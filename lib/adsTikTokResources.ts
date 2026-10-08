import { parseTikTokAccountInfo, type TikTokAdsAccount } from "./adsTikTokPolicy.ts";

export const TIKTOK_ADS_IDENTITY_TYPES = ["CUSTOMIZED_USER", "AUTH_CODE", "TT_USER", "BC_AUTH_TT"] as const;
export type TikTokAdsIdentity = {
  id: string;
  type: (typeof TIKTOK_ADS_IDENTITY_TYPES)[number];
  displayName: string;
  authorizedBusinessCenterId?: string;
};
export type TikTokAdsResourceBlocker = "campaign_write_unverified" | "publication_adapter_unavailable" | "active_publication_disabled" | "identity_read_unavailable" | "identity_required" | "account_timezone_unverified";
/** Public, read-only evidence. A successful GET never proves permission to create ads. */
export type TikTokAdsResources = {
  selectedAccountId: string;
  account: TikTokAdsAccount & { timezone: string | null };
  identities: TikTokAdsIdentity[];
  identityRead: { status: "verified" | "unavailable"; code?: string };
  readiness: { advertiserRead: true; campaignWrite: "unverified"; publicationReady: false; blockers: TikTokAdsResourceBlocker[] };
  publicationEnabled: false;
  verifiedAt: string;
};
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function opaqueId(value: unknown): string { return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : ""; }

export function parseTikTokAdsResourceAccount(payload: unknown, accountId: string): TikTokAdsResources["account"] | null {
  const account = parseTikTokAccountInfo(payload).find((row) => row.id === accountId);
  if (!account) return null;
  const data = object(object(payload).data);
  const native = Array.isArray(data.list) ? data.list.map(object).find((row) => String(row.advertiser_id) === accountId) : null;
  let timezone: string | null = null;
  const zone = text(native?.timezone);
  if (zone) { try { timezone = new Intl.DateTimeFormat("en-GB", { timeZone: zone }).resolvedOptions().timeZone; } catch { /* Unknown provider values remain unverified. */ } }
  return { ...account, timezone };
}

/** No avatar URLs, authorization codes, access tokens or unrecognized provider fields are exposed. */
export function parseTikTokAdsIdentities(payload: unknown): TikTokAdsIdentity[] | null {
  const data = object(object(payload).data);
  const list = Array.isArray(data.identity_list) ? data.identity_list : Array.isArray(data.list) ? data.list : null;
  if (!list) return null;
  const identities = new Map<string, TikTokAdsIdentity>();
  for (const value of list) {
    const row = object(value), id = opaqueId(row.identity_id), type = text(row.identity_type);
    if (!id || !TIKTOK_ADS_IDENTITY_TYPES.some((allowed) => allowed === type)) return null;
    const authorizedBusinessCenterId = opaqueId(row.identity_authorized_bc_id);
    if (type === "BC_AUTH_TT" && !authorizedBusinessCenterId) return null;
    const identity: TikTokAdsIdentity = { id, type: type as TikTokAdsIdentity["type"], displayName: text(row.display_name).slice(0, 180), ...(authorizedBusinessCenterId ? { authorizedBusinessCenterId } : {}) };
    identities.set(`${type}:${id}:${authorizedBusinessCenterId}`, identity);
  }
  return [...identities.values()];
}

export function tikTokAdsResourcesConsentKey(resources: TikTokAdsResources | null): string | null {
  if (!resources || resources.account.id !== resources.selectedAccountId || !/^\d{5,30}$/.test(resources.selectedAccountId)) return null;
  const { id, name, currency, status, timezone } = resources.account;
  return JSON.stringify({ account: { id, name, currency, status, timezone }, identityRead: resources.identityRead,
    identities: resources.identities.map((identity) => ({ id: identity.id, type: identity.type, displayName: identity.displayName, authorizedBusinessCenterId: identity.authorizedBusinessCenterId || null }))
      .sort((left, right) => `${left.type}:${left.id}:${left.authorizedBusinessCenterId}`.localeCompare(`${right.type}:${right.id}:${right.authorizedBusinessCenterId}`)),
    readiness: { ...resources.readiness, blockers: [...resources.readiness.blockers].sort() }, publicationEnabled: false });
}

export const TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT = {
  objectiveType: "TRAFFIC", placements: ["PLACEMENT_TIKTOK"], language: "fr", levelRange: "TO_CITY",
} as const;
export type TikTokAdsGeoTarget = {
  id: string; name: string; countryCode: string;
  level: "COUNTRY" | "PROVINCE" | "CITY"; parentId: string;
  areaType: "ADMIN" | "METROPOLITAN_OR_DMA";
  /** Native names of ancestors, from the same account/objective/placement response. */
  path: string[];
};
export type TikTokAdsGeoResolution = {
  query: string; status: "resolved" | "ambiguous" | "not_found";
  target: TikTokAdsGeoTarget | null; candidates: TikTokAdsGeoTarget[];
};
export type TikTokAdsGeography = {
  selectedAccountId: string;
  context: typeof TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT;
  resolutions: TikTokAdsGeoResolution[];
  resolvedTargets: TikTokAdsGeoTarget[];
  unresolvedQueries: string[];
  /** Country choices only when queries are empty; otherwise compact query candidates. */
  options: TikTokAdsGeoTarget[];
  publicationEnabled: false; verifiedAt: string;
};
export type TikTokAdsTrafficPreparation = {
  ready: false; publicationEnabled: false; preparationReady: boolean;
  selectedAccountId: string; selectedIdentity: TikTokAdsIdentity | null;
  verifiedLocations: TikTokAdsGeoTarget[]; verifiedLocationCount: number;
  resourcesKey: string; context: typeof TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT;
  capabilities: {
    nativeWriteAccess: "unverified"; manualTrafficV13: "unverified";
    videoUpload: "unverified"; imageUpload: "unverified";
    mediaRead: "unverified"; objectRead: "unverified";
    minimumLifetimeBudgetEuros: null; budgetCalendar: null;
    scheduleTimeBasis: null; scheduleOffsetMinutes: null;
  };
  blockers: string[]; verifiedAt: string;
};

