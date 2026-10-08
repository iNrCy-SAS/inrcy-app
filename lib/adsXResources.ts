import type { XAdsAccount } from "./adsXPolicy.ts";

export const X_ADS_LOCATION_TYPES = ["COUNTRIES", "REGIONS", "METROS", "CITIES", "POSTAL_CODES"] as const;
export type XAdsGeoTarget = { id: string; name: string; countryCode: string; locationType: (typeof X_ADS_LOCATION_TYPES)[number] };
export type XAdsFundingInstrument = { id: string; currency: string; ableToFund: boolean; deleted: boolean; cancelled: boolean };
export type XAdsPromotableUser = { id: string; userId: string; type: "FULL" | "RETWEETS_ONLY" };
export type XAdsPromotablePost = { id: string; userId: string; text: string };
/** This URL is published in the post text; no website conversion tracking is configured. */
export function xAdsTrackedDestination(destination: string, trackingParameters: string): { url: string | null; error: string | null } {
  try {
    const url = new URL(destination);
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname) throw new Error();
    const tracking = String(trackingParameters || "").trim().replace(/^\?/, "");
    if (tracking.length > 500 || tracking.includes("#") || /%(?![0-9a-f]{2})/i.test(tracking)) throw new Error();
    const seen = new Set<string>();
    for (const [key, value] of new URLSearchParams(tracking)) {
      if (!/^utm_(?:source|medium|campaign|term|content|id)$/.test(key) || !value.trim() || value.length > 250 || /[\u0000-\u001f]/.test(value) || seen.has(key)) throw new Error();
      seen.add(key); url.searchParams.set(key, value);
    }
    return { url: url.toString(), error: null };
  } catch { return { url: null, error: "Vérifiez le lien HTTPS et les paramètres UTM du post X." }; }
}
export function xAdsPostIncludesDestination(postText: string, destination: string, trackingParameters: string): boolean {
  if (!destination.trim()) return !trackingParameters.trim();
  const tracked = xAdsTrackedDestination(destination, trackingParameters);
  return Boolean(tracked.url && postText.split(/\s+/u).includes(tracked.url));
}
export type XAdsNativeSelections = {
  schemaVersion: 1; accountId: string;
  context: { objective: "ENGAGEMENTS"; format: "text"; targetingMode: "broad"; placements: "ALL_ON_TWITTER" };
  fundingInstrumentId: string | null; promotableUserId: string | null; postId: string | null; geoTargets: XAdsGeoTarget[];
};
export type XAdsResources = {
  selectedAccountId: string;
  account: XAdsAccount & { timeZone: string };
  fundingInstruments: XAdsFundingInstrument[]; promotableUsers: XAdsPromotableUser[]; posts: XAdsPromotablePost[];
  capabilities: { standardAccess: "verified" | "unverified"; tokenRegeneratedAfterApproval: "verified" | "unverified"; nativeWriteAccess: "verified" | "unverified" };
  publicationEnabled: false; verifiedAt: string;
};
export type XAdsGeography = {
  selectedAccountId: string;
  resolutions: Array<{ query: string; options: XAdsGeoTarget[]; autoSelectedTarget: XAdsGeoTarget | null }>;
  options: XAdsGeoTarget[]; complete: true; publicationEnabled: false; verifiedAt: string;
};
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const exact = (row: Record<string, unknown>, keys: string[]) => Object.keys(row).length === keys.length && Object.keys(row).every((key) => keys.includes(key));
export const xAdsResourceId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9]{1,128}$/i.test(value);
export const xAdsPostId = (value: unknown): value is string => typeof value === "string" && /^\d{1,20}$/.test(value);
const cleanName = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 250 && !/[\x00-\x1f]/.test(value);
export function normalizeXAdsGeoTargets(value: unknown): XAdsGeoTarget[] | null {
  if (!Array.isArray(value) || value.length > 20) return null;
  const found = new Set<string>(), result: XAdsGeoTarget[] = [];
  for (const item of value) {
    const row = record(item);
    if (!exact(row, ["id", "name", "countryCode", "locationType"]) || !xAdsResourceId(row.id) || found.has(row.id)
      || !cleanName(row.name) || typeof row.countryCode !== "string" || !/^[A-Z]{2}$/.test(row.countryCode)
      || !X_ADS_LOCATION_TYPES.includes(row.locationType as XAdsGeoTarget["locationType"])) return null;
    found.add(row.id); result.push({ id: row.id, name: row.name, countryCode: row.countryCode, locationType: row.locationType as XAdsGeoTarget["locationType"] });
  }
  return result;
}
export function normalizeXAdsNativeSelections(value: unknown): { selections: XAdsNativeSelections | null; error: string | null } {
  if (value == null) return { selections: null, error: null };
  const row = record(value), context = record(row.context), geoTargets = normalizeXAdsGeoTargets(row.geoTargets);
  const valid = exact(row, ["schemaVersion", "accountId", "context", "fundingInstrumentId", "promotableUserId", "postId", "geoTargets"])
    && row.schemaVersion === 1 && xAdsResourceId(row.accountId)
    && exact(context, ["objective", "format", "targetingMode", "placements"])
    && context.objective === "ENGAGEMENTS" && context.format === "text" && context.targetingMode === "broad" && context.placements === "ALL_ON_TWITTER"
    && (row.fundingInstrumentId === null || xAdsResourceId(row.fundingInstrumentId))
    && (row.promotableUserId === null || xAdsResourceId(row.promotableUserId))
    && (row.postId === null || xAdsPostId(row.postId)) && geoTargets !== null;
  if (!valid) return { selections: null, error: "Les sélections natives X Ads sont invalides. Revérifiez le compte et les ressources proposées par X." };
  return { selections: { schemaVersion: 1, accountId: row.accountId as string, context: { objective: "ENGAGEMENTS", format: "text", targetingMode: "broad", placements: "ALL_ON_TWITTER" }, fundingInstrumentId: row.fundingInstrumentId as string | null, promotableUserId: row.promotableUserId as string | null, postId: row.postId as string | null, geoTargets: geoTargets! }, error: null };
}
export function parseXAdsFundingInstruments(rows: unknown[]): XAdsFundingInstrument[] {
  return rows.flatMap((item) => { const row = record(item);
    return xAdsResourceId(row.id) && typeof row.currency === "string" && /^[A-Z]{3}$/.test(row.currency)
      && typeof row.able_to_fund === "boolean" && typeof row.deleted === "boolean" && typeof row.cancelled === "boolean"
      ? [{ id: row.id, currency: row.currency, ableToFund: row.able_to_fund, deleted: row.deleted, cancelled: row.cancelled }] : [];
  });
}
export function parseXAdsPromotableUsers(rows: unknown[]): XAdsPromotableUser[] {
  return rows.flatMap((item) => { const row = record(item);
    return row.deleted === false && xAdsResourceId(row.id) && xAdsPostId(row.user_id) && ["FULL", "RETWEETS_ONLY"].includes(String(row.promotable_user_type))
      ? [{ id: row.id, userId: row.user_id, type: row.promotable_user_type as XAdsPromotableUser["type"] }] : [];
  });
}
/** Ads v12 returns the Tweet v1 object. Reconstruct only provider-attested URL entities.
 * https://docs.x.com/x-ads-api/creatives/reference#get-accounts-account-id-tweets
 * https://developer.x.com/en/docs/twitter-api/v1/tweets/post-and-engage/api-reference/get-favorites-list
 */
