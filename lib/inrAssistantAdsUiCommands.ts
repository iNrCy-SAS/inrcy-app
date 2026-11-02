import type { AdsCampaignInput } from "./adsValidation.ts";
import { inrAssistantMaskQuotedText } from "./inrAssistantRequestClauses.ts";

export const INR_ASSISTANT_ADS_STEPS = ["foundations", "bidding", "geography", "targeting", "keywords", "creative", "pinterest_format", "identity", "media", "delivery", "budget", "validation", "analysis"] as const;
/** Only editable draft values. Provider identifiers, generated briefs, review flags
 * and spend consent are deliberately absent. Each nested change preserves its siblings. */
export const INR_ASSISTANT_ADS_FIELDS = [
  "offer", "dailyBudgetEuros", "endDate", "destinationUrl", "targetLocations", "targetAudiences", "languages",
  "trackingParameters", "headlines", "descriptions", "keywords", "negativeKeywords", "mediaBrief", "callToAction",
  "campaignType", "objective", "conversionGoal", "conversionLocation", "bidStrategy", "mediaStrategy",
  "urlExpansion", "urlExclusions", "googleSearchPartners", "googleDisplayExpansion", "metaAudienceExpansion", "metaPlacements",
  "pinterestBidEuros", "openaiBidEuros", "linkedinBidEuros",
  "channelSettings.objectiveType", "channelSettings.objective", "channelSettings.format", "channelSettings.targetingFacet",
  "channelSettings.locale.country", "channelSettings.locale.language", "channelSettings.targetingMode",
  "channelSettings.placementIntent", "channelSettings.optimizationIntent", "channelSettings.destinationKind",
  "channelSettings.intendedPromotionType", "channelSettings.creativeType", "channelSettings.conversionEvent",
  "metaDeliverySettings.budget.type", "metaDeliverySettings.budget.totalEuros", "metaDeliverySettings.budget.startAt", "metaDeliverySettings.budget.endAt",
  "metaDeliverySettings.bidding.strategy", "metaDeliverySettings.bidding.amountEuros", "metaDeliverySettings.callToAction",
  "metaDeliverySettings.audience.ageMin", "metaDeliverySettings.audience.ageMax",
  "preparedDeliverySettings.budget.type", "preparedDeliverySettings.budget.totalEuros", "preparedDeliverySettings.budget.startAt", "preparedDeliverySettings.budget.endAt",
  "preparedDeliverySettings.bidding.strategy", "preparedDeliverySettings.bidding.amountEuros",
  "pinterestDeliverySettings.budget.type", "pinterestDeliverySettings.budget.totalEuros", "pinterestDeliverySettings.budget.startAt", "pinterestDeliverySettings.budget.endAt",
  "pinterestDeliverySettings.budget.flexibleDaily", "pinterestDeliverySettings.bidding.strategy", "pinterestDeliverySettings.bidding.amountEuros", "pinterestDeliverySettings.placementGroup", "pinterestDeliverySettings.optimizationGoal",
  "linkedinDeliverySettings.budget.type", "linkedinDeliverySettings.budget.totalEuros", "linkedinDeliverySettings.budget.startAt", "linkedinDeliverySettings.budget.endAt",
  "linkedinDeliverySettings.bidding.strategy", "linkedinDeliverySettings.bidding.amountEuros", "linkedinDeliverySettings.callToAction",
  "linkedinDeliverySettings.placements.audienceExpansion", "linkedinDeliverySettings.placements.audienceNetwork", "linkedinDeliverySettings.locationType",
  "googleDeliverySettings.startDate", "googleDeliverySettings.budget.type", "googleDeliverySettings.budget.totalEuros", "googleDeliverySettings.bidding.manualCpcEuros", "googleDeliverySettings.bidding.cpcBidCeilingEuros", "googleDeliverySettings.bidding.targetCpaEuros", "googleDeliverySettings.bidding.targetRoas",
  "googleDeliverySettings.keywordMatchType", "googleDeliverySettings.negativeKeywordMatchType", "googleDeliverySettings.geoTargetType", "googleDeliverySettings.responsiveSearchAd.path1", "googleDeliverySettings.responsiveSearchAd.path2",
  "openaiDeliverySettings.budget.type", "openaiDeliverySettings.budget.totalEuros", "openaiDeliverySettings.budget.startAt", "openaiDeliverySettings.budget.endAt", "openaiDeliverySettings.platforms",
] as const;
export type InrAssistantAdsField = typeof INR_ASSISTANT_ADS_FIELDS[number];
export type InrAssistantAdsChange = { field: InrAssistantAdsField; valueJson: string };
export type InrAssistantAdsPatch = {
  name?: string; primaryText?: string; step?: typeof INR_ASSISTANT_ADS_STEPS[number];
  adsChanges?: InrAssistantAdsChange[];
  channel?: AdsCampaignInput["provider"];
  mediaId?: string; metaSlot?: "feed" | "story_reel";
};
export type InrAssistantAdsSaveCommand = { command: "save_ads_draft"; selection: { kind: "campaign"; id: string }; revision: string };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const channels = ["meta", "google", "linkedin", "tiktok", "pinterest", "x", "openai"];

