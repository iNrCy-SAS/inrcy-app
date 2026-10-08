import { linkedInDeliveryBidding, normalizeLinkedInDeliverySettings } from "./adsLinkedInCampaignSettings.ts";
import { googleAdsTextLength, googleSearchNativeBidding, googleSearchKeyword, normalizeGoogleDeliverySettings } from "./adsGoogleCampaignSettings.ts";
import { googleAdsDateInAccount } from "./adsGoogleResources.ts";
import { normalizePinterestDeliverySettings, pinterestNativeDelivery } from "./adsPinterestCampaignSettings.ts";
import { metaNativeDelivery } from "./adsMetaCampaignSettings.ts";
import { openaiNativeDelivery } from "./adsOpenaiCampaignSettings.ts";
import type { AdsCampaignInput } from "@/lib/adsValidation";

export type AdsLaunchStepMap = {
  foundations: number;
  bidding?: number;
  geography?: number;
  targeting: number;
  keywords: number;
  creative: number;
  media: number | null;
  delivery: number;
  destinationConfirmation?: number;
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
  googleTimeZone?: string;
  openaiTimeZone?: string;
};

const remotelyLaunchableChannels = new Set(["google", "meta", "linkedin", "pinterest", "openai"]);
const linkedInGeoUrn = /^urn:li:geo:\d{1,25}$/;

