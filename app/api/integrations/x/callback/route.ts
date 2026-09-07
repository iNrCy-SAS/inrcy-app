import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { encryptToken } from "@/lib/oauthCrypto";
import { clearAllToolCaches } from "@/lib/statsCache";
import { enforceRateLimit, getClientIp } from "@/lib/rateLimit";
import { getCookie, safeInternalPath, verifyOAuthState } from "@/lib/security";
import { resolveOAuthBoundInrcyAccountId } from "@/lib/multicompte/server";
import { asRecord, asString } from "@/lib/tsSafe";
import { withCurrentConnectionVersion } from "@/lib/connectionVersions";
import {
  fetchXAuthenticatedUser,
  getXOAuthScope,
  getXPkceCookieName,
  getXRedirectUri,
  openXCodeVerifier,
  requestXToken,
} from "@/lib/xOAuth";
import {
  oauthCallbackEvent,
  oauthCallbackException,
} from "@/lib/observability/oauth";
import { getFrenchPublicationErrorMessage } from "@/lib/publicationErrorFrench";

function getXConnectionUserMessage(input: unknown, fallback: string) {
  const raw = input instanceof Error
    ? String(input.message || "").trim()
    : String(input || "").trim();
  const normalized = raw.toLowerCase();

  if (
    normalized.includes("access_denied") ||
    normalized.includes("user_denied") ||
    normalized.includes("consent denied")
  ) {
    return "Connexion X annulée.";
  }
  if (
    normalized.includes("invalid_client") ||
    normalized.includes("invalid client") ||
    normalized.includes("client authentication failed")
  ) {
    return "La connexion X est temporairement indisponible. Merci de réessayer plus tard.";
  }

  const translated = getFrenchPublicationErrorMessage("x", input, fallback);
  return /^(?:http\s*)?\d{3}\b/i.test(translated) || /^[a-z0-9_.:-]+$/i.test(translated)
    ? fallback
    : translated;
}

