"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { StoredAdsCampaign } from "@/app/dashboard/ads/AdsCampaignTracking";
import { getAdsAdvertiserAccountUrl } from "@/lib/adsAccountLinks";
import {
  ADS_LOCAL_RECOVERY_DISCARD_CONFIRMATION,
  ADS_REMOTE_DELETE_CONFIRMATION,
  canDiscardInterruptedInitialPublish,
  canManageRemoteAdsCampaign,
  canRecoverInterruptedAdsCampaign,
  type AdsCampaignLifecycleAction,
} from "@/lib/adsCampaignLifecycle";
import { googleCampaignId, metaCampaignId, type AdsCampaignMetrics } from "@/lib/adsCampaignMetrics";
import type { AdsCampaignInput } from "@/lib/adsValidation";
import { adsChannelLabels, adsDate, adsDateTime, adsStatusLabels } from "./adsCampaignsFolder.shared";
import mailboxStyles from "../mails.module.css";
import styles from "./AdsCampaignsFolder.module.css";

type Props = {
  campaigns: StoredAdsCampaign[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  onRefresh: () => Promise<boolean>;
};

type MetricsState = { status: "loading" | "ready" | "empty" | "error"; metrics?: AdsCampaignMetrics; error?: string };
type DetailsTab = "info" | "stats";
type RemoteEditState = {
  name: string;
  dailyBudgetEuros: string;
  endDate: string;
  targetLocations: string;
};
type RemoteEditDirty = Record<keyof RemoteEditState, boolean>;
const euro = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const number = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
const cleanRemoteEditDirty = (): RemoteEditDirty => ({ name: false, dailyBudgetEuros: false, endDate: false, targetLocations: false });

function plusUtcDays(days: number) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days)).toISOString().slice(0, 10);
}

function dayAfter(value: string) {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) ? new Date(timestamp + 86_400_000).toISOString().slice(0, 10) : plusUtcDays(1);
}

function remoteLocations(value: string) {
  return value.split(/\r?\n|;/).map((entry) => entry.trim()).filter(Boolean);
}

function remoteEditValidation(state: RemoteEditState, dirty: RemoteEditDirty): string | null {
  if (!Object.values(dirty).some(Boolean)) return "Modifiez au moins un champ avant d’enregistrer.";
  if (dirty.name && (state.name.trim().length < 3 || state.name.trim().length > 100)) {
    return "Le nom doit contenir entre 3 et 100 caractères.";
  }
  if (dirty.dailyBudgetEuros) {
    const amount = Number(state.dailyBudgetEuros);
    const cents = Math.round(amount * 100);
    if (!Number.isFinite(amount) || amount < 5 || amount > 500 || Math.abs(cents - amount * 100) > 0.000001) {
      return "Le budget doit être compris entre 5 et 500 €, avec deux décimales maximum.";
    }
  }
  if (dirty.endDate && (!/^\d{4}-\d{2}-\d{2}$/.test(state.endDate) || state.endDate < plusUtcDays(1) || state.endDate > plusUtcDays(90))) {
    return "La date de fin doit être comprise entre demain et dans 90 jours.";
  }
  if (dirty.targetLocations) {
    const locations = remoteLocations(state.targetLocations);
    if (!locations.length || locations.length > 20 || locations.some((entry) => entry.length > 120)) {
      return "Indiquez entre 1 et 20 zones, une par ligne.";
    }
  }
  return null;
}

function canChangeDraft(campaign: StoredAdsCampaign) {
  return campaign.status === "draft" && Boolean(campaign.draft) && !campaign.published_at
    && campaign.provider_resources !== null && typeof campaign.provider_resources === "object"
    && !Array.isArray(campaign.provider_resources) && Object.keys(campaign.provider_resources).length === 0;
}

function canReadMetrics(campaign: StoredAdsCampaign) {
  if (!["active", "paused", "demo_paused", "needs_review"].includes(campaign.status)) return false;
  return campaign.provider === "google"
    ? Boolean(googleCampaignId(campaign.provider_resources, campaign.ad_account_id))
    : campaign.provider === "meta" && Boolean(metaCampaignId(campaign.provider_resources, campaign.ad_account_id));
}

