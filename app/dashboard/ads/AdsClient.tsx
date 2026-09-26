"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import SettingsDrawer from "@/app/dashboard/SettingsDrawer";
import { isAdsProvider, type AdsAccount, type AdsCampaignInput, type AdsChannelId, type AdsProvider } from "@/lib/adsValidation";
import { ADS_PAUSED_DEMO_CONFIRMATION } from "@/lib/adsPublishMode";
import type { ConnectionDisplayStatus } from "@/lib/connectionVersions";
import AdsConnectionSettings from "./AdsConnectionSettings";
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

type AccountResponse = {
  connected: boolean;
  hasConnection?: boolean;
  connectionStatus?: ConnectionDisplayStatus;
  accounts: AdsAccount[];
  pages: { id: string; name: string; instagramUserId?: string }[];
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

function defaultEndDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 8);
  return date.toISOString().slice(0, 10);
}

function newDraft(provider: AdsChannelId): AdsCampaignInput {
  return {
    provider,
    adAccountId: "",
    accountCurrency: "EUR",
    name: "",
    dailyBudgetEuros: 10,
    endDate: defaultEndDate(),
    destinationUrl: "",
    primaryText: "",
    imageUrl: "",
    creativeUrl: "",
    creativeType: provider === "tiktok" ? "video" : "image",
    pageId: "",
    headlines: [],
    descriptions: [],
    keywords: [],
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
  const [configuredAccountId, setConfiguredAccountId] = useState("");
  const [configuredPageId, setConfiguredPageId] = useState("");
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [accountsRefreshKey, setAccountsRefreshKey] = useState(0);
  const [configAction, setConfigAction] = useState<AdsConfigAction>(null);
  const [campaigns, setCampaigns] = useState<StoredCampaign[]>([]);
  const [tracking, setTracking] = useState(false);
  const [brief, setBrief] = useState("");
  const [brand, setBrand] = useState("");
  const [busy, setBusy] = useState<"save" | "generate" | "publish" | "demo" | null>(null);
  const [confirmedSpend, setConfirmedSpend] = useState(false);
  const [configuring, setConfiguring] = useState(initialConnection !== null);
  const [creating, setCreating] = useState(false);
  const [step, setStep] = useState(0);
  const [compactScreen, setCompactScreen] = useState(false);
  const [shortScreen, setShortScreen] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const stepNames = compactScreen
    ? ["Votre entreprise", "Votre idée", "Votre campagne", "Votre budget", ...(channelId === "meta" ? ["Votre texte", "Votre image"] : channelId === "google" ? ["Vos titres", "Vos descriptions", "Vos mots-clés"] : ["Votre texte", "Format du visuel", "Votre visuel"]), ...(shortScreen ? ["Récapitulatif", isAdsProvider(channelId) ? "Publication" : "Brouillon"] : ["Validation"])]
    : ["Votre idée", "Votre campagne", "Validation"];
  const lastStep = stepNames.length - 1;
  const validationStart = lastStep - (shortScreen && compactScreen ? 1 : 0);
  const sectionStep = compactScreen ? step < 2 ? 0 : step >= validationStart ? 2 : 1 : step;
  useEffect(() => {
    const media = window.matchMedia("(max-width: 999px), (max-height: 659px)");
    const shortMedia = window.matchMedia("(max-height: 600px)");
    const update = () => { setCompactScreen(media.matches); setShortScreen(shortMedia.matches); setStep(0); };
    update();
    media.addEventListener("change", update);
    shortMedia.addEventListener("change", update);
    return () => { media.removeEventListener("change", update); shortMedia.removeEventListener("change", update); };
  }, []);
  const [notice, setNotice] = useState(initialConnection === "connected" ? "Connexion publicitaire réussie. Vérifiez le compte annonceur proposé avant de préparer votre campagne." : initialConnection === "error" ? /Meta.*HTTPS/i.test(initialReason) ? "Pour connecter Meta Ads, ouvrez iNrCy depuis son adresse sécurisée (HTTPS)." : initialReason || "La connexion publicitaire n’a pas abouti." : "");

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
        setAccounts(nextAccounts);
        setPages(nextPages);
        const euroAccounts = nextAccounts.filter((account) => account.currency === "EUR");
        const linkedInstagramPages = nextPages.filter((page) => Boolean(page.instagramUserId));
        const persistedAccount = euroAccounts.find((account) => account.id === result.selectedAccountId);
        const persistedPage = nextPages.find((page) => page.id === result.selectedPageId);
        setConfiguredAccountId(persistedAccount?.id || "");
        setConfiguredPageId(persistedPage?.id || "");
        setDraft((current) => {
          const existingAccount = euroAccounts.find((account) => account.id === current.adAccountId);
          const account = persistedAccount || existingAccount || (euroAccounts.length === 1 ? euroAccounts[0] : undefined);
          const existingPage = nextPages.find((page) => page.id === current.pageId);
          const page = persistedPage || existingPage || (channelId === "meta" && linkedInstagramPages.length === 1 ? linkedInstagramPages[0] : undefined);
          const adAccountId = account?.id || "";
          const pageId = channelId === "meta" ? page?.id || "" : current.pageId;
          if (current.adAccountId === adAccountId && current.accountCurrency === "EUR" && current.pageId === pageId) return current;
          return { ...current, adAccountId, accountCurrency: "EUR", pageId };
        });
        if (result.connectionStatus === "needs_update") {
          setNotice(`La connexion ${channelId === "google" ? "Google Ads" : "Meta Ads"} doit être actualisée avant de charger vos comptes.`);
        } else if (result.connected && euroAccounts.length === 1 && (channelId !== "meta" || linkedInstagramPages.length === 1)) {
          setNotice("Un seul compte éligible détecté : il est sélectionné automatiquement.");
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

  async function generateCopy() {
    setBusy("generate"); setNotice("");
    try {
      const result = await readJson(await fetch("/api/ads/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: channelId, channel: channelId, brief, brand }),
      }));
      const copy = result.copy as { primaryText: string; headlines: string[]; descriptions: string[]; keywords: string[] };
      updateDraft(copy);
      setNotice("Proposition IA prête : relisez-la avant d’enregistrer. 1 crédit IA utilisé.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "La génération IA a échoué.");
    } finally { setBusy(null); }
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
    setNotice(`Brouillon « ${campaign.name} » rouvert.`);
    setStep(compactScreen ? 2 : 1);
    setCreating(true);
  }

  const estimate = useMemo(() => {
    const days = Math.max(0, Math.ceil((Date.parse(`${draft.endDate}T23:59:59Z`) - Date.now()) / 86_400_000));
    return Number.isFinite(days) ? days * Number(draft.dailyBudgetEuros || 0) : 0;
  }, [draft.dailyBudgetEuros, draft.endDate]);

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
        <button type="button" onClick={() => { setStep(0); setCreating(true); }} className={`${styles.headerCta} ${styles.launchButton}`}><span aria-hidden="true">✦</span> Lancer une campagne <span aria-hidden="true">↗</span></button>
      </div>
      {notice && <div className={`${styles.notice} ${styles.cockpitNotice}`} role="status">{notice}</div>}

      <SettingsDrawer title="Créer une campagne" isOpen={creating} onClose={() => setCreating(false)} presentation="centered" headerLead={<div className={styles.modalBrand}>iNr’<span>ADS</span><small>STUDIO DE CAMPAGNE</small></div>} headerStyle={{ background: "radial-gradient(ellipse at 20% 0, #246bbd70, transparent 60%), linear-gradient(100deg, #172e5a, #392464 65%, #772b75)", borderBottom: "1px solid #c68aff66", boxShadow: "0 8px 35px #8a4ce52b", minHeight: 76 }} headerContent={<div className={styles.wizardTitle}><span className={styles.modalSpark} aria-hidden="true">✦</span><div>Créer une campagne <small>{stepNames[step]} · Étape {step + 1} / {stepNames.length}</small></div></div>}>
      <div className={styles.workspace} data-compact={compactScreen || undefined} data-short={shortScreen || undefined} data-stage={step} data-review={shortScreen && step === validationStart || undefined} data-launch={isAdsProvider(channelId) && shortScreen && step === lastStep || undefined} data-last-editorial={compactScreen && step === validationStart - 1 || undefined} onTouchStart={(event) => { const touch = event.touches[0]; touchStart.current = { x: touch.clientX, y: touch.clientY }; }} onTouchEnd={(event) => { const start = touchStart.current; touchStart.current = null; if (!start) return; const touch = event.changedTouches[0]; const dx = touch.clientX - start.x; const dy = touch.clientY - start.y; if (Math.abs(dx) > 75 && Math.abs(dx) > Math.abs(dy) * 1.5 && !(event.target instanceof HTMLElement && event.target.closest("input, textarea, select, button"))) setStep((current) => Math.max(0, Math.min(lastStep, current + (dx < 0 ? 1 : -1)))); }}>
      <nav className={styles.stepper} aria-label="Étapes de création">{stepNames.map((name, index) => <button type="button" key={name} aria-label={`${index + 1}. ${name}`} aria-current={step === index ? "step" : undefined} onClick={() => setStep(index)}><span>{index + 1}</span>{!compactScreen && name}</button>)}</nav>
      {notice && <div className={styles.notice} role="status">{notice}</div>}
      <section hidden={sectionStep !== 0} className={`${styles.card} ${styles.aiCard}`}>
          <div className={styles.sectionHeading}><div><span>01 · VOTRE IDÉE</span><h2>{compactScreen ? stepNames[step] : "Le déclic créatif"} <span aria-hidden="true" className={styles.spark}>✦</span></h2></div><span className={styles.credit}>1 crédit IA</span></div>
          <p className={styles.intro}>Une offre, une envie, un objectif. L’IA vous aide à trouver les mots qui font la différence.</p>
          <label className={styles.field}>Nom de l’entreprise
            <input value={brand} maxLength={120} onChange={(event) => setBrand(event.target.value)} placeholder="Ex. iNrCy" />
          </label>
          <label className={styles.field}>Que souhaitez-vous mettre en lumière ?
            <textarea value={brief} maxLength={1200} onChange={(event) => setBrief(event.target.value)} rows={5} placeholder="Votre offre, vos clients, ce qui vous rend unique…" />
          </label>
          <button type="button" className={styles.aiButton} disabled={busy !== null || brief.trim().length < 15} onClick={() => void generateCopy()}><span aria-hidden="true">✦</span> {busy === "generate" ? "L’IA prépare votre message…" : "Créer mon message avec l’IA"}</button>
          <p className={styles.help}>Vous gardez le dernier mot : ajustez les textes avant de publier.</p>
      </section>

      <section hidden={sectionStep !== 1} data-channel={channelId} className={`${styles.card} ${styles.campaignCard}`}>
        <div className={styles.sectionHeading}><div><span>02 · VOTRE CAMPAGNE</span><h2>{compactScreen ? stepNames[step] : "Faites passer le message."}</h2></div><span className={styles.credit}>{channelMeta.label}</span></div>
        <div className={styles.formGrid}>
          <label className={styles.field}>Nom de la campagne<input value={draft.name} maxLength={100} onChange={(event) => updateDraft({ name: event.target.value })} placeholder="Ex. Visibilité locale septembre" /></label>
          <label className={styles.field}>Budget {channelId === "google" ? "moyen" : "journalier indicatif"} (€ / jour)<input type="number" min="5" max="500" step="0.01" value={draft.dailyBudgetEuros} onChange={(event) => updateDraft({ dailyBudgetEuros: Number(event.target.value) })} /></label>
          <label className={styles.field}>Date de fin<input type="date" value={draft.endDate} onChange={(event) => updateDraft({ endDate: event.target.value })} /></label>
          <label className={styles.field}>Lien de votre offre<input type="url" value={draft.destinationUrl} onChange={(event) => updateDraft({ destinationUrl: event.target.value })} placeholder="https://votresite.fr/offre" /></label>
          {channelId === "meta" ? <>
            <label className={`${styles.field} ${styles.wide}`}>Texte principal<textarea rows={4} value={draft.primaryText} maxLength={500} onChange={(event) => updateDraft({ primaryText: event.target.value })} /></label>
            <label className={`${styles.field} ${styles.wide}`}>Lien de votre image<input type="url" value={draft.creativeUrl || draft.imageUrl} onChange={(event) => updateDraft({ imageUrl: event.target.value, creativeUrl: event.target.value, creativeType: "image" })} placeholder="https://votresite.fr/image.jpg" /></label>
          </> : channelId === "google" ? <>
            <label className={styles.field}>Titres (3 minimum, un par ligne, 30 caractères max)<textarea rows={3} value={editableList(draft.headlines)} onChange={(event) => updateDraft({ headlines: parseEditableList(event.target.value.split("\n")) })} /></label>
            <label className={styles.field}>Descriptions (2 minimum, une par ligne, 90 caractères max)<textarea rows={3} value={editableList(draft.descriptions)} onChange={(event) => updateDraft({ descriptions: parseEditableList(event.target.value.split("\n")) })} /></label>
            <label className={`${styles.field} ${styles.wide}`}>Mots-clés (un par ligne)<textarea rows={2} value={editableList(draft.keywords)} onChange={(event) => updateDraft({ keywords: parseEditableList(event.target.value.split("\n")) })} /></label>
          </> : <>
            <label className={`${styles.field} ${styles.wide}`}>Texte de la campagne<textarea rows={4} value={draft.primaryText} maxLength={1200} onChange={(event) => updateDraft({ primaryText: event.target.value })} placeholder="Présentez votre offre avec vos mots…" /></label>
            <label className={styles.field}>Format du visuel<select value={draft.creativeType || (channelId === "tiktok" ? "video" : "image")} onChange={(event) => updateDraft({ creativeType: event.target.value as "image" | "video" })}><option value="image">Image</option><option value="video">Vidéo</option></select></label>
            <label className={styles.field}>{draft.creativeType === "video" ? "Lien de votre vidéo" : "Lien de votre image"}<input type="url" value={draft.creativeUrl || ""} onChange={(event) => updateDraft({ creativeUrl: event.target.value })} placeholder={draft.creativeType === "video" ? "https://votresite.fr/video.mp4" : "https://votresite.fr/image.jpg"} /></label>
          </>}
        </div>
        <div className={`${styles.disclosure} ${!isAdsProvider(channelId) ? styles.draftOnlyDisclosure : ""}`}><div className={styles.budgetEstimate}><span>Budget indicatif</span><strong>{Number.isFinite(estimate) ? estimate.toLocaleString("fr-FR", { style: "currency", currency: "EUR" }) : "—"}</strong></div><p>{channelId === "meta" ? "La facturation du budget média est gérée directement par Meta. Estimation jusqu’à la date de fin, sans garantie de plafond total." : channelId === "google" ? "Google gère directement la facturation. Le budget quotidien est une moyenne : la dépense peut varier selon les jours." : "Aucune dépense n’est engagée pendant la préparation. Le budget reste indicatif tant que ce canal n’est pas connecté."}</p></div>
        {channelId === "meta" && <label className={styles.check}><input type="checkbox" checked={draft.noSpecialCategoryConfirmed} onChange={(event) => updateDraft({ noSpecialCategoryConfirmed: event.target.checked })} />Je confirme que cette annonce ne concerne aucune catégorie spéciale Meta (crédit, emploi, logement ou enjeux sociaux/politiques).</label>}
        {channelId === "google" && <label className={styles.check}><input type="checkbox" checked={draft.notEuPoliticalConfirmed} onChange={(event) => updateDraft({ notEuPoliticalConfirmed: event.target.checked })} />Je certifie que cette campagne ne contient pas de publicité politique ciblant l’Union européenne.</label>}
        <div className={styles.actions}>
          <button type="button" className={styles.secondaryButton} disabled={busy !== null} onClick={() => void saveDraft()}>{busy === "save" ? "Enregistrement…" : savedId && dirty ? "Mettre à jour le brouillon" : "Enregistrer le brouillon"}</button>
          <span>{savedId && !dirty ? "Brouillon enregistré" : !isAdsProvider(channelId) ? "Préparation uniquement : connexion et publication non disponibles." : !connected || !draft.adAccountId ? "Vous pouvez sauvegarder sans compte connecté." : "Votre campagne reste un brouillon tant que vous ne la publiez pas."}</span>
        </div>
      </section>

      <section hidden={sectionStep !== 2} className={`${styles.card} ${styles.publishCard}`}>
        <div className={styles.sectionHeading}><div><span>{isAdsProvider(channelId) ? "03 · À VOUS DE JOUER" : "03 · PRÉPARATION TERMINÉE"}</span><h2>{isAdsProvider(channelId) ? "Prêt à rayonner ?" : "Votre brouillon est prêt."}</h2></div><span className={styles.launchIcon} aria-hidden="true">{isAdsProvider(channelId) ? "↗" : "✦"}</span></div>
        <dl className={styles.summary}><div><dt>Campagne</dt><dd>{draft.name || "À renseigner"}</dd></div><div><dt>Canal / compte</dt><dd>{channelMeta.label} · {selectedAccount?.name || (isAdsProvider(channelId) ? "À configurer" : "Pas encore connecté")}</dd></div><div><dt>Budget quotidien</dt><dd>{draft.dailyBudgetEuros.toLocaleString("fr-FR")} € / jour</dd></div><div><dt>Date de fin</dt><dd>{draft.endDate}</dd></div></dl>
        {!isAdsProvider(channelId) ? <p className={styles.draftOnlyWarning}><strong>Brouillon uniquement pour le moment</strong>La connexion à {channelMeta.label} et sa publication ne sont pas encore disponibles dans iNr’ADS. Vous pouvez enregistrer cette préparation ; aucune annonce ne part et aucun budget média n’est engagé.</p> : <>
          {demoPausedPublishingEnabled && <p className={styles.warning}><strong>Mode démo sécurisé</strong>Cette démonstration crée les éléments chez {channelMeta.label}, tous maintenus en pause. Aucune diffusion ni dépense ne peut démarrer.</p>}
          {!livePublishingEnabled && <p className={styles.warning}><strong>Publication bientôt disponible</strong>Préparez dès maintenant vos messages et vos brouillons. La diffusion des annonces n’est pas encore activée.</p>}
        </>}
        {isAdsProvider(channelId) ? <>
          {demoPausedPublishingEnabled && <button type="button" className={styles.secondaryButton} disabled={channelId !== provider || !savedId || dirty || !connected || busy !== null} onClick={() => void createPausedDemo()}>{busy === "demo" ? "Création de la démo…" : "Créer une démo en pause"} <span aria-hidden="true">↗</span></button>}
          <label className={styles.check}><input type="checkbox" checked={confirmedSpend} onChange={(event) => setConfirmedSpend(event.target.checked)} />Je valide le compte, le texte, la destination, la date de fin et la facturation directe par {channelId === "meta" ? "Meta" : "Google"}.</label>
          <button type="button" className={styles.primaryButton} disabled={channelId !== provider || !livePublishingEnabled || !savedId || dirty || !connected || !confirmedSpend || busy !== null} onClick={() => void publish()}>{busy === "publish" ? "Publication en cours…" : `Publier sur ${channelMeta.label}`} <span aria-hidden="true">↗</span></button>
        </> : <button type="button" className={styles.primaryButton} disabled={busy !== null} onClick={() => void saveDraft()}>{busy === "save" ? "Enregistrement…" : savedId && !dirty ? "Brouillon enregistré" : "Enregistrer ce brouillon"}<span aria-hidden="true">↗</span></button>}
      </section>
      <div className={styles.wizardNavigation}><button type="button" className={styles.back} disabled={step === 0} onClick={() => setStep((current) => current - 1)}>← Précédent</button><span>{step + 1} / {stepNames.length}</span>{step < lastStep ? <button type="button" className={styles.headerCta} onClick={() => setStep((current) => current + 1)}>Suivant →</button> : <button type="button" className={styles.back} onClick={() => setCreating(false)}>Revenir au cockpit</button>}</div>
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
  </main>;
}
