/** Native LinkedIn resource identities. Labels are for display; never authorize with them. */
export const LINKEDIN_ADS_PROFESSIONAL_FACETS = [
  { facet: "titles", facetUrn: "urn:li:adTargetingFacet:titles", label: "Intitulés de poste", searchRequired: true },
  { facet: "industries", facetUrn: "urn:li:adTargetingFacet:industries", label: "Secteurs d’activité", searchRequired: false },
  { facet: "skills", facetUrn: "urn:li:adTargetingFacet:skills", label: "Compétences", searchRequired: true },
  { facet: "seniorities", facetUrn: "urn:li:adTargetingFacet:seniorities", label: "Niveaux hiérarchiques", searchRequired: false },
  { facet: "companySizes", facetUrn: "urn:li:adTargetingFacet:staffCountRanges", label: "Tailles d’entreprise", searchRequired: false },
  { facet: "functions", facetUrn: "urn:li:adTargetingFacet:jobFunctions", label: "Fonctions", searchRequired: false },
] as const;

export type LinkedInAdsProfessionalFacet = typeof LINKEDIN_ADS_PROFESSIONAL_FACETS[number]["facet"];
export type LinkedInAdsProfessionalTarget = { facet: LinkedInAdsProfessionalFacet; urn: string; name: string };
export type LinkedInAdsResourcePaging = { start: number; count: number; total?: number; hasMore: boolean };
export type LinkedInAdsConversionOption = {
  urn: string;
  name: string;
  type: string;
  enabled: boolean;
  accountUrn: string;
  ownershipType: "OWNED" | "SHARED";
  conversionMethod: string | null;
  attributionType: string | null;
  postClickAttributionWindowSize: number | null;
  viewThroughAttributionWindowSize: number | null;
};

