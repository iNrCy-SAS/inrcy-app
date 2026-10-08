/** TikTok API for Business is separate from TikTok's organic Content Posting API. */
export const TIKTOK_ADS_SOURCE = "tiktok_ads";
export const TIKTOK_ADS_PRODUCT = "ads";
export const TIKTOK_ADS_API_BASE = "https://business-api.tiktok.com/open_api/v1.3";

export type TikTokAdsAccount = {
  id: string;
  name: string;
  currency: string;
  status: string;
};

/** Only an approved advertiser account can be associated with iNr'ADS. */
export function tikTokAdsAccountCanAssociate(account: TikTokAdsAccount): boolean {
  return account.currency === "EUR" && account.status.toUpperCase() === "STATUS_ENABLE";
}

/** TikTok may report an OAuth failure in its JSON envelope with HTTP 200. */
export function tikTokAdsRefreshNeedsReconnect(httpStatus: number, providerMessage: unknown): boolean {
  if (httpStatus === 401) return true;
  const message = typeof providerMessage === "string" ? providerMessage : "";
  return /(?:refresh[\s_-]*token.{0,80}(?:expired|invalid|revoked)|(?:expired|invalid|revoked).{0,80}refresh[\s_-]*token)/i.test(message);
}

/** A timed token with missing or malformed expiry must be refreshed or reauthorized. */
export function tikTokAdsAccessTokenIsFresh(expiresAt: unknown, now = Date.now()): boolean {
  const timestamp = typeof expiresAt === "string" ? Date.parse(expiresAt) : NaN;
  return Number.isFinite(timestamp) && timestamp > now + 120_000;
}

/** Marketing API can issue a long-term token without a refresh token or TTL. */
export function tikTokAdsIsLongLivedAuthorization(refreshToken: unknown, expiresIn: unknown): boolean {
  return !refreshToken && (expiresIn === undefined || expiresIn === null);
}

export function tikTokAdsRefreshTokenIsUsable(refreshToken: unknown, expiresAt: unknown, now = Date.now()): boolean {
  if (typeof refreshToken !== "string" || !refreshToken) return false;
  // Some token responses omit the refresh TTL; allow one provider-side refresh attempt.
  if (expiresAt == null || expiresAt === "") return true;
  const timestamp = typeof expiresAt === "string" ? Date.parse(expiresAt) : NaN;
  return Number.isFinite(timestamp) && timestamp > now;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function advertiserId(value: unknown): string {
  // TikTok v1.3 IDs are strings; a large JSON number may already be rounded by JavaScript.
  if (typeof value === "number" && !Number.isSafeInteger(value)) return "";
  const id = typeof value === "string" || typeof value === "number" ? String(value) : "";
  return /^\d{5,30}$/.test(id) ? id : "";
}

/** TikTok has returned both advertiser_ids and list across API revisions. */
export function parseTikTokAdvertiserIds(payload: unknown): string[] {
  const data = asRecord(asRecord(payload).data);
  const values = Array.isArray(data.list) ? data.list
    : Array.isArray(data.advertiser_ids) ? data.advertiser_ids : [];
  return [...new Set(values.flatMap((entry) => {
    const id = advertiserId(typeof entry === "object" && entry !== null ? asRecord(entry).advertiser_id : entry);
    return id ? [id] : [];
  }))];
}

/** A successful v1.3 response contains data.list of advertiser records.
 * Keep the existing advertiser_ids compatibility, but never turn a missing
 * list or rejected identifier into a genuine empty authorization.
 * https://business-api.tiktok.com/portal/docs/get-authorized-ad-accounts/v1.3
 */
export function parseTikTokAdvertiserAuthorization(payload: unknown): string[] | null {
  const root = asRecord(payload);
  if (root.code !== 0) return null;
  const data = asRecord(root.data);
  const values = Object.hasOwn(data, "list") ? data.list : data.advertiser_ids;
  if (!Array.isArray(values)) return null;
  const ids = new Set<string>();
  for (const entry of values) {
    const id = advertiserId(typeof entry === "object" && entry !== null ? asRecord(entry).advertiser_id : entry);
    if (!id) return null;
    ids.add(id);
  }
  return [...ids];
}

export function parseTikTokAccountInfo(payload: unknown): TikTokAdsAccount[] {
  const data = asRecord(asRecord(payload).data);
  const values = Array.isArray(data.list) ? data.list : [];
  return values.flatMap((entry) => {
    const row = asRecord(entry);
    const id = advertiserId(row.advertiser_id);
    if (!id) return [];
    return [{
      id,
      name: String(row.name || row.advertiser_name || `Compte ${id}`).slice(0, 180),
      currency: String(row.currency || "").toUpperCase(),
      status: String(row.status || row.account_status || ""),
    }];
  });
}

export type TikTokAdsOAuthBinding = { appId: string; redirectUri: string };

/** The state cookie can only return to this application's dedicated callback. */
export function tikTokAdsCallbackUrl(redirectUri: string, expectedOrigin?: string): URL | null {
  try {
    const url = new URL(redirectUri);
    const localHttp = url.protocol === "http:" && url.hostname === "localhost";
    if ((url.protocol !== "https:" && !localHttp) || url.username || url.password || url.search || url.hash
      || url.pathname !== "/api/ads/tiktok/callback") return null;
    if (expectedOrigin && url.origin !== expectedOrigin) return null;
    return url;
  } catch {
    return null;
  }
}

/** Preserve the generated advertiser URL; only state is set after its binding is verified. */
export function tikTokAdsAuthorizeUrl(configuredUrl: string, state: string, binding: TikTokAdsOAuthBinding): URL | null {
  try {
    const url = new URL(configuredUrl);
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash || !(
      url.hostname === "business-api.tiktok.com" || url.hostname === "ads.tiktok.com"
    )) return null;
    const appId = binding.appId.trim();
    const callback = tikTokAdsCallbackUrl(binding.redirectUri);
    if (!/^\d{5,30}$/.test(appId) || !callback) return null;
    const appIds = url.searchParams.getAll("app_id");
    // TikTok's authorization guide names redirect_uri; its FAQ also uses redirect_url.
    const redirects = [...url.searchParams.getAll("redirect_uri"), ...url.searchParams.getAll("redirect_url")];
    if (appIds.length !== 1 || appIds[0] !== appId || redirects.length !== 1
      || redirects[0] !== callback.toString()) return null;
    url.searchParams.set("state", state);
    return url;
  } catch {
    return null;
  }
}