function isCampaignMetrics(value: unknown): value is AdsCampaignMetrics {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const metrics = value as Record<string, unknown>;
  return metrics.period === "last_30_days" && (metrics.source === "google" || metrics.source === "meta")
    && [metrics.impressions, metrics.clicks, metrics.spendEuros].every((entry) => typeof entry === "number" && Number.isFinite(entry) && entry >= 0)
    && (metrics.conversions === null || (typeof metrics.conversions === "number" && Number.isFinite(metrics.conversions) && metrics.conversions >= 0))
    && typeof metrics.fetchedAt === "string";
}

function field(label: string, value: unknown) {
  const displayed = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())).join(" · ")
    : typeof value === "string" ? value.trim() : typeof value === "number" ? String(value)
      : typeof value === "boolean" ? value ? "Oui" : "Non" : "";
  return displayed ? { label, value: displayed } : null;
}

async function readActionResponse(response: Response) {
  const result = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(result?.error || "L’action n’a pas pu être terminée.");
}

export default function AdsCampaignDetailsModal({ campaigns, selectedId, onSelect, onClose, onRefresh }: Props) {
  const router = useRouter();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef<string | null>(null);
  const [portalReady, setPortalReady] = useState(false);
  const [metricsById, setMetricsById] = useState<Record<string, MetricsState>>({});
  const [extendId, setExtendId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [remoteEditId, setRemoteEditId] = useState<string | null>(null);
  const [remoteEdit, setRemoteEdit] = useState<RemoteEditState>({ name: "", dailyBudgetEuros: "", endDate: "", targetLocations: "" });
  const [remoteEditDirty, setRemoteEditDirty] = useState<RemoteEditDirty>(cleanRemoteEditDirty);
  const [nextDate, setNextDate] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [activeTab, setActiveTab] = useState<DetailsTab>("info");

  onCloseRef.current = onClose;
  busyRef.current = busyId;

  const selectedIndex = campaigns.findIndex((campaign) => campaign.id === selectedId);
  const campaign = selectedIndex >= 0 ? campaigns[selectedIndex] : null;
  const open = Boolean(campaign);

  useEffect(() => { setPortalReady(true); }, []);

  useEffect(() => {
    if (selectedId !== null) return;
    setActionError("");
    setActionSuccess("");
    setExtendId(null);
    setDeleteId(null);
    setRemoteEditId(null);
  }, [selectedId]);

  useEffect(() => {
    if (selectedId) setActiveTab("info");
  }, [selectedId]);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!busyRef.current) onCloseRef.current();
      }
      if (event.key !== "Tab" || !cardRef.current) return;
      const elements = Array.from(cardRef.current.querySelectorAll<HTMLElement>("button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),summary"));
      if (!elements.length) return;
      if (event.shiftKey && document.activeElement === elements[0]) { event.preventDefault(); elements.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === elements.at(-1)) { event.preventDefault(); elements[0]?.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); openerRef.current?.focus(); };
  }, [open]);

  const loadMetrics = useCallback(async (current: StoredAdsCampaign) => {
    if (!canReadMetrics(current)) return;
    setMetricsById((previous) => ({ ...previous, [current.id]: { status: "loading" } }));
    try {
      const response = await fetch(`/api/ads/campaigns/${encodeURIComponent(current.id)}/metrics`, { cache: "no-store" });
      const result = await response.json().catch(() => null) as { metrics?: unknown; reason?: string; error?: string } | null;
      if (!response.ok) throw new Error(result?.error || "Les statistiques ne sont pas disponibles pour le moment.");
      setMetricsById((previous) => ({ ...previous, [current.id]: result?.metrics === null && result?.reason === "no_data"
        ? { status: "empty" }
        : isCampaignMetrics(result?.metrics) ? { status: "ready", metrics: result.metrics }
          : { status: "error", error: "La plateforme n’a pas retourné de statistiques exploitables." } }));
    } catch (error) {
      setMetricsById((previous) => ({ ...previous, [current.id]: { status: "error", error: error instanceof Error ? error.message : "Statistiques indisponibles." } }));
    }
  }, []);

  useEffect(() => {
    if (campaign && canReadMetrics(campaign) && !metricsById[campaign.id]) void loadMetrics(campaign);
  }, [campaign, metricsById, loadMetrics]);

  function close() {
    if (busyId) return;
    setExtendId(null);
    setDeleteId(null);
    setRemoteEditId(null);
    setActionError("");
    onClose();
  }

  function navigate(direction: -1 | 1) {
    const next = campaigns[selectedIndex + direction];
    if (!next || busyId) return;
    setExtendId(null);
    setDeleteId(null);
    setRemoteEditId(null);
    setActionError("");
    setActionSuccess("");
    onSelect(next.id);
  }

  async function extendDraft(current: StoredAdsCampaign) {
    if (!nextDate || busyId) return;
    setBusyId(current.id);
    setActionError("");
    try {
      await readActionResponse(await fetch(`/api/ads/campaigns/${encodeURIComponent(current.id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endDate: nextDate }),
      }));
      const refreshed = await onRefresh();
      setExtendId(null);
      setNextDate("");
      if (refreshed) setActionSuccess("La date de fin du brouillon a été mise à jour.");
      else setActionError("La date a bien été enregistrée, mais la liste n’a pas pu être actualisée.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Impossible de prolonger ce brouillon.");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteDraft(current: StoredAdsCampaign) {
    if (busyId) return;
    setBusyId(current.id);
    setActionError("");
    try {
      await readActionResponse(await fetch(`/api/ads/campaigns/${encodeURIComponent(current.id)}`, { method: "DELETE" }));
      onClose();
      setDeleteId(null);
      await onRefresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Impossible de supprimer ce brouillon.");
    } finally {
      setBusyId(null);
    }
  }

  function openRemoteEdit(current: StoredAdsCampaign, currentDraft: Partial<AdsCampaignInput>) {
    setRemoteEditId(current.id);
    setExtendId(null);
    setDeleteId(null);
    setActionError("");
    setActionSuccess("");
    setRemoteEdit({
      name: current.name || "",
      dailyBudgetEuros: Number.isFinite(current.daily_budget_cents) ? (current.daily_budget_cents / 100).toFixed(2) : "",
      endDate: current.end_date || "",
      targetLocations: Array.isArray(currentDraft.targetLocations) ? currentDraft.targetLocations.join("\n") : "",
    });
    setRemoteEditDirty(cleanRemoteEditDirty());
  }

  async function runRemoteAction(
    current: StoredAdsCampaign,
    action: AdsCampaignLifecycleAction,
    changes?: Record<string, unknown>,
  ) {
    if (busyId) return;
    setBusyId(current.id);
    setActionError("");
    setActionSuccess("");
    try {
      await readActionResponse(await fetch(`/api/ads/campaigns/${encodeURIComponent(current.id)}/lifecycle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(changes ? { changes } : {}) }),
      }));
      const refreshed = await onRefresh();
      setRemoteEditId(null);
      const successMessage = action === "pause"
        ? "La campagne est maintenant en pause sur la plateforme publicitaire."
        : action === "resume"
          ? "La campagne est maintenant active sur la plateforme publicitaire."
        : action === "reconcile"
          ? "Le statut de la campagne a été resynchronisé avec la plateforme publicitaire."
        : "La campagne a été mise à jour sur la plateforme publicitaire.";
      if (refreshed) setActionSuccess(successMessage);
      else setActionError(`${successMessage} La liste iNrSend n’a toutefois pas pu être actualisée.`);
    } catch (error) {
      if (action === "reconcile") await onRefresh();
      setActionError(error instanceof Error ? error.message : "Impossible de gérer cette campagne.");
    } finally {
      setBusyId(null);
    }
  }

  async function saveRemoteEdit(current: StoredAdsCampaign) {
    const validationError = remoteEditValidation(remoteEdit, remoteEditDirty);
    if (validationError) {
      setActionError(validationError);
      return;
    }
    await runRemoteAction(current, "update", {
      ...(remoteEditDirty.name ? { name: remoteEdit.name } : {}),
      ...(remoteEditDirty.dailyBudgetEuros ? { dailyBudgetEuros: Number(remoteEdit.dailyBudgetEuros) } : {}),
      ...(remoteEditDirty.endDate ? { endDate: remoteEdit.endDate } : {}),
      ...(remoteEditDirty.targetLocations ? { targetLocations: remoteLocations(remoteEdit.targetLocations) } : {}),
    });
  }

  async function deleteRemoteCampaign(current: StoredAdsCampaign) {
    if (busyId) return;
    setBusyId(current.id);
    setActionError("");
    try {
      await readActionResponse(await fetch(`/api/ads/campaigns/${encodeURIComponent(current.id)}/lifecycle`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmation: canDiscardInterruptedInitialPublish(current)
            ? ADS_LOCAL_RECOVERY_DISCARD_CONFIRMATION
            : ADS_REMOTE_DELETE_CONFIRMATION,
        }),
      }));
      onClose();
      setDeleteId(null);
      await onRefresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Impossible de supprimer cette campagne.");
    } finally {
      setBusyId(null);
    }
  }

  if (!portalReady || !campaign) return null;

  const draft: Partial<AdsCampaignInput> = campaign.draft && typeof campaign.draft === "object" ? campaign.draft : {};
  const canChange = canChangeDraft(campaign);
  const canDiscardLocalRecovery = canDiscardInterruptedInitialPublish(campaign);
  const canManageRemote = canManageRemoteAdsCampaign(campaign);
  const isInterruptedRemoteOperation = canRecoverInterruptedAdsCampaign(campaign);
  const canEditRemote = canManageRemote && (campaign.provider === "google" || campaign.provider === "meta")
    && (campaign.status === "active" || campaign.status === "paused" || campaign.status === "demo_paused");
  const canToggleRemote = canManageRemote && (campaign.status === "active" || campaign.status === "paused");
  const canDeleteRemote = canManageRemote && (campaign.provider === "google" || campaign.provider === "meta");
  const canMetrics = canReadMetrics(campaign);
  const remoteEditError = remoteEditValidation(remoteEdit, remoteEditDirty);
  const metricsState = metricsById[campaign.id];
  const minDate = [dayAfter(campaign.end_date), plusUtcDays(1)].sort().at(-1) || "";
  const maxDate = plusUtcDays(90);
  const accountUrl = getAdsAdvertiserAccountUrl(campaign.provider, campaign.ad_account_id);
  const providerCampaignId = campaign.provider === "google"
    ? googleCampaignId(campaign.provider_resources, campaign.ad_account_id)
    : campaign.provider === "meta" ? metaCampaignId(campaign.provider_resources, campaign.ad_account_id)
      : campaign.provider === "pinterest" && typeof campaign.provider_resources?.campaignId === "string"
        ? campaign.provider_resources.campaignId : null;
  const campaignFields = [
    field("Compte annonceur", campaign.ad_account_id || "Non associé"),
    field("Identifiant sur la plateforme", providerCampaignId),
    field("Offre / service", draft.offer),
    field("Objectif", draft.objective),
    field("Conversion", [draft.conversionGoal, draft.conversionLocation]),
    field("Type de campagne", draft.campaignType),
    field("Stratégie média", draft.mediaStrategy),
    field("Stratégie d’enchères", draft.bidStrategy),
    field("Destination", draft.destinationUrl || "Non renseignée"),
    field("Expansion des URL", draft.urlExpansion),
    field("URL exclues", draft.urlExclusions),
    field("Zones ciblées", draft.targetLocations),
    field("Audiences", draft.targetAudiences),
    field("Langues", draft.languages),
    field("Partenaires de recherche Google", campaign.provider === "google" ? draft.googleSearchPartners : undefined),
    field("Extension au Réseau Display", campaign.provider === "google" ? draft.googleDisplayExpansion : undefined),
    field("Expansion de l’audience Meta", campaign.provider === "meta" ? draft.metaAudienceExpansion : undefined),
    field("Placements Meta", draft.metaPlacements),
    field("Page Facebook", draft.pageId),
    field("Mots-clés", draft.keywords),
    field("Mots-clés exclus", draft.negativeKeywords),
    field("Titres", draft.headlines),
    field("Descriptions", draft.descriptions),
    field("Message principal", draft.primaryText),
    field("Appel à l’action", draft.callToAction),
    field("Brief média", draft.mediaBrief),
    field("Visuel Feed Meta (4:5)", campaign.provider === "meta" ? draft.metaCreativeAssets?.feedImageUrl || draft.imageUrl : undefined),
    field("Visuel Story / Reel Meta (9:16)", campaign.provider === "meta" ? draft.metaCreativeAssets?.storyReelImageUrl : undefined),
    field("Média", campaign.provider !== "meta" ? draft.creativeUrl || draft.imageUrl : undefined),
    field("Type de média", draft.creativeType),
    field("Paramètres de suivi", draft.trackingParameters),
    field("Aucune catégorie publicitaire spéciale", campaign.provider === "meta" ? draft.noSpecialCategoryConfirmed : undefined),
    field("Aucune publicité politique UE", draft.notEuPoliticalConfirmed),
  ].filter((entry): entry is { label: string; value: string } => entry !== null);

  return createPortal(<div className={`${mailboxStyles.modalOverlay} ${styles.fullScreenOverlay}`} onClick={close}>
    <div ref={cardRef} className={`${mailboxStyles.modalCard} ${mailboxStyles.detailsModalCard} ${styles.modal} ${styles.fullScreenModal}`} role="dialog" aria-modal="true" aria-labelledby="ads-campaign-details-title" onClick={(event) => event.stopPropagation()}>
      <div className={mailboxStyles.modalHeader}>
        <div className={mailboxStyles.modalTitle}>Détails · {adsChannelLabels[campaign.provider] || campaign.provider}</div>
        <div className={mailboxStyles.detailsHeaderActions}>
          <div className={mailboxStyles.detailsNavigation} aria-label="Navigation dans les campagnes">
            <button type="button" className={`${mailboxStyles.btnGhost} ${mailboxStyles.detailsNavigationButton}`} disabled={selectedIndex <= 0 || Boolean(busyId)} onClick={() => navigate(-1)} aria-label="Campagne précédente">‹</button>
            <span className={mailboxStyles.detailsNavigationCounter}>{selectedIndex + 1} / {campaigns.length}</span>
            <button type="button" className={`${mailboxStyles.btnGhost} ${mailboxStyles.detailsNavigationButton}`} disabled={selectedIndex >= campaigns.length - 1 || Boolean(busyId)} onClick={() => navigate(1)} aria-label="Campagne suivante">›</button>
          </div>
          <button ref={closeRef} type="button" className={mailboxStyles.btnGhost} disabled={Boolean(busyId)} onClick={close} aria-label="Fermer les détails">✕</button>
        </div>
      </div>
      <div className={`${mailboxStyles.modalBody} ${styles.modalBody}`}>
        <div className={styles.detailHeading}>
          <div className={styles.detailTitle}><h2 id="ads-campaign-details-title">{campaign.name || "Campagne sans titre"}</h2><p>{adsChannelLabels[campaign.provider] || campaign.provider} · créée le {adsDateTime(campaign.created_at)}</p></div>
          <div className={styles.detailHeadingControls}>
            <span className={styles.status} data-status={campaign.status}>{adsStatusLabels[campaign.status] || "À vérifier"}</span>
            <div className={`${styles.actions} ${styles.headerActions}`}>
              {canChange ? <>
                <button type="button" className={styles.primary} disabled={Boolean(busyId)} onClick={() => router.push(`/dashboard/ads?channel=${encodeURIComponent(campaign.provider)}&editCampaign=${encodeURIComponent(campaign.id)}`)}>Modifier</button>
                {minDate <= maxDate && <button type="button" className={mailboxStyles.btnGhost} disabled={Boolean(busyId)} onClick={() => { setExtendId(campaign.id); setDeleteId(null); setActionError(""); setNextDate(minDate); }}>Prolonger</button>}
                <button type="button" className={styles.danger} disabled={Boolean(busyId)} onClick={() => { setDeleteId(campaign.id); setExtendId(null); setActionError(""); }}>Supprimer</button>
              </> : canDiscardLocalRecovery ? <button type="button" className={styles.danger} disabled={Boolean(busyId)} onClick={() => { setDeleteId(campaign.id); setExtendId(null); setRemoteEditId(null); setActionError(""); }}>Nettoyer ce suivi local</button> : isInterruptedRemoteOperation ? <button type="button" className={mailboxStyles.btnGhost} disabled={Boolean(busyId)} onClick={() => void runRemoteAction(campaign, "reconcile")}>{busyId === campaign.id ? "Contrôle…" : "Contrôler l’opération interrompue"}</button> : canManageRemote ? <>
                {canEditRemote && <>
                  <button type="button" className={styles.primary} disabled={Boolean(busyId)} onClick={() => openRemoteEdit(campaign, draft)}>Modifier</button>
                </>}
                {canToggleRemote && campaign.status === "active" && <button type="button" className={mailboxStyles.btnGhost} disabled={Boolean(busyId)} onClick={() => void runRemoteAction(campaign, "pause")}>{busyId === campaign.id ? "Synchronisation…" : "Mettre en pause"}</button>}
                {canToggleRemote && campaign.status === "paused" && <button type="button" className={styles.primary} disabled={Boolean(busyId)} onClick={() => void runRemoteAction(campaign, "resume")}>{busyId === campaign.id ? "Activation…" : "Reprendre la campagne"}</button>}
                {campaign.status === "needs_review" && <button type="button" className={mailboxStyles.btnGhost} disabled={Boolean(busyId)} onClick={() => void runRemoteAction(campaign, "reconcile")}>{busyId === campaign.id ? "Contrôle…" : "Resynchroniser le statut"}</button>}
                {canDeleteRemote && <button type="button" className={styles.danger} disabled={Boolean(busyId)} onClick={() => { setDeleteId(campaign.id); setExtendId(null); setRemoteEditId(null); setActionError(""); }}>Supprimer</button>}
              </> : null}
              {accountUrl && campaign.status !== "draft" && <a className={mailboxStyles.btnGhost} href={accountUrl} target="_blank" rel="noopener noreferrer">Ouvrir le compte publicitaire ↗</a>}
            </div>
          </div>
        </div>
        {actionSuccess && <p className={styles.success} role="status">{actionSuccess}</p>}
        {campaign.last_error && <p className={styles.error} role="alert">Contrôle nécessaire : {campaign.last_error}</p>}
        {actionError && <p className={styles.error} role="alert">{actionError}</p>}
        {canDiscardLocalRecovery ? <p className={styles.muted}>Aucun identifiant de campagne distante n’a été enregistré. Contrôlez d’abord le compte publicitaire ; ce nettoyage ne déclenche aucune action sur la plateforme.</p>
          : isInterruptedRemoteOperation ? <p className={styles.muted}>iNrSend vérifie que l’opération est réellement interrompue puis la place en contrôle, sans jamais activer de dépense.</p>
            : campaign.status === "paused" ? <p className={styles.muted}>{campaign.provider === "openai"
              ? "Cette campagne ChatGPT Ads a été créée en pause, sans diffusion. Contrôlez-la et activez-la uniquement depuis Ads Manager ; l’activation depuis iNrSend n’est pas disponible."
              : "Cette campagne existe réellement sur la plateforme et reste sans diffusion. Vous pouvez la reprendre ici sans la recréer."}</p>
              : canManageRemote && campaign.status === "needs_review" ? <p className={styles.muted}>Cette lecture ne réactive pas la campagne. Une opération interrompue est vérifiée avant d’être enregistrée localement.</p>
              : !canChange && !canManageRemote ? <p className={styles.muted}>Cette campagne ne dispose pas d’identifiants fournisseur complets. Contrôlez-la sur la plateforme publicitaire.</p>
                : null}
        {remoteEditId === campaign.id && <form className={`${styles.confirmation} ${styles.editPanel}`} noValidate onSubmit={(event) => { event.preventDefault(); void saveRemoteEdit(campaign); }}>
          <div className={styles.editHeading}><div><strong>Modifier la campagne sur {adsChannelLabels[campaign.provider] || campaign.provider}</strong><p>Les changements seront envoyés à la plateforme avant d’être enregistrés dans iNrSend.</p></div><button type="button" className={mailboxStyles.btnGhost} onClick={() => setRemoteEditId(null)} disabled={Boolean(busyId)}>Fermer</button></div>
          <div className={styles.editGrid}>
            <label>Nom de la campagne<input type="text" minLength={3} maxLength={100} value={remoteEdit.name} onChange={(event) => { setRemoteEdit((current) => ({ ...current, name: event.target.value })); setRemoteEditDirty((current) => ({ ...current, name: true })); }} /></label>
            <label>Budget quotidien (€)<input type="number" inputMode="decimal" min="5" max="500" step="0.01" value={remoteEdit.dailyBudgetEuros} onChange={(event) => { setRemoteEdit((current) => ({ ...current, dailyBudgetEuros: event.target.value })); setRemoteEditDirty((current) => ({ ...current, dailyBudgetEuros: true })); }} /></label>
            <label>Date de fin<input type="date" min={plusUtcDays(1)} max={maxDate} value={remoteEdit.endDate} onChange={(event) => { setRemoteEdit((current) => ({ ...current, endDate: event.target.value })); setRemoteEditDirty((current) => ({ ...current, endDate: true })); }} /></label>
            <label className={styles.editLocations}>Zones ciblées<textarea rows={4} maxLength={2_500} value={remoteEdit.targetLocations} onChange={(event) => { setRemoteEdit((current) => ({ ...current, targetLocations: event.target.value })); setRemoteEditDirty((current) => ({ ...current, targetLocations: true })); }} placeholder="Une zone par ligne, par exemple : Lille&#10;Hauts-de-France" /><small>1 à 20 zones. Les noms sont revalidés par la plateforme.</small></label>
          </div>
          <div><button type="submit" className={styles.primary} disabled={busyId === campaign.id || Boolean(remoteEditError)}>{busyId === campaign.id ? "Mise à jour sur la plateforme…" : "Enregistrer sur la plateforme"}</button><button type="button" className={mailboxStyles.btnGhost} onClick={() => setRemoteEditId(null)} disabled={Boolean(busyId)}>Annuler</button></div>
          {remoteEditError && <small role="status">{remoteEditError}</small>}
        </form>}
        {extendId === campaign.id && <div className={styles.confirmation}><label>Nouvelle date de fin du brouillon <input type="date" value={nextDate} min={minDate} max={maxDate} onChange={(event) => setNextDate(event.target.value)} /></label><div><button type="button" className={styles.primary} disabled={busyId === campaign.id || !nextDate || nextDate < minDate || nextDate > maxDate} onClick={() => void extendDraft(campaign)}>{busyId ? "Enregistrement…" : "Enregistrer"}</button><button type="button" className={mailboxStyles.btnGhost} onClick={() => setExtendId(null)} disabled={Boolean(busyId)}>Annuler</button></div><small>Le changement concerne uniquement le brouillon iNr’ADS.</small></div>}
        {deleteId === campaign.id && <div className={styles.confirmation}><strong>{canChange ? "Supprimer définitivement ce brouillon ?" : canDiscardLocalRecovery ? "Retirer définitivement ce suivi local interrompu ?" : `Supprimer définitivement la campagne sur ${adsChannelLabels[campaign.provider] || campaign.provider} ?`}</strong><p>{canChange ? "Aucune campagne publiée ne sera supprimée." : canDiscardLocalRecovery ? "Vérifiez d’abord le compte publicitaire. Aucun identifiant de campagne n’étant disponible, cette action retire uniquement la ligne iNrSend et ne modifie rien sur la plateforme." : "Cette action supprime la campagne chez le fournisseur puis la retire d’iNrSend. Elle est irréversible."}</p><div><button type="button" className={styles.danger} disabled={busyId === campaign.id} onClick={() => void (canChange ? deleteDraft(campaign) : deleteRemoteCampaign(campaign))}>{busyId ? "Suppression…" : canDiscardLocalRecovery ? "Confirmer le nettoyage local" : "Confirmer la suppression définitive"}</button><button type="button" className={mailboxStyles.btnGhost} onClick={() => setDeleteId(null)} disabled={Boolean(busyId)}>Annuler</button></div></div>}

        <div className={styles.detailTabs} role="tablist" aria-label="Détails de la campagne">
          <button id="ads-campaign-info-tab" type="button" role="tab" aria-selected={activeTab === "info"} aria-controls="ads-campaign-info-panel" data-active={activeTab === "info"} onClick={() => setActiveTab("info")}>Infos campagne</button>
          <button id="ads-campaign-stats-tab" type="button" role="tab" aria-selected={activeTab === "stats"} aria-controls="ads-campaign-stats-panel" data-active={activeTab === "stats"} onClick={() => setActiveTab("stats")}>Stats</button>
        </div>

        {activeTab === "info" ? <div id="ads-campaign-info-panel" className={styles.tabPanel} role="tabpanel" aria-labelledby="ads-campaign-info-tab">
          <section className={styles.section} aria-label="Informations générales"><h3>Informations générales</h3><dl className={styles.detailGrid}>
            <div><dt>Budget par jour</dt><dd>{Number.isFinite(campaign.daily_budget_cents) ? euro.format(campaign.daily_budget_cents / 100) : "—"}</dd></div>
            <div><dt>Fin prévue</dt><dd>{adsDate(campaign.end_date)}</dd></div>
            <div><dt>Publication enregistrée</dt><dd>{adsDateTime(campaign.published_at)}</dd></div>
            <div><dt>Mode de création</dt><dd>{draft.creationMode === "inrcy" ? "Avec iNr’Cy" : "Manuel"}</dd></div>
          </dl></section>

          <section className={styles.section} aria-label="Contenu de la campagne"><h3>Contenu de la campagne</h3><dl className={styles.detailGrid}>
            {campaignFields.map(({ label, value }) => <div key={label}><dt>{label}</dt><dd>{(label === "Destination" || label.startsWith("Visuel") || label === "Média") && (/^https:\/\//i.test(value) || value.startsWith("/api/")) ? <a href={value} target="_blank" rel="noopener noreferrer">{value} ↗</a> : value}</dd></div>)}
          </dl>
            {draft.channelDraft && <details className={styles.advanced}><summary>Brief spécifique au canal</summary><pre>{JSON.stringify(draft.channelDraft, null, 2)}</pre></details>}
            {draft.channelSettings && <details className={styles.advanced}><summary>Réglages du canal</summary><pre>{JSON.stringify(draft.channelSettings, null, 2)}</pre></details>}
          </section>
        </div> : <section id="ads-campaign-stats-panel" className={`${styles.section} ${styles.tabPanel}`} role="tabpanel" aria-labelledby="ads-campaign-stats-tab" aria-label="Statistiques de la campagne"><div className={styles.sectionHeading}><h3>Statistiques · 30 derniers jours</h3>{canMetrics && <button type="button" className={mailboxStyles.btnGhost} disabled={metricsState?.status === "loading"} onClick={() => void loadMetrics(campaign)}>{metricsState?.status === "loading" ? "Lecture…" : "Actualiser"}</button>}</div>
          {metricsState?.status === "ready" && metricsState.metrics ? <><p className={styles.metricSource}>{metricsState.metrics.source === "google" ? "Google Ads" : "Meta Ads"} · relevé le {adsDateTime(metricsState.metrics.fetchedAt)}</p><dl className={styles.metricsGrid}>
            <div><dt>Impressions</dt><dd>{number.format(metricsState.metrics.impressions)}</dd></div><div><dt>Clics</dt><dd>{number.format(metricsState.metrics.clicks)}</dd></div><div><dt>Dépenses</dt><dd>{euro.format(metricsState.metrics.spendEuros)}</dd></div><div><dt>Conversions</dt><dd>{metricsState.metrics.conversions === null ? "Non harmonisées" : number.format(metricsState.metrics.conversions)}</dd></div>
          </dl></> : <p className={styles.metricSource} role={metricsState?.status === "error" ? "alert" : "status"}>{metricsState?.status === "loading" ? "Lecture des performances sur la plateforme…" : metricsState?.status === "empty" ? "Aucune donnée de diffusion retournée." : metricsState?.status === "error" ? metricsState.error : campaign.status === "draft" ? "Brouillon non diffusé : aucune statistique." : "Statistiques indisponibles pour ce canal ou cet état."}</p>}
          <p className={styles.metricSource}>Les statuts iNr’ADS ne sont pas synchronisés en direct. Vérifiez l’état actuel dans votre compte publicitaire.</p>
        </section>}

      </div>
    </div>
  </div>, document.body);
}
