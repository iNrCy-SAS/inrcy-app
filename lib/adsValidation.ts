export const ADS_CHANNELS = [
  { id: "meta", label: "Meta Ads", format: "Trafic · Facebook · Instagram" },
  { id: "google", label: "Google Ads", format: "Recherche · annonces textuelles" },
  { id: "linkedin", label: "LinkedIn Ads", format: "Audience professionnelle" },
  { id: "tiktok", label: "TikTok Ads", format: "Vidéo · communautés" },
  { id: "pinterest", label: "Pinterest Ads", format: "Découverte visuelle" },
  { id: "x", label: "X Ads", format: "Conversations · actualité" },
] as const;

export const ADS_OAUTH_PROVIDERS = ["meta", "google"] as const;

export type AdsChannelId = (typeof ADS_CHANNELS)[number]["id"];
export type AdsProvider = (typeof ADS_OAUTH_PROVIDERS)[number];

/**
 * The campaign studio keeps the marketing decision separate from the platform
 * connector. This lets a professional prepare a complete brief today, even
 * when a specific Google/Meta campaign type is not enabled for publishing yet.
 */
export const ADS_CREATION_MODES = ["manual", "inrcy"] as const;
export const ADS_CAMPAIGN_TYPES = [
  "search",
  "performance_max",
  "display",
  "video",
  "demand_gen",
  "shopping",
  "meta_sales",
  "meta_leads",
  "meta_traffic",
  "meta_awareness",
  "generic",
] as const;
export const ADS_CAMPAIGN_OBJECTIVES = ["leads", "sales", "website_traffic", "awareness", "engagement", "app_promotion"] as const;
export const ADS_CONVERSION_GOALS = ["quote_request", "lead_form", "phone_call", "website_visit", "purchase", "message", "store_visit", "custom"] as const;
export const ADS_CONVERSION_LOCATIONS = ["website", "instant_form", "messaging", "phone", "store"] as const;
export const ADS_BID_STRATEGIES = ["maximize_conversions", "maximize_clicks", "maximize_value", "target_cpa", "target_roas", "manual_review"] as const;
export const ADS_MEDIA_STRATEGIES = ["search_text", "image", "video", "mixed", "product_feed"] as const;
export const ADS_META_PLACEMENTS = ["facebook_feed", "instagram_feed", "stories", "reels", "messenger"] as const;

export type AdsCreationMode = (typeof ADS_CREATION_MODES)[number];
export type AdsCampaignType = (typeof ADS_CAMPAIGN_TYPES)[number];
export type AdsCampaignObjective = (typeof ADS_CAMPAIGN_OBJECTIVES)[number];
export type AdsConversionGoal = (typeof ADS_CONVERSION_GOALS)[number];
export type AdsConversionLocation = (typeof ADS_CONVERSION_LOCATIONS)[number];
export type AdsBidStrategy = (typeof ADS_BID_STRATEGIES)[number];
export type AdsMediaStrategy = (typeof ADS_MEDIA_STRATEGIES)[number];
export type AdsMetaPlacement = (typeof ADS_META_PLACEMENTS)[number];

export function isAdsChannelId(value: unknown): value is AdsChannelId {
  return ADS_CHANNELS.some((channel) => channel.id === value);
}

export function isAdsProvider(value: unknown): value is AdsProvider {
  return value === "meta" || value === "google";
}

function includes<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

export function defaultAdsCampaignType(provider: AdsChannelId): AdsCampaignType {
  if (provider === "google") return "search";
  if (provider === "meta") return "meta_leads";
  return "generic";
}

export type AdsCampaignInput = {
  provider: AdsChannelId;
  creationMode: AdsCreationMode;
  campaignType: AdsCampaignType;
  objective: AdsCampaignObjective;
  conversionGoal: AdsConversionGoal;
  conversionLocation: AdsConversionLocation;
  bidStrategy: AdsBidStrategy;
  adAccountId: string;
  accountCurrency: "EUR";
  name: string;
  offer: string;
  dailyBudgetEuros: number;
  endDate: string;
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
  creativeUrl?: string;
  creativeType?: "image" | "video";
  mediaStrategy: AdsMediaStrategy;
  mediaBrief: string;
  callToAction: string;
  pageId: string;
  headlines: string[];
  descriptions: string[];
  keywords: string[];
  negativeKeywords: string[];
  noSpecialCategoryConfirmed: boolean;
  notEuPoliticalConfirmed: boolean;
};

