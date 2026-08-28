import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { clearAllToolCaches } from "@/lib/statsCache";
import { encryptToken as _encryptToken } from "@/lib/oauthCrypto";
import { gmbListAccounts } from "@/lib/googleBusiness";
import { enforceRateLimit, getClientIp } from "@/lib/rateLimit";
import { safeInternalPath, verifyOAuthState } from "@/lib/security";
import { asRecord, asString } from "@/lib/tsSafe";
import { oauthCallbackEvent, oauthCallbackException } from "@/lib/observability/oauth";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { log } from "@/lib/observability/logger";
import {
  findExplicitlyMissingGoogleScopes,
  GOOGLE_OAUTH_PERMISSION_ERROR_CODE,
  GOOGLE_OAUTH_PERMISSION_MESSAGE,
  GOOGLE_USERINFO_EMAIL_SCOPE,
} from "@/lib/googleOAuthConsent";

import { withCurrentConnectionVersion } from "@/lib/connectionVersions";
import { resolveOAuthBoundInrcyAccountId } from "@/lib/multicompte/server";
type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number | string;
  scope?: string;
  error?: string;
  error_description?: string;
};

type GoogleUserInfo = {
  id?: string;
  email?: string;
  name?: string;
  picture?: string;
};

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServer>>;

async function invalidateUserStatsCache(supabase: SupabaseServerClient, userId: string) {
  await clearAllToolCaches(supabase, userId);
}

