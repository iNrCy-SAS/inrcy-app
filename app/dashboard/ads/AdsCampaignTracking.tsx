"use client";

import { useLocale, useTranslations } from "next-intl";


import { createAdsApiRequestError } from "./adsClientHttp";
import { useAdsErrorMessage } from "./useAdsErrorMessage";
import { useMemo, useRef, useState } from "react";
import Image from "next/image";
import { getAdsAdvertiserAccountUrl } from "@/lib/adsAccountLinks";
import { googleCampaignId, isAdsCampaignMetrics, linkedInCampaignId, metaCampaignId, type AdsCampaignMetrics } from "@/lib/adsCampaignMetrics";
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

const statusLabelKeys: Record<StoredAdsCampaign["status"], string> = {
  draft: "mails.ads_status_draft",
  publishing: "booster.ads_tracking_status_publishing",
  active: "booster.ads_tracking_status_active",
  paused: "booster.ads_tracking_status_paused",
  needs_review: "mails.ads_status_needs_review",
  demo_paused: "booster.ads_tracking_status_demo_paused",
};

type MetricsState = { status: "loading" | "ready" | "empty" | "error"; metrics?: AdsCampaignMetrics; error?: string };

function canReadCampaignMetrics(campaign: StoredAdsCampaign) {
  if (!["active", "paused", "demo_paused", "needs_review"].includes(campaign.status)) return false;
  if (campaign.provider === "google") return Boolean(googleCampaignId(campaign.provider_resources, campaign.ad_account_id));
  if (campaign.provider === "meta") return Boolean(metaCampaignId(campaign.provider_resources, campaign.ad_account_id));
  return campaign.provider === "linkedin" && Boolean(linkedInCampaignId(campaign.provider_resources, campaign.ad_account_id));
}

function displayDate(value: string | null, dates: Intl.DateTimeFormat): string {
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
  if (!response.ok) throw createAdsApiRequestError(data, response.status);
}

