import {
  buildLinkedInAdsGeoSearchMinimalPath,
  buildLinkedInAdsGeoUrnsPath,
  normalizeLinkedInAdsTargetingEntities,
  type LinkedInAdsTargetingEntity,
} from "./adsLinkedInPreflightPolicy.ts";

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
  const contradicted = new Set((Array.isArray(elements) ? elements : []).flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    return typeof row.urn === "string" && requested.has(row.urn)
      && typeof row.facetUrn === "string" && row.facetUrn.trim()
      && row.facetUrn !== "urn:li:adTargetingFacet:locations" ? [row.urn] : [];
  }));
  const verified = new Map((normalizeResolvedLinkedInAdsGeos(payload) || [])
    .filter((target) => requested.has(target.urn) && !contradicted.has(target.urn))
    .map((target) => [target.urn, target] as const));

  // The urns finder can omit metadata while typeahead still returns that same
  // live location. Both finders are authoritative only for an exact URN match.
  for (const target of options.freshSuggestions || []) {
    if (requested.has(target.urn) && !contradicted.has(target.urn)
      && normalizeLinkedInAdsTargetingEntities({ elements: [target] })) {
      verified.set(target.urn, target);
    }
  }
  const searches = new Map<string, Promise<LinkedInAdsTargetingEntity[]>>();
  await Promise.all(targets.filter((target) => !verified.has(target.urn) && !contradicted.has(target.urn)).map(async (target) => {
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
  return [...requested].flatMap((urn) => verified.has(urn) ? [verified.get(urn)!] : []);
}
