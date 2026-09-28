"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import SettingsDrawer from "@/app/dashboard/SettingsDrawer";
import MediaGeneratorModal from "@/app/dashboard/_components/MediaGeneratorModal";
import MediaSubjectVoiceButton from "@/app/dashboard/_components/MediaSubjectVoiceButton";
import MediaLibraryPickerModal, {
  type MediaLibraryPickerItem,
} from "@/app/dashboard/_components/MediaLibraryPickerModal";
import type { MediaGenerationResult } from "@/app/dashboard/_hooks/useMediaGeneration";
import { uploadFileToMediaLibrary } from "@/lib/mediaLibraryUploadClient";
import {
  defaultAdsCampaignType,
  isAdsProvider,
  type AdsAccount,
  type AdsCampaignInput,
  type AdsChannelId,
  type AdsCreationMode,
  type AdsProvider,
} from "@/lib/adsValidation";
import { ADS_PAUSED_DEMO_CONFIRMATION, unsupportedAdsConnectorReason } from "@/lib/adsPublishMode";
import { adsMediaStrategyAfterAttachment, GOOGLE_SEARCH_IMAGE_REQUIREMENTS, googleSearchImageSubjectPrompt } from "@/lib/adsCampaignMediaPolicy";
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
import type { ConnectionDisplayStatus } from "@/lib/connectionVersions";
import AdsConnectionSettings from "./AdsConnectionSettings";
import AdsCampaignAutoMediaGenerator from "./AdsCampaignAutoMediaGenerator";
import AdsCampaignAnalysisChoice, { type AdsCampaignAnalysisMode } from "./AdsCampaignAnalysisChoice";
import AdsCampaignTracking, { type StoredAdsCampaign } from "./AdsCampaignTracking";
import styles from "./ads.module.css";

type StoredCampaign = StoredAdsCampaign;

type AdsConfigAction = "disconnect" | "save-account" | "clear-account" | "save-page" | "clear-page" | null;
type CampaignCreationPath = "choice" | AdsCreationMode;
type CampaignBusyAction = "save" | "plan" | "publish" | "demo" | null;
type CampaignMediaUploadKind = "image" | "video";

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
  suggestedAccountId?: string;
  selectedPageId?: string;
  error?: string;
};

const EXTERNAL_CHANNELS = ["linkedin", "tiktok", "pinterest", "x"] as const;
type ExternalChannelId = (typeof EXTERNAL_CHANNELS)[number];
type ExternalAdsAccount = { id: string; name: string; currency?: string | null; status?: string; eligibleToAssociate?: boolean };
type ExternalConnectorStatus = {
  load: "idle" | "loading" | "ready" | "error";
  configured: boolean;
  connected: boolean;
  status: string;
  selectedAccountId: string;
  selectedAccountName: string;
  error: string;
};

function isExternalChannel(value: unknown): value is ExternalChannelId {
  return typeof value === "string" && EXTERNAL_CHANNELS.some((channel) => channel === value);
}

function emptyExternalStatus(): ExternalConnectorStatus {
  return { load: "idle", configured: true, connected: false, status: "disconnected", selectedAccountId: "", selectedAccountName: "", error: "" };
}

function externalStatusDisplay(status: ExternalConnectorStatus): { label: string; tone: string } {
  if (status.load === "idle" || status.load === "loading") return { label: "Vérification…", tone: "loading" };
  if (status.load === "error") return { label: "État indisponible", tone: "unavailable" };
  if (!status.configured) return { label: "Connexion indisponible", tone: "unavailable" };
  if (status.status === "needs_update" || status.status === "needs_reconnect") return { label: "Connexion à actualiser", tone: "select-account" };
  if (status.connected && status.selectedAccountId) return { label: "Compte associé", tone: "connected" };
  if (status.connected) return { label: "Compte à associer", tone: "select-account" };
  return { label: "À connecter", tone: "disconnected" };
}

const EXTERNAL_DISCONNECT_CHANNELS: readonly ExternalChannelId[] = ["linkedin", "pinterest", "tiktok", "x"];

// Every channel can be prepared here. Live publication remains limited to Meta and Google.
const CHANNEL_CATALOG: { id: AdsChannelId; label: string; format: string; logo: string; provider?: AdsProvider }[] = [
  { id: "meta", label: "Meta Ads", format: "Facebook · Instagram", logo: "/ads-logos/meta.svg", provider: "meta" },
  { id: "google", label: "Google Ads", format: "Recherche · annonces textuelles", logo: "/ads-logos/google-ads.svg", provider: "google" },
  { id: "linkedin", label: "LinkedIn Ads", format: "Votre audience professionnelle", logo: "/ads-logos/linkedin.svg" },
  { id: "tiktok", label: "TikTok Ads", format: "De nouvelles communautés", logo: "/ads-logos/tiktok.svg" },
  { id: "pinterest", label: "Pinterest Ads", format: "Inspirez vos futurs clients", logo: "/ads-logos/pinterest.svg" },
  { id: "x", label: "X Ads", format: "Rejoignez les conversations", logo: "/ads-logos/x.svg" },
];

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
    { value: "meta_leads", label: "Prospects", detail: "Demandes de devis et formulaires" },
    { value: "meta_sales", label: "Ventes", detail: "Conversions et achats" },
    { value: "meta_traffic", label: "Trafic", detail: "Visites qualifiées vers votre site" },
    { value: "meta_awareness", label: "Notoriété", detail: "Faire connaître votre entreprise" },
  ],
  linkedin: [{ value: "generic", label: "Campagne LinkedIn", detail: "Préparation complète" }],
  tiktok: [{ value: "generic", label: "Campagne TikTok", detail: "Préparation complète" }],
  pinterest: [{ value: "generic", label: "Campagne Pinterest", detail: "Préparation complète" }],
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

const META_PLACEMENT_OPTIONS: { value: AdsCampaignInput["metaPlacements"][number]; label: string }[] = [
  { value: "facebook_feed", label: "Fil Facebook" },
  { value: "instagram_feed", label: "Fil Instagram" },
  { value: "stories", label: "Stories" },
  { value: "reels", label: "Reels" },
  { value: "messenger", label: "Messenger" },
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
    objective: provider === "meta" || isExternalChannel(provider) ? "website_traffic" : "leads",
    conversionGoal: provider === "meta" || isExternalChannel(provider) ? "website_visit" : "quote_request",
    conversionLocation: "website",
    bidStrategy: "maximize_conversions",
    adAccountId: "",
    accountCurrency: "EUR",
    name: "",
    offer: "",
    dailyBudgetEuros: 10,
    endDate: defaultEndDate(),
    destinationUrl: "",
    urlExpansion: true,
    urlExclusions: [],
    // The live Search connector uses France only when no precise territory is
    // supplied. Showing that default in the studio prevents hidden targeting.
    targetLocations: provider === "google" ? ["France"] : [],
    targetAudiences: [],
    languages: ["fr"],
    googleSearchPartners: false,
    googleDisplayExpansion: false,
    metaAudienceExpansion: true,
    metaPlacements: provider === "meta" ? ["facebook_feed", "instagram_feed"] : [],
    trackingParameters: "",
    primaryText: "",
    imageUrl: "",
    creativeUrl: "",
    creativeType: provider === "tiktok" ? "video" : "image",
    mediaStrategy: provider === "google" || provider === "x" ? "search_text" : provider === "tiktok" ? "video" : "image",
    mediaBrief: "",
    callToAction: provider === "meta" ? "En savoir plus" : "Demander un devis",
    pageId: "",
    headlines: [],
    descriptions: [],
    keywords: [],
    negativeKeywords: [],
    noSpecialCategoryConfirmed: false,
    notEuPoliticalConfirmed: false,
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
  if (settings.format === "text" || settings.format === "TEXT_AD") return "search_text";
  return settings.format === "video" || settings.format === "SINGLE_VIDEO" ? "video" : "image";
}

