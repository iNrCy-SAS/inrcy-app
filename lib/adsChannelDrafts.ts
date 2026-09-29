import { getPlannedAdsChannelCapability, isPlannedAdsChannel, type PlannedAdsChannel } from "./adsChannelCapabilities.ts";

/**
 * Strategy briefs, not API payloads. References below may only be filled from
 * the user's verified advertising account/assets; an AI plan must leave them
 * blank. Presence of a reference never proves permission or publishability.
 *
 * Native objective/format names are intentionally scoped to documented flows.
 * A publisher must perform fresh platform-side capability checks before its
 * own API-specific serialization is ever introduced.
 */
export type AdsDraftBudget = {
  amount: number;
  currency: string;
  period: "daily" | "lifetime";
  level: "campaign" | "ad_group";
};

export type AdsDraftAudience = {
  locationBriefs: string[];
  audienceBrief: string;
};

type AdsChannelDraftBase<Channel extends PlannedAdsChannel> = {
  schemaVersion: 1;
  channel: Channel;
  name: string;
  budget: AdsDraftBudget;
  audience: AdsDraftAudience;
};

export type LinkedInAdsDraft = AdsChannelDraftBase<"linkedin"> & {
  objectiveType: "BRAND_AWARENESS" | "WEBSITE_VISIT" | "ENGAGEMENT" | "VIDEO_VIEW" | "LEAD_GENERATION" | "WEBSITE_CONVERSION";
  format: "STANDARD_UPDATE" | "SINGLE_VIDEO" | "CAROUSEL" | "TEXT_AD" | "LEAD_GENERATION_FORM_SPONSORED_CONTENT";
  locale: { country: string; language: string };
  creative: {
    introText: string;
    headline: string;
    mediaBrief: string;
    destinationUrl: string;
    leadFormBrief?: string;
  };
  externalRefs?: {
    adAccountUrn?: string;
    campaignGroupUrn?: string;
    organizationUrn?: string;
    creativeAssetUrn?: string;
    leadFormUrn?: string;
    conversionUrn?: string;
    geoUrns?: string[];
  };
};

export type TikTokAdsDraft = AdsChannelDraftBase<"tiktok"> & {
  objectiveType: "REACH" | "VIDEO_VIEWS" | "TRAFFIC" | "WEB_CONVERSIONS" | "LEAD_GENERATION" | "ENGAGEMENT";
  /** First documented creative path prepared by this contract; not all TikTok formats. */
  format: "video";
  destinationKind: "website" | "instant_form" | "profile";
  placementIntent: "automatic" | "tiktok_only";
  optimizationIntent: "reach" | "views" | "clicks" | "conversions" | "leads" | "engagement";
  creative: {
    adText: string;
    videoBrief: string;
    destinationUrl: string;
    conversionEventBrief?: string;
  };
  externalRefs?: {
    advertiserId?: string;
    identityId?: string;
    videoId?: string;
    locationIds?: string[];
    pixelId?: string;
    optimizationEvent?: string;
    instantFormId?: string;
  };
};

export type PinterestAdsDraft = AdsChannelDraftBase<"pinterest"> & {
  objectiveType: "AWARENESS" | "CONSIDERATION" | "VIDEO_COMPLETION" | "SALES" | "LEADS";
  intendedPromotionType: "STANDARD_AD" | "CATALOG";
  /**
   * `automatic` maps to Pinterest Performance+ targeting
   * (`auto_targeting_enabled`) and does not require the AI to invent an
   * interest, keyword or audience identifier. Manual modes remain planning
   * choices until their provider resources have been resolved server-side.
   */
  targetingMode: "automatic" | "interests" | "keywords" | "audiences";
  /** Native creative_type is only used for Pin-based STANDARD_AD campaigns. */
  creativeType?: "REGULAR" | "VIDEO" | "MAX_VIDEO" | "CAROUSEL";
  conversionEvent?: "CHECKOUT" | "ADD_TO_CART" | "SIGNUP" | "LEAD";
  creative: {
    pinTitle: string;
    pinDescription: string;
    visualBrief: string;
    destinationUrl: string;
  };
  externalRefs?: {
    adAccountId?: string;
    pinId?: string;
    catalogId?: string;
    productGroupId?: string;
    geoCodes?: string[];
    conversionTagId?: string;
  };
};