function clearOAuthCookies(
  response: NextResponse,
  stateCookieName: string,
  pkceCookieName: string,
  secure: boolean,
) {
  const options = {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
  };
  response.cookies.set(stateCookieName, "", options);
  response.cookies.set(pkceCookieName, "", options);
  return response;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const siteUrl = String(process.env.NEXT_PUBLIC_SITE_URL || requestUrl.origin).replace(/\/$/, "");
  const stateCheck = verifyOAuthState<{ accountId?: string }>(
    request,
    "x",
    requestUrl.searchParams.get("state"),
  );
  const rawState = requestUrl.searchParams.get("state") || "";
  const pkceCookieName = getXPkceCookieName(rawState);
  const secureCookies = requestUrl.protocol === "https:" || process.env.NODE_ENV === "production";
  const returnTo = safeInternalPath(
    stateCheck.returnTo || "/dashboard?panel=x",
    "/dashboard?panel=x",
  );

  const redirectWithResult = (params: Record<string, string>) => {
    const destination = new URL(returnTo, siteUrl);
    destination.searchParams.set("linked", "x");
    for (const [key, value] of Object.entries(params)) destination.searchParams.set(key, value);
    return clearOAuthCookies(
      NextResponse.redirect(destination),
      stateCheck.cookieName,
      pkceCookieName,
      secureCookies,
    );
  };
  const fail = (code: string, message?: unknown) => {
    const safeMessage = message
      ? getXConnectionUserMessage(
          message,
          "La connexion X n'a pas pu être finalisée.",
        ).slice(0, 200)
      : "";
    oauthCallbackEvent(request, {
      provider: "x",
      outcome: "failed",
      error: code,
      message: safeMessage || undefined,
      return_to: returnTo,
      capture_in_sentry: true,
    });
    return redirectWithResult({ ok: "0", error: code, ...(safeMessage ? { message: safeMessage } : {}) });
  };

  try {
    oauthCallbackEvent(request, {
      provider: "x",
      outcome: "started",
      return_to: returnTo,
    });

    if (!stateCheck.ok) {
      oauthCallbackEvent(request, {
        provider: "x",
        outcome: "state_invalid",
        error: stateCheck.reason,
        return_to: returnTo,
        capture_in_sentry: true,
      });
      return redirectWithResult({ ok: "0", error: "oauth_state" });
    }

    const providerError = requestUrl.searchParams.get("error");
    const code = requestUrl.searchParams.get("code");
    if (providerError || !code) {
      const description = requestUrl.searchParams.get("error_description") || providerError || "missing_code";
      oauthCallbackEvent(request, {
        provider: "x",
        outcome: providerError === "access_denied" ? "cancelled" : "failed",
        error: providerError || "missing_code",
        message: description,
        return_to: returnTo,
        capture_in_sentry: providerError !== "access_denied",
      });
      return redirectWithResult({
        ok: "0",
        error: providerError || "missing_code",
        message: getXConnectionUserMessage(description, "Connexion X annulée.").slice(0, 200),
      });
    }

    const verifier = openXCodeVerifier(getCookie(request, pkceCookieName), rawState);
    if (!verifier) return fail("pkce_verifier_missing", "La session de connexion X a expiré. Relancez la connexion.");

    const clientId = String(process.env.X_CLIENT_ID || "").trim();
    const clientSecret = String(process.env.X_CLIENT_SECRET || "").trim();
    if (!clientId || !clientSecret) return fail("oauth_config_missing", "Configuration X incomplète côté serveur.");

    const supabase = await createSupabaseServer();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user) return fail("not_authenticated", "Votre session a expiré.");
    const userId = await resolveOAuthBoundInrcyAccountId(
      supabase,
      authData.user.id,
      stateCheck.state.accountId,
    );

    const userLimit = await enforceRateLimit({
      name: "oauth_x_cb",
      identifier: userId,
      limit: 10,
      window: "10 m",
    });
    if (userLimit) return clearOAuthCookies(userLimit, stateCheck.cookieName, pkceCookieName, secureCookies);
    const ipLimit = await enforceRateLimit({
      name: "oauth_x_cb_ip",
      identifier: getClientIp(request),
      limit: 20,
      window: "10 m",
    });
    if (ipLimit) return clearOAuthCookies(ipLimit, stateCheck.cookieName, pkceCookieName, secureCookies);

    const token = await requestXToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: getXRedirectUri(request.url),
      code_verifier: verifier,
    });
    const accessToken = asString(token.access_token);
    if (!accessToken) return fail("missing_access_token", "X n'a pas renvoyé de jeton d'accès.");
    const refreshToken = asString(token.refresh_token);
    if (!refreshToken) {
      return fail(
        "offline_access_missing",
        "X n'a pas accordé l'accès hors ligne nécessaire aux publications programmées.",
      );
    }

    const profile = await fetchXAuthenticatedUser(accessToken);
    const xUserId = asString(profile.id) || "";
    const username = asString(profile.username) || "";
    if (!xUserId || !username) return fail("x_profile_unavailable", "X n'a pas confirmé le profil autorisé.");
    const displayName = asString(profile.name) || username;
    const profileUrl = `https://x.com/${encodeURIComponent(username)}`;
    const expiresIn = Number(token.expires_in || 0);
    const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null;

    const { data: existing } = await supabaseAdmin
      .from("integrations")
      .select("meta")
      .eq("user_id", userId)
      .eq("provider", "x")
      .eq("source", "x")
      .eq("product", "x")
      .maybeSingle();
    const existingMeta = asRecord(asRecord(existing).meta);
    const payload = {
      user_id: userId,
      provider: "x",
      category: "social",
      source: "x",
      product: "x",
      status: "connected",
      display_name: displayName,
      provider_account_id: xUserId,
      scopes: asString(token.scope) || getXOAuthScope(),
      access_token_enc: encryptToken(accessToken),
      refresh_token_enc: encryptToken(refreshToken),
      expires_at: expiresAt,
      resource_id: xUserId,
      resource_label: username,
      meta: withCurrentConnectionVersion("channel:x", {
        ...existingMeta,
        username,
        name: displayName,
        profile_url: profileUrl,
        description: asString(profile.description) || null,
        location: asString(profile.location) || null,
        website_url: asString(profile.url) || null,
        profile_image_url: asString(profile.profile_image_url) || null,
        verified: profile.verified === true,
        public_metrics: asRecord(profile.public_metrics),
        token_type: asString(token.token_type) || "bearer",
        connected_at: new Date().toISOString(),
      }),
    };

    const { error: upsertError } = await supabaseAdmin
      .from("integrations")
      .upsert(payload, { onConflict: "user_id,provider,source,product" });
    if (upsertError) return fail("db_upsert_failed", upsertError);

    const { data: config } = await supabaseAdmin
      .from("pro_tools_configs")
      .select("settings")
      .eq("user_id", userId)
      .maybeSingle();
    const settings = asRecord(asRecord(config).settings);
    await supabaseAdmin.from("pro_tools_configs").upsert(
      {
        user_id: userId,
        settings: {
          ...settings,
          x: {
            ...asRecord(settings.x),
            accountConnected: true,
            connected: true,
            userId: xUserId,
            username,
            displayName,
            url: profileUrl,
            profileUrl,
          },
        },
      },
      { onConflict: "user_id" },
    );
    await clearAllToolCaches(supabase, userId);

    oauthCallbackEvent(request, {
      provider: "x",
      outcome: "success",
      return_to: returnTo,
    });
    return redirectWithResult({ ok: "1" });
  } catch (error) {
    oauthCallbackException(request, "x", error, {
      error: "oauth_callback_failed",
      return_to: returnTo,
    });
    return fail("oauth_callback_failed", error);
  }
}
