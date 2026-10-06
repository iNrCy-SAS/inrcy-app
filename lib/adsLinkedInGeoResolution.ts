import {
  buildLinkedInAdsGeoSearchMinimalPath,
  buildLinkedInAdsGeoUrnsPath,
  normalizeLinkedInAdsTargetingEntities,
  type LinkedInAdsTargetingEntity,
} from "./adsLinkedInPreflightPolicy.ts";
import { log } from "./observability/logger.ts";

const LOCATIONS_FACET = "urn:li:adTargetingFacet:locations";
const PROFILE_LOCATIONS_FACET = "urn:li:adTargetingFacet:profileLocations";

/** A mixed provider response must not discard its independently valid rows. */
export function normalizeResolvedLinkedInAdsGeos(payload: unknown): LinkedInAdsTargetingEntity[] | null {
  const elements = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>).elements : undefined;
  if (!Array.isArray(elements) || elements.length > 100) return null;
  return [...new Map(elements.flatMap((element) =>
    normalizeLinkedInAdsTargetingEntities({ elements: [element] }) || [])
    .map((target) => [target.urn, target] as const)).values()];
}

/** Recheck every chosen URN against fresh LinkedIn responses, never its saved label. */
export async function resolveLinkedInAdsGeoTargets(options: {
  targets: Array<{ urn: string; name: string }>;
  language: string;
  country: string;
  read: (path: string) => Promise<unknown>;
  resolvedPayload?: unknown;
  freshSuggestions?: LinkedInAdsTargetingEntity[];
}): Promise<LinkedInAdsTargetingEntity[]> {
  const { targets, language, country, read } = options;
  if (!targets.length) return [];
  const path = buildLinkedInAdsGeoUrnsPath(targets.map((target) => target.urn), language, country);
  const payload = options.resolvedPayload === undefined ? await read(path) : options.resolvedPayload;
  const requested = new Set(targets.map((target) => target.urn));
  const elements = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>).elements : undefined;
  const facetCounts = { locations: 0, profile_locations: 0, other: 0, missing: 0, malformed_row: 0 };
  for (const value of Array.isArray(elements) ? elements : []) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      facetCounts.malformed_row++;
      continue;
    }
    const row = value as Record<string, unknown>;
    const facet = typeof row.facetUrn === "string" ? row.facetUrn.trim() : "";
    if (facet === LOCATIONS_FACET) facetCounts.locations++;
    else if (facet === PROFILE_LOCATIONS_FACET) facetCounts.profile_locations++;
    else if (facet) facetCounts.other++;
    else facetCounts.missing++;
  }
  // The generic urns finder returns several facet representations for one URN.
  // Only a valid locations row proves eligibility; other representations do
  // not grant that proof, but cannot invalidate an independently valid row.
  const verified = new Map((normalizeResolvedLinkedInAdsGeos(payload) || [])
    .filter((target) => requested.has(target.urn))
    .map((target) => [target.urn, target] as const));

  // The urns finder can omit metadata while typeahead still returns that same
  // live location. Both finders are authoritative only for an exact URN match.
  for (const target of options.freshSuggestions || []) {
    const normalized = normalizeLinkedInAdsTargetingEntities({ elements: [target] })?.[0];
    if (normalized && requested.has(normalized.urn)) {
      verified.set(normalized.urn, normalized);
    }
  }
  const searches = new Map<string, Promise<LinkedInAdsTargetingEntity[]>>();
  await Promise.all(targets.filter((target) => !verified.has(target.urn)).map(async (target) => {
    const query = target.name.split(",")[0].trim();
    if (query.length < 2 || query.length > 80) return;
    let search = searches.get(query);
    if (!search) {
      search = read(buildLinkedInAdsGeoSearchMinimalPath(query))
        .then((result) => normalizeResolvedLinkedInAdsGeos(result) || []);
      searches.set(query, search);
    }
    const exact = (await search).find((candidate) => candidate.urn === target.urn);
    if (exact) verified.set(exact.urn, exact);
  }));
  const result = [...requested].flatMap((urn) => verified.has(urn) ? [verified.get(urn)!] : []);
  if (!result.length) log.warn("linkedin_ads_geo_resolution_empty", {
    provider: "linkedin",
    requested_count: requested.size,
    verified_count: 0,
    ignored_non_location_count: facetCounts.profile_locations + facetCounts.other,
    urn_response_shape: !Array.isArray(elements) ? "missing_elements" : elements.length > 100 ? "too_many_elements" : "elements",
    urn_facet_counts: facetCounts,
    fresh_suggestion_count: options.freshSuggestions?.length || 0,
    fallback_query_count: searches.size,
  });
  else if (facetCounts.profile_locations + facetCounts.other > 0) log.info("linkedin_ads_geo_resolution_verified", {
    provider: "linkedin",
    requested_count: requested.size,
    verified_count: result.length,
    urn_row_count: Array.isArray(elements) ? elements.length : 0,
    urn_facet_counts: facetCounts,
    ignored_non_location_count: facetCounts.profile_locations + facetCounts.other,
    fallback_query_count: searches.size,
  });
  return result;
}
