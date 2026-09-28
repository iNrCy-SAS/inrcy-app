"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { StoredAdsCampaign } from "@/app/dashboard/ads/AdsCampaignTracking";
import { getAdsAdvertiserAccountUrl } from "@/lib/adsAccountLinks";
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
  onRefresh: () => Promise<void>;
};

type MetricsState = { status: "loading" | "ready" | "empty" | "error"; metrics?: AdsCampaignMetrics; error?: string };
const euro = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const number = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

function plusUtcDays(days: number) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days)).toISOString().slice(0, 10);
}

function dayAfter(value: string) {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) ? new Date(timestamp + 86_400_000).toISOString().slice(0, 10) : plusUtcDays(1);
}

function canChangeDraft(campaign: StoredAdsCampaign) {
  return campaign.status === "draft" && Boolean(campaign.draft) && !campaign.published_at
    && campaign.provider_resources !== null && typeof campaign.provider_resources === "object"
    && !Array.isArray(campaign.provider_resources) && Object.keys(campaign.provider_resources).length === 0;
}

function canReadMetrics(campaign: StoredAdsCampaign) {
  if (!["active", "demo_paused", "needs_review"].includes(campaign.status)) return false;
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
  const [nextDate, setNextDate] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");

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
      const elements = Array.from(cardRef.current.querySelectorAll<HTMLElement>("button:not(:disabled),a[href],input:not(:disabled),summary"));
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
    setActionError("");
    onClose();
  }

  function navigate(direction: -1 | 1) {
    const next = campaigns[selectedIndex + direction];
    if (!next || busyId) return;
    setExtendId(null);
    setDeleteId(null);
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
      await onRefresh();
      setExtendId(null);
      setNextDate("");
      setActionSuccess("La date de fin du brouillon a été mise à jour.");
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

  if (!portalReady || !campaign) return null;

  const draft: Partial<AdsCampaignInput> = campaign.draft && typeof campaign.draft === "object" ? campaign.draft : {};
  const canChange = canChangeDraft(campaign);
  const canMetrics = canReadMetrics(campaign);
  const metricsState = metricsById[campaign.id];
  const minDate = [dayAfter(campaign.end_date), plusUtcDays(1)].sort().at(-1) || "";
  const maxDate = plusUtcDays(89);
  const accountUrl = campaign.provider === "google" || campaign.provider === "meta"
    ? getAdsAdvertiserAccountUrl(campaign.provider, campaign.ad_account_id) : null;
  const providerCampaignId = campaign.provider === "google"
    ? googleCampaignId(campaign.provider_resources, campaign.ad_account_id)
    : campaign.provider === "meta" ? metaCampaignId(campaign.provider_resources, campaign.ad_account_id) : null;
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
    field("Média", draft.creativeUrl || draft.imageUrl),
    field("Type de média", draft.creativeType),
    field("Paramètres de suivi", draft.trackingParameters),
    field("Aucune catégorie publicitaire spéciale", campaign.provider === "meta" ? draft.noSpecialCategoryConfirmed : undefined),
    field("Aucune publicité politique UE", draft.notEuPoliticalConfirmed),
  ].filter((entry): entry is { label: string; value: string } => entry !== null);

  return createPortal(<div className={mailboxStyles.modalOverlay} onClick={close}>
    <div ref={cardRef} className={`${mailboxStyles.modalCard} ${mailboxStyles.detailsModalCard} ${styles.modal}`} role="dialog" aria-modal="true" aria-labelledby="ads-campaign-details-title" onClick={(event) => event.stopPropagation()}>
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
        <div className={styles.detailHeading}><div><h2 id="ads-campaign-details-title">{campaign.name || "Campagne sans titre"}</h2><p>{adsChannelLabels[campaign.provider] || campaign.provider} · créée le {adsDateTime(campaign.created_at)}</p></div><span className={styles.status} data-status={campaign.status}>{adsStatusLabels[campaign.status] || "À vérifier"}</span></div>
        {actionSuccess && <p className={styles.success} role="status">{actionSuccess}</p>}
        {campaign.last_error && <p className={styles.error} role="alert">Contrôle nécessaire : {campaign.last_error}</p>}

        <section className={styles.section} aria-label="Informations générales"><h3>Informations générales</h3><dl className={styles.detailGrid}>
          <div><dt>Budget par jour</dt><dd>{Number.isFinite(campaign.daily_budget_cents) ? euro.format(campaign.daily_budget_cents / 100) : "—"}</dd></div>
          <div><dt>Fin prévue</dt><dd>{adsDate(campaign.end_date)}</dd></div>
          <div><dt>Publication enregistrée</dt><dd>{adsDateTime(campaign.published_at)}</dd></div>
          <div><dt>Mode de création</dt><dd>{draft.creationMode === "inrcy" ? "Avec iNr’Cy" : "Manuel"}</dd></div>
        </dl></section>

        <section className={styles.section} aria-label="Contenu de la campagne"><h3>Contenu de la campagne</h3><dl className={styles.detailGrid}>
          {campaignFields.map(({ label, value }) => <div key={label}><dt>{label}</dt><dd>{label === "Destination" && /^https:\/\//i.test(value) ? <a href={value} target="_blank" rel="noopener noreferrer">{value} ↗</a> : value}</dd></div>)}
        </dl>
          {draft.channelDraft && <details className={styles.advanced}><summary>Brief spécifique au canal</summary><pre>{JSON.stringify(draft.channelDraft, null, 2)}</pre></details>}
          {draft.channelSettings && <details className={styles.advanced}><summary>Réglages du canal</summary><pre>{JSON.stringify(draft.channelSettings, null, 2)}</pre></details>}
        </section>

        <section className={styles.section} aria-label="Statistiques de la campagne"><div className={styles.sectionHeading}><h3>Statistiques · 30 derniers jours</h3>{canMetrics && <button type="button" className={mailboxStyles.btnGhost} disabled={metricsState?.status === "loading"} onClick={() => void loadMetrics(campaign)}>{metricsState?.status === "loading" ? "Lecture…" : "Actualiser"}</button>}</div>
          {metricsState?.status === "ready" && metricsState.metrics ? <><p className={styles.metricSource}>{metricsState.metrics.source === "google" ? "Google Ads" : "Meta Ads"} · relevé le {adsDateTime(metricsState.metrics.fetchedAt)}</p><dl className={styles.metricsGrid}>
            <div><dt>Impressions</dt><dd>{number.format(metricsState.metrics.impressions)}</dd></div><div><dt>Clics</dt><dd>{number.format(metricsState.metrics.clicks)}</dd></div><div><dt>Dépenses</dt><dd>{euro.format(metricsState.metrics.spendEuros)}</dd></div><div><dt>Conversions</dt><dd>{metricsState.metrics.conversions === null ? "Non harmonisées" : number.format(metricsState.metrics.conversions)}</dd></div>
          </dl></> : <p className={styles.metricSource} role={metricsState?.status === "error" ? "alert" : "status"}>{metricsState?.status === "loading" ? "Lecture des performances sur la plateforme…" : metricsState?.status === "empty" ? "Aucune donnée de diffusion retournée." : metricsState?.status === "error" ? metricsState.error : campaign.status === "draft" ? "Brouillon non diffusé : aucune statistique." : "Statistiques indisponibles pour ce canal ou cet état."}</p>}
          <p className={styles.metricSource}>Les statuts iNr’ADS ne sont pas synchronisés en direct. Vérifiez l’état actuel dans votre compte publicitaire.</p>
        </section>

        <div className={styles.actions}>
          {canChange ? <>
            <button type="button" className={styles.primary} disabled={Boolean(busyId)} onClick={() => router.push(`/dashboard/ads?editCampaign=${encodeURIComponent(campaign.id)}`)}>Modifier</button>
            {minDate <= maxDate && <button type="button" className={mailboxStyles.btnGhost} disabled={Boolean(busyId)} onClick={() => { setExtendId(campaign.id); setDeleteId(null); setActionError(""); setNextDate(minDate); }}>Prolonger</button>}
            <button type="button" className={styles.danger} disabled={Boolean(busyId)} onClick={() => { setDeleteId(campaign.id); setExtendId(null); setActionError(""); }}>Supprimer</button>
          </> : <span className={styles.muted}>Après lancement, la modification et la suppression doivent se faire sur la plateforme publicitaire.</span>}
          {accountUrl && campaign.status !== "draft" && <a className={mailboxStyles.btnGhost} href={accountUrl} target="_blank" rel="noopener noreferrer">Ouvrir le compte publicitaire ↗</a>}
        </div>
        {extendId === campaign.id && <div className={styles.confirmation}><label>Nouvelle date de fin du brouillon <input type="date" value={nextDate} min={minDate} max={maxDate} onChange={(event) => setNextDate(event.target.value)} /></label><div><button type="button" className={styles.primary} disabled={busyId === campaign.id || !nextDate || nextDate < minDate || nextDate > maxDate} onClick={() => void extendDraft(campaign)}>{busyId ? "Enregistrement…" : "Enregistrer"}</button><button type="button" className={mailboxStyles.btnGhost} onClick={() => setExtendId(null)} disabled={Boolean(busyId)}>Annuler</button></div><small>Le changement concerne uniquement le brouillon iNr’ADS.</small></div>}
        {deleteId === campaign.id && <div className={styles.confirmation}><strong>Supprimer définitivement ce brouillon ?</strong><p>Aucune campagne publiée ne sera supprimée.</p><div><button type="button" className={styles.danger} disabled={busyId === campaign.id} onClick={() => void deleteDraft(campaign)}>{busyId ? "Suppression…" : "Confirmer la suppression"}</button><button type="button" className={mailboxStyles.btnGhost} onClick={() => setDeleteId(null)} disabled={Boolean(busyId)}>Annuler</button></div></div>}
        {actionError && <p className={styles.error} role="alert">{actionError}</p>}
      </div>
    </div>
  </div>, document.body);
}