export function xAdsNativePostText(value: unknown): string | null {
  const row = record(value), raw = typeof row.full_text === "string" ? row.full_text : row.text;
  if (typeof raw !== "string") return null;
  const urls = record(row.entities).urls;
  if (urls === undefined || Array.isArray(urls) && urls.length === 0) return raw;
  if (!Array.isArray(urls) || urls.length > 20) return null;
  const replacements: Array<{ start: number; end: number; expanded: string }> = [];
  for (const item of urls) { const entity = record(item), indices = entity.indices;
    if (typeof entity.url !== "string" || !/^https?:\/\/t\.co\/[A-Za-z0-9]+$/.test(entity.url) || typeof entity.expanded_url !== "string"
      || !/^https?:\/\//.test(entity.expanded_url) || /[\x00-\x20]/.test(entity.expanded_url) || !Array.isArray(indices) || indices.length !== 2
      || !Number.isSafeInteger(indices[0]) || !Number.isSafeInteger(indices[1]) || indices[0] < 0 || indices[1] <= indices[0] || indices[1] > raw.length
      || raw.slice(indices[0], indices[1]) !== entity.url) return null;
    replacements.push({ start: indices[0], end: indices[1], expanded: entity.expanded_url });
  }
  replacements.sort((a, b) => a.start - b.start);
  if (replacements.some((item, i) => i > 0 && item.start < replacements[i - 1].end)) return null;
  let result = raw;
  for (const item of replacements.reverse()) result = result.slice(0, item.start) + item.expanded + result.slice(item.end);
  return result;
}
/** Published text only; do not coerce 64-bit numeric tweet/user identifiers or hide media/cards. */
export function parseXAdsPromotablePosts(rows: unknown[], users: XAdsPromotableUser[]): XAdsPromotablePost[] {
  return rows.flatMap((item) => { const row = record(item), user = record(row.user), entities = record(row.entities), extended = record(row.extended_entities);
    const id = typeof row.id_str === "string" ? row.id_str : row.tweet_id, userId = user.id_str;
    const text = xAdsNativePostText(row);
    const hasMedia = (Array.isArray(entities.media) && entities.media.length > 0) || (Array.isArray(extended.media) && extended.media.length > 0) || Boolean(row.card_uri || row.card);
    return xAdsPostId(id) && xAdsPostId(userId) && users.some((candidate) => candidate.type === "FULL" && candidate.userId === userId)
      && typeof text === "string" && text.trim().length > 0 && text.length <= 280 && row.tweet_type === "PUBLISHED" && row.deleted !== true
      && row.truncated === false && !hasMedia && !row.retweeted_status && !row.quoted_status && !row.is_quote_status && !row.in_reply_to_status_id_str
      ? [{ id, userId, text }] : [];
  });
}
export function parseXAdsGeoTargets(rows: unknown[]): XAdsGeoTarget[] {
  const found = new Map<string, XAdsGeoTarget>();
  for (const item of rows) { const row = record(item);
    const parsed = normalizeXAdsGeoTargets([{ id: row.targeting_value, name: row.name, countryCode: row.country_code, locationType: row.location_type }]);
    if (row.targeting_type === "LOCATION" && parsed?.[0]) found.set(parsed[0].id, parsed[0]);
  }
  return [...found.values()];
}
export function normalizeXAdsGeoQueries(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 20 || value.some((query) => !cleanName(query) || query.length > 120)) return null;
  const queries = value.map((query) => (query as string).trim());
  return new Set(queries.map((query) => query.toLocaleLowerCase("fr"))).size === queries.length ? queries : null;
}
export function xAdsResourcesConsentKey(resources: XAdsResources | null | undefined): string {
  if (!resources) return "";
  const sorted = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify([resources.selectedAccountId, resources.account.id, resources.account.approvalStatus, resources.account.deleted, resources.account.currency,
    resources.account.timeZone, [...resources.account.permissions].sort(), resources.account.billingReady,
    sorted(resources.fundingInstruments), sorted(resources.promotableUsers), sorted(resources.posts), resources.capabilities]);
}
