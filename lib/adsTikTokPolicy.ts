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

export function tikTokAdsAuthorizeUrl(configuredUrl: string, state: string): URL | null {
  try {
    const url = new URL(configuredUrl);
    if (url.protocol !== "https:" || !(
      url.hostname === "business-api.tiktok.com" || url.hostname === "ads.tiktok.com"
    )) return null;
    url.searchParams.set("state", state);
    return url;
  } catch {
    return null;
  }
}
