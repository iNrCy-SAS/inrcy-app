import "server-only";

import { decryptToken, encryptToken } from "@/lib/oauthCrypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { signXAdsOAuthRequest } from "@/lib/adsXOAuth1";
import {
  isXAdsCallbackUri,
  normalizeXAdsAccount,
  verifyXAdsAccount,
  X_ADS_INTEGRATION_IDENTITY,
  type XAdsAccount,
} from "@/lib/adsXPolicy";

export const X_ADS_PROVIDER = X_ADS_INTEGRATION_IDENTITY.provider;
export const X_ADS_SOURCE = X_ADS_INTEGRATION_IDENTITY.source;
export const X_ADS_PRODUCT = X_ADS_INTEGRATION_IDENTITY.product;
const X_OAUTH_ORIGIN = "https://api.x.com";
const X_ADS_ORIGIN = "https://ads-api.x.com";
export const X_ADS_CURRENT_API_VERSION = "12";

export type XAdsIntegration = {
  id: string;
  status: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  resource_id: string | null;
  resource_label: string | null;
  provider_account_id: string | null;
  meta: unknown;
};

export class XAdsConnectionError extends Error {
  constructor(message: string, readonly code: string, readonly status = 503) {
    super(message);
    this.name = "XAdsConnectionError";
  }
}

export function getXAdsCredentials() {
  // OAuth 2.0 X_CLIENT_ID/SECRET are deliberately not reused for the Ads API.
  const apiKey = String(process.env.X_ADS_API_KEY || "").trim();
  const apiSecret = String(process.env.X_ADS_API_SECRET || "").trim();
  return { apiKey, apiSecret, configured: Boolean(apiKey && apiSecret) };
}

export function getXAdsApiVersion(): string {
  const version = String(process.env.X_ADS_API_VERSION || X_ADS_CURRENT_API_VERSION).trim();
  if (version !== X_ADS_CURRENT_API_VERSION) {
    throw new XAdsConnectionError(
      `Version X Ads API non prise en charge : utilisez ${X_ADS_CURRENT_API_VERSION}.`,
      "api_version_invalid",
    );
  }
  return version;
}

export function getXAdsRedirectUri(requestUrl: string): string {
  const explicit = String(process.env.X_ADS_REDIRECT_URI || "").trim();
  const site = String(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "").trim();
  const appOrigin = site ? new URL(site).origin : new URL(requestUrl).origin;
  const callbackUri = explicit || `${appOrigin}/api/ads/x/callback`;
  if (!isXAdsCallbackUri(callbackUri)) {
    throw new XAdsConnectionError("URL de retour X Ads invalide : utilisez /api/ads/x/callback.", "redirect_uri_invalid");
  }
  if (new URL(callbackUri).origin !== appOrigin) {
    throw new XAdsConnectionError("L’URL de retour X Ads doit utiliser l’origine canonique de l’application.", "redirect_origin_invalid");
  }
  return callbackUri;
}

function formResponse(raw: string): URLSearchParams {
  return new URLSearchParams(raw);
}

async function xOAuthPost(
  path: "/oauth/request_token" | "/oauth/access_token",
  input: { token?: string; tokenSecret?: string; oauth: Record<string, string> },
): Promise<URLSearchParams> {
  const { apiKey, apiSecret, configured } = getXAdsCredentials();
  if (!configured) throw new XAdsConnectionError("Configuration X Ads OAuth 1.0a incomplète.", "configuration_missing");
  const url = `${X_OAUTH_ORIGIN}${path}`;
  const { authorization } = signXAdsOAuthRequest({
    method: "POST", url, apiKey, apiSecret,
    token: input.token, tokenSecret: input.tokenSecret, oauth: input.oauth,
  });
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: authorization, Accept: "application/x-www-form-urlencoded" },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const payload = formResponse(await response.text().catch(() => ""));
  if (!response.ok) {
    const invalid = response.status === 400 || response.status === 401;
    throw new XAdsConnectionError(
      invalid ? "Autorisation X Ads invalide ou expirée." : "X Ads est momentanément indisponible.",
      invalid ? "authorization_invalid" : "provider_unavailable",
      invalid ? 401 : 503,
    );
  }
  return payload;
}

