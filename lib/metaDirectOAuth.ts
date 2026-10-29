import "server-only";

import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getCurrentInrcyAccountScope, resolveOAuthBoundInrcyAccountId } from "@/lib/multicompte/server";
import { makeOAuthState, safeInternalPath, verifyOAuthState, getCookie } from "@/lib/security";
import { isMetaChannelPilotEnabledForActorAndAccount, metaChannelPilotDeniedResponse } from "@/lib/metaChannelRolloutServer";
import { META_DIRECT_CHANNELS_PUBLIC_ENABLED } from "@/lib/metaChannelRollout";
import { INSTAGRAM_DIRECT_SCOPES, buildInstagramGraphUrl } from "@/lib/instagramAuthMode";
import { THREADS_SCOPES, buildThreadsGraphUrl } from "@/lib/threadsGraphApi";
import { encryptToken } from "@/lib/oauthCrypto";
import { asRecord, asString } from "@/lib/tsSafe";
import { withCurrentConnectionVersion } from "@/lib/connectionVersions";
import { clearAllToolCaches } from "@/lib/statsCache";
import { enforceRateLimit, getClientIp } from "@/lib/rateLimit";
import { oauthCallbackEvent } from "@/lib/observability/oauth";
import { fetchMetaDirectJson, exchangeMetaDirectLongToken, MetaDirectApiError, type MetaDirectProvider } from "@/lib/metaDirectTokens";

const callbackPath = (provider: MetaDirectProvider) => `/api/integrations/${provider === "instagram" ? "instagram-direct" : "threads"}/callback`;
const stateProvider = (provider: MetaDirectProvider) => provider === "instagram" ? "instagram_direct" : "threads";
const panelPath = (provider: MetaDirectProvider) => `/dashboard?panel=${provider}`;

export function getMetaDirectOAuthConfig(provider: MetaDirectProvider, requestUrl: string) {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || new URL(requestUrl).origin).replace(/\/$/, "");
  const appId = (provider === "instagram" ? process.env.INSTAGRAM_DIRECT_APP_ID : process.env.THREADS_APP_ID)?.trim();
  const appSecret = (provider === "instagram" ? process.env.INSTAGRAM_DIRECT_APP_SECRET : process.env.THREADS_APP_SECRET)?.trim();
  const redirectUri = (provider === "instagram" ? process.env.INSTAGRAM_DIRECT_REDIRECT_URI : process.env.THREADS_REDIRECT_URI)?.trim()
    || `${siteUrl}${callbackPath(provider)}`;
  let redirectSupported = false;
  try {
    const callbackUrl = new URL(redirectUri);
    const host = callbackUrl.hostname.toLowerCase();
    // Threads rejects localhost and requires HTTPS, including for local testing.
    redirectSupported = callbackUrl.origin === new URL(requestUrl).origin
      && callbackUrl.protocol === "https:"
      && (provider !== "threads" || (host !== "localhost" && !host.endsWith(".localhost") && host !== "127.0.0.1" && host !== "[::1]"));
  } catch {}
  return { siteUrl, appId, appSecret, redirectUri, redirectSupported, configured: !!appId && !!appSecret && redirectSupported };
}

export function metaDirectReturnUrl(input: unknown, provider: MetaDirectProvider, siteUrl: string) {
  const fallback = new URL(panelPath(provider), siteUrl);
  const candidate = new URL(safeInternalPath(input, panelPath(provider)), siteUrl);
  return candidate.origin === fallback.origin ? candidate : fallback;
}

export function parseMetaDirectScopes(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string")
    : typeof value === "string" ? value.split(/[\s,]+/).filter(Boolean) : [];
}

