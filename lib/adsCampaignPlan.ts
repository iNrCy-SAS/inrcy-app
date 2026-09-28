import { isPlannedAdsChannel, type PlannedAdsChannel } from "./adsChannelCapabilities.ts";
import {
  assessAdsChannelDraft,
  type AdsChannelDraft,
  type LinkedInAdsDraft,
  type PinterestAdsDraft,
  type TikTokAdsDraft,
  type XAdsDraft,
} from "./adsChannelDrafts.ts";
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
} from "./adsValidation.ts";

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
  /** Channel-specific planning brief. Never an advertising API payload. */
  channelDraft?: AdsChannelDraft;
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

function cleanRationale(value: unknown) {
  const text = String(value ?? "").replace(/\u0000/g, "").trim();
  if (text.length <= 4_000) return text;
  const withinLimit = text.slice(0, 4_000);
  const sentenceEnd = Math.max(
    withinLimit.lastIndexOf(". "),
    withinLimit.lastIndexOf("! "),
    withinLimit.lastIndexOf("? "),
  );
  if (sentenceEnd >= 2_000) return withinLimit.slice(0, sentenceEnd + 1).trim();
  const wordEnd = withinLimit.lastIndexOf(" ");
  return `${withinLimit.slice(0, wordEnd > 0 ? wordEnd : 4_000).trimEnd()}…`;
}

/** Earlier saved plans were clipped at exactly 900 characters. Show their last
 * complete sentence instead of leaving a dangling word on screen. */
