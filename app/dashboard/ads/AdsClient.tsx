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
import LocalMediaUploadChoice from "@/app/dashboard/_components/LocalMediaUploadChoice";
import MediaLibraryPickerModal, {
  type MediaLibraryPickerItem,
} from "@/app/dashboard/_components/MediaLibraryPickerModal";
import type { MediaGenerationResult } from "@/app/dashboard/_hooks/useMediaGeneration";
import { uploadFileToMediaLibrary } from "@/lib/mediaLibraryUploadClient";
import PreparedAdsNativeControls, { type PreparedNativeReadiness } from "./PreparedAdsNativeControls";
import XAdsLocationPicker from "./XAdsLocationPicker";
import { createReviewedPausedCampaign, preparedXCopyWithDestination, PREPARED_TIKTOK_CTA_LABELS } from "@/lib/adsPreparedNativeClient";
import { xAdsResourcesConsentKey, type XAdsResources } from "@/lib/adsXResources";
import { TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT } from "@/lib/adsTikTokResources";
import {
  adsAccountCanBeAssociated,
  defaultAdsCampaignType,
  isAdsDraftAccountChannel,
  isAdsProvider,
  normalizeLinkedInGeoTargets,
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
import { matchPinterestTargetLanguages, type PinterestGeographyOption } from "@/lib/adsPinterestLocations";
import { selectGoogleTargetLocation, type GoogleLocationOption } from "@/lib/adsGoogleLocations";
import { metaPlacementsNeedInstagramIdentity } from "@/lib/adsMetaPlacement";
import {
  adsMediaStrategyAfterAttachment,
  assessMetaCreativeAssetReadiness,
  CHATGPT_ADS_MAX_IMAGE_BYTES,
  CHATGPT_ADS_IMAGE_REQUIREMENTS,
  CHATGPT_ADS_MIN_IMAGE_SIDE_PX,
  chatgptAdsImageSubjectPrompt,
  GOOGLE_SEARCH_IMAGE_REQUIREMENTS,
  googleSearchImageSubjectPrompt,
  mergeMetaCreativeAssetUrls,
  META_ADS_FEED_IMAGE_REQUIREMENTS,
  META_ADS_STORY_REEL_IMAGE_REQUIREMENTS,
} from "@/lib/adsCampaignMediaPolicy";
import { isPossiblyTruncatedLinkedInSignal, presentAdsCampaignRationale, type AdsCampaignPlan } from "@/lib/adsCampaignPlan";
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
import {
  adsDraftHasKeywordsStep,
  adsDraftHasMediaStep,
  adsDraftStepKeys,
  adsDraftValidationStep,
  type AdsDraftStepKey,
} from "@/lib/adsDraftNavigation";
import { adsDestinationReviewState } from "@/lib/adsDestination";
import type { AdsPublicationPhase } from "@/lib/adsPublicationProgress";
import { adsIncompleteLaunchMessage, adsIncompleteLaunchSteps } from "@/lib/adsLaunchReadiness";
import { buildLinkedInGeoQueries, linkedInGeoQueryKey } from "@/lib/adsLinkedInGeoQueries";
import { linkedInAdsAutomaticPreflightKey, linkedInAdsContextualGeoDefaults, linkedInAdsLaunchBlockerMessage, linkedInAdsLaunchBlockers, linkedInAdsLaunchPreflightKey, linkedInAdsVerifiedBidDefault } from "@/lib/adsLinkedInClientDefaults";
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
import { removeLinkedInBriefGeoTargets } from "@/lib/adsLinkedInGeoSelection";
import LinkedInAdsLocationPicker from "./LinkedInAdsLocationPicker";
import LinkedInAdsAudience from "./LinkedInAdsAudience";
import { LinkedInAdsBudget, LinkedInAdsCallToAction, LinkedInAdsDistribution, LinkedInAdsEffectiveSummary, LINKEDIN_CTA_LABELS } from "./LinkedInAdsDelivery";
import { defaultLinkedInDeliverySettings, LINKEDIN_IMAGE_OBJECTIVES, type LinkedInDeliverySettings } from "@/lib/adsLinkedInCampaignSettings";
import { linkedInCallToActionFromLabel, type LinkedInAudienceSuggestion } from "@/lib/adsLinkedInAudienceSuggestions";
import { defaultGoogleDeliverySettings, googleSearchLocalIssue, type GoogleDeliverySettings } from "@/lib/adsGoogleCampaignSettings";
import { googleAdsResourcesConsentKey, type GoogleAdsAccountResources } from "@/lib/adsGoogleResources";
import { GoogleAdsBidding, GoogleAdsGeography, GoogleAdsKeywords, GoogleAdsRSAFields, GoogleAdsBudget, GoogleAdsMeasurement, GoogleAdsEffectiveSummary } from "./GoogleAdsCampaignControls";
import { defaultPinterestDeliverySettings, pinterestNativeDelivery, type PinterestDeliverySettings } from "@/lib/adsPinterestCampaignSettings";
import { pinterestAdsResourcesConsentKey, resolvePinterestAdsGeographies, type PinterestAdsResources } from "@/lib/adsPinterestResources";
import { PinterestAdsBudget, PinterestAdsBidding, PinterestAdsDistribution, PinterestAdsEffectiveSummary, pinterestAdsBudgetLabel } from "./PinterestAdsCampaignControls";
import { defaultMetaDeliverySettings, metaNativeDelivery, META_CALL_TO_ACTIONS, META_CALL_TO_ACTION_LABELS, type MetaDeliverySettings } from "@/lib/adsMetaCampaignSettings";
import { metaAdsResourcesConsentKey, resolveMetaAdsLanguages, type MetaAdsResources } from "@/lib/adsMetaResources";
import { MetaAdsBudget, MetaAdsBidding, MetaAdsAudience, MetaAdsEffectiveSummary, metaAdsBudgetLabel, metaAdsCalendarLabels } from "./MetaAdsCampaignControls";
import MetaAdsLocationPicker from "./MetaAdsLocationPicker";
import TikTokAdsLocationPicker from "./TikTokAdsLocationPicker";
import { defaultOpenaiDeliverySettings, openaiNativeDelivery, type OpenaiDeliverySettings } from "@/lib/adsOpenaiCampaignSettings";
import { openaiAdsResourcesConsentKey, type OpenaiAdsResources } from "@/lib/adsOpenaiResources";
import { ChatGPTAdsBudget, ChatGPTAdsBidding, ChatGPTAdsDistribution, ChatGPTAdsGeography, ChatGPTAdsEffectiveSummary, openaiAdsBudgetLabel } from "./ChatGPTAdsCampaignControls";
import { defaultPreparedDeliverySettings, plannedNativeCalendar, type PreparedDeliverySettings } from "@/lib/adsPreparedCampaignSettings";
import { preparedAdsReviewIssues } from "@/lib/adsPreparedReview";
import { tikTokAdsResourcesConsentKey, type TikTokAdsResources } from "@/lib/adsTikTokResources";
import { PreparedAdsBudget, PreparedAdsBidding, PreparedAdsEffectiveSummary, preparedAdsBudgetLabel } from "./PreparedAdsCampaignControls";
import styles from "./ads.module.css";

type StoredCampaign = StoredAdsCampaign;

type AdsConfigAction = "disconnect" | "save-account" | "clear-account" | "save-page" | "clear-page" | null;
type CampaignCreationPath = "choice" | AdsCreationMode;
type CampaignBusyAction = "save" | "plan" | "publish" | "demo" | null;
type CampaignMediaUploadKind = "image" | "video";

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
      reject(new Error("Cette image ne peut pas être lue. Choisissez un JPG, PNG ou WebP valide."));
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
  supportedLocales?: Array<{ language: string; country: string }>;
  organizations?: LinkedInOrganizationOption[];
  geoSuggestions?: LinkedInGeoTargetOption[];
  geoResolutions?: Array<{ query: string; suggestions: LinkedInGeoTargetOption[]; autoSelectedUrn: string | null; status?: "ok" | "provider_rejected" }>;
  selected?: {
    campaignGroup?: LinkedInCampaignGroupOption | null;
    organization?: LinkedInOrganizationOption | null;
    verifiedGeoUrns?: string[];
    verifiedGeoTargets?: LinkedInGeoTargetOption[];
    pricing?: { currency: string; bidMin: number; bidMax: number; dailyBudgetMin: number; dailyBudgetDefault: number | null } | null;
    bidAmount?: number | null;
    audienceCount?: number | null;
  };
  blockers?: string[];
  error?: string;
};

function linkedInCampaignGroupIsCompatible(group: LinkedInCampaignGroupOption, objectiveType = "WEBSITE_VISIT"): boolean {
  return (!group.objectiveType || group.objectiveType === objectiveType)
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

// Every channel can be prepared here. Publication is enabled only for the
// deliberately supported connector paths and the readiness returned by each platform.
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
    ...(provider === "pinterest" ? { pinterestDeliverySettings: defaultPinterestDeliverySettings() } : {}),
    ...(provider === "meta" ? { metaDeliverySettings: defaultMetaDeliverySettings(), metaGeoTargets: [] } : {}),
    ...(provider === "openai" ? { openaiDeliverySettings: defaultOpenaiDeliverySettings() } : {}),
    ...(["x", "tiktok"].includes(provider) ? { preparedDeliverySettings: defaultPreparedDeliverySettings() } : {}),
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
    callToAction: provider === "openai" ? "" : provider === "meta" || provider === "tiktok" ? "En savoir plus" : "Demander un devis",
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
  "metaCreativeAssets", "metaDeliverySettings", "metaGeoTargets", "openaiDeliverySettings", "openaiBidEuros",
  "pinterestBidEuros", "pinterestDeliverySettings", "preparedDeliverySettings",
  "tiktokNativeSelections", "xNativeSelections",
  "linkedinCampaignGroupId", "linkedinOrganizationUrn", "linkedinGeoTargets", "linkedinBidEuros",
  "linkedinPoliticalIntentConfirmed", "linkedinTargetingNoticeAcknowledged", "linkedinDeliverySettings",
  "urlExpansion", "urlExclusions", "googleSearchPartners", "googleDisplayExpansion",
  "metaAudienceExpansion", "metaPlacements", "noSpecialCategoryConfirmed", "notEuPoliticalConfirmed",
]);

