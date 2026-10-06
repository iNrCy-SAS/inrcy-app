import type { AdsCampaignInput } from "./adsValidation.ts";
import type { LinkedInAdsBudgetPricing } from "./adsLinkedInPreflightPolicy.ts";
import { linkedInAdsGeoNameMatchesQuery, normalizedLinkedInGeoLabel } from "./adsLinkedInPreflightPolicy.ts";

type AutomaticPreflightDraft = Pick<
  AdsCampaignInput,
  "targetLocations" | "linkedinGeoTargets" | "dailyBudgetEuros" | "channelSettings"
>;

function distinctSorted(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

type LinkedInGeoOption = { urn: string; name: string };
type LinkedInGeoResolution = {
  query: string;
  suggestions: readonly LinkedInGeoOption[];
  status?: "ok" | "provider_rejected";
};

function geoAreaKey(name: string): string | null {
  const parts = name.split(",").map(normalizedLinkedInGeoLabel);
  if (parts.length < 3 || !parts.at(-2) || !parts.at(-1)) return null;
  return `${parts.at(-2)}|${parts.at(-1)}`;
}

/**
 * LinkedIn's own verified choices establish the region and country. Only then
 * may an exact city suggestion from LinkedIn be proposed for that same area.
 * The newly proposed URN still needs the next provider preflight to verify it.
 */
export function linkedInAdsContextualGeoDefaults(input: {
  targetLocations: readonly string[];
  verifiedGeoTargets: readonly LinkedInGeoOption[];
  geoResolutions: readonly LinkedInGeoResolution[];
}): LinkedInGeoOption[] {
  const { targetLocations, verifiedGeoTargets, geoResolutions } = input;
  const providerTargets = new Map(verifiedGeoTargets.map((target) => [target.urn, target]));
  const areaKeys = verifiedGeoTargets.map((target) => geoAreaKey(target.name)).filter((area): area is string => Boolean(area));
  const contextArea = areaKeys.length >= 2 && new Set(areaKeys).size === 1 ? areaKeys[0] : null;
  if (!contextArea) return [...providerTargets.values()];

  const briefKeys = new Set(targetLocations.map(normalizedLinkedInGeoLabel));
  for (const resolution of geoResolutions) {
    const query = normalizedLinkedInGeoLabel(resolution.query);
    if (!query || !briefKeys.has(query) || resolution.status === "provider_rejected") continue;
    const matches = resolution.suggestions.filter((target) => {
      return /^urn:li:geo:\d{1,25}$/.test(target.urn)
        && linkedInAdsGeoNameMatchesQuery(target.name, resolution.query)
        && geoAreaKey(target.name) === contextArea;
    });
    if (matches.length === 1) providerTargets.set(matches[0].urn, matches[0]);
  }
  return [...providerTargets.values()];
}

/** Only inputs affecting geo resolution or pricing belong in this key. */
export function linkedInAdsAutomaticPreflightKey(accountId: string, draft: AutomaticPreflightDraft): string {
  const locale = draft.channelSettings?.channel === "linkedin"
    ? `${draft.channelSettings.locale.language}_${draft.channelSettings.locale.country}` : "fr_FR";
  return JSON.stringify([
    accountId,
    distinctSorted(draft.targetLocations),
    distinctSorted((draft.linkedinGeoTargets || []).map((target) => target.urn)),
    draft.dailyBudgetEuros,
    locale,
  ]);
}

function centSafe(value: number): boolean {
  return Number.isFinite(value) && Math.abs(Math.round(value * 100) - value * 100) <= 0.000001;
}

/** Apply only a provider-suggested CPC that fits its verified bounds and this budget. */
export function linkedInAdsVerifiedBidDefault(input: {
  currentBid: number | null | undefined;
  suggestedBid: number | null;
  pricing: LinkedInAdsBudgetPricing | null;
  dailyBudget: number;
}): number | null {
  const { currentBid, suggestedBid, pricing, dailyBudget } = input;
  if (!pricing || pricing.currency !== "EUR" || !Number.isFinite(dailyBudget)
    || !Number.isFinite(pricing.dailyBudgetMin) || pricing.dailyBudgetMin < 0
    || dailyBudget <= 0 || dailyBudget < pricing.dailyBudgetMin
    || !Number.isFinite(pricing.bidMin) || !Number.isFinite(pricing.bidMax)
    || pricing.bidMin < 0 || pricing.bidMin > pricing.bidMax) return null;
  const maximumBid = Math.min(pricing.bidMax, dailyBudget);
  const validBid = (bid: number | null | undefined): bid is number => typeof bid === "number"
    && centSafe(bid) && bid > 0 && bid >= pricing.bidMin && bid <= maximumBid;
  if (!validBid(suggestedBid) || validBid(currentBid)) return null;
  return suggestedBid;
}
