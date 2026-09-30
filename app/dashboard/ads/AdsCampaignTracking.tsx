"use client";

import { useState } from "react";
import Image from "next/image";
import { getAdsAdvertiserAccountUrl } from "@/lib/adsAccountLinks";
import { googleCampaignId, metaCampaignId, type AdsCampaignMetrics } from "@/lib/adsCampaignMetrics";
import type { AdsCampaignInput, AdsChannelId } from "@/lib/adsValidation";
import styles from "./AdsCampaignTracking.module.css";

export type StoredAdsCampaign = {
  id: string;
  provider: AdsChannelId;
  ad_account_id: string;
  name: string;
  daily_budget_cents: number;
  end_date: string;
  status: "draft" | "publishing" | "active" | "paused" | "needs_review" | "demo_paused";
  draft: AdsCampaignInput;
  provider_resources: Record<string, unknown> | null;
  last_error: string | null;
  published_at: string | null;
  created_at: string;
};

type Props = {
  campaigns: StoredAdsCampaign[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadError: string;
  onRefresh: () => Promise<void>;
  onLoadMore: () => Promise<void>;
  onClose: () => void;
  onEdit: (campaign: StoredAdsCampaign) => void;
  presentation?: "studio" | "inrsend";
};

const channelLabels: Record<AdsChannelId, { label: string; logo: string }> = {
  google: { label: "Google Ads", logo: "/ads-logos/google-ads.svg" },
  meta: { label: "Meta Ads", logo: "/ads-logos/meta.svg" },
  linkedin: { label: "LinkedIn Ads", logo: "/ads-logos/linkedin.svg" },
  tiktok: { label: "TikTok Ads", logo: "/ads-logos/tiktok.svg" },
  pinterest: { label: "Pinterest Ads", logo: "/ads-logos/pinterest.svg" },
  x: { label: "X Ads", logo: "/ads-logos/x.svg" },
  openai: { label: "ChatGPT Ads", logo: "/ads-logos/chatgpt-ads.svg" },
};

const statusLabels: Record<StoredAdsCampaign["status"], string> = {
  draft: "Brouillon",
  publishing: "Création en cours sur la plateforme",
  active: "Activée à la publication",
  paused: "En pause sur la plateforme",
  needs_review: "Contrôle requis",
  demo_paused: "Démo créée en pause",
};

const euros = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const quantities = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
const dates = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

type MetricsState = { status: "loading" | "ready" | "empty" | "error"; metrics?: AdsCampaignMetrics; error?: string };

function isCampaignMetrics(value: unknown): value is AdsCampaignMetrics {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const metrics = value as Record<string, unknown>;
  return metrics.period === "last_30_days"
    && (metrics.source === "google" || metrics.source === "meta")
    && [metrics.impressions, metrics.clicks, metrics.spendEuros].every((number) => typeof number === "number" && Number.isFinite(number) && number >= 0)
    && (metrics.conversions === null || (typeof metrics.conversions === "number" && Number.isFinite(metrics.conversions) && metrics.conversions >= 0))
    && typeof metrics.fetchedAt === "string";
}

function displayDate(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  return Number.isFinite(parsed.getTime()) ? dates.format(parsed) : "—";
}

function displayAdsList(value: unknown, separator = ", "): string {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).join(separator) : "";
}

function displayAdsPair(...values: unknown[]): string {
  return values.filter((value): value is string => typeof value === "string" && value.trim().length > 0).join(" · ");
}

function plusUtcDays(days: number): string {
  const now = new Date();
  const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(utcMidnight + days * 86_400_000).toISOString().slice(0, 10);
}

function dayAfter(value: string): string {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) ? new Date(timestamp + 86_400_000).toISOString().slice(0, 10) : plusUtcDays(1);
}

async function readActionResponse(response: Response): Promise<void> {
  const data = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(data?.error || "L’action n’a pas pu être terminée.");
}

