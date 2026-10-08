/** Native delivery choices, separate from the AI's planning brief and OAuth. */
export const LINKEDIN_PROFESSIONAL_FACETS = ["titles", "industries", "skills", "seniorities", "companySizes", "functions"] as const;
export const LINKEDIN_CALL_TO_ACTIONS = ["APPLY", "DOWNLOAD", "VIEW_QUOTE", "LEARN_MORE", "SIGN_UP", "SUBSCRIBE", "REGISTER", "JOIN", "ATTEND", "REQUEST_DEMO", "SEE_MORE", "BUY_NOW", "SHOP_NOW"] as const;
export const LINKEDIN_BIDDING_STRATEGIES = ["manual_cpc", "maximum_delivery", "cost_cap"] as const;
export const LINKEDIN_IMAGE_OBJECTIVES = ["WEBSITE_VISIT", "BRAND_AWARENESS", "ENGAGEMENT", "WEBSITE_CONVERSION"] as const;
export const LINKEDIN_CAMPAIGN_OBJECTIVES = [...LINKEDIN_IMAGE_OBJECTIVES, "VIDEO_VIEW"] as const;
export type LinkedInProfessionalFacet = (typeof LINKEDIN_PROFESSIONAL_FACETS)[number];
export type LinkedInProfessionalTarget = { facet: LinkedInProfessionalFacet; urn: string; name: string };
export type LinkedInCallToAction = (typeof LINKEDIN_CALL_TO_ACTIONS)[number];
export type LinkedInDeliverySettings = {
  professionalTargeting: { include: LinkedInProfessionalTarget[]; exclude: LinkedInProfessionalTarget[] };
  locationType: "recent_or_permanent" | "permanent";
  placements: { audienceNetwork: boolean; audienceExpansion: boolean };
  budget: { type: "daily" | "total"; totalEuros: number | null; startAt: string | null; endAt: string | null };
  bidding: { strategy: (typeof LINKEDIN_BIDDING_STRATEGIES)[number]; amountEuros: number | null };
  callToAction: LinkedInCallToAction;
  conversions: { conversionUrns: string[] };
};

export function defaultLinkedInDeliverySettings(): LinkedInDeliverySettings {
  return {
    professionalTargeting: { include: [], exclude: [] }, locationType: "recent_or_permanent",
    placements: { audienceNetwork: false, audienceExpansion: false },
    budget: { type: "daily", totalEuros: null, startAt: null, endAt: null },
    bidding: { strategy: "manual_cpc", amountEuros: null }, callToAction: "LEARN_MORE",
    conversions: { conversionUrns: [] },
  };
}

const prefixes: Record<LinkedInProfessionalFacet, RegExp> = {
  titles: /^urn:li:title:\d{1,25}$/, industries: /^urn:li:industry:\d{1,25}$/,
  skills: /^urn:li:skill:\d{1,25}$/, seniorities: /^urn:li:seniority:\d{1,25}$/,
  functions: /^urn:li:function:\d{1,25}$/,
  companySizes: /^urn:li:staffCountRange:\((?:1,1|2,10|11,50|51,200|201,500|501,1000|1001,5000|5001,10000|10001,2147483647)\)$/,
};
export const LINKEDIN_PROFESSIONAL_API_FACETS: Record<LinkedInProfessionalFacet, string> = {
  titles: "titles", industries: "industries", skills: "skills", seniorities: "seniorities",
  companySizes: "staffCountRanges", functions: "jobFunctions",
};
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function money(value: unknown, maximum: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= maximum
    && Math.abs(Math.round(value * 100) - value * 100) <= 0.000001 ? value : null;
}
function instant(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const calendarDay = new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)))).toISOString().slice(0, 10);
  if (calendarDay !== value.slice(0, 10)) return null;
  const milliseconds = Date.parse(value);
  return Number.isSafeInteger(milliseconds) && milliseconds > 0 ? new Date(milliseconds).toISOString() : null;
}
function targets(value: unknown): LinkedInProfessionalTarget[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const found = new Map<string, LinkedInProfessionalTarget>();
  for (const item of value) {
    const row = object(item);
    if (!row || !keys(row, ["facet", "urn", "name"]) || typeof row.facet !== "string"
      || !LINKEDIN_PROFESSIONAL_FACETS.includes(row.facet as LinkedInProfessionalFacet)) return null;
    const facet = row.facet as LinkedInProfessionalFacet;
    if (typeof row.urn !== "string" || !prefixes[facet].test(row.urn) || typeof row.name !== "string"
      || !row.name.trim() || row.name.trim().length > 300) return null;
    found.set(`${facet}|${row.urn}`, { facet, urn: row.urn, name: row.name.trim() });
  }
  return [...found.values()];
}

