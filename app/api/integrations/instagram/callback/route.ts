import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { clearAllToolCaches } from "@/lib/statsCache";
import { encryptToken } from "@/lib/oauthCrypto";
import { enforceRateLimit, getClientIp } from "@/lib/rateLimit";
import { safeInternalPath, verifyOAuthState } from "@/lib/security";
import { asRecord, asString } from "@/lib/tsSafe";
import { oauthCallbackEvent, oauthCallbackException } from "@/lib/observability/oauth";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import { withCurrentConnectionVersion } from "@/lib/connectionVersions";
import { resolveOAuthBoundInrcyAccountId } from "@/lib/multicompte/server";
import { buildMetaGraphUrl } from "@/lib/metaGraphApi";
import { listAccessibleFacebookPagesDetailed } from "@/lib/metaBusinessAssets";
type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: { message?: string };
};

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServer>>;

async function invalidateUserStatsCache(supabase: SupabaseServerClient, userId: string) {
  await clearAllToolCaches(supabase, userId);
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const data = (await res.json()) as unknown;
  if (!res.ok) {
    const rec = asRecord(data);
    const err = asRecord(rec["error"]);
    throw new Error(asString(err["message"]) || `HTTP ${res.status}`);
  }
  return data as T;
}

export async function GET(req: Request) {
  try {
    const urlObj = new URL(req.url);
    const code = urlObj.searchParams.get("code");
    const stateRaw = urlObj.searchParams.get("state");

    const fbErrorMsg = urlObj.searchParams.get("error_message") || urlObj.searchParams.get("error_description");
    const fbErrorCode = urlObj.searchParams.get("error_code") || urlObj.searchParams.get("error");

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;
    const st = verifyOAuthState(req, "instagram", stateRaw);
    const rawReturnTo = safeInternalPath(st.returnTo || "/dashboard?panel=instagram", "/dashboard?panel=instagram");
    const returnToUrl = new URL(rawReturnTo, siteUrl);
    const loginMode = returnToUrl.searchParams.get("ig_mode") === "business" ? "business" : "standard";
    const repairMode = returnToUrl.searchParams.get("ig_repair") === "1";
    returnToUrl.searchParams.delete("ig_mode");
    returnToUrl.searchParams.delete("ig_repair");
    const returnTo = `${returnToUrl.pathname}${returnToUrl.search}`;
    oauthCallbackEvent(req, { provider: "instagram", outcome: "started", return_to: returnTo });
    const clearStateCookie = (res: NextResponse) => {
      res.cookies.set(st.cookieName, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
      return res;
    };

    const fail = (error: string, message?: string) => {
      oauthCallbackEvent(req, { provider: "instagram", outcome: "failed", error, message, return_to: returnTo, capture_in_sentry: true });
      const finalUrl = new URL(returnTo, siteUrl);
      finalUrl.searchParams.set("linked", "instagram");
      finalUrl.searchParams.set("ok", "0");
      finalUrl.searchParams.set("error", error);
      if (message) finalUrl.searchParams.set("message", getSimpleFrenchErrorMessage(message, "La connexion n'a pas pu être finalisée.").slice(0, 200));
      return clearStateCookie(NextResponse.redirect(finalUrl));
    };

    if (!st.ok) {
      oauthCallbackEvent(req, { provider: "instagram", outcome: "state_invalid", error: st.reason, return_to: returnTo, capture_in_sentry: true });
      return clearStateCookie(NextResponse.redirect(new URL("/dashboard?panel=instagram&toast=oauth_state", siteUrl)));
    }

    if (!code) {
      oauthCallbackEvent(req, { provider: "instagram", outcome: fbErrorCode === "access_denied" || fbErrorCode === "user_denied" ? "cancelled" : "failed", error: fbErrorCode || "missing_code", message: fbErrorMsg || undefined, return_to: returnTo, capture_in_sentry: !!fbErrorCode && fbErrorCode !== "access_denied" && fbErrorCode !== "user_denied" });
      const finalUrl = new URL(returnTo, siteUrl);
      finalUrl.searchParams.set("linked", "instagram");
      finalUrl.searchParams.set("ok", "0");
      if (fbErrorCode) finalUrl.searchParams.set("reason", String(fbErrorCode));
      if (fbErrorMsg) finalUrl.searchParams.set("message", getSimpleFrenchErrorMessage(fbErrorMsg, "La connexion n'a pas pu être finalisée.").slice(0, 200));
      return clearStateCookie(NextResponse.redirect(finalUrl));
    }

    const appId = process.env.FACEBOOK_APP_ID;
    const appSecret = process.env.FACEBOOK_APP_SECRET;
    const redirectFromEnv = process.env.INSTAGRAM_REDIRECT_URI;
    const redirectUri = redirectFromEnv || `${siteUrl}/api/integrations/instagram/callback`;

    if (!appId || !appSecret) {
      oauthCallbackEvent(req, { provider: "instagram", outcome: "config_error", error: "oauth_config_missing", return_to: returnTo, capture_in_sentry: true });
      return NextResponse.redirect(new URL("/dashboard?panel=instagram&linked=instagram&ok=0&error=oauth_config_missing", siteUrl));
    }

    const supabase = await createSupabaseServer();
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !authData?.user) { oauthCallbackEvent(req, { provider: "instagram", outcome: "not_authenticated", error: "not_authenticated", return_to: returnTo }); const finalUrl = new URL(returnTo, siteUrl); finalUrl.searchParams.set("linked", "instagram"); finalUrl.searchParams.set("ok", "0"); finalUrl.searchParams.set("error", "not_authenticated"); return clearStateCookie(NextResponse.redirect(finalUrl)); }
    const userId = await resolveOAuthBoundInrcyAccountId(supabase, authData.user.id, st.state.accountId);

    const rlUser = await enforceRateLimit({
      name: "oauth_instagram_cb",
      identifier: userId,
      limit: 10,
      window: "10 m",
    });
    if (rlUser) return rlUser;

    const ip = getClientIp(req);
    const rlIp = await enforceRateLimit({
      name: "oauth_instagram_cb_ip",
      identifier: ip,
      limit: 20,
      window: "10 m",
    });
    if (rlIp) return rlIp;

    // Exchange code -> user token
    const tokenUrl = `${buildMetaGraphUrl("oauth/access_token")}?${new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      client_secret: appSecret,
      code,
    }).toString()}`;

    const tokenData = await fetchJson<TokenResponse>(tokenUrl);
    const userAccessToken = tokenData.access_token;
    if (!userAccessToken) return fail("missing_access_token", "La connexion Instagram a échoué. Merci de réessayer.");

    const shortExpiresIn = typeof tokenData.expires_in === "number" ? tokenData.expires_in : null;

    // Long-lived token (best-effort)
    let longUserToken = userAccessToken;
    let longExpiresIn: number | null = null;
    try {
      const longTokenUrl = `${buildMetaGraphUrl("oauth/access_token")}?${new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: userAccessToken,
      }).toString()}`;
      const longTok = await fetchJson<TokenResponse>(longTokenUrl);
      if (longTok.access_token) longUserToken = longTok.access_token;
      if (typeof longTok.expires_in === "number") longExpiresIn = longTok.expires_in;
    } catch {}

    const expiresIn = longExpiresIn ?? shortExpiresIn;
    const expiresAt = typeof expiresIn === "number" ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

    // Store as "account_connected" (selection later)
    // Upsert (robuste même si l’utilisateur reconnecte plusieurs fois)
// Nécessite un UNIQUE INDEX sur (user_id, provider, source, product) côté Supabase.
const encryptedToken = encryptToken(longUserToken);
const { data: existingIntegration } = await supabaseAdmin
  .from("integrations")
  .select("status,access_token_enc,refresh_token_enc,expires_at,resource_id,resource_label,meta")
  .eq("user_id", userId)
  .eq("provider", "instagram")
  .eq("source", "instagram")
  .eq("product", "instagram")
  .maybeSingle();

const existingRec = asRecord(existingIntegration);
const previousMeta = asRecord(existingRec["meta"]);
const previousStatus = asString(existingRec["status"]);
const previousAccessTokenEnc = asString(existingRec["access_token_enc"]);
const previousRefreshTokenEnc = asString(existingRec["refresh_token_enc"]);
const previousExpiresAt = asString(existingRec["expires_at"]);
const previousResourceId = asString(existingRec["resource_id"]);
const previousResourceLabel = asString(existingRec["resource_label"]);
const previousPageId = asString(previousMeta["page_id"]);
const preserveSelection = repairMode && previousStatus === "connected" && !!previousResourceId;

let refreshedSelectedPage: Awaited<ReturnType<typeof listAccessibleFacebookPagesDetailed>>["pages"][number] | null = null;
if (preserveSelection) {
  try {
    const discovery = await listAccessibleFacebookPagesDetailed(longUserToken);
    refreshedSelectedPage =
      discovery.pages.find((page) => page.instagram_business_account?.id === previousResourceId) || null;
  } catch {
    // Non destructif : si Meta ne confirme pas la Page pendant la réparation,
    // on conserve la sélection et le token de Page existants.
  }
}

const refreshedPageTokenEnc = refreshedSelectedPage?.access_token
  ? encryptToken(refreshedSelectedPage.access_token)
  : null;
const selectedUsername =
  refreshedSelectedPage?.instagram_business_account?.username || previousResourceLabel || null;
const selectedPageId = refreshedSelectedPage?.id || previousPageId || null;

const repairedMetaDraft: Record<string, unknown> = {
  ...previousMeta,
  user_access_token_enc: encryptedToken,
  standard_user_access_token_enc: loginMode === "standard"
    ? encryptedToken
    : asString(previousMeta["standard_user_access_token_enc"]) || null,
  business_user_access_token_enc: loginMode === "business"
    ? encryptedToken
    : asString(previousMeta["business_user_access_token_enc"]) || null,
  last_login_mode: loginMode,
};

if (preserveSelection) {
  if (selectedPageId) repairedMetaDraft.page_id = selectedPageId;
  if (refreshedSelectedPage?.name) repairedMetaDraft.page_name = refreshedSelectedPage.name;
  if (refreshedSelectedPage?.source) repairedMetaDraft.page_source = refreshedSelectedPage.source;
  if (refreshedSelectedPage?.business_name) repairedMetaDraft.business_name = refreshedSelectedPage.business_name;
  if (refreshedPageTokenEnc) repairedMetaDraft.page_access_token_enc = refreshedPageTokenEnc;
} else {
  repairedMetaDraft.picked = "none";
}

const repairedMeta = withCurrentConnectionVersion("channel:instagram", repairedMetaDraft);

const payload: Record<string, unknown> = {
  user_id: userId,
  provider: "instagram",
  category: "social",
  source: "instagram",
  product: "instagram",
  status: preserveSelection ? "connected" : "account_connected",
  access_token_enc: preserveSelection
    ? refreshedPageTokenEnc || previousAccessTokenEnc || encryptedToken
    : encryptedToken,
  refresh_token_enc: preserveSelection ? previousRefreshTokenEnc || null : null,
  expires_at: preserveSelection
    ? refreshedPageTokenEnc
      ? null
      : previousExpiresAt || null
    : expiresAt,
  resource_id: preserveSelection ? previousResourceId : null,
  resource_label: preserveSelection ? selectedUsername : null,
  meta: repairedMeta,
};

const { error: upsertErr } = await supabaseAdmin
  .from("integrations")
  .upsert(payload, { onConflict: "user_id,provider,source,product" });

if (upsertErr) return fail("db_upsert_failed", "Le service est momentanément indisponible. Merci de réessayer.");

    // Invalidate stats cache so iNrStats + Generator reflect the new connection immediately.
    await invalidateUserStatsCache(supabase, userId);

// Mirror in pro_tools_configs
    try {
      const { data: scRow } = await supabaseAdmin.from("pro_tools_configs").select("settings").eq("user_id", userId).maybeSingle();
      const current = asRecord(asRecord(scRow)["settings"]);
      const currentInstagram = asRecord(current["instagram"]);
      const merged = {
        ...current,
        instagram: preserveSelection
          ? {
              ...currentInstagram,
              accountConnected: true,
              connected: true,
              username: selectedUsername || asString(currentInstagram["username"]) || null,
              url: selectedUsername
                ? `https://www.instagram.com/${selectedUsername}/`
                : asString(currentInstagram["url"]) || null,
              pageId: selectedPageId || asString(currentInstagram["pageId"]) || null,
              igId: previousResourceId || asString(currentInstagram["igId"]) || null,
            }
          : {
              ...currentInstagram,
              accountConnected: true,
              connected: false,
              username: null,
              url: null,
              pageId: null,
              igId: null,
            },
      };
      await supabaseAdmin.from("pro_tools_configs").upsert({ user_id: userId, settings: merged }, { onConflict: "user_id" });
    } catch {}

    const finalUrl = new URL(returnTo, siteUrl);
    finalUrl.searchParams.set("linked", "instagram");
    finalUrl.searchParams.set("ok", "1");
    oauthCallbackEvent(req, { provider: "instagram", outcome: "success", user_id: userId, return_to: returnTo });
    return clearStateCookie(NextResponse.redirect(finalUrl));
  } catch (e: unknown) {
    oauthCallbackException(req, "instagram", e, { error: "oauth_callback_failed", return_to: "/dashboard?panel=instagram" });
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;
    const finalUrl = new URL("/dashboard?panel=instagram", siteUrl);
    finalUrl.searchParams.set("linked", "instagram");
    finalUrl.searchParams.set("ok", "0");
    finalUrl.searchParams.set("error", "oauth_callback_failed");
    const msg = getSimpleFrenchErrorMessage(e).slice(0, 200);
    if (msg) finalUrl.searchParams.set("message", msg);
    return NextResponse.redirect(finalUrl);
  }
}