/** Never keep an AI channel brief if a professional changes its native strategy. */
function applyDraftEdit(current: AdsCampaignInput, next: Partial<AdsCampaignInput>): AdsCampaignInput {
  const accountChanged = next.adAccountId !== undefined && next.adAccountId !== current.adAccountId;
  const updated = { ...current, ...next,
    ...(accountChanged ? { tiktokNativeSelections: undefined, xNativeSelections: undefined } : {}) };
  if (!accountChanged && next.targetLocations && JSON.stringify(next.targetLocations) !== JSON.stringify(current.targetLocations)) {
    if (updated.tiktokNativeSelections && !Object.hasOwn(next, "tiktokNativeSelections")) updated.tiktokNativeSelections = { ...updated.tiktokNativeSelections, locationIds: [] };
    if (updated.xNativeSelections && !Object.hasOwn(next, "xNativeSelections")) updated.xNativeSelections = { ...updated.xNativeSelections, geoTargets: [] };
  }
  if (next.creativeUrl !== undefined && next.creativeUrl !== current.creativeUrl && updated.tiktokNativeSelections && !Object.hasOwn(next, "tiktokNativeSelections"))
    updated.tiktokNativeSelections = { ...updated.tiktokNativeSelections, thumbnailMediaId: null, isAiGenerated: null };

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
    budget: (brief.channel === "x" || brief.channel === "tiktok") && updated.preparedDeliverySettings
      ? { ...brief.budget, period: updated.preparedDeliverySettings.budget.type === "total" ? "lifetime" as const : "daily" as const,
          amount: updated.preparedDeliverySettings.budget.type === "total" ? updated.preparedDeliverySettings.budget.totalEuros || 0 : updated.dailyBudgetEuros }
      : changed.has("dailyBudgetEuros") ? { ...brief.budget, amount: updated.dailyBudgetEuros } : brief.budget,
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
  getTagStatus?: (value: string) => { label: string; verified: boolean; rejected?: boolean };
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

  useEffect(() => {
    const workspace = textareaRef.current?.closest(`.${styles.studioWorkspace}`);
    if (!workspace) return;
    let frame = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(resize);
    });
    observer.observe(workspace, { attributes: true, attributeFilter: ["data-compact", "data-short", "data-stage"] });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
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
function TagField({ className, label, helper, values, onChange, placeholder, note, wide = false, maxItems, maxItemLength, getTagStatus }: TagFieldProps) {
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
        {values.map((value, index) => {
          const status = getTagStatus?.(value);
          return (
          <button
            key={`${value}-${index}`}
            type="button"
            className={styles.tagChip}
            data-verified={status?.verified || undefined}
            data-rejected={status?.rejected || undefined}
            onClick={() => onChange(values.filter((_, valueIndex) => valueIndex !== index))}
            aria-label={`Retirer ${value}${status ? ` · ${status.label}` : ""}`}
            title={`${value}${status ? ` · ${status.label}` : ""} · Retirer`}
          >
            <span>{value}</span>{status && <small className={styles.tagChipStatus}>{status.label}</small>}<span aria-hidden="true">×</span>
          </button>
          );
        })}
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

function PinterestLocationSearch({ accountId, locations, onChange, catalog }: {
  catalog?: readonly PinterestGeographyOption[];
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
      if (catalog) {
        const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr-FR");
        const terms = normalize(query.trim()).split(/\s+/).filter(Boolean);
        setOptions(catalog.filter((option) => terms.every((term) => normalize(option.name + " " + option.id).includes(term)))
          .sort((left, right) => Number(left.kind === "country") - Number(right.kind === "country") || left.name.localeCompare(right.name, "fr"))
          .slice(0, 40));
        setState("ready");
        return;
      }
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
    <label htmlFor={inputId}>Rechercher une zone Pinterest</label>
    <p>Si votre ville n’est pas proposée, choisissez une zone adaptée et retirez la ville ci-dessus.</p>
    <div className={styles.pinterestLocationSearchActions}>
      <input id={inputId} value={query} maxLength={100} placeholder="Ex. Hauts-de-France, Bretagne, Belgique" disabled={!accountId} onChange={(event) => { requestRef.current += 1; setQuery(event.target.value); setPageIndex(0); setOptions([]); setState("idle"); setError(""); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} />
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

export default function AdsClient({ initialChannel, initialEditCampaignId, initialConnections, initialConnection, initialReason, livePublishingEnabled, googlePublishingEnabled, pinterestPublishingEnabled, pilotChannelsEnabled }: {
  initialChannel: AdsChannelId;
  initialEditCampaignId: string;
  initialConnections: AdsConnectionSnapshots;
  initialConnection: "connected" | "error" | null;
  initialReason: string;
  livePublishingEnabled: boolean;
  googlePublishingEnabled: boolean;
  pinterestPublishingEnabled: boolean;
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
  const [openaiLiveReady, setOpenaiLiveReady] = useState(false);
  const [openaiReadinessMessage, setOpenaiReadinessMessage] = useState("");
  const [openaiLiveReadinessMessage, setOpenaiLiveReadinessMessage] = useState("");
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
  const linkedInPreflightContext = useRef(0);
  const linkedInContextAccount = useRef("");
  const linkedInPreflightCache = useRef(new Map<string, LinkedInAdsPreflightResponse>());
  const linkedInGeoChoices = useRef<Record<string, string>>({});
  const linkedInGeoDismissedUrns = useRef(new Set<string>());
  const linkedInAutomaticLoadKey = useRef("");
  const linkedInResourcesLoader = useRef<(force?: boolean, geoQueryOverride?: string) => Promise<void>>(async () => undefined);
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
  const [preparedBudgetApprovalKey, setPreparedBudgetApprovalKey] = useState("");
  const [preparedContentApprovalKey, setPreparedContentApprovalKey] = useState("");
  const preparedLatestReview = useRef({ draftKey: "", budgetKey: "", contentKey: "", destination: "" });
  const [preparedNativeReadiness, setPreparedNativeReadiness] = useState<PreparedNativeReadiness>({ draftKey: "", check: null, error: "" });
  const [preparedXResources, setPreparedXResources] = useState<XAdsResources | null>(null);
  const [tikTokResources, setTikTokResources] = useState<TikTokAdsResources | null>(null);
  const [tikTokResourcesLoad, setTikTokResourcesLoad] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [tikTokResourcesError, setTikTokResourcesError] = useState("");
  const [tikTokResourcesRevision, setTikTokResourcesRevision] = useState(0);
  const linkedInLaunchConsent = useRef<{ key: string; status: AdsCampaignLaunchStatus; googleResourcesKey?: string; pinterestResourcesKey?: string; metaResourcesKey?: string; openaiResourcesKey?: string } | null>(null);
  const reviewedPlanRevision = useRef(0);
  const [googleResources, setGoogleResources] = useState<GoogleAdsAccountResources | null>(null);
  const [googleResourcesLoad, setGoogleResourcesLoad] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [googleResourcesError, setGoogleResourcesError] = useState("");
  const [googleResourcesRevision, setGoogleResourcesRevision] = useState(0);
  const [googleGeoState, setGoogleGeoState] = useState<{ key: string; status: "idle" | "loading" | "ready" | "error"; error: string }>({ key: "", status: "idle", error: "" });
  const [googleGeoRevision, setGoogleGeoRevision] = useState(0);
  const googleResolvedGeoKey = useRef("");
  const [pinterestResources, setPinterestResources] = useState<PinterestAdsResources | null>(null);
  const [pinterestResourcesLoad, setPinterestResourcesLoad] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [pinterestResourcesError, setPinterestResourcesError] = useState("");
  const [pinterestResourcesRevision, setPinterestResourcesRevision] = useState(0);
  const [metaResources, setMetaResources] = useState<MetaAdsResources | null>(null);
  const [metaResourcesLoad, setMetaResourcesLoad] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [metaResourcesError, setMetaResourcesError] = useState("");
  const [metaResourcesRevision, setMetaResourcesRevision] = useState(0);
  const [metaGeoState, setMetaGeoState] = useState<{ key: string; ready: boolean; error: string }>({ key: "", ready: false, error: "" });
  const [openaiResources, setOpenaiResources] = useState<OpenaiAdsResources | null>(null);
  const [openaiResourcesLoad, setOpenaiResourcesLoad] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [openaiResourcesError, setOpenaiResourcesError] = useState("");
  const [openaiResourcesRevision, setOpenaiResourcesRevision] = useState(0);
  const [openaiGeoQuery, setOpenaiGeoQuery] = useState("");
  const [confirmedDestinationUrl, setConfirmedDestinationUrl] = useState("");
  const [configuring, setConfiguring] = useState(initialConnection !== null && isAdsProvider(initialChannel));
  const [creating, setCreating] = useState(false);
  const [linkedInAudienceSuggestions, setLinkedInAudienceSuggestions] = useState<LinkedInAudienceSuggestion[]>([]);
  const [linkedInAudiencePending, setLinkedInAudiencePending] = useState(0);
  const linkedInDelivery = draft.linkedinDeliverySettings || defaultLinkedInDeliverySettings();
  function updateLinkedInDelivery(next: LinkedInDeliverySettings) { updateDraft({ linkedinDeliverySettings: next }); }
  useEffect(() => {
    const accountId = externalStatuses.linkedin.selectedAccountId;
    if (!creating || channelId !== "linkedin" || !accountId) return;
    if (linkedInContextAccount.current === accountId && draft.adAccountId === accountId) return;
    linkedInContextAccount.current = accountId;
    linkedInPreflightContext.current++;
    linkedInPreflightCache.current.clear();
    linkedInAutomaticLoadKey.current = "";
    setLinkedInPreflight(null); setLinkedInPreflightLoad("idle"); setLinkedInPreflightError("");
    setDemoDialog(null); setConfirmedSpend(false); linkedInLaunchConsent.current = null;
    if (draft.adAccountId !== accountId) {
      setDraft((current) => applyDraftEdit(current, { adAccountId: accountId,
        ...(current.adAccountId ? { linkedinCampaignGroupId: "", linkedinOrganizationUrn: "",
          linkedinDeliverySettings: { ...(current.linkedinDeliverySettings || defaultLinkedInDeliverySettings()), conversions: { conversionUrns: [] } } } : {}),
      }));
      setDirty(true);
    }
  }, [creating, channelId, externalStatuses.linkedin.selectedAccountId, draft.adAccountId]);
  const [step, setStep] = useState(0);
  const [reachedStepKeys, setReachedStepKeys] = useState<AdsDraftStepKey[]>(["project"]);
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
  const keywordStepName = channelId === "google" ? "Mots-clés" : channelId === "linkedin" ? "Format" : "Signaux";
  // Only genuinely text-only formats omit this workspace. Keep the same rule
  // for a fresh campaign, an AI proposal and a reopened draft.
  const hasMediaStep = adsDraftHasMediaStep(draft);
  const hasKeywordsStep = adsDraftHasKeywordsStep(draft);
  const mediaStepName = channelId === "linkedin" ? "Média LinkedIn" : "Médias";
  const automatedChannelStepNames = (analysis: boolean): string[] | null => {
    const prefix = ["Votre projet", ...(analysis ? ["Analyse iNrCy"] : []), "Campagne"];
    if (channelId === "x" || channelId === "tiktok") return [...prefix, "Budget et calendrier", "Zones géographiques", "Audience et placements", "Enchères et optimisation",
      ...(hasKeywordsStep ? ["Mots-clés X"] : []), "Format et annonce", ...(channelId === "tiktok" ? ["Identité TikTok"] : []),
      ...(hasMediaStep ? [channelId === "tiktok" ? "Vidéo" : "Média"] : []), "Destination et suivi", "Vérifier et valider"];
    if (channelId === "meta") return [...prefix, "Zones géographiques", "Audience", "Enchères", "Annonce", "Média", "Destination et suivi", "Budget et calendrier", "Vérifier et lancer"];
    if (channelId === "openai") return [...prefix, "Budget et calendrier", "Zones géographiques", "Audience et contexte", "Enchères", "Carte ChatGPT", "Média", "Destination et suivi", "Vérifier et lancer"];
    return null;
  };
  const manualStepNames = automatedChannelStepNames(false) ?? (channelId === "pinterest"
    ? ["Votre projet", "Campagne", "Budget et calendrier", "Zones géographiques", "Audience", "Enchères", "Format du Pin", ...(hasKeywordsStep ? ["Découverte Pinterest"] : []), "Épingle", "Média", "Destination et suivi", "Vérifier et lancer"]
    : ["Votre projet", "Fondations", ...(channelId === "google" ? ["Enchères", "Zones géographiques"] : channelId === "linkedin" ? ["Zones géographiques"] : []), "Ciblage", ...(hasKeywordsStep ? [keywordStepName] : []), "Créations", ...(hasMediaStep ? [mediaStepName] : []), "Diffusion", "Budget", "Validation"]);
  const inrcyStepNames = automatedChannelStepNames(true) ?? (channelId === "pinterest"
    ? ["Votre projet", "Analyse iNrCy", "Campagne", "Budget et calendrier", "Zones géographiques", "Audience", "Enchères", "Format du Pin", ...(hasKeywordsStep ? ["Découverte Pinterest"] : []), "Épingle", "Média", "Destination et suivi", "Vérifier et lancer"]
    : ["Votre projet", "Analyse iNrCy", "Fondations", ...(channelId === "google" ? ["Enchères", "Zones géographiques"] : channelId === "linkedin" ? ["Zones géographiques"] : []), "Ciblage", ...(hasKeywordsStep ? [keywordStepName] : []), "Créations", ...(hasMediaStep ? [mediaStepName] : []), "Diffusion", "Budget", "Validation"]);
  const linkedInStepLabels: Record<string, string> = { Fondations: "Campagne", Ciblage: "Audience", Créations: "Annonce", "Média LinkedIn": "Média", Diffusion: "Diffusion et suivi", Budget: "Budget et calendrier", Validation: "Vérifier et lancer" };
  const googleStepLabels: Record<string, string> = { Fondations: "Campagne", Ciblage: "Paramètres", Créations: "Annonce", Diffusion: "Destination et suivi", Budget: "Budget et calendrier", Validation: "Vérifier et lancer" };
  const channelStepLabels = channelId === "google" ? googleStepLabels : channelId === "linkedin" ? linkedInStepLabels : {};
  const stepNames = (creationPath === "inrcy" ? inrcyStepNames : manualStepNames).map((label) => channelStepLabels[label] || label);
  const displayedStepNames = creationPath === "choice" && analysisSetupOpen ? inrcyStepNames.map((label) => channelStepLabels[label] || label) : stepNames;
  const manualStepKeys = adsDraftStepKeys({ ...draft, creationMode: "manual" });
  const inrcyStepKeys = adsDraftStepKeys({ ...draft, creationMode: "inrcy" });
  const stepKeys = creationPath === "inrcy" ? inrcyStepKeys : manualStepKeys;
  const displayedStepKeys = creationPath === "choice" && analysisSetupOpen ? inrcyStepKeys : stepKeys;
  const lastStep = stepNames.length - 1;
  const foundationsStep = stepKeys.indexOf("foundations");
  const biddingStep = stepKeys.indexOf("bidding");
  const geographyStep = stepKeys.indexOf("geography");
  const targetingStep = stepKeys.indexOf("targeting");
  const keywordsStep = stepKeys.indexOf("keywords");
  const creativeStep = stepKeys.indexOf("creative");
  const pinterestFormatStep = stepKeys.indexOf("pinterest_format");
  const identityStep = stepKeys.indexOf("identity");
  const mediaStep = stepKeys.indexOf("media");
  const deliveryStep = stepKeys.indexOf("delivery");
  const budgetStep = stepKeys.indexOf("budget");
  const validationStep = stepKeys.indexOf("validation");
  const analysisStep = stepKeys.indexOf("analysis");

  function navigateToStep(nextStep: number) {
    const boundedStep = Math.max(0, Math.min(lastStep, nextStep));
    setStep(boundedStep);
    const currentKey = stepKeys[step];
    const reachedKey = stepKeys[boundedStep];
    const visitedKeys = [currentKey, reachedKey].filter((key): key is AdsDraftStepKey => Boolean(key));
    if (visitedKeys.length > 0) {
      setReachedStepKeys((current) => {
        const next = [...current];
        for (const key of visitedKeys) {
          if (!next.includes(key)) next.push(key);
        }
        return next;
      });
    }
  }

  useEffect(() => {
    const revision = planGenerationRevision.current;
    if (!creating || !["linkedin", "google", "pinterest", "meta", "openai", "x", "tiktok"].includes(channelId) || creationPath !== "inrcy"
      || step !== analysisStep || planProgress !== 100 || busy === "plan" || planError
      || revision === 0 || reviewedPlanRevision.current === revision) return;
    reviewedPlanRevision.current = revision;
    // Review the effective prepared draft after its media has finished. Every
    // optional detail page remains accessible without forcing a manual tour.
    setStep(adsDraftValidationStep(draft));
    setReachedStepKeys(adsDraftStepKeys(draft));
  }, [creating, channelId, creationPath, step, analysisStep, planProgress, busy, planError, draft]);

  const googleDelivery = draft.googleDeliverySettings || defaultGoogleDeliverySettings();
  const googleResourceAccountId = draft.adAccountId || configuredAccountId;
  const effectiveGoogleResources = googleResources?.selectedAccountId === googleResourceAccountId ? googleResources : null;
  useEffect(() => {
    if (!creating || channelId !== "google" || !googleResourceAccountId) return;
    const abort = new AbortController();
    setGoogleResources(null); setGoogleResourcesLoad("loading"); setGoogleResourcesError("");
    void fetch("/api/ads/google/resources", { cache: "no-store", signal: abort.signal }).then(readJson).then((value) => {
      if (abort.signal.aborted) return;
      const resources = value as GoogleAdsAccountResources;
      if (resources.selectedAccountId !== googleResourceAccountId) throw new Error("Le compte Google Ads a changé. Actualisez sa connexion avant de valider.");
      setGoogleResources(resources); setGoogleResourcesLoad("ready");
    }).catch((error) => {
      if (abort.signal.aborted) return;
      setGoogleResourcesLoad("error"); setGoogleResourcesError(error instanceof Error ? error.message : "Le compte Google Ads n’a pas pu être vérifié.");
    });
    return () => abort.abort();
  }, [creating, channelId, googleResourceAccountId, googleResourcesRevision]);

  const googleGeoKey = JSON.stringify({ accountId: googleResourceAccountId, locations: draft.targetLocations });
  const googleGeoReady = googleGeoState.key === googleGeoKey && googleGeoState.status === "ready";
  useEffect(() => {
    if (!creating || channelId !== "google" || draft.campaignType !== "search" || !googleResourceAccountId || !draft.targetLocations.length
      || googleResolvedGeoKey.current === googleGeoKey) return;
    const abort = new AbortController();
    const expectedLocations = JSON.stringify(draft.targetLocations);
    setGoogleGeoState({ key: googleGeoKey, status: "loading", error: "" });
    setConfirmedSpend(false); linkedInLaunchConsent.current = null;
    void fetch(`/api/ads/google/geography?locations=${encodeURIComponent(expectedLocations)}`, { cache: "no-store", signal: abort.signal }).then(readJson).then((result) => {
      if (abort.signal.aborted) return;
      const locations = Array.isArray(result.locations) ? result.locations as { resourceName: string; label: string; countryCode: string }[] : [];
      if (result.selectedAccountId !== googleResourceAccountId || !locations.length
        || locations.some((location) => !/^geoTargetConstants\/\d+$/.test(location.resourceName) || !location.label)) throw new Error("Google Ads n’a pas confirmé toutes les zones de cette campagne.");
      const labels = locations.map((location) => location.label);
      const resolvedKey = JSON.stringify({ accountId: googleResourceAccountId, locations: labels });
      googleResolvedGeoKey.current = resolvedKey;
      setGoogleGeoState({ key: resolvedKey, status: "ready", error: "" });
      if (JSON.stringify(labels) !== expectedLocations) {
        setDraft((current) => current.provider === "google"
          && (current.adAccountId || configuredAccountId) === googleResourceAccountId
          && JSON.stringify(current.targetLocations) === expectedLocations ? { ...current, targetLocations: labels } : current);
        setDirty(true);
      }
    }).catch((error) => {
      if (abort.signal.aborted) return;
      setGoogleGeoState({ key: googleGeoKey, status: "error", error: error instanceof Error ? error.message : "Les zones Google Ads n’ont pas pu être vérifiées." });
    });
    return () => abort.abort();
  }, [creating, channelId, draft.campaignType, googleResourceAccountId, googleGeoKey, googleGeoRevision, configuredAccountId]);

  const preparedDelivery = draft.preparedDeliverySettings || defaultPreparedDeliverySettings();
  const preparedOnlyChannel = channelId === "x" || channelId === "tiktok";
  const tikTokAccountId = externalStatuses.tiktok.selectedAccountId || draft.adAccountId;
  const effectiveTikTokResources = tikTokResources?.selectedAccountId === tikTokAccountId && tikTokResources.account.id === tikTokAccountId ? tikTokResources : null;
  const preparedTimeZone = channelId === "tiktok" ? effectiveTikTokResources?.account.timezone || "Europe/Paris" : preparedXResources?.account.timeZone || "Europe/Paris";
  const tikTokIdentityMessage = effectiveTikTokResources?.identities.length === 1
    ? `Identité autorisée disponible : ${effectiveTikTokResources.identities[0].displayName}. Son utilisation sera revérifiée avant la publication.`
    : effectiveTikTokResources?.identities.length
      ? `${effectiveTikTokResources.identities.length} identités autorisées disponibles. L’identité et le mode de publication seront confirmés lors du branchement de diffusion.`
      : tikTokResourcesLoad === "loading" ? "Vérification des identités TikTok en cours."
        : tikTokResourcesError || "Une identité publicitaire sera vérifiée après connexion de l’application API TikTok.";
  function updatePreparedDelivery(next: Partial<PreparedDeliverySettings>) { updateDraft({ preparedDeliverySettings: { ...preparedDelivery, ...next } }); }
  useEffect(() => {
    if (!creating || channelId !== "tiktok" || !externalStatuses.tiktok.selectedAccountId || !externalStatuses.tiktok.connected) {
      setTikTokResources(null); setTikTokResourcesLoad("idle"); setTikTokResourcesError(""); return;
    }
    const abort = new AbortController();
    const accountId = externalStatuses.tiktok.selectedAccountId;
    setTikTokResources(null); setTikTokResourcesLoad("loading"); setTikTokResourcesError("");
    setDraft((current) => current.provider === "tiktok" && current.adAccountId !== accountId ? applyDraftEdit(current, { adAccountId: accountId }) : current);
    void fetch(`/api/ads/tiktok/resources?accountId=${encodeURIComponent(accountId)}`, { cache: "no-store", signal: abort.signal }).then(readJson).then((value) => {
      if (abort.signal.aborted) return;
      const resources = value as TikTokAdsResources;
      if (resources.selectedAccountId !== accountId || resources.account?.id !== accountId || resources.publicationEnabled !== false) throw new Error("La connexion TikTok a changé. Revérifiez le compte.");
      setTikTokResources(resources); setTikTokResourcesLoad("ready");
    }).catch((error) => {
      if (abort.signal.aborted) return;
      setTikTokResourcesLoad("error"); setTikTokResourcesError(error instanceof Error ? error.message : "Les ressources TikTok ne sont pas encore accessibles.");
    });
    return () => abort.abort();
  }, [creating, channelId, externalStatuses.tiktok.selectedAccountId, externalStatuses.tiktok.connected, tikTokResourcesRevision]);

  const metaDelivery = draft.metaDeliverySettings || defaultMetaDeliverySettings();
  const metaResourceAccountId = configuredAccountId || draft.adAccountId;
  const effectiveMetaResources = metaResources?.selectedAccountId === metaResourceAccountId && metaResources.selectedPageId === configuredPageId ? metaResources : null;
  function updateMetaDelivery(next: Partial<MetaDeliverySettings>) {
    updateDraft({ metaDeliverySettings: { ...metaDelivery, ...next }, ...(next.callToAction ? { callToAction: META_CALL_TO_ACTION_LABELS[next.callToAction] } : {}) });
  }
  useEffect(() => {
    if (!creating || channelId !== "meta" || !configuredAccountId || !configuredPageId) return;
    if (draft.adAccountId === configuredAccountId && draft.pageId === configuredPageId) return;
    setConfirmedSpend(false); linkedInLaunchConsent.current = null;
    setDraft((current) => current.provider === "meta" ? { ...current, adAccountId: configuredAccountId, pageId: configuredPageId,
      ...(current.adAccountId && current.adAccountId !== configuredAccountId ? { metaGeoTargets: [] } : {}) } : current);
    setDirty(true);
  }, [creating, channelId, configuredAccountId, configuredPageId, draft.adAccountId, draft.pageId]);
  useEffect(() => {
    if (!creating || channelId !== "meta" || !metaResourceAccountId || !configuredPageId) return;
    const abort = new AbortController();
    setMetaResources(null); setMetaResourcesLoad("loading"); setMetaResourcesError("");
    setConfirmedSpend(false); linkedInLaunchConsent.current = null;
    void fetch("/api/ads/meta/resources", { cache: "no-store", signal: abort.signal }).then(readJson).then((value) => {
      if (abort.signal.aborted) return;
      const resources = value as MetaAdsResources;
      if (resources.selectedAccountId !== metaResourceAccountId || resources.selectedPageId !== configuredPageId || resources.account?.id !== metaResourceAccountId) throw new Error("Le compte ou la Page Meta a changé. Revérifiez la connexion avant de valider.");
      setMetaResources(resources); setMetaResourcesLoad("ready");
    }).catch((error) => {
      if (abort.signal.aborted) return;
      setMetaResourcesLoad("error"); setMetaResourcesError(error instanceof Error ? error.message : "Le compte Meta n’a pas pu être vérifié.");
    });
    return () => abort.abort();
  }, [creating, channelId, metaResourceAccountId, configuredPageId, metaResourcesRevision]);
  useEffect(() => {
    if (!creating || channelId !== "meta" || !effectiveMetaResources) return;
    try {
      const ids = resolveMetaAdsLanguages(effectiveMetaResources, draft.languages).map(String);
      if (JSON.stringify(ids) === JSON.stringify(draft.languages)) return;
      const expected = JSON.stringify(draft.languages);
      setDraft((current) => current.provider === "meta" && current.adAccountId === metaResourceAccountId && JSON.stringify(current.languages) === expected ? { ...current, languages: ids } : current);
      setConfirmedSpend(false); linkedInLaunchConsent.current = null; setDirty(true);
    } catch { /* An unavailable language stays visible and blocks publication. */ }
  }, [creating, channelId, effectiveMetaResources, metaResourceAccountId, draft.languages]);
  const metaGeoKey = JSON.stringify({ accountId: metaResourceAccountId, locations: draft.targetLocations });
  const metaGeoReady = draft.metaDeliverySettings ? metaGeoState.key === metaGeoKey && metaGeoState.ready : draft.targetLocations.length > 0;
  const metaResolvedLanguages = useMemo(() => {
    try { return { ids: effectiveMetaResources ? resolveMetaAdsLanguages(effectiveMetaResources, draft.languages) : [], error: effectiveMetaResources ? "" : "Vérification des langues Meta en cours." }; }
    catch (error) { return { ids: [], error: error instanceof Error ? error.message : "Choisissez une langue vérifiée par Meta." }; }
  }, [effectiveMetaResources, draft.languages]);
  const openaiDelivery = draft.openaiDeliverySettings || defaultOpenaiDeliverySettings();
  const openaiResourceAccountId = connectionSnapshots.openai.accountId || draft.adAccountId;
  const effectiveOpenaiResources = openaiResources?.selectedAccountId === openaiResourceAccountId ? openaiResources : null;
  function updateOpenaiDelivery(next: Partial<OpenaiDeliverySettings>) { updateDraft({ openaiDeliverySettings: { ...openaiDelivery, ...next } }); }
  useEffect(() => {
    if (!creating || channelId !== "openai" || !openaiResourceAccountId || draft.adAccountId === openaiResourceAccountId) return;
    setConfirmedSpend(false); linkedInLaunchConsent.current = null;
    setDraft((current) => current.provider === "openai" ? { ...current, adAccountId: openaiResourceAccountId } : current);
    setDirty(true);
  }, [creating, channelId, openaiResourceAccountId, draft.adAccountId]);
  const openaiLocationsKey = JSON.stringify(draft.targetLocations);
  useEffect(() => {
    if (!creating || channelId !== "openai" || !openaiResourceAccountId) return;
    const abort = new AbortController();
    setOpenaiResources(null); setOpenaiResourcesLoad("loading"); setOpenaiResourcesError("");
    setConfirmedSpend(false); linkedInLaunchConsent.current = null;
    const url = `/api/ads/openai/resources?accountId=${encodeURIComponent(openaiResourceAccountId)}&queries=${encodeURIComponent(JSON.stringify(JSON.parse(openaiLocationsKey)))}${openaiGeoQuery.trim().length >= 2 ? `&q=${encodeURIComponent(openaiGeoQuery.trim())}` : ""}`;
    void fetch(url, { cache: "no-store", signal: abort.signal }).then(readJson).then((value) => {
      if (abort.signal.aborted) return;
      const resources = value as OpenaiAdsResources;
      if (resources.selectedAccountId !== openaiResourceAccountId || resources.account?.id !== openaiResourceAccountId) throw new Error("Le compte ChatGPT Ads a changé. Revérifiez la connexion.");
      setOpenaiResources(resources); setOpenaiResourcesLoad("ready");
    }).catch((error) => {
      if (abort.signal.aborted) return;
      setOpenaiResourcesLoad("error"); setOpenaiResourcesError(error instanceof Error ? error.message : "Le compte et les zones ChatGPT Ads n’ont pas pu être vérifiés.");
    });
    return () => abort.abort();
    // The search text is sent only when the professional requests a search.
  }, [creating, channelId, openaiResourceAccountId, openaiLocationsKey, openaiResourcesRevision]);
  const openaiGeoReady = Boolean(effectiveOpenaiResources && draft.targetLocations.length && draft.targetLocations.every((label) => {
    const key = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
    return effectiveOpenaiResources.geographyOptions.some((option) => key(option.name) === key(label) || key(option.canonicalName) === key(label));
  }));

  function updateGoogleDelivery(next: Partial<GoogleDeliverySettings>) {
    updateDraft({ googleDeliverySettings: { ...googleDelivery, ...next } });
  }

  const pinterestObjective = draft.channelSettings?.channel === "pinterest" ? draft.channelSettings.objectiveType : "CONSIDERATION";
  const pinterestDelivery = draft.pinterestDeliverySettings || {
    ...defaultPinterestDeliverySettings(pinterestObjective),
    bidding: { strategy: "max_bid" as const, amountEuros: draft.pinterestBidEuros ?? 1 },
  };
  function updatePinterestDelivery(next: Partial<PinterestDeliverySettings>) {
    updateDraft({ pinterestDeliverySettings: { ...pinterestDelivery, ...next } });
  }
  useEffect(() => {
    const accountId = externalStatuses.pinterest.selectedAccountId;
    if (!creating || channelId !== "pinterest" || !accountId || draft.adAccountId === accountId) return;
    setConfirmedSpend(false); linkedInLaunchConsent.current = null;
    setDraft((current) => current.provider === "pinterest" ? { ...current, adAccountId: accountId } : current);
    setDirty(true);
  }, [creating, channelId, externalStatuses.pinterest.selectedAccountId, draft.adAccountId]);
  const pinterestResourceAccountId = externalStatuses.pinterest.selectedAccountId || draft.adAccountId;
  const effectivePinterestResources = pinterestResources?.selectedAccountId === pinterestResourceAccountId ? pinterestResources : null;
  useEffect(() => {
    if (!creating || channelId !== "pinterest" || !pinterestResourceAccountId) return;
    const abort = new AbortController();
    setPinterestResources(null); setPinterestResourcesLoad("loading"); setPinterestResourcesError("");
    setConfirmedSpend(false); linkedInLaunchConsent.current = null;
    void fetch("/api/ads/pinterest/resources", { cache: "no-store", signal: abort.signal }).then(readJson).then((value) => {
      if (abort.signal.aborted) return;
      const resources = value as PinterestAdsResources;
      if (resources.selectedAccountId !== pinterestResourceAccountId || resources.account?.id !== pinterestResourceAccountId) throw new Error("Le compte Pinterest Ads a changé. Actualisez sa connexion avant de valider.");
      setPinterestResources(resources); setPinterestResourcesLoad("ready");
    }).catch((error) => {
      if (abort.signal.aborted) return;
      setPinterestResourcesLoad("error"); setPinterestResourcesError(error instanceof Error ? error.message : "Le compte Pinterest Ads n’a pas pu être vérifié.");
    });
    return () => abort.abort();
  }, [creating, channelId, pinterestResourceAccountId, pinterestResourcesRevision]);
  const pinterestResolvedGeography = useMemo(() => {
    if (!effectivePinterestResources || pinterestResourcesLoad !== "ready") return { zones: [], error: pinterestResourcesError || "Vérification des zones et des langues Pinterest en cours." };
    try { return { zones: resolvePinterestAdsGeographies(effectivePinterestResources, draft.targetLocations), error: "" }; }
    catch (error) { return { zones: [], error: error instanceof Error ? error.message : "Les zones Pinterest n’ont pas pu être vérifiées." }; }
  }, [effectivePinterestResources, pinterestResourcesLoad, pinterestResourcesError, draft.targetLocations]);
  const pinterestGeoReady = pinterestResolvedGeography.zones.length > 0 && !pinterestResolvedGeography.error;
  const pinterestResolvedLanguages = useMemo(() => {
    if (!effectivePinterestResources) return { ids: [], error: "Vérification des langues Pinterest en cours." };
    try { return { ids: matchPinterestTargetLanguages(draft.languages, effectivePinterestResources.locales.map((locale) => ({ [locale.id]: locale.name }))), error: "" }; }
    catch (error) { return { ids: [], error: error instanceof Error ? error.message : "Vérifiez les langues Pinterest." }; }
  }, [effectivePinterestResources, draft.languages]);

  function resetStepProgress(nextStep: number, availableStepKeys: AdsDraftStepKey[] = stepKeys) {
    const boundedStep = Math.max(0, Math.min(availableStepKeys.length - 1, nextStep));
    setStep(boundedStep);
    setReachedStepKeys(availableStepKeys.slice(0, boundedStep + 1));
  }

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
  // Keep every configuration discoverable. Unreleased channels are read-only for pros.
  const accessibleChannels = CHANNEL_CATALOG;
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
        : channelId === "openai" ? openaiLiveReady || openaiAccountReady : livePublishingEnabled;
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
          ? "Compte annonceur à connecter · brouillon enregistrable"
          : channelId === "openai" ? "Ajoutez la clé Advertiser API du compte ChatGPT Ads"
          : "Associez un compte pour créer la démo en pause";

  const refreshOpenaiStatus = useCallback(async () => {
    try {
      const status = await readJson(await fetch("/api/ads/openai/status", { cache: "no-store" })) as {
        connected?: boolean; status?: ConnectionDisplayStatus; accountId?: string; accountName?: string;
        pausedCreationEnabled?: boolean; liveDeliveryEnabled?: boolean;
        readinessMessage?: string; liveReadinessMessage?: string;
      };
      const accountId = String(status.accountId || "");
      const connectionStatus: AdsConnectionSnapshot["status"] = status.status === "connected"
        ? "connected" : status.status === "needs_update" ? "needs_update" : "disconnected";
      setOpenaiAccountReady(status.connected === true && status.pausedCreationEnabled === true && Boolean(accountId));
      setOpenaiLiveReady(status.connected === true && status.liveDeliveryEnabled === true && Boolean(accountId));
      setOpenaiReadinessMessage(String(status.readinessMessage || ""));
      setOpenaiLiveReadinessMessage(String(status.liveReadinessMessage || status.readinessMessage || ""));
      setConnectionSnapshots((current) => ({ ...current, openai: {
        ...current.openai,
        status: connectionStatus,
        accountId,
        accountLabel: accountId ? String(status.accountName || accountId) : "",
      } }));
      if (status.connected === true && accountId) setDraft((current) => current.provider === "openai" && !current.adAccountId
        ? { ...current, adAccountId: accountId } : current);
    } catch {
      // Keep the durable account snapshot visible during a transient check.
      setOpenaiAccountReady(false);
      setOpenaiLiveReady(false);
    }
  }, []);

  useEffect(() => {
    if (pilotChannelsEnabled || isAdsPublicChannel("openai")) void refreshOpenaiStatus();
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
        const reason = params.get("reason");
        setExternalError(callbackChannel === "tiktok" && reason === "ads_access_missing"
          ? "Aucun compte annonceur TikTok Ads n’est accessible avec cette connexion. Terminez la création de votre compte dans TikTok Ads Manager, ou reconnectez-vous avec le compte qui gère vos publicités."
          : callbackChannel === "tiktok" && reason === "provider_response_invalid"
            ? "TikTok n’a pas renvoyé une liste de comptes valide. Réessayez plus tard."
            : reason || "La connexion n’a pas abouti. Réessayez.");
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
    if (!externalConfiguring || !isExternalChannel(channelId) || (!pilotChannelsEnabled && !isAdsPublicChannel(channelId))) return;
    if (!externalStatuses[channelId].connected) { setExternalAccountsLoading(false); return; }
    void loadExternalAccounts(channelId, externalStatuses[channelId].selectedAccountId);
    return () => { externalAccountsRequest.current += 1; };
  }, [externalConfiguring, channelId, pilotChannelsEnabled, externalStatuses.linkedin.connected, externalStatuses.linkedin.selectedAccountId, externalStatuses.pinterest.connected, externalStatuses.pinterest.selectedAccountId, externalStatuses.tiktok.connected, externalStatuses.tiktok.selectedAccountId, externalStatuses.x.connected, externalStatuses.x.selectedAccountId, loadExternalAccounts]);

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
    const nextIndex = ((index % CHANNEL_CATALOG.length) + CHANNEL_CATALOG.length) % CHANNEL_CATALOG.length;
    setChannelIndex(nextIndex);
    const next = CHANNEL_CATALOG[nextIndex].id;
    if (next === channelId) return;
    setLinkedInAudienceSuggestions([]); setLinkedInAudiencePending(0);
    linkedInPreflightContext.current++;
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
    setConfirmedSpend(false); linkedInLaunchConsent.current = null;
    setConfirmedDestinationUrl("");
    setNotice("");
  }

  function openChannelConfiguration(channel: AdsChannelId) {
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
    const locked = !pilotChannelsEnabled && !isAdsPublicChannel(channel);
    setExternalAccounts(locked ? [] : cached.accounts);
    setExternalAccountsLoadFailed(!locked && cached.failed);
    setExternalAccountChoice(locked ? "" : cached.choice || externalStatuses[channel].selectedAccountId);
    setExternalAccountsLoading(!locked && externalStatuses[channel].connected && !cached.loaded);
    setExternalConfiguring(true);
  }

  useEffect(() => {
    let active = true;
    if (!pilotChannelsEnabled && !isAdsPublicChannel(channelId)) {
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
  }, [accountsRefreshRevisions, applyProviderAccountsResult, channelId, pilotChannelsEnabled]);

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
    const locked = !pilotChannelsEnabled && !isAdsPublicChannel(next);
    setConnected(!locked && (cached?.connected ?? savedConnection.status === "connected"));
    setConnectionStatus(locked ? "disconnected" : cached?.connectionStatus || (savedConnection.status === "unknown" ? "disconnected" : savedConnection.status));
    setConnectionAccount(locked ? undefined : cached?.connectionAccount);
    setConfiguredAccountId(locked ? "" : String(cached?.selectedAccountId || savedConnection.accountId || ""));
    setConfiguredAccountLabel(locked ? "" : String(cached?.selectedAccountLabel || savedConnection.accountLabel || ""));
    setConfiguredPageId(locked ? "" : String(cached?.selectedPageId || savedConnection.pageId || ""));
    setConfigAction(null);
    setAccounts(locked ? [] : cached?.accounts || []);
    setPages(locked ? [] : cached?.pages || []);
    setLoadingAccounts(!locked && !cached);
    setSavedId(null);
    setDirty(true);
    setMetaMediaFormatStatus({ feed: "empty", story_reel: "empty" });
    setConfirmedSpend(false); linkedInLaunchConsent.current = null;
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
    setConfirmedSpend(false); linkedInLaunchConsent.current = null;
  }

  function confirmReviewedDeclaration(
    field: "notEuPoliticalConfirmed" | "linkedinPoliticalIntentConfirmed" | "linkedinTargetingNoticeAcknowledged" | "noSpecialCategoryConfirmed",
    checked: boolean,
  ) {
    if (busy !== null) return;
    const approved = linkedInLaunchConsent.current;
    // Confirmations are independent. Only these explicit declaration flags can
    // update an existing approval; edits to campaign settings still revoke it.
    if (confirmedSpend && approved?.key === JSON.stringify(draft)) {
      linkedInLaunchConsent.current = { ...approved, key: JSON.stringify({ ...draft, [field]: checked }) };
    } else {
      setConfirmedSpend(false); linkedInLaunchConsent.current = null;
    }
    setDraft((current) => ({ ...current, [field]: checked }));
    setDirty(true);
  }

  async function fetchLinkedInPreflight(
    geoQueryOverride?: string,
    force = false,
    accountIdOverride?: string,
    preflightDraft: AdsCampaignInput = draft,
  ): Promise<LinkedInAdsPreflightResponse> {
    const context = linkedInPreflightContext.current;
    const selectedAccountId = accountIdOverride || externalStatuses.linkedin.selectedAccountId || preflightDraft.adAccountId;
    if (!selectedAccountId) {
      throw new Error("Associez d’abord un compte LinkedIn Ads dans la configuration du canal.");
    }
    const settings = preflightDraft.channelSettings?.channel === "linkedin" ? preflightDraft.channelSettings : null;
    const { queries: geoQueries, manualOnly } = buildLinkedInGeoQueries(preflightDraft.targetLocations, geoQueryOverride);
    const params = new URLSearchParams({
      language: settings?.locale.language || "fr",
      country: settings?.locale.country || "FR",
      dailyBudget: Number(preflightDraft.dailyBudgetEuros || 0).toFixed(2),
      politicalIntentConfirmed: String(preflightDraft.linkedinPoliticalIntentConfirmed === true),
      targetingNoticeAcknowledged: String(preflightDraft.linkedinTargetingNoticeAcknowledged === true),
    });
    if (settings) { params.set("objectiveType", settings.objectiveType); params.set("format", settings.format); }
    if (preflightDraft.linkedinDeliverySettings) params.set("deliverySettings", JSON.stringify(preflightDraft.linkedinDeliverySettings));
    params.set("endDate", preflightDraft.endDate);
    for (const query of geoQueries) params.append("geo", query);
    if (preflightDraft.linkedinCampaignGroupId) params.set("campaignGroupId", preflightDraft.linkedinCampaignGroupId);
    if (preflightDraft.linkedinOrganizationUrn) params.set("organizationUrn", preflightDraft.linkedinOrganizationUrn);
    if (preflightDraft.linkedinBidEuros && preflightDraft.linkedinBidEuros > 0) params.set("bidAmount", preflightDraft.linkedinBidEuros.toFixed(2));
    for (const target of preflightDraft.linkedinGeoTargets || []) params.append("geoUrn", target.urn);

    const showResponse = (data: LinkedInAdsPreflightResponse) => {
      if (context !== linkedInPreflightContext.current) return;
      setLinkedInPreflight((current) => {
        if (!manualOnly) {
          const briefQueries = new Set(preflightDraft.targetLocations.map(linkedInGeoQueryKey));
          const merged = new Map((current?.geoResolutions || []).filter((entry) => !briefQueries.has(linkedInGeoQueryKey(entry.query))).map((entry) => [linkedInGeoQueryKey(entry.query), entry]));
          for (const entry of data.geoResolutions || []) merged.set(linkedInGeoQueryKey(entry.query), entry);
          return { ...data, geoResolutions: [...merged.values()] };
        }
        const kept = current?.geoResolutions || [];
        const merged = new Map(kept.map((entry) => [linkedInGeoQueryKey(entry.query), entry]));
        for (const entry of data.geoResolutions || []) merged.set(linkedInGeoQueryKey(entry.query), entry);
        // A lookup can suggest a target that the user has not selected. Keep
        // the brief's verification and pricing until its automatic check runs again.
        return { ...(current || { ...data, selected: undefined, blockers: [] }),
          geoSuggestions: data.geoSuggestions,
          geoResolutions: [...merged.values()] };
      });
    };

    const cacheKey = `${selectedAccountId}:${params.toString()}`;
    const cached = force ? null : linkedInPreflightCache.current.get(cacheKey);
    if (cached) {
      showResponse(cached);
      return cached;
    }
    const data = await readJson(await fetch(`/api/ads/linkedin/preflight?${params.toString()}`, { cache: "no-store" })) as LinkedInAdsPreflightResponse;
    linkedInPreflightCache.current.set(cacheKey, data);
    showResponse(data);
    return data;
  }

  function applyLinkedInProviderDefaults(data: LinkedInAdsPreflightResponse, baseDraft: AdsCampaignInput = draft): AdsCampaignInput {
    const selected = data.selected;
    if (!selected) return baseDraft;
    const verifiedGeoUrns = new Set(selected.verifiedGeoUrns || []);
    const verifiedGeoTargets = (selected.verifiedGeoTargets || [])
      .filter((target) => verifiedGeoUrns.has(target.urn))
      .map((target) => ({ urn: target.urn, name: target.name }));
    const proposedGeoTargets = linkedInAdsContextualGeoDefaults({
      targetLocations: baseDraft.targetLocations,
      verifiedGeoTargets: verifiedGeoTargets.filter((target) => !linkedInGeoDismissedUrns.current.has(target.urn)),
      geoResolutions: data.geoResolutions || [],
    });
    const suggestedBid = selected.bidAmount ?? null;
    const pricing = selected.pricing;
    const hasProviderDefault = Boolean(
      selected.campaignGroup || selected.organization || proposedGeoTargets.length
      || (pricing && suggestedBid !== null && Number.isFinite(suggestedBid) && suggestedBid > 0),
    );
    if (!hasProviderDefault) return baseDraft;
    const providerPatch = (current: AdsCampaignInput): Partial<AdsCampaignInput> => {
      const patch: Partial<AdsCampaignInput> = {};
      if (current.provider !== "linkedin") return patch;
      const accountId = externalStatuses.linkedin.selectedAccountId || baseDraft.adAccountId;
      if (linkedInAdsAutomaticPreflightKey(accountId, current) !== linkedInAdsAutomaticPreflightKey(accountId, baseDraft)) return patch;
      if (!current.linkedinCampaignGroupId && selected.campaignGroup
          && linkedInCampaignGroupIsCompatible(selected.campaignGroup, baseDraft.channelSettings?.channel === "linkedin" ? baseDraft.channelSettings.objectiveType : "WEBSITE_VISIT")) {
        patch.linkedinCampaignGroupId = selected.campaignGroup.id;
      }
      if (!current.linkedinOrganizationUrn && selected.organization) {
        patch.linkedinOrganizationUrn = selected.organization.urn;
      }
      const currentGeoTargets = normalizeLinkedInGeoTargets(current.linkedinGeoTargets ?? []) || [];
      const currentGeoUrns = new Set(currentGeoTargets.map((target) => target.urn));
      const addedGeoTargets = proposedGeoTargets.filter((target) =>
        !currentGeoUrns.has(target.urn) && !linkedInGeoDismissedUrns.current.has(target.urn));
      const nextGeoTargets = normalizeLinkedInGeoTargets([...currentGeoTargets, ...addedGeoTargets]);
      if (nextGeoTargets && (addedGeoTargets.length || currentGeoTargets.length !== (current.linkedinGeoTargets || []).length)) {
        patch.linkedinGeoTargets = nextGeoTargets;
      }
      const bidDefault = linkedInAdsVerifiedBidDefault({
        currentBid: current.linkedinBidEuros,
        suggestedBid,
        pricing: pricing || null,
        dailyBudget: current.dailyBudgetEuros,
      });
      if (bidDefault !== null) patch.linkedinBidEuros = bidDefault;
      return patch;
    };
    const patch = providerPatch(baseDraft);
    if (!Object.keys(patch).length) return baseDraft;
    const updatedDraft = applyDraftEdit(baseDraft, patch);
    setDraft((current) => {
      const patch = providerPatch(current);
      return Object.keys(patch).length ? applyDraftEdit(current, patch) : current;
    });
    setDirty(true);
    setConfirmedSpend(false); linkedInLaunchConsent.current = null;
    return updatedDraft;
  }

  async function loadLinkedInResources(force = false, geoQueryOverride?: string) {
    if (linkedInPreflightLoad === "loading") return;
    const context = linkedInPreflightContext.current;
    setLinkedInPreflightLoad("loading");
    setLinkedInPreflightError("");
    try {
      const data = await fetchLinkedInPreflight(geoQueryOverride, force);
      if (context !== linkedInPreflightContext.current) return;
      if (!geoQueryOverride) applyLinkedInProviderDefaults(data);
      setLinkedInPreflightLoad("ready");
    } catch (error) {
      if (context !== linkedInPreflightContext.current) return;
      setLinkedInPreflightLoad("error");
      setLinkedInPreflightError(error instanceof Error ? error.message : "Ressources LinkedIn Ads indisponibles.");
    }
  }

  linkedInResourcesLoader.current = loadLinkedInResources;
  const linkedInAutomaticLoadSignature = linkedInAdsAutomaticPreflightKey(
    externalStatuses.linkedin.selectedAccountId,
    draft,
  );
  useEffect(() => {
    const selectedAccountId = externalStatuses.linkedin.selectedAccountId;
    if (!creating || channelId !== "linkedin" || !externalStatuses.linkedin.connected || !selectedAccountId) return;
    if (linkedInPreflightLoad === "loading") return;
    if (linkedInAutomaticLoadKey.current === linkedInAutomaticLoadSignature) return;
    linkedInAutomaticLoadKey.current = linkedInAutomaticLoadSignature;
    void linkedInResourcesLoader.current(false);
  }, [
    channelId,
    creating,
    externalStatuses.linkedin.connected,
    externalStatuses.linkedin.selectedAccountId,
    linkedInAutomaticLoadSignature,
    linkedInPreflightLoad,
  ]);

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
      if (next.objectiveType === "BRAND_AWARENESS" || next.objectiveType === "VIDEO_VIEW" || next.objectiveType === "WEBSITE_CONVERSION") patch.linkedinDeliverySettings = { ...linkedInDelivery, bidding: { strategy: "maximum_delivery", amountEuros: null } };
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
      & Partial<Pick<MediaLibraryPickerItem, "id" | "media_metadata" | "mime_type" | "size_bytes" | "width" | "height">>,
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
      if (item.mime_type && item.mime_type !== "image/jpeg" && item.mime_type !== "image/png" && item.mime_type !== "image/webp") {
        setCampaignMediaUploadError("Ce parcours ChatGPT Ads accepte une image JPG, PNG ou WebP.");
        return;
      }
      if (item.size_bytes && item.size_bytes > CHATGPT_ADS_MAX_IMAGE_BYTES) {
        setCampaignMediaUploadError("L’image ChatGPT Ads ne doit pas dépasser 20 Mo.");
        return;
      }
      if (item.width && item.height && (item.width !== item.height || item.width < CHATGPT_ADS_MIN_IMAGE_SIDE_PX)) {
        setCampaignMediaUploadError(`Choisissez une image carrée d’au moins ${CHATGPT_ADS_MIN_IMAGE_SIDE_PX} × ${CHATGPT_ADS_MIN_IMAGE_SIDE_PX} pixels pour ChatGPT Ads.`);
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
      setConfirmedSpend(false); linkedInLaunchConsent.current = null;
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
        ...(current.provider === "tiktok" && mediaType === "video" && /^\d{5,30}$/.test(current.adAccountId) ? {
          tiktokNativeSelections: { ...(current.tiktokNativeSelections || { schemaVersion: 1 as const, advertiserId: current.adAccountId,
            context: structuredClone(TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT), identity: null, locationIds: [], callToAction: "LEARN_MORE" }),
            thumbnailMediaId: url === current.creativeUrl ? current.tiktokNativeSelections?.thumbnailMediaId || null : null,
            isAiGenerated: item.media_metadata?.origin === "ai_generation" ? true : url === current.creativeUrl ? current.tiktokNativeSelections?.isAiGenerated ?? null : null }
        } : {}),
      });
    });
    setDirty(true);
    setConfirmedSpend(false); linkedInLaunchConsent.current = null;
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
        if (expectedType !== "image" || !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > CHATGPT_ADS_MAX_IMAGE_BYTES) {
          throw new Error("Ce parcours ChatGPT Ads accepte un JPG, PNG ou WebP carré de 20 Mo maximum.");
        }
        openaiDimensions = await uploadedImageDimensions(file);
        if (openaiDimensions.width !== openaiDimensions.height || openaiDimensions.width < CHATGPT_ADS_MIN_IMAGE_SIDE_PX) {
          throw new Error(`Choisissez une image carrée d’au moins ${CHATGPT_ADS_MIN_IMAGE_SIDE_PX} × ${CHATGPT_ADS_MIN_IMAGE_SIDE_PX} pixels pour ChatGPT Ads.`);
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
    applyCampaignMedia({ ...result.item, media_metadata: { ...result.item.media_metadata, origin: "ai_generation" } }, metaMediaSlot);
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
    setLinkedInAudienceSuggestions([]); setLinkedInAudiencePending(0);
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
    resetStepProgress(1, manualStepKeys);
  }

  function applyCampaignPlan(plan: AdsCampaignPlan) {
    linkedInPreflightContext.current++;
    if (channelId === "linkedin") { setLinkedInPreflight(null); setLinkedInPreflightLoad("idle"); linkedInAutomaticLoadKey.current = ""; setLinkedInAudienceSuggestions(plan.linkedinTargetingSuggestions || []); setLinkedInAudiencePending((plan.linkedinTargetingSuggestions || []).reduce((count, suggestion) => count + suggestion.terms.length, 0)); }
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
    });
    if (channelId === "linkedin") {
      linkedInGeoDismissedUrns.current.clear();
      linkedInGeoChoices.current = {};
      setLinkedInGeoQuery(plan.targetLocations[0] || "");
      setLinkedInPreflight((current) => current ? { ...current, geoSuggestions: [] } : current);
    }
    setDirty(true);
    setConfirmedSpend(false); linkedInLaunchConsent.current = null;
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
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
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
    resetStepProgress(0, inrcyStepKeys);
  }

  function beginAssistedAnalysis() {
    if (analysisMode === "guided" && !guidedAnalysisObjective.trim()) return;
    setAnalysisSetupOpen(false);
    setCreationPath("inrcy");
    updateDraft({ creationMode: "inrcy" });
    resetStepProgress(1, inrcyStepKeys);
    void generateCampaignPlan();
  }

  function startNewCampaign() {
    if (!pilotChannelsEnabled && !isAdsPublicChannel(channelId)) return;
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
    linkedInPreflightContext.current++;
    setLinkedInAudienceSuggestions([]); setLinkedInAudiencePending(0);
    setLinkedInPreflight(null);
    setLinkedInPreflightLoad("idle");
    setLinkedInPreflightError("");
    setLinkedInGeoQuery("");
    linkedInGeoDismissedUrns.current.clear();
    linkedInGeoChoices.current = {};
    linkedInAutomaticLoadKey.current = "";
    setMetaMediaSlot(null);
    setMetaMediaFormatStatus({ feed: "empty", story_reel: "empty" });
    setConfirmedSpend(false); linkedInLaunchConsent.current = null;
    setCreationPath("choice");
    setAnalysisSetupOpen(false);
    setAnalysisMode("free");
    setGuidedAnalysisObjective("");
    resetStepProgress(0, manualStepKeys);
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
      setConfirmedSpend(false); linkedInLaunchConsent.current = null;
      setDraftsRevision((revision) => revision + 1);
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Enregistrement impossible.");
    } finally { setBusy(null); }
  }

  async function validatePreparedDraft() {
    if (!preparedOnlyChannel || busy !== null) return;
    const key = preparedDraftKey;
    if (preparedBudgetApprovalKey !== key || preparedContentApprovalKey !== key || destinationReview.required && !destinationReview.confirmed || preparedReviewIssues.length) {
      setNotice("Relisez les réglages préparés et cochez les confirmations de cette dernière page."); return;
    }
    const parsed = parseAdsCampaignInput(draft, { purpose: "draft" });
    if (!parsed.draft || parsed.error) { setNotice(parsed.error || "Le brouillon préparé est incomplet."); return; }
    setBusy("save"); setNotice("");
    try {
      const resourcesKey = channelId === "tiktok" ? tikTokAdsResourcesConsentKey(effectiveTikTokResources) : null;
      if (resourcesKey && effectiveTikTokResources) {
        const fresh = await readJson(await fetch(`/api/ads/tiktok/resources?accountId=${encodeURIComponent(effectiveTikTokResources.selectedAccountId)}`, { cache: "no-store" })) as TikTokAdsResources;
        if (tikTokAdsResourcesConsentKey(fresh) !== resourcesKey) throw new Error("Le compte ou les identités TikTok ont changé. Relisez la proposition actualisée avant de valider.");
      }
      const reviewUnchanged = () => preparedLatestReview.current.draftKey === key && preparedLatestReview.current.budgetKey === key
        && preparedLatestReview.current.contentKey === key && (!destinationReview.required || preparedLatestReview.current.destination === draft.destinationUrl.trim());
      if (!reviewUnchanged()) throw new Error("La proposition a changé pendant sa vérification. Revalidez ses réglages actuels.");
      const result = await readJson(await fetch("/api/ads/campaigns", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...parsed.draft, ...(savedId ? { id: savedId } : {}) }) }));
      if (!reviewUnchanged()) throw new Error("Le brouillon précédent a été enregistré. Vos nouvelles modifications restent à valider ; aucune publicité n’a été créée.");
      const id = String((result.campaign as { id?: string } | undefined)?.id || "");
      if (!id) throw new Error("L’enregistrement du brouillon n’a pas été confirmé.");
      setSavedId(id); setDirty(false); setDraftsRevision((revision) => revision + 1);
      setNotice(`Votre brouillon ${channelMeta.label} est validé et enregistré. Les contrôles affichés doivent être terminés avant une création native en pause ; aucune dépense n’a été engagée.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Validation du brouillon impossible."); }
    finally { setBusy(null); }
  }

  async function createPreparedPausedCampaign() {
    if (!preparedOnlyChannel || busy !== null || !preparedNativeCheck || !preparedNativeReady) return;
    const key = preparedDraftKey;
    const assertUnchanged = () => {
      const current = preparedLatestReview.current;
      if (current.draftKey !== key || current.budgetKey !== key || current.contentKey !== key || destinationReview.required && current.destination !== draft.destinationUrl.trim())
        throw new Error("La proposition a changé. Relisez et confirmez ses réglages actuels.");
    };
    setBusy("publish"); setNotice("");
    try {
      assertUnchanged();
      const result = await createReviewedPausedCampaign({ draft, savedId: savedId || undefined, checked: preparedNativeCheck, assertUnchanged }, async (url, init) => readJson(await fetch(url, init)));
      setSavedId(result.id); setDraftsRevision((value) => value + 1); setCreating(false);
      try { assertUnchanged(); setDirty(false); } catch { setDirty(true); }
      setNotice(`La campagne ${channelMeta.label} est créée en pause et vérifiée. Sa diffusion reste désactivée ; retrouvez ses identifiants dans le suivi.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "La création doit être contrôlée dans le suivi avant toute nouvelle tentative."); }
    finally { setBusy(null); }
  }

  async function openLaunchDialog(validatePreparedCampaign = false) {
    const approvedLinkedInCampaign = validatePreparedCampaign ? linkedInLaunchConsent.current : null;
    if (validatePreparedCampaign && (!["linkedin", "google", "pinterest", "meta", "openai"].includes(channelId) || !confirmedSpend
      || !approvedLinkedInCampaign || approvedLinkedInCampaign.key !== JSON.stringify(draft))) {
      setNotice("Cochez la confirmation du budget et de la diffusion avant de valider.");
      return;
    }
    if (validatePreparedCampaign && destinationReview.required && (!destinationReview.valid || !destinationReview.confirmed)) {
      setNotice("Confirmez le lien de destination sur la dernière page avant de valider.");
      return;
    }
    let preparedCampaignId = "";
    if (!isAdsDraftAccountChannel(channelId)) {
      setNotice(`La publication ${channelMeta.label} n’est pas encore disponible. Vous pouvez conserver cette campagne en brouillon.`);
      return;
    }
    if (busy !== null || demoSubmissionRef.current || demoDialog) return;
    if (channelId === "linkedin" && !linkedInComplianceReady) {
      setNotice("Confirmez la déclaration NOT_POLITICAL et l’avis de ciblage non discriminatoire avant la validation finale.");
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
      let launchDraft = draft;
      async function prepareMetaOrOpenaiCampaign(resourcesKey: string, verifiedLocationCount: number, verifiedLanguageCount?: number) {
        const approvedResourcesKey = channelId === "meta" ? approvedLinkedInCampaign?.metaResourcesKey : approvedLinkedInCampaign?.openaiResourcesKey;
        if (!approvedResourcesKey || approvedResourcesKey !== resourcesKey || accountId !== launchDraft.adAccountId
          || channelId === "meta" && pageId !== launchDraft.pageId) {
          setConfirmedSpend(false); linkedInLaunchConsent.current = null;
          throw new Error("Le compte, ses ressources ou son calendrier ont changé. Relisez la proposition puis confirmez à nouveau.");
        }
        const validated = parseAdsCampaignInput(launchDraft, { purpose: "publish" });
        if (!validated.draft) throw new Error(validated.error || "Vérifiez les réglages de la campagne.");
        if (!approvedLinkedInCampaign || linkedInLaunchConsent.current !== approvedLinkedInCampaign
          || approvedLinkedInCampaign.key !== JSON.stringify(launchDraft) || approvedLinkedInCampaign.status !== launchStatus) {
          setConfirmedSpend(false); linkedInLaunchConsent.current = null;
          throw new Error("Les réglages ou le statut de diffusion ont changé depuis votre confirmation. Relisez puis validez à nouveau.");
        }
        const saved = await readJson(await fetch("/api/ads/campaigns", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...launchDraft, ...(savedId ? { id: savedId } : {}) }),
        }));
        const id = String((saved.campaign as { id?: string } | undefined)?.id || "");
        if (!id) throw new Error("Le brouillon n’a pas pu être confirmé.");
        if (linkedInLaunchConsent.current !== approvedLinkedInCampaign || approvedLinkedInCampaign.key !== JSON.stringify(launchDraft)) {
          throw new Error("Vos réglages ont changé pendant l’enregistrement. Ils sont conservés, sans publication.");
        }
        setSavedId(id); setDirty(false);
        const checked = await readJson(await fetch(`/api/ads/campaigns/${encodeURIComponent(id)}/preflight?mode=${launchStatus === "active" ? "live" : "paused"}`, { cache: "no-store" }));
        const legacyMeta = channelId === "meta" && !launchDraft.metaDeliverySettings;
        const locationsVerified = channelId === "openai"
          ? Number.isSafeInteger(checked.verifiedLocationCount) && Number(checked.verifiedLocationCount) > 0 && Number(checked.verifiedLocationCount) <= verifiedLocationCount
          : checked.verifiedLocationCount === verifiedLocationCount;
        if (checked.ready !== true || checked.selectedAccountId !== accountId || checked.resourcesKey !== (legacyMeta ? "" : resourcesKey)
          || !locationsVerified
          || channelId === "meta" && (checked.selectedPageId !== pageId || checked.verifiedLanguageCount !== verifiedLanguageCount)) {
          throw new Error("La plateforme n’a pas confirmé toutes les ressources et le média. Le brouillon est conservé, sans publication.");
        }
        return id;
      }
      if (channelId === "openai") {
        const connection = await readJson(await fetch("/api/ads/openai/status", { cache: "no-store" })) as {
          connected?: boolean; accountId?: string; accountName?: string;
          pausedCreationEnabled?: boolean; liveDeliveryEnabled?: boolean;
          readinessMessage?: string; liveReadinessMessage?: string;
        };
        accountId = String(connection.accountId || "");
        const pausedReady = connection.connected === true && Boolean(accountId) && connection.pausedCreationEnabled === true;
        const liveReady = connection.connected === true && Boolean(accountId) && connection.liveDeliveryEnabled === true;
        if (!pausedReady && !liveReady) {
          throw new Error(connection.liveReadinessMessage || connection.readinessMessage || "ChatGPT Ads attend une clé Advertiser API valide et un compte approuvé avant toute création.");
        }
        accountName = String(connection.accountName || accountId);
        launchStatus = liveReady ? "active" : "paused";
        setOpenaiAccountReady(pausedReady);
        setOpenaiLiveReady(liveReady);
        setOpenaiReadinessMessage(String(connection.readinessMessage || ""));
        setOpenaiLiveReadinessMessage(String(connection.liveReadinessMessage || connection.readinessMessage || ""));
        setConnectionSnapshots((current) => ({ ...current, openai: {
          ...current.openai, status: "connected", accountId, accountLabel: accountName,
        } }));
        if (validatePreparedCampaign) {
          const resources = await readJson(await fetch(`/api/ads/openai/resources?accountId=${encodeURIComponent(accountId)}`, { cache: "no-store" })) as OpenaiAdsResources;
          if (resources.selectedAccountId !== accountId || resources.account?.id !== accountId) throw new Error("Le compte ChatGPT Ads a changé depuis votre confirmation.");
          const resourcesKey = openaiAdsResourcesConsentKey(resources);
          if (!resourcesKey) throw new Error("Le compte ChatGPT Ads n’a pas pu être confirmé.");
          openaiNativeDelivery(launchDraft, Date.now(), resources.account.timezone || "UTC");
          preparedCampaignId = await prepareMetaOrOpenaiCampaign(resourcesKey, new Set(launchDraft.targetLocations).size);
        }
      } else if (channelId === "pinterest") {
        const connection = await readJson(await fetch("/api/ads/pinterest/accounts", { cache: "no-store" })) as {
          accounts?: ExternalAdsAccount[];
          selectedAccountId?: string | null;
          selectedAccountName?: string | null;
        };
        accountId = String(connection.selectedAccountId || "");
        const account = (connection.accounts || []).find((candidate) => candidate.id === accountId && candidate.currency === "EUR" && candidate.canManageCampaigns === true);
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
        if (validatePreparedCampaign) {
          const resources = await readJson(await fetch("/api/ads/pinterest/resources", { cache: "no-store" })) as PinterestAdsResources;
          if (resources.selectedAccountId !== accountId || accountId !== launchDraft.adAccountId || resources.account?.id !== accountId) throw new Error("Le compte Pinterest Ads a changé. Relisez le récapitulatif avant de valider à nouveau.");
          setPinterestResources(resources); setPinterestResourcesLoad("ready");
          if (!approvedLinkedInCampaign?.pinterestResourcesKey || approvedLinkedInCampaign.pinterestResourcesKey !== pinterestAdsResourcesConsentKey(resources)) {
            setConfirmedSpend(false); linkedInLaunchConsent.current = null;
            throw new Error("Les ressources Pinterest ou le fuseau du compte ont changé. Relisez le récapitulatif puis confirmez à nouveau.");
          }
          const resolvedZones = resolvePinterestAdsGeographies(resources, launchDraft.targetLocations);
          const resolvedLanguages = matchPinterestTargetLanguages(launchDraft.languages, resources.locales.map((locale) => ({ [locale.id]: locale.name })));
          const validated = parseAdsCampaignInput(launchDraft, { purpose: "publish" });
          if (!validated.draft) throw new Error(validated.error || "Vérifiez les réglages Pinterest.");
          if (!approvedLinkedInCampaign || linkedInLaunchConsent.current !== approvedLinkedInCampaign
            || approvedLinkedInCampaign.key !== JSON.stringify(launchDraft)
            || approvedLinkedInCampaign.status !== launchStatus) throw new Error("La campagne a changé depuis votre confirmation. Relisez les réglages puis validez à nouveau.");
          const saved = await readJson(await fetch("/api/ads/campaigns", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...launchDraft, ...(savedId ? { id: savedId } : {}) }),
          }));
          preparedCampaignId = String((saved.campaign as { id?: string } | undefined)?.id || "");
          if (!preparedCampaignId) throw new Error("Le brouillon Pinterest n’a pas pu être confirmé.");
          if (linkedInLaunchConsent.current !== approvedLinkedInCampaign || approvedLinkedInCampaign.key !== JSON.stringify(launchDraft)) throw new Error("La campagne a changé pendant l’enregistrement. Aucune publication n’a été lancée.");
          setSavedId(preparedCampaignId); setDirty(false);
          const checked = await readJson(await fetch(`/api/ads/campaigns/${encodeURIComponent(preparedCampaignId)}/preflight?mode=live`, { cache: "no-store" }));
          if (checked.ready !== true || checked.selectedAccountId !== accountId
            || checked.verifiedLocationCount !== resolvedZones.length || checked.verifiedLanguageCount !== resolvedLanguages.length
            || checked.resourcesKey !== approvedLinkedInCampaign.pinterestResourcesKey) throw new Error("Pinterest n’a pas confirmé toutes les zones, les langues et le média. Le brouillon est conservé, sans publication.");
        }
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
        let preflight: LinkedInAdsPreflightResponse | null = null;
        // React state still contains the previous render during this async call.
        // Recheck defaults with the effective draft, including newly selected zones.
        for (let attempt = 0; attempt < 3; attempt += 1) {
          preflight = await fetchLinkedInPreflight(undefined, true, accountId, launchDraft);
          const updatedDraft = applyLinkedInProviderDefaults(preflight, launchDraft);
          const defaultsChanged = linkedInAdsLaunchPreflightKey(updatedDraft) !== linkedInAdsLaunchPreflightKey(launchDraft);
          launchDraft = updatedDraft;
          if (!defaultsChanged) break;
          if (attempt === 2) throw new Error("Les réglages LinkedIn viennent de changer. Contrôlez les valeurs actualisées puis relancez la vérification.");
        }
        if (!preflight || preflight.account?.id !== accountId) {
          throw new Error("LinkedIn n’a pas confirmé le compte associé à cette campagne. Réessayez la vérification.");
        }
        setLinkedInPreflightLoad("ready");
        const group = (preflight.campaignGroups || []).find((candidate) => candidate.id === launchDraft.linkedinCampaignGroupId);
        const organization = (preflight.organizations || []).find((candidate) => candidate.urn === launchDraft.linkedinOrganizationUrn);
        if (!group || !linkedInCampaignGroupIsCompatible(group, launchDraft.channelSettings?.channel === "linkedin" ? launchDraft.channelSettings.objectiveType : "WEBSITE_VISIT")) {
          throw new Error("Le groupe de campagnes LinkedIn choisi n’est plus accessible ou compatible. Rechargez les ressources et choisissez-le de nouveau.");
        }
        if (!organization) {
          throw new Error("La Page LinkedIn choisie n’est plus accessible avec un rôle autorisé. Rechargez les ressources et choisissez-la de nouveau.");
        }
        // Active remains the default only when LinkedIn can actually serve and
        // the selected parent group is ACTIVE. A safe PAUSED creation remains
        // selectable for manageable On hold/DRAFT/PAUSED resources.
        if (preflight.account.canServeCampaigns !== true || group.status !== "ACTIVE") launchStatus = "paused";
        const blockers = linkedInAdsLaunchBlockers(preflight.blockers, launchStatus === "active" ? "ACTIVE" : "PAUSED");
        if (blockers.length) throw new Error(linkedInAdsLaunchBlockerMessage(blockers));
        launchDraft = {
          ...launchDraft,
          provider: "linkedin",
          adAccountId: accountId,
          accountCurrency: "EUR",
          linkedinGeoTargets: normalizeLinkedInGeoTargets(launchDraft.linkedinGeoTargets ?? []) || [],
        };
        const validated = parseAdsCampaignInput(launchDraft, { purpose: "publish" });
        if (!validated.draft) throw new Error(validated.error || "Vérifiez la campagne LinkedIn avant de la lancer.");
        if (validatePreparedCampaign && (!approvedLinkedInCampaign
          || linkedInLaunchConsent.current !== approvedLinkedInCampaign
          || approvedLinkedInCampaign.key !== JSON.stringify(launchDraft)
          || approvedLinkedInCampaign.status !== launchStatus)) {
          setConfirmedSpend(false); linkedInLaunchConsent.current = null;
          setNotice("Les réglages ont changé pendant la vérification. Relisez le récapitulatif et confirmez-les à nouveau.");
          return;
        }
        const saved = await readJson(await fetch("/api/ads/campaigns", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...launchDraft, ...(savedId ? { id: savedId } : {}) }),
        }));
        const campaignId = String((saved.campaign as { id?: string } | undefined)?.id || "");
        if (!campaignId) throw new Error("Le brouillon LinkedIn n’a pas pu être confirmé. Aucune campagne n’a été créée sur la plateforme.");
        if (validatePreparedCampaign && linkedInLaunchConsent.current !== approvedLinkedInCampaign) {
          // A request already sent may have saved the prior draft. Never
          // overwrite a newer local edit or mark that edit as saved.
          setNotice("Vos modifications sont conservées. Vérifiez le récapitulatif et confirmez à nouveau la campagne.");
          return;
        }
        setDraft(launchDraft);
        setSavedId(campaignId);
        preparedCampaignId = campaignId;
        setDirty(false);
        // Run the publisher's own resource/media checks without creating anything
        // on LinkedIn, before asking the professional to confirm a paid launch.
        const publicationCheck = await readJson(await fetch(`/api/ads/campaigns/${encodeURIComponent(campaignId)}/preflight?mode=${launchStatus === "active" ? "live" : "paused"}`, { cache: "no-store" }));
        const selectedGeoCount = new Set((launchDraft.linkedinGeoTargets || []).map((target) => target.urn)).size;
        if (publicationCheck.ready !== true || publicationCheck.verifiedGeoCount !== selectedGeoCount) {
          throw new Error("LinkedIn n’a pas confirmé toutes les ressources et l’image de la campagne. Le brouillon est conservé ; réessayez la vérification.");
        }
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
        if (channelId === "meta" && validatePreparedCampaign) {
          const resources = await readJson(await fetch("/api/ads/meta/resources", { cache: "no-store" })) as MetaAdsResources;
          if (resources.selectedAccountId !== accountId || resources.selectedPageId !== pageId || resources.account?.id !== accountId) throw new Error("Le compte ou la Page Meta a changé depuis votre confirmation.");
          setMetaResources(resources); setMetaResourcesLoad("ready");
          const verifiedLanguageCount = launchDraft.metaDeliverySettings ? resolveMetaAdsLanguages(resources, launchDraft.languages).length : 0;
          metaNativeDelivery(launchDraft);
          preparedCampaignId = await prepareMetaOrOpenaiCampaign(metaAdsResourcesConsentKey(resources), launchDraft.metaDeliverySettings ? new Set((launchDraft.metaGeoTargets || []).map((target) => `${target.type}:${target.key}`)).size : launchDraft.targetLocations.length, verifiedLanguageCount);
        }
        if (channelId === "google" && validatePreparedCampaign) {
          // Re-read native resources without changing approved campaign settings.
          const resources = await readJson(await fetch("/api/ads/google/resources", { cache: "no-store" })) as GoogleAdsAccountResources;
          if (resources.selectedAccountId !== accountId || accountId !== launchDraft.adAccountId) throw new Error("Le compte Google Ads a changé. Relisez le récapitulatif avant de valider à nouveau.");
          setGoogleResources(resources); setGoogleResourcesLoad("ready");
          if (!approvedLinkedInCampaign?.googleResourcesKey || approvedLinkedInCampaign.googleResourcesKey !== googleAdsResourcesConsentKey(resources)) {
            setConfirmedSpend(false); linkedInLaunchConsent.current = null;
            throw new Error("Les objectifs de conversion ou le fuseau du compte Google Ads ont changé. Relisez les réglages actualisés puis validez à nouveau.");
          }
          if (["maximize_conversions", "maximize_value", "target_cpa", "target_roas"].includes(launchDraft.bidStrategy) && !resources.hasBiddableConversions) throw new Error("Les conversions du compte Google Ads ne permettent plus cette stratégie. Actualisez les réglages avant de valider.");
          const validated = parseAdsCampaignInput(launchDraft, { purpose: "publish" });
          if (!validated.draft) throw new Error(validated.error || "Vérifiez les réglages Google Search.");
          if (!approvedLinkedInCampaign || linkedInLaunchConsent.current !== approvedLinkedInCampaign
            || approvedLinkedInCampaign.key !== JSON.stringify(launchDraft)
            || approvedLinkedInCampaign.status !== launchStatus) throw new Error("La campagne a changé depuis votre confirmation. Relisez le récapitulatif puis validez à nouveau.");
          const saved = await readJson(await fetch("/api/ads/campaigns", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...launchDraft, ...(savedId ? { id: savedId } : {}) }),
          }));
          preparedCampaignId = String((saved.campaign as { id?: string } | undefined)?.id || "");
          if (!preparedCampaignId) throw new Error("Le brouillon Google n’a pas pu être confirmé.");
          if (linkedInLaunchConsent.current !== approvedLinkedInCampaign || approvedLinkedInCampaign.key !== JSON.stringify(launchDraft)) throw new Error("La campagne a changé pendant l’enregistrement. Aucune publication n’a été lancée.");
          setSavedId(preparedCampaignId); setDirty(false);
          const checked = await readJson(await fetch(`/api/ads/campaigns/${encodeURIComponent(preparedCampaignId)}/preflight?mode=live`, { cache: "no-store" }));
          if (checked.ready !== true || checked.selectedAccountId !== accountId || !Number.isSafeInteger(checked.verifiedLocationCount) || Number(checked.verifiedLocationCount) < 1) throw new Error("Google Ads n’a pas confirmé toutes les zones et tous les réglages. Le brouillon est conservé.");
        }
      }
      setPublicationPhase("idle");
      const confirmation: DemoDialogState = {
        mode: "confirm",
        channelId,
        pageId,
        launchStatus,
        details: {
          campaignName: launchDraft.name,
          channelLabel: channelMeta.label,
          accountName,
          accountId,
          dailyBudgetEuros: launchDraft.dailyBudgetEuros,
          endDate: launchDraft.endDate,
          ...(channelId === "meta" || channelId === "openai" ? { nativeBudget: {
            type: channelId === "meta" ? launchDraft.metaDeliverySettings?.budget.type || "daily" : launchDraft.openaiDeliverySettings?.budget.type || "daily",
            totalEuros: channelId === "meta" ? launchDraft.metaDeliverySettings?.budget.totalEuros ?? null : launchDraft.openaiDeliverySettings?.budget.totalEuros ?? null,
            startAt: channelId === "meta" ? launchDraft.metaDeliverySettings?.budget.startAt || null : launchDraft.openaiDeliverySettings?.budget.startAt || null,
            endAt: channelId === "meta" ? metaNativeDelivery(launchDraft).endTime : new Date(openaiNativeDelivery(launchDraft, Date.now(), effectiveOpenaiResources?.account.timezone || "UTC").endTime * 1000).toISOString(),
            timeZone: channelId === "meta" ? effectiveMetaResources?.account.timezone || "Europe/Paris" : effectiveOpenaiResources?.account.timezone || "UTC",
          } } : {}),
          ...(channelId === "pinterest" ? { pinterestBudget: {
            type: launchDraft.pinterestDeliverySettings?.budget.type || "daily",
            totalEuros: launchDraft.pinterestDeliverySettings?.budget.totalEuros ?? null,
            startAt: launchDraft.pinterestDeliverySettings?.budget.startAt || null,
            endAt: launchDraft.pinterestDeliverySettings?.budget.endAt || launchDraft.endDate + "T23:59:59Z",
            timeZone: effectivePinterestResources?.account.timezone || "UTC",
            flexibleDaily: launchDraft.pinterestDeliverySettings?.budget.flexibleDaily || false,
          } } : {}),
          ...(channelId === "google" ? { googleBudget: {
            type: (launchDraft.googleDeliverySettings || defaultGoogleDeliverySettings()).budget.type,
            totalEuros: launchDraft.googleDeliverySettings?.budget.totalEuros ?? null,
            startDate: launchDraft.googleDeliverySettings?.startDate || null,
            timeZone: effectiveGoogleResources?.timeZone || "",
          } } : {}),
            ...(channelId === "linkedin" && launchDraft.linkedinDeliverySettings ? { linkedinBudget: {
              type: launchDraft.linkedinDeliverySettings.budget.type,
              totalEuros: launchDraft.linkedinDeliverySettings.budget.totalEuros,
              startAt: launchDraft.linkedinDeliverySettings.budget.startAt,
              endAt: launchDraft.linkedinDeliverySettings.budget.endAt || launchDraft.endDate + "T23:59:59Z",
            } } : {}),
        },
      };
      if (validatePreparedCampaign) {
        if (!approvedLinkedInCampaign || linkedInLaunchConsent.current !== approvedLinkedInCampaign
          || approvedLinkedInCampaign.key !== JSON.stringify(launchDraft)
          || approvedLinkedInCampaign.status !== launchStatus || !preparedCampaignId) {
          setConfirmedSpend(false); linkedInLaunchConsent.current = null;
          setNotice("Les réglages de la campagne ont été actualisés. Relisez le récapitulatif puis cochez à nouveau la confirmation avant de valider.");
          return;
        }
        // The user already approved this exact draft, budget and status in
        // the review. Fresh resource and publisher checks have just passed.
        demoSubmissionRef.current = false;
        await confirmCampaignLaunch({ confirmation, draft: launchDraft, savedId: preparedCampaignId });
      } else {
        setConfirmedSpend(false); linkedInLaunchConsent.current = null;
        setDemoDialog(confirmation);
      }
    } catch (error) {
      if (channelId === "linkedin") {
        setLinkedInPreflightLoad("error");
        setLinkedInPreflightError(error instanceof Error ? error.message : "Contrôle LinkedIn Ads indisponible.");
      }
      setNotice(error instanceof Error ? error.message : "Le compte annonceur n’a pas pu être vérifié. Réessayez avant de lancer la campagne.");
    } finally { demoSubmissionRef.current = false; setBusy(null); }
  }

  async function confirmCampaignLaunch(prepared?: { confirmation: DemoDialogState; draft: AdsCampaignInput; savedId: string }) {
    const confirmation = prepared?.confirmation || demoDialog;
    if (prepared && (!confirmedSpend || !linkedInLaunchConsent.current
      || linkedInLaunchConsent.current.key !== JSON.stringify(prepared.draft)
      || linkedInLaunchConsent.current.status !== confirmation?.launchStatus)) return;
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
      if (confirmation.channelId === "openai" && confirmation.launchStatus === "active" && !openaiLiveReady) {
        throw new Error(openaiLiveReadinessMessage || "Ce compte ChatGPT Ads n’est pas encore autorisé à lancer une diffusion active.");
      }
      if (confirmation.channelId === "openai" && confirmation.launchStatus === "paused" && !openaiAccountReady) {
        throw new Error(openaiReadinessMessage || "Ce compte ChatGPT Ads n’est pas encore autorisé à créer une campagne en pause.");
      }
      const campaignDraft: AdsCampaignInput = {
        ...(prepared?.draft || draft),
        provider: confirmation.channelId,
        adAccountId: confirmation.details.accountId,
        accountCurrency: "EUR",
        pageId: confirmation.channelId === "meta" ? confirmation.pageId : (prepared?.draft || draft).pageId,
        ...(confirmation.channelId === "linkedin"
          ? { linkedinGeoTargets: normalizeLinkedInGeoTargets((prepared?.draft || draft).linkedinGeoTargets ?? []) || [] }
          : {}),
      };
      const validated = parseAdsCampaignInput(campaignDraft, { purpose: "publish" });
      if (!validated.draft) throw new Error(validated.error || "Vérifiez la campagne avant de la lancer.");
      let campaignId = prepared?.savedId || "";
      if (!campaignId) {
        const saved = await readJson(await fetch("/api/ads/campaigns", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...campaignDraft, ...(savedId ? { id: savedId } : {}) }),
        }));
        campaignId = String((saved.campaign as { id?: string } | undefined)?.id || "");
      }
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
          ...(confirmation.channelId === "openai" && !paused && confirmedSpend ? { billingConfirmed: true } : {}),
        }),
      }));
      const expectedStatus = paused ? "paused" : "active";
      if ((published.campaign as { status?: string } | undefined)?.status !== expectedStatus) {
        throw new Error("La création sur la plateforme n’a pas pu être confirmée. Vérifiez son statut avant toute nouvelle tentative.");
      }
      setDemoDialog({ ...confirmation, mode: "success" });
      setConfirmedSpend(false); linkedInLaunchConsent.current = null;
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
    setConfirmedSpend(false); linkedInLaunchConsent.current = null;
    setPlanError("");
    setPlanRequestId("");
    setPlanRationale("");
    setPlanSources([]);
    setAutoMediaPlan(null);
    setAutoMediaState("idle");
    setAutoMediaMessage("");
    setCampaignMediaUploadError("");
    linkedInPreflightContext.current++;
    setLinkedInAudienceSuggestions([]); setLinkedInAudiencePending(0);
    setLinkedInPreflight(null);
    setLinkedInPreflightLoad("idle");
    setLinkedInPreflightError("");
    setLinkedInGeoQuery(campaign.draft.targetLocations[0] || "");
    linkedInGeoDismissedUrns.current.clear();
    linkedInGeoChoices.current = {};
    linkedInAutomaticLoadKey.current = "";
    setCampaignMediaStudioOpen(false);
    setCampaignMediaLibraryOpen(false);
    setBusy(null);
    const nextPath: AdsCreationMode = campaign.draft.creationMode === "inrcy" ? "inrcy" : "manual";
    setAnalysisSetupOpen(false);
    setCreationPath(nextPath);
    setPlanProgress(nextPath === "inrcy" ? 100 : 0);
    setNotice("");
    const reopenedStepKeys = adsDraftStepKeys(campaign.draft);
    resetStepProgress(adsDraftValidationStep(campaign.draft), reopenedStepKeys);
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
    && ([...LINKEDIN_IMAGE_OBJECTIVES, "VIDEO_VIEW"] as string[]).includes(nativeSettings.objectiveType)
    && (["STANDARD_UPDATE", "SINGLE_VIDEO"] as string[]).includes(nativeSettings.format);
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
  const metaLiveCtaSupported = channelId !== "meta" || Boolean(draft.metaDeliverySettings && META_CALL_TO_ACTIONS.includes(draft.metaDeliverySettings.callToAction)) || ["en savoir plus", "decouvrir", "learn more"].includes(
    draft.callToAction.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(),
  );
  const connectorConfigurationIssue = isAdsDraftAccountChannel(channelId) ? unsupportedAdsConnectorReason(draft) : null;
  const openaiHiddenSettingsNeedReset = channelId === "openai" && (draft.conversionGoal !== "website_visit"
    || draft.conversionLocation !== "website" || draft.bidStrategy !== "manual_review"
    || Boolean(draft.callToAction.trim()
      || draft.keywords.length || draft.negativeKeywords.length));
  const knownMetaMediaInvalid = channelId === "meta" && (
    (metaMediaReadiness.requiresFeedImage && metaMediaFormatStatus.feed === "invalid")
    || (metaMediaReadiness.requiresStoryReelImage && metaMediaFormatStatus.story_reel === "invalid")
  );
  const livePublisherMediaReady = channelId === "meta"
    ? metaMediaReadiness.ready && !knownMetaMediaInvalid
    : channelId === "linkedin"
      ? Boolean(attachedCampaignMediaUrl && ((draft.creativeType === "image" && draft.mediaStrategy === "image") || (draft.creativeType === "video" && draft.mediaStrategy === "video")))
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
    assisted: creationPath === "inrcy" || channelId === "google",
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
  const linkedInCampaignGroups = (linkedInPreflight?.campaignGroups || []).filter((group) => linkedInCampaignGroupIsCompatible(group, nativeSettings?.channel === "linkedin" ? nativeSettings.objectiveType : "WEBSITE_VISIT"));
  const linkedInOrganizations = linkedInPreflight?.organizations || [];
  const preflightSelectedLinkedInCampaignGroup = linkedInPreflight?.selected?.campaignGroup || null;
  const preflightSelectedLinkedInOrganization = linkedInPreflight?.selected?.organization || null;
  const selectedLinkedInCampaignGroup = linkedInCampaignGroups.find((group) => group.id === draft.linkedinCampaignGroupId)
    || (preflightSelectedLinkedInCampaignGroup?.id === draft.linkedinCampaignGroupId
      ? preflightSelectedLinkedInCampaignGroup : null);
  const selectedLinkedInOrganization = linkedInOrganizations.find((organization) => organization.urn === draft.linkedinOrganizationUrn)
    || (preflightSelectedLinkedInOrganization?.urn === draft.linkedinOrganizationUrn
      ? preflightSelectedLinkedInOrganization : null);
  const linkedInGeoTargets = normalizeLinkedInGeoTargets(draft.linkedinGeoTargets ?? []) || [];
  const linkedInVerifiedGeoUrns = new Set(linkedInPreflight?.selected?.verifiedGeoUrns || []);
  const linkedInGeoResolutions = linkedInPreflight?.geoResolutions || [];
  const linkedInBriefGeoStatus = (label: string) => {
    const resolution = linkedInGeoResolutions.find((entry) => linkedInGeoQueryKey(entry.query) === linkedInGeoQueryKey(label));
    if (!resolution) return { label: linkedInPreflightLoad === "loading" ? "Vérification…" : "Brief seul", verified: false };
    if (resolution.status === "provider_rejected") {
      return { label: "Zone refusée par LinkedIn, essayez une autre recherche", verified: false, rejected: true };
    }
    const verified = resolution.suggestions.some((suggestion) =>
      linkedInVerifiedGeoUrns.has(suggestion.urn) && linkedInGeoTargets.some((target) => target.urn === suggestion.urn));
    return verified
      ? { label: "Vérifiée LinkedIn", verified: true }
      : { label: resolution.suggestions.length ? "Choix exact requis" : "Non trouvée", verified: false };
  };
  const linkedInMissingGeoLocations = draft.targetLocations.filter((label) => !linkedInBriefGeoStatus(label).verified);
  const linkedInBriefGeoReady = linkedInMissingGeoLocations.length === 0;
  const linkedInBidPricing = linkedInPreflight?.selected?.pricing || null;
  const linkedInBidMinimum = Math.max(0.01, linkedInBidPricing?.bidMin ?? 0.01);
  const linkedInBudgetCap = linkedInDelivery.budget.type === "total" ? linkedInDelivery.budget.totalEuros || draft.dailyBudgetEuros : draft.dailyBudgetEuros;
  const linkedInBidMaximum = Math.min(linkedInBidPricing?.bidMax ?? linkedInBudgetCap, linkedInBudgetCap);
  const linkedInManualBid = linkedInDelivery.bidding.strategy === "manual_cpc";
  const linkedInBudgetBelowProviderMinimum = Boolean(linkedInBidPricing
    && linkedInDelivery.budget.type === "daily" && draft.dailyBudgetEuros < linkedInBidPricing.dailyBudgetMin);
  const linkedInBidOutsideVerifiedRange = Boolean(linkedInManualBid && linkedInBidPricing && draft.linkedinBidEuros !== undefined
    && (draft.linkedinBidEuros < linkedInBidMinimum || draft.linkedinBidEuros > linkedInBidMaximum));
  const linkedInSelectionsReady = Boolean(
    draft.linkedinCampaignGroupId
    && draft.linkedinOrganizationUrn
    && linkedInGeoTargets.length
    && linkedInGeoTargets.length <= 20
    && linkedInPreflightLoad === "ready"
    && linkedInPreflight
    && linkedInBriefGeoReady
    && linkedInAudiencePending === 0
    && linkedInGeoTargets.every((target) => linkedInVerifiedGeoUrns.has(target.urn))
    && linkedInBidPricing
    && !linkedInBudgetBelowProviderMinimum
    && !linkedInBidOutsideVerifiedRange
    && !linkedInPreflight.blockers?.some((blocker) => ["unresolved_geo_queries", "geo_query_provider_rejected", "selected_geo_unverified", "too_many_geo_targets", "budget_pricing_required"].includes(blocker))
    && (!linkedInManualBid || (draft.linkedinBidEuros && draft.linkedinBidEuros > 0))
    && !(nativeSettings?.channel === "linkedin" && nativeSettings.objectiveType === "WEBSITE_CONVERSION" && !linkedInDelivery.conversions.conversionUrns.length)
    && !linkedInPreflight.blockers?.some((blocker) => ["selected_professional_targets_unverified", "selected_conversion_unverified", "conversion_required", "total_budget_too_low", "unsupported_delivery_settings", "campaign_schedule_invalid", "audience_count_required", "audience_too_small"].includes(blocker)),
  );
  const linkedInPreparedLaunchStatus: AdsCampaignLaunchStatus = linkedInPreflight?.account?.canServeCampaigns === true
    && selectedLinkedInCampaignGroup?.status === "ACTIVE" ? "active" : "paused";
  const linkedInUnverifiedGeoTargets = linkedInGeoTargets.filter((target) => !linkedInVerifiedGeoUrns.has(target.urn));
  const linkedInReadinessDetails = (() => {
    if (linkedInAudiencePending > 0) return "Confirmez ou ignorez les propositions de ciblage professionnel à l’étape Audience.";
    if (linkedInPreflightLoad === "error") {
      return linkedInPreflightError || "La vérification LinkedIn a échoué. Actualisez les ressources à l’étape Campagne.";
    }
    if (linkedInPreflightLoad !== "ready" || !linkedInPreflight) {
      return "La vérification LinkedIn est en cours. Attendez son résultat avant de lancer.";
    }
    if (!draft.linkedinCampaignGroupId || !draft.linkedinOrganizationUrn) {
      return "Le groupe ou la Page n’a pas pu être choisi automatiquement. Vérifiez les réglages à l’étape Campagne.";
    }
    if (linkedInMissingGeoLocations.length) {
      const names = linkedInMissingGeoLocations.map((label) => `« ${label} »`).join(", ");
      const verified = draft.targetLocations.length - linkedInMissingGeoLocations.length;
      return `La résolution automatique de LinkedIn n’a pas confirmé ${names}. ${verified}/${draft.targetLocations.length} zones du brief sont vérifiées. Réessayez le contrôle ou choisissez une des propositions LinkedIn.`;
    }
    if (!linkedInGeoTargets.length) return "Sélectionnez au moins une zone LinkedIn exacte à l’étape Zones géographiques.";
    if (linkedInGeoTargets.length > 20) return "LinkedIn accepte au maximum 20 zones exactes. Retirez les zones en trop à l’étape Zones géographiques.";
    if (linkedInUnverifiedGeoTargets.length || linkedInPreflight.blockers?.includes("selected_geo_unverified")) {
      const names = linkedInUnverifiedGeoTargets.map((target) => target.name).join(", ");
      return `À l’étape Zones géographiques, revérifiez les zones LinkedIn non confirmées${names ? ` : ${names}` : ""}.`;
    }
    if (linkedInPreflight.blockers?.includes("unresolved_geo_queries") || linkedInPreflight.blockers?.includes("geo_query_provider_rejected")) {
      return "Une zone du brief n’a pas pu être confirmée par LinkedIn. Actualisez les zones à l’étape Zones géographiques.";
    }
    if (!linkedInBidPricing || linkedInPreflight.blockers?.includes("budget_pricing_required")) {
      return "LinkedIn n’a pas confirmé les bornes d’enchère. Vérifiez le budget et réactualisez les ressources à l’étape Budget et calendrier.";
    }
    if (linkedInBudgetBelowProviderMinimum) {
      return `Augmentez le budget quotidien à au moins ${linkedInBidPricing.dailyBudgetMin.toLocaleString("fr-FR")} € à l’étape Budget et calendrier.`;
    }
    if (linkedInManualBid && (!draft.linkedinBidEuros || draft.linkedinBidEuros <= 0)) return "Renseignez une enchère CPC positive à l’étape Budget et calendrier.";
    if (linkedInBidOutsideVerifiedRange) {
      return "L’enchère CPC ne respecte plus la plage vérifiée par LinkedIn. Corrigez-la à l’étape Budget et calendrier.";
    }
    return linkedInAdsLaunchBlockerMessage(linkedInPreflight.blockers || []) || "Vérifiez à nouveau les ressources LinkedIn avant de lancer la campagne.";
  })();
  const linkedInComplianceReady = draft.linkedinPoliticalIntentConfirmed === true
    && draft.linkedinTargetingNoticeAcknowledged === true;
  const incompleteLaunchSteps = adsIncompleteLaunchSteps({
    draft,
    steps: {
      foundations: foundationsStep + 1,
      bidding: biddingStep >= 0 ? biddingStep + 1 : undefined,
      geography: geographyStep >= 0 ? geographyStep + 1 : undefined,
      targeting: targetingStep + 1,
      keywords: keywordsStep + 1,
      creative: creativeStep + 1,
      media: mediaStep >= 0 ? mediaStep + 1 : null,
      delivery: deliveryStep + 1,
      destinationConfirmation: ["linkedin", "google", "pinterest", "meta", "openai"].includes(channelId) && destinationReview.valid
        ? validationStep + 1 : undefined,
      budget: budgetStep + 1,
      validation: validationStep + 1,
    },
    googleTimeZone: effectiveGoogleResources?.timeZone,
    openaiTimeZone: effectiveOpenaiResources?.account.timezone || "UTC",
    accountReady: reviewAccountReady,
    destinationReady: destinationReview.valid && (!destinationReview.required || destinationReview.confirmed),
    mediaReady: livePublisherMediaReady,
  });
  const incompleteLaunchMessage = adsIncompleteLaunchMessage(
    incompleteLaunchSteps,
    draft.provider,
    geographyStep >= 0 ? geographyStep + 1 : targetingStep + 1,
  );
  const launchUnavailableReason = !isAdsDraftAccountChannel(channelId)
    ? `La publication ${channelMeta.label} n’est pas encore disponible. Le brouillon reste enregistrable.`
    : !channelPublishingEnabled
      ? `Le lancement ${channelMeta.label} est momentanément verrouillé dans cet environnement.`
      : connectorConfigurationIssue
        ? connectorConfigurationIssue
        : !liveFormatAvailable
          ? `Le format choisi ne peut pas encore être lancé automatiquement sur ${channelMeta.label}.`
          : !livePublisherConversionReady
            ? "Le connecteur de lancement nécessite une destination vers votre site web."
            : !metaLiveObjectiveSupported
              ? "Choisissez l’objectif Trafic vers le site web à l’étape Campagne."
              : !metaLiveGoalSupported
                ? "Choisissez la visite d’une page clé à l’étape Diffusion."
                : !metaLivePlacementsSupported
                  ? "Choisissez un placement Meta compatible à l’étape Diffusion."
                  : !metaLiveCreativeSupported
                    ? "Choisissez le format image à l’étape Créations."
                    : !metaLiveCtaSupported
                      ? "Choisissez l’appel à l’action « En savoir plus » à l’étape Créations."
                      : !livePublisherMediaReady
                        ? "Ajoutez un média conforme dans l’étape Médias."
                        : "";
  const linkedInLaunchReadinessReason = channelId === "linkedin"
    ? !linkedInSelectionsReady
      ? linkedInReadinessDetails
      : !linkedInComplianceReady
        ? "Confirmez les deux déclarations LinkedIn avant de lancer."
        : ""
    : "";
  const googleLaunchReadinessReason = channelId === "google" && draft.campaignType === "search"
    ? googleSearchLocalIssue(draft) || (!googleGeoReady ? googleGeoState.key === googleGeoKey && googleGeoState.status === "error" ? googleGeoState.error : "Vérification automatique des zones Google Ads en cours." : "") || (!effectiveGoogleResources || googleResourcesLoad !== "ready"
      ? googleResourcesError || "Vérification du compte et des conversions Google Ads en cours."
      : ["maximize_conversions", "maximize_value", "target_cpa", "target_roas"].includes(draft.bidStrategy) && !effectiveGoogleResources.hasBiddableConversions
        ? "Aucune conversion principale active : choisissez Maximiser les clics à l’étape Enchères." : "")
    : "";
  const pinterestLaunchReadinessReason = channelId === "pinterest"
    ? !effectivePinterestResources || pinterestResourcesLoad !== "ready"
      ? pinterestResourcesError || "Vérification du compte, des zones et des langues Pinterest en cours."
      : !pinterestGeoReady ? pinterestResolvedGeography.error
        : pinterestResolvedLanguages.error || (() => { try { pinterestNativeDelivery(draft); return ""; } catch (error) { return error instanceof Error ? error.message : "Vérifiez le budget et les enchères Pinterest."; } })()
    : "";
  const metaLaunchReadinessReason = channelId === "meta"
    ? !effectiveMetaResources || metaResourcesLoad !== "ready" ? metaResourcesError || "Vérification du compte et de la Page Meta en cours."
      : !metaGeoReady ? metaGeoState.key === metaGeoKey && metaGeoState.error || "Vérification des zones Meta en cours."
        : (draft.metaDeliverySettings ? metaResolvedLanguages.error : "") || (() => { try { metaNativeDelivery(draft); return ""; } catch (error) { return error instanceof Error ? error.message : "Vérifiez les réglages Meta."; } })()
    : "";
  const openaiLaunchReadinessReason = channelId === "openai"
    ? !effectiveOpenaiResources || openaiResourcesLoad !== "ready" ? openaiResourcesError || "Vérification du compte ChatGPT Ads en cours."
      : !openaiGeoReady ? "Une zone ChatGPT Ads reste à confirmer à l’étape Zones géographiques."
        : (() => { try { openaiNativeDelivery(draft, Date.now(), effectiveOpenaiResources.account.timezone || "UTC"); return ""; } catch (error) { return error instanceof Error ? error.message : "Vérifiez les réglages ChatGPT Ads."; } })()
    : "";
  const metaConsentCalendar = metaAdsCalendarLabels(draft, effectiveMetaResources?.account.timezone || null);
  const launchBlockingMessage = incompleteLaunchMessage || launchUnavailableReason || linkedInLaunchReadinessReason || googleLaunchReadinessReason || pinterestLaunchReadinessReason || metaLaunchReadinessReason || openaiLaunchReadinessReason;
  const launchBlocked = Boolean(launchBlockingMessage);

  const preparedReviewIssues = preparedOnlyChannel ? preparedAdsReviewIssues(draft, Date.now(), preparedTimeZone) : [];
  const preparedNativeCheck = preparedNativeReadiness.draftKey === JSON.stringify(draft) ? preparedNativeReadiness.check : null;
  const preparedNativeReady = preparedNativeCheck?.ready === true && preparedNativeCheck.pausedCreationEnabled;
  const preparedDraftKey = JSON.stringify({ draft, resources: channelId === "tiktok" ? tikTokAdsResourcesConsentKey(effectiveTikTokResources) : xAdsResourcesConsentKey(preparedXResources), nativeConsent: preparedNativeCheck?.consentKey || "" });
  preparedLatestReview.current = { draftKey: preparedDraftKey, budgetKey: preparedBudgetApprovalKey, contentKey: preparedContentApprovalKey, destination: confirmedDestinationUrl };
  let preparedBudgetError = "";
  if (preparedOnlyChannel) { try { plannedNativeCalendar(draft, Date.now(), preparedTimeZone); } catch (error) { preparedBudgetError = error instanceof Error ? error.message : "Vérifiez le budget et les dates."; } }

  const campaignLocationFields = <div className={`${styles.studioLocationField}${["linkedin", "google", "pinterest", "meta", "openai", "x", "tiktok"].includes(channelId) ? ` ${styles.studioWide}` : ""}`}><TagField label="Zones ciblées" helper="Ajoutez un lieu ou choisissez une zone ci-dessous." values={draft.targetLocations} onChange={(targetLocations) => {
            const changed = targetLocations.join("\n") !== draft.targetLocations.join("\n");
            if (channelId === "linkedin" && changed) {
              const removed = removeLinkedInBriefGeoTargets(draft.targetLocations, targetLocations, linkedInGeoResolutions, linkedInGeoTargets, linkedInGeoChoices.current);
              for (const urn of removed.dismissed) linkedInGeoDismissedUrns.current.add(urn);
              linkedInPreflightContext.current++; setLinkedInPreflightLoad("idle"); linkedInAutomaticLoadKey.current = "";
              updateDraft({ targetLocations, linkedinGeoTargets: removed.targets });
            } else updateDraft({ targetLocations });
            if (channelId === "linkedin" && changed) {
              setLinkedInGeoQuery((current) => current || targetLocations[0] || "");
              const retained = new Set(targetLocations.map(linkedInGeoQueryKey));
              setLinkedInPreflight((current) => current ? {
                ...current,
                geoSuggestions: [],
                geoResolutions: (current.geoResolutions || []).filter((entry) => retained.has(linkedInGeoQueryKey(entry.query))),
              } : current);
            }
          }} placeholder={channelId === "pinterest" ? "Choisissez une zone Pinterest ci-dessous" : ["openai", "linkedin", "google", "meta"].includes(channelId) ? "Ex. Lille, Hauts-de-France, France" : "Ex. Lyon, Rhône, France"} note={channelId === "linkedin" ? "iNr’ADS associe automatiquement chaque lieu du brief à une zone LinkedIn exacte. Contrôlez les zones vérifiées ci-dessous avant publication." : channelId === "openai" ? "Zones françaises vérifiées dans ChatGPT Ads. Aucun pays ajouté par défaut." : channelId === "pinterest" ? "Un pays cible le pays entier. Vos zones ne sont jamais élargies automatiquement." : preparedOnlyChannel ? "Zones du brief, à vérifier dans le catalogue du compte avant publication. Aucun rayon fictif n’est appliqué." : undefined} maxItems={channelId === "linkedin" ? 8 : 20} maxItemLength={channelId === "linkedin" ? 80 : ["pinterest", "meta", "x", "tiktok"].includes(channelId) ? 120 : undefined} getTagStatus={channelId === "linkedin" ? linkedInBriefGeoStatus : channelId === "pinterest" ? (label) => {
            if (!effectivePinterestResources) return { label: pinterestResourcesLoad === "error" ? "À vérifier" : "Vérification…", verified: false };
            try { resolvePinterestAdsGeographies(effectivePinterestResources, [label]); return { label: "Vérifiée Pinterest", verified: true }; }
            catch { return { label: "Zone à ajuster", verified: false }; }
          } : undefined} />
          {channelId === "pinterest" && <PinterestLocationSearch catalog={effectivePinterestResources?.geographies} accountId={draft.adAccountId || externalStatuses.pinterest.selectedAccountId} locations={draft.targetLocations} onChange={(targetLocations) => updateDraft({ targetLocations })} />}
          {channelId === "google" && <GoogleLocationSearch accountId={draft.adAccountId || configuredAccountId} locations={draft.targetLocations} onChange={(targetLocations) => updateDraft({ targetLocations })} />}</div>;

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
        <nav className={styles.channelRail} aria-label="Choisir un canal publicitaire">{CHANNEL_CATALOG.map((channel, index) => {
          const locked = !pilotChannelsEnabled && !isAdsPublicChannel(channel.id);
          return <button type="button" key={channel.id} aria-label={`${channel.label}${locked ? " · canal verrouillé" : ""}`} title={locked ? `${channel.label} · Réservé à l’administration` : channel.label} data-channel={channel.id} data-locked={locked || undefined} data-near={index === channelIndex || index === (channelIndex + 1) % CHANNEL_CATALOG.length || index === (channelIndex - 1 + CHANNEL_CATALOG.length) % CHANNEL_CATALOG.length || undefined} onClick={() => selectChannel(index)} aria-pressed={index === channelIndex}><span className={styles.channelRailLogo} aria-hidden="true"><Image src={channel.logo} width={40} height={40} alt="" draggable={false} /></span><span className={styles.channelRailLabel}>{channel.label}</span></button>;
        })}</nav>
        <div className={styles.channelCarousel} data-testid="ads-channel-carousel">
          <button type="button" onClick={() => selectChannel(channelIndex - 1)} aria-label="Canal précédent">‹</button>
          <div className={styles.cubeStage} tabIndex={0} role="group" aria-label="Carrousel des canaux : flèches gauche et droite pour naviguer" onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); selectChannel(channelIndex + (event.key === "ArrowRight" ? 1 : -1)); } }} onPointerDown={(event) => { if (!(event.target as HTMLElement).closest("button,a")) channelPointerStart.current = { x: event.clientX, y: event.clientY }; }} onPointerUp={(event) => { const start = channelPointerStart.current; channelPointerStart.current = null; if (!start) return; const dx = event.clientX - start.x; if (Math.abs(dx) >= 58 && Math.abs(dx) > Math.abs(event.clientY - start.y) * 1.5) selectChannel(channelIndex + (dx < 0 ? 1 : -1)); }} onPointerCancel={() => { channelPointerStart.current = null; }}>
          {[-1, 0, 1].map((offset) => {
            const index = (channelIndex + offset + CHANNEL_CATALOG.length) % CHANNEL_CATALOG.length;
            const channel = CHANNEL_CATALOG[index];
            const externalChannel = isExternalChannel(channel.id) ? channel.id : null;
            const locked = !pilotChannelsEnabled && !isAdsPublicChannel(channel.id);
            const externalAdvertiserAccountUrl = externalChannel
              ? getAdsAdvertiserAccountUrl(externalChannel, externalStatuses[externalChannel].selectedAccountId)
              : null;
            return <div key={`${offset}-${channel.id}`} data-provider={channel.id} data-locked={locked || undefined} className={`${styles.channel} ${offset === 0 ? styles.channelActive : styles.channelMini}`}>
              {offset !== 0 && <button className={styles.miniSelect} type="button" aria-label={`Afficher ${channel.label}${locked ? " · canal verrouillé" : ""}`} onClick={() => selectChannel(index)} />}
              <span className={styles.channelLogo}><Image src={channel.logo} width={56} height={56} alt="" draggable={false} /></span>
              <div className={styles.channelIdentity}><strong>{channel.label}</strong><small>{channel.format}</small>{locked ? <span className={styles.channelStatus}>Verrouillé · en validation</span> : channel.provider ? <span className={styles.channelStatus} data-status={adsConnectionDisplay(connectionSnapshots[channel.provider]).tone}>{adsConnectionDisplay(connectionSnapshots[channel.provider]).label}</span> : channel.id === "openai" ? <span className={styles.channelStatus} data-status={adsConnectionDisplay(connectionSnapshots.openai).tone}>{adsConnectionDisplay(connectionSnapshots.openai).label}</span> : externalChannel ? <span className={styles.channelStatus} data-status={externalStatusDisplay(externalStatuses[externalChannel]).tone}>{externalStatusDisplay(externalStatuses[externalChannel]).label}</span> : null}</div>
              {offset === 0 && (channel.provider ? <div className={styles.channelActions}>
                {!locked && configuredAdvertiserAccountUrl ? <a className={styles.channelViewAccount} href={configuredAdvertiserAccountUrl} target="_blank" rel="noreferrer">Voir le compte</a> : null}
                <button type="button" className={styles.channelConfigure} onClick={() => openConfiguration(channel.provider!)}><span aria-hidden="true">⚙</span> Configurer</button>
              </div> : externalChannel ? <div className={styles.channelActions}>
                {!locked && externalAdvertiserAccountUrl ? <a className={styles.channelViewAccount} href={externalAdvertiserAccountUrl} target="_blank" rel="noreferrer">Voir le compte</a> : null}
                <button type="button" className={styles.channelConfigure} onClick={() => openExternalConfiguration(externalChannel)}><span aria-hidden="true">⚙</span> Configurer</button>
              </div> : channel.id === "openai" ? <div className={styles.channelActions}>
                {!locked && connectionSnapshots.openai.accountId ? <a className={styles.channelViewAccount} href={getAdsAdvertiserAccountUrl("openai", connectionSnapshots.openai.accountId) || "https://ads.openai.com/"} target="_blank" rel="noreferrer">Voir le compte</a> : null}
                <button type="button" className={styles.channelConfigure} onClick={() => openChannelConfiguration("openai")}><span aria-hidden="true">⚙</span> Configurer</button>
              </div> : null)}
            </div>;
          })}
          </div>
          <button type="button" onClick={() => selectChannel(channelIndex + 1)} aria-label="Canal suivant">›</button>
        </div>
      </section>

      <div className={styles.launchArea}>
        <button ref={launchButtonRef} type="button" onClick={startNewCampaign} disabled={!pilotChannelsEnabled && !isAdsPublicChannel(channelId)} className={`${styles.headerCta} ${styles.launchButton}`}><span aria-hidden="true">✦</span> {!pilotChannelsEnabled && !isAdsPublicChannel(channelId) ? "Canal verrouillé" : "Lancer une campagne"} <span aria-hidden="true">↗</span></button>
      </div>

      <SettingsDrawer title={campaignCreationTitle} isOpen={creating} onClose={() => { if (!demoDialog && busy !== "demo") void confirmCampaignExit(); }} closeOnEscape={!demoDialog && busy !== "demo"} closeOnBackdrop={!demoDialog && busy !== "demo"} presentation="centered" headerLead={<div className={styles.modalBrand}>iNr’<span>ADS</span><small>STUDIO DE CAMPAGNE</small></div>} headerStyle={campaignHeaderStyle(channelId)} headerContent={<div className={styles.wizardTitle}><span className={styles.wizardChannelLogo} aria-hidden="true"><Image src={channelMeta.logo} width={34} height={34} alt="" /></span><div>{campaignCreationTitle}<small>{displayedStepNames[step]} · Étape {step + 1} / {displayedStepNames.length}</small></div></div>}>
      <div data-channel={channelId} ref={studioWorkspaceRef} inert={busy === "demo" || undefined} className={`${styles.workspace} ${styles.studioWorkspace}`} data-compact={compactScreen || undefined} data-short={shortScreen || undefined} data-stage={step} data-creation-path={creationPath} data-analysis-setup={analysisSetupOpen || undefined} onTouchStart={(event) => { const touch = event.touches[0]; touchStart.current = { x: touch.clientX, y: touch.clientY }; }} onTouchEnd={(event) => { const start = touchStart.current; touchStart.current = null; if (!start || creationPath === "choice" || busy !== null) return; const touch = event.changedTouches[0]; const dx = touch.clientX - start.x; const dy = touch.clientY - start.y; if (Math.abs(dx) > 75 && Math.abs(dx) > Math.abs(dy) * 1.5 && !(event.target instanceof HTMLElement && event.target.closest("input, textarea, select, button"))) { const nextStep = step + (dx < 0 ? 1 : -1); if (dx < 0 && creationPath === "inrcy" && step === analysisStep && planProgress !== 100) return; navigateToStep(nextStep); } }}>
      <nav className={styles.stepper} aria-label="Étapes de création">{displayedStepNames.map((name, index) => <button type="button" key={name} disabled={(index !== step && !reachedStepKeys.includes(displayedStepKeys[index])) || busy === "plan" || busy === "demo"} aria-label={`${index + 1}. ${name}`} aria-current={step === index ? "step" : undefined} onClick={() => navigateToStep(index)}><span>{index + 1}</span>{!compactScreen && (channelId === "pinterest" ? PINTEREST_STEPPER_LABELS[name] || name : name)}</button>)}</nav>
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
        <StudioStepHeader number={foundationsStep + 1} label="CAMPAGNE" title={channelId === "pinterest" ? "Votre campagne et son objectif." : "La direction de votre campagne."} mobileTitle="Votre objectif" channel={channelMeta.label} />
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

          </>}
          {nativeSettings?.channel === "linkedin" && <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`} data-linkedin-provider-resources="true">
            <legend>Compte publicitaire et identité LinkedIn</legend>
            <p>LinkedIn range chaque nouvelle campagne dans un groupe. iNr’ADS sélectionne automatiquement un groupe compatible et la Page qui signe vos annonces quand une seule Page est disponible. Vous pouvez ajuster ces choix.</p>
            <div className={styles.studioControlOptions}>
              <span>{externalStatuses.linkedin.selectedAccountId
                ? `${externalStatuses.linkedin.selectedAccountName || "Compte LinkedIn Ads"} · ID ${externalStatuses.linkedin.selectedAccountId}`
                : "Aucun compte LinkedIn Ads associé"}</span>
              {linkedInPreflightLoad === "loading" && <small role="status">Vérification automatique des ressources LinkedIn…</small>}
              {linkedInPreflightLoad === "error" && <button type="button" className={styles.secondaryButton} disabled={!externalStatuses.linkedin.connected || !externalStatuses.linkedin.selectedAccountId} onClick={() => void loadLinkedInResources(true)}>
                Actualiser
              </button>}
            </div>
            {linkedInPreflightLoad === "error" && <p className={styles.campaignMediaError} role="alert">{linkedInPreflightError}</p>}
            {linkedInPreflight && <div className={styles.linkedInIdentityChoices}>
              <div className={styles.linkedInGroupChoice}>
                <span>Rangement dans LinkedIn</span>
                <strong>{selectedLinkedInCampaignGroup?.name || (draft.linkedinCampaignGroupId ? `Groupe ${draft.linkedinCampaignGroupId}` : linkedInPreflightLoad === "loading" ? "Recherche d’un groupe compatible…" : "Aucun groupe compatible sélectionné")}</strong>
                <small>Votre nouvelle campagne sera ajoutée à ce groupe.</small>
                <details open={!draft.linkedinCampaignGroupId || undefined}>
                  <summary>Changer de groupe</summary>
                  <label className={styles.field}>Groupe de campagnes
                <select value={draft.linkedinCampaignGroupId || ""} onChange={(event) => updateDraft({ linkedinCampaignGroupId: event.target.value })}>
                  <option value="">Sélectionnez un groupe vérifié</option>
                  {draft.linkedinCampaignGroupId && !linkedInCampaignGroups.some((group) => group.id === draft.linkedinCampaignGroupId) && <option value={draft.linkedinCampaignGroupId} disabled>Choix enregistré indisponible · ID {draft.linkedinCampaignGroupId}</option>}
                  {linkedInCampaignGroups.map((group) => <option key={group.id} value={group.id}>{group.name} · {group.status} · ID {group.id}</option>)}
                </select>
              </label>
                </details>
              </div>
              <label className={styles.field}>Page qui signe vos annonces
                <select value={draft.linkedinOrganizationUrn || ""} onChange={(event) => updateDraft({ linkedinOrganizationUrn: event.target.value })}>
                  <option value="">Sélectionnez une Page autorisée</option>
                  {draft.linkedinOrganizationUrn && !linkedInOrganizations.some((organization) => organization.urn === draft.linkedinOrganizationUrn) && <option value={draft.linkedinOrganizationUrn} disabled>Choix enregistré indisponible · {draft.linkedinOrganizationUrn}</option>}
                  {linkedInOrganizations.map((organization) => <option key={organization.urn} value={organization.urn}>{linkedInOrganizationLabel(organization)}</option>)}
                </select>
              </label>
            </div>}
            {linkedInPreflight && linkedInCampaignGroups.length === 0 && <small role="alert">Aucun groupe LinkedIn compatible avec l’objectif choisi n’est disponible sur ce compte.</small>}
            {linkedInPreflight && linkedInOrganizations.length === 0 && <small role="alert">Aucune Page avec un rôle Administrateur, Administrateur de contenu ou Sponsor direct autorisé n’est disponible.</small>}
            {selectedLinkedInCampaignGroup && selectedLinkedInCampaignGroup.status !== "ACTIVE" && <small>Ce groupe est en pause. La nouvelle campagne pourra être créée en pause ; choisissez un groupe actif pour la diffuser immédiatement.</small>}
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
              updatePinterestDelivery({ optimizationGoal: objectiveType === "AWARENESS" ? "impressions" : "pin_clicks" });
            }}>{PINTEREST_WIZARD_OBJECTIVES.map((value) => <option key={value} value={value}>{pinterestObjectiveLabel(value)}</option>)}</select><small>Notoriété et Considération peuvent être lancées aujourd’hui avec une image et le ciblage automatique. Les autres objectifs restent entièrement enregistrables en brouillon.</small></label>
          </>}
          {nativeSettings?.channel === "x" && <>
            <label className={styles.field}>Objectif X<select value={nativeSettings.objective} onChange={(event) => {
              const objective = event.target.value as XWizardSettings["objective"];
              updateNativeSettings({ ...nativeSettings, objective, format: objective === "video_views" ? "video" : nativeSettings.format });
            }}>{X_WIZARD_OBJECTIVES.map((value) => <option key={value} value={value}>{nativeBriefTerm(value)}</option>)}</select></label>
          </>}
          {!nativeSettings && channelId !== "openai" && channelId !== "google" && <>
            <label className={styles.field}>Objectif<select value={draft.objective} onChange={(event) => updateDraft({ objective: event.target.value as AdsCampaignInput["objective"] })}>{OBJECTIVE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label className={styles.field}>Action à mesurer<select value={draft.conversionGoal} onChange={(event) => updateDraft({ conversionGoal: event.target.value as AdsCampaignInput["conversionGoal"] })}>{CONVERSION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          </>}
        </div>
        {channelId === "google" && <p className={styles.studioTypeHint}>Compte Google Ads : {associatedAccountName || "À associer"}. L’IA prépare une campagne Réseau de recherche avec annonce textuelle responsive. Les autres types restent en brouillon jusqu’à leur intégration dédiée.</p>}
        {!nativeSettings && <><div className={styles.studioTypeGrid} role="radiogroup" aria-label="Type de campagne">{campaignTypeOptions.map((option) => <button type="button" role="radio" aria-checked={draft.campaignType === option.value} key={option.value} data-selected={draft.campaignType === option.value || undefined} onClick={() => updateDraft({ campaignType: option.value })}><strong>{option.label}</strong><small>{option.detail}{channelId === "google" && option.value !== "search" ? " · Brouillon uniquement" : ""}</small><span>{draft.campaignType === option.value ? "Choisi" : "Choisir"}</span></button>)}</div><p className={styles.studioTypeHint}>Un seul type par campagne : pour tester plusieurs leviers, créez ensuite une campagne dédiée à chacun.</p></>}
        {nativeSettings && <p className={styles.studioTypeHint}>{channelId === "pinterest" ? "La suite prépare le budget, les zones, l’audience, les enchères puis votre épingle. Toutes les confirmations sont regroupées à la fin." : channelId === "linkedin" ? "Choisissez ensuite les zones géographiques, l’audience, le format de l’annonce et son média." : nativeSettings.channel === "x" && nativeSettings.format === "text" ? "Le format texte ne nécessite aucun média ; le parcours passe directement à la diffusion." : "Le format est défini ; l’étape Médias est consacrée au fichier et à son aperçu."}</p>}
      </section>

      {(channelId === "meta" || channelId === "openai") && <>
        <section hidden={step !== geographyStep} data-channel={channelId} data-meta-geography={channelId === "meta" || undefined} data-openai-geography={channelId === "openai" || undefined} className={`${styles.card} ${styles.studioCard} ${styles.studioTargetingCard}`}>
          <StudioStepHeader number={geographyStep + 1} label="ZONES GÉOGRAPHIQUES" title="Les lieux où trouver vos futurs clients." mobileTitle="Vos zones" channel={channelMeta.label} />
          <p className={`${styles.intro} ${styles.studioOptionalIntro}`}>Les zones proposées par l’IA sont vérifiées dans {channelMeta.label}. Vous pouvez ajuster une proposition ici avant votre validation finale.</p>
          {channelId === "meta" ? <><div className={styles.studioGrid}>{campaignLocationFields}</div>{draft.metaDeliverySettings ? <MetaAdsLocationPicker accountId={metaResourceAccountId} locations={draft.targetLocations} targets={draft.metaGeoTargets || []} active={creating && channelId === "meta"} onChange={(metaGeoTargets) => { if (JSON.stringify(metaGeoTargets) !== JSON.stringify(draft.metaGeoTargets || [])) updateDraft({ metaGeoTargets }); }} onReadyChange={(ready, error) => setMetaGeoState((current) => current.key === metaGeoKey && current.ready === ready && current.error === error ? current : { key: metaGeoKey, ready, error })} onAddLocation={(label) => { if (!draft.targetLocations.includes(label)) updateDraft({ targetLocations: [...draft.targetLocations, label] }); }} /> : <div className={styles.studioControlPanel}><strong>Ciblage historique en France</strong><p>Ces lieux seront revérifiés en France avant publication. Pour choisir des zones précises du catalogue mondial et les nouveaux réglages Meta, vous pouvez actualiser cette proposition.</p><button type="button" className={styles.secondaryButton} onClick={() => updateMetaDelivery({})}>Actualiser les réglages Meta</button></div>}</> : <ChatGPTAdsGeography resources={effectiveOpenaiResources} loading={openaiResourcesLoad === "loading"} error={openaiResourcesError} query={openaiGeoQuery} onQueryChange={setOpenaiGeoQuery} onSearch={() => setOpenaiResourcesRevision((value) => value + 1)} locations={draft.targetLocations} onLocationsChange={(targetLocations) => updateDraft({ targetLocations })} />}
        </section>
        <section hidden={step !== biddingStep} data-channel={channelId} data-meta-bidding={channelId === "meta" || undefined} data-openai-bidding={channelId === "openai" || undefined} className={`${styles.card} ${styles.studioCard}`}>
          <StudioStepHeader number={biddingStep + 1} label="ENCHÈRES" title="Le résultat visé et son coût." mobileTitle="Vos enchères" channel={channelMeta.label} />
          <p className={`${styles.intro} ${styles.studioOptionalIntro}`}>La proposition est remplie automatiquement. Cette étape permet de consulter ou d’ajuster les enchères avant de tout valider à la fin.</p>
          {channelId === "meta" ? <MetaAdsBidding settings={metaDelivery} budgetEuros={metaDelivery.budget.type === "total" ? metaDelivery.budget.totalEuros || 0 : draft.dailyBudgetEuros} onChange={updateMetaDelivery} /> : <ChatGPTAdsBidding bidEuros={draft.openaiBidEuros} budgetEuros={openaiDelivery.budget.type === "total" ? openaiDelivery.budget.totalEuros || 0 : draft.dailyBudgetEuros} onBidChange={(openaiBidEuros) => updateDraft({ openaiBidEuros })} />}
        </section>
      </>}

      {channelId === "google" && <>
        <section hidden={step !== biddingStep} data-channel={channelId} data-google-bidding="true" className={`${styles.card} ${styles.studioCard}`}>
          <StudioStepHeader number={biddingStep + 1} label="ENCHÈRES GOOGLE" title="Quel résultat Google doit privilégier." mobileTitle="Vos enchères" channel={channelMeta.label} />
          <p className={styles.intro}>L’IA prépare une stratégie compatible. Les objectifs de conversion existants du compte sont vérifiés automatiquement ; aucun suivi n’est inventé.</p>
          <GoogleAdsBidding settings={googleDelivery} strategy={draft.bidStrategy} onStrategyChange={(bidStrategy) => updateDraft({ bidStrategy })} onChange={updateGoogleDelivery} conversionsReady={effectiveGoogleResources?.hasBiddableConversions ?? null} />
          <GoogleAdsMeasurement resources={effectiveGoogleResources} loading={googleResourcesLoad === "loading"} error={googleResourcesError} onRefresh={() => setGoogleResourcesRevision((value) => value + 1)} />
        </section>
        <section hidden={step !== geographyStep} data-channel={channelId} data-google-geography="true" className={`${styles.card} ${styles.studioCard} ${styles.studioTargetingCard}`}>
          <StudioStepHeader number={geographyStep + 1} label="ZONES GÉOGRAPHIQUES" title="Où trouver vos futurs clients." mobileTitle="Vos zones" channel={channelMeta.label} />
          <p className={styles.intro}>Les zones proposées seront vérifiées dans Google Ads avant la création. Vous pouvez les rechercher et ajuster leur périmètre ici.</p>
          <div className={styles.studioGrid}>{campaignLocationFields}<GoogleAdsGeography settings={googleDelivery} onChange={updateGoogleDelivery} /></div>
          <p className={styles.studioTypeHint} role="status">{googleGeoReady ? "✓ Toutes les zones ont été vérifiées dans Google Ads." : googleGeoState.key === googleGeoKey && googleGeoState.status === "error" ? googleGeoState.error : draft.targetLocations.length ? "Vérification automatique des villes et régions…" : "Les zones du brief apparaîtront ici."}</p>
          {googleGeoState.status === "error" && <button type="button" className={styles.secondaryButton} onClick={() => { googleResolvedGeoKey.current = ""; setGoogleGeoRevision((value) => value + 1); }}>Revérifier les zones</button>}
        </section>
      </>}

      {nativeSettings?.channel === "pinterest" && <>
        <section hidden={step !== geographyStep} data-channel={channelId} data-pinterest-geography="true" className={`${styles.card} ${styles.studioCard} ${styles.studioTargetingCard}`}>
          <StudioStepHeader number={geographyStep + 1} label="ZONES GÉOGRAPHIQUES" title="Les lieux où votre épingle sera diffusée." mobileTitle="Vos zones" channel={channelMeta.label} />
          <p className={`${styles.intro} ${styles.studioOptionalIntro}`}>Les lieux proposés par l’IA sont vérifiés dans Pinterest. Une zone indisponible reste à corriger ; elle n’est jamais remplacée par le pays entier.</p>
          <div className={styles.studioGrid}>{campaignLocationFields}</div>
          <p className={styles.studioTypeHint} role="status">{pinterestGeoReady ? `✓ ${pinterestResolvedGeography.zones.length} zone${pinterestResolvedGeography.zones.length > 1 ? "s" : ""} vérifiée${pinterestResolvedGeography.zones.length > 1 ? "s" : ""} dans Pinterest.` : pinterestResolvedGeography.error}</p>
          {pinterestGeoReady && <p className={styles.studioTypeHint}>{pinterestResolvedGeography.zones.map((zone) => zone.name).join(" · ")}</p>}
          {pinterestResourcesLoad === "error" && <button type="button" className={styles.secondaryButton} onClick={() => setPinterestResourcesRevision((value) => value + 1)}>Revérifier les ressources Pinterest</button>}
        </section>
        <section hidden={step !== biddingStep} data-channel={channelId} className={`${styles.card} ${styles.studioCard}`}>
          <StudioStepHeader number={biddingStep + 1} label="ENCHÈRES PINTEREST" title="Le résultat visé et son coût." mobileTitle="Vos enchères" channel={channelMeta.label} />
          <p className={`${styles.intro} ${styles.studioOptionalIntro}`}>{creationPath === "inrcy" ? "L’IA prépare une stratégie automatique adaptée à votre objectif. Consultez ou ajustez cette proposition si vous le souhaitez." : "Choisissez l’optimisation et les enchères adaptées à votre objectif."}</p>
          <PinterestAdsBidding settings={pinterestDelivery} objectiveType={nativeSettings.objectiveType} budgetEuros={pinterestDelivery.budget.type === "total" ? Number(pinterestDelivery.budget.totalEuros || 0) : draft.dailyBudgetEuros} onChange={updatePinterestDelivery} />
        </section>
      </>}

      {preparedOnlyChannel && <>
        <section hidden={step !== geographyStep} data-channel={channelId} data-x-geography={channelId === "x" || undefined} data-tiktok-geography={channelId === "tiktok" || undefined} className={`${styles.card} ${styles.studioCard} ${styles.studioTargetingCard}`}>
          <StudioStepHeader number={geographyStep + 1} label="ZONES GÉOGRAPHIQUES" title="Les lieux où trouver vos futurs clients." mobileTitle="Vos zones" channel={channelMeta.label} />
          <p className={styles.intro}>L’IA reprend vos zones d’activité. Les lieux restent compacts et modifiables ; aucun pays n’est ajouté automatiquement.</p>
          <div className={styles.studioGrid}>{campaignLocationFields}</div>
          {channelId === "tiktok" ? <TikTokAdsLocationPicker accountId={tikTokAccountId} locations={draft.targetLocations} active={creating && externalStatuses.tiktok.connected && nativeSettings?.channel === "tiktok" && nativeSettings.objectiveType === "TRAFFIC" && nativeSettings.placementIntent === "tiktok_only"} onChange={(targetLocations) => updateDraft({ targetLocations })} onResolvedTargets={(targets) => { if (draft.provider === "tiktok" && draft.tiktokNativeSelections?.advertiserId === tikTokAccountId && JSON.stringify(draft.tiktokNativeSelections.locationIds) !== JSON.stringify(targets.map((item) => item.id))) updateDraft({ tiktokNativeSelections: { ...draft.tiktokNativeSelections, locationIds: targets.map((item) => item.id) } }); }} /> : <XAdsLocationPicker accountId={externalStatuses.x.selectedAccountId || draft.adAccountId} locations={draft.targetLocations} selections={draft.xNativeSelections} active={creating && externalStatuses.x.connected} onChange={(targetLocations, xNativeSelections) => updateDraft({ targetLocations, xNativeSelections })} />}
        </section>
        <section hidden={step !== biddingStep} data-channel={channelId} data-prepared-bidding="true" className={`${styles.card} ${styles.studioCard}`}>
          <StudioStepHeader number={biddingStep + 1} label="ENCHÈRES ET OPTIMISATION" title="Le résultat visé et son coût." mobileTitle="Vos enchères" channel={channelMeta.label} />
          <PreparedAdsBidding settings={preparedDelivery} channel={channelId} optimizationIntent={nativeSettings?.channel === "tiktok" ? nativeSettings.optimizationIntent : undefined} budgetEuros={preparedDelivery.budget.type === "total" ? preparedDelivery.budget.totalEuros || 0 : draft.dailyBudgetEuros} onChange={updatePreparedDelivery} />
          {nativeSettings?.channel === "tiktok" && <div className={styles.studioControlPanel}><strong>Résultat préparé : {nativeBriefTerm(nativeSettings.optimizationIntent)}</strong><p>L’optimisation suit l’objectif de votre campagne. Le mode de facturation et l’événement de conversion seront vérifiés dans le compte TikTok ; le brief ne crée aucune balise.</p></div>}
        </section>
      </>}
      {nativeSettings?.channel === "tiktok" && <section hidden={step !== identityStep} data-channel={channelId} data-tiktok-identity="true" className={`${styles.card} ${styles.studioCard}`}>
        <StudioStepHeader number={identityStep + 1} label="IDENTITÉ PUBLICITAIRE" title="Le compte qui signe votre vidéo." mobileTitle="Votre identité" channel={channelMeta.label} />
        <div className={styles.studioControlPanel}><strong>{effectiveTikTokResources?.account.name || "Compte annonceur à connecter"}</strong><p>{tikTokIdentityMessage}</p>
          {effectiveTikTokResources?.identities.length === 1 && <small>Cette identité provient d’une lecture du compte autorisé, jamais d’une invention de l’IA.</small>}
          {effectiveTikTokResources && effectiveTikTokResources.identities.length > 1 && <details><summary>Voir les identités autorisées</summary><ul>{effectiveTikTokResources.identities.map((identity) => <li key={identity.type + identity.id + (identity.authorizedBusinessCenterId || "")}>{identity.displayName}</li>)}</ul></details>}
          <p>Une vidéo non Spark ou une publication Spark nécessitera les droits correspondants. Le premier parcours préparé vise une vidéo de trafic vers le site ; aucune publication organique n’est autorisée ici.</p>
          <button type="button" className={styles.secondaryButton} disabled={!externalStatuses.tiktok.connected || tikTokResourcesLoad === "loading" || busy !== null} onClick={() => setTikTokResourcesRevision((value) => value + 1)}>Revérifier le compte et l’identité</button>
        </div>
      </section>}
      {nativeSettings?.channel === "linkedin" && <section hidden={step !== geographyStep} data-channel={channelId} data-linkedin-geography="true" className={`${styles.card} ${styles.studioCard} ${styles.studioTargetingCard}`}>
        <StudioStepHeader number={geographyStep + 1} label="ZONES GÉOGRAPHIQUES" title="Où diffuser votre campagne." mobileTitle="Vos zones" channel={channelMeta.label} />
        <p className={`${styles.intro} ${styles.studioOptionalIntro}`}>L’IA propose les zones de votre brief. Vérifiez les lieux retenus, puis choisissez si vous visez les résidents ou aussi les personnes récemment présentes.</p>
        <div className={styles.studioGrid}>
          {campaignLocationFields}
          <div className={styles.studioWide} data-linkedin-geography-controls="true">
            <label className={styles.field}>Type de localisation<select value={linkedInDelivery.locationType} onChange={(event) => updateLinkedInDelivery({ ...linkedInDelivery, locationType: event.target.value as LinkedInDeliverySettings["locationType"] })}><option value="recent_or_permanent">Résidence ou présence récente</option><option value="permanent">Résidence permanente uniquement</option></select></label>
            <LinkedInAdsLocationPicker resolutions={linkedInGeoResolutions} targets={linkedInGeoTargets} verifiedUrns={linkedInVerifiedGeoUrns} busy={linkedInPreflightLoad === "loading"} query={linkedInGeoQuery} onQueryChange={setLinkedInGeoQuery} onChoiceRecorded={(query, urn) => { linkedInGeoChoices.current[linkedInGeoQueryKey(query)] = urn; }} onSearch={() => void loadLinkedInResources(true, linkedInGeoQuery.trim())} onChoose={(previousUrn, target) => {
              if (previousUrn && previousUrn !== target?.urn) linkedInGeoDismissedUrns.current.add(previousUrn);
              if (target) linkedInGeoDismissedUrns.current.delete(target.urn);
              const retained = linkedInGeoTargets.filter((item) => item.urn !== previousUrn);
              updateDraft({ linkedinGeoTargets: normalizeLinkedInGeoTargets(target ? [...retained, target] : retained) || retained });
            }} onRemove={(urn) => { linkedInGeoDismissedUrns.current.add(urn); updateDraft({ linkedinGeoTargets: linkedInGeoTargets.filter((target) => target.urn !== urn) }); }} />
          </div>
        </div>
      </section>}

      <section hidden={step !== targetingStep} data-linkedin-audience={channelId === "linkedin" || undefined} data-channel={channelId} className={`${styles.card} ${styles.studioCard} ${styles.studioTargetingCard}`}>
        <StudioStepHeader number={targetingStep + 1} label={channelId === "google" ? "PARAMÈTRES GOOGLE" : channelId === "pinterest" ? "AUDIENCE PINTEREST" : channelId === "linkedin" ? "AUDIENCE LINKEDIN" : channelId === "meta" ? "AUDIENCE META" : channelId === "openai" ? "AUDIENCE ET CONTEXTE" : "CIBLAGE"} title={channelId === "google" ? "Les surfaces et les profils utiles." : channelId === "pinterest" ? "À qui montrer vos idées." : channelId === "linkedin" ? "À quels professionnels parler." : channelId === "meta" ? "Les personnes à qui montrer votre offre." : channelId === "openai" ? "Votre offre, dans les conversations pertinentes." : "Les profils et les surfaces utiles."} mobileTitle="Votre ciblage" channel={channelMeta.label} />
        <p className={`${styles.intro} ${styles.studioOptionalIntro}`}>{channelId === "pinterest" ? "L’IA prépare le message pour vos clients. Pinterest utilise le contenu de l’épingle pour trouver les profils intéressés, dans vos zones validées." : channelId === "linkedin" ? "L’IA traduit vos clients prioritaires en critères LinkedIn. Ajustez les profils et leur langue ; les zones se règlent à l’étape précédente." : channelId === "meta" || channelId === "openai" ? "L’IA prépare le message pour vos clients. Les lieux se règlent à l’étape Zones géographiques ; les filtres réellement transmis sont expliqués ici." : "Les profils guident le message ; les zones se règlent séparément. Les critères exacts seront vérifiés dans le compte."}</p>
        <div className={styles.studioGrid}>
          {!preparedOnlyChannel && channelId !== "linkedin" && channelId !== "google" && channelId !== "pinterest" && channelId !== "meta" && channelId !== "openai" && campaignLocationFields}
          <TagField className={styles.studioAudienceField} wide label={channelId === "openai" ? "Profils pour guider le message" : "Clients / audiences prioritaires"} helper={channelId === "linkedin" ? "Ce brief guide l’IA. Les critères de diffusion sont sélectionnés ci-dessous." : channelId === "openai" ? "Pour le texte uniquement, sans ciblage d’audience personnalisée." : channelId === "pinterest" ? "Ces profils guident le message. Le ciblage automatique Pinterest s’appuie sur l’épingle et les zones retenues." : channelId === "google" ? "Ces profils guident les messages de l’IA ; ils ne sont pas des filtres d’audience envoyés à Google Ads." : channelId === "meta" ? "Ces profils guident le message de l’IA. Les âges et langues ci-dessous sont les filtres réellement transmis à Meta." : "Ces profils guident le message. Les critères de ciblage exacts seront vérifiés dans le compte annonceur."} values={draft.targetAudiences} onChange={(targetAudiences) => updateDraft({ targetAudiences })} placeholder={channelId === "linkedin" ? "Ex. dirigeants de petites entreprises" : "Ex. Propriétaires de maison"} />
          {channelId !== "openai" && channelId !== "linkedin" && channelId !== "google" && channelId !== "pinterest" && channelId !== "meta" && <TagField className={styles.studioLanguageField} wide label="Langue du message" helper="Cette langue guide la rédaction de l’IA. Elle ne crée pas de filtre de langue natif sur TikTok ou X." values={draft.languages} onChange={(languages) => updateDraft({ languages })} placeholder="Ex. fr ou en" />}
          {channelId === "google" && <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}><legend>Réseaux Google</legend><p>Choisissez les surfaces envisagées. Ces choix sont transmis à Google Ads. La recherche Google est toujours incluse.</p><div className={styles.studioControlOptions}><label><input type="checkbox" checked={draft.googleSearchPartners} onChange={(event) => updateDraft({ googleSearchPartners: event.target.checked })} />Partenaires du Réseau de Recherche</label><label><input type="checkbox" checked={draft.googleDisplayExpansion} onChange={(event) => updateDraft({ googleDisplayExpansion: event.target.checked })} />Extension Display lorsque pertinente</label></div></fieldset>}
          {channelId === "google" && <div className={`${styles.studioControlPanel} ${styles.studioWide}`}><strong>Langues automatiques sur Google Search</strong><p>Google adapte les langues à vos annonces, à votre site et à la recherche. Le brief de langue sert à rédiger l’annonce ; aucun filtre de langue obsolète n’est ajouté.</p><small>Segments d’audience : aucun filtre démographique ou segment de compte n’est ajouté. Le ciblage repose sur vos recherches et vos zones.</small></div>}
          {nativeSettings?.channel === "linkedin" && <div className={styles.studioWide} data-linkedin-targeting="true">
            <div className={styles.linkedInAudienceControls}>
              <label className={styles.field}>Langue des profils ciblés<select value={nativeSettings.locale.language + "_" + nativeSettings.locale.country} onChange={(event) => { const [language, country] = event.target.value.split("_"); updateNativeSettings({ ...nativeSettings, locale: { language, country } }); updateDraft({ languages: [language] }); }}>{(linkedInPreflight?.supportedLocales?.length ? linkedInPreflight.supportedLocales : [nativeSettings.locale]).map((locale) => <option key={locale.language + "_" + locale.country} value={locale.language + "_" + locale.country}>{new Intl.DisplayNames(["fr"], { type: "language" }).of(locale.language) || locale.language}</option>)}</select><small>Langues réellement disponibles dans LinkedIn.</small></label>

            </div>

            <LinkedInAdsAudience accountId={draft.adAccountId || externalStatuses.linkedin.selectedAccountId} language={nativeSettings.locale.language} country={nativeSettings.locale.country} targeting={linkedInDelivery.professionalTargeting} suggestions={linkedInAudienceSuggestions} active={creating} onChange={(professionalTargeting) => updateLinkedInDelivery({ ...linkedInDelivery, professionalTargeting })} onPendingChange={setLinkedInAudiencePending} />
            <small role="status">{typeof linkedInPreflight?.selected?.audienceCount === "number" ? `Audience estimée par LinkedIn : ${linkedInPreflight.selected.audienceCount.toLocaleString("fr-FR")} membres. ` : "LinkedIn vérifie la taille de l’audience avant le lancement. "}Minimum requis : 300 membres.</small>
          </div>}
          {nativeSettings?.channel === "tiktok" && <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}><legend>Audience TikTok</legend><div className={styles.studioControlOptions}><label>Approche d’audience<select value={nativeSettings.targetingMode} onChange={(event) => updateNativeSettings({ ...nativeSettings, targetingMode: event.target.value as TikTokWizardSettings["targetingMode"] })}><option value="broad">Audience large</option><option value="interests">Centres d’intérêt</option></select></label></div><small>Les intérêts exacts devront être vérifiés dans le compte annonceur.</small><div className={styles.studioControlOptions}><label className={styles.field}>Emplacements envisagés<select value={nativeSettings.placementIntent} onChange={(event) => updateNativeSettings({ ...nativeSettings, placementIntent: event.target.value as TikTokWizardSettings["placementIntent"] })}><option value="tiktok_only">TikTok uniquement</option><option value="automatic">Placements automatiques</option></select><small>La disponibilité sera vérifiée dans le compte annonceur.</small></label></div></fieldset>}
          {nativeSettings?.channel === "pinterest" && <>
            <div className={`${styles.field} ${styles.studioWide}`}>
              <TagField label="Langues des personnes ciblées" helper="Langues proposées par l’IA et vérifiées dans Pinterest." values={draft.languages} onChange={(languages) => updateDraft({ languages })} placeholder="Ex. français" maxItems={10} />
              <label className={styles.field}>Ajouter une langue Pinterest<select value="" disabled={pinterestResourcesLoad !== "ready"} onChange={(event) => { if (event.target.value && !pinterestResolvedLanguages.ids.includes(event.target.value) && draft.languages.length < 10) updateDraft({ languages: [...draft.languages, event.target.value] }); }}><option value="">Choisir une langue disponible</option>{effectivePinterestResources?.locales.map((locale) => <option key={locale.id} value={locale.id} disabled={pinterestResolvedLanguages.ids.includes(locale.id)}>{locale.name}</option>)}</select></label>
              {pinterestResolvedLanguages.error && <small role="status">{pinterestResolvedLanguages.error}</small>}
            </div>
            <PinterestAdsDistribution settings={pinterestDelivery} onChange={updatePinterestDelivery} />
          </>}
          {nativeSettings?.channel === "pinterest" && <label className={`${styles.field} ${styles.studioTargetingMode}`} >Mode de ciblage Pinterest<select value={nativeSettings.targetingMode} onChange={(event) => updatePinterestTargetingMode(event.target.value as PinterestWizardSettings["targetingMode"])}><option value="automatic">Ciblage automatique — recommandé · publiable</option><option value="interests">Centres d’intérêt · brouillon</option><option value="keywords">Recherches / mots-clés · brouillon</option><option value="audiences">Audiences existantes · brouillon</option></select><small>{nativeSettings.targetingMode === "automatic" ? "Pinterest optimise l’audience à partir du contenu de votre Pin, dans les zones choisies." : "Ce mode reste en brouillon jusqu’à la sélection de ses audiences dans Pinterest Ads."}</small>{nativeSettings.targetingMode === "automatic" && draft.keywords.length > 0 && <small role="alert">Retirez les anciens signaux manuels pour utiliser le ciblage automatique. <button type="button" className={styles.secondaryButton} onClick={clearPinterestManualSignals}>Retirer les signaux manuels</button></small>}</label>}
          {nativeSettings?.channel === "x" && <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}><legend>Audience X</legend><p>Votre choix oriente les signaux à détailler à l’étape suivante.</p><div className={styles.studioControlOptions}><label>Approche de ciblage<select value={nativeSettings.targetingMode} onChange={(event) => { const targetingMode = event.target.value as XWizardSettings["targetingMode"]; updateNativeSettings({ ...nativeSettings, targetingMode }); if (targetingMode !== "keywords") updateDraft({ keywords: [] }); }}><option value="broad">Audience large</option><option value="keywords">Mots-clés</option><option value="interests">Centres d’intérêt</option><option value="follower_lookalikes">Audiences similaires aux abonnés</option></select></label></div></fieldset>}
          {channelId === "meta" && draft.metaDeliverySettings && <MetaAdsAudience settings={metaDelivery} languages={metaResolvedLanguages.error ? draft.languages : metaResolvedLanguages.ids.map(String)} locales={effectiveMetaResources?.locales || []} onLanguagesChange={(languages) => updateDraft({ languages })} onChange={updateMetaDelivery} />}
          {channelId === "meta" && !draft.metaDeliverySettings && <div className={`${styles.studioControlPanel} ${styles.studioWide}`}><strong>Audience du parcours historique</strong><p>Le brief guide le message ; ses langues ne sont pas des filtres transmis à Meta. Les nouveaux réglages d’âge et de langue apparaîtront après actualisation de la proposition.</p></div>}
          {channelId === "openai" && <div className={`${styles.studioControlPanel} ${styles.studioWide}`}><strong>Contexte de votre carte ChatGPT</strong><p>L’offre de l’étape Campagne aide ChatGPT à rapprocher l’annonce des conversations pertinentes. Les profils du brief servent à rédiger le message ; aucun filtre d’audience personnalisée n’est ajouté.</p></div>}
        </div>
      </section>

      <section hidden={step !== keywordsStep} data-channel={channelId} className={`${styles.card} ${styles.studioCard} ${styles.studioKeywordsCard}`}>
        {channelId === "linkedin" ? <StudioStepHeader number={keywordsStep + 1} label="FORMAT PUBLICITAIRE" title="Comment présenter votre annonce." mobileTitle="Votre format" channel={channelMeta.label} /> : <StudioStepHeader number={keywordsStep + 1} label={channelId === "google" ? "MOTS-CLÉS" : channelId === "pinterest" ? "DÉCOUVERTE PINTEREST" : "SIGNAUX"} title={channelId === "google" ? "Les recherches à capter." : channelId === "pinterest" ? "Comment votre idée doit être découverte." : "Les signaux qui orientent votre audience."} mobileTitle={channelId === "google" ? "Vos mots-clés" : channelId === "pinterest" ? "Votre découverte" : "Vos signaux"} channel={channelMeta.label} />}
        {channelId !== "linkedin" && <>        <p className={`${styles.intro} ${styles.studioOptionalIntro}`}>{channelId === "google" ? "Cette étape est dédiée aux requêtes de vos futurs clients. Ajoutez les expressions commerciales à viser et celles à écarter." : channelId === "meta" ? "Ajoutez les intérêts, besoins et angles qui aident à orienter votre audience Meta." : `Détaillez les ${nativeSettings?.channel === "x" && nativeSettings.targetingMode === "keywords" || nativeSettings?.channel === "pinterest" && nativeSettings.targetingMode === "keywords" ? "mots-clés" : "signaux"} prévus pour ${channelMeta.label}. Les valeurs exactes seront confirmées dans le compte Ads.`}</p></>}
        {nativeSettings?.channel === "linkedin" ? <div className={styles.studioGrid}>            <label className={styles.field}>Format sponsorisé<select value={nativeSettings.format} onChange={(event) => updateNativeSettings({ ...nativeSettings, format: event.target.value as LinkedInWizardSettings["format"] })}>{LINKEDIN_WIZARD_FORMATS[nativeSettings.objectiveType].map((format) => <option key={format} value={format}>{nativeBriefTerm(format)}{format === "STANDARD_UPDATE" || format === "SINGLE_VIDEO" ? " · publiable" : " · brouillon"}</option>)}</select><small>Ce choix fixe les ressources à préparer dans l’étape Médias dédiée.</small></label>
          <aside className={styles.studioKeywordGuidance}><strong>Un format par groupe de publicités</strong><p>Le choix adapte le texte, le média et les réglages suivants. Les formats qui nécessitent encore une intégration restent identifiés comme brouillons.</p></aside>
        </div> : <>
        <div className={styles.studioGrid}>
          {channelId === "google" ? <TagField wide label={draft.campaignType === "performance_max" ? "Thèmes de recherche / signaux d’intention" : "Mots-clés recherchés"} helper="Saisissez une expression, puis Entrée. Le micro ajoute vos mots-clés dictés." values={draft.keywords} onChange={(keywords) => updateDraft({ keywords })} placeholder="Ex. installation panneaux solaires" maxItems={20} maxItemLength={80} /> : nativeSettings?.channel === "pinterest" && nativeSettings.targetingMode === "automatic" ? <aside className={`${styles.studioKeywordGuidance} ${styles.studioWide}`}><strong>La découverte est préparée automatiquement</strong><p>L’IA remplit le profil prioritaire, les zones, le titre, la description et le brief visuel. Pinterest utilise ensuite le contenu du Pin pour optimiser l’audience ; aucun ID d’intérêt ou d’audience n’est inventé.</p>{draft.keywords.length > 0 && <><p role="alert">{draft.keywords.length} signal{draft.keywords.length > 1 ? "aux manuels restent" : " manuel reste"} enregistré{draft.keywords.length > 1 ? "s" : ""}. Retirez-les pour lancer cette campagne en ciblage automatique.</p><button type="button" className={styles.secondaryButton} onClick={clearPinterestManualSignals}>Retirer les signaux manuels</button></>}</aside> : <label className={`${styles.field} ${styles.studioWide}`}>{nativeSettings?.channel === "pinterest" && nativeSettings.targetingMode === "keywords" || nativeSettings?.channel === "x" && nativeSettings.targetingMode === "keywords" ? "Mots-clés à envisager" : nativeSettings?.channel === "pinterest" && nativeSettings.targetingMode === "audiences" ? "Audiences Pinterest à retrouver dans le compte" : nativeSettings?.channel === "pinterest" && nativeSettings.targetingMode === "interests" ? "Centres d’intérêt Pinterest à vérifier" : nativeSettings?.channel === "x" && nativeSettings.targetingMode === "follower_lookalikes" ? "Comptes ou communautés similaires à étudier" : "Centres d’intérêt, signaux ou angles de ciblage"}<small>Un par ligne</small><CampaignTextarea className={styles.studioAdaptiveContentTextarea} rows={6} value={editableList(draft.keywords)} onChange={(event) => updateDraft({ keywords: parseEditableList(event.target.value.split("\n")) })} placeholder="Ex. rénovation énergétique\nMaison individuelle\nÉconomies d’énergie" /></label>}

          {nativeSettings && !(nativeSettings.channel === "pinterest" && nativeSettings.targetingMode === "automatic") && <aside className={`${styles.studioKeywordGuidance} ${styles.studioWide}`}><strong>Des pistes, pas des identifiants publicitaires</strong><p>Ces idées restent dans votre brouillon. iNr’ADS ne les convertit pas automatiquement en audiences ou mots-clés de la plateforme ; vérifiez leur disponibilité avant une création réelle.</p></aside>}
          {channelId === "google" && <GoogleAdsKeywords settings={googleDelivery} onChange={updateGoogleDelivery} />}
          {channelId === "google" && <TagField wide label="Mots-clés à exclure" helper="Écartez les recherches non pertinentes ; ajoutez-les aussi à la voix." values={draft.negativeKeywords} onChange={(negativeKeywords) => updateDraft({ negativeKeywords })} placeholder="Ex. emploi" maxItems={40} maxItemLength={80} />}
          {channelId === "meta" && <aside className={`${styles.studioKeywordGuidance} ${styles.studioWide}`}><strong>Un signal, pas une contrainte rigide</strong><p>iNrCy les combine à vos zones, à votre offre et au comportement observé par Meta. Vous gardez le contrôle sur les audiences définies à l’étape précédente.</p></aside>}
        </div>
        </>}
      </section>

      <section hidden={step !== creativeStep} data-channel={channelId} className={`${styles.card} ${styles.studioCard} ${styles.studioCreativeCard}`}>
        <StudioStepHeader number={creativeStep + 1} label={channelId === "pinterest" ? "ÉPINGLE SPONSORISÉE" : "CRÉATIONS"} title={channelId === "pinterest" ? "Le titre et la description de votre Pin." : "Des messages qui donnent envie d’agir."} mobileTitle={channelId === "pinterest" ? "Votre épingle" : "Vos messages"} channel={channelMeta.label} />
        <p className={`${styles.intro} ${styles.studioOptionalIntro}`}>{channelId === "pinterest" ? creationPath === "inrcy" ? "Le titre, la description et l’image sont préparés par l’IA. Vous pouvez ajuster chaque élément avant la validation finale." : "Préparez le titre et la description de votre épingle avant d’ajouter son image." : "Vous pouvez écrire vous-même, partir de la proposition iNrCy et ajuster chaque mot. Vérifiez les exigences du canal avant une éventuelle publication."}</p>
        <div className={styles.studioGrid}>
          {nativeSettings?.channel === "x" && <>
            <label className={styles.field}>Format du post X Ads<select value={nativeSettings.format} onChange={(event) => updateNativeSettings({ ...nativeSettings, format: event.target.value as XWizardSettings["format"] })}>{(nativeSettings.objective === "video_views" ? ["video"] : ["text", "image", "video"]).map((value) => <option key={value} value={value}>{nativeBriefTerm(value)}</option>)}</select><small>{nativeSettings.format === "text" ? "Le post texte est le seul format X Ads sans étape Média." : "Le fichier sera préparé dans l’étape Médias dédiée à X Ads."}</small></label>
          </>}

          {channelId !== "google" && <label className={`${styles.field} ${styles.studioWide} ${styles.studioMessageField}`}>{channelId === "x" ? "Texte du post X" : channelId === "tiktok" ? "Texte de l’annonce TikTok" : channelId === "pinterest" ? "Description de l’épingle" : channelId === "linkedin" ? "Introduction de la publication" : channelId === "openai" ? "Texte de la carte ChatGPT · 100 caractères max." : "Message principal"}<VoiceTextarea value={draft.primaryText} onChange={(primaryText) => updateDraft({ primaryText })} rows={2} maxLength={channelId === "linkedin" ? 300 : channelId === "openai" || channelId === "tiktok" ? 100 : channelId === "pinterest" ? 800 : channelId === "x" ? 280 : 500} purpose="content" contextLabel="Message principal de la campagne" placeholder="Présentez l’offre, son bénéfice concret et la prochaine action à réaliser." /></label>}
          {channelId === "linkedin" ? <label className={styles.field}>Titre de l’annonce<input value={draft.headlines[0] || ""} maxLength={200} onChange={(event) => updateDraft({ headlines: [event.target.value] })} placeholder="Un bénéfice clair pour votre audience" /><small>Un seul titre · 200 caractères maximum.</small></label> : <>          {channelId === "google" ? <GoogleAdCopyField label="Titres" singular="Titre" values={draft.headlines} onChange={(headlines) => updateDraft({ headlines })} minItems={3} maxItems={15} maxLength={30} /> : channelId === "openai" ? <label className={styles.field}>Titre de la carte ChatGPT · 3 à 50 caractères<input type="text" maxLength={50} value={draft.headlines[0] || ""} onChange={(event) => updateDraft({ headlines: event.target.value ? [event.target.value] : [] })} /></label> : channelId === "meta" ? <label className={styles.field}>Titre de l’annonce Meta<input value={draft.headlines[0] || ""} maxLength={30} onChange={(event) => updateDraft({ headlines: event.target.value ? [event.target.value] : [] })} /><small>Un seul titre · 30 caractères maximum dans ce parcours.</small></label> : channelId !== "tiktok" && channelId !== "x" && <label className={styles.field}>{channelId === "pinterest" ? "Titre de l’épingle" : "Titres ou accroches (un par ligne)"}<CampaignTextarea rows={2} value={editableList(draft.headlines)} aria-invalid={channelId === "pinterest" && (draft.headlines.length !== 1 || draft.headlines.some((title) => title.length > 100)) || undefined} onChange={(event) => updateDraft({ headlines: parseEditableList(event.target.value.split("\n")) })} />{channelId === "pinterest" && <small className={draft.headlines.some((title) => title.length > (channelId === "pinterest" ? 100 : 200)) || channelId === "pinterest" && draft.headlines.length !== 1 ? styles.copyLengthError : undefined}>{channelId === "pinterest" ? "Un seul titre · 100 caractères maximum" : "200 caractères maximum par titre ; reformulez tout dépassement."}</small>}{channelId === "pinterest" && draft.headlines.length > 1 && <small className={styles.copyLengthError} role="alert">Choisissez un seul titre pour votre épingle. Vos propositions sont conservées ci-dessus.</small>}</label>}</>}
          {channelId === "google" ? <GoogleAdCopyField label="Descriptions" singular="Description" values={draft.descriptions} onChange={(descriptions) => updateDraft({ descriptions })} minItems={2} maxItems={4} maxLength={90} /> : channelId === "meta" && <label className={styles.field}>Description de l’annonce · facultatif<input value={draft.descriptions[0] || ""} maxLength={90} onChange={(event) => updateDraft({ descriptions: event.target.value ? [event.target.value] : [] })} /></label>}
          {channelId === "linkedin" ? <LinkedInAdsCallToAction value={linkedInDelivery.callToAction} onChange={(callToAction) => { updateLinkedInDelivery({ ...linkedInDelivery, callToAction }); updateDraft({ callToAction: LINKEDIN_CTA_LABELS[callToAction] }); }} /> : channelId === "meta" ? <label className={styles.field}>Bouton de votre annonce<select value={metaDelivery.callToAction} onChange={(event) => updateMetaDelivery({ callToAction: event.target.value as MetaDeliverySettings["callToAction"] })}>{META_CALL_TO_ACTIONS.map((value) => <option key={value} value={value}>{META_CALL_TO_ACTION_LABELS[value]}</option>)}</select></label> : <>          {channelId === "tiktok" ? <label className={`${styles.field} ${styles.studioCtaField}`}>Bouton TikTok proposé<select value={draft.tiktokNativeSelections?.callToAction || "LEARN_MORE"} onChange={(event) => {
            const code = event.target.value;
            updateDraft({ callToAction: PREPARED_TIKTOK_CTA_LABELS[code], ...(draft.tiktokNativeSelections ? { tiktokNativeSelections: { ...draft.tiktokNativeSelections, callToAction: code } } : {}) });
          }}>{Object.entries(PREPARED_TIKTOK_CTA_LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select><small>Sa disponibilité sera confirmée dans le compte TikTok avant la création.</small></label> : channelId !== "openai" && channelId !== "google" && channelId !== "pinterest" && <label className={`${styles.field} ${styles.studioCtaField}`}>Appel à l’action<input value={draft.callToAction} maxLength={80} onChange={(event) => updateDraft({ callToAction: event.target.value })} placeholder="Ex. Demander un devis" /></label>}</>}
          {channelId === "google" && <GoogleAdsRSAFields settings={googleDelivery} onChange={updateGoogleDelivery} />}
          {channelId !== "google" && <aside className={`${styles.studioCopyGuidance} ${styles.field}`}><strong>À vérifier</strong><p>{channelId === "openai" ? "La carte publiée utilisera exactement le titre, le texte et l’image vérifiés ici. La personnalisation du texte dans Ads Manager n’est pas pilotée par ce parcours." : nativeSettings?.channel === "linkedin" ? "Le texte doit correspondre au format sponsorisé choisi, notamment si vous préparez un formulaire de prospects." : nativeSettings?.channel === "tiktok" ? "Gardez un texte court qui accompagne la vidéo et une action cohérente avec sa destination." : nativeSettings?.channel === "pinterest" ? "Le titre, la description et le visuel doivent présenter la même idée." : nativeSettings?.channel === "x" ? "Votre post doit être clair sans dépasser 280 caractères ; vérifiez le média si vous avez choisi image ou vidéo." : "Relisez la cohérence entre votre message, votre appel à l’action et le média choisi."}</p></aside>}
        </div>
      </section>

      {nativeSettings?.channel === "pinterest" && <section hidden={step !== pinterestFormatStep} data-channel={channelId} className={`${styles.card} ${styles.studioCard} ${styles.studioMediaCard} ${styles.studioPinterestFormatCard}`}>
        <StudioStepHeader number={pinterestFormatStep + 1} label="FORMAT DU PIN" title="Le format adapté à votre idée." mobileTitle="Votre format" channel={channelMeta.label} />
        <p className={`${styles.intro} ${styles.studioOptionalIntro}`}>Choisissez la structure publicitaire, le format du Pin et la direction créative. Le texte et le média sont préparés dans les étapes suivantes.</p>
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
        <StudioStepHeader number={mediaStep + 1} label={channelId === "pinterest" ? "PUR MÉDIA" : channelId === "linkedin" ? "MÉDIA LINKEDIN" : channelId === "openai" ? "IMAGE CHATGPT" : "MÉDIAS"} title={channelId === "pinterest" ? "Votre média, visible en entier." : channelId === "linkedin" ? "Votre média LinkedIn, visible en entier." : channelId === "openai" ? "Votre image, visible en entier." : "Vos médias, visibles en entier."} mobileTitle={channelId === "pinterest" || channelId === "linkedin" || channelId === "openai" ? "Votre média" : "Vos médias"} channel={channelMeta.label} />
        <p className={`${styles.intro} ${styles.studioOptionalIntro}`}>{channelId === "pinterest" ? "Ajoutez l’image de votre Pin et vérifiez son aperçu complet." : channelId === "linkedin" ? draft.mediaStrategy === "video" ? "Importez, générez ou choisissez une vidéo. Vérifiez le son, les sous-titres et le cadrage avant le lancement." : "Importez, générez ou choisissez votre image. L’aperçu conserve le cadrage complet et le fichier sera vérifié avant la création." : channelId === "openai" ? `Choisissez ou créez une image JPG, PNG ou WebP carrée d’au moins ${CHATGPT_ADS_MIN_IMAGE_SIDE_PX} × ${CHATGPT_ADS_MIN_IMAGE_SIDE_PX} pixels. Le fichier sera vérifié avant la création de la carte ChatGPT.` : "Importez, générez ou choisissez chaque fichier ici. Les aperçus sont larges, responsives et affichent le média complet sans le rogner."}</p>
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
            <LocalMediaUploadChoice
              disabled={campaignMediaUploadBusy}
              triggerLabel={campaignMediaUploadBusy ? "Ajout en cours…" : undefined}
              image={{
                onSelect: () => campaignImageInputRef.current?.click(),
                hidden: nativeMediaStrategy === "video",
                detail: "Sélection unique · image compatible avec le format publicitaire choisi",
                maxSelection: 1,
              }}
              video={{
                onSelect: () => campaignVideoInputRef.current?.click(),
                hidden: nativeMediaStrategy === "image" || channelId === "openai",
                detail: "Sélection unique · une seule vidéo",
              }}
              testId="ads-local-media-choice"
            />
            <button type="button" className={styles.campaignMediaGenerate} onClick={() => setCampaignMediaStudioOpen(true)} disabled={campaignMediaUploadBusy}><span aria-hidden="true">✦</span> Générer</button>
            <button type="button" onClick={() => setCampaignMediaLibraryOpen(true)} disabled={campaignMediaUploadBusy}><span aria-hidden="true">▦</span> Médiathèque</button>
          </div>}
          {googleSearchMedia && <p className={styles.campaignMediaFormatHint}>La démo Google Search publie uniquement les titres et descriptions. Une image enregistrée auparavant reste visible dans iNrCy, mais elle n’est pas jointe à la campagne Google Ads. Aucun crédit média n’est utilisé pour les nouvelles campagnes Search.</p>}
          {attachedCampaignMediaUrl ? <CampaignMediaPreview key={`${draft.creativeType}:${attachedCampaignMediaUrl}`} url={attachedCampaignMediaUrl} type={draft.creativeType === "video" ? "video" : "image"} campaignName={draft.name || channelMeta.label} onChooseMedia={() => setCampaignMediaLibraryOpen(true)} /> : <div className={styles.campaignMediaPreview} data-empty="true" role="status"><div className={styles.campaignMediaPreviewFallback}><span aria-hidden="true">✦</span><strong>Aperçu complet du média</strong><p>Le fichier choisi ou généré apparaîtra ici en entier, sans recadrage.</p></div></div>}
          {attachedCampaignMediaUrl && <div className={styles.campaignMediaAttached}><span aria-hidden="true">✓</span><div><strong>{googleSearchMedia ? "Image conservée dans iNrCy" : "Média associé à la campagne"}</strong><small>{googleSearchMedia ? "Non jointe à la campagne Google Search lors de la création en pause." : channelId === "openai" ? "Image de votre médiathèque iNrCy ; le format et les droits seront vérifiés avant l’envoi." : `${draft.creativeType === "video" ? "Vidéo" : "Image"} stockée dans votre médiathèque iNrCy ou liée depuis votre site.`}</small></div><a href={attachedCampaignMediaUrl} target="_blank" rel="noreferrer">Voir ↗</a><button type="button" onClick={() => updateDraft({ creativeUrl: "", imageUrl: "" })}>Retirer</button></div>}
          {campaignMediaUploadError && <p className={styles.campaignMediaError} role="alert">{campaignMediaUploadError}</p>}
        </div>}
        {(nativeSettings === null || nativeMediaUpload) && <>
          <input ref={campaignImageInputRef} type="file" accept={channelId === "openai" ? "image/jpeg,image/png,image/webp" : "image/*"} hidden onChange={(event) => void handleCampaignMediaUpload(event, "image")} />
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
          </>}
          {nativeSettings?.channel === "pinterest" && (nativeSettings.objectiveType === "SALES" || nativeSettings.objectiveType === "LEADS") && <label className={styles.field}>Événement Pinterest<select value={nativeSettings.conversionEvent || ""} onChange={(event) => updateNativeSettings({ ...nativeSettings, conversionEvent: event.target.value as Exclude<PinterestWizardSettings["conversionEvent"], null> })}>{(nativeSettings.objectiveType === "SALES" ? ["CHECKOUT", "ADD_TO_CART"] : ["LEAD", "SIGNUP"]).map((value) => <option key={value} value={value}>{nativeBriefTerm(value)}</option>)}</select><small>La balise et l’événement réels seront vérifiés dans Pinterest Ads.</small></label>}
          {nativeSettings && nativeSettings.channel !== "linkedin" && nativeSettings.channel !== "pinterest" && <label className={styles.field}>Action souhaitée<select value={draft.conversionGoal} onChange={(event) => updateDraft({ conversionGoal: event.target.value as AdsCampaignInput["conversionGoal"] })}>{CONVERSION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}
          {!nativeSettings && (channelId === "openai" || channelId === "google" ? <div className={styles.field}><span>Destination après le clic</span><strong>Votre site web</strong><small>{channelId === "google" ? "Les balises de suivi ci-dessous sont ajoutées à vos liens publicitaires dans Google Ads." : "Pour mesurer les visites, ajoutez vos paramètres UTM directement au lien HTTPS ci-dessus."}</small></div> : <label className={styles.field}>Lieu de conversion<select value={draft.conversionLocation} onChange={(event) => updateDraft({ conversionLocation: event.target.value as AdsCampaignInput["conversionLocation"] })}>{CONVERSION_LOCATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label} — {option.detail}</option>)}</select></label>)}
          {<label className={styles.field}>Balises de suivi <small>Optionnel</small><input value={draft.trackingParameters} maxLength={500} onChange={(event) => updateDraft({ trackingParameters: event.target.value })} placeholder={channelId === "linkedin" ? "utm_source=linkedin&utm_medium=paid_social&utm_campaign=ma_campagne" : channelId === "pinterest" ? "utm_source=pinterest&utm_campaign=inspiration" : channelId === "meta" ? "utm_source=meta&utm_medium=paid_social&utm_campaign=ma_campagne" : channelId === "openai" ? "utm_source=chatgpt&utm_medium=paid_social&utm_campaign=ma_campagne" : "utm_source=google&utm_campaign=devis"} /></label>}
          {channelId === "openai" && <ChatGPTAdsDistribution settings={openaiDelivery} onChange={updateOpenaiDelivery} />}
          {nativeSettings?.channel === "pinterest" && !nativeSettings.conversionEvent && <aside className={`${styles.studioKeywordGuidance} ${styles.studioWide}`}><strong>Mesure des résultats Pinterest</strong><p>Cette campagne mesure les impressions ou les clics sur l’épingle, selon votre objectif. Les paramètres UTM permettent de reconnaître les visites de votre site. Aucun événement de conversion n’est ajouté automatiquement.</p></aside>}
          {nativeSettings?.channel === "pinterest" && nativeSettings.conversionEvent && <aside className={`${styles.studioKeywordGuidance} ${styles.studioWide}`}><strong>Événement prévu : {nativeBriefTerm(nativeSettings.conversionEvent)}</strong><p>Vérifiez la balise de conversion Pinterest dans votre compte avant de publier cet objectif.</p></aside>}
          {nativeSettings?.channel === "linkedin" && <div className={styles.studioWide}><LinkedInAdsDistribution accountId={draft.adAccountId || externalStatuses.linkedin.selectedAccountId} settings={linkedInDelivery} active={creating && step === deliveryStep} objective={nativeSettings.objectiveType} onChange={updateLinkedInDelivery} /></div>}
          {channelId === "google" && <div className={styles.studioWide}><GoogleAdsMeasurement resources={effectiveGoogleResources} loading={googleResourcesLoad === "loading"} error={googleResourcesError} onRefresh={() => setGoogleResourcesRevision((value) => value + 1)} /></div>}
          {nativeSettings?.channel === "x" && <aside className={`${styles.studioKeywordGuidance} ${styles.studioWide}`}><strong>Mesure X à confirmer</strong><p>{nativeSettings.objective === "website_conversions" ? "Une source de conversion X valide devra être reliée au compte publicitaire." : "Les résultats réels ne seront visibles qu’après création et validation dans X Ads."}</p></aside>}
          {channelId === "google" && draft.campaignType !== "search" && <label className={`${styles.check} ${styles.studioWide}`}><input type="checkbox" checked={draft.urlExpansion} onChange={(event) => updateDraft({ urlExpansion: event.target.checked })} />Autoriser l’utilisation de pages pertinentes de mon site lorsque le format de campagne le permet.</label>}
          {channelId === "google" && draft.campaignType !== "search" && <label className={`${styles.field} ${styles.studioWide}`}>Pages à exclure <small>Une URL HTTPS par ligne, optionnel</small><CampaignTextarea className={styles.studioAdaptiveContentTextarea} rows={3} value={editableList(draft.urlExclusions)} onChange={(event) => updateDraft({ urlExclusions: parseEditableList(event.target.value.split("\n")) })} placeholder="https://votresite.fr/mentions-legales" /></label>}

        </div>
      </section>

      <section hidden={step !== budgetStep} data-channel={channelId} className={`${styles.card} ${styles.studioCard} ${styles.studioBudgetCard}`}>
        <StudioStepHeader number={budgetStep + 1} label={channelId === "pinterest" ? "BUDGET PINTEREST" : "BUDGET"} title="Votre investissement, en clair." mobileTitle="Votre budget" channel={channelMeta.label} />
        <p className={styles.intro}><span className={styles.studioTitleLong}>Choisissez le rythme d’investissement et la durée. Les repères ci-dessous estiment une enveloppe de dépense : ils ne promettent ni clics, ni prospects, ni ventes.</span><span className={styles.studioTitleShort}>Estimation indicative, sans promesse de résultat.</span></p>
        {preparedOnlyChannel ? <PreparedAdsBudget settings={preparedDelivery} dailyBudget={draft.dailyBudgetEuros} endDate={draft.endDate} timeZone={preparedTimeZone} onChange={updatePreparedDelivery} onDailyChange={(dailyBudgetEuros) => updateDraft({ dailyBudgetEuros })} onEndDateChange={(endDate) => updateDraft({ endDate })} /> : channelId === "meta" ? <MetaAdsBudget settings={metaDelivery} dailyBudget={draft.dailyBudgetEuros} endDate={draft.endDate} timeZone={effectiveMetaResources?.account.timezone || null} onChange={updateMetaDelivery} onDailyChange={(dailyBudgetEuros) => updateDraft({ dailyBudgetEuros })} onEndDateChange={(endDate) => updateDraft({ endDate })} /> : channelId === "openai" ? <ChatGPTAdsBudget settings={openaiDelivery} dailyBudget={draft.dailyBudgetEuros} endDate={draft.endDate} timeZone={effectiveOpenaiResources?.account.timezone || null} onChange={updateOpenaiDelivery} onDailyChange={(dailyBudgetEuros) => updateDraft({ dailyBudgetEuros })} onEndDateChange={(endDate) => updateDraft({ endDate })} /> : channelId === "pinterest" ? <PinterestAdsBudget settings={pinterestDelivery} dailyBudget={draft.dailyBudgetEuros} endDate={draft.endDate} timeZone={effectivePinterestResources?.account.timezone || null} onChange={updatePinterestDelivery} onDailyChange={(dailyBudgetEuros) => updateDraft({ dailyBudgetEuros })} onEndDateChange={(endDate) => updateDraft({ endDate })} /> : channelId === "google" ? <GoogleAdsBudget settings={googleDelivery} dailyBudget={draft.dailyBudgetEuros} endDate={draft.endDate} timeZone={effectiveGoogleResources?.timeZone || ""} onChange={updateGoogleDelivery} onDailyChange={(dailyBudgetEuros) => updateDraft({ dailyBudgetEuros })} onEndDateChange={(endDate) => updateDraft({ endDate })} /> : nativeSettings?.channel === "linkedin" ? <LinkedInAdsBudget settings={linkedInDelivery} dailyBudget={draft.dailyBudgetEuros} endDate={draft.endDate} bid={draft.linkedinBidEuros} objective={nativeSettings.objectiveType} pricing={linkedInBidPricing} onChange={updateLinkedInDelivery} onDailyChange={(dailyBudgetEuros) => updateDraft({ dailyBudgetEuros })} onEndDateChange={(endDate) => updateDraft({ endDate })} onBidChange={(linkedinBidEuros) => updateDraft({ linkedinBidEuros })} /> : <>
        <div className={styles.studioGrid}>
          <label className={styles.field}>Budget quotidien moyen (€)<input type="number" min="5" max="500" step="0.01" value={draft.dailyBudgetEuros} onChange={(event) => updateDraft({ dailyBudgetEuros: Number(event.target.value) })} /></label>
          <label className={styles.field}>Date de fin<input type="date" value={draft.endDate} onChange={(event) => updateDraft({ endDate: event.target.value })} /></label>
        </div>
        <div className={styles.studioBudgetForecast} aria-label="Repères budgétaires">
          <div className={styles.studioBudgetForecastCard}><span>Budget quotidien</span><strong>{Number(draft.dailyBudgetEuros || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}</strong><small>moyenne planifiée</small></div>
          <div className={styles.studioBudgetForecastCard}><span>Durée prévue</span><strong>{estimatedCampaignDays ? `${estimatedCampaignDays} j` : "—"}</strong><small>jusqu’à la date de fin</small></div>
          <div className={styles.studioBudgetForecastCard}><span>Enveloppe estimée</span><strong>{Number.isFinite(estimate) ? estimate.toLocaleString("fr-FR", { style: "currency", currency: "EUR" }) : "—"}</strong><small>budget × durée</small></div>
        </div>
        <div className={styles.studioBudgetPanel}><div><span>À retenir</span><strong>Vous gardez la main.</strong></div><p>Aucune dépense n’est engagée tant que ce canal reste en préparation.</p></div>
        </>}
      </section>

      <section hidden={step !== validationStep} data-channel={channelId} className={`${styles.card} ${styles.studioCard} ${styles.studioValidationCard}`}>
        <StudioStepHeader number={validationStep + 1} label={channelId === "pinterest" ? "REVUE PINTEREST" : "VOTRE CONTRÔLE"} title={channelId === "pinterest" ? "Votre campagne Pinterest, prête à valider." : "Votre campagne, vos décisions."} mobileTitle="Validation" channel={channelMeta.label} />
        <p className={styles.intro}><span className={styles.studioTitleLong}>{["linkedin", "google", "pinterest", "meta", "openai", "x", "tiktok"].includes(channelId) && creationPath === "inrcy" ? "Votre campagne est préparée. Relisez le récapitulatif, cochez les confirmations puis validez. Les onglets restent disponibles pour consulter ou ajuster une proposition." : channelId === "pinterest" ? "Relisez l’objectif, l’audience, l’épingle, le format, la destination et le budget. Vous pourrez ensuite lancer la campagne sur Pinterest ou l’enregistrer en brouillon pour plus tard." : "Relisez cette proposition avant tout enregistrement. Une campagne ne peut être diffusée qu’après votre validation explicite et celle de la plateforme."}</span><span className={styles.studioTitleShort}>{channelId === "pinterest" ? "Lancez maintenant ou gardez le brouillon." : "Diffusion après votre accord et celui de la plateforme."}</span></p>
        {preparedOnlyChannel && <PreparedAdsNativeControls draft={draft} active={creating} connected={channelId === "tiktok" ? externalStatuses.tiktok.connected : externalStatuses.x.connected}
          selectedAccountId={channelId === "tiktok" ? tikTokAccountId : externalStatuses.x.selectedAccountId || draft.adAccountId}
          tikTokResources={effectiveTikTokResources} mode={step === validationStep ? "final" : "hidden"}
          onChange={updateDraft} onReadiness={setPreparedNativeReadiness} onXResources={setPreparedXResources} />}
        {preparedOnlyChannel && <PreparedAdsEffectiveSummary draft={draft} timeZone={preparedTimeZone} identityMessage={channelId === "tiktok" ? tikTokIdentityMessage : "Le compte, sa source de financement et le post à promouvoir seront vérifiés avant toute publication."} />}
        {preparedOnlyChannel && preparedReviewIssues.length > 0 && <div className={styles.studioReadiness} role="status"><strong>Réglages à compléter dans le brouillon</strong><ul>{preparedReviewIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div>}
        {channelId === "meta" && <MetaAdsEffectiveSummary draft={draft} resources={effectiveMetaResources} />}
        {channelId === "openai" && <ChatGPTAdsEffectiveSummary draft={draft} resources={effectiveOpenaiResources} />}
        {channelId === "meta" && metaLaunchReadinessReason && <p className={styles.studioReadiness} role="status"><strong>Contrôle Meta Ads</strong>{metaLaunchReadinessReason}{metaResourcesLoad === "error" && <button type="button" className={styles.secondaryButton} onClick={() => setMetaResourcesRevision((value) => value + 1)}>Revérifier le compte et la Page</button>}</p>}
        {channelId === "openai" && openaiLaunchReadinessReason && <p className={styles.studioReadiness} role="status"><strong>Contrôle ChatGPT Ads</strong>{openaiLaunchReadinessReason}{openaiResourcesLoad === "error" && <button type="button" className={styles.secondaryButton} onClick={() => setOpenaiResourcesRevision((value) => value + 1)}>Revérifier le compte et les zones</button>}</p>}
        {channelId === "google" && <GoogleAdsEffectiveSummary draft={draft} resources={effectiveGoogleResources} />}
        {channelId === "pinterest" && <PinterestAdsEffectiveSummary draft={draft} timeZone={effectivePinterestResources?.account.timezone || null} resources={effectivePinterestResources ? { geographyOptions: effectivePinterestResources.geographies, languageOptions: effectivePinterestResources.locales } : null} />}
        {channelId === "pinterest" && pinterestLaunchReadinessReason && <p className={styles.studioReadiness} role="status"><strong>Contrôle Pinterest Ads</strong>{pinterestLaunchReadinessReason}<button type="button" className={styles.secondaryButton} onClick={() => navigateToStep(pinterestGeoReady ? budgetStep : geographyStep)}>Voir les réglages concernés</button>{pinterestResourcesLoad === "error" && <button type="button" className={styles.secondaryButton} onClick={() => setPinterestResourcesRevision((value) => value + 1)}>Revérifier le compte</button>}</p>}
        {channelId === "google" && draft.campaignType === "search" && googleLaunchReadinessReason && <p className={styles.studioReadiness} role="status"><strong>Contrôle Google Ads</strong>{googleLaunchReadinessReason}{googleGeoState.status === "error" && <button type="button" className={styles.secondaryButton} onClick={() => { googleResolvedGeoKey.current = ""; setGoogleGeoRevision((value) => value + 1); }}>Revérifier les zones</button>}{googleResourcesLoad === "error" && <button type="button" className={styles.secondaryButton} onClick={() => setGoogleResourcesRevision((value) => value + 1)}>Revérifier le compte</button>}</p>}
        {channelId === "linkedin" && <LinkedInAdsEffectiveSummary settings={linkedInDelivery} dailyBudget={draft.dailyBudgetEuros} endDate={draft.endDate} zones={linkedInGeoTargets.map((target) => target.name)} />}
        <dl className={styles.studioReviewGrid}>
          <div><dt>Campagne</dt><dd>{draft.name || "À renseigner"}</dd><small>{nativeSettings ? `${nativeBriefTerm(nativeWizardObjective(nativeSettings))} · ${nativeWizardFormat(nativeSettings)}` : `${selectedCampaignType?.label || channelMeta.label} · ${OBJECTIVE_OPTIONS.find((option) => option.value === draft.objective)?.label}`}</small></div>
          <div><dt>Compte / canal</dt><dd>{channelMeta.label} · {isAdsProvider(channelId) ? associatedAccountName || "À configurer" : channelId === "openai" ? connectionSnapshots.openai.accountLabel || connectionSnapshots.openai.accountId || "À connecter" : activeExternalStatus?.selectedAccountId ? activeExternalStatus.selectedAccountName || activeExternalStatus.selectedAccountId : "À associer"}</dd><small>{reviewAccountStatusLabel}</small></div>
          <div><dt>{channelId === "openai" ? "Objectif publicitaire" : channelId === "pinterest" ? "Objectif Pinterest" : "Objectif mesuré"}</dt><dd>{channelId === "openai" ? "Clics vers le site" : channelId === "google" ? "Objectifs du compte Google Ads" : nativeSettings?.channel === "linkedin" || nativeSettings?.channel === "pinterest" ? nativeBriefTerm(nativeSettings.objectiveType) : CONVERSION_OPTIONS.find((option) => option.value === draft.conversionGoal)?.label}</dd><small>{channelId === "openai" ? draft.targetLocations.length ? `${draft.targetLocations.slice(0, 2).join(" · ")}${draft.targetLocations.length > 2 ? ` +${draft.targetLocations.length - 2} zone(s)` : ""}` : "Zones à préciser" : draft.targetLocations.length ? `${draft.targetLocations.length} zone${draft.targetLocations.length > 1 ? "s" : ""} ciblée${draft.targetLocations.length > 1 ? "s" : ""}` : "Zones à préciser"}</small></div>
          {channelId !== "linkedin" && channelId !== "google" && <div><dt>Investissement</dt><dd>{channelId === "pinterest" ? pinterestAdsBudgetLabel(draft) : channelId === "meta" ? metaAdsBudgetLabel(draft) : channelId === "openai" ? openaiAdsBudgetLabel(draft) : preparedOnlyChannel ? preparedAdsBudgetLabel(draft) : `${draft.dailyBudgetEuros.toLocaleString("fr-FR")} € / jour`}</dd><small>{channelId === "openai" ? `CPC maximal · enchère ${draft.openaiBidEuros || "—"} € · fin ${draft.endDate || "à préciser"}` : `Fin prévue : ${draft.endDate || "à préciser"}`}</small></div>}
          <div><dt>Redirection</dt><dd>{nativeSettings?.channel === "tiktok" && nativeSettings.destinationKind !== "website" ? nativeSettings.destinationKind === "profile" ? "Profil TikTok" : "Formulaire intégré TikTok" : draft.destinationUrl || "À renseigner"}</dd><small>{channelId === "openai" ? "Lien HTTPS de la carte ChatGPT" : nativeSettings?.channel === "pinterest" && nativeSettings.targetingMode === "automatic" ? draft.trackingParameters || "Lien de l’épingle sponsorisée" : channelId === "linkedin" ? draft.trackingParameters || "Lien de l’annonce · paramètres UTM facultatifs" : preparedOnlyChannel ? draft.trackingParameters || "Destination préparée · suivi natif à vérifier" : draft.keywords.length ? `${draft.keywords.length} signaux / mots-clés préparés` : "Mots-clés ou audiences à compléter"}</small></div>
          <div><dt>{channelId === "openai" ? "Carte ChatGPT · image carrée" : "Médias & message"}</dt><dd>{channelId === "openai" ? draft.headlines[0] || "Titre à renseigner" : googleSearchMedia ? "Annonces textuelles" : channelId === "meta" ? "Pack images publicitaires Meta" : MEDIA_STRATEGY_OPTIONS.find((option) => option.value === draft.mediaStrategy)?.label}</dd><small>{channelId === "openai" ? draft.primaryText || "Texte à renseigner" : channelId === "meta" ? `${metaFeedReviewLabel} · ${metaStoryReelReviewLabel}` : googleSearchMedia ? `${draft.headlines.length} titres · ${draft.descriptions.length} descriptions` : channelId === "linkedin" ? LINKEDIN_CTA_LABELS[linkedInDelivery.callToAction] : channelId === "pinterest" ? "Titre, description et image de l’épingle" : draft.callToAction || "Appel à l’action à définir"}</small></div>
          {channelId !== "openai" && <div><dt>Conversion &amp; suivi</dt><dd>{CONVERSION_LOCATION_OPTIONS.find((option) => option.value === draft.conversionLocation)?.label}</dd><small>{draft.trackingParameters || "Aucune balise de suivi ajoutée"}</small></div>}
          {channelId !== "openai" && channelId !== "linkedin" && <div><dt>Diffusion avancée</dt><dd>{channelId === "meta" ? (draft.metaPlacements.length ? `${draft.metaPlacements.length} placement${draft.metaPlacements.length > 1 ? "s" : ""}` : "Placements à choisir") : channelId === "google" ? "Langue déduite des annonces et du site" : nativeSettings?.channel === "tiktok" ? nativeBriefTerm(nativeSettings.placementIntent) : nativeSettings?.channel === "pinterest" ? pinterestTargetingLabel(nativeSettings.targetingMode) : nativeSettings?.channel === "x" ? nativeBriefTerm(nativeSettings.targetingMode) : "Préparation complète"}</dd><small>{channelId === "meta" ? "Âges et langues vérifiés · optimisation des clics sur le lien" : channelId === "google" ? (draft.googleSearchPartners ? "Partenaires de recherche inclus" : "Réseau Google principal") : nativeSettings?.channel === "tiktok" ? `Destination : ${nativeBriefTerm(nativeSettings.destinationKind)} · Optimisation : ${nativeBriefTerm(nativeSettings.optimizationIntent)}` : nativeSettings?.channel === "pinterest" && nativeSettings.conversionEvent ? `Événement : ${nativeBriefTerm(nativeSettings.conversionEvent)}` : nativeSettings?.channel === "pinterest" && nativeSettings.targetingMode === "automatic" ? "Pinterest optimise automatiquement l’audience du groupe d’annonces" : "Choix à vérifier sur la plateforme"}</small></div>}
          {["linkedin", "google", "pinterest", "meta", "openai", "x", "tiktok"].includes(channelId) && destinationReview.required && <label className={`${styles.check} ${styles.studioRequiredCheck}`} data-linkedin-destination-confirmation={channelId === "linkedin" || undefined} data-google-destination-confirmation={channelId === "google" || undefined} data-pinterest-destination-confirmation={channelId === "pinterest" || undefined} data-meta-destination-confirmation={channelId === "meta" || undefined} data-openai-destination-confirmation={channelId === "openai" || undefined} data-prepared-destination-confirmation={preparedOnlyChannel || undefined}>
            <input type="checkbox" checked={destinationReview.confirmed} disabled={busy !== null || !destinationReview.valid} onChange={(event) => setConfirmedDestinationUrl(event.target.checked ? draft.destinationUrl.trim() : "")} />
            <span><strong>Lien de votre annonce</strong>Je confirme que l’annonce doit diriger vers {draft.destinationUrl || "le lien à compléter"}.</span>
          </label>}
          {preparedOnlyChannel && <>
            <label className={`${styles.check} ${styles.studioRequiredCheck}`} data-prepared-budget-confirmation="true">
              <input type="checkbox" checked={preparedBudgetApprovalKey === preparedDraftKey} disabled={busy !== null || Boolean(preparedBudgetError)} onChange={(event) => setPreparedBudgetApprovalKey(event.target.checked ? preparedDraftKey : "")} />
              <span><strong>Budget et calendrier préparés</strong>Je valide {preparedAdsBudgetLabel(draft)} et les dates du récapitulatif. {preparedNativeReady ? "La campagne sera créée en pause, sans diffusion ni dépense." : "Le brouillon sera enregistré ; aucune facturation ne sera déclenchée."}</span>
            </label>
            <label className={`${styles.check} ${styles.studioRequiredCheck}`} data-prepared-content-confirmation="true">
              <input type="checkbox" checked={preparedContentApprovalKey === preparedDraftKey} disabled={busy !== null} onChange={(event) => setPreparedContentApprovalKey(event.target.checked ? preparedDraftKey : "")} />
              <span><strong>Audience et annonce préparées</strong>Je valide les zones, les profils, le message et le format affichés. Les ressources exactes et les droits sont revérifiés avant toute création native sur {channelMeta.label}.</span>
            </label>
          </>}
          {channelId === "meta" && creationPath === "inrcy" && <label className={`${styles.check} ${styles.studioRequiredCheck}`} data-meta-launch-confirmation="true">
            <input type="checkbox" checked={confirmedSpend} disabled={busy !== null || !reviewAccountReady || metaResourcesLoad !== "ready" || !effectiveMetaResources || Boolean(metaLaunchReadinessReason)} onChange={(event) => { setConfirmedSpend(event.target.checked); linkedInLaunchConsent.current = event.target.checked ? { key: JSON.stringify(draft), status: "active", metaResourcesKey: metaAdsResourcesConsentKey(effectiveMetaResources) } : null; }} />
            <span><strong>Budget et diffusion</strong>J’autorise la diffusion sur le compte {effectiveMetaResources?.account.name || "Meta Ads"} avec {metaAdsBudgetLabel(draft)}, {metaDelivery.budget.startAt ? `à partir du ${metaConsentCalendar.start}` : "dès validation de Meta"}, jusqu’au {metaConsentCalendar.end}. Meta facturera directement ce compte. Le budget est celui de l’ensemble de publicités.</span>
          </label>}
          {channelId === "openai" && creationPath === "inrcy" && <label className={`${styles.check} ${styles.studioRequiredCheck}`} data-openai-launch-confirmation="true">
            <input type="checkbox" checked={confirmedSpend} disabled={busy !== null || !reviewAccountReady || openaiResourcesLoad !== "ready" || !effectiveOpenaiResources || Boolean(openaiLaunchReadinessReason) || (!openaiAccountReady && !openaiLiveReady)} onChange={(event) => { setConfirmedSpend(event.target.checked); linkedInLaunchConsent.current = event.target.checked ? { key: JSON.stringify(draft), status: openaiLiveReady ? "active" : "paused", openaiResourcesKey: openaiAdsResourcesConsentKey(effectiveOpenaiResources) || undefined } : null; }} />
            <span><strong>Budget et diffusion</strong>{openaiLiveReady ? `J’autorise la diffusion sur le compte ${effectiveOpenaiResources?.account.name || "ChatGPT Ads"} avec ${openaiAdsBudgetLabel(draft)} et un CPC maximal de ${draft.openaiBidEuros || "—"} €, ${openaiDelivery.budget.startAt ? `à partir du ${new Date(openaiDelivery.budget.startAt).toLocaleString("fr-FR", { timeZone: effectiveOpenaiResources?.account.timezone || "UTC" })}` : "après validation de l’annonce par ChatGPT Ads"}. Le calendrier détaillé ci-dessus s’applique ; ChatGPT Ads facturera ce compte.` : `Je confirme la création sur le compte ${effectiveOpenaiResources?.account.name || "ChatGPT Ads"} en pause, sans diffusion ni dépense.`}</span>
          </label>}
          {channelId === "pinterest" && creationPath === "inrcy" && <label className={`${styles.check} ${styles.studioRequiredCheck}`} data-pinterest-launch-confirmation="true">
            <input type="checkbox" checked={confirmedSpend} disabled={busy !== null || !reviewAccountReady || pinterestResourcesLoad !== "ready" || !effectivePinterestResources || Boolean(pinterestLaunchReadinessReason)} onChange={(event) => { setConfirmedSpend(event.target.checked); linkedInLaunchConsent.current = event.target.checked ? { key: JSON.stringify(draft), status: "active", pinterestResourcesKey: pinterestAdsResourcesConsentKey(effectivePinterestResources) } : null; }} />
            <span><strong>Budget et diffusion</strong>J’autorise la diffusion de cette épingle sur le compte {externalStatuses.pinterest.selectedAccountName || "Pinterest Ads"} avec {pinterestAdsBudgetLabel(draft)}, {pinterestDelivery.budget.startAt ? `à partir du ${new Date(pinterestDelivery.budget.startAt).toLocaleString("fr-FR", { timeZone: effectivePinterestResources?.account.timezone || "UTC" })}` : "dès la validation de Pinterest"}, jusqu’au {new Date(pinterestDelivery.budget.endAt || draft.endDate + "T23:59:59Z").toLocaleString("fr-FR", { timeZone: effectivePinterestResources?.account.timezone || "UTC" })} ({effectivePinterestResources?.account.timezone || "UTC · calendrier"}). Pinterest facturera directement ce compte.</span>
          </label>}
          {channelId === "google" && creationPath === "inrcy" && <label className={`${styles.check} ${styles.studioRequiredCheck}`} data-google-launch-confirmation="true">
            <input type="checkbox" checked={confirmedSpend} disabled={busy !== null || !reviewAccountReady || googleResourcesLoad !== "ready" || !effectiveGoogleResources || Boolean(googleLaunchReadinessReason)} onChange={(event) => { setConfirmedSpend(event.target.checked); linkedInLaunchConsent.current = event.target.checked ? { key: JSON.stringify(draft), status: "active", googleResourcesKey: googleAdsResourcesConsentKey(effectiveGoogleResources) } : null; }} />
            <span><strong>Budget et diffusion</strong>J’autorise la diffusion sur le compte {associatedAccountName || "Google Ads"} avec {googleDelivery.budget.type === "total" ? `${Number(googleDelivery.budget.totalEuros || 0).toLocaleString("fr-FR")} € au total` : `${draft.dailyBudgetEuros.toLocaleString("fr-FR")} € de budget quotidien moyen`}, {googleDelivery.startDate ? `à partir du ${googleDelivery.startDate}` : "dès la validation de Google"}, jusqu’au {draft.endDate}, dans le fuseau {effectiveGoogleResources?.timeZone || "du compte"}. Google facturera directement ce compte.{googleDelivery.budget.type === "daily" ? " La dépense peut varier d’un jour à l’autre ; ce montant est une moyenne." : " Cette enveloppe totale est transmise à Google Ads."}</span>
          </label>}
          {channelId === "linkedin" && <>

            <div><dt>Groupe LinkedIn</dt><dd>{selectedLinkedInCampaignGroup?.name || (draft.linkedinCampaignGroupId ? `Groupe ${draft.linkedinCampaignGroupId}` : "À sélectionner")}</dd><small>{selectedLinkedInCampaignGroup ? `${selectedLinkedInCampaignGroup.status} · ID ${selectedLinkedInCampaignGroup.id}` : draft.linkedinCampaignGroupId ? `ID ${draft.linkedinCampaignGroupId} · à revérifier` : "À vérifier à l’étape Campagne"}</small></div>
            <div><dt>Page LinkedIn</dt><dd>{selectedLinkedInOrganization ? linkedInOrganizationLabel(selectedLinkedInOrganization) : draft.linkedinOrganizationUrn || "À sélectionner"}</dd><small>{linkedInGeoTargets.length ? `${linkedInGeoTargets.length} zone${linkedInGeoTargets.length > 1 ? "s" : ""} LinkedIn exacte${linkedInGeoTargets.length > 1 ? "s" : ""}` : "Zone LinkedIn exacte à sélectionner"}</small></div>

            <div><dt>Conformité LinkedIn</dt><dd>{linkedInComplianceReady ? "Déclarations confirmées" : "Confirmation requise"}</dd><small>NOT_POLITICAL · ciblage non discriminatoire</small></div>
            {creationPath === "inrcy" && <label className={`${styles.check} ${styles.studioRequiredCheck}`} data-linkedin-launch-confirmation="true">
              <input type="checkbox" checked={confirmedSpend} disabled={busy !== null || !linkedInSelectionsReady} onChange={(event) => { setConfirmedSpend(event.target.checked); linkedInLaunchConsent.current = event.target.checked ? { key: JSON.stringify(draft), status: linkedInPreparedLaunchStatus } : null; }} />
              <span><strong>Budget et diffusion</strong>{linkedInPreparedLaunchStatus === "active"
                ? `J’autorise la diffusion sur le compte ${externalStatuses.linkedin.selectedAccountName || "LinkedIn Ads"} avec ${linkedInBudgetCap.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}${linkedInDelivery.budget.type === "total" ? " au total" : " par jour"}${linkedInDelivery.budget.startAt ? `, du ${new Date(linkedInDelivery.budget.startAt).toLocaleString("fr-FR")}` : ", dès la validation de LinkedIn"}, jusqu’au ${new Date(linkedInDelivery.budget.endAt || draft.endDate + "T23:59:59Z").toLocaleString("fr-FR")}. LinkedIn facturera directement ce compte.`
                : `Je confirme la création de cette campagne sur le compte ${externalStatuses.linkedin.selectedAccountName || "LinkedIn Ads"} en pause, sans diffusion ni dépense.`}</span>
            </label>}
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
          <p>{["linkedin", "google", "pinterest", "meta", "openai"].includes(channelId) ? "Ce brief explique la proposition de l’IA. Le récapitulatif ci-dessus présente les réglages actuels ; vos confirmations finales autorisent leur publication." : "Ce brief prépare votre campagne. Les comptes, médias et ressources publicitaires doivent encore être confirmés sur la plateforme ; aucune diffusion n’est lancée ici."}</p>
        </details>}
        {channelId !== "openai" && (channelId === "linkedin" && !linkedInSelectionsReady ? <p className={styles.studioReadiness}><strong>Une vérification LinkedIn manque encore</strong>{linkedInReadinessDetails} {(!draft.linkedinCampaignGroupId || !draft.linkedinOrganizationUrn) && <button type="button" className={styles.secondaryButton} onClick={() => navigateToStep(foundationsStep)}>Voir les réglages Campagne</button>} {linkedInMissingGeoLocations.length > 0 && <button type="button" className={styles.secondaryButton} onClick={() => navigateToStep(geographyStep)}>Voir les zones à compléter</button>} Le brouillon reste enregistrable sans lancer de campagne.</p> : channelId === "linkedin" && !linkedInComplianceReady ? <p className={styles.studioReadiness}><strong>Validez les deux déclarations LinkedIn</strong>La déclaration NOT_POLITICAL et l’avis de ciblage non discriminatoire doivent rester visibles et confirmés avant toute création distante.</p> : !isAdsDraftAccountChannel(channelId) ? <p className={styles.draftOnlyWarning}><strong>Brouillon uniquement pour le moment</strong>{`Vous pouvez connecter et associer votre compte ${channelMeta.label}, puis enregistrer cette campagne. La publication sur ce canal n’est pas encore activée : aucune diffusion ni dépense média ne sera déclenchée.`}{draft.creationMode === "inrcy" && !draft.channelDraft && <span className={styles.studioNativeBriefMissing}>Vos modifications ont désynchronisé le brief spécifique de {channelMeta.label}. Le brouillon simple reste disponible. <button type="button" disabled={busy !== null} onClick={() => { if (!window.confirm("Relancer l’analyse iNrCy ? La nouvelle proposition remplacera vos réglages actuels et pourra générer un nouveau média.")) return; setStep(analysisStep); void generateCampaignPlan(); }}>Recréer le brief IA</button></span>}</p> : !liveFormatAvailable ? <p className={styles.studioReadiness}><strong>Préparation complète, publication de ce choix à venir</strong>{channelId === "google" ? "Ce type reste un brouillon préparatoire. Son parcours complet et sa publication nécessitent une intégration dédiée. L’automatisation de bout en bout est actuellement disponible pour le Réseau de recherche." : channelId === "meta" ? "iNr’ADS prépare ce format et conserve votre brouillon. La publication automatisée actuellement disponible concerne la campagne Trafic Meta." : channelId === "linkedin" ? "Ce format nécessite encore une intégration de publication. Les annonces avec image ou vidéo et les objectifs compatibles peuvent être lancés ; les autres formats restent enregistrables en brouillon." : nativeSettings?.channel === "pinterest" && nativeSettings.targetingMode !== "automatic" ? "Ce ciblage manuel reste dans le brouillon jusqu’à la sélection vérifiée de ses intérêts, mots-clés ou audiences. Choisissez Ciblage automatique pour un lancement réel sans identifiant inventé." : "iNr’ADS peut lancer une épingle sponsorisée image, avec le ciblage automatique, pour un objectif Notoriété ou Considération. Les vidéos, carrousels, catalogues et objectifs de conversion restent entièrement enregistrables en brouillon."}</p> : !livePublisherConversionReady ? <p className={styles.studioReadiness}><strong>Conservez ce parcours dans votre brouillon</strong>Le connecteur de diffusion disponible aujourd’hui envoie les prospects vers votre site web. Votre choix de conversion est bien sauvegardé et sera repris dès que son connecteur dédié sera activé.</p> : !metaLiveObjectiveSupported ? <p className={styles.studioReadiness}><strong>Choisissez l’objectif Trafic vers le site web</strong>Le premier connecteur Meta Ads disponible construit une campagne orientée trafic qualifié vers votre site. Les objectifs Leads, Ventes et Notoriété restent enregistrés dans votre brouillon pour leurs connecteurs dédiés.</p> : !metaLiveGoalSupported ? <p className={styles.studioReadiness}><strong>Mesurez une visite de page clé</strong>Le connecteur Trafic Meta disponible mesure actuellement les visites de votre site web. Vos autres objectifs de conversion restent sauvegardés dans votre brouillon.</p> : !metaLivePlacementsSupported ? <p className={styles.studioReadiness}><strong>Choisissez un placement Meta compatible</strong>Les fils Facebook/Instagram, Stories et Reels sont disponibles. Messenger sera ajouté ultérieurement.</p> : !metaLiveCreativeSupported ? <p className={styles.studioReadiness}><strong>Choisissez le format image</strong>Le connecteur Trafic Meta disponible utilise actuellement des images publicitaires. Vos autres formats restent enregistrés dans le brouillon.</p> : !metaLiveCtaSupported ? <p className={styles.studioReadiness}><strong>Utilisez l’appel à l’action « En savoir plus »</strong>Le premier connecteur Trafic Meta utilise cet appel à l’action pour conserver exactement le message que vous avez validé.</p> : !livePublisherMediaReady ? <p className={styles.studioReadiness}><strong>{knownMetaMediaInvalid ? "Corrigez le format du pack média" : "Complétez le média avant la création"}</strong>{channelId === "meta" ? knownMetaMediaInvalid ? "Au moins une image ne respecte pas les dimensions ou le ratio de son emplacement. Remplacez-la par une image conforme." : "Ajoutez le visuel Feed 4:5 et/ou Story/Reel 9:16 demandé par les placements sélectionnés. Chaque image restera associée à son format." : channelId === "linkedin" ? "Ajoutez le média demandé par votre format à l’étape Média avant le lancement LinkedIn." : "Ajoutez une image disponible dans la médiathèque iNrCy avant le lancement Pinterest."}</p> : <>
          {connectorConfigurationIssue && <p className={styles.studioReadiness}><strong>Réglage à adapter avant publication</strong>{connectorConfigurationIssue}{nativeSettings?.channel === "pinterest" && nativeSettings.targetingMode === "automatic" && draft.keywords.length > 0 && <button type="button" className={styles.secondaryButton} onClick={clearPinterestManualSignals}>Retirer les signaux manuels</button>}{openaiHiddenSettingsNeedReset && <button type="button" className={styles.secondaryButton} onClick={() => updateDraft({ conversionGoal: "website_visit", conversionLocation: "website", bidStrategy: "manual_review", trackingParameters: "", callToAction: "", keywords: [], negativeKeywords: [] })}>Adapter les anciens réglages ChatGPT</button>}</p>}
        </>)}
        {channelId === "openai" && <p className={styles.studioReadiness}><strong>{channelPublishingEnabled && livePublisherMediaReady && liveFormatAvailable && livePublisherConversionReady && !connectorConfigurationIssue ? openaiLiveReady ? "Prête pour votre validation finale" : "Création réelle en pause disponible" : "À compléter pour ChatGPT Ads"}</strong>{!livePublisherMediaReady ? "Ajoutez une image JPG, PNG ou WebP carrée à l’étape Médias. " : ""}{connectorConfigurationIssue ? `${connectorConfigurationIssue} ` : ""}{!channelPublishingEnabled ? `${openaiReadinessMessage || "La clé Advertiser API et la revue du compte sont requises."} ` : ""}{!liveFormatAvailable || !livePublisherConversionReady ? "Ce format ou cet objectif n’est pas encore pris en charge. " : ""}{channelPublishingEnabled && livePublisherMediaReady && liveFormatAvailable && livePublisherConversionReady && !connectorConfigurationIssue ? openaiLiveReady ? "Le statut Active est préparé pour ce compte approuvé. La diffusion démarre seulement après votre validation finale et la revue de l’annonce par ChatGPT Ads." : `La carte peut être créée sans diffusion. ${openaiLiveReadinessMessage || "Le lancement Active n’est pas encore autorisé pour ce compte."}` : "Le brouillon reste enregistrable."}{openaiHiddenSettingsNeedReset && <button type="button" className={styles.secondaryButton} onClick={() => updateDraft({ conversionGoal: "website_visit", conversionLocation: "website", bidStrategy: "manual_review", trackingParameters: "", callToAction: "", keywords: [], negativeKeywords: [] })}>Adapter les anciens réglages ChatGPT</button>}</p>}
        <div className={styles.studioFinalActions} data-channel={channelId}>
          {channelId === "meta" && <label className={`${styles.check} ${styles.studioRequiredCheck}`}><input type="checkbox" checked={draft.noSpecialCategoryConfirmed} disabled={busy !== null} onChange={(event) => confirmReviewedDeclaration("noSpecialCategoryConfirmed", event.target.checked)} /><span><strong>Obligatoire avant création sur Meta</strong>Je confirme que cette annonce ne concerne aucune catégorie spéciale Meta (crédit, emploi, logement ou enjeux sociaux/politiques).</span></label>}
          {channelId === "google" && <label className={`${styles.check} ${styles.studioRequiredCheck}`}><input type="checkbox" checked={draft.notEuPoliticalConfirmed} disabled={busy !== null} onChange={(event) => confirmReviewedDeclaration("notEuPoliticalConfirmed", event.target.checked)} /><span><strong>Obligatoire avant création sur Google Ads</strong>Je certifie que cette campagne ne contient pas de publicité politique ciblant l’Union européenne.</span></label>}
          {channelId === "linkedin" && <>
            <label className={`${styles.check} ${styles.studioRequiredCheck}`} data-linkedin-political-confirmation="true"><input type="checkbox" checked={draft.linkedinPoliticalIntentConfirmed === true} disabled={busy !== null} onChange={(event) => confirmReviewedDeclaration("linkedinPoliticalIntentConfirmed", event.target.checked)} /><span><strong>Déclaration politique LinkedIn obligatoire</strong>Je confirme qu’il ne s’agit pas de publicité politique. Aucune annonce de cette campagne ne constitue une publicité politique au regard du droit des pays ciblés, notamment du droit de l’Union européenne pour les publicités ciblant l’UE. Je respecte les politiques LinkedIn et les exigences réglementaires applicables. La campagne sera déclarée <b>NOT_POLITICAL</b>.</span></label>
            <label className={`${styles.check} ${styles.studioRequiredCheck}`} data-linkedin-targeting-notice="true"><input type="checkbox" checked={draft.linkedinTargetingNoticeAcknowledged === true} disabled={busy !== null} onChange={(event) => confirmReviewedDeclaration("linkedinTargetingNoticeAcknowledged", event.target.checked)} /><span><strong>Avis LinkedIn contre la discrimination</strong>Je reconnais que les outils publicitaires LinkedIn ne doivent pas être utilisés pour discriminer selon des caractéristiques personnelles telles que le genre, l’âge, l’origine, la race ou l’appartenance ethnique. <a href="https://www.linkedin.com/legal/ads-policy" target="_blank" rel="noreferrer">Consulter les règles LinkedIn ↗</a></span></label>
          </>}
          <div className={styles.studioFinalActionButtons}>
            {preparedOnlyChannel && <button type="button" className={styles.primaryButton} data-prepared-final-validation="true" data-native-paused-ready={preparedNativeReady || undefined} disabled={busy !== null || preparedReviewIssues.length > 0 || preparedBudgetApprovalKey !== preparedDraftKey || preparedContentApprovalKey !== preparedDraftKey || destinationReview.required && !destinationReview.confirmed} onClick={() => void (preparedNativeReady ? createPreparedPausedCampaign() : validatePreparedDraft())}>{busy === "publish" ? "Création en pause…" : busy === "save" ? "Enregistrement…" : preparedNativeReady ? "VALIDER · CRÉER EN PAUSE" : "VALIDER LE BROUILLON"} <span aria-hidden="true">✓</span></button>}
            <button type="button" className={styles.secondaryButton} disabled={busy !== null || (!dirty && Boolean(savedId))} onClick={() => void saveDraft()}>{busy === "save" ? "Enregistrement…" : !dirty && savedId ? "Brouillon enregistré" : "Enregistrer en brouillon"}</button>
            {!preparedOnlyChannel && <div className={styles.studioLaunchGuard} data-blocked={launchBlocked || undefined} data-tooltip={launchBlocked ? launchBlockingMessage : undefined} title={launchBlocked ? launchBlockingMessage : undefined} tabIndex={launchBlocked ? 0 : undefined} aria-label={launchBlocked ? launchBlockingMessage : undefined}>
              <button type="button" className={styles.primaryButton} disabled={busy !== null || launchBlocked || (["linkedin", "google", "pinterest", "meta", "openai"].includes(channelId) && creationPath === "inrcy" && !confirmedSpend)} onClick={() => void openLaunchDialog(["linkedin", "google", "pinterest", "meta", "openai"].includes(channelId) && creationPath === "inrcy")}>{busy === "demo" ? demoDialog || publicationPhase === "saving" || publicationPhase === "sending" ? "Création en cours…" : "Vérification du compte…" : ["linkedin", "google", "pinterest", "meta", "openai"].includes(channelId) && creationPath === "inrcy" ? "VALIDER" : "Lancer la campagne"} <span aria-hidden="true">↗</span></button>
              {launchBlocked && <span className={styles.studioLaunchWarning} aria-hidden="true">⚠</span>}
            </div>}
          </div>
        </div>
      </section>
      {creationPath !== "choice" && <div className={styles.wizardNavigation}>
        <button type="button" className={styles.back} disabled={step === 0 || busy === "plan" || busy === "demo"} onClick={() => { if (creationPath === "inrcy" && step === analysisStep) { stopPlanProgress(); setCreationPath("choice"); setAnalysisSetupOpen(true); resetStepProgress(0, inrcyStepKeys); return; } navigateToStep(step - 1); }}>← Précédent</button>
        <span>{step + 1} / {stepNames.length}</span>
        {step < lastStep ? <div className={styles.wizardNextGroup}>
          {step === mediaStep && channelId === "meta" && !livePublisherMediaReady && <div className={styles.wizardMediaRequirement} role="status">
            <strong>Pack média obligatoire</strong>
            <span>{knownMetaMediaInvalid ? "Remplacez le visuel non conforme avant le lancement." : "Ajoutez chaque format demandé avant le lancement."}</span>
          </div>}
          {step === deliveryStep && !["linkedin", "google", "pinterest", "meta", "openai", "x", "tiktok"].includes(channelId) && destinationReview.required && <label className={styles.wizardRequiredCheck}>
            <input type="checkbox" checked={destinationReview.confirmed} disabled={!destinationReview.valid} onChange={(event) => setConfirmedDestinationUrl(event.target.checked ? draft.destinationUrl.trim() : "")} />
            <span><strong>À confirmer avant lancement</strong>Je confirme ce lien</span>
          </label>}
          <button type="button" className={`${styles.headerCta} ${analysisProposalReady ? styles.studioProposalReadyCta : ""}`} disabled={busy === "plan" || busy === "demo" || (creationPath === "inrcy" && step === analysisStep && planProgress !== 100)} onClick={() => { if (["linkedin", "google", "pinterest", "meta", "openai"].includes(channelId) && creationPath === "inrcy" && step === analysisStep && planProgress === 100) resetStepProgress(validationStep); else navigateToStep(step + 1); }}>{creationPath === "inrcy" && step === analysisStep ? planProgress === 100 ? channelId === "pinterest" ? "Voir ma proposition Pinterest →" : "Contrôler ma proposition →" : "Proposition en cours…" : "Suivant →"}</button>
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
          && selectedLinkedInCampaignGroup?.status === "ACTIVE"
          && !linkedInAdsLaunchBlockers(linkedInPreflight.blockers, "ACTIVE").length)
        : demoDialog.channelId === "openai" ? openaiLiveReady : demoDialog.channelId === "google" ? googlePublishingEnabled : demoDialog.channelId === "pinterest" ? pinterestPublishingEnabled : livePublishingEnabled}
      pausedEnabled={demoDialog.channelId === "linkedin"
        ? Boolean(linkedInPublishingEnabled && linkedInPreflight?.account?.canManageCampaigns
          && !linkedInAdsLaunchBlockers(linkedInPreflight.blockers, "PAUSED").length)
        : demoDialog.channelId === "openai" ? openaiAccountReady : demoDialog.channelId === "google" ? googlePublishingEnabled : demoDialog.channelId === "pinterest" ? pinterestPublishingEnabled : livePublishingEnabled}
      activeDisabledReason={demoDialog.channelId === "openai"
        ? openaiLiveReadinessMessage || "La diffusion Active n’est pas encore autorisée pour ce compte ChatGPT Ads."
        : undefined}
      declarationLabel={demoDialog.channelId === "openai" && demoDialog.launchStatus === "active"
        ? `Je confirme que la facturation est configurée et validée dans ChatGPT Ads Manager. J’autorise le lancement en statut Active avec une limite de ${demoDialog.details.dailyBudgetEuros.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })} par jour et je comprends qu’une dépense peut démarrer après la validation de l’annonce par ChatGPT Ads.`
        : demoDialog.launchStatus === "active"
        ? `Je valide le compte, la campagne et la facturation directe par ${demoDialog.details.channelLabel}, et je confirme le lancement en statut Active.`
        : `Je valide le compte et la création de cette campagne sur ${demoDialog.details.channelLabel} en statut Paused, sans diffusion.`}
      declarationChecked={confirmedSpend}
      onDeclarationChange={setConfirmedSpend}
      onLaunchStatusChange={(launchStatus) => {
        setConfirmedSpend(false); linkedInLaunchConsent.current = null;
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
      locked={!pilotChannelsEnabled && !isAdsPublicChannel(channelId)}
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
      locked={!pilotChannelsEnabled && !isAdsPublicChannel(channelId)}
      previous={{ name: previousConnectionChannel.label, onSelect: () => openChannelConfiguration(previousConnectionChannel.id) }}
      next={{ name: nextConnectionChannel.label, onSelect: () => openChannelConfiguration(nextConnectionChannel.id) }}
      onClose={() => { setExternalConfiguring(false); setExternalError(""); }}
      status={!pilotChannelsEnabled && !isAdsPublicChannel(externalSettingsChannel)
        ? { ...externalStatuses[externalSettingsChannel], load: "ready", connected: false, status: "locked", selectedAccountId: "", selectedAccountName: "", error: "" }
        : externalStatuses[externalSettingsChannel]}
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
      locked={!pilotChannelsEnabled && !isAdsPublicChannel("openai")}
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
            setConfirmedSpend(false); linkedInLaunchConsent.current = null;
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
          ? "Choisissez un JPG, PNG ou WebP carré de votre médiathèque iNrCy. Une image valide est obligatoire pour la carte ChatGPT."
        : "Choisissez une image ou une vidéo déjà disponible dans votre médiathèque iNrCy. Elle sera immédiatement associée à cette campagne."}
      accept={googleSearchMedia || channelId === "meta" || channelId === "openai" ? "image" : "all"}
      maxImageBytes={channelId === "openai" ? CHATGPT_ADS_MAX_IMAGE_BYTES : undefined}
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