function hasVerifiedLinkedInGeoTarget(draft: AdsCampaignInput) {
  return (draft.linkedinGeoTargets || []).some((target) => (
    linkedInGeoUrn.test(String(target.urn || "")) && String(target.name || "").trim().length > 0
  ));
}

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
  googleTimeZone = "UTC",
  openaiTimeZone = "UTC",
}: AdsLaunchReadinessInput): number[] {
  if (!remotelyLaunchableChannels.has(draft.provider)) return [];

  const incomplete = new Set<number>();
  const add = (step: number | null) => {
    if (step && step > 0) incomplete.add(step);
  };

  if (!accountReady || draft.name.trim().length < 3) add(steps.foundations);
  if (draft.conversionLocation === "website" && !destinationReady) add(steps.destinationConfirmation ?? steps.delivery);
  if (draft.provider === "google") {
    const settings = draft.googleDeliverySettings;
    let today = "";
    try { today = googleAdsDateInAccount(googleTimeZone, new Date(now)); } catch { /* The native preflight also checks the verified account timezone. */ }
    const startDate = settings?.startDate || today;
    const start = Date.parse(startDate + "T00:00:00Z");
    const end = Date.parse(draft.endDate + "T00:00:00Z");
    const total = settings?.budget.type === "total";
    const amount = total ? settings.budget.totalEuros : draft.dailyBudgetEuros;
    const days = (end - start) / 86_400_000 + 1;
    if (!today || !Number.isFinite(start) || !Number.isFinite(end) || startDate < today
      || days < (total ? 3 : 1) || days > 90 || (end - Date.parse(today + "T00:00:00Z")) / 86_400_000 > 90
      || (total && !settings?.startDate) || typeof amount !== "number" || !Number.isFinite(amount) || amount < 5 || amount > (total ? 45000 : 500)) add(steps.budget);
  } else if (!["pinterest", "meta", "openai"].includes(draft.provider) && !hasValidBudgetAndEndDate(draft, now)) add(steps.budget);

  if (draft.provider === "google") {
    if (!draft.targetLocations.length) add(steps.geography ?? steps.targeting);
    const parsedGoogle = normalizeGoogleDeliverySettings(draft.googleDeliverySettings);
    if (parsedGoogle.error) {
      add(/budget|enveloppe|date/i.test(parsedGoogle.error) ? steps.budget
        : /chemin/i.test(parsedGoogle.error) ? steps.creative
          : /géographique/i.test(parsedGoogle.error) ? steps.geography ?? steps.targeting
            : /correspondance|mots-clés/i.test(parsedGoogle.error) ? steps.keywords : steps.bidding ?? steps.foundations);
    }
    if (!googleSearchNativeBidding(draft.bidStrategy, parsedGoogle.settings)) add(steps.bidding ?? steps.foundations);
    try { for (const keyword of [...draft.keywords, ...draft.negativeKeywords]) googleSearchKeyword(keyword, "PHRASE"); } catch { add(steps.keywords); }
    if (!draft.keywords.length) add(steps.keywords);
    if (draft.headlines.filter((value) => value.trim()).length < 3
      || draft.descriptions.filter((value) => value.trim()).length < 2
      || draft.headlines.length > 15 || draft.descriptions.length > 4
      || draft.headlines.some((text) => googleAdsTextLength(text) > 30) || draft.descriptions.some((text) => googleAdsTextLength(text) > 90)) add(steps.creative);
    if (!draft.notEuPoliticalConfirmed) add(steps.validation);
  }

  if (draft.provider === "meta") {
    if (!draft.targetLocations.length || draft.metaDeliverySettings && !draft.metaGeoTargets?.length) add(steps.geography ?? steps.targeting);
    if (draft.primaryText.trim().length < 10 || !draft.callToAction.trim() || draft.metaDeliverySettings && (draft.headlines.length !== 1 || draft.descriptions.length > 1)) add(steps.creative);
    try { metaNativeDelivery(draft, now); }
    catch (error) { const message = error instanceof Error ? error.message : ""; add(/âge|audience|langue/i.test(message) ? steps.targeting : /appel|action/i.test(message) ? steps.creative : /enchère/i.test(message) ? steps.bidding ?? steps.budget : steps.budget); }
    if (!draft.metaPlacements.length) add(steps.delivery);
    if (!mediaReady) add(steps.media);
    if (!draft.noSpecialCategoryConfirmed) add(steps.validation);
  }

  if (draft.provider === "linkedin") {
    if (!draft.linkedinCampaignGroupId || !draft.linkedinOrganizationUrn) add(steps.foundations);
    if (!hasVerifiedLinkedInGeoTarget(draft)) add(steps.geography ?? steps.targeting);
    if (draft.primaryText.trim().length < 10 || (draft.headlines[0]?.trim().length || 0) < 3) add(steps.creative);
    if (!mediaReady) add(steps.media);
    const delivery = draft.linkedinDeliverySettings;
    const bid = Number(delivery?.bidding.amountEuros ?? draft.linkedinBidEuros);
    const amount = delivery?.budget.type === "total" ? Number(delivery.budget.totalEuros) : Number(draft.dailyBudgetEuros);
    if (draft.channelSettings?.channel === "linkedin"
      && (!/^[a-z]{2}$/.test(draft.channelSettings.locale.language)
        || !/^[A-Z]{2}$/.test(draft.channelSettings.locale.country))) add(steps.targeting);
    if (delivery && normalizeLinkedInDeliverySettings(delivery).error) {
      add(delivery.locationType !== "recent_or_permanent" && delivery.locationType !== "permanent"
        ? steps.geography ?? steps.targeting : steps.targeting);
    }
    if (delivery?.bidding.strategy !== "maximum_delivery" && (!Number.isFinite(bid) || bid <= 0 || bid > amount)) add(steps.budget);
    if (delivery?.budget.type === "total" && (!Number.isFinite(amount) || amount < 5)) add(steps.budget);
    const nativeStart = delivery?.budget.startAt ? Date.parse(delivery.budget.startAt) : now + 5 * 60_000;
    const nativeEnd = delivery?.budget.endAt ? Date.parse(delivery.budget.endAt) : Date.parse(`${draft.endDate}T23:59:59Z`);
    if (!Number.isFinite(nativeStart) || !Number.isFinite(nativeEnd) || nativeStart < now + 60_000 || nativeEnd <= nativeStart || nativeEnd > now + 90 * 86_400_000) add(steps.budget);
    const objective = !draft.channelSettings ? "WEBSITE_VISIT" : draft.channelSettings.channel === "linkedin" ? draft.channelSettings.objectiveType : "";
    if (!linkedInDeliveryBidding(objective, delivery)) add(steps.foundations);
    if (objective === "WEBSITE_CONVERSION" && !delivery?.conversions.conversionUrns.length) add(steps.delivery);
    if (!draft.linkedinPoliticalIntentConfirmed || !draft.linkedinTargetingNoticeAcknowledged) add(steps.validation);
  }

  if (draft.provider === "pinterest") {
    if (!draft.targetLocations.length) add(steps.geography ?? steps.targeting);
    if (!draft.languages.length) add(steps.targeting);
    if (draft.headlines.length !== 1 || !draft.headlines[0]?.trim() || draft.headlines[0].length > 100
      || !draft.primaryText.trim() || draft.primaryText.length > 800) add(steps.creative);
    if (!mediaReady) add(steps.media);
    const parsed = normalizePinterestDeliverySettings(draft.pinterestDeliverySettings);
    if (parsed.error) add(/placement/i.test(parsed.error) ? steps.targeting
      : /enchère|optimise/i.test(parsed.error) ? steps.bidding ?? steps.budget : steps.budget);
    else {
      try { pinterestNativeDelivery(draft, now); }
      catch (error) {
        const message = error instanceof Error ? error.message : "";
        add(/enchère|optimisation/i.test(message) ? steps.bidding ?? steps.budget
          : /Notoriété|Considération|conversion/i.test(message) ? steps.foundations : steps.budget);
      }
    }
  }

  if (draft.provider === "openai") {
    if (!draft.targetLocations.length) add(steps.geography ?? steps.targeting);
    const title = draft.headlines[0]?.trim() || "";
    const body = draft.primaryText.trim();
    if (draft.headlines.length !== 1 || title.length < 3 || title.length > 50
      || !body || body.length > 100) add(steps.creative);
    if (!mediaReady) add(steps.media);
    try { openaiNativeDelivery(draft, now, openaiTimeZone); }
    catch (error) { const message = error instanceof Error ? error.message : ""; add(/plateforme|suivi/i.test(message) ? steps.delivery : /enchère/i.test(message) ? steps.bidding ?? steps.budget : steps.budget); }
  }

  return [...incomplete].sort((left, right) => left - right);
}

export function adsIncompleteLaunchMessage(
  stepNumbers: readonly number[],
  provider?: AdsCampaignInput["provider"],
  targetingStep?: number,
) {
  if (!stepNumbers.length) return "";
  const label = stepNumbers.length === 1
    ? `l’étape ${stepNumbers[0]}`
    : `les étapes ${stepNumbers.slice(0, -1).join(", ")} et ${stepNumbers.at(-1)}`;
  const linkedInGeoDetail = provider === "linkedin"
    && typeof targetingStep === "number"
    && stepNumbers.includes(targetingStep)
    ? " Sélectionnez au moins une zone exacte vérifiée par LinkedIn ; le libellé affiché dans le brief ne suffit pas."
    : "";
  return `Informations manquantes : complétez ${label} avant de lancer la campagne.${linkedInGeoDetail}`;
}
