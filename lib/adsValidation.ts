import { isPlannedAdsChannel } from "./adsChannelCapabilities.ts";
import {
  assessAdsChannelDraft,
  isLegacyPinterestAdsDraft,
  normalizeAdsChannelDraftCompatibility,
  type AdsChannelDraft,
} from "./adsChannelDrafts.ts";
import {
  adsChannelWizardSettingsFromBrief,
  adsChannelWizardSettingsMatchBrief,
  parseAdsChannelWizardSettings,
  type AdsChannelWizardSettings,
} from "./adsChannelWizardSettings.ts";
import {
  assessMetaCreativeAssetReadiness,
  metaCreativeAssetReadinessReason,
} from "./adsCampaignMediaPolicy.ts";

export const ADS_CHANNELS = [
  { id: "meta", label: "Meta Ads", format: "Trafic · Facebook · Instagram" },
  { id: "google", label: "Google Ads", format: "Recherche · annonces textuelles" },
  { id: "linkedin", label: "LinkedIn Ads", format: "Audience professionnelle" },
  { id: "tiktok", label: "TikTok Ads", format: "Vidéo · communautés" },
  { id: "pinterest", label: "Pinterest Ads", format: "Découverte visuelle" },
  { id: "x", label: "X Ads", format: "Conversations · actualité" },
] as const;

export const ADS_OAUTH_PROVIDERS = ["meta", "google"] as const;
export const ADS_DRAFT_ACCOUNT_CHANNELS = ["meta", "google", "linkedin", "pinterest"] as const;

export type AdsChannelId = (typeof ADS_CHANNELS)[number]["id"];
export type AdsProvider = (typeof ADS_OAUTH_PROVIDERS)[number];
export type AdsDraftAccountChannel = (typeof ADS_DRAFT_ACCOUNT_CHANNELS)[number];

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

export type AdsMetaCreativeAssets = {
  /** Dedicated 4:5 image for Facebook and Instagram Feed placements. */
  feedImageUrl: string;
  /** Dedicated 9:16 image shared by Facebook/Instagram Stories and Reels. */
  storyReelImageUrl: string;
};

export function isAdsChannelId(value: unknown): value is AdsChannelId {
  return ADS_CHANNELS.some((channel) => channel.id === value);
}

export function isAdsProvider(value: unknown): value is AdsProvider {
  return value === "meta" || value === "google";
}

/** Channels with account-bound campaign publication adapters. X remains draft-only. */
export function isAdsDraftAccountChannel(value: unknown): value is AdsDraftAccountChannel {
  return value === "meta" || value === "google" || value === "linkedin" || value === "pinterest";
}

function includes<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