function nativeBriefTerm(value: string) {
  return NATIVE_BRIEF_TERMS[value] || value.replaceAll("_", " ").toLowerCase();
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
        settings: brief.conversionEvent ? `Action à mesurer : ${nativeBriefTerm(brief.conversionEvent)}` : "Découverte visuelle",
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

function editableList(items: string[]) { return items.join("\n"); }
function parseEditableList(text: string[]) { return text.map((value) => value.trim()).filter(Boolean); }

type TagFieldProps = {
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

/** Reuses iNrCy's established microphone/transcription control in the Ads studio. */
function VoiceTextarea({ value, onChange, placeholder, purpose, contextLabel, rows = 3, maxLength }: VoiceTextareaProps) {
  const [voiceBusy, setVoiceBusy] = useState(false);

  return (
    <div className={styles.voiceTextarea}>
      <textarea
        rows={rows}
        value={value}
        maxLength={maxLength}
        readOnly={voiceBusy}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
      <MediaSubjectVoiceButton
        purpose={purpose}
        value={value}
        maxLength={maxLength}
        mergeMode="paragraph"
        contextLabel={contextLabel}
        onBusyChange={setVoiceBusy}
        onChange={onChange}
      />
    </div>
  );
}

/** A compact, keyboard-friendly editor for campaign choices such as territories. */
function TagField({ label, helper, values, onChange, placeholder, note, wide = false, maxItems, maxItemLength }: TagFieldProps) {
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
    <div className={`${styles.field} ${styles.tagField}${wide ? ` ${styles.studioWide}` : ""}`}>
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

function GoogleAdCopyField({ label, singular, values, onChange, minItems, maxItems, maxLength }: GoogleAdCopyFieldProps) {
  const rows = Array.from({ length: Math.max(minItems, values.length) }, (_, index) => values[index] ?? "");

  return (
    <fieldset className={`${styles.field} ${styles.googleAdCopyField}`}>
      <legend>{label}</legend>
      <small>{minItems} minimum · {maxItems} maximum · {maxLength} caractères par {singular.toLowerCase()}</small>
      <div className={styles.googleAdCopyRows}>
        {rows.map((value, index) => (
          <div className={styles.googleAdCopyRow} key={index}>
            <label htmlFor={`${singular}-${index}`}>{singular} {index + 1}</label>
            <input
              id={`${singular}-${index}`}
              type="text"
              value={value}
              maxLength={maxLength}
              placeholder={`${singular} ${index + 1}`}
              onChange={(event) => onChange(rows.map((entry, rowIndex) => rowIndex === index ? event.target.value : entry))}
            />
            <span aria-label={`${value.length} caractères sur ${maxLength}`}>{value.length}/{maxLength}</span>
            {rows.length > minItems && <button type="button" aria-label={`Retirer ${singular.toLowerCase()} ${index + 1}`} title={`Retirer ${singular.toLowerCase()} ${index + 1}`} onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}>×</button>}
          </div>
        ))}
      </div>
      {rows.length < maxItems && <button type="button" className={styles.googleAdCopyAdd} onClick={() => onChange([...rows, ""])}>+ Ajouter {singular === "Titre" ? "un titre" : "une description"}</button>}
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

function campaignPromise(channel: AdsChannelId) {
  if (channel === "google") {
    return "Quand une personne recherche précisément votre service, une campagne Google Ads bien pensée vous place au bon moment, devant la bonne intention.";
  }
  if (channel === "meta") {
    return "Une campagne Meta Ads bien pensée transforme votre expertise en une rencontre utile avec les personnes qui peuvent devenir vos clients.";
  }
  return "Une campagne claire donne à votre expertise la place qu’elle mérite auprès des personnes prêtes à vous découvrir.";
}

export default function AdsClient({ initialChannel, initialConnection, initialReason, livePublishingEnabled, demoPausedPublishingEnabled }: {
  initialChannel: AdsProvider;
  initialConnection: "connected" | "error" | null;
  initialReason: string;
  livePublishingEnabled: boolean;
  demoPausedPublishingEnabled: boolean;
}) {
  const [provider, setProvider] = useState<AdsProvider>(initialChannel);
  const [channelId, setChannelId] = useState<AdsChannelId>(initialChannel);
  const [channelIndex, setChannelIndex] = useState(() => CHANNEL_CATALOG.findIndex((channel) => channel.id === initialChannel));
  const channelPointerStart = useRef<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<AdsCampaignInput>(() => newDraft(initialChannel));
  const [savedId, setSavedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(true);
  const [accounts, setAccounts] = useState<AdsAccount[]>([]);
  const [pages, setPages] = useState<{ id: string; name: string; instagramUserId?: string }[]>([]);
  const [connected, setConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionDisplayStatus>("disconnected");
  const [connectionAccount, setConnectionAccount] = useState<{ displayName?: string; email?: string; id?: string } | undefined>();
  const [configuredAccountId, setConfiguredAccountId] = useState("");
  const [configuredAccountLabel, setConfiguredAccountLabel] = useState("");
  const [configuredPageId, setConfiguredPageId] = useState("");
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [accountsRefreshKey, setAccountsRefreshKey] = useState(0);
  const [configAction, setConfigAction] = useState<AdsConfigAction>(null);
  const [externalStatuses, setExternalStatuses] = useState<Record<ExternalChannelId, ExternalConnectorStatus>>({
    linkedin: emptyExternalStatus(), tiktok: emptyExternalStatus(),
    pinterest: emptyExternalStatus(), x: emptyExternalStatus(),
  });
  const [externalConfiguring, setExternalConfiguring] = useState(false);
  const [externalAccounts, setExternalAccounts] = useState<ExternalAdsAccount[]>([]);
  const [externalAccountChoice, setExternalAccountChoice] = useState("");
  const [externalAccountsLoading, setExternalAccountsLoading] = useState(false);
  const [externalAccountsLoadFailed, setExternalAccountsLoadFailed] = useState(false);
  const [externalAction, setExternalAction] = useState<"associate" | "disconnect" | null>(null);
  const [externalError, setExternalError] = useState("");
  const externalAccountsRequest = useRef(0);
  const externalStatusRequests = useRef<Record<ExternalChannelId, number>>({ linkedin: 0, pinterest: 0, tiktok: 0, x: 0 });
  const [campaigns, setCampaigns] = useState<StoredCampaign[]>([]);
  const [campaignTotal, setCampaignTotal] = useState(0);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [campaignsLoadingMore, setCampaignsLoadingMore] = useState(false);
  const [campaignNextOffset, setCampaignNextOffset] = useState<number | null>(null);
  const [campaignsLoadError, setCampaignsLoadError] = useState("");
  const campaignRequestGeneration = useRef(0);
  const campaignPageLoading = useRef(false);
  const [tracking, setTracking] = useState(false);
  const [busy, setBusy] = useState<CampaignBusyAction>(null);
  const demoSubmissionRef = useRef(false);
  const [confirmedSpend, setConfirmedSpend] = useState(false);
  const [configuring, setConfiguring] = useState(initialConnection !== null);
  const [creating, setCreating] = useState(false);
  const [step, setStep] = useState(0);
  const [creationPath, setCreationPath] = useState<CampaignCreationPath>("choice");
  const [analysisSetupOpen, setAnalysisSetupOpen] = useState(false);
  const [analysisMode, setAnalysisMode] = useState<AdsCampaignAnalysisMode>("free");
  const [guidedAnalysisObjective, setGuidedAnalysisObjective] = useState("");
  const [planProgress, setPlanProgress] = useState(0);
  const [planRationale, setPlanRationale] = useState("");
  const [planSources, setPlanSources] = useState<string[]>([]);
  const [planError, setPlanError] = useState("");
  const [planRequestId, setPlanRequestId] = useState("");
  const [autoMediaPlan, setAutoMediaPlan] = useState<AdsCampaignPlan | null>(null);
  const [autoMediaState, setAutoMediaState] = useState<"idle" | "generating" | "ready" | "skipped" | "error">("idle");
  const [autoMediaMessage, setAutoMediaMessage] = useState("");
  const [campaignMediaStudioOpen, setCampaignMediaStudioOpen] = useState(false);
  const [campaignMediaLibraryOpen, setCampaignMediaLibraryOpen] = useState(false);
  const [campaignMediaUploadBusy, setCampaignMediaUploadBusy] = useState(false);
  const [campaignMediaUploadError, setCampaignMediaUploadError] = useState("");
  const planProgressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const campaignImageInputRef = useRef<HTMLInputElement | null>(null);
  const campaignVideoInputRef = useRef<HTMLInputElement | null>(null);
  const [compactScreen, setCompactScreen] = useState(false);
  const [shortScreen, setShortScreen] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const studioWorkspaceRef = useRef<HTMLDivElement | null>(null);
  const keywordStepName = channelId === "google" ? "Mots-clés" : "Signaux";
  const manualStepNames = ["Votre projet", "Fondations", "Ciblage", keywordStepName, "Créations", "Médias", "Diffusion", "Budget", "Validation"];
  const inrcyStepNames = ["Votre projet", "Analyse iNrCy", "Fondations", "Ciblage", keywordStepName, "Créations", "Médias", "Diffusion", "Budget", "Validation"];
  const stepNames = creationPath === "inrcy" ? inrcyStepNames : manualStepNames;
  const displayedStepNames = creationPath === "choice" && analysisSetupOpen ? inrcyStepNames : stepNames;
  const lastStep = stepNames.length - 1;
  const foundationsStep = creationPath === "inrcy" ? 2 : 1;
  const targetingStep = foundationsStep + 1;
  const keywordsStep = targetingStep + 1;
  const creativeStep = keywordsStep + 1;
  const mediaStep = creativeStep + 1;
  const deliveryStep = mediaStep + 1;
  const budgetStep = deliveryStep + 1;
  const validationStep = budgetStep + 1;
  const analysisStep = creationPath === "inrcy" ? 1 : -1;

  function stopPlanProgress() {
    if (planProgressTimer.current) {
      clearInterval(planProgressTimer.current);
      planProgressTimer.current = null;
    }
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

  const selectedAccount = isAdsProvider(channelId) ? accounts.find((account) => account.id === draft.adAccountId) : undefined;
  const selectedPage = channelId === "meta" ? pages.find((page) => page.id === draft.pageId) : undefined;
  const configuredAdvertiserAccount = isAdsProvider(channelId)
    ? accounts.find((account) => account.id === configuredAccountId && account.currency === "EUR" && account.provider === channelId)
    : undefined;
  const associatedAccountName = configuredAdvertiserAccount?.name || configuredAccountLabel || (configuredAccountId ? `Compte ${configuredAccountId}` : "");
  const configuredAdvertiserAccountUrl = configuredAdvertiserAccount && isAdsProvider(channelId)
    ? getAdsAdvertiserAccountUrl(channelId, configuredAdvertiserAccount.id)
    : null;
  const channelAccountReady = Boolean(
    connected
    && selectedAccount?.currency === "EUR"
    && selectedAccount.id === configuredAccountId
    && (channelId !== "meta" || (selectedPage?.instagramUserId && selectedPage.id === configuredPageId)),
  );
  const channelMeta = CHANNEL_CATALOG.find((channel) => channel.id === channelId) || CHANNEL_CATALOG[0];
  const activeExternalStatus = isExternalChannel(channelId) ? externalStatuses[channelId] : null;
  const reviewAccountReady = isAdsProvider(channelId)
    ? Boolean(connected && configuredAdvertiserAccount && (channelId !== "meta" || configuredPageId))
    : Boolean(activeExternalStatus?.connected && activeExternalStatus.selectedAccountId);

  const refreshExternalStatus = useCallback(async (channel: ExternalChannelId) => {
    const requestId = ++externalStatusRequests.current[channel];
    setExternalStatuses((current) => ({ ...current, [channel]: { ...current[channel], load: "loading", error: "" } }));
    try {
      const data = await readJson(await fetch(`/api/ads/${channel}/status`, { cache: "no-store" }));
      if (requestId !== externalStatusRequests.current[channel]) return;
      const status = typeof data.status === "string" ? data.status : "disconnected";
      const selectedAccountId = typeof data.selectedAccountId === "string" ? data.selectedAccountId : "";
      const selectedAccountName = typeof data.selectedAccountName === "string" ? data.selectedAccountName
        : typeof data.selectedAccountLabel === "string" ? data.selectedAccountLabel : "";
      setExternalStatuses((current) => ({
        ...current,
        [channel]: {
          load: "ready",
          configured: data.configured !== false && status !== "not_configured" && status !== "configuration_missing",
          connected: data.connected === true,
          status,
          selectedAccountId,
          selectedAccountName,
          error: "",
        },
      }));
    } catch (error) {
      if (requestId !== externalStatusRequests.current[channel]) return;
      setExternalStatuses((current) => ({
        ...current,
        [channel]: { ...current[channel], load: "error", error: error instanceof Error ? error.message : "État indisponible." },
      }));
    }
  }, []);

  useEffect(() => {
    if (isExternalChannel(channelId) && externalStatuses[channelId].load === "idle") void refreshExternalStatus(channelId);
  }, [channelId, externalStatuses, refreshExternalStatus]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const callbackChannel = params.get("channel");
    if (!isExternalChannel(callbackChannel)) return;
    const index = CHANNEL_CATALOG.findIndex((channel) => channel.id === callbackChannel);
    setChannelIndex(index);
    setChannelId(callbackChannel);
    setDraft(newDraft(callbackChannel));
    setConfiguring(false);
    setNotice("");
    if (params.has("connection")) {
      setExternalConfiguring(true);
      if (params.get("connection") === "error") {
        setExternalError(params.get("reason") || "La connexion n’a pas abouti. Réessayez.");
      }
      params.delete("connection");
      params.delete("reason");
      window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}`);
    }
  }, []);

  const loadExternalAccounts = useCallback(async (channel: ExternalChannelId, persistedAccountId: string) => {
    const requestId = ++externalAccountsRequest.current;
    setExternalAccountsLoading(true);
    setExternalAccountsLoadFailed(false);
    try {
      const data = await readJson(await fetch(`/api/ads/${channel}/accounts`, { cache: "no-store" }));
      if (requestId !== externalAccountsRequest.current) return;
      const nextAccounts = Array.isArray(data.accounts)
        ? data.accounts.filter((account): account is ExternalAdsAccount => account && typeof account === "object" && typeof account.id === "string" && typeof account.name === "string")
        : [];
      setExternalAccounts(nextAccounts);
      setExternalAccountChoice(typeof data.selectedAccountId === "string" ? data.selectedAccountId : persistedAccountId);
      setExternalError("");
    } catch (error) {
      if (requestId === externalAccountsRequest.current) {
        setExternalAccountsLoadFailed(true);
        setExternalError(error instanceof Error ? error.message : "Comptes indisponibles.");
      }
    } finally {
      if (requestId === externalAccountsRequest.current) setExternalAccountsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!externalConfiguring || !isExternalChannel(channelId) || !externalStatuses[channelId].connected) return;
    void loadExternalAccounts(channelId, externalStatuses[channelId].selectedAccountId);
    return () => { externalAccountsRequest.current += 1; };
  }, [externalConfiguring, channelId, externalStatuses.linkedin.connected, externalStatuses.linkedin.selectedAccountId, externalStatuses.pinterest.connected, externalStatuses.pinterest.selectedAccountId, externalStatuses.tiktok.connected, externalStatuses.tiktok.selectedAccountId, externalStatuses.x.connected, externalStatuses.x.selectedAccountId, loadExternalAccounts]);

  function openExternalConfiguration(channel: ExternalChannelId) {
    setConfiguring(false);
    setExternalError("");
    setExternalAccounts([]);
    setExternalAccountsLoadFailed(false);
    setExternalAccountChoice(externalStatuses[channel].selectedAccountId);
    setExternalAccountsLoading(externalStatuses[channel].connected);
    setExternalConfiguring(true);
  }

  async function associateExternalAccount() {
    if (!isExternalChannel(channelId) || !externalAccountChoice || externalAction) return;
    setExternalAction("associate");
    setExternalError("");
    try {
      await readJson(await fetch(`/api/ads/${channelId}/accounts`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: externalAccountChoice }),
      }));
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
    if (isAdsProvider(next)) {
      changeProvider(next);
      return;
    }
    setChannelId(next);
    setDraft(newDraft(next));
    setConnected(false);
    setConnectionStatus("disconnected");
    setConnectionAccount(undefined);
    setConfiguredAccountId("");
    setConfiguredPageId("");
    setAccounts([]);
    setPages([]);
    setSavedId(null);
    setDirty(true);
    setConfirmedSpend(false);
    setNotice("");
  }

  const loadCampaigns = useCallback(async () => {
    const generation = ++campaignRequestGeneration.current;
    setCampaignsLoading(true);
    setCampaignsLoadError("");
    try {
      const data = await readJson(await fetch("/api/ads/campaigns", { cache: "no-store" }));
      if (generation !== campaignRequestGeneration.current) return;
      const loaded = Array.isArray(data.campaigns) ? data.campaigns as StoredCampaign[] : [];
      setCampaigns(loaded);
      setCampaignTotal(typeof data.total === "number" && Number.isFinite(data.total) ? data.total : loaded.length);
      setCampaignNextOffset(typeof data.nextOffset === "number" && Number.isSafeInteger(data.nextOffset) ? data.nextOffset : null);
    } catch (error) {
      if (generation === campaignRequestGeneration.current) setCampaignsLoadError(error instanceof Error ? error.message : "Impossible de charger les campagnes.");
    } finally {
      if (generation === campaignRequestGeneration.current) setCampaignsLoading(false);
    }
  }, []);

  const loadMoreCampaigns = useCallback(async () => {
    if (campaignNextOffset === null || campaignsLoading || campaignPageLoading.current) return;
    const generation = campaignRequestGeneration.current;
    campaignPageLoading.current = true;
    setCampaignsLoadingMore(true);
    setCampaignsLoadError("");
    try {
      const data = await readJson(await fetch(`/api/ads/campaigns?offset=${campaignNextOffset}`, { cache: "no-store" }));
      if (generation !== campaignRequestGeneration.current) return;
      const loaded = Array.isArray(data.campaigns) ? data.campaigns as StoredCampaign[] : [];
      setCampaigns((current) => {
        const knownIds = new Set(current.map((campaign) => campaign.id));
        return [...current, ...loaded.filter((campaign) => !knownIds.has(campaign.id))];
      });
      setCampaignTotal(typeof data.total === "number" && Number.isFinite(data.total) ? data.total : campaignNextOffset + loaded.length);
      setCampaignNextOffset(typeof data.nextOffset === "number" && Number.isSafeInteger(data.nextOffset) ? data.nextOffset : null);
    } catch (error) {
      if (generation === campaignRequestGeneration.current) setCampaignsLoadError(error instanceof Error ? error.message : "Impossible de charger les campagnes suivantes.");
    } finally {
      campaignPageLoading.current = false;
      setCampaignsLoadingMore(false);
    }
  }, [campaignNextOffset, campaignsLoading]);

  useEffect(() => { void loadCampaigns(); }, [loadCampaigns]);
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
    setLoadingAccounts(true);
    void fetch(`/api/ads/accounts?provider=${channelId}`, { cache: "no-store" })
      .then(readJson)
      .then((data) => {
        if (!active) return;
        const result = data as AccountResponse;
        const nextAccounts = result.accounts || [];
        const nextPages = result.pages || [];
        setConnected(result.connected);
        setConnectionStatus(result.connectionStatus || (result.connected ? "connected" : "disconnected"));
        setConnectionAccount(result.connectionAccount);
        setAccounts(nextAccounts);
        setPages(nextPages);
        const euroAccounts = nextAccounts.filter((account) => account.currency === "EUR");
        const linkedInstagramPages = nextPages.filter((page) => Boolean(page.instagramUserId));
        const persistedAccount = euroAccounts.find((account) => account.id === result.selectedAccountId);
        const suggestedAccount = euroAccounts.find((account) => account.id === result.suggestedAccountId);
        const persistedPage = nextPages.find((page) => page.id === result.selectedPageId);
        const persistedAccountId = String(result.selectedAccountId || "");
        const persistedPageId = String(result.selectedPageId || "");
        // `selectedAccountId` is a persisted choice. Keep it intact even if a
        // temporary account-list refresh cannot currently resolve that ID.
        setConfiguredAccountId(persistedAccountId);
        setConfiguredAccountLabel(String(result.selectedAccountLabel || ""));
        setConfiguredPageId(persistedPageId);
        setDraft((current) => {
          const hasPersistedAccount = Boolean(persistedAccountId);
          const existingAccount = hasPersistedAccount || result.accountSelectionCleared ? undefined : euroAccounts.find((account) => account.id === current.adAccountId);
          // A provider refresh must never silently switch an associated
          // advertiser account to the only account currently returned.
          const account = persistedAccount || existingAccount || suggestedAccount;
          const existingPage = nextPages.find((page) => page.id === current.pageId);
          const page = persistedPage || existingPage || (channelId === "meta" && linkedInstagramPages.length === 1 ? linkedInstagramPages[0] : undefined);
          // Keep durable IDs visible through a transient provider outage. The
          // actual live-publish checks still require that their accounts/pages
          // are freshly available, so this never weakens publication safety.
          const adAccountId = persistedAccountId || account?.id || "";
          const pageId = channelId === "meta" ? persistedPageId || page?.id || "" : current.pageId;
          if (current.adAccountId === adAccountId && current.accountCurrency === "EUR" && current.pageId === pageId) return current;
          return { ...current, adAccountId, accountCurrency: "EUR", pageId };
        });
        if (result.connectionStatus === "needs_update") {
          setNotice(`La connexion ${channelId === "google" ? "Google Ads" : "Meta Ads"} doit être actualisée avant de charger vos comptes.`);
        } else if (result.connected && euroAccounts.length > 1) {
          setNotice("Connexion réussie. Chargez et choisissez le compte annonceur à utiliser.");
        }
        if (result.error) setNotice(result.error);
      })
      .catch((error) => { if (active) setNotice(error instanceof Error ? error.message : "Connexion publicitaire indisponible."); })
      .finally(() => { if (active) setLoadingAccounts(false); });
    return () => { active = false; };
  }, [channelId, accountsRefreshKey]);

  function changeProvider(next: AdsProvider) {
    setChannelIndex(CHANNEL_CATALOG.findIndex((channel) => channel.provider === next));
    const channelChanged = channelId !== next;
    setChannelId(next);
    if (next === provider && !channelChanged) return;
    if (next !== provider) setProvider(next);
    setDraft(newDraft(next));
    setConnected(false);
    setConnectionStatus("disconnected");
    setConnectionAccount(undefined);
    setConfiguredAccountId("");
    setConfiguredAccountLabel("");
    setConfiguredPageId("");
    setConfigAction(null);
    setAccounts([]);
    setPages([]);
    setSavedId(null);
    setDirty(true);
    setConfirmedSpend(false);
    setNotice("");
  }

  function openConfiguration(channel: AdsProvider) {
    changeProvider(channel);
    setConfiguring(true);
  }

  function updateDraft(next: Partial<AdsCampaignInput>) {
    setDraft((current) => applyDraftEdit(current, next));
    setDirty(true);
    setConfirmedSpend(false);
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

  function applyCampaignMedia(item: Pick<MediaLibraryPickerItem, "media_type" | "signed_url" | "title" | "original_file_name">) {
    const url = String(item.signed_url || "").trim();
    if (!url) {
      setCampaignMediaUploadError("Ce média ne peut pas encore être utilisé : son lien sécurisé est indisponible.");
      return;
    }
    const mediaType = item.media_type === "video" ? "video" : "image";
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
      const uploaded = await uploadFileToMediaLibrary(file, {
        source: "ads_campaign",
        title: file.name.replace(/\.[^.]+$/, ""),
        tags: ["inrads", "campagne", channelId, expectedType],
        metadata: {
          campaign_provider: channelId,
          campaign_media_source: "manual_upload",
        },
      });
      applyCampaignMedia({
        media_type: uploaded.media_type === "video" ? "video" : "image",
        signed_url: typeof uploaded.signed_url === "string" ? uploaded.signed_url : null,
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
    applyCampaignMedia(result.item);
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
      setConfiguredAccountId(String(result.selectedAccountId || draft.adAccountId));
      setConfiguredAccountLabel(String(result.selectedAccountLabel || selectedAccount?.name || ""));
      setNotice(`Compte ${provider === "google" ? "Google Ads" : "Meta Ads"} associé. Il restera mémorisé jusqu’à ce que vous le dissociiez. Aucune annonce n’a été publiée.`);
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
      setConfiguredPageId(String(result.selectedPageId || draft.pageId));
      setNotice("Identité Facebook et Instagram associée pour vos campagnes Meta Ads. Elle restera mémorisée jusqu’à sa dissociation.");
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
        setConfiguredAccountId("");
        setConfiguredAccountLabel("");
        setConfiguredPageId("");
        updateDraft({ adAccountId: "", pageId: provider === "meta" ? "" : draft.pageId });
        setNotice("Compte annonceur dissocié. Vous pouvez en choisir un autre.");
      } else {
        setConfiguredPageId("");
        updateDraft({ pageId: "" });
        setNotice("Identité publicitaire dissociée. Vous pouvez en choisir une autre.");
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
      setConnected(false);
      setConnectionStatus("disconnected");
      setConnectionAccount(undefined);
      setConfiguredAccountId("");
      setConfiguredAccountLabel("");
      setConfiguredPageId("");
      setAccounts([]);
      setPages([]);
      updateDraft({ adAccountId: "", pageId: provider === "meta" ? "" : draft.pageId });
      setNotice(`${provider === "google" ? "Google Ads" : "Meta Ads"} est déconnecté d’iNrCy. Aucune campagne existante n’a été modifiée.`);
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
    setCreationPath("manual");
    updateDraft({ creationMode: "manual" });
    setStep(1);
  }

  function applyCampaignPlan(plan: AdsCampaignPlan) {
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
      primaryText: plan.primaryText || current.primaryText,
      // A fresh analysis must never inherit an unrelated media attachment.
      // Only Studio acceptance or an explicit later user choice supplies one.
      imageUrl: plan.imageUrl,
      creativeUrl: plan.creativeUrl,
      creativeType: plan.creativeType,
      mediaStrategy: plan.mediaStrategy,
      mediaBrief: plan.mediaBrief || current.mediaBrief,
      callToAction: plan.callToAction || current.callToAction,
      headlines: plan.headlines.length ? plan.headlines : current.headlines,
      descriptions: plan.descriptions.length ? plan.descriptions : current.descriptions,
      keywords: plan.keywords.length ? plan.keywords : current.keywords,
      negativeKeywords: plan.negativeKeywords,
      channelDraft,
      channelSettings,
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
    setDirty(true);
    setConfirmedSpend(false);
  }

  async function generateCampaignPlan() {
    stopPlanProgress();
    setBusy("plan");
    setPlanError("");
    setPlanRequestId("");
    setPlanRationale("");
    setPlanSources([]);
    setAutoMediaPlan(null);
    setAutoMediaState("idle");
    setAutoMediaMessage("");
    // Never pretend that an AI answer is 89% complete: while the server is
    // analysing, the UI deliberately shows an indeterminate, truthful state.
    setPlanProgress(0);
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
      setPlanProgress(90);
      setAutoMediaState("generating");
      setAutoMediaPlan(plan);
      mediaGenerationQueued = true;
    } catch (error) {
      const requestError = error as AdsApiRequestError;
      setPlanRequestId(typeof requestError?.requestId === "string" ? requestError.requestId : "");
      setPlanError(error instanceof Error ? error.message : "La génération iNrCy a échoué.");
      setPlanProgress(0);
    } finally {
      stopPlanProgress();
      if (!mediaGenerationQueued) setBusy(null);
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
    setDraft({
      ...newDraft(channelId),
      // The advertiser/identity belongs to the channel, not to an individual
      // campaign. Starting over must not make an associated account disappear.
      adAccountId: isAdsProvider(channelId) ? configuredAccountId : "",
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
    setConfirmedSpend(false);
    setCreationPath("choice");
    setAnalysisSetupOpen(false);
    setAnalysisMode("free");
    setGuidedAnalysisObjective("");
    setStep(0);
    setCreating(true);
  }

  function closeCampaignCreation() {
    stopPlanProgress();
    setPlanSources([]);
    setAutoMediaPlan(null);
    setAutoMediaState("idle");
    setAutoMediaMessage("");
    setCampaignMediaStudioOpen(false);
    setCampaignMediaLibraryOpen(false);
    setBusy(null);
    setAnalysisSetupOpen(false);
    setCreating(false);
  }

  async function saveDraft() {
    setBusy("save"); setNotice("");
    try {
      const result = await readJson(await fetch("/api/ads/campaigns", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, provider: channelId, id: savedId }),
      }));
      const campaign = result.campaign as { id: string };
      setSavedId(campaign.id);
      setDirty(false);
      setConfirmedSpend(false);
      setNotice("Brouillon enregistré. Aucune annonce n’a été publiée ni facturée.");
      void loadCampaigns();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Enregistrement impossible.");
    } finally { setBusy(null); }
  }

  async function publish() {
    if (!isAdsProvider(channelId)) {
      setNotice(`${channelMeta.label} ne peut pas encore être publiée depuis iNr’ADS. Votre préparation reste un brouillon.`);
      return;
    }
    const connectorIssue = unsupportedAdsConnectorReason(draft);
    if (connectorIssue) {
      setNotice(connectorIssue);
      return;
    }
    if (!liveFormatAvailable) {
      setNotice(channelId === "google"
        ? "Ce format Google est prêt à être contrôlé et enregistré, mais seule la campagne Réseau de recherche peut actuellement être publiée depuis iNr’ADS."
        : "Ce format Meta est prêt à être contrôlé et enregistré, mais seule la campagne Trafic peut actuellement être publiée depuis iNr’ADS.");
      return;
    }
    if (!livePublisherConversionReady) {
      setNotice("La diffusion actuellement branchée nécessite une conversion vers votre site web. Conservez les autres parcours dans le brouillon : ils seront prêts lorsque leur connecteur sera disponible.");
      return;
    }
    if (!metaLivePlacementsSupported) {
      setNotice("Le connecteur Trafic Meta actuellement disponible diffuse dans les fils Facebook et Instagram. Vos autres placements restent bien sauvegardés dans le brouillon.");
      return;
    }
    if (channelId === "meta" && !draft.imageUrl) {
      setNotice("Ajoutez une image à cette campagne Meta avant de la publier. Le connecteur Trafic Meta actuellement disponible utilise un visuel image.");
      return;
    }
    if (channelId === "google" && draft.creationMode === "inrcy" && !draft.imageUrl) {
      setNotice("Ajoutez l’image complémentaire prévue par l’analyse Google Search avant de publier.");
      return;
    }
    if (channelId !== provider || !savedId || dirty || !selectedAccount || !channelAccountReady || !confirmedSpend || !livePublishingEnabled) return;
    if (provider === "meta" && !pages.some((page) => page.id === draft.pageId && page.instagramUserId)) {
      setNotice("Pour diffuser sur Facebook et Instagram, associez un compte Instagram professionnel à la Page sélectionnée dans Meta Business Suite.");
      return;
    }
    const accepted = window.confirm(`Publier réellement « ${draft.name} » sur ${channelMeta.label} ?\nCompte : ${selectedAccount.name}\nBudget ${channelId === "google" ? "moyen" : "journalier"} : ${draft.dailyBudgetEuros.toFixed(2)} €/jour\nFin : ${draft.endDate}\nLa plateforme débitera directement le compte publicitaire. iNrCy ne prélève pas le budget média.`);
    if (!accepted) return;
    setBusy("publish"); setNotice("");
    try {
      await readJson(await fetch(`/api/ads/campaigns/${savedId}/publish`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "PUBLIER_ET_DEPENSER" }),
      }));
      setNotice(`Campagne activée côté plateforme. Sa diffusion reste soumise à la vérification de l’annonce par ${channelMeta.label}.`);
      setConfirmedSpend(false);
      await loadCampaigns();
      setCreating(false);
      setTracking(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Publication impossible. Vérifiez le statut de la campagne avant toute nouvelle tentative.");
      void loadCampaigns();
    } finally { setBusy(null); }
  }

  async function createPausedDemo() {
    if (!isAdsProvider(channelId) || !demoPausedPublishingEnabled || busy !== null || demoSubmissionRef.current) return;
    const connectorIssue = unsupportedAdsConnectorReason(draft);
    if (connectorIssue) {
      setNotice(connectorIssue);
      return;
    }
    if (!liveFormatAvailable) {
      setNotice(channelId === "google"
        ? "La démo en pause est actuellement disponible pour les campagnes Réseau de recherche Google."
        : "La démo en pause est actuellement disponible pour les campagnes Trafic Meta.");
      return;
    }
    if (!livePublisherConversionReady) {
      setNotice("La démo en pause actuellement branchée nécessite une conversion vers votre site web.");
      return;
    }
    if (!metaLivePlacementsSupported) {
      setNotice("La démo Trafic Meta actuellement branchée utilise les fils Facebook et Instagram. Vos autres placements restent sauvegardés dans le brouillon.");
      return;
    }
    if (channelId === "meta" && !draft.imageUrl) {
      setNotice("Ajoutez une image à cette campagne Meta avant de créer une démo en pause.");
      return;
    }
    if (channelId === "google" && draft.creationMode === "inrcy" && !draft.imageUrl) {
      setNotice("Ajoutez l’image complémentaire prévue par l’analyse Google Search avant de créer une démo en pause.");
      return;
    }
    if (!livePublisherMediaReady) {
      setNotice("Le média choisi doit être disponible dans la médiathèque iNrCy avant de créer la démo en pause.");
      return;
    }
    if (channelId !== provider) {
      setNotice("Le canal de cette campagne a changé. Revenez sur son canal avant de créer la démo.");
      return;
    }
    demoSubmissionRef.current = true;
    setBusy("demo"); setNotice("");
    try {
      // Resolve the durable association at click time. A fresh campaign may
      // have a blank local draft even though the advertiser remains linked.
      const connection = await readJson(await fetch(`/api/ads/accounts?provider=${channelId}`, { cache: "no-store" })) as AccountResponse;
      const accountId = String(connection.selectedAccountId || "");
      setConnected(connection.connected);
      setConnectionStatus(connection.connectionStatus || (connection.connected ? "connected" : "disconnected"));
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
      const pageId = channelId === "meta" ? String(connection.selectedPageId || "") : "";
      if (channelId === "meta" && !(connection.pages || []).some((page) => page.id === pageId && page.instagramUserId)) {
        throw new Error("Pour la démo Meta, associez d’abord un compte Instagram professionnel à la Page sélectionnée.");
      }
      setConfiguredAccountLabel(String(connection.selectedAccountLabel || account.name));
      const accepted = window.confirm(`Créer « ${draft.name} » en pause sur ${channelMeta.label} ?\nCompte associé : ${account.name} (${accountId})\n\nLa campagne sera enregistrée automatiquement dans iNrCy puis créée sur la plateforme en pause, sans activation ni dépense. Vérifiez son état dans le compte publicitaire après la création.`);
      if (!accepted) return;

      const campaignDraft: AdsCampaignInput = {
        ...draft,
        provider: channelId,
        adAccountId: accountId,
        accountCurrency: "EUR",
        pageId: channelId === "meta" ? pageId : draft.pageId,
      };
      const saved = await readJson(await fetch("/api/ads/campaigns", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...campaignDraft, id: savedId }),
      }));
      const campaignId = String((saved.campaign as { id?: string } | undefined)?.id || "");
      if (!campaignId) throw new Error("Le brouillon n’a pas pu être confirmé. Aucune campagne Google Ads n’a été créée.");
      setDraft(campaignDraft);
      setSavedId(campaignId);
      setDirty(false);

      await readJson(await fetch(`/api/ads/campaigns/${campaignId}/publish`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "demo_paused", confirmation: ADS_PAUSED_DEMO_CONFIRMATION }),
      }));
      setNotice(`Campagne créée en pause sur ${channelMeta.label}, compte ${account.name}. Aucune diffusion n’est lancée.`);
      setConfirmedSpend(false);
      await loadCampaigns();
      setCreating(false);
      setTracking(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "La démo en pause n’a pas pu être confirmée. Vérifiez son statut sur la plateforme avant de réessayer.");
      void loadCampaigns();
    } finally { demoSubmissionRef.current = false; setBusy(null); }
  }

  function reopen(campaign: StoredCampaign) {
    if (campaign.status !== "draft") return;
    stopPlanProgress();
    setTracking(false);
    setChannelId(campaign.provider);
    setChannelIndex(CHANNEL_CATALOG.findIndex((channel) => channel.id === campaign.provider));
    if (isAdsProvider(campaign.provider)) {
      if (campaign.provider !== provider) setProvider(campaign.provider);
    } else {
      setConnected(false);
      setAccounts([]);
      setPages([]);
    }
    setDraft(campaign.draft);
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
    setCampaignMediaStudioOpen(false);
    setCampaignMediaLibraryOpen(false);
    setBusy(null);
    const nextPath: AdsCreationMode = campaign.draft.creationMode === "inrcy" ? "inrcy" : "manual";
    setAnalysisSetupOpen(false);
    setCreationPath(nextPath);
    setPlanProgress(nextPath === "inrcy" ? 100 : 0);
    setNotice(`Brouillon « ${campaign.name} » rouvert.`);
    setStep(nextPath === "inrcy" ? 2 : 1);
    setCreating(true);
  }

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
  const nativeMediaUpload = nativeMediaStrategy === "image" || nativeMediaStrategy === "video";
  const mediaStrategyOptions = channelId === "meta"
    ? MEDIA_STRATEGY_OPTIONS.filter((option) => option.value === "image" || option.value === "video" || option.value === "mixed")
    : MEDIA_STRATEGY_OPTIONS;
  const selectedCampaignType = campaignTypeOptions.find((option) => option.value === draft.campaignType) || campaignTypeOptions[0];
  const liveFormatAvailable = channelId === "google"
    ? draft.campaignType === "search"
    : channelId === "meta"
      ? draft.campaignType === "meta_traffic"
      : false;
  const livePublisherConversionReady = liveFormatAvailable && draft.conversionLocation === "website";
  const metaLiveObjectiveSupported = channelId !== "meta" || draft.objective === "website_traffic";
  const metaLiveGoalSupported = channelId !== "meta" || draft.conversionGoal === "website_visit";
  const metaLivePlacementsSupported = channelId !== "meta" || (
    draft.metaPlacements.length === 2 &&
    draft.metaPlacements.includes("facebook_feed") &&
    draft.metaPlacements.includes("instagram_feed")
  );
  const metaLiveCreativeSupported = channelId !== "meta" || (draft.mediaStrategy === "image" && draft.creativeType === "image");
  const metaLiveCtaSupported = channelId !== "meta" || ["en savoir plus", "decouvrir", "learn more"].includes(
    draft.callToAction.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(),
  );
  const connectorConfigurationIssue = isAdsProvider(channelId) ? unsupportedAdsConnectorReason(draft) : null;
  const livePublisherSetupReady = livePublisherConversionReady && !connectorConfigurationIssue;
  const googleSearchImageSourceReady = !googleSearchMedia || !draft.imageUrl || draft.imageUrl.startsWith("/api/media-library/items/");
  const livePublisherMediaReady = (channelId === "meta" || (googleSearchMedia && draft.creationMode === "inrcy")
    ? Boolean(draft.imageUrl)
    : true) && googleSearchImageSourceReady;
  const analysisRequestPending = busy === "plan" && autoMediaState !== "generating" && planProgress < 90 && !planError;
  const analysisProposalReady = creationPath === "inrcy" && step === analysisStep && planProgress === 100 && busy !== "plan";
  const visiblePlanRationale = presentAdsCampaignRationale(planRationale);
  const pendingAnalysisStage = AI_ANALYSIS_STAGES.findIndex((stage) => planProgress < stage.at);
  const activeAnalysisStage = planError
    ? -1
    : analysisRequestPending
      ? 0
      : pendingAnalysisStage === -1 ? AI_ANALYSIS_STAGES.length - 1 : pendingAnalysisStage;

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
            <button type="button" className={styles.trackingButton} aria-label="Suivi des campagnes" title="Suivi des campagnes" onClick={() => { setTracking(true); void loadCampaigns(); }}>
              <span className={styles.headerActionIcon} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M7 5h12M7 12h12M7 19h12" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" /><circle cx="3.5" cy="5" r="1.2" fill="currentColor" /><circle cx="3.5" cy="12" r="1.2" fill="currentColor" /><circle cx="3.5" cy="19" r="1.2" fill="currentColor" /></svg></span>
              <span className={styles.headerActionText}>Suivi des campagnes</span>
              {campaigns.length > 0 && <span className={styles.trackingCount}>{campaigns.length}</span>}
            </button>
            <Link href="/dashboard" className={`${styles.back} ${styles.headerCloseButton}`} aria-label="Fermer iNr’ADS" title="Fermer iNr’ADS"><span className={styles.headerActionIcon} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" /></svg></span><span className={styles.headerActionText}>Fermer</span></Link>
          </nav>
        </div>
      </header>

      {notice && !creating && <p className={`${styles.notice} ${styles.cockpitNotice}`} role="status" aria-live="polite">{notice}</p>}
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
        <nav className={styles.channelRail} aria-label="Choisir un canal publicitaire">{CHANNEL_CATALOG.map((channel, index) => <button type="button" key={channel.id} aria-label={channel.label} title={channel.label} data-channel={channel.id} data-near={index === channelIndex || index === (channelIndex + 1) % CHANNEL_CATALOG.length || index === (channelIndex - 1 + CHANNEL_CATALOG.length) % CHANNEL_CATALOG.length || undefined} onClick={() => selectChannel(index)} aria-pressed={index === channelIndex}><span className={styles.channelRailLogo} aria-hidden="true"><Image src={channel.logo} width={40} height={40} alt="" draggable={false} /></span><span className={styles.channelRailLabel}>{channel.label}</span></button>)}</nav>
        <div className={styles.channelCarousel} data-testid="ads-channel-carousel">
          <button type="button" onClick={() => selectChannel(channelIndex - 1)} aria-label="Canal précédent">‹</button>
          <div className={styles.cubeStage} tabIndex={0} role="group" aria-label="Carrousel des canaux : flèches gauche et droite pour naviguer" onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); selectChannel(channelIndex + (event.key === "ArrowRight" ? 1 : -1)); } }} onPointerDown={(event) => { if (!(event.target as HTMLElement).closest("button,a")) channelPointerStart.current = { x: event.clientX, y: event.clientY }; }} onPointerUp={(event) => { const start = channelPointerStart.current; channelPointerStart.current = null; if (!start) return; const dx = event.clientX - start.x; if (Math.abs(dx) >= 58 && Math.abs(dx) > Math.abs(event.clientY - start.y) * 1.5) selectChannel(channelIndex + (dx < 0 ? 1 : -1)); }} onPointerCancel={() => { channelPointerStart.current = null; }}>
          {[-1, 0, 1].map((offset) => {
            const index = (channelIndex + offset + CHANNEL_CATALOG.length) % CHANNEL_CATALOG.length;
            const channel = CHANNEL_CATALOG[index];
            const externalChannel = isExternalChannel(channel.id) ? channel.id : null;
            return <div key={`${offset}-${channel.id}`} data-provider={channel.id} className={`${styles.channel} ${offset === 0 ? styles.channelActive : styles.channelMini}`}>
              {offset !== 0 && <button className={styles.miniSelect} type="button" aria-label={`Afficher ${channel.label}`} onClick={() => selectChannel(index)} />}
              <span className={styles.channelLogo}><Image src={channel.logo} width={56} height={56} alt="" draggable={false} /></span>
              <div className={styles.channelIdentity}><strong>{channel.label}</strong><small>{channel.format}</small>{channel.provider ? <span className={styles.channelStatus} data-status={offset !== 0 ? "available" : channelAccountReady ? "connected" : connectionStatus === "needs_update" ? "select-account" : connected ? "select-account" : "disconnected"}>{offset !== 0 ? "Disponible" : channelAccountReady ? "Compte connecté" : connectionStatus === "needs_update" ? "Connexion à actualiser" : connected ? "Compte à associer" : "À connecter"}</span> : externalChannel && offset === 0 ? <span className={styles.channelStatus} data-status={externalStatusDisplay(externalStatuses[externalChannel]).tone}>{externalStatusDisplay(externalStatuses[externalChannel]).label}</span> : null}</div>
              {offset === 0 && (channel.provider ? <div className={styles.channelActions}>
                {configuredAdvertiserAccountUrl ? <a className={styles.channelViewAccount} href={configuredAdvertiserAccountUrl} target="_blank" rel="noreferrer">Voir le compte</a> : null}
                <button type="button" className={styles.channelConfigure} onClick={() => openConfiguration(channel.provider!)}><span aria-hidden="true">⚙</span> Configurer</button>
              </div> : externalChannel ? <div className={styles.channelActions}>
                <button type="button" className={styles.channelConfigure} onClick={() => openExternalConfiguration(externalChannel)}><span aria-hidden="true">⚙</span> Configurer</button>
              </div> : null)}
            </div>;
          })}
          </div>
          <button type="button" onClick={() => selectChannel(channelIndex + 1)} aria-label="Canal suivant">›</button>
        </div>
      </section>

      <div className={styles.launchArea}>
        <button type="button" onClick={startNewCampaign} className={`${styles.headerCta} ${styles.launchButton}`}><span aria-hidden="true">✦</span> Lancer une campagne <span aria-hidden="true">↗</span></button>
      </div>

      <SettingsDrawer title="Créer une campagne" isOpen={creating} onClose={closeCampaignCreation} presentation="centered" headerLead={<div className={styles.modalBrand}>iNr’<span>ADS</span><small>STUDIO DE CAMPAGNE</small></div>} headerStyle={{ background: "radial-gradient(ellipse at 20% 0, #246bbd70, transparent 60%), linear-gradient(100deg, #172e5a, #392464 65%, #772b75)", borderBottom: "1px solid #c68aff66", boxShadow: "0 8px 35px #8a4ce52b", minHeight: 76 }} headerContent={<div className={styles.wizardTitle}><span className={styles.modalSpark} aria-hidden="true">✦</span><div>Créer une campagne <small>{displayedStepNames[step]} · Étape {step + 1} / {displayedStepNames.length}</small></div></div>}>
      <div ref={studioWorkspaceRef} className={`${styles.workspace} ${styles.studioWorkspace}`} data-compact={compactScreen || undefined} data-short={shortScreen || undefined} data-stage={step} data-creation-path={creationPath} data-analysis-setup={analysisSetupOpen || undefined} onTouchStart={(event) => { const touch = event.touches[0]; touchStart.current = { x: touch.clientX, y: touch.clientY }; }} onTouchEnd={(event) => { const start = touchStart.current; touchStart.current = null; if (!start || creationPath === "choice" || busy !== null) return; const touch = event.changedTouches[0]; const dx = touch.clientX - start.x; const dy = touch.clientY - start.y; if (Math.abs(dx) > 75 && Math.abs(dx) > Math.abs(dy) * 1.5 && !(event.target instanceof HTMLElement && event.target.closest("input, textarea, select, button"))) setStep((current) => { if (dx < 0 && creationPath === "inrcy" && current === analysisStep && planProgress !== 100) return current; return Math.max(0, Math.min(lastStep, current + (dx < 0 ? 1 : -1))); }); }}>
      <nav className={styles.stepper} aria-label="Étapes de création">{displayedStepNames.map((name, index) => <button type="button" key={name} disabled={index > step || busy === "plan"} aria-label={`${index + 1}. ${name}`} aria-current={step === index ? "step" : undefined} onClick={() => setStep(index)}><span>{index + 1}</span>{!compactScreen && name}</button>)}</nav>
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
          <div className={styles.adsGenerationProgress} data-pending={analysisRequestPending || undefined} aria-label={analysisRequestPending ? "Analyse iNrCy en cours" : `Progression : ${planProgress} %`} aria-live="polite"><div><span style={{ width: `${analysisRequestPending ? 22 : planProgress}%` }} /></div><strong>{analysisRequestPending ? "Analyse en cours…" : `${planProgress}%`}</strong></div>
          <ol className={styles.adsGenerationStages}>{AI_ANALYSIS_STAGES.map((stage, index) => <li key={stage.label} data-state={planProgress >= stage.at ? "done" : index === activeAnalysisStage ? "active" : "pending"}><span>{planProgress >= stage.at ? "✓" : index + 1}</span><div><strong>{stage.label}</strong><small>{stage.detail}</small></div></li>)}</ol>
          {autoMediaMessage && <p className={styles.studioMediaGenerationNote} data-state={autoMediaState} role={autoMediaState === "error" ? "alert" : "status"}>{autoMediaMessage}</p>}
          {planError && <div className={styles.studioPlanError} role="alert"><strong>La proposition n’a pas pu être finalisée.</strong><span>{planError}</span>{planRequestId && <small>Référence technique : {planRequestId}</small>}<div><button type="button" className={styles.secondaryButton} onClick={() => void generateCampaignPlan()}>Réessayer l’analyse</button><button type="button" className={styles.back} onClick={chooseManualCreation}>Passer au mode manuel</button></div></div>}
          {!planError && planProgress < 100 && <div className={`${styles.studioPlanReady} ${styles.studioPlanPending}`} aria-hidden="true"><strong className={styles.studioPlanHeading}>Bilan de l’analyse</strong><div className={styles.studioPlanPendingLines}><span /><span /><span /></div></div>}
          {planProgress === 100 && !planError && <div className={styles.studioPlanReady}><strong className={styles.studioPlanHeading}>Bilan de l’analyse</strong><details className={styles.studioPlanDetails}><summary><span className={styles.studioPlanPreview}>{visiblePlanRationale}</span><span className={styles.studioPlanExpandClosed}>Lire le bilan complet ↓</span><span className={styles.studioPlanExpandOpen}>Réduire le bilan ↑</span></summary><p>{visiblePlanRationale}</p></details>{planSources.length > 0 && <div className={styles.studioPlanSources}><span>Analyse basée sur</span><ul>{planSources.map((source) => <li key={source}>{source}</li>)}</ul></div>}</div>}
        </div>
      </section>

      <section hidden={step !== foundationsStep} data-channel={channelId} className={`${styles.card} ${styles.studioCard} ${styles.studioFoundationsCard}`}>
        <StudioStepHeader number={foundationsStep + 1} label="FONDATIONS" title="La direction de votre campagne." mobileTitle="Votre objectif" channel={channelMeta.label} />
        <p className={`${styles.intro} ${styles.studioOptionalIntro}`}>Définissez ce que vous voulez obtenir. iNrCy utilise ces choix pour guider les messages, le ciblage et la diffusion.</p>
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
              updateNativeSettings({ ...nativeSettings, objectiveType,
                intendedPromotionType: objectiveType === "VIDEO_COMPLETION" || objectiveType === "AWARENESS" ? "STANDARD_AD" : nativeSettings.intendedPromotionType,
                creativeType: objectiveType === "VIDEO_COMPLETION" ? "VIDEO" : nativeSettings.intendedPromotionType === "CATALOG" && objectiveType !== "AWARENESS" ? null : nativeSettings.creativeType || "REGULAR",
                conversionEvent: objectiveType === "SALES" ? "CHECKOUT" : objectiveType === "LEADS" ? "LEAD" : null });
            }}>{PINTEREST_WIZARD_OBJECTIVES.map((value) => <option key={value} value={value}>{nativeBriefTerm(value)}</option>)}</select></label>
          </>}
          {nativeSettings?.channel === "x" && <>
            <label className={styles.field}>Objectif X<select value={nativeSettings.objective} onChange={(event) => {
              const objective = event.target.value as XWizardSettings["objective"];
              updateNativeSettings({ ...nativeSettings, objective, format: objective === "video_views" ? "video" : nativeSettings.format });
            }}>{X_WIZARD_OBJECTIVES.map((value) => <option key={value} value={value}>{nativeBriefTerm(value)}</option>)}</select></label>
          </>}
          {!nativeSettings && <>
            <label className={styles.field}>Objectif<select value={draft.objective} onChange={(event) => updateDraft({ objective: event.target.value as AdsCampaignInput["objective"] })}>{OBJECTIVE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label className={styles.field}>Action à mesurer<select value={draft.conversionGoal} onChange={(event) => updateDraft({ conversionGoal: event.target.value as AdsCampaignInput["conversionGoal"] })}>{CONVERSION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          </>}
        </div>
        {!nativeSettings && <><div className={styles.studioTypeGrid} role="radiogroup" aria-label="Type de campagne">{campaignTypeOptions.map((option) => <button type="button" role="radio" aria-checked={draft.campaignType === option.value} key={option.value} data-selected={draft.campaignType === option.value || undefined} onClick={() => updateDraft({ campaignType: option.value })}><strong>{option.label}</strong><small>{option.detail}</small><span>{draft.campaignType === option.value ? "Choisi" : "Choisir"}</span></button>)}</div><p className={styles.studioTypeHint}>Un seul type par campagne : pour tester plusieurs leviers, créez ensuite une campagne dédiée à chacun.</p></>}
        {nativeSettings && <p className={styles.studioTypeHint}>Vous choisirez le format dans Médias. Les ressources et autorisations seront à confirmer dans votre compte publicitaire.</p>}
      </section>

      <section hidden={step !== targetingStep} data-channel={channelId} className={`${styles.card} ${styles.studioCard} ${styles.studioTargetingCard}`}>
        <StudioStepHeader number={targetingStep + 1} label="CIBLAGE" title="À qui, où et quand parler." mobileTitle="Votre ciblage" channel={channelMeta.label} />
        <p className={`${styles.intro} ${styles.studioOptionalIntro}`}>Vos zones et vos clients sont des garde-fous : ils évitent une campagne trop large ou des clics peu pertinents.</p>
        <div className={styles.studioGrid}>
          <TagField label="Zones ciblées" helper="Ajoutez une zone à la fois : Entrée ou le bouton Ajouter" values={draft.targetLocations} onChange={(targetLocations) => updateDraft({ targetLocations })} placeholder="Ex. Lyon, Rhône ou 20 km autour de Villeurbanne" note={channelId === "google" ? "Avant diffusion, iNrCy vérifie chaque zone auprès de Google Ads afin d’éviter tout ciblage imprécis." : undefined} />
          <TagField label="Clients / audiences prioritaires" helper="Ajoutez les profils à privilégier" values={draft.targetAudiences} onChange={(targetAudiences) => updateDraft({ targetAudiences })} placeholder="Ex. Propriétaires de maison" />
          <TagField wide label={channelId === "google" ? "Langues du message" : "Langues de vos clients"} helper={channelId === "google" ? "Pour préparer les textes ; Google Search déduit la langue des annonces et du site." : "Ajoutez une langue ou son code"} values={draft.languages} onChange={(languages) => updateDraft({ languages })} placeholder="Ex. fr ou en" />
          {nativeSettings?.channel === "linkedin" && <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}><legend>Ciblage professionnel LinkedIn</legend><p>Choisissez l’angle principal ; les postes, secteurs ou compétences précis seront à confirmer dans le compte Ads.</p><div className={styles.studioControlOptions}><label>Critère principal<select value={nativeSettings.targetingFacet} onChange={(event) => updateNativeSettings({ ...nativeSettings, targetingFacet: event.target.value as LinkedInWizardSettings["targetingFacet"] })}><option value="titles">Fonctions / postes</option><option value="industries">Secteurs d’entreprise</option><option value="skills">Compétences</option></select></label><label>Langue de la campagne<select value={nativeSettings.locale.language} onChange={(event) => updateNativeSettings({ ...nativeSettings, locale: { ...nativeSettings.locale, language: event.target.value } })}><option value="fr">Français</option><option value="en">Anglais</option></select></label></div><small>Locale prévue : {nativeSettings.locale.language.toUpperCase()} · {nativeSettings.locale.country}. Les zones géographiques restent vos choix ci-dessus.</small></fieldset>}
          {nativeSettings?.channel === "tiktok" && <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}><legend>Audience TikTok</legend><div className={styles.studioControlOptions}><label>Approche d’audience<select value={nativeSettings.targetingMode} onChange={(event) => updateNativeSettings({ ...nativeSettings, targetingMode: event.target.value as TikTokWizardSettings["targetingMode"] })}><option value="broad">Audience large</option><option value="interests">Centres d’intérêt</option></select></label></div><small>Les intérêts exacts devront être vérifiés dans le compte annonceur.</small></fieldset>}
          {nativeSettings?.channel === "pinterest" && <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}><legend>Découverte sur Pinterest</legend><p>Choisissez le signal principal à préparer pour votre groupe d’annonces.</p><div className={styles.studioControlOptions}><label>Signal de ciblage<select value={nativeSettings.targetingMode} onChange={(event) => updateNativeSettings({ ...nativeSettings, targetingMode: event.target.value as PinterestWizardSettings["targetingMode"] })}><option value="interests">Centres d’intérêt</option><option value="keywords">Recherches / mots-clés</option><option value="audiences">Audiences existantes</option></select></label></div></fieldset>}
          {nativeSettings?.channel === "x" && <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}><legend>Audience X</legend><p>Votre choix oriente les signaux à détailler à l’étape suivante.</p><div className={styles.studioControlOptions}><label>Approche de ciblage<select value={nativeSettings.targetingMode} onChange={(event) => updateNativeSettings({ ...nativeSettings, targetingMode: event.target.value as XWizardSettings["targetingMode"] })}><option value="broad">Audience large</option><option value="keywords">Mots-clés</option><option value="interests">Centres d’intérêt</option><option value="follower_lookalikes">Audiences similaires aux abonnés</option></select></label></div></fieldset>}
          {channelId === "meta" && <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}><legend>Audience Meta</legend><label className={styles.check}><input type="checkbox" checked={draft.metaAudienceExpansion} onChange={(event) => updateDraft({ metaAudienceExpansion: event.target.checked })} />Autoriser Meta à élargir l’audience si cela améliore la probabilité de conversion.</label></fieldset>}
        </div>
      </section>

      <section hidden={step !== keywordsStep} data-channel={channelId} className={`${styles.card} ${styles.studioCard} ${styles.studioKeywordsCard}`}>
        <StudioStepHeader number={keywordsStep + 1} label={channelId === "google" ? "MOTS-CLÉS" : "SIGNAUX"} title={channelId === "google" ? "Les recherches à capter." : "Les signaux qui orientent votre audience."} mobileTitle={channelId === "google" ? "Vos mots-clés" : "Vos signaux"} channel={channelMeta.label} />
        <p className={`${styles.intro} ${styles.studioOptionalIntro}`}>{channelId === "google" ? "Cette étape est dédiée aux requêtes de vos futurs clients. Ajoutez les expressions commerciales à viser et celles à écarter." : channelId === "meta" ? "Ajoutez les intérêts, besoins et angles qui aident à orienter votre audience Meta." : `Détaillez les ${nativeSettings?.channel === "x" && nativeSettings.targetingMode === "keywords" || nativeSettings?.channel === "pinterest" && nativeSettings.targetingMode === "keywords" ? "mots-clés" : "signaux"} prévus pour ${channelMeta.label}. Les valeurs exactes seront confirmées dans le compte Ads.`}</p>
        <div className={styles.studioGrid}>
          {channelId === "google" ? <TagField wide label={draft.campaignType === "performance_max" ? "Thèmes de recherche / signaux d’intention" : "Mots-clés recherchés"} helper="Saisissez une expression, puis Entrée. Le micro ajoute vos mots-clés dictés." values={draft.keywords} onChange={(keywords) => updateDraft({ keywords })} placeholder="Ex. installation panneaux solaires" maxItems={20} maxItemLength={80} /> : <label className={`${styles.field} ${styles.studioWide}`}>{nativeSettings?.channel === "linkedin" ? `Pistes : ${nativeBriefTerm(nativeSettings.targetingFacet)}` : nativeSettings?.channel === "pinterest" && nativeSettings.targetingMode === "keywords" || nativeSettings?.channel === "x" && nativeSettings.targetingMode === "keywords" ? "Mots-clés à envisager" : nativeSettings?.channel === "x" && nativeSettings.targetingMode === "follower_lookalikes" ? "Comptes ou communautés similaires à étudier" : "Centres d’intérêt, signaux ou angles de ciblage"}<small>Un par ligne</small><textarea rows={6} value={editableList(draft.keywords)} onChange={(event) => updateDraft({ keywords: parseEditableList(event.target.value.split("\n")) })} placeholder="Ex. rénovation énergétique\nMaison individuelle\nÉconomies d’énergie" /></label>}
          {nativeSettings && <aside className={`${styles.studioKeywordGuidance} ${styles.studioWide}`}><strong>Des pistes, pas des identifiants publicitaires</strong><p>Ces idées restent dans votre brouillon. iNr’ADS ne les convertit pas automatiquement en audiences ou mots-clés de la plateforme ; vérifiez leur disponibilité avant une création réelle.</p></aside>}
          {channelId === "google" && <TagField wide label="Mots-clés à exclure" helper="Écartez les recherches non pertinentes ; ajoutez-les aussi à la voix." values={draft.negativeKeywords} onChange={(negativeKeywords) => updateDraft({ negativeKeywords })} placeholder="Ex. emploi" maxItems={40} maxItemLength={80} />}
          {channelId === "meta" && <aside className={`${styles.studioKeywordGuidance} ${styles.studioWide}`}><strong>Un signal, pas une contrainte rigide</strong><p>iNrCy les combine à vos zones, à votre offre et au comportement observé par Meta. Vous gardez le contrôle sur les audiences définies à l’étape précédente.</p></aside>}
        </div>
      </section>

      <section hidden={step !== creativeStep} data-channel={channelId} className={`${styles.card} ${styles.studioCard} ${styles.studioCreativeCard}`}>
        <StudioStepHeader number={creativeStep + 1} label="CRÉATIONS" title="Des messages qui donnent envie d’agir." mobileTitle="Vos messages" channel={channelMeta.label} />
        <p className={`${styles.intro} ${styles.studioOptionalIntro}`}>Vous pouvez écrire vous-même, partir de la proposition iNrCy et ajuster chaque mot. Vérifiez les exigences du canal avant une éventuelle publication.</p>
        <div className={styles.studioGrid}>
          <label className={`${styles.field} ${styles.studioWide}`}>{channelId === "x" ? "Texte du post X" : channelId === "tiktok" ? "Texte de l’annonce TikTok" : channelId === "pinterest" ? "Description de l’épingle" : channelId === "linkedin" ? "Introduction de la publication" : "Message principal"}<VoiceTextarea value={draft.primaryText} onChange={(primaryText) => updateDraft({ primaryText })} rows={4} maxLength={channelId === "linkedin" ? 300 : channelId === "tiktok" ? 100 : channelId === "pinterest" ? 800 : channelId === "x" ? 280 : 500} purpose="content" contextLabel="Message principal de la campagne" placeholder="Présentez l’offre, son bénéfice concret et la prochaine action à réaliser." /></label>
          {channelId === "google" ? <GoogleAdCopyField label="Titres" singular="Titre" values={draft.headlines} onChange={(headlines) => updateDraft({ headlines })} minItems={3} maxItems={15} maxLength={30} /> : channelId !== "tiktok" && channelId !== "x" && <label className={styles.field}>{channelId === "pinterest" ? "Titre de l’épingle" : channelId === "linkedin" ? "Titre de la création" : "Titres ou accroches (un par ligne)"}<textarea rows={4} value={editableList(draft.headlines)} onChange={(event) => updateDraft({ headlines: parseEditableList(event.target.value.split("\n")) })} /></label>}
          {channelId === "google" ? <GoogleAdCopyField label="Descriptions" singular="Description" values={draft.descriptions} onChange={(descriptions) => updateDraft({ descriptions })} minItems={2} maxItems={4} maxLength={90} /> : channelId === "meta" && <label className={styles.field}>Descriptions (une par ligne)<textarea rows={4} value={editableList(draft.descriptions)} onChange={(event) => updateDraft({ descriptions: parseEditableList(event.target.value.split("\n")) })} /></label>}
          <label className={styles.field}>Appel à l’action<input value={draft.callToAction} maxLength={80} onChange={(event) => updateDraft({ callToAction: event.target.value })} placeholder="Ex. Demander un devis" /></label>
          <aside className={`${styles.studioCopyGuidance} ${styles.field}`}><strong>À vérifier</strong><p>{channelId === "google" ? "iNrCy vérifie les longueurs de titres et descriptions avant la publication." : nativeSettings?.channel === "linkedin" ? "Le texte doit correspondre au format sponsorisé choisi, notamment si vous préparez un formulaire de prospects." : nativeSettings?.channel === "tiktok" ? "Gardez un texte court qui accompagne la vidéo et une action cohérente avec sa destination." : nativeSettings?.channel === "pinterest" ? "Le titre, la description et le visuel doivent présenter la même idée." : nativeSettings?.channel === "x" ? "Votre post doit être clair sans dépasser 280 caractères ; vérifiez le média si vous avez choisi image ou vidéo." : "Relisez la cohérence entre votre message, votre appel à l’action et le média choisi."}</p></aside>
        </div>
      </section>

      <section hidden={step !== mediaStep} data-channel={channelId} className={`${styles.card} ${styles.studioCard} ${styles.studioMediaCard}`}>
        <StudioStepHeader number={mediaStep + 1} label="MÉDIAS" title="Le bon visuel, au bon format." mobileTitle="Vos médias" channel={channelMeta.label} />
        <p className={`${styles.intro} ${styles.studioOptionalIntro}`}>Choisissez un média de votre médiathèque, importez-le ou laissez iNr’Studio créer le visuel adapté à cette campagne.</p>
        <div className={styles.studioGrid}>
          {nativeSettings?.channel === "linkedin" && <label className={styles.field}>Format sponsorisé<select value={nativeSettings.format} onChange={(event) => updateNativeSettings({ ...nativeSettings, format: event.target.value as LinkedInWizardSettings["format"] })}>{LINKEDIN_WIZARD_FORMATS[nativeSettings.objectiveType].map((format) => <option key={format} value={format}>{nativeBriefTerm(format)}</option>)}</select></label>}
          {nativeSettings?.channel === "pinterest" && <>
            <label className={styles.field}>Type de promotion<select value={nativeSettings.intendedPromotionType} onChange={(event) => {
              const intendedPromotionType = event.target.value as PinterestWizardSettings["intendedPromotionType"];
              updateNativeSettings({ ...nativeSettings, intendedPromotionType,
                creativeType: intendedPromotionType === "CATALOG" ? null : nativeSettings.objectiveType === "VIDEO_COMPLETION" ? "VIDEO" : "REGULAR" });
            }}><option value="STANDARD_AD">Épingle sponsorisée</option>{["CONSIDERATION", "SALES", "LEADS"].includes(nativeSettings.objectiveType) && <option value="CATALOG">Catalogue de produits</option>}</select></label>
            {nativeSettings.intendedPromotionType === "STANDARD_AD" && <label className={styles.field}>Format de l’épingle<select value={nativeSettings.creativeType || "REGULAR"} onChange={(event) => updateNativeSettings({ ...nativeSettings, creativeType: event.target.value as Exclude<PinterestWizardSettings["creativeType"], null> })}>{(nativeSettings.objectiveType === "VIDEO_COMPLETION" ? ["VIDEO", "MAX_VIDEO"] : ["REGULAR", "VIDEO", "MAX_VIDEO", "CAROUSEL"]).map((value) => <option key={value} value={value}>{nativeBriefTerm(value)}</option>)}</select></label>}
          </>}
          {nativeSettings?.channel === "x" && <label className={styles.field}>Format du post<select value={nativeSettings.format} onChange={(event) => updateNativeSettings({ ...nativeSettings, format: event.target.value as XWizardSettings["format"] })}>{(nativeSettings.objective === "video_views" ? ["video"] : ["text", "image", "video"]).map((value) => <option key={value} value={value}>{nativeBriefTerm(value)}</option>)}</select></label>}
          {nativeSettings ? <div className={styles.field}><span>Format prévu : {nativeWizardFormat(nativeSettings)}</span><small>{nativeSettings.channel === "tiktok" ? "Une vraie vidéo et une identité autorisée seront nécessaires dans TikTok Ads." : nativeSettings.channel === "pinterest" && nativeSettings.intendedPromotionType === "CATALOG" ? "Le catalogue et le groupe de produits seront sélectionnés dans Pinterest Ads." : nativeSettings.channel === "x" && nativeSettings.format === "text" ? "Aucun média n’est nécessaire pour le post texte." : "Choisissez un média cohérent ; ses droits et son format seront vérifiés avant toute publication."}</small></div> : googleSearchMedia ? <div className={styles.field}><span>Format prévu : annonce texte + image complémentaire</span><small>L’image est proposée à Google uniquement si vous l’ajoutez ou si iNr’Studio l’a générée.</small></div> : <label className={styles.field}>Média à utiliser<select value={draft.mediaStrategy} onChange={(event) => updateDraft({ mediaStrategy: event.target.value as AdsCampaignInput["mediaStrategy"] })}>{mediaStrategyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}
          {(nativeSettings === null || nativeMediaUpload) && !googleSearchMedia && <label className={styles.field}>Lien externe d’un média <small>Optionnel, HTTPS</small><input type="url" value={draft.creativeUrl || draft.imageUrl} onChange={(event) => updateDraft({ imageUrl: event.target.value, creativeUrl: event.target.value })} placeholder={nativeMediaStrategy === "video" ? "https://votresite.fr/video.mp4" : "https://votresite.fr/media.jpg"} /></label>}
          {nativeMediaStrategy !== "search_text" && <label className={`${styles.field} ${styles.studioWide}`}>Consignes pour vos médias<VoiceTextarea value={draft.mediaBrief} onChange={(mediaBrief) => updateDraft({ mediaBrief })} maxLength={1000} purpose="instruction" contextLabel="Consignes pour le média" placeholder="Style, produit, scène, preuves à montrer, format souhaité…" /></label>}
        </div>
        {(nativeSettings === null || nativeMediaUpload) && <div className={styles.campaignMediaWorkspace}>
          <div className={styles.campaignMediaWorkspaceHeading}><div><span>MÉDIAS DE CAMPAGNE</span><strong>{draft.creativeUrl ? "Un média est associé à cette campagne" : "Choisissez ou créez le média adapté"}</strong></div>{draft.creativeUrl ? <span data-type={draft.creativeType || "image"}>{draft.creativeType === "video" ? "Vidéo" : "Image"} prête</span> : <span>{nativeMediaStrategy === "video" ? "Vidéo à fournir" : nativeMediaStrategy === "image" ? "Image à fournir" : "Optionnel selon le format"}</span>}</div>
          <div className={styles.campaignMediaActions} data-three-actions={nativeMediaUpload || undefined}>
            {nativeMediaStrategy !== "video" && <button type="button" onClick={() => campaignImageInputRef.current?.click()} disabled={campaignMediaUploadBusy}><span aria-hidden="true">▧</span>{campaignMediaUploadBusy ? "Ajout en cours…" : "Ajouter une image"}</button>}
            {nativeMediaStrategy !== "image" && !googleSearchMedia && <button type="button" onClick={() => campaignVideoInputRef.current?.click()} disabled={campaignMediaUploadBusy}><span aria-hidden="true">▶</span>{campaignMediaUploadBusy ? "Ajout en cours…" : "Ajouter une vidéo"}</button>}
            <button type="button" className={styles.campaignMediaGenerate} onClick={() => setCampaignMediaStudioOpen(true)} disabled={campaignMediaUploadBusy}><span aria-hidden="true">✦</span> Générer</button>
            <button type="button" onClick={() => setCampaignMediaLibraryOpen(true)} disabled={campaignMediaUploadBusy}><span aria-hidden="true">▦</span> Médiathèque</button>
          </div>
          {googleSearchMedia && <p className={styles.campaignMediaFormatHint}>Google Search affiche d’abord une annonce textuelle. L’image carrée de votre médiathèque iNrCy sera jointe comme composant de campagne à la publication ; son affichage dépend de l’éligibilité du compte et de la validation par Google. Dans iNr’Studio, choisissez le format image, sans texte ni logo incrusté.</p>}
          {draft.creativeUrl && <div className={styles.campaignMediaAttached}><span aria-hidden="true">✓</span><div><strong>Média associé à la campagne</strong><small>{draft.creativeType === "video" ? "Vidéo" : "Image"} stockée dans votre médiathèque iNrCy ou liée depuis votre site.</small></div><a href={draft.creativeUrl} target="_blank" rel="noreferrer">Voir ↗</a><button type="button" onClick={() => updateDraft({ creativeUrl: "", imageUrl: "" })}>Retirer</button></div>}
          {campaignMediaUploadError && <p className={styles.campaignMediaError} role="alert">{campaignMediaUploadError}</p>}
          <input ref={campaignImageInputRef} type="file" accept="image/*" hidden onChange={(event) => void handleCampaignMediaUpload(event, "image")} />
          <input ref={campaignVideoInputRef} type="file" accept="video/*" hidden onChange={(event) => void handleCampaignMediaUpload(event, "video")} />
        </div>}
      </section>

      <section hidden={step !== deliveryStep} data-channel={channelId} className={`${styles.card} ${styles.studioCard} ${styles.studioDeliveryCard}`}>
        <StudioStepHeader number={deliveryStep + 1} label="DIFFUSION" title="Où envoyer et comment mesurer." mobileTitle="Votre diffusion" channel={channelMeta.label} />
        <p className={styles.intro}><span className={styles.studioTitleLong}>Préparez le parcours après le clic : une destination claire, l’action attendue et les paramètres utiles. Rien n’est encore diffusé.</span><span className={styles.studioTitleShort}>Aucune diffusion avant votre validation.</span></p>
        <div className={styles.studioGrid}>
          {(nativeSettings?.channel !== "tiktok" || nativeSettings.destinationKind === "website") && <label className={`${styles.field} ${styles.studioWide}`}>Lien de redirection<input type="url" value={draft.destinationUrl} onChange={(event) => updateDraft({ destinationUrl: event.target.value })} placeholder="https://votresite.fr/offre" /><small>Une page HTTPS claire et cohérente avec votre annonce.</small></label>}
          {nativeSettings?.channel === "tiktok" && <>
            <label className={styles.field}>Destination TikTok<select value={nativeSettings.destinationKind} onChange={(event) => updateNativeSettings({ ...nativeSettings, destinationKind: event.target.value as TikTokWizardSettings["destinationKind"] })}><option value="website">Site web</option>{nativeSettings.objectiveType === "LEAD_GENERATION" && <option value="instant_form">Formulaire intégré</option>}{["REACH", "VIDEO_VIEWS", "ENGAGEMENT"].includes(nativeSettings.objectiveType) && <option value="profile">Profil TikTok</option>}</select></label>
            <div className={styles.field}><span>Optimisation : {nativeBriefTerm(nativeSettings.optimizationIntent)}</span><small>Pour cet objectif, le Pixel ou formulaire devra être confirmé dans TikTok Ads si une conversion est prévue.</small></div>
            <label className={styles.field}>Emplacements envisagés<select value={nativeSettings.placementIntent} onChange={(event) => updateNativeSettings({ ...nativeSettings, placementIntent: event.target.value as TikTokWizardSettings["placementIntent"] })}><option value="tiktok_only">TikTok uniquement</option><option value="automatic">Placements automatiques</option></select><small>La disponibilité sera vérifiée dans le compte annonceur.</small></label>
          </>}
          {nativeSettings?.channel === "pinterest" && (nativeSettings.objectiveType === "SALES" || nativeSettings.objectiveType === "LEADS") && <label className={styles.field}>Événement Pinterest<select value={nativeSettings.conversionEvent || ""} onChange={(event) => updateNativeSettings({ ...nativeSettings, conversionEvent: event.target.value as Exclude<PinterestWizardSettings["conversionEvent"], null> })}>{(nativeSettings.objectiveType === "SALES" ? ["CHECKOUT", "ADD_TO_CART"] : ["LEAD", "SIGNUP"]).map((value) => <option key={value} value={value}>{nativeBriefTerm(value)}</option>)}</select><small>La balise et l’événement réels seront vérifiés dans Pinterest Ads.</small></label>}
          {nativeSettings && <label className={styles.field}>Action souhaitée<select value={draft.conversionGoal} onChange={(event) => updateDraft({ conversionGoal: event.target.value as AdsCampaignInput["conversionGoal"] })}>{CONVERSION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}
          {!nativeSettings && <label className={styles.field}>Lieu de conversion<select value={draft.conversionLocation} onChange={(event) => updateDraft({ conversionLocation: event.target.value as AdsCampaignInput["conversionLocation"] })}>{CONVERSION_LOCATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label} — {option.detail}</option>)}</select></label>}
          <label className={styles.field}>Balises de suivi <small>Optionnel</small><input value={draft.trackingParameters} maxLength={500} onChange={(event) => updateDraft({ trackingParameters: event.target.value })} placeholder="utm_source=google&utm_campaign=devis" /></label>
          {nativeSettings?.channel === "linkedin" && <aside className={`${styles.studioKeywordGuidance} ${styles.studioWide}`}><strong>{nativeSettings.objectiveType === "LEAD_GENERATION" ? "Formulaire LinkedIn à préparer" : nativeSettings.objectiveType === "WEBSITE_CONVERSION" ? "Mesure du site à confirmer" : "Destination de l’annonce"}</strong><p>{nativeSettings.objectiveType === "LEAD_GENERATION" ? "Le formulaire de prospects doit appartenir à l’organisation et sera choisi dans le compte LinkedIn Ads." : nativeSettings.objectiveType === "WEBSITE_CONVERSION" ? "La conversion et l’Insight Tag devront être vérifiés dans le compte LinkedIn Ads." : "Le lien et l’action voulue restent une intention tant qu’aucune création publicitaire n’a été vérifiée."}</p></aside>}
          {nativeSettings?.channel === "x" && <aside className={`${styles.studioKeywordGuidance} ${styles.studioWide}`}><strong>Mesure X à confirmer</strong><p>{nativeSettings.objective === "website_conversions" ? "Une source de conversion X valide devra être reliée au compte publicitaire." : "Les résultats réels ne seront visibles qu’après création et validation dans X Ads."}</p></aside>}
          {channelId === "google" && <label className={`${styles.check} ${styles.studioWide}`}><input type="checkbox" checked={draft.urlExpansion} onChange={(event) => updateDraft({ urlExpansion: event.target.checked })} />Autoriser l’utilisation de pages pertinentes de mon site lorsque le format de campagne le permet.</label>}
          {channelId === "google" && <label className={`${styles.field} ${styles.studioWide}`}>Pages à exclure <small>Une URL HTTPS par ligne, optionnel</small><textarea rows={3} value={editableList(draft.urlExclusions)} onChange={(event) => updateDraft({ urlExclusions: parseEditableList(event.target.value.split("\n")) })} placeholder="https://votresite.fr/mentions-legales" /></label>}
          {channelId === "google" && <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}><legend>Réseaux Google</legend><p>Choisissez les surfaces envisagées. Le budget reste défini à l’étape suivante.</p><div className={styles.studioControlOptions}><label><input type="checkbox" checked={draft.googleSearchPartners} onChange={(event) => updateDraft({ googleSearchPartners: event.target.checked })} />Partenaires du Réseau de Recherche</label><label><input type="checkbox" checked={draft.googleDisplayExpansion} onChange={(event) => updateDraft({ googleDisplayExpansion: event.target.checked })} />Extension Display lorsque pertinente</label></div></fieldset>}
          {channelId === "meta" && <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}><legend>Placements Meta</legend><p>Choisissez les emplacements adaptés à votre média. Le connecteur disponible peut imposer une sélection plus restreinte.</p><div className={styles.studioControlOptions}>{META_PLACEMENT_OPTIONS.map((option) => <label key={option.value}><input type="checkbox" checked={draft.metaPlacements.includes(option.value)} onChange={(event) => updateDraft({ metaPlacements: event.target.checked ? Array.from(new Set([...draft.metaPlacements, option.value])) : draft.metaPlacements.filter((placement) => placement !== option.value) })} />{option.label}</label>)}</div></fieldset>}
        </div>
      </section>

      <section hidden={step !== budgetStep} data-channel={channelId} className={`${styles.card} ${styles.studioCard} ${styles.studioBudgetCard}`}>
        <StudioStepHeader number={budgetStep + 1} label="BUDGET" title="Votre investissement, en clair." mobileTitle="Votre budget" channel={channelMeta.label} />
        <p className={styles.intro}><span className={styles.studioTitleLong}>Choisissez le rythme d’investissement et la durée. Les repères ci-dessous estiment une enveloppe de dépense : ils ne promettent ni clics, ni prospects, ni ventes.</span><span className={styles.studioTitleShort}>Estimation indicative, sans promesse de résultat.</span></p>
        <div className={styles.studioGrid}>
          <label className={styles.field}>Budget quotidien moyen (€)<input type="number" min="5" max="500" step="0.01" value={draft.dailyBudgetEuros} onChange={(event) => updateDraft({ dailyBudgetEuros: Number(event.target.value) })} /></label>
          <label className={styles.field}>Date de fin<input type="date" value={draft.endDate} onChange={(event) => updateDraft({ endDate: event.target.value })} /></label>
          {!nativeSettings && <label className={`${styles.field} ${styles.studioWide}`}>Stratégie de diffusion<select value={draft.bidStrategy} onChange={(event) => updateDraft({ bidStrategy: event.target.value as AdsCampaignInput["bidStrategy"] })}>{BID_STRATEGY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}
        </div>
        <div className={styles.studioBudgetForecast} aria-label="Repères budgétaires">
          <div className={styles.studioBudgetForecastCard}><span>Budget quotidien</span><strong>{Number(draft.dailyBudgetEuros || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}</strong><small>moyenne planifiée</small></div>
          <div className={styles.studioBudgetForecastCard}><span>Durée prévue</span><strong>{estimatedCampaignDays ? `${estimatedCampaignDays} j` : "—"}</strong><small>jusqu’à la date de fin</small></div>
          <div className={styles.studioBudgetForecastCard}><span>Enveloppe estimée</span><strong>{Number.isFinite(estimate) ? estimate.toLocaleString("fr-FR", { style: "currency", currency: "EUR" }) : "—"}</strong><small>budget × durée</small></div>
          {nativeSettings ? <div className={styles.studioBudgetForecastCard}><span>Statut</span><strong>Brouillon</strong><small>Aucune dépense engagée</small></div> : <div className={styles.studioBudgetForecastCard}><span>Optimisation</span><strong>{BID_STRATEGY_OPTIONS.find((option) => option.value === draft.bidStrategy)?.label || "À définir"}</strong><small>pilotée par la plateforme</small></div>}
        </div>
        <div className={styles.studioBudgetPanel}><div><span>À retenir</span><strong>Vous gardez la main.</strong></div><p>{channelId === "google" ? "Google Ads gère la facturation. Son budget quotidien est une moyenne : la dépense peut varier d’un jour à l’autre." : channelId === "meta" ? "Meta gère la facturation. Cette projection est indicative ; vérifiez les règles de dépense de votre compte avant toute diffusion." : "Aucune dépense n’est engagée tant que ce canal reste en préparation."}</p></div>
      </section>

      <section hidden={step !== validationStep} data-channel={channelId} className={`${styles.card} ${styles.studioCard} ${styles.studioValidationCard}`}>
        <StudioStepHeader number={validationStep + 1} label="VOTRE CONTRÔLE" title="Votre campagne, vos décisions." mobileTitle="Validation" channel={channelMeta.label} />
        <p className={styles.intro}><span className={styles.studioTitleLong}>Relisez cette proposition avant tout enregistrement. Une campagne ne peut être diffusée qu’après votre validation explicite et celle de la plateforme.</span><span className={styles.studioTitleShort}>Diffusion après votre accord et celui de la plateforme.</span></p>
        {channelId === "meta" && <label className={`${styles.check} ${styles.studioCompliance}`}><input type="checkbox" checked={draft.noSpecialCategoryConfirmed} onChange={(event) => updateDraft({ noSpecialCategoryConfirmed: event.target.checked })} />Je confirme que cette annonce ne concerne aucune catégorie spéciale Meta (crédit, emploi, logement ou enjeux sociaux/politiques).</label>}
        {channelId === "google" && <label className={`${styles.check} ${styles.studioCompliance}`}><input type="checkbox" checked={draft.notEuPoliticalConfirmed} onChange={(event) => updateDraft({ notEuPoliticalConfirmed: event.target.checked })} />Je certifie que cette campagne ne contient pas de publicité politique ciblant l’Union européenne.</label>}
        <dl className={styles.studioReviewGrid}>
          <div><dt>Campagne</dt><dd>{draft.name || "À renseigner"}</dd><small>{nativeSettings ? `${nativeBriefTerm(nativeWizardObjective(nativeSettings))} · ${nativeWizardFormat(nativeSettings)}` : `${selectedCampaignType?.label || channelMeta.label} · ${OBJECTIVE_OPTIONS.find((option) => option.value === draft.objective)?.label}`}</small></div>
          <div><dt>Compte / canal</dt><dd>{channelMeta.label} · {isAdsProvider(channelId) ? associatedAccountName || "À configurer" : activeExternalStatus?.selectedAccountId ? activeExternalStatus.selectedAccountName || activeExternalStatus.selectedAccountId : "À associer"}</dd><small>{reviewAccountReady ? "Compte annonceur associé" : configuredAccountId ? "Compte associé · accès à vérifier" : "Associez un compte pour créer la démo en pause"}</small></div>
          <div><dt>Objectif mesuré</dt><dd>{CONVERSION_OPTIONS.find((option) => option.value === draft.conversionGoal)?.label}</dd><small>{draft.targetLocations.length ? `${draft.targetLocations.length} zone${draft.targetLocations.length > 1 ? "s" : ""} ciblée${draft.targetLocations.length > 1 ? "s" : ""}` : "Zones à préciser"}</small></div>
          <div><dt>Investissement</dt><dd>{draft.dailyBudgetEuros.toLocaleString("fr-FR")} € / jour</dd><small>Fin prévue : {draft.endDate || "à préciser"}</small></div>
          <div><dt>Redirection</dt><dd>{draft.destinationUrl || "À renseigner"}</dd><small>{draft.keywords.length ? `${draft.keywords.length} signaux / mots-clés préparés` : "Mots-clés ou audiences à compléter"}</small></div>
          <div><dt>Médias &amp; message</dt><dd>{MEDIA_STRATEGY_OPTIONS.find((option) => option.value === draft.mediaStrategy)?.label}</dd><small>{draft.callToAction || "Appel à l’action à définir"}</small></div>
          <div><dt>Conversion &amp; suivi</dt><dd>{CONVERSION_LOCATION_OPTIONS.find((option) => option.value === draft.conversionLocation)?.label}</dd><small>{draft.trackingParameters || "Aucune balise de suivi ajoutée"}</small></div>
          <div><dt>Diffusion avancée</dt><dd>{channelId === "meta" ? (draft.metaPlacements.length ? `${draft.metaPlacements.length} placement${draft.metaPlacements.length > 1 ? "s" : ""}` : "Placements à choisir") : channelId === "google" ? "Langue déduite des annonces et du site" : nativeSettings?.channel === "linkedin" ? nativeBriefTerm(nativeSettings.targetingFacet) : nativeSettings?.channel === "tiktok" ? nativeBriefTerm(nativeSettings.placementIntent) : nativeSettings?.channel === "pinterest" || nativeSettings?.channel === "x" ? nativeBriefTerm(nativeSettings.targetingMode) : "Préparation complète"}</dd><small>{channelId === "meta" ? (draft.metaAudienceExpansion ? "Expansion d’audience autorisée" : "Audience strictement contrôlée") : channelId === "google" ? (draft.googleSearchPartners ? "Partenaires de recherche inclus" : "Réseau Google principal") : nativeSettings?.channel === "tiktok" ? `Destination : ${nativeBriefTerm(nativeSettings.destinationKind)} · Optimisation : ${nativeBriefTerm(nativeSettings.optimizationIntent)}` : nativeSettings?.channel === "pinterest" && nativeSettings.conversionEvent ? `Événement : ${nativeBriefTerm(nativeSettings.conversionEvent)}` : "Choix à vérifier sur la plateforme"}</small></div>
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
        {!isAdsProvider(channelId) ? <p className={styles.draftOnlyWarning}><strong>Brouillon uniquement pour le moment</strong>Vous pouvez connecter et associer votre compte {channelMeta.label}, puis enregistrer cette campagne. La publication sur ce canal n’est pas encore activée : aucune diffusion ni dépense média ne sera déclenchée.{draft.creationMode === "inrcy" && !draft.channelDraft && <span className={styles.studioNativeBriefMissing}>Vos modifications ont désynchronisé le brief spécifique de {channelMeta.label}. Le brouillon simple reste disponible. <button type="button" disabled={busy !== null} onClick={() => { if (!window.confirm("Relancer l’analyse iNrCy ? La nouvelle proposition remplacera vos réglages actuels et pourra générer un nouveau média.")) return; setStep(analysisStep); void generateCampaignPlan(); }}>Recréer le brief IA</button></span>}</p> : !liveFormatAvailable ? <p className={styles.studioReadiness}><strong>Préparation complète, publication de ce format à venir</strong>{channelId === "google" ? "iNr’ADS prépare tous les réglages nécessaires à ce type de campagne. La publication automatisée disponible aujourd’hui est la campagne Réseau de recherche." : "iNr’ADS prépare ce format et conserve votre brouillon. La publication automatisée actuellement disponible concerne la campagne Trafic Meta."}</p> : !livePublisherConversionReady ? <p className={styles.studioReadiness}><strong>Conservez ce parcours dans votre brouillon</strong>Le connecteur de diffusion disponible aujourd’hui envoie les prospects vers votre site web. Votre choix de conversion est bien sauvegardé et sera repris dès que son connecteur dédié sera activé.</p> : !metaLiveObjectiveSupported ? <p className={styles.studioReadiness}><strong>Choisissez l’objectif Trafic vers le site web</strong>Le premier connecteur Meta disponible construit une campagne orientée trafic qualifié vers votre site. Les objectifs Leads, Ventes et Notoriété restent enregistrés dans votre brouillon pour leurs connecteurs dédiés.</p> : !metaLiveGoalSupported ? <p className={styles.studioReadiness}><strong>Mesurez une visite de page clé</strong>Le connecteur Trafic Meta disponible mesure actuellement les visites de votre site web. Vos autres objectifs de conversion restent sauvegardés dans votre brouillon.</p> : !metaLivePlacementsSupported ? <p className={styles.studioReadiness}><strong>Vos placements sont bien préparés</strong>La première diffusion Trafic Meta disponible utilise les fils Facebook et Instagram ensemble. Stories, Reels et Messenger restent enregistrés dans votre brouillon pour le connecteur dédié.</p> : !metaLiveCreativeSupported ? <p className={styles.studioReadiness}><strong>Choisissez le format image</strong>Le connecteur Trafic Meta disponible utilise actuellement une image. Vos autres formats restent enregistrés dans le brouillon.</p> : !metaLiveCtaSupported ? <p className={styles.studioReadiness}><strong>Utilisez l’appel à l’action « En savoir plus »</strong>Le premier connecteur Trafic Meta utilise cet appel à l’action pour conserver exactement le message que vous avez validé.</p> : !livePublisherMediaReady ? <p className={styles.studioReadiness}><strong>Ajoutez votre image avant la diffusion</strong>{googleSearchMedia ? "La campagne assistée Google Search attend l’image complémentaire promise par l’analyse. Générez-la ou choisissez-la dans la médiathèque iNrCy." : "Le connecteur Trafic Meta actuellement disponible utilise un visuel image. Vous pouvez en générer un avec iNr’Studio, en importer un ou le choisir dans la médiathèque."}</p> : <>
          {connectorConfigurationIssue && <p className={styles.studioReadiness}><strong>Réglage à adapter avant publication</strong>{connectorConfigurationIssue}</p>}
          {!connectorConfigurationIssue && demoPausedPublishingEnabled && <p className={styles.warning}><strong>Démo en pause</strong>Cette action crée les éléments chez {channelMeta.label} en pause, sans demander leur activation. Vérifiez leur état dans le compte publicitaire après la création.</p>}
          {!connectorConfigurationIssue && !livePublishingEnabled && <p className={styles.warning}><strong>Publication bientôt disponible</strong>Vous pouvez préparer et enregistrer la campagne. La diffusion réelle n’est pas encore activée.</p>}
        </>}
        <div className={styles.studioFinalActions} data-channel={channelId}>
          {isAdsProvider(channelId) && demoPausedPublishingEnabled && <button type="button" className={channelId === "google" ? `${styles.primaryButton} ${styles.studioDemoCampaignButton}` : styles.primaryButton} disabled={busy !== null} onClick={() => void createPausedDemo()}>{busy === "demo" ? "Création de la démo…" : "Créer une démo en pause"} <span aria-hidden="true">↗</span></button>}
          <button type="button" className={channelId === "google" && !demoPausedPublishingEnabled ? `${styles.primaryButton} ${styles.studioDemoCampaignButton}` : styles.secondaryButton} disabled={busy !== null} onClick={() => void saveDraft()}>{busy === "save" ? "Enregistrement…" : savedId && dirty ? "Mettre à jour le brouillon iNrCy" : savedId ? "Brouillon iNrCy enregistré" : "Garder en brouillon iNrCy"}</button>
        </div>
        {isAdsProvider(channelId) && livePublisherSetupReady && livePublishingEnabled && <><label className={`${styles.check} ${styles.studioFinalCheck}`}><input type="checkbox" checked={confirmedSpend} onChange={(event) => setConfirmedSpend(event.target.checked)} />Je valide le compte, le texte, la destination, la date de fin et la facturation directe par {channelId === "meta" ? "Meta" : "Google"}.</label><button type="button" className={styles.primaryButton} disabled={channelId !== provider || !savedId || dirty || !channelAccountReady || !livePublisherMediaReady || !confirmedSpend || busy !== null} onClick={() => void publish()}>{busy === "publish" ? "Publication en cours…" : `Publier sur ${channelMeta.label}`} <span aria-hidden="true">↗</span></button></>}
      </section>
      {creationPath !== "choice" && <div className={styles.wizardNavigation}><button type="button" className={styles.back} disabled={step === 0 || busy === "plan"} onClick={() => { if (creationPath === "inrcy" && step === analysisStep) { stopPlanProgress(); setCreationPath("choice"); setAnalysisSetupOpen(true); setStep(0); return; } setStep((current) => current - 1); }}>← Précédent</button><span>{step + 1} / {stepNames.length}</span>{step < lastStep ? <button type="button" className={`${styles.headerCta} ${analysisProposalReady ? styles.studioProposalReadyCta : ""}`} disabled={busy === "plan" || (creationPath === "inrcy" && step === analysisStep && planProgress !== 100)} onClick={() => setStep((current) => current + 1)}>{creationPath === "inrcy" && step === analysisStep ? planProgress === 100 ? "Contrôler ma proposition →" : "Proposition en cours…" : "Suivant →"}</button> : <button type="button" className={styles.back} onClick={closeCampaignCreation}>Revenir au cockpit</button>}</div>}
      </div>
      </SettingsDrawer>

      <SettingsDrawer title="Suivi des campagnes" isOpen={tracking} onClose={() => setTracking(false)} presentation="centered" headerLead="Retrouvez vos campagnes et reprenez vos brouillons." headerStyle={{ background: "radial-gradient(ellipse at 20% 0, #246bbd70, transparent 60%), linear-gradient(100deg, #172e5a, #392464 65%, #772b75)", borderBottom: "1px solid #c68aff66", boxShadow: "0 8px 35px #8a4ce52b", minHeight: 76 }} headerContent={<div className={styles.trackingTitle}><span aria-hidden="true">↗</span> Suivi des campagnes</div>}>
        <AdsCampaignTracking campaigns={campaigns} total={campaignTotal} loading={campaignsLoading} loadingMore={campaignsLoadingMore} hasMore={campaignNextOffset !== null} loadError={campaignsLoadError} onRefresh={loadCampaigns} onLoadMore={loadMoreCampaigns} onClose={() => setTracking(false)} onEdit={reopen} />
      </SettingsDrawer>
    </div>
    <AdsConnectionSettings
      isOpen={configuring}
      provider={provider}
      onSelectProvider={changeProvider}
      onClose={() => setConfiguring(false)}
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
      configuredPageId={configuredPageId}
      onSelectAccount={(id) => updateDraft({ adAccountId: id, accountCurrency: "EUR" })}
      onSelectPage={(id) => updateDraft({ pageId: id })}
      onRefreshAccounts={() => setAccountsRefreshKey((key) => key + 1)}
      onSaveAccount={() => void saveAccountSelection()}
      onClearAccount={() => void clearSavedSelection("account")}
      onSavePage={() => void savePageSelection()}
      onClearPage={() => void clearSavedSelection("identity")}
      onDisconnect={() => void disconnectAdsConnection()}
    />
    <SettingsDrawer
      title={`Configurer ${channelMeta.label}`}
      isOpen={externalConfiguring && isExternalChannel(channelId)}
      onClose={() => { setExternalConfiguring(false); setExternalError(""); }}
      presentation="centered"
      headerLead="Associez le compte publicitaire que vous souhaitez utiliser."
      headerStyle={{ background: "radial-gradient(ellipse at 20% 0, #246bbd70, transparent 60%), linear-gradient(100deg, #172e5a, #392464 65%, #772b75)", borderBottom: "1px solid #c68aff66", minHeight: 76 }}
      headerContent={<div className={styles.externalSettingsTitle}><span className={styles.externalSettingsLogo}><Image src={channelMeta.logo} width={30} height={30} alt="" /></span> Configurer {channelMeta.label}</div>}
    >
      {isExternalChannel(channelId) && activeExternalStatus && <div className={styles.externalSettings}>
        <div className={styles.externalSettingsIntro}>
          <span>VOTRE ESPACE PUBLICITAIRE</span>
          <h2>{channelMeta.label}, prêt pour votre prochaine campagne.</h2>
          <p>Autorisez l’accès, puis choisissez vous-même le compte annonceur à associer. Ce choix reste enregistré jusqu’à ce que vous le changiez ou le déconnectiez.</p>
        </div>
        <div className={styles.externalSettingsGrid}>
          <section className={styles.externalSettingsPanel}>
            <header><span>01</span><div><h3>Votre connexion</h3><p>Autorisation sécurisée du canal publicitaire</p></div></header>
            <div className={styles.externalSettingsPanelBody}>
              <span className={styles.channelStatus} data-status={externalStatusDisplay(activeExternalStatus).tone}>{externalStatusDisplay(activeExternalStatus).label}</span>
              {activeExternalStatus.load === "loading" ? <p>Lecture de la connexion enregistrée…</p>
                : activeExternalStatus.load === "error" ? <><p>{activeExternalStatus.error}</p><button type="button" className={styles.externalSecondaryButton} onClick={() => void refreshExternalStatus(channelId)}>Réessayer</button></>
                : !activeExternalStatus.configured ? <p>La connexion {channelMeta.label} doit être activée côté application avant son utilisation.</p>
                : activeExternalStatus.connected ? <>
                  <p>L’accès à {channelMeta.label} est autorisé. Vous pouvez consulter les comptes disponibles et en associer un explicitement.</p>
                  <div className={styles.externalSettingsActions}>
                    <a className={styles.externalSecondaryButton} href={`/api/ads/${channelId}/start${channelId === "linkedin" ? "?access=read" : ""}`}>Actualiser la connexion</a>
                    {EXTERNAL_DISCONNECT_CHANNELS.includes(channelId) && <button type="button" className={styles.externalDestructiveButton} disabled={externalAction !== null} onClick={() => void disconnectExternalChannel()}>{externalAction === "disconnect" ? "Déconnexion…" : "Déconnecter"}</button>}
                  </div>
                </> : <>
                  <p>Connectez votre espace {channelMeta.label} pour afficher les comptes annonceurs accessibles.</p>
                  <a className={styles.externalPrimaryButton} href={`/api/ads/${channelId}/start${channelId === "linkedin" ? "?access=read" : ""}`}>{activeExternalStatus.status === "needs_update" || activeExternalStatus.status === "needs_reconnect" ? "Reconnecter" : "Connecter"} {channelMeta.label} <span aria-hidden="true">↗</span></a>
                </>}
            </div>
          </section>
          <section className={styles.externalSettingsPanel}>
            <header><span>02</span><div><h3>Compte annonceur</h3><p>Votre choix est enregistré séparément de la connexion</p></div></header>
            <div className={styles.externalSettingsPanelBody}>
              {activeExternalStatus.selectedAccountId && activeExternalStatus.connected && <div className={styles.externalAssociatedAccount}><small>Compte associé</small><strong>{externalAccounts.find((account) => account.id === activeExternalStatus.selectedAccountId)?.name || activeExternalStatus.selectedAccountName || activeExternalStatus.selectedAccountId}</strong></div>}
              {!activeExternalStatus.connected ? <p>Connectez d’abord {channelMeta.label} pour choisir votre compte publicitaire.</p>
                : externalAccountsLoading ? <p>Chargement des comptes accessibles…</p>
                : externalAccountsLoadFailed ? <><p>La liste des comptes n’a pas pu être chargée.</p><button type="button" className={styles.externalSecondaryButton} onClick={() => void loadExternalAccounts(channelId, activeExternalStatus.selectedAccountId)}>Réessayer</button></>
                : externalAccounts.length === 0 ? <><p>Aucun compte annonceur accessible pour le moment.</p><button type="button" className={styles.externalSecondaryButton} onClick={() => void loadExternalAccounts(channelId, activeExternalStatus.selectedAccountId)}>Recharger mes comptes</button></>
                : <>
                  <label className={styles.externalAccountLabel} htmlFor="external-ad-account">Compte à associer</label>
                  <select id="external-ad-account" className={styles.externalAccountSelect} value={externalAccountChoice} onChange={(event) => setExternalAccountChoice(event.target.value)}>
                    <option value="">Choisir un compte</option>
                    {activeExternalStatus.selectedAccountId && !externalAccounts.some((account) => account.id === activeExternalStatus.selectedAccountId) && <option value={activeExternalStatus.selectedAccountId}>{activeExternalStatus.selectedAccountName || `Compte ${activeExternalStatus.selectedAccountId}`} · déjà associé</option>}
                    {externalAccounts.map((account) => <option key={account.id} value={account.id} disabled={account.eligibleToAssociate === false || (channelId === "tiktok" && account.currency !== "EUR")}>{account.name} · {account.id}{account.currency ? ` · ${account.currency}` : ""}{account.eligibleToAssociate === false ? " · accès insuffisant" : channelId === "tiktok" && account.currency !== "EUR" ? " · euros requis" : ""}</option>)}
                  </select>
                  <button type="button" className={styles.externalPrimaryButton} disabled={!externalAccountChoice || externalAccountChoice === activeExternalStatus.selectedAccountId || externalAction !== null} onClick={() => void associateExternalAccount()}>{externalAction === "associate" ? "Association…" : "Associer ce compte"}</button>
                </>}
            </div>
          </section>
        </div>
        {externalError && <p role="alert" className={styles.externalSettingsError}>{externalError}</p>}
        <p className={styles.externalSettingsFootnote}>La préparation et l’enregistrement des campagnes sont disponibles. La publication sur {channelMeta.label} n’est pas encore activée : aucune annonce n’est diffusée depuis cet écran.</p>
      </div>}
    </SettingsDrawer>
    {creating && autoMediaPlan && (
      <AdsCampaignAutoMediaGenerator
        key={`${autoMediaPlan.campaignType}-${autoMediaPlan.name}-${autoMediaPlan.mediaBrief}`}
        provider={channelId}
        plan={autoMediaPlan}
        onProgress={(progress) => {
          setAutoMediaState("generating");
          setAutoMediaMessage(`iNr’Studio crée ${channelId === "google" && autoMediaPlan.campaignType === "search" ? "l’image complémentaire Google Search" : "le média de la campagne"} · ${Math.min(99, Math.max(4, Math.round(progress)))} %`);
          setPlanProgress((current) => Math.max(current, Math.min(99, 90 + Math.round(progress / 10))));
        }}
        onComplete={(result) => {
          if (!result.item.signed_url) {
            setAutoMediaState("error");
            setAutoMediaMessage("La campagne est prête, mais le média généré ne peut pas encore être associé. Vous pourrez en ajouter un à l’étape Médias.");
          } else {
            applyCampaignMedia(result.item);
            setAutoMediaState("ready");
            setAutoMediaMessage(channelId === "google" && autoMediaPlan.campaignType === "search"
              ? "iNr’Studio a créé et associé une image pour Google Search. Elle sera proposée comme composant image lors de la publication, sous réserve d’éligibilité et de validation par Google."
              : "iNr’Studio a généré et associé le média de cette campagne. Vous pourrez le remplacer, l’éditer ou le retirer à tout moment.");
          }
          setPlanProgress(100);
          setAutoMediaPlan(null);
          setBusy(null);
        }}
        onSkip={(reason) => {
          setAutoMediaState("skipped");
          setAutoMediaMessage(reason);
          setPlanProgress(100);
          setAutoMediaPlan(null);
          setBusy(null);
        }}
        onError={(message) => {
          setAutoMediaState("error");
          setAutoMediaMessage(`La campagne est préparée, mais iNr’Studio n’a pas pu créer le média : ${message} Vous pourrez en ajouter un à l’étape Médias.`);
          setPlanProgress(100);
          setAutoMediaPlan(null);
          setBusy(null);
        }}
      />
    )}
    <MediaLibraryPickerModal
      open={campaignMediaLibraryOpen}
      title="Ajouter un média à la campagne"
      subtitle="Choisissez une image ou une vidéo déjà disponible dans votre médiathèque iNrCy. Elle sera immédiatement associée à cette campagne."
      accept={googleSearchMedia ? "image" : "all"}
      multiple={false}
      maxSelection={1}
      confirmLabel="Ajouter à la campagne"
      onClose={() => setCampaignMediaLibraryOpen(false)}
      onConfirm={(items) => {
        const item = items[0];
        if (item) applyCampaignMedia(item);
      }}
    />
    <MediaGeneratorModal
      open={campaignMediaStudioOpen}
      embedded
      source="studio"
      origin="ads"
      initialTab="generate"
      initialMediaType={googleSearchMedia ? "image" : draft.mediaStrategy === "video" || draft.creativeType === "video" ? "video" : "image"}
      imageOnly={googleSearchMedia}
      freeOnly={googleSearchMedia}
      initialFreePrompt={googleSearchMedia ? googleSearchImageSubjectPrompt(draft) : ""}
      requiredFreePromptSuffix={googleSearchMedia ? GOOGLE_SEARCH_IMAGE_REQUIREMENTS : ""}
      fixedFreeFormat={googleSearchMedia ? "square" : undefined}
      publicationBrief={[draft.mediaBrief, draft.offer, draft.primaryText, draft.callToAction].filter(Boolean).join(". ").slice(0, 1_800)}
      acceptMode="insert"
      handoffOriginLabel="iNr’ADS"
      onClose={() => setCampaignMediaStudioOpen(false)}
      onAccepted={handleGeneratedCampaignMedia}
    />
  </main>;
}