function geoId(value: unknown, allowRoot = false): string {
  return typeof value === "string" && /^\d{1,30}$/.test(value) && (allowRoot || !/^0+$/.test(value)) ? value : "";
}
/** Strict documented /tool/region v1.3 shape. No data.list/guessed-schema fallback.
 * https://business-api.tiktok.com/portal/docs/get-available-locations-by-different-settings/v1.3
 * The fixture/payload must come from this advertiser + TRAFFIC + PLACEMENT_TIKTOK.
 */
export function parseTikTokAdsTrafficRegions(payload: unknown): TikTokAdsGeoTarget[] | null {
  const data = object(object(payload).data);
  if (!Array.isArray(data.region_info)) return null;
  type Region = { id: string; name: string; code: string; parentId: string; level: string; areaType: string };
  const regions = new Map<string, Region>();
  for (const value of data.region_info) {
    const row = object(value), id = geoId(row.location_id), name = text(row.name), parentId = geoId(row.parent_id, true);
    const level = text(row.level), areaType = text(row.area_type), code = text(row.region_code).toUpperCase();
    if (!id || !name || name.length > 180 || !parentId || id === parentId
      || !["COUNTRY", "PROVINCE", "CITY", "DISTRICT"].includes(level)
      || !["ADMIN", "METROPOLITAN_OR_DMA"].includes(areaType) || code.length > 64) return null;
    const next: Region = { id, name, code, parentId, level, areaType };
    const previous = regions.get(id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(next)) return null;
    regions.set(id, next);
  }
  const targets: TikTokAdsGeoTarget[] = [];
  for (const row of regions.values()) {
    if (row.level === "DISTRICT") continue; // This initial app flow requests TO_CITY.
    const path: string[] = [], seen = new Set<string>([row.id]);
    let ancestor = row, countryCode = row.level === "COUNTRY" && /^[A-Z]{2}$/.test(row.code) ? row.code : "";
    while (ancestor.parentId !== "0") {
      const parent = regions.get(ancestor.parentId);
      if (!parent || seen.has(parent.id)) return null;
      seen.add(parent.id); path.push(parent.name); ancestor = parent;
      if (parent.level === "COUNTRY" && /^[A-Z]{2}$/.test(parent.code)) countryCode = parent.code;
    }
    if (!countryCode || ancestor.level !== "COUNTRY") return null;
    targets.push({ id: row.id, name: row.name, countryCode, level: row.level as TikTokAdsGeoTarget["level"], parentId: row.parentId, areaType: row.areaType as TikTokAdsGeoTarget["areaType"], path });
  }
  return targets;
}

export function normalizeTikTokAdsGeoQueries(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 20 || value.some((query) => typeof query !== "string" || !query.trim() || query.trim().length > 180)) return null;
  return [...new Set(value.map((query) => (query as string).trim()))];
}
export function normalizeTikTokAdsLocationIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 20 || value.some((entry) => !geoId(entry))) return null;
  return [...new Set(value as string[])];
}
function geoLabel(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
export function tikTokAdsGeoTargetLabel(target: TikTokAdsGeoTarget): string {
  return [target.name, ...target.path].join(", ");
}
/** Exact native name/ancestor tuple only. Partial suggestions never become a selected target. */
export function resolveTikTokAdsGeoQueries(targets: TikTokAdsGeoTarget[], queries: string[]): TikTokAdsGeoResolution[] {
  const sorted = [...targets].sort((left, right) => tikTokAdsGeoTargetLabel(left).localeCompare(tikTokAdsGeoTargetLabel(right)) || left.id.localeCompare(right.id));
  return queries.map((query) => {
    const normalized = geoLabel(query);
    const exact = sorted.filter((target) => geoLabel(target.name) === normalized || geoLabel(tikTokAdsGeoTargetLabel(target)) === normalized);
    // Country codes are accepted only when expressly entered; no profile/account-country inference.
    const matches = exact.length ? exact : /^[A-Z]{2}$/.test(query) ? sorted.filter((target) => target.level === "COUNTRY" && target.countryCode === query) : [];
    const candidates = matches.length ? matches : sorted.filter((target) => geoLabel(target.name).includes(normalized));
    return { query, status: matches.length === 1 ? "resolved" : matches.length > 1 ? "ambiguous" : "not_found", target: matches.length === 1 ? matches[0] : null, candidates: candidates.slice(0, 25) };
  });
}

export function tikTokAdsGeographyConsentKey(geography: TikTokAdsGeography | null): string | null {
  if (!geography || !/^\d{5,30}$/.test(geography.selectedAccountId)
    || JSON.stringify(geography.context) !== JSON.stringify(TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT)) return null;
  const rows = (targets: TikTokAdsGeoTarget[]) => [...targets].sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify({ selectedAccountId: geography.selectedAccountId, context: geography.context,
    resolutions: [...geography.resolutions].sort((a, b) => a.query.localeCompare(b.query)).map((resolution) => ({ ...resolution, candidates: rows(resolution.candidates) })),
    resolvedTargets: rows(geography.resolvedTargets), unresolvedQueries: [...geography.unresolvedQueries].sort(), publicationEnabled: false });
}