export async function requestXAdsToken(callbackUri: string) {
  const params = await xOAuthPost("/oauth/request_token", { oauth: { oauth_callback: callbackUri } });
  const token = params.get("oauth_token") || "";
  const tokenSecret = params.get("oauth_token_secret") || "";
  if (!token || !tokenSecret || params.get("oauth_callback_confirmed") !== "true") {
    throw new XAdsConnectionError("X n’a pas confirmé l’URL de retour.", "oauth_callback_unconfirmed", 502);
  }
  return { token, tokenSecret, authorizeUrl: `${X_OAUTH_ORIGIN}/oauth/authorize?oauth_token=${encodeURIComponent(token)}` };
}

export async function exchangeXAdsAccessToken(token: string, tokenSecret: string, verifier: string) {
  const params = await xOAuthPost("/oauth/access_token", {
    token, tokenSecret, oauth: { oauth_verifier: verifier },
  });
  const accessToken = params.get("oauth_token") || "";
  const accessTokenSecret = params.get("oauth_token_secret") || "";
  if (!accessToken || !accessTokenSecret) {
    throw new XAdsConnectionError("X n’a pas fourni les jetons utilisateur attendus.", "access_token_missing", 502);
  }
  return {
    accessToken,
    accessTokenSecret,
    userId: params.get("user_id") || "",
    screenName: params.get("screen_name") || "",
  };
}

export async function readXAdsIntegration(userId: string): Promise<XAdsIntegration | null> {
  const { data, error } = await supabaseAdmin.from("integrations")
    .select("id,status,access_token_enc,refresh_token_enc,resource_id,resource_label,provider_account_id,meta")
    .eq("user_id", userId)
    .eq("provider", X_ADS_PROVIDER)
    .eq("source", X_ADS_SOURCE)
    .eq("product", X_ADS_PRODUCT)
    .maybeSingle();
  if (error) throw new XAdsConnectionError("Connexion X Ads indisponible.", "storage_unavailable");
  return data as XAdsIntegration | null;
}

