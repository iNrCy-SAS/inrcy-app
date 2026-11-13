"use client";

import { adsUiText, translateAdsUiChoices, type AdsUiTranslator } from "./adsUiCopy";
import { useAdsErrorMessage } from "./useAdsErrorMessage";
import { useInrAssistantAdsCommands } from "../_hooks/useInrAssistantAdsCommands";
import { useDashboardViewerAccess } from "../_components/DashboardViewerAccessProvider";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import { confirmInrcy } from "@/lib/inrcyDialog";
import { prepareInrAssistantAdsFormPatch, inrAssistantAdsPatchIsApplied } from "@/lib/inrAssistantAdsFormPatch";
import { persistVerifiedAdsDraft, adsDraftContentKey, adsDraftBaselineKey } from "@/lib/inrAssistantAdsDraftPersistence";
import { loadInrAssistantAdsLibraryMedia } from "@/lib/inrAssistantAdsLibraryMedia";

import { useCallback, useEffect, useEffectEvent, useId, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ComponentPropsWithoutRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import SettingsDrawer from "@/app/dashboard/SettingsDrawer";
import { useUnsavedExitGuard } from "@/app/dashboard/_hooks/useUnsavedExitGuard";
import { getChannelSettingsHeaderStyle } from "@/app/dashboard/channel-settings";
import MediaGeneratorModal from "@/app/dashboard/_components/MediaGeneratorModal";
import DashboardToolHeading from "@/app/dashboard/_components/DashboardToolHeading";
import MediaSubjectVoiceButton from "@/app/dashboard/_components/MediaSubjectVoiceButton";
import LocalMediaUploadChoice from "@/app/dashboard/_components/LocalMediaUploadChoice";
import MediaLibraryPickerModal, {
  type MediaLibraryPickerItem,
} from "@/app/dashboard/_components/MediaLibraryPickerModal";
import type { MediaGenerationResult } from "@/app/dashboard/_hooks/useMediaGeneration";
import { uploadFileToMediaLibrary } from "@/lib/mediaLibraryUploadClient";
import PreparedAdsNativeControls, { type PreparedNativeReadiness } from "./PreparedAdsNativeControls";
import XAdsLocationPicker from "./XAdsLocationPicker";
import { createReviewedPausedCampaign, preparedNativeBlockerLabel, preparedNativeBlockerStep, PREPARED_TIKTOK_CTA_LABELS } from "@/lib/adsPreparedNativeClient";
import { xAdsResourcesConsentKey, type XAdsResources } from "@/lib/adsXResources";
import { TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT } from "@/lib/adsTikTokResources";
import { linkedInAdsConnectionErrorMessage } from "@/lib/adsLinkedInConnectionDisplay";
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
import { presentAdsCampaignRationale, type AdsCampaignPlan } from "@/lib/adsCampaignPlan";
import { assessAdsChannelDraft, type AdsChannelDraft } from "@/lib/adsChannelDrafts";
import {
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
import { adsIncompleteLaunchMessage, adsIncompleteLaunchSteps, adsNativeDeliveryIssueStep, type AdsLaunchStepMap } from "@/lib/adsLaunchReadiness";
import { buildLinkedInGeoQueries, linkedInGeoQueryKey } from "@/lib/adsLinkedInGeoQueries";
import { linkedInAdsAutomaticPreflightKey, linkedInAdsContextualGeoDefaults, linkedInAdsLaunchBlockerMessage, linkedInAdsLaunchBlockers, linkedInAdsLaunchPreflightKey, linkedInAdsVerifiedBidDefault } from "@/lib/adsLinkedInClientDefaults";
import { linkedInCalendarIssue, prepareLinkedInPlanForGroup } from "@/lib/adsLinkedInCalendarReadiness";
import type { LinkedInAdsCampaignGroup } from "@/lib/adsLinkedInPreflightPolicy";
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
import { type LinkedInAudienceSuggestion } from "@/lib/adsLinkedInAudienceSuggestions";
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
import { preparedAdsReviewDetails } from "@/lib/adsPreparedReview";
import { tikTokAdsResourcesConsentKey, type TikTokAdsResources } from "@/lib/adsTikTokResources";
import { PreparedAdsBudget, PreparedAdsBidding, PreparedAdsEffectiveSummary, preparedAdsBudgetLabel } from "./PreparedAdsCampaignControls";
import useAdsExternalConnections, { EXTERNAL_CHANNELS, isExternalChannel, type ExternalChannelId, type ExternalAdsAccount, type ExternalConnectorStatus } from "./useAdsExternalConnections";
import { readJson, type AdsApiRequestError } from "./adsClientHttp";
import { projectAdsCampaignPlan, nativeBriefCopy, nativeWizardObjective, nativeWizardGenericObjective, nativeWizardMediaStrategy } from "@/lib/adsCampaignPlanClient";
import styles from "./ads.module.css";

type StoredCampaign = StoredAdsCampaign;

type AdsConfigAction = "disconnect" | "save-account" | "clear-account" | "save-page" | "clear-page" | null;
type CampaignCreationPath = "choice" | AdsCreationMode;
type CampaignBusyAction = "save" | "plan" | "publish" | "demo" | null;
type CampaignMediaUploadKind = "image" | "video";
type CampaignReadinessIssue = { step: number; message: string };

function CampaignStepWarning({ className }: { className: string }) {
  return <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false">
    <path d="M10 2 19 18H1L10 2Z" fill="#18213a" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M10 7v5m0 2.5v.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>;
}

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
type DemoDialogState = { mode: "confirm" | "success"; details: AdsCampaignDemoDialogDetails; channelId: AdsChannelId; pageId: string; launchStatus: AdsCampaignLaunchStatus; prepared?: { draft: AdsCampaignInput; savedId: string }; preparedReviewKey?: string };
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

type LinkedInCampaignGroupOption = LinkedInAdsCampaignGroup;

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
  inputKey?: string;
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

function linkedInOrganizationLabel(organization: LinkedInOrganizationOption, i18nT?: AdsUiTranslator): string {
  const id = organization.urn.split(":").at(-1) || organization.urn;
  const role = organization.role === "ADMINISTRATOR" ? adsUiText(i18nT, "Administrateur")
    : organization.role === "CONTENT_ADMINISTRATOR" ? adsUiText(i18nT, "Administrateur de contenu") : adsUiText(i18nT, "Sponsor direct autorisé");
  return adsUiText(i18nT, "{value0} · ID {value1} · {value2}", { value0: organization.name?.trim() || adsUiText(i18nT, "Page LinkedIn"), value1: id, value2: role });
}

function externalStatusDisplay(status: ExternalConnectorStatus, i18nT?: AdsUiTranslator): { label: string; tone: string } {
  // A remote refresh must not temporarily hide the durable Ads association.
  if ((status.load === "idle" || status.load === "loading" || status.load === "error") && status.status === "unknown") return { label: adsUiText(i18nT, "Vérification…"), tone: "loading" };
  if (!status.configured) return { label: adsUiText(i18nT, "Connexion indisponible"), tone: "unavailable" };
  if (status.status === "needs_update" || status.status === "needs_reconnect") return { label: adsUiText(i18nT, "Connexion à actualiser"), tone: "select-account" };
  if (status.connected && status.selectedAccountId) return { label: adsUiText(i18nT, "Compte associé"), tone: "connected" };
  if (status.connected) return { label: adsUiText(i18nT, "Compte à associer"), tone: "select-account" };
  return { label: adsUiText(i18nT, "À connecter"), tone: "disconnected" };
}

// Every channel can be prepared here. Publication is enabled only for the
// deliberately supported connector paths and the readiness returned by each platform.
const CHANNEL_CATALOG: { id: AdsChannelId; label: string; slogan: string; logo: string; provider?: AdsProvider }[] = [
  { id: "meta", slogan: "Votre audience vous attend 🎯", label: "Meta Ads", logo: "/ads-logos/meta.svg", provider: "meta" },
  { id: "google", slogan: "Soyez trouvé au bon moment 🔎", label: "Google Ads", logo: "/ads-logos/google-ads.svg", provider: "google" },
  { id: "linkedin", slogan: "Touchez les bons décideurs 🤝", label: "LinkedIn Ads", logo: "/ads-logos/linkedin.svg" },
  { id: "tiktok", slogan: "Captez l’attention en vidéo ⚡", label: "TikTok Ads", logo: "/ads-logos/tiktok.svg" },
  { id: "pinterest", slogan: "Inspirez la prochaine envie 📌", label: "Pinterest Ads", logo: "/ads-logos/pinterest.svg" },
  { id: "x", slogan: "Faites parler de votre marque 💬", label: "X Ads", logo: "/ads-logos/x.svg" },
  { id: "openai", slogan: "Au cœur des bonnes réponses 💡", label: "ChatGPT Ads", logo: "/ads-logos/chatgpt-ads.svg" },
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

const MEDIA_STRATEGY_OPTIONS: { value: AdsCampaignInput["mediaStrategy"]; label: string }[] = [
  { value: "search_text", label: "Annonces textuelles" },
  { value: "image", label: "Images" },
  { value: "video", label: "Vidéos" },
  { value: "mixed", label: "Images + vidéos" },
  { value: "product_feed", label: "Flux produits" },
];
const RAW_CHANNEL_CATALOG = CHANNEL_CATALOG;
const RAW_AI_ANALYSIS_STAGES = AI_ANALYSIS_STAGES;
const RAW_CAMPAIGN_TYPE_OPTIONS = CAMPAIGN_TYPE_OPTIONS;
const RAW_OBJECTIVE_OPTIONS = OBJECTIVE_OPTIONS;
const RAW_CONVERSION_OPTIONS = CONVERSION_OPTIONS;
const RAW_CONVERSION_LOCATION_OPTIONS = CONVERSION_LOCATION_OPTIONS;
const RAW_META_PLACEMENT_OPTIONS = META_PLACEMENT_OPTIONS;
const RAW_MEDIA_STRATEGY_OPTIONS = MEDIA_STRATEGY_OPTIONS;


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

function nativeWizardFormat(settings: AdsChannelWizardSettings, i18nT?: AdsUiTranslator): string {
  return settings.channel === "pinterest"
    ? settings.intendedPromotionType === "CATALOG" ? adsUiText(i18nT, "Catalogue") : nativeBriefTerm(settings.creativeType || "REGULAR", i18nT)
    : nativeBriefTerm(settings.format, i18nT);
}

function nativeBriefTerm(value: string, i18nT?: AdsUiTranslator) {
  return adsUiText(i18nT, NATIVE_BRIEF_TERMS[value]) || value.replaceAll("_", " ").toLowerCase();
}

function pinterestTargetingLabel(mode: PinterestWizardSettings["targetingMode"], i18nT?: AdsUiTranslator): string {
  switch (mode) {
    case "automatic": return adsUiText(i18nT, "Ciblage automatique — recommandé");
    case "interests": return adsUiText(i18nT, "Centres d’intérêt");
    case "keywords": return adsUiText(i18nT, "Recherches / mots-clés");
    case "audiences": return adsUiText(i18nT, "Audiences existantes");
  }
}

function pinterestObjectiveLabel(objective: PinterestWizardSettings["objectiveType"], i18nT?: AdsUiTranslator): string {
  const availability = objective === "AWARENESS" || objective === "CONSIDERATION"
    ? adsUiText(i18nT, "publiable aujourd’hui")
    : adsUiText(i18nT, "brouillon");
  return `${nativeBriefTerm(objective, i18nT)} · ${availability}`;
}

function pinterestCreativeLabel(creative: Exclude<PinterestWizardSettings["creativeType"], null>, i18nT?: AdsUiTranslator): string {
  return `${nativeBriefTerm(creative, i18nT)} · ${creative === "REGULAR" ? adsUiText(i18nT, "publiable aujourd’hui") : adsUiText(i18nT, "brouillon")}`;
}

function xPostWeightedLength(value: string) {
  const urls = value.match(/https?:\/\/\S+/g) || [];
  return Array.from(value.replace(/https?:\/\/\S+/g, "")).length + urls.length * 23;
}

function nativeBriefDetails(brief: AdsChannelDraft, i18nT?: AdsUiTranslator) {
  switch (brief.channel) {
    case "linkedin":
      return { objective: nativeBriefTerm(brief.objectiveType, i18nT), format: nativeBriefTerm(brief.format, i18nT),
        settings: adsUiText(i18nT, "Langue {value0} · Pays {value1}", { value0: brief.locale.language.toUpperCase(), value1: brief.locale.country }),
        complement: brief.creative.leadFormBrief ? adsUiText(i18nT, "Formulaire à préparer : {value0}", { value0: brief.creative.leadFormBrief }) : adsUiText(i18nT, "Audience professionnelle à confirmer dans le compte") };
    case "tiktok":
      return { objective: nativeBriefTerm(brief.objectiveType, i18nT), format: adsUiText(i18nT, "Vidéo verticale"),
        settings: adsUiText(i18nT, "{value0} · Optimisation : {value1} · Destination : {value2}", { value0: nativeBriefTerm(brief.placementIntent, i18nT), value1: nativeBriefTerm(brief.optimizationIntent, i18nT), value2: nativeBriefTerm(brief.destinationKind, i18nT) }),
        complement: brief.creative.conversionEventBrief ? adsUiText(i18nT, "Action à mesurer : {value0}", { value0: brief.creative.conversionEventBrief }) : adsUiText(i18nT, "Vidéo et identité publicitaire à choisir") };
    case "pinterest":
      return { objective: nativeBriefTerm(brief.objectiveType, i18nT),
        format: `${nativeBriefTerm(brief.intendedPromotionType, i18nT)}${brief.creativeType ? ` · ${nativeBriefTerm(brief.creativeType, i18nT)}` : ""}`,
        settings: adsUiText(i18nT, "Ciblage : {value0}{value1}", { value0: pinterestTargetingLabel(brief.targetingMode, i18nT), value1: brief.conversionEvent ? adsUiText(i18nT, " · Action : {value0}", { value0: nativeBriefTerm(brief.conversionEvent, i18nT) }) : "" }),
        complement: brief.intendedPromotionType === "CATALOG" ? adsUiText(i18nT, "Catalogue et produits à confirmer dans le compte") : adsUiText(i18nT, "Épingle et visuel à choisir") };
    case "x":
      return { objective: nativeBriefTerm(brief.objective, i18nT), format: nativeBriefTerm(brief.format, i18nT),
        settings: adsUiText(i18nT, "Ciblage : {value0}{value1}", { value0: nativeBriefTerm(brief.targetingMode, i18nT), value1: brief.keywords?.length ? ` · ${brief.keywords.join(", ")}` : "" }),
        complement: adsUiText(i18nT, "Publication et compte de financement à confirmer") };
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
  const i18nT = useTranslations("booster");
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
      {tooLong && <small id={lengthHintId} className={styles.copyLengthError} role="status">{value.length} / {maxLength} {" "}{i18nT("caracteres_reformulez_ce_texte_avant_publication_3dce037e")}</small>}
    </div>
  );
}

/** A compact, keyboard-friendly editor for campaign choices such as territories. */
function TagField({ className, label, helper, values, onChange, placeholder, note, wide = false, maxItems, maxItemLength, getTagStatus }: TagFieldProps) {
  const i18nT = useTranslations("booster");
  const [pendingValue, setPendingValue] = useState("");
  const [tagError, setTagError] = useState("");

  const addValues = useCallback((rawValue: string) => {
    const additions = rawValue
      .split(/[\n,;]+/)
      .map((value) => value.trim())
      .filter(Boolean);

    if (!additions.length) return;
    if (maxItemLength && additions.some((value) => value.length > maxItemLength)) {
      setTagError(i18nT("chaque_expression_doit_contenir_au_plus_1bed6c22", { value0: maxItemLength }));
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
    setTagError(maxItems !== undefined && uniqueAdditions.length > remaining ? i18nT("ads_tag_limit", { max: maxItems }) : "");
    setPendingValue("");
  }, [i18nT, maxItemLength, maxItems, onChange, values]);

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
            aria-label={i18nT("retirer_value_value_0243405c", { value0: value, value1: status ? ` · ${status.label}` : "" })}
            title={i18nT("value_value_retirer_db4f2de0", { value0: value, value1: status ? ` · ${status.label}` : "" })}
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
          placeholder={values.length ? i18nT("ajouter_un_choix_0c96b67b") : placeholder}
          aria-label={i18nT("ajouter_value_84c3a399", { value0: label })}
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
          {i18nT("ajouter_87c57ed1")}{" "}</button>
      </div>
      {note ? <small className={styles.tagFieldNote}>{note}</small> : null}
      {maxItems !== undefined && <small className={styles.tagFieldNote}>{i18nT("ads_tag_count", { count: values.length, max: maxItems })}{maxItemLength ? i18nT("value_caracteres_par_expression_f1ce5aa1", { value0: maxItemLength }) : ""}</small>}
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
  const i18nT = useTranslations("booster");
  const errorMessage = useAdsErrorMessage();
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
      setError(errorMessage(cause, "shell.ads_error_e56e628680"));
    }
  }

  return <div className={styles.pinterestLocationSearch}>
    <label htmlFor={inputId}>{i18nT("rechercher_une_zone_pinterest_1c4317bf")}</label>
    <p>{i18nT("si_votre_ville_n_est_pas_43d3b08c")}</p>
    <div className={styles.pinterestLocationSearchActions}>
      <input id={inputId} value={query} maxLength={100} placeholder={i18nT("ex_hauts_de_france_bretagne_belgique_63b06cd5")} disabled={!accountId} onChange={(event) => { requestRef.current += 1; setQuery(event.target.value); setPageIndex(0); setOptions([]); setState("idle"); setError(""); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} />
      <button type="button" className={styles.secondaryButton} disabled={!accountId || query.trim().length < 2 || state === "loading"} onClick={() => void search()}>{state === "loading" ? i18nT("recherche_af776274") : i18nT("rechercher_91f7d3e9")}</button>
    </div>
    {!accountId && <small>{i18nT("associez_votre_compte_pinterest_dans_la_f54dac45")}</small>}
    {state === "error" && <small role="alert" className={styles.copyLengthError}>{error}</small>}
    {state === "ready" && !options.length && <small role="status">{i18nT("aucune_zone_pinterest_ne_correspond_essayez_669bbeef")}</small>}
    {options.length > 0 && <ul aria-label={i18nT("zones_proposees_par_pinterest_6d2eff72")} className={styles.pinterestLocationOptions}>{options.slice(visiblePage * 3, (visiblePage + 1) * 3).map((option) => {
      const selected = locations.some((location) => location.trim().toLocaleLowerCase("fr-FR") === option.name.trim().toLocaleLowerCase("fr-FR"));
      return <li key={`${option.type}-${option.id}`}><span><strong>{option.name}</strong><small>{option.kind === "country" ? i18nT("pays_entier_74fc74dd") : option.kind === "region" ? i18nT("region_357f27de") : i18nT("zone_locale_pinterest_0e404710")}</small></span><button type="button" className={styles.secondaryButton} disabled={selected || locations.length >= 20} aria-label={`${selected ? i18nT("ads_ui_2f5cb6b354") : i18nT("ajouter_87c57ed1")} : ${option.name}`} onClick={() => onChange([...locations, option.name])}>{selected ? i18nT("ajoutee_c9e775ef") : i18nT("ajouter_87c57ed1")}</button></li>;
    })}</ul>}
    {options.length > 3 && <nav className={styles.googleAdCopyPagination} aria-label={i18nT("parcourir_les_zones_pinterest_515b967e")}>
      <button type="button" aria-label={i18nT("zones_precedentes_82ebae73")} disabled={visiblePage === 0} onClick={() => setPageIndex(visiblePage - 1)}>←</button>
      <span aria-live="polite">{i18nT("page_fb06270f")}{" "}{visiblePage + 1} / {pageCount}</span>
      <button type="button" aria-label={i18nT("zones_suivantes_4eaac66a")} disabled={visiblePage >= pageCount - 1} onClick={() => setPageIndex(visiblePage + 1)}>→</button>
    </nav>}
  </div>;
}

function GoogleLocationSearch({ accountId, locations, onChange }: {
  accountId: string;
  locations: string[];
  onChange: (locations: string[]) => void;
}) {
  const i18nT = useTranslations("booster");
  const errorMessage = useAdsErrorMessage();
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
      setError(errorMessage(cause, "shell.ads_error_9ffbae53c0"));
    }
  }

  return <div className={styles.pinterestLocationSearch}>
    <label htmlFor={inputId}>{i18nT("rechercher_une_ville_ou_une_region_1d41776a")}</label>
    <p>{i18nT("choisissez_le_lieu_exact_preciser_remplace_bf21864a")}</p>
    <div className={styles.pinterestLocationSearchActions}>
      <input id={inputId} value={query} maxLength={120} placeholder={i18nT("ex_lille_arras_hauts_de_france_09b07e80")} disabled={!accountId} onChange={(event) => { requestRef.current += 1; setQuery(event.target.value); setPageIndex(0); setOptions([]); setState("idle"); setError(""); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} />
      <button type="button" className={styles.secondaryButton} disabled={!accountId || query.trim().length < 2 || state === "loading"} onClick={() => void search()}>{state === "loading" ? i18nT("recherche_af776274") : i18nT("rechercher_91f7d3e9")}</button>
    </div>
    {!accountId && <small>{i18nT("associez_votre_compte_google_ads_dans_12aba457")}</small>}
    {state === "error" && <small role="alert" className={styles.copyLengthError}>{error}</small>}
    {state === "ready" && !options.length && <small role="status">{i18nT("aucune_zone_google_ne_correspond_precisez_ded09ddc")}</small>}
    {options.length > 0 && <ul aria-label={i18nT("zones_proposees_par_google_ads_ba270613")} className={styles.pinterestLocationOptions}>{options.slice(visiblePage * 3, (visiblePage + 1) * 3).map((option) => {
      const replacesName = option.name.toLocaleLowerCase("fr-FR") !== option.canonicalName.toLocaleLowerCase("fr-FR") && locations.some((location) => location.trim().toLocaleLowerCase("fr-FR") === option.name.toLocaleLowerCase("fr-FR"));
      const selected = !replacesName && locations.some((location) => location.trim().toLocaleLowerCase("fr-FR") === option.canonicalName.toLocaleLowerCase("fr-FR"));
      return <li key={option.id}><span><strong>{option.canonicalName}</strong><small>{i18nT("pays_value_14b2a4e7", { value0: option.country })}</small></span><button type="button" className={styles.secondaryButton} disabled={selected || !replacesName && locations.length >= 20} aria-label={`${selected ? i18nT("ads_ui_2f5cb6b354") : replacesName ? i18nT("ads_ui_9c09660f51") : i18nT("ajouter_87c57ed1")} : ${option.canonicalName}`} onClick={() => onChange(selectGoogleTargetLocation(locations, option))}>{selected ? i18nT("ajoutee_c9e775ef") : replacesName ? i18nT("preciser_4ad8dc1a") : i18nT("ajouter_87c57ed1")}</button></li>;
    })}</ul>}
    {options.length > 3 && <nav className={styles.googleAdCopyPagination} aria-label={i18nT("parcourir_les_zones_google_dc32b625")}>
      <button type="button" aria-label={i18nT("zones_precedentes_82ebae73")} disabled={visiblePage === 0} onClick={() => setPageIndex(visiblePage - 1)}>←</button>
      <span aria-live="polite">{i18nT("page_fb06270f")}{" "}{visiblePage + 1} / {pageCount}</span>
      <button type="button" aria-label={i18nT("zones_suivantes_4eaac66a")} disabled={visiblePage >= pageCount - 1} onClick={() => setPageIndex(visiblePage + 1)}>→</button>
    </nav>}
  </div>;
}

function GoogleAdCopyField({ label, singular, values, onChange, minItems, maxItems, maxLength }: GoogleAdCopyFieldProps) {
  const i18nT = useTranslations("booster");
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
      <small>{i18nT("value_minimum_value_maximum_value_caracteres_44aafcec", { value0: minItems, value1: maxItems, value2: maxLength, value3: singular.toLowerCase() })}</small>
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
            <span id={`${fieldId}-${index}-count`} data-invalid={value.length > maxLength || undefined} aria-label={i18nT("value_caracteres_sur_value_7aa129ff", { value0: value.length, value1: maxLength })}>{value.length}/{maxLength}</span>
            {rows.length > minItems && <button type="button" aria-label={i18nT("retirer_value_value_7070f3a7", { value0: singular.toLowerCase(), value1: index + 1 })} title={i18nT("retirer_value_value_7070f3a7", { value0: singular.toLowerCase(), value1: index + 1 })} onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}>×</button>}
          </div>;
        })}
      </div>
      {pageCount > 1 && <nav className={styles.googleAdCopyPagination} aria-label={i18nT("parcourir_les_value_fa00ff99", { value0: label.toLowerCase() })}>
        <button type="button" aria-label={i18nT("value_precedents_391400c5", { value0: label })} disabled={visiblePage === 0} onClick={() => setPageIndex(visiblePage - 1)}>←</button>
        <span aria-live="polite">{i18nT("ads_copy_pagination", { first: startIndex + 1, last: Math.min(startIndex + pageSize, rows.length), total: rows.length })}</span>
        <button type="button" aria-label={i18nT("ads_ui_2a0422379f", { value0: label })} disabled={visiblePage === pageCount - 1} onClick={() => setPageIndex(visiblePage + 1)}>→</button>
      </nav>}
      {tooLong && <small className={styles.copyLengthError} role="status">{i18nT("reformulez_les_textes_trop_longs_aucune_7e1aec51")}</small>}
      {rows.length < maxItems && <button type="button" className={styles.googleAdCopyAdd} onClick={() => { onChange([...rows, ""]); setPageIndex(Math.floor(rows.length / pageSize)); }}>{i18nT("ajouter_daff7acf")}{" "}{singular === i18nT("titre_eb97899a") ? i18nT("un_titre_0365c1ba") : i18nT("une_description_da1b7d04")}</button>}
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
  const i18nT = useTranslations("booster");
  const previewable = (url.startsWith("/") && !url.startsWith("//")) || /^https:\/\//i.test(url);
  const [failed, setFailed] = useState(!previewable);

  return <div className={styles.campaignMediaPreview} data-type={type}>
    {failed ? <div className={styles.campaignMediaPreviewFallback} role="status">
      <strong>{i18nT("apercu_du_media_indisponible_7b910c42")}</strong>
      <p>{i18nT("verifiez_son_lien_ou_choisissez_un_f458f392")}</p>
      <div>
        {previewable && <button type="button" onClick={() => setFailed(false)}>{i18nT("reessayer_895d416b")}</button>}
        <button type="button" onClick={onChooseMedia}>{i18nT("choisir_un_autre_media_6bb71cd7")}</button>
      </div>
    </div> : type === "video"
      ? <video src={url} aria-label={i18nT("apercu_de_la_video_associee_a_08842953")} onError={() => setFailed(true)} controls playsInline preload="metadata" />
      : <Image src={url} alt={i18nT("apercu_de_l_image_associee_a_33b353ce", { value0: campaignName })} onError={() => setFailed(true)} fill unoptimized sizes="(max-width: 800px) 100vw, 70vw" className={styles.campaignMediaPreviewImage} />}
  </div>;
}

function campaignPromise(channel: AdsChannelId, i18nT?: AdsUiTranslator) {
  if (channel === "google") {
    return adsUiText(i18nT, "Quand une personne recherche précisément votre service, une campagne Google Ads bien pensée vous place au bon moment, devant la bonne intention.");
  }
  if (channel === "meta") {
    return adsUiText(i18nT, "Une campagne Meta Ads bien pensée transforme votre expertise en une rencontre utile avec les personnes qui peuvent devenir vos clients.");
  }
  return adsUiText(i18nT, "Une campagne claire donne à votre expertise la place qu’elle mérite auprès des personnes prêtes à vous découvrir.");
}

