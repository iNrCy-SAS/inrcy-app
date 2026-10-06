import { isLinkedInAdsAccountId, missingLinkedInAdsScopes } from "./adsLinkedInPolicy.ts";

export type LinkedInAdsCampaignGroup = {
  id: string;
  urn: string;
  account: string;
  name: string;
  status: "ACTIVE" | "DRAFT" | "PAUSED";
  objectiveType: string | null;
  allowedCampaignTypes: string[];
  runSchedule: { start?: number; end?: number };
  organizationUrn: string | null;
};

export type LinkedInAdsTargetingEntity = {
  urn: string;
  name: string;
  facetUrn: string;
};

export type LinkedInAdsImageEvidence = {
  urn: string;
  owner: string;
  status: string;
  associatedAccount: string | null;
};

export type LinkedInAdsBudgetPricing = {
  currency: string;
  bidMin: number;
  bidMax: number;
  dailyBudgetMin: number;
  dailyBudgetDefault: number | null;
};

export const LINKEDIN_ADS_MAX_GEO_QUERIES = 8;

/** Preserve the first spelling while avoiding duplicate provider searches. */
export function normalizeLinkedInAdsGeoQueries(values: string[]): string[] {
  const queries = new Map<string, string>();
  for (const value of values) {
    if (typeof value !== "string") throw new TypeError("Invalid LinkedIn Ads geo query");
    const query = value.trim();
    if (!query) continue;
    if (query.length < 2 || query.length > 80) throw new TypeError("Invalid LinkedIn Ads geo query");
    const key = query.toLocaleLowerCase("fr-FR");
    if (!queries.has(key)) queries.set(key, query);
    if (queries.size > LINKEDIN_ADS_MAX_GEO_QUERIES) throw new TypeError("Too many LinkedIn Ads geo queries");
  }
  return [...queries.values()];
}

/**
 * A campaign group can only be proposed automatically when it already matches
 * the sole live LinkedIn campaign shape supported by iNr'ADS. The provider ID
 * always comes from LinkedIn; this helper never manufactures a resource.
 */
export function linkedInAdsCampaignGroupIsCompatible(
  group: Pick<LinkedInAdsCampaignGroup, "objectiveType" | "allowedCampaignTypes">,
): boolean {
  return (!group.objectiveType || group.objectiveType === "WEBSITE_VISIT")
    && (!group.allowedCampaignTypes.length || group.allowedCampaignTypes.includes("SPONSORED_UPDATES"));
}

