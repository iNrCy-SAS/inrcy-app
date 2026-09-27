import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { decryptToken, encryptToken } from "@/lib/oauthCrypto";
import {
  missingPinterestAdsScopes,
  normalizePinterestAdsAccount,
  isPinterestAdsCallbackUri,
  type PinterestAdsAccount,
} from "@/lib/adsPinterestPolicy";

export const PINTEREST_ADS_PROVIDER = "pinterest";
export const PINTEREST_ADS_SOURCE = "pinterest_ads";
export const PINTEREST_ADS_PRODUCT = "ads";

type PinterestAdsTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number | string;
  refresh_token_expires_in?: number | string;
  refresh_token_expires_at?: number | string;
  scope?: string;
  error?: string;
  error_description?: string;
  message?: string;
};

export type PinterestAdsIntegration = {
  id: string;
  status: string | null;
  scopes: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  expires_at: string | null;
  resource_id: string | null;
  resource_label: string | null;
  meta: unknown;
};

export class PinterestAdsConnectionError extends Error {
  constructor(message: string, readonly code: string, readonly status = 503) {
    super(message);
    this.name = "PinterestAdsConnectionError";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asPositiveSeconds(value: unknown): number | null {
  const number = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) && number > 0 ? number : null;
}

function expiryFromSeconds(value: unknown): string | null {
  const seconds = asPositiveSeconds(value);
  return seconds ? new Date(Date.now() + seconds * 1000).toISOString() : null;
}

function refreshExpiry(token: PinterestAdsTokenResponse): string | null {
  const epoch = asPositiveSeconds(token.refresh_token_expires_at);
  return epoch ? new Date(epoch * 1000).toISOString() : expiryFromSeconds(token.refresh_token_expires_in);
}

function isExpiring(value: unknown, marginSeconds = 120): boolean {
  const time = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(time) && time <= Date.now() + marginSeconds * 1000;
}

export function getPinterestAdsCredentials() {
  const adsId = String(process.env.PINTEREST_ADS_CLIENT_ID || "").trim();
  const adsSecret = String(process.env.PINTEREST_ADS_CLIENT_SECRET || "").trim();
  // A distinct Ads app is optional; an existing Pinterest app can request distinct Ads scopes.
  // Never combine an Ads app ID with the organic app secret (or vice versa).
  if (Boolean(adsId) !== Boolean(adsSecret)) {
    return { clientId: "", clientSecret: "", configured: false };
  }
  const clientId = adsId || String(process.env.PINTEREST_CLIENT_ID || process.env.PINTEREST_APP_ID || "").trim();
  const clientSecret = adsSecret || String(process.env.PINTEREST_CLIENT_SECRET || process.env.PINTEREST_APP_SECRET || "").trim();
  return { clientId, clientSecret, configured: Boolean(clientId && clientSecret) };
}

export function getPinterestAdsRedirectUri(requestUrl: string): string {
  const explicit = String(process.env.PINTEREST_ADS_REDIRECT_URI || "").trim();
  const site = String(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "").trim();
  const callbackUri = explicit || `${site ? new URL(site).origin : new URL(requestUrl).origin}/api/ads/pinterest/callback`;
  if (!isPinterestAdsCallbackUri(callbackUri)) {
    throw new PinterestAdsConnectionError("URL de retour Pinterest Ads invalide : utilisez /api/ads/pinterest/callback.", "redirect_uri_invalid");
  }
  return callbackUri;
}

async function pinterestAdsToken(body: URLSearchParams): Promise<PinterestAdsTokenResponse> {
  const { clientId, clientSecret, configured } = getPinterestAdsCredentials();
  if (!configured) throw new PinterestAdsConnectionError("Configuration Pinterest Ads incomplète.", "configuration_missing");
  const response = await fetch("https://api.pinterest.com/v5/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json().catch(() => ({})) as PinterestAdsTokenResponse;
  if (!response.ok || !payload.access_token) {
    const invalid = response.status === 400 || response.status === 401 || payload.error === "invalid_grant";
    throw new PinterestAdsConnectionError(
      invalid ? "Pinterest Ads demande une nouvelle autorisation." : "Pinterest Ads est momentanément indisponible.",
      invalid ? "authorization_invalid" : "provider_unavailable",
      invalid ? 401 : 503,
    );
  }
  return payload;
}

export async function exchangePinterestAdsCode(code: string, redirectUri: string) {
  return pinterestAdsToken(new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  }));
}

async function refreshPinterestAdsToken(refreshToken: string) {
  return pinterestAdsToken(new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }));
}

