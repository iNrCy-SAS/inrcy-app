"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import SettingsDrawer from "@/app/dashboard/SettingsDrawer";
import MediaGeneratorModal from "@/app/dashboard/_components/MediaGeneratorModal";
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
import { ADS_PAUSED_DEMO_CONFIRMATION } from "@/lib/adsPublishMode";
import type { AdsCampaignPlan } from "@/lib/adsCampaignPlan";
import type { ConnectionDisplayStatus } from "@/lib/connectionVersions";
import AdsConnectionSettings from "./AdsConnectionSettings";
import AdsCampaignAutoMediaGenerator from "./AdsCampaignAutoMediaGenerator";
import styles from "./ads.module.css";

type StoredCampaign = {
  id: string;
  provider: AdsChannelId;
  name: string;
  status: "draft" | "publishing" | "active" | "needs_review" | "demo_paused";
  draft: AdsCampaignInput;
  last_error: string | null;
  created_at: string;
};

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
  selectedPageId?: string;
  error?: string;
};

// Every channel can be prepared here. Only Meta and Google currently support account connection/publishing.
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
    objective: "leads",
    conversionGoal: "quote_request",
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
    mediaStrategy: provider === "google" ? "search_text" : provider === "tiktok" ? "video" : "image",
    mediaBrief: "",
    callToAction: "Demander un devis",
    pageId: "",
    headlines: [],
    descriptions: [],
    keywords: [],
    negativeKeywords: [],
    noSpecialCategoryConfirmed: false,
    notEuPoliticalConfirmed: false,
  };
}

async function readJson(response: Response) {
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = String(data.error || "Le service est momentanément indisponible. Réessayez dans un instant.");
    throw new Error(/migration|stockage|relation .* does not exist/i.test(message) ? "L’enregistrement des campagnes sera bientôt disponible. Vous pouvez déjà préparer vos messages." : message);
  }
  return data;
}