export default function AdsClient({ initialChannel, initialEditCampaignId, initialConnections, initialConnection, initialReason, metaPublishingEnabled, googlePublishingEnabled, pinterestPublishingEnabled, pilotChannelsEnabled }: {
  initialChannel: AdsChannelId;
  initialEditCampaignId: string;
  initialConnections: AdsConnectionSnapshots;
  initialConnection: "connected" | "error" | null;
  initialReason: string;
  metaPublishingEnabled: boolean;
  googlePublishingEnabled: boolean;
  pinterestPublishingEnabled: boolean;
  pilotChannelsEnabled: boolean;
}) {
  const locale = useLocale();
  const i18nT = useTranslations("booster");
  const { CHANNEL_CATALOG, AI_ANALYSIS_STAGES, CAMPAIGN_TYPE_OPTIONS, OBJECTIVE_OPTIONS, CONVERSION_OPTIONS, CONVERSION_LOCATION_OPTIONS, META_PLACEMENT_OPTIONS, MEDIA_STRATEGY_OPTIONS } = useMemo(() => ({ CHANNEL_CATALOG: translateAdsUiChoices(RAW_CHANNEL_CATALOG, i18nT), AI_ANALYSIS_STAGES: translateAdsUiChoices(RAW_AI_ANALYSIS_STAGES, i18nT), CAMPAIGN_TYPE_OPTIONS: translateAdsUiChoices(RAW_CAMPAIGN_TYPE_OPTIONS, i18nT), OBJECTIVE_OPTIONS: translateAdsUiChoices(RAW_OBJECTIVE_OPTIONS, i18nT), CONVERSION_OPTIONS: translateAdsUiChoices(RAW_CONVERSION_OPTIONS, i18nT), CONVERSION_LOCATION_OPTIONS: translateAdsUiChoices(RAW_CONVERSION_LOCATION_OPTIONS, i18nT), META_PLACEMENT_OPTIONS: translateAdsUiChoices(RAW_META_PLACEMENT_OPTIONS, i18nT), MEDIA_STRATEGY_OPTIONS: translateAdsUiChoices(RAW_MEDIA_STRATEGY_OPTIONS, i18nT) }), [i18nT]);
  const errorMessage = useAdsErrorMessage();
  const router = useRouter();
  const channelT = useTranslations("dashboard.signatureTools");
  const comingSoonLabel = channelT("comingSoon");
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
  const {
    externalStatuses, externalAccounts, externalAccountChoice, externalAccountsLoading,
    externalAccountsLoadFailed, externalAction, externalError, setExternalError,
    refreshExternalStatus, loadExternalAccounts, associateExternalAccount, disconnectExternalChannel,
    clearExternalAccountsCache, cancelExternalAccountsLoad, stopExternalAccountsLoading,
    hydrateExternalChannel, selectExternalAccount, mergeExternalStatus, externalAccountsLoaded,
  } = useAdsExternalConnections({ initialChannel, initialConnections, setConnectionSnapshots });
  const [openaiAccountReady, setOpenaiAccountReady] = useState(false);
  const [openaiLiveReady, setOpenaiLiveReady] = useState(false);
  const [openaiReadinessMessage, setOpenaiReadinessMessage] = useState("");
  const [openaiLiveReadinessMessage, setOpenaiLiveReadinessMessage] = useState("");
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
  const linkedInLatestPreflightSignature = useRef("");
  const linkedInManualGroupId = useRef<string | null>(null);
  const linkedInPlanEndIsExplicit = useRef(true);
  const linkedInResourcesLoader = useRef<(force?: boolean, geoQueryOverride?: string) => Promise<void>>(async () => undefined);
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
    linkedInManualGroupId.current = null;
    linkedInPlanEndIsExplicit.current = true;
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
  const [planBudgetRationale, setPlanBudgetRationale] = useState("");
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
      setGoogleResourcesLoad("error"); setGoogleResourcesError(errorMessage(error, "shell.ads_error_a34ca7af67"));
    });
    return () => abort.abort();
  }, [creating, channelId, googleResourceAccountId, googleResourcesRevision, errorMessage]);

  const googleLocationsKey = JSON.stringify(draft.targetLocations);
  const googleGeoKey = JSON.stringify({ accountId: googleResourceAccountId, locations: draft.targetLocations });
  const googleGeoReady = googleGeoState.key === googleGeoKey && googleGeoState.status === "ready";
  useEffect(() => {
    if (!creating || channelId !== "google" || draft.campaignType !== "search" || !googleResourceAccountId || !(JSON.parse(googleLocationsKey) as string[]).length
      || googleResolvedGeoKey.current === googleGeoKey) return;
    const abort = new AbortController();
    const expectedLocations = googleLocationsKey;
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
      setGoogleGeoState({ key: googleGeoKey, status: "error", error: errorMessage(error, "shell.ads_error_a437df8c28") });
    });
    return () => abort.abort();
  }, [creating, channelId, draft.campaignType, googleResourceAccountId, googleGeoKey, googleLocationsKey, googleGeoRevision, configuredAccountId, errorMessage]);

  const preparedDelivery = draft.preparedDeliverySettings || defaultPreparedDeliverySettings();
  const preparedOnlyChannel = channelId === "x" || channelId === "tiktok";
  const tikTokAccountId = externalStatuses.tiktok.selectedAccountId || draft.adAccountId;
  const effectiveTikTokResources = tikTokResources?.selectedAccountId === tikTokAccountId && tikTokResources.account.id === tikTokAccountId ? tikTokResources : null;
  const preparedTimeZone = channelId === "tiktok" ? effectiveTikTokResources?.account.timezone || "Europe/Paris" : preparedXResources?.account.timeZone || "Europe/Paris";
  const tikTokIdentityMessage = effectiveTikTokResources?.identities.length === 1
    ? i18nT("ads_ui_21e30ba750", { value0: effectiveTikTokResources.identities[0].displayName })
    : effectiveTikTokResources?.identities.length
      ? i18nT("ads_ui_a9a2856029", { value0: effectiveTikTokResources.identities.length })
      : tikTokResourcesLoad === "loading" ? i18nT("ads_ui_915a03a7dd")
        : tikTokResourcesError || i18nT("ads_ui_58dd743ffd");
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
      setTikTokResourcesLoad("error"); setTikTokResourcesError(errorMessage(error, "shell.ads_error_d377ac66e5"));
    });
    return () => abort.abort();
  }, [creating, channelId, externalStatuses.tiktok.selectedAccountId, externalStatuses.tiktok.connected, tikTokResourcesRevision, errorMessage]);

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
      setMetaResourcesLoad("error"); setMetaResourcesError(errorMessage(error, "shell.ads_error_7b0e6d3fbf"));
    });
    return () => abort.abort();
  }, [creating, channelId, metaResourceAccountId, configuredPageId, metaResourcesRevision, errorMessage]);
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
    try { return { ids: effectiveMetaResources ? resolveMetaAdsLanguages(effectiveMetaResources, draft.languages) : [], error: effectiveMetaResources ? "" : i18nT("ads_ui_b189eb1173") }; }
    catch (error) { return { ids: [], error: errorMessage(error, "shell.ads_error_ea9b7b0211") }; }
  }, [effectiveMetaResources, draft.languages, errorMessage, i18nT]);
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
  // Read the staged search text when a search/context request starts, not per keystroke.
  const onOpenaiResourcesRequested = useEffectEvent((accountId: string, locationsKey: string, signal: AbortSignal) => {
    const url = `/api/ads/openai/resources?accountId=${encodeURIComponent(accountId)}&queries=${encodeURIComponent(JSON.stringify(JSON.parse(locationsKey)))}${openaiGeoQuery.trim().length >= 2 ? `&q=${encodeURIComponent(openaiGeoQuery.trim())}` : ""}`;
    return fetch(url, { cache: "no-store", signal }).then(readJson);
  });
  useEffect(() => {
    if (!creating || channelId !== "openai" || !openaiResourceAccountId) return;
    const abort = new AbortController();
    setOpenaiResources(null); setOpenaiResourcesLoad("loading"); setOpenaiResourcesError("");
    setConfirmedSpend(false); linkedInLaunchConsent.current = null;
    void onOpenaiResourcesRequested(openaiResourceAccountId, openaiLocationsKey, abort.signal).then((value) => {
      if (abort.signal.aborted) return;
      const resources = value as OpenaiAdsResources;
      if (resources.selectedAccountId !== openaiResourceAccountId || resources.account?.id !== openaiResourceAccountId) throw new Error("Le compte ChatGPT Ads a changé. Revérifiez la connexion.");
      setOpenaiResources(resources); setOpenaiResourcesLoad("ready");
    }).catch((error) => {
      if (abort.signal.aborted) return;
      setOpenaiResourcesLoad("error"); setOpenaiResourcesError(errorMessage(error, "shell.ads_error_51c61a39cc"));
    });
    return () => abort.abort();
    // The search text is sent only when the professional requests a search.
  }, [creating, channelId, openaiResourceAccountId, openaiLocationsKey, openaiResourcesRevision, errorMessage]);
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
      setPinterestResourcesLoad("error"); setPinterestResourcesError(errorMessage(error, "shell.ads_error_c7ffdb2c41"));
    });
    return () => abort.abort();
  }, [creating, channelId, pinterestResourceAccountId, pinterestResourcesRevision, errorMessage]);
  const pinterestResolvedGeography = useMemo(() => {
    if (!effectivePinterestResources || pinterestResourcesLoad !== "ready") return { zones: [], error: pinterestResourcesError || i18nT("ads_ui_056be3f4d6") };
    try { return { zones: resolvePinterestAdsGeographies(effectivePinterestResources, draft.targetLocations), error: "" }; }
    catch (error) { return { zones: [], error: errorMessage(error, "shell.ads_error_057ad8295d") }; }
  }, [effectivePinterestResources, pinterestResourcesLoad, pinterestResourcesError, draft.targetLocations, errorMessage, i18nT]);
  const pinterestGeoReady = pinterestResolvedGeography.zones.length > 0 && !pinterestResolvedGeography.error;
  const pinterestResolvedLanguages = useMemo(() => {
    if (!effectivePinterestResources) return { ids: [], error: i18nT("verification_des_langues_pinterest_en_cours_a65b0d97") };
    try { return { ids: matchPinterestTargetLanguages(draft.languages, effectivePinterestResources.locales.map((locale) => ({ [locale.id]: locale.name }))), error: "" }; }
    catch (error) { return { ids: [], error: errorMessage(error, "shell.ads_error_26cac3b30e") }; }
  }, [effectivePinterestResources, draft.languages, errorMessage, i18nT]);

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
  const [notice, setNotice] = useState(initialConnection === "error" ? errorMessage(initialReason, /Meta.*HTTPS/i.test(initialReason) ? "shell.ads_error_secure_connection" : "shell.ads_error_d82764b915") : "");

  const applyProviderAccountsResult = useCallback((channel: AdsProvider, result: AccountResponse, announce: boolean) => {
    if (result.connected && result.error) {
      // A temporary discovery error does not invalidate the stored association.
      if (announce) setNotice(errorMessage(result, channel === "google" ? "shell.ads_error_a34ca7af67" : "shell.ads_error_7b0e6d3fbf"));
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
      setNotice(i18nT("la_connexion_value_doit_etre_actualisee_67b072cc", { value0: channel === "google" ? "Google Ads" : "Meta Ads" }));
    }
    if (result.error) setNotice(errorMessage(result, channel === "google" ? "shell.ads_error_a34ca7af67" : "shell.ads_error_7b0e6d3fbf"));
  }, [errorMessage, i18nT]);

  const selectedAccount = isAdsProvider(channelId) ? accounts.find((account) => account.id === draft.adAccountId) : undefined;
  const configuredAdvertiserAccount = isAdsProvider(channelId)
    ? accounts.find((account) => account.id === configuredAccountId && account.provider === channelId && adsAccountCanBeAssociated(account))
    : undefined;
  const associatedAccountName = configuredAdvertiserAccount?.name || configuredAccountLabel || (configuredAccountId ? `Compte ${configuredAccountId}` : "");
  const metaNeedsInstagramIdentity = channelId === "meta" && metaPlacementsNeedInstagramIdentity(draft.metaPlacements);
  const configuredMetaPage = channelId === "meta"
    ? pages.find((page) => page.id === configuredPageId)
    : undefined;
  const channelMeta = CHANNEL_CATALOG.find((channel) => channel.id === channelId) || CHANNEL_CATALOG[0];
  const campaignCreationTitle = i18nT("ads_ui_4617896f39", { value0: CAMPAIGN_CHANNEL_NAMES[channelId] });
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
        : channelId === "openai" ? openaiLiveReady || openaiAccountReady : channelId === "meta" && metaPublishingEnabled;
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
      ? i18nT("ads_ui_2da62dc8dc")
      : channelId === "meta"
      ? metaNeedsInstagramIdentity
        ? i18nT("ads_ui_bddd5fe438")
        : i18nT("ads_ui_7c34a19c81")
      : i18nT("ads_ui_2da62dc8dc")
    : channelId === "openai" && connectionSnapshots.openai.accountId
      ? i18nT("ads_ui_78d65de141")
    : channelId === "meta" && draft.pageId && draft.pageId !== configuredPageId
      ? i18nT("ads_ui_3ba2513419")
    : channelId === "meta" && configuredAccountId && configuredPageId && metaNeedsInstagramIdentity
      ? i18nT("ads_ui_d8d5a427b6")
      : isExternalChannel(channelId) && activeExternalStatus?.selectedAccountId
        ? i18nT("ads_ui_bad98b961a")
      : configuredAccountId
        ? i18nT("ads_ui_bad98b961a")
        : isExternalChannel(channelId)
          ? i18nT("ads_ui_893ed8cbcf")
          : channelId === "openai" ? i18nT("ads_ui_d4d6326460")
          : i18nT("ads_ui_b99f519026");

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

  useEffect(() => {
    if ((pilotChannelsEnabled || isAdsPublicChannel(channelId)) && isExternalChannel(channelId) && externalStatuses[channelId].load === "idle") void refreshExternalStatus(channelId);
  }, [channelId, externalStatuses, pilotChannelsEnabled, refreshExternalStatus]);

  useEffect(() => {
    for (const channel of EXTERNAL_CHANNELS) if (pilotChannelsEnabled || isAdsPublicChannel(channel)) void refreshExternalStatus(channel, { silent: true });
  }, [pilotChannelsEnabled, refreshExternalStatus]);

  const onExternalConnectionError = useEffectEvent((callbackChannel: ExternalChannelId, reason: string | null) => {
    if (callbackChannel === "linkedin") {
      setExternalError(adsUiText(i18nT, linkedInAdsConnectionErrorMessage(reason)));
    } else if (callbackChannel === "tiktok" && reason === "ads_access_missing") {
      setExternalError(i18nT("ads_external_tiktok_no_account"));
    } else if (callbackChannel === "tiktok" && reason === "provider_response_invalid") {
      setExternalError(i18nT("ads_external_tiktok_invalid_accounts"));
    } else {
      setExternalError(errorMessage({ code: reason, error: reason }, "shell.ads_error_d82764b915"));
    }
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const callbackChannel = params.get("channel");
    if (!isExternalChannel(callbackChannel) || (!pilotChannelsEnabled && !isAdsPublicChannel(callbackChannel))) return;
    const index = RAW_CHANNEL_CATALOG.findIndex((channel) => channel.id === callbackChannel);
    setChannelIndex(index);
    setChannelId(callbackChannel);
    setDraft((current) => current.provider === callbackChannel ? current : newDraft(callbackChannel));
    setConfirmedDestinationUrl("");
    setNotice("");
    if (params.has("connection")) {
      clearExternalAccountsCache(callbackChannel);
      void refreshExternalStatus(callbackChannel);
      if (params.get("connection") === "error") {
        onExternalConnectionError(callbackChannel, params.get("reason"));
      }
      params.delete("connection");
      params.delete("reason");
      window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}`);
    }
  }, [pilotChannelsEnabled, refreshExternalStatus, clearExternalAccountsCache, setExternalError]);

  useEffect(() => {
    if (!initialConnection) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("connection")) return;
    params.delete("connection");
    params.delete("reason");
    const query = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, [initialConnection]);

  const activeExternalConnected = isExternalChannel(channelId) && externalStatuses[channelId].connected;
  const activeExternalAccountId = isExternalChannel(channelId) ? externalStatuses[channelId].selectedAccountId : "";
  useEffect(() => {
    if (!isExternalChannel(channelId) || (!pilotChannelsEnabled && !isAdsPublicChannel(channelId))) return;
    if (!activeExternalConnected) { stopExternalAccountsLoading(); return; }
    void loadExternalAccounts(channelId, activeExternalAccountId);
    return () => { cancelExternalAccountsLoad(); };
  }, [channelId, pilotChannelsEnabled, activeExternalConnected, activeExternalAccountId, loadExternalAccounts, cancelExternalAccountsLoad, stopExternalAccountsLoading]);

  function selectChannel(index: number) {
    const nextIndex = ((index % CHANNEL_CATALOG.length) + CHANNEL_CATALOG.length) % CHANNEL_CATALOG.length;
    setChannelIndex(nextIndex);
    const next = CHANNEL_CATALOG[nextIndex].id;
    if (next === channelId) return;
    adsFormGeneration.current += 1;
    cancelExternalAccountsLoad();
    if (isExternalChannel(next)) {
      const locked = !pilotChannelsEnabled && !isAdsPublicChannel(next);
      hydrateExternalChannel(next, locked);
    }
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
      .catch((error) => { if (active) setNotice(errorMessage(error, "shell.ads_error_d82764b915")); })
      .finally(() => { if (active) setLoadingAccounts(false); });
    return () => { active = false; };
  }, [accountsRefreshRevisions, applyProviderAccountsResult, channelId, pilotChannelsEnabled, errorMessage]);

  function changeProvider(next: AdsProvider) {
    setChannelIndex(CHANNEL_CATALOG.findIndex((channel) => channel.provider === next));
    const channelChanged = channelId !== next;
    setChannelId(next);
    if (next === provider && !channelChanged) return;
    adsFormGeneration.current += 1;
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

  function updateDraft(next: Partial<AdsCampaignInput>) {
    if (Object.hasOwn(next, "linkedinCampaignGroupId")) linkedInManualGroupId.current = next.linkedinCampaignGroupId || null;
    if (Object.hasOwn(next, "endDate") || (next.linkedinDeliverySettings && next.linkedinDeliverySettings.budget.endAt !== draft.linkedinDeliverySettings?.budget.endAt)) linkedInPlanEndIsExplicit.current = true;
    if (Object.prototype.hasOwnProperty.call(next, "destinationUrl")) setConfirmedDestinationUrl("");
    if (channelId === "openai" && next.primaryText !== undefined) next = { ...next, descriptions: next.primaryText ? [next.primaryText] : [] };
    setDraft((current) => applyDraftEdit(current, next));
    setDirty(true);
    setConfirmedSpend(false); linkedInLaunchConsent.current = null;
  }

  const { actorUserId: adsActorId, activeAccountId: adsAccountId } = useDashboardViewerAccess();
  const adsEditor = useRef({ draft, savedId, channelId, actorId: adsActorId, accountId: adsAccountId, creating, busy, active: true });
  const nativeSavePending = useRef(false);
  const nativeSaveAttempt = useRef<{ key: string; idempotencyKey: string } | null>(null);
  const savedBaseline = useRef<{ id: string; key: string | null } | null>(null);
  const adsFormGeneration = useRef(0);
  const assistantMedia = useRef<{ id: string; url: string; slot?: "feed" | "story_reel" } | null>(null);
  useLayoutEffect(() => { adsEditor.current = { draft, savedId, channelId, actorId: adsActorId, accountId: adsAccountId, creating, busy, active: true }; });
  useLayoutEffect(() => {
    // Capture a newly opened/created identity once, never subsequent local edits.
    if (savedBaseline.current?.id !== savedId) savedBaseline.current = savedId ? { id: savedId, key: adsDraftBaselineKey(draft) } : null;
  }, [savedId, draft]);
  useLayoutEffect(() => () => { adsEditor.current.active = false; }, []);

  useInrAssistantAdsCommands({
    snapshot: { draft, savedId, step, channelId, creating, creationPath, actorId: adsActorId, accountId: adsAccountId, generation: adsFormGeneration.current },
    mounted: creating && creationPath !== "choice",
    enabled: busy === null && !campaignMediaUploadBusy,
    channel: channelId, step: stepKeys[step], pendingChanges: dirty,
    async apply(command, isCurrent) {
      if (!creating || creationPath === "choice" || busy !== null || !isCurrent()) return false;
      if (command.command === "save_ads_draft") return saveDraft({ isCurrent });
      const { step: requestedStep, channel, mediaId, metaSlot } = command.patch;
      if (channel) {
        if (!pilotChannelsEnabled && !isAdsPublicChannel(channel)) return false;
        if (channel === channelId) return true;
        if (dirty && !await confirmInrcy({ title: i18nT("changer_de_canal_publicitaire_167032bc"), message: i18nT("le_formulaire_actuel_contient_des_modifications_c8371b7a"), confirmLabel: i18nT("changer_sans_enregistrer_4e7c2f78"), cancelLabel: i18nT("conserver_ma_saisie_f7040665"), variant: "warning" })) return false;
        if (!isCurrent()) return false;
        selectChannel(CHANNEL_CATALOG.findIndex(item => item.id === channel));
        return true;
      }
      if (mediaId) {
        const item = await loadInrAssistantAdsLibraryMedia(mediaId, isCurrent);
        if (!item || !isCurrent() || channelId === "meta" && !metaSlot || channelId !== "meta" && metaSlot) return false;
        assistantMedia.current = { id: mediaId, url: item.signed_url!, ...(metaSlot ? { slot: metaSlot } : {}) };
        applyCampaignMedia(item, metaSlot ?? null);
        return true;
      }
      const nextStep = requestedStep ? stepKeys.indexOf(requestedStep) : -1;
      if (requestedStep && (nextStep < 0 || nextStep !== step && !reachedStepKeys.includes(requestedStep)
        && !(nextStep === step + 1 && !(creationPath === "inrcy" && step === analysisStep && planProgress !== 100)))) return false;
      const prepared = prepareInrAssistantAdsFormPatch(draft, command.patch);
      if (!prepared.patch) { setNotice(prepared.error); return false; }
      const { channelSettings, ...patch } = prepared.patch;
      if (channelSettings) {
        // Preserve the native confirmation before discarding Pinterest signals.
        if (channelSettings.channel === "pinterest" && nativeSettings?.channel === "pinterest" && channelSettings.targetingMode !== nativeSettings.targetingMode) {
          const transition = preparePinterestTargetingTransition(nativeSettings.targetingMode, channelSettings.targetingMode, draft.keywords);
          if (transition.requiresConfirmation && !await confirmInrcy({ message: "Ce changement retire " + transition.removedSignalCount + " signal(s) manuel(s). Continuer ?", variant: "warning" })) return false;
          if (!isCurrent()) return false;
          updateNativeSettings(channelSettings);
          if (channelSettings.targetingMode === "automatic") updateDraft({ keywords: transition.keywords });
        } else updateNativeSettings(channelSettings);
      }
      if (Object.keys(patch).length) updateDraft(patch);
      if (nextStep >= 0) navigateToStep(nextStep);
      return true;
    },
    isApplied(command) {
      if (command.command === "save_ads_draft") return Boolean(savedId) && !dirty;
      if (command.patch.channel) return command.patch.channel === channelId;
      if (command.patch.mediaId) {
        const media = assistantMedia.current;
        return media?.id === command.patch.mediaId && (media.slot ? draft.metaCreativeAssets[media.slot === "feed" ? "feedImageUrl" : "storyReelImageUrl"] === media.url : draft.creativeUrl === media.url);
      }
      return inrAssistantAdsPatchIsApplied(draft, command.patch) && (command.patch.step === undefined || stepKeys[step] === command.patch.step);
    },
  });

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
      throw new Error("Associez d’abord un compte LinkedIn Ads dans la carte du canal.");
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
      const inputKey = linkedInAdsAutomaticPreflightKey(selectedAccountId, preflightDraft);
      if (inputKey !== linkedInLatestPreflightSignature.current) return;
      setLinkedInPreflight((current) => {
        if (!manualOnly) {
          const briefQueries = new Set(preflightDraft.targetLocations.map(linkedInGeoQueryKey));
          const merged = new Map((current?.geoResolutions || []).filter((entry) => !briefQueries.has(linkedInGeoQueryKey(entry.query))).map((entry) => [linkedInGeoQueryKey(entry.query), entry]));
          for (const entry of data.geoResolutions || []) merged.set(linkedInGeoQueryKey(entry.query), entry);
          return { ...data, inputKey, geoResolutions: [...merged.values()] };
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
    const preparedGroupDraft = prepareLinkedInPlanForGroup(baseDraft, { groups: data.campaignGroups || [],
      manualGroupId: linkedInManualGroupId.current, endIsExplicit: linkedInPlanEndIsExplicit.current });
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
      || (preparedGroupDraft.linkedinCampaignGroupId && preparedGroupDraft.linkedinCampaignGroupId !== baseDraft.linkedinCampaignGroupId)
      || (pricing && suggestedBid !== null && Number.isFinite(suggestedBid) && suggestedBid > 0),
    );
    if (!hasProviderDefault) return baseDraft;
    const providerPatch = (current: AdsCampaignInput): Partial<AdsCampaignInput> => {
      const patch: Partial<AdsCampaignInput> = {};
      if (current.provider !== "linkedin") return patch;
      const accountId = externalStatuses.linkedin.selectedAccountId || baseDraft.adAccountId;
      if (linkedInAdsAutomaticPreflightKey(accountId, current) !== linkedInAdsAutomaticPreflightKey(accountId, baseDraft)) return patch;
      if (preparedGroupDraft.linkedinCampaignGroupId && preparedGroupDraft.linkedinCampaignGroupId !== current.linkedinCampaignGroupId) patch.linkedinCampaignGroupId = preparedGroupDraft.linkedinCampaignGroupId;
      if (preparedGroupDraft.linkedinDeliverySettings?.budget.endAt !== baseDraft.linkedinDeliverySettings?.budget.endAt) {
        patch.linkedinDeliverySettings = preparedGroupDraft.linkedinDeliverySettings;
        patch.endDate = preparedGroupDraft.endDate;
      }
      if (!patch.linkedinCampaignGroupId && !current.linkedinCampaignGroupId && selected.campaignGroup
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
    const signature = linkedInLatestPreflightSignature.current;
    setLinkedInPreflightLoad("loading");
    setLinkedInPreflightError("");
    if (linkedInPreflightLoad === "error") setNotice("");
    try {
      const data = await fetchLinkedInPreflight(geoQueryOverride, force);
      if (context !== linkedInPreflightContext.current) return;
      if (signature !== linkedInLatestPreflightSignature.current) { setLinkedInPreflightLoad("idle"); return; }
      if (!geoQueryOverride) applyLinkedInProviderDefaults(data);
      setLinkedInPreflightLoad("ready");
    } catch (error) {
      if (context !== linkedInPreflightContext.current) return;
      if (signature !== linkedInLatestPreflightSignature.current) { setLinkedInPreflightLoad("idle"); return; }
      setLinkedInPreflightLoad("error");
      setLinkedInPreflightError(errorMessage(error, "shell.ads_error_1a0b7135ec"));
    }
  }

  linkedInResourcesLoader.current = loadLinkedInResources;
  const linkedInAutomaticLoadSignature = linkedInAdsAutomaticPreflightKey(
    externalStatuses.linkedin.selectedAccountId,
    draft,
  );
  linkedInLatestPreflightSignature.current = linkedInAutomaticLoadSignature;
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
      i18nT("ads_remove_manual_signals_confirmation", { count: transition.removedSignalCount }),
    )) return;
    updateNativeSettings({ ...nativeSettings, targetingMode });
    if (targetingMode === "automatic") updateDraft({ keywords: transition.keywords });
  }

  function clearPinterestManualSignals() {
    if (nativeSettings?.channel !== "pinterest" || nativeSettings.targetingMode !== "automatic" || draft.keywords.length === 0) return;
    if (!window.confirm(i18nT("retirer_les_signaux_manuels_restants_pour_c7401285"))) return;
    updateDraft({ keywords: [] });
  }

  function applyCampaignMedia(
    item: Pick<MediaLibraryPickerItem, "media_type" | "signed_url" | "title" | "original_file_name">
      & Partial<Pick<MediaLibraryPickerItem, "id" | "media_metadata" | "mime_type" | "size_bytes" | "width" | "height">>,
    requestedMetaSlot: MetaAdsMediaSlot | null = metaMediaSlot,
  ) {
    const url = String(item.signed_url || "").trim();
    if (!url) {
      setCampaignMediaUploadError(i18nT("ce_media_ne_peut_pas_encore_9b44cbe3"));
      return;
    }
    const mediaType = item.media_type === "video" ? "video" : "image";
    if (channelId === "openai") {
      if (mediaType !== "image" || !isMediaLibraryContentReference(url)) {
        setCampaignMediaUploadError(i18nT("choisissez_une_image_enregistree_dans_votre_bda19ed1"));
        return;
      }
      if (item.mime_type && item.mime_type !== "image/jpeg" && item.mime_type !== "image/png" && item.mime_type !== "image/webp") {
        setCampaignMediaUploadError(i18nT("ce_parcours_chatgpt_ads_accepte_une_0652418f"));
        return;
      }
      if (item.size_bytes && item.size_bytes > CHATGPT_ADS_MAX_IMAGE_BYTES) {
        setCampaignMediaUploadError(i18nT("l_image_chatgpt_ads_ne_doit_9b4800e0"));
        return;
      }
      if (item.width && item.height && (item.width !== item.height || item.width < CHATGPT_ADS_MIN_IMAGE_SIDE_PX)) {
        setCampaignMediaUploadError(i18nT("choisissez_une_image_carree_d_au_dc993ac4", { value0: CHATGPT_ADS_MIN_IMAGE_SIDE_PX, value1: CHATGPT_ADS_MIN_IMAGE_SIDE_PX }));
        return;
      }
    }
    if (channelId === "meta") {
      if (mediaType !== "image") {
        setCampaignMediaUploadError(i18nT("le_pack_meta_ads_utilise_ici_a32cac07"));
        return;
      }
      if (!requestedMetaSlot) {
        setCampaignMediaUploadError(i18nT("choisissez_d_abord_le_format_meta_634b5349"));
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
      setCampaignMediaUploadError(i18nT("google_search_accepte_ici_une_image_41dd326e"));
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
        errorMessage(error, expectedType === "video" ? "shell.ads_error_005d9154fe" : "shell.ads_error_58903e47f6"),
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
      setNotice(i18nT("choisissez_d_abord_un_compte_annonceur_73cb8501"));
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
      setNotice(errorMessage(error, "shell.ads_error_4d475624c6"));
    } finally {
      setConfigAction(null);
    }
  }

  async function savePageSelection() {
    if (!draft.pageId) {
      setNotice(i18nT("choisissez_d_abord_une_identite_facebook_576b61d2"));
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
      setNotice(errorMessage(error, "shell.ads_error_95635d1113"));
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
      setNotice(errorMessage(error, "shell.ads_error_710d90716a"));
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
      setNotice(errorMessage(error, "shell.ads_error_0d6bc28f5e"));
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
    setPlanBudgetRationale("");
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
    linkedInPlanEndIsExplicit.current = plan.linkedinCalendarConstraints?.endIsExplicit !== false;
    if (channelId === "linkedin") { setLinkedInPreflight(null); setLinkedInPreflightLoad("idle"); linkedInAutomaticLoadKey.current = ""; setLinkedInAudienceSuggestions(plan.linkedinTargetingSuggestions || []); setLinkedInAudiencePending((plan.linkedinTargetingSuggestions || []).reduce((count, suggestion) => count + suggestion.terms.length, 0)); }
    setConfirmedDestinationUrl("");
    setMetaMediaFormatStatus({ feed: "empty", story_reel: "empty" });
    setDraft((current) => projectAdsCampaignPlan(current, plan, {
      channelId,
      linkedInCampaignGroups: linkedInPreflight?.campaignGroups || [],
      linkedInManualGroupId: linkedInManualGroupId.current,
    }));
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
    setPlanBudgetRationale("");
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
      setPlanBudgetRationale(plan.budgetRecommendation?.rationale || "");
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
      setPlanError(errorMessage(error, "shell.ads_error_3fdf998321"));
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
    setPlanBudgetRationale("");
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
    adsFormGeneration.current += 1;
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
    setPlanBudgetRationale("");
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
    linkedInManualGroupId.current = null;
    linkedInPlanEndIsExplicit.current = true;
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
    eyebrow: i18nT("campagne_en_cours_41143e49"),
    title: i18nT("quitter_cette_campagne_a4b93470"),
    message: i18nT("votre_campagne_contient_des_informations_non_1098c262"),
    confirmLabel: i18nT("quitter_sans_enregistrer_095c1a97"),
    cancelLabel: i18nT("continuer_l_edition_0f0075bb"),
    variant: "danger",
  });

  function closeCampaignCreation() {
    adsFormGeneration.current += 1;
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

  async function saveDraft(options?: { isCurrent?: () => boolean }): Promise<boolean> {
    if (nativeSavePending.current || busy !== null) return false;
    const initial = adsEditor.current;
    const key = adsDraftContentKey({ draft: initial.draft, savedId: initial.savedId, channelId: initial.channelId, actorId: initial.actorId, accountId: initial.accountId, generation: adsFormGeneration.current });
    const isCurrent = () => adsEditor.current.active && adsEditor.current.creating
      && Boolean(initial.accountId) && getActiveBrowserUserId() === initial.accountId
      && (options?.isCurrent?.() ?? true)
      && key === adsDraftContentKey({ draft: adsEditor.current.draft, savedId: adsEditor.current.savedId, channelId: adsEditor.current.channelId, actorId: adsEditor.current.actorId, accountId: adsEditor.current.accountId, generation: adsFormGeneration.current });
    if (!isCurrent()) return false;
    if (nativeSaveAttempt.current?.key !== key) nativeSaveAttempt.current = { key, idempotencyKey: crypto.randomUUID() };
    nativeSavePending.current = true;
    setBusy("save"); setNotice("");
    try {
      const campaignDraft: AdsCampaignInput = {
        ...draft, provider: channelId,
        adAccountId: channelId === "pinterest" || channelId === "linkedin"
          ? externalStatuses[channelId].selectedAccountId || draft.adAccountId
          : channelId === "openai" ? connectionSnapshots.openai.accountId || draft.adAccountId : draft.adAccountId,
      };
      const baselineKey = savedBaseline.current?.id === savedId ? savedBaseline.current.key : null;
      const confirmed = await persistVerifiedAdsDraft({ draft: campaignDraft, savedId, baselineKey, idempotencyKey: nativeSaveAttempt.current.idempotencyKey, isCurrent });
      if (!isCurrent()) return false;
      savedBaseline.current = { id: confirmed.id, key: adsDraftBaselineKey(confirmed.draft) };
      setDraft(confirmed.draft); setSavedId(confirmed.id); setDirty(false);
      setConfirmedSpend(false); linkedInLaunchConsent.current = null;
      setDraftsRevision(revision => revision + 1); setNotice("");
      return true;
    } catch (error) {
      if (isCurrent()) setNotice(errorMessage(error, "shell.ads_error_48d4b8f851"));
      return false;
    } finally { nativeSavePending.current = false; if (adsEditor.current.active) setBusy(current => current === "save" ? null : current); }
  }

  async function validatePreparedDraft() {
    if (!preparedOnlyChannel || busy !== null) return;
    const key = preparedDraftKey;
    if (preparedBudgetApprovalKey !== key || preparedContentApprovalKey !== key || destinationReview.required && !destinationReview.confirmed || preparedReviewIssues.length) {
      setNotice(i18nT("relisez_les_reglages_prepares_et_cochez_e37e0223")); return;
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
      setNotice(i18nT("votre_brouillon_value_est_valide_et_34b8eb46", { value0: channelMeta.label }));
    } catch (error) { setNotice(errorMessage(error, "shell.ads_error_b307c2bd3d")); }
    finally { setBusy(null); }
  }

  function openPreparedLaunchDialog() {
    if (!preparedOnlyChannel || busy !== null || demoDialog || !preparedNativeCheck || !preparedNativeReady) return;
    if (preparedBudgetApprovalKey !== preparedDraftKey || preparedContentApprovalKey !== preparedDraftKey
      || destinationReview.required && !destinationReview.confirmed || preparedReviewIssues.length) {
      setNotice(i18nT("relisez_les_reglages_prepares_et_cochez_e37e0223")); return;
    }
    try {
      const calendar = plannedNativeCalendar(draft, Date.now(), preparedTimeZone);
      setConfirmedSpend(false);
      setDemoDialog({
        mode: "confirm", channelId, pageId: "", launchStatus: "paused", preparedReviewKey: preparedDraftKey,
        details: {
          campaignName: draft.name, channelLabel: channelMeta.label,
          accountName: externalStatuses[channelId === "tiktok" ? "tiktok" : "x"].selectedAccountName || draft.adAccountId,
          accountId: draft.adAccountId, dailyBudgetEuros: draft.dailyBudgetEuros, endDate: draft.endDate,
          nativeBudget: { type: calendar.budgetType, totalEuros: calendar.totalEuros, startAt: calendar.startAt,
            endAt: calendar.endAt, timeZone: calendar.timeZone },
        },
      });
    } catch (error) { setNotice(errorMessage(error, "shell.ads_error_ca994daaf5")); }
  }

  async function createPreparedPausedCampaign() {
    const confirmation = demoDialog;
    if (!preparedOnlyChannel || busy !== null || demoSubmissionRef.current || !preparedNativeCheck || !preparedNativeReady
      || !confirmation || confirmation.mode !== "confirm" || confirmation.channelId !== channelId
      || confirmation.launchStatus !== "paused" || !confirmedSpend || confirmation.preparedReviewKey !== preparedDraftKey) return;
    const key = preparedDraftKey;
    const assertUnchanged = () => {
      const current = preparedLatestReview.current;
      if (current.draftKey !== key || current.budgetKey !== key || current.contentKey !== key || destinationReview.required && current.destination !== draft.destinationUrl.trim())
        throw new Error("La proposition a changé. Relisez et confirmez ses réglages actuels.");
    };
    demoSubmissionRef.current = true;
    setBusy("publish"); setNotice(""); setPublicationPhase("saving");
    try {
      assertUnchanged();
      const result = await createReviewedPausedCampaign({ draft, savedId: savedId || undefined, checked: preparedNativeCheck, assertUnchanged }, async (url, init) => {
        if (url.endsWith("/publish")) setPublicationPhase("sending");
        return readJson(await fetch(url, init));
      });
      setSavedId(result.id); setDraftsRevision((value) => value + 1); setCreating(false);
      try { assertUnchanged(); setDirty(false); } catch { setDirty(true); }
      setDemoDialog({ ...confirmation, mode: "success" });
      setConfirmedSpend(false); setPublicationPhase("success");
      setNotice(i18nT("la_campagne_value_est_creee_en_9e17ba05", { value0: channelMeta.label }));
    } catch (error) { setDemoDialog(null); setPublicationPhase("idle"); setNotice(errorMessage(error, "shell.ads_error_b5a7121c04")); }
    finally { demoSubmissionRef.current = false; setBusy(null); }
  }

  async function openLaunchDialog(validatePreparedCampaign = false) {
    const approvedLinkedInCampaign = validatePreparedCampaign ? linkedInLaunchConsent.current : null;
    if (validatePreparedCampaign && (!["linkedin", "google", "pinterest", "meta", "openai"].includes(channelId) || !confirmedSpend
      || !approvedLinkedInCampaign || approvedLinkedInCampaign.key !== JSON.stringify(draft))) {
      setNotice(i18nT("cochez_la_confirmation_du_budget_et_9cefe2e5"));
      return;
    }
    if (validatePreparedCampaign && destinationReview.required && (!destinationReview.valid || !destinationReview.confirmed)) {
      setNotice(i18nT("confirmez_le_lien_de_destination_sur_95a15c39"));
      return;
    }
    let preparedCampaignId = "";
    if (!isAdsDraftAccountChannel(channelId)) {
      setNotice(i18nT("la_publication_value_n_est_pas_5ef9177b", { value0: channelMeta.label }));
      return;
    }
    if (busy !== null || demoSubmissionRef.current || demoDialog) return;
    if (channelId === "linkedin" && !linkedInComplianceReady) {
      setNotice(i18nT("confirmez_la_declaration_not_political_et_e340522e"));
      return;
    }
    if (!channelPublishingEnabled) {
      setNotice(i18nT("le_lancement_value_est_momentanement_verrouille_0e86c256", { value0: channelMeta.label }));
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
      setNotice(i18nT("le_connecteur_de_lancement_actuellement_branche_8bc499e3"));
      return;
    }
    if (!metaLivePlacementsSupported) {
      setNotice(i18nT("la_demo_meta_accepte_les_fils_63be235b"));
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
          throw new Error(i18nT("le_compte_ses_ressources_ou_son_66e07ca4"));
        }
        const validated = parseAdsCampaignInput(launchDraft, { purpose: "publish" });
        if (!validated.draft) throw new Error(validated.error || i18nT("verifiez_les_reglages_de_la_campagne_7f3cce5b"));
        if (!approvedLinkedInCampaign || linkedInLaunchConsent.current !== approvedLinkedInCampaign
          || approvedLinkedInCampaign.key !== JSON.stringify(launchDraft) || approvedLinkedInCampaign.status !== launchStatus) {
          setConfirmedSpend(false); linkedInLaunchConsent.current = null;
          throw new Error(i18nT("les_reglages_ou_le_statut_de_7f0b4fd2"));
        }
        const saved = await readJson(await fetch("/api/ads/campaigns", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...launchDraft, ...(savedId ? { id: savedId } : {}) }),
        }));
        const id = String((saved.campaign as { id?: string } | undefined)?.id || "");
        if (!id) throw new Error(i18nT("le_brouillon_n_a_pas_pu_30eab68c"));
        if (linkedInLaunchConsent.current !== approvedLinkedInCampaign || approvedLinkedInCampaign.key !== JSON.stringify(launchDraft)) {
          throw new Error(i18nT("vos_reglages_ont_change_pendant_l_d32d8f77"));
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
          throw new Error(i18nT("la_plateforme_n_a_pas_confirme_2ab031ad"));
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
        mergeExternalStatus("pinterest", {
          load: "ready",
          connected: true,
          status: "connected",
          selectedAccountId: accountId,
          selectedAccountName: accountName,
          error: "",
        });
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
        mergeExternalStatus("linkedin", {
          load: "ready",
          connected: true,
          status: "connected",
          selectedAccountId: accountId,
          selectedAccountName: accountName,
          selectedAccountCanManage: true,
          selectedAccountCanServe: connection.selectedAccountCanServe === true,
          error: "",
        });
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
          setNotice(i18nT("les_reglages_ont_change_pendant_la_19f60431"));
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
          setNotice(i18nT("vos_modifications_sont_conservees_verifiez_le_ce4ef7ba"));
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
            : "Aucun compte annonceur n’est associé à ce canal. Associez-en un dans la carte du canal.");
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
          setNotice(i18nT("les_reglages_de_la_campagne_ont_f7cbf020"));
          return;
        }
        confirmation.prepared = { draft: launchDraft, savedId: preparedCampaignId };
      }
      setConfirmedSpend(false); linkedInLaunchConsent.current = null;
      setDemoDialog(confirmation);
    } catch (error) {
      if (channelId === "linkedin") {
        setLinkedInPreflightLoad("error");
        setLinkedInPreflightError(errorMessage(error, "shell.ads_error_9dd78ed691"));
      }
      setNotice(errorMessage(error, "shell.ads_error_93c30c90a5"));
    } finally { demoSubmissionRef.current = false; setBusy(null); }
  }

  async function confirmCampaignLaunch() {
    const confirmation = demoDialog;
    if (!confirmation || confirmation.mode !== "confirm" || !confirmedSpend || busy !== null || demoSubmissionRef.current) return;
    if (confirmation.channelId === "x" || confirmation.channelId === "tiktok") {
      await createPreparedPausedCampaign();
      return;
    }
    const prepared = confirmation.prepared;
    if (prepared && JSON.stringify(prepared.draft) !== JSON.stringify(draft)) {
      setConfirmedSpend(false);
      setDemoDialog(null);
      setNotice(i18nT("les_reglages_ont_change_depuis_la_c0dc415c"));
      return;
    }
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
      setNotice(errorMessage(error, "shell.ads_error_fdf4749e70"));
    } finally { demoSubmissionRef.current = false; setBusy(null); }
  }

  function reopen(campaign: StoredCampaign) {
    if (campaign.status !== "draft") return;
    if (!pilotChannelsEnabled && !isAdsPublicChannel(campaign.provider)) return;
    adsFormGeneration.current += 1;
    savedBaseline.current = { id: campaign.id, key: adsDraftBaselineKey(campaign.draft) };
    linkedInManualGroupId.current = campaign.draft.linkedinCampaignGroupId || null;
    linkedInPlanEndIsExplicit.current = true;
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
    setPlanBudgetRationale("");
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

  const onRouteDraftLoaded = useEffectEvent((campaign: StoredCampaign) => reopen(campaign));

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
        onRouteDraftLoaded(campaign);
      })
      .catch((error) => setNotice(errorMessage(error, "shell.ads_error_9c1ed5c11b")));
  }, [initialEditCampaignId, errorMessage]);

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
    ? i18nT("ads_ui_d21a2a0c7b")
    : !draft.metaCreativeAssets.feedImageUrl
      ? i18nT("ads_ui_431eebb3fb")
      : metaMediaFormatStatus.feed === "valid"
        ? i18nT("ads_ui_fc3b046368")
        : metaMediaFormatStatus.feed === "invalid"
          ? i18nT("ads_ui_15db643bb3")
          : i18nT("ads_ui_7d198007ee");
  const metaStoryReelReviewLabel = !metaMediaReadiness.requiresStoryReelImage
    ? i18nT("ads_ui_771f01429e")
    : !draft.metaCreativeAssets.storyReelImageUrl
      ? i18nT("ads_ui_0c9188075d")
      : metaMediaFormatStatus.story_reel === "valid"
        ? i18nT("ads_ui_fc687ed96f")
        : metaMediaFormatStatus.story_reel === "invalid"
          ? i18nT("ads_ui_838b36faa4")
          : i18nT("ads_ui_8d45cef6ae");
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
  const linkedInScheduleIssue = linkedInCalendarIssue(draft, selectedLinkedInCampaignGroup);
  const linkedInCalendarRepair = channelId === "linkedin" && linkedInScheduleIssue && selectedLinkedInCampaignGroup
    ? prepareLinkedInPlanForGroup(draft, { groups: [selectedLinkedInCampaignGroup], manualGroupId: draft.linkedinCampaignGroupId || null, endIsExplicit: false }) : null;
  const linkedInCalendarCanBeRepaired = Boolean(linkedInCalendarRepair
    && linkedInCalendarRepair.linkedinDeliverySettings?.budget.endAt !== draft.linkedinDeliverySettings?.budget.endAt);
  const linkedInPreflightCurrent = linkedInPreflight?.inputKey === linkedInAutomaticLoadSignature;
  const linkedInGeoTargets = normalizeLinkedInGeoTargets(draft.linkedinGeoTargets ?? []) || [];
  const linkedInVerifiedGeoUrns = new Set(linkedInPreflight?.selected?.verifiedGeoUrns || []);
  const linkedInGeoResolutions = linkedInPreflight?.geoResolutions || [];
  const linkedInBriefGeoStatus = (label: string) => {
    const resolution = linkedInGeoResolutions.find((entry) => linkedInGeoQueryKey(entry.query) === linkedInGeoQueryKey(label));
    if (!resolution) return { label: linkedInPreflightLoad === "loading" ? i18nT("verification_30a67937") : i18nT("brief_seul_1bee6f24"), verified: false };
    if (resolution.status === "provider_rejected") {
      return { label: i18nT("zone_refusee_par_linkedin_essayez_une_65e61f8f"), verified: false, rejected: true };
    }
    const verified = resolution.suggestions.some((suggestion) =>
      linkedInVerifiedGeoUrns.has(suggestion.urn) && linkedInGeoTargets.some((target) => target.urn === suggestion.urn));
    return verified
      ? { label: i18nT("verifiee_linkedin_97c52b68"), verified: true }
      : { label: resolution.suggestions.length ? i18nT("choix_exact_requis_8a1c8274") : i18nT("non_trouvee_a586e5e8"), verified: false };
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
    && linkedInPreflightCurrent
    && linkedInBriefGeoReady
    && linkedInAudiencePending === 0
    && linkedInGeoTargets.every((target) => linkedInVerifiedGeoUrns.has(target.urn))
    && linkedInBidPricing
    && !linkedInBudgetBelowProviderMinimum
    && !linkedInBidOutsideVerifiedRange
    && !linkedInScheduleIssue
    && !linkedInPreflight.blockers?.some((blocker) => ["unresolved_geo_queries", "geo_query_provider_rejected", "selected_geo_unverified", "too_many_geo_targets", "budget_pricing_required"].includes(blocker))
    && (!linkedInManualBid || (draft.linkedinBidEuros && draft.linkedinBidEuros > 0))
    && !(nativeSettings?.channel === "linkedin" && nativeSettings.objectiveType === "WEBSITE_CONVERSION" && !linkedInDelivery.conversions.conversionUrns.length)
    && !linkedInPreflight.blockers?.some((blocker) => ["selected_professional_targets_unverified", "selected_conversion_unverified", "conversion_required", "total_budget_too_low", "unsupported_delivery_settings", "campaign_schedule_invalid", "audience_count_required", "audience_too_small"].includes(blocker)),
  );
  const linkedInPreparedLaunchStatus: AdsCampaignLaunchStatus = linkedInPreflight?.account?.canServeCampaigns === true
    && selectedLinkedInCampaignGroup?.status === "ACTIVE" ? "active" : "paused";
  const linkedInUnverifiedGeoTargets = linkedInGeoTargets.filter((target) => !linkedInVerifiedGeoUrns.has(target.urn));
  const linkedInReadinessIssue: CampaignReadinessIssue = (() => {
    const issue = (step: number, message: string) => ({ step: step + 1, message });
    if (linkedInAudiencePending > 0) return issue(targetingStep, i18nT("ads_ui_10db446517"));
    if (linkedInPreflightLoad === "error") {
      return issue(foundationsStep, linkedInPreflightError || i18nT("ads_ui_d78f868927"));
    }
    if (linkedInPreflightLoad !== "ready" || !linkedInPreflight || !linkedInPreflightCurrent) {
      return issue(foundationsStep, i18nT("ads_ui_4ea3193bfd"));
    }
    if (!draft.linkedinCampaignGroupId || !draft.linkedinOrganizationUrn) {
      return issue(foundationsStep, i18nT("ads_ui_28cad7a4e4"));
    }
    if (linkedInMissingGeoLocations.length) {
      const names = linkedInMissingGeoLocations.map((label) => `« ${label} »`).join(", ");
      const verified = draft.targetLocations.length - linkedInMissingGeoLocations.length;
      return issue(geographyStep, i18nT("ads_ui_2ebc8f39d9", { value0: names, value1: verified, value2: draft.targetLocations.length }));
    }
    if (!linkedInGeoTargets.length) return issue(geographyStep, i18nT("ads_ui_3682cec5ed"));
    if (linkedInGeoTargets.length > 20) return issue(geographyStep, i18nT("ads_ui_8d78e0d4e7"));
    if (linkedInUnverifiedGeoTargets.length || linkedInPreflight.blockers?.includes("selected_geo_unverified")) {
      const names = linkedInUnverifiedGeoTargets.map((target) => target.name).join(", ");
      return issue(geographyStep, i18nT("ads_ui_1ed500802b", { value0: names ? ` : ${names}` : "" }));
    }
    if (linkedInPreflight.blockers?.includes("unresolved_geo_queries") || linkedInPreflight.blockers?.includes("geo_query_provider_rejected")) {
      return issue(geographyStep, i18nT("ads_ui_d48a028c81"));
    }
    if (!linkedInBidPricing || linkedInPreflight.blockers?.includes("budget_pricing_required")) {
      return issue(budgetStep, i18nT("ads_ui_eae76787ac"));
    }
    if (linkedInBudgetBelowProviderMinimum) {
      return issue(budgetStep, i18nT("ads_ui_71d3b1ce71", { value0: linkedInBidPricing.dailyBudgetMin.toLocaleString(locale) }));
    }
    if (linkedInManualBid && (!draft.linkedinBidEuros || draft.linkedinBidEuros <= 0)) return issue(budgetStep, i18nT("ads_ui_f69c8a13d0"));
    if (linkedInBidOutsideVerifiedRange) {
      return issue(budgetStep, i18nT("ads_ui_1c289f937c"));
    }
    if (linkedInScheduleIssue) return issue(budgetStep, linkedInScheduleIssue);
    const blockers = linkedInAdsLaunchBlockers(linkedInPreflight.blockers, linkedInPreparedLaunchStatus === "active" ? "ACTIVE" : "PAUSED");
    const blocker = blockers[0] || "";
    const issueStep = /professional_targets|audience/.test(blocker) ? targetingStep
      : /conversion/.test(blocker) ? deliveryStep
        : /budget|schedule/.test(blocker) ? budgetStep
          : /political|targeting_notice/.test(blocker) ? validationStep : foundationsStep;
    return issue(issueStep, linkedInAdsLaunchBlockerMessage(blockers) || i18nT("ads_ui_a38ca5f495"));
  })();
  const linkedInReadinessDetails = linkedInReadinessIssue.message;
  const linkedInComplianceReady = draft.linkedinPoliticalIntentConfirmed === true
    && draft.linkedinTargetingNoticeAcknowledged === true;
  const launchStepMap: AdsLaunchStepMap = {
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
  };
  const incompleteLaunchSteps = adsIncompleteLaunchSteps({
    draft,
    steps: launchStepMap,
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
    ? i18nT("ads_ui_99f038dac8", { value0: channelMeta.label })
    : !channelPublishingEnabled
      ? i18nT("le_lancement_value_est_momentanement_verrouille_0e86c256", { value0: channelMeta.label })
      : connectorConfigurationIssue
        ? connectorConfigurationIssue
        : !liveFormatAvailable
          ? i18nT("ads_ui_604f2646c5", { value0: channelMeta.label })
          : !livePublisherConversionReady
            ? i18nT("ads_ui_c9aa0de419")
            : !metaLiveObjectiveSupported
              ? i18nT("ads_ui_1101b93abb")
              : !metaLiveGoalSupported
                ? i18nT("ads_ui_28c375fa53")
                : !metaLivePlacementsSupported
                  ? i18nT("ads_ui_b88cf8817b")
                  : !metaLiveCreativeSupported
                    ? i18nT("ads_ui_d1ef829c5d")
                    : !metaLiveCtaSupported
                      ? i18nT("ads_ui_7ae82bea81")
                      : !livePublisherMediaReady
                        ? i18nT("ads_ui_d41d3c2db2")
                        : "";
  const linkedInLaunchReadinessReason = channelId === "linkedin"
    ? !linkedInSelectionsReady
      ? linkedInReadinessDetails
      : !linkedInComplianceReady
        ? i18nT("ads_ui_a9b09aa8e3")
        : ""
    : "";
  const googleLaunchReadinessIssue: CampaignReadinessIssue | null = channelId === "google" && draft.campaignType === "search" ? (() => {
    const localIssue = googleSearchLocalIssue(draft);
    if (localIssue) {
      const step = /budget|enveloppe|date|début|diffusion/i.test(localIssue) ? budgetStep
        : /titre|description|chemin/i.test(localIssue) ? creativeStep
          : /mots-clés|correspondance/i.test(localIssue) ? keywordsStep
            : /géographique/i.test(localIssue) ? geographyStep : biddingStep;
      return { step: step + 1, message: localIssue };
    }
    if (!googleGeoReady) return { step: geographyStep + 1, message: googleGeoState.key === googleGeoKey && googleGeoState.status === "error" ? googleGeoState.error : i18nT("ads_ui_c212ba54f1") };
    if (!effectiveGoogleResources || googleResourcesLoad !== "ready") return { step: foundationsStep + 1, message: googleResourcesError || i18nT("ads_ui_ce4c6f598f") };
    if (["maximize_conversions", "maximize_value", "target_cpa", "target_roas"].includes(draft.bidStrategy) && !effectiveGoogleResources.hasBiddableConversions) return { step: biddingStep + 1, message: i18nT("aucune_conversion_principale_active_choisissez_m_bcc03b96") };
    return null;
  })() : null;
  const googleLaunchReadinessReason = googleLaunchReadinessIssue?.message || "";
  const pinterestLaunchReadinessIssue: CampaignReadinessIssue | null = channelId === "pinterest" ? (() => {
    if (!effectivePinterestResources || pinterestResourcesLoad !== "ready") return { step: foundationsStep + 1, message: pinterestResourcesError || i18nT("ads_ui_2733d5f0b3") };
    if (!pinterestGeoReady) return { step: geographyStep + 1, message: pinterestResolvedGeography.error };
    if (pinterestResolvedLanguages.error) return { step: targetingStep + 1, message: pinterestResolvedLanguages.error };
    try { pinterestNativeDelivery(draft); return null; }
    catch (error) {
      const message = errorMessage(error, "shell.ads_error_ba394891ec");
      return { step: adsNativeDeliveryIssueStep(channelId, error instanceof Error ? error.message : "", launchStepMap), message };
    }
  })() : null;
  const pinterestLaunchReadinessReason = pinterestLaunchReadinessIssue?.message || "";
  const metaLaunchReadinessIssue: CampaignReadinessIssue | null = channelId === "meta" ? (() => {
    if (!effectiveMetaResources || metaResourcesLoad !== "ready") return { step: foundationsStep + 1, message: metaResourcesError || i18nT("ads_ui_8da8c2e3a9") };
    if (!metaGeoReady) return { step: geographyStep + 1, message: metaGeoState.key === metaGeoKey && metaGeoState.error || i18nT("ads_ui_c6f9b05541") };
    if (draft.metaDeliverySettings && metaResolvedLanguages.error) return { step: targetingStep + 1, message: metaResolvedLanguages.error };
    try { metaNativeDelivery(draft); return null; }
    catch (error) {
      const message = errorMessage(error, "shell.ads_error_cfef74f02b");
      return { step: adsNativeDeliveryIssueStep(channelId, error instanceof Error ? error.message : "", launchStepMap), message };
    }
  })() : null;
  const metaLaunchReadinessReason = metaLaunchReadinessIssue?.message || "";
  const openaiLaunchReadinessIssue: CampaignReadinessIssue | null = channelId === "openai" ? (() => {
    if (!effectiveOpenaiResources || openaiResourcesLoad !== "ready") return { step: foundationsStep + 1, message: openaiResourcesError || i18nT("ads_ui_eeb81d8db2") };
    if (!openaiGeoReady) return { step: geographyStep + 1, message: i18nT("une_zone_chatgpt_ads_reste_a_12567569") };
    try { openaiNativeDelivery(draft, Date.now(), effectiveOpenaiResources.account.timezone || "UTC"); return null; }
    catch (error) {
      const message = errorMessage(error, "shell.ads_error_ee2397f631");
      return { step: adsNativeDeliveryIssueStep(channelId, error instanceof Error ? error.message : "", launchStepMap), message };
    }
  })() : null;
  const openaiLaunchReadinessReason = openaiLaunchReadinessIssue?.message || "";
  const metaConsentCalendar = metaAdsCalendarLabels(draft, effectiveMetaResources?.account.timezone || null, i18nT, locale);
  const launchBlockingMessage = incompleteLaunchMessage || launchUnavailableReason || linkedInLaunchReadinessReason || googleLaunchReadinessReason || pinterestLaunchReadinessReason || metaLaunchReadinessReason || openaiLaunchReadinessReason;
  const launchBlocked = Boolean(launchBlockingMessage);

  const preparedReviewDetails = preparedOnlyChannel ? preparedAdsReviewDetails(draft, Date.now(), preparedTimeZone) : [];
  const preparedReviewIssues = preparedReviewDetails.map((issue) => issue.message);
  const preparedNativeCheck = preparedNativeReadiness.draftKey === JSON.stringify(draft) ? preparedNativeReadiness.check : null;
  const stepWarningMessages = new Map<number, string>();
  for (const number of incompleteLaunchSteps) stepWarningMessages.set(number, i18nT("ads_ui_d334817672"));
  for (const issue of [
    linkedInLaunchReadinessReason ? !linkedInComplianceReady && linkedInSelectionsReady
      ? { step: validationStep + 1, message: linkedInLaunchReadinessReason } : linkedInReadinessIssue : null,
    googleLaunchReadinessIssue, pinterestLaunchReadinessIssue, metaLaunchReadinessIssue, openaiLaunchReadinessIssue,
  ]) {
    if (issue?.message) stepWarningMessages.set(issue.step, issue.message);
  }
  for (const issue of preparedReviewDetails) {
    const index = displayedStepKeys.indexOf(issue.step);
    if (index >= 0) stepWarningMessages.set(index + 1, issue.message);
  }
  if (preparedOnlyChannel) for (const code of preparedNativeCheck?.blockers || []) {
    const index = displayedStepKeys.indexOf(preparedNativeBlockerStep(code, channelId === "tiktok" ? "tiktok" : "x"));
    if (index >= 0) stepWarningMessages.set(index + 1, preparedNativeBlockerLabel(code));
  }
  const preparedNativeReady = preparedNativeCheck?.ready === true && preparedNativeCheck.pausedCreationEnabled;
  const tikTokPausedNotice = channelId === "tiktok" ? {
    title: preparedNativeReady ? i18nT("ads_ui_6653391577") : i18nT("ads_ui_8032dea964"),
    message: preparedNativeReady
      ? i18nT("ads_ui_37c49ab06c")
      : i18nT("ads_ui_a1cfc88ca6", { value0: preparedNativeReadiness.draftKey === JSON.stringify(draft) && preparedNativeReadiness.error
        || (preparedNativeCheck?.blockers.includes("paused_creation_disabled")
          ? i18nT("ads_ui_ed3a6c44aa")
          : preparedNativeCheck?.blockers.includes("native_capabilities_unverified")
            ? i18nT("ads_ui_67ec23c922")
            : i18nT("ads_ui_3b2c1cbfae")) }),
  } : null;
  const preparedDraftKey = JSON.stringify({ draft, resources: channelId === "tiktok" ? tikTokAdsResourcesConsentKey(effectiveTikTokResources) : xAdsResourcesConsentKey(preparedXResources), nativeConsent: preparedNativeCheck?.consentKey || "" });
  preparedLatestReview.current = { draftKey: preparedDraftKey, budgetKey: preparedBudgetApprovalKey, contentKey: preparedContentApprovalKey, destination: confirmedDestinationUrl };
  let preparedBudgetError = "";
  if (preparedOnlyChannel) { try { plannedNativeCalendar(draft, Date.now(), preparedTimeZone); } catch (error) { preparedBudgetError = errorMessage(error, "shell.ads_error_12ec2686ed"); } }

  const campaignLocationFields = <div className={`${styles.studioLocationField}${["linkedin", "google", "pinterest", "meta", "openai", "x", "tiktok"].includes(channelId) ? ` ${styles.studioWide}` : ""}`}><TagField label={i18nT("zones_ciblees_09e322f6")} helper={i18nT("ads_ui_de6dea1316")} values={draft.targetLocations} onChange={(targetLocations) => {
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
          }} placeholder={channelId === "pinterest" ? i18nT("choisissez_une_zone_pinterest_ci_dessous_9c3e3ab5") : ["openai", "linkedin", "google", "meta"].includes(channelId) ? i18nT("ex_lille_hauts_de_france_france_4eb5ea66") : i18nT("ex_lyon_rhone_france_184207a5")} note={channelId === "linkedin" ? i18nT("ads_ui_e4a4ee3a10") : channelId === "openai" ? i18nT("ads_ui_523e5c7009") : channelId === "pinterest" ? i18nT("ads_ui_45983aeef5") : preparedOnlyChannel ? i18nT("ads_ui_6fa1aa55e2") : undefined} maxItems={channelId === "linkedin" ? 8 : 20} maxItemLength={channelId === "linkedin" ? 80 : ["pinterest", "meta", "x", "tiktok"].includes(channelId) ? 120 : undefined} getTagStatus={channelId === "linkedin" ? linkedInBriefGeoStatus : channelId === "pinterest" ? (label) => {
            if (!effectivePinterestResources) return { label: pinterestResourcesLoad === "error" ? i18nT("a_verifier_8f5f7255") : i18nT("verification_30a67937"), verified: false };
            try { resolvePinterestAdsGeographies(effectivePinterestResources, [label]); return { label: i18nT("verifiee_pinterest_366a82d0"), verified: true }; }
            catch { return { label: i18nT("zone_a_ajuster_56565f50"), verified: false }; }
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
            <DashboardToolHeading subtitle={i18nT("donnez_de_l_elan_a_votre_1bdc69ed")}>
              <h1>{i18nT("inr_cb7c9950")}<span>{i18nT("ads_ui_0d1c315edb")}</span></h1><span className={styles.premiumBadge}>{i18nT("premium_6c2f2888")}</span>
            </DashboardToolHeading>
          </div>
          <nav className={styles.headerActions} aria-label={i18nT("actions_inr_ads_9eb0e08a")}>
            <Link href="/dashboard/mails?folder=campagnes-ads" className={styles.trackingButton} aria-label={i18nT("voir_les_campagnes_dans_inr_send_d3b02b3f")} title={i18nT("voir_les_campagnes_dans_inr_send_d3b02b3f")}>
              <span className={styles.headerActionIcon} aria-hidden="true"><Image src="/inrsend-logo-seul.png" alt="" width={28} height={28} className={styles.inrsendHeaderLogo} /></span>
              <span className={styles.headerActionText}>{i18nT("inr_send_98e1b891")}</span>
            </Link>
            <AdsDraftsMenu refreshKey={draftsRevision} onOpenDraft={openDraftFromHeader} />
            <Link href="/dashboard" className={`${styles.back} ${styles.headerCloseButton}`} aria-label={i18nT("fermer_inr_ads_bc3e9419")} title={i18nT("fermer_inr_ads_bc3e9419")}><span className={styles.headerActionIcon} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" /></svg></span><span className={styles.headerActionText}>{i18nT("fermer_5ab4ec64")}</span></Link>
          </nav>
        </div>
      </header>

      {notice && !creating && <p className={`${styles.notice} ${styles.cockpitNotice}`} role="alert">{notice}</p>}
      <section id="ads-channels" className={styles.channelCard} aria-label={i18nT("canaux_publicitaires_8d6084df")}>
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
        <div className={styles.sectionHeading}><div><span>{i18nT("amplifiez_votre_portee_0c7dcc26")}</span><h2>{i18nT("choisissez_votre_terrain_de_jeu_644eb8d9")}</h2></div><p>{i18nT("selectionnez_un_canal_puis_configurez_votre_0e2acdd9")}</p></div>
        <nav className={styles.channelRail} aria-label={i18nT("choisir_un_canal_publicitaire_514183c7")}>{CHANNEL_CATALOG.map((channel, index) => {
          const locked = !pilotChannelsEnabled && !isAdsPublicChannel(channel.id);
          return <button type="button" key={channel.id} aria-label={`${channel.label}${locked ? ` · ${comingSoonLabel}` : ""}`} title={locked ? `${channel.label} · ${comingSoonLabel}` : channel.label} disabled={locked} data-channel={channel.id} data-locked={locked || undefined} data-near={index === channelIndex || index === (channelIndex + 1) % CHANNEL_CATALOG.length || index === (channelIndex - 1 + CHANNEL_CATALOG.length) % CHANNEL_CATALOG.length || undefined} onClick={() => selectChannel(index)} aria-pressed={index === channelIndex}><span className={styles.channelRailLogo} aria-hidden="true"><Image src={channel.logo} width={40} height={40} alt="" draggable={false} /></span><span className={styles.channelRailLabel}>{channel.label}</span></button>;
        })}</nav>
        <div className={styles.channelCarousel} data-testid="ads-channel-carousel">
          <button type="button" onClick={() => selectChannel(channelIndex - 1)} aria-label={i18nT("canal_precedent_e644dfdf")}>‹</button>
          <div className={styles.cubeStage} tabIndex={0} role="group" aria-label={i18nT("carrousel_des_canaux_fleches_gauche_et_c047fc3a")} onKeyDown={(event) => { if ((event.target as HTMLElement).closest("input,select,textarea,form")) return; if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); selectChannel(channelIndex + (event.key === "ArrowRight" ? 1 : -1)); } }} onPointerDown={(event) => { if (!(event.target as HTMLElement).closest("button,a,input,select,textarea,form")) channelPointerStart.current = { x: event.clientX, y: event.clientY }; }} onPointerUp={(event) => { const start = channelPointerStart.current; channelPointerStart.current = null; if (!start) return; const dx = event.clientX - start.x; if (Math.abs(dx) >= 58 && Math.abs(dx) > Math.abs(event.clientY - start.y) * 1.5) selectChannel(channelIndex + (dx < 0 ? 1 : -1)); }} onPointerCancel={() => { channelPointerStart.current = null; }}>
          {[-1, 0, 1].map((offset) => {
            const index = (channelIndex + offset + CHANNEL_CATALOG.length) % CHANNEL_CATALOG.length;
            const channel = CHANNEL_CATALOG[index];
            const externalChannel = isExternalChannel(channel.id) ? channel.id : null;
            const locked = !pilotChannelsEnabled && !isAdsPublicChannel(channel.id);
            const display = locked ? { tone: "locked", label: comingSoonLabel }
              : channel.provider ? adsConnectionDisplay(connectionSnapshots[channel.provider])
                : channel.id === "openai" ? adsConnectionDisplay(connectionSnapshots.openai)
                  : externalStatusDisplay(externalStatuses[externalChannel!], i18nT);
            return <div key={offset} data-provider={channel.id} data-locked={locked || undefined} className={`${styles.channel} ${offset === 0 ? styles.channelActive : styles.channelMini}`}>
              {offset !== 0 && <button className={styles.miniSelect} type="button" disabled={locked} aria-label={i18nT("afficher_value_value_cbe2d29a", { value0: channel.label, value1: locked ? ` · ${comingSoonLabel}` : "" })} onClick={() => selectChannel(index)} />}
              <span className={styles.channelLogo}><Image src={channel.logo} width={56} height={56} alt="" draggable={false} /></span>
              <div className={styles.channelIdentity}><strong>{channel.label}</strong><small>{channel.slogan}</small></div>
              <span className={styles.channelConnectionDot} data-status={display.tone} role="img" aria-label={adsUiText(i18nT, display.label)} title={adsUiText(i18nT, display.label)} />
              {offset === 0 && <div className={styles.connectionWorkspace} data-testid="ads-inline-connection">
    <AdsConnectionSettings
      active={isAdsProvider(channelId)}
      provider={provider}
      locked={!pilotChannelsEnabled && !isAdsPublicChannel(channelId)}
      connected={connected}
      connectionStatus={connectionStatus}
      connectionAccount={connectionAccount}
      loading={loadingAccounts}
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
      active={isExternalChannel(channelId)}
      channel={externalSettingsChannel}
      locked={!pilotChannelsEnabled && !isAdsPublicChannel(channelId)}
      status={!pilotChannelsEnabled && !isAdsPublicChannel(externalSettingsChannel)
        ? { ...externalStatuses[externalSettingsChannel], load: "ready", connected: false, status: "locked", selectedAccountId: "", selectedAccountName: "", error: "" }
        : externalStatuses[externalSettingsChannel]}
      accounts={externalAccounts}
      accountChoice={externalAccountChoice}
      accountsLoading={externalAccountsLoading}
      accountsLoaded={externalAccountsLoaded(externalSettingsChannel)}
      accountsLoadFailed={externalAccountsLoadFailed}
      action={externalAction}
      error={externalError}
      onSelectAccount={(id) => selectExternalAccount(externalSettingsChannel, id)}
      onRefreshStatus={() => void refreshExternalStatus(externalSettingsChannel)}
      onRefreshAccounts={() => void loadExternalAccounts(externalSettingsChannel, externalStatuses[externalSettingsChannel].selectedAccountId, true)}
      onAssociateAccount={() => void associateExternalAccount(channelId)}
      onDisconnect={() => void disconnectExternalChannel(channelId)}
    />
    <OpenaiAdsConnectionSettings
      active={channelId === "openai"}
      locked={!pilotChannelsEnabled && !isAdsPublicChannel("openai")}
      onConnectionChange={() => void refreshOpenaiStatus()}
      initialConnection={connectionSnapshots.openai}
    />
              </div>}
            </div>;
          })}
          </div>
          <button type="button" onClick={() => selectChannel(channelIndex + 1)} aria-label={i18nT("canal_suivant_d20db274")}>›</button>
        </div>
      </section>

      <div className={styles.launchArea}>
        <button ref={launchButtonRef} type="button" onClick={startNewCampaign} disabled={!pilotChannelsEnabled && !isAdsPublicChannel(channelId)} className={`${styles.headerCta} ${styles.launchButton}`}><span aria-hidden="true">✦</span> {!pilotChannelsEnabled && !isAdsPublicChannel(channelId) ? comingSoonLabel : i18nT("lancer_une_campagne_a806e57c")} <span aria-hidden="true">↗</span></button>
      </div>

      <SettingsDrawer title={campaignCreationTitle} isOpen={creating} onClose={() => { if (!demoDialog && busy !== "demo") void confirmCampaignExit(); }} closeOnEscape={!demoDialog && busy !== "demo"} closeOnBackdrop={!demoDialog && busy !== "demo"} presentation="centered" headerStyle={campaignHeaderStyle(channelId)} headerContent={<div className={styles.wizardTitle}><span className={styles.wizardChannelLogo} aria-hidden="true"><Image src={channelMeta.logo} width={34} height={34} alt="" /></span><div>{campaignCreationTitle}<small>{adsUiText(i18nT, displayedStepNames[step])} {" "}{i18nT("etape_7f143e85")}{" "}{step + 1} / {displayedStepNames.length}</small></div></div>}>
      <div data-channel={channelId} ref={studioWorkspaceRef} inert={busy === "demo" || undefined} className={`${styles.workspace} ${styles.studioWorkspace}`} data-compact={compactScreen || undefined} data-short={shortScreen || undefined} data-stage={step} data-creation-path={creationPath} data-analysis-setup={analysisSetupOpen || undefined} onTouchStart={(event) => { const touch = event.touches[0]; touchStart.current = { x: touch.clientX, y: touch.clientY }; }} onTouchEnd={(event) => { const start = touchStart.current; touchStart.current = null; if (!start || creationPath === "choice" || busy !== null) return; const touch = event.changedTouches[0]; const dx = touch.clientX - start.x; const dy = touch.clientY - start.y; if (Math.abs(dx) > 75 && Math.abs(dx) > Math.abs(dy) * 1.5 && !(event.target instanceof HTMLElement && event.target.closest("input, textarea, select, button"))) { const nextStep = step + (dx < 0 ? 1 : -1); if (dx < 0 && creationPath === "inrcy" && step === analysisStep && planProgress !== 100) return; navigateToStep(nextStep); } }}>
      <nav className={styles.stepper} aria-label={i18nT("etapes_de_creation_8c0acff9")}>{displayedStepNames.map((name, index) => {
        const warning = creationPath !== "choice" && (reachedStepKeys.includes("validation") || reachedStepKeys.includes(displayedStepKeys[index]))
          ? stepWarningMessages.get(index + 1) : undefined;
        return <button type="button" key={name} disabled={(index !== step && !reachedStepKeys.includes(displayedStepKeys[index])) || busy === "plan" || busy === "demo"} data-incomplete={Boolean(warning) || undefined} title={adsUiText(i18nT, warning) || undefined} aria-label={`${index + 1}. ${adsUiText(i18nT, name)}${warning ? ` · ${adsUiText(i18nT, warning)}` : ""}`} aria-current={step === index ? "step" : undefined} onClick={() => navigateToStep(index)}>
          <span aria-hidden="true">{index + 1}{warning && <CampaignStepWarning className={styles.studioStepBubbleWarning} />}</span>
          {!compactScreen && <b className={styles.studioStepName}>{adsUiText(i18nT, channelId === "pinterest" ? PINTEREST_STEPPER_LABELS[name] || name : name)}{warning && <CampaignStepWarning className={styles.studioStepNameWarning} />}</b>}
        </button>;
      })}</nav>
      {notice && <p className={styles.notice} role="status" aria-live="polite">{notice}</p>}
      <section hidden={step !== 0} className={`${styles.card} ${styles.studioChoiceCard}`}>
          <StudioStepHeader number={1} label={analysisSetupOpen ? i18nT("le_cap_de_l_analyse_d0c8c19a") : i18nT("votre_projet_1310b083")} title={analysisSetupOpen ? i18nT("comment_inrcy_doit_il_vous_guider_22a85d0f") : i18nT("comment_creer_4eed607e")} mobileTitle={analysisSetupOpen ? i18nT("quel_cap_choisir_6572bf1b") : i18nT("comment_creer_4eed607e")} channel={i18nT("ads_ui_86a14a1bb9")} />
          {analysisSetupOpen ? <>
            <div className={styles.studioAnalysisSetup}>
              <AdsCampaignAnalysisChoice value={analysisMode} onChange={setAnalysisMode} objective={guidedAnalysisObjective} onObjectiveChange={setGuidedAnalysisObjective} disabled={busy !== null} className={styles.studioAnalysisChoice} />
              <div className={styles.studioAnalysisSetupActions}>
                <button type="button" className={styles.back} disabled={busy !== null} onClick={() => setAnalysisSetupOpen(false)}>{i18nT("choisir_un_autre_parcours_43e7c2b7")}</button>
                <button type="button" className={styles.headerCta} disabled={busy !== null || (analysisMode === "guided" && !guidedAnalysisObjective.trim())} onClick={beginAssistedAnalysis}>{i18nT("lancer_l_analyse_inrcy_1b423f17")}{" "}<span aria-hidden="true">→</span></button>
              </div>
            </div>
          </> : <>
            <div className={styles.studioPathGrid}>
              <button type="button" className={styles.studioPath} onClick={chooseManualCreation} disabled={busy !== null}>
                <span className={styles.studioPathIcon} aria-hidden="true">✎</span><span><strong>{i18nT("creer_manuellement_89b2d47e")}</strong><small>{i18nT("vous_gardez_la_main_sur_chaque_88453a84")}</small></span><b>{i18nT("commencer_c1037398")}</b>
              </button>
              <button type="button" className={`${styles.studioPath} ${styles.studioPathAi}`} onClick={openAssistedAnalysisSetup} disabled={busy !== null}>
                <span className={styles.studioPathIcon} aria-hidden="true">✦</span><span><strong>{i18nT("creer_avec_inrcy_6abf3922")}</strong><small>{i18nT("votre_inradn_guide_une_campagne_preparee_d835821b")}</small></span><b>{i18nT("preparer_l_analyse_638446ec")}</b>
              </button>
            </div>
            <p className={styles.studioCampaignPromise}><span aria-hidden="true">✦</span>{campaignPromise(channelId, i18nT)}</p>
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
          <p className={styles.adsGenerationEyebrow}>{i18nT("inrcy_analyse_amp_generation_b869aa5f")}</p>
          <h2>{planProgress === 100 ? i18nT("votre_campagne_prend_forme_b668b3e7") : autoMediaState === "generating" ? i18nT("inr_studio_compose_votre_media_ead37ed0") : i18nT("inrcy_construit_votre_campagne_2f80e839")}</h2>
          <p className={styles.adsGenerationLead}>{planProgress === 100 ? i18nT("votre_base_est_prete_controlez_chaque_5b103470") : autoMediaState === "generating" ? i18nT("le_ciblage_et_les_messages_sont_56328b8e") : i18nT("nous_relions_votre_inradn_vos_priorites_574f1742")}</p>
          <div className={styles.adsGenerationProgress} data-pending={analysisRequestPending || undefined} role="progressbar" aria-label={hasMediaStep ? i18nT("analyse_inrcy_et_generation_du_media_26fd739c") : i18nT("analyse_inrcy_de_la_campagne_9a4fd4b7")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={analysisRequestPending ? undefined : planProgress} aria-valuetext={analysisRequestPending ? i18nT("ads_ui_7c89a3da50", { value0: planProgress }) : undefined}><div><span style={{ width: `${planProgress}%` }} /></div><strong>{analysisRequestPending ? i18nT("value_estime_07c0f54e", { value0: planProgress }) : `${planProgress}%`}</strong></div>
          <ol className={styles.adsGenerationStages}>{AI_ANALYSIS_STAGES.map((stage, index) => {
            const done = planProgress === 100 || index < completedAnalysisStages;
            return <li key={stage.label} data-state={done ? "done" : index <= activeAnalysisStage ? "active" : "pending"}><span>{done ? "✓" : index + 1}</span><div><strong>{stage.label}</strong><small>{!hasMediaStep && stage.label === i18nT("creations_messages_2ae71f9c") ? i18nT("arguments_titres_et_descriptions_de_l_6e8c19e6") : stage.detail}</small></div></li>;
          })}</ol>
          {autoMediaMessage && <p className={styles.studioMediaGenerationNote} data-state={autoMediaState} role={autoMediaState === "error" ? "alert" : "status"}>{autoMediaMessage}</p>}
          {planError && <div className={styles.studioPlanError} role="alert"><strong>{i18nT("la_proposition_n_a_pas_pu_819cb0fc")}</strong><span>{planError}</span>{planRequestId && <small>{i18nT("reference_technique_value_c614e1e7", { value0: planRequestId })}</small>}<div><button type="button" className={styles.secondaryButton} onClick={() => void generateCampaignPlan()}>{i18nT("reessayer_l_analyse_693b1916")}</button><button type="button" className={styles.back} onClick={chooseManualCreation}>{i18nT("passer_au_mode_manuel_3ab91a17")}</button></div></div>}
          {!planError && planProgress < 100 && <div className={`${styles.studioPlanReady} ${styles.studioPlanPending}`} aria-hidden="true"><strong className={styles.studioPlanHeading}>{i18nT("bilan_de_l_analyse_e9eaec6a")}</strong><div className={styles.studioPlanPendingLines}><span /><span /><span /></div></div>}
          {planProgress === 100 && !planError && <div className={styles.studioPlanReady}><strong className={styles.studioPlanHeading}>{i18nT("bilan_de_l_analyse_e9eaec6a")}</strong><details className={styles.studioPlanDetails}><summary><span className={styles.studioPlanPreview}>{visiblePlanRationale}</span><span className={styles.studioPlanExpandClosed}>{i18nT("lire_le_bilan_complet_93a47134")}</span><span className={styles.studioPlanExpandOpen}>{i18nT("reduire_le_bilan_3cd7b1bd")}</span></summary><p>{visiblePlanRationale}</p></details>{planSources.length > 0 && <div className={styles.studioPlanSources}><span>{i18nT("analyse_basee_sur_ea620501")}</span><ul>{planSources.map((source) => <li key={source}>{source}</li>)}</ul></div>}</div>}
        </div>
      </section>

      <section hidden={step !== foundationsStep} data-channel={channelId} className={`${styles.card} ${styles.studioCard} ${styles.studioFoundationsCard}`}>
        <StudioStepHeader number={foundationsStep + 1} label={i18nT("ads_ui_3be0fb7aed")} title={channelId === "pinterest" ? i18nT("votre_campagne_et_son_objectif_d1a44bbf") : i18nT("la_direction_de_votre_campagne_c5f38aac")} mobileTitle={i18nT("votre_objectif_6a75871c")} channel={channelMeta.label} />
        <p className={`${styles.intro} ${styles.studioOptionalIntro}`}>{channelId === "pinterest" ? i18nT("notoriete_consideration_video_ventes_ou_prospect_cb5c61b0") : i18nT("definissez_ce_que_vous_voulez_obtenir_48f7bbe0")}</p>
        <div className={styles.studioGrid}>
          <label className={styles.field}>{i18nT("nom_de_la_campagne_9491056a")}<input value={draft.name} maxLength={100} onChange={(event) => updateDraft({ name: event.target.value })} placeholder={i18nT("ex_demandes_de_devis_locales_333c497d")} /></label>
          <label className={`${styles.field} ${styles.studioWide}`}>{i18nT("offre_ou_service_a_mettre_en_451aaa80")}<VoiceTextarea value={draft.offer} onChange={(offer) => updateDraft({ offer })} maxLength={500} purpose="subject" contextLabel={i18nT("offre_a_mettre_en_lumiere_b4b0ccef")} placeholder={i18nT("ex_installation_de_panneaux_solaires_avec_ac7a9738")} /></label>
          {nativeSettings?.channel === "linkedin" && <>
            <label className={styles.field}>{i18nT("objectif_linkedin_19b2aeff")}<select value={nativeSettings.objectiveType} onChange={(event) => {
              const objectiveType = event.target.value as LinkedInWizardSettings["objectiveType"];
              const formats = LINKEDIN_WIZARD_FORMATS[objectiveType] as readonly string[];
              const format = formats.includes(nativeSettings.format) ? nativeSettings.format : formats[0] as LinkedInWizardSettings["format"];
              updateNativeSettings({ ...nativeSettings, objectiveType, format });
            }}>{Object.keys(LINKEDIN_WIZARD_FORMATS).map((value) => <option key={value} value={value}>{nativeBriefTerm(value, i18nT)}</option>)}</select></label>

          </>}
          {nativeSettings?.channel === "linkedin" && <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`} data-linkedin-provider-resources="true">
            <legend>{i18nT("compte_publicitaire_et_identite_linkedin_375be96b")}</legend>
            <p>{i18nT("linkedin_range_chaque_nouvelle_campagne_dans_9b497ca8")}</p>
            <div className={styles.studioControlOptions}>
              <span>{externalStatuses.linkedin.selectedAccountId
                ? i18nT("value_id_value_b0e8c14b", { value0: externalStatuses.linkedin.selectedAccountName || i18nT("ads_linkedin_account_fallback"), value1: externalStatuses.linkedin.selectedAccountId })
                : i18nT("aucun_compte_linkedin_ads_associe_e31a3456")}</span>
              {linkedInPreflightLoad === "loading" && <small role="status">{i18nT("verification_automatique_des_ressources_linkedin_e27ab5d6")}</small>}
              {linkedInPreflightLoad === "error" && <button type="button" className={styles.secondaryButton} disabled={!externalStatuses.linkedin.connected || !externalStatuses.linkedin.selectedAccountId} onClick={() => void loadLinkedInResources(true)}>
                {i18nT("actualiser_9d3b2a7d")}{" "}</button>}
            </div>
            {linkedInPreflightLoad === "error" && <p className={styles.campaignMediaError} role="alert">{linkedInPreflightError}</p>}
            {linkedInPreflight && <div className={styles.linkedInIdentityChoices}>
              <div className={styles.linkedInGroupChoice}>
                <span>{i18nT("rangement_dans_linkedin_b2f146da")}</span>
                <strong>{selectedLinkedInCampaignGroup?.name || (draft.linkedinCampaignGroupId ? i18nT("groupe_value_095e360a", { value0: draft.linkedinCampaignGroupId }) : linkedInPreflightLoad === "loading" ? i18nT("recherche_d_un_groupe_compatible_0144946b") : i18nT("aucun_groupe_compatible_selectionne_1281afa9"))}</strong>
                <small>{i18nT("votre_nouvelle_campagne_sera_ajoutee_a_36128fa0")}</small>
                {selectedLinkedInCampaignGroup?.runSchedule.end && <small>{i18nT("fin_du_groupe_value_le_calendrier_3c4450bf", { value0: new Date(selectedLinkedInCampaignGroup.runSchedule.end).toLocaleString(locale) })}</small>}
                {adsUiText(i18nT, linkedInScheduleIssue) && <small role="alert">{adsUiText(i18nT, linkedInScheduleIssue)} <button type="button" className={styles.secondaryButton} onClick={() => navigateToStep(budgetStep)}>{i18nT("verifier_le_calendrier_2547bf03")}</button></small>}
                <details open={!draft.linkedinCampaignGroupId || undefined}>
                  <summary>{i18nT("changer_de_groupe_adb9e718")}</summary>
                  <label className={styles.field}>{i18nT("groupe_de_campagnes_4de7947c")}{" "}<select value={draft.linkedinCampaignGroupId || ""} onChange={(event) => updateDraft({ linkedinCampaignGroupId: event.target.value })}>
                  <option value="">{i18nT("selectionnez_un_groupe_verifie_f4f95247")}</option>
                  {draft.linkedinCampaignGroupId && !linkedInCampaignGroups.some((group) => group.id === draft.linkedinCampaignGroupId) && <option value={draft.linkedinCampaignGroupId} disabled>{i18nT("choix_enregistre_indisponible_id_value_c1d57331", { value0: draft.linkedinCampaignGroupId })}</option>}
                  {linkedInCampaignGroups.map((group) => <option key={group.id} value={group.id}>{i18nT("value_value_id_value_2dce67a1", { value0: group.name, value1: group.status, value2: group.id })}</option>)}
                </select>
              </label>
                </details>
              </div>
              <label className={styles.field}>{i18nT("page_qui_signe_vos_annonces_939eb340")}{" "}<select value={draft.linkedinOrganizationUrn || ""} onChange={(event) => updateDraft({ linkedinOrganizationUrn: event.target.value })}>
                  <option value="">{i18nT("selectionnez_une_page_autorisee_6a16e77f")}</option>
                  {draft.linkedinOrganizationUrn && !linkedInOrganizations.some((organization) => organization.urn === draft.linkedinOrganizationUrn) && <option value={draft.linkedinOrganizationUrn} disabled>{i18nT("choix_enregistre_indisponible_value_e92d5274", { value0: draft.linkedinOrganizationUrn })}</option>}
                  {linkedInOrganizations.map((organization) => <option key={organization.urn} value={organization.urn}>{linkedInOrganizationLabel(organization, i18nT)}</option>)}
                </select>
              </label>
            </div>}
            {linkedInPreflight && linkedInCampaignGroups.length === 0 && <small role="alert">{i18nT("aucun_groupe_linkedin_compatible_avec_l_1d1857ec")}</small>}
            {linkedInPreflight && linkedInOrganizations.length === 0 && <small role="alert">{i18nT("aucune_page_avec_un_role_administrateur_9a818cf0")}</small>}
            {selectedLinkedInCampaignGroup && selectedLinkedInCampaignGroup.status !== "ACTIVE" && <small>{i18nT("ce_groupe_est_en_pause_la_2d79694e")}</small>}
          </fieldset>}
          {nativeSettings?.channel === "tiktok" && <>
            <label className={styles.field}>{i18nT("objectif_tiktok_0469334e")}<select value={nativeSettings.objectiveType} onChange={(event) => {
              const objectiveType = event.target.value as TikTokWizardSettings["objectiveType"];
              const optimizationIntent = ({ REACH: "reach", VIDEO_VIEWS: "views", TRAFFIC: "clicks", WEB_CONVERSIONS: "conversions", LEAD_GENERATION: "leads", ENGAGEMENT: "engagement" } as const)[objectiveType];
              updateNativeSettings({ ...nativeSettings, objectiveType, optimizationIntent,
                destinationKind: objectiveType === "LEAD_GENERATION" ? "instant_form" : "website" });
            }}>{TIKTOK_WIZARD_OBJECTIVES.map((value) => <option key={value} value={value}>{nativeBriefTerm(value, i18nT)}</option>)}</select></label>
          </>}
          {nativeSettings?.channel === "pinterest" && <>
            <label className={styles.field}>{i18nT("objectif_pinterest_7bfa04bd")}<select value={nativeSettings.objectiveType} onChange={(event) => {
              const objectiveType = event.target.value as PinterestWizardSettings["objectiveType"];
              const catalogAllowed = objectiveType === "CONSIDERATION" || objectiveType === "SALES";
              const intendedPromotionType = catalogAllowed ? nativeSettings.intendedPromotionType : "STANDARD_AD";
              updateNativeSettings({ ...nativeSettings, objectiveType,
                intendedPromotionType,
                creativeType: objectiveType === "VIDEO_COMPLETION" ? "VIDEO" : intendedPromotionType === "CATALOG" ? null : nativeSettings.creativeType || "REGULAR",
                conversionEvent: objectiveType === "SALES" ? "CHECKOUT" : objectiveType === "LEADS" ? "LEAD" : null });
              updatePinterestDelivery({ optimizationGoal: objectiveType === "AWARENESS" ? "impressions" : "pin_clicks" });
            }}>{PINTEREST_WIZARD_OBJECTIVES.map((value) => <option key={value} value={value}>{pinterestObjectiveLabel(value, i18nT)}</option>)}</select><small>{i18nT("notoriete_et_consideration_peuvent_etre_lancees_3ced0506")}</small></label>
          </>}
          {nativeSettings?.channel === "x" && <>
            <label className={styles.field}>{i18nT("objectif_x_81381f07")}<select value={nativeSettings.objective} onChange={(event) => {
              const objective = event.target.value as XWizardSettings["objective"];
              updateNativeSettings({ ...nativeSettings, objective, format: objective === "video_views" ? "video" : nativeSettings.format });
            }}>{X_WIZARD_OBJECTIVES.map((value) => <option key={value} value={value}>{nativeBriefTerm(value, i18nT)}</option>)}</select></label>
          </>}
          {!nativeSettings && channelId !== "openai" && channelId !== "google" && <>
            <label className={styles.field}>{i18nT("objectif_47d1c260")}<select value={draft.objective} onChange={(event) => updateDraft({ objective: event.target.value as AdsCampaignInput["objective"] })}>{OBJECTIVE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label className={styles.field}>{i18nT("action_a_mesurer_a3cbedda")}<select value={draft.conversionGoal} onChange={(event) => updateDraft({ conversionGoal: event.target.value as AdsCampaignInput["conversionGoal"] })}>{CONVERSION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          </>}
        </div>
        {channelId === "google" && <p className={styles.studioTypeHint}>{i18nT("compte_google_ads_016fc70e")}{" "}{associatedAccountName || i18nT("a_associer_98e1fb09")}{i18nT("l_ia_prepare_une_campagne_reseau_993f8ad8")}</p>}
        {!nativeSettings && <><div className={styles.studioTypeGrid} role="radiogroup" aria-label={i18nT("type_de_campagne_70f9fad7")}>{campaignTypeOptions.map((option) => <button type="button" role="radio" aria-checked={draft.campaignType === option.value} key={option.value} data-selected={draft.campaignType === option.value || undefined} onClick={() => updateDraft({ campaignType: option.value })}><strong>{option.label}</strong><small>{option.detail}{channelId === "google" && option.value !== "search" ? i18nT("brouillon_uniquement_7b60249e") : ""}</small><span>{draft.campaignType === option.value ? i18nT("choisi_6888aab0") : i18nT("choisir_b030d590")}</span></button>)}</div><p className={styles.studioTypeHint}>{i18nT("un_seul_type_par_campagne_pour_7ff241ab")}</p></>}
        {nativeSettings && <p className={styles.studioTypeHint}>{channelId === "pinterest" ? i18nT("la_suite_prepare_le_budget_les_e44954f1") : channelId === "linkedin" ? i18nT("choisissez_ensuite_les_zones_geographiques_l_1153a791") : nativeSettings.channel === "x" && nativeSettings.format === "text" ? i18nT("le_format_texte_ne_necessite_aucun_cb226def") : i18nT("le_format_est_defini_l_etape_2b0f0ea1")}</p>}
      </section>

      {(channelId === "meta" || channelId === "openai") && <>
        <section hidden={step !== geographyStep} data-channel={channelId} data-meta-geography={channelId === "meta" || undefined} data-openai-geography={channelId === "openai" || undefined} className={`${styles.card} ${styles.studioCard} ${styles.studioTargetingCard}`}>
          <StudioStepHeader number={geographyStep + 1} label={i18nT("zones_geographiques_e119269a")} title={i18nT("les_lieux_ou_trouver_vos_futurs_99904931")} mobileTitle={i18nT("vos_zones_d8f5f67a")} channel={channelMeta.label} />
          <p className={`${styles.intro} ${styles.studioOptionalIntro}`}>{i18nT("les_zones_proposees_par_l_ia_0aa5e7cc", { value0: channelMeta.label })}</p>
          {channelId === "meta" ? <><div className={styles.studioGrid}>{campaignLocationFields}</div>{draft.metaDeliverySettings ? <MetaAdsLocationPicker accountId={metaResourceAccountId} locations={draft.targetLocations} targets={draft.metaGeoTargets || []} active={creating && channelId === "meta"} onChange={(metaGeoTargets) => { if (JSON.stringify(metaGeoTargets) !== JSON.stringify(draft.metaGeoTargets || [])) updateDraft({ metaGeoTargets }); }} onReadyChange={(ready, error) => setMetaGeoState((current) => current.key === metaGeoKey && current.ready === ready && current.error === error ? current : { key: metaGeoKey, ready, error })} onAddLocation={(label) => { if (!draft.targetLocations.includes(label)) updateDraft({ targetLocations: [...draft.targetLocations, label] }); }} /> : <div className={styles.studioControlPanel}><strong>{i18nT("ciblage_historique_en_france_b2406952")}</strong><p>{i18nT("ces_lieux_seront_reverifies_en_france_c11ba62a")}</p><button type="button" className={styles.secondaryButton} onClick={() => updateMetaDelivery({})}>{i18nT("actualiser_les_reglages_meta_f1fb7dd2")}</button></div>}</> : <ChatGPTAdsGeography resources={effectiveOpenaiResources} loading={openaiResourcesLoad === "loading"} error={openaiResourcesError} query={openaiGeoQuery} onQueryChange={setOpenaiGeoQuery} onSearch={() => setOpenaiResourcesRevision((value) => value + 1)} locations={draft.targetLocations} onLocationsChange={(targetLocations) => updateDraft({ targetLocations })} />}
        </section>
        <section hidden={step !== biddingStep} data-channel={channelId} data-meta-bidding={channelId === "meta" || undefined} data-openai-bidding={channelId === "openai" || undefined} className={`${styles.card} ${styles.studioCard}`}>
          <StudioStepHeader number={biddingStep + 1} label={i18nT("encheres_52ae31a3")} title={i18nT("le_resultat_vise_et_son_cout_c64c789c")} mobileTitle={i18nT("vos_encheres_f6fabfe6")} channel={channelMeta.label} />
          <p className={`${styles.intro} ${styles.studioOptionalIntro}`}>{i18nT("la_proposition_est_remplie_automatiquement_cette_26de75e4")}</p>
          {channelId === "meta" ? <MetaAdsBidding settings={metaDelivery} budgetEuros={metaDelivery.budget.type === "total" ? metaDelivery.budget.totalEuros || 0 : draft.dailyBudgetEuros} onChange={updateMetaDelivery} /> : <ChatGPTAdsBidding bidEuros={draft.openaiBidEuros} budgetEuros={openaiDelivery.budget.type === "total" ? openaiDelivery.budget.totalEuros || 0 : draft.dailyBudgetEuros} onBidChange={(openaiBidEuros) => updateDraft({ openaiBidEuros })} />}
        </section>
      </>}

      {channelId === "google" && <>
        <section hidden={step !== biddingStep} data-channel={channelId} data-google-bidding="true" className={`${styles.card} ${styles.studioCard}`}>
          <StudioStepHeader number={biddingStep + 1} label={i18nT("encheres_google_61d863a7")} title={i18nT("quel_resultat_google_doit_privilegier_380fa88f")} mobileTitle={i18nT("vos_encheres_f6fabfe6")} channel={channelMeta.label} />
          <p className={styles.intro}>{i18nT("l_ia_prepare_une_strategie_compatible_a3390ed8")}</p>
          <GoogleAdsBidding settings={googleDelivery} strategy={draft.bidStrategy} onStrategyChange={(bidStrategy) => updateDraft({ bidStrategy })} onChange={updateGoogleDelivery} conversionsReady={effectiveGoogleResources?.hasBiddableConversions ?? null} />
          <GoogleAdsMeasurement resources={effectiveGoogleResources} loading={googleResourcesLoad === "loading"} error={googleResourcesError} onRefresh={() => setGoogleResourcesRevision((value) => value + 1)} />
        </section>
        <section hidden={step !== geographyStep} data-channel={channelId} data-google-geography="true" className={`${styles.card} ${styles.studioCard} ${styles.studioTargetingCard}`}>
          <StudioStepHeader number={geographyStep + 1} label={i18nT("zones_geographiques_e119269a")} title={i18nT("ou_trouver_vos_futurs_clients_816308ec")} mobileTitle={i18nT("vos_zones_d8f5f67a")} channel={channelMeta.label} />
          <p className={styles.intro}>{i18nT("les_zones_proposees_seront_verifiees_dans_ed26195f")}</p>
          <div className={styles.studioGrid}>{campaignLocationFields}<GoogleAdsGeography settings={googleDelivery} onChange={updateGoogleDelivery} /></div>
          <p className={styles.studioTypeHint} role="status">{googleGeoReady ? i18nT("toutes_les_zones_ont_ete_verifiees_60af7d83") : googleGeoState.key === googleGeoKey && googleGeoState.status === "error" ? googleGeoState.error : draft.targetLocations.length ? i18nT("verification_automatique_des_villes_et_regions_fd17acce") : i18nT("les_zones_du_brief_apparaitront_ici_d428b243")}</p>
          {googleGeoState.status === "error" && <button type="button" className={styles.secondaryButton} onClick={() => { googleResolvedGeoKey.current = ""; setGoogleGeoRevision((value) => value + 1); }}>{i18nT("reverifier_les_zones_b7fd9197")}</button>}
        </section>
      </>}

      {nativeSettings?.channel === "pinterest" && <>
        <section hidden={step !== geographyStep} data-channel={channelId} data-pinterest-geography="true" className={`${styles.card} ${styles.studioCard} ${styles.studioTargetingCard}`}>
          <StudioStepHeader number={geographyStep + 1} label={i18nT("zones_geographiques_e119269a")} title={i18nT("les_lieux_ou_votre_epingle_sera_7c261e15")} mobileTitle={i18nT("vos_zones_d8f5f67a")} channel={channelMeta.label} />
          <p className={`${styles.intro} ${styles.studioOptionalIntro}`}>{i18nT("les_lieux_proposes_par_l_ia_07b49a65")}</p>
          <div className={styles.studioGrid}>{campaignLocationFields}</div>
          <p className={styles.studioTypeHint} role="status">{pinterestGeoReady ? i18nT("ads_count_pinterest_verified_zones", { count: pinterestResolvedGeography.zones.length }) : pinterestResolvedGeography.error}</p>
          {pinterestGeoReady && <p className={styles.studioTypeHint}>{pinterestResolvedGeography.zones.map((zone) => zone.name).join(" · ")}</p>}
          {pinterestResourcesLoad === "error" && <button type="button" className={styles.secondaryButton} onClick={() => setPinterestResourcesRevision((value) => value + 1)}>{i18nT("reverifier_les_ressources_pinterest_0b936856")}</button>}
        </section>
        <section hidden={step !== biddingStep} data-channel={channelId} className={`${styles.card} ${styles.studioCard}`}>
          <StudioStepHeader number={biddingStep + 1} label={i18nT("encheres_pinterest_cbc5d4a8")} title={i18nT("le_resultat_vise_et_son_cout_c64c789c")} mobileTitle={i18nT("vos_encheres_f6fabfe6")} channel={channelMeta.label} />
          <p className={`${styles.intro} ${styles.studioOptionalIntro}`}>{creationPath === "inrcy" ? i18nT("l_ia_prepare_une_strategie_automatique_bed74361") : i18nT("choisissez_l_optimisation_et_les_encheres_396a726a")}</p>
          <PinterestAdsBidding settings={pinterestDelivery} objectiveType={nativeSettings.objectiveType} budgetEuros={pinterestDelivery.budget.type === "total" ? Number(pinterestDelivery.budget.totalEuros || 0) : draft.dailyBudgetEuros} onChange={updatePinterestDelivery} />
        </section>
      </>}

      {preparedOnlyChannel && <>
        <section hidden={step !== geographyStep} data-channel={channelId} data-x-geography={channelId === "x" || undefined} data-tiktok-geography={channelId === "tiktok" || undefined} className={`${styles.card} ${styles.studioCard} ${styles.studioTargetingCard}`}>
          <StudioStepHeader number={geographyStep + 1} label={i18nT("zones_geographiques_e119269a")} title={i18nT("les_lieux_ou_trouver_vos_futurs_99904931")} mobileTitle={i18nT("vos_zones_d8f5f67a")} channel={channelMeta.label} />
          <p className={styles.intro}>{i18nT("l_ia_reprend_vos_zones_d_5bdee5a9")}</p>
          <div className={styles.studioGrid}>{campaignLocationFields}</div>
          {channelId === "tiktok" ? <TikTokAdsLocationPicker accountId={tikTokAccountId} locations={draft.targetLocations} active={creating && externalStatuses.tiktok.connected && nativeSettings?.channel === "tiktok" && nativeSettings.objectiveType === "TRAFFIC" && nativeSettings.placementIntent === "tiktok_only"} onChange={(targetLocations) => updateDraft({ targetLocations })} onResolvedTargets={(targets) => { if (draft.provider === "tiktok" && draft.tiktokNativeSelections?.advertiserId === tikTokAccountId && JSON.stringify(draft.tiktokNativeSelections.locationIds) !== JSON.stringify(targets.map((item) => item.id))) updateDraft({ tiktokNativeSelections: { ...draft.tiktokNativeSelections, locationIds: targets.map((item) => item.id) } }); }} /> : <XAdsLocationPicker accountId={externalStatuses.x.selectedAccountId || draft.adAccountId} locations={draft.targetLocations} selections={draft.xNativeSelections} active={creating && externalStatuses.x.connected} onChange={(targetLocations, xNativeSelections) => updateDraft({ targetLocations, xNativeSelections })} />}
        </section>
        <section hidden={step !== biddingStep} data-channel={channelId} data-prepared-bidding="true" className={`${styles.card} ${styles.studioCard}`}>
          <StudioStepHeader number={biddingStep + 1} label={i18nT("encheres_et_optimisation_a79ddb92")} title={i18nT("le_resultat_vise_et_son_cout_c64c789c")} mobileTitle={i18nT("vos_encheres_f6fabfe6")} channel={channelMeta.label} />
          <PreparedAdsBidding settings={preparedDelivery} channel={channelId} optimizationIntent={nativeSettings?.channel === "tiktok" ? nativeSettings.optimizationIntent : undefined} budgetEuros={preparedDelivery.budget.type === "total" ? preparedDelivery.budget.totalEuros || 0 : draft.dailyBudgetEuros} onChange={updatePreparedDelivery} />
          {nativeSettings?.channel === "tiktok" && <div className={styles.studioControlPanel}><strong>{i18nT("resultat_prepare_value_8b1dc36d", { value0: nativeBriefTerm(nativeSettings.optimizationIntent, i18nT) })}</strong><p>{i18nT("l_optimisation_suit_l_objectif_de_b855d143")}</p></div>}
        </section>
      </>}
      {nativeSettings?.channel === "tiktok" && <section hidden={step !== identityStep} data-channel={channelId} data-tiktok-identity="true" className={`${styles.card} ${styles.studioCard}`}>
        <StudioStepHeader number={identityStep + 1} label={i18nT("identite_publicitaire_df360e59")} title={i18nT("le_compte_qui_signe_votre_video_1cc538ec")} mobileTitle={i18nT("votre_identite_1d0d455f")} channel={channelMeta.label} />
        <div className={styles.studioControlPanel}><strong>{effectiveTikTokResources?.account.name || i18nT("compte_annonceur_a_connecter_7d78bd53")}</strong><p>{adsUiText(i18nT, tikTokIdentityMessage)}</p>
          {effectiveTikTokResources?.identities.length === 1 && <small>{i18nT("cette_identite_provient_d_une_lecture_b1a64aac")}</small>}
          {effectiveTikTokResources && effectiveTikTokResources.identities.length > 1 && <details><summary>{i18nT("voir_les_identites_autorisees_98d17799")}</summary><ul>{effectiveTikTokResources.identities.map((identity) => <li key={identity.type + identity.id + (identity.authorizedBusinessCenterId || "")}>{identity.displayName}</li>)}</ul></details>}
          <p>{i18nT("une_video_non_spark_ou_une_c18411f8")}</p>
          <button type="button" className={styles.secondaryButton} disabled={!externalStatuses.tiktok.connected || tikTokResourcesLoad === "loading" || busy !== null} onClick={() => setTikTokResourcesRevision((value) => value + 1)}>{i18nT("reverifier_le_compte_et_l_identite_41562038")}</button>
        </div>
      </section>}
      {nativeSettings?.channel === "linkedin" && <section hidden={step !== geographyStep} data-channel={channelId} data-linkedin-geography="true" className={`${styles.card} ${styles.studioCard} ${styles.studioTargetingCard}`}>
        <StudioStepHeader number={geographyStep + 1} label={i18nT("zones_geographiques_e119269a")} title={i18nT("ou_diffuser_votre_campagne_9c5fc62f")} mobileTitle={i18nT("vos_zones_d8f5f67a")} channel={channelMeta.label} />
        <p className={`${styles.intro} ${styles.studioOptionalIntro}`}>{i18nT("l_ia_propose_les_zones_de_223458d1")}</p>
        <div className={styles.studioGrid}>
          {campaignLocationFields}
          <div className={styles.studioWide} data-linkedin-geography-controls="true">
            <label className={styles.field}>{i18nT("type_de_localisation_f144ebf8")}<select value={linkedInDelivery.locationType} onChange={(event) => updateLinkedInDelivery({ ...linkedInDelivery, locationType: event.target.value as LinkedInDeliverySettings["locationType"] })}><option value="recent_or_permanent">{i18nT("residence_ou_presence_recente_350938d6")}</option><option value="permanent">{i18nT("residence_permanente_uniquement_1296c70a")}</option></select></label>
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
        <StudioStepHeader number={targetingStep + 1} label={channelId === "google" ? i18nT("parametres_google_b629a9b9") : channelId === "pinterest" ? i18nT("audience_pinterest_db284bc2") : channelId === "linkedin" ? i18nT("audience_linkedin_b2a8e698") : channelId === "meta" ? i18nT("audience_meta_69ee59e2") : channelId === "openai" ? i18nT("audience_et_contexte_858454f0") : i18nT("ads_ui_c7f1894efa")} title={channelId === "google" ? i18nT("les_surfaces_et_les_profils_utiles_3b74dec5") : channelId === "pinterest" ? i18nT("a_qui_montrer_vos_idees_59e8211e") : channelId === "linkedin" ? i18nT("a_quels_professionnels_parler_87f2a303") : channelId === "meta" ? i18nT("les_personnes_a_qui_montrer_votre_ed426acc") : channelId === "openai" ? i18nT("votre_offre_dans_les_conversations_pertinentes_68ee669e") : i18nT("les_profils_et_les_surfaces_utiles_bf810485")} mobileTitle={i18nT("votre_ciblage_e9cd319d")} channel={channelMeta.label} />
        <p className={`${styles.intro} ${styles.studioOptionalIntro}`}>{channelId === "pinterest" ? i18nT("l_ia_prepare_le_message_pour_ab41a33b") : channelId === "linkedin" ? i18nT("l_ia_traduit_vos_clients_prioritaires_08254eb0") : channelId === "meta" || channelId === "openai" ? i18nT("l_ia_prepare_le_message_pour_5584b7a7") : i18nT("les_profils_guident_le_message_les_4dedfe41")}</p>
        <div className={styles.studioGrid}>
          {!preparedOnlyChannel && channelId !== "linkedin" && channelId !== "google" && channelId !== "pinterest" && channelId !== "meta" && channelId !== "openai" && campaignLocationFields}
          <TagField className={styles.studioAudienceField} wide label={channelId === "openai" ? i18nT("profils_pour_guider_le_message_08ca3311") : i18nT("clients_audiences_prioritaires_fe51bcb0")} helper={channelId === "linkedin" ? i18nT("ads_ui_3a6cafea8d") : channelId === "openai" ? i18nT("ads_ui_a7e6725cc6") : channelId === "pinterest" ? i18nT("ads_ui_e21ab0ab56") : channelId === "google" ? i18nT("ads_ui_0544f70739") : channelId === "meta" ? i18nT("ads_ui_4f7dad98ca") : i18nT("ads_ui_fbead4af23")} values={draft.targetAudiences} onChange={(targetAudiences) => updateDraft({ targetAudiences })} placeholder={channelId === "linkedin" ? i18nT("ex_dirigeants_de_petites_entreprises_35bba36b") : i18nT("ex_proprietaires_de_maison_316692d5")} />
          {channelId !== "openai" && channelId !== "linkedin" && channelId !== "google" && channelId !== "pinterest" && channelId !== "meta" && <TagField className={styles.studioLanguageField} wide label={i18nT("langue_du_message_1fdab780")} helper={i18nT("ads_ui_1ca6f053ae")} values={draft.languages} onChange={(languages) => updateDraft({ languages })} placeholder={i18nT("ex_fr_ou_en_4e86fb5d")} />}
          {channelId === "google" && <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}><legend>{i18nT("reseaux_google_ab3638dd")}</legend><p>{i18nT("choisissez_les_surfaces_envisagees_ces_choix_6b40df16")}</p><div className={styles.studioControlOptions}><label><input type="checkbox" checked={draft.googleSearchPartners} onChange={(event) => updateDraft({ googleSearchPartners: event.target.checked })} />{i18nT("partenaires_du_reseau_de_recherche_8165f47e")}</label><label><input type="checkbox" checked={draft.googleDisplayExpansion} onChange={(event) => updateDraft({ googleDisplayExpansion: event.target.checked })} />{i18nT("extension_display_lorsque_pertinente_556ae4b1")}</label></div></fieldset>}
          {channelId === "google" && <div className={`${styles.studioControlPanel} ${styles.studioWide}`}><strong>{i18nT("langues_automatiques_sur_google_search_5c812ce7")}</strong><p>{i18nT("google_adapte_les_langues_a_vos_3f1db1db")}</p><small>{i18nT("segments_d_audience_aucun_filtre_demographique_ab5cb923")}</small></div>}
          {nativeSettings?.channel === "linkedin" && <div className={styles.studioWide} data-linkedin-targeting="true">
            <div className={styles.linkedInAudienceControls}>
              <label className={styles.field}>{i18nT("langue_des_profils_cibles_4ebcc963")}<select value={nativeSettings.locale.language + "_" + nativeSettings.locale.country} onChange={(event) => { const [language, country] = event.target.value.split("_"); updateNativeSettings({ ...nativeSettings, locale: { language, country } }); updateDraft({ languages: [language] }); }}>{(linkedInPreflight?.supportedLocales?.length ? linkedInPreflight.supportedLocales : [nativeSettings.locale]).map((locale) => <option key={locale.language + "_" + locale.country} value={locale.language + "_" + locale.country}>{new Intl.DisplayNames(["fr"], { type: "language" }).of(locale.language) || locale.language}</option>)}</select><small>{i18nT("langues_reellement_disponibles_dans_linkedin_19eba354")}</small></label>

            </div>

            <LinkedInAdsAudience accountId={draft.adAccountId || externalStatuses.linkedin.selectedAccountId} language={nativeSettings.locale.language} country={nativeSettings.locale.country} targeting={linkedInDelivery.professionalTargeting} suggestions={linkedInAudienceSuggestions} active={creating} onChange={(professionalTargeting) => updateLinkedInDelivery({ ...linkedInDelivery, professionalTargeting })} onPendingChange={setLinkedInAudiencePending} />
            <small role="status">{typeof linkedInPreflight?.selected?.audienceCount === "number" ? i18nT("audience_estimee_par_linkedin_value_membres_a1da4678", { value0: linkedInPreflight.selected.audienceCount.toLocaleString(locale) }) : i18nT("linkedin_verifie_la_taille_de_l_2fc1a233")}{i18nT("minimum_requis_300_membres_c6c04288")}</small>
          </div>}
          {nativeSettings?.channel === "tiktok" && <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}><legend>{i18nT("audience_tiktok_ecff36f2")}</legend><div className={styles.studioControlOptions}><label>{i18nT("approche_d_audience_48536fca")}<select value={nativeSettings.targetingMode} onChange={(event) => updateNativeSettings({ ...nativeSettings, targetingMode: event.target.value as TikTokWizardSettings["targetingMode"] })}><option value="broad">{i18nT("audience_large_166547d6")}</option><option value="interests">{i18nT("centres_d_interet_479a90c0")}</option></select></label></div><small>{i18nT("les_interets_exacts_devront_etre_verifies_0b01884b")}</small><div className={styles.studioControlOptions}><label className={styles.field}>{i18nT("emplacements_envisages_d6426fb5")}<select value={nativeSettings.placementIntent} onChange={(event) => updateNativeSettings({ ...nativeSettings, placementIntent: event.target.value as TikTokWizardSettings["placementIntent"] })}><option value="tiktok_only">{i18nT("tiktok_uniquement_2f12d7e1")}</option><option value="automatic">{i18nT("placements_automatiques_cc878f66")}</option></select><small>{i18nT("la_disponibilite_sera_verifiee_dans_le_798dc115")}</small></label></div></fieldset>}
          {nativeSettings?.channel === "pinterest" && <>
            <div className={`${styles.field} ${styles.studioWide}`}>
              <TagField label={i18nT("langues_des_personnes_ciblees_e0b1aa9d")} helper={i18nT("ads_ui_0028e1ed3e")} values={draft.languages} onChange={(languages) => updateDraft({ languages })} placeholder={i18nT("ex_francais_459fc03a")} maxItems={10} />
              <label className={styles.field}>{i18nT("ajouter_une_langue_pinterest_75673064")}<select value="" disabled={pinterestResourcesLoad !== "ready"} onChange={(event) => { if (event.target.value && !pinterestResolvedLanguages.ids.includes(event.target.value) && draft.languages.length < 10) updateDraft({ languages: [...draft.languages, event.target.value] }); }}><option value="">{i18nT("choisir_une_langue_disponible_fb0f711e")}</option>{effectivePinterestResources?.locales.map((locale) => <option key={locale.id} value={locale.id} disabled={pinterestResolvedLanguages.ids.includes(locale.id)}>{locale.name}</option>)}</select></label>
              {pinterestResolvedLanguages.error && <small role="status">{pinterestResolvedLanguages.error}</small>}
            </div>
            <PinterestAdsDistribution settings={pinterestDelivery} onChange={updatePinterestDelivery} />
          </>}
          {nativeSettings?.channel === "pinterest" && <label className={`${styles.field} ${styles.studioTargetingMode}`} >{i18nT("mode_de_ciblage_pinterest_9a54a86d")}<select value={nativeSettings.targetingMode} onChange={(event) => updatePinterestTargetingMode(event.target.value as PinterestWizardSettings["targetingMode"])}><option value="automatic">{i18nT("ciblage_automatique_recommande_publiable_cfd36d99")}</option><option value="interests">{i18nT("centres_d_interet_brouillon_91f47e31")}</option><option value="keywords">{i18nT("recherches_mots_cles_brouillon_71fe29e6")}</option><option value="audiences">{i18nT("audiences_existantes_brouillon_9b4d67a6")}</option></select><small>{nativeSettings.targetingMode === "automatic" ? i18nT("pinterest_optimise_l_audience_a_partir_fdd57d52") : i18nT("ce_mode_reste_en_brouillon_jusqu_2ad7697d")}</small>{nativeSettings.targetingMode === "automatic" && draft.keywords.length > 0 && <small role="alert">{i18nT("retirez_les_anciens_signaux_manuels_pour_9b22a8b8")}{" "}<button type="button" className={styles.secondaryButton} onClick={clearPinterestManualSignals}>{i18nT("retirer_les_signaux_manuels_d7d6e282")}</button></small>}</label>}
          {nativeSettings?.channel === "x" && <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}><legend>{i18nT("audience_x_6bd69075")}</legend><p>{i18nT("votre_choix_oriente_les_signaux_a_5fa366fd")}</p><div className={styles.studioControlOptions}><label>{i18nT("approche_de_ciblage_a5bf3574")}<select value={nativeSettings.targetingMode} onChange={(event) => { const targetingMode = event.target.value as XWizardSettings["targetingMode"]; updateNativeSettings({ ...nativeSettings, targetingMode }); if (targetingMode !== "keywords") updateDraft({ keywords: [] }); }}><option value="broad">{i18nT("audience_large_166547d6")}</option><option value="keywords">{i18nT("mots_cles_7120109e")}</option><option value="interests">{i18nT("centres_d_interet_479a90c0")}</option><option value="follower_lookalikes">{i18nT("audiences_similaires_aux_abonnes_9dcac389")}</option></select></label></div></fieldset>}
          {channelId === "meta" && draft.metaDeliverySettings && <MetaAdsAudience settings={metaDelivery} languages={metaResolvedLanguages.error ? draft.languages : metaResolvedLanguages.ids.map(String)} locales={effectiveMetaResources?.locales || []} onLanguagesChange={(languages) => updateDraft({ languages })} onChange={updateMetaDelivery} />}
          {channelId === "meta" && !draft.metaDeliverySettings && <div className={`${styles.studioControlPanel} ${styles.studioWide}`}><strong>{i18nT("audience_du_parcours_historique_ca0edea4")}</strong><p>{i18nT("le_brief_guide_le_message_ses_f0c60674")}</p></div>}
          {channelId === "openai" && <div className={`${styles.studioControlPanel} ${styles.studioWide}`}><strong>{i18nT("contexte_de_votre_carte_chatgpt_9e57ddeb")}</strong><p>{i18nT("l_offre_de_l_etape_campagne_dc7f6bc4")}</p></div>}
        </div>
      </section>

      <section hidden={step !== keywordsStep} data-channel={channelId} className={`${styles.card} ${styles.studioCard} ${styles.studioKeywordsCard}`}>
        {channelId === "linkedin" ? <StudioStepHeader number={keywordsStep + 1} label={i18nT("format_publicitaire_9f17c802")} title={i18nT("comment_presenter_votre_annonce_24322b7e")} mobileTitle={i18nT("votre_format_1c07287a")} channel={channelMeta.label} /> : <StudioStepHeader number={keywordsStep + 1} label={channelId === "google" ? i18nT("mots_cles_5cee6748") : channelId === "pinterest" ? i18nT("decouverte_pinterest_4fc27293") : i18nT("ads_ui_451f8d9a52")} title={channelId === "google" ? i18nT("les_recherches_a_capter_a99e7363") : channelId === "pinterest" ? i18nT("comment_votre_idee_doit_etre_decouverte_ea278703") : i18nT("les_signaux_qui_orientent_votre_audience_91e61c63")} mobileTitle={channelId === "google" ? i18nT("vos_mots_cles_ac1103b9") : channelId === "pinterest" ? i18nT("votre_decouverte_291c8691") : i18nT("vos_signaux_60f2da1c")} channel={channelMeta.label} />}
        {channelId !== "linkedin" && <>        <p className={`${styles.intro} ${styles.studioOptionalIntro}`}>{channelId === "google" ? i18nT("cette_etape_est_dediee_aux_requetes_d34901fc") : channelId === "meta" ? i18nT("ajoutez_les_interets_besoins_et_angles_5bc81bb8") : i18nT("ads_detail_targeting", { channel: channelMeta.label })}</p></>}
        {nativeSettings?.channel === "linkedin" ? <div className={styles.studioGrid}>            <label className={styles.field}>{i18nT("format_sponsorise_b6eadeb5")}<select value={nativeSettings.format} onChange={(event) => updateNativeSettings({ ...nativeSettings, format: event.target.value as LinkedInWizardSettings["format"] })}>{LINKEDIN_WIZARD_FORMATS[nativeSettings.objectiveType].map((format) => <option key={format} value={format}>{nativeBriefTerm(format, i18nT)}{format === "STANDARD_UPDATE" || format === "SINGLE_VIDEO" ? i18nT("publiable_0d3b4509") : i18nT("brouillon_ae6876ea")}</option>)}</select><small>{i18nT("ce_choix_fixe_les_ressources_a_da82ae42")}</small></label>
          <aside className={styles.studioKeywordGuidance}><strong>{i18nT("un_format_par_groupe_de_publicites_7bf9246f")}</strong><p>{i18nT("le_choix_adapte_le_texte_le_0e12e348")}</p></aside>
        </div> : <>
        <div className={styles.studioGrid}>
          {channelId === "google" ? <TagField wide label={draft.campaignType === "performance_max" ? i18nT("themes_de_recherche_signaux_d_intention_63655af4") : i18nT("mots_cles_recherches_00138528")} helper={i18nT("ads_ui_2d247aaa70")} values={draft.keywords} onChange={(keywords) => updateDraft({ keywords })} placeholder={i18nT("ex_installation_panneaux_solaires_5a0e535a")} maxItems={20} maxItemLength={80} /> : nativeSettings?.channel === "pinterest" && nativeSettings.targetingMode === "automatic" ? <aside className={`${styles.studioKeywordGuidance} ${styles.studioWide}`}><strong>{i18nT("la_decouverte_est_preparee_automatiquement_07eb72d9")}</strong><p>{i18nT("l_ia_remplit_le_profil_prioritaire_9161280b")}</p>{draft.keywords.length > 0 && <><p role="alert">{i18nT("ads_count_manual_signals", { count: draft.keywords.length })}</p><button type="button" className={styles.secondaryButton} onClick={clearPinterestManualSignals}>{i18nT("retirer_les_signaux_manuels_d7d6e282")}</button></>}</aside> : <label className={`${styles.field} ${styles.studioWide}`}>{nativeSettings?.channel === "pinterest" && nativeSettings.targetingMode === "keywords" || nativeSettings?.channel === "x" && nativeSettings.targetingMode === "keywords" ? i18nT("mots_cles_a_envisager_185df768") : nativeSettings?.channel === "pinterest" && nativeSettings.targetingMode === "audiences" ? i18nT("audiences_pinterest_a_retrouver_dans_le_cfcbb193") : nativeSettings?.channel === "pinterest" && nativeSettings.targetingMode === "interests" ? i18nT("centres_d_interet_pinterest_a_verifier_14865b8f") : nativeSettings?.channel === "x" && nativeSettings.targetingMode === "follower_lookalikes" ? i18nT("comptes_ou_communautes_similaires_a_etudier_42167b68") : i18nT("centres_d_interet_signaux_ou_angles_2b90490d")}<small>{i18nT("un_par_ligne_62e71bde")}</small><CampaignTextarea className={styles.studioAdaptiveContentTextarea} rows={6} value={editableList(draft.keywords)} onChange={(event) => updateDraft({ keywords: parseEditableList(event.target.value.split("\n")) })} placeholder={i18nT("ex_renovation_energetique_nmaison_individuelle_n_e694076a")} /></label>}

          {nativeSettings && !(nativeSettings.channel === "pinterest" && nativeSettings.targetingMode === "automatic") && <aside className={`${styles.studioKeywordGuidance} ${styles.studioWide}`}><strong>{i18nT("des_pistes_pas_des_identifiants_publicitaires_05d7a965")}</strong><p>{i18nT("ces_idees_restent_dans_votre_brouillon_ad5ee76a")}</p></aside>}
          {channelId === "google" && <GoogleAdsKeywords settings={googleDelivery} onChange={updateGoogleDelivery} />}
          {channelId === "google" && <TagField wide label={i18nT("mots_cles_a_exclure_a97ff5c4")} helper={i18nT("ads_ui_8024b68c05")} values={draft.negativeKeywords} onChange={(negativeKeywords) => updateDraft({ negativeKeywords })} placeholder={i18nT("ex_emploi_91ce5f44")} maxItems={40} maxItemLength={80} />}
          {channelId === "meta" && <aside className={`${styles.studioKeywordGuidance} ${styles.studioWide}`}><strong>{i18nT("un_signal_pas_une_contrainte_rigide_00b397c7")}</strong><p>{i18nT("inrcy_les_combine_a_vos_zones_e1b30019")}</p></aside>}
        </div>
        </>}
      </section>

      <section hidden={step !== creativeStep} data-channel={channelId} className={`${styles.card} ${styles.studioCard} ${styles.studioCreativeCard}`}>
        <StudioStepHeader number={creativeStep + 1} label={channelId === "pinterest" ? i18nT("epingle_sponsorisee_b9ffbb19") : i18nT("creations_fcb4954e")} title={channelId === "pinterest" ? i18nT("le_titre_et_la_description_de_eaa8c606") : i18nT("des_messages_qui_donnent_envie_d_68a06d36")} mobileTitle={channelId === "pinterest" ? i18nT("votre_epingle_ab9a10fd") : i18nT("vos_messages_d5765374")} channel={channelMeta.label} />
        <p className={`${styles.intro} ${styles.studioOptionalIntro}`}>{channelId === "pinterest" ? creationPath === "inrcy" ? i18nT("le_titre_la_description_et_l_34c67f43") : i18nT("preparez_le_titre_et_la_description_27cbcf86") : i18nT("vous_pouvez_ecrire_vous_meme_partir_d43d34d6")}</p>
        <div className={styles.studioGrid}>
          {nativeSettings?.channel === "x" && <>
            <label className={styles.field}>{i18nT("format_du_post_x_ads_89c56005")}<select value={nativeSettings.format} onChange={(event) => updateNativeSettings({ ...nativeSettings, format: event.target.value as XWizardSettings["format"] })}>{(nativeSettings.objective === "video_views" ? ["video"] : ["text", "image", "video"]).map((value) => <option key={value} value={value}>{nativeBriefTerm(value, i18nT)}</option>)}</select><small>{nativeSettings.format === "text" ? i18nT("le_post_texte_est_le_seul_2431cad4") : i18nT("le_fichier_sera_prepare_dans_l_995d407f")}</small></label>
          </>}

          {channelId !== "google" && <label className={`${styles.field} ${styles.studioWide} ${styles.studioMessageField}`}>{channelId === "x" ? i18nT("texte_du_post_x_b39d47c5") : channelId === "tiktok" ? i18nT("texte_de_l_annonce_tiktok_54e536e8") : channelId === "pinterest" ? i18nT("description_de_l_epingle_d71176bd") : channelId === "linkedin" ? i18nT("introduction_de_la_publication_bc069acb") : channelId === "openai" ? i18nT("texte_de_la_carte_chatgpt_100_044cdfea") : i18nT("message_principal_5132e292")}<VoiceTextarea value={draft.primaryText} onChange={(primaryText) => updateDraft({ primaryText })} rows={2} maxLength={channelId === "linkedin" ? 300 : channelId === "openai" || channelId === "tiktok" ? 100 : channelId === "pinterest" ? 800 : channelId === "x" ? 280 : 500} purpose="content" contextLabel={i18nT("message_principal_de_la_campagne_f7fe2e29")} placeholder={i18nT("presentez_l_offre_son_benefice_concret_95356cb7")} /></label>}
          {channelId === "linkedin" ? <label className={styles.field}>{i18nT("titre_de_l_annonce_e6f42084")}<input value={draft.headlines[0] || ""} maxLength={200} onChange={(event) => updateDraft({ headlines: [event.target.value] })} placeholder={i18nT("un_benefice_clair_pour_votre_audience_30db47c6")} /><small>{i18nT("un_seul_titre_200_caracteres_maximum_ba0db619")}</small></label> : <>          {channelId === "google" ? <GoogleAdCopyField label={i18nT("titres_e8384542")} singular={i18nT("titre_eb97899a")} values={draft.headlines} onChange={(headlines) => updateDraft({ headlines })} minItems={3} maxItems={15} maxLength={30} /> : channelId === "openai" ? <label className={styles.field}>{i18nT("titre_de_la_carte_chatgpt_3_dbaa327d")}<input type="text" maxLength={50} value={draft.headlines[0] || ""} onChange={(event) => updateDraft({ headlines: event.target.value ? [event.target.value] : [] })} /></label> : channelId === "meta" ? <label className={styles.field}>{i18nT("titre_de_l_annonce_meta_2d1c208a")}<input value={draft.headlines[0] || ""} maxLength={30} onChange={(event) => updateDraft({ headlines: event.target.value ? [event.target.value] : [] })} /><small>{i18nT("un_seul_titre_30_caracteres_maximum_9596fa41")}</small></label> : channelId !== "tiktok" && channelId !== "x" && <label className={styles.field}>{channelId === "pinterest" ? i18nT("titre_de_l_epingle_bda42313") : i18nT("titres_ou_accroches_un_par_ligne_0be9785f")}<CampaignTextarea rows={2} value={editableList(draft.headlines)} aria-invalid={channelId === "pinterest" && (draft.headlines.length !== 1 || draft.headlines.some((title) => title.length > 100)) || undefined} onChange={(event) => updateDraft({ headlines: parseEditableList(event.target.value.split("\n")) })} />{channelId === "pinterest" && <small className={draft.headlines.some((title) => title.length > (channelId === "pinterest" ? 100 : 200)) || channelId === "pinterest" && draft.headlines.length !== 1 ? styles.copyLengthError : undefined}>{channelId === "pinterest" ? i18nT("un_seul_titre_100_caracteres_maximum_80b42b96") : i18nT("200_caracteres_maximum_par_titre_reformulez_eb798b9a")}</small>}{channelId === "pinterest" && draft.headlines.length > 1 && <small className={styles.copyLengthError} role="alert">{i18nT("choisissez_un_seul_titre_pour_votre_2493b5aa")}</small>}</label>}</>}
          {channelId === "google" ? <GoogleAdCopyField label={i18nT("descriptions_72e4c870")} singular={i18nT("ads_ui_526e0087cc")} values={draft.descriptions} onChange={(descriptions) => updateDraft({ descriptions })} minItems={2} maxItems={4} maxLength={90} /> : channelId === "meta" && <label className={styles.field}>{i18nT("description_de_l_annonce_facultatif_38f9a01f")}<input value={draft.descriptions[0] || ""} maxLength={90} onChange={(event) => updateDraft({ descriptions: event.target.value ? [event.target.value] : [] })} /></label>}
          {channelId === "linkedin" ? <LinkedInAdsCallToAction value={linkedInDelivery.callToAction} onChange={(callToAction) => { updateLinkedInDelivery({ ...linkedInDelivery, callToAction }); updateDraft({ callToAction: LINKEDIN_CTA_LABELS[callToAction] }); }} /> : channelId === "meta" ? <label className={styles.field}>{i18nT("bouton_de_votre_annonce_44025276")}<select value={metaDelivery.callToAction} onChange={(event) => updateMetaDelivery({ callToAction: event.target.value as MetaDeliverySettings["callToAction"] })}>{META_CALL_TO_ACTIONS.map((value) => <option key={value} value={value}>{adsUiText(i18nT, META_CALL_TO_ACTION_LABELS[value])}</option>)}</select></label> : <>          {channelId === "tiktok" ? <label className={`${styles.field} ${styles.studioCtaField}`}>{i18nT("bouton_tiktok_propose_cf119f08")}<select value={draft.tiktokNativeSelections?.callToAction || "LEARN_MORE"} onChange={(event) => {
            const code = event.target.value;
            updateDraft({ callToAction: PREPARED_TIKTOK_CTA_LABELS[code], ...(draft.tiktokNativeSelections ? { tiktokNativeSelections: { ...draft.tiktokNativeSelections, callToAction: code } } : {}) });
          }}>{Object.entries(PREPARED_TIKTOK_CTA_LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select><small>{i18nT("sa_disponibilite_sera_confirmee_dans_le_033f6045")}</small></label> : channelId !== "openai" && channelId !== "google" && channelId !== "pinterest" && <label className={`${styles.field} ${styles.studioCtaField}`}>{i18nT("appel_a_l_action_024c6142")}<input value={draft.callToAction} maxLength={80} onChange={(event) => updateDraft({ callToAction: event.target.value })} placeholder={i18nT("ex_demander_un_devis_54848d49")} /></label>}</>}
          {channelId === "google" && <GoogleAdsRSAFields settings={googleDelivery} onChange={updateGoogleDelivery} />}
          {channelId !== "google" && <aside className={`${styles.studioCopyGuidance} ${styles.field}`}><strong>{i18nT("a_verifier_8f5f7255")}</strong><p>{channelId === "openai" ? i18nT("la_carte_publiee_utilisera_exactement_le_c8a7f802") : nativeSettings?.channel === "linkedin" ? i18nT("le_texte_doit_correspondre_au_format_9c3f902a") : nativeSettings?.channel === "tiktok" ? i18nT("gardez_un_texte_court_qui_accompagne_9747ec4d") : nativeSettings?.channel === "pinterest" ? i18nT("le_titre_la_description_et_le_abe2adf2") : nativeSettings?.channel === "x" ? i18nT("votre_post_doit_etre_clair_sans_6bf416f3") : i18nT("relisez_la_coherence_entre_votre_message_0c25cb81")}</p></aside>}
        </div>
      </section>

      {nativeSettings?.channel === "pinterest" && <section hidden={step !== pinterestFormatStep} data-channel={channelId} className={`${styles.card} ${styles.studioCard} ${styles.studioMediaCard} ${styles.studioPinterestFormatCard}`}>
        <StudioStepHeader number={pinterestFormatStep + 1} label={i18nT("format_du_pin_b412c2b4")} title={i18nT("le_format_adapte_a_votre_idee_cad67815")} mobileTitle={i18nT("votre_format_1c07287a")} channel={channelMeta.label} />
        <p className={`${styles.intro} ${styles.studioOptionalIntro}`}>{i18nT("choisissez_la_structure_publicitaire_le_format_a1cef40d")}</p>
        <div className={styles.studioGrid}>
          <label className={styles.field}>{i18nT("type_de_promotion_576cb078")}<select value={nativeSettings.intendedPromotionType} onChange={(event) => {
            const intendedPromotionType = event.target.value as PinterestWizardSettings["intendedPromotionType"];
            updateNativeSettings({ ...nativeSettings, intendedPromotionType,
              creativeType: intendedPromotionType === "CATALOG" ? null : nativeSettings.objectiveType === "VIDEO_COMPLETION" ? "VIDEO" : "REGULAR" });
          }}><option value="STANDARD_AD">{i18nT("epingle_sponsorisee_bb8e1b62")}</option>{["CONSIDERATION", "SALES"].includes(nativeSettings.objectiveType) && <option value="CATALOG">{i18nT("catalogue_de_produits_brouillon_230a68b7")}</option>}</select></label>
          {nativeSettings.intendedPromotionType === "STANDARD_AD" && <label className={styles.field}>{i18nT("format_de_l_epingle_bcba2d54")}<select value={nativeSettings.creativeType || "REGULAR"} onChange={(event) => updateNativeSettings({ ...nativeSettings, creativeType: event.target.value as Exclude<PinterestWizardSettings["creativeType"], null> })}>{(nativeSettings.objectiveType === "VIDEO_COMPLETION" ? ["VIDEO", "MAX_VIDEO"] : ["REGULAR", "VIDEO", "MAX_VIDEO", "CAROUSEL"]).map((value) => <option key={value} value={value}>{pinterestCreativeLabel(value as Exclude<PinterestWizardSettings["creativeType"], null>, i18nT)}</option>)}</select></label>}
          <div className={`${styles.field} ${styles.studioWide}`}><span>{i18nT("format_prevu_value_6b6a70e2", { value0: nativeWizardFormat(nativeSettings, i18nT) })}</span><small>{nativeSettings.intendedPromotionType === "CATALOG" ? i18nT("le_catalogue_et_le_groupe_de_fa918517") : nativeSettings.creativeType === "REGULAR" ? i18nT("l_image_simple_peut_etre_publiee_ace2c48b") : i18nT("ce_format_est_conserve_dans_le_99410bf4")}</small></div>
          <label className={`${styles.field} ${styles.studioWide}`}>{i18nT("direction_creative_du_pin_619841f2")}<VoiceTextarea value={draft.mediaBrief} onChange={(mediaBrief) => updateDraft({ mediaBrief })} maxLength={1000} purpose="instruction" contextLabel={i18nT("direction_creative_du_pin_619841f2")} placeholder={i18nT("style_produit_scene_preuves_a_montrer_16d39479")} /></label>
        </div>
      </section>}

      {hasMediaStep && <section hidden={step !== mediaStep} data-channel={channelId} data-media-step="true" className={`${styles.card} ${styles.studioCard} ${styles.studioMediaCard} ${styles.studioDedicatedMediaCard} ${channelId === "pinterest" ? styles.studioPureMediaCard : ""}`}>
        <StudioStepHeader number={mediaStep + 1} label={channelId === "pinterest" ? i18nT("pur_media_e63ff486") : channelId === "linkedin" ? i18nT("media_linkedin_7e2d9359") : channelId === "openai" ? i18nT("image_chatgpt_b23933a7") : i18nT("medias_38231af1")} title={channelId === "pinterest" ? i18nT("votre_media_visible_en_entier_105dda6c") : channelId === "linkedin" ? i18nT("votre_media_linkedin_visible_en_entier_db8d16b3") : channelId === "openai" ? i18nT("votre_image_visible_en_entier_703eb79a") : i18nT("vos_medias_visibles_en_entier_414ef971")} mobileTitle={channelId === "pinterest" || channelId === "linkedin" || channelId === "openai" ? i18nT("votre_media_e5f9284a") : i18nT("vos_medias_009bb358")} channel={channelMeta.label} />
        <p className={`${styles.intro} ${styles.studioOptionalIntro}`}>{channelId === "pinterest" ? i18nT("ajoutez_l_image_de_votre_pin_20e10d67") : channelId === "linkedin" ? draft.mediaStrategy === "video" ? i18nT("importez_generez_ou_choisissez_une_video_e315cb3f") : i18nT("importez_generez_ou_choisissez_votre_image_3bb393f7") : channelId === "openai" ? i18nT("choisissez_ou_creez_une_image_jpg_aca3deec", { value0: CHATGPT_ADS_MIN_IMAGE_SIDE_PX, value1: CHATGPT_ADS_MIN_IMAGE_SIDE_PX }) : i18nT("importez_generez_ou_choisissez_chaque_fichier_f2146097")}</p>
        <div className={styles.studioGrid}>
          {nativeSettings ? <div className={styles.field}><span>{nativeSettings.channel === "pinterest" ? i18nT("media_attendu_178d03cf") : i18nT("format_prevu_f888ffb1")} : {nativeWizardFormat(nativeSettings, i18nT)}</span><small>{nativeSettings.channel === "tiktok" ? i18nT("une_vraie_video_et_une_identite_ded490b9") : nativeSettings.channel === "pinterest" && nativeSettings.intendedPromotionType === "CATALOG" ? i18nT("le_catalogue_et_le_groupe_de_b152f711") : nativeSettings.channel === "pinterest" ? i18nT("le_fichier_et_ses_droits_seront_76561808") : nativeSettings.channel === "x" && nativeSettings.format === "text" ? i18nT("aucun_media_n_est_necessaire_pour_562cdf07") : i18nT("choisissez_un_media_coherent_ses_droits_0dce6126")}</small></div> : googleSearchMedia ? <div className={styles.field}><span>{i18nT("format_publie_annonce_google_search_textuelle_27037241")}</span><small>{i18nT("ce_connecteur_ne_joint_pas_d_f8674153")}</small></div> : channelId === "meta" ? <div className={styles.field}><span>{i18nT("pack_publicitaire_meta_988c48c9")}</span><small>{i18nT("inr_ads_prepare_un_visuel_feed_52855840")}</small></div> : channelId === "openai" ? <div className={styles.field}><span>{i18nT("carte_chatgpt_avec_image_carree_0db4d203")}</span><small>{i18nT("ajoutez_une_image_nette_et_representative_38034fd3")}</small></div> : <label className={styles.field}>{i18nT("media_a_utiliser_8701a2a0")}<select value={draft.mediaStrategy} onChange={(event) => updateDraft({ mediaStrategy: event.target.value as AdsCampaignInput["mediaStrategy"] })}>{mediaStrategyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}
          {(nativeSettings === null || nativeMediaUpload) && !googleSearchMedia && channelId !== "meta" && channelId !== "openai" && <details className={styles.campaignExternalMedia}><summary>{i18nT("utiliser_un_lien_externe_7760f771")}</summary><label className={styles.field}>{i18nT("lien_https_du_media_ce368ea4")}<input type="url" value={draft.creativeUrl || draft.imageUrl} onChange={(event) => updateDraft({ imageUrl: event.target.value, creativeUrl: event.target.value })} placeholder={nativeMediaStrategy === "video" ? i18nT("ads_ui_9c65fa3aa3") : i18nT("ads_ui_a8af6bc749")} /></label></details>}
          {nativeMediaStrategy !== "search_text" && channelId !== "pinterest" && <label className={`${styles.field} ${styles.studioWide}`}>{i18nT("consignes_pour_vos_medias_ae6b61ef")}<VoiceTextarea value={draft.mediaBrief} onChange={(mediaBrief) => updateDraft({ mediaBrief })} maxLength={1000} purpose="instruction" contextLabel={i18nT("consignes_pour_le_media_66581037")} placeholder={i18nT("style_produit_scene_preuves_a_montrer_5036989c")} /></label>}
        </div>
        {channelId === "meta" && <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}>
          <legend>{i18nT("emplacements_et_formats_meta_2cafbb94")}</legend>
          <p>{i18nT("chaque_emplacement_utilise_uniquement_le_visuel_784fa52b")}</p>
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
          <div><strong>{i18nT("source_media_catalogue_pinterest_f4fee607")}</strong><p>{i18nT("les_images_et_videos_proviendront_du_d86af875")}</p></div>
        </div>}
        {(nativeSettings === null || nativeMediaUpload) && channelId !== "meta" && <div className={styles.campaignMediaWorkspace}>
          <div className={styles.campaignMediaWorkspaceHeading}><div><span>{i18nT("medias_de_campagne_1ad6a387")}</span><strong>{googleSearchMedia ? attachedCampaignMediaUrl ? i18nT("image_conservee_dans_inrcy_976e553a") : i18nT("aucun_media_a_fournir_pour_google_3c148d58") : attachedCampaignMediaUrl ? i18nT("un_media_est_associe_a_cette_e241b3de") : i18nT("choisissez_ou_creez_le_media_adapte_b819f1f1")}</strong></div>{attachedCampaignMediaUrl ? <span data-type={draft.creativeType || "image"}>{draft.creativeType === "video" ? i18nT("video_304f6ca4") : i18nT("image_50e19fda")} {" "}{i18nT("prete_85536043")}</span> : <span>{channelId === "openai" ? i18nT("image_obligatoire_de1b69f0") : nativeMediaStrategy === "video" ? i18nT("video_a_fournir_9c4f6a70") : nativeMediaStrategy === "image" ? i18nT("image_a_fournir_0f687b87") : i18nT("optionnel_selon_le_format_333fbb4b")}</span>}</div>
          {!googleSearchMedia && <div className={styles.campaignMediaActions} data-three-actions={nativeMediaUpload || undefined}>
            <LocalMediaUploadChoice
              disabled={campaignMediaUploadBusy}
              triggerLabel={campaignMediaUploadBusy ? i18nT("ajout_en_cours_7935509d") : undefined}
              image={{
                onSelect: () => campaignImageInputRef.current?.click(),
                hidden: nativeMediaStrategy === "video",
                detail: i18nT("ads_ui_5615f79d7e"),
                maxSelection: 1,
              }}
              video={{
                onSelect: () => campaignVideoInputRef.current?.click(),
                hidden: nativeMediaStrategy === "image" || channelId === "openai",
                detail: i18nT("ads_ui_86dd6de890"),
              }}
              testId="ads-local-media-choice"
            />
            <button type="button" className={styles.campaignMediaGenerate} onClick={() => setCampaignMediaStudioOpen(true)} disabled={campaignMediaUploadBusy}><span aria-hidden="true">✦</span> {" "}{i18nT("generer_bd221c07")}</button>
            <button type="button" onClick={() => setCampaignMediaLibraryOpen(true)} disabled={campaignMediaUploadBusy}><span aria-hidden="true">▦</span> {" "}{i18nT("mediatheque_e4fa8e31")}</button>
          </div>}
          {googleSearchMedia && <p className={styles.campaignMediaFormatHint}>{i18nT("la_demo_google_search_publie_uniquement_6402ac10")}</p>}
          {attachedCampaignMediaUrl ? <CampaignMediaPreview key={`${draft.creativeType}:${attachedCampaignMediaUrl}`} url={attachedCampaignMediaUrl} type={draft.creativeType === "video" ? "video" : "image"} campaignName={draft.name || channelMeta.label} onChooseMedia={() => setCampaignMediaLibraryOpen(true)} /> : <div className={styles.campaignMediaPreview} data-empty="true" role="status"><div className={styles.campaignMediaPreviewFallback}><span aria-hidden="true">✦</span><strong>{i18nT("apercu_complet_du_media_d50f93f9")}</strong><p>{i18nT("le_fichier_choisi_ou_genere_apparaitra_e5784704")}</p></div></div>}
          {attachedCampaignMediaUrl && <div className={styles.campaignMediaAttached}><span aria-hidden="true">✓</span><div><strong>{googleSearchMedia ? i18nT("image_conservee_dans_inrcy_976e553a") : i18nT("media_associe_a_la_campagne_126df16e")}</strong><small>{googleSearchMedia ? i18nT("non_jointe_a_la_campagne_google_3e26c433") : channelId === "openai" ? i18nT("image_de_votre_mediatheque_inrcy_le_38450c96") : i18nT("value_stockee_dans_votre_mediatheque_inrcy_3c5ddc3e", { value0: draft.creativeType === "video" ? i18nT("video_304f6ca4") : i18nT("wizard_pool_image") })}</small></div><a href={attachedCampaignMediaUrl} target="_blank" rel="noreferrer">{i18nT("voir_cb044503")}</a><button type="button" onClick={() => updateDraft({ creativeUrl: "", imageUrl: "" })}>{i18nT("retirer_54ec24a1")}</button></div>}
          {campaignMediaUploadError && <p className={styles.campaignMediaError} role="alert">{campaignMediaUploadError}</p>}
        </div>}
        {(nativeSettings === null || nativeMediaUpload) && <>
          <input ref={campaignImageInputRef} type="file" accept={channelId === "openai" ? "image/jpeg,image/png,image/webp" : "image/*"} hidden onChange={(event) => void handleCampaignMediaUpload(event, "image")} />
          <input ref={campaignVideoInputRef} type="file" accept="video/*" hidden onChange={(event) => void handleCampaignMediaUpload(event, "video")} />
        </>}
        {channelId === "meta" && campaignMediaUploadError && <p className={styles.campaignMediaError} role="alert">{campaignMediaUploadError}</p>}
      </section>}

      <section hidden={step !== deliveryStep} data-channel={channelId} className={`${styles.card} ${styles.studioCard} ${styles.studioDeliveryCard}`}>
        <StudioStepHeader number={deliveryStep + 1} label={channelId === "pinterest" ? i18nT("destination_mesure_4e5ba149") : i18nT("ads_ui_b4f5f9c82d")} title={channelId === "pinterest" ? i18nT("ou_mene_votre_epingle_b00f5616") : i18nT("ou_envoyer_et_comment_mesurer_a08af463")} mobileTitle={channelId === "pinterest" ? i18nT("lien_mesure_de138a4b") : i18nT("votre_diffusion_0b337437")} channel={channelMeta.label} />
        <p className={styles.intro}><span className={styles.studioTitleLong}>{i18nT("preparez_le_parcours_apres_le_clic_036fda87")}</span><span className={styles.studioTitleShort}>{i18nT("aucune_diffusion_avant_votre_validation_6a730842")}</span></p>
        <div className={styles.studioGrid}>
          {destinationFieldVisible && <label className={`${styles.field} ${styles.studioWide}`}>{channelId === "pinterest" ? i18nT("url_de_destination_du_pin_3e3a4be3") : i18nT("lien_de_redirection_191a7215")}<input type="url" value={draft.destinationUrl} onChange={(event) => updateDraft({ destinationUrl: event.target.value })} placeholder={i18nT("ads_ui_85f4f6e22f")} /><small>{i18nT("une_page_https_claire_et_coherente_57748213")}</small></label>}
          {destinationReview.required && <div className={`${styles.studioDestinationReview} ${styles.studioWide}`}>
            <span>{destinationReview.confirmed ? i18nT("destination_validee_9e371de4") : i18nT("verifiez_ou_votre_annonce_enverra_les_744f31c9")}</span>
            {destinationReview.valid && <a href={draft.destinationUrl.trim()} target="_blank" rel="noopener noreferrer">{i18nT("ouvrir_le_lien_1fd1e3e2")}</a>}
            {!destinationReview.valid && <small role="alert">{i18nT("indiquez_un_lien_https_valide_avant_36d6d90b")}</small>}
          </div>}
          {nativeSettings?.channel === "tiktok" && <>
            <label className={styles.field}>{i18nT("destination_tiktok_52d52a58")}<select value={nativeSettings.destinationKind} onChange={(event) => updateNativeSettings({ ...nativeSettings, destinationKind: event.target.value as TikTokWizardSettings["destinationKind"] })}><option value="website">{i18nT("site_web_7e78af33")}</option>{nativeSettings.objectiveType === "LEAD_GENERATION" && <option value="instant_form">{i18nT("formulaire_integre_2421b8da")}</option>}{["REACH", "VIDEO_VIEWS", "ENGAGEMENT"].includes(nativeSettings.objectiveType) && <option value="profile">{i18nT("profil_tiktok_77aac6e1")}</option>}</select></label>
            <div className={styles.field}><span>{i18nT("optimisation_value_bd7a5b3e", { value0: nativeBriefTerm(nativeSettings.optimizationIntent, i18nT) })}</span><small>{i18nT("pour_cet_objectif_le_pixel_ou_d4d6d638")}</small></div>
          </>}
          {nativeSettings?.channel === "pinterest" && (nativeSettings.objectiveType === "SALES" || nativeSettings.objectiveType === "LEADS") && <label className={styles.field}>{i18nT("evenement_pinterest_0634524e")}<select value={nativeSettings.conversionEvent || ""} onChange={(event) => updateNativeSettings({ ...nativeSettings, conversionEvent: event.target.value as Exclude<PinterestWizardSettings["conversionEvent"], null> })}>{(nativeSettings.objectiveType === "SALES" ? ["CHECKOUT", "ADD_TO_CART"] : ["LEAD", "SIGNUP"]).map((value) => <option key={value} value={value}>{nativeBriefTerm(value, i18nT)}</option>)}</select><small>{i18nT("la_balise_et_l_evenement_reels_b3ca1c18")}</small></label>}
          {nativeSettings && nativeSettings.channel !== "linkedin" && nativeSettings.channel !== "pinterest" && <label className={styles.field}>{i18nT("action_souhaitee_0ef3fc57")}<select value={draft.conversionGoal} onChange={(event) => updateDraft({ conversionGoal: event.target.value as AdsCampaignInput["conversionGoal"] })}>{CONVERSION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}
          {!nativeSettings && (channelId === "openai" || channelId === "google" ? <div className={styles.field}><span>{i18nT("destination_apres_le_clic_ea7b1dae")}</span><strong>{i18nT("votre_site_web_635cd879")}</strong><small>{channelId === "google" ? i18nT("les_balises_de_suivi_ci_dessous_71d2d65f") : i18nT("pour_mesurer_les_visites_ajoutez_vos_76faa634")}</small></div> : <label className={styles.field}>{i18nT("lieu_de_conversion_b67785fe")}<select value={draft.conversionLocation} onChange={(event) => updateDraft({ conversionLocation: event.target.value as AdsCampaignInput["conversionLocation"] })}>{CONVERSION_LOCATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label} — {option.detail}</option>)}</select></label>)}
          {<label className={styles.field}>{i18nT("balises_de_suivi_cf3a63b8")}{" "}<small>{i18nT("optionnel_879d6b16")}</small><input value={draft.trackingParameters} maxLength={500} onChange={(event) => updateDraft({ trackingParameters: event.target.value })} placeholder={channelId === "linkedin" ? i18nT("utm_source_linkedin_utm_medium_paid_335f9b40") : channelId === "pinterest" ? i18nT("utm_source_pinterest_utm_campaign_inspiration_92a8595e") : channelId === "meta" ? i18nT("utm_source_meta_utm_medium_paid_bf5523c8") : channelId === "openai" ? i18nT("utm_source_chatgpt_utm_medium_paid_2fbdae33") : i18nT("utm_source_google_utm_campaign_devis_4aa60b7e")} /></label>}
          {channelId === "openai" && <ChatGPTAdsDistribution settings={openaiDelivery} onChange={updateOpenaiDelivery} />}
          {nativeSettings?.channel === "pinterest" && !nativeSettings.conversionEvent && <aside className={`${styles.studioKeywordGuidance} ${styles.studioWide}`}><strong>{i18nT("mesure_des_resultats_pinterest_d8068ba0")}</strong><p>{i18nT("cette_campagne_mesure_les_impressions_ou_0f9ecdbd")}</p></aside>}
          {nativeSettings?.channel === "pinterest" && nativeSettings.conversionEvent && <aside className={`${styles.studioKeywordGuidance} ${styles.studioWide}`}><strong>{i18nT("evenement_prevu_value_09f95003", { value0: nativeBriefTerm(nativeSettings.conversionEvent, i18nT) })}</strong><p>{i18nT("verifiez_la_balise_de_conversion_pinterest_78a769f5")}</p></aside>}
          {nativeSettings?.channel === "linkedin" && <div className={styles.studioWide}><LinkedInAdsDistribution accountId={draft.adAccountId || externalStatuses.linkedin.selectedAccountId} settings={linkedInDelivery} active={creating && step === deliveryStep} objective={nativeSettings.objectiveType} onChange={updateLinkedInDelivery} /></div>}
          {channelId === "google" && <div className={styles.studioWide}><GoogleAdsMeasurement resources={effectiveGoogleResources} loading={googleResourcesLoad === "loading"} error={googleResourcesError} onRefresh={() => setGoogleResourcesRevision((value) => value + 1)} /></div>}
          {nativeSettings?.channel === "x" && <aside className={`${styles.studioKeywordGuidance} ${styles.studioWide}`}><strong>{i18nT("mesure_x_a_confirmer_9965283b")}</strong><p>{nativeSettings.objective === "website_conversions" ? i18nT("une_source_de_conversion_x_valide_527c3c5e") : i18nT("les_resultats_reels_ne_seront_visibles_e75bda67")}</p></aside>}
          {channelId === "google" && draft.campaignType !== "search" && <label className={`${styles.check} ${styles.studioWide}`}><input type="checkbox" checked={draft.urlExpansion} onChange={(event) => updateDraft({ urlExpansion: event.target.checked })} />{i18nT("autoriser_l_utilisation_de_pages_pertinentes_7e972e9e")}</label>}
          {channelId === "google" && draft.campaignType !== "search" && <label className={`${styles.field} ${styles.studioWide}`}>{i18nT("pages_a_exclure_28c05b39")}{" "}<small>{i18nT("une_url_https_par_ligne_optionnel_fb41932f")}</small><CampaignTextarea className={styles.studioAdaptiveContentTextarea} rows={3} value={editableList(draft.urlExclusions)} onChange={(event) => updateDraft({ urlExclusions: parseEditableList(event.target.value.split("\n")) })} placeholder={i18nT("ads_ui_8638b26044")} /></label>}

        </div>
      </section>

      <section hidden={step !== budgetStep} data-channel={channelId} className={`${styles.card} ${styles.studioCard} ${styles.studioBudgetCard}`}>
        <StudioStepHeader number={budgetStep + 1} label={channelId === "pinterest" ? i18nT("budget_pinterest_f9a5a536") : i18nT("ads_ui_fb42ae4ac6")} title={i18nT("votre_investissement_en_clair_5f338345")} mobileTitle={i18nT("votre_budget_db001a35")} channel={channelMeta.label} />
        <p className={styles.intro}><span className={styles.studioTitleLong}>{i18nT("choisissez_le_rythme_d_investissement_et_832a4592")}</span><span className={styles.studioTitleShort}>{i18nT("estimation_indicative_sans_promesse_de_resultat_dfe9a76f")}</span></p>
        {creationPath === "inrcy" && planBudgetRationale && <aside className={styles.studioBudgetAdvice}><strong>{i18nT("pourquoi_inrcy_propose_ce_budget_3bbd96da")}</strong><p>{planBudgetRationale}</p><small>{i18nT("proposition_initiale_a_ajuster_selon_vos_ca7b5bea")}</small></aside>}
        {preparedOnlyChannel ? <PreparedAdsBudget settings={preparedDelivery} dailyBudget={draft.dailyBudgetEuros} endDate={draft.endDate} timeZone={preparedTimeZone} onChange={updatePreparedDelivery} onDailyChange={(dailyBudgetEuros) => updateDraft({ dailyBudgetEuros })} onEndDateChange={(endDate) => updateDraft({ endDate })} /> : channelId === "meta" ? <MetaAdsBudget settings={metaDelivery} dailyBudget={draft.dailyBudgetEuros} endDate={draft.endDate} timeZone={effectiveMetaResources?.account.timezone || null} onChange={updateMetaDelivery} onDailyChange={(dailyBudgetEuros) => updateDraft({ dailyBudgetEuros })} onEndDateChange={(endDate) => updateDraft({ endDate })} /> : channelId === "openai" ? <ChatGPTAdsBudget settings={openaiDelivery} dailyBudget={draft.dailyBudgetEuros} endDate={draft.endDate} timeZone={effectiveOpenaiResources?.account.timezone || null} onChange={updateOpenaiDelivery} onDailyChange={(dailyBudgetEuros) => updateDraft({ dailyBudgetEuros })} onEndDateChange={(endDate) => updateDraft({ endDate })} /> : channelId === "pinterest" ? <PinterestAdsBudget settings={pinterestDelivery} dailyBudget={draft.dailyBudgetEuros} endDate={draft.endDate} timeZone={effectivePinterestResources?.account.timezone || null} onChange={updatePinterestDelivery} onDailyChange={(dailyBudgetEuros) => updateDraft({ dailyBudgetEuros })} onEndDateChange={(endDate) => updateDraft({ endDate })} /> : channelId === "google" ? <GoogleAdsBudget settings={googleDelivery} dailyBudget={draft.dailyBudgetEuros} endDate={draft.endDate} timeZone={effectiveGoogleResources?.timeZone || ""} onChange={updateGoogleDelivery} onDailyChange={(dailyBudgetEuros) => updateDraft({ dailyBudgetEuros })} onEndDateChange={(endDate) => updateDraft({ endDate })} /> : nativeSettings?.channel === "linkedin" ? <>
          <LinkedInAdsBudget settings={linkedInDelivery} dailyBudget={draft.dailyBudgetEuros} endDate={draft.endDate} bid={draft.linkedinBidEuros} objective={nativeSettings.objectiveType} pricing={linkedInBidPricing} onChange={updateLinkedInDelivery} onDailyChange={(dailyBudgetEuros) => updateDraft({ dailyBudgetEuros })} onEndDateChange={(endDate) => updateDraft({ endDate })} onBidChange={(linkedinBidEuros) => updateDraft({ linkedinBidEuros })} />
          {selectedLinkedInCampaignGroup?.runSchedule.end && <p className={styles.studioReadiness}>{i18nT("le_groupe_value_termine_sa_diffusion_2734322f", { value0: selectedLinkedInCampaignGroup.name, value1: new Date(selectedLinkedInCampaignGroup.runSchedule.end).toLocaleString(locale) })}</p>}
          {adsUiText(i18nT, linkedInScheduleIssue) && <div className={styles.studioReadiness} role="alert"><strong>{i18nT("calendrier_a_adapter_bec71c2b")}</strong>{adsUiText(i18nT, linkedInScheduleIssue)}
            {linkedInCalendarCanBeRepaired && linkedInCalendarRepair && <button type="button" className={styles.secondaryButton} disabled={busy !== null} onClick={() => updateDraft({ endDate: linkedInCalendarRepair.endDate, linkedinDeliverySettings: linkedInCalendarRepair.linkedinDeliverySettings })}>{i18nT("adapter_la_fin_au_groupe_value_bdfe1785", { value0: new Date(linkedInCalendarRepair.linkedinDeliverySettings!.budget.endAt!).toLocaleString(locale) })}</button>}
            <button type="button" className={styles.secondaryButton} onClick={() => navigateToStep(foundationsStep)}>{i18nT("choisir_un_autre_groupe_52ea925a")}</button>
          </div>}
        </> : <>
        <div className={styles.studioGrid}>
          <label className={styles.field}>{i18nT("budget_quotidien_moyen_8d3aa62f")}<input type="number" min="5" max="500" step="0.01" value={draft.dailyBudgetEuros} onChange={(event) => updateDraft({ dailyBudgetEuros: Number(event.target.value) })} /></label>
          <label className={styles.field}>{i18nT("date_de_fin_716a6d8d")}<input type="date" value={draft.endDate} onChange={(event) => updateDraft({ endDate: event.target.value })} /></label>
        </div>
        <div className={styles.studioBudgetForecast} aria-label={i18nT("reperes_budgetaires_29cfb4a5")}>
          <div className={styles.studioBudgetForecastCard}><span>{i18nT("budget_quotidien_c56e4bf1")}</span><strong>{Number(draft.dailyBudgetEuros || 0).toLocaleString(locale, { style: "currency", currency: "EUR" })}</strong><small>{i18nT("moyenne_planifiee_c5ac00b0")}</small></div>
          <div className={styles.studioBudgetForecastCard}><span>{i18nT("duree_prevue_e9741840")}</span><strong>{estimatedCampaignDays ? i18nT("ads_ui_be2b63d0db", { value0: estimatedCampaignDays }) : "—"}</strong><small>{i18nT("jusqu_a_la_date_de_fin_f557d508")}</small></div>
          <div className={styles.studioBudgetForecastCard}><span>{i18nT("enveloppe_estimee_772ebaef")}</span><strong>{Number.isFinite(estimate) ? estimate.toLocaleString(locale, { style: "currency", currency: "EUR" }) : "—"}</strong><small>{i18nT("budget_duree_8e2b96db")}</small></div>
        </div>
        <div className={styles.studioBudgetPanel}><div><span>{i18nT("a_retenir_2fcd85f2")}</span><strong>{i18nT("vous_gardez_la_main_a619fb85")}</strong></div><p>{i18nT("aucune_depense_n_est_engagee_tant_f905fa2b")}</p></div>
        </>}
      </section>

      <section hidden={step !== validationStep} data-channel={channelId} className={`${styles.card} ${styles.studioCard} ${styles.studioValidationCard}`}>
        <StudioStepHeader number={validationStep + 1} label={channelId === "pinterest" ? i18nT("revue_pinterest_fcb24cf3") : i18nT("votre_controle_95386e61")} title={channelId === "pinterest" ? i18nT("votre_campagne_pinterest_prete_a_valider_7bd9c828") : i18nT("votre_campagne_vos_decisions_e3618575")} mobileTitle={i18nT("validation_dd74d182")} channel={channelMeta.label} />
        <p className={styles.intro}><span className={styles.studioTitleLong}>{["linkedin", "google", "pinterest", "meta", "openai", "x", "tiktok"].includes(channelId) && creationPath === "inrcy" ? i18nT("votre_campagne_est_preparee_relisez_le_12d22228") : channelId === "pinterest" ? i18nT("relisez_l_objectif_l_audience_l_cfe08c31") : i18nT("relisez_cette_proposition_avant_tout_enregistrem_02f0842c")}</span><span className={styles.studioTitleShort}>{channelId === "pinterest" ? i18nT("lancez_maintenant_ou_gardez_le_brouillon_7cf49fee") : i18nT("diffusion_apres_votre_accord_et_celui_f22e7a02")}</span></p>
        {preparedOnlyChannel && <PreparedAdsNativeControls draft={draft} active={creating} connected={channelId === "tiktok" ? externalStatuses.tiktok.connected : externalStatuses.x.connected}
          selectedAccountId={channelId === "tiktok" ? tikTokAccountId : externalStatuses.x.selectedAccountId || draft.adAccountId}
          tikTokResources={effectiveTikTokResources} mode={step === validationStep ? "final" : "hidden"}
          onChange={updateDraft} onReadiness={setPreparedNativeReadiness} onXResources={setPreparedXResources} />}
        {preparedOnlyChannel && <PreparedAdsEffectiveSummary draft={draft} timeZone={preparedTimeZone} identityMessage={channelId === "tiktok" ? adsUiText(i18nT, tikTokIdentityMessage) : i18nT("le_compte_sa_source_de_financement_1c15af4d")} />}
        {preparedOnlyChannel && preparedReviewIssues.length > 0 && <div className={styles.studioReadiness} role="status"><strong>{i18nT("reglages_a_completer_dans_le_brouillon_c616c5d5")}</strong><ul>{preparedReviewIssues.map((issue) => <li key={issue}>{adsUiText(i18nT, issue)}</li>)}</ul></div>}
        {channelId === "meta" && <MetaAdsEffectiveSummary draft={draft} resources={effectiveMetaResources} />}
        {channelId === "openai" && <ChatGPTAdsEffectiveSummary draft={draft} resources={effectiveOpenaiResources} />}
        {channelId === "meta" && adsUiText(i18nT, metaLaunchReadinessReason) && <p className={styles.studioReadiness} role="status"><strong>{i18nT("controle_meta_ads_279080fc")}</strong>{adsUiText(i18nT, metaLaunchReadinessReason)}{metaResourcesLoad === "error" && <button type="button" className={styles.secondaryButton} onClick={() => setMetaResourcesRevision((value) => value + 1)}>{i18nT("reverifier_le_compte_et_la_page_e4ca505c")}</button>}</p>}
        {channelId === "openai" && adsUiText(i18nT, openaiLaunchReadinessReason) && <p className={styles.studioReadiness} role="status"><strong>{i18nT("controle_chatgpt_ads_2f6bbeb5")}</strong>{adsUiText(i18nT, openaiLaunchReadinessReason)}{openaiResourcesLoad === "error" && <button type="button" className={styles.secondaryButton} onClick={() => setOpenaiResourcesRevision((value) => value + 1)}>{i18nT("reverifier_le_compte_et_les_zones_5df2434d")}</button>}</p>}
        {channelId === "google" && <GoogleAdsEffectiveSummary draft={draft} resources={effectiveGoogleResources} />}
        {channelId === "pinterest" && <PinterestAdsEffectiveSummary draft={draft} timeZone={effectivePinterestResources?.account.timezone || null} resources={effectivePinterestResources ? { geographyOptions: effectivePinterestResources.geographies, languageOptions: effectivePinterestResources.locales } : null} />}
        {channelId === "pinterest" && adsUiText(i18nT, pinterestLaunchReadinessReason) && <p className={styles.studioReadiness} role="status"><strong>{i18nT("controle_pinterest_ads_f675acc1")}</strong>{adsUiText(i18nT, pinterestLaunchReadinessReason)}<button type="button" className={styles.secondaryButton} onClick={() => navigateToStep(pinterestGeoReady ? budgetStep : geographyStep)}>{i18nT("voir_les_reglages_concernes_01749cfc")}</button>{pinterestResourcesLoad === "error" && <button type="button" className={styles.secondaryButton} onClick={() => setPinterestResourcesRevision((value) => value + 1)}>{i18nT("reverifier_le_compte_39ef192e")}</button>}</p>}
        {channelId === "google" && draft.campaignType === "search" && adsUiText(i18nT, googleLaunchReadinessReason) && <p className={styles.studioReadiness} role="status"><strong>{i18nT("controle_google_ads_79c5f65e")}</strong>{adsUiText(i18nT, googleLaunchReadinessReason)}{googleGeoState.status === "error" && <button type="button" className={styles.secondaryButton} onClick={() => { googleResolvedGeoKey.current = ""; setGoogleGeoRevision((value) => value + 1); }}>{i18nT("reverifier_les_zones_b7fd9197")}</button>}{googleResourcesLoad === "error" && <button type="button" className={styles.secondaryButton} onClick={() => setGoogleResourcesRevision((value) => value + 1)}>{i18nT("reverifier_le_compte_39ef192e")}</button>}</p>}
        {channelId === "linkedin" && <LinkedInAdsEffectiveSummary settings={linkedInDelivery} dailyBudget={draft.dailyBudgetEuros} endDate={draft.endDate} zones={linkedInGeoTargets.map((target) => target.name)} />}
        <dl className={styles.studioReviewGrid}>
          <div><dt>{i18nT("campagne_53c2fc2a")}</dt><dd>{draft.name || i18nT("a_renseigner_e3d2f20f")}</dd><small>{nativeSettings ? `${nativeBriefTerm(nativeWizardObjective(nativeSettings), i18nT)} · ${nativeWizardFormat(nativeSettings, i18nT)}` : `${selectedCampaignType?.label || channelMeta.label} · ${OBJECTIVE_OPTIONS.find((option) => option.value === draft.objective)?.label}`}</small></div>
          <div><dt>{i18nT("compte_canal_f1359301")}</dt><dd>{channelMeta.label} · {isAdsProvider(channelId) ? associatedAccountName || i18nT("a_configurer_bde8227a") : channelId === "openai" ? connectionSnapshots.openai.accountLabel || connectionSnapshots.openai.accountId || i18nT("a_connecter_dee8dcb4") : activeExternalStatus?.selectedAccountId ? activeExternalStatus.selectedAccountName || activeExternalStatus.selectedAccountId : i18nT("a_associer_98e1fb09")}</dd><small>{reviewAccountStatusLabel}</small></div>
          <div><dt>{channelId === "openai" ? i18nT("objectif_publicitaire_20d8c3c3") : channelId === "pinterest" ? i18nT("objectif_pinterest_7bfa04bd") : i18nT("objectif_mesure_3be0c22a")}</dt><dd>{channelId === "openai" ? i18nT("clics_vers_le_site_22552132") : channelId === "google" ? i18nT("objectifs_du_compte_google_ads_efa07a46") : nativeSettings?.channel === "linkedin" || nativeSettings?.channel === "pinterest" ? nativeBriefTerm(nativeSettings.objectiveType, i18nT) : CONVERSION_OPTIONS.find((option) => option.value === draft.conversionGoal)?.label}</dd><small>{channelId === "openai" ? draft.targetLocations.length ? `${draft.targetLocations.slice(0, 2).join(" · ")}${draft.targetLocations.length > 2 ? i18nT("ads_count_extra_zones", { count: draft.targetLocations.length - 2 }) : ""}` : i18nT("zones_a_preciser_2e28f65b") : draft.targetLocations.length ? i18nT("ads_count_target_zones", { count: draft.targetLocations.length }) : i18nT("zones_a_preciser_2e28f65b")}</small></div>
          {channelId !== "linkedin" && channelId !== "google" && <div><dt>{i18nT("investissement_ba3f6f4e")}</dt><dd>{channelId === "pinterest" ? pinterestAdsBudgetLabel(draft, i18nT, locale) : channelId === "meta" ? metaAdsBudgetLabel(draft, i18nT, locale) : channelId === "openai" ? openaiAdsBudgetLabel(draft, i18nT, locale) : preparedOnlyChannel ? preparedAdsBudgetLabel(draft, i18nT, locale) : i18nT("value_jour_32cef077", { value0: draft.dailyBudgetEuros.toLocaleString(locale) })}</dd><small>{channelId === "openai" ? i18nT("cpc_maximal_enchere_value_fin_value_e1ba2dbb", { value0: draft.openaiBidEuros || "—", value1: draft.endDate || i18nT("ads_date_to_specify") }) : i18nT("fin_prevue_value_ac289a92", { value0: draft.endDate || i18nT("ads_date_to_specify") })}</small></div>}
          <div><dt>{i18nT("redirection_b77aad5f")}</dt><dd>{nativeSettings?.channel === "tiktok" && nativeSettings.destinationKind !== "website" ? nativeSettings.destinationKind === "profile" ? i18nT("profil_tiktok_77aac6e1") : i18nT("formulaire_integre_tiktok_f1a247ba") : draft.destinationUrl || i18nT("a_renseigner_e3d2f20f")}</dd><small>{channelId === "openai" ? i18nT("lien_https_de_la_carte_chatgpt_d40fa1e6") : nativeSettings?.channel === "pinterest" && nativeSettings.targetingMode === "automatic" ? draft.trackingParameters || i18nT("lien_de_l_epingle_sponsorisee_ac881512") : channelId === "linkedin" ? draft.trackingParameters || i18nT("lien_de_l_annonce_parametres_utm_08495210") : preparedOnlyChannel ? draft.trackingParameters || i18nT("destination_preparee_suivi_natif_a_verifier_42aea3e4") : draft.keywords.length ? i18nT("value_signaux_mots_cles_prepares_71eb7bb1", { value0: draft.keywords.length }) : i18nT("mots_cles_ou_audiences_a_completer_608bf503")}</small></div>
          <div><dt>{channelId === "openai" ? i18nT("carte_chatgpt_image_carree_7c54b6e5") : i18nT("medias_message_113a99d2")}</dt><dd>{channelId === "openai" ? draft.headlines[0] || i18nT("titre_a_renseigner_02c6be7e") : googleSearchMedia ? i18nT("annonces_textuelles_1a75ba49") : channelId === "meta" ? i18nT("pack_images_publicitaires_meta_0de7011a") : MEDIA_STRATEGY_OPTIONS.find((option) => option.value === draft.mediaStrategy)?.label}</dd><small>{channelId === "openai" ? draft.primaryText || i18nT("texte_a_renseigner_1d6da64c") : channelId === "meta" ? `${metaFeedReviewLabel} · ${metaStoryReelReviewLabel}` : googleSearchMedia ? i18nT("value_titres_value_descriptions_5d6b81f8", { value0: draft.headlines.length, value1: draft.descriptions.length }) : channelId === "linkedin" ? adsUiText(i18nT, LINKEDIN_CTA_LABELS[linkedInDelivery.callToAction]) : channelId === "pinterest" ? i18nT("titre_description_et_image_de_l_0a9ab5ea") : draft.callToAction || i18nT("appel_a_l_action_a_definir_a32bfc7e")}</small></div>
          {channelId !== "openai" && <div><dt>{i18nT("conversion_amp_suivi_34a3f0cc")}</dt><dd>{CONVERSION_LOCATION_OPTIONS.find((option) => option.value === draft.conversionLocation)?.label}</dd><small>{draft.trackingParameters || i18nT("aucune_balise_de_suivi_ajoutee_19fdb348")}</small></div>}
          {channelId !== "openai" && channelId !== "linkedin" && <div><dt>{i18nT("diffusion_avancee_b7c1a13f")}</dt><dd>{channelId === "meta" ? (draft.metaPlacements.length ? i18nT("ads_count_placements", { count: draft.metaPlacements.length }) : i18nT("placements_a_choisir_c60e5a11")) : channelId === "google" ? i18nT("langue_deduite_des_annonces_et_du_eee59a87") : nativeSettings?.channel === "tiktok" ? nativeBriefTerm(nativeSettings.placementIntent, i18nT) : nativeSettings?.channel === "pinterest" ? pinterestTargetingLabel(nativeSettings.targetingMode, i18nT) : nativeSettings?.channel === "x" ? nativeBriefTerm(nativeSettings.targetingMode, i18nT) : i18nT("preparation_complete_734a7b30")}</dd><small>{channelId === "meta" ? i18nT("ages_et_langues_verifies_optimisation_des_25ed96c3") : channelId === "google" ? (draft.googleSearchPartners ? i18nT("partenaires_de_recherche_inclus_93f4d74e") : i18nT("reseau_google_principal_5e2ca772")) : nativeSettings?.channel === "tiktok" ? i18nT("destination_value_optimisation_value_f8700438", { value0: nativeBriefTerm(nativeSettings.destinationKind, i18nT), value1: nativeBriefTerm(nativeSettings.optimizationIntent, i18nT) }) : nativeSettings?.channel === "pinterest" && nativeSettings.conversionEvent ? i18nT("evenement_value_5b1a4adf", { value0: nativeBriefTerm(nativeSettings.conversionEvent, i18nT) }) : nativeSettings?.channel === "pinterest" && nativeSettings.targetingMode === "automatic" ? i18nT("pinterest_optimise_automatiquement_l_audience_du_a38f4ccf") : i18nT("choix_a_verifier_sur_la_plateforme_36aafe91")}</small></div>}
          {["linkedin", "google", "pinterest", "meta", "openai", "x", "tiktok"].includes(channelId) && destinationReview.required && <label className={`${styles.check} ${styles.studioRequiredCheck}`} data-linkedin-destination-confirmation={channelId === "linkedin" || undefined} data-google-destination-confirmation={channelId === "google" || undefined} data-pinterest-destination-confirmation={channelId === "pinterest" || undefined} data-meta-destination-confirmation={channelId === "meta" || undefined} data-openai-destination-confirmation={channelId === "openai" || undefined} data-prepared-destination-confirmation={preparedOnlyChannel || undefined}>
            <input type="checkbox" checked={destinationReview.confirmed} disabled={busy !== null || !destinationReview.valid} onChange={(event) => setConfirmedDestinationUrl(event.target.checked ? draft.destinationUrl.trim() : "")} />
            <span><strong>{i18nT("lien_de_votre_annonce_60abc0eb")}</strong>{i18nT("je_confirme_que_l_annonce_doit_f982d246")}{" "}{draft.destinationUrl || i18nT("le_lien_a_completer_33e1e3ab")}.</span>
          </label>}
          {preparedOnlyChannel && <>
            <label className={`${styles.check} ${styles.studioRequiredCheck}`} data-prepared-budget-confirmation="true">
              <input type="checkbox" checked={preparedBudgetApprovalKey === preparedDraftKey} disabled={busy !== null || Boolean(preparedBudgetError)} onChange={(event) => setPreparedBudgetApprovalKey(event.target.checked ? preparedDraftKey : "")} />
              <span><strong>{i18nT("budget_et_calendrier_prepares_b9a9d758")}</strong>{i18nT("je_valide_77b8a207")}{" "}{preparedAdsBudgetLabel(draft, i18nT, locale)} {" "}{i18nT("et_les_dates_du_recapitulatif_20a82473")}{" "}{preparedNativeReady ? i18nT("la_campagne_sera_creee_en_pause_4214c9ee") : i18nT("le_brouillon_sera_enregistre_aucune_facturation_a4c678cf")}</span>
            </label>
            <label className={`${styles.check} ${styles.studioRequiredCheck}`} data-prepared-content-confirmation="true">
              <input type="checkbox" checked={preparedContentApprovalKey === preparedDraftKey} disabled={busy !== null} onChange={(event) => setPreparedContentApprovalKey(event.target.checked ? preparedDraftKey : "")} />
              <span><strong>{i18nT("audience_et_annonce_preparees_3e3a3694")}</strong>{i18nT("je_valide_les_zones_les_profils_e184f316")}{" "}{channelMeta.label}.</span>
            </label>
          </>}
          {channelId === "meta" && creationPath === "inrcy" && <label className={`${styles.check} ${styles.studioRequiredCheck}`} data-meta-launch-confirmation="true">
            <input type="checkbox" checked={confirmedSpend} disabled={busy !== null || !reviewAccountReady || metaResourcesLoad !== "ready" || !effectiveMetaResources || Boolean(metaLaunchReadinessReason)} onChange={(event) => { setConfirmedSpend(event.target.checked); linkedInLaunchConsent.current = event.target.checked ? { key: JSON.stringify(draft), status: "active", metaResourcesKey: metaAdsResourcesConsentKey(effectiveMetaResources) } : null; }} />
            <span><strong>{i18nT("budget_et_diffusion_62fba6bb")}</strong>{i18nT("j_autorise_la_diffusion_sur_le_4e960d87")}{" "}{effectiveMetaResources?.account.name || i18nT("meta_ads_54a00eaa")} {i18nT("ads_with_budget", { budget: metaAdsBudgetLabel(draft, i18nT, locale) })}, {metaDelivery.budget.startAt ? i18nT("a_partir_du_value_924108c5", { value0: metaConsentCalendar.start }) : i18nT("des_validation_de_meta_aa759c26")}{i18nT("jusqu_au_a6698bb9")}{" "}{metaConsentCalendar.end}{i18nT("meta_facturera_directement_ce_compte_le_a20a7b94")}</span>
          </label>}
          {channelId === "openai" && creationPath === "inrcy" && <label className={`${styles.check} ${styles.studioRequiredCheck}`} data-openai-launch-confirmation="true">
            <input type="checkbox" checked={confirmedSpend} disabled={busy !== null || !reviewAccountReady || openaiResourcesLoad !== "ready" || !effectiveOpenaiResources || Boolean(openaiLaunchReadinessReason) || (!openaiAccountReady && !openaiLiveReady)} onChange={(event) => { setConfirmedSpend(event.target.checked); linkedInLaunchConsent.current = event.target.checked ? { key: JSON.stringify(draft), status: openaiLiveReady ? "active" : "paused", openaiResourcesKey: openaiAdsResourcesConsentKey(effectiveOpenaiResources) || undefined } : null; }} />
            <span><strong>{i18nT("budget_et_diffusion_62fba6bb")}</strong>{openaiLiveReady ? i18nT("j_autorise_la_diffusion_sur_le_b66d5891", { value0: effectiveOpenaiResources?.account.name || "ChatGPT Ads", value1: openaiAdsBudgetLabel(draft, i18nT, locale), value2: draft.openaiBidEuros || "—", value3: openaiDelivery.budget.startAt ? i18nT("a_partir_du_value_924108c5", { value0: new Date(openaiDelivery.budget.startAt).toLocaleString(locale, { timeZone: effectiveOpenaiResources?.account.timezone || "UTC" }) }) : i18nT("ads_after_chatgpt_ad_approval") }) : i18nT("je_confirme_la_creation_sur_le_7cca9d93", { value0: effectiveOpenaiResources?.account.name || "ChatGPT Ads" })}</span>
          </label>}
          {channelId === "pinterest" && creationPath === "inrcy" && <label className={`${styles.check} ${styles.studioRequiredCheck}`} data-pinterest-launch-confirmation="true">
            <input type="checkbox" checked={confirmedSpend} disabled={busy !== null || !reviewAccountReady || pinterestResourcesLoad !== "ready" || !effectivePinterestResources || Boolean(pinterestLaunchReadinessReason)} onChange={(event) => { setConfirmedSpend(event.target.checked); linkedInLaunchConsent.current = event.target.checked ? { key: JSON.stringify(draft), status: "active", pinterestResourcesKey: pinterestAdsResourcesConsentKey(effectivePinterestResources) } : null; }} />
            <span><strong>{i18nT("budget_et_diffusion_62fba6bb")}</strong>{i18nT("j_autorise_la_diffusion_de_cette_46bd4268")}{" "}{externalStatuses.pinterest.selectedAccountName || i18nT("pinterest_ads_c131df7a")} {i18nT("ads_with_budget", { budget: pinterestAdsBudgetLabel(draft, i18nT, locale) })}, {pinterestDelivery.budget.startAt ? i18nT("a_partir_du_value_924108c5", { value0: new Date(pinterestDelivery.budget.startAt).toLocaleString(locale, { timeZone: effectivePinterestResources?.account.timezone || "UTC" }) }) : i18nT("des_la_validation_de_pinterest_fd5c96fd")}{i18nT("jusqu_au_a6698bb9")}{" "}{new Date(pinterestDelivery.budget.endAt || draft.endDate + "T23:59:59Z").toLocaleString(locale, { timeZone: effectivePinterestResources?.account.timezone || "UTC" })} ({effectivePinterestResources?.account.timezone || i18nT("utc_calendrier_cd9971e3")}{i18nT("pinterest_facturera_directement_ce_compte_fd9cc1ea")}</span>
          </label>}
          {channelId === "google" && creationPath === "inrcy" && <label className={`${styles.check} ${styles.studioRequiredCheck}`} data-google-launch-confirmation="true">
            <input type="checkbox" checked={confirmedSpend} disabled={busy !== null || !reviewAccountReady || googleResourcesLoad !== "ready" || !effectiveGoogleResources || Boolean(googleLaunchReadinessReason)} onChange={(event) => { setConfirmedSpend(event.target.checked); linkedInLaunchConsent.current = event.target.checked ? { key: JSON.stringify(draft), status: "active", googleResourcesKey: googleAdsResourcesConsentKey(effectiveGoogleResources) } : null; }} />
            <span><strong>{i18nT("budget_et_diffusion_62fba6bb")}</strong>{i18nT("j_autorise_la_diffusion_sur_le_4e960d87")}{" "}{associatedAccountName || i18nT("google_ads_14076a7d")} {i18nT("ads_with_budget", { budget: googleDelivery.budget.type === "total" ? i18nT("value_au_total_c990d9bf", { value0: Number(googleDelivery.budget.totalEuros || 0).toLocaleString(locale) }) : i18nT("value_de_budget_quotidien_moyen_f8b7b3dc", { value0: draft.dailyBudgetEuros.toLocaleString(locale) }) })}, {googleDelivery.startDate ? i18nT("a_partir_du_value_924108c5", { value0: googleDelivery.startDate }) : i18nT("des_la_validation_de_google_a37d748f")}{i18nT("jusqu_au_a6698bb9")}{" "}{draft.endDate}{i18nT("dans_le_fuseau_0ca8fdea")}{" "}{effectiveGoogleResources?.timeZone || i18nT("du_compte_28ccb6e3")}{i18nT("google_facturera_directement_ce_compte_293b8dc9")}{googleDelivery.budget.type === "daily" ? i18nT("la_depense_peut_varier_d_un_9470e504") : i18nT("cette_enveloppe_totale_est_transmise_a_135b3e44")}</span>
          </label>}
          {channelId === "linkedin" && <>

            <div><dt>{i18nT("groupe_linkedin_ed5b9915")}</dt><dd>{selectedLinkedInCampaignGroup?.name || (draft.linkedinCampaignGroupId ? i18nT("groupe_value_095e360a", { value0: draft.linkedinCampaignGroupId }) : i18nT("a_selectionner_51ca6f8a"))}</dd><small>{selectedLinkedInCampaignGroup ? i18nT("value_id_value_b0e8c14b", { value0: selectedLinkedInCampaignGroup.status, value1: selectedLinkedInCampaignGroup.id }) : draft.linkedinCampaignGroupId ? i18nT("id_value_a_reverifier_5dd2b37b", { value0: draft.linkedinCampaignGroupId }) : i18nT("a_verifier_a_l_etape_campagne_67fead3e")}</small></div>
            <div><dt>{i18nT("page_linkedin_354333b8")}</dt><dd>{selectedLinkedInOrganization ? linkedInOrganizationLabel(selectedLinkedInOrganization, i18nT) : draft.linkedinOrganizationUrn || i18nT("a_selectionner_51ca6f8a")}</dd><small>{linkedInGeoTargets.length ? i18nT("ads_count_linkedin_zones", { count: linkedInGeoTargets.length }) : i18nT("zone_linkedin_exacte_a_selectionner_23a7dd44")}</small></div>

            <div><dt>{i18nT("conformite_linkedin_62921c05")}</dt><dd>{linkedInComplianceReady ? i18nT("declarations_confirmees_dc6818f7") : i18nT("confirmation_requise_190264c7")}</dd><small>{i18nT("not_political_ciblage_non_discriminatoire_adcef6c0")}</small></div>
            {creationPath === "inrcy" && <label className={`${styles.check} ${styles.studioRequiredCheck}`} data-linkedin-launch-confirmation="true">
              <input type="checkbox" checked={confirmedSpend} disabled={busy !== null || !linkedInSelectionsReady} onChange={(event) => { setConfirmedSpend(event.target.checked); linkedInLaunchConsent.current = event.target.checked ? { key: JSON.stringify(draft), status: linkedInPreparedLaunchStatus } : null; }} />
              <span><strong>{i18nT("budget_et_diffusion_62fba6bb")}</strong>{linkedInPreparedLaunchStatus === "active"
                ? i18nT("j_autorise_la_diffusion_sur_le_d7271ee3", { value0: externalStatuses.linkedin.selectedAccountName || "LinkedIn Ads", value1: linkedInBudgetCap.toLocaleString(locale, { style: "currency", currency: "EUR" }), value2: linkedInDelivery.budget.type === "total" ? ` ${i18nT("au_total_c8d2e40b")}` : i18nT("ads_ui_892bcf22ec"), value3: linkedInDelivery.budget.startAt ? `, ${i18nT("a_partir_du_value_924108c5", { value0: new Date(linkedInDelivery.budget.startAt).toLocaleString(locale) })}` : `, ${i18nT("des_la_validation_de_linkedin_1f84bd29")}`, value4: new Date(linkedInDelivery.budget.endAt || draft.endDate + "T23:59:59Z").toLocaleString(locale) })
                : i18nT("je_confirme_la_creation_de_cette_8daf4c3e", { value0: externalStatuses.linkedin.selectedAccountName || "LinkedIn Ads" })}</span>
            </label>}
          </>}
        </dl>
        {draft.channelDraft?.channel === channelId && <details className={styles.studioNativeBrief}>
          <summary><strong>{i18nT("brief_value_prepare_par_inrcy_eb4df483", { value0: channelMeta.label })}</strong><span>{nativeBriefDetails(draft.channelDraft, i18nT).objective} · {nativeBriefDetails(draft.channelDraft, i18nT).format}</span></summary>
          <dl>
            <div><dt>{i18nT("audience_51d99345")}</dt><dd>{draft.channelDraft.audience.audienceBrief}</dd><small>{draft.channelDraft.audience.locationBriefs.join(" · ")}</small></div>
            <div><dt>{i18nT("message_propose_818f6ed0")}</dt><dd>{nativeBriefCopy(draft.channelDraft).message}</dd><small>{nativeBriefCopy(draft.channelDraft).headline}</small></div>
            <div><dt>{i18nT("direction_media_99ba6cc2")}</dt><dd>{nativeBriefCopy(draft.channelDraft).media}</dd></div>
            <div><dt>{i18nT("reglages_du_canal_b17da70e")}</dt><dd>{nativeBriefDetails(draft.channelDraft, i18nT).settings}</dd><small>{nativeBriefDetails(draft.channelDraft, i18nT).complement}</small></div>
          </dl>
          <p>{["linkedin", "google", "pinterest", "meta", "openai"].includes(channelId) ? i18nT("ce_brief_explique_la_proposition_de_e9814a98") : i18nT("ce_brief_prepare_votre_campagne_les_bccc7ae2")}</p>
        </details>}
        {channelId !== "openai" && (channelId === "linkedin" && !linkedInSelectionsReady ? <p className={styles.studioReadiness}><strong>{i18nT("une_verification_linkedin_manque_encore_64935cb1")}</strong>{adsUiText(i18nT, linkedInReadinessDetails)} {adsUiText(i18nT, linkedInScheduleIssue) && <button type="button" className={styles.secondaryButton} onClick={() => navigateToStep(budgetStep)}>{i18nT("corriger_le_calendrier_557ae741")}</button>} <button type="button" className={styles.secondaryButton} disabled={busy !== null || linkedInPreflightLoad === "loading"} onClick={() => void loadLinkedInResources(true)}>{i18nT("actualiser_les_verifications_ff31e71c")}</button> {linkedInAudiencePending > 0 && <button type="button" className={styles.secondaryButton} onClick={() => navigateToStep(targetingStep)}>{i18nT("verifier_les_propositions_audience_a59a19c5")}</button>} {(!draft.linkedinCampaignGroupId || !draft.linkedinOrganizationUrn) && <button type="button" className={styles.secondaryButton} onClick={() => navigateToStep(foundationsStep)}>{i18nT("voir_les_reglages_campagne_05f1a490")}</button>} {linkedInMissingGeoLocations.length > 0 && <button type="button" className={styles.secondaryButton} onClick={() => navigateToStep(geographyStep)}>{i18nT("voir_les_zones_a_completer_0281d9bd")}</button>} {" "}{i18nT("le_brouillon_reste_enregistrable_sans_lancer_39496b0d")}</p> : channelId === "linkedin" && !linkedInComplianceReady ? <p className={styles.studioReadiness}><strong>{i18nT("validez_les_deux_declarations_linkedin_ba71e643")}</strong>{i18nT("la_declaration_not_political_et_l_2dc13f90")}</p> : !isAdsDraftAccountChannel(channelId) ? <p className={styles.draftOnlyWarning}><strong>{tikTokPausedNotice?.title || i18nT("brouillon_uniquement_pour_le_moment_f472dc4c")}</strong>{tikTokPausedNotice?.message || i18nT("vous_pouvez_connecter_et_associer_votre_db322ead", { value0: channelMeta.label })}{draft.creationMode === "inrcy" && !draft.channelDraft && <span className={styles.studioNativeBriefMissing}>{i18nT("vos_modifications_ont_desynchronise_le_brief_fdaaada0")}{" "}{channelMeta.label}{i18nT("le_brouillon_simple_reste_disponible_02b840db")}{" "}<button type="button" disabled={busy !== null} onClick={() => { if (!window.confirm(i18nT("relancer_l_analyse_inrcy_la_nouvelle_4864946c"))) return; setStep(analysisStep); void generateCampaignPlan(); }}>{i18nT("recreer_le_brief_ia_f97576a2")}</button></span>}</p> : !liveFormatAvailable ? <p className={styles.studioReadiness}><strong>{i18nT("preparation_complete_publication_de_ce_choix_7e9319a9")}</strong>{channelId === "google" ? i18nT("ce_type_reste_un_brouillon_preparatoire_58d0b90c") : channelId === "meta" ? i18nT("inr_ads_prepare_ce_format_et_4b42b96d") : channelId === "linkedin" ? i18nT("ce_format_necessite_encore_une_integration_2b459bb2") : nativeSettings?.channel === "pinterest" && nativeSettings.targetingMode !== "automatic" ? i18nT("ce_ciblage_manuel_reste_dans_le_0dca7c3c") : i18nT("inr_ads_peut_lancer_une_epingle_211055af")}</p> : !livePublisherConversionReady ? <p className={styles.studioReadiness}><strong>{i18nT("conservez_ce_parcours_dans_votre_brouillon_72db8dfc")}</strong>{i18nT("le_connecteur_de_diffusion_disponible_aujourd_de8a2a56")}</p> : !metaLiveObjectiveSupported ? <p className={styles.studioReadiness}><strong>{i18nT("choisissez_l_objectif_trafic_vers_le_013299cc")}</strong>{i18nT("le_premier_connecteur_meta_ads_disponible_e5dbc5c8")}</p> : !metaLiveGoalSupported ? <p className={styles.studioReadiness}><strong>{i18nT("mesurez_une_visite_de_page_cle_86c3996a")}</strong>{i18nT("le_connecteur_trafic_meta_disponible_mesure_e20136f4")}</p> : !metaLivePlacementsSupported ? <p className={styles.studioReadiness}><strong>{i18nT("choisissez_un_placement_meta_compatible_f13e9ddb")}</strong>{i18nT("les_fils_facebook_instagram_stories_et_15c8b2f9")}</p> : !metaLiveCreativeSupported ? <p className={styles.studioReadiness}><strong>{i18nT("choisissez_le_format_image_845bf75c")}</strong>{i18nT("le_connecteur_trafic_meta_disponible_utilise_e513e758")}</p> : !metaLiveCtaSupported ? <p className={styles.studioReadiness}><strong>{i18nT("utilisez_l_appel_a_l_action_4e03e0d4")}</strong>{i18nT("le_premier_connecteur_trafic_meta_utilise_b1b49a22")}</p> : !livePublisherMediaReady ? <p className={styles.studioReadiness}><strong>{knownMetaMediaInvalid ? i18nT("corrigez_le_format_du_pack_media_db80427f") : i18nT("completez_le_media_avant_la_creation_6b5019c2")}</strong>{channelId === "meta" ? knownMetaMediaInvalid ? i18nT("au_moins_une_image_ne_respecte_a3b7f751") : i18nT("ajoutez_le_visuel_feed_4_5_2d890b26") : channelId === "linkedin" ? i18nT("ajoutez_le_media_demande_par_votre_e13ae14f") : i18nT("ajoutez_une_image_disponible_dans_la_ca18e0c5")}</p> : <>
          {adsUiText(i18nT, connectorConfigurationIssue) && <p className={styles.studioReadiness}><strong>{i18nT("reglage_a_adapter_avant_publication_b3082270")}</strong>{adsUiText(i18nT, connectorConfigurationIssue)}{nativeSettings?.channel === "pinterest" && nativeSettings.targetingMode === "automatic" && draft.keywords.length > 0 && <button type="button" className={styles.secondaryButton} onClick={clearPinterestManualSignals}>{i18nT("retirer_les_signaux_manuels_d7d6e282")}</button>}{openaiHiddenSettingsNeedReset && <button type="button" className={styles.secondaryButton} onClick={() => updateDraft({ conversionGoal: "website_visit", conversionLocation: "website", bidStrategy: "manual_review", trackingParameters: "", callToAction: "", keywords: [], negativeKeywords: [] })}>{i18nT("adapter_les_anciens_reglages_chatgpt_cd1392d4")}</button>}</p>}
        </>)}
        {channelId === "openai" && <p className={styles.studioReadiness}><strong>{channelPublishingEnabled && livePublisherMediaReady && liveFormatAvailable && livePublisherConversionReady && !adsUiText(i18nT, connectorConfigurationIssue) ? openaiLiveReady ? i18nT("prete_pour_votre_validation_finale_f539c702") : i18nT("creation_reelle_en_pause_disponible_f8c3e3b8") : i18nT("a_completer_pour_chatgpt_ads_5e5b012b")}</strong>{!livePublisherMediaReady ? i18nT("ajoutez_une_image_jpg_png_ou_141b171b") : ""}{adsUiText(i18nT, connectorConfigurationIssue) ? `${adsUiText(i18nT, connectorConfigurationIssue)} ` : ""}{!channelPublishingEnabled ? `${errorMessage(openaiReadinessMessage, "booster.ads_ui_20894d06ab")} ` : ""}{!liveFormatAvailable || !livePublisherConversionReady ? i18nT("ce_format_ou_cet_objectif_n_9d887858") : ""}{channelPublishingEnabled && livePublisherMediaReady && liveFormatAvailable && livePublisherConversionReady && !adsUiText(i18nT, connectorConfigurationIssue) ? openaiLiveReady ? i18nT("le_statut_active_est_prepare_pour_fc572302") : i18nT("la_carte_peut_etre_creee_sans_7d4e9f2b", { value0: errorMessage(openaiLiveReadinessMessage, "booster.ce_compte_n_est_pas_encore_c16c1342") }) : i18nT("le_brouillon_reste_enregistrable_5d982585")}{openaiHiddenSettingsNeedReset && <button type="button" className={styles.secondaryButton} onClick={() => updateDraft({ conversionGoal: "website_visit", conversionLocation: "website", bidStrategy: "manual_review", trackingParameters: "", callToAction: "", keywords: [], negativeKeywords: [] })}>{i18nT("adapter_les_anciens_reglages_chatgpt_cd1392d4")}</button>}</p>}
        <div className={styles.studioFinalActions} data-channel={channelId}>
          {channelId === "meta" && <label className={`${styles.check} ${styles.studioRequiredCheck}`}><input type="checkbox" checked={draft.noSpecialCategoryConfirmed} disabled={busy !== null} onChange={(event) => confirmReviewedDeclaration("noSpecialCategoryConfirmed", event.target.checked)} /><span><strong>{i18nT("obligatoire_avant_creation_sur_meta_d0a82eb2")}</strong>{i18nT("je_confirme_que_cette_annonce_ne_744786d8")}</span></label>}
          {channelId === "google" && <label className={`${styles.check} ${styles.studioRequiredCheck}`}><input type="checkbox" checked={draft.notEuPoliticalConfirmed} disabled={busy !== null} onChange={(event) => confirmReviewedDeclaration("notEuPoliticalConfirmed", event.target.checked)} /><span><strong>{i18nT("obligatoire_avant_creation_sur_google_ads_77fbd644")}</strong>{i18nT("je_certifie_que_cette_campagne_ne_c1dfb026")}</span></label>}
          {channelId === "linkedin" && <>
            <label className={`${styles.check} ${styles.studioRequiredCheck}`} data-linkedin-political-confirmation="true"><input type="checkbox" checked={draft.linkedinPoliticalIntentConfirmed === true} disabled={busy !== null} onChange={(event) => confirmReviewedDeclaration("linkedinPoliticalIntentConfirmed", event.target.checked)} /><span><strong>{i18nT("declaration_politique_linkedin_obligatoire_3633712d")}</strong>{i18nT("je_confirme_qu_il_ne_s_fe8b37de")}{" "}<b>{i18nT("ads_non_political_advertising")}</b>.</span></label>
            <label className={`${styles.check} ${styles.studioRequiredCheck}`} data-linkedin-targeting-notice="true"><input type="checkbox" checked={draft.linkedinTargetingNoticeAcknowledged === true} disabled={busy !== null} onChange={(event) => confirmReviewedDeclaration("linkedinTargetingNoticeAcknowledged", event.target.checked)} /><span><strong>{i18nT("avis_linkedin_contre_la_discrimination_7f7dcef8")}</strong>{i18nT("je_reconnais_que_les_outils_publicitaires_dae5d2d4")}{" "}<a href="https://www.linkedin.com/legal/ads-policy" target="_blank" rel="noreferrer">{i18nT("consulter_les_regles_linkedin_d4fb52c4")}</a></span></label>
          </>}
          <div className={styles.studioFinalActionButtons}>
            {preparedOnlyChannel && <button type="button" className={styles.primaryButton} data-prepared-final-validation="true" data-native-paused-ready={preparedNativeReady || undefined} disabled={busy !== null || preparedReviewIssues.length > 0 || preparedBudgetApprovalKey !== preparedDraftKey || preparedContentApprovalKey !== preparedDraftKey || destinationReview.required && !destinationReview.confirmed} onClick={() => void (preparedNativeReady ? openPreparedLaunchDialog() : validatePreparedDraft())}>{busy === "publish" ? i18nT("creation_en_pause_4c43f18a") : busy === "save" ? i18nT("enregistrement_e7d5f232") : channelId === "tiktok" ? preparedNativeReady ? i18nT("creer_en_pause_6bdad8cf") : i18nT("enregistrer_le_brouillon_6a319595") : preparedNativeReady ? i18nT("ads_ui_90d23b1ef9") : i18nT("valider_le_brouillon_d79e5772")} <span aria-hidden="true">✓</span></button>}
            <button type="button" className={styles.secondaryButton} disabled={busy !== null || (!dirty && Boolean(savedId))} onClick={() => void saveDraft()}>{busy === "save" ? i18nT("enregistrement_e7d5f232") : !dirty && savedId ? i18nT("brouillon_enregistre_5b3c3ae3") : i18nT("enregistrer_en_brouillon_d0c5a1eb")}</button>
            {!preparedOnlyChannel && <div className={styles.studioLaunchGuard} data-blocked={launchBlocked || undefined} data-tooltip={launchBlocked ? adsUiText(i18nT, launchBlockingMessage) : undefined} title={launchBlocked ? adsUiText(i18nT, launchBlockingMessage) : undefined} tabIndex={launchBlocked ? 0 : undefined} aria-label={launchBlocked ? adsUiText(i18nT, launchBlockingMessage) : undefined}>
              <button type="button" className={styles.primaryButton} disabled={busy !== null || launchBlocked || (["linkedin", "google", "pinterest", "meta", "openai"].includes(channelId) && creationPath === "inrcy" && !confirmedSpend)} onClick={() => void openLaunchDialog(["linkedin", "google", "pinterest", "meta", "openai"].includes(channelId) && creationPath === "inrcy")}>{busy === "demo" ? demoDialog || publicationPhase === "saving" || publicationPhase === "sending" ? i18nT("creation_en_cours_1488d01b") : i18nT("verification_du_compte_ac363391") : ["linkedin", "google", "pinterest", "meta", "openai"].includes(channelId) && creationPath === "inrcy" ? i18nT("ads_ui_90d23b1ef9") : i18nT("lancer_la_campagne_7b257402")} <span aria-hidden="true">↗</span></button>
              {launchBlocked && <span className={styles.studioLaunchWarning} aria-hidden="true">⚠</span>}
            </div>}
          </div>
        </div>
      </section>
      {creationPath !== "choice" && <div className={styles.wizardNavigation}>
        <button type="button" className={styles.back} disabled={step === 0 || busy === "plan" || busy === "demo"} onClick={() => { if (creationPath === "inrcy" && step === analysisStep) { stopPlanProgress(); setCreationPath("choice"); setAnalysisSetupOpen(true); resetStepProgress(0, inrcyStepKeys); return; } navigateToStep(step - 1); }}>{i18nT("precedent_3ec988c1")}</button>
        <span>{step + 1} / {stepNames.length}</span>
        {step < lastStep ? <div className={styles.wizardNextGroup}>
          {step === mediaStep && channelId === "meta" && !livePublisherMediaReady && <div className={styles.wizardMediaRequirement} role="status">
            <strong>{i18nT("pack_media_obligatoire_5d8618e8")}</strong>
            <span>{knownMetaMediaInvalid ? i18nT("remplacez_le_visuel_non_conforme_avant_cd96611f") : i18nT("ajoutez_chaque_format_demande_avant_le_7718c8fe")}</span>
          </div>}
          {step === deliveryStep && !["linkedin", "google", "pinterest", "meta", "openai", "x", "tiktok"].includes(channelId) && destinationReview.required && <label className={styles.wizardRequiredCheck}>
            <input type="checkbox" checked={destinationReview.confirmed} disabled={!destinationReview.valid} onChange={(event) => setConfirmedDestinationUrl(event.target.checked ? draft.destinationUrl.trim() : "")} />
            <span><strong>{i18nT("a_confirmer_avant_lancement_1c059f25")}</strong>{i18nT("je_confirme_ce_lien_a5d51935")}</span>
          </label>}
          <button type="button" className={`${styles.headerCta} ${analysisProposalReady ? styles.studioProposalReadyCta : ""}`} disabled={busy === "plan" || busy === "demo" || (creationPath === "inrcy" && step === analysisStep && planProgress !== 100)} onClick={() => navigateToStep(step + 1)}>{creationPath === "inrcy" && step === analysisStep ? planProgress === 100 ? channelId === "pinterest" ? i18nT("voir_ma_proposition_pinterest_7f5d9f02") : i18nT("controler_ma_proposition_e181d720") : i18nT("proposition_en_cours_3dcdee21") : i18nT("suivant_ea96c11e")}</button>
        </div> : <button type="button" className={styles.back} onClick={() => void confirmCampaignExit()}>{i18nT("revenir_au_cockpit_167c8cad")}</button>}
      </div>}
      </div>
      </SettingsDrawer>

    {demoDialog && <AdsCampaignDemoDialog
      mode={demoDialog.mode}
      details={demoDialog.details}
      busy={busy === "demo" || busy === "publish"}
      publicationPhase={publicationPhase}
      launchStatus={demoDialog.launchStatus}
      activeEnabled={demoDialog.channelId === "linkedin"
        ? Boolean(linkedInPublishingEnabled && linkedInPreflight?.account?.canServeCampaigns
          && selectedLinkedInCampaignGroup?.status === "ACTIVE"
          && !linkedInAdsLaunchBlockers(linkedInPreflight.blockers, "ACTIVE").length)
        : demoDialog.channelId === "x" || demoDialog.channelId === "tiktok" ? false : demoDialog.channelId === "openai" ? openaiLiveReady : demoDialog.channelId === "google" ? googlePublishingEnabled : demoDialog.channelId === "pinterest" ? pinterestPublishingEnabled : demoDialog.channelId === "meta" && metaPublishingEnabled}
      pausedEnabled={demoDialog.channelId === "linkedin"
        ? Boolean(linkedInPublishingEnabled && linkedInPreflight?.account?.canManageCampaigns
          && !linkedInAdsLaunchBlockers(linkedInPreflight.blockers, "PAUSED").length)
        : demoDialog.channelId === "x" || demoDialog.channelId === "tiktok" ? Boolean(preparedNativeReady) : demoDialog.channelId === "openai" ? openaiAccountReady : demoDialog.channelId === "google" ? googlePublishingEnabled : demoDialog.channelId === "pinterest" ? pinterestPublishingEnabled : demoDialog.channelId === "meta" && metaPublishingEnabled}
      activeDisabledReason={demoDialog.channelId === "openai"
        ? errorMessage(openaiLiveReadinessMessage, "booster.ads_ui_db1c77acbf")
        : demoDialog.channelId === "x" || demoDialog.channelId === "tiktok" ? i18nT("ads_ui_7595c54935") : undefined}
      declarationLabel={demoDialog.channelId === "openai" && demoDialog.launchStatus === "active"
        ? i18nT("je_confirme_que_la_facturation_est_cfec120c", { value0: demoDialog.details.dailyBudgetEuros.toLocaleString(locale, { style: "currency", currency: "EUR" }) })
        : demoDialog.launchStatus === "active"
        ? i18nT("je_valide_le_compte_la_campagne_40a5b8be", { value0: demoDialog.details.channelLabel })
        : i18nT("je_valide_le_compte_et_la_bbe21d43", { value0: demoDialog.details.channelLabel })}
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
    {creating && autoMediaPlan && (
      <AdsCampaignAutoMediaGenerator
        key={`${autoMediaPlan.campaignType}-${autoMediaPlan.name}-${autoMediaPlan.mediaBrief}`}
        provider={channelId}
        plan={autoMediaPlan}
        onProgress={(progress) => {
          setAutoMediaState("generating");
          setAutoMediaMessage(i18nT("inr_studio_cree_le_media_de_eb950da9", { value0: Math.min(99, Math.max(4, Math.round(progress))) }));
          planProgressTarget.current = Math.max(planProgressTarget.current, Math.min(99, 90 + Math.round(progress / 10)));
        }}
        onComplete={(result) => {
          if (!result.item.signed_url) {
            setAutoMediaState("error");
            setAutoMediaMessage(i18nT("la_campagne_est_prete_mais_le_e67e7f00"));
          } else {
            applyCampaignMedia(result.item);
            setAutoMediaState("ready");
            setAutoMediaMessage(i18nT("inr_studio_a_genere_et_associe_440cc7e0"));
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
            setAutoMediaMessage(i18nT("la_campagne_est_prete_mais_le_796e58f4", { value0: generationError ? ` : ${generationError}` : ".", value1: feedImageUrl || storyReelImageUrl ? `${i18nT("ads_existing_campaign_image_note")} ` : "" }));
          } else {
            setAutoMediaState("ready");
            setAutoMediaMessage(i18nT("inr_studio_a_genere_le_pack_514d2165", { value0: needsFeed && needsStoryReel ? ` : ${i18nT("ads_format_pair", { first: "Feed 4:5", second: "Story/Reel 9:16" })}` : needsFeed ? " Feed 4:5" : " Story/Reel 9:16" }));
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
          setAutoMediaMessage(i18nT("la_campagne_est_preparee_mais_inr_506b0a2d", { value0: message }));
          planProgressTarget.current = 100;
          setAutoMediaPlan(null);
          setBusy(null);
        }}
      />
    )}
    <MediaLibraryPickerModal
      open={campaignMediaLibraryOpen}
      title={channelId === "meta"
        ? i18nT("choisir_l_image_value_9a40f114", { value0: metaMediaSlot === "story_reel" ? "Story/Reel 9:16" : "Feed 4:5" })
        : i18nT("ajouter_un_media_a_la_campagne_ffdce8ce")}
      subtitle={channelId === "meta"
        ? i18nT("choisissez_un_visuel_publicitaire_adapte_au_b11d9fb9")
        : channelId === "openai"
          ? i18nT("choisissez_un_jpg_png_ou_webp_afdb9933")
        : i18nT("choisissez_une_image_ou_une_video_d902e543")}
      accept={googleSearchMedia || channelId === "meta" || channelId === "openai" ? "image" : "all"}
      maxImageBytes={channelId === "openai" ? CHATGPT_ADS_MAX_IMAGE_BYTES : undefined}
      multiple={false}
      maxSelection={1}
      confirmLabel={i18nT("ajouter_a_la_campagne_c14b0cf6")}
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
      handoffOriginLabel={i18nT("inr_ads_85c07243")}
      onClose={() => setCampaignMediaStudioOpen(false)}
      onAccepted={handleGeneratedCampaignMedia}
    />
  </main>;
}
