import {
  ADS_BID_STRATEGIES,
  ADS_CAMPAIGN_OBJECTIVES,
  ADS_CAMPAIGN_TYPES,
  ADS_CONVERSION_LOCATIONS,
  ADS_CONVERSION_GOALS,
  ADS_MEDIA_STRATEGIES,
  ADS_META_PLACEMENTS,
  defaultAdsCampaignType,
  type AdsBidStrategy,
  type AdsCampaignObjective,
  type AdsCampaignType,
  type AdsChannelId,
  type AdsConversionLocation,
  type AdsConversionGoal,
  type AdsMediaStrategy,
  type AdsMetaPlacement,
} from "@/lib/adsValidation";

export type AdsCampaignPlan = {
  brand: string;
  name: string;
  campaignType: AdsCampaignType;
  objective: AdsCampaignObjective;
  conversionGoal: AdsConversionGoal;
  conversionLocation: AdsConversionLocation;
  bidStrategy: AdsBidStrategy;
  offer: string;
  destinationUrl: string;
  urlExpansion: boolean;
  urlExclusions: string[];
  targetLocations: string[];
  targetAudiences: string[];
  languages: string[];
  googleSearchPartners: boolean;
  googleDisplayExpansion: boolean;
  metaAudienceExpansion: boolean;
  metaPlacements: AdsMetaPlacement[];
  trackingParameters: string;
  primaryText: string;
  imageUrl: string;
  creativeUrl: string;
  creativeType: "image" | "video";
  mediaStrategy: AdsMediaStrategy;
  mediaBrief: string;
  callToAction: string;
  headlines: string[];
  descriptions: string[];
  keywords: string[];
  negativeKeywords: string[];
  rationale: string;
};

type PlanContext = {
  provider: AdsChannelId;
  companyName?: string;
  destinationUrl?: string;
  locations?: string[];
  audiences?: string[];
  services?: string[];
};

function clean(value: unknown, max: number) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

function list(value: unknown, maxItems: number, maxItemLength: number) {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\n,;]/) : [];
  const seen = new Set<string>();
  const items: string[] = [];
  for (const value of raw) {
    const item = clean(value, maxItemLength);
    const key = item.toLocaleLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    items.push(item);
    if (items.length >= maxItems) break;
  }
  return items;
}

function oneOf<T extends readonly string[]>(values: T, value: unknown, fallback: T[number]) {
  return typeof value === "string" && (values as readonly string[]).includes(value)
    ? value as T[number]
    : fallback;
}

function enumList<T extends readonly string[]>(values: T, value: unknown, maxItems: number): T[number][] {
  const candidates = list(value, maxItems, 60);
  return candidates.filter((candidate): candidate is T[number] => (values as readonly string[]).includes(candidate));
}

function httpsUrl(value: unknown) {
  const raw = clean(value, 2_000);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : "";
  } catch {
    return "";
  }
}

function defaultMediaStrategy(provider: AdsChannelId): AdsMediaStrategy {
  return provider === "google" ? "search_text" : provider === "tiktok" ? "video" : "image";
}

/**
 * A model may recommend a valid asset strategy for the wrong campaign format.
 * Resolve that here, before a Studio credit is ever spent on an unusable asset.
 */
function mediaStrategyForCampaignType(
  provider: AdsChannelId,
  campaignType: AdsCampaignType,
  candidate: AdsMediaStrategy,
): AdsMediaStrategy {
  if (campaignType === "search") return "search_text";
  if (campaignType === "shopping") return "product_feed";
  if (campaignType === "video") return "video";

  const needsVisual = campaignType === "performance_max"
    || campaignType === "display"
    || campaignType === "demand_gen"
    || campaignType.startsWith("meta_");

  if (needsVisual && (candidate === "search_text" || candidate === "product_feed")) {
    return provider === "google" ? "mixed" : "image";
  }

  return candidate;
}

