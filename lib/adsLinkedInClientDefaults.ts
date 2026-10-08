import type { AdsCampaignInput } from "./adsValidation.ts";
import type { LinkedInAdsBudgetPricing } from "./adsLinkedInPreflightPolicy.ts";
import { linkedInAdsGeoNameMatchesQuery, normalizedLinkedInGeoLabel } from "./adsLinkedInPreflightPolicy.ts";

type AutomaticPreflightDraft = Pick<
  AdsCampaignInput,
  "targetLocations" | "linkedinGeoTargets" | "dailyBudgetEuros" | "channelSettings" | "linkedinDeliverySettings"
> & Partial<Pick<AdsCampaignInput, "linkedinCampaignGroupId" | "linkedinOrganizationUrn" | "endDate">>;

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

/** Every choice affecting resource compatibility, geo resolution or pricing belongs in this key. */
export function linkedInAdsAutomaticPreflightKey(accountId: string, draft: AutomaticPreflightDraft): string {
  const locale = draft.channelSettings?.channel === "linkedin"
    ? `${draft.channelSettings.locale.language}_${draft.channelSettings.locale.country}` : "fr_FR";
  return JSON.stringify([
    accountId,
    distinctSorted(draft.targetLocations),
    distinctSorted((draft.linkedinGeoTargets || []).map((target) => target.urn)),
    draft.dailyBudgetEuros,
    locale,
    draft.channelSettings?.channel === "linkedin" ? [draft.channelSettings.objectiveType, draft.channelSettings.format] : null,
    draft.linkedinDeliverySettings || null,
    draft.linkedinCampaignGroupId || "",
    draft.linkedinOrganizationUrn || "",
    draft.endDate || "",
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

/** Every input sent by the final preflight, including defaults it may fill. */
export function linkedInAdsLaunchPreflightKey(draft: AdsCampaignInput): string {
  return JSON.stringify([
    linkedInAdsAutomaticPreflightKey(draft.adAccountId, draft),
    draft.linkedinCampaignGroupId,
    draft.linkedinOrganizationUrn,
    draft.linkedinBidEuros,
    draft.linkedinPoliticalIntentConfirmed === true,
    draft.linkedinTargetingNoticeAcknowledged === true,
  ]);
}

/** The provider image is uploaded after confirmation, then checked by the publisher. */
export function linkedInAdsLaunchBlockers(
  blockers: readonly string[] | undefined,
  targetStatus: "ACTIVE" | "PAUSED",
): string[] {
  if (!blockers) return ["preflight_required"];
  return [...new Set(blockers.filter((blocker) => blocker !== "available_image_required"
    && !(targetStatus === "PAUSED" && (blocker === "account_not_serving" || blocker === "campaign_group_not_active"))))];
}

export function linkedInAdsLaunchBlockerMessage(blockers: readonly string[]): string {
  const messages: Record<string, string> = {
    account_manage_access_unverified: "LinkedIn n’a pas confirmé les droits de gestion de ce compte.",
    account_not_serving: "Ce compte LinkedIn ne peut pas diffuser actuellement. La création en pause reste possible.",
    unsupported_account_currency: "Le compte LinkedIn doit utiliser l’euro.",
    campaign_group_required: "Sélectionnez un groupe de campagnes LinkedIn vérifié à l’étape Campagne.",
    campaign_group_not_active: "Le groupe LinkedIn n’est pas actif. La création en pause reste possible.",
    campaign_group_objective_mismatch: "Le groupe LinkedIn ne permet pas l’objectif sélectionné.",
    campaign_group_format_unsupported: "Le groupe LinkedIn ne permet pas ce format sponsorisé.",
    organization_required: "Sélectionnez une Page LinkedIn autorisée à l’étape Campagne.",
    image_owner_mismatch: "L’image LinkedIn n’appartient pas à la Page sélectionnée.",
    unsupported_locale: "LinkedIn ne prend pas en charge la langue et le pays sélectionnés.",
    verified_geo_required: "LinkedIn n’a confirmé aucune zone de ciblage.",
    selected_geo_unverified: "LinkedIn n’a pas confirmé toutes les zones sélectionnées. Relancez leur vérification à l’étape Zones géographiques.",
    unresolved_geo_queries: "Une zone du brief attend encore une correspondance LinkedIn exacte à l’étape Zones géographiques.",
    geo_query_provider_rejected: "LinkedIn a refusé la vérification d’une zone du brief. Réessayez à l’étape Zones géographiques.",
    too_many_geo_targets: "LinkedIn accepte au maximum 20 zones exactes.",
    audience_count_required: "LinkedIn n’a pas pu confirmer la taille de l’audience. Réessayez sa vérification.",
    audience_too_small: "L’audience LinkedIn doit compter au moins 300 membres. Élargissez les zones ciblées.",
    budget_pricing_required: "LinkedIn n’a pas confirmé les bornes d’enchère pour ces zones. Réessayez à l’étape Budget et calendrier.",
    bid_out_of_range: "L’enchère ne respecte plus la plage vérifiée par LinkedIn. Réessayez à l’étape Budget et calendrier.",
    selected_professional_targets_unverified: "LinkedIn n’a pas confirmé tous les critères professionnels. Vérifiez l’étape Audience.",
    selected_conversion_unverified: "LinkedIn n’a pas confirmé les conversions sélectionnées dans ce compte.",
    conversion_required: "Sélectionnez au moins une conversion LinkedIn active pour cet objectif.",
    campaign_schedule_invalid: "Les dates et heures ne sont pas compatibles avec le groupe LinkedIn ou le budget choisi.",
    unsupported_delivery_settings: "Les options de diffusion LinkedIn sont invalides ou incompatibles avec cet objectif.",
    total_budget_too_low: "Le budget total est inférieur au minimum demandé par LinkedIn.",
    daily_budget_too_low: "Le budget quotidien est inférieur au minimum demandé par LinkedIn.",
    political_intent_confirmation_required: "Confirmez la déclaration NOT_POLITICAL avant le lancement.",
    targeting_notice_acknowledgement_required: "Confirmez l’avis de ciblage non discriminatoire avant le lancement.",
    development_account_mapping_required: "La publication LinkedIn n’est pas encore autorisée pour ce compte annonceur.",
  };
  return [...new Set(blockers.map((blocker) => blocker.startsWith("missing_scope:")
    ? "Une autorisation LinkedIn manque. Reconnectez le compte pour actualiser ses droits."
    : messages[blocker] || "La vérification LinkedIn n’est pas complète. Réessayez avant de lancer la campagne."))].join(" ");
}