function editableList(items: string[]) { return items.join("\n"); }
function parseEditableList(text: string[]) { return text.map((value) => value.trim()).filter(Boolean); }

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
  const [configuredPageId, setConfiguredPageId] = useState("");
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [accountsRefreshKey, setAccountsRefreshKey] = useState(0);
  const [configAction, setConfigAction] = useState<AdsConfigAction>(null);
  const [campaigns, setCampaigns] = useState<StoredCampaign[]>([]);
  const [tracking, setTracking] = useState(false);
  const [brief, setBrief] = useState("");
  const [brand, setBrand] = useState("");
  const [busy, setBusy] = useState<CampaignBusyAction>(null);
  const [confirmedSpend, setConfirmedSpend] = useState(false);
  const [configuring, setConfiguring] = useState(initialConnection !== null);
  const [creating, setCreating] = useState(false);
  const [step, setStep] = useState(0);
  const [creationPath, setCreationPath] = useState<CampaignCreationPath>("choice");
  const [planProgress, setPlanProgress] = useState(0);
  const [planRationale, setPlanRationale] = useState("");
  const [planSources, setPlanSources] = useState<string[]>([]);
  const [planError, setPlanError] = useState("");
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
  const stepNames = creationPath === "inrcy"
    ? ["Votre projet", "Analyse iNrCy", "Fondations", "Ciblage", "Créations", "Diffusion", "Validation"]
    : ["Votre projet", "Fondations", "Ciblage", "Créations", "Diffusion", "Validation"];
  const lastStep = stepNames.length - 1;
  const foundationsStep = creationPath === "inrcy" ? 2 : 1;
  const targetingStep = foundationsStep + 1;
  const creativeStep = foundationsStep + 2;
  const deliveryStep = foundationsStep + 3;
  const validationStep = foundationsStep + 4;
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
  const channelAccountReady = Boolean(
    connected
    && selectedAccount?.currency === "EUR"
    && selectedAccount.id === configuredAccountId
    && (channelId !== "meta" || (selectedPage?.instagramUserId && selectedPage.id === configuredPageId)),
  );
  const channelMeta = CHANNEL_CATALOG.find((channel) => channel.id === channelId) || CHANNEL_CATALOG[0];

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
    setNotice(`${CHANNEL_CATALOG[nextIndex].label} : vous pouvez préparer et enregistrer un brouillon. Connexion et publication ne sont pas encore disponibles.`);
  }

  const loadCampaigns = useCallback(async () => {
    try {
      const data = await readJson(await fetch("/api/ads/campaigns", { cache: "no-store" }));
      setCampaigns(Array.isArray(data.campaigns) ? data.campaigns as StoredCampaign[] : []);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Impossible de charger les campagnes.");
    }
  }, []);

  useEffect(() => { void loadCampaigns(); }, [loadCampaigns]);
  useEffect(() => {
    let active = true;
    if (!isAdsProvider(channelId)) {
      setLoadingAccounts(false);
      setConnected(false);
      setConnectionStatus("disconnected");
      setConnectionAccount(undefined);
      setConfiguredAccountId("");
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
        const persistedPage = nextPages.find((page) => page.id === result.selectedPageId);
        setConfiguredAccountId(persistedAccount?.id || "");
        setConfiguredPageId(persistedPage?.id || "");
        setDraft((current) => {
          const existingAccount = result.accountSelectionCleared ? undefined : euroAccounts.find((account) => account.id === current.adAccountId);
          const account = persistedAccount || existingAccount || (!result.accountSelectionCleared && euroAccounts.length === 1 ? euroAccounts[0] : undefined);
          const existingPage = nextPages.find((page) => page.id === current.pageId);
          const page = persistedPage || existingPage || (channelId === "meta" && linkedInstagramPages.length === 1 ? linkedInstagramPages[0] : undefined);
          const adAccountId = account?.id || "";
          const pageId = channelId === "meta" ? page?.id || "" : current.pageId;
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
    setDraft((current) => ({ ...current, ...next }));
    setDirty(true);
    setConfirmedSpend(false);
  }

  function applyCampaignMedia(item: Pick<MediaLibraryPickerItem, "media_type" | "signed_url" | "title" | "original_file_name">) {
    const url = String(item.signed_url || "").trim();
    if (!url) {
      setCampaignMediaUploadError("Ce média ne peut pas encore être utilisé : son lien sécurisé est indisponible.");
      return;
    }
    const mediaType = item.media_type === "video" ? "video" : "image";
    setDraft((current) => {
      const mediaStrategy = mediaType === "video"
        ? current.mediaStrategy === "image" || current.mediaStrategy === "mixed"
          ? "mixed"
          : "video"
        : current.mediaStrategy === "video" || current.mediaStrategy === "mixed"
          ? "mixed"
          : "image";
      return {
        ...current,
        creativeUrl: url,
        imageUrl: mediaType === "image" ? url : current.imageUrl,
        creativeType: mediaType,
        mediaStrategy,
      };
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
      setNotice(`Compte ${provider === "google" ? "Google Ads" : "Meta Ads"} sélectionné. Aucune annonce n’a été publiée.`);
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
      setNotice("Identité Facebook et Instagram sélectionnée pour vos campagnes Meta Ads.");
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
    setPlanRationale("");
    setPlanSources([]);
    setAutoMediaPlan(null);
    setAutoMediaState("idle");
    setAutoMediaMessage("");
    setCreationPath("manual");
    updateDraft({ creationMode: "manual" });
    setStep(1);
  }

  function applyCampaignPlan(plan: AdsCampaignPlan) {
    setBrand(plan.brand || brand);
    setBrief(plan.offer || brief);
    setDraft((current) => ({
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
      imageUrl: plan.imageUrl || current.imageUrl,
      creativeUrl: plan.creativeUrl || current.creativeUrl,
      creativeType: plan.creativeType,
      mediaStrategy: plan.mediaStrategy,
      mediaBrief: plan.mediaBrief || current.mediaBrief,
      callToAction: plan.callToAction || current.callToAction,
      headlines: plan.headlines.length ? plan.headlines : current.headlines,
      descriptions: plan.descriptions.length ? plan.descriptions : current.descriptions,
      keywords: plan.keywords.length ? plan.keywords : current.keywords,
      negativeKeywords: plan.negativeKeywords,
    }));
    setDirty(true);
    setConfirmedSpend(false);
  }

  async function generateCampaignPlan() {
    stopPlanProgress();
    setBusy("plan");
    setPlanError("");
    setPlanRationale("");
    setPlanSources([]);
    setAutoMediaPlan(null);
    setAutoMediaState("idle");
    setAutoMediaMessage("");
    setPlanProgress(7);
    let mediaGenerationQueued = false;
    planProgressTimer.current = setInterval(() => {
      setPlanProgress((current) => current >= 89 ? current : Math.min(89, current + (current < 45 ? 7 : 4)));
    }, 520);
    try {
      const result = await readJson(await fetch("/api/ads/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: channelId, intent: brief, destinationUrl: draft.destinationUrl }),
      }));
      const plan = result.plan as AdsCampaignPlan;
      applyCampaignPlan(plan);
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
      setPlanError(error instanceof Error ? error.message : "La génération iNrCy a échoué.");
      setPlanProgress(0);
    } finally {
      stopPlanProgress();
      if (!mediaGenerationQueued) setBusy(null);
    }
  }

  function chooseAssistedCreation() {
    setCreationPath("inrcy");
    updateDraft({ creationMode: "inrcy" });
    setStep(1);
    void generateCampaignPlan();
  }

  function startNewCampaign() {
    stopPlanProgress();
    setDraft(newDraft(channelId));
    setSavedId(null);
    setDirty(true);
    setBrief("");
    setBrand("");
    setPlanProgress(0);
    setPlanError("");
    setPlanRationale("");
    setPlanSources([]);
    setAutoMediaPlan(null);
    setAutoMediaState("idle");
    setAutoMediaMessage("");
    setCampaignMediaUploadError("");
    setConfirmedSpend(false);
    setCreationPath("choice");
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
    if (channelId !== provider || !savedId || dirty || !selectedAccount || !confirmedSpend || !livePublishingEnabled) return;
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
      void loadCampaigns();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Publication impossible. Vérifiez le statut de la campagne avant toute nouvelle tentative.");
      void loadCampaigns();
    } finally { setBusy(null); }
  }

  async function createPausedDemo() {
    if (!isAdsProvider(channelId)) return;
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
    if (channelId !== provider || !savedId || dirty || !selectedAccount || !connected) return;
    if (provider === "meta" && !pages.some((page) => page.id === draft.pageId && page.instagramUserId)) {
      setNotice("Pour la démo Meta, associez d’abord un compte Instagram professionnel à la Page sélectionnée.");
      return;
    }
    const accepted = window.confirm(`Créer une démo réelle, entièrement en pause sur ${channelMeta.label} ?\n\nLa plateforme créera les éléments de campagne, mais iNrCy n’enverra aucune demande d’activation. Aucune diffusion ni dépense ne pourra démarrer.`);
    if (!accepted) return;
    setBusy("demo"); setNotice("");
    try {
      await readJson(await fetch(`/api/ads/campaigns/${savedId}/publish`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "demo_paused", confirmation: ADS_PAUSED_DEMO_CONFIRMATION }),
      }));
      setNotice(`Démo créée en pause sur ${channelMeta.label}. Aucune annonce ne diffuse et aucun budget n’est dépensé.`);
      setConfirmedSpend(false);
      void loadCampaigns();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "La démo en pause n’a pas pu être créée. Vérifiez son statut sur la plateforme avant de réessayer.");
      void loadCampaigns();
    } finally { setBusy(null); }
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
  const campaignTypeOptions = CAMPAIGN_TYPE_OPTIONS[channelId];
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
  const metaLivePlacementsSupported = channelId !== "meta" || draft.metaPlacements.every((placement) => placement === "facebook_feed" || placement === "instagram_feed");
  const livePublisherSetupReady = livePublisherConversionReady && metaLivePlacementsSupported;
  const livePublisherMediaReady = channelId !== "meta" || Boolean(draft.imageUrl);
  const pendingAnalysisStage = AI_ANALYSIS_STAGES.findIndex((stage) => planProgress < stage.at);
  const activeAnalysisStage = pendingAnalysisStage === -1 ? AI_ANALYSIS_STAGES.length - 1 : pendingAnalysisStage;

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
            <button type="button" className={styles.trackingButton} onClick={() => { setTracking(true); void loadCampaigns(); }}>Suivi des campagnes{campaigns.length > 0 && <span className={styles.trackingCount}>{campaigns.length}</span>}</button>
            <Link href="/dashboard" className={styles.back}>Fermer</Link>
          </nav>
        </div>
      </header>

      <section id="ads-channels" className={styles.channelCard} aria-label="Canaux publicitaires">
        <div className={styles.sectionHeading}><div><span>AMPLIFIEZ VOTRE PORTÉE</span><h2>Choisissez votre terrain de jeu.</h2></div><p>Sélectionnez un canal, puis configurez votre compte.</p></div>
        <nav className={styles.channelRail} aria-label="Choisir un canal publicitaire">{CHANNEL_CATALOG.map((channel, index) => <button type="button" key={channel.id} data-near={index === channelIndex || index === (channelIndex + 1) % CHANNEL_CATALOG.length || index === (channelIndex - 1 + CHANNEL_CATALOG.length) % CHANNEL_CATALOG.length || undefined} onClick={() => selectChannel(index)} aria-pressed={index === channelIndex}>{channel.label}{!channel.provider && <small>Brouillon</small>}</button>)}</nav>
        <div className={styles.channelCarousel} data-testid="ads-channel-carousel">
          <button type="button" onClick={() => selectChannel(channelIndex - 1)} aria-label="Canal précédent">‹</button>
          <div className={styles.cubeStage} tabIndex={0} role="group" aria-label="Carrousel des canaux : flèches gauche et droite pour naviguer" onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); selectChannel(channelIndex + (event.key === "ArrowRight" ? 1 : -1)); } }} onPointerDown={(event) => { if (!(event.target as HTMLElement).closest("button,a")) channelPointerStart.current = { x: event.clientX, y: event.clientY }; }} onPointerUp={(event) => { const start = channelPointerStart.current; channelPointerStart.current = null; if (!start) return; const dx = event.clientX - start.x; if (Math.abs(dx) >= 58 && Math.abs(dx) > Math.abs(event.clientY - start.y) * 1.5) selectChannel(channelIndex + (dx < 0 ? 1 : -1)); }} onPointerCancel={() => { channelPointerStart.current = null; }}>
          {[-1, 0, 1].map((offset) => {
            const index = (channelIndex + offset + CHANNEL_CATALOG.length) % CHANNEL_CATALOG.length;
            const channel = CHANNEL_CATALOG[index];
            return <div key={`${offset}-${channel.id}`} data-provider={channel.id} className={`${styles.channel} ${offset === 0 ? styles.channelActive : styles.channelMini}`}>
              {offset !== 0 && <button className={styles.miniSelect} type="button" aria-label={`Afficher ${channel.label}`} onClick={() => selectChannel(index)} />}
              <span className={styles.channelLogo}><Image src={channel.logo} width={56} height={56} alt="" draggable={false} /></span>
              <div className={styles.channelIdentity}><strong>{channel.label}</strong><small>{channel.format}</small><span className={styles.channelStatus} data-draft-only={!channel.provider || undefined} data-status={channel.provider ? offset !== 0 ? "available" : loadingAccounts ? "loading" : channelAccountReady ? "connected" : connected ? "select-account" : "disconnected" : "draft"}>{!channel.provider ? "Brouillon uniquement" : offset !== 0 ? "Disponible" : loadingAccounts ? "Vérification…" : channelAccountReady ? "Compte connecté" : connected ? "Compte à configurer" : "À connecter"}</span></div>
              {offset === 0 && (channel.provider ? <button type="button" className={styles.channelConfigure} onClick={() => openConfiguration(channel.provider!)}><span aria-hidden="true">⚙</span> Configurer</button> : <span className={styles.comingSoon}>Préparer un brouillon</span>)}
            </div>;
          })}
          </div>
          <button type="button" onClick={() => selectChannel(channelIndex + 1)} aria-label="Canal suivant">›</button>
        </div>
      </section>

      <div className={styles.launchArea}>
        <button type="button" onClick={startNewCampaign} className={`${styles.headerCta} ${styles.launchButton}`}><span aria-hidden="true">✦</span> Lancer une campagne <span aria-hidden="true">↗</span></button>
      </div>
      {notice && <div className={`${styles.notice} ${styles.cockpitNotice}`} role="status">{notice}</div>}

      <SettingsDrawer title="Créer une campagne" isOpen={creating} onClose={closeCampaignCreation} presentation="centered" headerLead={<div className={styles.modalBrand}>iNr’<span>ADS</span><small>STUDIO DE CAMPAGNE</small></div>} headerStyle={{ background: "radial-gradient(ellipse at 20% 0, #246bbd70, transparent 60%), linear-gradient(100deg, #172e5a, #392464 65%, #772b75)", borderBottom: "1px solid #c68aff66", boxShadow: "0 8px 35px #8a4ce52b", minHeight: 76 }} headerContent={<div className={styles.wizardTitle}><span className={styles.modalSpark} aria-hidden="true">✦</span><div>Créer une campagne <small>{stepNames[step]} · Étape {step + 1} / {stepNames.length}</small></div></div>}>
      <div className={`${styles.workspace} ${styles.studioWorkspace}`} data-compact={compactScreen || undefined} data-short={shortScreen || undefined} data-stage={step} data-creation-path={creationPath} onTouchStart={(event) => { const touch = event.touches[0]; touchStart.current = { x: touch.clientX, y: touch.clientY }; }} onTouchEnd={(event) => { const start = touchStart.current; touchStart.current = null; if (!start || busy === "plan") return; const touch = event.changedTouches[0]; const dx = touch.clientX - start.x; const dy = touch.clientY - start.y; if (Math.abs(dx) > 75 && Math.abs(dx) > Math.abs(dy) * 1.5 && !(event.target instanceof HTMLElement && event.target.closest("input, textarea, select, button"))) setStep((current) => Math.max(0, Math.min(lastStep, current + (dx < 0 ? 1 : -1)))); }}>
      <nav className={styles.stepper} aria-label="Étapes de création">{stepNames.map((name, index) => <button type="button" key={name} disabled={index > step || busy === "plan"} aria-label={`${index + 1}. ${name}`} aria-current={step === index ? "step" : undefined} onClick={() => setStep(index)}><span>{index + 1}</span>{!compactScreen && name}</button>)}</nav>
      <section hidden={step !== 0} className={`${styles.card} ${styles.studioChoiceCard}`}>
          <div className={styles.sectionHeading}><div><span>01 · VOTRE PROJET</span><h2>Comment voulez-vous créer ? <span aria-hidden="true" className={styles.spark}>✦</span></h2></div><span className={styles.credit}>Sans diffusion</span></div>
          <p className={styles.intro}>Choisissez votre rythme : vous pilotez chaque détail, ou iNrCy prépare une campagne complète à partir de votre activité. Rien ne sera publié sans votre validation finale.</p>
          <div className={styles.studioProjectFields}>
            <label className={styles.field}>Nom de l’entreprise <input value={brand} maxLength={120} onChange={(event) => setBrand(event.target.value)} placeholder="Ex. Atelier Durand" /></label>
            <label className={styles.field}>Votre priorité pour cette campagne <textarea value={brief} maxLength={1200} onChange={(event) => setBrief(event.target.value)} rows={3} placeholder="Ex. obtenir plus de demandes de devis pour mon offre locale…" /></label>
          </div>
          <div className={styles.studioPathGrid}>
            <button type="button" className={styles.studioPath} onClick={chooseManualCreation} disabled={busy !== null}>
              <span className={styles.studioPathIcon} aria-hidden="true">✎</span><span><strong>Créer manuellement</strong><small>Un parcours clair, étape par étape. Vous renseignez vos choix et vos contenus.</small></span><b>Commencer →</b>
            </button>
            <button type="button" className={`${styles.studioPath} ${styles.studioPathAi}`} onClick={chooseAssistedCreation} disabled={busy !== null}>
              <span className={styles.studioPathIcon} aria-hidden="true">✦</span><span><strong>Créer avec iNrCy</strong><small>iNrADN, historique et vos priorités construisent la campagne ; iNr’Studio crée le média utile.</small></span><b>Analyser mon activité →</b>
            </button>
          </div>
          <p className={styles.help}>Le plan iNrCy consomme 1 crédit IA lorsqu’il est généré. Si le format a besoin d’un visuel, iNr’Studio utilise ensuite votre quota média — jamais pour une campagne Search purement textuelle.</p>
      </section>

      <section hidden={creationPath !== "inrcy" || step !== analysisStep} className={`${styles.card} ${styles.studioAnalysisCard}`}>
        <div className={styles.adsGenerationCanvas} data-ready={planProgress === 100 || undefined}>
          <span className={`${styles.adsGenerationParticle} ${styles.adsGenerationParticleOne}`} aria-hidden="true" /><span className={`${styles.adsGenerationParticle} ${styles.adsGenerationParticleTwo}`} aria-hidden="true" /><span className={`${styles.adsGenerationParticle} ${styles.adsGenerationParticleThree}`} aria-hidden="true" />
          <div className={styles.adsGenerationOrbit} aria-hidden="true"><i /><i /><i /></div>
          <div className={styles.adsGenerationEmblem} aria-hidden="true"><span>↗</span></div>
          <p className={styles.adsGenerationEyebrow}>iNrCY · ANALYSE &amp; GÉNÉRATION</p>
          <h2>{planProgress === 100 ? "Votre campagne prend forme." : autoMediaState === "generating" ? "iNr’Studio compose votre média." : "iNrCy construit votre campagne."}</h2>
          <p className={styles.adsGenerationLead}>{planProgress === 100 ? "Votre base est prête. Contrôlez chaque recommandation avant de l’enregistrer ou de la diffuser." : autoMediaState === "generating" ? "Le ciblage et les messages sont prêts : iNrCy fabrique maintenant le média adapté au format choisi." : "Nous relions votre iNrADN, vos priorités et l’historique utile pour vous proposer une campagne cohérente."}</p>
          <div className={styles.adsGenerationProgress} aria-label={`Progression : ${planProgress} %`}><div><span style={{ width: `${planProgress}%` }} /></div><strong>{planProgress}%</strong></div>
          <ol className={styles.adsGenerationStages}>{AI_ANALYSIS_STAGES.map((stage, index) => <li key={stage.label} data-state={planProgress >= stage.at ? "done" : index === activeAnalysisStage ? "active" : "pending"}><span>{planProgress >= stage.at ? "✓" : index + 1}</span><div><strong>{stage.label}</strong><small>{stage.detail}</small></div></li>)}</ol>
          {autoMediaState !== "idle" && autoMediaMessage && <p className={styles.studioMediaGenerationNote} data-state={autoMediaState}>{autoMediaMessage}</p>}
          {planError && <div className={styles.studioPlanError} role="alert"><strong>La proposition n’a pas pu être finalisée.</strong><span>{planError}</span><div><button type="button" className={styles.secondaryButton} onClick={() => void generateCampaignPlan()}>Réessayer l’analyse</button><button type="button" className={styles.back} onClick={chooseManualCreation}>Passer au mode manuel</button></div></div>}
          {planProgress === 100 && !planError && <div className={styles.studioPlanReady}><p>{planRationale}</p>{planSources.length > 0 && <div className={styles.studioPlanSources}><span>Analyse basée sur</span><ul>{planSources.map((source) => <li key={source}>{source}</li>)}</ul></div>}<button type="button" className={styles.headerCta} onClick={() => setStep(foundationsStep)}>Contrôler ma proposition <span aria-hidden="true">→</span></button></div>}
        </div>
      </section>

      <section hidden={step !== foundationsStep} data-channel={channelId} className={`${styles.card} ${styles.studioCard}`}>
        <div className={styles.sectionHeading}><div><span>{foundationsStep.toString().padStart(2, "0")} · FONDATIONS</span><h2>La direction de votre campagne.</h2></div><span className={styles.credit}>{channelMeta.label}</span></div>
        <p className={styles.intro}>Définissez ce que vous voulez obtenir. iNrCy utilise ces choix pour guider les messages, le ciblage et la diffusion.</p>
        <div className={styles.studioGrid}>
          <label className={styles.field}>Nom de la campagne<input value={draft.name} maxLength={100} onChange={(event) => updateDraft({ name: event.target.value })} placeholder="Ex. Demandes de devis locales" /></label>
          <label className={`${styles.field} ${styles.studioWide}`}>Offre ou service à mettre en lumière<textarea rows={3} value={draft.offer} maxLength={500} onChange={(event) => updateDraft({ offer: event.target.value })} placeholder="Ex. installation de panneaux solaires avec étude personnalisée" /></label>
          <label className={styles.field}>Objectif<select value={draft.objective} onChange={(event) => updateDraft({ objective: event.target.value as AdsCampaignInput["objective"] })}>{OBJECTIVE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className={styles.field}>Action à mesurer<select value={draft.conversionGoal} onChange={(event) => updateDraft({ conversionGoal: event.target.value as AdsCampaignInput["conversionGoal"] })}>{CONVERSION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        </div>
        <div className={styles.studioTypeGrid} role="radiogroup" aria-label="Type de campagne">{campaignTypeOptions.map((option) => <button type="button" key={option.value} data-selected={draft.campaignType === option.value || undefined} onClick={() => updateDraft({ campaignType: option.value })}><strong>{option.label}</strong><small>{option.detail}</small><span>{draft.campaignType === option.value ? "Choisi" : "Choisir"}</span></button>)}</div>
      </section>

      <section hidden={step !== targetingStep} data-channel={channelId} className={`${styles.card} ${styles.studioCard}`}>
        <div className={styles.sectionHeading}><div><span>{targetingStep.toString().padStart(2, "0")} · CIBLAGE</span><h2>À qui, où et quand parler.</h2></div><span className={styles.credit}>À contrôler</span></div>
        <p className={styles.intro}>Vos zones et vos clients sont des garde-fous : ils évitent une campagne trop large ou des clics peu pertinents.</p>
        <div className={styles.studioGrid}>
          <label className={styles.field}>Zones ciblées <small>Une par ligne</small><textarea rows={5} value={editableList(draft.targetLocations)} onChange={(event) => updateDraft({ targetLocations: parseEditableList(event.target.value.split("\n")) })} placeholder="Ex. Lyon\nRhône\n20 km autour de Villeurbanne" />{channelId === "google" && <small>Avant diffusion, iNrCy vérifie chaque zone auprès de Google Ads afin d’éviter tout ciblage imprécis.</small>}</label>
          <label className={styles.field}>Clients / audiences prioritaires <small>Une par ligne</small><textarea rows={5} value={editableList(draft.targetAudiences)} onChange={(event) => updateDraft({ targetAudiences: parseEditableList(event.target.value.split("\n")) })} placeholder="Ex. Propriétaires de maison\nEntreprises locales" /></label>
          <label className={`${styles.field} ${styles.studioWide}`}>Langues de vos clients <small>Une langue ou un code par ligne</small><textarea rows={2} value={editableList(draft.languages)} onChange={(event) => updateDraft({ languages: parseEditableList(event.target.value.split("\n")) })} placeholder="fr\nen" /></label>
          <label className={`${styles.field} ${styles.studioWide}`}>{channelId === "google" && draft.campaignType === "performance_max" ? "Thèmes de recherche / signaux d’intention" : channelId === "google" ? "Mots-clés recherchés" : "Centres d’intérêt ou angles de ciblage"}<small>Un par ligne</small><textarea rows={4} value={editableList(draft.keywords)} onChange={(event) => updateDraft({ keywords: parseEditableList(event.target.value.split("\n")) })} placeholder={channelId === "google" ? "Ex. installation panneaux solaires\nDevis photovoltaïque" : "Ex. rénovation énergétique\nMaison individuelle"} /></label>
          {channelId === "google" && <label className={`${styles.field} ${styles.studioWide}`}>Mots-clés à exclure <small>Pour éviter les recherches non pertinentes</small><textarea rows={3} value={editableList(draft.negativeKeywords)} onChange={(event) => updateDraft({ negativeKeywords: parseEditableList(event.target.value.split("\n")) })} placeholder="Ex. emploi\nformation\noccasion" /></label>}
          {channelId === "google" && <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}><legend>Réseaux Google</legend><p>Ces réglages complètent le ciblage de votre campagne sans modifier votre budget.</p><label className={styles.check}><input type="checkbox" checked={draft.googleSearchPartners} onChange={(event) => updateDraft({ googleSearchPartners: event.target.checked })} />Inclure les partenaires du Réseau de Recherche lorsque cela est cohérent avec l’objectif.</label><label className={styles.check}><input type="checkbox" checked={draft.googleDisplayExpansion} onChange={(event) => updateDraft({ googleDisplayExpansion: event.target.checked })} />Préparer l’extension au Réseau Display pour toucher de nouvelles audiences qualifiées.</label></fieldset>}
          {channelId === "meta" && <fieldset className={`${styles.studioControlPanel} ${styles.studioWide}`}><legend>Audience &amp; placements Meta</legend><p>Choisissez les emplacements adaptés à votre média ; iNrCy ne coche que les formats cohérents lors de l’analyse.</p><label className={styles.check}><input type="checkbox" checked={draft.metaAudienceExpansion} onChange={(event) => updateDraft({ metaAudienceExpansion: event.target.checked })} />Autoriser Meta à élargir l’audience si cela améliore la probabilité de conversion.</label><div className={styles.studioControlOptions}>{META_PLACEMENT_OPTIONS.map((option) => <label key={option.value}><input type="checkbox" checked={draft.metaPlacements.includes(option.value)} onChange={(event) => updateDraft({ metaPlacements: event.target.checked ? Array.from(new Set([...draft.metaPlacements, option.value])) : draft.metaPlacements.filter((placement) => placement !== option.value) })} />{option.label}</label>)}</div></fieldset>}
        </div>
      </section>

      <section hidden={step !== creativeStep} data-channel={channelId} className={`${styles.card} ${styles.studioCard}`}>
        <div className={styles.sectionHeading}><div><span>{creativeStep.toString().padStart(2, "0")} · CRÉATIONS</span><h2>Des messages qui donnent envie d’agir.</h2></div><span className={styles.credit}>Modifiable</span></div>
        <p className={styles.intro}>Vous pouvez écrire vous-même, partir de la proposition iNrCy et ajuster chaque mot. Les règles de la plateforme restent appliquées à la publication.</p>
        <div className={styles.studioGrid}>
          <label className={`${styles.field} ${styles.studioWide}`}>Message principal<textarea rows={5} value={draft.primaryText} maxLength={500} onChange={(event) => updateDraft({ primaryText: event.target.value })} placeholder="Présentez l’offre, son bénéfice concret et la prochaine action à réaliser." /></label>
          <label className={styles.field}>{channelId === "google" ? "Titres (3 minimum, un par ligne, 30 caractères max)" : "Titres ou accroches (un par ligne)"}<textarea rows={5} value={editableList(draft.headlines)} onChange={(event) => updateDraft({ headlines: parseEditableList(event.target.value.split("\n")) })} /></label>
          <label className={styles.field}>{channelId === "google" ? "Descriptions (2 minimum, une par ligne, 90 caractères max)" : "Descriptions (une par ligne)"}<textarea rows={5} value={editableList(draft.descriptions)} onChange={(event) => updateDraft({ descriptions: parseEditableList(event.target.value.split("\n")) })} /></label>
          <label className={styles.field}>Média à utiliser<select value={draft.mediaStrategy} onChange={(event) => updateDraft({ mediaStrategy: event.target.value as AdsCampaignInput["mediaStrategy"] })}>{mediaStrategyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className={styles.field}>Appel à l’action<input value={draft.callToAction} maxLength={80} onChange={(event) => updateDraft({ callToAction: event.target.value })} placeholder="Ex. Demander un devis" /></label>
          <label className={styles.field}>Lien externe d’un média <small>Optionnel, HTTPS</small><input type="url" value={draft.creativeUrl || draft.imageUrl} onChange={(event) => updateDraft({ imageUrl: event.target.value, creativeUrl: event.target.value })} placeholder="https://votresite.fr/media.jpg" /></label>
          <label className={`${styles.field} ${styles.studioWide}`}>Consignes pour vos médias<textarea rows={3} value={draft.mediaBrief} maxLength={1000} onChange={(event) => updateDraft({ mediaBrief: event.target.value })} placeholder="Style, produit, scène, preuves à montrer, format souhaité…" /></label>
        </div>
        <div className={styles.campaignMediaWorkspace}>
          <div className={styles.campaignMediaWorkspaceHeading}><div><span>MÉDIAS DE CAMPAGNE</span><strong>{draft.creativeUrl ? "Un média est associé à cette campagne" : "Choisissez ou créez le média adapté"}</strong></div>{draft.creativeUrl ? <span data-type={draft.creativeType || "image"}>{draft.creativeType === "video" ? "Vidéo" : "Image"} prête</span> : <span>Optionnel selon le format</span>}</div>
          <div className={styles.campaignMediaActions}>
            <button type="button" onClick={() => campaignImageInputRef.current?.click()} disabled={campaignMediaUploadBusy}><span aria-hidden="true">▧</span>{campaignMediaUploadBusy ? "Ajout en cours…" : "Ajouter une image"}</button>
            <button type="button" onClick={() => campaignVideoInputRef.current?.click()} disabled={campaignMediaUploadBusy}><span aria-hidden="true">▶</span>{campaignMediaUploadBusy ? "Ajout en cours…" : "Ajouter une vidéo"}</button>
            <button type="button" className={styles.campaignMediaGenerate} onClick={() => setCampaignMediaStudioOpen(true)} disabled={campaignMediaUploadBusy}><span aria-hidden="true">✦</span> Générer</button>
            <button type="button" onClick={() => setCampaignMediaLibraryOpen(true)} disabled={campaignMediaUploadBusy}><span aria-hidden="true">▦</span> Médiathèque</button>
          </div>
          {channelId === "google" && draft.campaignType === "search" && <p className={styles.campaignMediaFormatHint}>La campagne Réseau de recherche est textuelle : conservez ici un visuel pour votre médiathèque ou passez à un format visuel pour l’utiliser dans la diffusion.</p>}
          {draft.creativeUrl && <div className={styles.campaignMediaAttached}><span aria-hidden="true">✓</span><div><strong>Média associé à la campagne</strong><small>{draft.creativeType === "video" ? "Vidéo" : "Image"} stockée dans votre médiathèque iNrCy ou liée depuis votre site.</small></div><a href={draft.creativeUrl} target="_blank" rel="noreferrer">Voir ↗</a><button type="button" onClick={() => updateDraft({ creativeUrl: "", imageUrl: "" })}>Retirer</button></div>}
          {campaignMediaUploadError && <p className={styles.campaignMediaError} role="alert">{campaignMediaUploadError}</p>}
          <input ref={campaignImageInputRef} type="file" accept="image/*" hidden onChange={(event) => void handleCampaignMediaUpload(event, "image")} />
          <input ref={campaignVideoInputRef} type="file" accept="video/*" hidden onChange={(event) => void handleCampaignMediaUpload(event, "video")} />
        </div>
      </section>

      <section hidden={step !== deliveryStep} data-channel={channelId} className={`${styles.card} ${styles.studioCard}`}>
        <div className={styles.sectionHeading}><div><span>{deliveryStep.toString().padStart(2, "0")} · DIFFUSION</span><h2>Le cadre de votre investissement.</h2></div><span className={styles.credit}>Sans engagement</span></div>
        <p className={styles.intro}>La plateforme facture directement votre compte publicitaire. Ce réglage prépare votre campagne, il ne déclenche aucune diffusion.</p>
        <div className={styles.studioGrid}>
          <label className={`${styles.field} ${styles.studioWide}`}>Lien de redirection<input type="url" value={draft.destinationUrl} onChange={(event) => updateDraft({ destinationUrl: event.target.value })} placeholder="https://votresite.fr/offre" /><small>Une page HTTPS claire et cohérente avec votre annonce.</small></label>
          <label className={styles.field}>Lieu de conversion<select value={draft.conversionLocation} onChange={(event) => updateDraft({ conversionLocation: event.target.value as AdsCampaignInput["conversionLocation"] })}>{CONVERSION_LOCATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label} — {option.detail}</option>)}</select></label>
          <label className={styles.field}>Balises de suivi <small>Optionnel</small><input value={draft.trackingParameters} maxLength={500} onChange={(event) => updateDraft({ trackingParameters: event.target.value })} placeholder="utm_source=google&utm_campaign=devis" /></label>
          <label className={styles.field}>Budget quotidien moyen (€)<input type="number" min="5" max="500" step="0.01" value={draft.dailyBudgetEuros} onChange={(event) => updateDraft({ dailyBudgetEuros: Number(event.target.value) })} /></label>
          <label className={styles.field}>Date de fin<input type="date" value={draft.endDate} onChange={(event) => updateDraft({ endDate: event.target.value })} /></label>
          <label className={`${styles.field} ${styles.studioWide}`}>Stratégie de diffusion<select value={draft.bidStrategy} onChange={(event) => updateDraft({ bidStrategy: event.target.value as AdsCampaignInput["bidStrategy"] })}>{BID_STRATEGY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          {channelId === "google" && <label className={`${styles.check} ${styles.studioWide}`}><input type="checkbox" checked={draft.urlExpansion} onChange={(event) => updateDraft({ urlExpansion: event.target.checked })} />Autoriser l’utilisation de pages pertinentes de mon site lorsque le format de campagne le permet.</label>}
          {channelId === "google" && <label className={`${styles.field} ${styles.studioWide}`}>Pages à exclure <small>Une URL HTTPS par ligne, optionnel</small><textarea rows={3} value={editableList(draft.urlExclusions)} onChange={(event) => updateDraft({ urlExclusions: parseEditableList(event.target.value.split("\n")) })} placeholder="https://votresite.fr/mentions-legales" /></label>}
        </div>
        <div className={styles.studioBudgetPanel}><div><span>Projection jusqu’à la date de fin</span><strong>{Number.isFinite(estimate) ? estimate.toLocaleString("fr-FR", { style: "currency", currency: "EUR" }) : "—"}</strong></div><p>{channelId === "google" ? "Google Ads gère la facturation. Le budget quotidien est une moyenne et la dépense peut varier selon les jours." : channelId === "meta" ? "Meta gère la facturation. Cette projection est indicative et ne constitue pas un plafond garanti." : "Aucune dépense n’est engagée tant que ce canal reste en préparation."}</p></div>
        {channelId === "meta" && <label className={`${styles.check} ${styles.studioCompliance}`}><input type="checkbox" checked={draft.noSpecialCategoryConfirmed} onChange={(event) => updateDraft({ noSpecialCategoryConfirmed: event.target.checked })} />Je confirme que cette annonce ne concerne aucune catégorie spéciale Meta (crédit, emploi, logement ou enjeux sociaux/politiques).</label>}
        {channelId === "google" && <label className={`${styles.check} ${styles.studioCompliance}`}><input type="checkbox" checked={draft.notEuPoliticalConfirmed} onChange={(event) => updateDraft({ notEuPoliticalConfirmed: event.target.checked })} />Je certifie que cette campagne ne contient pas de publicité politique ciblant l’Union européenne.</label>}
      </section>

      <section hidden={step !== validationStep} data-channel={channelId} className={`${styles.card} ${styles.studioCard} ${styles.studioValidationCard}`}>
        <div className={styles.sectionHeading}><div><span>{validationStep.toString().padStart(2, "0")} · VOTRE CONTRÔLE</span><h2>Votre campagne, vos décisions.</h2></div><span className={styles.launchIcon} aria-hidden="true">↗</span></div>
        <p className={styles.intro}>Relisez cette proposition avant tout enregistrement. Une campagne ne peut être diffusée qu’après votre validation explicite et celle de la plateforme.</p>
        <dl className={styles.studioReviewGrid}>
          <div><dt>Campagne</dt><dd>{draft.name || "À renseigner"}</dd><small>{selectedCampaignType?.label || channelMeta.label} · {OBJECTIVE_OPTIONS.find((option) => option.value === draft.objective)?.label}</small></div>
          <div><dt>Compte / canal</dt><dd>{channelMeta.label} · {selectedAccount?.name || (isAdsProvider(channelId) ? "À configurer" : "Préparation" )}</dd><small>{selectedAccount ? "Compte annonceur prêt à être contrôlé" : "Vous pouvez enregistrer avant de connecter un compte"}</small></div>
          <div><dt>Objectif mesuré</dt><dd>{CONVERSION_OPTIONS.find((option) => option.value === draft.conversionGoal)?.label}</dd><small>{draft.targetLocations.length ? `${draft.targetLocations.length} zone${draft.targetLocations.length > 1 ? "s" : ""} ciblée${draft.targetLocations.length > 1 ? "s" : ""}` : "Zones à préciser"}</small></div>
          <div><dt>Investissement</dt><dd>{draft.dailyBudgetEuros.toLocaleString("fr-FR")} € / jour</dd><small>Fin prévue : {draft.endDate || "à préciser"}</small></div>
          <div><dt>Redirection</dt><dd>{draft.destinationUrl || "À renseigner"}</dd><small>{draft.keywords.length ? `${draft.keywords.length} signaux / mots-clés préparés` : "Mots-clés ou audiences à compléter"}</small></div>
          <div><dt>Médias &amp; message</dt><dd>{MEDIA_STRATEGY_OPTIONS.find((option) => option.value === draft.mediaStrategy)?.label}</dd><small>{draft.callToAction || "Appel à l’action à définir"}</small></div>
          <div><dt>Conversion &amp; suivi</dt><dd>{CONVERSION_LOCATION_OPTIONS.find((option) => option.value === draft.conversionLocation)?.label}</dd><small>{draft.trackingParameters || "Aucune balise de suivi ajoutée"}</small></div>
          <div><dt>Diffusion avancée</dt><dd>{channelId === "meta" ? (draft.metaPlacements.length ? `${draft.metaPlacements.length} placement${draft.metaPlacements.length > 1 ? "s" : ""}` : "Placements à choisir") : channelId === "google" ? `${draft.languages.length} langue${draft.languages.length > 1 ? "s" : ""}` : "Préparation complète"}</dd><small>{channelId === "meta" ? (draft.metaAudienceExpansion ? "Expansion d’audience autorisée" : "Audience strictement contrôlée") : channelId === "google" ? (draft.googleSearchPartners ? "Partenaires de recherche inclus" : "Réseau Google principal") : "À adapter au canal"}</small></div>
        </dl>
        {!isAdsProvider(channelId) ? <p className={styles.draftOnlyWarning}><strong>Brouillon uniquement pour le moment</strong>La connexion à {channelMeta.label} et sa publication ne sont pas encore disponibles dans iNr’ADS. Votre préparation reste enregistrable, sans diffusion ni dépense média.</p> : !liveFormatAvailable ? <p className={styles.studioReadiness}><strong>Préparation complète, publication de ce format à venir</strong>{channelId === "google" ? "iNr’ADS prépare tous les réglages nécessaires à ce type de campagne. La publication automatisée disponible aujourd’hui est la campagne Réseau de recherche." : "iNr’ADS prépare ce format et conserve votre brouillon. La publication automatisée actuellement disponible concerne la campagne Trafic Meta."}</p> : !livePublisherConversionReady ? <p className={styles.studioReadiness}><strong>Conservez ce parcours dans votre brouillon</strong>Le connecteur de diffusion disponible aujourd’hui envoie les prospects vers votre site web. Votre choix de conversion est bien sauvegardé et sera repris dès que son connecteur dédié sera activé.</p> : !metaLivePlacementsSupported ? <p className={styles.studioReadiness}><strong>Vos placements sont bien préparés</strong>La première diffusion Trafic Meta disponible utilise les fils Facebook et Instagram. Stories, Reels et Messenger restent enregistrés dans votre brouillon pour le connecteur dédié.</p> : !livePublisherMediaReady ? <p className={styles.studioReadiness}><strong>Ajoutez votre image avant la diffusion</strong>Le connecteur Trafic Meta actuellement disponible utilise un visuel image. Vous pouvez en générer un avec iNr’Studio, en importer un ou le choisir dans la médiathèque.</p> : <>
          {demoPausedPublishingEnabled && <p className={styles.warning}><strong>Mode démo sécurisé</strong>Cette démonstration crée les éléments chez {channelMeta.label}, tous maintenus en pause. Aucune diffusion ni dépense ne peut démarrer.</p>}
          {!livePublishingEnabled && <p className={styles.warning}><strong>Publication bientôt disponible</strong>Vous pouvez préparer et enregistrer la campagne. La diffusion réelle n’est pas encore activée.</p>}
        </>}
        <div className={styles.studioFinalActions}>
          <button type="button" className={styles.secondaryButton} disabled={busy !== null} onClick={() => void saveDraft()}>{busy === "save" ? "Enregistrement…" : savedId && dirty ? "Mettre à jour le brouillon" : savedId ? "Brouillon enregistré" : "Enregistrer la campagne"}</button>
          {isAdsProvider(channelId) && livePublisherSetupReady && demoPausedPublishingEnabled && <button type="button" className={styles.secondaryButton} disabled={channelId !== provider || !savedId || dirty || !connected || !livePublisherMediaReady || busy !== null} onClick={() => void createPausedDemo()}>{busy === "demo" ? "Création de la démo…" : "Créer une démo en pause"} <span aria-hidden="true">↗</span></button>}
        </div>
        {isAdsProvider(channelId) && livePublisherSetupReady && <><label className={`${styles.check} ${styles.studioFinalCheck}`}><input type="checkbox" checked={confirmedSpend} onChange={(event) => setConfirmedSpend(event.target.checked)} />Je valide le compte, le texte, la destination, la date de fin et la facturation directe par {channelId === "meta" ? "Meta" : "Google"}.</label><button type="button" className={styles.primaryButton} disabled={channelId !== provider || !livePublishingEnabled || !savedId || dirty || !connected || !livePublisherMediaReady || !confirmedSpend || busy !== null} onClick={() => void publish()}>{busy === "publish" ? "Publication en cours…" : `Publier sur ${channelMeta.label}`} <span aria-hidden="true">↗</span></button></>}
      </section>
      <div className={styles.wizardNavigation}><button type="button" className={styles.back} disabled={step === 0 || busy === "plan"} onClick={() => setStep((current) => current - 1)}>← Précédent</button><span>{step + 1} / {stepNames.length}</span>{step < lastStep ? <button type="button" className={styles.headerCta} disabled={busy === "plan" || (creationPath === "inrcy" && step === analysisStep && planProgress !== 100)} onClick={() => setStep((current) => current + 1)}>{creationPath === "inrcy" && step === analysisStep ? "Proposition en cours…" : "Suivant →"}</button> : <button type="button" className={styles.back} onClick={closeCampaignCreation}>Revenir au cockpit</button>}</div>
      </div>
      </SettingsDrawer>

      <SettingsDrawer title="Suivi des campagnes" isOpen={tracking} onClose={() => setTracking(false)} presentation="centered" headerLead="Retrouvez vos campagnes et reprenez vos brouillons." headerStyle={{ background: "radial-gradient(ellipse at 20% 0, #246bbd70, transparent 60%), linear-gradient(100deg, #172e5a, #392464 65%, #772b75)", borderBottom: "1px solid #c68aff66", boxShadow: "0 8px 35px #8a4ce52b", minHeight: 76 }} headerContent={<div className={styles.trackingTitle}><span aria-hidden="true">↗</span> Suivi des campagnes</div>}>
        <div className={styles.trackingContent}>
          <div className={styles.trackingIntro}><div><span>VOS CAMPAGNES</span><h2>Gardez le fil de vos annonces.</h2><p>Brouillons, publications et campagnes actives au même endroit.</p></div><strong>{campaigns.length} campagne{campaigns.length > 1 ? "s" : ""}</strong></div>
          {notice && <div className={styles.notice} role="status">{notice}</div>}
          {campaigns.length === 0 ? <div className={styles.trackingEmpty}><span aria-hidden="true">✦</span><strong>Votre première campagne commence ici.</strong><p>Choisissez un canal, lancez une campagne et retrouvez votre brouillon dans ce suivi.</p><button type="button" className={styles.headerCta} onClick={() => setTracking(false)}>Voir les canaux</button></div> : <div className={styles.trackingList}>
            {campaigns.map((item) => <article key={item.id} className={styles.trackingItem}>
              <span className={styles.trackingLogo}><Image src={CHANNEL_CATALOG.find((channel) => channel.id === item.provider)?.logo || "/ads-logos/meta.svg"} width={30} height={30} alt="" /></span>
              <div className={styles.trackingItemCopy}><strong>{item.name}</strong><small>{CHANNEL_CATALOG.find((channel) => channel.id === item.provider)?.label || item.provider}</small>{item.last_error && <p className={styles.error}>{item.last_error}</p>}</div>
              <span className={styles.trackingStatus} data-status={item.status}>{item.status === "active" ? "Activée côté plateforme" : item.status === "publishing" ? "Publication à vérifier" : item.status === "demo_paused" ? "Démo en pause" : item.status === "needs_review" ? "Vérification manuelle requise" : "Brouillon"}</span>
              {item.status === "draft" && <button type="button" className={styles.resumeButton} onClick={() => reopen(item)}>Reprendre <span aria-hidden="true">→</span></button>}
            </article>)}
          </div>}
        </div>
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
    {creating && autoMediaPlan && (
      <AdsCampaignAutoMediaGenerator
        key={`${autoMediaPlan.campaignType}-${autoMediaPlan.name}-${autoMediaPlan.mediaBrief}`}
        plan={autoMediaPlan}
        onProgress={(progress) => {
          setAutoMediaState("generating");
          setAutoMediaMessage(`iNr’Studio crée le média de la campagne · ${Math.min(99, Math.max(4, Math.round(progress)))} %`);
          setPlanProgress((current) => Math.max(current, Math.min(99, 90 + Math.round(progress / 10))));
        }}
        onComplete={(result) => {
          if (!result.item.signed_url) {
            setAutoMediaState("error");
            setAutoMediaMessage("La campagne est prête, mais le média généré ne peut pas encore être associé. Vous pourrez en ajouter un dans l’étape Créations.");
          } else {
            applyCampaignMedia(result.item);
            setAutoMediaState("ready");
            setAutoMediaMessage("iNr’Studio a généré et associé le média de cette campagne. Vous pourrez le remplacer, l’éditer ou le retirer à tout moment.");
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
          setAutoMediaMessage(`La campagne est préparée, mais iNr’Studio n’a pas pu créer le média : ${message} Vous pourrez en ajouter un dans l’étape Créations.`);
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
      accept="all"
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
      initialMediaType={draft.mediaStrategy === "video" || draft.creativeType === "video" ? "video" : "image"}
      publicationBrief={[draft.mediaBrief, draft.offer, draft.primaryText, draft.callToAction].filter(Boolean).join(". ").slice(0, 1_800)}
      acceptMode="insert"
      handoffOriginLabel="iNr’ADS"
      onClose={() => setCampaignMediaStudioOpen(false)}
      onAccepted={handleGeneratedCampaignMedia}
    />
  </main>;
}
