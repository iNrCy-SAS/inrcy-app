import { ADS_CAMPAIGN_TYPES, ADS_CAMPAIGN_OBJECTIVES, ADS_CONVERSION_GOALS, ADS_CONVERSION_LOCATIONS, ADS_BID_STRATEGIES, ADS_MEDIA_STRATEGIES, parseAdsCampaignInput, type AdsCampaignInput } from "./adsValidation.ts";
import { defaultGoogleDeliverySettings } from "./adsGoogleCampaignSettings.ts";
import { defaultLinkedInDeliverySettings } from "./adsLinkedInCampaignSettings.ts";
import { defaultMetaDeliverySettings, META_CALL_TO_ACTION_LABELS } from "./adsMetaCampaignSettings.ts";
import { defaultPinterestDeliverySettings } from "./adsPinterestCampaignSettings.ts";
import { defaultOpenaiDeliverySettings } from "./adsOpenaiCampaignSettings.ts";
import { defaultPreparedDeliverySettings } from "./adsPreparedCampaignSettings.ts";
import type { InrAssistantAdsPatch } from "./inrAssistantAdsUiCommands.ts";

type Row = Record<string, unknown>;
const record = (value: unknown): Row => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const enums: Record<string, readonly string[]> = { campaignType: ADS_CAMPAIGN_TYPES, objective: ADS_CAMPAIGN_OBJECTIVES, conversionGoal: ADS_CONVERSION_GOALS, conversionLocation: ADS_CONVERSION_LOCATIONS, bidStrategy: ADS_BID_STRATEGIES, mediaStrategy: ADS_MEDIA_STRATEGIES };
const settingsProviders: Record<string, string[]> = { googleDeliverySettings: ["google"], linkedinDeliverySettings: ["linkedin"], metaDeliverySettings: ["meta"], pinterestDeliverySettings: ["pinterest"], openaiDeliverySettings: ["openai"], preparedDeliverySettings: ["x", "tiktok"], channelSettings: ["linkedin", "pinterest", "x", "tiktok"] };
export const inrAssistantAdsFieldValue = (draft: unknown, path: string): unknown => path.split(".").reduce<unknown>((value, key) => record(value)[key], draft);

/** Adapt a bounded list of edits to the existing native draft validator. No
 * provider resources or consent fields can be introduced by this adapter. */
