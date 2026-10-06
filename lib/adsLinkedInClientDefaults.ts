import type { AdsCampaignInput } from "./adsValidation.ts";
import type { LinkedInAdsBudgetPricing } from "./adsLinkedInPreflightPolicy.ts";

type AutomaticPreflightDraft = Pick<
  AdsCampaignInput,
  "targetLocations" | "linkedinGeoTargets" | "dailyBudgetEuros" | "channelSettings"
>;

function distinctSorted(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
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
