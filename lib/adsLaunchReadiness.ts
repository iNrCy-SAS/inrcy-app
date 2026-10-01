import type { AdsCampaignInput } from "@/lib/adsValidation";

export type AdsLaunchStepMap = {
  foundations: number;
  targeting: number;
  keywords: number;
  creative: number;
  media: number | null;
  delivery: number;
  budget: number;
  validation: number;
};

type AdsLaunchReadinessInput = {
  draft: AdsCampaignInput;
  steps: AdsLaunchStepMap;
  accountReady: boolean;
  destinationReady: boolean;
  mediaReady: boolean;
  now?: number;
};

const remotelyLaunchableChannels = new Set(["google", "meta", "linkedin", "pinterest"]);

function hasValidBudgetAndEndDate(draft: AdsCampaignInput, now: number) {
  const budget = Number(draft.dailyBudgetEuros);
  const endTime = Date.parse(`${draft.endDate}T23:59:59Z`);
  const daysUntilEnd = (endTime - now) / 86_400_000;
  return Number.isFinite(budget)
    && budget >= 5
    && budget <= 500
    && /^\d{4}-\d{2}-\d{2}$/.test(draft.endDate)
    && Number.isFinite(endTime)
    && daysUntilEnd >= 1
    && daysUntilEnd <= 90;
}

/**
 * Returns the numbered wizard steps that still miss information required by
 * the live publisher. It deliberately does not control wizard navigation or
 * draft saving: incomplete campaigns must remain editable and saveable.
 */
export function adsIncompleteLaunchSteps({
  draft,
  steps,
  accountReady,
  destinationReady,
  mediaReady,
  now = Date.now(),
}: AdsLaunchReadinessInput): number[] {
  if (!remotelyLaunchableChannels.has(draft.provider)) return [];

  const incomplete = new Set<number>();
  const add = (step: number | null) => {
    if (step && step > 0) incomplete.add(step);
  };

  if (!accountReady || draft.name.trim().length < 3) add(steps.foundations);
  if (draft.conversionLocation === "website" && !destinationReady) add(steps.delivery);
  if (!hasValidBudgetAndEndDate(draft, now)) add(steps.budget);

  if (draft.provider === "google") {
    if (!draft.targetLocations.length) add(steps.targeting);
    if (!draft.keywords.length) add(steps.keywords);
    if (draft.headlines.filter((value) => value.trim()).length < 3
      || draft.descriptions.filter((value) => value.trim()).length < 2) add(steps.creative);
    if (!draft.notEuPoliticalConfirmed) add(steps.validation);
  }

  if (draft.provider === "meta") {
    if (!draft.targetLocations.length) add(steps.targeting);
    if (draft.primaryText.trim().length < 10 || !draft.callToAction.trim()) add(steps.creative);
    if (!draft.metaPlacements.length) add(steps.delivery);
    if (!mediaReady) add(steps.media);
    if (!draft.noSpecialCategoryConfirmed) add(steps.validation);
  }

  if (draft.provider === "linkedin") {
    if (!draft.linkedinCampaignGroupId || !draft.linkedinOrganizationUrn) add(steps.foundations);
    if (!draft.linkedinGeoTargets?.length) add(steps.targeting);
    if (!draft.primaryText.trim() || !draft.headlines[0]?.trim()) add(steps.creative);
    if (!mediaReady) add(steps.media);
    const bid = Number(draft.linkedinBidEuros);
    if (!Number.isFinite(bid) || bid <= 0 || bid > Number(draft.dailyBudgetEuros)) add(steps.budget);
    if (!draft.linkedinPoliticalIntentConfirmed || !draft.linkedinTargetingNoticeAcknowledged) add(steps.validation);
  }

  if (draft.provider === "pinterest") {
    if (!draft.targetLocations.length) add(steps.targeting);
    if (!draft.headlines[0]?.trim() || !draft.primaryText.trim()) add(steps.creative);
    if (!mediaReady) add(steps.media);
    const bid = Number(draft.pinterestBidEuros);
    if (!Number.isFinite(bid) || bid < 0.01 || bid > Number(draft.dailyBudgetEuros)) add(steps.budget);
  }

  return [...incomplete].sort((left, right) => left - right);
}

export function adsIncompleteLaunchMessage(stepNumbers: readonly number[]) {
  if (!stepNumbers.length) return "";
  const label = stepNumbers.length === 1
    ? `l’étape ${stepNumbers[0]}`
    : `les étapes ${stepNumbers.slice(0, -1).join(", ")} et ${stepNumbers.at(-1)}`;
  return `Informations manquantes : complétez ${label} avant de lancer la campagne.`;
}