export default function AdsCampaignTracking({ campaigns, total, loading, loadingMore, hasMore, loadError, onRefresh, onLoadMore, onClose, onEdit, presentation = "studio" }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [extendId, setExtendId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [nextDate, setNextDate] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [metricsById, setMetricsById] = useState<Record<string, MetricsState>>({});
  const shownDrafts = campaigns.filter((campaign) => campaign.status === "draft").length;
  const shownBeyondDraft = campaigns.filter((campaign) => campaign.status !== "draft").length;

  function cancelAction() {
    setExtendId(null);
    setDeleteId(null);
    setNextDate("");
    setActionError("");
  }

  async function extendDraft(campaign: StoredAdsCampaign) {
    if (!nextDate || busyId) return;
    setBusyId(campaign.id);
    setActionError("");
    setActionSuccess("");
    try {
      await readActionResponse(await fetch(`/api/ads/campaigns/${encodeURIComponent(campaign.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endDate: nextDate }),
      }));
      await onRefresh();
      cancelAction();
      setActionSuccess("La date de fin du brouillon a été mise à jour.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Impossible de prolonger ce brouillon.");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteDraft(campaign: StoredAdsCampaign) {
    if (busyId) return;
    setBusyId(campaign.id);
    setActionError("");
    setActionSuccess("");
    try {
      await readActionResponse(await fetch(`/api/ads/campaigns/${encodeURIComponent(campaign.id)}`, { method: "DELETE" }));
      await onRefresh();
      cancelAction();
      setActionSuccess("Le brouillon a été supprimé.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Impossible de supprimer ce brouillon.");
    } finally {
      setBusyId(null);
    }
  }

  async function loadMetrics(campaign: StoredAdsCampaign) {
    if (metricsById[campaign.id]?.status === "loading") return;
    setMetricsById((current) => ({ ...current, [campaign.id]: { status: "loading" } }));
    try {
      const response = await fetch(`/api/ads/campaigns/${encodeURIComponent(campaign.id)}/metrics`, { cache: "no-store" });
      const result = await response.json().catch(() => null) as { metrics?: unknown; reason?: string; error?: string } | null;
      if (!response.ok) throw new Error(result?.error || "Les statistiques ne sont pas disponibles pour le moment.");
      const metrics = result?.metrics;
      if (metrics === null && result?.reason === "no_data") {
        setMetricsById((current) => ({ ...current, [campaign.id]: { status: "empty" } }));
      } else if (isCampaignMetrics(metrics)) {
        setMetricsById((current) => ({ ...current, [campaign.id]: { status: "ready", metrics } }));
      } else {
        throw new Error("La plateforme n’a pas retourné de statistiques exploitables.");
      }
    } catch (error) {
      setMetricsById((current) => ({ ...current, [campaign.id]: { status: "error", error: error instanceof Error ? error.message : "Statistiques indisponibles." } }));
    }
  }

  return <div className={`${styles.root} ${presentation === "inrsend" ? styles.inrsendRoot : ""}`}>
    <header className={styles.hero}>
      <div>
        <span className={styles.eyebrow}>{presentation === "inrsend" ? "iNr’SEND · CAMPAGNES ADS" : "TABLEAU DE BORD · iNr’ADS"}</span>
        <h2>Campagnes publicitaires</h2>
        <p>Campagnes enregistrées, en pause ou en ligne, réunies avec vos autres envois.</p>
      </div>
      <button type="button" className={styles.refresh} disabled={loading} onClick={() => void onRefresh()} aria-label="Actualiser les campagnes">
        <span aria-hidden="true">↻</span> {loading ? "Actualisation…" : "Actualiser"}
      </button>
    </header>

    <div className={styles.overview} aria-label="Récapitulatif des campagnes enregistrées">
      <div className={styles.overviewTile}><span>Campagnes enregistrées</span><strong>{total}</strong><small>{hasMore ? `${campaigns.length} sur ${total} affichées` : "Dans iNr’Send"}</small></div>
      <div className={styles.overviewTile}><span>Brouillons affichés</span><strong>{shownDrafts}</strong><small>Modifiables avant publication</small></div>
      <div className={styles.overviewTile}><span>Hors brouillon affichées</span><strong>{shownBeyondDraft}</strong><small>Création, contrôle, publication ou démo</small></div>
    </div>

    <p className={styles.metricsNote}>Les statuts ci-dessous sont ceux enregistrés par iNr’ADS, sans synchronisation en direct. Vérifiez l’état actuel dans votre compte publicitaire. Les performances Google Ads et Meta Ads sont consultées à la demande ; celles des autres canaux restent indisponibles ici.</p>

    {loadError && <div className={styles.feedback} role="alert">{loadError} {campaigns.length > 0 && "Les données affichées peuvent être obsolètes."} <button type="button" onClick={() => void onRefresh()}>Réessayer</button></div>}
    {actionSuccess && <p className={styles.success} role="status">{actionSuccess}</p>}
    {loading && campaigns.length === 0 ? <div className={styles.empty} role="status">Chargement de vos campagnes…</div>
      : !loadError && campaigns.length === 0 ? <div className={styles.empty}><span aria-hidden="true">✦</span><strong>Votre première campagne commence ici.</strong><p>Choisissez un canal et enregistrez votre brouillon : il apparaîtra ici.</p><button type="button" className={styles.primary} onClick={onClose}>Voir les canaux</button></div>
        : <div className={styles.list}>
          {campaigns.map((campaign) => {
            const channel = channelLabels[campaign.provider] || { label: campaign.provider, logo: "/ads-logos/meta.svg" };
            const accountUrl = (campaign.provider === "google" || campaign.provider === "meta")
              ? getAdsAdvertiserAccountUrl(campaign.provider, campaign.ad_account_id)
              : null;
            const canChange = campaign.status === "draft" && Boolean(campaign.draft) && !campaign.published_at && campaign.provider_resources !== null
              && typeof campaign.provider_resources === "object" && !Array.isArray(campaign.provider_resources)
              && Object.keys(campaign.provider_resources).length === 0;
            const tomorrow = plusUtcDays(1);
            const afterEnd = dayAfter(campaign.end_date);
            const minDate = afterEnd > tomorrow ? afterEnd : tomorrow;
            const maxDate = plusUtcDays(89);
            const canExtend = minDate <= maxDate;
            const canReadMetrics = ["active", "paused", "demo_paused", "needs_review"].includes(campaign.status)
              && (campaign.provider === "google"
                ? Boolean(googleCampaignId(campaign.provider_resources, campaign.ad_account_id))
                : campaign.provider === "meta" && Boolean(metaCampaignId(campaign.provider_resources, campaign.ad_account_id)));
            const metricsState = metricsById[campaign.id];
            const expanded = presentation !== "inrsend" || expandedId === campaign.id;
            const draft: Partial<AdsCampaignInput> = campaign.draft && typeof campaign.draft === "object" ? campaign.draft : {};
            return <article key={campaign.id} className={`${styles.card} ${presentation === "inrsend" ? styles.inboxCard : ""}`}>
              <div className={styles.cardTop}>
                <div className={styles.identity}>
                  <span className={styles.logo}><Image src={channel.logo} alt="" width={30} height={30} /></span>
                  <div><strong>{campaign.name || "Campagne sans titre"}</strong><small>{channel.label} · créée le {displayDate(campaign.created_at)}</small></div>
                </div>
                <div className={styles.cardTopActions}><span className={styles.status} data-status={campaign.status}>{statusLabels[campaign.status] || "État à vérifier"}</span>{presentation === "inrsend" && <button type="button" className={styles.primary} aria-expanded={expanded} onClick={() => { setExpandedId(expanded ? null : campaign.id); if (!expanded && canReadMetrics && !metricsById[campaign.id]) void loadMetrics(campaign); }}>{expanded ? "Masquer" : "Détails"}</button>}</div>
              </div>

              {expanded && <>
              <dl className={styles.facts}>
                <div><dt>Budget/jour prévu</dt><dd>{Number.isFinite(campaign.daily_budget_cents) ? euros.format(campaign.daily_budget_cents / 100) : "—"}</dd></div>
                <div><dt>Fin prévue</dt><dd>{displayDate(campaign.end_date)}</dd></div>
                <div><dt>Publication enregistrée</dt><dd>{displayDate(campaign.published_at)}</dd></div>
                <div><dt>Performances réelles</dt><dd>{metricsState?.status === "ready" ? "30 derniers jours" : metricsState?.status === "empty" ? "Aucune donnée retournée" : canReadMetrics ? "À consulter" : "Indisponibles"}</dd></div>
              </dl>
              <section className={styles.campaignConfiguration} aria-label={`Contenu de la campagne ${campaign.name}`}>
                <h3>Contenu de la campagne</h3>
                <dl className={styles.configurationGrid}>
                  {([
                    ["Offre", draft.offer || ""],
                    ["Objectif", draft.objective || ""],
                    ["Conversion", displayAdsPair(draft.conversionGoal, draft.conversionLocation)],
                    ["Type / format", displayAdsPair(draft.campaignType, draft.mediaStrategy)],
                    ["Stratégie d’enchères", draft.bidStrategy || ""],
                    ["Compte annonceur", campaign.ad_account_id || "Non associé"],
                    ["Destination", draft.destinationUrl || "Non renseignée"],
                    ["Zones", displayAdsList(draft.targetLocations)],
                    ["Audiences", displayAdsList(draft.targetAudiences)],
                    ["Langues", displayAdsList(draft.languages)],
                    ["Mots-clés", displayAdsList(draft.keywords)],
                    ["Mots-clés à exclure", displayAdsList(draft.negativeKeywords)],
                    ["Titres", displayAdsList(draft.headlines, " · ")],
                    ["Descriptions", displayAdsList(draft.descriptions, " · ")],
                    ["Message principal", draft.primaryText || ""],
                    ["Appel à l’action", draft.callToAction || ""],
                    ["Paramètres de suivi", draft.trackingParameters || ""],
                  ] as [string, string][]).filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
                </dl>
              </section>
              {campaign.last_error && <p className={styles.campaignError}>Contrôle nécessaire : {campaign.last_error}</p>}

              <div className={styles.actions}>
                {canChange ? <>
                  <button type="button" className={styles.primary} disabled={Boolean(busyId)} onClick={() => onEdit(campaign)}>Modifier</button>
                  {canExtend ? <button type="button" className={styles.secondary} disabled={Boolean(busyId)} onClick={() => { cancelAction(); setExtendId(campaign.id); setNextDate(minDate); }}>Prolonger</button> : <span className={styles.locked}>Prolongation indisponible : la fin actuelle dépasse la fenêtre de 89 jours.</span>}
                  <button type="button" className={styles.danger} disabled={Boolean(busyId)} onClick={() => { cancelAction(); setDeleteId(campaign.id); }}>Supprimer</button>
                </> : <span className={styles.locked}>Modification, prolongation et suppression indisponibles ici après le lancement : vérifiez la campagne sur la plateforme.</span>}
                {accountUrl && campaign.status !== "draft" && <a className={styles.external} href={accountUrl} target="_blank" rel="noopener noreferrer">Ouvrir le compte publicitaire ↗</a>}
                {canReadMetrics && <button type="button" className={styles.secondary} disabled={metricsState?.status === "loading"} onClick={() => void loadMetrics(campaign)}>{metricsState?.status === "loading" ? "Lecture des statistiques…" : metricsState ? "Actualiser les statistiques" : "Voir les statistiques"}</button>}
              </div>

              <section className={styles.metricsPanel} aria-label={`Statistiques de ${campaign.name}`}>
                <div className={styles.metricsHeading}><strong>Statistiques de la campagne · 30 derniers jours</strong>{metricsState?.status === "ready" && metricsState.metrics && <small>{metricsState.metrics.source === "google" ? "Google Ads" : "Meta Ads"} · relevé le {displayDate(metricsState.metrics.fetchedAt)}</small>}</div>
                {metricsState?.status === "ready" && metricsState.metrics ? <dl className={styles.metricsGrid}>
                  <div><dt>Impressions</dt><dd>{quantities.format(metricsState.metrics.impressions)}</dd></div>
                  <div><dt>Clics</dt><dd>{quantities.format(metricsState.metrics.clicks)}</dd></div>
                  <div><dt>Dépenses</dt><dd>{euros.format(metricsState.metrics.spendEuros)}</dd></div>
                  <div><dt>Conversions</dt><dd>{metricsState.metrics.conversions === null ? "Non harmonisées" : quantities.format(metricsState.metrics.conversions)}</dd></div>
                </dl> : <p className={styles.metricsFeedback} role={metricsState?.status === "error" ? "alert" : "status"}>
                  {metricsState?.status === "loading" ? "Lecture des performances sur la plateforme…" : metricsState?.status === "empty" ? "Aucune donnée de diffusion retournée sur les 30 derniers jours." : metricsState?.status === "error" ? metricsState.error : campaign.status === "draft" ? "Brouillon non diffusé : aucune statistique pour le moment." : canReadMetrics ? "Ouvrez les détails pour charger les performances." : "Statistiques indisponibles pour ce canal ou cet état."}
                </p>}
              </section>

              {extendId === campaign.id && <div className={styles.actionPanel}>
                <label>Nouvelle date de fin du brouillon<input type="date" value={nextDate} min={minDate} max={maxDate} onChange={(event) => setNextDate(event.target.value)} /></label>
                <div><button type="button" className={styles.primary} disabled={busyId === campaign.id || !nextDate || nextDate < minDate || nextDate > maxDate} onClick={() => void extendDraft(campaign)}>{busyId === campaign.id ? "Enregistrement…" : "Enregistrer la nouvelle date"}</button><button type="button" className={styles.secondary} disabled={Boolean(busyId)} onClick={cancelAction}>Annuler</button></div>
                <small>Ce changement concerne uniquement le brouillon iNr’ADS, avant publication.</small>
              </div>}

              {deleteId === campaign.id && <div className={styles.actionPanel}>
                <strong>Supprimer définitivement ce brouillon ?</strong><p>Cette action efface uniquement le brouillon iNr’ADS. Aucune campagne publiée ne sera supprimée.</p>
                <div><button type="button" className={styles.dangerConfirm} disabled={busyId === campaign.id} onClick={() => void deleteDraft(campaign)}>{busyId === campaign.id ? "Suppression…" : "Confirmer la suppression"}</button><button type="button" className={styles.secondary} disabled={Boolean(busyId)} onClick={cancelAction}>Annuler</button></div>
              </div>}
              {actionError && (extendId === campaign.id || deleteId === campaign.id) && <p className={styles.actionError} role="alert">{actionError}</p>}
              </>}
            </article>;
          })}
        </div>}
    {hasMore && campaigns.length > 0 && <div className={styles.pagination}>
      <span aria-live="polite">{campaigns.length} campagne{campaigns.length > 1 ? "s" : ""} affichée{campaigns.length > 1 ? "s" : ""} sur {total}</span>
      <button type="button" className={styles.secondary} disabled={loading || loadingMore} onClick={() => void onLoadMore()}>{loadingMore ? "Chargement…" : "Afficher les campagnes suivantes"}</button>
    </div>}
  </div>;
}