export function defaultAdsCampaignType(provider: AdsChannelId): AdsCampaignType {
  if (provider === "google") return "search";
  // The first Meta connector creates a website-traffic campaign. Starting on
  // that format keeps both assisted and manual demos publishable by default;
  // the other objectives remain available as editable iNr'ADS drafts.
  if (provider === "meta") return "meta_traffic";
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
  /** Explicit Pinterest CPM/CPC max bid; ignored by other channel publishers. */
  pinterestBidEuros?: number;
  /** Verified LinkedIn choices. Provider ownership is always re-read before a mutation. */
  linkedinCampaignGroupId?: string;
  linkedinOrganizationUrn?: string;
  linkedinGeoTargets?: Array<{ urn: string; name: string }>;
  linkedinBidEuros?: number;
  linkedinPoliticalIntentConfirmed?: boolean;
  linkedinTargetingNoticeAcknowledged?: boolean;
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
  metaCreativeAssets: AdsMetaCreativeAssets;
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
  /** Rich planning brief generated for the channel. Never trusted as an API publish payload. */
  channelDraft?: AdsChannelDraft;
  /** Editable native planning choices, without provider account or asset IDs. */
  channelSettings?: AdsChannelWizardSettings;
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

/**
 * An advertiser can only be associated when the connector can actually use it.
 * Meta exposes numeric account_status values and only `1` means ACTIVE.
 */
export function adsAccountAssociationIssue(account: AdsAccount): string | null {
  if (account.currency.trim().toUpperCase() !== "EUR") return "devise non prise en charge";
  if (account.provider === "meta" && String(account.status || "").trim() !== "1") {
    return "compte Meta inactif ou restreint";
  }
  return null;
}

export function adsAccountCanBeAssociated(account: AdsAccount): boolean {
  return adsAccountAssociationIssue(account) === null;
}

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

function parseMetaCreativeAssets(
  value: unknown,
  provider: AdsChannelId,
  legacyImageUrl: string,
): { assets: AdsMetaCreativeAssets | null; error: string | null } {
  const empty: AdsMetaCreativeAssets = { feedImageUrl: "", storyReelImageUrl: "" };
  if (value === undefined || value === null) {
    return {
      assets: provider === "meta" ? { ...empty, feedImageUrl: legacyImageUrl } : empty,
      error: null,
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { assets: null, error: "Les créations Meta Feed et Story/Reel sont invalides." };
  }
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => key !== "feedImageUrl" && key !== "storyReelImageUrl")) {
    return { assets: null, error: "Les créations Meta contiennent un champ inattendu." };
  }
  if ((raw.feedImageUrl !== undefined && typeof raw.feedImageUrl !== "string") ||
      (raw.storyReelImageUrl !== undefined && typeof raw.storyReelImageUrl !== "string")) {
    return { assets: null, error: "Les créations Meta Feed et Story/Reel sont invalides." };
  }
  const rawFeedImageUrl = clean(raw.feedImageUrl);
  const rawStoryReelImageUrl = clean(raw.storyReelImageUrl);
  if (provider !== "meta") {
    return rawFeedImageUrl || rawStoryReelImageUrl
      ? { assets: null, error: "Les créations Feed et Story/Reel sont réservées aux campagnes Meta Ads." }
      : { assets: empty, error: null };
  }
  const feedImageUrl = rawFeedImageUrl ? adsMediaUrl(rawFeedImageUrl) : null;
  const storyReelImageUrl = rawStoryReelImageUrl ? adsMediaUrl(rawStoryReelImageUrl) : null;
  if (rawFeedImageUrl && !feedImageUrl) {
    return { assets: null, error: "L’image Meta Feed doit provenir d’une URL HTTPS ou de votre médiathèque iNrCy." };
  }
  if (rawStoryReelImageUrl && !storyReelImageUrl) {
    return { assets: null, error: "L’image Meta Story/Reel doit provenir d’une URL HTTPS ou de votre médiathèque iNrCy." };
  }
  return {
    assets: {
      // An explicit new-format asset wins; imageUrl remains a compatibility
      // input for campaigns saved before the two-slot Meta model existed.
      feedImageUrl: feedImageUrl || legacyImageUrl,
      storyReelImageUrl: storyReelImageUrl || "",
    },
    error: null,
  };
}

export const ADS_CHANNEL_DRAFT_MAX_BYTES = 16_384;

function containsExternalRefs(value: unknown): boolean {
  const pending: unknown[] = [value];
  const visited = new WeakSet<object>();
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== "object") continue;
    if (visited.has(current)) continue;
    visited.add(current);
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    for (const [key, nested] of Object.entries(current)) {
      if (key.replace(/[_-]/g, "").toLowerCase() === "externalrefs") return true;
      pending.push(nested);
    }
  }
  return false;
}

function onlyDraftKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).every((key) => keys.includes(key));
}

