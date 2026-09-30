"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type ComponentPropsWithoutRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import SettingsDrawer from "@/app/dashboard/SettingsDrawer";
import { useUnsavedExitGuard } from "@/app/dashboard/_hooks/useUnsavedExitGuard";
import { getChannelSettingsHeaderStyle } from "@/app/dashboard/channel-settings";
import MediaGeneratorModal from "@/app/dashboard/_components/MediaGeneratorModal";
import MediaSubjectVoiceButton from "@/app/dashboard/_components/MediaSubjectVoiceButton";
import MediaLibraryPickerModal, {
  type MediaLibraryPickerItem,
} from "@/app/dashboard/_components/MediaLibraryPickerModal";
import type { MediaGenerationResult } from "@/app/dashboard/_hooks/useMediaGeneration";
import { uploadFileToMediaLibrary } from "@/lib/mediaLibraryUploadClient";
import {
  adsAccountCanBeAssociated,
  defaultAdsCampaignType,
  isAdsDraftAccountChannel,
  isAdsProvider,
  parseAdsCampaignInput,
  type AdsAccount,
  type AdsCampaignInput,
  type AdsChannelId,
  type AdsCreationMode,
  type AdsDraftAccountChannel,
  type AdsProvider,
} from "@/lib/adsValidation";
import { ADS_LIVE_PUBLISH_CONFIRMATION, ADS_PAUSED_PUBLISH_CONFIRMATION, unsupportedAdsConnectorReason } from "@/lib/adsPublishMode";
import { isAdsPublicChannel } from "@/lib/adsAccessPolicy";
import type { PinterestGeographyOption } from "@/lib/adsPinterestLocations";
import { selectGoogleTargetLocation, type GoogleLocationOption } from "@/lib/adsGoogleLocations";
import { metaPlacementsNeedInstagramIdentity } from "@/lib/adsMetaPlacement";
import {
  adsMediaStrategyAfterAttachment,
  assessMetaCreativeAssetReadiness,
  CHATGPT_ADS_IMAGE_REQUIREMENTS,
  chatgptAdsImageSubjectPrompt,
  GOOGLE_SEARCH_IMAGE_REQUIREMENTS,
  googleSearchImageSubjectPrompt,
  mergeMetaCreativeAssetUrls,
  META_ADS_FEED_IMAGE_REQUIREMENTS,
  META_ADS_STORY_REEL_IMAGE_REQUIREMENTS,
} from "@/lib/adsCampaignMediaPolicy";
import { presentAdsCampaignRationale, type AdsCampaignPlan } from "@/lib/adsCampaignPlan";
import { assessAdsChannelDraft, type AdsChannelDraft } from "@/lib/adsChannelDrafts";
import {
  adsChannelWizardSettingsFromBrief,
  defaultAdsChannelWizardSettings,
  LINKEDIN_WIZARD_FORMATS,
  PINTEREST_WIZARD_OBJECTIVES,
  TIKTOK_WIZARD_OBJECTIVES,
  X_WIZARD_OBJECTIVES,
  type AdsChannelWizardSettings,
  type LinkedInWizardSettings,
  type PinterestWizardSettings,
  type TikTokWizardSettings,
  type XWizardSettings,
} from "@/lib/adsChannelWizardSettings";
import { getAdsAdvertiserAccountUrl } from "@/lib/adsAccountLinks";
import { preparePinterestTargetingTransition } from "@/lib/adsPinterestTargetingTransition";
import { adsDraftHasKeywordsStep, adsDraftHasMediaStep, adsDraftValidationStep } from "@/lib/adsDraftNavigation";
import { adsDestinationReviewState } from "@/lib/adsDestination";
import type { AdsPublicationPhase } from "@/lib/adsPublicationProgress";
import type { ConnectionDisplayStatus } from "@/lib/connectionVersions";
import {
  adsConnectionDisplay,
  type AdsConnectionSnapshot,
  type AdsConnectionSnapshots,
} from "@/lib/adsConnectionSnapshot";
import AdsConnectionSettings from "./AdsConnectionSettings";
import ExternalAdsConnectionSettings from "./ExternalAdsConnectionSettings";
import OpenaiAdsConnectionSettings from "./OpenaiAdsConnectionSettings";
import AdsCampaignAutoMediaGenerator from "./AdsCampaignAutoMediaGenerator";
import AdsCampaignAnalysisChoice, { type AdsCampaignAnalysisMode } from "./AdsCampaignAnalysisChoice";
import AdsCampaignDemoDialog, { type AdsCampaignDemoDialogDetails, type AdsCampaignLaunchStatus } from "./AdsCampaignDemoDialog";
import AdsDraftsMenu from "./AdsDraftsMenu";
import MetaAdsMediaPack, {
  type MetaAdsMediaFormatStatus,
  type MetaAdsMediaSlot,
} from "./MetaAdsMediaPack";
import type { StoredAdsCampaign } from "./AdsCampaignTracking";
import styles from "./ads.module.css";

type StoredCampaign = StoredAdsCampaign;

type AdsConfigAction = "disconnect" | "save-account" | "clear-account" | "save-page" | "clear-page" | null;
type CampaignCreationPath = "choice" | AdsCreationMode;
type CampaignBusyAction = "save" | "plan" | "publish" | "demo" | null;
type CampaignMediaUploadKind = "image" | "video";
const OPENAI_ADS_MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function isMediaLibraryContentReference(value: string): boolean {
  try {
    const url = new URL(value, "https://inrcy-media.local");
    return value.startsWith("/") && !value.startsWith("//") && url.origin === "https://inrcy-media.local"
      && /^\/api\/media-library\/items\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/content$/i.test(url.pathname)
      && /^[A-Za-z0-9_-]{20,}$/.test(url.searchParams.get("token") || "");
  } catch { return false; }
}

async function uploadedImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return await new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new window.Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Cette image ne peut pas être lue. Choisissez un JPG ou PNG valide."));
    };
    image.src = objectUrl;
  });
}
type DemoDialogState = { mode: "confirm" | "success"; details: AdsCampaignDemoDialogDetails; channelId: AdsDraftAccountChannel; pageId: string; launchStatus: AdsCampaignLaunchStatus };
const PINTEREST_STEPPER_LABELS: Record<string, string> = {
  "Objectif Pinterest": "Objectif",
  "Audience Pinterest": "Audience",
  "Découverte Pinterest": "Découverte",
  "Épingle sponsorisée": "Épingle",
  "Pur média": "Média",
  "Destination & mesure": "Destination",
  "Budget Pinterest": "Budget",
  "Validation Pinterest": "Validation",
};

type AccountResponse = {
  connected: boolean;
  hasConnection?: boolean;
  connectionStatus?: ConnectionDisplayStatus;
  accounts: AdsAccount[];
  pages: { id: string; name: string; instagramUserId?: string }[];
  connectionAccount?: { displayName?: string; email?: string; id?: string };
  accountSelectionCleared?: boolean;
  selectedAccountId?: string;
  selectedAccountLabel?: string;
  selectedAccountAvailable?: boolean;
  suggestedAccountId?: string;
  selectedPageId?: string;
  selectedPageAvailable?: boolean;
  error?: string;
};

const EXTERNAL_CHANNELS = ["linkedin", "tiktok", "pinterest", "x"] as const;
type ExternalChannelId = (typeof EXTERNAL_CHANNELS)[number];
type ExternalAdsAccount = {
  id: string;
  name: string;
  currency?: string | null;
  status?: string;
  eligibleToAssociate?: boolean | null;
  canManageCampaigns?: boolean;
  canServeCampaigns?: boolean;
};
type ExternalAccountsCacheEntry = {
  accounts: ExternalAdsAccount[];
  choice: string;
  loaded: boolean;
  failed: boolean;
};
type ExternalConnectorStatus = {
  load: "idle" | "loading" | "ready" | "error";
  configured: boolean;
  connected: boolean;
  status: string;
  selectedAccountId: string;
  selectedAccountName: string;
  scopes?: string[];
  missingScopes?: string[];
  selectedAccountCanManage?: boolean;
  selectedAccountCanServe?: boolean;
  publicationEnabled?: boolean;
  error: string;
};

type LinkedInCampaignGroupOption = {
  id: string;
  urn: string;
  name: string;
  status: "ACTIVE" | "DRAFT" | "PAUSED";
  objectiveType: string | null;
  allowedCampaignTypes: string[];
};

type LinkedInOrganizationOption = {
  urn: string;
  role: "ADMINISTRATOR" | "CONTENT_ADMINISTRATOR" | "DIRECT_SPONSORED_CONTENT_POSTER";
  name?: string;
};

type LinkedInGeoTargetOption = {
  urn: string;
  name: string;
  facetUrn: string;
};

type LinkedInAdsPreflightResponse = {
  account?: ExternalAdsAccount;
  campaignGroups?: LinkedInCampaignGroupOption[];
  organizations?: LinkedInOrganizationOption[];
  geoSuggestions?: LinkedInGeoTargetOption[];
  selected?: {
    campaignGroup?: LinkedInCampaignGroupOption | null;
    organization?: LinkedInOrganizationOption | null;
    pricing?: { currency: string; bidMin: number; bidMax: number; dailyBudgetMin: number; dailyBudgetDefault: number | null } | null;
  };
  blockers?: string[];
  error?: string;
};

function linkedInCampaignGroupIsCompatible(group: LinkedInCampaignGroupOption): boolean {
  return (!group.objectiveType || group.objectiveType === "WEBSITE_VISIT")
    && (!group.allowedCampaignTypes.length || group.allowedCampaignTypes.includes("SPONSORED_UPDATES"));
}

function linkedInOrganizationLabel(organization: LinkedInOrganizationOption): string {
  const id = organization.urn.split(":").at(-1) || organization.urn;
  const role = organization.role === "ADMINISTRATOR" ? "Administrateur"
    : organization.role === "CONTENT_ADMINISTRATOR" ? "Administrateur de contenu" : "Sponsor direct autorisé";
  return `${organization.name?.trim() || "Page LinkedIn"} · ID ${id} · ${role}`;
}

function isExternalChannel(value: unknown): value is ExternalChannelId {
  return typeof value === "string" && EXTERNAL_CHANNELS.some((channel) => channel === value);
}

function externalStatusFromSnapshot(snapshot: AdsConnectionSnapshot): ExternalConnectorStatus {
  return {
    load: snapshot.status === "unknown" ? "idle" : "ready",
    configured: true,
    connected: snapshot.status === "connected",
    status: snapshot.status,
    selectedAccountId: snapshot.accountId,
    selectedAccountName: snapshot.accountLabel,
    selectedAccountCanManage: false,
    selectedAccountCanServe: false,
    publicationEnabled: false,
    error: "",
  };
}

function externalStatusDisplay(status: ExternalConnectorStatus): { label: string; tone: string } {
  // A remote refresh must not temporarily hide the durable Ads association.
  if ((status.load === "idle" || status.load === "loading" || status.load === "error") && status.status === "unknown") return { label: "Vérification…", tone: "loading" };
  if (!status.configured) return { label: "Connexion indisponible", tone: "unavailable" };
  if (status.status === "needs_update" || status.status === "needs_reconnect") return { label: "Connexion à actualiser", tone: "select-account" };
  if (status.connected && status.selectedAccountId) return { label: "Compte associé", tone: "connected" };
  if (status.connected) return { label: "Compte à associer", tone: "select-account" };
  return { label: "À connecter", tone: "disconnected" };
}

const EXTERNAL_DISCONNECT_CHANNELS: readonly ExternalChannelId[] = ["linkedin", "pinterest", "tiktok", "x"];

// Every channel can be prepared here. Live publication is enabled only for the
// deliberately supported connector paths (Meta, Google and classic Pinterest).
const CHANNEL_CATALOG: { id: AdsChannelId; label: string; format: string; logo: string; provider?: AdsProvider }[] = [
  { id: "meta", label: "Meta Ads", format: "Facebook · Instagram", logo: "/ads-logos/meta.svg", provider: "meta" },
  { id: "google", label: "Google Ads", format: "Recherche · annonces textuelles", logo: "/ads-logos/google-ads.svg", provider: "google" },
  { id: "linkedin", label: "LinkedIn Ads", format: "Votre audience professionnelle", logo: "/ads-logos/linkedin.svg" },
  { id: "tiktok", label: "TikTok Ads", format: "De nouvelles communautés", logo: "/ads-logos/tiktok.svg" },
  { id: "pinterest", label: "Pinterest Ads", format: "Inspirez vos futurs clients", logo: "/ads-logos/pinterest.svg" },
  { id: "x", label: "X Ads", format: "Rejoignez les conversations", logo: "/ads-logos/x.svg" },
  { id: "openai", label: "ChatGPT Ads", format: "Découverte dans ChatGPT", logo: "/ads-logos/chatgpt-ads.svg" },
];

const CAMPAIGN_CHANNEL_NAMES: Record<AdsChannelId, string> = {
  meta: "Meta",
  google: "Google",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  pinterest: "Pinterest",
  openai: "ChatGPT",
  x: "X",
};

function campaignHeaderStyle(channel: AdsChannelId) {
  const panel = channel === "meta" ? "facebook" : channel === "google" || channel === "openai" ? "gmb" : channel;
  return { ...getChannelSettingsHeaderStyle(panel), minHeight: 76 };
}

const AI_ANALYSIS_STAGES = [
  { at: 12, label: "Lecture de votre iNrADN", detail: "Services, zones, clients et points forts" },
  { at: 28, label: "Objectif & conversion", detail: "Ce que votre campagne doit réellement obtenir" },
  { at: 46, label: "Ciblage intelligent", detail: "Intentions, audiences et mots-clés utiles" },
  { at: 66, label: "Architecture de campagne", detail: "Format, budget et stratégie de diffusion" },
  { at: 84, label: "Créations & messages", detail: "Arguments, annonces et recommandations média" },
  { at: 100, label: "Finalisation", detail: "Une proposition prête à être contrôlée par vous" },
] as const;

const CAMPAIGN_TYPE_OPTIONS: Record<AdsChannelId, { value: AdsCampaignInput["campaignType"]; label: string; detail: string }[]> = {
  google: [
    { value: "search", label: "Réseau de recherche", detail: "Mots-clés et annonces textuelles" },
    { value: "performance_max", label: "Performance Max", detail: "Tous les inventaires Google" },
    { value: "display", label: "Display", detail: "Bannières et notoriété" },
    { value: "video", label: "Vidéo / YouTube", detail: "Formats vidéo et portée" },
    { value: "demand_gen", label: "Demand Gen", detail: "Découverte visuelle" },
    { value: "shopping", label: "Shopping", detail: "Produits et flux marchand" },
  ],
  meta: [
    { value: "meta_traffic", label: "Trafic", detail: "Visites qualifiées vers votre site" },
    { value: "meta_leads", label: "Prospects", detail: "Demandes de devis et formulaires" },
    { value: "meta_sales", label: "Ventes", detail: "Conversions et achats" },
    { value: "meta_awareness", label: "Notoriété", detail: "Faire connaître votre entreprise" },
  ],
  linkedin: [{ value: "generic", label: "Campagne LinkedIn", detail: "Préparation complète" }],
  tiktok: [{ value: "generic", label: "Campagne TikTok", detail: "Préparation complète" }],
  pinterest: [{ value: "generic", label: "Campagne Pinterest", detail: "Préparation complète" }],
  openai: [{ value: "generic", label: "Carte ChatGPT", detail: "Clics vers votre site · titre, texte et image" }],
  x: [{ value: "generic", label: "Campagne X", detail: "Préparation complète" }],
};

const OBJECTIVE_OPTIONS: { value: AdsCampaignInput["objective"]; label: string }[] = [
  { value: "leads", label: "Générer des prospects" },
  { value: "sales", label: "Développer les ventes" },
  { value: "website_traffic", label: "Attirer du trafic qualifié" },
  { value: "awareness", label: "Faire connaître mon entreprise" },
  { value: "engagement", label: "Créer de l’engagement" },
  { value: "app_promotion", label: "Promouvoir une application" },
];

const CONVERSION_OPTIONS: { value: AdsCampaignInput["conversionGoal"]; label: string }[] = [
  { value: "quote_request", label: "Demande de devis" },
  { value: "lead_form", label: "Formulaire de contact" },
  { value: "phone_call", label: "Appel téléphonique" },
  { value: "website_visit", label: "Visite de page clé" },
  { value: "purchase", label: "Achat / commande" },
  { value: "message", label: "Message reçu" },
  { value: "store_visit", label: "Visite en point de vente" },
  { value: "custom", label: "Autre action à définir" },
];

const CONVERSION_LOCATION_OPTIONS: { value: AdsCampaignInput["conversionLocation"]; label: string; detail: string }[] = [
  { value: "website", label: "Mon site web", detail: "Vers une page de destination" },
  { value: "instant_form", label: "Formulaire instantané", detail: "Sans quitter la plateforme" },
  { value: "messaging", label: "Messages", detail: "Pour démarrer une conversation" },
  { value: "phone", label: "Appels", detail: "Pour être appelé directement" },
  { value: "store", label: "Point de vente", detail: "Pour attirer près de chez vous" },
];

const META_PLACEMENT_OPTIONS: { value: AdsCampaignInput["metaPlacements"][number]; label: string; format: string; disabled?: boolean }[] = [
  { value: "facebook_feed", label: "Fil Facebook", format: "4:5" },
  { value: "instagram_feed", label: "Fil Instagram", format: "4:5" },
  { value: "stories", label: "Stories", format: "9:16" },
  { value: "reels", label: "Reels", format: "9:16" },
  { value: "messenger", label: "Messenger", format: "bientôt", disabled: true },
];

const BID_STRATEGY_OPTIONS: { value: AdsCampaignInput["bidStrategy"]; label: string }[] = [
  { value: "maximize_conversions", label: "Maximiser les conversions" },
  { value: "maximize_clicks", label: "Maximiser les clics" },
  { value: "maximize_value", label: "Maximiser la valeur" },
  { value: "target_cpa", label: "Préparer un coût par prospect cible" },
  { value: "target_roas", label: "Préparer un ROAS cible" },
  { value: "manual_review", label: "À valider avec mon expert" },
];

const MEDIA_STRATEGY_OPTIONS: { value: AdsCampaignInput["mediaStrategy"]; label: string }[] = [
  { value: "search_text", label: "Annonces textuelles" },
  { value: "image", label: "Images" },
  { value: "video", label: "Vidéos" },
  { value: "mixed", label: "Images + vidéos" },
  { value: "product_feed", label: "Flux produits" },
];

function defaultEndDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 8);
  return date.toISOString().slice(0, 10);
}

function newDraft(provider: AdsChannelId): AdsCampaignInput {
  return {
    provider,
    creationMode: "manual",
    campaignType: defaultAdsCampaignType(provider),
    objective: provider === "meta" || provider === "openai" || isExternalChannel(provider) ? "website_traffic" : "leads",
    conversionGoal: provider === "meta" || provider === "openai" || isExternalChannel(provider) ? "website_visit" : "quote_request",
    conversionLocation: "website",
    bidStrategy: provider === "openai" ? "manual_review" : "maximize_conversions",
    adAccountId: "",
    accountCurrency: "EUR",
    name: "",
    offer: "",
    dailyBudgetEuros: provider === "openai" ? 15 : 10,
    pinterestBidEuros: 1,
    openaiBidEuros: undefined,
    endDate: defaultEndDate(),
    destinationUrl: "",
    urlExpansion: true,
    urlExclusions: [],
    // A country must be an intentional choice, never an implicit local campaign target.
    targetLocations: [],
    targetAudiences: [],
    languages: ["fr"],
    googleSearchPartners: false,
    googleDisplayExpansion: false,
    metaAudienceExpansion: true,
    metaPlacements: provider === "meta" ? ["facebook_feed", "instagram_feed", "stories", "reels"] : [],
    trackingParameters: "",
    primaryText: "",
    imageUrl: "",
    metaCreativeAssets: { feedImageUrl: "", storyReelImageUrl: "" },
    creativeUrl: "",
    creativeType: provider === "tiktok" ? "video" : "image",
    mediaStrategy: provider === "google" || provider === "x" ? "search_text" : provider === "tiktok" ? "video" : "image",
    mediaBrief: "",
    callToAction: provider === "openai" ? "" : provider === "meta" ? "En savoir plus" : "Demander un devis",
    pageId: "",
    headlines: [],
    descriptions: [],
    keywords: [],
    negativeKeywords: [],
    noSpecialCategoryConfirmed: false,
    notEuPoliticalConfirmed: false,
    ...(provider === "linkedin" ? {
      linkedinCampaignGroupId: "",
      linkedinOrganizationUrn: "",
      linkedinGeoTargets: [],
      linkedinBidEuros: undefined,
      // LinkedIn requires the EU political declaration to be clearly visible
      // and checked by default. It remains editable and is revalidated before publish.
      linkedinPoliticalIntentConfirmed: true,
      linkedinTargetingNoticeAcknowledged: false,
    } : {}),
    ...(isExternalChannel(provider) ? { channelSettings: defaultAdsChannelWizardSettings(provider) } : {}),
  };
}

function nativeBriefCopy(brief: AdsChannelDraft) {
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

const NATIVE_BRIEF_TERMS: Record<string, string> = {
  BRAND_AWARENESS: "Notoriété", WEBSITE_VISIT: "Visites du site", ENGAGEMENT: "Engagement",
  VIDEO_VIEW: "Vues vidéo", LEAD_GENERATION: "Prospects", WEBSITE_CONVERSION: "Conversions du site",
  REACH: "Couverture", VIDEO_VIEWS: "Vues vidéo", TRAFFIC: "Trafic", WEB_CONVERSIONS: "Conversions du site",
  AWARENESS: "Notoriété", CONSIDERATION: "Considération", VIDEO_COMPLETION: "Vues complètes",
  SALES: "Ventes", LEADS: "Prospects", reach: "Couverture", video_views: "Vues vidéo",
  website_traffic: "Trafic du site", website_conversions: "Conversions du site", engagement: "Engagement",
  STANDARD_UPDATE: "Publication sponsorisée", SINGLE_VIDEO: "Vidéo", CAROUSEL: "Carrousel",
  TEXT_AD: "Annonce textuelle", LEAD_GENERATION_FORM_SPONSORED_CONTENT: "Formulaire de prospects",
  STANDARD_AD: "Épingle sponsorisée", CATALOG: "Catalogue", REGULAR: "Image", VIDEO: "Vidéo",
  MAX_VIDEO: "Vidéo étendue", text: "Texte", image: "Image", video: "Vidéo",
  automatic: "Placements automatiques", tiktok_only: "TikTok uniquement",
  broad: "Audience large", keywords: "Mots-clés", interests: "Centres d’intérêt",
  follower_lookalikes: "Audiences similaires", website: "Site web", instant_form: "Formulaire intégré",
  profile: "Profil", CHECKOUT: "Achat", ADD_TO_CART: "Ajout au panier", SIGNUP: "Inscription", LEAD: "Prospect",
  titles: "Fonctions / postes", industries: "Secteurs d’entreprise", skills: "Compétences",
  audiences: "Audiences existantes", conversions: "Conversions", clicks: "Clics", views: "Vues",
};

function nativeWizardObjective(settings: AdsChannelWizardSettings): string {
  return settings.channel === "x" ? settings.objective : settings.objectiveType;
}

function nativeWizardFormat(settings: AdsChannelWizardSettings): string {
  return settings.channel === "pinterest"
    ? settings.intendedPromotionType === "CATALOG" ? "Catalogue" : nativeBriefTerm(settings.creativeType || "REGULAR")
    : nativeBriefTerm(settings.format);
}

function nativeWizardGenericObjective(settings: AdsChannelWizardSettings): AdsCampaignInput["objective"] {
  const objective = nativeWizardObjective(settings);
  if (["BRAND_AWARENESS", "REACH", "AWARENESS", "reach"].includes(objective)) return "awareness";
  if (["LEAD_GENERATION", "LEADS"].includes(objective)) return "leads";
  if (["WEBSITE_CONVERSION", "WEB_CONVERSIONS", "SALES", "website_conversions"].includes(objective)) return "sales";
  if (["ENGAGEMENT", "VIDEO_VIEW", "VIDEO_VIEWS", "VIDEO_COMPLETION", "engagement", "video_views"].includes(objective)) return "engagement";
  return "website_traffic";
}

function nativeWizardMediaStrategy(settings: AdsChannelWizardSettings): AdsCampaignInput["mediaStrategy"] {
  if (settings.channel === "tiktok") return "video";
  if (settings.channel === "pinterest") {
    if (settings.intendedPromotionType === "CATALOG") return "product_feed";
    return settings.creativeType === "VIDEO" || settings.creativeType === "MAX_VIDEO" ? "video" : "image";
  }
  if (settings.channel === "x" && settings.format === "text") return "search_text";
  return settings.format === "video" || settings.format === "SINGLE_VIDEO" ? "video" : "image";
}

function nativeBriefTerm(value: string) {
  return NATIVE_BRIEF_TERMS[value] || value.replaceAll("_", " ").toLowerCase();
}

function pinterestTargetingLabel(mode: PinterestWizardSettings["targetingMode"]): string {
  switch (mode) {
    case "automatic": return "Ciblage automatique — recommandé";
    case "interests": return "Centres d’intérêt";
    case "keywords": return "Recherches / mots-clés";
    case "audiences": return "Audiences existantes";
  }
}

function pinterestObjectiveLabel(objective: PinterestWizardSettings["objectiveType"]): string {
  const availability = objective === "AWARENESS" || objective === "CONSIDERATION"
    ? "publiable aujourd’hui"
    : "brouillon";
  return `${nativeBriefTerm(objective)} · ${availability}`;
}

function pinterestCreativeLabel(creative: Exclude<PinterestWizardSettings["creativeType"], null>): string {
  return `${nativeBriefTerm(creative)} · ${creative === "REGULAR" ? "publiable aujourd’hui" : "brouillon"}`;
}

function xPostWeightedLength(value: string) {
  const urls = value.match(/https?:\/\/\S+/g) || [];
  return Array.from(value.replace(/https?:\/\/\S+/g, "")).length + urls.length * 23;
}

function nativeBriefDetails(brief: AdsChannelDraft) {
  switch (brief.channel) {
    case "linkedin":
      return { objective: nativeBriefTerm(brief.objectiveType), format: nativeBriefTerm(brief.format),
        settings: `Langue ${brief.locale.language.toUpperCase()} · Pays ${brief.locale.country}`,
        complement: brief.creative.leadFormBrief ? `Formulaire à préparer : ${brief.creative.leadFormBrief}` : "Audience professionnelle à confirmer dans le compte" };
    case "tiktok":
      return { objective: nativeBriefTerm(brief.objectiveType), format: "Vidéo verticale",
        settings: `${nativeBriefTerm(brief.placementIntent)} · Optimisation : ${nativeBriefTerm(brief.optimizationIntent)} · Destination : ${nativeBriefTerm(brief.destinationKind)}`,
        complement: brief.creative.conversionEventBrief ? `Action à mesurer : ${brief.creative.conversionEventBrief}` : "Vidéo et identité publicitaire à choisir" };
    case "pinterest":
      return { objective: nativeBriefTerm(brief.objectiveType),
        format: `${nativeBriefTerm(brief.intendedPromotionType)}${brief.creativeType ? ` · ${nativeBriefTerm(brief.creativeType)}` : ""}`,
        settings: `Ciblage : ${pinterestTargetingLabel(brief.targetingMode)}${brief.conversionEvent ? ` · Action : ${nativeBriefTerm(brief.conversionEvent)}` : ""}`,
        complement: brief.intendedPromotionType === "CATALOG" ? "Catalogue et produits à confirmer dans le compte" : "Épingle et visuel à choisir" };
    case "x":
      return { objective: nativeBriefTerm(brief.objective), format: nativeBriefTerm(brief.format),
        settings: `Ciblage : ${nativeBriefTerm(brief.targetingMode)}${brief.keywords?.length ? ` · ${brief.keywords.join(", ")}` : ""}`,
        complement: "Publication et compte de financement à confirmer" };
  }
}

const NATIVE_BRIEF_SAFE_EDITS = new Set<keyof AdsCampaignInput>([
  "name", "dailyBudgetEuros", "targetLocations", "targetAudiences", "destinationUrl",
  "primaryText", "mediaBrief", "headlines", "endDate", "trackingParameters",
  "adAccountId", "accountCurrency", "pageId", "imageUrl", "creativeUrl",
  "metaCreativeAssets",
  "pinterestBidEuros",
  "linkedinCampaignGroupId", "linkedinOrganizationUrn", "linkedinGeoTargets", "linkedinBidEuros",
  "linkedinPoliticalIntentConfirmed", "linkedinTargetingNoticeAcknowledged",
  "urlExpansion", "urlExclusions", "googleSearchPartners", "googleDisplayExpansion",
  "metaAudienceExpansion", "metaPlacements", "noSpecialCategoryConfirmed", "notEuPoliticalConfirmed",
]);

/** Never keep an AI channel brief if a professional changes its native strategy. */
function applyDraftEdit(current: AdsCampaignInput, next: Partial<AdsCampaignInput>): AdsCampaignInput {
  const updated = { ...current, ...next };
  const brief = current.channelDraft;
  if (!brief) return updated;
  if (brief.channel !== current.provider) return { ...updated, channelDraft: undefined };

  const changed = new Set((Object.keys(next) as (keyof AdsCampaignInput)[]).filter(
    (key) => JSON.stringify(current[key]) !== JSON.stringify(next[key]),
  ));
  if (changed.size === 0) return updated;
  if ([...changed].some((key) => !NATIVE_BRIEF_SAFE_EDITS.has(key))) return { ...updated, channelDraft: undefined };
  if (changed.has("headlines") && brief.channel !== "linkedin" && brief.channel !== "pinterest") {
    return { ...updated, channelDraft: undefined };
  }
  if (changed.has("primaryText") && (
    (brief.channel === "tiktok" && Array.from(updated.primaryText).length > 100)
    || (brief.channel === "x" && xPostWeightedLength(updated.primaryText) > 280)
  )) return { ...updated, channelDraft: undefined };
  if (changed.has("headlines") && (
    (brief.channel === "linkedin" && (updated.headlines[0]?.length || 0) > 200)
    || (brief.channel === "pinterest" && (updated.headlines[0]?.length || 0) > 100)
  )) return { ...updated, channelDraft: undefined };

  const common = {
    name: changed.has("name") ? updated.name.trim() : brief.name,
    budget: changed.has("dailyBudgetEuros") ? { ...brief.budget, amount: updated.dailyBudgetEuros } : brief.budget,
    audience: {
      locationBriefs: changed.has("targetLocations") ? updated.targetLocations : brief.audience.locationBriefs,
      audienceBrief: changed.has("targetAudiences") ? updated.targetAudiences.join(" ; ") : brief.audience.audienceBrief,
    },
  };
  let channelDraft: AdsChannelDraft;
  switch (brief.channel) {
    case "linkedin":
      channelDraft = { ...brief, ...common, creative: {
        ...brief.creative,
        introText: changed.has("primaryText") ? updated.primaryText : brief.creative.introText,
        headline: changed.has("headlines") ? updated.headlines[0] || "" : brief.creative.headline,
        mediaBrief: changed.has("mediaBrief") ? updated.mediaBrief : brief.creative.mediaBrief,
        destinationUrl: changed.has("destinationUrl") ? updated.destinationUrl : brief.creative.destinationUrl,
      } };
      break;
    case "tiktok":
      channelDraft = { ...brief, ...common, creative: {
        ...brief.creative,
        adText: changed.has("primaryText") ? updated.primaryText : brief.creative.adText,
        videoBrief: changed.has("mediaBrief") ? updated.mediaBrief : brief.creative.videoBrief,
        destinationUrl: changed.has("destinationUrl") ? updated.destinationUrl : brief.creative.destinationUrl,
      } };
      break;
    case "pinterest":
      channelDraft = { ...brief, ...common, creative: {
        ...brief.creative,
        pinTitle: changed.has("headlines") ? updated.headlines[0] || "" : brief.creative.pinTitle,
        pinDescription: changed.has("primaryText") ? updated.primaryText : brief.creative.pinDescription,
        visualBrief: changed.has("mediaBrief") ? updated.mediaBrief : brief.creative.visualBrief,
        destinationUrl: changed.has("destinationUrl") ? updated.destinationUrl : brief.creative.destinationUrl,
      } };
      break;
    case "x":
      channelDraft = { ...brief, ...common, creative: {
        ...brief.creative,
        postText: changed.has("primaryText") ? updated.primaryText : brief.creative.postText,
        mediaBrief: changed.has("mediaBrief") ? updated.mediaBrief : brief.creative.mediaBrief,
        destinationUrl: changed.has("destinationUrl") ? updated.destinationUrl : brief.creative.destinationUrl,
      } };
      break;
  }
  // The simple draft remains editable even if a native-specific brief becomes incomplete.
  if (!assessAdsChannelDraft(channelDraft).briefComplete) return { ...updated, channelDraft: undefined };
  if (changed.has("primaryText")) {
    if (brief.channel !== "linkedin" || updated.primaryText.length <= 300) {
      updated.descriptions = [updated.primaryText, ...updated.descriptions.slice(1)];
    }
    if (brief.channel === "tiktok" || brief.channel === "x") updated.headlines = [updated.primaryText, ...updated.headlines.slice(1)];
  }
  return { ...updated, channelDraft };
}

type AdsApiRequestError = Error & {
  code?: string;
  requestId?: string;
  status?: number;
};

async function readJson(response: Response) {
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = String(data.error || "Le service est momentanément indisponible. Réessayez dans un instant.");
    const error = new Error(
      /migration|stockage|relation .* does not exist/i.test(message)
        ? "L’enregistrement des campagnes sera bientôt disponible. Vous pouvez déjà préparer vos messages."
        : message,
    ) as AdsApiRequestError;
    error.code = typeof data.code === "string" ? data.code : undefined;
    error.requestId = typeof data.requestId === "string" ? data.requestId : undefined;
    error.status = response.status;
    throw error;
  }
  return data;
}