export async function readPinterestAdsIntegration(userId: string): Promise<PinterestAdsIntegration | null> {
  const { data, error } = await supabaseAdmin.from("integrations")
    .select("id,status,scopes,access_token_enc,refresh_token_enc,expires_at,resource_id,resource_label,meta")
    .eq("user_id", userId)
    .eq("provider", PINTEREST_ADS_PROVIDER)
    .eq("source", PINTEREST_ADS_SOURCE)
    .eq("product", PINTEREST_ADS_PRODUCT)
    .maybeSingle();
  if (error) throw new PinterestAdsConnectionError("Connexion Pinterest Ads indisponible.", "storage_unavailable");
  return data as PinterestAdsIntegration | null;
}

async function markPinterestAdsNeedsReconnect(userId: string, integration: PinterestAdsIntegration): Promise<void> {
  let query = supabaseAdmin.from("integrations")
    .update({ status: "needs_update", updated_at: new Date().toISOString() })
    .eq("id", integration.id)
    .eq("user_id", userId)
    .eq("status", "connected");
  if (integration.refresh_token_enc) query = query.eq("refresh_token_enc", integration.refresh_token_enc);
  await query;
}

export async function savePinterestAdsConnection(userId: string, token: PinterestAdsTokenResponse): Promise<void> {
  if (!token.access_token || !token.refresh_token) {
    throw new PinterestAdsConnectionError("Pinterest Ads n’a pas fourni de connexion renouvelable.", "refresh_token_missing");
  }
  const missing = missingPinterestAdsScopes(token.scope);
  if (missing.length) {
    throw new PinterestAdsConnectionError(`Autorisation Pinterest Ads manquante : ${missing.join(", ")}.`, "missing_scopes", 403);
  }
  const previous = await readPinterestAdsIntegration(userId);
  const { error } = await supabaseAdmin.from("integrations").upsert({
    user_id: userId,
    provider: PINTEREST_ADS_PROVIDER,
    category: "social",
    source: PINTEREST_ADS_SOURCE,
    product: PINTEREST_ADS_PRODUCT,
    status: "connected",
    display_name: "Compte Pinterest Ads",
    provider_account_id: null,
    scopes: token.scope,
    access_token_enc: encryptToken(token.access_token),
    refresh_token_enc: encryptToken(token.refresh_token),
    expires_at: expiryFromSeconds(token.expires_in),
    // Keep the explicit choice across reauthorization. Status and account listing only
    // expose it while the fresh token can still see that advertiser.
    resource_id: previous?.resource_id || null,
    resource_label: previous?.resource_label || null,
    meta: {
      product: "inr_ads",
      provider: "pinterest",
      pinterest_api_environment: "production",
      refresh_expires_at: refreshExpiry(token),
    },
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,provider,source,product" });
  if (error) throw new PinterestAdsConnectionError("Impossible de sauvegarder la connexion Pinterest Ads.", "storage_unavailable");
}

export async function pinterestAdsAccessToken(userId: string, row?: PinterestAdsIntegration | null, forceRefresh = false): Promise<string> {
  const integration = row === undefined ? await readPinterestAdsIntegration(userId) : row;
  if (!integration || integration.status !== "connected") {
    const needsReconnect = integration?.status === "needs_update";
    throw new PinterestAdsConnectionError(needsReconnect ? "Reconnectez Pinterest Ads." : "Connectez Pinterest Ads.", needsReconnect ? "needs_reconnect" : "not_connected", 409);
  }
  if (missingPinterestAdsScopes(integration.scopes).length) {
    throw new PinterestAdsConnectionError("Les autorisations Pinterest Ads doivent être actualisées.", "missing_scopes", 403);
  }
  let accessToken: string;
  try {
    accessToken = integration.access_token_enc ? decryptToken(integration.access_token_enc) : "";
  } catch {
    accessToken = "";
  }
  if (!forceRefresh && accessToken && integration.expires_at && !isExpiring(integration.expires_at)) return accessToken;

  const storedRefreshExpiry = asRecord(integration.meta).refresh_expires_at;
  if (!integration.refresh_token_enc || isExpiring(storedRefreshExpiry, 0)) {
    await markPinterestAdsNeedsReconnect(userId, integration);
    throw new PinterestAdsConnectionError("Reconnectez Pinterest Ads.", "needs_reconnect", 409);
  }
  let refreshToken: string;
  try {
    refreshToken = decryptToken(integration.refresh_token_enc);
  } catch {
    await markPinterestAdsNeedsReconnect(userId, integration);
    throw new PinterestAdsConnectionError("Reconnectez Pinterest Ads.", "needs_reconnect", 409);
  }
  let refreshed: PinterestAdsTokenResponse;
  try {
    refreshed = await refreshPinterestAdsToken(refreshToken);
  } catch (error) {
    if (error instanceof PinterestAdsConnectionError && error.code === "authorization_invalid") {
      const latest = await readPinterestAdsIntegration(userId);
      if (latest?.status === "connected" && latest.refresh_token_enc !== integration.refresh_token_enc) {
        return pinterestAdsAccessToken(userId, latest);
      }
      await markPinterestAdsNeedsReconnect(userId, integration);
    }
    throw error;
  }
  if (refreshed.scope && missingPinterestAdsScopes(refreshed.scope).length) {
    await markPinterestAdsNeedsReconnect(userId, integration);
    throw new PinterestAdsConnectionError("Les autorisations Pinterest Ads ont changé.", "missing_scopes", 403);
  }
  const nextMeta = { ...asRecord(integration.meta) };
  const nextRefreshExpiry = refreshExpiry(refreshed);
  if (nextRefreshExpiry) nextMeta.refresh_expires_at = nextRefreshExpiry;
  const { data, error } = await supabaseAdmin.from("integrations").update({
    access_token_enc: encryptToken(refreshed.access_token!),
    refresh_token_enc: encryptToken(refreshed.refresh_token || refreshToken),
    expires_at: expiryFromSeconds(refreshed.expires_in) || integration.expires_at,
    scopes: refreshed.scope || integration.scopes,
    meta: nextMeta,
    updated_at: new Date().toISOString(),
  }).eq("id", integration.id).eq("user_id", userId).eq("status", "connected")
    .eq("refresh_token_enc", integration.refresh_token_enc).select("id").maybeSingle();
  if (error) throw new PinterestAdsConnectionError("Le renouvellement Pinterest Ads n’a pas pu être conservé.", "storage_unavailable");
  if (!data) {
    const latest = await readPinterestAdsIntegration(userId);
    if (latest?.status === "connected" && latest.refresh_token_enc !== integration.refresh_token_enc) {
      return pinterestAdsAccessToken(userId, latest);
    }
    throw new PinterestAdsConnectionError("La connexion Pinterest Ads a changé ; rechargez vos comptes.", "connection_changed", 409);
  }
  return refreshed.access_token!;
}

/** GET-only account discovery. No paid-ad creation or publication is reachable here. */
export async function listPinterestAdsAccounts(userId: string, row?: PinterestAdsIntegration | null): Promise<PinterestAdsAccount[]> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const integration = attempt === 0 ? row : await readPinterestAdsIntegration(userId);
    const accessToken = await pinterestAdsAccessToken(userId, integration, attempt > 0);
    const accounts = new Map<string, PinterestAdsAccount>();
    const seenBookmarks = new Set<string>();
    let bookmark = "";
    let unauthorized = false;
    for (let page = 0; page < 5; page += 1) {
      const params = new URLSearchParams({ page_size: "100", include_shared_accounts: "true" });
      if (bookmark) params.set("bookmark", bookmark);
      const response = await fetch(`https://api.pinterest.com/v5/ad_accounts?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      const payload = await response.json().catch(() => ({})) as { items?: unknown[]; bookmark?: string };
      if (response.status === 401) {
        unauthorized = true;
        break;
      }
      if (!response.ok) {
        throw new PinterestAdsConnectionError(
          response.status === 403 ? "Pinterest n’autorise pas la lecture des comptes Ads pour cette connexion." : "Impossible de lire les comptes Pinterest Ads.",
          response.status === 403 ? "ads_access_denied" : "provider_unavailable",
          response.status === 403 ? 403 : 503,
        );
      }
      if (!Array.isArray(payload.items)) {
        throw new PinterestAdsConnectionError("Réponse Pinterest Ads incomplète.", "provider_response_invalid", 502);
      }
      for (const item of payload.items) {
        const account = normalizePinterestAdsAccount(item);
        if (account) accounts.set(account.id, account);
      }
      const nextBookmark = typeof payload.bookmark === "string" ? payload.bookmark : "";
      if (!nextBookmark) return [...accounts.values()];
      if (seenBookmarks.has(nextBookmark) || page === 4) {
        throw new PinterestAdsConnectionError("La liste des comptes Pinterest Ads est incomplète.", "accounts_pagination_incomplete", 502);
      }
      seenBookmarks.add(nextBookmark);
      bookmark = nextBookmark;
    }
    if (!unauthorized) break;
  }
  const latest = await readPinterestAdsIntegration(userId);
  if (latest) await markPinterestAdsNeedsReconnect(userId, latest);
  throw new PinterestAdsConnectionError("Reconnectez Pinterest Ads.", "needs_reconnect", 409);
}