function normalizedLinkedInGeoLabel(value: string): string {
  return value.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR")
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Returns a provider-supplied geo only when exactly one suggestion names the
 * requested place. A city may be followed by its region/country in LinkedIn's
 * label, but a mere fuzzy/substring match is deliberately rejected.
 */
export function selectUnambiguousLinkedInAdsGeoTarget(
  suggestions: LinkedInAdsTargetingEntity[],
  requestedLocation: string,
): LinkedInAdsTargetingEntity | null {
  const requested = normalizedLinkedInGeoLabel(requestedLocation);
  if (!requested) return null;
  const matches = suggestions.filter((suggestion) => {
    const label = normalizedLinkedInGeoLabel(suggestion.name);
    const leadingPlace = normalizedLinkedInGeoLabel(suggestion.name.split(/[,·|—(]/, 1)[0] || "");
    return label === requested || leadingPlace === requested;
  });
  return matches.length === 1 ? matches[0] : null;
}

/** Choose a positive, cent-safe CPC from LinkedIn's verified pricing bounds. */
export function recommendedLinkedInAdsBid(
  pricing: LinkedInAdsBudgetPricing | null,
  requestedBid: number | null,
  dailyBudget: number | null = null,
): number | null {
  if (!pricing) return null;
  const maximumBid = dailyBudget !== null && Number.isFinite(dailyBudget) && dailyBudget > 0
    ? Math.min(pricing.bidMax, dailyBudget) : pricing.bidMax;
  if (requestedBid !== null && Number.isFinite(requestedBid)
    && requestedBid > 0 && requestedBid >= pricing.bidMin && requestedBid <= maximumBid) {
    return requestedBid;
  }
  const minimumPositiveBid = Math.max(0.01, Math.ceil(pricing.bidMin * 100) / 100);
  return minimumPositiveBid <= maximumBid ? minimumPositiveBid : null;
}

const GROUP_ID = /^\d{1,25}$/;
const GROUP_URN = /^urn:li:sponsoredCampaignGroup:(\d{1,25})$/;
const ACCOUNT_URN = /^urn:li:sponsoredAccount:(\d{1,25})$/;
const ORGANIZATION_URN = /^urn:li:organization:\d{1,25}$/;
const GEO_URN = /^urn:li:geo:\d{1,25}$/;
const IMAGE_URN = /^urn:li:image:[A-Za-z0-9_-]{3,200}$/;
const LOCALE_URN = /^urn:li:locale:([a-z]{2})_([A-Z]{2})$/;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function safeTime(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function nonNegativeMoney(value: unknown): number | null {
  const amount = Number(record(value).amount);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function organizationUrn(value: unknown, depth = 0): string | null {
  if (typeof value === "string") return ORGANIZATION_URN.test(value) ? value : null;
  if (depth > 4 || !value || typeof value !== "object") return null;
  const values = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  for (const entry of values) {
    const found = organizationUrn(entry, depth + 1);
    if (found) return found;
  }
  return null;
}

export function normalizeLinkedInAdsCampaignGroup(
  value: unknown,
  expectedAccountId: string,
): LinkedInAdsCampaignGroup | null {
  if (!isLinkedInAdsAccountId(expectedAccountId)) return null;
  const row = record(value);
  const rawId = String(row.id ?? "");
  const groupMatch = GROUP_URN.exec(text(row.id));
  const id = groupMatch?.[1] || rawId;
  const account = text(row.account);
  const status = text(row.status);
  if (!GROUP_ID.test(id) || account !== `urn:li:sponsoredAccount:${expectedAccountId}`
    || (status !== "ACTIVE" && status !== "DRAFT" && status !== "PAUSED")) return null;
  const allowedCampaignTypes = Array.isArray(row.allowedCampaignTypes)
    ? row.allowedCampaignTypes.filter((item): item is string => typeof item === "string") : [];
  const schedule = record(row.runSchedule);
  const start = safeTime(schedule.start);
  const end = safeTime(schedule.end);
  return {
    id,
    urn: `urn:li:sponsoredCampaignGroup:${id}`,
    account,
    name: text(row.name) || `Groupe ${id}`,
    status,
    objectiveType: text(row.objectiveType) || null,
    allowedCampaignTypes,
    runSchedule: { ...(start ? { start } : {}), ...(end ? { end } : {}) },
    organizationUrn: organizationUrn(row.beneficiaryReference),
  };
}

export function normalizeLinkedInAdsCampaignGroups(
  payload: unknown,
  expectedAccountId: string,
): LinkedInAdsCampaignGroup[] | null {
  const elements = record(payload).elements;
  if (!Array.isArray(elements) || elements.length > 100) return null;
  const groups = elements.map((item) => normalizeLinkedInAdsCampaignGroup(item, expectedAccountId));
  return groups.every((item): item is LinkedInAdsCampaignGroup => item !== null) ? groups : null;
}

export function normalizeLinkedInAdsTargetingEntities(payload: unknown): LinkedInAdsTargetingEntity[] | null {
  const elements = record(payload).elements;
  if (!Array.isArray(elements) || elements.length > 100) return null;
  const entities = elements.map((value) => {
    const row = record(value);
    const urn = text(row.urn);
    const name = text(row.name);
    const facetUrn = text(row.facetUrn);
    return GEO_URN.test(urn) && name && facetUrn === "urn:li:adTargetingFacet:locations"
      ? { urn, name, facetUrn } : null;
  });
  return entities.every((item): item is LinkedInAdsTargetingEntity => item !== null) ? entities : null;
}

export function normalizeLinkedInAdsLocales(payload: unknown): Array<{ language: string; country: string }> | null {
  const elements = record(payload).elements;
  if (!Array.isArray(elements) || elements.length > 250) return null;
  const locales: Array<{ language: string; country: string }> = [];
  for (const value of elements) {
    const match = LOCALE_URN.exec(text(record(value).urn));
    if (!match) return null;
    locales.push({ language: match[1], country: match[2] });
  }
  return locales;
}

export function normalizeLinkedInAdsImage(
  payload: unknown,
  expectedImageUrn: string,
): LinkedInAdsImageEvidence | null {
  if (!IMAGE_URN.test(expectedImageUrn)) return null;
  const row = record(payload);
  const urn = text(row.id);
  const owner = text(row.owner);
  const status = text(row.status);
  const metadata = record(row.mediaLibraryMetadata);
  const associatedAccount = text(metadata.associatedAccount) || null;
  if (urn !== expectedImageUrn || (!ORGANIZATION_URN.test(owner) && !ACCOUNT_URN.test(owner))) return null;
  if (associatedAccount && !ACCOUNT_URN.test(associatedAccount)) return null;
  return { urn, owner, status, associatedAccount };
}

export function buildLinkedInAdsCampaignGroupsPath(accountId: string): string {
  if (!isLinkedInAdsAccountId(accountId)) throw new TypeError("Invalid LinkedIn Ads account ID");
  return `/rest/adAccounts/${accountId}/adCampaignGroups?q=search&search=(status:(values:List(ACTIVE,DRAFT,PAUSED)))&sortOrder=DESCENDING&pageSize=100`;
}

/** Builds LinkedIn's account-scoped Bing Geo typeahead; locale is optional for the guarded 400 fallback. */
export function buildLinkedInAdsGeoSearchPath(input: {
  query: string;
  accountId: string;
  language?: string;
  country?: string;
}): string {
  const normalizedQuery = input.query.trim();
  const hasLocale = input.language !== undefined || input.country !== undefined;
  if (normalizedQuery.length < 2 || normalizedQuery.length > 80 || !isLinkedInAdsAccountId(input.accountId)
    || (hasLocale && (!/^[a-z]{2}$/.test(input.language || "") || !/^[A-Z]{2}$/.test(input.country || "")))) {
    throw new TypeError("Invalid LinkedIn Ads geo query");
  }
  const params = new URLSearchParams({
    q: "typeahead",
    query: normalizedQuery,
    facet: "urn:li:adTargetingFacet:locations",
    queryVersion: "QUERY_USES_URNS",
    ...(hasLocale ? {
      "locale.language": input.language!,
      "locale.country": input.country!,
    } : {}),
    lixEntity: `urn:li:sponsoredAccount:${input.accountId}`,
  });
  return `/rest/adTargetingEntities?${params.toString()}`;
}

/** LinkedIn's documented typeahead minimum, used only after scoped 400 responses. */
export function buildLinkedInAdsGeoSearchMinimalPath(query: string): string {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length < 2 || normalizedQuery.length > 80) {
    throw new TypeError("Invalid LinkedIn Ads geo query");
  }
  const params = new URLSearchParams({
    q: "typeahead",
    facet: "urn:li:adTargetingFacet:locations",
    query: normalizedQuery,
  });
  return `/rest/adTargetingEntities?${params.toString()}`;
}

/** Re-resolves chosen Bing geo URNs instead of trusting a prior typeahead row. */
export function buildLinkedInAdsGeoUrnsPath(geoUrns: string[], language: string, country: string): string {
  const urns = [...new Set(geoUrns)];
  if (!urns.length || urns.length > 20 || urns.some((urn) => !GEO_URN.test(urn))
    || !/^[a-z]{2}$/.test(language) || !/^[A-Z]{2}$/.test(country)) {
    throw new TypeError("Invalid LinkedIn Ads geo URNs");
  }
  // REST.li keeps the List/locale delimiters literal and encodes each URN inside the list.
  return "/rest/adTargetingEntities?q=urns&queryVersion=QUERY_USES_URNS"
    + `&urns=List(${urns.map(encodeURIComponent).join(",")})`
    + `&locale=(language:${language},country:${country})`;
}

export function buildLinkedInAdsLocalesPath(): string {
  const params = new URLSearchParams({
    q: "adTargetingFacet",
    queryVersion: "QUERY_USES_URNS",
    facet: "urn:li:adTargetingFacet:interfaceLocales",
  });
  return `/rest/adTargetingEntities?${params.toString()}`;
}

export function buildLinkedInAdsImagePath(imageUrn: string): string {
  if (!IMAGE_URN.test(imageUrn)) throw new TypeError("Invalid LinkedIn image URN");
  return `/rest/images/${encodeURIComponent(imageUrn)}`;
}

function buildTargetingCriteria(geoUrns: string[], language: string, country: string): string {
  const geos = [...new Set(geoUrns)];
  if (!geos.length || geos.length > 20 || geos.some((urn) => !GEO_URN.test(urn))
    || !/^[a-z]{2}$/.test(language) || !/^[A-Z]{2}$/.test(country)) {
    throw new TypeError("Invalid LinkedIn Ads targeting criteria");
  }
  const localeUrn = `urn:li:locale:${language}_${country}`;
  const localeFacet = encodeURIComponent("urn:li:adTargetingFacet:interfaceLocales");
  const locationFacet = encodeURIComponent("urn:li:adTargetingFacet:locations");
  return `(include:(and:List((or:(${localeFacet}:List(${encodeURIComponent(localeUrn)}))),(or:(${locationFacet}:List(${geos.map(encodeURIComponent).join(",")}))))))`;
}

export function buildLinkedInAdsAudienceCountPath(geoUrns: string[], language: string, country: string): string {
  return `/rest/audienceCounts?q=targetingCriteriaV2&targetingCriteria=${buildTargetingCriteria(geoUrns, language, country)}`;
}

export function buildLinkedInAdsBudgetPricingPath(input: {
  accountId: string;
  geoUrns: string[];
  language: string;
  country: string;
  dailyBudget: number;
}): string {
  if (!isLinkedInAdsAccountId(input.accountId) || !Number.isFinite(input.dailyBudget) || input.dailyBudget <= 0) {
    throw new TypeError("Invalid LinkedIn Ads pricing criteria");
  }
  const accountUrn = encodeURIComponent(`urn:li:sponsoredAccount:${input.accountId}`);
  const budget = input.dailyBudget.toFixed(2);
  return "/rest/adBudgetPricing"
    + `?account=${accountUrn}&bidType=CPC&currency=EUR&optimizationTargetType=NONE`
    + "&objectiveType=WEBSITE_VISIT&campaignType=SPONSORED_UPDATES&matchType=EXACT&q=criteriaV2"
    + `&targetingCriteria=${buildTargetingCriteria(input.geoUrns, input.language, input.country)}`
    + `&dailyBudget=(amount:${budget},currencyCode:EUR)`;
}

export function normalizeLinkedInAdsAudienceCount(payload: unknown): number | null {
  const elements = record(payload).elements;
  if (!Array.isArray(elements) || elements.length !== 1) return null;
  const total = Number(record(elements[0]).total);
  return Number.isSafeInteger(total) && total >= 0 ? total : null;
}

export function normalizeLinkedInAdsBudgetPricing(payload: unknown): LinkedInAdsBudgetPricing | null {
  const elements = record(payload).elements;
  if (!Array.isArray(elements) || elements.length !== 1) return null;
  const row = record(elements[0]);
  const bidLimits = record(row.bidLimits);
  const dailyBudgetLimits = record(row.dailyBudgetLimits);
  const bidMin = nonNegativeMoney(bidLimits.min);
  const bidMax = nonNegativeMoney(bidLimits.max);
  const dailyBudgetMin = nonNegativeMoney(dailyBudgetLimits.min);
  const dailyBudgetDefault = nonNegativeMoney(dailyBudgetLimits.default);
  const currencies = [record(bidLimits.min).currencyCode, record(bidLimits.max).currencyCode,
    record(dailyBudgetLimits.min).currencyCode].map(text);
  if (bidMin === null || bidMax === null || dailyBudgetMin === null || bidMin > bidMax
    || currencies.some((currency) => currency !== "EUR")) return null;
  return { currency: "EUR", bidMin, bidMax, dailyBudgetMin, dailyBudgetDefault };
}

export function linkedInAdsPreflightBlockers(input: {
  scopes: string[];
  accountCurrency: string;
  canManageCampaigns: boolean;
  canServeCampaigns: boolean;
  targetStatus?: "ACTIVE" | "PAUSED";
  campaignGroup?: LinkedInAdsCampaignGroup | null;
  image?: LinkedInAdsImageEvidence | null;
  /** Image is uploaded after account/targeting preflight in the live publisher. */
  requireImage?: boolean;
  organizationUrn?: string | null;
  localeSupported: boolean;
  verifiedGeoUrns: string[];
  audienceCount: number | null;
  pricing: LinkedInAdsBudgetPricing | null;
  bidAmount: number | null;
  dailyBudget: number | null;
  politicalIntentConfirmed: boolean;
  targetingNoticeAcknowledged: boolean;
}): string[] {
  const blockers: string[] = [];
  for (const scope of missingLinkedInAdsScopes(input.scopes.join(" "), "manage")) {
    blockers.push(`missing_scope:${scope}`);
  }
  if (!input.canManageCampaigns) blockers.push("account_manage_access_unverified");
  if (input.targetStatus !== "PAUSED" && !input.canServeCampaigns) blockers.push("account_not_serving");
  if (input.accountCurrency !== "EUR") blockers.push("unsupported_account_currency");
  if (!input.campaignGroup) blockers.push("campaign_group_required");
  if (input.targetStatus !== "PAUSED" && input.campaignGroup && input.campaignGroup.status !== "ACTIVE") {
    blockers.push("campaign_group_not_active");
  }
  if (input.campaignGroup && input.campaignGroup.objectiveType && input.campaignGroup.objectiveType !== "WEBSITE_VISIT") {
    blockers.push("campaign_group_objective_mismatch");
  }
  if (input.campaignGroup && input.campaignGroup.allowedCampaignTypes.length
    && !input.campaignGroup.allowedCampaignTypes.includes("SPONSORED_UPDATES")) {
    blockers.push("campaign_group_format_unsupported");
  }
  if (input.requireImage !== false && (!input.image || input.image.status !== "AVAILABLE")) blockers.push("available_image_required");
  if (!input.organizationUrn || !ORGANIZATION_URN.test(input.organizationUrn)) blockers.push("organization_required");
  if (input.requireImage !== false && input.image && input.organizationUrn && input.image.owner !== input.organizationUrn) blockers.push("image_owner_mismatch");
  if (!input.localeSupported) blockers.push("unsupported_locale");
  if (!input.verifiedGeoUrns.length) blockers.push("verified_geo_required");
  if (input.audienceCount === null) blockers.push("audience_count_required");
  else if (input.audienceCount < 300) blockers.push("audience_too_small");
  if (!input.pricing) blockers.push("budget_pricing_required");
  if (input.pricing && (input.bidAmount === null
    || input.bidAmount < input.pricing.bidMin || input.bidAmount > input.pricing.bidMax)) blockers.push("bid_out_of_range");
  if (input.pricing && (input.dailyBudget === null
    || input.dailyBudget < input.pricing.dailyBudgetMin)) blockers.push("daily_budget_too_low");
  if (!input.politicalIntentConfirmed) blockers.push("political_intent_confirmation_required");
  if (!input.targetingNoticeAcknowledged) blockers.push("targeting_notice_acknowledgement_required");
  return [...new Set(blockers)];
}