async function readAdsConnectionStatus(response: Response) {
  if (!response.ok) {
    const data = await response.clone().json().catch(() => ({})) as Record<string, unknown>;
    // A provider error can carry a confirmed revocation. Do not preserve an
    // old green snapshot when the server explicitly reports that disconnection.
    if (data.connected === false && ["needs_update", "needs_reconnect", "disconnected"].includes(String(data.status))) return data;
  }
  return readJson(response);
}

function editableList(items: string[]) { return items.join("\n"); }
function parseEditableList(text: string[]) { return text.map((value) => value.trim()).filter(Boolean); }

type TagFieldProps = {
  className?: string;
  label: string;
  helper: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  note?: string;
  wide?: boolean;
  maxItems?: number;
  maxItemLength?: number;
};

type GoogleAdCopyFieldProps = {
  label: string;
  singular: string;
  values: string[];
  onChange: (values: string[]) => void;
  minItems: number;
  maxItems: number;
  maxLength: number;
};

type VoiceTextareaProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  purpose: "subject" | "instruction" | "title" | "content" | "cta" | "hashtags" | "tags";
  contextLabel: string;
  rows?: number;
  maxLength?: number;
};

/** Keep the complete copy visible as the user edits or changes viewport. */
function CampaignTextarea({ value, className, ...props }: ComponentPropsWithoutRef<"textarea">) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resize = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea || !textarea.clientWidth) return;
    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight + 2}px`;
  }, []);

  useEffect(resize, [resize, value]);
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    let previousWidth = -1;
    const observer = new ResizeObserver(() => {
      if (textarea.clientWidth === previousWidth) return;
      previousWidth = textarea.clientWidth;
      resize();
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [resize]);

  return <textarea {...props} ref={textareaRef} value={value} className={`${styles.campaignTextarea}${className ? ` ${className}` : ""}`} />;
}

/** Reuses iNrCy's established microphone/transcription control in the Ads studio. */
function VoiceTextarea({ value, onChange, placeholder, purpose, contextLabel, rows = 3, maxLength }: VoiceTextareaProps) {
  const [voiceBusy, setVoiceBusy] = useState(false);
  const lengthHintId = useId();
  const tooLong = maxLength !== undefined && value.length > maxLength;

  return (
    <div className={styles.voiceTextarea}>
      <CampaignTextarea
        rows={rows}
        value={value}
        aria-invalid={tooLong || undefined}
        aria-describedby={tooLong ? lengthHintId : undefined}
        readOnly={voiceBusy}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
      <MediaSubjectVoiceButton
        purpose={purpose}
        value={value}
        mergeMode="paragraph"
        contextLabel={contextLabel}
        onBusyChange={setVoiceBusy}
        onChange={onChange}
      />
      {tooLong && <small id={lengthHintId} className={styles.copyLengthError} role="status">{value.length} / {maxLength} caractères : reformulez ce texte avant publication. Il est conservé en entier.</small>}
    </div>
  );
}

/** A compact, keyboard-friendly editor for campaign choices such as territories. */
function TagField({ className, label, helper, values, onChange, placeholder, note, wide = false, maxItems, maxItemLength }: TagFieldProps) {
  const [pendingValue, setPendingValue] = useState("");
  const [tagError, setTagError] = useState("");

  const addValues = useCallback((rawValue: string) => {
    const additions = rawValue
      .split(/[\n,;]+/)
      .map((value) => value.trim())
      .filter(Boolean);

    if (!additions.length) return;
    if (maxItemLength && additions.some((value) => value.length > maxItemLength)) {
      setTagError(`Chaque expression doit contenir au plus ${maxItemLength} caractères.`);
      return;
    }

    const existing = new Set(values.map((value) => value.trim().toLocaleLowerCase("fr-FR")));
    const uniqueAdditions = additions.filter((value) => {
      const normalized = value.toLocaleLowerCase("fr-FR");
      if (existing.has(normalized)) return false;
      existing.add(normalized);
      return true;
    });

    const remaining = maxItems === undefined ? uniqueAdditions.length : Math.max(0, maxItems - values.length);
    if (remaining) onChange([...values, ...uniqueAdditions.slice(0, remaining)]);
    setTagError(uniqueAdditions.length > remaining ? `Limite de ${maxItems} expressions atteinte.` : "");
    setPendingValue("");
  }, [maxItemLength, maxItems, onChange, values]);

  return (
    <div className={`${styles.field} ${styles.tagField}${wide ? ` ${styles.studioWide}` : ""}${className ? ` ${className}` : ""}`}>
      <span className={styles.tagFieldLabel}>{label}</span>
      <small>{helper}</small>
      <div className={styles.tagInputShell}>
        {values.map((value, index) => (
          <button
            key={`${value}-${index}`}
            type="button"
            className={styles.tagChip}
            onClick={() => onChange(values.filter((_, valueIndex) => valueIndex !== index))}
            aria-label={`Retirer ${value}`}
            title={`Retirer ${value}`}
          >
            <span>{value}</span><span aria-hidden="true">×</span>
          </button>
        ))}
        <input
          value={pendingValue}
          onChange={(event) => { setPendingValue(event.target.value); setTagError(""); }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              addValues(pendingValue);
            } else if (event.key === "Backspace" && !pendingValue && values.length) {
              onChange(values.slice(0, -1));
            }
          }}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData("text");
            if (/[,;\n]/.test(pasted)) {
              event.preventDefault();
              addValues(pasted);
            }
          }}
          maxLength={maxItemLength}
          disabled={maxItems !== undefined && values.length >= maxItems}
          placeholder={values.length ? "Ajouter un choix…" : placeholder}
          aria-label={`Ajouter : ${label}`}
        />
        <MediaSubjectVoiceButton
          placement="inline"
          purpose="tags"
          value=""
          mergeMode="replace"
          contextLabel={label}
          disabled={maxItems !== undefined && values.length >= maxItems}
          onChange={addValues}
        />
        <button type="button" className={styles.tagAddButton} onClick={() => addValues(pendingValue)} disabled={!pendingValue.trim() || maxItems !== undefined && values.length >= maxItems}>
          Ajouter
        </button>
      </div>
      {note ? <small className={styles.tagFieldNote}>{note}</small> : null}
      {maxItems !== undefined && <small className={styles.tagFieldNote}>{values.length} / {maxItems} expressions{maxItemLength ? ` · ${maxItemLength} caractères par expression` : ""}</small>}
      {tagError && <small className={styles.tagFieldError} role="alert">{tagError}</small>}
    </div>
  );
}

function PinterestLocationSearch({ accountId, locations, onChange }: {
  accountId: string;
  locations: string[];
  onChange: (locations: string[]) => void;
}) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<PinterestGeographyOption[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const pageCount = Math.max(1, Math.ceil(options.length / 3));
  const visiblePage = Math.min(pageIndex, pageCount - 1);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const requestRef = useRef(0);

  useEffect(() => {
    requestRef.current += 1;
    setQuery("");
    setOptions([]);
    setState("idle");
    setError("");
    return () => { requestRef.current += 1; };
  }, [accountId]);

  async function search() {
    if (!accountId || query.trim().length < 2 || state === "loading") return;
    const requestId = ++requestRef.current;
    setState("loading");
    setOptions([]);
    setError("");
    try {
      const response = await readJson(await fetch(`/api/ads/pinterest/targeting?query=${encodeURIComponent(query.trim())}`, { cache: "no-store" }));
      if (requestId !== requestRef.current) return;
      if (response.selectedAccountId !== accountId) throw new Error("Le compte Pinterest a changé. Vérifiez son association avant une nouvelle recherche.");
      setOptions(Array.isArray(response.options) ? response.options.filter((option): option is PinterestGeographyOption => Boolean(
        option && typeof option === "object" && typeof option.id === "string" && typeof option.name === "string"
        && (option.type === "LOCATION" || option.type === "GEO"),
      )) : []);
      setState("ready");
    } catch (cause) {
      if (requestId !== requestRef.current) return;
      setState("error");
      setError(cause instanceof Error ? cause.message : "La recherche Pinterest est indisponible. Réessayez.");
    }
  }

  return <div className={styles.pinterestLocationSearch}>
    <label htmlFor={inputId}>Rechercher un département ou une région</label>
    <p>Si votre ville n’est pas proposée, choisissez une zone adaptée et retirez la ville ci-dessus.</p>
    <div className={styles.pinterestLocationSearchActions}>
      <input id={inputId} value={query} maxLength={100} placeholder="Ex. Nord, Pas-de-Calais, Hauts-de-France" disabled={!accountId} onChange={(event) => { requestRef.current += 1; setQuery(event.target.value); setPageIndex(0); setOptions([]); setState("idle"); setError(""); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} />
      <button type="button" className={styles.secondaryButton} disabled={!accountId || query.trim().length < 2 || state === "loading"} onClick={() => void search()}>{state === "loading" ? "Recherche…" : "Rechercher"}</button>
    </div>
    {!accountId && <small>Associez votre compte Pinterest dans la configuration du canal pour rechercher les zones disponibles.</small>}
    {state === "error" && <small role="alert" className={styles.copyLengthError}>{error}</small>}
    {state === "ready" && !options.length && <small role="status">Aucune zone Pinterest ne correspond. Essayez le département ou la région que vous souhaitez réellement couvrir.</small>}
    {options.length > 0 && <ul aria-label="Zones proposées par Pinterest" className={styles.pinterestLocationOptions}>{options.slice(visiblePage * 3, (visiblePage + 1) * 3).map((option) => {
      const selected = locations.some((location) => location.trim().toLocaleLowerCase("fr-FR") === option.name.trim().toLocaleLowerCase("fr-FR"));
      return <li key={`${option.type}-${option.id}`}><span><strong>{option.name}</strong><small>{option.kind === "country" ? "Pays entier" : option.kind === "region" ? "Région" : "Zone locale Pinterest"}</small></span><button type="button" className={styles.secondaryButton} disabled={selected || locations.length >= 20} aria-label={`${selected ? "Zone ajoutée" : "Ajouter"} : ${option.name}`} onClick={() => onChange([...locations, option.name])}>{selected ? "Ajoutée" : "Ajouter"}</button></li>;
    })}</ul>}
    {options.length > 3 && <nav className={styles.googleAdCopyPagination} aria-label="Parcourir les zones Pinterest">
      <button type="button" aria-label="Zones précédentes" disabled={visiblePage === 0} onClick={() => setPageIndex(visiblePage - 1)}>←</button>
      <span aria-live="polite">Page {visiblePage + 1} / {pageCount}</span>
      <button type="button" aria-label="Zones suivantes" disabled={visiblePage >= pageCount - 1} onClick={() => setPageIndex(visiblePage + 1)}>→</button>
    </nav>}
  </div>;
}

function GoogleLocationSearch({ accountId, locations, onChange }: {
  accountId: string;
  locations: string[];
  onChange: (locations: string[]) => void;
}) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<GoogleLocationOption[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const pageCount = Math.max(1, Math.ceil(options.length / 3));
  const visiblePage = Math.min(pageIndex, pageCount - 1);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const requestRef = useRef(0);

  useEffect(() => {
    requestRef.current += 1;
    setQuery("");
    setOptions([]);
    setState("idle");
    setError("");
    return () => { requestRef.current += 1; };
  }, [accountId]);

  async function search() {
    if (!accountId || query.trim().length < 2 || state === "loading") return;
    const requestId = ++requestRef.current;
    setState("loading");
    setOptions([]);
    setError("");
    try {
      const response = await readJson(await fetch(`/api/ads/google/targeting?query=${encodeURIComponent(query.trim())}`, { cache: "no-store" }));
      if (requestId !== requestRef.current) return;
      if (response.selectedAccountId !== accountId) throw new Error("Le compte Google Ads a changé. Vérifiez son association avant une nouvelle recherche.");
      setOptions(Array.isArray(response.options) ? response.options.filter((option): option is GoogleLocationOption => Boolean(
        option && typeof option === "object" && typeof option.id === "string" && typeof option.name === "string"
        && typeof option.canonicalName === "string" && typeof option.country === "string",
      )) : []);
      setState("ready");
    } catch (cause) {
      if (requestId !== requestRef.current) return;
      setState("error");
      setError(cause instanceof Error ? cause.message : "La recherche Google Ads est indisponible. Réessayez.");
    }
  }

  return <div className={styles.pinterestLocationSearch}>
    <label htmlFor={inputId}>Rechercher une ville ou une région</label>
    <p>Choisissez le lieu exact. « Préciser » remplace le nom court par la zone choisie.</p>
    <div className={styles.pinterestLocationSearchActions}>
      <input id={inputId} value={query} maxLength={120} placeholder="Ex. Lille, Arras, Hauts-de-France" disabled={!accountId} onChange={(event) => { requestRef.current += 1; setQuery(event.target.value); setPageIndex(0); setOptions([]); setState("idle"); setError(""); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} />
      <button type="button" className={styles.secondaryButton} disabled={!accountId || query.trim().length < 2 || state === "loading"} onClick={() => void search()}>{state === "loading" ? "Recherche…" : "Rechercher"}</button>
    </div>
    {!accountId && <small>Associez votre compte Google Ads dans la configuration du canal pour rechercher les zones disponibles.</small>}
    {state === "error" && <small role="alert" className={styles.copyLengthError}>{error}</small>}
    {state === "ready" && !options.length && <small role="status">Aucune zone Google ne correspond. Précisez le nom de la ville et son pays, ou recherchez votre région.</small>}
    {options.length > 0 && <ul aria-label="Zones proposées par Google Ads" className={styles.pinterestLocationOptions}>{options.slice(visiblePage * 3, (visiblePage + 1) * 3).map((option) => {
      const replacesName = option.name.toLocaleLowerCase("fr-FR") !== option.canonicalName.toLocaleLowerCase("fr-FR") && locations.some((location) => location.trim().toLocaleLowerCase("fr-FR") === option.name.toLocaleLowerCase("fr-FR"));
      const selected = !replacesName && locations.some((location) => location.trim().toLocaleLowerCase("fr-FR") === option.canonicalName.toLocaleLowerCase("fr-FR"));
      return <li key={option.id}><span><strong>{option.canonicalName}</strong><small>Pays : {option.country}</small></span><button type="button" className={styles.secondaryButton} disabled={selected || !replacesName && locations.length >= 20} aria-label={`${selected ? "Zone ajoutée" : replacesName ? "Préciser la zone" : "Ajouter"} : ${option.canonicalName}`} onClick={() => onChange(selectGoogleTargetLocation(locations, option))}>{selected ? "Ajoutée" : replacesName ? "Préciser" : "Ajouter"}</button></li>;
    })}</ul>}
    {options.length > 3 && <nav className={styles.googleAdCopyPagination} aria-label="Parcourir les zones Google">
      <button type="button" aria-label="Zones précédentes" disabled={visiblePage === 0} onClick={() => setPageIndex(visiblePage - 1)}>←</button>
      <span aria-live="polite">Page {visiblePage + 1} / {pageCount}</span>
      <button type="button" aria-label="Zones suivantes" disabled={visiblePage >= pageCount - 1} onClick={() => setPageIndex(visiblePage + 1)}>→</button>
    </nav>}
  </div>;
}

function GoogleAdCopyField({ label, singular, values, onChange, minItems, maxItems, maxLength }: GoogleAdCopyFieldProps) {
  const rows = Array.from({ length: Math.max(minItems, values.length) }, (_, index) => values[index] ?? "");
  const fieldId = useId();
  const tooLong = rows.some((value) => value.length > maxLength);
  const [pageIndex, setPageIndex] = useState(0);
  const pageSize = maxLength === 30 ? 5 : 4;
  const pageCount = Math.ceil(rows.length / pageSize);
  const visiblePage = Math.min(pageIndex, pageCount - 1);
  const startIndex = visiblePage * pageSize;

  return (
    <fieldset className={`${styles.field} ${styles.googleAdCopyField}`}>
      <legend>{label}</legend>
      <small>{minItems} minimum · {maxItems} maximum · {maxLength} caractères par {singular.toLowerCase()}</small>
      <div className={styles.googleAdCopyRows} data-copy-kind={maxLength === 30 ? "headline" : "description"}>
        {rows.slice(startIndex, startIndex + pageSize).map((value, offset) => {
          const index = startIndex + offset;
          return <div className={styles.googleAdCopyRow} key={index}>
            <label htmlFor={`${fieldId}-${index}`}>{singular} {index + 1}</label>
            <CampaignTextarea
              id={`${fieldId}-${index}`}
              rows={1}
              value={value}
              aria-invalid={value.length > maxLength || undefined}
              aria-describedby={`${fieldId}-${index}-count`}
              placeholder={`${singular} ${index + 1}`}
              onChange={(event) => onChange(rows.map((entry, rowIndex) => rowIndex === index ? event.target.value.replace(/\r?\n/g, " ") : entry))}
            />
            <span id={`${fieldId}-${index}-count`} data-invalid={value.length > maxLength || undefined} aria-label={`${value.length} caractères sur ${maxLength}`}>{value.length}/{maxLength}</span>
            {rows.length > minItems && <button type="button" aria-label={`Retirer ${singular.toLowerCase()} ${index + 1}`} title={`Retirer ${singular.toLowerCase()} ${index + 1}`} onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}>×</button>}
          </div>;
        })}
      </div>
      {pageCount > 1 && <nav className={styles.googleAdCopyPagination} aria-label={`Parcourir les ${label.toLowerCase()}`}>
        <button type="button" aria-label={`${label} précédents`} disabled={visiblePage === 0} onClick={() => setPageIndex(visiblePage - 1)}>←</button>
        <span aria-live="polite">{startIndex + 1}–{Math.min(startIndex + pageSize, rows.length)} sur {rows.length}</span>
        <button type="button" aria-label={`${label} suivants`} disabled={visiblePage === pageCount - 1} onClick={() => setPageIndex(visiblePage + 1)}>→</button>
      </nav>}
      {tooLong && <small className={styles.copyLengthError} role="status">Reformulez les textes trop longs : aucune phrase ne sera coupée pour respecter la limite.</small>}
      {rows.length < maxItems && <button type="button" className={styles.googleAdCopyAdd} onClick={() => { onChange([...rows, ""]); setPageIndex(Math.floor(rows.length / pageSize)); }}>+ Ajouter {singular === "Titre" ? "un titre" : "une description"}</button>}
    </fieldset>
  );
}

function StudioStepHeader({
  number,
  label,
  title,
  mobileTitle,
  channel,
}: {
  number: number;
  label: string;
  title: string;
  mobileTitle: string;
  channel: string;
}) {
  return (
    <header className={styles.studioStepHeader}>
      <span className={styles.studioStepLabel}>{String(number).padStart(2, "0")} · {label}</span>
      <h2><span className={styles.studioTitleLong}>{title}</span><span className={styles.studioTitleShort}>{mobileTitle}</span></h2>
      <span className={styles.studioStepChannel}>{channel}</span>
    </header>
  );
}

function CampaignMediaPreview({
  url,
  type,
  campaignName,
  onChooseMedia,
}: {
  url: string;
  type: "image" | "video";
  campaignName: string;
  onChooseMedia: () => void;
}) {
  const previewable = (url.startsWith("/") && !url.startsWith("//")) || /^https:\/\//i.test(url);
  const [failed, setFailed] = useState(!previewable);

  return <div className={styles.campaignMediaPreview} data-type={type}>
    {failed ? <div className={styles.campaignMediaPreviewFallback} role="status">
      <strong>Aperçu du média indisponible</strong>
      <p>Vérifiez son lien ou choisissez un autre média dans votre médiathèque.</p>
      <div>
        {previewable && <button type="button" onClick={() => setFailed(false)}>Réessayer</button>}
        <button type="button" onClick={onChooseMedia}>Choisir un autre média</button>
      </div>
    </div> : type === "video"
      ? <video src={url} aria-label="Aperçu de la vidéo associée à la campagne" onError={() => setFailed(true)} controls playsInline preload="metadata" />
      : <Image src={url} alt={`Aperçu de l’image associée à la campagne ${campaignName}`} onError={() => setFailed(true)} fill unoptimized sizes="(max-width: 800px) 100vw, 70vw" className={styles.campaignMediaPreviewImage} />}
  </div>;
}

function campaignPromise(channel: AdsChannelId) {
  if (channel === "google") {
    return "Quand une personne recherche précisément votre service, une campagne Google Ads bien pensée vous place au bon moment, devant la bonne intention.";
  }
  if (channel === "meta") {
    return "Une campagne Meta Ads bien pensée transforme votre expertise en une rencontre utile avec les personnes qui peuvent devenir vos clients.";
  }
  return "Une campagne claire donne à votre expertise la place qu’elle mérite auprès des personnes prêtes à vous découvrir.";
}

export default function AdsClient({ initialChannel, initialEditCampaignId, initialConnections, initialConnection, initialReason, livePublishingEnabled, googlePublishingEnabled, pinterestPublishingEnabled, openaiPausedPublishingEnabled, pilotChannelsEnabled }: {
  initialChannel: AdsChannelId;
  initialEditCampaignId: string;
  initialConnections: AdsConnectionSnapshots;
  initialConnection: "connected" | "error" | null;
  initialReason: string;
  livePublishingEnabled: boolean;
  googlePublishingEnabled: boolean;
  pinterestPublishingEnabled: boolean;
  openaiPausedPublishingEnabled: boolean;
  pilotChannelsEnabled: boolean;
}) {
  const router = useRouter();
  const [provider, setProvider] = useState<AdsProvider>(() => isAdsProvider(initialChannel) ? initialChannel : "google");
  const [channelId, setChannelId] = useState<AdsChannelId>(initialChannel);
  const [channelIndex, setChannelIndex] = useState(() => CHANNEL_CATALOG.findIndex((channel) => channel.id === initialChannel));
  const channelPointerStart = useRef<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<AdsCampaignInput>(() => ({
    ...newDraft(initialChannel),
    adAccountId: initialConnections[initialChannel].accountId,
    pageId: initialConnections[initialChannel].pageId,
  }));
  const [savedId, setSavedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(true);
  const planGenerationRevision = useRef(0);
  const [accounts, setAccounts] = useState<AdsAccount[]>([]);
  const [pages, setPages] = useState<{ id: string; name: string; instagramUserId?: string }[]>([]);
  const [connectionSnapshots, setConnectionSnapshots] = useState<AdsConnectionSnapshots>(initialConnections);
  const [connected, setConnected] = useState(initialConnections[initialChannel].status === "connected");
  const [connectionStatus, setConnectionStatus] = useState<ConnectionDisplayStatus>(initialConnections[initialChannel].status === "unknown" ? "disconnected" : initialConnections[initialChannel].status);
  const [connectionAccount, setConnectionAccount] = useState<{ displayName?: string; email?: string; id?: string } | undefined>();
  const [configuredAccountId, setConfiguredAccountId] = useState(initialConnections[initialChannel].accountId);
  const [configuredAccountLabel, setConfiguredAccountLabel] = useState(initialConnections[initialChannel].accountLabel);
  const [configuredPageId, setConfiguredPageId] = useState(initialConnections[initialChannel].pageId);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [accountsRefreshRevisions, setAccountsRefreshRevisions] = useState<Record<AdsProvider, number>>({ meta: 0, google: 0 });
  const providerAccountsCache = useRef<Partial<Record<AdsProvider, AccountResponse>>>({});
  const providerAccountsFetchedRevision = useRef<Record<AdsProvider, number>>({ meta: -1, google: -1 });
  const [configAction, setConfigAction] = useState<AdsConfigAction>(null);
  const [externalStatuses, setExternalStatuses] = useState<Record<ExternalChannelId, ExternalConnectorStatus>>({
    linkedin: externalStatusFromSnapshot(initialConnections.linkedin), tiktok: externalStatusFromSnapshot(initialConnections.tiktok),
    pinterest: externalStatusFromSnapshot(initialConnections.pinterest), x: externalStatusFromSnapshot(initialConnections.x),
  });
  const [externalConfiguring, setExternalConfiguring] = useState(initialConnection !== null && isExternalChannel(initialChannel));
  const [openaiConfiguring, setOpenaiConfiguring] = useState(false);
  const [openaiAccountReady, setOpenaiAccountReady] = useState(false);
  const [openaiReadinessMessage, setOpenaiReadinessMessage] = useState("");
  const [externalAccounts, setExternalAccounts] = useState<ExternalAdsAccount[]>([]);
  const [externalAccountChoice, setExternalAccountChoice] = useState(initialConnections[initialChannel].accountId);
  const [externalAccountsLoading, setExternalAccountsLoading] = useState(false);
  const [externalAccountsLoadFailed, setExternalAccountsLoadFailed] = useState(false);
  const [externalAction, setExternalAction] = useState<"associate" | "disconnect" | null>(null);
  const [externalError, setExternalError] = useState("");
  const [linkedInPreflight, setLinkedInPreflight] = useState<LinkedInAdsPreflightResponse | null>(null);
  const [linkedInPreflightLoad, setLinkedInPreflightLoad] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [linkedInPreflightError, setLinkedInPreflightError] = useState("");
  const [linkedInGeoQuery, setLinkedInGeoQuery] = useState("");
  const linkedInPreflightCache = useRef(new Map<string, LinkedInAdsPreflightResponse>());
  const externalAccountsRequest = useRef(0);
  const externalAccountsCache = useRef<Record<ExternalChannelId, ExternalAccountsCacheEntry>>({
    linkedin: { accounts: [], choice: initialConnections.linkedin.accountId, loaded: false, failed: false },
    pinterest: { accounts: [], choice: initialConnections.pinterest.accountId, loaded: false, failed: false },
    tiktok: { accounts: [], choice: initialConnections.tiktok.accountId, loaded: false, failed: false },
    x: { accounts: [], choice: initialConnections.x.accountId, loaded: false, failed: false },
  });
  const externalStatusRequests = useRef<Record<ExternalChannelId, number>>({ linkedin: 0, pinterest: 0, tiktok: 0, x: 0 });
  const [busy, setBusy] = useState<CampaignBusyAction>(null);
  const [draftsRevision, setDraftsRevision] = useState(0);
  const demoSubmissionRef = useRef(false);
  const editLoadId = useRef("");
  const launchButtonRef = useRef<HTMLButtonElement | null>(null);
  const [demoDialog, setDemoDialog] = useState<DemoDialogState | null>(null);
  const [publicationPhase, setPublicationPhase] = useState<AdsPublicationPhase>("idle");
  const [confirmedSpend, setConfirmedSpend] = useState(false);
  const [confirmedDestinationUrl, setConfirmedDestinationUrl] = useState("");
  const [configuring, setConfiguring] = useState(initialConnection !== null && isAdsProvider(initialChannel));
  const [creating, setCreating] = useState(false);
  const [step, setStep] = useState(0);
  const [creationPath, setCreationPath] = useState<CampaignCreationPath>("choice");
  const [analysisSetupOpen, setAnalysisSetupOpen] = useState(false);
  const [analysisMode, setAnalysisMode] = useState<AdsCampaignAnalysisMode>("free");
  const [guidedAnalysisObjective, setGuidedAnalysisObjective] = useState("");
  const [planProgress, setPlanProgress] = useState(0);
  const [completedAnalysisStages, setCompletedAnalysisStages] = useState(0);
  const [planRationale, setPlanRationale] = useState("");
  const [planSources, setPlanSources] = useState<string[]>([]);
  const [planError, setPlanError] = useState("");
  const [planRequestId, setPlanRequestId] = useState("");
  const [autoMediaPlan, setAutoMediaPlan] = useState<AdsCampaignPlan | null>(null);
  const [autoMediaState, setAutoMediaState] = useState<"idle" | "generating" | "ready" | "skipped" | "error">("idle");
  const [autoMediaMessage, setAutoMediaMessage] = useState("");
  const [campaignMediaStudioOpen, setCampaignMediaStudioOpen] = useState(false);
  const [campaignMediaLibraryOpen, setCampaignMediaLibraryOpen] = useState(false);
  const [metaMediaSlot, setMetaMediaSlot] = useState<MetaAdsMediaSlot | null>(null);
  const [metaMediaFormatStatus, setMetaMediaFormatStatus] = useState<Record<MetaAdsMediaSlot, MetaAdsMediaFormatStatus>>({
    feed: "empty",
    story_reel: "empty",
  });
  const handleMetaMediaFormatStatus = useCallback((slot: MetaAdsMediaSlot, status: MetaAdsMediaFormatStatus) => {
    setMetaMediaFormatStatus((current) => current[slot] === status ? current : { ...current, [slot]: status });
  }, []);
  const [campaignMediaUploadBusy, setCampaignMediaUploadBusy] = useState(false);
  const [campaignMediaUploadError, setCampaignMediaUploadError] = useState("");
  const planProgressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const planProgressTarget = useRef(0);
  const planProgressValue = useRef(0);
  const planProgressTick = useRef(0);
  const planResponseReceived = useRef(false);
  const completedAnalysisStagesValue = useRef(0);
  const campaignImageInputRef = useRef<HTMLInputElement | null>(null);
  const campaignVideoInputRef = useRef<HTMLInputElement | null>(null);
  const [compactScreen, setCompactScreen] = useState(false);
  const [shortScreen, setShortScreen] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const studioWorkspaceRef = useRef<HTMLDivElement | null>(null);
  const keywordStepName = channelId === "google" ? "Mots-clés" : "Signaux";
  // Only genuinely text-only formats omit this workspace. Keep the same rule
  // for a fresh campaign, an AI proposal and a reopened draft.
  const hasMediaStep = adsDraftHasMediaStep(draft);
  const hasKeywordsStep = adsDraftHasKeywordsStep(draft);
  const mediaStepName = channelId === "linkedin" ? "Média LinkedIn" : "Médias";
  const manualStepNames = channelId === "pinterest"
    ? ["Votre projet", "Objectif Pinterest", "Audience Pinterest", ...(hasKeywordsStep ? ["Découverte Pinterest"] : []), "Épingle sponsorisée", "Format du Pin", "Pur média", "Destination & mesure", "Budget Pinterest", "Validation Pinterest"]
    : ["Votre projet", "Fondations", "Ciblage", ...(hasKeywordsStep ? [keywordStepName] : []), "Créations", ...(hasMediaStep ? [mediaStepName] : []), "Diffusion", "Budget", "Validation"];
  const inrcyStepNames = channelId === "pinterest"
    ? ["Votre projet", "Analyse iNrCy", "Objectif Pinterest", "Audience Pinterest", ...(hasKeywordsStep ? ["Découverte Pinterest"] : []), "Épingle sponsorisée", "Format du Pin", "Pur média", "Destination & mesure", "Budget Pinterest", "Validation Pinterest"]
    : ["Votre projet", "Analyse iNrCy", "Fondations", "Ciblage", ...(hasKeywordsStep ? [keywordStepName] : []), "Créations", ...(hasMediaStep ? [mediaStepName] : []), "Diffusion", "Budget", "Validation"];
  const stepNames = creationPath === "inrcy" ? inrcyStepNames : manualStepNames;
  const displayedStepNames = creationPath === "choice" && analysisSetupOpen ? inrcyStepNames : stepNames;
  const lastStep = stepNames.length - 1;
  const foundationsStep = creationPath === "inrcy" ? 2 : 1;
  const targetingStep = foundationsStep + 1;
  const keywordsStep = hasKeywordsStep ? targetingStep + 1 : -1;
  const creativeStep = targetingStep + (hasKeywordsStep ? 2 : 1);
  const pinterestFormatStep = channelId === "pinterest" ? creativeStep + 1 : -1;
  const mediaStep = hasMediaStep ? creativeStep + (channelId === "pinterest" ? 2 : 1) : -1;
  const deliveryStep = creativeStep + (hasMediaStep ? channelId === "pinterest" ? 3 : 2 : 1);
  const budgetStep = deliveryStep + 1;
  const validationStep = budgetStep + 1;
  const analysisStep = creationPath === "inrcy" ? 1 : -1;

  function stopPlanProgress() {
    if (planProgressTimer.current) {
      clearInterval(planProgressTimer.current);
      planProgressTimer.current = null;
    }
  }

  function startPlanProgress() {
    stopPlanProgress();
    planProgressTarget.current = 78;
    planProgressValue.current = 0;
    planProgressTick.current = 0;
    planResponseReceived.current = false;
    completedAnalysisStagesValue.current = 0;
    setCompletedAnalysisStages(0);
    setPlanProgress(0);

    // The plan endpoint returns a single final response, not stage telemetry.
    // Before it answers, the bar is explicitly indicative and capped below the
    // completed-plan threshold. Checked stages are reserved for the real answer.
    planProgressTimer.current = setInterval(() => {
      const tick = ++planProgressTick.current;
      const target = planProgressTarget.current;
      const shouldAdvance = planResponseReceived.current || tick % 3 === 0;
      const cap = target === 100 && completedAnalysisStagesValue.current < AI_ANALYSIS_STAGES.length - 1
        ? 99 : target;
      if (shouldAdvance && planProgressValue.current < cap) {
        planProgressValue.current += 1;
        setPlanProgress(planProgressValue.current);
      }

      // A returned plan can be acknowledged one stage at a time. No stage is
      // marked complete while the server request is still unresolved.
      const completed = completedAnalysisStagesValue.current;
      if (planResponseReceived.current && completed < AI_ANALYSIS_STAGES.length - 1 && tick % 7 === 0
        && planProgressValue.current >= AI_ANALYSIS_STAGES[completed].at) {
        completedAnalysisStagesValue.current = completed + 1;
        setCompletedAnalysisStages(completed + 1);
      }
      if (planProgressValue.current === 100) stopPlanProgress();
    }, 120);
  }

  useEffect(() => () => {
    if (planProgressTimer.current) {
      clearInterval(planProgressTimer.current);
      planProgressTimer.current = null;
    }
  }, []);
  useEffect(() => {
    if (!creating || !compactScreen) return;
    const scrollArea = studioWorkspaceRef.current?.closest<HTMLElement>('[data-dashboard-settings-drawer-scroll="true"]');
    if (scrollArea) scrollArea.scrollTop = 0;
  }, [creating, compactScreen, step, analysisSetupOpen, channelId]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 999px), (max-height: 659px)");
    const shortMedia = window.matchMedia("(max-height: 600px)");
    const update = () => { setCompactScreen(media.matches); setShortScreen(shortMedia.matches); };
    update();
    media.addEventListener("change", update);
    shortMedia.addEventListener("change", update);
    return () => { media.removeEventListener("change", update); shortMedia.removeEventListener("change", update); };
  }, []);
  const [notice, setNotice] = useState(initialConnection === "error" ? /Meta.*HTTPS/i.test(initialReason) ? "Pour connecter Meta Ads, ouvrez iNrCy depuis son adresse sécurisée (HTTPS)." : initialReason || "La connexion publicitaire n’a pas abouti." : "");

  const applyProviderAccountsResult = useCallback((channel: AdsProvider, result: AccountResponse, announce: boolean) => {
    if (result.connected && result.error) {
      // A temporary discovery error does not invalidate the stored association.
      if (announce) setNotice(result.error);
      return;
    }
    const nextAccounts = result.accounts || [];
    const nextPages = result.pages || [];
    const eligibleAccounts = nextAccounts.filter(adsAccountCanBeAssociated);
    const linkedInstagramPages = nextPages.filter((page) => Boolean(page.instagramUserId));
    const persistedAccount = eligibleAccounts.find((account) => account.id === result.selectedAccountId);
    const suggestedAccount = eligibleAccounts.find((account) => account.id === result.suggestedAccountId);
    const persistedPage = nextPages.find((page) => page.id === result.selectedPageId);
    const persistedAccountId = String(result.selectedAccountId || "");
    const persistedPageId = String(result.selectedPageId || "");

    setConnected(result.connected);
    setConnectionStatus(result.connectionStatus || (result.connected ? "connected" : "disconnected"));
    setConnectionAccount(result.connectionAccount);
    setAccounts(nextAccounts);
    setPages(nextPages);
    setConfiguredAccountId(persistedAccountId);
    setConfiguredAccountLabel(String(result.selectedAccountLabel || ""));
    setConfiguredPageId(persistedPageId);
    setConnectionSnapshots((current) => ({ ...current, [channel]: {
      status: result.connectionStatus || (result.connected ? "connected" : "disconnected"),
      accountId: persistedAccountId,
      accountLabel: String(result.selectedAccountLabel || ""),
      pageId: persistedPageId,
      ...(persistedAccountId ? { accountAvailable: result.selectedAccountAvailable === true } : {}),
      ...(persistedPageId ? { pageAvailable: result.selectedPageAvailable === true } : {}),
    } }));
    setDraft((current) => {
      if (current.provider !== channel) return current;
      const hasPersistedAccount = Boolean(persistedAccountId);
      const existingAccount = hasPersistedAccount || result.accountSelectionCleared
        ? undefined
        : eligibleAccounts.find((account) => account.id === current.adAccountId);
      const account = persistedAccount || existingAccount || suggestedAccount;
      const existingPage = nextPages.find((page) => page.id === current.pageId);
      const page = persistedPage || existingPage || (channel === "meta" && linkedInstagramPages.length === 1 ? linkedInstagramPages[0] : undefined);
      const currentChoice = result.accountSelectionCleared ? undefined : eligibleAccounts.find((candidate) => candidate.id === current.adAccountId);
      const adAccountId = currentChoice?.id || persistedAccountId || account?.id || "";
      const pageId = channel === "meta" ? persistedPageId || page?.id || "" : current.pageId;
      if (current.adAccountId === adAccountId && current.accountCurrency === "EUR" && current.pageId === pageId) return current;
      return { ...current, adAccountId, accountCurrency: "EUR", pageId };
    });

    if (!announce) return;
    if (result.connectionStatus === "needs_update") {
      setNotice(`La connexion ${channel === "google" ? "Google Ads" : "Meta Ads"} doit être actualisée avant de charger vos comptes.`);
    }
    if (result.error) setNotice(result.error);
  }, []);

  const selectedAccount = isAdsProvider(channelId) ? accounts.find((account) => account.id === draft.adAccountId) : undefined;
  const configuredAdvertiserAccount = isAdsProvider(channelId)
    ? accounts.find((account) => account.id === configuredAccountId && account.provider === channelId && adsAccountCanBeAssociated(account))
    : undefined;
  const associatedAccountName = configuredAdvertiserAccount?.name || configuredAccountLabel || (configuredAccountId ? `Compte ${configuredAccountId}` : "");
  const configuredAdvertiserAccountUrl = configuredAccountId && isAdsProvider(channelId)
    ? getAdsAdvertiserAccountUrl(channelId, configuredAccountId)
    : null;
  const metaNeedsInstagramIdentity = channelId === "meta" && metaPlacementsNeedInstagramIdentity(draft.metaPlacements);
  const configuredMetaPage = channelId === "meta"
    ? pages.find((page) => page.id === configuredPageId)
    : undefined;
  const channelMeta = CHANNEL_CATALOG.find((channel) => channel.id === channelId) || CHANNEL_CATALOG[0];
  const campaignCreationTitle = `Créer une campagne ${CAMPAIGN_CHANNEL_NAMES[channelId]}`;
  const accessibleChannels = CHANNEL_CATALOG.filter((channel) => pilotChannelsEnabled || isAdsPublicChannel(channel.id));
  const connectionChannelIndex = Math.max(0, accessibleChannels.findIndex((channel) => channel.id === channelId));
  const previousConnectionChannel = accessibleChannels[(connectionChannelIndex - 1 + accessibleChannels.length) % accessibleChannels.length];
  const nextConnectionChannel = accessibleChannels[(connectionChannelIndex + 1) % accessibleChannels.length];
  const externalSettingsChannel: ExternalChannelId = isExternalChannel(channelId) ? channelId : "linkedin";
  const activeExternalStatus = isExternalChannel(channelId) ? externalStatuses[channelId] : null;
  // LinkedIn has its own rollout gate. A durable account snapshot is not a
  // publication authorization: require the current status endpoint to confirm it.
  const linkedInPublishingEnabled = externalStatuses.linkedin.load === "ready"
    && externalStatuses.linkedin.publicationEnabled === true;
  const channelPublishingEnabled = channelId === "linkedin"
    ? linkedInPublishingEnabled
    : channelId === "google" ? googlePublishingEnabled
      : channelId === "pinterest" ? pinterestPublishingEnabled
        : channelId === "openai" ? openaiPausedPublishingEnabled && openaiAccountReady : livePublishingEnabled;
  const reviewAccountReady = isAdsProvider(channelId)
    ? Boolean(connected && configuredAdvertiserAccount && (channelId !== "meta" || (
      configuredMetaPage
      && draft.pageId === configuredPageId
      && (!metaNeedsInstagramIdentity || configuredMetaPage.instagramUserId)
    )))
    : channelId === "openai"
      ? Boolean(connectionSnapshots.openai.status === "connected" && connectionSnapshots.openai.accountId)
      : Boolean(activeExternalStatus?.connected && activeExternalStatus.selectedAccountId);
  const reviewAccountStatusLabel = reviewAccountReady
    ? isExternalChannel(channelId)
      ? "Compte annonceur associé"
      : channelId === "meta"
      ? metaNeedsInstagramIdentity
        ? "Compte, Page et Instagram associés"
        : "Compte et Page Facebook associés"
      : "Compte annonceur associé"
    : channelId === "openai" && connectionSnapshots.openai.accountId
      ? "Compte associé · vérification API et revue de marque nécessaires"
    : channelId === "meta" && draft.pageId && draft.pageId !== configuredPageId
      ? "Identité Meta sélectionnée · association à confirmer"
    : channelId === "meta" && configuredAccountId && configuredPageId && metaNeedsInstagramIdentity
      ? "Compte et Page associés · Instagram requis pour ces placements"
      : isExternalChannel(channelId) && activeExternalStatus?.selectedAccountId
        ? "Compte associé · accès à vérifier"
      : configuredAccountId
        ? "Compte associé · accès à vérifier"
        : isExternalChannel(channelId)
          ? "Associez un compte pour enregistrer cette proposition"
          : channelId === "openai" ? "Ajoutez la clé Advertiser API du compte ChatGPT Ads"
          : "Associez un compte pour créer la démo en pause";

  const refreshOpenaiStatus = useCallback(async () => {
    try {
      const status = await readJson(await fetch("/api/ads/openai/status", { cache: "no-store" })) as {
        connected?: boolean; accountId?: string; accountName?: string; pausedCreationEnabled?: boolean; readinessMessage?: string;
      };
      const accountId = status.connected ? String(status.accountId || "") : "";
      setOpenaiAccountReady(status.connected === true && status.pausedCreationEnabled === true && Boolean(accountId));
      setOpenaiReadinessMessage(String(status.readinessMessage || ""));
      setConnectionSnapshots((current) => ({ ...current, openai: {
        ...current.openai,
        status: accountId ? "connected" : "disconnected",
        accountId,
        accountLabel: accountId ? String(status.accountName || accountId) : "",
      } }));
      if (accountId) setDraft((current) => current.provider === "openai" && !current.adAccountId
        ? { ...current, adAccountId: accountId } : current);
    } catch {
      // Keep the durable account snapshot visible during a transient check.
      setOpenaiAccountReady(false);
    }
  }, []);

  useEffect(() => {
    if (pilotChannelsEnabled) void refreshOpenaiStatus();
  }, [pilotChannelsEnabled, refreshOpenaiStatus]);

  const refreshExternalStatus = useCallback(async (channel: ExternalChannelId, options?: { silent?: boolean }) => {
    const requestId = ++externalStatusRequests.current[channel];
    setExternalStatuses((current) => ({
      ...current,
      [channel]: {
        ...current[channel],
        load: options?.silent && current[channel].load === "ready" ? "ready" : "loading",
        publicationEnabled: channel === "linkedin" ? false : current[channel].publicationEnabled,
        error: "",
      },
    }));
    try {
      const data = await readAdsConnectionStatus(await fetch(`/api/ads/${channel}/status`, { cache: "no-store" }));
      if (requestId !== externalStatusRequests.current[channel]) return;
      const status = typeof data.status === "string" ? data.status : "disconnected";
      const selectedAccountId = typeof data.selectedAccountId === "string" ? data.selectedAccountId : "";
      const selectedAccountName = typeof data.selectedAccountName === "string" ? data.selectedAccountName
        : typeof data.selectedAccountLabel === "string" ? data.selectedAccountLabel : "";
      const scopes = Array.isArray(data.scopes) ? data.scopes.filter((scope): scope is string => typeof scope === "string") : [];
      const missingScopes = Array.isArray(data.missingScopes) ? data.missingScopes.filter((scope): scope is string => typeof scope === "string") : [];
      setExternalStatuses((current) => ({
        ...current,
        [channel]: {
          load: "ready",
          configured: data.configured !== false && status !== "not_configured" && status !== "configuration_missing",
          connected: data.connected === true,
          status,
          selectedAccountId,
          selectedAccountName,
          scopes,
          missingScopes,
          selectedAccountCanManage: data.selectedAccountCanManage === true,
          selectedAccountCanServe: data.selectedAccountCanServe === true,
          publicationEnabled: data.publicationEnabled === true,
          error: "",
        },
      }));
      setConnectionSnapshots((current) => ({ ...current, [channel]: {
        status: status === "connected" ? "connected" : status === "needs_update" || status === "needs_reconnect" ? "needs_update" : "disconnected",
        accountId: selectedAccountId,
        accountLabel: selectedAccountName,
        pageId: "",
      } }));
    } catch (error) {
      if (requestId !== externalStatusRequests.current[channel]) return;
      setExternalStatuses((current) => ({
        ...current,
        [channel]: { ...current[channel], load: "error", error: error instanceof Error ? error.message : "État indisponible." },
      }));
    }
  }, []);

  useEffect(() => {
    if ((pilotChannelsEnabled || isAdsPublicChannel(channelId)) && isExternalChannel(channelId) && externalStatuses[channelId].load === "idle") void refreshExternalStatus(channelId);
  }, [channelId, externalStatuses, pilotChannelsEnabled, refreshExternalStatus]);

  useEffect(() => {
    for (const channel of EXTERNAL_CHANNELS) if (pilotChannelsEnabled || isAdsPublicChannel(channel)) void refreshExternalStatus(channel, { silent: true });
  }, [pilotChannelsEnabled, refreshExternalStatus]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const callbackChannel = params.get("channel");
    if (!isExternalChannel(callbackChannel) || (!pilotChannelsEnabled && !isAdsPublicChannel(callbackChannel))) return;
    const index = CHANNEL_CATALOG.findIndex((channel) => channel.id === callbackChannel);
    setChannelIndex(index);
    setChannelId(callbackChannel);
    setDraft((current) => current.provider === callbackChannel ? current : newDraft(callbackChannel));
    setConfirmedDestinationUrl("");
    setConfiguring(false);
    setNotice("");
    if (params.has("connection")) {
      externalAccountsCache.current[callbackChannel] = {
        accounts: [],
        choice: "",
        loaded: false,
        failed: false,
      };
      setExternalConfiguring(true);
      void refreshExternalStatus(callbackChannel);
      if (params.get("connection") === "error") {
        setExternalError(params.get("reason") || "La connexion n’a pas abouti. Réessayez.");
      }
      params.delete("connection");
      params.delete("reason");
      window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}`);
    }
  }, [pilotChannelsEnabled, refreshExternalStatus]);

  useEffect(() => {
    if (!initialConnection) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("connection")) return;
    params.delete("connection");
    params.delete("reason");
    const query = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, [initialConnection]);

  const loadExternalAccounts = useCallback(async (channel: ExternalChannelId, persistedAccountId: string, force = false) => {
    const cached = externalAccountsCache.current[channel];
    if (cached.loaded && !force) {
      setExternalAccounts(cached.accounts);
      setExternalAccountChoice(cached.choice || persistedAccountId);
      setExternalAccountsLoadFailed(cached.failed);
      setExternalAccountsLoading(false);
      return;
    }
    const requestId = ++externalAccountsRequest.current;
    setExternalAccountsLoading(true);
    setExternalAccountsLoadFailed(false);
    try {
      const data = await readJson(await fetch(`/api/ads/${channel}/accounts`, { cache: "no-store" }));
      if (requestId !== externalAccountsRequest.current) return;
      const nextAccounts = Array.isArray(data.accounts)
        ? data.accounts.filter((account): account is ExternalAdsAccount => account && typeof account === "object" && typeof account.id === "string" && typeof account.name === "string")
        : [];
      const storedChoice = externalAccountsCache.current[channel].choice;
      const nextChoice = nextAccounts.some((account) => account.id === storedChoice)
        ? storedChoice : typeof data.selectedAccountId === "string" ? data.selectedAccountId : persistedAccountId;
      externalAccountsCache.current[channel] = { accounts: nextAccounts, choice: nextChoice, loaded: true, failed: false };
      setExternalAccounts(nextAccounts);
      setExternalAccountChoice(nextChoice);
      setExternalStatuses((current) => ({
        ...current,
        [channel]: {
          ...current[channel],
          selectedAccountCanManage: data.selectedAccountCanManage === true,
          selectedAccountCanServe: data.selectedAccountCanServe === true,
          // Account discovery does not own LinkedIn's rollout authorization.
          publicationEnabled: channel === "linkedin"
            ? current[channel].publicationEnabled
            : data.publicationEnabled === true,
        },
      }));
      setExternalError("");
    } catch (error) {
      if (requestId === externalAccountsRequest.current) {
        externalAccountsCache.current[channel] = { ...cached, failed: true };
        setExternalAccountsLoadFailed(true);
        setExternalError(error instanceof Error ? error.message : "Comptes indisponibles.");
        void refreshExternalStatus(channel, { silent: true });
      }
    } finally {
      if (requestId === externalAccountsRequest.current) setExternalAccountsLoading(false);
    }
  }, [refreshExternalStatus]);

  useEffect(() => {
    if (!externalConfiguring || !isExternalChannel(channelId)) return;
    if (!externalStatuses[channelId].connected) { setExternalAccountsLoading(false); return; }
    void loadExternalAccounts(channelId, externalStatuses[channelId].selectedAccountId);
    return () => { externalAccountsRequest.current += 1; };
  }, [externalConfiguring, channelId, externalStatuses.linkedin.connected, externalStatuses.linkedin.selectedAccountId, externalStatuses.pinterest.connected, externalStatuses.pinterest.selectedAccountId, externalStatuses.tiktok.connected, externalStatuses.tiktok.selectedAccountId, externalStatuses.x.connected, externalStatuses.x.selectedAccountId, loadExternalAccounts]);

  function openExternalConfiguration(channel: ExternalChannelId) {
    openChannelConfiguration(channel);
  }

  async function associateExternalAccount() {
    if (!isExternalChannel(channelId) || !externalAccountChoice || externalAction) return;
    setExternalAction("associate");
    setExternalError("");
    try {
      await readJson(await fetch(`/api/ads/${channelId}/accounts`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: externalAccountChoice }),
      }));
      externalAccountsCache.current[channelId] = {
        ...externalAccountsCache.current[channelId],
        choice: externalAccountChoice,
      };
      await refreshExternalStatus(channelId);
    } catch (error) {
      setExternalError(error instanceof Error ? error.message : "Association impossible.");
    } finally {
      setExternalAction(null);
    }
  }

  async function disconnectExternalChannel() {
    if (!isExternalChannel(channelId) || !EXTERNAL_DISCONNECT_CHANNELS.includes(channelId) || externalAction) return;
    setExternalAction("disconnect");
    setExternalError("");
    try {
      await readJson(await fetch(`/api/ads/${channelId}/disconnect`, { method: "POST" }));
      externalAccountsCache.current[channelId] = { accounts: [], choice: "", loaded: false, failed: false };
      setExternalAccounts([]);
      setExternalAccountChoice("");
      await refreshExternalStatus(channelId);
    } catch (error) {
      setExternalError(error instanceof Error ? error.message : "Déconnexion impossible.");
    } finally {
      setExternalAction(null);
    }
  }

  function selectChannel(index: number) {
    let nextIndex = ((index % CHANNEL_CATALOG.length) + CHANNEL_CATALOG.length) % CHANNEL_CATALOG.length;
    if (!pilotChannelsEnabled) {
      const direction = index < channelIndex ? -1 : 1;
      while (!isAdsPublicChannel(CHANNEL_CATALOG[nextIndex].id)) {
        nextIndex = (nextIndex + direction + CHANNEL_CATALOG.length) % CHANNEL_CATALOG.length;
      }
    }
    setChannelIndex(nextIndex);
    const next = CHANNEL_CATALOG[nextIndex].id;
    if (next === channelId) return;
    if (isAdsProvider(next)) {
      changeProvider(next);
      return;
    }
    setChannelId(next);
    const nextDraft = newDraft(next);
    nextDraft.adAccountId = next === "openai"
      ? connectionSnapshots.openai.accountId
      : externalStatuses[next].selectedAccountId;
    setDraft(nextDraft);
    setConnected(false);
    setConnectionStatus("disconnected");
    setConnectionAccount(undefined);
    setConfiguredAccountId("");
    setConfiguredPageId("");
    setAccounts([]);
    setPages([]);
    setSavedId(null);
    setDirty(true);
    setMetaMediaFormatStatus({ feed: "empty", story_reel: "empty" });
    setConfirmedSpend(false);
    setConfirmedDestinationUrl("");
    setNotice("");
  }

  function openChannelConfiguration(channel: AdsChannelId) {
    if (!pilotChannelsEnabled && !isAdsPublicChannel(channel)) return;
    const nextIndex = CHANNEL_CATALOG.findIndex((candidate) => candidate.id === channel);
    if (nextIndex >= 0 && channel !== channelId) selectChannel(nextIndex);

    if (isAdsProvider(channel)) {
      setOpenaiConfiguring(false);
      setExternalConfiguring(false);
      setConfiguring(true);
      return;
    }

    if (channel === "openai") {
      setConfiguring(false);
      setExternalConfiguring(false);
      setOpenaiConfiguring(true);
      return;
    }

    setOpenaiConfiguring(false);
    setConfiguring(false);
    setExternalError("");
    const cached = externalAccountsCache.current[channel];
    setExternalAccounts(cached.accounts);
    setExternalAccountsLoadFailed(cached.failed);
    setExternalAccountChoice(cached.choice || externalStatuses[channel].selectedAccountId);
    setExternalAccountsLoading(externalStatuses[channel].connected && !cached.loaded);
    setExternalConfiguring(true);
  }

  useEffect(() => {
    let active = true;
    if (!isAdsProvider(channelId)) {
      setLoadingAccounts(false);
      setConnected(false);
      setConnectionStatus("disconnected");
      setConnectionAccount(undefined);
      setConfiguredAccountId("");
      setConfiguredAccountLabel("");
      setConfiguredPageId("");
      setAccounts([]);
      setPages([]);
      return () => { active = false; };
    }

    const activeProvider = channelId;
    const refreshRevision = accountsRefreshRevisions[activeProvider];
    const cached = providerAccountsCache.current[activeProvider];
    if (cached && providerAccountsFetchedRevision.current[activeProvider] === refreshRevision) {
      applyProviderAccountsResult(activeProvider, cached, false);
      setLoadingAccounts(false);
      return () => { active = false; };
    }

    setLoadingAccounts(true);
    void fetch(`/api/ads/accounts?provider=${activeProvider}`, { cache: "no-store" })
      .then(readJson)
      .then((data) => {
        if (!active) return;
        const result = data as AccountResponse;
        if (!result.connected || !result.error) {
          providerAccountsCache.current[activeProvider] = result;
          providerAccountsFetchedRevision.current[activeProvider] = refreshRevision;
        }
        applyProviderAccountsResult(activeProvider, result, true);
      })
      .catch((error) => { if (active) setNotice(error instanceof Error ? error.message : "Connexion publicitaire indisponible."); })
      .finally(() => { if (active) setLoadingAccounts(false); });
    return () => { active = false; };
  }, [accountsRefreshRevisions, applyProviderAccountsResult, channelId]);

  function changeProvider(next: AdsProvider) {
    setChannelIndex(CHANNEL_CATALOG.findIndex((channel) => channel.provider === next));
    const channelChanged = channelId !== next;
    setChannelId(next);
    if (next === provider && !channelChanged) return;
    if (next !== provider) setProvider(next);
    const cached = providerAccountsCache.current[next];
    const savedConnection = connectionSnapshots[next];
    const nextDraft = newDraft(next);
    nextDraft.adAccountId = String(cached?.selectedAccountId || savedConnection.accountId || "");
    if (next === "meta") nextDraft.pageId = String(cached?.selectedPageId || savedConnection.pageId || "");
    setDraft(nextDraft);
    setConnected(cached?.connected ?? savedConnection.status === "connected");
    setConnectionStatus(cached?.connectionStatus || (savedConnection.status === "unknown" ? "disconnected" : savedConnection.status));
    setConnectionAccount(cached?.connectionAccount);
    setConfiguredAccountId(String(cached?.selectedAccountId || savedConnection.accountId || ""));
    setConfiguredAccountLabel(String(cached?.selectedAccountLabel || savedConnection.accountLabel || ""));
    setConfiguredPageId(String(cached?.selectedPageId || savedConnection.pageId || ""));
    setConfigAction(null);
    setAccounts(cached?.accounts || []);
    setPages(cached?.pages || []);
    setLoadingAccounts(!cached);
    setSavedId(null);
    setDirty(true);
    setMetaMediaFormatStatus({ feed: "empty", story_reel: "empty" });
    setConfirmedSpend(false);
    setConfirmedDestinationUrl("");
    setNotice("");
  }

  function openConfiguration(channel: AdsProvider) {
    openChannelConfiguration(channel);
  }

  function updateDraft(next: Partial<AdsCampaignInput>) {
    if (Object.prototype.hasOwnProperty.call(next, "destinationUrl")) setConfirmedDestinationUrl("");
    if (channelId === "openai" && next.primaryText !== undefined) next = { ...next, descriptions: next.primaryText ? [next.primaryText] : [] };
    setDraft((current) => applyDraftEdit(current, next));
    setDirty(true);
    setConfirmedSpend(false);
  }

  async function fetchLinkedInPreflight(
    geoQueryOverride?: string,
    force = false,
    accountIdOverride?: string,
  ): Promise<LinkedInAdsPreflightResponse> {
    const selectedAccountId = accountIdOverride || externalStatuses.linkedin.selectedAccountId || draft.adAccountId;
    if (!selectedAccountId) {
      throw new Error("Associez d’abord un compte LinkedIn Ads dans la configuration du canal.");
    }
    const settings = draft.channelSettings?.channel === "linkedin" ? draft.channelSettings : null;
    const geoQuery = (geoQueryOverride || linkedInGeoQuery || draft.targetLocations[0] || "").trim();
    const params = new URLSearchParams({
      language: settings?.locale.language || "fr",
      country: settings?.locale.country || "FR",
      dailyBudget: Number(draft.dailyBudgetEuros || 0).toFixed(2),
      politicalIntentConfirmed: String(draft.linkedinPoliticalIntentConfirmed === true),
      targetingNoticeAcknowledged: String(draft.linkedinTargetingNoticeAcknowledged === true),
    });
    if (geoQuery.length >= 2) params.set("geo", geoQuery);
    if (draft.linkedinCampaignGroupId) params.set("campaignGroupId", draft.linkedinCampaignGroupId);
    if (draft.linkedinOrganizationUrn) params.set("organizationUrn", draft.linkedinOrganizationUrn);
    if (draft.linkedinBidEuros && draft.linkedinBidEuros > 0) params.set("bidAmount", draft.linkedinBidEuros.toFixed(2));
    for (const target of draft.linkedinGeoTargets || []) params.append("geoUrn", target.urn);

    const cacheKey = `${selectedAccountId}:${params.toString()}`;
    const cached = force ? null : linkedInPreflightCache.current.get(cacheKey);
    if (cached) {
      setLinkedInPreflight(cached);
      if (geoQuery) setLinkedInGeoQuery(geoQuery);
      return cached;
    }
    const data = await readJson(await fetch(`/api/ads/linkedin/preflight?${params.toString()}`, { cache: "no-store" })) as LinkedInAdsPreflightResponse;
    linkedInPreflightCache.current.set(cacheKey, data);
    setLinkedInPreflight(data);
    if (geoQuery) setLinkedInGeoQuery(geoQuery);
    return data;
  }

  async function loadLinkedInResources(force = false) {
    if (linkedInPreflightLoad === "loading") return;
    setLinkedInPreflightLoad("loading");
    setLinkedInPreflightError("");
    try {
      await fetchLinkedInPreflight(undefined, force);
      setLinkedInPreflightLoad("ready");
    } catch (error) {
      setLinkedInPreflightLoad("error");
      setLinkedInPreflightError(error instanceof Error ? error.message : "Ressources LinkedIn Ads indisponibles.");
    }
  }

  function updateNativeSettings(next: AdsChannelWizardSettings) {
    if (next.channel !== channelId) return;
    const previous = draft.channelSettings;
    const objectiveChanged = !previous || nativeWizardObjective(previous) !== nativeWizardObjective(next);
    const formatChanged = !previous || nativeWizardMediaStrategy(previous) !== nativeWizardMediaStrategy(next);
    const patch: Partial<AdsCampaignInput> = { channelSettings: next };
    if (objectiveChanged) {
      patch.objective = nativeWizardGenericObjective(next);
      patch.conversionGoal = patch.objective === "leads" ? "lead_form"
        : patch.objective === "sales" ? "purchase" : "website_visit";
    }
    if (formatChanged) {
      patch.mediaStrategy = nativeWizardMediaStrategy(next);
      patch.creativeType = patch.mediaStrategy === "video" ? "video" : "image";
      // A previously attached image/video must not silently survive a format
      // switch to a different native creative requirement.
      patch.creativeUrl = "";
      patch.imageUrl = "";
    }
    if (next.channel === "tiktok" && previous?.channel === "tiktok" &&
        next.destinationKind !== previous.destinationKind) {
      patch.conversionLocation = next.destinationKind === "instant_form" ? "instant_form" : "website";
    }
    if (next.channel === "linkedin" && objectiveChanged) {
      patch.conversionLocation = next.objectiveType === "LEAD_GENERATION" ? "instant_form" : "website";
    }
    updateDraft(patch);
  }

  function updatePinterestTargetingMode(targetingMode: PinterestWizardSettings["targetingMode"]) {
    if (nativeSettings?.channel !== "pinterest" || nativeSettings.targetingMode === targetingMode) return;
    const transition = preparePinterestTargetingTransition(
      nativeSettings.targetingMode,
      targetingMode,
      draft.keywords,
    );
    if (transition.requiresConfirmation && !window.confirm(
      `Passer au ciblage automatique retirera ${transition.removedSignalCount} ${transition.removedSignalCount > 1 ? "signaux manuels" : "signal manuel"} de cette campagne. Continuer ?`,
    )) return;
    updateNativeSettings({ ...nativeSettings, targetingMode });
    if (targetingMode === "automatic") updateDraft({ keywords: transition.keywords });
  }

  function clearPinterestManualSignals() {
    if (nativeSettings?.channel !== "pinterest" || nativeSettings.targetingMode !== "automatic" || draft.keywords.length === 0) return;
    if (!window.confirm("Retirer les signaux manuels restants pour rendre le ciblage automatique publiable ?")) return;
    updateDraft({ keywords: [] });
  }

  function applyCampaignMedia(
    item: Pick<MediaLibraryPickerItem, "media_type" | "signed_url" | "title" | "original_file_name">
      & Partial<Pick<MediaLibraryPickerItem, "mime_type" | "size_bytes" | "width" | "height">>,
    requestedMetaSlot: MetaAdsMediaSlot | null = metaMediaSlot,
  ) {
    const url = String(item.signed_url || "").trim();
    if (!url) {
      setCampaignMediaUploadError("Ce média ne peut pas encore être utilisé : son lien sécurisé est indisponible.");
      return;
    }
    const mediaType = item.media_type === "video" ? "video" : "image";
    if (channelId === "openai") {
      if (mediaType !== "image" || !isMediaLibraryContentReference(url)) {
        setCampaignMediaUploadError("Choisissez une image enregistrée dans votre médiathèque iNrCy pour ChatGPT Ads.");
        return;
      }
      if (item.mime_type && item.mime_type !== "image/jpeg" && item.mime_type !== "image/png") {
        setCampaignMediaUploadError("ChatGPT Ads accepte ici uniquement une image JPG ou PNG.");
        return;
      }
      if (item.size_bytes && item.size_bytes > OPENAI_ADS_MAX_IMAGE_BYTES) {
        setCampaignMediaUploadError("L’image ChatGPT Ads ne doit pas dépasser 20 Mo.");
        return;
      }
      if (item.width && item.height && (item.width !== item.height || item.width < 256)) {
        setCampaignMediaUploadError("Choisissez une image carrée d’au moins 256 × 256 pixels pour ChatGPT Ads.");
        return;
      }
    }
    if (channelId === "meta") {
      if (mediaType !== "image") {
        setCampaignMediaUploadError("Le pack Meta Ads utilise ici des images publicitaires. Choisissez une image pour ce format.");
        return;
      }
      if (!requestedMetaSlot) {
        setCampaignMediaUploadError("Choisissez d’abord le format Meta Feed ou Story/Reel à compléter.");
        return;
      }
      setMetaMediaFormatStatus((current) => ({ ...current, [requestedMetaSlot]: "checking" }));
      setDraft((current) => {
        const metaCreativeAssets = {
          ...current.metaCreativeAssets,
          [requestedMetaSlot === "feed" ? "feedImageUrl" : "storyReelImageUrl"]: url,
        };
        return applyDraftEdit(current, {
          metaCreativeAssets,
          imageUrl: metaCreativeAssets.feedImageUrl,
          creativeUrl: metaCreativeAssets.feedImageUrl,
          creativeType: "image",
          mediaStrategy: "image",
        });
      });
      setDirty(true);
      setConfirmedSpend(false);
      setCampaignMediaUploadError("");
      return;
    }
    if (channelId === "google" && draft.campaignType === "search" && mediaType !== "image") {
      setCampaignMediaUploadError("Google Search accepte ici une image en complément de l’annonce texte, pas une vidéo. Choisissez une image.");
      return;
    }
    setDraft((current) => {
      const mediaStrategy = adsMediaStrategyAfterAttachment(current, mediaType);
      return applyDraftEdit(current, {
        creativeUrl: url,
        imageUrl: mediaType === "image" ? url : current.imageUrl,
        creativeType: mediaType,
        mediaStrategy,
      });
    });
    setDirty(true);
    setConfirmedSpend(false);
    setCampaignMediaUploadError("");
  }

  async function handleCampaignMediaUpload(
    event: ChangeEvent<HTMLInputElement>,
    expectedType: CampaignMediaUploadKind,
  ) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file || campaignMediaUploadBusy) return;

    setCampaignMediaUploadBusy(true);
    setCampaignMediaUploadError("");
    try {
      let openaiDimensions: { width: number; height: number } | null = null;
      if (channelId === "openai") {
        if (expectedType !== "image" || !["image/jpeg", "image/png"].includes(file.type) || file.size > OPENAI_ADS_MAX_IMAGE_BYTES) {
          throw new Error("ChatGPT Ads demande un JPG ou PNG carré de 20 Mo maximum.");
        }
        openaiDimensions = await uploadedImageDimensions(file);
        if (openaiDimensions.width !== openaiDimensions.height || openaiDimensions.width < 256) {
          throw new Error("Choisissez une image carrée d’au moins 256 × 256 pixels pour ChatGPT Ads.");
        }
      }
      const uploaded = await uploadFileToMediaLibrary(file, {
        source: "ads_campaign",
        title: file.name.replace(/\.[^.]+$/, ""),
        tags: ["inrads", "campagne", channelId, expectedType],
        metadata: {
          campaign_provider: channelId,
          campaign_media_source: "manual_upload",
        },
        ...(openaiDimensions || {}),
      });
      applyCampaignMedia({
        media_type: uploaded.media_type === "video" ? "video" : "image",
        signed_url: typeof uploaded.signed_url === "string" ? uploaded.signed_url : null,
        mime_type: typeof uploaded.mime_type === "string" ? uploaded.mime_type : null,
        size_bytes: typeof uploaded.size_bytes === "number" ? uploaded.size_bytes : null,
        width: typeof uploaded.width === "number" ? uploaded.width : null,
        height: typeof uploaded.height === "number" ? uploaded.height : null,
        title: typeof uploaded.title === "string" ? uploaded.title : null,
        original_file_name: typeof uploaded.original_name === "string" ? uploaded.original_name : null,
      });
    } catch (error) {
      setCampaignMediaUploadError(
        error instanceof Error
          ? error.message
          : `Impossible d’ajouter cette ${expectedType === "video" ? "vidéo" : "image"} à la campagne.`,
      );
    } finally {
      setCampaignMediaUploadBusy(false);
    }
  }

  function handleGeneratedCampaignMedia(result: MediaGenerationResult) {
    applyCampaignMedia(result.item, metaMediaSlot);
    setCampaignMediaStudioOpen(false);
  }

  async function saveAccountSelection() {
    if (!draft.adAccountId) {
      setNotice("Choisissez d’abord un compte annonceur en euros.");
      return;
    }
    setConfigAction("save-account");
    setNotice("");
    try {
      const result = await readJson(await fetch("/api/ads/accounts/selection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, accountId: draft.adAccountId }),
      }));
      const selectedAccountId = String(result.selectedAccountId || draft.adAccountId);
      const selectedAccountLabel = String(result.selectedAccountLabel || selectedAccount?.name || "");
      setConfiguredAccountId(selectedAccountId);
      setConfiguredAccountLabel(selectedAccountLabel);
      const cached = providerAccountsCache.current[provider];
      if (cached) providerAccountsCache.current[provider] = {
        ...cached,
        selectedAccountId,
        selectedAccountLabel,
        selectedAccountAvailable: true,
      };
      setConnectionSnapshots((current) => ({ ...current, [provider]: {
        ...current[provider], status: "connected",
        accountId: selectedAccountId,
        accountLabel: selectedAccountLabel,
        accountAvailable: true,
      } }));
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Impossible de sélectionner ce compte annonceur.");
    } finally {
      setConfigAction(null);
    }
  }

  async function savePageSelection() {
    if (!draft.pageId) {
      setNotice("Choisissez d’abord une identité Facebook ou Instagram.");
      return;
    }
    setConfigAction("save-page");
    setNotice("");
    try {
      const result = await readJson(await fetch("/api/ads/accounts/selection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "meta", pageId: draft.pageId }),
      }));
      const selectedPageId = String(result.selectedPageId || draft.pageId);
      setConfiguredPageId(selectedPageId);
      const cached = providerAccountsCache.current.meta;
      if (cached) providerAccountsCache.current.meta = { ...cached, selectedPageId, selectedPageAvailable: true };
      setConnectionSnapshots((current) => ({ ...current, meta: { ...current.meta, pageId: selectedPageId, pageAvailable: true } }));
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Impossible de sélectionner cette identité publicitaire.");
    } finally {
      setConfigAction(null);
    }
  }

  async function clearSavedSelection(target: "account" | "identity") {
    setConfigAction(target === "account" ? "clear-account" : "clear-page");
    setNotice("");
    try {
      await readJson(await fetch("/api/ads/accounts/selection", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, target }),
      }));
      if (target === "account") {
        const cached = providerAccountsCache.current[provider];
        if (cached) providerAccountsCache.current[provider] = {
          ...cached,
          selectedAccountId: "",
          selectedAccountLabel: "",
          selectedAccountAvailable: false,
          selectedPageId: provider === "meta" ? "" : cached.selectedPageId,
          selectedPageAvailable: provider === "meta" ? false : cached.selectedPageAvailable,
        };
        setConnectionSnapshots((current) => ({ ...current, [provider]: { ...current[provider], accountId: "", accountLabel: "", pageId: "" } }));
        setConfiguredAccountId("");
        setConfiguredAccountLabel("");
        setConfiguredPageId("");
        updateDraft({ adAccountId: "", pageId: provider === "meta" ? "" : draft.pageId });
        setNotice("");
      } else {
        const cached = providerAccountsCache.current[provider];
        if (cached) providerAccountsCache.current[provider] = { ...cached, selectedPageId: "", selectedPageAvailable: false };
        setConnectionSnapshots((current) => ({ ...current, [provider]: { ...current[provider], pageId: "" } }));
        setConfiguredPageId("");
        updateDraft({ pageId: "" });
        setNotice("");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Impossible de dissocier cette sélection.");
    } finally {
      setConfigAction(null);
    }
  }

  async function disconnectAdsConnection() {
    setConfigAction("disconnect");
    setNotice("");
    try {
      await readJson(await fetch(`/api/ads/oauth/${provider}/disconnect`, { method: "POST" }));
      providerAccountsCache.current[provider] = {
        connected: false,
        connectionStatus: "disconnected",
        accounts: [],
        pages: [],
        selectedAccountId: "",
        selectedAccountLabel: "",
        selectedPageId: "",
      };
      setConnected(false);
      setConnectionStatus("disconnected");
      setConnectionSnapshots((current) => ({ ...current, [provider]: { status: "disconnected", accountId: "", accountLabel: "", pageId: "" } }));
      setConnectionAccount(undefined);
      setConfiguredAccountId("");
      setConfiguredAccountLabel("");
      setConfiguredPageId("");
      setAccounts([]);
      setPages([]);
      updateDraft({ adAccountId: "", pageId: provider === "meta" ? "" : draft.pageId });
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Impossible de déconnecter ce canal publicitaire.");
    } finally {
      setConfigAction(null);
    }
  }

  function chooseManualCreation() {
    stopPlanProgress();
    setPlanProgress(0);
    setPlanError("");
    setPlanRequestId("");
    setPlanRationale("");
    setPlanSources([]);
    setAutoMediaPlan(null);
    setAutoMediaState("idle");
    setAutoMediaMessage("");
    setAnalysisSetupOpen(false);
    setConfirmedDestinationUrl("");
    setCreationPath("manual");
    updateDraft({ creationMode: "manual" });
    setStep(1);
  }

  function applyCampaignPlan(plan: AdsCampaignPlan) {
    setConfirmedDestinationUrl("");
    setMetaMediaFormatStatus({ feed: "empty", story_reel: "empty" });
    setDraft((current) => {
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
      metaAudienceExpansion: plan.metaAudienceExpansion,
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
      keywords: channelDraft?.channel === "pinterest" && channelDraft.targetingMode === "automatic"
        ? []
        : plan.keywords.length ? plan.keywords : current.keywords,
      negativeKeywords: plan.negativeKeywords,
      channelDraft,
      channelSettings,
      ...(channelDraft?.channel === "linkedin" ? { linkedinGeoTargets: [] } : {}),
      };
      if (!channelDraft || !nativeCopy) return proposal;
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
        dailyBudgetEuros: channelDraft.budget.amount,
        targetLocations: channelDraft.audience.locationBriefs,
        destinationUrl: nativeCopy.destination,
        primaryText: nativeCopy.message,
        mediaBrief: nativeCopy.media,
        headlines: nativeCopy.headline
          ? [nativeCopy.headline, ...plan.headlines.filter((headline) => headline !== nativeCopy.headline)].slice(0, 15)
          : proposal.headlines,
        descriptions: channelDraft.channel === "linkedin"
          ? proposal.descriptions
          : [nativeCopy.message, ...plan.descriptions.filter((description) => description !== nativeCopy.message)].slice(0, 4),
      };
    });
    if (channelId === "linkedin") {
      setLinkedInGeoQuery(plan.targetLocations[0] || "");
      setLinkedInPreflight((current) => current ? { ...current, geoSuggestions: [] } : current);
    }
    setDirty(true);
    setConfirmedSpend(false);
  }

  async function generateCampaignPlan() {
    const generationRevision = ++planGenerationRevision.current;
    startPlanProgress();
    setConfirmedDestinationUrl("");
    setBusy("plan");
    setPlanError("");
    setPlanRequestId("");
    setPlanRationale("");
    setPlanSources([]);
    setAutoMediaPlan(null);
    setAutoMediaState("idle");
    setAutoMediaMessage("");
    let mediaGenerationQueued = false;
    try {
      const result = await readJson(await fetch("/api/ads/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: channelId,
          destinationUrl: draft.destinationUrl,
          analysisMode: analysisMode === "guided" ? "goal" : "open",
          analysisObjective: analysisMode === "guided" ? guidedAnalysisObjective.trim() : "",
        }),
      }));
      if (generationRevision !== planGenerationRevision.current) return;
      const plan = result.plan as AdsCampaignPlan;
      applyCampaignPlan(plan);
      setPlanRequestId(typeof result.requestId === "string" ? result.requestId : "");
      setPlanRationale(plan.rationale || "iNrCy a préparé une base cohérente à partir de vos informations. Vous gardez la main sur chaque choix.");
      setPlanSources(
        Array.isArray(result.sources)
          ? result.sources.map((source) => String(source || "").trim()).filter(Boolean).slice(0, 4)
          : ["iNrADN"],
      );
      // The assisted path includes the real iNr'Studio generation when a
      // visual is useful for the selected campaign format. Search and product
      // feed plans intentionally skip it instead of consuming a media credit.
      planResponseReceived.current = true;
      planProgressTarget.current = 90;
      setAutoMediaState(channelId === "google" && plan.campaignType === "search" ? "skipped" : "generating");
      setAutoMediaPlan(plan);
      mediaGenerationQueued = true;
    } catch (error) {
      if (generationRevision !== planGenerationRevision.current) return;
      const requestError = error as AdsApiRequestError;
      setPlanRequestId(typeof requestError?.requestId === "string" ? requestError.requestId : "");
      setPlanError(error instanceof Error ? error.message : "La génération iNrCy a échoué.");
      stopPlanProgress();
      planProgressTarget.current = 0;
      planProgressValue.current = 0;
      completedAnalysisStagesValue.current = 0;
      setCompletedAnalysisStages(0);
      setPlanProgress(0);
    } finally {
      if (generationRevision === planGenerationRevision.current && !mediaGenerationQueued) {
        stopPlanProgress();
        setBusy(null);
      }
    }
  }

  function openAssistedAnalysisSetup() {
    stopPlanProgress();
    setPlanError("");
    setPlanRequestId("");
    setPlanRationale("");
    setPlanSources([]);
    setAutoMediaPlan(null);
    setAutoMediaState("idle");
    setAutoMediaMessage("");
    setAnalysisMode("free");
    setGuidedAnalysisObjective("");
    setAnalysisSetupOpen(true);
  }

  function beginAssistedAnalysis() {
    if (analysisMode === "guided" && !guidedAnalysisObjective.trim()) return;
    setAnalysisSetupOpen(false);
    setCreationPath("inrcy");
    updateDraft({ creationMode: "inrcy" });
    setStep(1);
    void generateCampaignPlan();
  }

  function startNewCampaign() {
    stopPlanProgress();
    setConfirmedDestinationUrl("");
    setDraft({
      ...newDraft(channelId),
      // The advertiser/identity belongs to the channel, not to an individual
      // campaign. Starting over must not make an associated account disappear.
      adAccountId: isAdsProvider(channelId)
        ? configuredAccountId
        : isExternalChannel(channelId) ? externalStatuses[channelId].selectedAccountId
          : channelId === "openai" ? connectionSnapshots.openai.accountId : "",
      pageId: channelId === "meta" ? configuredPageId : "",
    });
    setSavedId(null);
    setDirty(true);
    setNotice("");
    setPlanProgress(0);
    setPlanError("");
    setPlanRequestId("");
    setPlanRationale("");
    setPlanSources([]);
    setAutoMediaPlan(null);
    setAutoMediaState("idle");
    setAutoMediaMessage("");
    setCampaignMediaUploadError("");
    setLinkedInPreflight(null);
    setLinkedInPreflightLoad("idle");
    setLinkedInPreflightError("");
    setLinkedInGeoQuery("");
    setMetaMediaSlot(null);
    setMetaMediaFormatStatus({ feed: "empty", story_reel: "empty" });
    setConfirmedSpend(false);
    setCreationPath("choice");
    setAnalysisSetupOpen(false);
    setAnalysisMode("free");
    setGuidedAnalysisObjective("");
    setStep(0);
    setCreating(true);
  }

  const { confirmExit: confirmCampaignExit } = useUnsavedExitGuard({
    active: creating,
    shouldBlock: (dirty && creationPath !== "choice") || busy === "plan" || busy === "demo" || busy === "save",
    onConfirmExit: () => closeCampaignCreation(),
    ...(busy === "demo" || busy === "save" ? { onBlockedExit: async () => false } : {}),
    eyebrow: "CAMPAGNE EN COURS",
    title: "Quitter cette campagne ?",
    message: "Votre campagne contient des informations non enregistrées. En quittant maintenant, votre proposition et vos modifications seront perdues.",
    confirmLabel: "Quitter sans enregistrer",
    cancelLabel: "Continuer l’édition",
    variant: "danger",
  });

  function closeCampaignCreation() {
    planGenerationRevision.current += 1;
    stopPlanProgress();
    setDemoDialog(null);
    setPlanSources([]);
    setAutoMediaPlan(null);
    setAutoMediaState("idle");
    setAutoMediaMessage("");
    setCampaignMediaStudioOpen(false);
    setCampaignMediaLibraryOpen(false);
    setMetaMediaSlot(null);
    setMetaMediaFormatStatus({ feed: "empty", story_reel: "empty" });
    setBusy(null);
    setAnalysisSetupOpen(false);
    setCreating(false);
  }

  async function saveDraft() {
    setBusy("save"); setNotice("");
    try {
      const campaignDraft: AdsCampaignInput = {
        ...draft,
        provider: channelId,
        adAccountId: channelId === "pinterest" || channelId === "linkedin"
          ? externalStatuses[channelId].selectedAccountId || draft.adAccountId
          : channelId === "openai" ? connectionSnapshots.openai.accountId || draft.adAccountId
          : draft.adAccountId,
      };
      const result = await readJson(await fetch("/api/ads/campaigns", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...campaignDraft, ...(savedId ? { id: savedId } : {}) }),
      }));
      const campaign = result.campaign as { id: string };
      setDraft(campaignDraft);
      setSavedId(campaign.id);
      setDirty(false);
      setConfirmedSpend(false);
      setDraftsRevision((revision) => revision + 1);
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Enregistrement impossible.");
    } finally { setBusy(null); }
  }

  async function openLaunchDialog() {
    if (!isAdsDraftAccountChannel(channelId)) {
      setNotice(`La publication ${channelMeta.label} n’est pas encore disponible. Vous pouvez conserver cette campagne en brouillon.`);
      return;
    }
    if (busy !== null || demoSubmissionRef.current || demoDialog) return;
    if (channelId === "linkedin" && (!linkedInSelectionsReady || !linkedInComplianceReady)) {
      setNotice(!linkedInSelectionsReady
        ? "Sélectionnez explicitement le groupe, la Page, une zone LinkedIn vérifiée et l’enchère CPC avant la validation finale."
        : "Confirmez la déclaration NOT_POLITICAL et l’avis de ciblage non discriminatoire avant la validation finale.");
      return;
    }
    if (!channelPublishingEnabled) {
      setNotice(`Le lancement ${channelMeta.label} est momentanément verrouillé dans cet environnement.`);
      return;
    }
    const connectorIssue = unsupportedAdsConnectorReason(draft);
    if (connectorIssue) {
      setNotice(connectorIssue);
      return;
    }
    if (!liveFormatAvailable) {
      setNotice(channelId === "google"
        ? "Le lancement est actuellement disponible pour les campagnes Réseau de recherche Google."
        : channelId === "meta"
          ? "Le lancement est actuellement disponible pour les campagnes Trafic Meta."
          : channelId === "linkedin"
            ? "Le lancement LinkedIn est actuellement disponible pour l’objectif Visites du site avec une publication sponsorisée image."
          : "Le lancement Pinterest est actuellement disponible pour une épingle sponsorisée image, avec un objectif Notoriété ou Considération.");
      return;
    }
    if (!livePublisherConversionReady) {
      setNotice("Le connecteur de lancement actuellement branché nécessite une destination vers votre site web.");
      return;
    }
    if (!metaLivePlacementsSupported) {
      setNotice("La démo Meta accepte les fils Facebook/Instagram, les Stories et les Reels. Messenger sera ajouté ultérieurement.");
      return;
    }
    if (!livePublisherMediaReady) {
      setNotice(knownMetaMediaInvalid
        ? "Un visuel Meta ne respecte pas les dimensions ou le ratio de son emplacement. Remplacez-le par une image conforme avant le lancement."
        : "Le média choisi doit être disponible dans la médiathèque iNrCy avant le lancement.");
      return;
    }
    demoSubmissionRef.current = true;
    setBusy("demo"); setNotice("");
    try {
      let accountId = "";
      let accountName = "";
      let pageId = "";
      let launchStatus: AdsCampaignLaunchStatus = "active";
      if (channelId === "openai") {
        const connection = await readJson(await fetch("/api/ads/openai/status", { cache: "no-store" })) as {
          connected?: boolean; accountId?: string; accountName?: string;
          pausedCreationEnabled?: boolean; readinessMessage?: string;
        };
        accountId = String(connection.accountId || "");
        if (!connection.connected || !accountId || connection.pausedCreationEnabled !== true) {
          throw new Error(connection.readinessMessage || "ChatGPT Ads attend une clé API valide et un compte approuvé avant la création en pause.");
        }
        accountName = String(connection.accountName || accountId);
        launchStatus = "paused";
        setOpenaiAccountReady(true);
        setConnectionSnapshots((current) => ({ ...current, openai: {
          ...current.openai, status: "connected", accountId, accountLabel: accountName,
        } }));
      } else if (channelId === "pinterest") {
        const connection = await readJson(await fetch("/api/ads/pinterest/accounts", { cache: "no-store" })) as {
          accounts?: ExternalAdsAccount[];
          selectedAccountId?: string | null;
          selectedAccountName?: string | null;
        };
        accountId = String(connection.selectedAccountId || "");
        const account = (connection.accounts || []).find((candidate) => candidate.id === accountId && candidate.currency === "EUR" && candidate.eligibleToAssociate !== false);
        if (!accountId || !account) {
          throw new Error(accountId
            ? "Le compte Pinterest Ads associé est momentanément inaccessible. Actualisez la connexion, puis réessayez."
            : "Associez un compte Pinterest Ads avant de lancer la campagne.");
        }
        accountName = String(connection.selectedAccountName || account.name || account.id);
        setExternalStatuses((current) => ({ ...current, pinterest: {
          ...current.pinterest,
          load: "ready",
          connected: true,
          status: "connected",
          selectedAccountId: accountId,
          selectedAccountName: accountName,
          error: "",
        } }));
      } else if (channelId === "linkedin") {
        const connection = await readJson(await fetch("/api/ads/linkedin/accounts", { cache: "no-store" })) as {
          accounts?: ExternalAdsAccount[];
          selectedAccountId?: string | null;
          selectedAccountName?: string | null;
          selectedAccountCanManage?: boolean;
          selectedAccountCanServe?: boolean;
        };
        accountId = String(connection.selectedAccountId || "");
        const account = (connection.accounts || []).find((candidate) => candidate.id === accountId
          && candidate.currency === "EUR" && candidate.canManageCampaigns === true);
        if (!accountId || !account || connection.selectedAccountCanManage !== true) {
          throw new Error(accountId
            ? "Le compte LinkedIn Ads associé n’a plus un rôle de gestion de campagnes en euros. Actualisez la connexion, puis réessayez."
            : "Associez un compte LinkedIn Ads avant de lancer la campagne.");
        }
        accountName = String(connection.selectedAccountName || account.name || account.id);
        setExternalStatuses((current) => ({ ...current, linkedin: {
          ...current.linkedin,
          load: "ready",
          connected: true,
          status: "connected",
          selectedAccountId: accountId,
          selectedAccountName: accountName,
          selectedAccountCanManage: true,
          selectedAccountCanServe: connection.selectedAccountCanServe === true,
          error: "",
        } }));
        setLinkedInPreflightLoad("loading");
        setLinkedInPreflightError("");
        const preflight = await fetchLinkedInPreflight(undefined, true, accountId);
        setLinkedInPreflightLoad("ready");
        const group = (preflight.campaignGroups || []).find((candidate) => candidate.id === draft.linkedinCampaignGroupId);
        const organization = (preflight.organizations || []).find((candidate) => candidate.urn === draft.linkedinOrganizationUrn);
        if (!group || !linkedInCampaignGroupIsCompatible(group)) {
          throw new Error("Le groupe de campagnes LinkedIn choisi n’est plus accessible ou compatible. Rechargez les ressources et choisissez-le de nouveau.");
        }
        if (!organization) {
          throw new Error("La Page LinkedIn choisie n’est plus accessible avec un rôle autorisé. Rechargez les ressources et choisissez-la de nouveau.");
        }
        // Active remains the default only when LinkedIn can actually serve and
        // the selected parent group is ACTIVE. A safe PAUSED creation remains
        // selectable for manageable On hold/DRAFT/PAUSED resources.
        if (connection.selectedAccountCanServe !== true || group.status !== "ACTIVE") launchStatus = "paused";
      } else {
        if (channelId !== provider) {
          throw new Error("Le canal de cette campagne a changé. Revenez sur son canal avant de la lancer.");
        }
        const connection = await readJson(await fetch(`/api/ads/accounts?provider=${channelId}`, { cache: "no-store" })) as AccountResponse;
        accountId = String(connection.selectedAccountId || "");
        setConnected(connection.connected);
        setConnectionStatus(connection.connectionStatus || (connection.connected ? "connected" : "disconnected"));
        setConnectionSnapshots((current) => ({ ...current, [channelId]: {
          status: connection.connectionStatus || (connection.connected ? "connected" : "disconnected"),
          accountId,
          accountLabel: String(connection.selectedAccountLabel || ""),
          pageId: String(connection.selectedPageId || ""),
        } }));
        setAccounts(connection.accounts || []);
        setPages(connection.pages || []);
        setConfiguredAccountId(accountId);
        setConfiguredAccountLabel(String(connection.selectedAccountLabel || ""));
        if (channelId === "meta") setConfiguredPageId(String(connection.selectedPageId || ""));
        const account = (connection.accounts || []).find((candidate) => candidate.id === accountId && candidate.currency === "EUR");
        if (!connection.connected || !accountId || !account) {
          throw new Error(accountId
            ? "Le compte annonceur associé est momentanément inaccessible. Actualisez la connexion sans dissocier ce compte, puis réessayez."
            : "Aucun compte annonceur n’est associé à ce canal. Associez-en un une seule fois dans la configuration.");
        }
        pageId = channelId === "meta" ? String(connection.selectedPageId || "") : "";
        const connectionNeedsInstagramIdentity = channelId === "meta"
          && metaPlacementsNeedInstagramIdentity(draft.metaPlacements);
        if (channelId === "meta" && !(connection.pages || []).some((page) => page.id === pageId
          && (!connectionNeedsInstagramIdentity || page.instagramUserId))) {
          throw new Error(connectionNeedsInstagramIdentity
            ? "Pour le lancement Meta sur Instagram, Stories ou Reels, associez d’abord un compte Instagram professionnel à la Page sélectionnée."
            : "Pour le lancement Meta, associez d’abord une Page Facebook autorisée.");
        }
        accountName = String(connection.selectedAccountLabel || account.name);
        setConfiguredAccountLabel(accountName);
      }
      setConfirmedSpend(false);
      setPublicationPhase("idle");
      setDemoDialog({
        mode: "confirm",
        channelId,
        pageId,
        launchStatus,
        details: { campaignName: draft.name, channelLabel: channelMeta.label, accountName, accountId },
      });
    } catch (error) {
      if (channelId === "linkedin") {
        setLinkedInPreflightLoad("error");
        setLinkedInPreflightError(error instanceof Error ? error.message : "Contrôle LinkedIn Ads indisponible.");
      }
      setNotice(error instanceof Error ? error.message : "Le compte annonceur n’a pas pu être vérifié. Réessayez avant de lancer la campagne.");
    } finally { demoSubmissionRef.current = false; setBusy(null); }
  }

  async function confirmCampaignLaunch() {
    const confirmation = demoDialog;
    if (!confirmation || confirmation.mode !== "confirm" || busy !== null || demoSubmissionRef.current) return;
    demoSubmissionRef.current = true;
    setPublicationPhase("saving");
    setBusy("demo"); setNotice("");
    try {
      if (confirmation.channelId !== channelId || !creating || step !== validationStep) {
        throw new Error("Le parcours de la campagne a changé. Revenez à la validation et réessayez.");
      }
      if (!channelPublishingEnabled) {
        throw new Error(`Le lancement ${channelMeta.label} est momentanément verrouillé dans cet environnement.`);
      }
      const campaignDraft: AdsCampaignInput = {
        ...draft,
        provider: confirmation.channelId,
        adAccountId: confirmation.details.accountId,
        accountCurrency: "EUR",
        pageId: confirmation.channelId === "meta" ? confirmation.pageId : draft.pageId,
      };
      const validated = parseAdsCampaignInput(campaignDraft, { purpose: "publish" });
      if (!validated.draft) throw new Error(validated.error || "Vérifiez la campagne avant de la lancer.");
      const saved = await readJson(await fetch("/api/ads/campaigns", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...campaignDraft, ...(savedId ? { id: savedId } : {}) }),
      }));
      const campaignId = String((saved.campaign as { id?: string } | undefined)?.id || "");
      if (!campaignId) throw new Error("Le brouillon n’a pas pu être confirmé. Aucune campagne n’a été créée sur la plateforme.");
      setDraft(campaignDraft);
      setSavedId(campaignId);
      setDirty(false);

      const paused = confirmation.launchStatus === "paused";
      setPublicationPhase("sending");
      const published = await readJson(await fetch(`/api/ads/campaigns/${campaignId}/publish`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: paused ? "paused" : "live",
          confirmation: paused ? ADS_PAUSED_PUBLISH_CONFIRMATION : ADS_LIVE_PUBLISH_CONFIRMATION,
        }),
      }));
      const expectedStatus = paused ? "paused" : "active";
      if ((published.campaign as { status?: string } | undefined)?.status !== expectedStatus) {
        throw new Error("La création sur la plateforme n’a pas pu être confirmée. Vérifiez son statut avant toute nouvelle tentative.");
      }
      setDemoDialog({ ...confirmation, mode: "success" });
      setConfirmedSpend(false);
      setPublicationPhase("success");
    } catch (error) {
      setPublicationPhase("idle");
      setDemoDialog(null);
      setNotice(error instanceof Error ? error.message : "Le lancement n’a pas pu être confirmé. Vérifiez son statut sur la plateforme avant de réessayer.");
    } finally { demoSubmissionRef.current = false; setBusy(null); }
  }

  function reopen(campaign: StoredCampaign) {
    if (campaign.status !== "draft") return;
    if (!pilotChannelsEnabled && !isAdsPublicChannel(campaign.provider)) return;
    stopPlanProgress();
    setConfirmedDestinationUrl("");
    setChannelId(campaign.provider);
    setChannelIndex(CHANNEL_CATALOG.findIndex((channel) => channel.id === campaign.provider));
    if (isAdsProvider(campaign.provider)) {
      setProvider(campaign.provider);
    } else {
      setConnected(false);
      setAccounts([]);
      setPages([]);
    }
    setDraft(campaign.draft);
    setMetaMediaFormatStatus({ feed: "empty", story_reel: "empty" });
    setSavedId(campaign.id);
    setDirty(false);
    setConfirmedSpend(false);
    setPlanError("");
    setPlanRequestId("");
    setPlanRationale("");
    setPlanSources([]);
    setAutoMediaPlan(null);
    setAutoMediaState("idle");
    setAutoMediaMessage("");
    setCampaignMediaUploadError("");
    setLinkedInPreflight(null);
    setLinkedInPreflightLoad("idle");
    setLinkedInPreflightError("");
    setLinkedInGeoQuery(campaign.draft.targetLocations[0] || "");
    setCampaignMediaStudioOpen(false);
    setCampaignMediaLibraryOpen(false);
    setBusy(null);
    const nextPath: AdsCreationMode = campaign.draft.creationMode === "inrcy" ? "inrcy" : "manual";
    setAnalysisSetupOpen(false);
    setCreationPath(nextPath);
    setPlanProgress(nextPath === "inrcy" ? 100 : 0);
    setNotice("");
    setStep(adsDraftValidationStep(campaign.draft));
    setCreating(true);
  }

  async function openDraftFromHeader(campaignId: string) {
    const result = await readJson(await fetch(`/api/ads/campaigns/${encodeURIComponent(campaignId)}`, { cache: "no-store" }));
    const campaign = result.campaign as StoredCampaign | undefined;
    if (!campaign || campaign.status !== "draft") {
      throw new Error("Ce brouillon n’est plus disponible. Actualisez la liste.");
    }
    editLoadId.current = campaignId;
    reopen(campaign);
    router.replace(`/dashboard/ads?channel=${encodeURIComponent(campaign.provider)}&editCampaign=${encodeURIComponent(campaign.id)}`, { scroll: false });
  }

  // A draft opened from iNr’Send returns straight to the validation step.
  // This request is scoped again on the server to the active establishment.
  useEffect(() => {
    if (!initialEditCampaignId || editLoadId.current === initialEditCampaignId) return;
    editLoadId.current = initialEditCampaignId;
    void fetch(`/api/ads/campaigns/${encodeURIComponent(initialEditCampaignId)}`, { cache: "no-store" })
      .then(readJson)
      .then((result) => {
        const campaign = result.campaign as StoredCampaign | undefined;
        if (!campaign || campaign.status !== "draft") throw new Error("Seuls les brouillons non publiés peuvent être modifiés dans le studio.");
        reopen(campaign);
      })
      .catch((error) => setNotice(error instanceof Error ? error.message : "Impossible d’ouvrir ce brouillon."));
  }, [initialEditCampaignId]);

  const estimate = useMemo(() => {
    const days = Math.max(0, Math.ceil((Date.parse(`${draft.endDate}T23:59:59Z`) - Date.now()) / 86_400_000));
    return Number.isFinite(days) ? days * Number(draft.dailyBudgetEuros || 0) : 0;
  }, [draft.dailyBudgetEuros, draft.endDate]);
  const estimatedCampaignDays = useMemo(() => {
    const end = Date.parse(`${draft.endDate}T23:59:59Z`);
    if (!Number.isFinite(end)) return null;
    return Math.max(1, Math.ceil((end - Date.now()) / 86_400_000));
  }, [draft.endDate]);
  const campaignTypeOptions = CAMPAIGN_TYPE_OPTIONS[channelId];
  const nativeSettings = isExternalChannel(channelId)
    ? draft.channelSettings?.channel === channelId ? draft.channelSettings : defaultAdsChannelWizardSettings(channelId)
    : null;
  const nativeMediaStrategy = nativeSettings ? nativeWizardMediaStrategy(nativeSettings) : null;
  const googleSearchMedia = channelId === "google" && draft.campaignType === "search";
  const attachedCampaignMediaUrl = googleSearchMedia ? draft.imageUrl : draft.creativeUrl || draft.imageUrl;
  const nativeMediaUpload = nativeMediaStrategy === "image" || nativeMediaStrategy === "video";
  const mediaStrategyOptions = channelId === "meta"
    ? MEDIA_STRATEGY_OPTIONS.filter((option) => option.value === "image" || option.value === "video" || option.value === "mixed")
    : channelId === "openai" ? MEDIA_STRATEGY_OPTIONS.filter((option) => option.value === "image")
    : MEDIA_STRATEGY_OPTIONS;
  const selectedCampaignType = campaignTypeOptions.find((option) => option.value === draft.campaignType) || campaignTypeOptions[0];
  const pinterestLiveFormatSupported = nativeSettings?.channel === "pinterest"
    && nativeSettings.intendedPromotionType === "STANDARD_AD"
    && nativeSettings.creativeType === "REGULAR"
    && nativeSettings.targetingMode === "automatic"
    && (nativeSettings.objectiveType === "AWARENESS" || nativeSettings.objectiveType === "CONSIDERATION");
  const linkedInLiveFormatSupported = nativeSettings?.channel === "linkedin"
    && nativeSettings.objectiveType === "WEBSITE_VISIT"
    && nativeSettings.format === "STANDARD_UPDATE";
  const liveFormatAvailable = channelId === "google"
    ? draft.campaignType === "search"
    : channelId === "meta"
      ? draft.campaignType === "meta_traffic"
      : channelId === "linkedin"
        ? linkedInLiveFormatSupported
      : channelId === "pinterest"
        ? pinterestLiveFormatSupported
      : channelId === "openai"
        ? draft.campaignType === "generic" && draft.objective === "website_traffic"
        : false;
  const livePublisherConversionReady = liveFormatAvailable && draft.conversionLocation === "website";
  const metaLiveObjectiveSupported = channelId !== "meta" || draft.objective === "website_traffic";
  const metaLiveGoalSupported = channelId !== "meta" || draft.conversionGoal === "website_visit";
  const metaMediaReadiness = assessMetaCreativeAssetReadiness({
    metaPlacements: draft.metaPlacements,
    metaCreativeAssets: draft.metaCreativeAssets,
    imageUrl: draft.imageUrl,
  });
  const metaLivePlacementsSupported = channelId !== "meta" || (
    draft.metaPlacements.length > 0 && !draft.metaPlacements.includes("messenger")
  );
  const metaLiveCreativeSupported = channelId !== "meta" || (draft.mediaStrategy === "image" && draft.creativeType === "image");
  const metaLiveCtaSupported = channelId !== "meta" || ["en savoir plus", "decouvrir", "learn more"].includes(
    draft.callToAction.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(),
  );
  const connectorConfigurationIssue = isAdsDraftAccountChannel(channelId) ? unsupportedAdsConnectorReason(draft) : null;
  const openaiHiddenSettingsNeedReset = channelId === "openai" && (draft.conversionGoal !== "website_visit"
    || draft.conversionLocation !== "website" || draft.bidStrategy !== "manual_review"
    || Boolean(draft.trackingParameters.trim() || draft.callToAction.trim()
      || draft.keywords.length || draft.negativeKeywords.length));
  const knownMetaMediaInvalid = channelId === "meta" && (
    (metaMediaReadiness.requiresFeedImage && metaMediaFormatStatus.feed === "invalid")
    || (metaMediaReadiness.requiresStoryReelImage && metaMediaFormatStatus.story_reel === "invalid")
  );
  const livePublisherMediaReady = channelId === "meta"
    ? metaMediaReadiness.ready && !knownMetaMediaInvalid
    : channelId === "linkedin"
      ? Boolean(attachedCampaignMediaUrl && draft.creativeType === "image" && draft.mediaStrategy === "image")
    : channelId === "pinterest"
      ? Boolean(attachedCampaignMediaUrl && draft.creativeType === "image")
    : channelId === "openai"
      ? Boolean(isMediaLibraryContentReference(attachedCampaignMediaUrl)
        && draft.creativeType === "image" && draft.mediaStrategy === "image")
      : true;
  const metaFeedReviewLabel = !metaMediaReadiness.requiresFeedImage
    ? "Feed non sélectionné"
    : !draft.metaCreativeAssets.feedImageUrl
      ? "Feed 4:5 manquant"
      : metaMediaFormatStatus.feed === "valid"
        ? "Feed 4:5 conforme"
        : metaMediaFormatStatus.feed === "invalid"
          ? "Feed 4:5 non conforme"
          : "Feed 4:5 à vérifier";
  const metaStoryReelReviewLabel = !metaMediaReadiness.requiresStoryReelImage
    ? "Story/Reel non sélectionné"
    : !draft.metaCreativeAssets.storyReelImageUrl
      ? "Story/Reel 9:16 manquant"
      : metaMediaFormatStatus.story_reel === "valid"
        ? "Story/Reel 9:16 conforme"
        : metaMediaFormatStatus.story_reel === "invalid"
          ? "Story/Reel 9:16 non conforme"
          : "Story/Reel 9:16 à vérifier";
  const analysisRequestPending = busy === "plan" && autoMediaState !== "generating" && planProgress < 90 && !planError;
  const analysisProposalReady = creationPath === "inrcy" && step === analysisStep && planProgress === 100 && busy !== "plan";
  const destinationFieldVisible = nativeSettings?.channel !== "tiktok" || nativeSettings.destinationKind === "website";
  const destinationReview = adsDestinationReviewState({
    assisted: creationPath === "inrcy",
    fieldVisible: destinationFieldVisible,
    websiteRequired: draft.conversionLocation === "website",
    destinationUrl: draft.destinationUrl,
    confirmedUrl: confirmedDestinationUrl,
  });
  const visiblePlanRationale = presentAdsCampaignRationale(planRationale);
  const pendingAnalysisStage = AI_ANALYSIS_STAGES.findIndex((stage) => planProgress < stage.at);
  const activeAnalysisStage = planError
    ? -1
    : pendingAnalysisStage === -1 ? AI_ANALYSIS_STAGES.length - 1 : pendingAnalysisStage;
  const linkedInCampaignGroups = (linkedInPreflight?.campaignGroups || []).filter(linkedInCampaignGroupIsCompatible);
  const linkedInOrganizations = linkedInPreflight?.organizations || [];
  const preflightSelectedLinkedInCampaignGroup = linkedInPreflight?.selected?.campaignGroup || null;
  const preflightSelectedLinkedInOrganization = linkedInPreflight?.selected?.organization || null;
  const selectedLinkedInCampaignGroup = linkedInCampaignGroups.find((group) => group.id === draft.linkedinCampaignGroupId)
    || (preflightSelectedLinkedInCampaignGroup?.id === draft.linkedinCampaignGroupId
      ? preflightSelectedLinkedInCampaignGroup : null);
  const selectedLinkedInOrganization = linkedInOrganizations.find((organization) => organization.urn === draft.linkedinOrganizationUrn)
    || (preflightSelectedLinkedInOrganization?.urn === draft.linkedinOrganizationUrn
      ? preflightSelectedLinkedInOrganization : null);
  const linkedInGeoTargets = draft.linkedinGeoTargets || [];
  const linkedInSelectionsReady = Boolean(
    draft.linkedinCampaignGroupId
    && draft.linkedinOrganizationUrn
    && linkedInGeoTargets.length
    && draft.linkedinBidEuros
    && draft.linkedinBidEuros > 0,
  );
  const linkedInComplianceReady = draft.linkedinPoliticalIntentConfirmed === true
    && draft.linkedinTargetingNoticeAcknowledged === true;

  return <main className={styles.page}>
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <div className={styles.headerBrand}>
            <span className={styles.brandMark} aria-hidden="true">
              <svg viewBox="0 0 64 64" fill="none" focusable="false">
                <circle cx="32" cy="32" r="20" />
                <circle cx="32" cy="32" r="11" />
                <circle cx="32" cy="32" r="3" className={styles.brandMarkCenter} />
                <path d="m44 20 8-8m-8 0h8v8" />
              </svg>
            </span>
            <div className={styles.headerIdentity}>
              <div className={styles.headerTitleLine}><h1>iNr’<span>ADS</span></h1><span className={styles.premiumBadge}>Premium</span></div>
              <p>Donnez de l’élan à votre visibilité.</p>
            </div>
          </div>
          <nav className={styles.headerActions} aria-label="Actions iNr’ADS">
            <Link href="/dashboard/mails?folder=campagnes-ads" className={styles.trackingButton} aria-label="Voir les campagnes dans iNr’Send" title="Voir les campagnes dans iNr’Send">
              <span className={styles.headerActionIcon} aria-hidden="true"><Image src="/inrsend-logo-seul.png" alt="" width={28} height={28} className={styles.inrsendHeaderLogo} /></span>
              <span className={styles.headerActionText}>iNr’Send</span>
            </Link>
            <AdsDraftsMenu refreshKey={draftsRevision} onOpenDraft={openDraftFromHeader} />
            <Link href="/dashboard" className={`${styles.back} ${styles.headerCloseButton}`} aria-label="Fermer iNr’ADS" title="Fermer iNr’ADS"><span className={styles.headerActionIcon} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" /></svg></span><span className={styles.headerActionText}>Fermer</span></Link>
          </nav>
        </div>
      </header>

      {notice && !creating && !configuring && !externalConfiguring && <p className={`${styles.notice} ${styles.cockpitNotice}`} role="alert">{notice}</p>}
      <section id="ads-channels" className={styles.channelCard} aria-label="Canaux publicitaires">
        <div className={styles.channelAtmosphere} aria-hidden="true">
          <span className={styles.channelCreativeStack}><i /><i /><i /></span>
          <svg className={styles.channelConversionRoutes} viewBox="0 0 1440 560" preserveAspectRatio="xMidYMid slice" focusable="false">
            <path className={`${styles.channelConversionRoute} ${styles.channelConversionRouteOne}`} d="M-70 430 C 210 365, 360 170, 700 278 S 1125 430, 1510 118" />
            <path className={`${styles.channelConversionRoute} ${styles.channelConversionRouteTwo}`} d="M-40 150 C 250 250, 430 418, 735 295 S 1140 135, 1490 300" />
            <path className={`${styles.channelConversionRoute} ${styles.channelConversionRouteThree}`} d="M80 550 C 360 410, 500 510, 770 338 S 1110 212, 1420 425" />
            <circle className={`${styles.channelRoutePacket} ${styles.channelRoutePacketCyan}`} fill="#69e6ff" stroke="#effdff" r="5">
              <animateMotion dur="9s" repeatCount="indefinite" path="M-70 430 C 210 365, 360 170, 700 278 S 1125 430, 1510 118" />
            </circle>
            <circle className={`${styles.channelRoutePacket} ${styles.channelRoutePacketViolet}`} fill="#e29cff" stroke="#fff0fc" r="4.5">
              <animateMotion begin="-3.8s" dur="11s" repeatCount="indefinite" path="M-40 150 C 250 250, 430 418, 735 295 S 1140 135, 1490 300" />
            </circle>
            <circle className={`${styles.channelRoutePacket} ${styles.channelRoutePacketGreen}`} fill="#7aebba" stroke="#effff8" r="5.5">
              <animateMotion begin="-6.1s" dur="13s" repeatCount="indefinite" path="M80 550 C 360 410, 500 510, 770 338 S 1110 212, 1420 425" />
            </circle>
            <circle className={`${styles.channelRouteNode} ${styles.channelRouteNodeAudience}`} cx="270" cy="300" r="7" />
            <circle className={`${styles.channelRouteNode} ${styles.channelRouteNodeCreative}`} cx="730" cy="290" r="9" />
            <circle className={`${styles.channelRouteNode} ${styles.channelRouteNodeConversion}`} cx="1165" cy="225" r="8" />
          </svg>
          <span className={styles.channelCockpitGrid} />
          <span className={styles.channelPerformanceBoard}><i /><i /><i /><b /></span>
        </div>
        <div className={styles.sectionHeading}><div><span>AMPLIFIEZ VOTRE PORTÉE</span><h2>Choisissez votre terrain de jeu.</h2></div><p>Sélectionnez un canal, puis configurez votre compte.</p></div>
        <nav className={styles.channelRail} aria-label="Choisir un canal publicitaire">{CHANNEL_CATALOG.map((channel, index) => <button type="button" key={channel.id} disabled={!pilotChannelsEnabled && !isAdsPublicChannel(channel.id)} aria-label={channel.label} title={!pilotChannelsEnabled && !isAdsPublicChannel(channel.id) ? `${channel.label} · En préparation` : channel.label} data-channel={channel.id} data-near={index === channelIndex || index === (channelIndex + 1) % CHANNEL_CATALOG.length || index === (channelIndex - 1 + CHANNEL_CATALOG.length) % CHANNEL_CATALOG.length || undefined} onClick={() => selectChannel(index)} aria-pressed={index === channelIndex}><span className={styles.channelRailLogo} aria-hidden="true"><Image src={channel.logo} width={40} height={40} alt="" draggable={false} /></span><span className={styles.channelRailLabel}>{channel.label}</span></button>)}</nav>
        <div className={styles.channelCarousel} data-testid="ads-channel-carousel">
          <button type="button" onClick={() => selectChannel(channelIndex - 1)} aria-label="Canal précédent">‹</button>
          <div className={styles.cubeStage} tabIndex={0} role="group" aria-label="Carrousel des canaux : flèches gauche et droite pour naviguer" onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); selectChannel(channelIndex + (event.key === "ArrowRight" ? 1 : -1)); } }} onPointerDown={(event) => { if (!(event.target as HTMLElement).closest("button,a")) channelPointerStart.current = { x: event.clientX, y: event.clientY }; }} onPointerUp={(event) => { const start = channelPointerStart.current; channelPointerStart.current = null; if (!start) return; const dx = event.clientX - start.x; if (Math.abs(dx) >= 58 && Math.abs(dx) > Math.abs(event.clientY - start.y) * 1.5) selectChannel(channelIndex + (dx < 0 ? 1 : -1)); }} onPointerCancel={() => { channelPointerStart.current = null; }}>
          {[-1, 0, 1].map((offset) => {
            const index = (channelIndex + offset + CHANNEL_CATALOG.length) % CHANNEL_CATALOG.length;
            const channel = CHANNEL_CATALOG[index];
            const externalChannel = isExternalChannel(channel.id) ? channel.id : null;
            const externalAdvertiserAccountUrl = externalChannel
              ? getAdsAdvertiserAccountUrl(externalChannel, externalStatuses[externalChannel].selectedAccountId)
              : null;
            return <div key={`${offset}-${channel.id}`} data-provider={channel.id} className={`${styles.channel} ${offset === 0 ? styles.channelActive : styles.channelMini}`}>
              {offset !== 0 && <button className={styles.miniSelect} type="button" disabled={!pilotChannelsEnabled && !isAdsPublicChannel(channel.id)} aria-label={`Afficher ${channel.label}`} onClick={() => selectChannel(index)} />}
              <span className={styles.channelLogo}><Image src={channel.logo} width={56} height={56} alt="" draggable={false} /></span>
              <div className={styles.channelIdentity}><strong>{channel.label}</strong><small>{channel.format}</small>{!pilotChannelsEnabled && !isAdsPublicChannel(channel.id) ? <span className={styles.channelStatus}>En préparation</span> : channel.provider ? <span className={styles.channelStatus} data-status={adsConnectionDisplay(connectionSnapshots[channel.provider]).tone}>{adsConnectionDisplay(connectionSnapshots[channel.provider]).label}</span> : channel.id === "openai" ? <span className={styles.channelStatus} data-status={adsConnectionDisplay(connectionSnapshots.openai).tone}>{adsConnectionDisplay(connectionSnapshots.openai).label}</span> : externalChannel ? <span className={styles.channelStatus} data-status={externalStatusDisplay(externalStatuses[externalChannel]).tone}>{externalStatusDisplay(externalStatuses[externalChannel]).label}</span> : null}</div>
              {offset === 0 && (pilotChannelsEnabled || isAdsPublicChannel(channel.id)) && (channel.provider ? <div className={styles.channelActions}>
                {configuredAdvertiserAccountUrl ? <a className={styles.channelViewAccount} href={configuredAdvertiserAccountUrl} target="_blank" rel="noreferrer">Voir le compte</a> : null}
                <button type="button" className={styles.channelConfigure} onClick={() => openConfiguration(channel.provider!)}><span aria-hidden="true">⚙</span> Configurer</button>
              </div> : externalChannel ? <div className={styles.channelActions}>
                {externalAdvertiserAccountUrl ? <a className={styles.channelViewAccount} href={externalAdvertiserAccountUrl} target="_blank" rel="noreferrer">Voir le compte</a> : null}
                <button type="button" className={styles.channelConfigure} onClick={() => openExternalConfiguration(externalChannel)}><span aria-hidden="true">⚙</span> Configurer</button>
              </div> : channel.id === "openai" ? <div className={styles.channelActions}>
                {connectionSnapshots.openai.accountId ? <a className={styles.channelViewAccount} href={getAdsAdvertiserAccountUrl("openai", connectionSnapshots.openai.accountId) || "https://ads.openai.com/"} target="_blank" rel="noreferrer">Voir le compte</a> : null}
                <button type="button" className={styles.channelConfigure} onClick={() => openChannelConfiguration("openai")}><span aria-hidden="true">⚙</span> Configurer</button>
              </div> : null)}
            </div>;
          })}
          </div>
          <button type="button" onClick={() => selectChannel(channelIndex + 1)} aria-label="Canal suivant">›</button>
        </div>
      </section>

      <div className={styles.launchArea}>
        <button ref={launchButtonRef} type="button" onClick={startNewCampaign} className={`${styles.headerCta} ${styles.launchButton}`}><span aria-hidden="true">✦</span> Lancer une campagne <span aria-hidden="true">↗</span></button>
      </div>

      <SettingsDrawer title={campaignCreationTitle} isOpen={creating} onClose={() => { if (!demoDialog && busy !== "demo") void confirmCampaignExit(); }} closeOnEscape={!demoDialog && busy !== "demo"} closeOnBackdrop={!demoDialog && busy !== "demo"} presentation="centered" headerLead={<div className={styles.modalBrand}>iNr’<span>ADS</span><small>STUDIO DE CAMPAGNE</small></div>} headerStyle={campaignHeaderStyle(channelId)} headerContent={<div className={styles.wizardTitle}><span className={styles.wizardChannelLogo} aria-hidden="true"><Image src={channelMeta.logo} width={34} height={34} alt="" /></span><div>{campaignCreationTitle}<small>{displayedStepNames[step]} · Étape {step + 1} / {displayedStepNames.length}</small></div></div>}>
      <div ref={studioWorkspaceRef} className={`${styles.workspace} ${styles.studioWorkspace}`} data-compact={compactScreen || undefined} data-short={shortScreen || undefined} data-stage={step} data-creation-path={creationPath} data-analysis-setup={analysisSetupOpen || undefined} onTouchStart={(event) => { const touch = event.touches[0]; touchStart.current = { x: touch.clientX, y: touch.clientY }; }} onTouchEnd={(event) => { const start = touchStart.current; touchStart.current = null; if (!start || creationPath === "choice" || busy !== null) return; const touch = event.changedTouches[0]; const dx = touch.clientX - start.x; const dy = touch.clientY - start.y; if (Math.abs(dx) > 75 && Math.abs(dx) > Math.abs(dy) * 1.5 && !(event.target instanceof HTMLElement && event.target.closest("input, textarea, select, button"))) setStep((current) => { if (dx < 0 && creationPath === "inrcy" && current === analysisStep && planProgress !== 100) return current; if (dx < 0 && current === mediaStep && channelId === "meta" && !livePublisherMediaReady) return current; if (dx < 0 && current === deliveryStep && !destinationReview.canContinue) return current; return Math.max(0, Math.min(lastStep, current + (dx < 0 ? 1 : -1))); }); }}>
      <nav className={styles.stepper} aria-label="Étapes de création">{displayedStepNames.map((name, index) => <button type="button" key={name} disabled={index > step || busy === "plan"} aria-label={`${index + 1}. ${name}`} aria-current={step === index ? "step" : undefined} onClick={() => setStep(index)}><span>{index + 1}</span>{!compactScreen && (channelId === "pinterest" ? PINTEREST_STEPPER_LABELS[name] || name : name)}</button>)}</nav>
      {notice && <p className={styles.notice} role="status" aria-live="polite">{notice}</p>}
      <section hidden={step !== 0} className={`${styles.card} ${styles.studioChoiceCard}`}>
          <StudioStepHeader number={1} label={analysisSetupOpen ? "LE CAP DE L’ANALYSE" : "VOTRE PROJET"} title={analysisSetupOpen ? "Comment iNrCy doit-il vous guider ?" : "Comment créer ?"} mobileTitle={analysisSetupOpen ? "Quel cap choisir ?" : "Comment créer ?"} channel="Sans diffusion" />
          {analysisSetupOpen ? <>
            <div className={styles.studioAnalysisSetup}>
              <AdsCampaignAnalysisChoice value={analysisMode} onChange={setAnalysisMode} objective={guidedAnalysisObjective} onObjectiveChange={setGuidedAnalysisObjective} disabled={busy !== null} className={styles.studioAnalysisChoice} />
              <div className={styles.studioAnalysisSetupActions}>
                <button type="button" className={styles.back} disabled={busy !== null} onClick={() => setAnalysisSetupOpen(false)}>← Choisir un autre parcours</button>
                <button type="button" className={styles.headerCta} disabled={busy !== null || (analysisMode === "guided" && !guidedAnalysisObjective.trim())} onClick={beginAssistedAnalysis}>Lancer l’analyse iNrCy <span aria-hidden="true">→</span></button>
              </div>
            </div>
          </> : <>
            <div className={styles.studioPathGrid}>
              <button type="button" className={styles.studioPath} onClick={chooseManualCreation} disabled={busy !== null}>
                <span className={styles.studioPathIcon} aria-hidden="true">✎</span><span><strong>Créer manuellement</strong><small>Vous gardez la main sur chaque étape.</small></span><b>Commencer →</b>
              </button>
              <button type="button" className={`${styles.studioPath} ${styles.studioPathAi}`} onClick={openAssistedAnalysisSetup} disabled={busy !== null}>
                <span className={styles.studioPathIcon} aria-hidden="true">✦</span><span><strong>Créer avec iNrCy</strong><small>Votre iNrADN guide une campagne préparée pour vous.</small></span><b>Préparer l’analyse →</b>
              </button>
            </div>
            <p className={styles.studioCampaignPromise}><span aria-hidden="true">✦</span>{campaignPromise(channelId)}</p>
          </>}
      </section>

      <section hidden={creationPath !== "inrcy" || step !== analysisStep} className={`${styles.card} ${styles.studioAnalysisCard}`}>
        <div className={styles.adsGenerationCanvas} data-ready={planProgress === 100 || undefined}>
          <span className={`${styles.adsGenerationParticle} ${styles.adsGenerationParticleOne}`} aria-hidden="true" /><span className={`${styles.adsGenerationParticle} ${styles.adsGenerationParticleTwo}`} aria-hidden="true" /><span className={`${styles.adsGenerationParticle} ${styles.adsGenerationParticleThree}`} aria-hidden="true" />
          <div className={styles.adsGenerationRadar} aria-hidden="true">
            <span className={styles.adsGenerationRadarSweep} />
            <span className={styles.adsGenerationRadarCore} />
          </div>
          <span className={`${styles.adsGenerationSatellite} ${styles.adsGenerationSatelliteLeft}`} aria-hidden="true" />
          <span className={`${styles.adsGenerationSatellite} ${styles.adsGenerationSatelliteRight}`} aria-hidden="true" />
          <div className={styles.adsGenerationEmblem} aria-hidden="true"><span>↗</span></div>
          <p className={styles.adsGenerationEyebrow}>iNrCY · ANALYSE &amp; GÉNÉRATION</p>
          <h2>{planProgress === 100 ? "Votre campagne prend forme." : autoMediaState === "generating" ? "iNr’Studio compose votre média." : "iNrCy construit votre campagne."}</h2>
          <p className={styles.adsGenerationLead}>{planProgress === 100 ? "Votre base est prête. Contrôlez chaque recommandation avant de l’enregistrer ou de la diffuser." : autoMediaState === "generating" ? "Le ciblage et les messages sont prêts : iNrCy fabrique maintenant le média adapté au format choisi." : "Nous relions votre iNrADN, vos priorités et l’historique utile pour vous proposer une campagne cohérente."}</p>
          <div className={styles.adsGenerationProgress} data-pending={analysisRequestPending || undefined} role="progressbar" aria-label={hasMediaStep ? "Analyse iNrCy et génération du média" : "Analyse iNrCy de la campagne"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={analysisRequestPending ? undefined : planProgress} aria-valuetext={analysisRequestPending ? `Analyse en cours, progression indicative à ${planProgress} %` : undefined}><div><span style={{ width: `${planProgress}%` }} /></div><strong>{analysisRequestPending ? `${planProgress}% estimé` : `${planProgress}%`}</strong></div>
          <ol className={styles.adsGenerationStages}>{AI_ANALYSIS_STAGES.map((stage, index) => {
            const done = planProgress === 100 || index < completedAnalysisStages;
            return <li key={stage.label} data-state={done ? "done" : index <= activeAnalysisStage ? "active" : "pending"}><span>{done ? "✓" : index + 1}</span><div><strong>{stage.label}</strong><small>{!hasMediaStep && stage.label === "Créations & messages" ? "Arguments, titres et descriptions de l’annonce" : stage.detail}</small></div></li>;
          })}</ol>
          {autoMediaMessage && <p className={styles.studioMediaGenerationNote} data-state={autoMediaState} role={autoMediaState === "error" ? "alert" : "status"}>{autoMediaMessage}</p>}
          {planError && <div className={styles.studioPlanError} role="alert"><strong>La proposition n’a pas pu être finalisée.</strong><span>{planError}</span>{planRequestId && <small>Référence technique : {planRequestId}</small>}<div><button type="button" className={styles.secondaryButton} onClick={() => void generateCampaignPlan()}>Réessayer l’analyse</button><button type="button" className={styles.back} onClick={chooseManualCreation}>Passer au mode manuel</button></div></div>}
          {!planError && planProgress < 100 && <div className={`${styles.studioPlanReady} ${styles.studioPlanPending}`} aria-hidden="true"><strong className={styles.studioPlanHeading}>Bilan de l’analyse</strong><div className={styles.studioPlanPendingLines}><span /><span /><span /></div></div>}
          {planProgress === 100 && !planError && <div className={styles.studioPlanReady}><strong className={styles.studioPlanHeading}>Bilan de l’analyse</strong><details className={styles.studioPlanDetails}><summary><span className={styles.studioPlanPreview}>{visiblePlanRationale}</span><span className={styles.studioPlanExpandClosed}>Lire le bilan complet ↓</span><span className={styles.studioPlanExpandOpen}>Réduire le bilan ↑</span></summary><p>{visiblePlanRationale}</p></details>{planSources.length > 0 && <div className={styles.studioPlanSources}><span>Analyse basée sur</span><ul>{planSources.map((source) => <li key={source}>{source}</li>)}</ul></div>}</div>}
        </div>
      </section>

      <section hidden={step !== foundationsStep} data-channel={channelId} className={`${styles.card} ${styles.studioCard} ${styles.studioFoundationsCard}`}>
        <StudioStepHeader number={foundationsStep + 1} label={channelId === "pinterest" ? "OBJECTIF PINTEREST" : "FONDATIONS"} title={channelId === "pinterest" ? "Choisissez l’intention de découverte." : "La direction de votre campagne."} mobileTitle="Votre objectif" channel={channelMeta.label} />
        <p className={`${styles.intro} ${styles.studioOptionalIntro}`}>{channelId === "pinterest" ? "Notoriété, considération, vidéo, ventes ou prospects : ce choix structure la proposition Pinterest et les réglages qui suivent." : "Définissez ce que vous voulez obtenir. iNrCy utilise ces choix pour guider les messages, le ciblage et la diffusion."}</p>
        <div className={styles.studioGrid}>
          <label className={styles.field}>Nom de la campagne<input value={draft.name} maxLength={100} onChange={(event) => updateDraft({ name: event.target.value })} placeholder="Ex. Demandes de devis locales" /></label>
          <label className={`${styles.field} ${styles.studioWide}`}>Offre ou service à mettre en lumière<VoiceTextarea value={draft.offer} onChange={(offer) => updateDraft({ offer })} maxLength={500} purpose="subject" contextLabel="Offre à mettre en lumière" placeholder="Ex. installation de panneaux solaires avec étude personnalisée" /></label>
          {nativeSettings?.channel === "linkedin" && <>
            <label className={styles.field}>Objectif LinkedIn<select value={nativeSettings.objectiveType} onChange={(event) => {
              const objectiveType = event.target.value as LinkedInWizardSettings["objectiveType"];
              const formats = LINKEDIN_WIZARD_FORMATS[objectiveType] as readonly string[];
              const format = formats.includes(nativeSettings.format) ? nativeSettings.format : formats[0] as LinkedInWizardSettings["format"];
              updateNativeSettings({ ...nativeSettings, objectiveType, format });
            }}>{Object.keys(LINKEDIN_WIZARD_FORMATS).map((value) => <option key={value} value={value}>{nativeBriefTerm(value)}</option>)}</select></label>
            <label className={styles.field}>Format sponsorisé<select value={nativeSettings.format} onChange={(event) => updateNativeSettings({ ...nativeSettings, format: event.target.value as LinkedInWizardSettings["format"] })}>{LINKEDIN_WIZARD_FORMATS[nativeSettings.objectiveType].map((format) => <option key={format} value={format}>{nativeBriefTerm(format)}</option>)}</select><small>Ce choix fixe les ressources à préparer dans l’étape Médias dédiée.</small></label>
          </>}
          {nativeSettings?.channel === "linkedin" && <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`} data-linkedin-provider-resources="true">
            <legend>Compte, groupe et Page LinkedIn</legend>
            <p>Chargez une seule fois les ressources du compte associé, puis choisissez-les explicitement. Vos choix restent enregistrés dans le brouillon et ne changent pas lorsque vous passez d’une étape à l’autre.</p>
            <div className={styles.studioControlOptions}>
              <button type="button" className={styles.secondaryButton} disabled={linkedInPreflightLoad === "loading" || !externalStatuses.linkedin.connected || !externalStatuses.linkedin.selectedAccountId} onClick={() => void loadLinkedInResources(linkedInPreflightLoad === "ready")}>
                {linkedInPreflightLoad === "loading" ? "Vérification LinkedIn…" : linkedInPreflightLoad === "ready" ? "Actualiser les ressources" : "Charger les ressources LinkedIn"}
              </button>
              <span>{externalStatuses.linkedin.selectedAccountId
                ? `${externalStatuses.linkedin.selectedAccountName || "Compte LinkedIn Ads"} · ID ${externalStatuses.linkedin.selectedAccountId}`
                : "Aucun compte LinkedIn Ads associé"}</span>
            </div>
            {linkedInPreflightLoad === "error" && <p className={styles.campaignMediaError} role="alert">{linkedInPreflightError}</p>}
            {linkedInPreflight && <div className={styles.studioControlOptions}>
              <label>Groupe de campagnes
                <select value={draft.linkedinCampaignGroupId || ""} onChange={(event) => updateDraft({ linkedinCampaignGroupId: event.target.value })}>
                  <option value="">Sélectionnez un groupe vérifié</option>
                  {draft.linkedinCampaignGroupId && !linkedInCampaignGroups.some((group) => group.id === draft.linkedinCampaignGroupId) && <option value={draft.linkedinCampaignGroupId} disabled>Choix enregistré indisponible · ID {draft.linkedinCampaignGroupId}</option>}
                  {linkedInCampaignGroups.map((group) => <option key={group.id} value={group.id}>{group.name} · {group.status} · ID {group.id}</option>)}
                </select>
              </label>
              <label>Page organisation
                <select value={draft.linkedinOrganizationUrn || ""} onChange={(event) => updateDraft({ linkedinOrganizationUrn: event.target.value })}>
                  <option value="">Sélectionnez une Page autorisée</option>
                  {draft.linkedinOrganizationUrn && !linkedInOrganizations.some((organization) => organization.urn === draft.linkedinOrganizationUrn) && <option value={draft.linkedinOrganizationUrn} disabled>Choix enregistré indisponible · {draft.linkedinOrganizationUrn}</option>}
                  {linkedInOrganizations.map((organization) => <option key={organization.urn} value={organization.urn}>{linkedInOrganizationLabel(organization)}</option>)}
                </select>
              </label>
            </div>}
            {linkedInPreflight && linkedInCampaignGroups.length === 0 && <small role="alert">Aucun groupe compatible Visites du site / Sponsored Content n’est disponible sur ce compte.</small>}
            {linkedInPreflight && linkedInOrganizations.length === 0 && <small role="alert">Aucune Page avec un rôle Administrateur, Administrateur de contenu ou Sponsor direct autorisé n’est disponible.</small>}
            {selectedLinkedInCampaignGroup && <small>Groupe choisi : {selectedLinkedInCampaignGroup.name} · {selectedLinkedInCampaignGroup.status} · ID {selectedLinkedInCampaignGroup.id}. Le statut Active exige un groupe ACTIVE ; un groupe DRAFT ou PAUSED permet uniquement une création en pause.</small>}
          </fieldset>}
          {nativeSettings?.channel === "tiktok" && <>
            <label className={styles.field}>Objectif TikTok<select value={nativeSettings.objectiveType} onChange={(event) => {
              const objectiveType = event.target.value as TikTokWizardSettings["objectiveType"];
              const optimizationIntent = ({ REACH: "reach", VIDEO_VIEWS: "views", TRAFFIC: "clicks", WEB_CONVERSIONS: "conversions", LEAD_GENERATION: "leads", ENGAGEMENT: "engagement" } as const)[objectiveType];
              updateNativeSettings({ ...nativeSettings, objectiveType, optimizationIntent,
                destinationKind: objectiveType === "LEAD_GENERATION" ? "instant_form" : "website" });
            }}>{TIKTOK_WIZARD_OBJECTIVES.map((value) => <option key={value} value={value}>{nativeBriefTerm(value)}</option>)}</select></label>
          </>}
          {nativeSettings?.channel === "pinterest" && <>
            <label className={styles.field}>Objectif Pinterest<select value={nativeSettings.objectiveType} onChange={(event) => {
              const objectiveType = event.target.value as PinterestWizardSettings["objectiveType"];
              const catalogAllowed = objectiveType === "CONSIDERATION" || objectiveType === "SALES";
              const intendedPromotionType = catalogAllowed ? nativeSettings.intendedPromotionType : "STANDARD_AD";
              updateNativeSettings({ ...nativeSettings, objectiveType,
                intendedPromotionType,
                creativeType: objectiveType === "VIDEO_COMPLETION" ? "VIDEO" : intendedPromotionType === "CATALOG" ? null : nativeSettings.creativeType || "REGULAR",
                conversionEvent: objectiveType === "SALES" ? "CHECKOUT" : objectiveType === "LEADS" ? "LEAD" : null });
            }}>{PINTEREST_WIZARD_OBJECTIVES.map((value) => <option key={value} value={value}>{pinterestObjectiveLabel(value)}</option>)}</select><small>Notoriété et Considération peuvent être lancées aujourd’hui avec une image et le ciblage automatique. Les autres objectifs restent entièrement enregistrables en brouillon.</small></label>
          </>}
          {nativeSettings?.channel === "x" && <>
            <label className={styles.field}>Objectif X<select value={nativeSettings.objective} onChange={(event) => {
              const objective = event.target.value as XWizardSettings["objective"];
              updateNativeSettings({ ...nativeSettings, objective, format: objective === "video_views" ? "video" : nativeSettings.format });
            }}>{X_WIZARD_OBJECTIVES.map((value) => <option key={value} value={value}>{nativeBriefTerm(value)}</option>)}</select></label>
            <label className={styles.field}>Format du post X Ads<select value={nativeSettings.format} onChange={(event) => updateNativeSettings({ ...nativeSettings, format: event.target.value as XWizardSettings["format"] })}>{(nativeSettings.objective === "video_views" ? ["video"] : ["text", "image", "video"]).map((value) => <option key={value} value={value}>{nativeBriefTerm(value)}</option>)}</select><small>{nativeSettings.format === "text" ? "Le post texte est le seul format X Ads sans étape Média." : "Le fichier sera préparé dans l’étape Médias dédiée à X Ads."}</small></label>
          </>}
          {!nativeSettings && channelId !== "openai" && <>
            <label className={styles.field}>Objectif<select value={draft.objective} onChange={(event) => updateDraft({ objective: event.target.value as AdsCampaignInput["objective"] })}>{OBJECTIVE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label className={styles.field}>Action à mesurer<select value={draft.conversionGoal} onChange={(event) => updateDraft({ conversionGoal: event.target.value as AdsCampaignInput["conversionGoal"] })}>{CONVERSION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          </>}
        </div>
        {!nativeSettings && <><div className={styles.studioTypeGrid} role="radiogroup" aria-label="Type de campagne">{campaignTypeOptions.map((option) => <button type="button" role="radio" aria-checked={draft.campaignType === option.value} key={option.value} data-selected={draft.campaignType === option.value || undefined} onClick={() => updateDraft({ campaignType: option.value })}><strong>{option.label}</strong><small>{option.detail}</small><span>{draft.campaignType === option.value ? "Choisi" : "Choisir"}</span></button>)}</div><p className={styles.studioTypeHint}>Un seul type par campagne : pour tester plusieurs leviers, créez ensuite une campagne dédiée à chacun.</p></>}
        {nativeSettings && <p className={styles.studioTypeHint}>{channelId === "pinterest" ? "Choisissez ensuite votre audience, puis le format et l’image de votre Pin." : nativeSettings.channel === "x" && nativeSettings.format === "text" ? "Le format texte ne nécessite aucun média ; le parcours passe directement à la diffusion." : "Le format est défini ; l’étape Médias est consacrée au fichier et à son aperçu."}</p>}
      </section>

      <section hidden={step !== targetingStep} data-channel={channelId} className={`${styles.card} ${styles.studioCard} ${styles.studioTargetingCard}`}>
        <StudioStepHeader number={targetingStep + 1} label={channelId === "pinterest" ? "AUDIENCE PINTEREST" : "CIBLAGE"} title={channelId === "pinterest" ? "À qui montrer vos idées." : "À qui, où et quand parler."} mobileTitle="Votre ciblage" channel={channelMeta.label} />
        <p className={`${styles.intro} ${styles.studioOptionalIntro}`}>{channelId === "pinterest" ? "Choisissez les zones à couvrir et les clients que votre Pin doit intéresser." : "Vos zones et vos clients évitent une campagne trop large ou des clics peu pertinents."}</p>
        <div className={styles.studioGrid}>
          <div className={styles.studioLocationField}><TagField label="Zones ciblées" helper="Ajoutez un lieu ou choisissez une zone ci-dessous." values={draft.targetLocations} onChange={(targetLocations) => {
            const changed = targetLocations.join("\n") !== draft.targetLocations.join("\n");
            updateDraft({ targetLocations, ...(channelId === "linkedin" && changed ? { linkedinGeoTargets: [] } : {}) });
            if (channelId === "linkedin" && changed) {
              setLinkedInGeoQuery(targetLocations[0] || "");
              setLinkedInPreflight((current) => current ? { ...current, geoSuggestions: [] } : current);
            }
          }} placeholder={channelId === "pinterest" ? "Choisissez une zone Pinterest ci-dessous" : channelId === "openai" ? "Ex. Lille, Arras" : "Ex. Lyon, Rhône ou 20 km autour de Villeurbanne"} note={channelId === "linkedin" ? "Chaque libellé devra être résolu en zone LinkedIn exacte ci-dessous avant le lancement." : channelId === "openai" ? "Zones françaises vérifiées dans ChatGPT Ads. Aucun pays ajouté par défaut." : channelId === "pinterest" ? "Un pays cible le pays entier. Vos zones ne sont jamais élargies automatiquement." : undefined} />
          {channelId === "pinterest" && <PinterestLocationSearch accountId={draft.adAccountId || externalStatuses.pinterest.selectedAccountId} locations={draft.targetLocations} onChange={(targetLocations) => updateDraft({ targetLocations })} />}
          {channelId === "google" && <GoogleLocationSearch accountId={draft.adAccountId || configuredAccountId} locations={draft.targetLocations} onChange={(targetLocations) => updateDraft({ targetLocations })} />}</div>
          <TagField className={styles.studioAudienceField} label={channelId === "openai" ? "Profils pour guider le message" : "Clients / audiences prioritaires"} helper={channelId === "openai" ? "Pour le texte uniquement, sans ciblage d’audience personnalisée." : channelId === "google" || channelId === "pinterest" ? "Ces profils guident les textes et visuels de l’IA." : "Ajoutez les profils à privilégier"} values={draft.targetAudiences} onChange={(targetAudiences) => updateDraft({ targetAudiences })} placeholder="Ex. Propriétaires de maison" />
          {channelId !== "openai" && <TagField className={styles.studioLanguageField} wide={channelId !== "google" && channelId !== "pinterest"} label={channelId === "google" ? "Langues du message" : "Langues de vos clients"} helper={channelId === "google" ? "Google déduit la langue des annonces et du site." : "Ajoutez une langue ou son code"} values={draft.languages} onChange={(languages) => updateDraft({ languages })} placeholder="Ex. fr ou en" />}
          {nativeSettings?.channel === "linkedin" && <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`} data-linkedin-targeting="true">
            <legend>Ciblage professionnel LinkedIn</legend>
            <p>Choisissez l’angle principal, puis résolvez chaque zone en cible LinkedIn vérifiée. iNr’ADS n’invente et ne sélectionne jamais un identifiant de ciblage à votre place.</p>
            <div className={styles.studioControlOptions}>
              <label>Critère principal<select value={nativeSettings.targetingFacet} onChange={(event) => updateNativeSettings({ ...nativeSettings, targetingFacet: event.target.value as LinkedInWizardSettings["targetingFacet"] })}><option value="titles">Fonctions / postes</option><option value="industries">Secteurs d’entreprise</option><option value="skills">Compétences</option></select></label>
              <label>Langue de la campagne<select value={nativeSettings.locale.language} onChange={(event) => updateNativeSettings({ ...nativeSettings, locale: { ...nativeSettings.locale, language: event.target.value } })}><option value="fr">Français</option><option value="en">Anglais</option></select></label>
            </div>
            <div className={styles.studioControlOptions}>
              <label>Rechercher une zone LinkedIn
                <input value={linkedInGeoQuery} maxLength={80} onChange={(event) => setLinkedInGeoQuery(event.target.value)} placeholder={draft.targetLocations[0] || "Ex. France"} />
              </label>
              <button type="button" className={styles.secondaryButton} disabled={linkedInPreflightLoad === "loading" || (linkedInGeoQuery.trim() || draft.targetLocations[0] || "").trim().length < 2} onClick={() => void loadLinkedInResources()}>{linkedInPreflightLoad === "loading" ? "Recherche…" : "Rechercher dans LinkedIn"}</button>
            </div>
            {(linkedInPreflight?.geoSuggestions || []).length > 0 && <div className={styles.studioControlOptions} role="group" aria-label="Zones LinkedIn proposées">
              {(linkedInPreflight?.geoSuggestions || []).map((target) => {
                const selected = linkedInGeoTargets.some((item) => item.urn === target.urn);
                return <label key={target.urn}>
                  <input type="checkbox" checked={selected} disabled={!selected && linkedInGeoTargets.length >= 20} onChange={(event) => updateDraft({
                    linkedinGeoTargets: event.target.checked
                      ? [...linkedInGeoTargets, { urn: target.urn, name: target.name }]
                      : linkedInGeoTargets.filter((item) => item.urn !== target.urn),
                  })} />
                  {target.name} · {target.urn}
                </label>;
              })}
            </div>}
            {linkedInGeoTargets.length > 0 ? <div className={styles.studioKeywordGuidance}>
              <strong>{linkedInGeoTargets.length} zone{linkedInGeoTargets.length > 1 ? "s" : ""} LinkedIn vérifiée{linkedInGeoTargets.length > 1 ? "s" : ""}</strong>
              <ul>{linkedInGeoTargets.map((target) => <li key={target.urn}>{target.name} · {target.urn}</li>)}</ul>
            </div> : <small role="alert">Sélectionnez au moins une zone exacte avant un lancement réel. Les libellés généraux ci-dessus restent utiles au brief IA, mais ne suffisent pas à l’API LinkedIn.</small>}
            <small>Locale prévue : {nativeSettings.locale.language.toUpperCase()} · {nativeSettings.locale.country}. L’audience finale doit compter au moins 300 membres selon le contrôle LinkedIn.</small>
          </fieldset>}
          {nativeSettings?.channel === "tiktok" && <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}><legend>Audience TikTok</legend><div className={styles.studioControlOptions}><label>Approche d’audience<select value={nativeSettings.targetingMode} onChange={(event) => updateNativeSettings({ ...nativeSettings, targetingMode: event.target.value as TikTokWizardSettings["targetingMode"] })}><option value="broad">Audience large</option><option value="interests">Centres d’intérêt</option></select></label></div><small>Les intérêts exacts devront être vérifiés dans le compte annonceur.</small></fieldset>}
          {nativeSettings?.channel === "pinterest" && <label className={`${styles.field} ${styles.studioTargetingMode}`}>Mode de ciblage Pinterest<select value={nativeSettings.targetingMode} onChange={(event) => updatePinterestTargetingMode(event.target.value as PinterestWizardSettings["targetingMode"])}><option value="automatic">Ciblage automatique — recommandé · publiable</option><option value="interests">Centres d’intérêt · brouillon</option><option value="keywords">Recherches / mots-clés · brouillon</option><option value="audiences">Audiences existantes · brouillon</option></select><small>{nativeSettings.targetingMode === "automatic" ? "Pinterest optimise l’audience à partir du contenu de votre Pin, dans les zones choisies." : "Ce mode reste en brouillon jusqu’à la sélection de ses audiences dans Pinterest Ads."}</small>{nativeSettings.targetingMode === "automatic" && draft.keywords.length > 0 && <small role="alert">Retirez les anciens signaux manuels pour utiliser le ciblage automatique. <button type="button" className={styles.secondaryButton} onClick={clearPinterestManualSignals}>Retirer les signaux manuels</button></small>}</label>}
          {nativeSettings?.channel === "x" && <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}><legend>Audience X</legend><p>Votre choix oriente les signaux à détailler à l’étape suivante.</p><div className={styles.studioControlOptions}><label>Approche de ciblage<select value={nativeSettings.targetingMode} onChange={(event) => updateNativeSettings({ ...nativeSettings, targetingMode: event.target.value as XWizardSettings["targetingMode"] })}><option value="broad">Audience large</option><option value="keywords">Mots-clés</option><option value="interests">Centres d’intérêt</option><option value="follower_lookalikes">Audiences similaires aux abonnés</option></select></label></div></fieldset>}
          {channelId === "meta" && <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}><legend>Audience Meta</legend><label className={styles.check}><input type="checkbox" checked={draft.metaAudienceExpansion} onChange={(event) => updateDraft({ metaAudienceExpansion: event.target.checked })} />Autoriser Meta à élargir l’audience si cela améliore la probabilité de conversion.</label></fieldset>}
        </div>
      </section>

      <section hidden={step !== keywordsStep} data-channel={channelId} className={`${styles.card} ${styles.studioCard} ${styles.studioKeywordsCard}`}>
        <StudioStepHeader number={keywordsStep + 1} label={channelId === "google" ? "MOTS-CLÉS" : channelId === "pinterest" ? "DÉCOUVERTE PINTEREST" : "SIGNAUX"} title={channelId === "google" ? "Les recherches à capter." : channelId === "pinterest" ? "Comment votre idée doit être découverte." : "Les signaux qui orientent votre audience."} mobileTitle={channelId === "google" ? "Vos mots-clés" : channelId === "pinterest" ? "Votre découverte" : "Vos signaux"} channel={channelMeta.label} />
        <p className={`${styles.intro} ${styles.studioOptionalIntro}`}>{channelId === "google" ? "Cette étape est dédiée aux requêtes de vos futurs clients. Ajoutez les expressions commerciales à viser et celles à écarter." : channelId === "meta" ? "Ajoutez les intérêts, besoins et angles qui aident à orienter votre audience Meta." : `Détaillez les ${nativeSettings?.channel === "x" && nativeSettings.targetingMode === "keywords" || nativeSettings?.channel === "pinterest" && nativeSettings.targetingMode === "keywords" ? "mots-clés" : "signaux"} prévus pour ${channelMeta.label}. Les valeurs exactes seront confirmées dans le compte Ads.`}</p>
        <div className={styles.studioGrid}>
          {channelId === "google" ? <TagField wide label={draft.campaignType === "performance_max" ? "Thèmes de recherche / signaux d’intention" : "Mots-clés recherchés"} helper="Saisissez une expression, puis Entrée. Le micro ajoute vos mots-clés dictés." values={draft.keywords} onChange={(keywords) => updateDraft({ keywords })} placeholder="Ex. installation panneaux solaires" maxItems={20} maxItemLength={80} /> : nativeSettings?.channel === "pinterest" && nativeSettings.targetingMode === "automatic" ? <aside className={`${styles.studioKeywordGuidance} ${styles.studioWide}`}><strong>La découverte est préparée automatiquement</strong><p>L’IA remplit le profil prioritaire, les zones, le titre, la description et le brief visuel. Pinterest utilise ensuite le contenu du Pin pour optimiser l’audience ; aucun ID d’intérêt ou d’audience n’est inventé.</p>{draft.keywords.length > 0 && <><p role="alert">{draft.keywords.length} signal{draft.keywords.length > 1 ? "aux manuels restent" : " manuel reste"} enregistré{draft.keywords.length > 1 ? "s" : ""}. Retirez-les pour lancer cette campagne en ciblage automatique.</p><button type="button" className={styles.secondaryButton} onClick={clearPinterestManualSignals}>Retirer les signaux manuels</button></>}</aside> : <label className={`${styles.field} ${styles.studioWide}`}>{nativeSettings?.channel === "linkedin" ? `Pistes : ${nativeBriefTerm(nativeSettings.targetingFacet)}` : nativeSettings?.channel === "pinterest" && nativeSettings.targetingMode === "keywords" || nativeSettings?.channel === "x" && nativeSettings.targetingMode === "keywords" ? "Mots-clés à envisager" : nativeSettings?.channel === "pinterest" && nativeSettings.targetingMode === "audiences" ? "Audiences Pinterest à retrouver dans le compte" : nativeSettings?.channel === "pinterest" && nativeSettings.targetingMode === "interests" ? "Centres d’intérêt Pinterest à vérifier" : nativeSettings?.channel === "x" && nativeSettings.targetingMode === "follower_lookalikes" ? "Comptes ou communautés similaires à étudier" : "Centres d’intérêt, signaux ou angles de ciblage"}<small>Un par ligne</small><textarea rows={6} value={editableList(draft.keywords)} onChange={(event) => updateDraft({ keywords: parseEditableList(event.target.value.split("\n")) })} placeholder="Ex. rénovation énergétique\nMaison individuelle\nÉconomies d’énergie" /></label>}
          {nativeSettings && !(nativeSettings.channel === "pinterest" && nativeSettings.targetingMode === "automatic") && <aside className={`${styles.studioKeywordGuidance} ${styles.studioWide}`}><strong>Des pistes, pas des identifiants publicitaires</strong><p>Ces idées restent dans votre brouillon. iNr’ADS ne les convertit pas automatiquement en audiences ou mots-clés de la plateforme ; vérifiez leur disponibilité avant une création réelle.</p></aside>}
          {channelId === "google" && <TagField wide label="Mots-clés à exclure" helper="Écartez les recherches non pertinentes ; ajoutez-les aussi à la voix." values={draft.negativeKeywords} onChange={(negativeKeywords) => updateDraft({ negativeKeywords })} placeholder="Ex. emploi" maxItems={40} maxItemLength={80} />}
          {channelId === "meta" && <aside className={`${styles.studioKeywordGuidance} ${styles.studioWide}`}><strong>Un signal, pas une contrainte rigide</strong><p>iNrCy les combine à vos zones, à votre offre et au comportement observé par Meta. Vous gardez le contrôle sur les audiences définies à l’étape précédente.</p></aside>}
        </div>
      </section>

      <section hidden={step !== creativeStep} data-channel={channelId} className={`${styles.card} ${styles.studioCard} ${styles.studioCreativeCard}`}>
        <StudioStepHeader number={creativeStep + 1} label={channelId === "pinterest" ? "ÉPINGLE SPONSORISÉE" : "CRÉATIONS"} title={channelId === "pinterest" ? "Le titre et la description de votre Pin." : "Des messages qui donnent envie d’agir."} mobileTitle={channelId === "pinterest" ? "Votre épingle" : "Vos messages"} channel={channelMeta.label} />
        <p className={`${styles.intro} ${styles.studioOptionalIntro}`}>{channelId === "pinterest" ? "Relisez le titre, la description et l’appel à l’action de votre épingle." : "Vous pouvez écrire vous-même, partir de la proposition iNrCy et ajuster chaque mot. Vérifiez les exigences du canal avant une éventuelle publication."}</p>
        <div className={styles.studioGrid}>
          <label className={`${styles.field} ${styles.studioWide} ${styles.studioMessageField}`}>{channelId === "x" ? "Texte du post X" : channelId === "tiktok" ? "Texte de l’annonce TikTok" : channelId === "pinterest" ? "Description de l’épingle" : channelId === "linkedin" ? "Introduction de la publication" : channelId === "openai" ? "Texte de la carte ChatGPT · 100 caractères max." : "Message principal"}<VoiceTextarea value={draft.primaryText} onChange={(primaryText) => updateDraft({ primaryText })} rows={2} maxLength={channelId === "linkedin" ? 300 : channelId === "openai" || channelId === "tiktok" ? 100 : channelId === "pinterest" ? 800 : channelId === "x" ? 280 : 500} purpose="content" contextLabel="Message principal de la campagne" placeholder="Présentez l’offre, son bénéfice concret et la prochaine action à réaliser." /></label>
          {channelId === "google" ? <GoogleAdCopyField label="Titres" singular="Titre" values={draft.headlines} onChange={(headlines) => updateDraft({ headlines })} minItems={3} maxItems={15} maxLength={30} /> : channelId === "openai" ? <label className={styles.field}>Titre de la carte ChatGPT · 3 à 50 caractères<input type="text" maxLength={50} value={draft.headlines[0] || ""} onChange={(event) => updateDraft({ headlines: event.target.value ? [event.target.value] : [] })} /></label> : channelId !== "tiktok" && channelId !== "x" && <label className={styles.field}>{channelId === "pinterest" ? "Titre de l’épingle" : channelId === "linkedin" ? "Titre de la création" : "Titres ou accroches (un par ligne)"}<CampaignTextarea rows={2} value={editableList(draft.headlines)} aria-invalid={channelId === "pinterest" && (draft.headlines.length !== 1 || draft.headlines.some((title) => title.length > 100)) || undefined} onChange={(event) => updateDraft({ headlines: parseEditableList(event.target.value.split("\n")) })} />{(channelId === "pinterest" || channelId === "linkedin") && <small className={draft.headlines.some((title) => title.length > (channelId === "pinterest" ? 100 : 200)) || channelId === "pinterest" && draft.headlines.length !== 1 ? styles.copyLengthError : undefined}>{channelId === "pinterest" ? "Un seul titre · 100 caractères maximum" : "200 caractères maximum par titre ; reformulez tout dépassement."}</small>}{channelId === "pinterest" && draft.headlines.length > 1 && <small className={styles.copyLengthError} role="alert">Choisissez un seul titre pour votre épingle. Vos propositions sont conservées ci-dessus.</small>}</label>}
          {channelId === "google" ? <GoogleAdCopyField label="Descriptions" singular="Description" values={draft.descriptions} onChange={(descriptions) => updateDraft({ descriptions })} minItems={2} maxItems={4} maxLength={90} /> : channelId === "meta" && <label className={styles.field}>Descriptions (une par ligne)<CampaignTextarea rows={2} value={editableList(draft.descriptions)} onChange={(event) => updateDraft({ descriptions: parseEditableList(event.target.value.split("\n")) })} /></label>}
          {channelId !== "openai" && <label className={`${styles.field} ${styles.studioCtaField}`}>Appel à l’action<input value={draft.callToAction} maxLength={80} onChange={(event) => updateDraft({ callToAction: event.target.value })} placeholder="Ex. Demander un devis" /></label>}
          {channelId !== "google" && <aside className={`${styles.studioCopyGuidance} ${styles.field}`}><strong>À vérifier</strong><p>{channelId === "openai" ? "La carte publiée utilisera exactement le titre, le texte et l’image vérifiés ici. La personnalisation du texte dans Ads Manager n’est pas pilotée par ce parcours." : nativeSettings?.channel === "linkedin" ? "Le texte doit correspondre au format sponsorisé choisi, notamment si vous préparez un formulaire de prospects." : nativeSettings?.channel === "tiktok" ? "Gardez un texte court qui accompagne la vidéo et une action cohérente avec sa destination." : nativeSettings?.channel === "pinterest" ? "Le titre, la description et le visuel doivent présenter la même idée." : nativeSettings?.channel === "x" ? "Votre post doit être clair sans dépasser 280 caractères ; vérifiez le média si vous avez choisi image ou vidéo." : "Relisez la cohérence entre votre message, votre appel à l’action et le média choisi."}</p></aside>}
        </div>
      </section>

      {nativeSettings?.channel === "pinterest" && <section hidden={step !== pinterestFormatStep} data-channel={channelId} className={`${styles.card} ${styles.studioCard} ${styles.studioMediaCard} ${styles.studioPinterestFormatCard}`}>
        <StudioStepHeader number={pinterestFormatStep + 1} label="FORMAT DU PIN" title="Le format adapté à votre idée." mobileTitle="Votre format" channel={channelMeta.label} />
        <p className={`${styles.intro} ${styles.studioOptionalIntro}`}>Choisissez la structure publicitaire, le format du Pin et la direction créative. Le média lui-même sera ajouté, généré ou choisi à l’étape suivante.</p>
        <div className={styles.studioGrid}>
          <label className={styles.field}>Type de promotion<select value={nativeSettings.intendedPromotionType} onChange={(event) => {
            const intendedPromotionType = event.target.value as PinterestWizardSettings["intendedPromotionType"];
            updateNativeSettings({ ...nativeSettings, intendedPromotionType,
              creativeType: intendedPromotionType === "CATALOG" ? null : nativeSettings.objectiveType === "VIDEO_COMPLETION" ? "VIDEO" : "REGULAR" });
          }}><option value="STANDARD_AD">Épingle sponsorisée</option>{["CONSIDERATION", "SALES"].includes(nativeSettings.objectiveType) && <option value="CATALOG">Catalogue de produits · brouillon</option>}</select></label>
          {nativeSettings.intendedPromotionType === "STANDARD_AD" && <label className={styles.field}>Format de l’épingle<select value={nativeSettings.creativeType || "REGULAR"} onChange={(event) => updateNativeSettings({ ...nativeSettings, creativeType: event.target.value as Exclude<PinterestWizardSettings["creativeType"], null> })}>{(nativeSettings.objectiveType === "VIDEO_COMPLETION" ? ["VIDEO", "MAX_VIDEO"] : ["REGULAR", "VIDEO", "MAX_VIDEO", "CAROUSEL"]).map((value) => <option key={value} value={value}>{pinterestCreativeLabel(value as Exclude<PinterestWizardSettings["creativeType"], null>)}</option>)}</select></label>}
          <div className={`${styles.field} ${styles.studioWide}`}><span>Format prévu : {nativeWizardFormat(nativeSettings)}</span><small>{nativeSettings.intendedPromotionType === "CATALOG" ? "Le catalogue et le groupe de produits seront sélectionnés dans Pinterest Ads." : nativeSettings.creativeType === "REGULAR" ? "L’image simple peut être publiée aujourd’hui. Les droits et le fichier seront contrôlés avant la création." : "Ce format est conservé dans le brouillon jusqu’à l’activation de son connecteur de publication."}</small></div>
          <label className={`${styles.field} ${styles.studioWide}`}>Direction créative du Pin<VoiceTextarea value={draft.mediaBrief} onChange={(mediaBrief) => updateDraft({ mediaBrief })} maxLength={1000} purpose="instruction" contextLabel="Direction créative du Pin" placeholder="Style, produit, scène, preuves à montrer et composition souhaitée…" /></label>
        </div>
      </section>}

      {hasMediaStep && <section hidden={step !== mediaStep} data-channel={channelId} data-media-step="true" className={`${styles.card} ${styles.studioCard} ${styles.studioMediaCard} ${styles.studioDedicatedMediaCard} ${channelId === "pinterest" ? styles.studioPureMediaCard : ""}`}>
        <StudioStepHeader number={mediaStep + 1} label={channelId === "pinterest" ? "PUR MÉDIA" : channelId === "linkedin" ? "MÉDIA LINKEDIN" : channelId === "openai" ? "IMAGE CHATGPT" : "MÉDIAS"} title={channelId === "pinterest" ? "Votre média, visible en entier." : channelId === "linkedin" ? "Votre image sponsorisée, visible en entier." : channelId === "openai" ? "Votre image, visible en entier." : "Vos médias, visibles en entier."} mobileTitle={channelId === "pinterest" || channelId === "linkedin" || channelId === "openai" ? "Votre média" : "Vos médias"} channel={channelMeta.label} />
        <p className={`${styles.intro} ${styles.studioOptionalIntro}`}>{channelId === "pinterest" ? "Ajoutez l’image de votre Pin et vérifiez son aperçu complet." : channelId === "linkedin" ? "Importez, générez ou choisissez l’image unique de votre Sponsored Content. L’aperçu conserve le cadrage complet et le fichier sera réimporté sous la Page sélectionnée avant la création." : channelId === "openai" ? "Choisissez ou créez une image JPG ou PNG carrée d’au moins 256 × 256 pixels. Le fichier sera vérifié avant la création en pause de la carte ChatGPT." : "Importez, générez ou choisissez chaque fichier ici. Les aperçus sont larges, responsives et affichent le média complet sans le rogner."}</p>
        <div className={styles.studioGrid}>
          {nativeSettings ? <div className={styles.field}><span>{nativeSettings.channel === "pinterest" ? "Média attendu" : "Format prévu"} : {nativeWizardFormat(nativeSettings)}</span><small>{nativeSettings.channel === "tiktok" ? "Une vraie vidéo et une identité autorisée seront nécessaires dans TikTok Ads." : nativeSettings.channel === "pinterest" && nativeSettings.intendedPromotionType === "CATALOG" ? "Le catalogue et le groupe de produits seront sélectionnés dans Pinterest Ads ; aucun fichier isolé n’est requis ici." : nativeSettings.channel === "pinterest" ? "Le fichier et ses droits seront vérifiés avant toute publication." : nativeSettings.channel === "x" && nativeSettings.format === "text" ? "Aucun média n’est nécessaire pour le post texte." : "Choisissez un média cohérent ; ses droits et son format seront vérifiés avant toute publication."}</small></div> : googleSearchMedia ? <div className={styles.field}><span>Format publié : annonce Google Search textuelle</span><small>Ce connecteur ne joint pas d’image à Google Ads. Aucun visuel n’est requis ni généré automatiquement.</small></div> : channelId === "meta" ? <div className={styles.field}><span>Pack publicitaire Meta</span><small>iNr’ADS prépare un visuel Feed 4:5 et un visuel plein écran 9:16, puis associe chacun uniquement aux placements compatibles.</small></div> : channelId === "openai" ? <div className={styles.field}><span>Carte ChatGPT avec image carrée</span><small>Ajoutez une image nette et représentative de votre offre. Elle accompagne un titre, un texte court et votre lien.</small></div> : <label className={styles.field}>Média à utiliser<select value={draft.mediaStrategy} onChange={(event) => updateDraft({ mediaStrategy: event.target.value as AdsCampaignInput["mediaStrategy"] })}>{mediaStrategyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}
          {(nativeSettings === null || nativeMediaUpload) && !googleSearchMedia && channelId !== "meta" && channelId !== "openai" && <details className={styles.campaignExternalMedia}><summary>Utiliser un lien externe</summary><label className={styles.field}>Lien HTTPS du média<input type="url" value={draft.creativeUrl || draft.imageUrl} onChange={(event) => updateDraft({ imageUrl: event.target.value, creativeUrl: event.target.value })} placeholder={nativeMediaStrategy === "video" ? "https://votresite.fr/video.mp4" : "https://votresite.fr/media.jpg"} /></label></details>}
          {nativeMediaStrategy !== "search_text" && channelId !== "pinterest" && <label className={`${styles.field} ${styles.studioWide}`}>Consignes pour vos médias<VoiceTextarea value={draft.mediaBrief} onChange={(mediaBrief) => updateDraft({ mediaBrief })} maxLength={1000} purpose="instruction" contextLabel="Consignes pour le média" placeholder="Style, produit, scène, preuves à montrer, format souhaité…" /></label>}
        </div>
        {channelId === "meta" && <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}>
          <legend>Emplacements et formats Meta</legend>
          <p>Chaque emplacement utilise uniquement le visuel dont le cadrage lui correspond.</p>
          <div className={styles.studioControlOptions}>{META_PLACEMENT_OPTIONS.map((option) => {
            const selected = draft.metaPlacements.includes(option.value);
            // Unsupported legacy placements must remain removable, never selectable.
            const disabled = Boolean(option.disabled && !selected);
            return <label key={option.value} aria-disabled={disabled || undefined}>
              <input type="checkbox" disabled={disabled} checked={selected} onChange={(event) => updateDraft({ metaPlacements: event.target.checked ? Array.from(new Set([...draft.metaPlacements, option.value])) : draft.metaPlacements.filter((placement) => placement !== option.value) })} />
              {option.label} · {option.format}
            </label>;
          })}</div>
        </fieldset>}
        {channelId === "meta" && <MetaAdsMediaPack
          feedImageUrl={draft.metaCreativeAssets.feedImageUrl || null}
          storyReelImageUrl={draft.metaCreativeAssets.storyReelImageUrl || null}
          selectedPlacements={draft.metaPlacements}
          disabled={campaignMediaUploadBusy}
          onGenerate={(slot) => { setMetaMediaSlot(slot); setCampaignMediaStudioOpen(true); }}
          onImport={(slot) => { setMetaMediaSlot(slot); campaignImageInputRef.current?.click(); }}
          onChooseFromLibrary={(slot) => { setMetaMediaSlot(slot); setCampaignMediaLibraryOpen(true); }}
          onFormatStatusChange={handleMetaMediaFormatStatus}
          onRemove={(slot) => {
            setMetaMediaFormatStatus((current) => ({ ...current, [slot]: "empty" }));
            const metaCreativeAssets = {
              ...draft.metaCreativeAssets,
              [slot === "feed" ? "feedImageUrl" : "storyReelImageUrl"]: "",
            };
            updateDraft({
              metaCreativeAssets,
              imageUrl: metaCreativeAssets.feedImageUrl,
              creativeUrl: metaCreativeAssets.feedImageUrl,
            });
          }}
        />}
        {nativeSettings?.channel === "pinterest" && nativeSettings.intendedPromotionType === "CATALOG" && <div className={styles.campaignMediaSourceNotice} role="status">
          <span aria-hidden="true">▦</span>
          <div><strong>Source média : catalogue Pinterest</strong><p>Les images et vidéos proviendront du catalogue et du groupe de produits associés dans Pinterest Ads. Cette étape reste dédiée à la source créative, sans demander un fichier isolé.</p></div>
        </div>}
        {(nativeSettings === null || nativeMediaUpload) && channelId !== "meta" && <div className={styles.campaignMediaWorkspace}>
          <div className={styles.campaignMediaWorkspaceHeading}><div><span>MÉDIAS DE CAMPAGNE</span><strong>{googleSearchMedia ? attachedCampaignMediaUrl ? "Image conservée dans iNrCy" : "Aucun média à fournir pour Google Search" : attachedCampaignMediaUrl ? "Un média est associé à cette campagne" : "Choisissez ou créez le média adapté"}</strong></div>{attachedCampaignMediaUrl ? <span data-type={draft.creativeType || "image"}>{draft.creativeType === "video" ? "Vidéo" : "Image"} prête</span> : <span>{channelId === "openai" ? "Image obligatoire" : nativeMediaStrategy === "video" ? "Vidéo à fournir" : nativeMediaStrategy === "image" ? "Image à fournir" : "Optionnel selon le format"}</span>}</div>
          {!googleSearchMedia && <div className={styles.campaignMediaActions} data-three-actions={nativeMediaUpload || undefined}>
            {nativeMediaStrategy !== "video" && <button type="button" onClick={() => campaignImageInputRef.current?.click()} disabled={campaignMediaUploadBusy}><span aria-hidden="true">▧</span>{campaignMediaUploadBusy ? "Ajout en cours…" : "Ajouter une image"}</button>}
            {nativeMediaStrategy !== "image" && !googleSearchMedia && channelId !== "openai" && <button type="button" onClick={() => campaignVideoInputRef.current?.click()} disabled={campaignMediaUploadBusy}><span aria-hidden="true">▶</span>{campaignMediaUploadBusy ? "Ajout en cours…" : "Ajouter une vidéo"}</button>}
            <button type="button" className={styles.campaignMediaGenerate} onClick={() => setCampaignMediaStudioOpen(true)} disabled={campaignMediaUploadBusy}><span aria-hidden="true">✦</span> Générer</button>
            <button type="button" onClick={() => setCampaignMediaLibraryOpen(true)} disabled={campaignMediaUploadBusy}><span aria-hidden="true">▦</span> Médiathèque</button>
          </div>}
          {googleSearchMedia && <p className={styles.campaignMediaFormatHint}>La démo Google Search publie uniquement les titres et descriptions. Une image enregistrée auparavant reste visible dans iNrCy, mais elle n’est pas jointe à la campagne Google Ads. Aucun crédit média n’est utilisé pour les nouvelles campagnes Search.</p>}
          {attachedCampaignMediaUrl ? <CampaignMediaPreview key={`${draft.creativeType}:${attachedCampaignMediaUrl}`} url={attachedCampaignMediaUrl} type={draft.creativeType === "video" ? "video" : "image"} campaignName={draft.name || channelMeta.label} onChooseMedia={() => setCampaignMediaLibraryOpen(true)} /> : <div className={styles.campaignMediaPreview} data-empty="true" role="status"><div className={styles.campaignMediaPreviewFallback}><span aria-hidden="true">✦</span><strong>Aperçu complet du média</strong><p>Le fichier choisi ou généré apparaîtra ici en entier, sans recadrage.</p></div></div>}
          {attachedCampaignMediaUrl && <div className={styles.campaignMediaAttached}><span aria-hidden="true">✓</span><div><strong>{googleSearchMedia ? "Image conservée dans iNrCy" : "Média associé à la campagne"}</strong><small>{googleSearchMedia ? "Non jointe à la campagne Google Search lors de la création en pause." : channelId === "openai" ? "Image de votre médiathèque iNrCy ; le format et les droits seront vérifiés avant l’envoi." : `${draft.creativeType === "video" ? "Vidéo" : "Image"} stockée dans votre médiathèque iNrCy ou liée depuis votre site.`}</small></div><a href={attachedCampaignMediaUrl} target="_blank" rel="noreferrer">Voir ↗</a><button type="button" onClick={() => updateDraft({ creativeUrl: "", imageUrl: "" })}>Retirer</button></div>}
          {campaignMediaUploadError && <p className={styles.campaignMediaError} role="alert">{campaignMediaUploadError}</p>}
        </div>}
        {(nativeSettings === null || nativeMediaUpload) && <>
          <input ref={campaignImageInputRef} type="file" accept={channelId === "openai" ? "image/jpeg,image/png" : "image/*"} hidden onChange={(event) => void handleCampaignMediaUpload(event, "image")} />
          <input ref={campaignVideoInputRef} type="file" accept="video/*" hidden onChange={(event) => void handleCampaignMediaUpload(event, "video")} />
        </>}
        {channelId === "meta" && campaignMediaUploadError && <p className={styles.campaignMediaError} role="alert">{campaignMediaUploadError}</p>}
      </section>}

      <section hidden={step !== deliveryStep} data-channel={channelId} className={`${styles.card} ${styles.studioCard} ${styles.studioDeliveryCard}`}>
        <StudioStepHeader number={deliveryStep + 1} label={channelId === "pinterest" ? "DESTINATION & MESURE" : "DIFFUSION"} title={channelId === "pinterest" ? "Où mène votre épingle." : "Où envoyer et comment mesurer."} mobileTitle={channelId === "pinterest" ? "Lien & mesure" : "Votre diffusion"} channel={channelMeta.label} />
        <p className={styles.intro}><span className={styles.studioTitleLong}>Préparez le parcours après le clic : une destination claire, l’action attendue et les paramètres utiles. Rien n’est encore diffusé.</span><span className={styles.studioTitleShort}>Aucune diffusion avant votre validation.</span></p>
        <div className={styles.studioGrid}>
          {destinationFieldVisible && <label className={`${styles.field} ${styles.studioWide}`}>{channelId === "pinterest" ? "URL de destination du Pin" : "Lien de redirection"}<input type="url" value={draft.destinationUrl} onChange={(event) => updateDraft({ destinationUrl: event.target.value })} placeholder="https://votresite.fr/offre" /><small>Une page HTTPS claire et cohérente avec votre annonce.</small></label>}
          {destinationReview.required && <div className={`${styles.studioDestinationReview} ${styles.studioWide}`}>
            <span>{destinationReview.confirmed ? "✓ Destination validée" : "Vérifiez où votre annonce enverra les visiteurs."}</span>
            {destinationReview.valid && <a href={draft.destinationUrl.trim()} target="_blank" rel="noopener noreferrer">Ouvrir le lien ↗</a>}
            {!destinationReview.valid && <small role="alert">Indiquez un lien HTTPS valide avant de continuer.</small>}
          </div>}
          {nativeSettings?.channel === "tiktok" && <>
            <label className={styles.field}>Destination TikTok<select value={nativeSettings.destinationKind} onChange={(event) => updateNativeSettings({ ...nativeSettings, destinationKind: event.target.value as TikTokWizardSettings["destinationKind"] })}><option value="website">Site web</option>{nativeSettings.objectiveType === "LEAD_GENERATION" && <option value="instant_form">Formulaire intégré</option>}{["REACH", "VIDEO_VIEWS", "ENGAGEMENT"].includes(nativeSettings.objectiveType) && <option value="profile">Profil TikTok</option>}</select></label>
            <div className={styles.field}><span>Optimisation : {nativeBriefTerm(nativeSettings.optimizationIntent)}</span><small>Pour cet objectif, le Pixel ou formulaire devra être confirmé dans TikTok Ads si une conversion est prévue.</small></div>
            <label className={styles.field}>Emplacements envisagés<select value={nativeSettings.placementIntent} onChange={(event) => updateNativeSettings({ ...nativeSettings, placementIntent: event.target.value as TikTokWizardSettings["placementIntent"] })}><option value="tiktok_only">TikTok uniquement</option><option value="automatic">Placements automatiques</option></select><small>La disponibilité sera vérifiée dans le compte annonceur.</small></label>
          </>}
          {nativeSettings?.channel === "pinterest" && (nativeSettings.objectiveType === "SALES" || nativeSettings.objectiveType === "LEADS") && <label className={styles.field}>Événement Pinterest<select value={nativeSettings.conversionEvent || ""} onChange={(event) => updateNativeSettings({ ...nativeSettings, conversionEvent: event.target.value as Exclude<PinterestWizardSettings["conversionEvent"], null> })}>{(nativeSettings.objectiveType === "SALES" ? ["CHECKOUT", "ADD_TO_CART"] : ["LEAD", "SIGNUP"]).map((value) => <option key={value} value={value}>{nativeBriefTerm(value)}</option>)}</select><small>La balise et l’événement réels seront vérifiés dans Pinterest Ads.</small></label>}
          {nativeSettings && <label className={styles.field}>Action souhaitée<select value={draft.conversionGoal} onChange={(event) => updateDraft({ conversionGoal: event.target.value as AdsCampaignInput["conversionGoal"] })}>{CONVERSION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}
          {!nativeSettings && (channelId === "openai" ? <div className={styles.field}><span>Destination après le clic</span><strong>Votre site web</strong><small>Pour mesurer les visites, ajoutez vos paramètres UTM directement au lien HTTPS ci-dessus.</small></div> : <label className={styles.field}>Lieu de conversion<select value={draft.conversionLocation} onChange={(event) => updateDraft({ conversionLocation: event.target.value as AdsCampaignInput["conversionLocation"] })}>{CONVERSION_LOCATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label} — {option.detail}</option>)}</select></label>)}
          {channelId !== "openai" && <label className={styles.field}>Balises de suivi <small>Optionnel</small><input value={draft.trackingParameters} maxLength={500} onChange={(event) => updateDraft({ trackingParameters: event.target.value })} placeholder={channelId === "pinterest" ? "utm_source=pinterest&utm_campaign=inspiration" : "utm_source=google&utm_campaign=devis"} /></label>}
          {nativeSettings?.channel === "pinterest" && nativeSettings.conversionEvent && <aside className={`${styles.studioKeywordGuidance} ${styles.studioWide}`}><strong>Événement prévu : {nativeBriefTerm(nativeSettings.conversionEvent)}</strong><p>Vérifiez la balise de conversion Pinterest dans votre compte avant de publier cet objectif.</p></aside>}
          {nativeSettings?.channel === "linkedin" && <aside className={`${styles.studioKeywordGuidance} ${styles.studioWide}`}><strong>{nativeSettings.objectiveType === "LEAD_GENERATION" ? "Formulaire LinkedIn à préparer" : nativeSettings.objectiveType === "WEBSITE_CONVERSION" ? "Mesure du site à confirmer" : "Destination de l’annonce"}</strong><p>{nativeSettings.objectiveType === "LEAD_GENERATION" ? "Le formulaire de prospects doit appartenir à l’organisation et sera choisi dans le compte LinkedIn Ads." : nativeSettings.objectiveType === "WEBSITE_CONVERSION" ? "La conversion et l’Insight Tag devront être vérifiés dans le compte LinkedIn Ads." : "Le lien et l’action voulue restent une intention tant qu’aucune création publicitaire n’a été vérifiée."}</p></aside>}
          {nativeSettings?.channel === "x" && <aside className={`${styles.studioKeywordGuidance} ${styles.studioWide}`}><strong>Mesure X à confirmer</strong><p>{nativeSettings.objective === "website_conversions" ? "Une source de conversion X valide devra être reliée au compte publicitaire." : "Les résultats réels ne seront visibles qu’après création et validation dans X Ads."}</p></aside>}
          {channelId === "google" && <label className={`${styles.check} ${styles.studioWide}`}><input type="checkbox" checked={draft.urlExpansion} onChange={(event) => updateDraft({ urlExpansion: event.target.checked })} />Autoriser l’utilisation de pages pertinentes de mon site lorsque le format de campagne le permet.</label>}
          {channelId === "google" && <label className={`${styles.field} ${styles.studioWide}`}>Pages à exclure <small>Une URL HTTPS par ligne, optionnel</small><textarea rows={3} value={editableList(draft.urlExclusions)} onChange={(event) => updateDraft({ urlExclusions: parseEditableList(event.target.value.split("\n")) })} placeholder="https://votresite.fr/mentions-legales" /></label>}
          {channelId === "google" && <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}><legend>Réseaux Google</legend><p>Choisissez les surfaces envisagées. Le budget reste défini à l’étape suivante.</p><div className={styles.studioControlOptions}><label><input type="checkbox" checked={draft.googleSearchPartners} onChange={(event) => updateDraft({ googleSearchPartners: event.target.checked })} />Partenaires du Réseau de Recherche</label><label><input type="checkbox" checked={draft.googleDisplayExpansion} onChange={(event) => updateDraft({ googleDisplayExpansion: event.target.checked })} />Extension Display lorsque pertinente</label></div></fieldset>}
        </div>
      </section>

      <section hidden={step !== budgetStep} data-channel={channelId} className={`${styles.card} ${styles.studioCard} ${styles.studioBudgetCard}`}>
        <StudioStepHeader number={budgetStep + 1} label={channelId === "pinterest" ? "BUDGET PINTEREST" : "BUDGET"} title="Votre investissement, en clair." mobileTitle="Votre budget" channel={channelMeta.label} />
        <p className={styles.intro}><span className={styles.studioTitleLong}>Choisissez le rythme d’investissement et la durée. Les repères ci-dessous estiment une enveloppe de dépense : ils ne promettent ni clics, ni prospects, ni ventes.</span><span className={styles.studioTitleShort}>Estimation indicative, sans promesse de résultat.</span></p>
        <div className={styles.studioGrid}>
          <label className={styles.field}>Budget quotidien moyen (€)<input type="number" min={channelId === "openai" ? 15 : 5} max="500" step="0.01" value={draft.dailyBudgetEuros} onChange={(event) => updateDraft({ dailyBudgetEuros: Number(event.target.value) })} />{channelId === "openai" && <small>Ce parcours commence à 15 € ; votre compte peut exiger davantage. Moyenne sur 7 jours : un jour peut atteindre 2 fois ce montant.</small>}</label>
          <label className={styles.field}>Date de fin<input type="date" value={draft.endDate} onChange={(event) => updateDraft({ endDate: event.target.value })} /></label>
          {nativeSettings?.channel === "pinterest" && (nativeSettings.objectiveType === "AWARENESS" || nativeSettings.objectiveType === "CONSIDERATION") && <label className={`${styles.field} ${styles.studioWide}`}>{nativeSettings.objectiveType === "AWARENESS" ? "Enchère CPM maximale Pinterest (€)" : "Enchère par clic maximale Pinterest (€)"}<input type="number" min="0.01" max={draft.dailyBudgetEuros} step="0.01" value={draft.pinterestBidEuros ?? 1} onChange={(event) => updateDraft({ pinterestBidEuros: Number(event.target.value) })} /><small>Cette limite explicite est transmise à Pinterest ; elle ne peut pas dépasser votre budget quotidien.</small></label>}
          {nativeSettings?.channel === "linkedin" && <label className={`${styles.field} ${styles.studioWide}`}>Enchère CPC maximale LinkedIn (€)
            <input type="number" min={linkedInPreflight?.selected?.pricing?.bidMin || 0.01} max={Math.min(linkedInPreflight?.selected?.pricing?.bidMax || draft.dailyBudgetEuros, draft.dailyBudgetEuros)} step="0.01" value={draft.linkedinBidEuros ?? ""} onChange={(event) => updateDraft({ linkedinBidEuros: event.target.value ? Number(event.target.value) : undefined })} placeholder="Ex. 2,50" />
            <small>{linkedInPreflight?.selected?.pricing
              ? `Plage vérifiée par LinkedIn : ${linkedInPreflight.selected.pricing.bidMin.toLocaleString("fr-FR")} € à ${linkedInPreflight.selected.pricing.bidMax.toLocaleString("fr-FR")} € · budget quotidien minimum ${linkedInPreflight.selected.pricing.dailyBudgetMin.toLocaleString("fr-FR")} €.`
              : "Saisissez l’enchère CPC souhaitée. Le préflight LinkedIn vérifiera la plage autorisée avant toute création."}</small>
          </label>}
          {channelId === "openai" && <label className={styles.field}>Enchère maximale {draft.objective === "awareness" ? "par impression" : "par clic"} (€)<input type="number" min="0.01" max={draft.dailyBudgetEuros} step="0.01" value={draft.openaiBidEuros ?? ""} onChange={(event) => updateDraft({ openaiBidEuros: event.target.value ? Number(event.target.value) : undefined })} placeholder="Ex. 1,50" /><small>Valeur explicite, à contrôler avec le budget de votre compte ChatGPT Ads.</small></label>}
          {!nativeSettings && channelId !== "openai" && <label className={`${styles.field} ${styles.studioWide}`}>Stratégie de diffusion<select value={draft.bidStrategy} onChange={(event) => updateDraft({ bidStrategy: event.target.value as AdsCampaignInput["bidStrategy"] })}>{BID_STRATEGY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}
        </div>
        <div className={styles.studioBudgetForecast} aria-label="Repères budgétaires">
          <div className={styles.studioBudgetForecastCard}><span>Budget quotidien</span><strong>{Number(draft.dailyBudgetEuros || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}</strong><small>moyenne planifiée</small></div>
          <div className={styles.studioBudgetForecastCard}><span>Durée prévue</span><strong>{estimatedCampaignDays ? `${estimatedCampaignDays} j` : "—"}</strong><small>jusqu’à la date de fin</small></div>
          <div className={styles.studioBudgetForecastCard}><span>Enveloppe estimée</span><strong>{Number.isFinite(estimate) ? estimate.toLocaleString("fr-FR", { style: "currency", currency: "EUR" }) : "—"}</strong><small>budget × durée</small></div>
          {nativeSettings ? <div className={styles.studioBudgetForecastCard}><span>Statut au lancement</span><strong>Active / Paused</strong><small>choisi dans la validation finale</small></div> : channelId === "openai" ? <div className={styles.studioBudgetForecastCard}><span>Création sur ChatGPT Ads</span><strong>En pause</strong><small>aucune diffusion immédiate</small></div> : <div className={styles.studioBudgetForecastCard}><span>Optimisation</span><strong>{BID_STRATEGY_OPTIONS.find((option) => option.value === draft.bidStrategy)?.label || "À définir"}</strong><small>pilotée par la plateforme</small></div>}
        </div>
        {channelId === "openai" && <p className={styles.studioBudgetMobileSummary}>Enveloppe indicative : {Number.isFinite(estimate) ? estimate.toLocaleString("fr-FR", { style: "currency", currency: "EUR" }) : "—"} sur {estimatedCampaignDays ? `${estimatedCampaignDays} jours` : "la durée choisie"}. Moyenne sur 7 jours, jusqu’à 2× certains jours. Création en pause, sans dépense immédiate.</p>}
        <div className={styles.studioBudgetPanel}><div><span>À retenir</span><strong>Vous gardez la main.</strong></div><p>{channelId === "google" ? "Google Ads gère la facturation. Son budget quotidien est une moyenne : la dépense peut varier d’un jour à l’autre." : channelId === "meta" ? "Meta gère la facturation. Cette projection est indicative ; vérifiez les règles de dépense de votre compte avant toute diffusion." : channelId === "pinterest" ? "Pinterest gère directement la facturation. Le choix Active ou Paused sera confirmé dans la modale finale avant toute création." : channelId === "openai" ? "ChatGPT Ads mesure le budget quotidien sur 7 jours ; une journée peut atteindre 2 fois la moyenne. La carte est créée en pause, sans diffusion, puis soumise aux contrôles du compte et du contenu dans Ads Manager." : "Aucune dépense n’est engagée tant que ce canal reste en préparation."}</p></div>
      </section>

      <section hidden={step !== validationStep} data-channel={channelId} className={`${styles.card} ${styles.studioCard} ${styles.studioValidationCard}`}>
        <StudioStepHeader number={validationStep + 1} label={channelId === "pinterest" ? "REVUE PINTEREST" : "VOTRE CONTRÔLE"} title={channelId === "pinterest" ? "Votre proposition Pinterest, prête à enregistrer." : "Votre campagne, vos décisions."} mobileTitle="Validation" channel={channelMeta.label} />
        <p className={styles.intro}><span className={styles.studioTitleLong}>{channelId === "pinterest" ? "Relisez l’objectif, l’audience, l’épingle, le format, la destination et le budget. Vous pourrez ensuite lancer la campagne sur Pinterest ou l’enregistrer en brouillon pour plus tard." : "Relisez cette proposition avant tout enregistrement. Une campagne ne peut être diffusée qu’après votre validation explicite et celle de la plateforme."}</span><span className={styles.studioTitleShort}>{channelId === "pinterest" ? "Lancez maintenant ou gardez le brouillon." : "Diffusion après votre accord et celui de la plateforme."}</span></p>
        <dl className={styles.studioReviewGrid}>
          <div><dt>Campagne</dt><dd>{draft.name || "À renseigner"}</dd><small>{nativeSettings ? `${nativeBriefTerm(nativeWizardObjective(nativeSettings))} · ${nativeWizardFormat(nativeSettings)}` : `${selectedCampaignType?.label || channelMeta.label} · ${OBJECTIVE_OPTIONS.find((option) => option.value === draft.objective)?.label}`}</small></div>
          <div><dt>Compte / canal</dt><dd>{channelMeta.label} · {isAdsProvider(channelId) ? associatedAccountName || "À configurer" : channelId === "openai" ? connectionSnapshots.openai.accountLabel || connectionSnapshots.openai.accountId || "À connecter" : activeExternalStatus?.selectedAccountId ? activeExternalStatus.selectedAccountName || activeExternalStatus.selectedAccountId : "À associer"}</dd><small>{reviewAccountStatusLabel}</small></div>
          <div><dt>{channelId === "openai" ? "Objectif publicitaire" : "Objectif mesuré"}</dt><dd>{channelId === "openai" ? "Clics vers le site" : CONVERSION_OPTIONS.find((option) => option.value === draft.conversionGoal)?.label}</dd><small>{channelId === "openai" ? draft.targetLocations.length ? `${draft.targetLocations.slice(0, 2).join(" · ")}${draft.targetLocations.length > 2 ? ` +${draft.targetLocations.length - 2} zone(s)` : ""}` : "Zones à préciser" : draft.targetLocations.length ? `${draft.targetLocations.length} zone${draft.targetLocations.length > 1 ? "s" : ""} ciblée${draft.targetLocations.length > 1 ? "s" : ""}` : "Zones à préciser"}</small></div>
          <div><dt>Investissement</dt><dd>{draft.dailyBudgetEuros.toLocaleString("fr-FR")} € / jour</dd><small>{channelId === "openai" ? `Moyenne sur 7 jours · enchère ${draft.openaiBidEuros || "—"} € · fin ${draft.endDate || "à préciser"}` : `Fin prévue : ${draft.endDate || "à préciser"}`}</small></div>
          <div><dt>Redirection</dt><dd>{draft.destinationUrl || "À renseigner"}</dd><small>{channelId === "openai" ? "Lien HTTPS de la carte ChatGPT" : nativeSettings?.channel === "pinterest" && nativeSettings.targetingMode === "automatic" ? "Découverte automatique du Pin" : draft.keywords.length ? `${draft.keywords.length} signaux / mots-clés préparés` : "Mots-clés ou audiences à compléter"}</small></div>
          <div><dt>{channelId === "openai" ? "Carte ChatGPT · image carrée" : "Médias & message"}</dt><dd>{channelId === "openai" ? draft.headlines[0] || "Titre à renseigner" : googleSearchMedia ? "Annonces textuelles" : channelId === "meta" ? "Pack images publicitaires Meta" : MEDIA_STRATEGY_OPTIONS.find((option) => option.value === draft.mediaStrategy)?.label}</dd><small>{channelId === "openai" ? draft.primaryText || "Texte à renseigner" : channelId === "meta" ? `${metaFeedReviewLabel} · ${metaStoryReelReviewLabel}` : googleSearchMedia && draft.imageUrl ? "Image conservée dans iNrCy, non jointe à Google" : draft.callToAction || "Appel à l’action à définir"}</small></div>
          {channelId !== "openai" && <div><dt>Conversion &amp; suivi</dt><dd>{CONVERSION_LOCATION_OPTIONS.find((option) => option.value === draft.conversionLocation)?.label}</dd><small>{draft.trackingParameters || "Aucune balise de suivi ajoutée"}</small></div>}
          {channelId !== "openai" && <div><dt>Diffusion avancée</dt><dd>{channelId === "meta" ? (draft.metaPlacements.length ? `${draft.metaPlacements.length} placement${draft.metaPlacements.length > 1 ? "s" : ""}` : "Placements à choisir") : channelId === "google" ? "Langue déduite des annonces et du site" : nativeSettings?.channel === "linkedin" ? nativeBriefTerm(nativeSettings.targetingFacet) : nativeSettings?.channel === "tiktok" ? nativeBriefTerm(nativeSettings.placementIntent) : nativeSettings?.channel === "pinterest" ? pinterestTargetingLabel(nativeSettings.targetingMode) : nativeSettings?.channel === "x" ? nativeBriefTerm(nativeSettings.targetingMode) : "Préparation complète"}</dd><small>{channelId === "meta" ? (draft.metaAudienceExpansion ? "Expansion d’audience autorisée" : "Audience strictement contrôlée") : channelId === "google" ? (draft.googleSearchPartners ? "Partenaires de recherche inclus" : "Réseau Google principal") : nativeSettings?.channel === "tiktok" ? `Destination : ${nativeBriefTerm(nativeSettings.destinationKind)} · Optimisation : ${nativeBriefTerm(nativeSettings.optimizationIntent)}` : nativeSettings?.channel === "pinterest" && nativeSettings.conversionEvent ? `Événement : ${nativeBriefTerm(nativeSettings.conversionEvent)}` : nativeSettings?.channel === "pinterest" && nativeSettings.targetingMode === "automatic" ? "Pinterest optimise automatiquement l’audience du groupe d’annonces" : "Choix à vérifier sur la plateforme"}</small></div>}
          {channelId === "linkedin" && <>
            <div><dt>Groupe LinkedIn</dt><dd>{selectedLinkedInCampaignGroup?.name || (draft.linkedinCampaignGroupId ? `Groupe ${draft.linkedinCampaignGroupId}` : "À sélectionner")}</dd><small>{selectedLinkedInCampaignGroup ? `${selectedLinkedInCampaignGroup.status} · ID ${selectedLinkedInCampaignGroup.id}` : draft.linkedinCampaignGroupId ? `ID ${draft.linkedinCampaignGroupId} · à revérifier` : "Sélection explicite obligatoire"}</small></div>
            <div><dt>Page LinkedIn</dt><dd>{selectedLinkedInOrganization ? linkedInOrganizationLabel(selectedLinkedInOrganization) : draft.linkedinOrganizationUrn || "À sélectionner"}</dd><small>{linkedInGeoTargets.length ? `${linkedInGeoTargets.length} zone${linkedInGeoTargets.length > 1 ? "s" : ""} LinkedIn exacte${linkedInGeoTargets.length > 1 ? "s" : ""}` : "Zone LinkedIn exacte à sélectionner"}</small></div>
            <div><dt>Enchère LinkedIn</dt><dd>{draft.linkedinBidEuros ? `${draft.linkedinBidEuros.toLocaleString("fr-FR")} € CPC max.` : "À renseigner"}</dd><small>Montant et audience revérifiés juste avant la création</small></div>
            <div><dt>Conformité LinkedIn</dt><dd>{linkedInComplianceReady ? "Déclarations confirmées" : "Confirmation requise"}</dd><small>NOT_POLITICAL · ciblage non discriminatoire</small></div>
          </>}
        </dl>
        {draft.channelDraft?.channel === channelId && <details className={styles.studioNativeBrief}>
          <summary><strong>Brief {channelMeta.label} préparé par iNrCy</strong><span>{nativeBriefDetails(draft.channelDraft).objective} · {nativeBriefDetails(draft.channelDraft).format}</span></summary>
          <dl>
            <div><dt>Audience</dt><dd>{draft.channelDraft.audience.audienceBrief}</dd><small>{draft.channelDraft.audience.locationBriefs.join(" · ")}</small></div>
            <div><dt>Message proposé</dt><dd>{nativeBriefCopy(draft.channelDraft).message}</dd><small>{nativeBriefCopy(draft.channelDraft).headline}</small></div>
            <div><dt>Direction média</dt><dd>{nativeBriefCopy(draft.channelDraft).media}</dd></div>
            <div><dt>Réglages du canal</dt><dd>{nativeBriefDetails(draft.channelDraft).settings}</dd><small>{nativeBriefDetails(draft.channelDraft).complement}</small></div>
          </dl>
          <p>Ce brief prépare votre campagne. Les comptes, médias et ressources publicitaires doivent encore être confirmés sur la plateforme ; aucune diffusion n’est lancée ici.</p>
        </details>}
        {channelId !== "openai" && (channelId === "linkedin" && !linkedInSelectionsReady ? <p className={styles.studioReadiness}><strong>Complétez les ressources LinkedIn vérifiées</strong>Sélectionnez explicitement le groupe de campagnes, la Page organisation, au moins une zone LinkedIn exacte et une enchère CPC. Le brouillon reste enregistrable sans aucun appel de création.</p> : channelId === "linkedin" && !linkedInComplianceReady ? <p className={styles.studioReadiness}><strong>Validez les deux déclarations LinkedIn</strong>La déclaration NOT_POLITICAL et l’avis de ciblage non discriminatoire doivent rester visibles et confirmés avant toute création distante.</p> : !isAdsDraftAccountChannel(channelId) ? <p className={styles.draftOnlyWarning}><strong>Brouillon uniquement pour le moment</strong>{`Vous pouvez connecter et associer votre compte ${channelMeta.label}, puis enregistrer cette campagne. La publication sur ce canal n’est pas encore activée : aucune diffusion ni dépense média ne sera déclenchée.`}{draft.creationMode === "inrcy" && !draft.channelDraft && <span className={styles.studioNativeBriefMissing}>Vos modifications ont désynchronisé le brief spécifique de {channelMeta.label}. Le brouillon simple reste disponible. <button type="button" disabled={busy !== null} onClick={() => { if (!window.confirm("Relancer l’analyse iNrCy ? La nouvelle proposition remplacera vos réglages actuels et pourra générer un nouveau média.")) return; setStep(analysisStep); void generateCampaignPlan(); }}>Recréer le brief IA</button></span>}</p> : !liveFormatAvailable ? <p className={styles.studioReadiness}><strong>Préparation complète, publication de ce choix à venir</strong>{channelId === "google" ? "iNr’ADS prépare tous les réglages nécessaires à ce type de campagne. La publication automatisée disponible aujourd’hui est la campagne Réseau de recherche." : channelId === "meta" ? "iNr’ADS prépare ce format et conserve votre brouillon. La publication automatisée actuellement disponible concerne la campagne Trafic Meta." : channelId === "linkedin" ? "Le lancement LinkedIn disponible utilise l’objectif Visites du site, une publication sponsorisée et une image unique. Vos autres choix restent entièrement enregistrables en brouillon." : nativeSettings?.channel === "pinterest" && nativeSettings.targetingMode !== "automatic" ? "Ce ciblage manuel reste dans le brouillon jusqu’à la sélection vérifiée de ses intérêts, mots-clés ou audiences. Choisissez Ciblage automatique pour un lancement réel sans identifiant inventé." : "iNr’ADS peut lancer une épingle sponsorisée image, avec le ciblage automatique, pour un objectif Notoriété ou Considération. Les vidéos, carrousels, catalogues et objectifs de conversion restent entièrement enregistrables en brouillon."}</p> : !livePublisherConversionReady ? <p className={styles.studioReadiness}><strong>Conservez ce parcours dans votre brouillon</strong>Le connecteur de diffusion disponible aujourd’hui envoie les prospects vers votre site web. Votre choix de conversion est bien sauvegardé et sera repris dès que son connecteur dédié sera activé.</p> : !metaLiveObjectiveSupported ? <p className={styles.studioReadiness}><strong>Choisissez l’objectif Trafic vers le site web</strong>Le premier connecteur Meta Ads disponible construit une campagne orientée trafic qualifié vers votre site. Les objectifs Leads, Ventes et Notoriété restent enregistrés dans votre brouillon pour leurs connecteurs dédiés.</p> : !metaLiveGoalSupported ? <p className={styles.studioReadiness}><strong>Mesurez une visite de page clé</strong>Le connecteur Trafic Meta disponible mesure actuellement les visites de votre site web. Vos autres objectifs de conversion restent sauvegardés dans votre brouillon.</p> : !metaLivePlacementsSupported ? <p className={styles.studioReadiness}><strong>Choisissez un placement Meta compatible</strong>Les fils Facebook/Instagram, Stories et Reels sont disponibles. Messenger sera ajouté ultérieurement.</p> : !metaLiveCreativeSupported ? <p className={styles.studioReadiness}><strong>Choisissez le format image</strong>Le connecteur Trafic Meta disponible utilise actuellement des images publicitaires. Vos autres formats restent enregistrés dans le brouillon.</p> : !metaLiveCtaSupported ? <p className={styles.studioReadiness}><strong>Utilisez l’appel à l’action « En savoir plus »</strong>Le premier connecteur Trafic Meta utilise cet appel à l’action pour conserver exactement le message que vous avez validé.</p> : !livePublisherMediaReady ? <p className={styles.studioReadiness}><strong>{knownMetaMediaInvalid ? "Corrigez le format du pack média" : "Complétez le média avant la création"}</strong>{channelId === "meta" ? knownMetaMediaInvalid ? "Au moins une image ne respecte pas les dimensions ou le ratio de son emplacement. Remplacez-la par une image conforme." : "Ajoutez le visuel Feed 4:5 et/ou Story/Reel 9:16 demandé par les placements sélectionnés. Chaque image restera associée à son format." : channelId === "linkedin" ? "Ajoutez une image unique, visible en entier dans l’étape Médias, avant le lancement LinkedIn." : "Ajoutez une image disponible dans la médiathèque iNrCy avant le lancement Pinterest."}</p> : <>
          {connectorConfigurationIssue && <p className={styles.studioReadiness}><strong>Réglage à adapter avant publication</strong>{connectorConfigurationIssue}{nativeSettings?.channel === "pinterest" && nativeSettings.targetingMode === "automatic" && draft.keywords.length > 0 && <button type="button" className={styles.secondaryButton} onClick={clearPinterestManualSignals}>Retirer les signaux manuels</button>}{openaiHiddenSettingsNeedReset && <button type="button" className={styles.secondaryButton} onClick={() => updateDraft({ conversionGoal: "website_visit", conversionLocation: "website", bidStrategy: "manual_review", trackingParameters: "", callToAction: "", keywords: [], negativeKeywords: [] })}>Adapter les anciens réglages ChatGPT</button>}</p>}
        </>)}
        {channelId === "openai" && <p className={styles.studioReadiness}><strong>{channelPublishingEnabled && livePublisherMediaReady && liveFormatAvailable && livePublisherConversionReady && !connectorConfigurationIssue ? "Création réelle en pause" : "À compléter pour ChatGPT Ads"}</strong>{!livePublisherMediaReady ? "Ajoutez une image JPG ou PNG carrée à l’étape Médias. " : ""}{connectorConfigurationIssue ? `${connectorConfigurationIssue} ` : ""}{!channelPublishingEnabled ? `${openaiReadinessMessage || "La clé Advertiser API et la revue du compte sont requises."} ` : ""}{!liveFormatAvailable || !livePublisherConversionReady ? "Ce format ou cet objectif n’est pas encore pris en charge. " : ""}{channelPublishingEnabled && livePublisherMediaReady && liveFormatAvailable && livePublisherConversionReady && !connectorConfigurationIssue ? "La carte sera créée en pause et soumise aux contrôles d’Ads Manager." : "Le brouillon reste enregistrable."}{openaiHiddenSettingsNeedReset && <button type="button" className={styles.secondaryButton} onClick={() => updateDraft({ conversionGoal: "website_visit", conversionLocation: "website", bidStrategy: "manual_review", trackingParameters: "", callToAction: "", keywords: [], negativeKeywords: [] })}>Adapter les anciens réglages ChatGPT</button>}</p>}
        <div className={styles.studioFinalActions} data-channel={channelId}>
          {channelId === "meta" && livePublishingEnabled && <label className={`${styles.check} ${styles.studioRequiredCheck}`}><input type="checkbox" checked={draft.noSpecialCategoryConfirmed} onChange={(event) => updateDraft({ noSpecialCategoryConfirmed: event.target.checked })} /><span><strong>Obligatoire avant création sur Meta</strong>Je confirme que cette annonce ne concerne aucune catégorie spéciale Meta (crédit, emploi, logement ou enjeux sociaux/politiques).</span></label>}
          {channelId === "google" && googlePublishingEnabled && <label className={`${styles.check} ${styles.studioRequiredCheck}`}><input type="checkbox" checked={draft.notEuPoliticalConfirmed} onChange={(event) => updateDraft({ notEuPoliticalConfirmed: event.target.checked })} /><span><strong>Obligatoire avant création sur Google Ads</strong>Je certifie que cette campagne ne contient pas de publicité politique ciblant l’Union européenne.</span></label>}
          {channelId === "linkedin" && <>
            <label className={`${styles.check} ${styles.studioRequiredCheck}`} data-linkedin-political-confirmation="true"><input type="checkbox" checked={draft.linkedinPoliticalIntentConfirmed === true} onChange={(event) => updateDraft({ linkedinPoliticalIntentConfirmed: event.target.checked })} /><span><strong>Déclaration politique LinkedIn obligatoire</strong>Je confirme qu’il ne s’agit pas de publicité politique. Aucune annonce de cette campagne ne constitue une publicité politique au regard du droit des pays ciblés, notamment du droit de l’Union européenne pour les publicités ciblant l’UE. Je respecte les politiques LinkedIn et les exigences réglementaires applicables. La campagne sera déclarée <b>NOT_POLITICAL</b>.</span></label>
            <label className={`${styles.check} ${styles.studioRequiredCheck}`} data-linkedin-targeting-notice="true"><input type="checkbox" checked={draft.linkedinTargetingNoticeAcknowledged === true} onChange={(event) => updateDraft({ linkedinTargetingNoticeAcknowledged: event.target.checked })} /><span><strong>Avis LinkedIn contre la discrimination</strong>Je reconnais que les outils publicitaires LinkedIn ne doivent pas être utilisés pour discriminer selon des caractéristiques personnelles telles que le genre, l’âge, l’origine, la race ou l’appartenance ethnique. <a href="https://www.linkedin.com/legal/ads-policy" target="_blank" rel="noreferrer">Consulter les règles LinkedIn ↗</a></span></label>
          </>}
          <button type="button" className={styles.primaryButton} disabled={busy !== null || (channelId === "openai" && (!channelPublishingEnabled || !livePublisherMediaReady || !liveFormatAvailable || !livePublisherConversionReady || Boolean(connectorConfigurationIssue))) || (channelId === "linkedin" && (!linkedInSelectionsReady || !linkedInComplianceReady || !linkedInLiveFormatSupported || !livePublisherConversionReady || !livePublisherMediaReady))} onClick={() => void openLaunchDialog()}>{busy === "demo" ? demoDialog ? "Création en cours…" : "Vérification du compte…" : channelId === "openai" ? "Créer en pause sur ChatGPT Ads" : "Lancer la campagne"} <span aria-hidden="true">↗</span></button>
          <button type="button" className={styles.secondaryButton} disabled={busy !== null || (!dirty && Boolean(savedId))} onClick={() => void saveDraft()}>{busy === "save" ? "Enregistrement…" : !dirty && savedId ? "Brouillon enregistré" : "Enregistrer en brouillon"}</button>
        </div>
      </section>
      {creationPath !== "choice" && <div className={styles.wizardNavigation}>
        <button type="button" className={styles.back} disabled={step === 0 || busy === "plan"} onClick={() => { if (creationPath === "inrcy" && step === analysisStep) { stopPlanProgress(); setCreationPath("choice"); setAnalysisSetupOpen(true); setStep(0); return; } setStep((current) => current - 1); }}>← Précédent</button>
        <span>{step + 1} / {stepNames.length}</span>
        {step < lastStep ? <div className={styles.wizardNextGroup}>
          {step === mediaStep && channelId === "meta" && !livePublisherMediaReady && <div className={styles.wizardMediaRequirement} role="status">
            <strong>Pack média obligatoire</strong>
            <span>{knownMetaMediaInvalid ? "Remplacez le visuel non conforme avant de continuer." : "Ajoutez chaque format demandé par les placements sélectionnés."}</span>
          </div>}
          {step === deliveryStep && destinationReview.required && <label className={styles.wizardRequiredCheck}>
            <input type="checkbox" checked={destinationReview.confirmed} disabled={!destinationReview.valid} onChange={(event) => setConfirmedDestinationUrl(event.target.checked ? draft.destinationUrl.trim() : "")} />
            <span><strong>Validation obligatoire</strong>Je confirme ce lien</span>
          </label>}
          <button type="button" className={`${styles.headerCta} ${analysisProposalReady ? styles.studioProposalReadyCta : ""}`} disabled={busy === "plan" || (creationPath === "inrcy" && step === analysisStep && planProgress !== 100) || (step === mediaStep && channelId === "meta" && !livePublisherMediaReady) || (step === deliveryStep && !destinationReview.canContinue)} onClick={() => setStep((current) => current + 1)}>{creationPath === "inrcy" && step === analysisStep ? planProgress === 100 ? channelId === "pinterest" ? "Voir ma proposition Pinterest →" : "Contrôler ma proposition →" : "Proposition en cours…" : "Suivant →"}</button>
        </div> : <button type="button" className={styles.back} onClick={() => void confirmCampaignExit()}>Revenir au cockpit</button>}
      </div>}
      </div>
      </SettingsDrawer>

    {demoDialog && <AdsCampaignDemoDialog
      mode={demoDialog.mode}
      details={demoDialog.details}
      busy={busy === "demo"}
      publicationPhase={publicationPhase}
      launchStatus={demoDialog.launchStatus}
      activeEnabled={demoDialog.channelId === "linkedin"
        ? Boolean(linkedInPublishingEnabled && linkedInPreflight?.account?.canServeCampaigns
          && selectedLinkedInCampaignGroup?.status === "ACTIVE")
        : demoDialog.channelId === "openai" ? false : demoDialog.channelId === "google" ? googlePublishingEnabled : demoDialog.channelId === "pinterest" ? pinterestPublishingEnabled : livePublishingEnabled}
      pausedEnabled={demoDialog.channelId === "linkedin"
        ? Boolean(linkedInPublishingEnabled && linkedInPreflight?.account?.canManageCampaigns)
        : demoDialog.channelId === "openai" ? openaiPausedPublishingEnabled && openaiAccountReady : demoDialog.channelId === "google" ? googlePublishingEnabled : demoDialog.channelId === "pinterest" ? pinterestPublishingEnabled : livePublishingEnabled}
      declarationLabel={demoDialog.launchStatus === "active"
        ? `Je valide le compte, la campagne et la facturation directe par ${demoDialog.details.channelLabel}, et je confirme le lancement en statut Active.`
        : `Je valide le compte et la création de cette campagne sur ${demoDialog.details.channelLabel} en statut Paused, sans diffusion.`}
      declarationChecked={confirmedSpend}
      onDeclarationChange={setConfirmedSpend}
      onLaunchStatusChange={(launchStatus) => {
        setConfirmedSpend(false);
        setDemoDialog((current) => current ? { ...current, launchStatus } : current);
      }}
      onCancel={() => setDemoDialog(null)}
      onConfirm={() => void confirmCampaignLaunch()}
      onReturnHome={() => {
        setNotice("");
        closeCampaignCreation();
        requestAnimationFrame(() => launchButtonRef.current?.focus());
      }}
    />}

    </div>
    <AdsConnectionSettings
      isOpen={configuring && isAdsProvider(channelId)}
      provider={provider}
      previous={{ name: previousConnectionChannel.label, onSelect: () => openChannelConfiguration(previousConnectionChannel.id) }}
      next={{ name: nextConnectionChannel.label, onSelect: () => openChannelConfiguration(nextConnectionChannel.id) }}
      onClose={() => { setConfiguring(false); setNotice(""); }}
      connected={connected}
      connectionStatus={connectionStatus}
      connectionAccount={connectionAccount}
      loading={loadingAccounts}
      error={notice}
      configAction={configAction}
      accounts={accounts}
      pages={pages}
      selectedAccountId={draft.adAccountId}
      selectedPageId={draft.pageId}
      configuredAccountId={configuredAccountId}
      configuredAccountLabel={configuredAccountLabel}
      configuredPageId={configuredPageId}
      configuredAccountAvailable={connectionSnapshots[provider].accountAvailable}
      configuredPageAvailable={connectionSnapshots[provider].pageAvailable}
      metaNeedsInstagramIdentity={metaNeedsInstagramIdentity}
      onSelectAccount={(id) => updateDraft({ adAccountId: id, accountCurrency: "EUR" })}
      onSelectPage={(id) => updateDraft({ pageId: id })}
      onRefreshAccounts={() => setAccountsRefreshRevisions((current) => ({
        ...current,
        [provider]: current[provider] + 1,
      }))}
      onSaveAccount={() => void saveAccountSelection()}
      onClearAccount={() => void clearSavedSelection("account")}
      onSavePage={() => void savePageSelection()}
      onClearPage={() => void clearSavedSelection("identity")}
      onDisconnect={() => void disconnectAdsConnection()}
    />
    <ExternalAdsConnectionSettings
      isOpen={externalConfiguring && isExternalChannel(channelId)}
      channel={externalSettingsChannel}
      previous={{ name: previousConnectionChannel.label, onSelect: () => openChannelConfiguration(previousConnectionChannel.id) }}
      next={{ name: nextConnectionChannel.label, onSelect: () => openChannelConfiguration(nextConnectionChannel.id) }}
      onClose={() => { setExternalConfiguring(false); setExternalError(""); }}
      status={externalStatuses[externalSettingsChannel]}
      accounts={externalAccounts}
      accountChoice={externalAccountChoice}
      accountsLoading={externalAccountsLoading}
      accountsLoaded={externalAccountsCache.current[externalSettingsChannel].loaded}
      accountsLoadFailed={externalAccountsLoadFailed}
      action={externalAction}
      error={externalError}
      onSelectAccount={(id) => {
        externalAccountsCache.current[externalSettingsChannel].choice = id;
        setExternalAccountChoice(id);
      }}
      onRefreshStatus={() => void refreshExternalStatus(externalSettingsChannel)}
      onRefreshAccounts={() => void loadExternalAccounts(externalSettingsChannel, externalStatuses[externalSettingsChannel].selectedAccountId, true)}
      onAssociateAccount={() => void associateExternalAccount()}
      onDisconnect={() => void disconnectExternalChannel()}
    />
    <OpenaiAdsConnectionSettings
      isOpen={openaiConfiguring && channelId === "openai"}
      previous={{ name: previousConnectionChannel.label, onSelect: () => openChannelConfiguration(previousConnectionChannel.id) }}
      next={{ name: nextConnectionChannel.label, onSelect: () => openChannelConfiguration(nextConnectionChannel.id) }}
      onClose={() => { setOpenaiConfiguring(false); void refreshOpenaiStatus(); }}
      onConnectionChange={() => void refreshOpenaiStatus()}
      initialConnection={connectionSnapshots.openai}
    />
    {creating && autoMediaPlan && (
      <AdsCampaignAutoMediaGenerator
        key={`${autoMediaPlan.campaignType}-${autoMediaPlan.name}-${autoMediaPlan.mediaBrief}`}
        provider={channelId}
        plan={autoMediaPlan}
        onProgress={(progress) => {
          setAutoMediaState("generating");
          setAutoMediaMessage(`iNr’Studio crée le média de la campagne · ${Math.min(99, Math.max(4, Math.round(progress)))} %`);
          planProgressTarget.current = Math.max(planProgressTarget.current, Math.min(99, 90 + Math.round(progress / 10)));
        }}
        onComplete={(result) => {
          if (!result.item.signed_url) {
            setAutoMediaState("error");
            setAutoMediaMessage("La campagne est prête, mais le média généré ne peut pas encore être associé. Vous pourrez en ajouter un à l’étape Médias.");
          } else {
            applyCampaignMedia(result.item);
            setAutoMediaState("ready");
            setAutoMediaMessage("iNr’Studio a généré et associé le média de cette campagne. Vous pourrez le remplacer, l’éditer ou le retirer à tout moment.");
          }
          planProgressTarget.current = 100;
          setAutoMediaPlan(null);
          setBusy(null);
        }}
        onMetaPackComplete={(results, generationError) => {
          const feedImageUrl = String(results.feed?.item.signed_url || "").trim();
          const storyReelImageUrl = String(results.storyReel?.item.signed_url || "").trim();
          const needsFeed = autoMediaPlan.metaPlacements.some((placement) => placement === "facebook_feed" || placement === "instagram_feed");
          const needsStoryReel = autoMediaPlan.metaPlacements.some((placement) => placement === "stories" || placement === "reels");
          if (feedImageUrl || storyReelImageUrl) {
            setMetaMediaFormatStatus((current) => ({
              ...current,
              ...(feedImageUrl ? { feed: "checking" as const } : {}),
              ...(storyReelImageUrl ? { story_reel: "checking" as const } : {}),
            }));
            setDraft((current) => {
              const metaCreativeAssets = mergeMetaCreativeAssetUrls(current.metaCreativeAssets, {
                feedImageUrl,
                storyReelImageUrl,
              });
              return applyDraftEdit(current, {
                metaCreativeAssets,
                imageUrl: metaCreativeAssets.feedImageUrl,
                creativeUrl: metaCreativeAssets.feedImageUrl,
                creativeType: "image",
                mediaStrategy: "image",
              });
            });
            setDirty(true);
            setConfirmedSpend(false);
          }
          if (generationError || (needsFeed && !feedImageUrl) || (needsStoryReel && !storyReelImageUrl)) {
            setAutoMediaState("error");
            setAutoMediaMessage(`La campagne est prête, mais le pack Meta est incomplet${generationError ? ` : ${generationError}` : "."} ${feedImageUrl || storyReelImageUrl ? "Le visuel déjà créé reste associé à la campagne. " : ""}Complétez le format manquant à l’étape Médias.`);
          } else {
            setAutoMediaState("ready");
            setAutoMediaMessage(`iNr’Studio a généré le pack publicitaire Meta${needsFeed && needsStoryReel ? " : Feed 4:5 et Story/Reel 9:16" : needsFeed ? " Feed 4:5" : " Story/Reel 9:16"}. Chaque visuel est associé uniquement à ses placements.`);
          }
          planProgressTarget.current = 100;
          setAutoMediaPlan(null);
          setBusy(null);
        }}
        onSkip={(reason) => {
          setAutoMediaState("skipped");
          setAutoMediaMessage(reason);
          planProgressTarget.current = 100;
          setAutoMediaPlan(null);
          setBusy(null);
        }}
        onError={(message) => {
          setAutoMediaState("error");
          setAutoMediaMessage(`La campagne est préparée, mais iNr’Studio n’a pas pu créer le média : ${message} Vous pourrez en ajouter un à l’étape Médias.`);
          planProgressTarget.current = 100;
          setAutoMediaPlan(null);
          setBusy(null);
        }}
      />
    )}
    <MediaLibraryPickerModal
      open={campaignMediaLibraryOpen}
      title={channelId === "meta"
        ? `Choisir l’image ${metaMediaSlot === "story_reel" ? "Story/Reel 9:16" : "Feed 4:5"}`
        : "Ajouter un média à la campagne"}
      subtitle={channelId === "meta"
        ? "Choisissez un visuel publicitaire adapté au format sélectionné. L’autre format conserve sa propre image."
        : channelId === "openai"
          ? "Choisissez un JPG ou PNG carré de votre médiathèque iNrCy. Une image valide est obligatoire pour la carte ChatGPT."
        : "Choisissez une image ou une vidéo déjà disponible dans votre médiathèque iNrCy. Elle sera immédiatement associée à cette campagne."}
      accept={googleSearchMedia || channelId === "meta" || channelId === "openai" ? "image" : "all"}
      maxImageBytes={channelId === "openai" ? OPENAI_ADS_MAX_IMAGE_BYTES : undefined}
      multiple={false}
      maxSelection={1}
      confirmLabel="Ajouter à la campagne"
      onClose={() => setCampaignMediaLibraryOpen(false)}
      onConfirm={(items) => {
        const item = items[0];
        if (item) applyCampaignMedia(item, metaMediaSlot);
      }}
    />
    <MediaGeneratorModal
      open={campaignMediaStudioOpen}
      embedded
      source="studio"
      origin="ads"
      initialTab="generate"
      initialMediaType={googleSearchMedia || channelId === "meta" || channelId === "openai" ? "image" : draft.mediaStrategy === "video" || draft.creativeType === "video" ? "video" : "image"}
      imageOnly={googleSearchMedia || channelId === "meta" || channelId === "openai"}
      freeOnly={googleSearchMedia || channelId === "meta" || channelId === "openai"}
      initialFreePrompt={googleSearchMedia
        ? googleSearchImageSubjectPrompt(draft)
        : channelId === "meta"
          ? [draft.mediaBrief, draft.offer && `Offre : ${draft.offer}`, draft.primaryText && `Message : ${draft.primaryText}`].filter(Boolean).join(". ").slice(0, 900)
          : channelId === "openai"
            ? chatgptAdsImageSubjectPrompt(draft)
          : ""}
      requiredFreePromptSuffix={googleSearchMedia
        ? GOOGLE_SEARCH_IMAGE_REQUIREMENTS
        : channelId === "meta" && metaMediaSlot === "story_reel"
          ? META_ADS_STORY_REEL_IMAGE_REQUIREMENTS
          : channelId === "meta" ? META_ADS_FEED_IMAGE_REQUIREMENTS
            : channelId === "openai" ? CHATGPT_ADS_IMAGE_REQUIREMENTS : ""}
      fixedFreeFormat={googleSearchMedia || channelId === "openai" ? "square" : channelId === "meta" ? metaMediaSlot === "story_reel" ? "story" : "portrait" : undefined}
      publicationBrief={[draft.mediaBrief, draft.offer, draft.primaryText, draft.callToAction].filter(Boolean).join(". ").slice(0, 1_800)}
      acceptMode="insert"
      handoffOriginLabel="iNr’ADS"
      onClose={() => setCampaignMediaStudioOpen(false)}
      onAccepted={handleGeneratedCampaignMedia}
    />
  </main>;
}