function hasExpectedChannelDraftShape(value: Record<string, unknown>, channel: AdsChannelId): boolean {
  const common = ["schemaVersion", "channel", "name", "budget", "audience"];
  const channelFields: Record<"linkedin" | "tiktok" | "pinterest" | "x", string[]> = {
    linkedin: ["objectiveType", "format", "locale", "creative"],
    tiktok: ["objectiveType", "format", "destinationKind", "placementIntent", "optimizationIntent", "creative"],
    pinterest: ["objectiveType", "intendedPromotionType", "targetingMode", "creativeType", "conversionEvent", "creative"],
    x: ["objective", "format", "targetingMode", "keywords", "creative"],
  };
  if (!isPlannedAdsChannel(channel) || !onlyDraftKeys(value, [...common, ...channelFields[channel]])) return false;
  if (!onlyDraftKeys(value.budget, ["amount", "currency", "period", "level"])) return false;
  if (!onlyDraftKeys(value.audience, ["locationBriefs", "audienceBrief"])) return false;
  if (channel === "linkedin" && !onlyDraftKeys(value.locale, ["country", "language"])) return false;
  const creativeFields = channel === "linkedin"
    ? ["introText", "headline", "mediaBrief", "destinationUrl", "leadFormBrief"]
    : channel === "tiktok"
      ? ["adText", "videoBrief", "destinationUrl", "conversionEventBrief"]
      : channel === "pinterest"
        ? ["pinTitle", "pinDescription", "visualBrief", "destinationUrl"]
        : ["postText", "mediaBrief", "destinationUrl"];
  return onlyDraftKeys(value.creative, creativeFields);
}

function parsePlannedChannelDraft(
  value: unknown,
  provider: AdsChannelId,
): { channelDraft: AdsChannelDraft | undefined; error: string | null } {
  if (value === undefined || value === null) return { channelDraft: undefined, error: null };
  if (!isPlannedAdsChannel(provider)) {
    return { channelDraft: undefined, error: "Ce canal n’accepte pas de brief publicitaire spécifique." };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { channelDraft: undefined, error: "Le brief du canal est invalide." };
  }
  let serialised: string;
  try {
    serialised = JSON.stringify(value);
  } catch {
    return { channelDraft: undefined, error: "Le brief du canal n’est pas un JSON valide." };
  }
  if (!serialised || new TextEncoder().encode(serialised).length > ADS_CHANNEL_DRAFT_MAX_BYTES) {
    return { channelDraft: undefined, error: "Le brief du canal dépasse la taille autorisée." };
  }
  const candidate: unknown = normalizeAdsChannelDraftCompatibility(JSON.parse(serialised));
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { channelDraft: undefined, error: "Le brief du canal est invalide." };
  }
  const raw = candidate as Record<string, unknown>;
  if (raw.channel !== provider) {
    return { channelDraft: undefined, error: "Le brief ne correspond pas au canal sélectionné." };
  }
  if (raw.schemaVersion !== 1) {
    return { channelDraft: undefined, error: "La version du brief du canal est inconnue." };
  }
  if (containsExternalRefs(candidate)) {
    return { channelDraft: undefined, error: "Les identifiants publicitaires non vérifiés ne peuvent pas être sauvegardés dans ce brief." };
  }
  if (!hasExpectedChannelDraftShape(raw, provider)) {
    return { channelDraft: undefined, error: "Le brief du canal contient des champs inattendus." };
  }
  if (!assessAdsChannelDraft(candidate).briefComplete) {
    return { channelDraft: undefined, error: "Le brief du canal est incomplet ou incompatible avec son objectif." };
  }
  return { channelDraft: candidate as AdsChannelDraft, error: null };
}

