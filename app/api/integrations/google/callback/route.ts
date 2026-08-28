import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { encryptToken } from "@/lib/oauthCrypto";
import { enforceRateLimit, getClientIp } from "@/lib/rateLimit";
import { safeInternalPath, verifyOAuthState } from "@/lib/security";
import { asRecord, asString } from "@/lib/tsSafe";
import { oauthCallbackEvent, oauthCallbackException } from "@/lib/observability/oauth";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveOAuthBoundInrcyAccountId } from "@/lib/multicompte/server";
import {
  findExplicitlyMissingGoogleScopes,
  GOOGLE_OAUTH_PERMISSION_ERROR_CODE,
  GOOGLE_OAUTH_PERMISSION_MESSAGE,
  GOOGLE_USERINFO_EMAIL_SCOPE,
} from "@/lib/googleOAuthConsent";

import { withCurrentConnectionVersion } from "@/lib/connectionVersions";
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

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;

  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");
    const oauthError = searchParams.get("error");
    const oauthErrorDescription = searchParams.get("error_description");

    const clientId = process.env.GOOGLE_CLIENT_ID!;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
    const redirectFromEnv = process.env.GOOGLE_REDIRECT_URI;

    // ✅ Robust redirect_uri (must match the one used in /start)
    const redirectUri = redirectFromEnv || `${origin}/api/integrations/google/callback`;

    if (!clientId || !clientSecret) {
      oauthCallbackEvent(req, { provider: "google", outcome: "config_error", error: "oauth_config_missing", return_to: "/dashboard?panel=mails", capture_in_sentry: true });
      return NextResponse.redirect(new URL("/dashboard?panel=mails&ok=0&error=oauth_config_missing", origin));
    }

    // ✅ CSRF protection: verify state against HttpOnly cookie
    const st = verifyOAuthState(req, "google", searchParams.get("state"));
    const returnTo = safeInternalPath(st.returnTo || "/dashboard?panel=mails&toast=connected", "/dashboard?panel=mails&toast=connected");
    oauthCallbackEvent(req, { provider: "google", outcome: "started", return_to: returnTo });
    const fail = (error: string, message?: string) => {
      oauthCallbackEvent(req, { provider: "google", outcome: "failed", error, message, return_to: returnTo, capture_in_sentry: true });
      const finalUrl = new URL(returnTo, origin);
      finalUrl.searchParams.set("linked", "google");
      finalUrl.searchParams.set("ok", "0");
      finalUrl.searchParams.set("error", error);
      if (message) finalUrl.searchParams.set("message", getSimpleFrenchErrorMessage(message, "La connexion n'a pas pu être finalisée.").slice(0, 200));
      const res = NextResponse.redirect(finalUrl);
      res.cookies.set(st.cookieName, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
      return res;
    };

    if (!st.ok) {
      oauthCallbackEvent(req, { provider: "google", outcome: "state_invalid", error: "invalid_state", return_to: returnTo, capture_in_sentry: true });
      const res = NextResponse.redirect(new URL(`/dashboard?panel=mails&toast=oauth_state`, origin));
      res.cookies.set(st.cookieName, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
      return res;
    }

    if (oauthError || !code) {
      oauthCallbackEvent(req, { provider: "google", outcome: oauthError === "access_denied" ? "cancelled" : "failed", error: oauthError || "missing_code", message: oauthErrorDescription || undefined, return_to: returnTo, capture_in_sentry: oauthError !== "access_denied" });
      const resUrl = new URL(returnTo, origin);
      resUrl.searchParams.set("linked", "google");
      resUrl.searchParams.set("ok", "0");
      resUrl.searchParams.set("error", oauthError || "missing_code");
      if (oauthErrorDescription) resUrl.searchParams.set("message", getSimpleFrenchErrorMessage(oauthErrorDescription, "La connexion n'a pas pu être finalisée.").slice(0, 200));
      const res = NextResponse.redirect(resUrl);
      res.cookies.set(st.cookieName, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
      return res;
    }

    const { supabase, user, authUserId, errorResponse } = await requireUser();
    if (errorResponse) {
      oauthCallbackEvent(req, { provider: "google", outcome: "not_authenticated", error: "not_authenticated", return_to: returnTo });
      return fail("not_authenticated");
    }
    const userId = await resolveOAuthBoundInrcyAccountId(supabase, authUserId, st.state.accountId);

    // Clear state cookie once used
    // (do it early; if the rest fails, user can restart the flow)
    // We'll attach it to the final response.

    // Rate limit OAuth callbacks
    const rlUser = await enforceRateLimit({
      name: "oauth_google_cb",
      identifier: userId,
      limit: 10,
      window: "10 m",
    });
    if (rlUser) return rlUser;

    const ip = getClientIp(req);
    const rlIp = await enforceRateLimit({
      name: "oauth_google_cb_ip",
      identifier: ip,
      limit: 20,
      window: "10 m",
    });
    if (rlIp) return rlIp;

    // 1) Exchange code -> tokens
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
  return fail(
    "token_exchange_failed",
    tokenData.error_description || tokenData.error || "La connexion au compte a échoué. Merci de réessayer."
  );
}

    const missingScopes = findExplicitlyMissingGoogleScopes(tokenData.scope, [
      "https://www.googleapis.com/auth/gmail.send",
      GOOGLE_USERINFO_EMAIL_SCOPE,
    ]);
    if (missingScopes.length) {
      return fail(GOOGLE_OAUTH_PERMISSION_ERROR_CODE, GOOGLE_OAUTH_PERMISSION_MESSAGE);
    }

    // 2) Get user email
    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const userInfo = (await userRes.json()) as GoogleUserInfo;

    if (!userRes.ok || !userInfo?.email) {
      return fail("userinfo_failed", "Impossible de récupérer les informations du compte.");
    }

    // 3) Read existing row (to preserve refresh_token if not returned)
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("integrations")
      .select("id, refresh_token_enc")
      .eq("user_id", userId)
      .eq("provider", "gmail")
      .eq("category", "mail")
      .eq("account_email", userInfo.email)
      .maybeSingle();

    if (existingErr) {
      return fail("db_read_failed", "Le service est momentanément indisponible. Merci de réessayer.");
    }

    const refreshTokenEncToStore = tokenData.refresh_token
      ? encryptToken(tokenData.refresh_token)
      : asString(asRecord(existing)["refresh_token_enc"]) ?? null;

    const expiresAt =
      tokenData.expires_in != null
        ? new Date(Date.now() + Number(tokenData.expires_in) * 1000).toISOString()
        : null;

    const payload = {
      user_id: userId,
      provider: "gmail",
      category: "mail",
      product: "gmail",
      account_email: userInfo.email,
      provider_account_id: userInfo.id ?? null,
      status: "connected",
      access_token_enc: tokenData.access_token ? encryptToken(tokenData.access_token) : null,
      refresh_token_enc: refreshTokenEncToStore,
      expires_at: expiresAt,
      settings: withCurrentConnectionVersion("mail:gmail", {
        display_name: userInfo.name ?? null,
        scopes_raw: tokenData.scope ?? null,
      }),
      updated_at: new Date().toISOString(),
    };

    // 4) Update or insert
    if (asRecord(existing)["id"]) {
      const { error: upErr } = await supabaseAdmin
        .from("integrations")
        .update(payload)
        .eq("id", String(asRecord(existing)["id"]))
        .eq("user_id", userId);

      if (upErr) {
        return fail("db_update_failed", "La mise à jour a échoué.");
      }
    } else {
      const { error: insErr } = await supabaseAdmin.from("integrations").insert(payload);
      if (insErr) {
        return fail("db_insert_failed", "Le service est momentanément indisponible. Merci de réessayer.");
      }
    }

    const res = NextResponse.redirect(new URL(returnTo, origin));
    res.cookies.set(st.cookieName, "", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    oauthCallbackEvent(req, { provider: "google", outcome: "success", user_id: userId, return_to: returnTo });
    return res;
  } catch (e: unknown) {
    // No stack traces to clients in production.
    oauthCallbackException(req, "google", e, { error: "oauth_callback_failed", return_to: "/dashboard?panel=mails" });
    const message = getSimpleFrenchErrorMessage(e, "La connexion au compte a échoué. Merci de réessayer.");
    return NextResponse.redirect(new URL(`/dashboard?panel=mails&linked=google&ok=0&error=oauth_callback_failed&message=${encodeURIComponent(message.slice(0, 200))}`, origin));
  }
}