export type XAdsDraft = AdsChannelDraftBase<"x"> & {
  /** Product-level intent: X Ads API objective identifiers are not assumed. */
  objective: "reach" | "video_views" | "website_traffic" | "website_conversions" | "engagement";
  format: "text" | "image" | "video";
  targetingMode: "broad" | "keywords" | "interests" | "follower_lookalikes";
  keywords?: string[];
  creative: {
    postText: string;
    mediaBrief: string;
    destinationUrl: string;
  };
  externalRefs?: {
    adAccountId?: string;
    fundingInstrumentId?: string;
    postId?: string;
    locationIds?: string[];
    conversionEventId?: string;
  };
};

export type AdsChannelDraft = LinkedInAdsDraft | TikTokAdsDraft | PinterestAdsDraft | XAdsDraft;

export type AdsDraftIssue = { code: string; field: string };

export type AdsChannelDraftAssessment = {
  channel: PlannedAdsChannel | null;
  briefComplete: boolean;
  /** Literal false until an audited, tested publisher exists for this channel. */
  publicationReady: false;
  briefIssues: AdsDraftIssue[];
  publicationIssues: AdsDraftIssue[];
};

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}

/**
 * Pinterest briefs were already persisted with schemaVersion 1 before the
 * targeting choice became part of the native brief. Keep that wire version
 * readable while giving the missing choice the only safe, ID-free default.
 *
 * This helper deliberately changes nothing else. Callers must still run the
 * normal strict shape/content checks, so unexpected fields and external
 * resource identifiers remain rejected.
 */
export function isLegacyPinterestAdsDraft(value: unknown): boolean {
  const raw = record(value);
  return raw.channel === "pinterest"
    && raw.schemaVersion === 1
    && !Object.hasOwn(raw, "targetingMode");
}