/** Absence keeps the legacy image/visits payload unchanged; malformed choices never silently fall back. */
export function normalizeLinkedInDeliverySettings(value: unknown): { settings: LinkedInDeliverySettings | null; error: string | null } {
  if (value == null) return { settings: null, error: null };
  const fail = (error: string) => ({ settings: null, error });
  const row = object(value);
  if (!row || !keys(row, ["professionalTargeting", "locationType", "placements", "budget", "bidding", "callToAction", "conversions"])) return fail("Les réglages de diffusion LinkedIn sont invalides.");
  const targeting = object(row.professionalTargeting), placements = object(row.placements);
  const budget = object(row.budget), bidding = object(row.bidding), conversions = object(row.conversions);
  if (!targeting || !keys(targeting, ["include", "exclude"])) return fail("Vérifiez le ciblage professionnel LinkedIn.");
  const include = targets(targeting.include), exclude = targets(targeting.exclude);
  if (!include || !exclude || include.length + exclude.length > 100) return fail("Sélectionnez les critères professionnels proposés par LinkedIn.");
  const excluded = new Set(exclude.map((target) => `${target.facet}|${target.urn}`));
  if (include.some((target) => excluded.has(`${target.facet}|${target.urn}`))) return fail("Un même critère LinkedIn ne peut être inclus et exclu.");
  const includedFacets = new Set(include.map((target) => target.facet));
  if (includedFacets.has("titles") && (includedFacets.has("seniorities") || includedFacets.has("functions"))) return fail("LinkedIn ne permet pas de combiner les intitulés de poste avec les fonctions ou niveaux hiérarchiques en inclusion.");
  if (includedFacets.has("companySizes") && exclude.some((target) => target.facet === "companySizes")) return fail("Les tailles d’entreprise LinkedIn doivent être incluses ou exclues, pas les deux.");
  if (row.locationType !== "recent_or_permanent" && row.locationType !== "permanent") return fail("Choisissez le type de localisation LinkedIn.");
  if (!placements || !keys(placements, ["audienceNetwork", "audienceExpansion"]) || typeof placements.audienceNetwork !== "boolean" || typeof placements.audienceExpansion !== "boolean") return fail("Vérifiez les placements et l’élargissement LinkedIn.");
  if (!budget || !keys(budget, ["type", "totalEuros", "startAt", "endAt"]) || (budget.type !== "daily" && budget.type !== "total")) return fail("Choisissez un budget LinkedIn quotidien ou total.");
  const totalEuros = budget.totalEuros == null ? null : money(budget.totalEuros, 45_000);
  if ((budget.totalEuros != null && totalEuros === null) || (budget.type === "total" && (totalEuros === null || totalEuros < 5))) return fail("Le budget total LinkedIn doit être compris entre 5 et 45 000 €, avec deux décimales maximum.");
  const startAt = budget.startAt == null ? null : instant(budget.startAt), endAt = budget.endAt == null ? null : instant(budget.endAt);
  if ((budget.startAt != null && startAt === null) || (budget.endAt != null && endAt === null) || (startAt && endAt && Date.parse(startAt) >= Date.parse(endAt))) return fail("Vérifiez les dates et heures de diffusion LinkedIn.");
  if (!bidding || !keys(bidding, ["strategy", "amountEuros"]) || !LINKEDIN_BIDDING_STRATEGIES.includes(bidding.strategy as LinkedInDeliverySettings["bidding"]["strategy"])) return fail("Choisissez une stratégie d’enchères LinkedIn prise en charge.");
  const amountEuros = bidding.amountEuros == null ? null : money(bidding.amountEuros, 500);
  if (bidding.amountEuros != null && amountEuros === null) return fail("L’enchère LinkedIn doit être positive et limitée à deux décimales.");
  if (!LINKEDIN_CALL_TO_ACTIONS.includes(row.callToAction as LinkedInCallToAction)) return fail("Choisissez un appel à l’action natif LinkedIn.");
  if (!conversions || !keys(conversions, ["conversionUrns"]) || !Array.isArray(conversions.conversionUrns) || conversions.conversionUrns.length > 20
    || conversions.conversionUrns.some((urn) => typeof urn !== "string" || !/^urn:lla:llaPartnerConversion:\d{1,25}$/.test(urn))) return fail("Sélectionnez des conversions accessibles dans ce compte LinkedIn.");
  return { settings: {
    professionalTargeting: { include, exclude }, locationType: row.locationType,
    placements: { audienceNetwork: placements.audienceNetwork, audienceExpansion: placements.audienceExpansion },
    budget: { type: budget.type, totalEuros, startAt, endAt },
    bidding: { strategy: bidding.strategy as LinkedInDeliverySettings["bidding"]["strategy"], amountEuros },
    callToAction: row.callToAction as LinkedInCallToAction,
    conversions: { conversionUrns: [...new Set(conversions.conversionUrns as string[])] },
  }, error: null };
}

