import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { decryptToken, encryptToken } from "@/lib/oauthCrypto";
import {
  TIKTOK_ADS_API_BASE,
  TIKTOK_ADS_PRODUCT,
  TIKTOK_ADS_SOURCE,
  parseTikTokAccountInfo,
  parseTikTokAdvertiserIds,
  tikTokAdsAccountCanAssociate,
  tikTokAdsAccessTokenIsFresh,
  tikTokAdsIsLongLivedAuthorization,
  tikTokAdsRefreshTokenIsUsable,
  tikTokAdsRefreshNeedsReconnect,
  tikTokAdsAuthorizeUrl,
  tikTokAdsCallbackUrl,
  type TikTokAdsAccount,
} from "@/lib/adsTikTokPolicy";

export type TikTokAdsIntegration = {
  id: string;
  status: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  expires_at: string | null;
  resource_id: string | null;
  resource_label: string | null;
  meta: unknown;
};

export class TikTokAdsConnectionError extends Error {
  constructor(message: string, readonly code: string, readonly status = 503) {
    super(message);
    this.name = "TikTokAdsConnectionError";
  }
}

type TikTokAdsTokenPayload = {
  code?: number;
  message?: string;
  data?: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    refresh_token_expires_in?: number;
    advertiser_ids?: string[];
  };
};

export async function exchangeTikTokAdsCode(code: string): Promise<NonNullable<TikTokAdsTokenPayload["data"]>> {
  const appId = String(process.env.TIKTOK_ADS_APP_ID || "").trim();
  const secret = String(process.env.TIKTOK_ADS_SECRET || "").trim();
  if (!appId || !secret) {
    throw new TikTokAdsConnectionError("Configuration TikTok Ads incomplète.", "configuration_missing");
  }
  let response: Response;
  try {
    response = await fetch(`${TIKTOK_ADS_API_BASE}/oauth2/access_token/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, secret, auth_code: code }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new TikTokAdsConnectionError("TikTok Ads est momentanément indisponible.", "provider_unavailable");
  }
  const payload = await response.json().catch(() => ({})) as TikTokAdsTokenPayload;
  if (!response.ok || payload.code !== 0 || !payload.data?.access_token) {
    throw new TikTokAdsConnectionError("L’autorisation TikTok Ads n’a pas abouti.", "authorization_failed", 401);
  }
  return payload.data;
}

export async function saveTikTokAdsConnection(
  userId: string,
  token: NonNullable<TikTokAdsTokenPayload["data"]>,
): Promise<void> {
  if (!token.access_token) throw new TikTokAdsConnectionError("Jeton TikTok Ads invalide.", "authorization_failed", 401);
  // A successful authorization is not enough: verify advertiser access before
  // declaring the independent Ads integration connected.
  const accounts = await listTikTokAdsAccountsWithToken(token.access_token);
  if (!accounts.length) {
    throw new TikTokAdsConnectionError("Aucun compte publicitaire TikTok autorisé.", "ads_access_missing", 403);
  }
  const existing = await readTikTokAdsIntegration(userId);
  const selected = accounts.find((account) => account.id === existing?.resource_id && tikTokAdsAccountCanAssociate(account));
  const seconds = Number(token.expires_in);
  const expiresAt = Number.isFinite(seconds) && seconds > 0
    ? new Date(Date.now() + seconds * 1000).toISOString() : null;
  const refreshSeconds = Number(token.refresh_token_expires_in);
  const refreshExpiresAt = Number.isFinite(refreshSeconds) && refreshSeconds > 0
    ? new Date(Date.now() + refreshSeconds * 1000).toISOString() : null;
  const longLived = tikTokAdsIsLongLivedAuthorization(token.refresh_token, token.expires_in);
  const { error } = await supabaseAdmin.from("integrations").upsert({
    user_id: userId,
    provider: "tiktok",
    source: TIKTOK_ADS_SOURCE,
    product: TIKTOK_ADS_PRODUCT,
    category: "social",
    status: "connected",
    display_name: "Compte TikTok Ads",
    provider_account_id: null,
    access_token_enc: encryptToken(token.access_token),
    refresh_token_enc: token.refresh_token ? encryptToken(token.refresh_token) : null,
    expires_at: expiresAt,
    resource_id: selected?.id || null,
    resource_label: selected?.name || null,
    meta: { product: "inr_ads", provider: "tiktok", refresh_expires_at: refreshExpiresAt,
      token_lifecycle: longLived ? "long_lived" : "timed" },
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,provider,source,product" });
  if (error) {
    throw new TikTokAdsConnectionError("Impossible de sauvegarder la connexion TikTok Ads.", "storage_unavailable");
  }
}

export function tikTokAdsReturnUrl(requestUrl: string, result: "connected" | "error", reason?: string) {
  const url = new URL("/dashboard/ads", requestUrl);
  url.searchParams.set("channel", "tiktok");
  url.searchParams.set("connection", result);
  if (reason) url.searchParams.set("reason", reason.slice(0, 150));
  return url;
}

export function tikTokAdsRedirectUri(requestUrl: string) {
  return process.env.TIKTOK_ADS_REDIRECT_URI ||
    `${new URL(requestUrl).origin}/api/ads/tiktok/callback`;
}

/** Validate one server-side OAuth configuration without returning its secret. */
export function tikTokAdsOAuthConfiguration(requestUrl: string): {
  appId: string; redirectUri: string; authorizationUrl: string;
} | null {
  try {
    const appId = String(process.env.TIKTOK_ADS_APP_ID || "").trim();
    const authorizationUrl = String(process.env.TIKTOK_ADS_AUTHORIZATION_URL || "").trim();
    if (!String(process.env.TIKTOK_ADS_SECRET || "").trim()
      || Buffer.from(String(process.env.INRCY_CREDENTIALS_SECRET || ""), "base64").length !== 32) return null;
    const callback = tikTokAdsCallbackUrl(tikTokAdsRedirectUri(requestUrl), new URL(requestUrl).origin);
    if (!callback) return null;
    const binding = { appId, redirectUri: callback.toString() };
    if (!tikTokAdsAuthorizeUrl(authorizationUrl, "configuration-check", binding)) return null;
    return { ...binding, authorizationUrl };
  } catch {
    return null;
  }
}

export async function readTikTokAdsIntegration(userId: string): Promise<TikTokAdsIntegration | null> {
  const { data, error } = await supabaseAdmin.from("integrations")
    .select("id,status,access_token_enc,refresh_token_enc,expires_at,resource_id,resource_label,meta")
    .eq("user_id", userId)
    .eq("provider", "tiktok")
    .eq("source", TIKTOK_ADS_SOURCE)
    .eq("product", TIKTOK_ADS_PRODUCT)
    .maybeSingle();
  if (error) throw new Error("Impossible de lire la connexion TikTok Ads.");
  return data as TikTokAdsIntegration | null;
}

async function tikTokAdsGet(path: string, token: string, params: URLSearchParams) {
  const url = `${TIKTOK_ADS_API_BASE}/${path}/?${params.toString()}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "Access-Token": token },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new TikTokAdsConnectionError("TikTok Ads est momentanément indisponible.", "provider_unavailable");
  }
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || payload.code !== 0) {
    // Do not echo provider payloads: they can include account-identifying data.
    if (response.status === 401) throw new TikTokAdsConnectionError("Réautorisez TikTok Ads.", "needs_reconnect", 409);
    if (response.status === 403) throw new TikTokAdsConnectionError("Accès Marketing API ou compte TikTok Ads refusé.", "ads_access_denied", 403);
    throw new TikTokAdsConnectionError("TikTok Ads n’a pas pu fournir les comptes autorisés.", "provider_unavailable");
  }
  return payload;
}

