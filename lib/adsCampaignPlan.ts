import { isPlannedAdsChannel, type PlannedAdsChannel } from "./adsChannelCapabilities.ts";
import {
  assessAdsChannelDraft,
  normalizeAdsChannelDraftCompatibility,
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
import { normalizePinterestAutomaticLocations } from "./adsPinterestLocations.ts";
import {
  ADS_PLAN_EDITORIAL_INSTRUCTIONS,
  ADS_PLAN_STRATEGY_INSTRUCTIONS,
  adsCopyList,
  adsCopyText,
  adsPlanCopyIssues,
  adsPlanStrategyIssues,
  selectAdsPlanLocations,
} from "./adsPlanQuality.ts";

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
  /** Country is context, never permission to widen a local campaign. */
  country?: string;
  city?: string;
  intent?: string;
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
  let complete = text;
  if (text.length === 900 && !/[.!?…]$/.test(text)) {
    const sentenceEnds = [...text.matchAll(/[.!?](?=\s|$)/g)];
    const lastSentenceEnd = sentenceEnds.at(-1)?.index;
    complete = lastSentenceEnd !== undefined && lastSentenceEnd >= text.length * 0.65
      ? text.slice(0, lastSentenceEnd + 1)
      : `${text}…`;
  }
  const labels: Record<string, string> = {
    REGULAR: "image unique", VIDEO: "vidéo", STANDARD_AD: "annonce standard",
    CONSIDERATION: "visites du site", website_traffic: "visites du site", website_visit: "visite du site",
    maximize_clicks: "maximisation des clics", maximize_conversions: "optimisation des conversions",
    search_text: "annonces textuelles", automatic: "automatique",
  };
  return complete.replace(/\b(?:REGULAR|VIDEO|STANDARD_AD|CONSIDERATION|website_traffic|website_visit|maximize_clicks|maximize_conversions|search_text|automatic)\b/g,
    (token) => labels[token]);
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

function enumToken(value: unknown, casing: "upper" | "lower" = "upper") {
  const token = clean(value, 80)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return casing === "upper" ? token.toUpperCase() : token.toLowerCase();
}

function finiteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !/^-?\d+(?:[.,]\d+)?$/.test(value.trim())) return 0;
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function suppliedChannelMatches(value: unknown, channel: PlannedAdsChannel) {
  const supplied = enumToken(value, "lower").replace(/_?ads$/, "");
  if (!supplied) return true;
  if (channel === "x") return supplied === "x" || supplied === "twitter";
  return supplied === channel;
}

