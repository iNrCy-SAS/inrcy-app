import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { clearAllToolCaches } from "@/lib/statsCache";
import { encryptToken } from "@/lib/oauthCrypto";
import { enforceRateLimit, getClientIp } from "@/lib/rateLimit";
import { safeInternalPath, verifyOAuthState } from "@/lib/security";
import { asRecord, asString } from "@/lib/tsSafe";
import {
  oauthCallbackEvent,
  oauthCallbackException,
} from "@/lib/observability/oauth";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getLinkedInOAuthScope } from "@/lib/linkedinScopes";

import { withCurrentConnectionVersion } from "@/lib/connectionVersions";
import { resolveOAuthBoundInrcyAccountId } from "@/lib/multicompte/server";
type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServer>>;

async function invalidateUserStatsCache(
  supabase: SupabaseServerClient,
  userId: string,
) {
  await clearAllToolCaches(supabase, userId);
}

async function postForm(url: string, form: Record<string, string>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
    cache: "no-store",
  });
  const data: unknown = await res.json().catch(() => ({}));
  const rec = asRecord(data);
  if (!res.ok) {
    throw new Error(
      asString(rec["error_description"]) ||
        asString(rec["error"]) ||
        `HTTP ${res.status}`,
    );
  }
  return rec;
}

async function fetchJson(url: string, accessToken: string) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const data: unknown = await res.json().catch(() => ({}));
  const rec = asRecord(data);
  if (!res.ok) {
    throw new Error(
      asString(rec["message"]) ||
        asString(rec["error"]) ||
        `HTTP ${res.status}`,
    );
  }
  return rec;
}