export async function saveXAdsConnection(userId: string, token: Awaited<ReturnType<typeof exchangeXAdsAccessToken>>) {
  const previous = await readXAdsIntegration(userId);
  const sameXUser = Boolean(token.userId && previous?.provider_account_id === token.userId);
  const { error } = await supabaseAdmin.from("integrations").upsert({
    user_id: userId,
    provider: X_ADS_PROVIDER,
    category: "social",
    source: X_ADS_SOURCE,
    product: X_ADS_PRODUCT,
    status: "connected",
    display_name: token.screenName ? `@${token.screenName}` : "Compte X Ads",
    provider_account_id: token.userId || null,
    scopes: "oauth1",
    access_token_enc: encryptToken(token.accessToken),
    refresh_token_enc: encryptToken(token.accessTokenSecret),
    expires_at: null, // OAuth 1.0a user tokens do not expire, but users can revoke them.
    // Reauthorizing the same X user refreshes OAuth without silently detaching its chosen Ads account.
    // A different or unidentified X user must choose an advertiser again.
    resource_id: sameXUser ? previous?.resource_id : null,
    resource_label: sameXUser ? previous?.resource_label : null,
    meta: { product: "inr_ads", provider: "x", auth: "oauth1a", x_user_id: token.userId || null },
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,provider,source,product" });
  if (error) throw new XAdsConnectionError("Impossible de mémoriser X Ads.", "storage_unavailable");
}

async function markXAdsNeedsReconnect(userId: string, integrationId: string) {
  await supabaseAdmin.from("integrations")
    .update({ status: "needs_update", updated_at: new Date().toISOString() })
    .eq("id", integrationId).eq("user_id", userId);
}

async function signedXAdsGet<T>(userId: string, row: XAdsIntegration, url: string): Promise<T> {
  const { apiKey, apiSecret, configured } = getXAdsCredentials();
  if (!configured) throw new XAdsConnectionError("Configuration X Ads OAuth 1.0a incomplète.", "configuration_missing");
  if (row.status !== "connected" || !row.access_token_enc || !row.refresh_token_enc) {
    throw new XAdsConnectionError("Connectez X Ads.", row.status === "needs_update" ? "needs_reconnect" : "not_connected", 409);
  }
  let token: string;
  let tokenSecret: string;
  try {
    token = decryptToken(row.access_token_enc);
    tokenSecret = decryptToken(row.refresh_token_enc);
  } catch {
    await markXAdsNeedsReconnect(userId, row.id);
    throw new XAdsConnectionError("Reconnectez X Ads.", "needs_reconnect", 409);
  }
  const { authorization } = signXAdsOAuthRequest({ method: "GET", url, apiKey, apiSecret, token, tokenSecret });
  const response = await fetch(url, {
    headers: { Authorization: authorization, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json().catch(() => ({})) as T;
  if (!response.ok) {
    if (response.status === 401) {
      await markXAdsNeedsReconnect(userId, row.id);
      throw new XAdsConnectionError("Reconnectez X Ads.", "needs_reconnect", 409);
    }
    throw new XAdsConnectionError(
      response.status === 403 ? "L’application X doit être approuvée pour Ads API Standard ou ce compte est inaccessible." : "X Ads est momentanément indisponible.",
      response.status === 403 ? "ads_access_denied" : "provider_unavailable",
      response.status === 403 ? 403 : 503,
    );
  }
  return payload;
}

/** Read-only discovery via the current versioned GET /accounts endpoint. */
export async function listXAdsAccounts(userId: string, row?: XAdsIntegration | null): Promise<XAdsAccount[]> {
  const integration = row === undefined ? await readXAdsIntegration(userId) : row;
  if (!integration) throw new XAdsConnectionError("Connectez X Ads.", "not_connected", 409);
  const apiVersion = getXAdsApiVersion();
  const found = new Map<string, XAdsAccount>();
  let cursor = "";
  const seenCursors = new Set<string>();
  for (let page = 0; page < 20; page += 1) {
    const url = new URL(`${X_ADS_ORIGIN}/${apiVersion}/accounts`);
    url.searchParams.set("count", "200");
    if (cursor) url.searchParams.set("cursor", cursor);
    const result = await signedXAdsGet<{ data?: unknown[]; next_cursor?: string }>(userId, integration, url.toString());
    if (!Array.isArray(result.data)) {
      throw new XAdsConnectionError("Réponse X Ads incomplète.", "provider_response_invalid", 502);
    }
    for (const item of result.data) {
      const account = normalizeXAdsAccount(item);
      if (account) found.set(account.id, account);
    }
    const next = typeof result.next_cursor === "string" ? result.next_cursor : "";
    if (!next) break;
    if (seenCursors.has(next) || page === 19) {
      throw new XAdsConnectionError("La liste des comptes X Ads est incomplète.", "accounts_pagination_incomplete", 502);
    }
    seenCursors.add(next);
    cursor = next;
  }
  return [...found.values()];
}

/** Explicit verification of the chosen account's role and EUR funding currency. */
export async function verifySelectedXAdsAccount(userId: string, row: XAdsIntegration, account: XAdsAccount): Promise<XAdsAccount> {
  const encodedId = encodeURIComponent(account.id);
  const apiVersion = getXAdsApiVersion();
  const fundingTask = async () => {
    const instruments: unknown[] = [];
    const seenCursors = new Set<string>();
    let cursor = "";
    for (let page = 0; page < 20; page += 1) {
      const url = new URL(`${X_ADS_ORIGIN}/${apiVersion}/accounts/${encodedId}/funding_instruments`);
      url.searchParams.set("count", "200");
      if (cursor) url.searchParams.set("cursor", cursor);
      const result = await signedXAdsGet<{ data?: unknown[]; next_cursor?: string }>(userId, row, url.toString());
      if (!Array.isArray(result.data)) {
        throw new XAdsConnectionError("Réponse de financement X Ads incomplète.", "provider_response_invalid", 502);
      }
      instruments.push(...result.data);
      const next = typeof result.next_cursor === "string" ? result.next_cursor : "";
      if (!next) return instruments;
      if (seenCursors.has(next) || page === 19) {
        throw new XAdsConnectionError("La devise du compte X Ads n’a pas pu être vérifiée complètement.", "funding_pagination_incomplete", 502);
      }
      seenCursors.add(next);
      cursor = next;
    }
    return instruments;
  };
  const [access, funding] = await Promise.all([
    signedXAdsGet<{ data?: unknown }>(userId, row, `${X_ADS_ORIGIN}/${apiVersion}/accounts/${encodedId}/authenticated_user_access`),
    fundingTask(),
  ]);
  if (!access.data || typeof access.data !== "object" || Array.isArray(access.data)) {
    throw new XAdsConnectionError("Réponse d’autorisation X Ads incomplète.", "provider_response_invalid", 502);
  }
  return verifyXAdsAccount(account, access.data, funding);
}