export type AdsAccount = {
  id: string;
  name: string;
  currency: string;
  provider: AdsProvider;
  status?: string;
  /** Google manager account through which this advertiser account is accessible. */
  loginCustomerId?: string;
};

const clean = (value: unknown) => String(value ?? "").trim();

function textList(value: unknown, maxItems: number, maxLength: number): string[] | null {
  const list = Array.isArray(value) ? value : String(value ?? "").split("\n");
  const items = list.map((item) => clean(item)).filter(Boolean);
  if (items.length > maxItems || items.some((item) => item.length > maxLength)) return null;
  return Array.from(new Set(items));
}

function enumList<T extends readonly string[]>(values: T, value: unknown, maxItems: number): T[number][] | null {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(/[\n,;]/);
  if (raw.length > maxItems) return null;
  const items: T[number][] = [];
  for (const candidate of raw) {
    const item = clean(candidate);
    if (!item) continue;
    if (!includes(values, item)) return null;
    if (!items.includes(item)) items.push(item);
  }
  return items;
}

function httpsUrl(value: unknown): string | null {
  try {
    const raw = clean(value);
    if (raw.length > 2000) return null;
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * A campaign may reference a private iNrCy library item while it is being
 * prepared. The publishing connector verifies its signed token again on the
 * server, then gives the advertising platform a short-lived Storage URL.
 * Accepting only this exact internal path here keeps drafts flexible without
 * accepting arbitrary relative URLs.
 */
function mediaLibraryContentUrl(value: unknown): string | null {
  const raw = clean(value);
  if (!raw || raw.length > 2_000 || !raw.startsWith("/")) return null;
  try {
    const url = new URL(raw, "https://inrcy-media.local");
    if (url.origin !== "https://inrcy-media.local") return null;
    if (!/^\/api\/media-library\/items\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/content$/i.test(url.pathname)) {
      return null;
    }
    const token = url.searchParams.get("token") || "";
    return /^[A-Za-z0-9_-]{16,128}$/.test(token) ? raw : null;
  } catch {
    return null;
  }
}

function adsMediaUrl(value: unknown): string | null {
  return httpsUrl(value) || mediaLibraryContentUrl(value);
}

export function parseAdsCampaignInput(value: unknown, options: { purpose?: "draft" | "publish" } = {}): { draft: AdsCampaignInput | null; error: string | null } {
  const purpose = options.purpose || "publish";
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const provider = isAdsChannelId(raw.provider) ? raw.provider : null;
  if (!provider) return { draft: null, error: "Choisissez un canal publicitaire disponible." };
  if (purpose === "publish" && !isAdsProvider(provider)) {
    return { draft: null, error: "La connexion et la publication de ce canal ne sont pas encore disponibles." };
  }

  const rawAccountId = clean(raw.adAccountId);
  const adAccountId = rawAccountId.replace(/^act_/, "").replace(/-/g, "");
  if (purpose === "publish" && !/^\d{5,25}$/.test(adAccountId)) return { draft: null, error: "Sélectionnez un compte publicitaire connecté." };
  if (adAccountId && !/^\d{5,25}$/.test(adAccountId)) return { draft: null, error: "L’identifiant du compte publicitaire est invalide." };
  if (!isAdsProvider(provider) && adAccountId) return { draft: null, error: "Connectez ce canal dans iNr’ADS avant d’associer un compte publicitaire." };
  if (raw.accountCurrency !== "EUR") return { draft: null, error: "Cette première version accepte les comptes publicitaires en EUR uniquement." };

  const creationMode: AdsCreationMode = includes(ADS_CREATION_MODES, raw.creationMode) ? raw.creationMode : "manual";
  const campaignType: AdsCampaignType = includes(ADS_CAMPAIGN_TYPES, raw.campaignType) ? raw.campaignType : defaultAdsCampaignType(provider);
  const objective: AdsCampaignObjective = includes(ADS_CAMPAIGN_OBJECTIVES, raw.objective) ? raw.objective : "leads";
  const conversionGoal: AdsConversionGoal = includes(ADS_CONVERSION_GOALS, raw.conversionGoal) ? raw.conversionGoal : "quote_request";
  const conversionLocation: AdsConversionLocation = includes(ADS_CONVERSION_LOCATIONS, raw.conversionLocation) ? raw.conversionLocation : "website";
  const bidStrategy: AdsBidStrategy = includes(ADS_BID_STRATEGIES, raw.bidStrategy) ? raw.bidStrategy : "maximize_conversions";

  const name = clean(raw.name);
  if ((purpose === "publish" && name.length < 3) || name.length > 100) return { draft: null, error: "Le nom de campagne doit contenir entre 3 et 100 caractères." };
  const offer = clean(raw.offer);
  if (offer.length > 500) return { draft: null, error: "L’offre mise en avant est trop longue." };

  const dailyBudgetEuros = Number(raw.dailyBudgetEuros);
  if (!Number.isFinite(dailyBudgetEuros) || dailyBudgetEuros < 5 || dailyBudgetEuros > 500 || Math.abs(Math.round(dailyBudgetEuros * 100) - dailyBudgetEuros * 100) > 0.000001) {
    return { draft: null, error: "Le budget journalier doit être compris entre 5 et 500 €, avec deux décimales maximum." };
  }

  const endDate = clean(raw.endDate);
  const endTime = Date.parse(`${endDate}T23:59:59Z`);
  const daysUntilEnd = (endTime - Date.now()) / 86_400_000;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || !Number.isFinite(endTime) || daysUntilEnd < 1 || daysUntilEnd > 90) {
    return { draft: null, error: "Choisissez une fin de campagne entre demain et dans 90 jours." };
  }

  const rawDestinationUrl = clean(raw.destinationUrl);
  const destinationUrl = rawDestinationUrl ? httpsUrl(rawDestinationUrl) : null;
  if (rawDestinationUrl && !destinationUrl) return { draft: null, error: "Renseignez une URL de destination HTTPS valide." };
  if (purpose === "publish" && !destinationUrl) return { draft: null, error: "Renseignez une URL de destination HTTPS valide." };
  const urlExpansion = raw.urlExpansion !== false;
  const urlExclusions = textList(raw.urlExclusions, 20, 300);
  if (!urlExclusions) return { draft: null, error: "Vérifiez les URL à exclure." };
  if (urlExclusions.some((url) => !httpsUrl(url))) return { draft: null, error: "Les URL à exclure doivent être des liens HTTPS valides." };

  const targetLocations = textList(raw.targetLocations, 20, 120);
  const targetAudiences = textList(raw.targetAudiences, 20, 160);
  const languages = textList(raw.languages, 10, 40);
  const metaPlacements = enumList(ADS_META_PLACEMENTS, raw.metaPlacements, 8);
  if (!targetLocations || !targetAudiences || !languages || !metaPlacements) return { draft: null, error: "Vérifiez vos zones, audiences, langues et placements." };
  const googleSearchPartners = raw.googleSearchPartners === true;
  const googleDisplayExpansion = raw.googleDisplayExpansion === true;
  const metaAudienceExpansion = raw.metaAudienceExpansion !== false;
  const trackingParameters = clean(raw.trackingParameters);
  if (trackingParameters.length > 500) return { draft: null, error: "Les paramètres de suivi sont trop longs." };

  const primaryText = clean(raw.primaryText);
  const rawImageUrl = clean(raw.imageUrl);
  const imageUrl = rawImageUrl ? adsMediaUrl(rawImageUrl) : null;
  if (rawImageUrl && !imageUrl) return { draft: null, error: "Le visuel doit provenir d’une URL HTTPS ou de votre médiathèque iNrCy." };
  const rawCreativeUrl = clean(raw.creativeUrl);
  const creativeUrl = rawCreativeUrl ? adsMediaUrl(rawCreativeUrl) : null;
  if (rawCreativeUrl && !creativeUrl) return { draft: null, error: "Le média doit provenir d’une URL HTTPS ou de votre médiathèque iNrCy." };
  const creativeType = raw.creativeType === "video" ? "video" : "image";
  const mediaStrategy: AdsMediaStrategy = includes(ADS_MEDIA_STRATEGIES, raw.mediaStrategy)
    ? raw.mediaStrategy
    : provider === "google" ? "search_text" : "image";
  const mediaBrief = clean(raw.mediaBrief);
  if (mediaBrief.length > 1_000) return { draft: null, error: "Les indications média sont trop longues." };
  const callToAction = clean(raw.callToAction);
  if (callToAction.length > 80) return { draft: null, error: "L’appel à l’action est trop long." };
  const pageId = clean(raw.pageId);
  const headlineLimit = provider === "linkedin" ? 200 : provider === "pinterest" ? 100 : provider === "x" ? 280 : provider === "tiktok" ? 100 : 30;
  const descriptionLimit = provider === "linkedin" ? 300 : provider === "pinterest" ? 800 : provider === "x" ? 280 : provider === "tiktok" ? 100 : 90;
  const headlines = textList(raw.headlines, 15, headlineLimit);
  const descriptions = textList(raw.descriptions, 4, descriptionLimit);
  const keywords = textList(raw.keywords, 20, 80);
  const negativeKeywords = textList(raw.negativeKeywords, 40, 80);
  if (!headlines || !descriptions || !keywords || !negativeKeywords) {
    return { draft: null, error: "Vérifiez le nombre et la longueur des titres, descriptions et mots-clés." };
  }
  const noSpecialCategoryConfirmed = raw.noSpecialCategoryConfirmed === true;
  const notEuPoliticalConfirmed = raw.notEuPoliticalConfirmed === true;

  if (purpose === "publish" && provider === "meta") {
    if (primaryText.length < 10 || primaryText.length > 500) return { draft: null, error: "Le texte Meta doit contenir entre 10 et 500 caractères." };
    if (!imageUrl) return { draft: null, error: "Meta requiert un visuel HTTPS ou un média de votre médiathèque iNrCy." };
    if (!/^\d{5,30}$/.test(pageId)) return { draft: null, error: "Sélectionnez une Page Facebook autorisée pour cette annonce." };
    if (!noSpecialCategoryConfirmed) return { draft: null, error: "Confirmez que l’annonce Meta ne relève d’aucune catégorie publicitaire spéciale." };
  } else if (purpose === "publish" && provider === "google") {
    if (headlines.length < 3 || descriptions.length < 2 || keywords.length < 1) {
      return { draft: null, error: "Google Search requiert 3 titres, 2 descriptions et au moins un mot-clé." };
    }
    if (!notEuPoliticalConfirmed) {
      return { draft: null, error: "Confirmez que la campagne Google ne contient pas de publicité politique ciblant l’Union européenne." };
    }
  } else if (purpose === "publish") {
    return { draft: null, error: "La publication de ce canal n’est pas disponible." };
  }

  return {
    draft: {
      provider,
      creationMode,
      campaignType,
      objective,
      conversionGoal,
      conversionLocation,
      bidStrategy,
      adAccountId,
      accountCurrency: "EUR",
      name,
      offer,
      dailyBudgetEuros,
      endDate,
      destinationUrl: destinationUrl || "",
      urlExpansion,
      urlExclusions: urlExclusions || [],
      targetLocations: targetLocations || [],
      targetAudiences: targetAudiences || [],
      languages: languages?.length ? languages : ["fr"],
      googleSearchPartners,
      googleDisplayExpansion,
      metaAudienceExpansion,
      metaPlacements: metaPlacements || [],
      trackingParameters,
      primaryText,
      imageUrl: imageUrl || "",
      creativeUrl: creativeUrl || "",
      creativeType,
      mediaStrategy,
      mediaBrief,
      callToAction,
      pageId,
      headlines,
      descriptions,
      keywords,
      negativeKeywords: negativeKeywords || [],
      noSpecialCategoryConfirmed,
      notEuPoliticalConfirmed,
    },
    error: null,
  };
}