export async function listTikTokAdsAccountsWithToken(token: string): Promise<TikTokAdsAccount[]> {
  const appId = String(process.env.TIKTOK_ADS_APP_ID || "").trim();
  const secret = String(process.env.TIKTOK_ADS_SECRET || "").trim();
  if (!appId || !secret) throw new Error("Configuration TikTok Ads incomplète.");

  const authorized = await tikTokAdsGet("oauth2/advertiser/get", token,
    new URLSearchParams({ app_id: appId, secret }));
  const ids = parseTikTokAdvertiserIds(authorized);
  if (!ids.length) return [];
  if (ids.length > 500) {
    throw new TikTokAdsConnectionError("Trop de comptes TikTok Ads pour cette connexion.", "account_limit", 409);
  }
  const byId = new Map<string, TikTokAdsAccount>();
  for (let start = 0; start < ids.length; start += 50) {
    const info = await tikTokAdsGet("advertiser/info", token,
      new URLSearchParams({ advertiser_ids: JSON.stringify(ids.slice(start, start + 50)) }));
    for (const account of parseTikTokAccountInfo(info)) byId.set(account.id, account);
  }
  return ids.map((id) => byId.get(id) || { id, name: `Compte ${id}`, currency: "", status: "" });
}

export async function listTikTokAdsAccounts(userId: string): Promise<TikTokAdsAccount[]> {
  const integration = await readTikTokAdsIntegration(userId);
  if (!integration?.access_token_enc || integration.status !== "connected") {
    throw new Error("Connectez d’abord TikTok Ads.");
  }
  const token = await tikTokAdsAccessToken(userId, integration);
  try { return await listTikTokAdsAccountsWithToken(token); }
  catch (error) {
    if (error instanceof TikTokAdsConnectionError && error.code === "needs_reconnect") {
      await markTikTokAdsNeedsReconnect(userId, integration.id);
    }
    throw error;
  }
}