function firstText(value: unknown, maxItems: number, maxLength: number) {
  return adsCopyList(value, maxItems).find((text) => Array.from(text).length <= maxLength) || "";
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

/**
 * Keep the AI's strategic choices, but never let it create an account/asset ID,
 * verified geo ID or destination URL. Those must come from the professional or
 * a future platform-side discovery flow.
 */
function buildPlannedAdsChannelDraft(
  value: unknown,
  context: PlanContext,
  planValue?: unknown,
): AdsChannelDraft | null {
  if (!isPlannedAdsChannel(context.provider)) return null;
  const channel = context.provider;
  const raw = record(normalizeAdsChannelDraftCompatibility(value));
  const plan = record(planValue);
  if (!suppliedChannelMatches(raw.channel, channel)) return null;
  const budget = record(raw.budget);
  const audience = record(raw.audience);
  const creative = record(raw.creative);
  const base = {
    schemaVersion: 1 as const,
    channel,
    name: adsCopyText(raw.name) || adsCopyText(plan.name),
    budget: {
      amount: finiteNumber(budget.amount),
      currency: enumToken(budget.currency),
      period: enumToken(budget.period, "lower"),
      level: enumToken(budget.level, "lower"),
    },
    audience: {
      locationBriefs: list(context.locations, 20, 120),
      audienceBrief: adsCopyText(audience.audienceBrief)
        || list(plan.targetAudiences, 8, 160).join(" ; ")
        || list(context.audiences, 8, 160).join(" ; "),
    },
  };
  const destinationUrl = httpsUrl(context.destinationUrl);
  let draft: AdsChannelDraft;
  switch (channel) {
    case "linkedin":
      draft = {
        ...base,
        channel,
        objectiveType: enumToken(raw.objectiveType),
        format: enumToken(raw.format),
        locale: {
          country: clean(record(raw.locale).country, 2).toUpperCase(),
          language: clean(record(raw.locale).language, 2).toLowerCase(),
        },
        creative: {
          introText: adsCopyText(creative.introText) || adsCopyText(plan.primaryText),
          headline: adsCopyText(creative.headline) || firstText(plan.headlines, 15, 200),
          mediaBrief: adsCopyText(creative.mediaBrief) || adsCopyText(plan.mediaBrief),
          destinationUrl,
          leadFormBrief: adsCopyText(creative.leadFormBrief),
        },
      } as LinkedInAdsDraft;
      break;
    case "tiktok":
      draft = {
        ...base,
        channel,
        objectiveType: enumToken(raw.objectiveType),
        format: enumToken(raw.format, "lower"),
        destinationKind: enumToken(raw.destinationKind, "lower"),
        placementIntent: enumToken(raw.placementIntent, "lower"),
        optimizationIntent: enumToken(raw.optimizationIntent, "lower"),
        creative: {
          adText: adsCopyText(creative.adText) || adsCopyText(plan.primaryText),
          videoBrief: adsCopyText(creative.videoBrief) || adsCopyText(plan.mediaBrief),
          destinationUrl,
          conversionEventBrief: adsCopyText(creative.conversionEventBrief),
        },
      } as TikTokAdsDraft;
      break;
    case "pinterest":
    {
      const planObjective = enumToken(plan.objective, "lower");
      const inferredObjective = planObjective === "awareness"
        ? "AWARENESS"
        : planObjective === "website_traffic" || planObjective === "engagement"
          ? "CONSIDERATION"
          : planObjective === "sales"
            ? "SALES"
            : planObjective === "leads"
              ? "LEADS"
              : "";
      const objectiveType = enumToken(raw.objectiveType) || inferredObjective;
      const rootMediaType = enumToken(plan.creativeType || plan.mediaStrategy, "lower");
      const creativeType = enumToken(raw.creativeType)
        || (rootMediaType === "video" ? "VIDEO" : rootMediaType === "image" ? "REGULAR" : "");
      const intendedPromotionType = enumToken(raw.intendedPromotionType)
        || (creativeType ? "STANDARD_AD" : "");
      const targetingMode = enumToken(raw.targetingMode, "lower") || "automatic";
      const planConversionGoal = enumToken(plan.conversionGoal, "lower");
      const inferredConversionEvent = objectiveType === "SALES" && planConversionGoal === "purchase"
        ? "CHECKOUT"
        : objectiveType === "LEADS" && ["lead_form", "quote_request"].includes(planConversionGoal)
          ? "LEAD"
          : "";
      draft = {
        ...base,
        channel,
        objectiveType,
        intendedPromotionType,
        targetingMode,
        creativeType: creativeType || undefined,
        conversionEvent: enumToken(raw.conversionEvent) || inferredConversionEvent || undefined,
        creative: {
          pinTitle: adsCopyText(creative.pinTitle) || firstText(plan.headlines, 15, 100),
          pinDescription: adsCopyText(creative.pinDescription)
            || adsCopyText(plan.primaryText)
            || firstText(plan.descriptions, 4, 800),
          visualBrief: adsCopyText(creative.visualBrief) || adsCopyText(plan.mediaBrief),
          destinationUrl,
        },
      } as PinterestAdsDraft;
      break;
    }
    case "x":
      draft = {
        ...base,
        channel,
        objective: enumToken(raw.objective, "lower"),
        format: enumToken(raw.format, "lower"),
        targetingMode: enumToken(raw.targetingMode, "lower"),
        keywords: list(raw.keywords, 20, 80),
        creative: {
          postText: adsCopyText(creative.postText) || adsCopyText(plan.primaryText),
          mediaBrief: adsCopyText(creative.mediaBrief) || adsCopyText(plan.mediaBrief),
          destinationUrl,
        },
      } as XAdsDraft;
      break;
  }
  return draft;
}

export function normalizePlannedAdsChannelDraft(
  value: unknown,
  context: PlanContext,
  planValue?: unknown,
): AdsChannelDraft | null {
  const draft = buildPlannedAdsChannelDraft(value, context, planValue);
  return draft && assessAdsChannelDraft(draft).briefComplete ? draft : null;
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

/**
 * The Pinterest strategist used to receive only "return JSON" instructions.
 * Gateway models could therefore return a convincing generic plan while
 * omitting or slightly reshaping the native brief, which was then (correctly)
 * rejected by the semantic validator. This schema makes the native contract
 * explicit at generation time; semantic and trusted-data checks still run
 * after parsing.
 */
export function pinterestAdsCampaignPlanResponseSchema(): {
  name: string;
  strict: true;
  schema: Record<string, unknown>;
} {
  const properties: Record<string, unknown> = {
    brand: { type: "string", maxLength: 120 },
    name: { type: "string", minLength: 3, maxLength: 100 },
    campaignType: { type: "string", enum: ["generic"] },
    objective: { type: "string", enum: [...ADS_CAMPAIGN_OBJECTIVES] },
    conversionGoal: { type: "string", enum: [...ADS_CONVERSION_GOALS] },
    conversionLocation: { type: "string", enum: [...ADS_CONVERSION_LOCATIONS] },
    bidStrategy: { type: "string", enum: [...ADS_BID_STRATEGIES] },
    offer: { type: "string", minLength: 1, maxLength: 500 },
    destinationUrl: { type: "string", maxLength: 2_000 },
    urlExpansion: { type: "boolean" },
    urlExclusions: { type: "array", maxItems: 20, items: { type: "string", maxLength: 300 } },
    targetLocations: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", minLength: 1, maxLength: 120 } },
    targetAudiences: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", minLength: 1, maxLength: 160 } },
    languages: { type: "array", minItems: 1, maxItems: 10, items: { type: "string", minLength: 2, maxLength: 40 } },
    googleSearchPartners: { type: "boolean" },
    googleDisplayExpansion: { type: "boolean" },
    metaAudienceExpansion: { type: "boolean" },
    metaPlacements: { type: "array", maxItems: 0, items: { type: "string" } },
    trackingParameters: { type: "string", maxLength: 500 },
    primaryText: { type: "string", minLength: 3, maxLength: 800 },
    imageUrl: { type: "string", maxLength: 0 },
    creativeUrl: { type: "string", maxLength: 0 },
    creativeType: { type: "string", enum: ["image", "video"] },
    mediaStrategy: { type: "string", enum: [...ADS_MEDIA_STRATEGIES] },
    mediaBrief: { type: "string", minLength: 10, maxLength: 1_000 },
    callToAction: { type: "string", minLength: 1, maxLength: 80 },
    headlines: { type: "array", minItems: 1, maxItems: 1, items: { type: "string", minLength: 3, maxLength: 100 } },
    descriptions: { type: "array", minItems: 1, maxItems: 1, items: { type: "string", minLength: 3, maxLength: 800 } },
    keywords: { type: "array", maxItems: 20, items: { type: "string", maxLength: 80 } },
    negativeKeywords: { type: "array", maxItems: 40, items: { type: "string", maxLength: 80 } },
    rationale: { type: "string", minLength: 10, maxLength: 4_000 },
    channelDraft: {
      type: "object",
      additionalProperties: false,
      required: [
        "schemaVersion", "channel", "name", "budget", "audience", "objectiveType",
        "intendedPromotionType", "targetingMode", "creativeType", "conversionEvent", "creative",
      ],
      properties: {
        schemaVersion: { type: "integer", enum: [1] },
        channel: { type: "string", enum: ["pinterest"] },
        name: { type: "string", minLength: 3, maxLength: 100 },
        budget: {
          type: "object",
          additionalProperties: false,
          required: ["amount", "currency", "period", "level"],
          properties: {
            amount: { type: "number", minimum: 5, maximum: 500, multipleOf: 0.01 },
            currency: { type: "string", enum: ["EUR"] },
            period: { type: "string", enum: ["daily", "lifetime"] },
            level: { type: "string", enum: ["campaign", "ad_group"] },
          },
        },
        audience: {
          type: "object",
          additionalProperties: false,
          required: ["locationBriefs", "audienceBrief"],
          properties: {
            locationBriefs: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", minLength: 1, maxLength: 120 } },
            audienceBrief: { type: "string", minLength: 3, maxLength: 500 },
          },
        },
        objectiveType: { type: "string", enum: ["AWARENESS", "CONSIDERATION", "VIDEO_COMPLETION", "SALES", "LEADS"] },
        intendedPromotionType: { type: "string", enum: ["STANDARD_AD", "CATALOG"] },
        targetingMode: { type: "string", enum: ["automatic", "interests", "keywords", "audiences"] },
        creativeType: { type: ["string", "null"], enum: ["REGULAR", "VIDEO", "MAX_VIDEO", "CAROUSEL", null] },
        conversionEvent: { type: ["string", "null"], enum: ["CHECKOUT", "ADD_TO_CART", "SIGNUP", "LEAD", null] },
        creative: {
          type: "object",
          additionalProperties: false,
          required: ["pinTitle", "pinDescription", "visualBrief", "destinationUrl"],
          properties: {
            pinTitle: { type: "string", minLength: 3, maxLength: 100 },
            pinDescription: { type: "string", minLength: 3, maxLength: 800 },
            visualBrief: { type: "string", minLength: 10, maxLength: 1_000 },
            destinationUrl: { type: "string", maxLength: 2_000 },
          },
        },
      },
    },
  };
  return {
    name: "inrcy_pinterest_ads_campaign_plan",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: Object.keys(properties),
      properties,
    },
  };
}

/** An explicit native brief lets the strategist reason beyond Google/Meta. */
export function plannedAdsChannelPlanPrompt(channel: PlannedAdsChannel): string {
  const channelInstructions: Record<PlannedAdsChannel, string> = {
    linkedin: `LinkedIn Ads : cible une audience professionnelle justifiée par l’activité. channelDraft.objectiveType = BRAND_AWARENESS | WEBSITE_VISIT | ENGAGEMENT | VIDEO_VIEW | LEAD_GENERATION | WEBSITE_CONVERSION. channelDraft.format = STANDARD_UPDATE | SINGLE_VIDEO | CAROUSEL | TEXT_AD | LEAD_GENERATION_FORM_SPONSORED_CONTENT ; VIDEO_VIEW exige SINGLE_VIDEO et LEAD_GENERATION exige LEAD_GENERATION_FORM_SPONSORED_CONTENT. channelDraft.locale = {country:"FR",language:"fr"} seulement si ces paramètres conviennent aux zones et à la langue connues. channelDraft.creative = {introText,headline,mediaBrief,destinationUrl,leadFormBrief}. introText : accroche et argument professionnel concrets (300 caractères au plus) ; headline : 200 caractères au plus. Pour LEAD_GENERATION, décris le formulaire et son intérêt dans leadFormBrief.`,
    tiktok: `TikTok Ads : ne propose que la voie vidéo préparée dans l’application. channelDraft.objectiveType = REACH | VIDEO_VIEWS | TRAFFIC | WEB_CONVERSIONS | LEAD_GENERATION | ENGAGEMENT ; format="video" ; destinationKind="website" | "instant_form" | "profile" ; placementIntent="automatic" | "tiktok_only" ; optimizationIntent="reach" | "views" | "clicks" | "conversions" | "leads" | "engagement". channelDraft.creative = {adText,videoBrief,destinationUrl,conversionEventBrief}. adText : 100 caractères au plus. videoBrief : scène verticale, déroulé, démonstration et appel à l’action réalistes ; aucun média existant ne doit être supposé. Pour WEB_CONVERSIONS, nomme l’action observable dans conversionEventBrief sans prétendre qu’un Pixel existe.`,
    pinterest: `Pinterest Ads : fonde l’idée créative sur une recherche d’inspiration plausible pour cette activité. Remplis explicitement tout le channelDraft Pinterest ; un plan racine générique sans brief natif est invalide. channelDraft.objectiveType = AWARENESS | CONSIDERATION | VIDEO_COMPLETION | SALES | LEADS ; intendedPromotionType="STANDARD_AD" | "CATALOG" ; targetingMode="automatic" | "interests" | "keywords" | "audiences". Utilise automatic pour le parcours publiable actuel et retourne alors obligatoirement keywords=[] : ce mode s’appuie sur le contenu du Pin et les zones fiables, pas sur des mots-clés proposés par le moteur. Pour le ciblage géographique, targetLocations et channelDraft.audience.locationBriefs conservent les zones locales sélectionnées dans le contexte. Ne remplace jamais une ville ou une région par le pays du siège. Leur disponibilité sera vérifiée auprès de Pinterest avant publication. interests, keywords et audiences restent des intentions de brouillon tant que leurs identifiants Pinterest n’ont pas été résolus ; pour ces trois modes manuels seulement, conserve les signaux utiles dans keywords. Choisis CATALOG uniquement avec CONSIDERATION ou SALES, et seulement si des produits et un catalogue sont attestés ; LEADS reste STANDARD_AD. Sinon choisis STANDARD_AD. Pour STANDARD_AD, creativeType=REGULAR | VIDEO | MAX_VIDEO | CAROUSEL ; VIDEO_COMPLETION requiert VIDEO ou MAX_VIDEO. Pour CATALOG, mets creativeType à null. Pour SALES, conversionEvent=CHECKOUT | ADD_TO_CART ; pour LEADS, SIGNUP | LEAD ; sinon mets conversionEvent à null. Sans preferredDestinationUrl HTTPS fiable, choisis AWARENESS (ou VIDEO_COMPLETION avec une vraie stratégie vidéo), jamais CONSIDERATION, SALES ou LEADS. Pour le parcours publiable actuel, privilégie STANDARD_AD + REGULAR avec AWARENESS ou CONSIDERATION ; les autres combinaisons restent révisables et enregistrables en brouillon. channelDraft.creative = {pinTitle,pinDescription,visualBrief,destinationUrl}. pinTitle : 100 caractères au plus ; pinDescription : 800 caractères au plus ; visualBrief décrit le format visuel, la scène et la preuve vérifiée, pas un Pin déjà publié. Le budget est une hypothèse quotidienne explicite ; le statut de lancement Active ou Paused, la date de fin, l’enchère MAX_BID, le billable_event et placement_group=ALL sont contrôlés dans les étapes finales et ne doivent pas être inventés dans channelDraft.`,
    x: `X Ads : distingue conversation pertinente et publicité intrusive. channelDraft.objective = reach | video_views | website_traffic | website_conversions | engagement ; format=text | image | video ; video_views requiert video ; targetingMode=broad | keywords | interests | follower_lookalikes ; keywords est une liste courte, concrète, uniquement si targetingMode=keywords. channelDraft.creative = {postText,mediaBrief,destinationUrl}. postText : un vrai texte de publication de 280 caractères maximum, en comptant chaque URL pour 23 caractères. mediaBrief décrit le visuel/vidéo nécessaire quand format n’est pas text. Ne prétends jamais qu’un post publicitaire, un financement ou un événement de conversion existe déjà.`,
  };

  const publicationContext = "C’est un BROUILLON complet destiné au contrôle humain puis, seulement pour une combinaison prise en charge et après validation finale, à une publication réelle. Tu ne publies rien toi-même et tu ne prétends jamais que la campagne est déjà créée ou diffusée. Les accès et ressources du compte sont vérifiés par le connecteur avant publication.";

  return `Tu es le stratège senior d’iNr’ADS. Construis en français une proposition de campagne ${channel} spécifique et utile à un professionnel. ${publicationContext}

Analyse silencieusement l’iNrADN, l’offre réellement attestée, les besoins et objections du public, les zones connues, l’objectif de conversion, la destination, le format du média à produire et la mesure possible. Si l’utilisateur fixe un objectif, respecte-le après vérification de cohérence ; sinon choisis l’opportunité la plus crédible. Utilise l’historique uniquement pour varier l’angle, jamais comme preuve. Ne promets aucun résultat, n’invente aucun prix, certification, preuve, lieu, média existant, compte, catalogue, Pin, Pixel ou ID externe. Une URL doit venir textuellement du contexte, sinon laisse-la vide. Aucun CPA/ROAS cible ou prévision chiffrée sans données vérifiées. Préfère un message précis et authentique à un slogan générique.

Réponds uniquement en JSON. Retourne les mêmes champs principaux que le studio : brand, name, campaignType, objective, conversionGoal, conversionLocation, bidStrategy, offer, destinationUrl, urlExpansion, urlExclusions, targetLocations, targetAudiences, languages, googleSearchPartners, googleDisplayExpansion, metaAudienceExpansion, metaPlacements, trackingParameters, primaryText, imageUrl, creativeUrl, creativeType, mediaStrategy, mediaBrief, callToAction, headlines, descriptions, keywords, negativeKeywords, rationale ; ajoute obligatoirement channelDraft. campaignType="generic" ; objective=leads | sales | website_traffic | awareness | engagement | app_promotion ; conversionGoal=quote_request | lead_form | phone_call | website_visit | purchase | message | store_visit | custom ; conversionLocation=website | instant_form | messaging | phone | store ; bidStrategy=maximize_conversions | maximize_clicks | maximize_value | manual_review ; mediaStrategy=search_text | image | video | mixed | product_feed ; creativeType=image | video. Les flags Google/Meta sont false et metaPlacements=[]. imageUrl et creativeUrl sont vides. trackingParameters est une chaîne UTM ou vide, pas un objet. rationale relie en deux ou trois phrases offre, audience, format, action mesurable et limites à vérifier.

channelDraft est un objet avec {schemaVersion:1,channel:"${channel}",name,budget:{amount,currency:"EUR",period:"daily",level:"campaign" | "ad_group"},audience:{locationBriefs,audienceBrief}, ...champs spécifiques ci-dessous}. Propose amount de 5 à 500 € comme hypothèse quotidienne à faire valider par le professionnel, jamais comme budget engagé. N’ajoute PAS externalRefs : aucun ID de compte, média, géographie, conversion ou autre ressource n’est vérifié par ce moteur. Les zones locationBriefs doivent venir uniquement du contexte connu. audienceBrief formule le public pertinent et sa motivation ; ne cible aucune caractéristique personnelle sensible.

${channelInstructions[channel]}
${channel === "pinterest" ? "Qualité Pinterest : choisis un angle utile à une personne qui prépare un projet, compare des idées ou cherche une inspiration liée au service attesté ; ne copie pas simplement une annonce Search. Le titre nomme ce qu’elle va découvrir et la description apporte un conseil ou un usage concret, sans accumulation de mots-clés. visualBrief précise une image portrait 4:5 (1080×1350), format généré par le studio, le sujet, son contexte d’usage, la composition et un détail visuel qui rend l’offre compréhensible. Pas de texte incrusté, de faux avant/après ni de preuve non attestée. Une illustration générée n'est pas une réalisation client : ne la décris pas comme une photo de chantier attesté. pinDescription est le texte réellement publié : il reprend les mêmes faits vérifiés que primaryText, sans enrichir les caractéristiques, dimensions, finitions ou lieu d'une réalisation. N'ajoute ni « mat », ni « du sol au plafond », ni une commune de réalisation si ces détails ne sont pas fournis. Justifie l’adéquation de cet angle à l’activité dans rationale." : ""}

${ADS_PLAN_EDITORIAL_INSTRUCTIONS}
${ADS_PLAN_STRATEGY_INSTRUCTIONS}
rationale utilise un français métier : « image unique », « visites du site », « maximisation des clics ». Aucun nom de champ ou code API tel que REGULAR, website_traffic, CONSIDERATION ou maximize_clicks dans l’explication destinée au professionnel.
${channel === "pinterest" ? "Une campagne Pinterest prépare ici une seule épingle : headlines contient exactement [channelDraft.creative.pinTitle] et descriptions contient exactement [channelDraft.creative.pinDescription]. primaryText est exactement pinDescription. Ne fournis pas une liste de variantes dont seule la première serait publiée." : ""}

Les champs principaux du studio doivent refléter exactement le même choix que channelDraft. Respecte les longueurs du canal, pas les limites Google de 30/90 : LinkedIn headlines 200/descriptions 300, TikTok 100/100, Pinterest 100/800, X 280/280. primaryText respecte aussi la limite du studio : LinkedIn 300, TikTok 100, Pinterest 800, X 280 caractères. Fournis un primaryText et une description exploitables, des idées de média détaillées et une audience argumentée. Les mots-clés ne sont utiles que si le ciblage/format les justifie. Si des données indispensables manquent, laisse-les vides ; n’invente pas pour compléter le JSON.`;
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
  const trustedLocations = selectAdsPlanLocations(context);
  const planContext = context.provider === "pinterest"
    ? { ...context, locations: normalizePinterestAutomaticLocations(trustedLocations, context.country) }
    : { ...context, locations: trustedLocations };
  const channelDraft = normalizePlannedAdsChannelDraft(raw.channelDraft, planContext, raw);
  const rawKeywords = list(raw.keywords, 20, 80);
  const automaticPinterestTargeting = context.provider === "pinterest" && (
    (channelDraft?.channel === "pinterest" && channelDraft.targetingMode === "automatic")
    || enumToken(record(raw.channelDraft).targetingMode, "lower") === "automatic"
  );
  const native = plannedCopy(channelDraft);
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
  const headlines = context.provider === "pinterest"
    ? adsCopyList(native.headline ? [native.headline] : raw.headlines, 1)
    : adsCopyList(raw.headlines, 15);
  const descriptions = context.provider === "pinterest"
    ? adsCopyList(native.description ? [native.description] : raw.descriptions, 1)
    : adsCopyList(raw.descriptions, 4);
  const offer = adsCopyText(raw.offer) || adsCopyText(fallbackOffer);
  const fallbackActions: Record<AdsConversionGoal, string> = {
    quote_request: "Demander un devis", lead_form: "Nous contacter", phone_call: "Nous appeler",
    website_visit: "En savoir plus", purchase: "Découvrir l’offre", message: "Nous écrire",
    store_visit: "Nous rendre visite", custom: "En savoir plus",
  };
  const callToAction = adsCopyText(raw.callToAction)
    || (context.provider === "meta" ? "En savoir plus" : fallbackActions[conversionGoal]);
  const primaryText = (context.provider === "pinterest" ? native.primaryText : "") || adsCopyText(raw.primaryText) || native.primaryText
    || (context.provider === "google" ? descriptions.join(" ") || [offer, callToAction].filter(Boolean).join(". ") : "");

  return {
    brand: adsCopyText(raw.brand) || adsCopyText(context.companyName),
    name: adsCopyText(raw.name) || channelDraft?.name || "",
    campaignType,
    objective,
    conversionGoal,
    conversionLocation,
    bidStrategy,
    offer,
    destinationUrl: httpsUrl(raw.destinationUrl) || httpsUrl(context.destinationUrl),
    urlExpansion: raw.urlExpansion !== false,
    urlExclusions: list(raw.urlExclusions, 20, 300).filter((url) => Boolean(httpsUrl(url))),
    targetLocations: context.provider === "pinterest"
      ? normalizePinterestAutomaticLocations(
        trustedLocations,
        context.country,
      )
      : trustedLocations,
    targetAudiences: list(raw.targetAudiences, 20, 160).length
      ? list(raw.targetAudiences, 20, 160)
      : list(context.audiences, 20, 160),
    languages: list(raw.languages, 10, 40).length ? list(raw.languages, 10, 40) : ["fr"],
    googleSearchPartners: raw.googleSearchPartners === true,
    googleDisplayExpansion: raw.googleDisplayExpansion === true,
    metaAudienceExpansion: raw.metaAudienceExpansion !== false,
    metaPlacements,
    trackingParameters: clean(raw.trackingParameters, 500),
    primaryText,
    // The planning endpoint receives no verified media URL. Do not turn a
    // model-invented link into an ad asset; Studio or the professional adds it.
    imageUrl: "",
    creativeUrl: "",
    creativeType: creativeTypeForStrategy(mediaStrategy, rawCreativeType),
    mediaStrategy,
    mediaBrief: adsCopyText(raw.mediaBrief) || native.mediaBrief,
    callToAction,
    headlines: headlines.length ? headlines : native.headline ? [native.headline] : [],
    descriptions: descriptions.length ? descriptions : native.description ? [native.description] : [],
    // Performance+ targeting uses the Pin and trusted locations. Keeping
    // model-suggested keywords here would make an otherwise live-compatible
    // Pinterest plan fail the publisher preflight. Manual targeting modes keep
    // their planning signals unchanged for later provider-side resolution.
    keywords: automaticPinterestTargeting ? [] : rawKeywords,
    negativeKeywords: list(raw.negativeKeywords, 40, 80),
    rationale: cleanRationale(raw.rationale),
    ...(channelDraft ? { channelDraft } : {}),
  };
}

export function isUsableAdsCampaignPlan(plan: AdsCampaignPlan) {
  return Boolean(plan.name && plan.offer && (plan.primaryText || plan.headlines.length >= 3));
}

export type AdsCampaignPlanReview = {
  reviewable: boolean;
  issueCodes: string[];
};

/** Safe diagnostics only: codes describe structure, never generated copy. */
export function assessAdsCampaignPlanReview(
  plan: AdsCampaignPlan,
  provider: AdsChannelId,
): AdsCampaignPlanReview {
  const issues: string[] = [...adsPlanCopyIssues(plan, provider), ...adsPlanStrategyIssues(plan, provider)];
  if (!plan.name) issues.push("missing_name");
  if (!plan.offer) issues.push("missing_offer");
  if (!plan.primaryText) issues.push("missing_primary_text");
  if (isPlannedAdsChannel(provider)) {
    if (plan.campaignType !== "generic") issues.push("invalid_planned_campaign_type");
    if (!plan.channelDraft) {
      issues.push("missing_native_channel_draft");
    } else if (plan.channelDraft.channel !== provider) {
      issues.push("native_channel_mismatch");
    } else {
      for (const issue of assessAdsChannelDraft(plan.channelDraft).briefIssues) {
        issues.push(`native_${issue.code}`);
      }
    }
  } else if (plan.campaignType === "search") {
    if (plan.headlines.length < 6) issues.push("search_headlines_incomplete");
    if (plan.descriptions.length < 3) issues.push("search_descriptions_incomplete");
    if (plan.keywords.length < 6) issues.push("search_keywords_incomplete");
  } else if (plan.campaignType.startsWith("meta_") && (!plan.primaryText || !plan.callToAction)) {
    issues.push("meta_copy_incomplete");
  }
  return { reviewable: issues.length === 0, issueCodes: [...new Set(issues)] };
}

/**
 * Explains why a raw model answer was rejected after trusted-data
 * normalization. Values, prompts and professional content are intentionally
 * absent from the returned diagnostics.
 */
export function adsCampaignPlanValidationIssueCodes(
  value: unknown,
  context: PlanContext,
): string[] {
  const raw = record(value);
  const plan = normalizeAdsCampaignPlan(raw, context);
  const issues = assessAdsCampaignPlanReview(plan, context.provider).issueCodes;
  if (!isPlannedAdsChannel(context.provider)) return issues;
  const builtDraft = buildPlannedAdsChannelDraft(raw.channelDraft, context, raw);
  if (!builtDraft) return [...new Set([...issues, "native_channel_mismatch"])];
  const nativeIssues = assessAdsChannelDraft(builtDraft).briefIssues.map((issue) => `native_${issue.code}`);
  return [...new Set([...issues.filter((issue) => issue !== "missing_native_channel_draft"), ...nativeIssues])];
}

/** A model answer must contain a valid native brief before review, not merely JSON. */
export function isReviewableAdsCampaignPlan(plan: AdsCampaignPlan, provider: AdsChannelId): boolean {
  return assessAdsCampaignPlanReview(plan, provider).reviewable;
}