export function presentAdsCampaignRationale(value: string) {
  const text = value.trim();
  if (text.length !== 900 || /[.!?…]$/.test(text)) return text;
  const sentenceEnds = [...text.matchAll(/[.!?](?=\s|$)/g)];
  const lastSentenceEnd = sentenceEnds.at(-1)?.index;
  return lastSentenceEnd !== undefined && lastSentenceEnd >= text.length * 0.65
    ? text.slice(0, lastSentenceEnd + 1)
    : `${text}…`;
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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

const PLANNED_COPY_LIMITS: Record<PlannedAdsChannel, { headline: number; description: number }> = {
  linkedin: { headline: 200, description: 300 },
  tiktok: { headline: 100, description: 100 },
  pinterest: { headline: 100, description: 800 },
  x: { headline: 280, description: 280 },
};

/**
 * Keep the AI's strategic choices, but never let it create an account/asset ID,
 * verified geo ID or destination URL. Those must come from the professional or
 * a future platform-side discovery flow.
 */
export function normalizePlannedAdsChannelDraft(value: unknown, context: PlanContext): AdsChannelDraft | null {
  if (!isPlannedAdsChannel(context.provider)) return null;
  const channel = context.provider;
  const raw = record(value);
  if (raw.channel !== channel) return null;
  const budget = record(raw.budget);
  const audience = record(raw.audience);
  const creative = record(raw.creative);
  const base = {
    schemaVersion: 1 as const,
    channel,
    name: clean(raw.name, 100),
    budget: {
      amount: typeof budget.amount === "number" ? budget.amount : 0,
      currency: clean(budget.currency, 3),
      period: budget.period,
      level: budget.level,
    },
    audience: {
      locationBriefs: list(context.locations, 20, 120),
      audienceBrief: clean(audience.audienceBrief, 500) || list(context.audiences, 8, 160).join(" ; "),
    },
  };
  const destinationUrl = httpsUrl(context.destinationUrl);
  let draft: AdsChannelDraft;
  switch (channel) {
    case "linkedin":
      draft = {
        ...base,
        channel,
        objectiveType: clean(raw.objectiveType, 40),
        format: clean(raw.format, 60),
        locale: {
          country: clean(record(raw.locale).country, 2),
          language: clean(record(raw.locale).language, 2),
        },
        creative: {
          introText: clean(creative.introText, 600),
          headline: clean(creative.headline, 200),
          mediaBrief: clean(creative.mediaBrief, 1_000),
          destinationUrl,
          leadFormBrief: clean(creative.leadFormBrief, 500),
        },
      } as LinkedInAdsDraft;
      break;
    case "tiktok":
      draft = {
        ...base,
        channel,
        objectiveType: clean(raw.objectiveType, 40),
        format: clean(raw.format, 20),
        destinationKind: clean(raw.destinationKind, 20),
        placementIntent: clean(raw.placementIntent, 30),
        optimizationIntent: clean(raw.optimizationIntent, 30),
        creative: {
          adText: clean(creative.adText, 100),
          videoBrief: clean(creative.videoBrief, 1_000),
          destinationUrl,
          conversionEventBrief: clean(creative.conversionEventBrief, 300),
        },
      } as TikTokAdsDraft;
      break;
    case "pinterest":
      draft = {
        ...base,
        channel,
        objectiveType: clean(raw.objectiveType, 40),
        intendedPromotionType: clean(raw.intendedPromotionType, 30),
        creativeType: raw.creativeType ? clean(raw.creativeType, 20) : undefined,
        conversionEvent: raw.conversionEvent ? clean(raw.conversionEvent, 30) : undefined,
        creative: {
          pinTitle: clean(creative.pinTitle, 100),
          pinDescription: clean(creative.pinDescription, 800),
          visualBrief: clean(creative.visualBrief, 1_000),
          destinationUrl,
        },
      } as PinterestAdsDraft;
      break;
    case "x":
      draft = {
        ...base,
        channel,
        objective: clean(raw.objective, 40),
        format: clean(raw.format, 20),
        targetingMode: clean(raw.targetingMode, 30),
        keywords: list(raw.keywords, 20, 80),
        creative: {
          postText: clean(creative.postText, 500),
          mediaBrief: clean(creative.mediaBrief, 1_000),
          destinationUrl,
        },
      } as XAdsDraft;
      break;
  }
  return assessAdsChannelDraft(draft).briefComplete ? draft : null;
}

function plannedCopy(draft: AdsChannelDraft | null) {
  if (!draft) return { primaryText: "", headline: "", description: "", mediaBrief: "", strategy: null };
  switch (draft.channel) {
    case "linkedin":
      return {
        primaryText: draft.creative.introText,
        headline: draft.creative.headline,
        description: draft.creative.introText,
        mediaBrief: draft.creative.mediaBrief,
        strategy: draft.format === "SINGLE_VIDEO" ? "video" as const : "image" as const,
      };
    case "tiktok":
      return {
        primaryText: draft.creative.adText,
        headline: draft.creative.adText,
        description: draft.creative.adText,
        mediaBrief: draft.creative.videoBrief,
        strategy: "video" as const,
      };
    case "pinterest":
      return {
        primaryText: draft.creative.pinDescription,
        headline: draft.creative.pinTitle,
        description: draft.creative.pinDescription,
        mediaBrief: draft.creative.visualBrief,
        strategy: draft.creativeType === "VIDEO" || draft.creativeType === "MAX_VIDEO" ? "video" as const : "image" as const,
      };
    case "x":
      return {
        primaryText: draft.creative.postText,
        headline: draft.creative.postText,
        description: draft.creative.postText,
        mediaBrief: draft.creative.mediaBrief,
        strategy: draft.format === "video" ? "video" as const : draft.format === "image" ? "image" as const : "search_text" as const,
      };
  }
}

/** An explicit native brief lets the strategist reason beyond Google/Meta. */
export function plannedAdsChannelPlanPrompt(channel: PlannedAdsChannel): string {
  const channelInstructions: Record<PlannedAdsChannel, string> = {
    linkedin: `LinkedIn Ads : cible une audience professionnelle justifiée par l’activité. channelDraft.objectiveType = BRAND_AWARENESS | WEBSITE_VISIT | ENGAGEMENT | VIDEO_VIEW | LEAD_GENERATION | WEBSITE_CONVERSION. channelDraft.format = STANDARD_UPDATE | SINGLE_VIDEO | CAROUSEL | TEXT_AD | LEAD_GENERATION_FORM_SPONSORED_CONTENT ; VIDEO_VIEW exige SINGLE_VIDEO et LEAD_GENERATION exige LEAD_GENERATION_FORM_SPONSORED_CONTENT. channelDraft.locale = {country:"FR",language:"fr"} seulement si ces paramètres conviennent aux zones et à la langue connues. channelDraft.creative = {introText,headline,mediaBrief,destinationUrl,leadFormBrief}. introText : accroche et argument professionnel concrets (600 caractères au plus) ; headline : 200 caractères au plus. Pour LEAD_GENERATION, décris le formulaire et son intérêt dans leadFormBrief.`,
    tiktok: `TikTok Ads : ne propose que la voie vidéo préparée dans l’application. channelDraft.objectiveType = REACH | VIDEO_VIEWS | TRAFFIC | WEB_CONVERSIONS | LEAD_GENERATION | ENGAGEMENT ; format="video" ; destinationKind="website" | "instant_form" | "profile" ; placementIntent="automatic" | "tiktok_only" ; optimizationIntent="reach" | "views" | "clicks" | "conversions" | "leads" | "engagement". channelDraft.creative = {adText,videoBrief,destinationUrl,conversionEventBrief}. adText : 100 caractères au plus. videoBrief : scène verticale, déroulé, démonstration et appel à l’action réalistes ; aucun média existant ne doit être supposé. Pour WEB_CONVERSIONS, nomme l’action observable dans conversionEventBrief sans prétendre qu’un Pixel existe.`,
    pinterest: `Pinterest Ads : fonde l’idée créative sur une recherche d’inspiration plausible pour cette activité. channelDraft.objectiveType = AWARENESS | CONSIDERATION | VIDEO_COMPLETION | SALES | LEADS ; intendedPromotionType="STANDARD_AD" | "CATALOG". Choisis CATALOG uniquement si des produits et un catalogue sont attestés ; sinon STANDARD_AD. Pour STANDARD_AD, creativeType=REGULAR | VIDEO | MAX_VIDEO | CAROUSEL ; VIDEO_COMPLETION requiert VIDEO ou MAX_VIDEO. Pour CATALOG, omets creativeType. Pour SALES, conversionEvent=CHECKOUT | ADD_TO_CART ; pour LEADS, SIGNUP | LEAD ; sinon omets conversionEvent. channelDraft.creative = {pinTitle,pinDescription,visualBrief,destinationUrl}. pinTitle : 100 caractères au plus ; pinDescription : 800 caractères au plus ; visualBrief décrit le format visuel, la scène et la preuve vérifiée, pas un Pin déjà publié.`,
    x: `X Ads : distingue conversation pertinente et publicité intrusive. channelDraft.objective = reach | video_views | website_traffic | website_conversions | engagement ; format=text | image | video ; video_views requiert video ; targetingMode=broad | keywords | interests | follower_lookalikes ; keywords est une liste courte, concrète, uniquement si targetingMode=keywords. channelDraft.creative = {postText,mediaBrief,destinationUrl}. postText : un vrai texte de publication de 280 caractères maximum, en comptant chaque URL pour 23 caractères. mediaBrief décrit le visuel/vidéo nécessaire quand format n’est pas text. Ne prétends jamais qu’un post publicitaire, un financement ou un événement de conversion existe déjà.`,
  };

  return `Tu es le stratège senior d’iNr’ADS. Construis en français une proposition de campagne ${channel} spécifique et utile à un professionnel. C’est un BROUILLON à relire, jamais une campagne prête à publier. Tu ne disposes d’aucun adaptateur de publication pour ce canal.

Analyse silencieusement l’iNrADN, l’offre réellement attestée, les besoins et objections du public, les zones connues, l’objectif de conversion, la destination, le format du média à produire et la mesure possible. Si l’utilisateur fixe un objectif, respecte-le après vérification de cohérence ; sinon choisis l’opportunité la plus crédible. Utilise l’historique uniquement pour varier l’angle, jamais comme preuve. Ne promets aucun résultat, n’invente aucun prix, certification, preuve, lieu, média existant, compte, catalogue, Pin, Pixel ou ID externe. Une URL doit venir textuellement du contexte, sinon laisse-la vide. Aucun CPA/ROAS cible ou prévision chiffrée sans données vérifiées. Préfère un message précis et authentique à un slogan générique.

Réponds uniquement en JSON. Retourne les mêmes champs principaux que le studio : brand, name, campaignType, objective, conversionGoal, conversionLocation, bidStrategy, offer, destinationUrl, urlExpansion, urlExclusions, targetLocations, targetAudiences, languages, googleSearchPartners, googleDisplayExpansion, metaAudienceExpansion, metaPlacements, trackingParameters, primaryText, imageUrl, creativeUrl, creativeType, mediaStrategy, mediaBrief, callToAction, headlines, descriptions, keywords, negativeKeywords, rationale ; ajoute obligatoirement channelDraft. campaignType="generic" ; objective=leads | sales | website_traffic | awareness | engagement | app_promotion ; conversionGoal=quote_request | lead_form | phone_call | website_visit | purchase | message | store_visit | custom ; conversionLocation=website | instant_form | messaging | phone | store ; bidStrategy=maximize_conversions | maximize_clicks | maximize_value | manual_review ; mediaStrategy=search_text | image | video | mixed | product_feed ; creativeType=image | video. Les flags Google/Meta sont false et metaPlacements=[]. imageUrl et creativeUrl sont vides. trackingParameters est une chaîne UTM ou vide, pas un objet. rationale relie en deux ou trois phrases offre, audience, format, action mesurable et limites à vérifier.

channelDraft est un objet avec {schemaVersion:1,channel:"${channel}",name,budget:{amount,currency:"EUR",period:"daily",level},audience:{locationBriefs,audienceBrief}, ...champs spécifiques ci-dessous}. Propose amount de 5 à 500 € comme hypothèse quotidienne à faire valider par le professionnel, jamais comme budget engagé. N’ajoute PAS externalRefs : aucun ID de compte, média, géographie, conversion ou autre ressource n’est vérifié par ce moteur. Les zones locationBriefs doivent venir uniquement du contexte connu. audienceBrief formule le public pertinent et sa motivation ; ne cible aucune caractéristique personnelle sensible.

${channelInstructions[channel]}

Les champs principaux du studio doivent refléter exactement le même choix que channelDraft. Respecte les longueurs du canal, pas les limites Google de 30/90 : LinkedIn headlines 200/descriptions 300, TikTok 100/100, Pinterest 100/800, X 280/280. Fournis un primaryText et une description exploitables, des idées de média détaillées et une audience argumentée. Les mots-clés ne sont utiles que si le ciblage/format les justifie. Si des données indispensables manquent, laisse-les vides ; n’invente pas pour compléter le JSON.`;
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
  const raw = record(value);
  const channelDraft = normalizePlannedAdsChannelDraft(raw.channelDraft, context);
  const native = plannedCopy(channelDraft);
  const copyLimits = isPlannedAdsChannel(context.provider)
    ? PLANNED_COPY_LIMITS[context.provider]
    : { headline: 30, description: 90 };
  const campaignType = oneOf(ADS_CAMPAIGN_TYPES, raw.campaignType, defaultAdsCampaignType(context.provider));
  const objective = oneOf(ADS_CAMPAIGN_OBJECTIVES, raw.objective, context.provider === "meta" ? "website_traffic" : "leads");
  const conversionGoal = oneOf(ADS_CONVERSION_GOALS, raw.conversionGoal, context.provider === "meta" ? "website_visit" : "quote_request");
  const conversionLocation = oneOf(ADS_CONVERSION_LOCATIONS, raw.conversionLocation, "website");
  const bidStrategy = oneOf(ADS_BID_STRATEGIES, raw.bidStrategy, "maximize_conversions");
  const rawMediaStrategy = native.strategy || oneOf(ADS_MEDIA_STRATEGIES, raw.mediaStrategy, defaultMediaStrategy(context.provider));
  const mediaStrategy = mediaStrategyForCampaignType(context.provider, campaignType, rawMediaStrategy);
  const rawCreativeType = raw.creativeType === "video" ? "video" as const : "image" as const;
  const fallbackOffer = context.services?.[0] || "";
  const requestedMetaPlacements = enumList(ADS_META_PLACEMENTS, raw.metaPlacements, 8);
  const metaPlacements: AdsMetaPlacement[] = context.provider === "meta"
    ? requestedMetaPlacements.length ? requestedMetaPlacements : ["facebook_feed", "instagram_feed", "stories", "reels"]
    : requestedMetaPlacements;

  return {
    brand: clean(raw.brand, 120) || clean(context.companyName, 120),
    name: clean(raw.name, 100) || channelDraft?.name || "",
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
    metaPlacements,
    trackingParameters: clean(raw.trackingParameters, 500),
    primaryText: clean(raw.primaryText, 500) || clean(native.primaryText, 500),
    // The planning endpoint receives no verified media URL. Do not turn a
    // model-invented link into an ad asset; Studio or the professional adds it.
    imageUrl: "",
    creativeUrl: "",
    creativeType: creativeTypeForStrategy(mediaStrategy, rawCreativeType),
    mediaStrategy,
    mediaBrief: clean(raw.mediaBrief, 1_000) || native.mediaBrief,
    callToAction: clean(raw.callToAction, 80) || (context.provider === "meta" ? "En savoir plus" : "Demander un devis"),
    headlines: list(raw.headlines, 15, copyLimits.headline).length
      ? list(raw.headlines, 15, copyLimits.headline)
      : native.headline ? [clean(native.headline, copyLimits.headline)] : [],
    descriptions: list(raw.descriptions, 4, copyLimits.description).length
      ? list(raw.descriptions, 4, copyLimits.description)
      : native.description ? [clean(native.description, copyLimits.description)] : [],
    keywords: list(raw.keywords, 20, 80),
    negativeKeywords: list(raw.negativeKeywords, 40, 80),
    rationale: cleanRationale(raw.rationale),
    ...(channelDraft ? { channelDraft } : {}),
  };
}

export function isUsableAdsCampaignPlan(plan: AdsCampaignPlan) {
  return Boolean(plan.name && plan.offer && (plan.primaryText || plan.headlines.length >= 3));
}

/** A model answer must contain a valid native brief before review, not merely JSON. */
export function isReviewableAdsCampaignPlan(plan: AdsCampaignPlan, provider: AdsChannelId): boolean {
  if (!isUsableAdsCampaignPlan(plan)) return false;
  if (isPlannedAdsChannel(provider)) {
    return plan.campaignType === "generic"
      && plan.channelDraft?.channel === provider
      && assessAdsChannelDraft(plan.channelDraft).briefComplete === true;
  }
  if (plan.campaignType === "search") {
    return plan.headlines.length >= 6 && plan.descriptions.length >= 3 && plan.keywords.length >= 6;
  }
  if (plan.campaignType.startsWith("meta_")) return Boolean(plan.primaryText && plan.callToAction);
  return true;
}