export function parseInrAssistantAdsPatch(value: unknown): InrAssistantAdsPatch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (JSON.stringify(value).length > 16_000) return null;
  const entries = Object.entries(value).filter(([, item]) => item !== null && item !== undefined);
  if (!entries.length || entries.some(([key]) => !["name", "primaryText", "step", "adsChanges", "channel", "mediaId", "metaSlot"].includes(key))) return null;
  const patch = Object.fromEntries(entries) as InrAssistantAdsPatch;
  if (patch.name !== undefined && (typeof patch.name !== "string" || !patch.name.trim() || patch.name.length > 100)
    || patch.primaryText !== undefined && (typeof patch.primaryText !== "string" || patch.primaryText.length > 800)
    || patch.step !== undefined && !INR_ASSISTANT_ADS_STEPS.includes(patch.step)
    || patch.channel !== undefined && (!channels.includes(patch.channel) || entries.length !== 1)
    || patch.mediaId !== undefined && (typeof patch.mediaId !== "string" || !UUID.test(patch.mediaId) || entries.some(([key]) => key !== "mediaId" && key !== "metaSlot"))
    || patch.metaSlot !== undefined && (!patch.mediaId || !["feed", "story_reel"].includes(patch.metaSlot))) return null;
  if (patch.adsChanges !== undefined) {
    if (!Array.isArray(patch.adsChanges) || !patch.adsChanges.length || patch.adsChanges.length > 40 || new Set(patch.adsChanges.map(item => item?.field)).size !== patch.adsChanges.length) return null;
    for (const change of patch.adsChanges) {
      if (!change || typeof change !== "object" || Object.keys(change).sort().join(",") !== "field,valueJson" || !INR_ASSISTANT_ADS_FIELDS.includes(change.field) || typeof change.valueJson !== "string" || change.valueJson.length > 4000) return null;
      try {
        const parsed: unknown = JSON.parse(change.valueJson);
        if (parsed !== null && !["string", "number", "boolean"].includes(typeof parsed) && (!Array.isArray(parsed) || parsed.length > 40 || parsed.some(item => typeof item !== "string" || item.length > 300))) return null;
      } catch { return null; }
    }
    // Native strategy transitions have their own normalization and reset rules.
    const strategy = patch.adsChanges.some(item => item.field.startsWith("channelSettings."));
    if (strategy && (entries.length !== 1 || patch.adsChanges.some(item => !item.field.startsWith("channelSettings.")))) return null;
  }
  return patch;
}

export function isInrAssistantAdsSaveRequest(text: string): boolean {
  return !/\b(?:comment|pourquoi|explique|si|quand|lorsque|apres|avant|demain|plus tard|how|why|if|when|unless|until|after|before|tomorrow|later)\b|\blorsqu'|\b(?:a condition|sous reserve|une fois)\b|\b(?:ne |n'|sans |do not |don't ).{0,35}(?:sauvegard|enregistr|save)|\b(?:sauvegarde\w*|enregistre\w*)\s+pas\b/.test(text)
    && /\b(?:enregistre\w*|sauvegarde\w*|save)\b/.test(text) && /\b(?:campagne|publicitaire|publicite|ads|annonce)\b/.test(text);
}

export function isInrAssistantAdsEditRequest(text: string): boolean {
  if (/\b(?:comment|pourquoi|explique|si|quand|lorsque|apres|avant|demain|plus tard|how|why|if|when|unless|until|after|before|tomorrow|later)\b|\blorsqu'|\b(?:a condition|sous reserve|une fois)\b/.test(text)) return false;
  if (/\b(?:ne |n'|sans |do not |don't ).{0,40}(?:modifi|chang|regl|appli|rempl|config|pass|met|renomm|ajout|joins|chois|selection|utilis)|\b(?:modifie\w*|change\w*|ajoute\w*|choisis|selectionne\w*|utilise\w*)\s+pas\b/.test(text)) return false;
  return /\b(?:modifi\w*|chang\w*|regl\w*|appli\w*|rempl\w*|configur\w*|passe\w*|mets|mettre|renomm\w*|ajoute\w*|joins|choisis|selectionne\w*|utilise\w*|set|change|edit|apply|fill)\b/.test(text)
    && /\b(?:pub|publicite|publicitaire|campagne|annonce|ads|advert|brouillon)\b/.test(text);
}

/** A name or copy may be quoted data; command authorization is checked separately. */
export function inrAssistantAdsFieldsRequested(message: string, patch: InrAssistantAdsPatch): boolean {
  const text = inrAssistantMaskQuotedText(message).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (patch.channel && !new RegExp(`\\b${patch.channel === "meta" ? "(?:meta|facebook|instagram)" : patch.channel === "openai" ? "(?:chatgpt|openai)" : patch.channel}\\b`).test(text)) return false;
  if (patch.mediaId && !/\b(?:media|image|video|visuel|photo)\b/.test(text)) return false;
  return (patch.adsChanges ?? []).every(({ field, valueJson }) => {
    const value: unknown = JSON.parse(valueJson);
    if (typeof value === "number" && /Euros|Roas/.test(field) && !new RegExp(`(?:^|[^0-9])${String(value).replace(".", "[.,]")}(?:$|[^0-9])`).test(text)) return false;
    const subject = /[Bb]udget|Euros|[Bb]idding|Roas|Cpc|Cpa/.test(field) ? /budget|euros?|€|enchere|cpc|cpa|roas/
      : /Date|startAt|endAt/.test(field) ? /date|debut|fin|commence|termine|calendrier|programme|\d{4}-\d{2}-\d{2}/
      : /Locations|Audiences|audience|targeting|ageM/.test(field) ? /cibl|zone|local|ville|pays|audience|age|ans/
      : /language|locale/.test(field) ? /langue|francais|anglais|pays|locale/
      : /keyword|Keyword/.test(field) ? /mots?.cles?|recherche|exclu|signaux/
      : /Url|tracking|displayPath/.test(field) ? /lien|url|site|destination|suivi|utm|chemin/
      : /headline|description|primaryText|offer|mediaBrief|callToAction/.test(field) ? /titre|texte|description|offre|service|media|action|bouton|contenu/
      : /objectif|format|type|conversion|diffusion|placement|plateforme|strategie|reseau|partenaire/;
    return subject.test(text);
  });
}