export function prepareInrAssistantAdsFormPatch(current: AdsCampaignInput, input: InrAssistantAdsPatch): { patch: Partial<AdsCampaignInput>; error: null } | { patch: null; error: string } {
  const candidate = structuredClone(current) as AdsCampaignInput & Row;
  const touched = new Set<string>();
  if (input.name !== undefined) { candidate.name = input.name; touched.add("name"); }
  if (input.primaryText !== undefined) {
    const limit = current.provider === "linkedin" ? 300 : ["openai", "tiktok"].includes(current.provider) ? 100 : current.provider === "pinterest" ? 800 : current.provider === "x" ? 280 : 500;
    if (current.provider === "google" || input.primaryText.length > limit) return { patch: null, error: "Le texte dépasse les limites du formulaire de ce canal." };
    candidate.primaryText = input.primaryText; touched.add("primaryText");
  }
  const defaults: Row = { googleDeliverySettings: defaultGoogleDeliverySettings(), linkedinDeliverySettings: defaultLinkedInDeliverySettings(), metaDeliverySettings: defaultMetaDeliverySettings(), pinterestDeliverySettings: defaultPinterestDeliverySettings(current.channelSettings?.channel === "pinterest" ? current.channelSettings.objectiveType : undefined), openaiDeliverySettings: defaultOpenaiDeliverySettings(), preparedDeliverySettings: defaultPreparedDeliverySettings() };
  for (const change of input.adsChanges ?? []) {
    const keys = change.field.split("."), field = keys[0], value: unknown = JSON.parse(change.valueJson);
    if (settingsProviders[field] && !settingsProviders[field].includes(current.provider)) return { patch: null, error: "Ce réglage appartient à un autre canal publicitaire." };
    if (enums[field] && (typeof value !== "string" || !enums[field].includes(value))) return { patch: null, error: "Cette option n’existe pas dans le formulaire publicitaire." };
    if (field === "mediaStrategy" && current.channelSettings || ["objective", "conversionGoal", "conversionLocation"].includes(field) && current.channelSettings) return { patch: null, error: "Utilisez les réglages natifs de l’objectif et du format de ce canal." };
    if (keys.length === 1) {
      const original = candidate[field];
      if (Array.isArray(original) ? !Array.isArray(value) : typeof original === "number" ? typeof value !== "number" : typeof original === "boolean" ? typeof value !== "boolean" : typeof original === "string" ? typeof value !== "string" : /BidEuros$/.test(field) ? typeof value !== "number" : false) return { patch: null, error: "Le type de ce réglage ne correspond pas au formulaire." };
      candidate[field] = value;
    }
    else {
      candidate[field] ??= structuredClone(defaults[field]);
      let target = record(candidate[field]);
      for (const key of keys.slice(1, -1)) {
        if (!Object.hasOwn(target, key)) return { patch: null, error: "Ce réglage n’existe pas dans le formulaire courant." };
        target = record(target[key]);
      }
      if (!Object.hasOwn(target, keys.at(-1)!)) return { patch: null, error: "Ce réglage n’existe pas dans le formulaire courant." };
      target[keys.at(-1)!] = value;
    }
    touched.add(field);
  }
  const deliveryField = current.provider === "meta" ? "metaDeliverySettings" : current.provider === "google" ? "googleDeliverySettings" : current.provider === "linkedin" ? "linkedinDeliverySettings" : current.provider === "pinterest" ? "pinterestDeliverySettings" : current.provider === "openai" ? "openaiDeliverySettings" : "preparedDeliverySettings";
  const delivery = record(candidate[deliveryField] ?? defaults[deliveryField]);
  const budget = record(delivery.budget);
  const changed = new Set<string>(input.adsChanges?.map(item => item.field));
  // A legacy value may be hidden by a native delivery control. Do not acknowledge
  // a changed number/date that leaves the actual campaign setting untouched.
  if (touched.has("dailyBudgetEuros") && budget.type === "total"
    || changed.has(`${deliveryField}.budget.totalEuros`) && budget.totalEuros !== null && budget.type !== "total") return { patch: null, error: "Modifiez le montant correspondant au type de budget affiché, ou changez explicitement ce type dans la même demande." };
  if (touched.has("endDate") && budget.endAt) return { patch: null, error: "Une date et heure de fin précise est déjà définie. Modifiez ce réglage du calendrier natif." };
  if (touched.has("callToAction") && ["meta", "linkedin"].includes(current.provider)) return { patch: null, error: "Choisissez le bouton dans les réglages natifs de ce canal." };
  if ((touched.has("pinterestBidEuros") || touched.has("linkedinBidEuros")) && record(delivery.bidding).amountEuros != null) return { patch: null, error: "Modifiez le montant d’enchère dans les réglages natifs de ce canal." };
  if (changed.has("metaDeliverySettings.callToAction")) {
    candidate.callToAction = META_CALL_TO_ACTION_LABELS[record(candidate.metaDeliverySettings).callToAction as keyof typeof META_CALL_TO_ACTION_LABELS];
    touched.add("callToAction");
  }
  // The native edit owner invalidates a stale generated brief after the patch.
  const checked = parseAdsCampaignInput({ ...candidate, channelDraft: undefined }, { purpose: "draft" });
  if (!checked.draft) return { patch: null, error: checked.error || "Vérifiez les réglages du brouillon." };
  const patch: Row = {};
  for (const field of touched) patch[field] = record(checked.draft)[field];
  if (touched.has("targetLocations") && JSON.stringify(current.targetLocations) !== JSON.stringify(checked.draft.targetLocations)) {
    // The native location selectors will resolve the new labels. Never retain
    // provider IDs for the old brief while those asynchronous reads are pending.
    if (current.provider === "meta") patch.metaGeoTargets = [];
    if (current.provider === "linkedin") patch.linkedinGeoTargets = [];
  }
  return { patch: patch as Partial<AdsCampaignInput>, error: null };
}

export function inrAssistantAdsPatchIsApplied(draft: AdsCampaignInput, input: InrAssistantAdsPatch): boolean {
  const prepared = prepareInrAssistantAdsFormPatch(draft, input);
  return !!prepared.patch && Object.entries(prepared.patch).every(([field, value]) => JSON.stringify(record(draft)[field]) === JSON.stringify(value));
}