export async function startMetaDirectOAuth(request: Request, provider: MetaDirectProvider) {
  const current = await getCurrentInrcyAccountScope();
  if (!current) return NextResponse.json({ error: "Votre session a expiré. Reconnectez-vous." }, { status: 401 });
  const accountId = current.scope.activeUserId;
  if (!await isMetaChannelPilotEnabledForActorAndAccount(supabaseAdmin, accountId)) return metaChannelPilotDeniedResponse();
  const config = getMetaDirectOAuthConfig(provider, request.url);
  if (!config.configured) return NextResponse.json({
    error: !config.redirectSupported ? (provider === "threads"
      ? "Pour connecter Threads, ouvrez iNrCy en HTTPS : Meta n’accepte pas localhost pour cette connexion."
      : "Pour connecter Instagram directement, ouvrez iNrCy en HTTPS avec une URL de retour configurée dans Meta.")
      : provider === "instagram" ? "La connexion Instagram directe doit encore être configurée dans Meta."
      : "La connexion Threads doit encore être configurée dans Meta.", code: "meta_oauth_config_missing",
  }, { status: 503 });
  const returnUrl = metaDirectReturnUrl(new URL(request.url).searchParams.get("returnTo"), provider, config.siteUrl);
  const state = makeOAuthState(stateProvider(provider), `${returnUrl.pathname}${returnUrl.search}`, {
    accountId, authUserId: current.user.id,
  });
  const authorization = new URL(provider === "instagram" ? "https://www.instagram.com/oauth/authorize" : "https://www.threads.com/oauth/authorize");
  authorization.searchParams.set("client_id", config.appId!);
  authorization.searchParams.set("redirect_uri", config.redirectUri);
  authorization.searchParams.set("response_type", "code");
  authorization.searchParams.set("scope", (provider === "instagram" ? INSTAGRAM_DIRECT_SCOPES : THREADS_SCOPES).join(","));
  authorization.searchParams.set("state", state.stateB64);
  if (provider === "instagram") {
    authorization.searchParams.set("enable_fb_login", "0");
  }
  const response = NextResponse.redirect(authorization);
  response.cookies.set(state.cookieName, state.cookieValue, {
    httpOnly: true, secure: new URL(request.url).protocol === "https:", sameSite: "lax", path: "/", maxAge: 600,
  });
  return response;
}