function creativeTypeForStrategy(
  strategy: AdsMediaStrategy,
  candidate: "image" | "video",
) {
  if (strategy === "video") return "video" as const;
  if (strategy === "image" || strategy === "search_text" || strategy === "product_feed") return "image" as const;
  return candidate;
}

/**
 * Normalises an AI proposal before it reaches the browser. The model is free to
 * be creative in the copy, never in the identifiers or campaign controls.
 */
export function normalizeAdsCampaignPlan(value: unknown, context: PlanContext): AdsCampaignPlan {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const campaignType = oneOf(ADS_CAMPAIGN_TYPES, raw.campaignType, defaultAdsCampaignType(context.provider));
  const objective = oneOf(ADS_CAMPAIGN_OBJECTIVES, raw.objective, "leads");
  const conversionGoal = oneOf(ADS_CONVERSION_GOALS, raw.conversionGoal, "quote_request");
  const conversionLocation = oneOf(ADS_CONVERSION_LOCATIONS, raw.conversionLocation, "website");
  const bidStrategy = oneOf(ADS_BID_STRATEGIES, raw.bidStrategy, "maximize_conversions");
  const rawMediaStrategy = oneOf(ADS_MEDIA_STRATEGIES, raw.mediaStrategy, defaultMediaStrategy(context.provider));
  const mediaStrategy = mediaStrategyForCampaignType(context.provider, campaignType, rawMediaStrategy);
  const rawCreativeType = raw.creativeType === "video" ? "video" as const : "image" as const;
  const fallbackOffer = context.services?.[0] || "";

  return {
    brand: clean(raw.brand, 120) || clean(context.companyName, 120),
    name: clean(raw.name, 100),
    campaignType,
    objective,
    conversionGoal,
    conversionLocation,
    bidStrategy,
    offer: clean(raw.offer, 500) || fallbackOffer,
    destinationUrl: httpsUrl(raw.destinationUrl) || httpsUrl(context.destinationUrl),
    urlExpansion: raw.urlExpansion !== false,
    urlExclusions: list(raw.urlExclusions, 20, 300).filter((url) => Boolean(httpsUrl(url))),
    targetLocations: list(raw.targetLocations, 20, 120).length
      ? list(raw.targetLocations, 20, 120)
      : list(context.locations, 20, 120).length
        ? list(context.locations, 20, 120)
        : context.provider === "google" ? ["France"] : [],
    targetAudiences: list(raw.targetAudiences, 20, 160).length
      ? list(raw.targetAudiences, 20, 160)
      : list(context.audiences, 20, 160),
    languages: list(raw.languages, 10, 40).length ? list(raw.languages, 10, 40) : ["fr"],
    googleSearchPartners: raw.googleSearchPartners === true,
    googleDisplayExpansion: raw.googleDisplayExpansion === true,
    metaAudienceExpansion: raw.metaAudienceExpansion !== false,
    metaPlacements: enumList(ADS_META_PLACEMENTS, raw.metaPlacements, 8),
    trackingParameters: clean(raw.trackingParameters, 500),
    primaryText: clean(raw.primaryText, 500),
    // The planning endpoint receives no verified media URL. Do not turn a
    // model-invented link into an ad asset; Studio or the professional adds it.
    imageUrl: "",
    creativeUrl: "",
    creativeType: creativeTypeForStrategy(mediaStrategy, rawCreativeType),
    mediaStrategy,
    mediaBrief: clean(raw.mediaBrief, 1_000),
    callToAction: clean(raw.callToAction, 80) || "Demander un devis",
    headlines: list(raw.headlines, 15, 30),
    descriptions: list(raw.descriptions, 4, 90),
    keywords: list(raw.keywords, 20, 80),
    negativeKeywords: list(raw.negativeKeywords, 40, 80),
    rationale: clean(raw.rationale, 900),
  };
}

export function isUsableAdsCampaignPlan(plan: AdsCampaignPlan) {
  return Boolean(plan.name && plan.offer && (plan.primaryText || plan.headlines.length >= 3));
}