export async function GET(req: Request) {
  try {
    const urlObj = new URL(req.url);
    const code = urlObj.searchParams.get("code");
    const stateRaw = urlObj.searchParams.get("state");
    const err = urlObj.searchParams.get("error");
    const errDesc = urlObj.searchParams.get("error_description");

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;
    const st = verifyOAuthState(req, "linkedin", stateRaw);
    const returnTo = safeInternalPath(
      st.returnTo || "/dashboard?panel=linkedin",
      "/dashboard?panel=linkedin",
    );
    oauthCallbackEvent(req, {
      provider: "linkedin",
      outcome: "started",
      return_to: returnTo,
    });
    const clearStateCookie = (res: NextResponse) => {
      res.cookies.set(st.cookieName, "", {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });
      return res;
    };

    const fail = (error: string, message?: string) => {
      oauthCallbackEvent(req, {
        provider: "linkedin",
        outcome: "failed",
        error,
        message,
        return_to: returnTo,
        capture_in_sentry: true,
      });
      const finalUrl = new URL(returnTo, siteUrl);
      finalUrl.searchParams.set("linked", "linkedin");
      finalUrl.searchParams.set("ok", "0");
      finalUrl.searchParams.set("error", error);
      if (message)
        finalUrl.searchParams.set(
          "message",
          getSimpleFrenchErrorMessage(
            message,
            "La connexion n'a pas pu être finalisée.",
          ).slice(0, 200),
        );
      return clearStateCookie(NextResponse.redirect(finalUrl));
    };

    if (!st.ok) {
      oauthCallbackEvent(req, {
        provider: "linkedin",
        outcome: "state_invalid",
        error: st.reason,
        return_to: returnTo,
        capture_in_sentry: true,
      });
      return clearStateCookie(
        NextResponse.redirect(
          new URL("/dashboard?panel=linkedin&toast=oauth_state", siteUrl),
        ),
      );
    }

    if (err || !code) {
      oauthCallbackEvent(req, {
        provider: "linkedin",
        outcome: err === "access_denied" ? "cancelled" : "failed",
        error: err || "missing_code",
        message: errDesc || undefined,
        return_to: returnTo,
        capture_in_sentry: err !== "access_denied",
      });
      const finalUrl = new URL(returnTo, siteUrl);
      finalUrl.searchParams.set("linked", "linkedin");
      finalUrl.searchParams.set("ok", "0");
      if (err) finalUrl.searchParams.set("reason", String(err));
      if (errDesc)
        finalUrl.searchParams.set(
          "message",
          getSimpleFrenchErrorMessage(
            errDesc,
            "La connexion n'a pas pu être finalisée.",
          ).slice(0, 200),
        );
      return clearStateCookie(NextResponse.redirect(finalUrl));
    }

    const clientId = process.env.LINKEDIN_CLIENT_ID;
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
    const redirectFromEnv = process.env.LINKEDIN_REDIRECT_URI;
    const redirectUri =
      redirectFromEnv || `${siteUrl}/api/integrations/linkedin/callback`;

    if (!clientId || !clientSecret) {
      oauthCallbackEvent(req, {
        provider: "linkedin",
        outcome: "config_error",
        error: "oauth_config_missing",
        return_to: returnTo,
        capture_in_sentry: true,
      });
      return NextResponse.redirect(
        new URL(
          "/dashboard?panel=linkedin&linked=linkedin&ok=0&error=oauth_config_missing",
          siteUrl,
        ),
      );
    }

    const supabase = await createSupabaseServer();
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !authData?.user) {
      oauthCallbackEvent(req, {
        provider: "linkedin",
        outcome: "not_authenticated",
        error: "not_authenticated",
        return_to: returnTo,
      });
      const finalUrl = new URL(returnTo, siteUrl);
      finalUrl.searchParams.set("linked", "linkedin");
      finalUrl.searchParams.set("ok", "0");
      finalUrl.searchParams.set("error", "not_authenticated");
      return clearStateCookie(NextResponse.redirect(finalUrl));
    }
    const userId = await resolveOAuthBoundInrcyAccountId(supabase, authData.user.id, st.state.accountId);

    const rlUser = await enforceRateLimit({
      name: "oauth_linkedin_cb",
      identifier: userId,
      limit: 10,
      window: "10 m",
    });
    if (rlUser) return rlUser;

    const ip = getClientIp(req);
    const rlIp = await enforceRateLimit({
      name: "oauth_linkedin_cb_ip",
      identifier: ip,
      limit: 20,
      window: "10 m",
    });
    if (rlIp) return rlIp;

    const token = await postForm(
      "https://www.linkedin.com/oauth/v2/accessToken",
      {
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      },
    );

    const accessToken = String(token?.access_token || "");
    if (!accessToken)
      return fail(
        "missing_access_token",
        "La connexion LinkedIn a échoué. Merci de réessayer.",
      );

    const expiresIn = Number(token?.expires_in);
    const expiresAt =
      Number.isFinite(expiresIn) && expiresIn > 0
        ? new Date(Date.now() + expiresIn * 1000).toISOString()
        : null;
    const refreshToken = String(token?.refresh_token || "");
    const refreshTokenExpiresIn = Number(token?.refresh_token_expires_in);

    // App LinkedIn Community Management : on utilise uniquement les scopes
    // réellement autorisés dans le portail développeur, notamment r_basicprofile.
    // Ne pas appeler /v2/userinfo, /v2/emailAddress, ni demander openid/email/r_emailaddress.
    let sub = "";
    let name = "";
    const email = "";
    let profileUrl: unknown = null;

    try {
      const me = await fetchJson("https://api.linkedin.com/v2/me", accessToken);
      const meRec = asRecord(me);
      sub = String(meRec["id"] || "");
      const firstName =
        asString(asRecord(asRecord(meRec["localizedFirstName"]))["fr_FR"]) ||
        asString(meRec["localizedFirstName"]);
      const lastName =
        asString(asRecord(asRecord(meRec["localizedLastName"]))["fr_FR"]) ||
        asString(meRec["localizedLastName"]);
      name = [firstName, lastName].filter(Boolean).join(" ").trim();
      profileUrl = meRec["vanityName"]
        ? `https://www.linkedin.com/in/${String(meRec["vanityName"])}`
        : null;
    } catch {}

    if (!sub) {
      return fail(
        "linkedin_profile_unavailable",
        "LinkedIn n'a pas confirmé le profil autorisé. Merci de relancer la connexion.",
      );
    }

    const authorUrn = sub ? `urn:li:person:${sub}` : "";

    const { data: existingIntegration } = await supabaseAdmin
      .from("integrations")
      .select("refresh_token_enc,meta")
      .eq("user_id", userId)
      .eq("provider", "linkedin")
      .eq("source", "linkedin")
      .eq("product", "linkedin")
      .maybeSingle();
    const existingRec = asRecord(existingIntegration);
    const existingMeta = asRecord(existingRec["meta"]);
    const refreshTokenExpiresAt =
      refreshToken &&
      Number.isFinite(refreshTokenExpiresIn) &&
      refreshTokenExpiresIn > 0
        ? new Date(Date.now() + refreshTokenExpiresIn * 1000).toISOString()
        : asString(existingMeta["refresh_expires_at"]) || null;
    const refreshTokenEncToStore = refreshToken
      ? encryptToken(refreshToken)
      : existingRec["refresh_token_enc"] || null;

    // Upsert integration
    // Upsert (robuste même si l’utilisateur reconnecte plusieurs fois)
    // Nécessite un UNIQUE INDEX sur (user_id, provider, source, product) côté Supabase.
    const payload: Record<string, unknown> = {
      user_id: userId,
      provider: "linkedin",
      category: "social",
      source: "linkedin",
      product: "linkedin",
      status: "connected",
      email_address: email || null,
      display_name: name || null,
      provider_account_id: sub || null,
      scopes: getLinkedInOAuthScope(),
      access_token_enc: encryptToken(accessToken),
      refresh_token_enc: refreshTokenEncToStore,
      expires_at: expiresAt,
      resource_id: authorUrn || null,
      resource_label: name || null,
      meta: {
        ...existingMeta,
        profile_display_name:
          name || existingMeta["profile_display_name"] || null,
        profile_url: profileUrl || existingMeta["profile_url"] || null,
        profile_urn: authorUrn || existingMeta["profile_urn"] || null,
        org_urn: null,
        org_id: null,
        org_name: null,
        org_url: null,
        refresh_token_expires_in: Number.isFinite(refreshTokenExpiresIn)
          ? refreshTokenExpiresIn
          : (existingMeta["refresh_token_expires_in"] ?? null),
        refresh_expires_at: refreshTokenExpiresAt,
        ...withCurrentConnectionVersion("channel:linkedin", {}),
      },
    };

    await supabaseAdmin
      .from("integrations")
      .upsert(payload, { onConflict: "user_id,provider,source,product" });

    // Invalidate stats cache so iNrStats + Generator reflect the new connection immediately.
    await invalidateUserStatsCache(supabase, userId);

    // Mirror in pro_tools_configs
    try {
      const { data: scRow } = await supabaseAdmin
        .from("pro_tools_configs")
        .select("settings")
        .eq("user_id", userId)
        .maybeSingle();
      const current = asRecord(asRecord(scRow)["settings"]);
      const merged = {
        ...current,
        linkedin: {
          ...asRecord(current["linkedin"]),
          accountConnected: true,
          connected: true,
          displayName: name || null,
          url: profileUrl || "",
          profileUrl: profileUrl || "",
          orgId: "",
          orgName: "",
          orgUrl: "",
          shareToPersonalProfile: false,
        },
      };
      await supabaseAdmin
        .from("pro_tools_configs")
        .upsert(
          { user_id: userId, settings: merged },
          { onConflict: "user_id" },
        );
    } catch {}

    const finalUrl = new URL(returnTo, siteUrl);
    finalUrl.searchParams.set("linked", "linkedin");
    finalUrl.searchParams.set("ok", "1");
    oauthCallbackEvent(req, {
      provider: "linkedin",
      outcome: "success",
      user_id: userId,
      return_to: returnTo,
    });
    return clearStateCookie(NextResponse.redirect(finalUrl));
  } catch (e: unknown) {
    oauthCallbackException(req, "linkedin", e, {
      error: "oauth_callback_failed",
      return_to: "/dashboard?panel=linkedin",
    });
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;
    const finalUrl = new URL("/dashboard?panel=linkedin", siteUrl);
    finalUrl.searchParams.set("linked", "linkedin");
    finalUrl.searchParams.set("ok", "0");
    finalUrl.searchParams.set("error", "oauth_callback_failed");
    const msg = getSimpleFrenchErrorMessage(e).slice(0, 200);
    if (msg) finalUrl.searchParams.set("message", msg);
    return NextResponse.redirect(finalUrl);
  }
}
