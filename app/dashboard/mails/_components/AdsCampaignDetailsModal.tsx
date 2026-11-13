"use client";
import { getClientUserFacingErrorMessage as getSafeClientErrorMessage } from "@/lib/userFacingErrors";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import DashboardMobileSelect from "../../_components/DashboardMobileSelect";
import type { StoredAdsCampaign } from "@/app/dashboard/ads/AdsCampaignTracking";
import { getAdsAdvertiserAccountUrl } from "@/lib/adsAccountLinks";
import {
  ADS_LOCAL_RECOVERY_DISCARD_CONFIRMATION,
  ADS_OPENAI_REMOTE_RESUME_CONFIRMATION,
  ADS_REMOTE_DELETE_CONFIRMATION,
  canDiscardInterruptedInitialPublish,
  canManageRemoteAdsCampaign,
  canRecoverInterruptedAdsCampaign,
  type AdsCampaignLifecycleAction,
} from "@/lib/adsCampaignLifecycle";
import { googleCampaignId, isAdsCampaignMetrics, linkedInCampaignId, metaCampaignId, type AdsCampaignMetrics } from "@/lib/adsCampaignMetrics";
import type { AdsCampaignInput } from "@/lib/adsValidation";
import { adsChannelLabels, adsDate, adsDateTime, adsStatusMessageKeys, type MailsTranslator } from "./adsCampaignsFolder.shared";
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

function remoteEditValidation(state: RemoteEditState, dirty: RemoteEditDirty, translate: MailsTranslator): string | null {
  if (!Object.values(dirty).some(Boolean)) return translate("modifiez_au_moins_un_champ_avant_bd67482e");
  if (dirty.name && (state.name.trim().length < 3 || state.name.trim().length > 100)) {
    return translate("le_nom_doit_contenir_entre_3_99e0a5f9");
  }
  if (dirty.dailyBudgetEuros) {
    const amount = Number(state.dailyBudgetEuros);
    const cents = Math.round(amount * 100);
    if (!Number.isFinite(amount) || amount < 5 || amount > 500 || Math.abs(cents - amount * 100) > 0.000001) {
      return translate("le_budget_doit_etre_compris_entre_ebb135fd");
    }
  }
  if (dirty.endDate && (!/^\d{4}-\d{2}-\d{2}$/.test(state.endDate) || state.endDate < plusUtcDays(1) || state.endDate > plusUtcDays(90))) {
    return translate("la_date_de_fin_doit_etre_87e6c76a");
  }
  if (dirty.targetLocations) {
    const locations = remoteLocations(state.targetLocations);
    if (!locations.length || locations.length > 20 || locations.some((entry) => entry.length > 120)) {
      return translate("indiquez_entre_1_et_20_zones_cd9cf873");
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
  if (campaign.provider === "google") return Boolean(googleCampaignId(campaign.provider_resources, campaign.ad_account_id));
  if (campaign.provider === "meta") return Boolean(metaCampaignId(campaign.provider_resources, campaign.ad_account_id));
  return campaign.provider === "linkedin" && Boolean(linkedInCampaignId(campaign.provider_resources, campaign.ad_account_id));
}

function field(label: string, value: unknown, translate: MailsTranslator, isLink = false) {
  const displayed = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())).join(" · ")
    : typeof value === "string" ? value.trim() : typeof value === "number" ? String(value)
      : typeof value === "boolean" ? value ? translate("oui_eaa02f3f") : translate("non_a7219939") : "";
  return displayed ? { label, value: displayed, isLink } : null;
}

async function readActionResponse(response: Response, translate: MailsTranslator) {
  const result = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw Object.assign(new Error(getSafeClientErrorMessage({ ...result, status: response.status }, translate("l_action_n_a_pas_pu_99c7a256"), { allowUnknownMessage: false })), { status: response.status });
}