export async function GET(req: Request) {
  try {
    const urlObj = new URL(req.url);
    const code = urlObj.searchParams.get("code");
    const stateRaw = urlObj.searchParams.get("state");
    const oauthError = urlObj.searchParams.get("error");
    const oauthErrorDescription = urlObj.searchParams.get("error_description");

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;
    if (!stateRaw) {
      oauthCallbackEvent(req, { provider: "google_business", outcome: "state_invalid", error: "missing_state", return_to: "/dashboard?panel=gmb", capture_in_sentry: true });
      return NextResponse.redirect(new URL("/dashboard?panel=gmb&toast=oauth_state", siteUrl));
    }

    // IMPORTANT:
    // - In dev you often hit this route via Cloudflare tunnel (https://xxxx.trycloudflare.com)
    // - But your app UI might be on http://localhost:3000 (no TLS)
    // So we MUST NOT guess the final redirect origin from req.url.
    // We use NEXT_PUBLIC_SITE_URL as the canonical base URL to redirect back to.

    const st = verifyOAuthState(req, "google_business", stateRaw);
    const returnToPath = safeInternalPath(st.returnTo || "/dashboard?panel=gmb", "/dashboard?panel=gmb");
    oauthCallbackEvent(req, { provider: "google_business", outcome: "started", return_to: returnToPath });
    const clearStateCookie = (res: NextResponse) => {
      res.cookies.set(st.cookieName, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
      return res;
    };

    const fail = (error: string, message?: string) => {
      oauthCallbackEvent(req, { provider: "google_business", outcome: "failed", error, message, return_to: returnToPath, capture_in_sentry: true });
      const finalUrl = new URL(returnToPath, siteUrl);
      finalUrl.searchParams.set("linked", "gmb");
      finalUrl.searchParams.set("ok", "0");
      finalUrl.searchParams.set("error", error);
      if (message) finalUrl.searchParams.set("message", getSimpleFrenchErrorMessage(message, "La connexion n'a pas pu être finalisée.").slice(0, 200));
      return clearStateCookie(NextResponse.redirect(finalUrl));
    };

    if (!st.ok) {
      oauthCallbackEvent(req, { provider: "google_business", outcome: "state_invalid", error: st.reason, return_to: returnToPath, capture_in_sentry: true });
      return clearStateCookie(NextResponse.redirect(new URL("/dashboard?panel=gmb&toast=oauth_state", siteUrl)));
    }

    if (oauthError || !code) {
      oauthCallbackEvent(req, { provider: "google_business", outcome: oauthError === "access_denied" ? "cancelled" : "failed", error: oauthError || "missing_code", message: oauthErrorDescription || undefined, return_to: returnToPath, capture_in_sentry: oauthError !== "access_denied" });
      const finalUrl = new URL(returnToPath, siteUrl);
      finalUrl.searchParams.set("linked", "gmb");
      finalUrl.searchParams.set("ok", "0");
      finalUrl.searchParams.set("error", oauthError || "missing_code");
      if (oauthErrorDescription) finalUrl.searchParams.set("message", getSimpleFrenchErrorMessage(oauthErrorDescription, "La connexion n'a pas pu être finalisée.").slice(0, 200));
      return clearStateCookie(NextResponse.redirect(finalUrl));
    }

    const clientId = process.env.GOOGLE_CLIENT_ID!;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
    const redirectFromEnv = process.env.GOOGLE_GMB_REDIRECT_URI;

    // For the token exchange, redirect_uri MUST match exactly what you configured in Google Cloud.
    // Prefer env so you can switch between dev tunnel and production.
    // IMPORTANT: the redirect_uri used here MUST match exactly what was used in the initial OAuth step.
    // Prefer env; otherwise use the canonical siteUrl (not req.url origin).
    const redirectUri = redirectFromEnv || `${siteUrl}/api/integrations/google-business/callback`;

    if (!clientId || !clientSecret) {
      oauthCallbackEvent(req, { provider: "google_business", outcome: "config_error", error: "oauth_config_missing", return_to: returnToPath, capture_in_sentry: true });
      return NextResponse.redirect(new URL("/dashboard?panel=gmb&linked=gmb&ok=0&error=oauth_config_missing", siteUrl));
    }

    const supabase = await createSupabaseServer();
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !authData?.user) {
      oauthCallbackEvent(req, { provider: "google_business", outcome: "not_authenticated", error: "not_authenticated", return_to: returnToPath });
      const finalUrl = new URL(returnToPath, siteUrl);
      finalUrl.searchParams.set("linked", "gmb");
      finalUrl.searchParams.set("ok", "0");
      finalUrl.searchParams.set("error", "not_authenticated");
      return clearStateCookie(NextResponse.redirect(finalUrl));
    }
    const userId = await resolveOAuthBoundInrcyAccountId(supabase, authData.user.id, st.state.accountId);

    const rlUser = await enforceRateLimit({
      name: "oauth_google_business_cb",
      identifier: userId,
      limit: 10,
      window: "10 m",
    });
    if (rlUser) return rlUser;

    const ip = getClientIp(req);
    const rlIp = await enforceRateLimit({
      name: "oauth_google_business_cb_ip",
      identifier: ip,
      limit: 20,
      window: "10 m",
    });
    if (rlIp) return rlIp;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = (await tokenRes.json()) as TokenResponse;
    if (!tokenRes.ok || !tokenData.access_token) {
      return fail("token_exchange_failed", "La connexion au compte a échoué. Merci de réessayer.");
    }

    const missingScopes = findExplicitlyMissingGoogleScopes(tokenData.scope, [
      "https://www.googleapis.com/auth/business.manage",
      GOOGLE_USERINFO_EMAIL_SCOPE,
    ]);
    if (missingScopes.length) {
      return fail(GOOGLE_OAUTH_PERMISSION_ERROR_CODE, GOOGLE_OAUTH_PERMISSION_MESSAGE);
    }

    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userInfo = (await userRes.json()) as GoogleUserInfo;
    if (!userRes.ok || !userInfo?.email) {
      return fail("userinfo_failed", "Impossible de récupérer les informations du compte.");
    }

    // Preserve refresh_token if Google doesn't return it
    const [existingIntegrationRes, existingConfigRes] = await Promise.all([
      supabaseAdmin
        .from("integrations")
        .select("id,refresh_token_enc,resource_id,resource_label,email_address,meta")
        .eq("user_id", userId)
        .eq("provider", "google")
        .eq("source", "gmb")
        .eq("product", "gmb")
        .maybeSingle(),
      supabaseAdmin
        .from("pro_tools_configs")
        .select("settings")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);
    const { data: existing, error: existingErr } = existingIntegrationRes;

    if (existingErr || existingConfigRes.error) {
      return fail("db_read_failed", "Le service est momentanément indisponible. Merci de réessayer.");
    }

    const existingRec = asRecord(existing);
    const existingMeta = asRecord(existingRec["meta"]);
    const existingProSettings = asRecord(asRecord(existingConfigRes.data)["settings"]);
    const existingSettings = asRecord(existingProSettings["gmb"]);
    const existingRefresh = asString(existingRec["refresh_token_enc"]);
    const existingId = asString(existingRec["id"]);
    const existingEmail = String(existingRec["email_address"] || "").trim().toLowerCase();
    const nextEmail = String(userInfo.email || "").trim().toLowerCase();
    const sameGoogleIdentity = !existingEmail || existingEmail === nextEmail;
    const preservedLocationName = sameGoogleIdentity
      ? asString(existingRec["resource_id"]) || asString(existingSettings["locationName"]) || asString(existingSettings["resource_id"])
      : null;
    const preservedLocationTitle = sameGoogleIdentity
      ? asString(existingRec["resource_label"]) || asString(existingSettings["locationTitle"]) || asString(existingSettings["resource_label"])
      : null;
    const preservedAccountName = sameGoogleIdentity
      ? asString(existingMeta["account"]) || asString(existingSettings["accountName"])
      : null;
    const preserveSelection = Boolean(
      preservedLocationName && preservedAccountName,
    );

    const refreshTokenToStore = tokenData.refresh_token
      ? _encryptToken(tokenData.refresh_token)
      : sameGoogleIdentity
        ? existingRefresh ?? null
        : null;

    const expiresAt =
      tokenData.expires_in != null
        ? new Date(Date.now() + Number(tokenData.expires_in) * 1000).toISOString()
        : null;

    const payload: Record<string, unknown> = {
      user_id: userId,
      provider: "google",
      category: "local",
      source: "gmb",
      product: "gmb",
      status: preserveSelection ? "connected" : "account_connected",
      email_address: userInfo.email,
      display_name: userInfo.name ?? null,
      provider_account_id: userInfo.id ?? null,
      scopes: tokenData.scope ?? null,
      access_token_enc: tokenData.access_token ? _encryptToken(tokenData.access_token) : null,
      refresh_token_enc: refreshTokenToStore,
      expires_at: expiresAt,
      resource_id: preserveSelection ? preservedLocationName : null,
      resource_label: preserveSelection ? preservedLocationTitle : null,
      meta: withCurrentConnectionVersion("channel:gmb", {
        ...existingMeta,
        picture: userInfo.picture ?? null,
        account: preserveSelection ? preservedAccountName : null,
      }),
    };

    if (existingId) {
      const { error: upErr } = await supabaseAdmin
        .from("integrations")
        .update(payload)
        .eq("id", existingId)
        .eq("user_id", userId);
      if (upErr) return fail("db_update_failed", "La mise à jour a échoué.");
    } else {
      const { error: insErr } = await supabaseAdmin.from("integrations").insert(payload);
      if (insErr) return fail("db_insert_failed", "Le service est momentanément indisponible. Merci de réessayer.");
    }

    // Keep this display mirror synchronized, but never use it as publication
    // authority. Reusing the validated snapshot avoids a second-read race.
    {
      const merged = {
        ...existingProSettings,
        gmb: {
          ...existingSettings,
          connected: true,
          configured: preserveSelection,
          accountEmail: userInfo.email,
          accountDisplayName: userInfo.name ?? null,
          accountName: preserveSelection ? preservedAccountName : null,
          locationName: preserveSelection ? preservedLocationName : null,
          locationTitle: preserveSelection ? preservedLocationTitle : null,
          resource_id: preserveSelection ? preservedLocationName : null,
          resource_label: preserveSelection ? preservedLocationTitle : null,
        },
      };
      const { error: mirrorError } = await supabaseAdmin
        .from("pro_tools_configs")
        .upsert({ user_id: userId, settings: merged }, { onConflict: "user_id" });
      if (mirrorError) {
        log.warn("google_business_settings_mirror_sync_failed", {
          route: "google_business_callback",
          user_id: userId,
          error: mirrorError.message,
        });
      }
    }


    // IMPORTANT:
    // We DO NOT auto-select a location here.
    // GMB stats are tied to a specific establishment (location). Until the user explicitly
    // chooses a location in the UI, we must not fetch or display metrics.
    // We can however store a default *account* hint to help list locations faster.
    try {
      // tokenData.access_token is the raw access token returned by Google.
      // payload.access_token_enc is stored for DB usage but is typed as unknown (Record<string, unknown>).
      // For calling Google APIs we must use a real string access token.
      const accessToken = typeof tokenData.access_token === "string" ? tokenData.access_token.trim() : "";
      if (accessToken) {
        const accounts = await gmbListAccounts(accessToken);
          const firstAcc = preserveSelection ? preservedAccountName : accounts?.[0]?.name; // e.g. "accounts/123"
          if (firstAcc) {
            const metaToMerge = asRecord(payload["meta"]);
            const { error: accountHintError } = await supabaseAdmin
              .from("integrations")
              .update({
                meta: withCurrentConnectionVersion("channel:gmb", { ...metaToMerge, account: firstAcc }),
                resource_id: preserveSelection ? preservedLocationName : null,
                resource_label: preserveSelection ? preservedLocationTitle : null,
                status: preserveSelection ? "connected" : "account_connected",
              })
            .eq("user_id", userId)
            .eq("provider", "google")
            .eq("source", "gmb")
            .eq("product", "gmb");
            if (accountHintError) {
              log.warn("google_business_account_hint_sync_failed", {
                route: "google_business_callback",
                user_id: userId,
                error: accountHintError.message,
              });
            }
        }
      }
    } catch (discoveryError) {
      log.warn("google_business_account_discovery_failed", {
        route: "google_business_callback",
        user_id: userId,
        error:
          discoveryError instanceof Error
            ? discoveryError.message
            : String(discoveryError || ""),
      });
    }

    // Invalidate stats cache so iNrStats + Generator reflect the new connection immediately.
    await invalidateUserStatsCache(supabase, userId);

    // Build final redirect URL safely and append params without breaking existing querystring
    const finalUrl = new URL(returnToPath, siteUrl);
    finalUrl.searchParams.set("linked", "gmb");
    finalUrl.searchParams.set("ok", "1");

    oauthCallbackEvent(req, { provider: "google_business", outcome: "success", user_id: userId, return_to: returnToPath });
    return clearStateCookie(NextResponse.redirect(finalUrl));
  } catch (e: unknown) {
    oauthCallbackException(req, "google_business", e, { error: "oauth_callback_failed", return_to: "/dashboard?panel=gmb" });
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;
    const finalUrl = new URL("/dashboard?panel=gmb", siteUrl);
    finalUrl.searchParams.set("linked", "gmb");
    finalUrl.searchParams.set("ok", "0");
    finalUrl.searchParams.set("error", "oauth_callback_failed");
    const msg = getSimpleFrenchErrorMessage(e, "La connexion n'a pas pu être finalisée.").slice(0, 200);
    if (msg) finalUrl.searchParams.set("message", msg);
    return NextResponse.redirect(finalUrl);
  }
}
