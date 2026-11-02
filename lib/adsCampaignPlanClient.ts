import type { AdsCampaignInput, AdsChannelId } from "./adsValidation.ts";
import type { AdsCampaignPlan } from "./adsCampaignPlan.ts";
import type { AdsChannelDraft } from "./adsChannelDrafts.ts";
import { adsChannelWizardSettingsFromBrief, type AdsChannelWizardSettings } from "./adsChannelWizardSettings.ts";
import { defaultPreparedDeliverySettings } from "./adsPreparedCampaignSettings.ts";
import { preparedXCopyWithDestination } from "./adsPreparedNativeClient.ts";
import { defaultMetaDeliverySettings, META_CALL_TO_ACTION_LABELS } from "./adsMetaCampaignSettings.ts";
import { defaultOpenaiDeliverySettings } from "./adsOpenaiCampaignSettings.ts";
import { defaultPinterestDeliverySettings } from "./adsPinterestCampaignSettings.ts";
import { defaultGoogleDeliverySettings } from "./adsGoogleCampaignSettings.ts";
import { defaultLinkedInDeliverySettings } from "./adsLinkedInCampaignSettings.ts";
import { linkedInCallToActionFromLabel } from "./adsLinkedInAudienceSuggestions.ts";
import { prepareLinkedInPlanForGroup } from "./adsLinkedInCalendarReadiness.ts";
import type { LinkedInAdsCampaignGroup } from "./adsLinkedInPreflightPolicy.ts";
export function nativeBriefCopy(brief: AdsChannelDraft) {
  switch (brief.channel) {
    case "linkedin":
      return { message: brief.creative.introText, headline: brief.creative.headline, media: brief.creative.mediaBrief, destination: brief.creative.destinationUrl };
    case "tiktok":
      return { message: brief.creative.adText, headline: brief.creative.adText, media: brief.creative.videoBrief, destination: brief.creative.destinationUrl };
    case "pinterest":
      return { message: brief.creative.pinDescription, headline: brief.creative.pinTitle, media: brief.creative.visualBrief, destination: brief.creative.destinationUrl };
    case "x":
      return { message: brief.creative.postText, headline: brief.creative.postText, media: brief.creative.mediaBrief, destination: brief.creative.destinationUrl };
  }
}
export function nativeWizardObjective(settings: AdsChannelWizardSettings): string {
  return settings.channel === "x" ? settings.objective : settings.objectiveType;
}
export function nativeWizardGenericObjective(settings: AdsChannelWizardSettings): AdsCampaignInput["objective"] {
  const objective = nativeWizardObjective(settings);
  if (["BRAND_AWARENESS", "REACH", "AWARENESS", "reach"].includes(objective))
    return "awareness";
  if (["LEAD_GENERATION", "LEADS"].includes(objective))
    return "leads";
  if (["WEBSITE_CONVERSION", "WEB_CONVERSIONS", "SALES", "website_conversions"].includes(objective))
    return "sales";
  if (["ENGAGEMENT", "VIDEO_VIEW", "VIDEO_VIEWS", "VIDEO_COMPLETION", "engagement", "video_views"].includes(objective))
    return "engagement";
  return "website_traffic";
}
export function nativeWizardMediaStrategy(settings: AdsChannelWizardSettings): AdsCampaignInput["mediaStrategy"] {
  if (settings.channel === "tiktok")
    return "video";
  if (settings.channel === "pinterest") {
    if (settings.intendedPromotionType === "CATALOG")
      return "product_feed";
    return settings.creativeType === "VIDEO" || settings.creativeType === "MAX_VIDEO" ? "video" : "image";
  }
  if (settings.channel === "x" && settings.format === "text")
    return "search_text";
  return settings.format === "video" || settings.format === "SINGLE_VIDEO" ? "video" : "image";
}
/** Projects the proposal into a draft without changing connection or launch consent state. */
export function projectAdsCampaignPlan(current: AdsCampaignInput, plan: AdsCampaignPlan, { channelId, linkedInCampaignGroups, linkedInManualGroupId }: {
  channelId: AdsChannelId;
  linkedInCampaignGroups: LinkedInAdsCampaignGroup[];
  linkedInManualGroupId: string | null;
}): AdsCampaignInput {
  const channelDraft = plan.channelDraft?.channel === current.provider ? plan.channelDraft : undefined;
  const channelSettings = channelDraft ? adsChannelWizardSettingsFromBrief(channelDraft) : current.channelSettings;
  const nativeCopy = channelDraft ? nativeBriefCopy(channelDraft) : null;
  const proposal: AdsCampaignInput = {
    ...current,
    creationMode: "inrcy",
    campaignType: plan.campaignType,
    objective: plan.objective,
    conversionGoal: plan.conversionGoal,
    conversionLocation: plan.conversionLocation,
    bidStrategy: plan.bidStrategy,
    name: plan.name || current.name,
    offer: plan.offer || current.offer,
    destinationUrl: plan.destinationUrl || current.destinationUrl,
    urlExpansion: plan.urlExpansion,
    urlExclusions: plan.urlExclusions,
    targetLocations: plan.targetLocations,
    targetAudiences: plan.targetAudiences,
    languages: plan.languages,
    googleSearchPartners: plan.googleSearchPartners,
    googleDisplayExpansion: plan.googleDisplayExpansion,
    metaAudienceExpansion: false,
    metaPlacements: plan.metaPlacements,
    trackingParameters: plan.trackingParameters,
    primaryText: plan.primaryText.trim() || plan.descriptions.filter(Boolean).join(" ") || plan.offer || current.primaryText,
    // A fresh analysis must never inherit an unrelated media attachment.
    // Only Studio acceptance or an explicit later user choice supplies one.
    imageUrl: plan.imageUrl,
    metaCreativeAssets: { feedImageUrl: "", storyReelImageUrl: "" },
    creativeUrl: plan.creativeUrl,
    creativeType: plan.creativeType,
    mediaStrategy: plan.mediaStrategy,
    mediaBrief: plan.mediaBrief,
    callToAction: plan.callToAction || current.callToAction,
    headlines: plan.headlines.length ? plan.headlines : current.headlines,
    descriptions: plan.descriptions.length ? plan.descriptions : current.descriptions,
    keywords: channelId === "meta" || channelId === "openai" || channelId === "tiktok" || channelDraft?.channel === "x" && channelDraft.targetingMode !== "keywords" || channelDraft?.channel === "pinterest" && channelDraft.targetingMode === "automatic"
      ? []
      : plan.keywords.length ? plan.keywords : current.keywords,
    negativeKeywords: plan.negativeKeywords,
    channelDraft,
    channelSettings,
    ...(channelId === "x" || channelId === "tiktok" ? {
      preparedDeliverySettings: plan.preparedDeliverySuggestion || defaultPreparedDeliverySettings(),
      dailyBudgetEuros: plan.preparedBudgetSuggestion?.dailyEuros ?? current.dailyBudgetEuros,
      endDate: plan.preparedBudgetSuggestion?.endAt?.slice(0, 10) || current.endDate,
    } : {}),
    ...(channelId === "meta" ? {
      metaDeliverySettings: plan.metaDeliverySuggestion || defaultMetaDeliverySettings(), metaGeoTargets: [],
      dailyBudgetEuros: plan.metaBudgetSuggestion?.dailyEuros ?? current.dailyBudgetEuros,
      endDate: plan.metaBudgetSuggestion?.endAt?.slice(0, 10) || current.endDate,
      callToAction: META_CALL_TO_ACTION_LABELS[(plan.metaDeliverySuggestion || defaultMetaDeliverySettings()).callToAction],
    } : {}),
    ...(channelId === "openai" ? {
      openaiDeliverySettings: plan.openaiDeliverySuggestion || defaultOpenaiDeliverySettings(),
      openaiBidEuros: plan.openaiBidSuggestion ?? 1,
      dailyBudgetEuros: plan.openaiBudgetSuggestion?.dailyEuros ?? current.dailyBudgetEuros,
      endDate: plan.openaiBudgetSuggestion?.endAt?.slice(0, 10) || current.endDate,
    } : {}),
    ...(channelId === "pinterest" ? {
      pinterestDeliverySettings: plan.pinterestDeliverySuggestion || defaultPinterestDeliverySettings(channelSettings?.channel === "pinterest" ? channelSettings.objectiveType : "CONSIDERATION"),
      dailyBudgetEuros: plan.pinterestBudgetSuggestion?.dailyEuros ?? current.dailyBudgetEuros,
      endDate: plan.pinterestBudgetSuggestion?.endAt?.slice(0, 10) || current.endDate,
    } : {}),
    ...(channelId === "google" ? {
      googleDeliverySettings: plan.googleDeliverySettings || defaultGoogleDeliverySettings(),
      dailyBudgetEuros: plan.googleBudgetSuggestion?.dailyEuros ?? current.dailyBudgetEuros,
      endDate: plan.googleBudgetSuggestion?.endDate || current.endDate,
    } : {}),
    ...(channelDraft?.channel === "linkedin" ? {
      linkedinGeoTargets: [],
      linkedinDeliverySettings: {
        ...defaultLinkedInDeliverySettings(),
        locationType: plan.linkedinDeliverySuggestion?.locationType || "recent_or_permanent",
        placements: plan.linkedinDeliverySuggestion?.placements || { audienceNetwork: false, audienceExpansion: false },
        callToAction: linkedInCallToActionFromLabel(plan.callToAction),
        bidding: plan.linkedinDeliverySuggestion?.bidding || { strategy: "maximum_delivery", amountEuros: null },
        budget: {
          type: plan.linkedinBudgetSuggestion?.type || "daily",
          totalEuros: plan.linkedinBudgetSuggestion?.totalEuros ?? null,
          startAt: plan.linkedinDeliverySuggestion?.budget.startAt || null,
          endAt: plan.linkedinDeliverySuggestion?.budget.endAt || new Date(current.endDate + "T23:59:00").toISOString(),
        },
      },
      ...(plan.linkedinDeliverySuggestion?.budget.endAt ? {
        endDate: new Date(plan.linkedinDeliverySuggestion.budget.endAt).toLocaleDateString("sv-SE"),
      } : {}),
    } : {}),
  };
  if (channelDraft?.channel === "linkedin") {
    Object.assign(proposal, prepareLinkedInPlanForGroup(proposal, {
      groups: linkedInCampaignGroups,
      manualGroupId: linkedInManualGroupId,
      endIsExplicit: plan.linkedinCalendarConstraints?.endIsExplicit !== false,
    }));
  }
  if (!channelDraft || !nativeCopy)
    return proposal;
  // For prepared-only channels, the audited native brief is the source of
  // truth for fields that the model could otherwise contradict or invent.
  return {
    ...proposal,
    name: channelDraft.name,
    objective: channelSettings ? nativeWizardGenericObjective(channelSettings) : proposal.objective,
    mediaStrategy: channelSettings ? nativeWizardMediaStrategy(channelSettings) : proposal.mediaStrategy,
    conversionLocation: channelSettings?.channel === "tiktok" && channelSettings.destinationKind === "instant_form"
      ? "instant_form" : channelSettings?.channel === "linkedin" && channelSettings.objectiveType === "LEAD_GENERATION"
      ? "instant_form" : "website",
    dailyBudgetEuros: ["pinterest", "x", "tiktok"].includes(channelDraft.channel) ? proposal.dailyBudgetEuros : channelDraft.channel === "linkedin" && (plan.linkedinBudgetSuggestion?.type === "total" || channelDraft.budget.period === "lifetime") ? current.dailyBudgetEuros : channelDraft.budget.amount,
    targetLocations: channelDraft.audience.locationBriefs,
    destinationUrl: nativeCopy.destination,
    primaryText: channelDraft.channel === "x" && channelSettings?.channel === "x" && channelSettings.format === "text"
      ? preparedXCopyWithDestination(nativeCopy.message, nativeCopy.destination, proposal.trackingParameters) : nativeCopy.message,
    mediaBrief: nativeCopy.media,
    headlines: nativeCopy.headline
      ? channelDraft.channel === "pinterest" ? [nativeCopy.headline] : [nativeCopy.headline, ...plan.headlines.filter((headline) => headline !== nativeCopy.headline)].slice(0, 15)
      : proposal.headlines,
    descriptions: channelDraft.channel === "linkedin"
      ? proposal.descriptions
      : [nativeCopy.message, ...plan.descriptions.filter((description) => description !== nativeCopy.message)].slice(0, 4),
  };
}