export default function AdsCampaignDetailsModal({ campaigns, selectedId, onSelect, onClose, onRefresh }: Props) {
  const i18nT = useTranslations("mails");
  const locale = useLocale();
  const euro = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const router = useRouter();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef<string | null>(null);
  const [portalReady, setPortalReady] = useState(false);
  const [metricsById, setMetricsById] = useState<Record<string, MetricsState>>({});
  const metricsRequestsRef = useRef(new Set<string>());
  const [extendId, setExtendId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [resumeId, setResumeId] = useState<string | null>(null);
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
    setResumeId(null);
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
      const elements = Array.from(cardRef.current.querySelectorAll<HTMLElement>("button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary"));
      if (!elements.length) return;
      if (event.shiftKey && document.activeElement === elements[0]) { event.preventDefault(); elements.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === elements.at(-1)) { event.preventDefault(); elements[0]?.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); openerRef.current?.focus(); };
  }, [open]);

  const loadMetrics = useCallback(async (current: StoredAdsCampaign) => {
    if (!canReadMetrics(current) || metricsRequestsRef.current.has(current.id)) return;
    metricsRequestsRef.current.add(current.id);
    setMetricsById((previous) => ({ ...previous, [current.id]: { status: "loading" } }));
    try {
      const response = await fetch(`/api/ads/campaigns/${encodeURIComponent(current.id)}/metrics`, { cache: "no-store" });
      const result = await response.json().catch(() => null) as { metrics?: unknown; reason?: string; error?: string } | null;
      if (!response.ok) throw Object.assign(new Error(getSafeClientErrorMessage({ ...result, status: response.status }, i18nT("les_statistiques_ne_sont_pas_disponibles_053dac35"), { allowUnknownMessage: false })), { status: response.status });
      setMetricsById((previous) => ({ ...previous, [current.id]: result?.metrics === null && result?.reason === "no_data"
        ? { status: "empty" }
        : isAdsCampaignMetrics(result?.metrics, current.provider) ? { status: "ready", metrics: result.metrics }
          : { status: "error", error: i18nT("la_plateforme_n_a_pas_retourne_c609e1bc") } }));
    } catch (error) {
      setMetricsById((previous) => ({ ...previous, [current.id]: { status: "error", error: getSafeClientErrorMessage(error, i18nT("statistiques_indisponibles_d182d329")) } }));
    } finally {
      metricsRequestsRef.current.delete(current.id);
    }
  }, [i18nT]);

  useEffect(() => {
    if (campaign && canReadMetrics(campaign) && !metricsById[campaign.id]) void loadMetrics(campaign);
  }, [campaign, metricsById, loadMetrics]);

  function close() {
    if (busyId) return;
    setExtendId(null);
    setDeleteId(null);
    setResumeId(null);
    setRemoteEditId(null);
    setActionError("");
    onClose();
  }

  function navigate(direction: -1 | 1) {
    const next = campaigns[selectedIndex + direction];
    if (!next || busyId) return;
    setExtendId(null);
    setDeleteId(null);
    setResumeId(null);
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
      }), i18nT);
      const refreshed = await onRefresh();
      setExtendId(null);
      setNextDate("");
      if (refreshed) setActionSuccess(i18nT("la_date_de_fin_du_brouillon_c0573c12"));
      else setActionError(i18nT("la_date_a_bien_ete_enregistree_85555d5f"));
    } catch (error) {
      setActionError(getSafeClientErrorMessage(error, i18nT("impossible_de_prolonger_ce_brouillon_447e47b3")));
    } finally {
      setBusyId(null);
    }
  }

  async function deleteDraft(current: StoredAdsCampaign) {
    if (busyId) return;
    setBusyId(current.id);
    setActionError("");
    try {
      await readActionResponse(await fetch(`/api/ads/campaigns/${encodeURIComponent(current.id)}`, { method: "DELETE" }), i18nT);
      onClose();
      setDeleteId(null);
      await onRefresh();
    } catch (error) {
      setActionError(getSafeClientErrorMessage(error, i18nT("impossible_de_supprimer_ce_brouillon_f92cf73b")));
    } finally {
      setBusyId(null);
    }
  }

  function openRemoteEdit(current: StoredAdsCampaign, currentDraft: Partial<AdsCampaignInput>) {
    setRemoteEditId(current.id);
    setExtendId(null);
    setDeleteId(null);
    setResumeId(null);
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
    confirmation?: Record<string, unknown>,
  ) {
    if (busyId) return;
    setBusyId(current.id);
    setActionError("");
    setActionSuccess("");
    try {
      await readActionResponse(await fetch(`/api/ads/campaigns/${encodeURIComponent(current.id)}/lifecycle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(changes ? { changes } : {}), ...confirmation }),
      }), i18nT);
      const refreshed = await onRefresh();
      setRemoteEditId(null);
      setResumeId(null);
      const successMessage = action === "pause"
        ? i18nT("la_campagne_est_maintenant_en_pause_1c376576")
        : action === "resume"
          ? i18nT("la_campagne_est_maintenant_active_sur_01aa2a65")
        : action === "reconcile"
          ? i18nT("le_statut_de_la_campagne_a_3e7048ae")
        : i18nT("la_campagne_a_ete_mise_a_28430a00");
      if (refreshed) setActionSuccess(successMessage);
      else setActionError(i18nT("value_la_liste_inrsend_n_a_fe6b8092", { value0: successMessage }));
    } catch (error) {
      if (action === "reconcile") await onRefresh();
      setActionError(getSafeClientErrorMessage(error, i18nT("impossible_de_gerer_cette_campagne_83dffbe1")));
    } finally {
      setBusyId(null);
    }
  }

  async function saveRemoteEdit(current: StoredAdsCampaign) {
    const validationError = remoteEditValidation(remoteEdit, remoteEditDirty, i18nT);
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
      }), i18nT);
      onClose();
      setDeleteId(null);
      await onRefresh();
    } catch (error) {
      setActionError(getSafeClientErrorMessage(error, i18nT("impossible_de_supprimer_cette_campagne_aa8e5439")));
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
  const remoteEditError = remoteEditValidation(remoteEdit, remoteEditDirty, i18nT);
  const metricsState = metricsById[campaign.id];
  const minDate = [dayAfter(campaign.end_date), plusUtcDays(1)].sort().at(-1) || "";
  const maxDate = plusUtcDays(90);
  const accountUrl = getAdsAdvertiserAccountUrl(campaign.provider, campaign.ad_account_id);
  const providerCampaignId = campaign.provider === "google"
    ? googleCampaignId(campaign.provider_resources, campaign.ad_account_id)
    : campaign.provider === "meta" ? metaCampaignId(campaign.provider_resources, campaign.ad_account_id)
      : campaign.provider === "linkedin" ? linkedInCampaignId(campaign.provider_resources, campaign.ad_account_id)
        : campaign.provider === "pinterest" && typeof campaign.provider_resources?.campaignId === "string"
          ? campaign.provider_resources.campaignId
          : campaign.provider === "openai" && typeof campaign.provider_resources?.campaignId === "string"
            ? campaign.provider_resources.campaignId : null;
  const campaignFields = [
    field(i18nT("compte_annonceur_87bebaad"), campaign.ad_account_id || i18nT("non_associe_1d12cdc9"), i18nT),
    field(i18nT("identifiant_sur_la_plateforme_422786ed"), providerCampaignId, i18nT),
    field(i18nT("offre_service_88de03f0"), draft.offer, i18nT),
    field(i18nT("objectif_47d1c260"), draft.objective, i18nT),
    field(i18nT("conversion_9151f843"), [draft.conversionGoal, draft.conversionLocation], i18nT),
    field(i18nT("type_de_campagne_70f9fad7"), draft.campaignType, i18nT),
    field(i18nT("strategie_media_d069fcbe"), draft.mediaStrategy, i18nT),
    field(i18nT("strategie_d_encheres_d2f40380"), draft.bidStrategy, i18nT),
    field(i18nT("destination_d4271349"), draft.destinationUrl || i18nT("non_renseignee_d6a3c5fe"), i18nT, true),
    field(i18nT("expansion_des_url_34768c70"), draft.urlExpansion, i18nT),
    field(i18nT("url_exclues_f9e14f0b"), draft.urlExclusions, i18nT),
    field(i18nT("zones_ciblees_09e322f6"), draft.targetLocations, i18nT),
    field(i18nT("audiences_8d0c96d8"), draft.targetAudiences, i18nT),
    field(i18nT("langues_e90c7e3c"), draft.languages, i18nT),
    field(i18nT("partenaires_de_recherche_google_5feaf529"), campaign.provider === "google" ? draft.googleSearchPartners : undefined, i18nT),
    field(i18nT("extension_au_reseau_display_9199c7f5"), campaign.provider === "google" ? draft.googleDisplayExpansion : undefined, i18nT),
    field(i18nT("expansion_de_l_audience_meta_09e666ad"), campaign.provider === "meta" ? draft.metaAudienceExpansion : undefined, i18nT),
    field(i18nT("placements_meta_d89a026e"), draft.metaPlacements, i18nT),
    field(i18nT("page_facebook_5017637f"), draft.pageId, i18nT),
    field(i18nT("mots_cles_7120109e"), draft.keywords, i18nT),
    field(i18nT("mots_cles_exclus_d5b8ad53"), draft.negativeKeywords, i18nT),
    field(i18nT("titres_e8384542"), draft.headlines, i18nT),
    field(i18nT("descriptions_72e4c870"), draft.descriptions, i18nT),
    field(i18nT("message_principal_5132e292"), draft.primaryText, i18nT),
    field(i18nT("appel_a_l_action_024c6142"), draft.callToAction, i18nT),
    field(i18nT("brief_media_d0aeff36"), draft.mediaBrief, i18nT),
    field(i18nT("visuel_feed_meta_4_5_e2c38614"), campaign.provider === "meta" ? draft.metaCreativeAssets?.feedImageUrl || draft.imageUrl : undefined, i18nT, true),
    field(i18nT("visuel_story_reel_meta_9_16_b26f7827"), campaign.provider === "meta" ? draft.metaCreativeAssets?.storyReelImageUrl : undefined, i18nT, true),
    field(i18nT("media_d8a313d3"), campaign.provider !== "meta" ? draft.creativeUrl || draft.imageUrl : undefined, i18nT, true),
    field(i18nT("type_de_media_f54aeeae"), draft.creativeType, i18nT),
    field(i18nT("parametres_de_suivi_90a56411"), draft.trackingParameters, i18nT),
    field(i18nT("aucune_categorie_publicitaire_speciale_4d76be78"), campaign.provider === "meta" ? draft.noSpecialCategoryConfirmed : undefined, i18nT),
    field(i18nT("aucune_publicite_politique_ue_2c13d7f2"), draft.notEuPoliticalConfirmed, i18nT),
  ].filter((entry): entry is { label: string; value: string; isLink: boolean } => entry !== null);

  return createPortal(<div className={`${mailboxStyles.modalOverlay} ${styles.fullScreenOverlay}`} onClick={close}>
    <div ref={cardRef} className={`${mailboxStyles.modalCard} ${mailboxStyles.detailsModalCard} ${styles.modal} ${styles.fullScreenModal}`} role="dialog" aria-modal="true" aria-labelledby="ads-campaign-details-title" onClick={(event) => event.stopPropagation()}>
      <div className={mailboxStyles.modalHeader}>
        <div className={mailboxStyles.modalTitle}>{i18nT("details_d1d25d62")}{" "}{adsChannelLabels[campaign.provider] || campaign.provider}</div>
        <div className={mailboxStyles.detailsHeaderActions}>
          <div className={mailboxStyles.detailsNavigation} aria-label={i18nT("navigation_dans_les_campagnes_b6a24f64")}>
            <button type="button" className={`${mailboxStyles.btnGhost} ${mailboxStyles.detailsNavigationButton}`} disabled={selectedIndex <= 0 || Boolean(busyId)} onClick={() => navigate(-1)} aria-label={i18nT("campagne_precedente_6037d157")}>‹</button>
            <span className={mailboxStyles.detailsNavigationCounter}>{selectedIndex + 1} / {campaigns.length}</span>
            <button type="button" className={`${mailboxStyles.btnGhost} ${mailboxStyles.detailsNavigationButton}`} disabled={selectedIndex >= campaigns.length - 1 || Boolean(busyId)} onClick={() => navigate(1)} aria-label={i18nT("campagne_suivante_d03ef44d")}>›</button>
          </div>
          <button ref={closeRef} type="button" className={mailboxStyles.btnGhost} disabled={Boolean(busyId)} onClick={close} aria-label={i18nT("fermer_les_details_1cc2163f")}>✕</button>
        </div>
      </div>
      <div className={`${mailboxStyles.modalBody} ${styles.modalBody}`}>
        <div className={styles.detailHeading}>
          <div className={styles.detailTitle}><h2 id="ads-campaign-details-title">{campaign.name || i18nT("campagne_sans_titre_c9c3142d")}</h2><p>{adsChannelLabels[campaign.provider] || campaign.provider} {" "}{i18nT("creee_le_78e11ee4")}{" "}{adsDateTime(campaign.created_at, locale)}</p></div>
          <div className={styles.detailHeadingControls}>
            <span className={styles.status} data-status={campaign.status}>{i18nT(adsStatusMessageKeys[campaign.status] || "a_verifier_8f5f7255")}</span>
            <div className={`${styles.actions} ${styles.headerActions}`}>
              {canChange ? <>
                <button type="button" className={styles.primary} disabled={Boolean(busyId)} onClick={() => router.push(`/dashboard/ads?channel=${encodeURIComponent(campaign.provider)}&editCampaign=${encodeURIComponent(campaign.id)}`)}>{i18nT("modifier_f260e757")}</button>
                {minDate <= maxDate && <button type="button" className={mailboxStyles.btnGhost} disabled={Boolean(busyId)} onClick={() => { setExtendId(campaign.id); setDeleteId(null); setActionError(""); setNextDate(minDate); }}>{i18nT("prolonger_cbe2fcdc")}</button>}
                <button type="button" className={styles.danger} disabled={Boolean(busyId)} onClick={() => { setDeleteId(campaign.id); setExtendId(null); setActionError(""); }}>{i18nT("supprimer_1acfc1c7")}</button>
              </> : canDiscardLocalRecovery ? <button type="button" className={styles.danger} disabled={Boolean(busyId)} onClick={() => { setDeleteId(campaign.id); setExtendId(null); setRemoteEditId(null); setActionError(""); }}>{i18nT("nettoyer_ce_suivi_local_e06672c3")}</button> : isInterruptedRemoteOperation ? <button type="button" className={mailboxStyles.btnGhost} disabled={Boolean(busyId)} onClick={() => void runRemoteAction(campaign, "reconcile")}>{busyId === campaign.id ? i18nT("controle_b08592eb") : i18nT("controler_l_operation_interrompue_48cf1237")}</button> : canManageRemote ? <>
                {canEditRemote && <>
                  <button type="button" className={styles.primary} disabled={Boolean(busyId)} onClick={() => openRemoteEdit(campaign, draft)}>{i18nT("modifier_f260e757")}</button>
                </>}
                {canToggleRemote && campaign.status === "active" && <button type="button" className={mailboxStyles.btnGhost} disabled={Boolean(busyId)} onClick={() => void runRemoteAction(campaign, "pause")}>{busyId === campaign.id ? i18nT("synchronisation_cc8ad3ae") : i18nT("mettre_en_pause_4515da4b")}</button>}
                {canToggleRemote && campaign.status === "paused" && <button type="button" className={styles.primary} disabled={Boolean(busyId)} onClick={() => campaign.provider === "openai" ? setResumeId(campaign.id) : void runRemoteAction(campaign, "resume")}>{busyId === campaign.id ? i18nT("activation_fcf229d1") : i18nT("reprendre_la_campagne_f7014e08")}</button>}
                {campaign.status === "needs_review" && <button type="button" className={mailboxStyles.btnGhost} disabled={Boolean(busyId)} onClick={() => void runRemoteAction(campaign, "reconcile")}>{busyId === campaign.id ? i18nT("controle_b08592eb") : i18nT("resynchroniser_le_statut_e4a5e9a4")}</button>}
                {canDeleteRemote && <button type="button" className={styles.danger} disabled={Boolean(busyId)} onClick={() => { setDeleteId(campaign.id); setExtendId(null); setRemoteEditId(null); setActionError(""); }}>{i18nT("supprimer_1acfc1c7")}</button>}
              </> : null}
              {accountUrl && campaign.status !== "draft" && <a className={mailboxStyles.btnGhost} href={accountUrl} target="_blank" rel="noopener noreferrer">{i18nT("ouvrir_le_compte_publicitaire_8824c33c")}</a>}
            </div>
          </div>
        </div>
        {actionSuccess && <p className={styles.success} role="status">{actionSuccess}</p>}
        {campaign.last_error && <p className={styles.error} role="alert">{i18nT("controle_necessaire_value_0fe8c3e0", { value0: getSafeClientErrorMessage(campaign.last_error, i18nT("mail_action_failed"), { allowUnknownMessage: false }) })}</p>}
        {actionError && <p className={styles.error} role="alert">{actionError}</p>}
        {canDiscardLocalRecovery ? <p className={styles.muted}>{i18nT("aucun_identifiant_de_campagne_distante_n_937ba42b")}</p>
          : isInterruptedRemoteOperation ? <p className={styles.muted}>{i18nT("inrsend_verifie_que_l_operation_est_9c120158")}</p>
            : campaign.status === "paused" ? <p className={styles.muted}>{campaign.provider === "openai"
              ? i18nT("cette_campagne_chatgpt_ads_existe_reellement_8b699008")
              : i18nT("cette_campagne_existe_reellement_sur_la_220dbc16")}</p>
              : canManageRemote && campaign.status === "needs_review" ? <p className={styles.muted}>{i18nT("cette_lecture_ne_reactive_pas_la_e7a5b681")}</p>
              : !canChange && !canManageRemote ? <p className={styles.muted}>{i18nT("cette_campagne_ne_dispose_pas_d_54a2e0ba")}</p>
                : null}
        {remoteEditId === campaign.id && <form className={`${styles.confirmation} ${styles.editPanel}`} noValidate onSubmit={(event) => { event.preventDefault(); void saveRemoteEdit(campaign); }}>
          <div className={styles.editHeading}><div><strong>{i18nT("modifier_la_campagne_sur_577a42be")}{" "}{adsChannelLabels[campaign.provider] || campaign.provider}</strong><p>{i18nT("les_changements_seront_envoyes_a_la_bdcbd1cc")}</p></div><button type="button" className={mailboxStyles.btnGhost} onClick={() => setRemoteEditId(null)} disabled={Boolean(busyId)}>{i18nT("fermer_5ab4ec64")}</button></div>
          <div className={styles.editGrid}>
            <label>{i18nT("nom_de_la_campagne_9491056a")}<input type="text" minLength={3} maxLength={100} value={remoteEdit.name} onChange={(event) => { setRemoteEdit((current) => ({ ...current, name: event.target.value })); setRemoteEditDirty((current) => ({ ...current, name: true })); }} /></label>
            <label>{i18nT("budget_quotidien_02a0766e")}<input type="number" inputMode="decimal" min="5" max="500" step="0.01" value={remoteEdit.dailyBudgetEuros} onChange={(event) => { setRemoteEdit((current) => ({ ...current, dailyBudgetEuros: event.target.value })); setRemoteEditDirty((current) => ({ ...current, dailyBudgetEuros: true })); }} /></label>
            <label>{i18nT("date_de_fin_716a6d8d")}<input type="date" min={plusUtcDays(1)} max={maxDate} value={remoteEdit.endDate} onChange={(event) => { setRemoteEdit((current) => ({ ...current, endDate: event.target.value })); setRemoteEditDirty((current) => ({ ...current, endDate: true })); }} /></label>
            <label className={styles.editLocations}>{i18nT("zones_ciblees_09e322f6")}<textarea rows={4} maxLength={2_500} value={remoteEdit.targetLocations} onChange={(event) => { setRemoteEdit((current) => ({ ...current, targetLocations: event.target.value })); setRemoteEditDirty((current) => ({ ...current, targetLocations: true })); }} placeholder={i18nT("une_zone_par_ligne_par_exemple_017aed35")} /><small>{i18nT("1_a_20_zones_les_noms_a5d15c7d")}</small></label>
          </div>
          <div><button type="submit" className={styles.primary} disabled={busyId === campaign.id || Boolean(remoteEditError)}>{busyId === campaign.id ? i18nT("mise_a_jour_sur_la_plateforme_d121983d") : i18nT("enregistrer_sur_la_plateforme_19f1c4e6")}</button><button type="button" className={mailboxStyles.btnGhost} onClick={() => setRemoteEditId(null)} disabled={Boolean(busyId)}>{i18nT("annuler_49ba3292")}</button></div>
          {remoteEditError && <small role="status">{remoteEditError}</small>}
        </form>}
        {resumeId === campaign.id && campaign.provider === "openai" && <div className={styles.confirmation} role="alertdialog" aria-label={i18nT("confirmer_la_reprise_chatgpt_ads_0232b633")}>
          <strong>{i18nT("activer_la_diffusion_payante_chatgpt_ads_a2f0187d")}</strong>
          <p>{i18nT("cette_action_reprend_la_campagne_et_6ed67c1d")}</p>
          <div><button type="button" className={styles.primary} disabled={busyId === campaign.id} onClick={() => void runRemoteAction(campaign, "resume", undefined, { confirmation: ADS_OPENAI_REMOTE_RESUME_CONFIRMATION, billingConfirmed: true })}>{busyId === campaign.id ? i18nT("activation_fcf229d1") : i18nT("confirmer_et_activer_d0b8314b")}</button><button type="button" className={mailboxStyles.btnGhost} onClick={() => setResumeId(null)} disabled={Boolean(busyId)}>{i18nT("annuler_49ba3292")}</button></div>
        </div>}
        {extendId === campaign.id && <div className={styles.confirmation}><label>{i18nT("nouvelle_date_de_fin_du_brouillon_e5faea35")}{" "}<input type="date" value={nextDate} min={minDate} max={maxDate} onChange={(event) => setNextDate(event.target.value)} /></label><div><button type="button" className={styles.primary} disabled={busyId === campaign.id || !nextDate || nextDate < minDate || nextDate > maxDate} onClick={() => void extendDraft(campaign)}>{busyId ? i18nT("enregistrement_e7d5f232") : i18nT("enregistrer_f7c8bcd8")}</button><button type="button" className={mailboxStyles.btnGhost} onClick={() => setExtendId(null)} disabled={Boolean(busyId)}>{i18nT("annuler_49ba3292")}</button></div><small>{i18nT("le_changement_concerne_uniquement_le_brouillon_eeb13b22")}</small></div>}
        {deleteId === campaign.id && <div className={styles.confirmation}><strong>{canChange ? i18nT("supprimer_definitivement_ce_brouillon_c9471a55") : canDiscardLocalRecovery ? i18nT("retirer_definitivement_ce_suivi_local_interrompu_18c7b914") : i18nT("supprimer_definitivement_la_campagne_sur_value_7ad7be36", { value0: adsChannelLabels[campaign.provider] || campaign.provider })}</strong><p>{canChange ? i18nT("aucune_campagne_publiee_ne_sera_supprimee_09007c22") : canDiscardLocalRecovery ? i18nT("verifiez_d_abord_le_compte_publicitaire_2838bc95") : i18nT("cette_action_supprime_la_campagne_chez_c6819c83")}</p><div><button type="button" className={styles.danger} disabled={busyId === campaign.id} onClick={() => void (canChange ? deleteDraft(campaign) : deleteRemoteCampaign(campaign))}>{busyId ? i18nT("suppression_a620db43") : canDiscardLocalRecovery ? i18nT("confirmer_le_nettoyage_local_97de5f70") : i18nT("confirmer_la_suppression_definitive_a4e2c4f0")}</button><button type="button" className={mailboxStyles.btnGhost} onClick={() => setDeleteId(null)} disabled={Boolean(busyId)}>{i18nT("annuler_49ba3292")}</button></div></div>}

        <div className={styles.mobileDetailNavigation}>
          <DashboardMobileSelect
            value={activeTab}
            options={[{ value: "info", label: i18nT("infos_campagne_be358616") }, { value: "stats", label: i18nT("stats_be763e9a") }]}
            onChange={setActiveTab}
            ariaLabel={i18nT("details_de_la_campagne_959cd016")}
            controls={`ads-campaign-${activeTab}-panel`}
          />
        </div>
        <div className={styles.detailTabs} role="tablist" aria-label={i18nT("details_de_la_campagne_959cd016")}>
          <button id="ads-campaign-info-tab" type="button" role="tab" aria-selected={activeTab === "info"} aria-controls="ads-campaign-info-panel" data-active={activeTab === "info"} onClick={() => setActiveTab("info")}>{i18nT("infos_campagne_be358616")}</button>
          <button id="ads-campaign-stats-tab" type="button" role="tab" aria-selected={activeTab === "stats"} aria-controls="ads-campaign-stats-panel" data-active={activeTab === "stats"} onClick={() => setActiveTab("stats")}>{i18nT("stats_be763e9a")}</button>
        </div>

        {activeTab === "info" ? <div id="ads-campaign-info-panel" className={styles.tabPanel} role="tabpanel" aria-labelledby="ads-campaign-info-tab">
          <section className={styles.section} aria-label={i18nT("informations_generales_be6ba6e5")}><h3>{i18nT("informations_generales_be6ba6e5")}</h3><dl className={styles.detailGrid}>
            <div><dt>{i18nT("budget_par_jour_c55acfa0")}</dt><dd>{Number.isFinite(campaign.daily_budget_cents) ? euro.format(campaign.daily_budget_cents / 100) : "—"}</dd></div>
            <div><dt>{i18nT("fin_prevue_8c5b0359")}</dt><dd>{adsDate(campaign.end_date, locale)}</dd></div>
            <div><dt>{i18nT("publication_enregistree_7f472529")}</dt><dd>{adsDateTime(campaign.published_at, locale)}</dd></div>
            <div><dt>{i18nT("mode_de_creation_18e407f0")}</dt><dd>{draft.creationMode === "inrcy" ? i18nT("avec_inr_cy_80600d77") : i18nT("manuel_6c1cc012")}</dd></div>
          </dl></section>

          <section className={styles.section} aria-label={i18nT("contenu_de_la_campagne_a6f1a8ae")}><h3>{i18nT("contenu_de_la_campagne_a6f1a8ae")}</h3><dl className={styles.detailGrid}>
            {campaignFields.map(({ label, value, isLink }) => <div key={label}><dt>{label}</dt><dd>{isLink && (/^https:\/\//i.test(value) || value.startsWith("/api/")) ? <a href={value} target="_blank" rel="noopener noreferrer">{value} ↗</a> : value}</dd></div>)}
          </dl>
            {draft.channelDraft && <details className={styles.advanced}><summary>{i18nT("brief_specifique_au_canal_c29ed2cb")}</summary><pre>{JSON.stringify(draft.channelDraft, null, 2)}</pre></details>}
            {draft.channelSettings && <details className={styles.advanced}><summary>{i18nT("reglages_du_canal_b17da70e")}</summary><pre>{JSON.stringify(draft.channelSettings, null, 2)}</pre></details>}
          </section>
        </div> : <section id="ads-campaign-stats-panel" className={`${styles.section} ${styles.tabPanel}`} role="tabpanel" aria-labelledby="ads-campaign-stats-tab" aria-label={i18nT("statistiques_de_la_campagne_3a78957e")}><div className={styles.sectionHeading}><h3>{i18nT("statistiques_30_derniers_jours_45b7df27")}</h3>{canMetrics && <button type="button" className={mailboxStyles.btnGhost} disabled={metricsState?.status === "loading"} onClick={() => void loadMetrics(campaign)}>{metricsState?.status === "loading" ? i18nT("lecture_6e0d98ed") : i18nT("actualiser_9d3b2a7d")}</button>}</div>
          {metricsState?.status === "ready" && metricsState.metrics ? <><p className={styles.metricSource}>{i18nT("value_releve_le_value_6c6f2084", { value0: adsChannelLabels[metricsState.metrics.source], value1: adsDateTime(metricsState.metrics.fetchedAt, locale) })}</p><dl className={styles.metricsGrid}>
            <div><dt>{i18nT("impressions_b5fb66f6")}</dt><dd>{number.format(metricsState.metrics.impressions)}</dd></div><div><dt>{i18nT("clics_6e92c5b0")}</dt><dd>{number.format(metricsState.metrics.clicks)}</dd></div><div><dt>{i18nT("depenses_fb667434")}</dt><dd>{euro.format(metricsState.metrics.spendEuros)}</dd></div><div><dt>{i18nT("conversions_b08eaadf")}</dt><dd>{metricsState.metrics.conversions === null ? i18nT("non_harmonisees_46e60bc9") : number.format(metricsState.metrics.conversions)}</dd></div>
          </dl></> : <p className={styles.metricSource} role={metricsState?.status === "error" ? "alert" : "status"}>{metricsState?.status === "loading" ? i18nT("lecture_des_performances_sur_la_plateforme_fc1426e1") : metricsState?.status === "empty" ? i18nT("aucune_donnee_de_diffusion_retournee_par_13c72279", { value0: adsChannelLabels[campaign.provider] || i18nT("ads_platform") }) : metricsState?.status === "error" ? metricsState.error : campaign.status === "draft" ? i18nT("brouillon_non_diffuse_aucune_statistique_6a9937e7") : i18nT("statistiques_indisponibles_pour_ce_canal_ou_8f0e88c1")}</p>}
          {metricsState?.status === "ready" && metricsState.metrics?.source === "linkedin" && <p className={styles.metricSource}>{i18nT("les_conversions_web_sont_celles_attribuees_9b3ee29c")}</p>}
          <p className={styles.metricSource}>{i18nT("les_statuts_inr_ads_ne_sont_2bea1570")}</p>
        </section>}

      </div>
    </div>
  </div>, document.body);
}