export function parseAdsCampaignInput(value: unknown, options: { purpose?: "draft" | "publish" } = {}): { draft: AdsCampaignInput | null; error: string | null } {
  const purpose = options.purpose || "publish";
  const sourceRaw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const provider = isAdsChannelId(sourceRaw.provider) ? sourceRaw.provider : null;
  if (!provider) return { draft: null, error: "Choisissez un canal publicitaire disponible." };
  if (containsExternalRefs(sourceRaw)) {
    return { draft: null, error: "Les identifiants publicitaires externes non vérifiés sont interdits dans ce brouillon." };
  }
  const legacyPinterestDraft = provider === "pinterest" && isLegacyPinterestAdsDraft(sourceRaw.channelDraft);
  const legacySettingsRecord = sourceRaw.channelSettings && typeof sourceRaw.channelSettings === "object"
    && !Array.isArray(sourceRaw.channelSettings)
      ? sourceRaw.channelSettings as Record<string, unknown>
      : null;
  const legacySettingsTargetingMode = legacySettingsRecord?.targetingMode;
  const legacySettingsCanMigrate = legacySettingsRecord?.channel === "pinterest"
    && legacySettingsRecord.schemaVersion === 1
    && (
      !Object.hasOwn(legacySettingsRecord, "targetingMode")
      || ["automatic", "interests", "keywords", "audiences"].includes(String(legacySettingsTargetingMode))
    );
  const legacySettings = legacySettingsCanMigrate
    ? { ...legacySettingsRecord, targetingMode: "automatic" }
    : sourceRaw.channelSettings;
  const raw = legacyPinterestDraft
    ? {
        ...sourceRaw,
        channelDraft: normalizeAdsChannelDraftCompatibility(sourceRaw.channelDraft),
        ...(sourceRaw.channelSettings == null ? {} : { channelSettings: legacySettings }),
      }
    : sourceRaw;
  if (purpose === "publish" && !isAdsDraftAccountChannel(provider)) {
    return { draft: null, error: "La connexion et la publication de ce canal ne sont pas encore disponibles." };
  }

  const rawAccountId = clean(raw.adAccountId);
  // X Ads account IDs are opaque alphanumeric identifiers, unlike the numeric
  // advertisers used by the live adapters. Never transform an X identifier.
  const adAccountId = provider === "x" ? rawAccountId : rawAccountId.replace(/^act_/, "").replace(/-/g, "");
  const accountIdPattern = provider === "x" ? /^[a-z0-9]+$/i : provider === "pinterest" ? /^\d{5,30}$/ : /^\d{5,25}$/;
  if (purpose === "publish" && !accountIdPattern.test(adAccountId)) return { draft: null, error: "Sélectionnez un compte publicitaire connecté." };
  if (adAccountId && !accountIdPattern.test(adAccountId)) return { draft: null, error: "L’identifiant du compte publicitaire est invalide." };
  if (!isAdsDraftAccountChannel(provider) && provider !== "x" && adAccountId) return { draft: null, error: "Connectez ce canal dans iNr’ADS avant d’associer un compte publicitaire." };
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
  const pinterestBidEuros = raw.pinterestBidEuros == null ? 1 : Number(raw.pinterestBidEuros);
  if (provider === "pinterest" && (!Number.isFinite(pinterestBidEuros) || pinterestBidEuros < 0.01
    || pinterestBidEuros > dailyBudgetEuros || Math.abs(Math.round(pinterestBidEuros * 100) - pinterestBidEuros * 100) > 0.000001)) {
    return { draft: null, error: "L’enchère Pinterest doit être comprise entre 0,01 € et le budget journalier, avec deux décimales maximum." };
  }
  const linkedinCampaignGroupId = clean(raw.linkedinCampaignGroupId);
  const linkedinOrganizationUrn = clean(raw.linkedinOrganizationUrn);
  const linkedinGeoTargets = Array.isArray(raw.linkedinGeoTargets)
    ? raw.linkedinGeoTargets.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return null;
      const row = value as Record<string, unknown>;
      if (Object.keys(row).some((key) => key !== "urn" && key !== "name")) return null;
      const urn = clean(row.urn);
      const name = clean(row.name);
      return /^urn:li:geo:\d{1,25}$/.test(urn) && name.length >= 1 && name.length <= 160 ? { urn, name } : null;
    })
    : [];
  const linkedinBidEuros = raw.linkedinBidEuros == null ? undefined : Number(raw.linkedinBidEuros);
  const linkedinPoliticalIntentConfirmed = raw.linkedinPoliticalIntentConfirmed === true;
  const linkedinTargetingNoticeAcknowledged = raw.linkedinTargetingNoticeAcknowledged === true;
  if (provider === "linkedin") {
    if (linkedinCampaignGroupId && !/^\d{1,25}$/.test(linkedinCampaignGroupId)) {
      return { draft: null, error: "Le groupe de campagnes LinkedIn sélectionné est invalide." };
    }
    if (linkedinOrganizationUrn && !/^urn:li:organization:\d{1,25}$/.test(linkedinOrganizationUrn)) {
      return { draft: null, error: "La Page LinkedIn sélectionnée est invalide." };
    }
    if (linkedinGeoTargets.some((target) => target === null) || linkedinGeoTargets.length > 20
      || new Set(linkedinGeoTargets.map((target) => target?.urn)).size !== linkedinGeoTargets.length) {
      return { draft: null, error: "Les zones LinkedIn sélectionnées sont invalides." };
    }
    if (linkedinBidEuros !== undefined && (!Number.isFinite(linkedinBidEuros) || linkedinBidEuros <= 0
      || linkedinBidEuros > dailyBudgetEuros
      || Math.abs(Math.round(linkedinBidEuros * 100) - linkedinBidEuros * 100) > 0.000001)) {
      return { draft: null, error: "L’enchère LinkedIn doit être positive, inférieure au budget journalier et limitée à deux décimales." };
    }
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
  const primaryTextLimit = provider === "linkedin" ? 300 : provider === "pinterest" ? 800 : provider === "x" ? 280 : provider === "tiktok" ? 100 : 500;
  if (Array.from(primaryText).length > primaryTextLimit) {
    return { draft: null, error: `Le message ${provider} dépasse ${primaryTextLimit} caractères.` };
  }
  const rawImageUrl = clean(raw.imageUrl);
  const imageUrl = rawImageUrl ? adsMediaUrl(rawImageUrl) : null;
  if (rawImageUrl && !imageUrl) return { draft: null, error: "Le visuel doit provenir d’une URL HTTPS ou de votre médiathèque iNrCy." };
  const parsedMetaAssets = parseMetaCreativeAssets(raw.metaCreativeAssets, provider, imageUrl || "");
  if (parsedMetaAssets.error || !parsedMetaAssets.assets) {
    return { draft: null, error: parsedMetaAssets.error || "Les créations Meta sont invalides." };
  }
  const metaCreativeAssets = parsedMetaAssets.assets;
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
  const { channelDraft: parsedChannelDraft, error: channelDraftError } = parsePlannedChannelDraft(raw.channelDraft, provider);
  if (channelDraftError) return { draft: null, error: channelDraftError };
  if (!isPlannedAdsChannel(provider) && raw.channelSettings != null) {
    return { draft: null, error: "Ce canal n’accepte pas de réglages publicitaires spécifiques." };
  }
  const parsedSettings = isPlannedAdsChannel(provider)
    ? parseAdsChannelWizardSettings(raw.channelSettings, provider)
    : { settings: null, error: null };
  if (parsedSettings.error) return { draft: null, error: parsedSettings.error };
  const inferredSettings = parsedChannelDraft && !parsedSettings.settings
    ? adsChannelWizardSettingsFromBrief(parsedChannelDraft) : undefined;
  const validatedInference = inferredSettings && isPlannedAdsChannel(provider)
    ? parseAdsChannelWizardSettings(inferredSettings, provider) : null;
  if (validatedInference?.error) return { draft: null, error: validatedInference.error };
  const channelSettings = parsedSettings.settings || validatedInference?.settings || undefined;
  const channelDraft = parsedChannelDraft && channelSettings &&
    !adsChannelWizardSettingsMatchBrief(channelSettings, parsedChannelDraft)
    ? undefined : parsedChannelDraft;

  if (purpose === "publish" && provider === "meta") {
    if (primaryText.length < 10 || primaryText.length > 500) return { draft: null, error: "Le texte Meta doit contenir entre 10 et 500 caractères." };
    const mediaReadinessReason = metaCreativeAssetReadinessReason(assessMetaCreativeAssetReadiness({
      metaPlacements,
      metaCreativeAssets,
      imageUrl: imageUrl || "",
    }));
    if (mediaReadinessReason) return { draft: null, error: mediaReadinessReason };
    if (!/^\d{5,30}$/.test(pageId)) return { draft: null, error: "Sélectionnez une Page Facebook autorisée pour cette annonce." };
    if (!noSpecialCategoryConfirmed) return { draft: null, error: "Confirmez que l’annonce Meta ne relève d’aucune catégorie publicitaire spéciale." };
  } else if (purpose === "publish" && provider === "google") {
    if (!targetLocations.length) return { draft: null, error: "Google Search requiert au moins une zone ciblée." };
    if (headlines.length < 3 || descriptions.length < 2 || keywords.length < 1) {
      return { draft: null, error: "Google Search requiert 3 titres, 2 descriptions et au moins un mot-clé." };
    }
    if (!notEuPoliticalConfirmed) {
      return { draft: null, error: "Confirmez que la campagne Google ne contient pas de publicité politique ciblant l’Union européenne." };
    }
  } else if (purpose === "publish" && provider === "pinterest") {
    if (channelSettings?.channel !== "pinterest") {
      return { draft: null, error: "Choisissez les réglages Pinterest de cette campagne." };
    }
    if (headlines.length !== 1 || !headlines[0]?.trim()) {
      return { draft: null, error: "Choisissez un seul titre pour l’épingle sponsorisée Pinterest avant publication." };
    }
    if (primaryText.length < 1) {
      return { draft: null, error: "Pinterest requiert une description pour l’épingle sponsorisée." };
    }
    if (!targetLocations.length) {
      return { draft: null, error: "Pinterest requiert au moins une zone ciblée." };
    }
    if (!(creativeUrl || imageUrl) || creativeType !== "image" || mediaStrategy !== "image") {
      return { draft: null, error: "Ajoutez une image à l’épingle sponsorisée Pinterest." };
    }
  } else if (purpose === "publish" && provider === "linkedin") {
    if (channelSettings?.channel !== "linkedin" || channelSettings.objectiveType !== "WEBSITE_VISIT"
      || channelSettings.format !== "STANDARD_UPDATE") {
      return { draft: null, error: "Le lancement LinkedIn prend actuellement en charge une campagne Visites du site avec une image sponsorisée." };
    }
    if (!linkedinCampaignGroupId) return { draft: null, error: "Sélectionnez un groupe de campagnes LinkedIn vérifié." };
    if (!linkedinOrganizationUrn) return { draft: null, error: "Sélectionnez une Page LinkedIn autorisée." };
    if (linkedinBidEuros === undefined) return { draft: null, error: "Choisissez une enchère CPC LinkedIn vérifiée." };
    if (!linkedinPoliticalIntentConfirmed) {
      return { draft: null, error: "Confirmez que la campagne LinkedIn n’est pas une publicité politique ciblant l’Union européenne." };
    }
    if (!linkedinTargetingNoticeAcknowledged) {
      return { draft: null, error: "Acceptez la notice LinkedIn relative au ciblage non discriminatoire." };
    }
    if (!linkedinGeoTargets.length) return { draft: null, error: "Sélectionnez au moins une zone géographique LinkedIn vérifiée." };
    if (!(creativeUrl || imageUrl) || creativeType !== "image" || mediaStrategy !== "image") {
      return { draft: null, error: "Ajoutez une image unique à la campagne LinkedIn." };
    }
    if (!primaryText || !headlines[0]?.trim()) {
      return { draft: null, error: "LinkedIn requiert une introduction et un titre pour la création sponsorisée." };
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
      pinterestBidEuros,
      linkedinCampaignGroupId,
      linkedinOrganizationUrn,
      linkedinGeoTargets: linkedinGeoTargets.filter((target): target is { urn: string; name: string } => target !== null),
      linkedinBidEuros,
      linkedinPoliticalIntentConfirmed,
      linkedinTargetingNoticeAcknowledged,
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
      imageUrl: provider === "meta" ? metaCreativeAssets.feedImageUrl : imageUrl || "",
      metaCreativeAssets,
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
      ...(channelDraft ? { channelDraft } : {}),
      ...(channelSettings ? { channelSettings } : {}),
    },
    error: null,
  };
}

/**
 * Upgrade a valid stored Pinterest v1 draft before returning it to the studio.
 * Invalid or unrelated payloads are left byte-for-byte untouched; save and
 * publish paths will still reject them through parseAdsCampaignInput.
 */
export function normalizeStoredAdsCampaignDraft(value: unknown): unknown {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  if (!raw || raw.provider !== "pinterest" || !isLegacyPinterestAdsDraft(raw.channelDraft)) return value;
  return parseAdsCampaignInput(raw, { purpose: "draft" }).draft || value;
}