export function normalizeAdsChannelDraftCompatibility(value: unknown): unknown {
  if (!isLegacyPinterestAdsDraft(value)) return value;
  return { ...(value as RecordValue), targetingMode: "automatic" };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function items(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value.map((item: string) => item.trim()).filter(Boolean)
    : [];
}

function isOneOf<const Values extends readonly string[]>(value: unknown, choices: Values): value is Values[number] {
  return typeof value === "string" && (choices as readonly string[]).includes(value);
}

function httpsUrl(value: unknown): boolean {
  try {
    const url = new URL(text(value));
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function issue(list: AdsDraftIssue[], code: string, field: string, failed: boolean): void {
  if (failed) list.push({ code, field });
}

function refIssue(list: AdsDraftIssue[], refs: RecordValue, field: string): void {
  issue(list, "unverified_or_missing_platform_resource", `externalRefs.${field}`, !text(refs[field]));
}

function refListIssue(list: AdsDraftIssue[], refs: RecordValue, field: string): void {
  issue(list, "unverified_or_missing_platform_resource", `externalRefs.${field}`, items(refs[field]).length === 0);
}

function assessCommon(raw: RecordValue, briefIssues: AdsDraftIssue[]): void {
  issue(briefIssues, "unsupported_schema", "schemaVersion", raw.schemaVersion !== 1);
  issue(briefIssues, "missing_name", "name", text(raw.name).length < 3 || text(raw.name).length > 100);
  const budget = record(raw.budget);
  issue(briefIssues, "invalid_budget", "budget.amount", typeof budget.amount !== "number" || !Number.isFinite(budget.amount) || budget.amount < 5 || budget.amount > 500 || Math.abs(Math.round(budget.amount * 100) - budget.amount * 100) > 0.000001);
  issue(briefIssues, "invalid_currency", "budget.currency", text(budget.currency) !== "EUR");
  issue(briefIssues, "invalid_budget_period", "budget.period", !isOneOf(budget.period, ["daily", "lifetime"] as const));
  issue(briefIssues, "invalid_budget_level", "budget.level", !isOneOf(budget.level, ["campaign", "ad_group"] as const));
  const audience = record(raw.audience);
  issue(briefIssues, "missing_locations", "audience.locationBriefs", items(audience.locationBriefs).length === 0);
  issue(briefIssues, "missing_audience", "audience.audienceBrief", text(audience.audienceBrief).length < 3);
}

const LINKEDIN_FORMATS = {
  BRAND_AWARENESS: ["STANDARD_UPDATE", "SINGLE_VIDEO", "CAROUSEL", "TEXT_AD"],
  WEBSITE_VISIT: ["STANDARD_UPDATE", "SINGLE_VIDEO", "CAROUSEL", "TEXT_AD"],
  ENGAGEMENT: ["STANDARD_UPDATE", "SINGLE_VIDEO", "CAROUSEL"],
  VIDEO_VIEW: ["SINGLE_VIDEO"],
  LEAD_GENERATION: ["LEAD_GENERATION_FORM_SPONSORED_CONTENT"],
  WEBSITE_CONVERSION: ["STANDARD_UPDATE", "SINGLE_VIDEO", "CAROUSEL", "TEXT_AD"],
} as const;

function assessLinkedIn(raw: RecordValue, brief: AdsDraftIssue[], publication: AdsDraftIssue[]): void {
  const objective = raw.objectiveType;
  const formats = typeof objective === "string" && Object.hasOwn(LINKEDIN_FORMATS, objective)
    ? LINKEDIN_FORMATS[objective as keyof typeof LINKEDIN_FORMATS] as readonly string[]
    : [];
  issue(brief, "unsupported_objective", "objectiveType", formats.length === 0);
  issue(brief, "objective_format_mismatch", "format", !formats.includes(text(raw.format)));
  issue(brief, "invalid_budget_level", "budget.level", record(raw.budget).level !== "campaign");
  const locale = record(raw.locale);
  issue(brief, "invalid_locale", "locale", !/^[A-Z]{2}$/.test(text(locale.country)) || !/^[a-z]{2}$/.test(text(locale.language)));
  const creative = record(raw.creative);
  issue(brief, "missing_creative_copy", "creative.introText", text(creative.introText).length < 10);
  issue(brief, "missing_headline", "creative.headline", text(creative.headline).length < 3);
  issue(brief, "missing_media_brief", "creative.mediaBrief", raw.format !== "TEXT_AD" && text(creative.mediaBrief).length < 10);
  issue(brief, "missing_destination", "creative.destinationUrl", (objective === "WEBSITE_VISIT" || objective === "WEBSITE_CONVERSION") && !httpsUrl(creative.destinationUrl));
  issue(brief, "invalid_destination", "creative.destinationUrl", Boolean(text(creative.destinationUrl)) && !httpsUrl(creative.destinationUrl));
  issue(brief, "missing_lead_form_brief", "creative.leadFormBrief", objective === "LEAD_GENERATION" && text(creative.leadFormBrief).length < 10);
  const refs = record(raw.externalRefs);
  refIssue(publication, refs, "adAccountUrn");
  refIssue(publication, refs, "campaignGroupUrn");
  refIssue(publication, refs, "organizationUrn");
  refListIssue(publication, refs, "geoUrns");
  if (raw.format !== "TEXT_AD") refIssue(publication, refs, "creativeAssetUrn");
  if (objective === "LEAD_GENERATION") refIssue(publication, refs, "leadFormUrn");
  if (objective === "WEBSITE_CONVERSION") refIssue(publication, refs, "conversionUrn");
}

const TIKTOK_OBJECTIVES = ["REACH", "VIDEO_VIEWS", "TRAFFIC", "WEB_CONVERSIONS", "LEAD_GENERATION", "ENGAGEMENT"] as const;

function assessTikTok(raw: RecordValue, brief: AdsDraftIssue[], publication: AdsDraftIssue[]): void {
  issue(brief, "unsupported_objective", "objectiveType", !isOneOf(raw.objectiveType, TIKTOK_OBJECTIVES));
  issue(brief, "unsupported_format", "format", raw.format !== "video");
  issue(brief, "invalid_destination_kind", "destinationKind", !isOneOf(raw.destinationKind, ["website", "instant_form", "profile"] as const));
  issue(brief, "invalid_placement", "placementIntent", !isOneOf(raw.placementIntent, ["automatic", "tiktok_only"] as const));
  issue(brief, "missing_optimization_intent", "optimizationIntent", !isOneOf(raw.optimizationIntent, ["reach", "views", "clicks", "conversions", "leads", "engagement"] as const));
  const creative = record(raw.creative);
  issue(brief, "missing_creative_copy", "creative.adText", text(creative.adText).length < 3);
  issue(brief, "missing_video_brief", "creative.videoBrief", text(creative.videoBrief).length < 10);
  issue(brief, "missing_destination", "creative.destinationUrl", raw.destinationKind === "website" && !httpsUrl(creative.destinationUrl));
  issue(brief, "invalid_destination", "creative.destinationUrl", Boolean(text(creative.destinationUrl)) && !httpsUrl(creative.destinationUrl));
  issue(brief, "missing_conversion_event_brief", "creative.conversionEventBrief", raw.objectiveType === "WEB_CONVERSIONS" && text(creative.conversionEventBrief).length < 3);
  const refs = record(raw.externalRefs);
  refIssue(publication, refs, "advertiserId");
  refIssue(publication, refs, "identityId");
  refIssue(publication, refs, "videoId");
  refListIssue(publication, refs, "locationIds");
  if (raw.objectiveType === "WEB_CONVERSIONS" || (raw.objectiveType === "LEAD_GENERATION" && raw.destinationKind === "website")) {
    refIssue(publication, refs, "pixelId");
    refIssue(publication, refs, "optimizationEvent");
  }
  if (raw.destinationKind === "instant_form") refIssue(publication, refs, "instantFormId");
}

const PINTEREST_OBJECTIVES = ["AWARENESS", "CONSIDERATION", "VIDEO_COMPLETION", "SALES", "LEADS"] as const;

function assessPinterest(raw: RecordValue, brief: AdsDraftIssue[], publication: AdsDraftIssue[]): void {
  issue(brief, "unsupported_objective", "objectiveType", !isOneOf(raw.objectiveType, PINTEREST_OBJECTIVES));
  issue(brief, "invalid_promotion_type", "intendedPromotionType", !isOneOf(raw.intendedPromotionType, ["STANDARD_AD", "CATALOG"] as const));
  issue(brief, "invalid_targeting_mode", "targetingMode", !isOneOf(raw.targetingMode, ["automatic", "interests", "keywords", "audiences"] as const));
  const catalog = raw.intendedPromotionType === "CATALOG";
  issue(brief, "invalid_creative_type", "creativeType", catalog
    ? Boolean(raw.creativeType)
    : !isOneOf(raw.creativeType, ["REGULAR", "VIDEO", "MAX_VIDEO", "CAROUSEL"] as const));
  issue(brief, "objective_promotion_mismatch", "intendedPromotionType", catalog && !["CONSIDERATION", "SALES"].includes(text(raw.objectiveType)));
  issue(brief, "objective_format_mismatch", "creativeType", raw.objectiveType === "VIDEO_COMPLETION" && !["VIDEO", "MAX_VIDEO"].includes(text(raw.creativeType)));
  const conversion = text(raw.conversionEvent);
  const allowedConversionEvents = raw.objectiveType === "SALES" ? ["CHECKOUT", "ADD_TO_CART"] : raw.objectiveType === "LEADS" ? ["SIGNUP", "LEAD"] : [];
  issue(brief, "invalid_conversion_event", "conversionEvent", allowedConversionEvents.length > 0
    ? !allowedConversionEvents.includes(conversion)
    : Boolean(conversion));
  const creative = record(raw.creative);
  issue(brief, "missing_visual_brief", "creative.visualBrief", text(creative.visualBrief).length < 10);
  issue(brief, "missing_pin_title", "creative.pinTitle", !catalog && text(creative.pinTitle).length < 3);
  issue(brief, "missing_destination", "creative.destinationUrl", ["CONSIDERATION", "SALES", "LEADS"].includes(text(raw.objectiveType)) && !httpsUrl(creative.destinationUrl));
  issue(brief, "invalid_destination", "creative.destinationUrl", Boolean(text(creative.destinationUrl)) && !httpsUrl(creative.destinationUrl));
  const refs = record(raw.externalRefs);
  refIssue(publication, refs, "adAccountId");
  refListIssue(publication, refs, "geoCodes");
  if (catalog) {
    refIssue(publication, refs, "catalogId");
    refIssue(publication, refs, "productGroupId");
  } else {
    refIssue(publication, refs, "pinId");
  }
  if (raw.objectiveType === "SALES" || raw.objectiveType === "LEADS") refIssue(publication, refs, "conversionTagId");
}

function xWeightedPostLength(value: unknown): number {
  const post = text(value);
  const withoutUrls = post.replace(/https?:\/\/\S+/g, "");
  const urls = post.match(/https?:\/\/\S+/g) || [];
  return Array.from(withoutUrls).length + urls.length * 23;
}

function assessX(raw: RecordValue, brief: AdsDraftIssue[], publication: AdsDraftIssue[]): void {
  issue(brief, "unsupported_objective", "objective", !isOneOf(raw.objective, ["reach", "video_views", "website_traffic", "website_conversions", "engagement"] as const));
  issue(brief, "invalid_format", "format", !isOneOf(raw.format, ["text", "image", "video"] as const));
  issue(brief, "objective_format_mismatch", "format", raw.objective === "video_views" && raw.format !== "video");
  issue(brief, "invalid_targeting_mode", "targetingMode", !isOneOf(raw.targetingMode, ["broad", "keywords", "interests", "follower_lookalikes"] as const));
  issue(brief, "missing_keywords", "keywords", raw.targetingMode === "keywords" && items(raw.keywords).length === 0);
  const creative = record(raw.creative);
  issue(brief, "missing_post_copy", "creative.postText", !text(creative.postText) || xWeightedPostLength(creative.postText) > 280);
  issue(brief, "missing_media_brief", "creative.mediaBrief", raw.format !== "text" && text(creative.mediaBrief).length < 10);
  issue(brief, "missing_destination", "creative.destinationUrl", (raw.objective === "website_traffic" || raw.objective === "website_conversions") && !httpsUrl(creative.destinationUrl));
  issue(brief, "invalid_destination", "creative.destinationUrl", Boolean(text(creative.destinationUrl)) && !httpsUrl(creative.destinationUrl));
  const refs = record(raw.externalRefs);
  refIssue(publication, refs, "adAccountId");
  refIssue(publication, refs, "fundingInstrumentId");
  refIssue(publication, refs, "postId");
  refListIssue(publication, refs, "locationIds");
  if (raw.objective === "website_conversions") refIssue(publication, refs, "conversionEventId");
}

/** A complete brief is never a signal that spending or publishing is safe. */
export function assessAdsChannelDraft(value: unknown): AdsChannelDraftAssessment {
  const raw = record(normalizeAdsChannelDraftCompatibility(value));
  if (!isPlannedAdsChannel(raw.channel)) {
    return {
      channel: null,
      briefComplete: false,
      publicationReady: false,
      briefIssues: [{ code: "unsupported_channel", field: "channel" }],
      publicationIssues: [{ code: "publisher_not_implemented", field: "channel" }],
    };
  }

  const channel = raw.channel;
  const capability = getPlannedAdsChannelCapability(channel);
  const briefIssues: AdsDraftIssue[] = [];
  const publicationIssues: AdsDraftIssue[] = [{ code: capability.publicationGate, field: "channel" }];
  assessCommon(raw, briefIssues);

  switch (channel) {
    case "linkedin": assessLinkedIn(raw, briefIssues, publicationIssues); break;
    case "tiktok": assessTikTok(raw, briefIssues, publicationIssues); break;
    case "pinterest": assessPinterest(raw, briefIssues, publicationIssues); break;
    case "x": assessX(raw, briefIssues, publicationIssues); break;
  }

  issue(publicationIssues, "brief_incomplete", "brief", briefIssues.length > 0);
  // Even present IDs must be resolved against live account permissions and
  // asset ownership. No such checks exist in this pure planning module.
  publicationIssues.push({ code: "platform_access_unverified", field: "externalRefs" });
  return { channel, briefComplete: briefIssues.length === 0, publicationReady: false, briefIssues, publicationIssues };
}