export async function handleMetaDirectOAuthCallback(request: Request, provider: MetaDirectProvider) {
  const config = getMetaDirectOAuthConfig(provider, request.url);
  const requestUrl = new URL(request.url);
  const state = verifyOAuthState<{ accountId: string; authUserId: string }>(request, stateProvider(provider), requestUrl.searchParams.get("state"));
  const cookie = getCookie(request, state.cookieName);
  // These new flows have never used nonce-only cookies; do not accept legacy unbound state.
  const stateValid = state.ok && !!cookie?.includes(".") && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(state.state.accountId || "") && !!state.state.authUserId;
  const returnUrl = metaDirectReturnUrl(stateValid ? state.returnTo : panelPath(provider), provider, config.siteUrl);
  const finish = (success: boolean, error?: string, message?: string) => {
    const destination = new URL(returnUrl);
    destination.searchParams.set("linked", provider);
    destination.searchParams.set("ok", success ? "1" : "0");
    if (provider === "instagram") destination.searchParams.set("ig_login", "direct");
    if (error) destination.searchParams.set("error", error);
    if (message) destination.searchParams.set("message", message);
    const response = NextResponse.redirect(destination);
    response.cookies.set(state.cookieName, "", { httpOnly: true, secure: new URL(request.url).protocol === "https:", sameSite: "lax", path: "/", maxAge: 0 });
    return response;
  };
  if (!stateValid || !state.ok) return finish(false, "oauth_state", "La connexion a expiré. Relancez-la depuis l’application.");
  let stage = "authorization";
  let databaseCode: string | undefined;
  try {
    const supabase = await createSupabaseServer();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    const user = authData?.user;
    if (authError || !user || user.id !== state.state.authUserId) return finish(false, "not_authenticated", "Reconnectez-vous à l’application avant de relancer cette connexion.");
    const accountId = await resolveOAuthBoundInrcyAccountId(supabase, user.id, state.state.accountId);
    if (!await isMetaChannelPilotEnabledForActorAndAccount(supabaseAdmin, accountId)) return finish(false, "meta_channel_admin_pilot", "Cette connexion est réservée aux comptes ADMIN et REVIEWER pendant sa validation.");
    const code = requestUrl.searchParams.get("code");
    if (!code || requestUrl.searchParams.has("error")) {
      oauthCallbackEvent(request, { provider: stateProvider(provider), outcome: "cancelled", error: "authorization_cancelled" });
      return finish(false, "authorization_cancelled", "La connexion a été annulée. Votre connexion précédente est conservée.");
    }
    if (!config.configured) return finish(false, "meta_oauth_config_missing", "La connexion Meta doit encore être configurée.");
    const rateLimit = await enforceRateLimit({ name: `oauth_${stateProvider(provider)}_cb`, identifier: accountId, limit: 10, window: "10 m" });
    const ipLimit = await enforceRateLimit({ name: `oauth_${stateProvider(provider)}_ip`, identifier: getClientIp(request), limit: 20, window: "10 m" });
    if (rateLimit || ipLimit) return finish(false, "rate_limited", "Trop de tentatives de connexion. Réessayez dans quelques minutes.");
    const shortFields = { client_id: config.appId!, client_secret: config.appSecret!, grant_type: "authorization_code", redirect_uri: config.redirectUri, code: code.replace(/#_$/, "") };
    const form = provider === "instagram" ? new FormData() : new URLSearchParams();
    for (const [key, value] of Object.entries(shortFields)) form.set(key, value);
    stage = "token_exchange";
    const shortToken = await fetchMetaDirectJson(provider === "instagram" ? "https://api.instagram.com/oauth/access_token" : "https://graph.threads.com/oauth/access_token", { method: "POST", body: form });
    const accessToken = asString(shortToken.access_token);
    if (!accessToken) throw new MetaDirectApiError("meta_token_missing", "Meta n’a pas fourni de token. Relancez la connexion.", 502);
    let grantedScopes = parseMetaDirectScopes(shortToken.permissions ?? shortToken.scope);
    let longToken: Awaited<ReturnType<typeof exchangeMetaDirectLongToken>> | undefined;
    if (provider === "threads") {
      // Inspect with the app credential: ordinary customer tokens cannot call the debugger.
      stage = "long_token_exchange";
      longToken = await exchangeMetaDirectLongToken(provider, accessToken, config.appSecret!);
      stage = "token_inspection";
      const debugUrl = new URL(buildThreadsGraphUrl("debug_token"));
      debugUrl.searchParams.set("input_token", longToken.accessToken);
      debugUrl.searchParams.set("access_token", `TH|${config.appId}|${config.appSecret}`);
      const debugData = asRecord((await fetchMetaDirectJson(debugUrl)).data);
      if (debugData.is_valid !== true || (debugData.app_id && String(debugData.app_id) !== config.appId)) {
        throw new MetaDirectApiError("meta_token_invalid", "Meta n’a pas validé l’autorisation de ce compte.", 401);
      }
      grantedScopes = parseMetaDirectScopes(debugData.scopes);
    }
    stage = "permissions";
    const scopes = provider === "instagram" ? INSTAGRAM_DIRECT_SCOPES : THREADS_SCOPES;
    if (scopes.some((scope) => !grantedScopes.includes(scope))) {
      throw new MetaDirectApiError("meta_permissions_incomplete", "Accordez les autorisations de connexion, publication et statistiques demandées par iNrCy, puis relancez la connexion.", 403);
    }
    if (!longToken) {
      stage = "long_token_exchange";
      longToken = await exchangeMetaDirectLongToken(provider, accessToken, config.appSecret!);
    }
    const profileUrl = new URL(provider === "instagram" ? buildInstagramGraphUrl("me", "instagram_login") : buildThreadsGraphUrl("me"));
    profileUrl.searchParams.set("fields", provider === "instagram" ? "user_id,username,account_type" : "id,username,name,threads_profile_picture_url");
    profileUrl.searchParams.set("access_token", longToken.accessToken);
    stage = "profile";
    const profileData = await fetchMetaDirectJson(profileUrl);
    const profile = Array.isArray(profileData.data) ? asRecord(profileData.data[0]) : profileData;
    const resourceId = asString(provider === "instagram" ? profile.user_id ?? profile.id : profile.id);
    const username = asString(profile.username);
    const accountType = asString(profile.account_type)?.toUpperCase();
    if (!resourceId || !/^\d+$/.test(resourceId) || !username) throw new MetaDirectApiError("meta_profile_missing", "Meta n’a pas confirmé le profil à connecter.", 400);
    if (provider === "instagram" && accountType === "PERSONAL") throw new MetaDirectApiError("instagram_professional_required", "La connexion directe nécessite un compte Instagram professionnel ou Creator.", 400);
    stage = "connection_read";
    const { data: previous, error: previousError } = await supabaseAdmin.from("integrations").select("meta")
      .eq("user_id", accountId).eq("provider", provider).eq("source", provider).eq("product", provider).maybeSingle();
    if (previousError) throw new MetaDirectApiError("meta_connection_read_failed", "La connexion précédente n’a pas pu être vérifiée. Réessayez.", 503);
    const previousMeta = { ...asRecord(asRecord(previous).meta) };
    for (const key of ["page_id", "page_name", "page_source", "page_access_token_enc", "user_access_token_enc", "standard_user_access_token_enc", "business_user_access_token_enc", "business_name", "last_login_mode"]) delete previousMeta[key];
    const now = new Date().toISOString();
    const meta = withCurrentConnectionVersion(provider === "instagram" ? "channel:instagram" : "channel:threads", {
      ...previousMeta, auth_mode: provider === "instagram" ? "instagram_login" : "threads_login", username,
      account_type: accountType ?? null, permissions: grantedScopes, token_issued_at: now,
      profile_picture_url: asString(profile.threads_profile_picture_url) || null,
    });
    const publicUrl = provider === "instagram" ? `https://www.instagram.com/${encodeURIComponent(username)}/` : `https://www.threads.com/@${encodeURIComponent(username)}`;
    const integration = {
      user_id: accountId, provider, category: "social", source: provider, product: provider,
      status: "connected", resource_id: resourceId, resource_label: username, display_name: provider === "instagram" ? "Instagram" : "Threads",
      access_token_enc: encryptToken(longToken.accessToken), refresh_token_enc: null,
      expires_at: longToken.expiresAt, scopes: grantedScopes.join(" "), meta, updated_at: now,
    };
    const settings = { accountConnected: true, connected: true, username, url: publicUrl,
      ...(provider === "instagram" ? { igId: resourceId, pageId: null, auth_mode: "instagram_login" } : { threadsId: resourceId }),
    };
    // A single transaction updates the connection and its UI projection without overwriting other tools.
    stage = "connection_save";
    const { error: saveError } = await supabaseAdmin.rpc("save_meta_direct_connection", {
      p_account_id: accountId, p_channel: provider, p_integration: integration, p_settings: settings,
      p_admin_pilot: !META_DIRECT_CHANNELS_PUBLIC_ENABLED,
    });
    if (saveError) {
      const candidate = typeof saveError.code === "string" ? saveError.code : "";
      databaseCode = /^(?:[A-Z0-9]{5}|PGRST\d{3})$/.test(candidate) ? candidate : undefined;
      throw new MetaDirectApiError("meta_connection_save_failed", "La connexion n’a pas pu être enregistrée. Réessayez.", 503);
    }
    try { await clearAllToolCaches(supabase, accountId); } catch {}
    oauthCallbackEvent(request, { provider: stateProvider(provider), outcome: "success", user_id: accountId, return_to: `${returnUrl.pathname}${returnUrl.search}` });
    return finish(true);
  } catch (error) {
    const code = error instanceof MetaDirectApiError ? error.code : "meta_connection_failed";
    const message = error instanceof MetaDirectApiError ? error.message : "La connexion Meta n’a pas pu être finalisée. Réessayez.";
    oauthCallbackEvent(request, { provider: stateProvider(provider), outcome: "failed", error: code, message,
      stage, database_code: databaseCode,
      ...(error instanceof MetaDirectApiError ? { status_code: error.status, ...error.diagnostics } : {}),
      capture_in_sentry: false });
    return finish(false, code, message);
  }
}