async function markTikTokAdsNeedsReconnect(userId: string, rowId: string) {
  await supabaseAdmin.from("integrations")
    .update({ status: "needs_update", updated_at: new Date().toISOString() })
    .eq("id", rowId).eq("user_id", userId);
}

/** Refreshes only when required; the saved Ads account remains selected. */
export async function tikTokAdsAccessToken(userId: string, row?: TikTokAdsIntegration | null): Promise<string> {
  const integration = row === undefined ? await readTikTokAdsIntegration(userId) : row;
  if (!integration?.access_token_enc || integration.status !== "connected") {
    throw new TikTokAdsConnectionError("Connectez d’abord TikTok Ads.", "not_connected", 409);
  }
  const meta = integration.meta && typeof integration.meta === "object" && !Array.isArray(integration.meta)
    ? integration.meta as Record<string, unknown> : {};
  if (meta.token_lifecycle === "long_lived" && !integration.expires_at && !integration.refresh_token_enc) {
    try { return decryptToken(integration.access_token_enc); }
    catch {
      await markTikTokAdsNeedsReconnect(userId, integration.id);
      throw new TikTokAdsConnectionError("Réautorisez TikTok Ads.", "needs_reconnect", 409);
    }
  }
  if (tikTokAdsAccessTokenIsFresh(integration.expires_at)) {
    try { return decryptToken(integration.access_token_enc); }
    catch {
      await markTikTokAdsNeedsReconnect(userId, integration.id);
      throw new TikTokAdsConnectionError("Réautorisez TikTok Ads.", "needs_reconnect", 409);
    }
  }
  const refreshExpiry = String(meta.refresh_expires_at || "");
  if (!tikTokAdsRefreshTokenIsUsable(integration.refresh_token_enc, refreshExpiry)) {
    await markTikTokAdsNeedsReconnect(userId, integration.id);
    throw new TikTokAdsConnectionError("Réautorisez TikTok Ads pour conserver l’accès au compte.", "needs_reconnect", 409);
  }
  const appId = String(process.env.TIKTOK_ADS_APP_ID || "").trim();
  const secret = String(process.env.TIKTOK_ADS_SECRET || "").trim();
  if (!appId || !secret) throw new TikTokAdsConnectionError("Configuration TikTok Ads incomplète.", "configuration_missing");
  let refreshToken: string;
  try { refreshToken = decryptToken(integration.refresh_token_enc!); }
  catch {
    await markTikTokAdsNeedsReconnect(userId, integration.id);
    throw new TikTokAdsConnectionError("Réautorisez TikTok Ads.", "needs_reconnect", 409);
  }
  let response: Response;
  try {
    response = await fetch(`${TIKTOK_ADS_API_BASE}/oauth2/refresh_token/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, secret, grant_type: "refresh_token", refresh_token: refreshToken }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new TikTokAdsConnectionError("Renouvellement TikTok Ads momentanément indisponible.", "provider_unavailable");
  }
  const payload = await response.json().catch(() => ({})) as TikTokAdsTokenPayload;
  if (!response.ok || payload.code !== 0 || !payload.data?.access_token) {
    if (tikTokAdsRefreshNeedsReconnect(response.status, payload.message)) {
      await markTikTokAdsNeedsReconnect(userId, integration.id);
      throw new TikTokAdsConnectionError("Réautorisez TikTok Ads.", "needs_reconnect", 409);
    }
    throw new TikTokAdsConnectionError("Renouvellement TikTok Ads momentanément indisponible.", "provider_unavailable");
  }
  const seconds = Number(payload.data.expires_in);
  const refreshSeconds = Number(payload.data.refresh_token_expires_in);
  const oldMeta = integration.meta && typeof integration.meta === "object" && !Array.isArray(integration.meta)
    ? integration.meta as Record<string, unknown> : {};
  const { error } = await supabaseAdmin.from("integrations").update({
    access_token_enc: encryptToken(payload.data.access_token),
    refresh_token_enc: payload.data.refresh_token ? encryptToken(payload.data.refresh_token) : integration.refresh_token_enc,
    expires_at: Number.isFinite(seconds) && seconds > 0 ? new Date(Date.now() + seconds * 1000).toISOString() : integration.expires_at,
    meta: { ...oldMeta, refresh_expires_at: Number.isFinite(refreshSeconds) && refreshSeconds > 0
      ? new Date(Date.now() + refreshSeconds * 1000).toISOString() : oldMeta.refresh_expires_at || null },
    updated_at: new Date().toISOString(),
  }).eq("id", integration.id).eq("user_id", userId);
  if (error) throw new TikTokAdsConnectionError("Renouvellement TikTok Ads non conservé.", "storage_unavailable");
  return payload.data.access_token;
}