const NUMBER_ID = /^\d{1,25}$/;
const CONVERSION_URN = /^urn:lla:llaPartnerConversion:\d{1,25}$/;
const ACCOUNT_URN = /^urn:li:sponsoredAccount:\d{1,25}$/;
const STAFF_RANGE_URN = /^urn:li:staffCountRange:\((\d{1,10}),(\d{1,10})\)$/;
const ENTITY_URNS: Record<Exclude<LinkedInAdsProfessionalFacet, "companySizes">, RegExp> = {
  titles: /^urn:li:title:\d{1,25}$/,
  industries: /^urn:li:industry:\d{1,25}$/,
  skills: /^urn:li:skill:\d{1,25}$/,
  seniorities: /^urn:li:seniority:\d{1,25}$/,
  functions: /^urn:li:function:\d{1,25}$/,
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function isLinkedInAdsProfessionalFacet(value: unknown): value is LinkedInAdsProfessionalFacet {
  return LINKEDIN_ADS_PROFESSIONAL_FACETS.some((item) => item.facet === value);
}

export function isLinkedInAdsProfessionalUrn(facet: LinkedInAdsProfessionalFacet, urn: unknown): urn is string {
  if (typeof urn !== "string") return false;
  if (facet !== "companySizes") return ENTITY_URNS[facet]?.test(urn) === true;
  const match = STAFF_RANGE_URN.exec(urn);
  return Boolean(match && Number(match[1]) >= 1 && Number(match[1]) <= Number(match[2]) && Number(match[2]) <= 2_147_483_647);
}

export function isLinkedInAdsConversionUrn(value: unknown): value is string {
  return typeof value === "string" && CONVERSION_URN.test(value);
}

export function linkedInAdsProfessionalFacetUrn(facet: LinkedInAdsProfessionalFacet): string {
  const descriptor = LINKEDIN_ADS_PROFESSIONAL_FACETS.find((item) => item.facet === facet);
  if (!descriptor) throw new TypeError("Invalid LinkedIn professional facet");
  return descriptor.facetUrn;
}

export function normalizeLinkedInAdsProfessionalTarget(value: unknown): LinkedInAdsProfessionalTarget | null {
  const row = record(value);
  const descriptor = LINKEDIN_ADS_PROFESSIONAL_FACETS.find((item) => item.facetUrn === row.facetUrn);
  const urn = text(row.urn);
  const name = text(row.name);
  if (!descriptor || !isLinkedInAdsProfessionalUrn(descriptor.facet, urn) || !name || name.length > 500
    || row.isTargetable === false) return null;
  return { facet: descriptor.facet, urn, name };
}

/** Mixed, unknown or unavailable facet identities are never evidence for a submitted selection. */
export function normalizeLinkedInAdsProfessionalTargets(payload: unknown, facet?: LinkedInAdsProfessionalFacet): LinkedInAdsProfessionalTarget[] | null {
  const elements = record(payload).elements;
  if (!Array.isArray(elements) || elements.length > 1_000) return null;
  const targets = new Map<string, LinkedInAdsProfessionalTarget>();
  for (const element of elements) {
    const target = normalizeLinkedInAdsProfessionalTarget(element);
    if (!target || (facet && target.facet !== facet)) continue;
    const key = `${target.facet}:${target.urn}`;
    if (!targets.has(key)) targets.set(key, target);
  }
  return [...targets.values()];
}

export function normalizeLinkedInAdsResourcePaging(payload: unknown, returnedCount: number, requestedStart = 0): LinkedInAdsResourcePaging {
  const paging = record(record(payload).paging);
  const start = nonNegativeInteger(paging.start) ?? requestedStart;
  const total = nonNegativeInteger(paging.total);
  const pageSize = nonNegativeInteger(paging.count);
  const hasNext = Array.isArray(paging.links) && paging.links.some((value) => record(value).rel === "next");
  return {
    start, count: returnedCount, ...(total !== null ? { total } : {}),
    hasMore: hasNext || (total !== null && start + returnedCount < total)
      || (total === null && pageSize !== null && pageSize > 0 && returnedCount >= pageSize),
  };
}

function locale(language: string, country: string): string {
  if (!/^[a-z]{2}$/.test(language) || !/^[A-Z]{2}$/.test(country)) throw new TypeError("Invalid LinkedIn locale");
  return `&locale=(language:${language},country:${country})`;
}

export function buildLinkedInAdsProfessionalSearchPath(input: {
  facet: LinkedInAdsProfessionalFacet; query?: string; language?: string; country?: string; start?: number; count?: number;
}): string {
  const facetUrn = linkedInAdsProfessionalFacetUrn(input.facet);
  const query = (input.query || "").trim();
  const start = input.start ?? 0;
  const count = input.count ?? 100;
  const descriptor = LINKEDIN_ADS_PROFESSIONAL_FACETS.find((item) => item.facet === input.facet)!;
  if (query.length > 80 || (query.length > 0 && query.length < 2) || (descriptor.searchRequired && query.length < 2)
    || !Number.isSafeInteger(start) || start < 0 || start > 5_000 || !Number.isSafeInteger(count) || count < 1 || count > 100) {
    throw new TypeError("Invalid LinkedIn professional search");
  }
  const useTypeahead = query.length > 0 && (input.facet === "titles" || input.facet === "industries" || input.facet === "skills");
  const params = new URLSearchParams({
    q: useTypeahead ? "typeahead" : "adTargetingFacet",
    facet: facetUrn,
    queryVersion: "QUERY_USES_URNS",
    ...(useTypeahead ? { query } : {}),
    start: String(start), count: String(count),
  });
  return `/rest/adTargetingEntities?${params.toString()}${locale(input.language || "fr", input.country || "FR")}`;
}

export function buildLinkedInAdsProfessionalUrnsPath(targets: LinkedInAdsProfessionalTarget[], language = "fr", country = "FR"): string {
  if (!targets.length || targets.length > 100 || targets.some((target) => !isLinkedInAdsProfessionalFacet(target.facet)
    || !isLinkedInAdsProfessionalUrn(target.facet, target.urn))) throw new TypeError("Invalid LinkedIn professional selection");
  const urns = [...new Set(targets.map((target) => target.urn))];
  return "/rest/adTargetingEntities?q=urns&queryVersion=QUERY_USES_URNS"
    + `&urns=List(${urns.map(encodeURIComponent).join(",")})${locale(language, country)}`;
}

export function buildLinkedInAdsConversionsPath(accountId: string, start = 0, count = 100): string {
  if (!NUMBER_ID.test(accountId) || !Number.isSafeInteger(start) || start < 0 || start > 5_000
    || !Number.isSafeInteger(count) || count < 1 || count > 100) throw new TypeError("Invalid LinkedIn conversion account");
  const params = new URLSearchParams({ q: "account", account: `urn:li:sponsoredAccount:${accountId}`, start: String(start), count: String(count) });
  return `/rest/conversions?${params.toString()}`;
}

/** The account finder also returns authorized SHARED rules (API 202605+). */
export function normalizeLinkedInAdsConversionOptions(payload: unknown, requestedAccountId: string): LinkedInAdsConversionOption[] | null {
  const elements = record(payload).elements;
  if (!NUMBER_ID.test(requestedAccountId) || !Array.isArray(elements) || elements.length > 1_000) return null;
  const options = new Map<string, LinkedInAdsConversionOption>();
  for (const element of elements) {
    const row = record(element);
    const key = record(row.key);
    const rawId = row.id ?? key.id;
    const id = typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId >= 0 ? String(rawId) : text(rawId);
    const urn = `urn:lla:llaPartnerConversion:${id}`;
    const name = text(row.name);
    const type = text(row.type);
    const accountUrn = text(row.account) || text(key.account);
    const ownershipType = row.ownershipType === "SHARED" ? "SHARED" : "OWNED";
    if (!isLinkedInAdsConversionUrn(urn) || !name || name.length > 500 || !/^[A-Z][A-Z_]{1,80}$/.test(type)
      || !ACCOUNT_URN.test(accountUrn) || (accountUrn !== `urn:li:sponsoredAccount:${requestedAccountId}` && ownershipType !== "SHARED")
      || (row.enabled !== undefined && typeof row.enabled !== "boolean")
      || (row.ownershipType !== undefined && row.ownershipType !== "OWNED" && row.ownershipType !== "SHARED")) continue;
    const option: LinkedInAdsConversionOption = {
      urn, name, type, accountUrn, ownershipType,
      enabled: row.enabled !== false,
      conversionMethod: text(row.conversionMethod) || null,
      attributionType: text(row.attributionType) || null,
      postClickAttributionWindowSize: nonNegativeInteger(row.postClickAttributionWindowSize),
      viewThroughAttributionWindowSize: nonNegativeInteger(row.viewThroughAttributionWindowSize),
    };
    // Conflicting provider rows cannot turn a disabled rule into enabled evidence.
    const previous = options.get(urn);
    if (previous && JSON.stringify(previous) !== JSON.stringify(option)) return null;
    options.set(urn, option);
  }
  return [...options.values()];
}

export function linkedInAdsProfessionalNameMatches(name: string, query: string): boolean {
  const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr");
  return normalized(name).includes(normalized(query.trim()));
}