/** Exact versioned API mapping. CPC is a legacy strategy name; awareness needs CPM auto/cap. */
export function linkedInDeliveryBidding(objective: string, settings?: LinkedInDeliverySettings | null) {
  const strategy = settings?.bidding.strategy || "manual_cpc";
  if (!LINKEDIN_CAMPAIGN_OBJECTIVES.includes(objective as (typeof LINKEDIN_CAMPAIGN_OBJECTIVES)[number])) return null;
  if (strategy === "manual_cpc") {
    if (objective === "BRAND_AWARENESS" || objective === "VIDEO_VIEW") return null;
    return { costType: "CPC" as const, optimizationTargetType: objective === "ENGAGEMENT" || objective === "WEBSITE_CONVERSION" ? "ENHANCED_CONVERSION" as const : "NONE" as const, bidType: "CPC" as const };
  }
  if (strategy === "cost_cap" && objective === "WEBSITE_CONVERSION") return null;
  return { costType: "CPM" as const,
    optimizationTargetType: strategy === "cost_cap"
      ? objective === "BRAND_AWARENESS" ? "CAP_COST_AND_MAXIMIZE_IMPRESSIONS" as const : objective === "VIDEO_VIEW" ? "CAP_COST_AND_MAXIMIZE_VIDEO_VIEWS" as const : "CAP_COST_AND_MAXIMIZE_CLICKS" as const
      : objective === "BRAND_AWARENESS" ? "MAX_IMPRESSION" as const : objective === "WEBSITE_CONVERSION" ? "MAX_CONVERSION" as const : objective === "VIDEO_VIEW" ? "MAX_VIDEO_VIEW" as const : "MAX_CLICK" as const,
    bidType: "CPM" as const };
}

export type LinkedInTargetingCriteria = { include: { and: Array<{ or: Record<string, string[]> }> }; exclude?: { or: Record<string, string[]> } };
export function buildLinkedInDeliveryTargeting(geoUrns: readonly string[], language: string, country: string, settings?: LinkedInDeliverySettings | null): LinkedInTargetingCriteria {
  if (!geoUrns.length || geoUrns.length > 20 || geoUrns.some((urn) => !/^urn:li:geo:\d{1,25}$/.test(urn)) || !/^[a-z]{2}$/.test(language) || !/^[A-Z]{2}$/.test(country)) throw new TypeError("Invalid LinkedIn targeting");
  const criteria: LinkedInTargetingCriteria = { include: { and: [
    { or: { "urn:li:adTargetingFacet:interfaceLocales": [`urn:li:locale:${language}_${country}`] } },
    { or: { [`urn:li:adTargetingFacet:${settings?.locationType === "permanent" ? "profileLocations" : "locations"}`]: [...new Set(geoUrns)] } },
  ] } };
  const grouped = (targets: LinkedInProfessionalTarget[]) => {
    const groups: Record<string, string[]> = {};
    for (const target of targets) {
      const facet = `urn:li:adTargetingFacet:${LINKEDIN_PROFESSIONAL_API_FACETS[target.facet]}`;
      (groups[facet] ||= []).push(target.urn);
    }
    return groups;
  };
  for (const [facet, urns] of Object.entries(grouped(settings?.professionalTargeting.include || []))) criteria.include.and.push({ or: { [facet]: urns } });
  const exclusions = grouped(settings?.professionalTargeting.exclude || []);
  if (Object.keys(exclusions).length) criteria.exclude = { or: exclusions };
  return criteria;
}

/** Shared final link used by preflight and the provider post; preserves existing parameters and fragments. */
export function linkedInTrackedDestination(destination: string, trackingParameters: string): { url: string | null; error: string | null } {
  try {
    const url = new URL(destination);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if (url.protocol !== "https:" || url.username || url.password || !hostname || hostname === "localhost" || /\.(?:localhost|local|internal)$/.test(hostname) || /^(?:10|127|169\.254|192\.168)\./.test(hostname) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname) || hostname === "0.0.0.0" || /^\[(?:::1\]$|::\]$|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i.test(hostname)) throw new Error("destination");
    const tracking = String(trackingParameters || "").trim().replace(/^\?/, "");
    if (tracking && (tracking.includes("#") || /%(?![0-9a-f]{2})/i.test(tracking))) throw new Error("tracking");
    const parameters = new URLSearchParams(tracking);
    const seen = new Set<string>();
    for (const [key, value] of parameters) {
      if (!/^utm_(?:source|medium|campaign|term|content|id)$/.test(key) || !value.trim() || seen.has(key) || value.length > 250 || /[\u0000-\u001f]/.test(value)) throw new Error("tracking");
      seen.add(key); url.searchParams.set(key, value);
    }
    return { url: url.toString(), error: null };
  } catch { return { url: null, error: "Vérifiez l’URL et les paramètres UTM LinkedIn (source, medium, campaign, term, content ou id)." }; }
}
