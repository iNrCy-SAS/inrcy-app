import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { encryptToken, tryDecryptToken } from "@/lib/oauthCrypto";
import { enforceRateLimit, getClientIp } from "@/lib/rateLimit";
import { safeInternalPath, verifyOAuthState } from "@/lib/security";
import { asRecord, asString } from "@/lib/tsSafe";
import { oauthCallbackEvent, oauthCallbackException } from "@/lib/observability/oauth";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import { withCurrentConnectionVersion } from "@/lib/connectionVersions";
import { resolveOAuthBoundInrcyAccountId } from "@/lib/multicompte/server";
type TokenResponse = {
  token_type?: string;
  scope?: string;
  expires_in?: number;
  ext_expires_in?: number;
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

type GraphMe = {
  id?: string;
  displayName?: string;
  mail?: string;
  userPrincipalName?: string;
};

function computeExpiresAt(expires_in?: number | null) {
  if (!expires_in) return null;
  return new Date(Date.now() + Number(expires_in) * 1000).toISOString();
}

const MICROSOFT_SAFE_TOKEN_ERRORS = new Set([
  "invalid_request", "invalid_client", "invalid_grant", "unauthorized_client",
  "unsupported_grant_type", "invalid_scope", "access_denied", "server_error",
  "temporarily_unavailable", "interaction_required", "consent_required", "login_required",
]);

function tokenFailureDiagnostics(data: TokenResponse) {
  const record = asRecord(data);
  const providerError = asString(record["error"]);
  const codes = Array.isArray(record["error_codes"]) ? record["error_codes"] : [];
  const aadstsCodes: number[] = [];
  for (const code of codes) {
    if (typeof code === "number" && Number.isSafeInteger(code) && code > 0 && code <= 999_999_999) aadstsCodes.push(code);
  }
  // Some Microsoft responses omit error_codes. Extract only the numeric AADSTS
  // identifier; never log the description, trace details or returned payload.
  if (!aadstsCodes.length) {
    const description = (asString(record["error_description"]) || "").slice(0, 8_000);
    for (const match of description.matchAll(/\bAADSTS(\d{3,9})\b/g)) aadstsCodes.push(Number(match[1]));
  }
  return {
    ...(providerError && MICROSOFT_SAFE_TOKEN_ERRORS.has(providerError) ? { provider_error: providerError } : {}),
    aadsts_codes: Array.from(new Set(aadstsCodes)).slice(0, 8),
  };
}

export async function GET(req: Request) {
  let callbackUserId: string | undefined;
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");
    const oauthError = searchParams.get("error");
    const oauthErrorDescription = searchParams.get("error_description");
    const stateRaw = searchParams.get("state");
    const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;

    const st = verifyOAuthState(req, "microsoft", stateRaw);
    const returnTo = safeInternalPath(st.returnTo || "/dashboard?panel=mails", "/dashboard?panel=mails");
    oauthCallbackEvent(req, { provider: "microsoft", outcome: "started", return_to: returnTo });
    const clearStateCookie = (res: NextResponse) => {
      res.cookies.set(st.cookieName, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
      return res;
    };

    const fail = (error: string, message?: string, details: {
      public_error?: string;
      status_code?: number;
      provider_error?: string;
      aadsts_codes?: number[];
    } = {}) => {
      const { public_error: publicError, ...diagnostics } = details;
      oauthCallbackEvent(req, { provider: "microsoft", outcome: "failed", error, message, user_id: callbackUserId, return_to: returnTo, capture_in_sentry: true, ...diagnostics });
      const finalUrl = new URL(returnTo, origin);
      finalUrl.searchParams.set("linked", "microsoft");
      finalUrl.searchParams.set("ok", "0");
      finalUrl.searchParams.set("error", publicError || error);
      if (message) finalUrl.searchParams.set("message", getSimpleFrenchErrorMessage(message, "La connexion n'a pas pu être finalisée.").slice(0, 200));
      return clearStateCookie(NextResponse.redirect(finalUrl));
    };

    if (!st.ok) {
      oauthCallbackEvent(req, { provider: "microsoft", outcome: "state_invalid", error: st.reason, return_to: returnTo, capture_in_sentry: true });
      return clearStateCookie(NextResponse.redirect(new URL("/dashboard?panel=mails&toast=oauth_state", origin)));
    }

    if (oauthError || !code) {
      oauthCallbackEvent(req, { provider: "microsoft", outcome: oauthError === "access_denied" ? "cancelled" : "failed", error: oauthError || "missing_code", message: oauthErrorDescription || undefined, return_to: returnTo, capture_in_sentry: oauthError !== "access_denied" });
      const finalUrl = new URL(returnTo, origin);
      finalUrl.searchParams.set("linked", "microsoft");
      finalUrl.searchParams.set("ok", "0");
      finalUrl.searchParams.set("error", oauthError || "missing_code");
      if (oauthErrorDescription) finalUrl.searchParams.set("message", getSimpleFrenchErrorMessage(oauthErrorDescription, "La connexion n'a pas pu être finalisée.").slice(0, 200));
      return clearStateCookie(NextResponse.redirect(finalUrl));
    }

    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    const redirectUri = process.env.MICROSOFT_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      oauthCallbackEvent(req, { provider: "microsoft", outcome: "config_error", error: "oauth_config_missing", return_to: returnTo, capture_in_sentry: true });
      return NextResponse.redirect(new URL("/dashboard?panel=mails&linked=microsoft&ok=0&error=oauth_config_missing", origin));
    }

    const supabase = await createSupabaseServer();
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !authData?.user) {
      oauthCallbackEvent(req, { provider: "microsoft", outcome: "not_authenticated", error: "not_authenticated", return_to: returnTo });
      const finalUrl = new URL(returnTo, origin);
      finalUrl.searchParams.set("linked", "microsoft");
      finalUrl.searchParams.set("ok", "0");
      finalUrl.searchParams.set("error", "not_authenticated");
      return clearStateCookie(NextResponse.redirect(finalUrl));
    }
    const userId = await resolveOAuthBoundInrcyAccountId(supabase, authData.user.id, st.state.accountId);
    callbackUserId = userId;

    const rlUser = await enforceRateLimit({
      name: "oauth_microsoft_cb",
      identifier: userId,
      limit: 10,
      window: "10 m",
    });
    if (rlUser) return rlUser;

    const ip = getClientIp(req);
    const rlIp = await enforceRateLimit({
      name: "oauth_microsoft_cb_ip",
      identifier: ip,
      limit: 20,
      window: "10 m",
    });
    if (rlIp) return rlIp;

    // Exchange code -> tokens
    const tokenRes = await fetch(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      }
    );

    const tokenData = asRecord(await tokenRes.json().catch(() => ({}))) as TokenResponse;
    if (!tokenRes.ok || !tokenData.access_token) {
      const diagnostics = tokenFailureDiagnostics(tokenData);
      const configurationFailure = diagnostics.aadsts_codes.some((code) => code === 7000222 || code === 7000215);
      const authorizationExpired = diagnostics.aadsts_codes.some((code) => code === 700082 || code === 70043);
      return fail("token_exchange_failed", undefined, {
        ...diagnostics,
        status_code: tokenRes.status,
        ...(configurationFailure ? { public_error: "microsoft_oauth_configuration_error" }
          : authorizationExpired ? { public_error: "microsoft_oauth_authorization_expired" } : {}),
      });
    }

    // Fetch /me
    const meRes = await fetch("https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const me = (await meRes.json().catch(() => ({}))) as GraphMe;
    if (!meRes.ok) {
      return fail("graph_me_failed", "Impossible de récupérer les informations du compte Microsoft.");
    }

    const email = (me.mail || me.userPrincipalName || "").toLowerCase();
    if (!email) {
      return fail("email_resolution_failed", "Impossible de retrouver l’adresse e-mail du compte Microsoft.");
    }

    // Preserve refresh token if not returned (rare but possible)
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("integrations")
      .select("id, refresh_token_enc")
      .eq("user_id", userId)
      .eq("provider", "microsoft")
      .eq("category", "mail")
      .eq("account_email", email)
      .maybeSingle();

    if (existingErr) {
      return fail("db_read_failed", "Le service est momentanément indisponible. Merci de réessayer.");
    }

    const existingRefreshEnc = asString(asRecord(existing)["refresh_token_enc"]) ?? null;
    const existingRefreshPlain = existingRefreshEnc ? tryDecryptToken(String(existingRefreshEnc)) : null;
    const refreshTokenToStore = tokenData.refresh_token ?? existingRefreshPlain ?? null;
    const refreshTokenEncToStore = refreshTokenToStore ? encryptToken(String(refreshTokenToStore)) : null;

    const payload = {
      user_id: userId,
      provider: "microsoft",
      category: "mail",
      product: "microsoft",
      account_email: email,
      provider_account_id: me.id ?? null,
      status: "connected",
      access_token_enc: tokenData.access_token ? encryptToken(tokenData.access_token) : null,
      refresh_token_enc: refreshTokenEncToStore,
      expires_at: computeExpiresAt(tokenData.expires_in ?? null),
      settings: withCurrentConnectionVersion("mail:microsoft", {
        display_name: me.displayName ?? null,
        scopes_raw: tokenData.scope ?? null,
      }),
      updated_at: new Date().toISOString(),
    };

    if (asRecord(existing)["id"]) {
      const { error: upErr } = await supabaseAdmin
        .from("integrations")
        .update(payload)
        .eq("id", String(asRecord(existing)["id"]))
        .eq("user_id", userId);

      if (upErr) return fail("db_update_failed", "La mise à jour a échoué.");
    } else {
      const { error: insErr } = await supabaseAdmin.from("integrations").insert(payload);
      if (insErr) return fail("db_insert_failed", "Le service est momentanément indisponible. Merci de réessayer.");
    }


    const finalUrl = new URL(returnTo, origin);
    finalUrl.searchParams.set("linked", "microsoft");
    finalUrl.searchParams.set("ok", "1");
    oauthCallbackEvent(req, { provider: "microsoft", outcome: "success", user_id: userId, return_to: returnTo });
    return clearStateCookie(NextResponse.redirect(finalUrl));
  } catch (e: unknown) {
    oauthCallbackException(req, "microsoft", e, { error: "oauth_callback_failed", user_id: callbackUserId, return_to: "/dashboard?panel=mails" });
    const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;
    const finalUrl = new URL("/dashboard?panel=mails", origin);
    finalUrl.searchParams.set("linked", "microsoft");
    finalUrl.searchParams.set("ok", "0");
    finalUrl.searchParams.set("error", "oauth_callback_failed");
    const msg = getSimpleFrenchErrorMessage(e, "La connexion n'a pas pu être finalisée.").slice(0, 200);
    if (msg) finalUrl.searchParams.set("message", msg);
    return NextResponse.redirect(finalUrl);
  }
}
