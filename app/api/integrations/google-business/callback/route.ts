import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { clearAllToolCaches } from "@/lib/statsCache";
import { encryptToken as _encryptToken } from "@/lib/oauthCrypto";
import { listAllGoogleBusinessAccounts, listAllGoogleBusinessLocations } from "@/lib/googleBusinessLocations";
import { clearGmbSelectionMeta, clearGmbSelectionSettings, resolveVerifiedGmbSelection, type VerifiedGmbSelection } from "@/lib/googleBusinessSelectionPolicy";
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

    const fail = (error: string, message?: string, databaseCode?: unknown) => {
      const dbCode = typeof databaseCode === "string" && /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.test(databaseCode) ? databaseCode : undefined;
      oauthCallbackEvent(req, { provider: "google_business", outcome: "failed", error, message, return_to: returnToPath, capture_in_sentry: true, ...(dbCode ? { db_code: dbCode } : {}) });
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
        .select("id,access_token_enc,refresh_token_enc,resource_id,resource_label,email_address,meta")
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
      return fail("db_read_failed", "Le service est momentanément indisponible. Merci de réessayer.", (existingErr || existingConfigRes.error)?.code);
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
    let verifiedSelection: VerifiedGmbSelection | null = null;
    let verifiedAccountHint: string | null = null;
    if (preservedLocationName && preservedAccountName) {
      try {
        // Validate with this authorization's NEW token, never a cached DB token.
        // The paginated readers throw on an incomplete discovery. A matching
        // title or the only remaining establishment cannot replace the saved ID.
        const accounts = await listAllGoogleBusinessAccounts(tokenData.access_token);
        if (accounts.some(account => account.name === preservedAccountName)) {
          verifiedAccountHint = preservedAccountName;
          const locations = await listAllGoogleBusinessLocations(tokenData.access_token, preservedAccountName);
          verifiedSelection = resolveVerifiedGmbSelection(
            { accountName: preservedAccountName, locationName: preservedLocationName },
            { accounts, locations, complete: true },
          );
        }
      } catch {
        log.warn("google_business_selection_verification_unavailable", {
          route: "google_business_callback", user_id: userId,
        });
      }
    }
    const preserveSelection = Boolean(
      preservedLocationName && preservedAccountName && verifiedSelection,
    );
    const selectionMeta = clearGmbSelectionMeta(existingMeta, verifiedSelection?.accountName || verifiedAccountHint);

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
      resource_label: preserveSelection ? verifiedSelection?.locationTitle || preservedLocationTitle : null,
      meta: withCurrentConnectionVersion("channel:gmb", {
        ...selectionMeta,
        picture: userInfo.picture ?? null,
        url: verifiedSelection?.url || null,
      }),
    };

    let savedIntegration: { id?: unknown; status?: unknown; resource_id?: unknown } | null = null;
    if (existingId) {
      const update = supabaseAdmin
        .from("integrations")
        .update(payload)
        .eq("id", existingId)
        .eq("user_id", userId);
      const targetGuard = existingRec.resource_id == null
        ? update.is("resource_id", null)
        : update.eq("resource_id", existingRec.resource_id);
      const credentialGuard = existingRec.access_token_enc == null
        ? targetGuard.is("access_token_enc", null)
        : targetGuard.eq("access_token_enc", existingRec.access_token_enc);
      const metadataGuard = existingRec.meta == null
        ? credentialGuard.is("meta", null)
        : credentialGuard.eq("meta", JSON.stringify(existingRec.meta));
      const { data, error: upErr } = await metadataGuard
        .select("id,status,resource_id")
        .single();
      if (upErr) return fail("db_update_failed", "La mise à jour a échoué.", upErr.code);
      savedIntegration = data;
    } else {
      const { data, error: insErr } = await supabaseAdmin
        .from("integrations")
        .insert(payload)
        .select("id,status,resource_id")
        .single();
      if (insErr) return fail("db_insert_failed", "Le service est momentanément indisponible. Merci de réessayer.", insErr.code);
      savedIntegration = data;
    }

    const expectedStatus = preserveSelection ? "connected" : "account_connected";
    const savedResourceId = asString(savedIntegration?.resource_id);
    if (
      !savedIntegration?.id ||
      asString(savedIntegration.status) !== expectedStatus ||
      (preserveSelection ? savedResourceId !== preservedLocationName : savedResourceId !== null)
    ) {
      return fail("db_postcondition_failed", "La connexion Google Business n’a pas été enregistrée. Réessayez.");
    }

    // Keep this display mirror synchronized, but never use it as publication
    // authority. Reusing the validated snapshot avoids a second-read race.
    {
      const merged = {
        ...existingProSettings,
        gmb: {
          ...clearGmbSelectionSettings(existingSettings, verifiedSelection?.accountName || verifiedAccountHint),
          connected: true,
          configured: preserveSelection,
          accountEmail: userInfo.email,
          accountDisplayName: userInfo.name ?? null,
          accountName: verifiedSelection?.accountName || verifiedAccountHint,
          locationName: preserveSelection ? preservedLocationName : null,
          locationTitle: preserveSelection ? verifiedSelection?.locationTitle || preservedLocationTitle : null,
          resource_id: preserveSelection ? preservedLocationName : null,
          resource_label: preserveSelection ? verifiedSelection?.locationTitle || preservedLocationTitle : null,
          url: verifiedSelection?.url || null,
        },
      };
      // A selection/preferences write made during Google validation wins over
      // this older mirror snapshot. The canonical integration remains authority.
      const mirror = supabaseAdmin.from("pro_tools_configs");
      let mirrorWrite;
      if (existingConfigRes.data) {
        const update = mirror.update({ settings: merged }).eq("user_id", userId);
        mirrorWrite = existingConfigRes.data.settings == null
          ? update.is("settings", null)
          : update.eq("settings", JSON.stringify(existingConfigRes.data.settings));
      } else {
        mirrorWrite = mirror.insert({ user_id: userId, settings: merged });
      }
      const { data: savedMirror, error: mirrorError } = await mirrorWrite.select("user_id").maybeSingle();
      if (mirrorError || !savedMirror) {
        log.warn("google_business_settings_mirror_sync_failed", {
          route: "google_business_callback",
          user_id: userId,
          error: mirrorError?.message || "concurrent_settings_write",
        });
      }
    }


    // Discovery never writes a late account hint: it could overwrite an
    // explicit selection made while this callback was completing.

    // Invalidate stats cache so iNrStats + Generator reflect the new connection immediately.
    await invalidateUserStatsCache(supabase, userId);

    // Build final redirect URL safely and append params without breaking existing querystring
    const finalUrl = new URL(returnToPath, siteUrl);
    ["error", "message", "warning", "toast", "skipped"].forEach(key => finalUrl.searchParams.delete(key));
    finalUrl.searchParams.set("linked", "gmb");
    finalUrl.searchParams.set("ok", "1");
    if (!preserveSelection) finalUrl.searchParams.set("warning", "gmb_selection_required");

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