export default function AdsCampaignTracking({ campaigns, total, loading, loadingMore, hasMore, loadError, onRefresh, onLoadMore, onClose, onEdit, presentation = "studio" }: Props) {
  const i18nT = useTranslations("booster");
  const sharedT = useTranslations();
  const locale = useLocale();
  const { euros, quantities, dates, dateTimes } = useMemo(() => ({
    euros: new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }),
    quantities: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }),
    dates: new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }),
    dateTimes: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
  }), [locale]);
  const metricsSourceLabel = (source: unknown) => source === "google" || source === "meta" || source === "linkedin"
    ? channelLabels[source].label : sharedT("mails.ads_platform");
  const errorMessage = useAdsErrorMessage();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [extendId, setExtendId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [nextDate, setNextDate] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [metricsById, setMetricsById] = useState<Record<string, MetricsState>>({});
  const metricsRequestsRef = useRef(new Set<string>());
  const [nativeStateById, setNativeStateById] = useState<Record<string, { confirmed: boolean; message: string }>>({});
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
      setActionSuccess(sharedT("mails.la_date_de_fin_du_brouillon_c0573c12"));
    } catch (error) {
      setActionError(errorMessage(error, "mails.impossible_de_prolonger_ce_brouillon_447e47b3"));
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
      setActionSuccess(i18nT("ads_tracking_draft_deleted"));
    } catch (error) {
      setActionError(errorMessage(error, "mails.impossible_de_supprimer_ce_brouillon_f92cf73b"));
    } finally {
      setBusyId(null);
    }
  }

  async function readPreparedNativeState(campaign: StoredAdsCampaign) {
    if (busyId || (campaign.provider !== "tiktok" && campaign.provider !== "x")) return;
    setBusyId(campaign.id);
    try {
      const response = await fetch(`/api/ads/campaigns/${encodeURIComponent(campaign.id)}/lifecycle`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reconcile" }), cache: "no-store" });
      const result = await response.json().catch(() => null) as { readOnly?: boolean; publicationEnabled?: boolean; nativeReadback?: { confirmed?: boolean; targetStatus?: string }; error?: string } | null;
      if (!response.ok) throw createAdsApiRequestError(result, response.status);
      if (result?.readOnly !== true || result.publicationEnabled !== false || typeof result.nativeReadback?.confirmed !== "boolean" || result.nativeReadback.targetStatus !== (campaign.provider === "tiktok" ? "DISABLE" : "PAUSED")) throw new Error("La plateforme n’a pas confirmé un état suspendu exploitable.");
      const confirmed = result.nativeReadback.confirmed;
      setNativeStateById((current) => ({ ...current, [campaign.id]: { confirmed, message: confirmed ? i18nT("ads_tracking_paused_confirmed") : i18nT("ads_tracking_paused_unconfirmed") } }));
    } catch (error) {
      setNativeStateById((current) => ({ ...current, [campaign.id]: { confirmed: false, message: errorMessage(error, "shell.ads_error_20d50de173") } }));
    } finally { setBusyId(null); }
  }

  async function loadMetrics(campaign: StoredAdsCampaign) {
    if (!canReadCampaignMetrics(campaign) || metricsRequestsRef.current.has(campaign.id)) return;
    metricsRequestsRef.current.add(campaign.id);
    setMetricsById((current) => ({ ...current, [campaign.id]: { status: "loading" } }));
    try {
      const response = await fetch(`/api/ads/campaigns/${encodeURIComponent(campaign.id)}/metrics`, { cache: "no-store" });
      const result = await response.json().catch(() => null) as { metrics?: unknown; reason?: string; error?: string } | null;
      if (!response.ok) throw createAdsApiRequestError(result, response.status);
      const metrics = result?.metrics;
      if (metrics === null && result?.reason === "no_data") {
        setMetricsById((current) => ({ ...current, [campaign.id]: { status: "empty" } }));
      } else if (isAdsCampaignMetrics(metrics, campaign.provider)) {
        setMetricsById((current) => ({ ...current, [campaign.id]: { status: "ready", metrics } }));
      } else {
        throw new Error("La plateforme n’a pas retourné de statistiques exploitables.");
      }
    } catch (error) {
      setMetricsById((current) => ({ ...current, [campaign.id]: { status: "error", error: errorMessage(error, "mails.statistiques_indisponibles_d182d329") } }));
    } finally {
      metricsRequestsRef.current.delete(campaign.id);
    }
  }

  return <div className={`${styles.root} ${presentation === "inrsend" ? styles.inrsendRoot : ""}`}>
    <header className={styles.hero}>
      <div>
        <span className={styles.eyebrow}>{presentation === "inrsend" ? i18nT("inr_send_campagnes_ads_90bbd5cd") : i18nT("tableau_de_bord_inr_ads_350f43d1")}</span>
        <h2>{i18nT("campagnes_publicitaires_8cdb8acc")}</h2>
        <p>{i18nT("campagnes_enregistrees_en_pause_ou_en_7a92c007")}</p>
      </div>
      <button type="button" className={styles.refresh} disabled={loading} onClick={() => void onRefresh()} aria-label={i18nT("actualiser_les_campagnes_a4dde282")}>
        <span aria-hidden="true">↻</span> {loading ? i18nT("actualisation_2834f8d6") : i18nT("actualiser_9d3b2a7d")}
      </button>
    </header>

    <div className={styles.overview} aria-label={i18nT("recapitulatif_des_campagnes_enregistrees_81d140dd")}>
      <div className={styles.overviewTile}><span>{i18nT("campagnes_enregistrees_12743fc3")}</span><strong>{total}</strong><small>{hasMore ? i18nT("value_sur_value_affichees_30b7bb68", { value0: campaigns.length, value1: total }) : i18nT("dans_inr_send_4011af0d")}</small></div>
      <div className={styles.overviewTile}><span>{i18nT("brouillons_affiches_78c68227")}</span><strong>{shownDrafts}</strong><small>{i18nT("modifiables_avant_publication_b061ebee")}</small></div>
      <div className={styles.overviewTile}><span>{i18nT("hors_brouillon_affichees_0be33010")}</span><strong>{shownBeyondDraft}</strong><small>{i18nT("creation_controle_publication_ou_demo_6347cb4f")}</small></div>
    </div>

    <p className={styles.metricsNote}>{i18nT("les_statuts_ci_dessous_sont_ceux_57bddd42")}</p>

    {loadError && <div className={styles.feedback} role="alert">{errorMessage(loadError, "mails.impossible_de_charger_les_campagnes_ads_af10c644")} {campaigns.length > 0 && i18nT("les_donnees_affichees_peuvent_etre_obsoletes_10499e23")} <button type="button" onClick={() => void onRefresh()}>{i18nT("reessayer_895d416b")}</button></div>}
    {actionSuccess && <p className={styles.success} role="status">{actionSuccess}</p>}
    {loading && campaigns.length === 0 ? <div className={styles.empty} role="status">{i18nT("chargement_de_vos_campagnes_77c8a03c")}</div>
      : !loadError && campaigns.length === 0 ? <div className={styles.empty}><span aria-hidden="true">✦</span><strong>{i18nT("votre_premiere_campagne_commence_ici_888c88e4")}</strong><p>{i18nT("choisissez_un_canal_et_enregistrez_votre_f960a3f3")}</p><button type="button" className={styles.primary} onClick={onClose}>{i18nT("voir_les_canaux_69ffcfb5")}</button></div>
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
            const canReadMetrics = canReadCampaignMetrics(campaign);
            const metricsState = metricsById[campaign.id];
            const expanded = presentation !== "inrsend" || expandedId === campaign.id;
            const draft: Partial<AdsCampaignInput> = campaign.draft && typeof campaign.draft === "object" ? campaign.draft : {};
            const preparedChannel = campaign.provider === "tiktok" || campaign.provider === "x";
            const canReadPreparedNative = preparedChannel && ["paused", "needs_review", "publishing"].includes(campaign.status) && Boolean(campaign.provider_resources?.preparationStage);
            const nativeState = nativeStateById[campaign.id];
            const nativeBudget = campaign.provider === "google" ? draft.googleDeliverySettings?.budget : campaign.provider === "linkedin" ? draft.linkedinDeliverySettings?.budget : campaign.provider === "pinterest" ? draft.pinterestDeliverySettings?.budget : campaign.provider === "meta" ? draft.metaDeliverySettings?.budget : campaign.provider === "openai" ? draft.openaiDeliverySettings?.budget : preparedChannel ? draft.preparedDeliverySettings?.budget : null;
            const totalBudget = nativeBudget?.type === "total";
            const displayedBudget = totalBudget ? nativeBudget.totalEuros : campaign.daily_budget_cents / 100;
            return <article key={campaign.id} className={`${styles.card} ${presentation === "inrsend" ? styles.inboxCard : ""}`}>
              <div className={styles.cardTop}>
                <div className={styles.identity}>
                  <span className={styles.logo}><Image src={channel.logo} alt="" width={30} height={30} /></span>
                  <div><strong>{campaign.name || i18nT("campagne_sans_titre_c9c3142d")}</strong><small>{i18nT("value_creee_le_value_99062d91", { value0: channel.label, value1: displayDate(campaign.created_at, dates) })}</small></div>
                </div>
                <div className={styles.cardTopActions}><span className={styles.status} data-status={campaign.status}>{statusLabelKeys[campaign.status] ? sharedT(statusLabelKeys[campaign.status]) : i18nT("etat_a_verifier_a55b3a91")}</span>{presentation === "inrsend" && <button type="button" className={styles.primary} aria-expanded={expanded} onClick={() => { setExpandedId(expanded ? null : campaign.id); if (!expanded && canReadMetrics && !metricsById[campaign.id]) void loadMetrics(campaign); }}>{expanded ? i18nT("masquer_adb05f2b") : i18nT("details_aaa029e6")}</button>}</div>
              </div>

              {expanded && <>
              <dl className={styles.facts}>
                <div><dt>{totalBudget ? i18nT("budget_total_prevu_a3571125") : i18nT("budget_jour_prevu_d93cc5d7")}</dt><dd>{typeof displayedBudget === "number" && Number.isFinite(displayedBudget) ? euros.format(displayedBudget) : "—"}</dd></div>
                <div><dt>{i18nT("fin_prevue_8c5b0359")}</dt><dd>{campaign.provider === "linkedin" && draft.linkedinDeliverySettings?.budget.endAt ? displayDate(draft.linkedinDeliverySettings.budget.endAt, dateTimes) : preparedChannel && draft.preparedDeliverySettings?.budget.endAt ? displayDate(draft.preparedDeliverySettings.budget.endAt, dateTimes) : displayDate(campaign.end_date, dates)}</dd></div>
                <div><dt>{preparedChannel ? i18nT("creation_enregistree_18fd2971") : i18nT("publication_enregistree_7f472529")}</dt><dd>{displayDate(campaign.published_at, dates)}</dd></div>
                <div><dt>{i18nT("performances_reelles_0ef4d2d1")}</dt><dd>{metricsState?.status === "ready" ? i18nT("30_derniers_jours_edd8abc9") : metricsState?.status === "empty" ? i18nT("aucune_donnee_retournee_7fed32e4") : canReadMetrics ? i18nT("a_consulter_d523bdb4") : i18nT("indisponibles_a9fbd066")}</dd></div>
              </dl>
              <section className={styles.campaignConfiguration} aria-label={i18nT("contenu_de_la_campagne_value_06f752c3", { value0: campaign.name })}>
                <h3>{i18nT("contenu_de_la_campagne_a6f1a8ae")}</h3>
                <dl className={styles.configurationGrid}>
                  {([
                    [sharedT("booster.ads_tracking_offer"), draft.offer || ""],
                    [sharedT("booster.objectif_47d1c260"), draft.objective || ""],
                    [sharedT("mails.conversion_9151f843"), displayAdsPair(draft.conversionGoal, draft.conversionLocation)],
                    [sharedT("booster.ads_tracking_type_format"), displayAdsPair(draft.campaignType, draft.mediaStrategy)],
                    [sharedT("booster.strategie_d_encheres_d2f40380"), draft.bidStrategy || ""],
                    [sharedT("booster.compte_annonceur_87bebaad"), campaign.ad_account_id || (preparedChannel ? draft.adAccountId : "") || sharedT("mails.non_associe_1d12cdc9")],
                    [sharedT("mails.destination_d4271349"), draft.destinationUrl || sharedT("mails.non_renseignee_d6a3c5fe")],
                    [sharedT("booster.ads_tracking_zones"), displayAdsList(draft.targetLocations)],
                    [sharedT("mails.audiences_8d0c96d8"), displayAdsList(draft.targetAudiences)],
                    [sharedT("mails.langues_e90c7e3c"), displayAdsList(draft.languages)],
                    [sharedT("booster.mots_cles_7120109e"), displayAdsList(draft.keywords)],
                    [sharedT("booster.mots_cles_a_exclure_a97ff5c4"), displayAdsList(draft.negativeKeywords)],
                    [sharedT("booster.titres_e8384542"), displayAdsList(draft.headlines, " · ")],
                    [sharedT("booster.descriptions_72e4c870"), displayAdsList(draft.descriptions, " · ")],
                    [sharedT("booster.message_principal_5132e292"), draft.primaryText || ""],
                    [sharedT("booster.appel_a_l_action_024c6142"), draft.callToAction || ""],
                    [sharedT("mails.parametres_de_suivi_90a56411"), draft.trackingParameters || ""],
                  ] as [string, string][]).filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
                </dl>
              </section>
              {campaign.last_error && <p className={styles.campaignError}>{i18nT("controle_necessaire_value_0fe8c3e0", { value0: errorMessage(campaign.last_error, "shell.ads_error_campaign_review") })}</p>}

              <div className={styles.actions}>
                {canChange ? <>
                  <button type="button" className={styles.primary} disabled={Boolean(busyId)} onClick={() => onEdit(campaign)}>{i18nT("modifier_f260e757")}</button>
                  {canExtend ? <button type="button" className={styles.secondary} disabled={Boolean(busyId)} onClick={() => { cancelAction(); setExtendId(campaign.id); setNextDate(minDate); }}>{i18nT("prolonger_cbe2fcdc")}</button> : <span className={styles.locked}>{i18nT("prolongation_indisponible_la_fin_actuelle_depass_276594ff")}</span>}
                  <button type="button" className={styles.danger} disabled={Boolean(busyId)} onClick={() => { cancelAction(); setDeleteId(campaign.id); }}>{i18nT("supprimer_1acfc1c7")}</button>
                </> : <span className={styles.locked}>{i18nT("modification_prolongation_et_suppression_indispo_3f63c5e0")}</span>}
                {accountUrl && campaign.status !== "draft" && <a className={styles.external} href={accountUrl} target="_blank" rel="noopener noreferrer">{i18nT("ouvrir_le_compte_publicitaire_8824c33c")}</a>}
                {canReadPreparedNative && <button type="button" className={styles.secondary} disabled={Boolean(busyId)} onClick={() => void readPreparedNativeState(campaign)}>{busyId === campaign.id ? i18nT("lecture_de_l_etat_natif_a9312ad1") : i18nT("verifier_l_etat_suspendu_573f9942")}</button>}
                {canReadMetrics && <button type="button" className={styles.secondary} disabled={metricsState?.status === "loading"} onClick={() => void loadMetrics(campaign)}>{metricsState?.status === "loading" ? i18nT("lecture_des_statistiques_8a32bda3") : metricsState ? i18nT("actualiser_les_statistiques_48a02e72") : i18nT("voir_les_statistiques_89baaf5c")}</button>}
              </div>

              {preparedChannel && campaign.status !== "draft" && <p className={styles.metricsNote}>{i18nT("ce_parcours_vise_une_campagne_suspendue_eec458d4")}</p>}
              {nativeState && <p className={nativeState.confirmed ? styles.success : styles.campaignError} role={nativeState.confirmed ? "status" : "alert"}>{nativeState.message}</p>}

              <section className={styles.metricsPanel} aria-label={i18nT("statistiques_de_value_da4a4422", { value0: campaign.name })}>
                <div className={styles.metricsHeading}><strong>{i18nT("statistiques_de_la_campagne_30_derniers_e63135e1")}</strong>{metricsState?.status === "ready" && metricsState.metrics && <small>{i18nT("value_releve_le_value_6c6f2084", { value0: metricsSourceLabel(metricsState.metrics.source), value1: displayDate(metricsState.metrics.fetchedAt, dates) })}</small>}</div>
                {metricsState?.status === "ready" && metricsState.metrics ? <dl className={styles.metricsGrid}>
                  <div><dt>{i18nT("impressions_b5fb66f6")}</dt><dd>{quantities.format(metricsState.metrics.impressions)}</dd></div>
                  <div><dt>{i18nT("clics_6e92c5b0")}</dt><dd>{quantities.format(metricsState.metrics.clicks)}</dd></div>
                  <div><dt>{i18nT("depenses_fb667434")}</dt><dd>{euros.format(metricsState.metrics.spendEuros)}</dd></div>
                  <div><dt>{i18nT("conversions_b08eaadf")}</dt><dd>{metricsState.metrics.conversions === null ? i18nT("non_harmonisees_46e60bc9") : quantities.format(metricsState.metrics.conversions)}</dd></div>
                </dl> : <p className={styles.metricsFeedback} role={metricsState?.status === "error" ? "alert" : "status"}>
                  {metricsState?.status === "loading" ? i18nT("lecture_des_performances_sur_la_plateforme_fc1426e1") : metricsState?.status === "empty" ? i18nT("aucune_donnee_de_diffusion_retournee_par_13c72279", { value0: metricsSourceLabel(campaign.provider) }) : metricsState?.status === "error" ? metricsState.error : campaign.status === "draft" ? i18nT("brouillon_non_diffuse_aucune_statistique_pour_bdfff66f") : canReadMetrics ? i18nT("ouvrez_les_details_pour_charger_les_92a26200") : i18nT("statistiques_indisponibles_pour_ce_canal_ou_8f0e88c1")}
                </p>}
                {metricsState?.status === "ready" && metricsState.metrics?.source === "linkedin" && <p className={styles.metricsNote}>{i18nT("les_conversions_web_sont_celles_attribuees_9b3ee29c")}</p>}
              </section>

              {extendId === campaign.id && <div className={styles.actionPanel}>
                <label>{i18nT("nouvelle_date_de_fin_du_brouillon_e5faea35")}<input type="date" value={nextDate} min={minDate} max={maxDate} onChange={(event) => setNextDate(event.target.value)} /></label>
                <div><button type="button" className={styles.primary} disabled={busyId === campaign.id || !nextDate || nextDate < minDate || nextDate > maxDate} onClick={() => void extendDraft(campaign)}>{busyId === campaign.id ? i18nT("enregistrement_e7d5f232") : i18nT("enregistrer_la_nouvelle_date_27caaf2e")}</button><button type="button" className={styles.secondary} disabled={Boolean(busyId)} onClick={cancelAction}>{i18nT("annuler_49ba3292")}</button></div>
                <small>{i18nT("ce_changement_concerne_uniquement_le_brouillon_01182719")}</small>
              </div>}

              {deleteId === campaign.id && <div className={styles.actionPanel}>
                <strong>{i18nT("supprimer_definitivement_ce_brouillon_c9471a55")}</strong><p>{i18nT("cette_action_efface_uniquement_le_brouillon_fadc7ce6")}</p>
                <div><button type="button" className={styles.dangerConfirm} disabled={busyId === campaign.id} onClick={() => void deleteDraft(campaign)}>{busyId === campaign.id ? i18nT("suppression_a620db43") : i18nT("confirmer_la_suppression_c4d5fad6")}</button><button type="button" className={styles.secondary} disabled={Boolean(busyId)} onClick={cancelAction}>{i18nT("annuler_49ba3292")}</button></div>
              </div>}
              {actionError && (extendId === campaign.id || deleteId === campaign.id) && <p className={styles.actionError} role="alert">{actionError}</p>}
              </>}
            </article>;
          })}
        </div>}
    {hasMore && campaigns.length > 0 && <div className={styles.pagination}>
      <span aria-live="polite">{i18nT("ads_tracking_pagination", { count: campaigns.length, total })}</span>
      <button type="button" className={styles.secondary} disabled={loading || loadingMore} onClick={() => void onLoadMore()}>{loadingMore ? i18nT("chargement_01cba1df") : i18nT("afficher_les_campagnes_suivantes_70247e67")}</button>
    </div>}
  </div>;
}
