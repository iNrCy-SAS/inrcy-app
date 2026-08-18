import { useLocale, useTranslations } from "next-intl";
import React from "react";
import { useRouter } from "next/navigation";
import { readSanitizedElementHtml, sanitizeHtml } from "@/lib/sanitizeHtml";
import { editableHtmlToSiteText, renderBoosterSiteContentHtml, renderBoosterSiteInlineHtml, stripSiteTextFormatting } from "@/lib/boosterFormatting";
import styles from "../mails.module.css";
import { ChannelImageAdapterCardsPanel, ChannelPublicationPreview } from "@/app/dashboard/_components/ChannelImageAdapterTool";
import InrcyCameraCaptureModal from "@/app/dashboard/_components/InrcyCameraCaptureModal";
import MediaLibraryPickerModal, {
  type MediaLibraryPickerItem,
} from "@/app/dashboard/_components/MediaLibraryPickerModal";
import MediaOptimizerModal, {
  type MediaOptimizerItem,
} from "@/app/dashboard/_components/MediaOptimizerModal";
import RichSiteContentEditor from "@/app/dashboard/booster/publier/components/RichSiteContentEditor";
import BoosterVideoFormatManager from "@/app/dashboard/booster/publier/components/BoosterVideoFormatManager";
import {
  buildPreferredCtaPatch,
  BOOSTER_IMAGE_ACCEPT,
  BOOSTER_MAX_IMAGE_BYTES,
  BOOSTER_MAX_VIDEO_BYTES,
  BOOSTER_PREFERRED_CTA_OPTIONS,
  BOOSTER_VIDEO_ACCEPT,
  CHANNEL_TEXT_GUIDELINES,
  getChannelDefaultCtaLabel,
  getCtaModeHelp,
  getPreferredCtaChoiceFromPost,
  getVideoFormatLabel,
  getVideoPreviewAspectRatio,
  getVideoPreviewFitMode,
  getWebsiteSourceLabelForChannel,
  getWebsiteUrlForChannel,
  isSiteDisplayKey,
  normalizeBoosterAiLanguage,
  normalizeBoosterPreferredCta,
  VIDEO_ADAPTATION_MODE_LABELS,
  type BoosterCtaDefaults,
  type BoosterCtaMode,
  type BoosterPreferredCta,
  type ChannelKey,
  type ChannelPost,
  type DisplayKey,
  type VideoAdaptationMode,
  type VideoFormat,
} from "@/app/dashboard/booster/publier/publishModal.shared";
import { darkOptionStyle, darkSelectStyle, lightFieldStyle, textAreaStyle } from "@/app/dashboard/booster/publier/publishModal.styles";
import { confirmInrcy } from "@/lib/inrcyDialog";
import { useUnsavedExitGuard } from "@/app/dashboard/_hooks/useUnsavedExitGuard";
import { detectUniversalUploadMediaType } from "@/lib/mediaUploadPolicy";
import { getMediaLibraryOptimizationRequirements } from "@/lib/mediaLibraryOptimizationPolicy";
import {
  MAILBOX_RECIPIENTS_PAGE_SIZE,
  type CampaignRecipientsFilterId,
  type PublicationEditForm,
  campaignCounts,
  extractAttachmentsFromPayload,
  extractChannelPublications,
  extractPublicationParts,
  firstNonEmpty,
  formatChannelLabel,
  getChannelIndicatorMeta,
  getPublicationBackgroundMode,
  arePublicationTransformsEquivalent,
  isCancelledChannelResult,
  isDeletedChannelResult,
  isFailedChannelResult,
  isWarningChannelResult,
  isImageAttachment,
  isRetryableCampaignItem,
  isVideoAttachment,
  orderChannelKeys,
  pill,
  splitList,
} from "../_lib/mailboxPhase1";
import { pillBtn, pillBtnActive } from "./mailboxInlineStyles";
import {
  getTiktokAutoPollTarget,
  getTiktokPublishId,
  getTiktokStatusMeta,
  getYoutubeShortsPublicationUrl,
  isCampaignFinishedStatus,
  sameVideoAttachment,
  type MailboxDetailsModalProps,
} from "../_lib/mailboxDetails.foundations";

type MailsTranslator = (
  key: string,
  values?: Record<string, string | number | boolean>,
) => string;

function formatTiktokBytes(bytes: number, locale: string) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes >= 1024 * 1024) {
    return new Intl.NumberFormat(locale, { style: "unit", unit: "megabyte", unitDisplay: "short", maximumFractionDigits: 1 }).format(bytes / (1024 * 1024));
  }
  if (bytes >= 1024) {
    return new Intl.NumberFormat(locale, { style: "unit", unit: "kilobyte", unitDisplay: "short", maximumFractionDigits: 0 }).format(bytes / 1024);
  }
  return new Intl.NumberFormat(locale, { style: "unit", unit: "byte", unitDisplay: "short", maximumFractionDigits: 0 }).format(bytes);
}

function formatTiktokDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return minutes
    ? `${minutes} min ${String(remainingSeconds).padStart(2, "0")} s`
    : `${remainingSeconds} s`;
}

function formatTiktokDate(value: string, locale: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(locale) : "";
}

function localizedCampaignProgress(raw: any, health: any | null, locale: string, t: MailsTranslator) {
  const source = health && typeof health === "object" ? health : raw || {};
  const total = Math.max(0, Number(source.total ?? source.total_count ?? 0) || 0);
  const sent = Math.max(0, Number(source.sent ?? source.sent_count ?? 0) || 0);
  const processing = Math.max(0, Number(source.processing ?? source.processing_count ?? 0) || 0);
  const queued = Math.max(0, Number(source.queued ?? source.queued_count ?? 0) || 0);
  const failed = Math.max(0, Number(source.failed ?? source.failed_count ?? 0) || 0);
  const formatNumber = (value: number) => new Intl.NumberFormat(locale).format(value);
  const parts = [t("campaign_progress_accepted", { sent: formatNumber(sent), total: formatNumber(total || sent) })];
  if (processing > 0) parts.push(t("campaign_progress_processing", { count: processing }));
  if (queued > 0) parts.push(t("campaign_progress_queued", { count: queued }));
  if (failed > 0) parts.push(t("campaign_progress_failed", { count: failed }));
  return parts.join(" • ");
}

function localizedCampaignStatus(statusValue: unknown, t: MailsTranslator) {
  const status = String(statusValue || "").toLowerCase();
  if (status === "queued") return t("en_attente_de_distribution_569bec13");
  if (status === "processing") return t("distribution_en_cours_3ee8c273");
  if (status === "paused") return t("campagne_en_pause_2fc0292a");
  if (status === "partial") return t("terminee_avec_des_erreurs_ea43b1a5");
  if (status === "failed") return t("campagne_en_echec_bc6f6841");
  if (status === "completed" || status === "sent") return t("campagne_terminee_e3c5f9c5");
  return t("suivi_de_campagne_2fc0ee95");
}

function localizedCompletionEmailStatus(statusValue: unknown, t: MailsTranslator) {
  const status = String(statusValue || "pending").toLowerCase();
  if (status === "sent") return t("bilan_envoye_ad83545d");
  if (status === "sending") return t("envoi_du_bilan_en_cours_178da2d3");
  if (status === "failed") return t("bilan_non_envoye_23f96e8e");
  if (status === "skipped") return t("bilan_non_configure_b483d9f2");
  return t("bilan_en_attente_83ea8db8");
}

function localizedCampaignDuration(value: number | null | undefined, t: MailsTranslator) {
  const totalSeconds = Math.max(0, Math.round(Number(value || 0) / 1000));
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return t("duration_less_than_minute");
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return t("duration_hours_minutes", { hours, minutes: String(minutes).padStart(2, "0") });
  if (minutes > 0) return t("duration_minutes_seconds", { minutes, seconds: seconds >= 30 ? 30 : 0 });
  return t("duration_seconds", { seconds });
}

function localizedCampaignFilter(filter: CampaignRecipientsFilterId, t: MailsTranslator) {
  const keys: Record<CampaignRecipientsFilterId, string> = {
    all: "tous_b97ae3b4",
    sent: "envoye_7b0a810d",
    queued: "en_attente_5231158f",
    processing: "en_cours_bc9b533a",
    failed: "echecs_0cb65dc8",
    blocked: "bloques_4881b34c",
    opt_out: "desinscrits_5c693986",
    blacklist: "blacklist_7b2dd04c",
  };
  return t(keys[filter] || keys.all);
}

function localizedRecipientStatus(recipient: any, locale: string, t: MailsTranslator) {
  const formatDate = (value: unknown) => new Date(String(value || "")).toLocaleString(locale);
  if (recipient.status === "sent") {
    if (recipient.unsubscribed_at) return t("recipient_unsubscribed_at", { date: formatDate(recipient.unsubscribed_at) });
    if (recipient.delivery_status === "delivered" && recipient.delivered_at) return t("recipient_delivered_at", { date: formatDate(recipient.delivered_at) });
    if (recipient.delivery_status === "accepted") {
      return recipient.sent_at ? t("recipient_accepted_at", { date: formatDate(recipient.sent_at) }) : t("recipient_accepted");
    }
    return recipient.sent_at ? t("recipient_sent_at", { date: formatDate(recipient.sent_at) }) : t("envoye_7b0a810d");
  }
  if (recipient.status === "failed") {
    if (recipient.suppression_reason) return t("recipient_blocked");
    return t("recipient_failed");
  }
  if (recipient.status === "processing") return t("en_cours_bc9b533a");
  if (recipient.next_attempt_at) {
    return t(recipient.failure_retryable ? "recipient_retry_at" : "recipient_pending_at", { date: formatDate(recipient.next_attempt_at) });
  }
  return t("en_attente_5231158f");
}

function localizedOutboxStatus(item: any, locale: string, t: MailsTranslator) {
  const withDetail = (status: string, detail: string) => t("status_with_detail", { status, detail });
  if (item.source === "mail_campaigns") {
    const raw = item.raw || {};
    const status = String(raw.status || item.status || "").toLowerCase();
    const progress = localizedCampaignProgress(raw, null, locale, t);
    if (status === "queued") return withDetail(t("en_attente_5231158f"), progress);
    if (status === "processing") return withDetail(t("distribution_en_cours_3ee8c273"), progress);
    if (status === "paused") {
      const resumeAt = raw.resume_at ? new Date(raw.resume_at) : null;
      return resumeAt && Number.isFinite(resumeAt.getTime())
        ? t("campaign_paused_resume_at", { date: resumeAt.toLocaleString(locale) })
        : withDetail(t("campagne_en_pause_2fc0292a"), progress);
    }
    if (status === "partial") return withDetail(t("terminee_avec_des_erreurs_ea43b1a5"), progress);
    if (status === "failed") return withDetail(t("campagne_en_echec_bc6f6841"), progress);
    if (status === "sent" || status === "completed") {
      return item.sent_at
        ? t("campaign_completed_at", { date: new Date(item.sent_at).toLocaleString(locale) })
        : withDetail(t("campagne_terminee_e3c5f9c5"), progress);
    }
    return withDetail(t("suivi_de_campagne_2fc0ee95"), progress);
  }
  if (item.status === "draft") return t("brouillon_57d2d7a7");
  if (item.status === "error" || item.status === "failed") return t("en_echec_363c6c87");
  if (item.source === "inr_agent_actions") {
    return item.sent_at
      ? t("report_sent_at", { date: new Date(item.sent_at).toLocaleString(locale) })
      : t("report_generated_at", { date: new Date(item.created_at).toLocaleString(locale) });
  }
  return item.sent_at
    ? t("mail_sent_at", { date: new Date(item.sent_at).toLocaleString(locale) })
    : t("history_at", { date: new Date(item.created_at).toLocaleString(locale) });
}

function localizedIndicatorTitle(kind: "failed" | "deleted" | "cancelled" | "warning" | "processing", t: MailsTranslator) {
  const keys = {
    failed: "echec_sur_ce_canal_9d5ea0f3",
    deleted: "publication_supprimee_sur_ce_canal_ea8177eb",
    cancelled: "publication_annulee_dans_inr_send_3a044f29",
    warning: "publication_publiee_avec_avertissement_1a7dc204",
    processing: "en_traitement_sur_ce_canal_bad018e7",
  } as const;
  return t(keys[kind]);
}

function localizedTiktokStatusLabel(meta: ReturnType<typeof getTiktokStatusMeta> | null, t: MailsTranslator) {
  if (meta?.cancelled) return t("annulee_2776573b");
  if (meta?.failed) return t("en_echec_363c6c87");
  if (meta?.complete) return t("publiee_ebef6edc");
  if (meta?.pending) return t("en_traitement_016e2d20");
  return t("a_verifier_8f5f7255");
}

function localizedTiktokStatusMessage(meta: ReturnType<typeof getTiktokStatusMeta> | null, t: MailsTranslator) {
  if (meta?.cancelled) return t("publication_annulee_dans_inrsend_le_suivi_f4a9fbdb");
  if (meta?.failed) return t("publication_tiktok_en_echec_d5b61de2");
  if (meta?.complete) return t("publication_finalisee_sur_tiktok_033cc7f2");
  if (meta?.pending) return t("tiktok_traite_encore_la_publication_inrsend_b812613c");
  return t("inrsend_garde_l_historique_et_le_49149c78");
}

type ConnectedChannelDetail = {
  type?: string | null;
  label?: string | null;
  href?: string | null;
};

type PublicationStatusTone = "success" | "pending" | "warning" | "danger" | "muted";

type PublicationStatusMeta = {
  label: string;
  tone: PublicationStatusTone;
  title: string;
};

type PublicationMediaOptimizerRequest = {
  source:
    | { kind: "file"; file: File }
    | { kind: "library"; item: MediaOptimizerItem };
};

function normalizeExternalHref(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const candidate = /^(https?:)?\/\//i.test(raw)
    ? raw.startsWith("//")
      ? `https:${raw}`
      : raw
    : /^www\./i.test(raw)
      ? `https://${raw}`
      : "";
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function getFallbackChannelAccountHref(channel: string, result: any): string {
  const candidates = [
    result?.profile_url,
    result?.profileUrl,
    result?.page_url,
    result?.pageUrl,
    result?.channel_url,
    result?.channelUrl,
    result?.organization_url,
    result?.organizationUrl,
    result?.account_url,
    result?.accountUrl,
    result?.resource_url,
    result?.resourceUrl,
    result?.website_url,
    result?.websiteUrl,
    result?.site_url,
    result?.siteUrl,
    ["inrcy_site", "site_web", "inr_search", "gmb"].includes(channel)
      ? result?.external_url
      : "",
  ];
  for (const candidate of candidates) {
    const href = normalizeExternalHref(candidate);
    if (href) return href;
  }

  const username = String(result?.username || result?.handle || "")
    .trim()
    .replace(/^@+/, "");
  if (!username) return "";
  if (channel === "instagram") return `https://www.instagram.com/${encodeURIComponent(username)}/`;
  if (channel === "tiktok") return `https://www.tiktok.com/@${encodeURIComponent(username)}`;
  if (channel === "pinterest") return `https://www.pinterest.fr/${encodeURIComponent(username)}/`;
  return "";
}

function getChannelAccountActionLabel(channel: string, detail: ConnectedChannelDetail | null | undefined, t: MailsTranslator) {
  if (channel === "inrcy_site" || channel === "site_web") return t("ouvrir_le_site_138503f6");
  if (channel === "inr_search") return t("open_page");
  if (channel === "gmb") return t("open_listing");
  if (channel === "youtube_shorts") return t("open_channel");
  const type = String(detail?.type || "").toLowerCase();
  if (type === "account" || type === "profile") return t("ouvrir_le_compte_72c79948");
  if (type === "channel") return t("open_channel");
  if (type === "location") return t("open_listing");
  return t("open_page");
}

function getLivePublicationEntry(liveStatus: any, channel: string) {
  const entries = Array.isArray(liveStatus?.summary?.entries)
    ? liveStatus.summary.entries
    : [];
  return entries.find((entry: any) => String(entry?.channel || "").trim() === channel) || null;
}

function getLivePublicationResult(liveStatus: any, channel: string) {
  const results = liveStatus?.results && typeof liveStatus.results === "object"
    ? liveStatus.results
    : null;
  if (!results) return null;
  const result = results[channel];
  return result && typeof result === "object" ? result : null;
}

function getPublicationStatusMeta(
  channel: string,
  result: any,
  liveEntry: any,
  t: MailsTranslator,
): PublicationStatusMeta {
  if (isCancelledChannelResult(result)) {
    return { label: t("annulee_2776573b"), tone: "muted", title: t("publication_annulee_cbe31b94") };
  }
  if (isDeletedChannelResult(result)) {
    return { label: t("supprimee_4f8de1fe"), tone: "muted", title: t("publication_supprimee_sur_ce_canal_ea8177eb") };
  }

  if (channel === "tiktok") {
    const tiktok = getTiktokStatusMeta(result);
    if (tiktok.cancelled) return { label: t("annulee_2776573b"), tone: "muted", title: t("publication_tiktok_annulee_7f35b8c0") };
    if (tiktok.failed) return { label: t("en_echec_363c6c87"), tone: "danger", title: t("publication_tiktok_en_echec_d5b61de2") };
    if (tiktok.complete) return { label: t("publiee_ebef6edc"), tone: "success", title: t("publication_finalisee_sur_tiktok_033cc7f2") };
    if (tiktok.pending) return { label: t("en_traitement_016e2d20"), tone: "pending", title: t("tiktok_finalise_encore_la_publication_9191f914") };
  }

  if (isFailedChannelResult(result) || liveEntry?.ok === false) {
    return { label: t("en_echec_363c6c87"), tone: "danger", title: t("la_publication_n_a_pas_abouti_9368e2ed") };
  }
  if (isWarningChannelResult(result, channel)) {
    return { label: t("publiee_avec_avertissement_47eb62fb"), tone: "warning", title: t("publication_finalisee_avec_avertissement_b3f02094") };
  }

  const status = String(
    liveEntry?.status ||
      liveEntry?.technicalStatus ||
      result?.publication_status ||
      result?.status ||
      "",
  ).toLowerCase();
  if (["queued", "pending", "waiting", "created"].includes(status)) {
    return { label: t("en_attente_5231158f"), tone: "pending", title: t("publication_en_attente_de_traitement_9bf8f778") };
  }
  if (["processing", "running", "submitted", "accepted", "uploading", "external_processing"].includes(status) || result?.pending === true || result?.processing === true) {
    return { label: t("en_traitement_016e2d20"), tone: "pending", title: t("le_canal_finalise_encore_la_publication_82d4c8b2") };
  }
  if (["failed", "error", "rejected"].includes(status)) {
    return { label: t("en_echec_363c6c87"), tone: "danger", title: t("la_publication_n_a_pas_abouti_9368e2ed") };
  }
  if (
    liveEntry?.ok === true ||
    result?.ok === true ||
    ["published", "completed", "complete", "done", "success", "sent"].includes(status)
  ) {
    return { label: t("publiee_ebef6edc"), tone: "success", title: t("publication_finalisee_sur_ce_canal_da11ba3f") };
  }
  return { label: t("a_verifier_8f5f7255"), tone: "muted", title: t("le_statut_sera_actualise_automatiquement_fca9b8aa") };
}

function getPublicationStatusPillStyle(tone: PublicationStatusTone): React.CSSProperties {
  if (tone === "success") {
    return { border: "1px solid rgba(74,222,128,0.34)", background: "rgba(22,101,52,0.22)", color: "#bbf7d0" };
  }
  if (tone === "danger") {
    return { border: "1px solid rgba(248,113,113,0.38)", background: "rgba(127,29,29,0.24)", color: "#fecaca" };
  }
  if (tone === "warning") {
    return { border: "1px solid rgba(251,191,36,0.36)", background: "rgba(120,53,15,0.22)", color: "#fde68a" };
  }
  if (tone === "pending") {
    return { border: "1px solid rgba(56,189,248,0.34)", background: "rgba(7,89,133,0.22)", color: "#bae6fd" };
  }
  return { border: "1px solid rgba(148,163,184,0.28)", background: "rgba(51,65,85,0.24)", color: "#e2e8f0" };
}

function shouldPollPublicationStatus(liveStatus: any) {
  const pendingCount = Number(liveStatus?.summary?.pendingCount || 0) || 0;
  return liveStatus?.done === false || liveStatus?.queued === true || pendingCount > 0;
}

function formatPublicationStatusCheckedAt(value: string, locale: string) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function MailboxDetailsModal(props: MailboxDetailsModalProps) {
  const i18nT = useTranslations("mails");
  const locale = useLocale();
  const runtimeT = i18nT as unknown as MailsTranslator;
  const {
    open,
    onClose,
    detailsItem,
    detailsAccountLabel,
    detailsChannelKey,
    setDetailsChannelKey,
    detailsEditMode,
    setDetailsEditMode,
    detailsActionBusy,
    detailsActionError,
    detailsActionSuccess,
    setDetailsActionError,
    setDetailsActionSuccess,
    detailsSourceDocPayload,
    canNavigatePrevious,
    canNavigateNext,
    navigationLabel,
    navigationBusy,
    onNavigate,
    campaignRecipients,
    campaignRecipientsLoading,
    campaignRecipientsPage,
    setCampaignRecipientsPage,
    campaignRecipientsPageCount,
    campaignRecipientsTotal,
    campaignRecipientsFilter,
    setCampaignRecipientsFilter,
    campaignHealth,
    campaignHealthLoading,
    campaignReport,
    campaignSummaryBusyId,
    campaignActionBusyId,
    publicationEditForm,
    setPublicationEditForm,
    publicationEditFileInputId,
    activePublicationEditChannelKey,
    activePublicationEditPreset,
    activePublicationEditAssets,
    togglePublicationImage,
    openPublicationImageAdapter,
    resetPublicationImage,
    movePublicationImage,
    addPublicationFiles,
    addPublicationPhoto,
    addPublicationMediaLibraryItems,
    publicationVideoInputId,
    activePublicationEditVideo,
    addPublicationVideo,
    removePublicationVideo,
    setPublicationVideoFormatForChannel,
    setPublicationVideoAdaptationModeForChannel,
    applyPublicationVideoFormatForChannel,
    saveChannelPublication,
    deleteChannelPublication,
    retryCampaignFailedRecipients,
    resendCampaignCompletionSummary,
    openCampaignComposeFromHistory,
    loadCampaignRecipients,
    loadCampaignHealth,
    refreshHistory,
    resumeDraft,
  } = props;
  const router = useRouter();
  const [publicationPreviewOpen, setPublicationPreviewOpen] = React.useState(false);
  const [publicationCameraOpen, setPublicationCameraOpen] = React.useState(false);
  const [publicationMediaLibraryOpen, setPublicationMediaLibraryOpen] = React.useState(false);
  const [publicationOptimizerRequest, setPublicationOptimizerRequest] =
    React.useState<PublicationMediaOptimizerRequest | null>(null);
  const [publicationOptimizerQueue, setPublicationOptimizerQueue] =
    React.useState<PublicationMediaOptimizerRequest[]>([]);
  const [publicationOptimizerCompleted, setPublicationOptimizerCompleted] =
    React.useState(false);
  const [tiktokStatusChecking, setTiktokStatusChecking] = React.useState(false);
  const [tiktokRetrying, setTiktokRetrying] = React.useState(false);
  const [tiktokCancelling, setTiktokCancelling] = React.useState(false);
  const [connectedChannelDetails, setConnectedChannelDetails] = React.useState<Record<string, ConnectedChannelDetail>>({});
  const [publicationLiveStatus, setPublicationLiveStatus] = React.useState<any | null>(null);
  const [publicationStatusRefreshing, setPublicationStatusRefreshing] = React.useState(false);
  const [publicationStatusCheckedAt, setPublicationStatusCheckedAt] = React.useState("");
  const [isMobileViewport, setIsMobileViewport] = React.useState(false);
  const detailsBodyRef = React.useRef<HTMLDivElement | null>(null);
  const detailsScrollSnapshotRef = React.useRef<number | null>(null);
  const tiktokAutoPollInFlightRef = React.useRef(false);
  const publicationStatusRefreshInFlightRef = React.useRef<string | null>(null);
  const activePublicationId = React.useMemo(() => {
    if (!open || detailsItem?.source !== "app_events") return "";
    const payload = (detailsItem as any)?.raw?.payload;
    const payloadId = String(payload?.publication_id || "").trim();
    const itemId = String(detailsItem?.id || "").trim();
    const candidate = payloadId || itemId;
    return /^[0-9a-f-]{36}$/i.test(candidate) ? candidate : "";
  }, [detailsItem, open]);
  const activePublicationIdRef = React.useRef("");
  activePublicationIdRef.current = activePublicationId;
  const detailsEditModeRef = React.useRef(detailsEditMode);
  detailsEditModeRef.current = detailsEditMode;
  const tiktokAutoPollTarget = React.useMemo(
    () => (open ? getTiktokAutoPollTarget(detailsItem) : null),
    [open, detailsItem],
  );
  const detailsMailProvider = String(detailsItem?.provider || detailsItem?.payload?.provider || "").trim();

  const refreshPublicationStatus = React.useCallback(async (silent = false) => {
    const requestedPublicationId = activePublicationId;
    if (!requestedPublicationId || publicationStatusRefreshInFlightRef.current === requestedPublicationId) return null;
    publicationStatusRefreshInFlightRef.current = requestedPublicationId;
    if (!silent) {
      setPublicationStatusRefreshing(true);
      setDetailsActionError(null);
      setDetailsActionSuccess(null);
    }
    try {
      const response = await fetch(
        `/api/booster/publications/${encodeURIComponent(requestedPublicationId)}/status`,
        { method: "GET", cache: "no-store" },
      );
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(json?.error || "publication_status_refresh_failed");
      }
      if (activePublicationIdRef.current !== requestedPublicationId) return null;
      setPublicationLiveStatus(json);
      setPublicationStatusCheckedAt(new Date().toISOString());
      if (!detailsEditModeRef.current) await refreshHistory?.();
      if (activePublicationIdRef.current !== requestedPublicationId) return null;
      if (!silent) setDetailsActionSuccess(i18nT("publication_status_updated"));
      return json;
    } catch (error) {
      if (!silent) {
        setDetailsActionError(i18nT("publication_status_refresh_failed"));
      }
      return null;
    } finally {
      if (publicationStatusRefreshInFlightRef.current === requestedPublicationId) {
        publicationStatusRefreshInFlightRef.current = null;
      }
      if (!silent && activePublicationIdRef.current === requestedPublicationId) {
        setPublicationStatusRefreshing(false);
      }
    }
  }, [
    activePublicationId,
    i18nT,
    refreshHistory,
    setDetailsActionError,
    setDetailsActionSuccess,
  ]);

  const deleteChannelPublicationAndSyncStatus = React.useCallback(async () => {
    const deletion = await deleteChannelPublication();
    if (!deletion?.payload || !deletion.channel) return;

    const deletedResults =
      deletion.payload?.results && typeof deletion.payload.results === "object"
        ? deletion.payload.results
        : {};
    const deletedResult = (deletedResults as Record<string, unknown>)[deletion.channel];

    setPublicationLiveStatus((current: any) => {
      if (!current) return current;
      const currentResults =
        current?.results && typeof current.results === "object"
          ? current.results
          : {};
      const currentSummary =
        current?.summary && typeof current.summary === "object"
          ? current.summary
          : null;
      const entries = Array.isArray(currentSummary?.entries)
        ? currentSummary.entries.map((entry: any) =>
            String(entry?.channel || "").trim() === deletion.channel
              ? {
                  ...entry,
                  ok: true,
                  status: "deleted",
                  technicalStatus: "deleted",
                  pending: false,
                }
              : entry,
          )
        : currentSummary?.entries;

      return {
        ...current,
        results: {
          ...currentResults,
          ...(deletedResult ? { [deletion.channel]: deletedResult } : {}),
        },
        ...(currentSummary
          ? {
              summary: {
                ...currentSummary,
                entries,
              },
            }
          : {}),
      };
    });
    setPublicationStatusCheckedAt(new Date().toISOString());
  }, [deleteChannelPublication]);

  React.useEffect(() => {
    let cancelled = false;
    if (!open || detailsItem?.source !== "app_events") {
      setConnectedChannelDetails({});
      return;
    }

    void (async () => {
      try {
        const response = await fetch("/api/booster/connected-channels", {
          method: "GET",
          cache: "no-store",
        });
        const json = await response.json().catch(() => ({}));
        if (!cancelled && response.ok && json?.channelDetails && typeof json.channelDetails === "object") {
          setConnectedChannelDetails(json.channelDetails as Record<string, ConnectedChannelDetail>);
        }
        if (!cancelled && response.ok && json?.channels?.pinterest) {
          const pinterestResponse = await fetch(
            "/api/integrations/pinterest/status?live=1",
            { method: "GET", cache: "no-store" },
          ).catch(() => null);
          const pinterestStatus = pinterestResponse?.ok
            ? await pinterestResponse.json().catch(() => null)
            : null;
          if (!cancelled && pinterestStatus?.ok && pinterestStatus?.connected) {
            const username = String(pinterestStatus.username || "")
              .replace(/^@+/, "")
              .trim();
            const href = normalizeExternalHref(
              pinterestStatus.profileUrl ||
                pinterestStatus.publicProfileUrl ||
                (username
                  ? `https://www.pinterest.fr/${encodeURIComponent(username)}/`
                  : ""),
            );
            if (href) {
              setConnectedChannelDetails((current) => ({
                ...current,
                pinterest: {
                  ...(current.pinterest || {}),
                  type: "account",
                  label: String(
                    pinterestStatus.accountName ||
                      username ||
                      "Compte Pinterest connecté",
                  ).trim(),
                  href,
                },
              }));
            }
          }
        }
      } catch {
        // Le lien enregistré dans le résultat reste disponible en repli.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [detailsItem?.source, open]);

  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (!open || !activePublicationId || detailsItem?.source !== "app_events") {
      setPublicationLiveStatus(null);
      setPublicationStatusCheckedAt("");
      return;
    }

    setPublicationLiveStatus(null);
    setPublicationStatusCheckedAt("");
    const startedAt = Date.now();

    const clearTimer = () => {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
    };

    const schedule = (delayMs: number) => {
      clearTimer();
      if (cancelled || document.hidden) return;
      timer = setTimeout(() => {
        timer = null;
        void run();
      }, delayMs);
    };

    const run = async () => {
      if (cancelled || document.hidden) return;
      const status = await refreshPublicationStatus(true);
      if (cancelled || document.hidden) return;
      if (
        status &&
        shouldPollPublicationStatus(status) &&
        Date.now() - startedAt < 30 * 60_000
      ) {
        schedule(20_000);
      }
    };

    const handleVisibilityChange = () => {
      if (cancelled) return;
      if (document.hidden) {
        clearTimer();
        return;
      }
      schedule(0);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    if (!document.hidden) void run();

    return () => {
      cancelled = true;
      clearTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activePublicationId, detailsItem?.source, open, refreshPublicationStatus]);

  React.useEffect(() => {
    if (!open || !tiktokAutoPollTarget || tiktokRetrying || tiktokStatusChecking || tiktokCancelling) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let resumeRequested = false;
    const startedAt = Date.now();
    const lastCheckedAt = Date.parse(tiktokAutoPollTarget.checkedAt || "");
    const initialIntervalMs = tiktokAutoPollTarget.statusFetchFailed ? 60_000 : 20_000;
    const initialDelay = Number.isFinite(lastCheckedAt)
      ? Math.max(3_000, initialIntervalMs - Math.max(0, Date.now() - lastCheckedAt))
      : 8_000;

    const clearTimer = () => {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
    };

    const schedule = (delayMs: number) => {
      clearTimer();
      if (cancelled || document.hidden) return;
      timer = setTimeout(() => {
        timer = null;
        void run();
      }, delayMs);
    };

    const run = async () => {
      if (cancelled || document.hidden) return;
      if (tiktokAutoPollInFlightRef.current) {
        schedule(1_000);
        return;
      }

      tiktokAutoPollInFlightRef.current = true;
      let shouldContinue = true;
      let nextDelay = Date.now() - startedAt >= 5 * 60_000 ? 60_000 : 20_000;
      try {
        const res = await fetch(
          `/api/inrsend/publications/${encodeURIComponent(tiktokAutoPollTarget.publicationId)}/tiktok/status`,
          { method: "POST", headers: { "Content-Type": "application/json" } },
        );
        const json = await res.json().catch(() => ({}));
        const status = String(json?.status?.status || "").toUpperCase();
        shouldContinue = !["PUBLISH_COMPLETE", "DONE", "SUCCESS", "FAILED", "PUBLISH_FAILED", "ERROR", "CANCELLED", "CANCELED"].includes(status);
        if (!res.ok || json?.status?.statusFetchFailed) nextDelay = 60_000;
        await refreshHistory?.();
      } catch {
        nextDelay = 60_000;
      } finally {
        tiktokAutoPollInFlightRef.current = false;
      }

      if (cancelled || document.hidden) return;
      if (resumeRequested) {
        resumeRequested = false;
        schedule(0);
        return;
      }
      if (shouldContinue && Date.now() - startedAt < 30 * 60_000) {
        schedule(nextDelay);
      }
    };

    const handleVisibilityChange = () => {
      if (cancelled) return;
      if (document.hidden) {
        clearTimer();
        return;
      }
      if (tiktokAutoPollInFlightRef.current) {
        resumeRequested = true;
        return;
      }
      schedule(0);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    if (!document.hidden) schedule(initialDelay);
    return () => {
      cancelled = true;
      clearTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    open,
    refreshHistory,
    tiktokAutoPollTarget?.checkedAt,
    tiktokAutoPollTarget?.publicationId,
    tiktokAutoPollTarget?.publishId,
    tiktokAutoPollTarget?.statusFetchFailed,
    tiktokCancelling,
    tiktokRetrying,
    tiktokStatusChecking,
  ]);

  async function checkTiktokPublicationStatus(publicationId: string) {
    if (!publicationId || tiktokStatusChecking) return;
    setTiktokStatusChecking(true);
    setDetailsActionError(null);
    setDetailsActionSuccess(null);
    try {
      const res = await fetch(`/api/inrsend/publications/${encodeURIComponent(publicationId)}/tiktok/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "tiktok_status_check_failed");
      const statusLabel = localizedTiktokStatusLabel(getTiktokStatusMeta(json), runtimeT);
      if (json?.ok === false) {
        setDetailsActionError(i18nT("tiktok_status_result", { status: statusLabel }));
      } else {
        setDetailsActionSuccess(i18nT("tiktok_status_result", { status: statusLabel }));
      }
      await refreshHistory?.();
    } catch (e: any) {
      setDetailsActionError(i18nT("tiktok_status_check_failed"));
    } finally {
      setTiktokStatusChecking(false);
    }
  }

  async function retryTiktokPublication(publicationId: string, statusMeta?: ReturnType<typeof getTiktokStatusMeta> | null) {
    if (!publicationId || tiktokRetrying) return;
    const isPending = Boolean(statusMeta?.pending);
    const ok = await confirmInrcy({
      eyebrow: isPending ? i18nT("tiktok_retry_pending_eyebrow") : i18nT("tiktok_retry_eyebrow"),
      title: isPending ? i18nT("tiktok_retry_pending_title") : i18nT("tiktok_retry_title"),
      message: isPending
        ? i18nT("tiktok_retry_pending_message")
        : i18nT("tiktok_retry_message"),
      cancelLabel: i18nT("annuler_49ba3292"),
      confirmLabel: i18nT("retenter_e2034526"),
      variant: isPending ? "danger" : "default",
    });
    if (!ok) return;

    setTiktokRetrying(true);
    setDetailsActionError(null);
    setDetailsActionSuccess(null);
    try {
      const res = await fetch(`/api/inrsend/publications/${encodeURIComponent(publicationId)}/tiktok/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) throw new Error(json?.error || json?.message || "tiktok_retry_failed");
      setDetailsActionSuccess(i18nT("tiktok_retry_started"));
      await refreshHistory?.();
    } catch (e: any) {
      setDetailsActionError(i18nT("tiktok_retry_failed"));
    } finally {
      setTiktokRetrying(false);
    }
  }

  async function cancelPendingTiktokPublication(
    publicationId: string,
    statusMeta?: ReturnType<typeof getTiktokStatusMeta> | null,
  ) {
    if (!publicationId || tiktokCancelling || !statusMeta?.pending) return;

    const ok = await confirmInrcy({
      eyebrow: i18nT("publication_tiktok_en_attente_72538498"),
      title: i18nT("annuler_cette_publication_en_cours_07e623b2"),
      message:
        i18nT("inrsend_arretera_immediatement_le_suivi_et_91405c80"),
      cancelLabel: i18nT("conserver_le_suivi_b9c668ab"),
      confirmLabel: i18nT("annuler_la_publication_e7d30046"),
      variant: "danger",
    });
    if (!ok) return;

    setTiktokCancelling(true);
    setDetailsActionError(null);
    setDetailsActionSuccess(null);
    try {
      const res = await fetch(`/api/inrsend/publications/${encodeURIComponent(publicationId)}/tiktok`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel_pending" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || json?.message || "tiktok_cancel_failed");
      }
      setDetailsActionSuccess(i18nT("publication_annulee_dans_inrsend_le_suivi_f4a9fbdb"));
      await refreshHistory?.();
    } catch (e: any) {
      setDetailsActionError(i18nT("tiktok_cancel_failed"));
    } finally {
      setTiktokCancelling(false);
    }
  }

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(max-width: 760px)");
    const sync = () => setIsMobileViewport(media.matches);
    sync();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", sync);
      return () => media.removeEventListener("change", sync);
    }
    media.addListener(sync);
    return () => media.removeListener(sync);
  }, []);

  React.useEffect(() => {
    if (open) setPublicationPreviewOpen(false);
  }, [open, detailsItem?.id, detailsEditMode]);

  const preserveDetailsModalScroll = React.useCallback(() => {
    if (typeof document === "undefined") return;
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) activeElement.blur();
    detailsScrollSnapshotRef.current = detailsBodyRef.current?.scrollTop ?? 0;
  }, []);

  const restoreDetailsModalScroll = React.useCallback(() => {
    if (typeof window === "undefined") return;
    const snapshot = detailsScrollSnapshotRef.current;
    if (snapshot === null) return;
    const restore = () => {
      if (detailsBodyRef.current) detailsBodyRef.current.scrollTop = snapshot;
    };
    window.requestAnimationFrame(() => {
      restore();
      window.setTimeout(restore, 80);
      window.setTimeout(restore, 220);
    });
  }, []);

  const openPublicationCamera = React.useCallback(() => {
    if (!isMobileViewport) return;
    preserveDetailsModalScroll();
    setPublicationCameraOpen(true);
  }, [isMobileViewport, preserveDetailsModalScroll]);

  const openPublicationMediaLibrary = React.useCallback(() => {
    preserveDetailsModalScroll();
    setPublicationMediaLibraryOpen(true);
  }, [preserveDetailsModalScroll]);

  const closePublicationMediaLibrary = React.useCallback(() => {
    setPublicationMediaLibraryOpen(false);
    restoreDetailsModalScroll();
  }, [restoreDetailsModalScroll]);

  const closePublicationCamera = React.useCallback(() => {
    setPublicationCameraOpen(false);
    restoreDetailsModalScroll();
  }, [restoreDetailsModalScroll]);

  const [publicationEditDirty, setPublicationEditDirty] = React.useState(false);
  const [publicationCtaDefaults, setPublicationCtaDefaults] = React.useState<BoosterCtaDefaults | null>(null);
  const publicationSiteContentEditorRef = React.useRef<HTMLDivElement | null>(null);

  const publicationDisplayKey = React.useMemo<DisplayKey>(() => {
    const key = String(activePublicationEditChannelKey || "");
    if (["inrcy_site", "site_web", "inr_search", "gmb", "facebook", "instagram", "linkedin", "tiktok", "youtube_shorts", "pinterest"].includes(key)) {
      return key as DisplayKey;
    }
    return "facebook";
  }, [activePublicationEditChannelKey]);

  const markPublicationEditDirty = React.useCallback(() => {
    setPublicationEditDirty(true);
  }, []);

  const updatePublicationEdit = React.useCallback((patch: Partial<PublicationEditForm>) => {
    markPublicationEditDirty();
    setPublicationEditForm((prev) => ({ ...prev, ...patch }));
  }, [markPublicationEditDirty, setPublicationEditForm]);

  React.useEffect(() => {
    let alive = true;
    if (!open || !detailsEditMode || detailsItem?.source !== "app_events") return () => { alive = false; };

    (async () => {
      try {
        const res = await fetch("/api/booster/cta-defaults", { cache: "no-store" as const });
        if (!res.ok) return;
        const json = await res.json().catch(() => ({}));
        if (!alive) return;
        setPublicationCtaDefaults({
          preferredWebsiteUrl: String(json?.preferredWebsiteUrl || "").trim(),
          preferredWebsiteLabel: String(json?.preferredWebsiteLabel || "").trim(),
          siteWebUrl: String(json?.siteWebUrl || "").trim(),
          inrcySiteUrl: String(json?.inrcySiteUrl || "").trim(),
          phone: String(json?.phone || "").trim(),
          preferredCta: normalizeBoosterPreferredCta(json?.preferredCta),
          aiLanguage: normalizeBoosterAiLanguage(json?.aiLanguage),
        });
      } catch {
        // CTA defaults are helpful but not required to edit a publication.
      }
    })();

    return () => {
      alive = false;
    };
  }, [open, detailsEditMode, detailsItem?.source]);

  const applyPublicationSiteContentFormat = React.useCallback((kind: "bold" | "italic" | "underline") => {
    if (!isSiteDisplayKey(publicationDisplayKey) || typeof document === "undefined") return;
    const editor = publicationSiteContentEditorRef.current;
    if (!editor) return;

    try {
      editor.focus({ preventScroll: true });
    } catch {
      editor.focus();
    }
    const command = kind === "bold" ? "bold" : kind === "italic" ? "italic" : "underline";
    document.execCommand(command, false);
    updatePublicationEdit({ content: editableHtmlToSiteText(readSanitizedElementHtml(editor)) });
  }, [publicationDisplayKey, updatePublicationEdit]);

  const applyPublicationPreferredCtaPrefill = React.useCallback((choice: BoosterPreferredCta) => {
    const current = {
      title: publicationEditForm.title,
      content: publicationEditForm.content,
      cta: publicationEditForm.cta,
      ctaMode: publicationEditForm.ctaMode || "none",
      ctaUrl: publicationEditForm.ctaUrl || "",
      ctaPhone: publicationEditForm.ctaPhone || "",
      hashtags: [],
    } as ChannelPost;
    const patch = buildPreferredCtaPatch(publicationDisplayKey, choice, current, publicationCtaDefaults, publicationCtaDefaults?.aiLanguage);
    updatePublicationEdit({
      ctaMode: String(patch.ctaMode || current.ctaMode || "none"),
      ...(typeof patch.cta === "string" ? { cta: patch.cta } : {}),
      ...(typeof patch.ctaUrl === "string" ? { ctaUrl: patch.ctaUrl } : {}),
      ...(typeof patch.ctaPhone === "string" ? { ctaPhone: patch.ctaPhone } : {}),
    });
  }, [publicationCtaDefaults, publicationDisplayKey, publicationEditForm.content, publicationEditForm.cta, publicationEditForm.ctaMode, publicationEditForm.ctaPhone, publicationEditForm.ctaUrl, publicationEditForm.title, updatePublicationEdit]);

  const getPublicationPreviewCta = React.useCallback((channel: DisplayKey, form: PublicationEditForm) => {
    const mode = (form.ctaMode || "none") as BoosterCtaMode;
    const explicit = String(form.cta || "").trim();
    const phone = String(form.ctaPhone || "").trim();
    if (mode === "none") return "";
    if (mode === "call") {
      const label = explicit || getChannelDefaultCtaLabel(channel, "call") || "Appeler";
      return phone ? `${label} · ${phone}` : label;
    }
    if (explicit) return explicit;
    if (mode === "website") return getChannelDefaultCtaLabel(channel, mode);
    if (mode === "message") return channel === "instagram" ? "Message privé" : "Envoyer un message";
    return "";
  }, []);

  React.useEffect(() => {
    if (!open || !detailsEditMode) setPublicationEditDirty(false);
  }, [open, detailsItem?.id, activePublicationEditChannelKey, detailsEditMode]);

  const confirmDiscardPublicationEdit = React.useCallback(async () => {
    if (!detailsEditMode) return true;
    if (detailsActionBusy) return false;

    const ok = await confirmInrcy({
      eyebrow: i18nT("modification_en_cours_26445b1d"),
      title: i18nT("quitter_la_modification_2a7e2e07"),
      message: publicationEditDirty
        ? i18nT("vos_changements_ne_seront_pas_enregistres_2c404e9f")
        : i18nT("publication_edit_mode_message"),
      cancelLabel: i18nT("continuer_l_edition_0f0075bb"),
      confirmLabel: i18nT("quitter_3e4126f5"),
      variant: "danger",
    });
    if (ok) setPublicationEditDirty(false);
    return ok;
  }, [detailsActionBusy, detailsEditMode, publicationEditDirty]);

  const requestClose = React.useCallback(async () => {
    const ok = await confirmDiscardPublicationEdit();
    if (!ok) return;
    setDetailsEditMode(false);
    onClose();
  }, [confirmDiscardPublicationEdit, onClose, setDetailsEditMode]);

  const requestNavigate = React.useCallback(async (direction: -1 | 1) => {
    if (navigationBusy) return;
    const allowed = direction < 0 ? canNavigatePrevious : canNavigateNext;
    if (!allowed) return;
    const ok = await confirmDiscardPublicationEdit();
    if (!ok) return;
    setPublicationEditDirty(false);
    setDetailsEditMode(false);
    setDetailsActionError(null);
    setDetailsActionSuccess(null);
    await onNavigate(direction);
  }, [
    canNavigateNext,
    canNavigatePrevious,
    confirmDiscardPublicationEdit,
    navigationBusy,
    onNavigate,
    setDetailsActionError,
    setDetailsActionSuccess,
    setDetailsEditMode,
  ]);

  const closePublicationEditForNavigation = React.useCallback(() => {
    setPublicationEditDirty(false);
    setDetailsEditMode(false);
    onClose();
  }, [onClose, setDetailsEditMode]);

  useUnsavedExitGuard({
    active: open && detailsEditMode,
    shouldBlock: open && detailsEditMode && publicationEditDirty,
    onConfirmExit: closePublicationEditForNavigation,
    eyebrow: i18nT("modification_en_cours_26445b1d"),
    title: i18nT("quitter_la_modification_2a7e2e07"),
    message: i18nT("vos_changements_ne_seront_pas_enregistres_2c404e9f"),
    cancelLabel: i18nT("continuer_l_edition_0f0075bb"),
    confirmLabel: i18nT("quitter_3e4126f5"),
    variant: "danger",
  });

  const requestChannelChange = React.useCallback(async (channelKey: string) => {
    if (!channelKey || channelKey === activePublicationEditChannelKey) return;
    const ok = await confirmDiscardPublicationEdit();
    if (!ok) return;
    setDetailsEditMode(false);
    setDetailsActionError(null);
    setDetailsActionSuccess(null);
    setDetailsChannelKey(channelKey);
  }, [activePublicationEditChannelKey, confirmDiscardPublicationEdit, setDetailsActionError, setDetailsActionSuccess, setDetailsChannelKey, setDetailsEditMode]);

  React.useEffect(() => {
    if (!open) return;
    setPublicationPreviewOpen(false);
    setPublicationCameraOpen(false);
    setPublicationMediaLibraryOpen(false);
    setPublicationOptimizerRequest(null);
    setPublicationOptimizerQueue([]);
    setPublicationOptimizerCompleted(false);
    setTiktokStatusChecking(false);
    setTiktokRetrying(false);
    setTiktokCancelling(false);
    setPublicationStatusRefreshing(false);
    detailsScrollSnapshotRef.current = null;
    window.requestAnimationFrame(() => {
      detailsBodyRef.current?.scrollTo({ top: 0, behavior: "auto" });
    });
  }, [open, detailsItem?.id]);

  function openPublicationOptimizerForFiles(files: File[]) {
    const requests = files.map<PublicationMediaOptimizerRequest>((file) => ({
      source: { kind: "file", file },
    }));
    const [first, ...rest] = requests;
    if (!first) return;
    setPublicationOptimizerRequest(first);
    setPublicationOptimizerQueue(rest);
    setPublicationOptimizerCompleted(false);
  }

  function openPublicationOptimizerForLibraryItem(
    item: MediaLibraryPickerItem,
  ) {
    setPublicationOptimizerRequest({
      source: { kind: "library", item: item as MediaOptimizerItem },
    });
    setPublicationOptimizerQueue([]);
    setPublicationOptimizerCompleted(false);
  }

  function closePublicationOptimizer() {
    if (
      publicationOptimizerCompleted &&
      publicationOptimizerQueue.length > 0
    ) {
      const [next, ...rest] = publicationOptimizerQueue;
      setPublicationOptimizerRequest(next);
      setPublicationOptimizerQueue(rest);
      setPublicationOptimizerCompleted(false);
      return;
    }
    setPublicationOptimizerRequest(null);
    setPublicationOptimizerQueue([]);
    setPublicationOptimizerCompleted(false);
  }

  async function handleOptimizedPublicationMedia(item: MediaOptimizerItem) {
    await addPublicationMediaLibraryItems([item]);
    markPublicationEditDirty();
    setPublicationOptimizerCompleted(true);
    restoreDetailsModalScroll();
  }

  function handlePublicationImageFiles(
    fileList: FileList | File[] | null,
  ) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const insertableFiles = files.filter(
      (file) =>
        !getMediaLibraryOptimizationRequirements({
          mediaType: "image",
          sizeBytes: file.size,
          targetBytes: BOOSTER_MAX_IMAGE_BYTES,
          name: file.name,
          mimeType: file.type,
        }).needsOptimization,
    );
    const mediaToOptimize = files.filter(
      (file) => !insertableFiles.includes(file),
    );
    if (insertableFiles.length > 0) {
      markPublicationEditDirty();
      addPublicationFiles(insertableFiles);
    }
    if (mediaToOptimize.length > 0) {
      openPublicationOptimizerForFiles(mediaToOptimize);
    }
  }

  function handlePublicationVideoFiles(
    fileList: FileList | File[] | null,
  ) {
    const file = Array.from(fileList || [])[0];
    if (!file) return;
    const detectedType = detectUniversalUploadMediaType({
      name: file.name,
      mimeType: file.type,
    });
    const requirements = getMediaLibraryOptimizationRequirements({
      mediaType: "video",
      sizeBytes: file.size,
      targetBytes: BOOSTER_MAX_VIDEO_BYTES,
      name: file.name,
      mimeType: file.type,
    });
    if (detectedType === "video" && requirements.needsOptimization) {
      openPublicationOptimizerForFiles([file]);
      return;
    }
    markPublicationEditDirty();
    addPublicationVideo([file]);
  }

  function handlePublicationPhoto(file: File) {
    const requirements = getMediaLibraryOptimizationRequirements({
      mediaType: "image",
      sizeBytes: file.size,
      targetBytes: BOOSTER_MAX_IMAGE_BYTES,
      name: file.name,
      mimeType: file.type,
    });
    if (requirements.needsOptimization) {
      openPublicationOptimizerForFiles([file]);
      return;
    }
    markPublicationEditDirty();
    addPublicationPhoto(file);
  }

  if (!open) return null;

  const safeDetailHtml = detailsItem?.detailHtml ? sanitizeHtml(detailsItem.detailHtml) : "";

  return (
          <div className={styles.modalOverlay} onClick={() => void requestClose()}>
            <div className={`${styles.modalCard} ${styles.detailsModalCard}`} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div className={styles.modalTitle}>{i18nT("details_aaa029e6")}</div>
                  {detailsItem ? (
                    <>
                      <span className={`${styles.badge} ${pill(detailsItem.provider).cls}`}>{pill(detailsItem.provider).label}</span>
                      {detailsItem.originSource === "inr_agent" ? (
                        <span className={styles.inrAgentDetailBadge} title={detailsItem.originLabel || "Créé par iNr’Agent"}>
                          <img src="/icons/inr-agent.png" alt="" aria-hidden="true" />
                          {i18nT("cree_par_inr_agent_31bbe816")}{" "}</span>
                      ) : null}
                      {detailsItem.source !== "app_events" && detailsAccountLabel ? (
                        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.65)" }}>• {detailsAccountLabel}</span>
                      ) : null}
                    </>
                  ) : null}
                </div>

                <div className={styles.detailsHeaderActions}>
                  <div className={styles.detailsNavigation} aria-label={i18nT("navigation_dans_la_liste_85ea6000")}>
                    <button
                      className={`${styles.btnGhost} ${styles.detailsNavigationButton}`}
                      onClick={() => void requestNavigate(-1)}
                      type="button"
                      title={i18nT("element_precedent_358f9c1e")}
                      aria-label={i18nT("element_precedent_358f9c1e")}
                      disabled={!canNavigatePrevious || navigationBusy}
                    >
                      ‹
                    </button>
                    <span className={styles.detailsNavigationCounter} aria-live="polite">
                      {navigationBusy ? "…" : navigationLabel}
                    </span>
                    <button
                      className={`${styles.btnGhost} ${styles.detailsNavigationButton}`}
                      onClick={() => void requestNavigate(1)}
                      type="button"
                      title={i18nT("element_suivant_9d61e569")}
                      aria-label={i18nT("element_suivant_9d61e569")}
                      disabled={!canNavigateNext || navigationBusy}
                    >
                      ›
                    </button>
                  </div>
                  <button className={styles.btnGhost} onClick={() => void requestClose()} type="button" title={i18nT("fermer_5ab4ec64")} aria-label={i18nT("fermer_5ab4ec64")}>
                    ✕
                  </button>
                </div>
              </div>

              <div ref={detailsBodyRef} className={styles.modalBody} data-inrsend-details-body="true">
                {!detailsItem ? (
                  <div style={{ color: "rgba(255,255,255,0.65)" }}>{i18nT("selectionne_un_element_523f9c88")}</div>
                ) : (() => {
                  const payload = detailsItem.source === "app_events" ? ((detailsItem as any)?.raw?.payload || null) : null;
                  const publicationId = detailsItem.source === "app_events" ? String(payload?.publication_id || "").trim() : "";
                  const channelPublications = detailsItem.source === "app_events" ? extractChannelPublications(payload) : [];
                  const defaultParts = detailsItem.source === "app_events" ? extractPublicationParts(payload) : {};
                  const publicationChannelEntries = detailsItem.source === "app_events"
                    ? channelPublications.length
                      ? channelPublications
                      : orderChannelKeys((detailsItem.channels && detailsItem.channels.length ? detailsItem.channels : [detailsItem.target]).filter(Boolean).map((channel: unknown) => String(channel))).map((channel) => ({
                          key: channel,
                          label: formatChannelLabel(channel),
                          parts: defaultParts,
                        }))
                    : [];
                  const activePublicationEntry = detailsItem.source === "app_events"
                    ? (publicationChannelEntries.find((entry) => entry.key === detailsChannelKey) || publicationChannelEntries[0] || null)
                    : null;
                  const persistedActivePublicationResult = detailsItem.source === "app_events" && activePublicationEntry
                    ? ((payload?.results && typeof payload.results === "object" ? (payload.results as any)[activePublicationEntry.key] : null) || null)
                    : null;
                  const activePublicationLiveEntry = activePublicationEntry
                    ? getLivePublicationEntry(publicationLiveStatus, activePublicationEntry.key)
                    : null;
                  const activePublicationLiveResult = activePublicationEntry
                    ? getLivePublicationResult(publicationLiveStatus, activePublicationEntry.key)
                    : null;
                  const activePublicationResult = activePublicationLiveResult || persistedActivePublicationResult;
                  const activePublicationDeleted = isDeletedChannelResult(activePublicationResult);
                  const activePublicationFailed = isFailedChannelResult(activePublicationResult);
                  const activePublicationFailureMessage = activePublicationFailed
                    ? i18nT("la_publication_n_a_pas_abouti_9368e2ed")
                    : "";
                  const activePublicationWarning = isWarningChannelResult(
                    activePublicationResult,
                    activePublicationEntry?.key || "",
                  );
                  const activePublicationWarningMessage = activePublicationWarning
                    ? i18nT("publication_finalisee_avec_avertissement_b3f02094")
                    : "";
                  const visiblePublicationItemError =
                    detailsItem.source === "app_events" && detailsItem.error
                      ? i18nT("mail_action_failed")
                      : "";
                  const isTiktokPublicationEntry = activePublicationEntry?.key === "tiktok";
                  const isYoutubeShortsPublicationEntry = activePublicationEntry?.key === "youtube_shorts";
                  const isExternalVideoPublicationEntry = isTiktokPublicationEntry || isYoutubeShortsPublicationEntry;
                  const tiktokPublishId = isTiktokPublicationEntry ? getTiktokPublishId(activePublicationResult) : "";
                  const tiktokStatusMeta = isTiktokPublicationEntry ? getTiktokStatusMeta(activePublicationResult) : null;
                  const youtubeShortsPublicationHref = isYoutubeShortsPublicationEntry ? getYoutubeShortsPublicationUrl(activePublicationResult) : "";
                  const activeConnectedChannelDetail = activePublicationEntry
                    ? connectedChannelDetails[activePublicationEntry.key] || null
                    : null;
                  const activeChannelAccountHref = activePublicationEntry
                    ? getFallbackChannelAccountHref(activePublicationEntry.key, activePublicationResult) ||
                      normalizeExternalHref(activeConnectedChannelDetail?.href)
                    : "";
                  const activeChannelAccountActionLabel = activePublicationEntry
                    ? getChannelAccountActionLabel(activePublicationEntry.key, activeConnectedChannelDetail, runtimeT)
                    : i18nT("open_channel");
                  const activePublicationStatusMeta = activePublicationEntry
                    ? getPublicationStatusMeta(
                        activePublicationEntry.key,
                        activePublicationResult,
                        activePublicationLiveEntry,
                        runtimeT,
                      )
                    : null;
                  const activePublicationStatusTime = formatPublicationStatusCheckedAt(
                    (isTiktokPublicationEntry ? tiktokStatusMeta?.checkedAt : "") || publicationStatusCheckedAt,
                    locale,
                  );
                  const tiktokDirectPublicationHref = isTiktokPublicationEntry
                    ? normalizeExternalHref(
                        activePublicationResult?.share_url ||
                          activePublicationResult?.post_url ||
                          activePublicationResult?.video_url ||
                          activePublicationResult?.external_url,
                      )
                    : "";
                  const activeParts = activePublicationEntry?.parts || defaultParts;
                  const sourceDocAttachments = detailsItem.source === "send_items"
                    ? extractAttachmentsFromPayload(detailsSourceDocPayload)
                    : [];
                  const campaignAttachments = detailsItem.source === "mail_campaigns"
                    ? [...(detailsItem.attachments || []), ...extractAttachmentsFromPayload((detailsItem as any).raw)]
                    : [];
                  const publicationDraftAttachments = detailsItem.source === "app_events" && Array.isArray(payload?.imageDrafts)
                    ? payload.imageDrafts
                        .map((image: any) => ({
                          url: String(image?.originalPublicUrl || image?.originalUrl || image?.publicUrl || image?.url || image?.dataUrl || "").trim(),
                          name: String(image?.originalName || image?.name || "Image brouillon"),
                          type: String(image?.originalType || image?.type || "image/jpeg"),
                          size: Number(image?.originalSize || image?.size || 0) || undefined,
                        }))
                        .filter((att: any) => att.url)
                    : [];
                  const attachmentCandidates = detailsItem.source === "send_items"
                    ? [...(detailsItem.attachments || []), ...extractAttachmentsFromPayload((detailsItem as any).raw), ...sourceDocAttachments]
                    : detailsItem.source === "mail_campaigns"
                    ? campaignAttachments
                    : detailsItem.source === "app_events"
                    ? [...(activeParts.attachments || []), ...publicationDraftAttachments]
                    : [...(detailsItem.attachments || [])];
                  const dedupedAttachments = attachmentCandidates.filter((att, idx, arr) => {
                    const key = `${att.url || ""}|${att.name || ""}`;
                    return arr.findIndex((x) => `${x.url || ""}|${x.name || ""}` === key) === idx;
                  });
                  const imageAttachments = dedupedAttachments.filter((att) => att?.url && isImageAttachment(att));
                  const videoAttachments = dedupedAttachments.filter((att) => att?.url && isVideoAttachment(att));
                  const activeVideoAttachment = videoAttachments[0] || null;
                  const activeSourceVideoAttachment = activeParts.sourceVideo && !sameVideoAttachment(activeParts.sourceVideo, activeVideoAttachment)
                    ? activeParts.sourceVideo
                    : null;
                  // iNrSend conserve la vidéo originale comme source de travail, même si une variante publiée existe.
                  const activeVideoDisplayAttachment = activeSourceVideoAttachment || activeVideoAttachment;
                  const activeVideoSourceMetadata = (activeSourceVideoAttachment as any)?.sourceMetadata || (activeVideoAttachment as any)?.sourceMetadata || null;
                  const isVideoPublication = detailsItem.source === "app_events" && (
                    String(payload?.mediaType || payload?.media_type || "").toLowerCase() === "video" ||
                    Boolean(activeVideoAttachment)
                  );
                  const activeVideoSettings = isVideoPublication ? activeParts.videoSettings || null : null;
                  const activeVideoFormatLabel = activeVideoSettings && activePublicationEntry
                    ? getVideoFormatLabel(activePublicationEntry.key as any, activeVideoSettings.format as any, activeVideoSourceMetadata as any)
                    : null;
                  const activeVideoAdaptationLabel = activeVideoSettings
                    ? VIDEO_ADAPTATION_MODE_LABELS[activeVideoSettings.adaptationMode]
                    : null;
                  const fileAttachments = dedupedAttachments.filter((att) => !imageAttachments.includes(att) && !videoAttachments.includes(att));
                  const showFallbackMessage = (() => {
                    if (detailsItem.source !== "app_events") return true;
                    const activeHasStructured = !!(activeParts.title || activeParts.content || activeParts.cta || activeParts.hashtags?.length || activeParts.attachments?.length);
                    const fallbackTitle = firstNonEmpty(payload?.post?.title, payload?.subject, payload?.title);
                    const fallbackContent = firstNonEmpty(payload?.post?.content, payload?.post?.text, payload?.content, payload?.text, payload?.message);
                    const fallbackCta = firstNonEmpty(payload?.post?.cta, payload?.cta);
                    const fallbackHashtags = Array.isArray(payload?.post?.hashtags || payload?.hashtags)
                      ? (payload?.post?.hashtags || payload?.hashtags).map((x: any) => String(x || "").trim()).filter(Boolean)
                      : [];
                    const fallbackAttachments = extractAttachmentsFromPayload(payload);
                    return !(activeHasStructured || fallbackTitle || fallbackContent || fallbackCta || fallbackHashtags.length || fallbackAttachments.length);
                  })();
                  const isDraftItem = String((detailsItem as any)?.status || (detailsItem as any)?.raw?.status || "").toLowerCase() === "draft";
                  const publicationPreviewData = (() => {
                    if (detailsItem.source !== "app_events" || !activePublicationEntry) return null;
                    const selectedAssets = detailsEditMode
                      ? activePublicationEditAssets.filter((asset) => asset.selected)
                      : imageAttachments.map((attachment) => ({
                          previewUrl: attachment.url || "",
                          transform: undefined,
                          preset: activePublicationEditPreset,
                        }));
                    const firstAsset = selectedAssets[0] || null;
                    const hashtags = detailsEditMode
                      ? publicationEditForm.hashtags
                          .split(/[;,\n\s]+/)
                          .map((tag) => tag.trim().replace(/^#+/, ""))
                          .filter(Boolean)
                      : (Array.isArray(activeParts.hashtags) ? activeParts.hashtags : [])
                          .map((tag: string) => String(tag || "").trim().replace(/^#+/, ""))
                          .filter(Boolean);
                    const previewTitle = detailsEditMode ? publicationEditForm.title : (activeParts.title || "");
                    const previewContent = detailsEditMode ? publicationEditForm.content : (activeParts.content || "");
                    const previewCta = detailsEditMode
                      ? getPublicationPreviewCta(publicationDisplayKey, publicationEditForm)
                      : (activeParts.cta || "");
                    return {
                      channelKey: activePublicationEntry.key,
                      mediaType: isVideoPublication ? "video" as const : "images" as const,
                      channelLabel: activePublicationEntry?.label || formatChannelLabel(activePublicationEntry.key),
                      title: previewTitle,
                      content: previewContent,
                      cta: previewCta,
                      hashtags,
                      imageCount: isVideoPublication ? 0 : selectedAssets.length,
                      video: isVideoPublication && activeVideoDisplayAttachment?.url
                        ? {
                            previewUrl: activeVideoDisplayAttachment.url,
                            name: activeVideoDisplayAttachment.name || "Vidéo iNrCy",
                            type: activeVideoDisplayAttachment.type || "video/mp4",
                            size: activeVideoDisplayAttachment.size || null,
                            duration: (activeVideoDisplayAttachment as any).duration || null,
                            aspectRatio: activeVideoSettings
                              ? getVideoPreviewAspectRatio(activeVideoSettings.format as any, activeVideoSourceMetadata as any)
                              : null,
                            fitMode: activeVideoSettings ? getVideoPreviewFitMode(activeVideoSettings.adaptationMode as any) : null,
                          }
                        : null,
                      formatLabel: isVideoPublication
                        ? activeVideoFormatLabel && activeVideoAdaptationLabel
                          ? `Vidéo ${activeVideoFormatLabel} · ${activeVideoAdaptationLabel}`
                          : "Vidéo finale"
                        : activePublicationEntry.key === "inrcy_site" || activePublicationEntry.key === "site_web" ? "Rendu site / iframe" : `Image finale : ${activePublicationEditPreset.width}×${activePublicationEditPreset.height}`,
                      image: firstAsset
                        ? {
                            previewUrl: firstAsset.previewUrl,
                          transform: firstAsset.transform,
                          preset: firstAsset.preset || activePublicationEditPreset,
                          }
                        : null,
                      images: selectedAssets.map((asset) => ({
                        previewUrl: asset.previewUrl,
                        transform: asset.transform,
                        preset: asset.preset || activePublicationEditPreset,
                      })),
                    };
                  })();

                  return (
                    <>
                      <div className={styles.detailsStack}>
                        <section className={styles.detailSectionCard}>
                          <div className={styles.detailSectionHeader}>
                            <div>
                              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                <div className={styles.detailsTitle}>{detailsItem.title || i18nT("sans_objet_e5ad6a39")}</div>
                                {isVideoPublication ? <span className={styles.publicationMediaBadge}>{i18nT("video_712dab2a")}</span> : null}
                              </div>
                              <div className={styles.detailsSub}>{localizedOutboxStatus(detailsItem, locale, runtimeT)}</div>
                            </div>
                          </div>

                          {detailsItem.source === "send_items" ? (
                            <>
                              <div className={styles.metaGrid}>
                                <div className={styles.metaRow}>
                                  <div className={styles.metaKey}>{i18nT("boite_d_envoi_8af123c1")}</div>
                                  <div className={styles.metaVal}>{detailsAccountLabel || "—"}</div>
                                </div>
                                <div className={styles.metaRow}>
                                  <div className={styles.metaKey}>{i18nT("destinataires_51610ad7")}</div>
                                  <div className={styles.metaVal}>{splitList(detailsItem.to || detailsItem.target).join(", ") || "—"}</div>
                                </div>
                                <div className={styles.metaRow}>
                                  <div className={styles.metaKey}>{i18nT("objet_3de621c5")}</div>
                                  <div className={styles.metaVal}>{detailsItem.subject || detailsItem.title || "—"}</div>
                                </div>
                                <div className={styles.metaRow}>
                                  <div className={styles.metaKey}>{i18nT("document_source_9015fe2a")}</div>
                                  <div className={styles.metaVal}>{(detailsItem as any).raw?.source_doc_number || "—"}</div>
                                </div>
                              </div>
                              <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                                {isDraftItem ? (
                                  <button
                                    type="button"
                                    className={styles.btnPrimary}
                                    onClick={() => resumeDraft(detailsItem)}
                                  >
                                    {i18nT("reprendre_l_edition_0d6c9774")}{" "}</button>
                                ) : null}
                                {detailsItem.reopenHref ? (
                                  <button
                                    type="button"
                                    className={styles.btnGhost}
                                    onClick={() => router.push(detailsItem.reopenHref || "/dashboard/mails")}
                                  >
                                    {i18nT("reouvrir_dans_l_outil_3baa13cd")}{" "}</button>
                                ) : null}
                                {(detailsItem as any).raw?.source_doc_type === "devis" && (detailsItem as any).raw?.source_doc_save_id ? (
                                  <button
                                    type="button"
                                    className={styles.btnGhost}
                                    onClick={() => router.push(`/dashboard/factures/new?fromDevisSaveId=${encodeURIComponent((detailsItem as any).raw.source_doc_save_id)}`)}
                                  >
                                    {i18nT("creer_la_facture_d28b4fd5")}{" "}</button>
                                ) : null}
                              </div>
                            </>
                          ) : detailsItem.source === "mail_campaigns" ? (
                            <>
                              <div
                                style={{
                                  padding: 16,
                                  borderRadius: 16,
                                  border: "1px solid rgba(76,195,255,0.20)",
                                  background: "rgba(76,195,255,0.06)",
                                  marginBottom: 14,
                                }}
                              >
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                                  <div>
                                    {!isCampaignFinishedStatus(campaignReport?.status || (detailsItem as any).raw?.status) ? (
                                      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.62)", marginBottom: 4 }}>
                                        {i18nT("suivi_automatique_toutes_les_2_minutes_8ff76207")}{" "}</div>
                                    ) : null}
                                    <div style={{ fontSize: 17, fontWeight: 800 }}>
                                      {localizedCampaignStatus(campaignReport?.status || (detailsItem as any).raw?.status, runtimeT)}
                                    </div>
                                  </div>
                                  <div style={{ fontSize: 28, fontWeight: 900 }}>
                                    {campaignReport?.progressPercent ?? Math.max(0, Number((detailsItem as any).raw?.progress_percent || 0))}%
                                  </div>
                                </div>
                                <div style={{ height: 9, borderRadius: 999, background: "rgba(255,255,255,0.10)", overflow: "hidden", marginTop: 12 }}>
                                  <div
                                    style={{
                                      width: `${Math.max(0, Math.min(100, campaignReport?.progressPercent ?? Number((detailsItem as any).raw?.progress_percent || 0)))}%`,
                                      height: "100%",
                                      borderRadius: 999,
                                      background: "linear-gradient(90deg, rgba(76,195,255,0.85), rgba(120,105,255,0.90))",
                                      transition: "width 300ms ease",
                                    }}
                                  />
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, marginTop: 14 }}>
                                  <div>
                                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.58)" }}>{i18nT("temps_restant_estime_5144a14a")}</div>
                                    <div style={{ marginTop: 3, fontWeight: 700 }}>
                                      {campaignReport?.estimatedRemainingMs != null
                                        ? localizedCampaignDuration(campaignReport.estimatedRemainingMs, runtimeT)
                                        : i18nT("calcul_en_cours_d976e804")}
                                    </div>
                                  </div>
                                  <div>
                                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.58)" }}>{i18nT("fin_estimee_7b9ffd11")}</div>
                                    <div style={{ marginTop: 3, fontWeight: 700 }}>
                                      {campaignReport?.estimatedCompletionAt
                                        ? new Date(campaignReport.estimatedCompletionAt).toLocaleString(locale)
                                        : "—"}
                                    </div>
                                  </div>
                                  <div>
                                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.58)" }}>{i18nT("duree_ecoulee_d3b27cd9")}</div>
                                    <div style={{ marginTop: 3, fontWeight: 700 }}>
                                      {campaignReport?.elapsedMs != null ? localizedCampaignDuration(campaignReport.elapsedMs, runtimeT) : "—"}
                                    </div>
                                  </div>
                                  <div>
                                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.58)" }}>{i18nT("bilan_de_campagne_15e3ff8b")}</div>
                                    <div style={{ marginTop: 3, fontWeight: 700 }}>
                                      {localizedCompletionEmailStatus(campaignReport?.completionEmail.status || (detailsItem as any).raw?.completion_email_status, runtimeT)}
                                    </div>
                                  </div>
                                </div>
                                {campaignReport?.completionEmail.lastError ? (
                                  <div style={{ marginTop: 10, color: "#ffb0b0", fontSize: 12 }}>
                                    {i18nT("mail_action_failed")}
                                  </div>
                                ) : null}
                              </div>
                              <div className={styles.metaGrid}>
                                <div className={styles.metaRow}>
                                  <div className={styles.metaKey}>{i18nT("boite_d_envoi_8af123c1")}</div>
                                  <div className={styles.metaVal}>{detailsAccountLabel || "—"}</div>
                                </div>
                                <div className={styles.metaRow}>
                                  <div className={styles.metaKey}>{i18nT("destinataires_51610ad7")}</div>
                                  <div className={styles.metaVal}>{i18nT("campaign_contact_count", { count: Number((detailsItem as any).raw?.total_count || 0) })}</div>
                                </div>
                                <div className={styles.metaRow}>
                                  <div className={styles.metaKey}>{i18nT("progression_685e2622")}</div>
                                  <div className={styles.metaVal}>{localizedCampaignProgress((detailsItem as any).raw || {}, campaignHealth, locale, runtimeT)}</div>
                                </div>
                                {String((detailsItem as any).raw?.status || "").toLowerCase() === "paused" ? (
                                  <div className={styles.metaRow}>
                                    <div className={styles.metaKey}>{i18nT("reprise_a0a582ef")}</div>
                                    <div className={styles.metaVal}>
                                      {(detailsItem as any).raw?.resume_at
                                        ? i18nT("automatique_le_value_a5b6b0dc", { value0: new Date((detailsItem as any).raw.resume_at).toLocaleString(locale) })
                                        : i18nT("manuelle_apres_correction_de_la_boite_43502c57")}
                                    </div>
                                  </div>
                                ) : null}
                                <div className={styles.metaRow}>
                                  <div className={styles.metaKey}>{i18nT("objet_3de621c5")}</div>
                                  <div className={styles.metaVal}>{detailsItem.subject || detailsItem.title || "—"}</div>
                                </div>
                              </div>
                              <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                                {isRetryableCampaignItem(detailsItem) ? (
                                  <button
                                    type="button"
                                    className={styles.btnPrimary}
                                    onClick={() => void retryCampaignFailedRecipients(detailsItem.id)}
                                    disabled={campaignActionBusyId === detailsItem.id}
                                  >
                                    {campaignActionBusyId === detailsItem.id
                                      ? i18nT("relance_428b7ac0")
                                      : String((detailsItem as any).raw?.status || "").toLowerCase() === "paused"
                                        ? i18nT("reprendre_la_campagne_f7014e08")
                                        : i18nT("relancer_les_echecs_5ced08d1")}
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className={styles.btnGhost}
                                  onClick={() => {
                                    void Promise.all([
                                      loadCampaignRecipients(detailsItem.id, campaignRecipientsPage, campaignRecipientsFilter),
                                      loadCampaignHealth(detailsItem.id, (detailsItem as any).raw || {}),
                                      refreshHistory?.(),
                                    ]);
                                  }}
                                  disabled={campaignRecipientsLoading || campaignHealthLoading || campaignActionBusyId === detailsItem.id}
                                >
                                  {campaignRecipientsLoading || campaignHealthLoading ? i18nT("actualisation_2834f8d6") : i18nT("rafraichir_le_suivi_02fcaec9")}
                                </button>
                                {["completed", "partial", "failed"].includes(String(campaignReport?.status || (detailsItem as any).raw?.status || "").toLowerCase()) ? (
                                  <button
                                    type="button"
                                    className={styles.btnGhost}
                                    onClick={() => void resendCampaignCompletionSummary(detailsItem.id)}
                                    disabled={campaignSummaryBusyId === detailsItem.id}
                                  >
                                    {campaignSummaryBusyId === detailsItem.id
                                      ? i18nT("envoi_du_bilan_6e6a9817")
                                      : campaignReport?.completionEmail.status === "sent"
                                        ? i18nT("renvoyer_le_bilan_c0b47db8")
                                        : i18nT("envoyer_le_bilan_40c695f9")}
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className={styles.btnGhost}
                                  onClick={() => void openCampaignComposeFromHistory(detailsItem, "reuse")}
                                  disabled={campaignActionBusyId === detailsItem.id}
                                >
                                  {campaignActionBusyId === detailsItem.id ? i18nT("preparation_47305e12") : i18nT("reutiliser_62388f54")}
                                </button>
                                <button
                                  type="button"
                                  className={styles.btnGhost}
                                  onClick={() => void openCampaignComposeFromHistory(detailsItem, "resend")}
                                  disabled={campaignActionBusyId === detailsItem.id}
                                >
                                  {campaignActionBusyId === detailsItem.id ? i18nT("preparation_47305e12") : i18nT("renvoyer_1e73219e")}
                                </button>
                                {detailsItem.reopenHref ? (
                                  <button
                                    type="button"
                                    className={styles.btnGhost}
                                    onClick={() => router.push(detailsItem.reopenHref || "/dashboard/mails")}
                                  >
                                    {i18nT("reouvrir_dans_l_outil_3baa13cd")}{" "}</button>
                                ) : null}
                              </div>
                            </>
                          ) : (
                            <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                              <div className={styles.detailPillsWrap}>
                                {publicationChannelEntries.length ? (
                                  publicationChannelEntries.map((entry, idx) => {
                                    const entryResult = detailsItem.source === "app_events" && payload?.results && typeof payload.results === "object"
                                      ? ((payload.results as any)[entry.key] || null)
                                      : null;
                                    const entryIndicator = getChannelIndicatorMeta(
                                      entryResult,
                                      entry.key,
                                    );
                                    return (
                                      <button
                                        key={`${entry.key}-${idx}`}
                                        type="button"
                                        className={`${styles.channelBubbleBtn} ${activePublicationEntry?.key === entry.key ? styles.channelBubbleBtnActive : ""}`}
                                        onClick={() => void requestChannelChange(entry.key)}
                                      >
                                        <span className={styles.channelBubble}>
                                          <span>{entry.label}</span>
                                          {entryIndicator ? (
                                            <span
                                              className={entryIndicator.className}
                                              title={localizedIndicatorTitle(entryIndicator.kind, runtimeT)}
                                              aria-label={localizedIndicatorTitle(entryIndicator.kind, runtimeT)}
                                            />
                                          ) : null}
                                        </span>
                                      </button>
                                    );
                                  })
                                ) : (
                                  <span className={styles.metaVal}>—</span>
                                )}
                              </div>
                              {activePublicationEntry ? (
                                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginLeft: "auto" }}>
                                  {detailsActionSuccess ? (
                                    <div className={styles.detailsSuccessInline}>
                                      <b>{i18nT("action_7392d4ef")}</b> {detailsActionSuccess}
                                    </div>
                                  ) : null}
                                  {!isDraftItem && activePublicationStatusMeta ? (
                                    <div
                                      title={activePublicationStatusMeta.title}
                                      style={{
                                        ...getPublicationStatusPillStyle(activePublicationStatusMeta.tone),
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 6,
                                        minHeight: 34,
                                        padding: "6px 10px",
                                        borderRadius: 999,
                                        fontSize: 12,
                                        whiteSpace: "nowrap",
                                      }}
                                    >
                                      <span
                                        aria-hidden="true"
                                        style={{
                                          width: 7,
                                          height: 7,
                                          borderRadius: 999,
                                          background: "currentColor",
                                          opacity: 0.92,
                                        }}
                                      />
                                      <span>
                                        {i18nT("statut_b20e7fc2")}{" "}<b>{activePublicationStatusMeta.label}</b>
                                      </span>
                                      {activePublicationStatusTime ? (
                                        <span style={{ opacity: 0.66 }}>· {activePublicationStatusTime}</span>
                                      ) : null}
                                    </div>
                                  ) : null}
                                  {!isDraftItem && activePublicationId ? (
                                    <button
                                      type="button"
                                      className={styles.btnGhost}
                                      onClick={() => void refreshPublicationStatus(false)}
                                      disabled={detailsActionBusy || publicationStatusRefreshing}
                                      title={i18nT("actualiser_le_statut_de_tous_les_6545abd9")}
                                    >
                                      {publicationStatusRefreshing ? i18nT("actualisation_2834f8d6") : i18nT("actualiser_le_statut_47041c70")}
                                    </button>
                                  ) : null}
                                  {!isDraftItem && activeChannelAccountHref ? (
                                    <a
                                      className={styles.btnGhost}
                                      href={activeChannelAccountHref}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title={activeConnectedChannelDetail?.label || `Ouvrir ${activePublicationEntry.label}`}
                                      style={{ textDecoration: "none" }}
                                    >
                                      {activeChannelAccountActionLabel}
                                    </a>
                                  ) : null}
                                  {isTiktokPublicationEntry && !isDraftItem ? (
                                    <>
                                      {!tiktokStatusMeta?.cancelled ? (
                                        <button
                                          type="button"
                                          className={styles.btnGhost}
                                          onClick={() => void checkTiktokPublicationStatus(publicationId)}
                                          disabled={detailsActionBusy || tiktokStatusChecking || tiktokRetrying || tiktokCancelling || !tiktokPublishId}
                                          title={tiktokPublishId ? "Vérifier le statut réel auprès de TikTok" : "Identifiant TikTok introuvable"}
                                        >
                                          {tiktokStatusChecking ? i18nT("verification_30a67937") : i18nT("verifier_le_statut_06793362")}
                                        </button>
                                      ) : null}
                                      {tiktokStatusMeta?.failed || tiktokStatusMeta?.pending ? (
                                        <button
                                          type="button"
                                          className={tiktokStatusMeta?.failed ? styles.btnPrimary : styles.btnGhost}
                                          onClick={() => void retryTiktokPublication(publicationId, tiktokStatusMeta)}
                                          disabled={detailsActionBusy || tiktokStatusChecking || tiktokRetrying || tiktokCancelling}
                                          title={tiktokStatusMeta?.pending ? "Retenter avec confirmation pour éviter les doublons" : "Retenter l’envoi TikTok"}
                                        >
                                          {tiktokRetrying ? i18nT("relance_428b7ac0") : i18nT("retenter_l_envoi_d90d38d2")}
                                        </button>
                                      ) : null}
                                      {tiktokStatusMeta?.pending ? (
                                        <button
                                          type="button"
                                          className={styles.btnDangerSmall}
                                          onClick={() => void cancelPendingTiktokPublication(publicationId, tiktokStatusMeta)}
                                          disabled={detailsActionBusy || tiktokStatusChecking || tiktokRetrying || tiktokCancelling}
                                          title={i18nT("arreter_le_suivi_inrsend_et_annuler_aabec505")}
                                        >
                                          {tiktokCancelling ? i18nT("annulation_0cfb2a1c") : i18nT("annuler_49ba3292")}
                                        </button>
                                      ) : null}
                                      {tiktokDirectPublicationHref && tiktokDirectPublicationHref !== activeChannelAccountHref ? (
                                        <button
                                          type="button"
                                          className={styles.btnPrimary}
                                          onClick={() => {
                                            if (typeof window !== "undefined") window.open(tiktokDirectPublicationHref, "_blank", "noopener,noreferrer");
                                          }}
                                          disabled={detailsActionBusy || tiktokCancelling}
                                          title={i18nT("ouvrir_la_publication_tiktok_b7fdb9de")}
                                        >
                                          {i18nT("voir_la_publication_d6d6819f")}{" "}</button>
                                      ) : null}
                                    </>
                                  ) : isYoutubeShortsPublicationEntry && !isDraftItem ? (
                                    youtubeShortsPublicationHref && youtubeShortsPublicationHref !== activeChannelAccountHref ? (
                                      <button
                                        type="button"
                                        className={styles.btnPrimary}
                                        onClick={() => {
                                          if (typeof window !== "undefined") window.open(youtubeShortsPublicationHref, "_blank", "noopener,noreferrer");
                                        }}
                                        disabled={detailsActionBusy}
                                        title={i18nT("ouvrir_la_video_publiee_sur_youtube_16f63875")}
                                      >
                                        {i18nT("voir_la_video_f7f45e64")}{" "}</button>
                                    ) : null
                                  ) : isDraftItem ? (
                                    <button
                                      type="button"
                                      className={styles.btnPrimary}
                                      onClick={() => resumeDraft(detailsItem)}
                                      disabled={detailsActionBusy}
                                    >
                                      {i18nT("reprendre_l_edition_0d6c9774")}{" "}</button>
                                  ) : detailsEditMode ? (
                                    <button
                                      type="button"
                                      className={styles.btnPrimary}
                                      onClick={saveChannelPublication}
                                      disabled={detailsActionBusy}
                                    >
                                      {detailsActionBusy ? i18nT("enregistrement_e7d5f232") : i18nT("enregistrer_f7c8bcd8")}
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      className={styles.btnGhost}
                                      onClick={() => { setPublicationEditDirty(false); setDetailsEditMode(true); setDetailsActionError(null); setDetailsActionSuccess(null); }}
                                      disabled={detailsActionBusy}
                                      title={i18nT("modifier_la_publication_295870a4")}
                                      aria-label={i18nT("modifier_la_publication_295870a4")}
                                    >
                                      {i18nT("modifier_f260e757")}{" "}</button>
                                  )}
                                  {!isDraftItem && !isExternalVideoPublicationEntry ? (
                                    <button
                                      type="button"
                                      className={styles.btnDangerSmall}
                                      onClick={() => void deleteChannelPublicationAndSyncStatus()}
                                      disabled={detailsActionBusy}
                                      title={i18nT("supprimer_la_publication_2960b405")}
                                      aria-label={i18nT("supprimer_la_publication_2960b405")}
                                    >
                                      {detailsActionBusy && !detailsEditMode ? i18nT("suppression_a620db43") : i18nT("supprimer_1acfc1c7")}
                                    </button>
                                  ) : null}
                                </div>
                              ) : isDraftItem ? (
                                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginLeft: "auto" }}>
                                  {isDraftItem ? (
                                    <button
                                      type="button"
                                      className={styles.btnPrimary}
                                      onClick={() => resumeDraft(detailsItem)}
                                    >
                                      {i18nT("reprendre_l_edition_0d6c9774")}{" "}</button>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          )}

                          {detailsActionError ? (
                            <div className={styles.detailsError}>
                              <b>{i18nT("action_7392d4ef")}</b>{" "}
                              {detailsItem.source === "app_events"
                                ? detailsActionError
                                : i18nT("mail_action_failed")}
                            </div>
                          ) : null}

                          {isTiktokPublicationEntry && !isDraftItem && !detailsEditMode ? (
                            <div
                              style={{
                                marginTop: 12,
                                padding: "10px 12px",
                                borderRadius: 14,
                                border: tiktokStatusMeta?.failed
                                  ? "1px solid rgba(248,113,113,0.35)"
                                  : tiktokStatusMeta?.cancelled
                                    ? "1px solid rgba(168,85,247,0.35)"
                                  : tiktokStatusMeta?.pending
                                    ? "1px solid rgba(250,204,21,0.35)"
                                    : "1px solid rgba(56,189,248,0.24)",
                                background: tiktokStatusMeta?.failed
                                  ? "rgba(127,29,29,0.22)"
                                  : tiktokStatusMeta?.cancelled
                                    ? "rgba(88,28,135,0.18)"
                                  : tiktokStatusMeta?.pending
                                    ? "rgba(250,204,21,0.10)"
                                    : "rgba(56,189,248,0.08)",
                                color: "rgba(225,245,255,0.92)",
                                fontSize: 13,
                              }}
                            >
                              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                                <b>{i18nT("tiktok_7bacd055")}</b>
                                <span>{i18nT("statut_reel_7c442c71")}{" "}<b>{localizedTiktokStatusLabel(tiktokStatusMeta, runtimeT)}</b></span>
                                {tiktokPublishId ? (
                                  <span style={{ opacity: 0.72 }}>{i18nT("id_suivi_value_fa716bc7", { value0: tiktokPublishId })}</span>
                                ) : null}
                                {tiktokStatusMeta?.uploadedBytes ? (
                                  <span style={{ opacity: 0.72 }}>
                                    {i18nT("recu_par_tiktok_value_70589796", { value0: formatTiktokBytes(tiktokStatusMeta.uploadedBytes, locale) })}</span>
                                ) : null}
                                {tiktokStatusMeta?.downloadedBytes ? (
                                  <span style={{ opacity: 0.72 }}>
                                    {i18nT("telecharge_value_bc533700", { value0: formatTiktokBytes(tiktokStatusMeta.downloadedBytes, locale) })}</span>
                                ) : null}
                                {tiktokStatusMeta?.checkCount ? (
                                  <span style={{ opacity: 0.72 }}>
                                    {i18nT("verifications_value_91abd598", { value0: tiktokStatusMeta.checkCount })}</span>
                                ) : null}
                                {tiktokStatusMeta?.processingDurationSeconds ? (
                                  <span style={{ opacity: 0.72 }}>
                                    {i18nT("duree_value_b460295f", { value0: formatTiktokDuration(tiktokStatusMeta.processingDurationSeconds) })}</span>
                                ) : null}
                              </div>
                              {tiktokStatusMeta?.checkedAt ? (
                                <div style={{ marginTop: 5, opacity: 0.72 }}>
                                  {i18nT("dernier_controle_value_4a972550", { value0: formatTiktokDate(tiktokStatusMeta.checkedAt, locale) })}</div>
                              ) : null}
                              <div style={{ marginTop: 6, color: tiktokStatusMeta?.failed ? "#fecaca" : tiktokStatusMeta?.cancelled ? "#e9d5ff" : tiktokStatusMeta?.pending ? "#fde68a" : "rgba(225,245,255,0.88)" }}>
                                {localizedTiktokStatusMessage(tiktokStatusMeta, runtimeT)}
                              </div>
                              {tiktokStatusMeta?.failReason ? (
                                <div style={{ marginTop: 5, opacity: 0.8 }}>
                                  {i18nT("motif_technique_tiktok_4641189f")}{" "}<code>{tiktokStatusMeta.failReason}</code>
                                </div>
                              ) : null}
                              {tiktokStatusMeta?.providerErrorCode ? (
                                <div style={{ marginTop: 5, opacity: 0.8 }}>
                                  {i18nT("code_tiktok_8230f144")}{" "}<code>{tiktokStatusMeta.providerErrorCode}</code>
                                </div>
                              ) : null}
                            </div>
                          ) : null}

                          {isYoutubeShortsPublicationEntry && !isDraftItem && !detailsEditMode ? (
                            <div
                              style={{
                                marginTop: 12,
                                padding: "10px 12px",
                                borderRadius: 14,
                                border: "1px solid rgba(56,189,248,0.24)",
                                background: "rgba(56,189,248,0.08)",
                                color: "rgba(225,245,255,0.92)",
                                fontSize: 13,
                              }}
                            >
                              <b>{i18nT("youtube_3f8b5798")}</b> {" "}{i18nT("inrsend_garde_le_statut_et_le_1b4364e2")}{" "}</div>
                          ) : null}

                          {detailsItem.source === "app_events" && activePublicationFailed && !activePublicationDeleted ? (
                            <div className={styles.detailsError}>
                              <b>{i18nT("statut_b20e7fc2")}</b> {" "}{i18nT("publication_echouee_3078a063")}{" "}</div>
                          ) : null}

                          {detailsItem.source === "app_events" && activePublicationFailed && activePublicationFailureMessage ? (
                            <div className={styles.detailsError}>
                              <b>{i18nT("detail_fd53c22d")}</b> {activePublicationFailureMessage}
                            </div>
                          ) : null}

                          {detailsItem.source === "app_events" && activePublicationWarning ? (
                            <div className={styles.detailsWarning}>
                              <b>{i18nT("statut_b20e7fc2")}</b> {" "}{i18nT("publiee_avec_avertissement_47eb62fb")}{" "}{activePublicationWarningMessage ? ` — ${activePublicationWarningMessage}` : ""}
                            </div>
                          ) : null}

                          {detailsItem.error ? (
                            <div className={styles.detailsError}>
                              <b>{i18nT("detail_fd53c22d")}</b> {detailsItem.source !== "app_events" ? i18nT("mail_action_failed") : visiblePublicationItemError}
                            </div>
                          ) : null}
                        </section>

                        <section className={styles.detailSectionCard}>
                          <div className={styles.detailSectionHeader}>
                            <div className={styles.messageHeaderTitle}>{detailsItem.source === "app_events" && detailsEditMode ? i18nT("contenu_f3cb82af") : i18nT("message_68f4145f")}</div>
                          </div>

                          {detailsItem.source !== "app_events" ? (
                            <div className={styles.messageBody}>
                              {detailsItem.detailHtml ? (
                                <div className={styles.messageHtml} dangerouslySetInnerHTML={{ __html: safeDetailHtml }} />
                              ) : (
                                <pre className={styles.messageText}>{detailsItem.detailText || ""}</pre>
                              )}
                            </div>
                          ) : activePublicationEntry ? (
                            (() => {
                              const parts = activeParts;
                              const isSitePublication = activePublicationEntry.key === "inrcy_site" || activePublicationEntry.key === "site_web" || activePublicationEntry.key === "site";
                              const showInstagramHashtags = activePublicationEntry.key === "instagram" || activePublicationEntry.key === "tiktok";
                              const deletedAt = activePublicationResult?.deleted_at ? new Date(String(activePublicationResult.deleted_at)).toLocaleString(locale) : null;
                              const hasAny = !!(parts.title || parts.content || parts.cta || (showInstagramHashtags && parts.hashtags?.length));
                              if (!hasAny && showFallbackMessage) {
                                return (
                                  <div className={styles.messageBody}>
                                    {detailsItem.detailHtml ? (
                                      <div className={styles.messageHtml} dangerouslySetInnerHTML={{ __html: safeDetailHtml }} />
                                    ) : (
                                      <pre className={styles.messageText}>{detailsItem.detailText || ""}</pre>
                                    )}
                                  </div>
                                );
                              }
                              if (!hasAny && !detailsEditMode) return <div className={styles.emptyDetailText}>{i18nT("aucun_message_disponible_pour_ce_canal_552a6c0c")}</div>;
                              return (
                                <article key={activePublicationEntry.key} className={styles.channelPublicationCard}>
                                  {activePublicationDeleted ? (
                                    <div className={styles.detailsError} style={{ marginBottom: 12 }}>
                                      <b>{i18nT("statut_b20e7fc2")}</b> {" "}{i18nT("supprime_c73cacd5")}{deletedAt ? i18nT("le_value_02cc4688", { value0: deletedAt }) : ""}
                                    </div>
                                  ) : null}
                                  <div className={styles.publicationParts}>
                                    {detailsEditMode && !activePublicationDeleted ? (
                                      <>
                                        <div>
                                          <div className={styles.publicationLabel}>{i18nT("titre_eb97899a")}</div>
                                          {isMobileViewport ? (
                                            <textarea
                                              value={publicationEditForm.title}
                                              onChange={(e) => updatePublicationEdit({ title: e.target.value })}
                                              className={`${styles.publicationFieldInput} ${styles.publicationFieldInputMultiline}`}
                                              placeholder={i18nT("titre_eb97899a")}
                                              rows={2}
                                              disabled={detailsActionBusy}
                                            />
                                          ) : (
                                            <input
                                              type="text"
                                              value={publicationEditForm.title}
                                              onChange={(e) => updatePublicationEdit({ title: e.target.value })}
                                              className={styles.publicationFieldInput}
                                              placeholder={i18nT("titre_eb97899a")}
                                              disabled={detailsActionBusy}
                                            />
                                          )}
                                        </div>
                                        <div>
                                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
                                            <div className={styles.publicationLabel} style={{ marginBottom: 0 }}>{i18nT("contenu_f3cb82af")}</div>
                                            {isSitePublication ? (
                                              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                                {([
                                                  ["bold", "B", "Gras"],
                                                  ["italic", "I", "Italique"],
                                                  ["underline", "U", "Souligné"],
                                                ] as const).map(([kind, label, title]) => (
                                                  <button
                                                    key={kind}
                                                    type="button"
                                                    title={title}
                                                    aria-label={title}
                                                    disabled={detailsActionBusy}
                                                    onMouseDown={(event) => {
                                                      if (event.cancelable) event.preventDefault();
                                                      applyPublicationSiteContentFormat(kind);
                                                    }}
                                                    style={{
                                                      minWidth: 32,
                                                      height: 30,
                                                      borderRadius: 9,
                                                      border: "1px solid rgba(76,195,255,0.35)",
                                                      background: "rgba(76,195,255,0.12)",
                                                      color: "#eaf7ff",
                                                      fontWeight: 900,
                                                      fontStyle: kind === "italic" ? "italic" : "normal",
                                                      textDecoration: kind === "underline" ? "underline" : "none",
                                                      cursor: detailsActionBusy ? "not-allowed" : "pointer",
                                                      opacity: detailsActionBusy ? 0.55 : 1,
                                                    }}
                                                  >
                                                    {label}
                                                  </button>
                                                ))}
                                              </div>
                                            ) : null}
                                          </div>
                                          {isSitePublication ? (
                                            <RichSiteContentEditor
                                              value={publicationEditForm.content}
                                              onChange={(content) => updatePublicationEdit({ content })}
                                              minHeight={180}
                                              editorRef={publicationSiteContentEditorRef}
                                              style={{ ...textAreaStyle, minHeight: 180 }}
                                            />
                                          ) : (
                                            <textarea
                                              value={publicationEditForm.content}
                                              onChange={(e) => updatePublicationEdit({ content: e.target.value })}
                                              className={styles.publicationFieldTextarea}
                                              placeholder={i18nT("contenu_f3cb82af")}
                                              rows={8}
                                              disabled={detailsActionBusy}
                                            />
                                          )}
                                        </div>
                                        <div>
                                          {(() => {
                                            const ctaMode = (publicationEditForm.ctaMode || "none") as BoosterCtaMode;
                                            const publicationCtaPost: Partial<ChannelPost> = {
                                              title: publicationEditForm.title,
                                              content: publicationEditForm.content,
                                              cta: publicationEditForm.cta,
                                              ctaMode,
                                              ctaUrl: publicationEditForm.ctaUrl,
                                              ctaPhone: publicationEditForm.ctaPhone,
                                            };
                                            const ctaChoice = getPreferredCtaChoiceFromPost(publicationDisplayKey, publicationCtaPost);
                                            const activeWebsiteUrl = getWebsiteUrlForChannel(publicationDisplayKey, publicationCtaDefaults);
                                            const activeWebsiteSourceLabel = getWebsiteSourceLabelForChannel(publicationDisplayKey, publicationCtaDefaults);
                                            const websiteChoices = [
                                              publicationCtaDefaults?.inrcySiteUrl
                                                ? { label: i18nT("site_inrcy_57016d6f"), url: publicationCtaDefaults.inrcySiteUrl }
                                                : null,
                                              publicationCtaDefaults?.siteWebUrl
                                                ? { label: i18nT("site_web_7e78af33"), url: publicationCtaDefaults.siteWebUrl }
                                                : null,
                                            ].filter(Boolean) as Array<{ label: string; url: string }>;
                                            const ctaGridColumns = isMobileViewport
                                              ? "1fr"
                                              : ctaMode === "website" || ctaMode === "custom"
                                                ? "minmax(0, 0.8fr) minmax(0, 1.1fr) minmax(0, 1fr)"
                                                : ctaMode === "call"
                                                  ? "minmax(0, 0.9fr) minmax(0, 1.1fr)"
                                                  : "minmax(0, 0.9fr)";
                                            return (
                                              <>
                                                <div style={{ display: "grid", gridTemplateColumns: ctaGridColumns, gap: 10, alignItems: "start" }}>
                                                  <div>
                                                    <div className={styles.publicationLabel}>{i18nT("bouton_fd5aea71")}</div>
                                                    <select
                                                      value={ctaChoice}
                                                      onChange={(e) => applyPublicationPreferredCtaPrefill(e.target.value as BoosterPreferredCta)}
                                                      style={darkSelectStyle}
                                                      disabled={detailsActionBusy}
                                                    >
                                                      {BOOSTER_PREFERRED_CTA_OPTIONS.map((option) => (
                                                        <option key={option.value} value={option.value} style={darkOptionStyle}>
                                                          {option.label}
                                                        </option>
                                                      ))}
                                                    </select>
                                                  </div>

                                                  {ctaMode === "website" ? (
                                                    <>
                                                      <div>
                                                        <div className={styles.publicationLabel}>{i18nT("url_de_destination_f11980ae")}</div>
                                                        <input
                                                          value={publicationEditForm.ctaUrl || ""}
                                                          onChange={(e) => updatePublicationEdit({ ctaUrl: e.target.value })}
                                                          style={lightFieldStyle}
                                                          placeholder={
                                                            activeWebsiteUrl
                                                              ? `URL du site préremplie (${activeWebsiteSourceLabel})`
                                                              : websiteChoices.length > 1
                                                                ? "Choisissez Site iNrCy ou Site web"
                                                                : "URL du site (optionnel)"
                                                          }
                                                          disabled={detailsActionBusy}
                                                        />
                                                        {websiteChoices.length ? (
                                                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 7 }}>
                                                            {websiteChoices.map((choice) => (
                                                              <button
                                                                key={choice.label}
                                                                type="button"
                                                                onClick={() => updatePublicationEdit({ ctaUrl: choice.url })}
                                                                disabled={detailsActionBusy}
                                                                style={{
                                                                  border: publicationEditForm.ctaUrl === choice.url
                                                                    ? "1px solid rgba(76,195,255,0.55)"
                                                                    : "1px solid rgba(255,255,255,0.14)",
                                                                  background: publicationEditForm.ctaUrl === choice.url
                                                                    ? "rgba(76,195,255,0.14)"
                                                                    : "rgba(255,255,255,0.06)",
                                                                  color: "rgba(255,255,255,0.86)",
                                                                  borderRadius: 999,
                                                                  padding: "5px 9px",
                                                                  fontSize: 11,
                                                                  fontWeight: 800,
                                                                  cursor: detailsActionBusy ? "not-allowed" : "pointer",
                                                                  opacity: detailsActionBusy ? 0.55 : 1,
                                                                }}
                                                              >
                                                                {choice.label}
                                                              </button>
                                                            ))}
                                                          </div>
                                                        ) : null}
                                                      </div>
                                                      <div>
                                                        <div className={styles.publicationLabel}>{i18nT("texte_du_bouton_5bc213b4")}</div>
                                                        <input
                                                          value={publicationEditForm.cta}
                                                          onChange={(e) => updatePublicationEdit({ cta: e.target.value })}
                                                          style={lightFieldStyle}
                                                          placeholder={i18nT("texte_du_bouton_ex_value_872ff84c", { value0: getChannelDefaultCtaLabel(publicationDisplayKey, "website") || "Voir le site" })}
                                                          disabled={detailsActionBusy}
                                                        />
                                                      </div>
                                                    </>
                                                  ) : null}

                                                  {ctaMode === "call" ? (
                                                    <div>
                                                      <div className={styles.publicationLabel}>{i18nT("telephone_d3b023ea")}</div>
                                                      <input
                                                        value={publicationEditForm.ctaPhone || ""}
                                                        onChange={(e) => updatePublicationEdit({ ctaPhone: e.target.value })}
                                                        style={lightFieldStyle}
                                                        placeholder={
                                                          publicationCtaDefaults?.phone
                                                            ? "Téléphone prérempli depuis Mon profil"
                                                            : "Téléphone (optionnel)"
                                                        }
                                                        disabled={detailsActionBusy}
                                                      />
                                                    </div>
                                                  ) : null}

                                                  {ctaMode === "custom" ? (
                                                    <>
                                                      <div>
                                                        <div className={styles.publicationLabel}>{i18nT("url_de_destination_f11980ae")}</div>
                                                        <input
                                                          value={publicationEditForm.ctaUrl || ""}
                                                          onChange={(e) => updatePublicationEdit({ ctaUrl: e.target.value })}
                                                          style={lightFieldStyle}
                                                          placeholder={i18nT("url_personnalisee_optionnel_49f1857f")}
                                                          disabled={detailsActionBusy}
                                                        />
                                                      </div>
                                                      <div>
                                                        <div className={styles.publicationLabel}>{i18nT("texte_du_bouton_5bc213b4")}</div>
                                                        <input
                                                          value={publicationEditForm.cta}
                                                          onChange={(e) => updatePublicationEdit({ cta: e.target.value })}
                                                          style={lightFieldStyle}
                                                          placeholder={i18nT("ex_en_savoir_plus_8c60a773")}
                                                          disabled={detailsActionBusy}
                                                        />
                                                      </div>
                                                    </>
                                                  ) : null}
                                                </div>
                                                <div style={{ fontSize: 11, marginTop: 6, color: "rgba(255,255,255,0.62)", lineHeight: 1.45 }}>
                                                  {getCtaModeHelp(publicationDisplayKey, ctaMode)}
                                                </div>
                                                {ctaMode === "website" && activeWebsiteUrl ? (
                                                  <div style={{ fontSize: 11, marginTop: 8, color: "rgba(255,255,255,0.62)", lineHeight: 1.45 }}>
                                                    {i18nT("valeur_par_defaut_disponible_depuis_value_f363b12c", { value0: activeWebsiteSourceLabel.toLowerCase(), value1: activeWebsiteUrl })}</div>
                                                ) : ctaMode === "website" && websiteChoices.length > 1 ? (
                                                  <div style={{ fontSize: 11, marginTop: 8, color: "rgba(255,255,255,0.62)", lineHeight: 1.45 }}>
                                                    {i18nT("deux_sites_sont_connectes_choisissez_le_ec7d3ccc")}{" "}</div>
                                                ) : null}
                                                {ctaMode === "call" && publicationCtaDefaults?.phone ? (
                                                  <div style={{ fontSize: 11, marginTop: 8, color: "rgba(255,255,255,0.62)", lineHeight: 1.45 }}>
                                                    {i18nT("valeur_par_defaut_disponible_depuis_mon_38837a44", { value0: publicationCtaDefaults.phone })}</div>
                                                ) : null}
                                                {ctaMode === "website" || ctaMode === "custom" ? (
                                                  <div style={{ fontSize: 11, marginTop: 6, textAlign: "right", color: publicationEditForm.cta.length > CHANNEL_TEXT_GUIDELINES[publicationDisplayKey].cta ? "#ff8f8f" : "rgba(255,255,255,0.62)" }}>
                                                    {i18nT("bouton_value_value_457352e1", { value0: publicationEditForm.cta.length, value1: CHANNEL_TEXT_GUIDELINES[publicationDisplayKey].cta })}</div>
                                                ) : null}
                                              </>
                                            );
                                          })()}
                                        </div>
                                        {activePublicationEntry.key === "instagram" || activePublicationEntry.key === "tiktok" ? (
                                          <div>
                                            <div className={styles.publicationLabel}>{i18nT("hashtags_338da6e1")}</div>
                                            <input
                                              type="text"
                                              value={publicationEditForm.hashtags}
                                              onChange={(e) => updatePublicationEdit({ hashtags: e.target.value })}
                                              className={styles.publicationFieldInput}
                                              placeholder={i18nT("maconnerie_lens_btp_6517298b")}
                                              disabled={detailsActionBusy}
                                            />
                                          </div>
                                        ) : null}
                                      </>
                                    ) : (
                                      <>
                                        {parts.title ? (
                                          <div>
                                            <div className={styles.publicationLabel}>{i18nT("titre_eb97899a")}</div>
                                            {isSitePublication ? (
                                              <div
                                                className={styles.publicationValue}
                                                dangerouslySetInnerHTML={{
                                                  __html: sanitizeHtml(renderBoosterSiteInlineHtml(parts.title)),
                                                }}
                                              />
                                            ) : (
                                              <div className={styles.publicationValue}>{stripSiteTextFormatting(parts.title)}</div>
                                            )}
                                          </div>
                                        ) : null}
                                        {parts.content ? (
                                          <div>
                                            <div className={styles.publicationLabel}>{i18nT("contenu_f3cb82af")}</div>
                                            {activePublicationEntry.key === "inrcy_site" || activePublicationEntry.key === "site_web" ? (
                                              <div
                                                className={styles.publicationPre}
                                                dangerouslySetInnerHTML={{
                                                  __html: sanitizeHtml(renderBoosterSiteContentHtml(parts.content)),
                                                }}
                                              />
                                            ) : (
                                              <pre className={styles.publicationPre}>{stripSiteTextFormatting(parts.content)}</pre>
                                            )}
                                          </div>
                                        ) : null}
                                        {parts.cta ? (
                                          <div>
                                            <div className={styles.publicationLabel}>{i18nT("cta_11441d32")}</div>
                                            <div className={styles.publicationCtaBox}>{stripSiteTextFormatting(parts.cta)}</div>
                                          </div>
                                        ) : null}
                                        {(activePublicationEntry.key === "instagram" || activePublicationEntry.key === "tiktok") && parts.hashtags && parts.hashtags.length ? (
                                          <div>
                                            <div className={styles.publicationLabel}>{i18nT("hashtags_338da6e1")}</div>
                                            <div className={styles.publicationTagRow}>
                                              {parts.hashtags.map((t, idx) => (
                                                <span key={idx} className={styles.publicationTag}>#{t.replace(/^#/, "")}</span>
                                              ))}
                                            </div>
                                          </div>
                                        ) : null}
                                      </>
                                    )}
                                  </div>
                                </article>
                              );
                            })()
                          ) : showFallbackMessage ? (
                            <div className={styles.messageBody}>
                              {detailsItem.detailHtml ? (
                                <div className={styles.messageHtml} dangerouslySetInnerHTML={{ __html: safeDetailHtml }} />
                              ) : (
                                <pre className={styles.messageText}>{detailsItem.detailText || ""}</pre>
                              )}
                            </div>
                          ) : (
                            <div className={styles.emptyDetailText}>{i18nT("aucun_message_disponible_26f34ece")}</div>
                          )}
                        </section>

                        {detailsItem.source === "app_events" && activePublicationEntry && !activePublicationDeleted ? (
                          <>
                            {detailsEditMode && !isVideoPublication ? (
                              <InrcyCameraCaptureModal
                                open={publicationCameraOpen}
                                title={i18nT("appareil_inrcy_7b70f4b8")}
                                onClose={closePublicationCamera}
                                onCapture={async (file) => {
                                  handlePublicationPhoto(file);
                                  restoreDetailsModalScroll();
                                }}
                              />
                            ) : null}

                            {detailsEditMode ? (
                              <>
                                <input
                                  id={publicationEditFileInputId}
                                  type="file"
                                  accept={BOOSTER_IMAGE_ACCEPT}
                                  multiple
                                  className={styles.hiddenFileInput}
                                  onChange={(e) => {
                                    const input = e.currentTarget;
                                    const files = input?.files ?? null;
                                    handlePublicationImageFiles(files);
                                    if (input) input.value = "";
                                  }}
                                />
                                <input
                                  id={publicationVideoInputId}
                                  type="file"
                                  accept={BOOSTER_VIDEO_ACCEPT}
                                  className={styles.hiddenFileInput}
                                  onChange={(e) => {
                                    const input = e.currentTarget;
                                    const files = input?.files ?? null;
                                    handlePublicationVideoFiles(files);
                                    if (input) input.value = "";
                                  }}
                                />
                                <MediaOptimizerModal
                                  open={Boolean(publicationOptimizerRequest)}
                                  sourceFile={
                                    publicationOptimizerRequest?.source.kind === "file"
                                      ? publicationOptimizerRequest.source.file
                                      : null
                                  }
                                  sourceItem={
                                    publicationOptimizerRequest?.source.kind === "library"
                                      ? publicationOptimizerRequest.source.item
                                      : null
                                  }
                                  origin="booster"
                                  onClose={closePublicationOptimizer}
                                  onOptimized={handleOptimizedPublicationMedia}
                                />
                                <MediaLibraryPickerModal
                                  open={publicationMediaLibraryOpen}
                                  title={i18nT("ajouter_depuis_la_mediatheque_d0f700b2")}
                                  subtitle="Sélectionnez une image ou une vidéo pour remplacer le média de cette publication."
                                  accept="all"
                                  multiple
                                  maxSelection={5}
                                  maxImageBytes={BOOSTER_MAX_IMAGE_BYTES}
                                  maxVideoBytes={BOOSTER_MAX_VIDEO_BYTES}
                                  confirmLabel={i18nT("utiliser_la_selection_a62d5ca0")}
                                  selectedHint={i18nT("choisissez_jusqu_a_5_images_ou_e00ddfb0")}
                                  onOpenOptimizer={openPublicationOptimizerForLibraryItem}
                                  onOversizedMedia={openPublicationOptimizerForLibraryItem}
                                  onClose={closePublicationMediaLibrary}
                                  onConfirm={async (items) => {
                                    if (items.length) markPublicationEditDirty();
                                    await addPublicationMediaLibraryItems(items);
                                    restoreDetailsModalScroll();
                                  }}
                                />
                              </>
                            ) : null}

                            {(detailsEditMode ? (activePublicationEditVideo?.removed ? false : Boolean(activePublicationEditVideo?.previewUrl) || isVideoPublication) : isVideoPublication) ? (
                              <section
                                className={styles.detailSectionCard}
                                style={{
                                  background: "#111827",
                                  border: "1px solid rgba(255,255,255,0.10)",
                                }}
                              >
                                <div className={styles.detailSectionHeader}>
                                  <div>
                                    <div className={styles.messageHeaderTitle}>{i18nT("media_de_la_publication_82477994")}</div>
                                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.66)", marginTop: 4 }}>
                                      {detailsEditMode
                                        ? i18nT("modifiez_la_video_son_format_et_ddd363e8")
                                        : i18nT("media_source_original_conserve_pour_value_19606662", { value0: activePublicationEntry.label || formatChannelLabel(activePublicationEntry.key) })}
                                    </div>
                                  </div>
                                </div>

                                <div style={{ display: "grid", gap: 12 }}>
                                  {detailsEditMode ? (
                                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                                      <label htmlFor={publicationEditFileInputId} className={styles.btnAttach}>
                                        {i18nT("ajouter_des_images_e2d04cfb")}{" "}</label>
                                      <button
                                        type="button"
                                        className={styles.btnAttach}
                                        onClick={() => document.getElementById(publicationVideoInputId)?.click()}
                                      >
                                        {i18nT("ajouter_remplacer_la_video_a495d0ec")}{" "}</button>
                                      <button
                                        type="button"
                                        className={styles.btnAttach}
                                        onClick={openPublicationMediaLibrary}
                                      >
                                        {i18nT("mediatheque_43cc8dff")}{" "}</button>
                                      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.65)" }}>
                                        {i18nT("1_video_maximum_pour_ea9b1d35")}{" "}{activePublicationEntry?.label || i18nT("ce_canal_37404023")}.
                                      </span>
                                    </div>
                                  ) : null}

                                  <BoosterVideoFormatManager
                                    isMobile={isMobileViewport}
                                    channel={(activePublicationEntry.key as ChannelKey)}
                                    videoName={detailsEditMode ? (activePublicationEditVideo?.name || activeVideoDisplayAttachment?.name) : activeVideoDisplayAttachment?.name}
                                    videoDisplayUrl={detailsEditMode ? (activePublicationEditVideo?.previewUrl || "") : (activeVideoDisplayAttachment?.url || "")}
                                    videoSize={detailsEditMode ? (activePublicationEditVideo?.size || activeVideoDisplayAttachment?.size || 0) : (activeVideoDisplayAttachment?.size || 0)}
                                    videoDurationSeconds={detailsEditMode ? (activePublicationEditVideo?.duration || activeVideoDisplayAttachment?.duration || null) : (activeVideoDisplayAttachment?.duration || null)}
                                    videoSourceMetadata={detailsEditMode ? (activePublicationEditVideo?.sourceMetadata || null) : null}
                                    currentFormat={(detailsEditMode ? (activePublicationEditVideo?.format || activeVideoSettings?.format || "original") : (activeVideoSettings?.format || "original")) as VideoFormat}
                                    adaptationMode={(detailsEditMode ? (activePublicationEditVideo?.adaptationMode || activeVideoSettings?.adaptationMode || "safe_frame") : (activeVideoSettings?.adaptationMode || "safe_frame")) as VideoAdaptationMode}
                                    videoTransformedVariants={[]}
                                    preparationState={detailsEditMode ? (activePublicationEditVideo?.preparation || null) : null}
                                    preparing={detailsEditMode ? Boolean(activePublicationEditVideo?.preparing) : false}
                                    onFormatChange={detailsEditMode ? (format) => { markPublicationEditDirty(); setPublicationVideoFormatForChannel(activePublicationEntry.key, format); } : undefined}
                                    onAdaptationModeChange={detailsEditMode ? (mode) => { markPublicationEditDirty(); setPublicationVideoAdaptationModeForChannel(activePublicationEntry.key, mode); } : undefined}
                                    onApplyFormat={detailsEditMode ? async () => { markPublicationEditDirty(); await applyPublicationVideoFormatForChannel(activePublicationEntry.key); } : undefined}
                                    onDeleteVideo={detailsEditMode ? () => { markPublicationEditDirty(); removePublicationVideo(activePublicationEntry.key); } : undefined}
                                    deleteVideoLabel={i18nT("retirer_la_video_de_ce_canal_bd7a54fa")}
                                    onPickVideoClick={detailsEditMode ? () => document.getElementById(publicationVideoInputId)?.click() : undefined}
                                    showApplyAll={false}
                                    buttonClassName={styles.btnGhost}
                                    compact={detailsEditMode}
                                  />

                                  {activeVideoDisplayAttachment?.url && !detailsEditMode ? (
                                    <a className={styles.attachmentDownloadHint} href={activeVideoDisplayAttachment.url} target="_blank" rel="noreferrer" style={{ justifySelf: "start" }}>
                                      {i18nT("telecharger_b332d06d")}{" "}</a>
                                  ) : null}

                                  {detailsEditMode && (!activePublicationEditVideo || activePublicationEditVideo.removed || !activePublicationEditVideo.previewUrl) ? (
                                    <div style={{ borderRadius: 14, padding: "10px 12px", border: "1px solid rgba(251,191,36,0.25)", background: "rgba(251,191,36,0.10)", color: "#fde68a", fontSize: 12, lineHeight: 1.45, fontWeight: 750 }}>
                                      {i18nT("ajoutez_une_nouvelle_video_avant_d_803819f5")}{" "}</div>
                                  ) : null}

                                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", lineHeight: 1.45 }}>
                                    {detailsEditMode
                                      ? i18nT("enregistrez_ensuite_pour_republier_ce_canal_3e44a8ca")
                                      : i18nT("ce_detail_affiche_l_original_reutilisable_5ffe24c1")}
                                  </div>
                                </div>
                              </section>
                            ) : detailsEditMode ? (
                              <section className={styles.detailSectionCard}>
                                <div className={styles.detailSectionHeader}>
                                  <div className={styles.messageHeaderTitle}>{i18nT("images_de_la_publication_85bb3522")}</div>
                                </div>
                                <div style={{ display: "grid", gap: 12 }}>
                                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                                  <label htmlFor={publicationEditFileInputId} className={styles.btnAttach}>{i18nT("ajouter_des_images_e2d04cfb")}</label>
                                  <button
                                    type="button"
                                    className={styles.btnAttach}
                                    onClick={() => document.getElementById(publicationVideoInputId)?.click()}
                                  >
                                    {i18nT("ajouter_une_video_47903bae")}{" "}</button>
                                  <button
                                    type="button"
                                    className={styles.btnAttach}
                                    onClick={openPublicationMediaLibrary}
                                  >
                                    {i18nT("mediatheque_43cc8dff")}{" "}</button>
                                  <span
                                    title={
                                      isMobileViewport
                                        ? activePublicationEditAssets.length >= 5
                                          ? "5 images maximum"
                                          : "Prendre une photo dans iNrCy"
                                        : "Utilisable en version mobile"
                                    }
                                    style={{ display: "inline-flex" }}
                                  >
                                    <button
                                      type="button"
                                      className={styles.btnAttach}
                                      onClick={isMobileViewport ? openPublicationCamera : undefined}
                                      disabled={!isMobileViewport || activePublicationEditAssets.length >= 5}
                                      aria-disabled={!isMobileViewport || activePublicationEditAssets.length >= 5}
                                      style={{
                                        opacity: !isMobileViewport || activePublicationEditAssets.length >= 5 ? 0.55 : 1,
                                        filter: !isMobileViewport || activePublicationEditAssets.length >= 5 ? "grayscale(1)" : undefined,
                                        cursor: !isMobileViewport || activePublicationEditAssets.length >= 5 ? "not-allowed" : "pointer",
                                      }}
                                    >
                                      {i18nT("appareil_inrcy_89d04cc9")}{" "}</button>
                                  </span>
                                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.65)" }}>
                                    {activePublicationEditAssets.length} {" "}{i18nT("image_s_pour_a20546c7")}{" "}{activePublicationEntry?.label || i18nT("ce_canal_37404023")}
                                  </span>
                                </div>

                                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>
                                  {i18nT("inrcy_prepare_automatiquement_le_rendu_du_1f7b0de6")}{" "}</div>

                                <ChannelImageAdapterCardsPanel
                                  tabs={[{ key: activePublicationEditChannelKey, label: activePublicationEntry?.label || formatChannelLabel(activePublicationEditChannelKey) }]}
                                  activeChannel={activePublicationEditChannelKey}
                                  onActiveChannelChange={() => {}}
                                  channelTitle={activePublicationEntry?.label || formatChannelLabel(activePublicationEditChannelKey)}
                                  formatLabel={activePublicationEditChannelKey === "inrcy_site" || activePublicationEditChannelKey === "site_web" ? "Rendu site / iframe" : `Rendu final : ${activePublicationEditPreset.width}×${activePublicationEditPreset.height}`}
                                  aspectRatio={`${activePublicationEditPreset.width} / ${activePublicationEditPreset.height}`}
                                  items={activePublicationEditAssets.map((asset, index) => {
                                    const selectedAssets = activePublicationEditAssets.filter((candidate) => candidate.selected);
                                    const selectedIndex = selectedAssets.findIndex((candidate) => candidate.key === asset.key);
                                    const isSingleImageChannel = activePublicationEditChannelKey === "pinterest";
                                    const disabledBySingleImageLimit = isSingleImageChannel && selectedAssets.length >= 1 && !asset.selected;
                                    return {
                                      key: asset.key,
                                      previewUrl: asset.previewUrl,
                                      included: asset.selected,
                                      disabled: disabledBySingleImageLimit,
                                      title: i18nT("image_value_5907a7ef", { value0: index + 1 }),
                                      subtitle: disabledBySingleImageLimit
                                        ? "Une seule image par épingle Pinterest"
                                        : asset.selected
                                          ? "Publiée sur ce canal"
                                          : "Non publiée sur ce canal",
                                      fitLabel:
                                        asset.originalUrl &&
                                        asset.savedTransform &&
                                        arePublicationTransformsEquivalent(asset.transform, asset.savedTransform)
                                          ? "Originale"
                                          : "Personnalisée",
                                      backgroundMode: getPublicationBackgroundMode(asset.transform),
                                      backgroundColor: asset.transform.backgroundColor,
                                      transform: asset.transform,
                                      preset: activePublicationEditPreset,
                                      onToggle: () => { markPublicationEditDirty(); togglePublicationImage(activePublicationEditChannelKey, asset.key); },
                                      onAdapt: () => openPublicationImageAdapter(activePublicationEditChannelKey, asset.key),
                                      onReset: resetPublicationImage ? () => { markPublicationEditDirty(); resetPublicationImage(activePublicationEditChannelKey, asset.key); } : undefined,
                                      onRemove: asset.selected ? () => { markPublicationEditDirty(); togglePublicationImage(activePublicationEditChannelKey, asset.key); } : undefined,
                                      removeLabel: i18nT("retirer_de_ce_canal_76fbf864"),
                                      onMovePrevious: movePublicationImage && asset.selected && selectedIndex > 0 ? () => { markPublicationEditDirty(); movePublicationImage(activePublicationEditChannelKey, asset.key, -1); } : undefined,
                                      onMoveNext: movePublicationImage && asset.selected && selectedIndex >= 0 && selectedIndex < selectedAssets.length - 1 ? () => { markPublicationEditDirty(); movePublicationImage(activePublicationEditChannelKey, asset.key, 1); } : undefined,
                                    };
                                  })}
                                  buttonClassName={styles.btnGhost}
                                  pillButtonStyle={pillBtn}
                                  pillButtonActiveStyle={pillBtnActive}
                                  showTabs={false}
                                  emptyMessage={i18nT("aucune_image_pour_ce_canal_fea641ed")}
                                />
                                </div>
                              </section>
                            ) : null}

                            <section className={styles.detailSectionCard}>
                              <div className={styles.detailSectionHeader}>
                                <div>
                                  <div className={styles.messageHeaderTitle}>{i18nT("apercu_f0f53004")}</div>
                                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.62)", marginTop: 4 }}>
                                    {i18nT("apercu_du_canal_selectionne_a4ff0959")}{" "}{activePublicationEntry?.label || formatChannelLabel(activePublicationEntry?.key || activePublicationEditChannelKey)}.
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  className={styles.btnGhost}
                                  onClick={() => setPublicationPreviewOpen((value) => !value)}
                                >
                                  {publicationPreviewOpen ? i18nT("masquer_l_apercu_20561222") : i18nT("afficher_l_apercu_4ecc7839")}
                                </button>
                              </div>

                              {publicationPreviewOpen && publicationPreviewData ? (
                                <ChannelPublicationPreview preview={publicationPreviewData} />
                              ) : (
                                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.62)" }}>
                                  {publicationPreviewData ? i18nT("l_apercu_est_masque_par_defaut_248f2a7d") : i18nT("aucun_apercu_disponible_pour_ce_canal_5671f79a")}
                                </div>
                              )}
                            </section>
                          </>
                        ) : null}

                        {detailsItem.source === "mail_campaigns" ? (
                          <section className={styles.detailSectionCard}>
                            <div className={styles.detailSectionHeader}>
                              <div className={styles.messageHeaderTitle}>{i18nT("suivi_destinataires_3d5a441c")}</div>
                            </div>
                            {campaignReport ? (
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 14 }}>
                                {[
                                  { label: i18nT("acceptes_par_le_provider_59d7f357"), value: campaignReport.counts.accepted },
                                  { label: i18nT("livraisons_confirmees_b02398dd"), value: campaignReport.counts.delivered },
                                  { label: i18nT("rebonds_durs_28d50de6"), value: campaignReport.counts.hardBounce },
                                  { label: i18nT("rebonds_temporaires_208fe5f3"), value: campaignReport.counts.softBounce },
                                ].map((stat) => (
                                  <div
                                    key={stat.label}
                                    style={{ padding: "12px 14px", borderRadius: 14, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.10)" }}
                                  >
                                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.68)", marginBottom: 4 }}>{stat.label}</div>
                                    <div style={{ fontSize: 22, fontWeight: 700 }}>{stat.value}</div>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 14 }}>
                              {[
                                { key: "sent", label: i18nT("acceptes_par_le_provider_59d7f357"), value: campaignHealth?.sent ?? campaignCounts((detailsItem as any).raw || {}).sent },
                                { key: "queued", label: i18nT("en_attente_5231158f"), value: campaignHealth?.queued ?? campaignCounts((detailsItem as any).raw || {}).queued },
                                { key: "processing", label: i18nT("en_cours_bc9b533a"), value: campaignHealth?.processing ?? campaignCounts((detailsItem as any).raw || {}).processing },
                                { key: "failed", label: i18nT("echecs_0cb65dc8"), value: campaignHealth?.failed ?? campaignCounts((detailsItem as any).raw || {}).failed },
                                { key: "blocked", label: i18nT("bloques_4881b34c"), value: campaignHealth?.blocked ?? 0 },
                                { key: "opt_out", label: i18nT("desinscrits_5c693986"), value: campaignHealth?.opt_out ?? 0 },
                                { key: "blacklist", label: i18nT("blacklist_7b2dd04c"), value: campaignHealth?.blacklist ?? 0 },
                              ].map((stat) => {
                                const isActive = campaignRecipientsFilter === stat.key;
                                return (
                                  <button
                                    key={stat.key}
                                    type="button"
                                    className={styles.btnGhost}
                                    onClick={() => {
                                      setCampaignRecipientsPage(1);
                                      setCampaignRecipientsFilter((prev) => (prev === stat.key ? "all" : (stat.key as CampaignRecipientsFilterId)));
                                    }}
                                    style={{
                                      textAlign: "left",
                                      padding: "12px 14px",
                                      borderRadius: 14,
                                      background: isActive ? "rgba(76,195,255,0.12)" : "rgba(255,255,255,0.03)",
                                      border: isActive ? "1px solid rgba(76,195,255,0.35)" : "1px solid rgba(255,255,255,0.10)",
                                    }}
                                  >
                                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.68)", marginBottom: 4 }}>{stat.label}</div>
                                    <div style={{ fontSize: 22, fontWeight: 700 }}>{stat.value}</div>
                                  </button>
                                );
                              })}
                            </div>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                              {([
                                { key: "all", label: i18nT("tous_b97ae3b4"), value: campaignHealth?.total ?? Number((detailsItem as any).raw?.total_count || 0) },
                                { key: "sent", label: i18nT("envoyes_4130f1ea"), value: campaignHealth?.sent ?? campaignCounts((detailsItem as any).raw || {}).sent },
                                { key: "queued", label: i18nT("en_attente_5231158f"), value: campaignHealth?.queued ?? campaignCounts((detailsItem as any).raw || {}).queued },
                                { key: "processing", label: i18nT("en_cours_bc9b533a"), value: campaignHealth?.processing ?? campaignCounts((detailsItem as any).raw || {}).processing },
                                { key: "failed", label: i18nT("echecs_0cb65dc8"), value: campaignHealth?.failed ?? campaignCounts((detailsItem as any).raw || {}).failed },
                                { key: "blocked", label: i18nT("bloques_4881b34c"), value: campaignHealth?.blocked ?? 0 },
                                { key: "opt_out", label: i18nT("desinscrits_5c693986"), value: campaignHealth?.opt_out ?? 0 },
                                { key: "blacklist", label: i18nT("blacklist_7b2dd04c"), value: campaignHealth?.blacklist ?? 0 },
                              ] as Array<{ key: CampaignRecipientsFilterId | "all"; label: string; value: number }>).map((chip) => {
                                const active = campaignRecipientsFilter === chip.key;
                                return (
                                  <button
                                    key={chip.key}
                                    type="button"
                                    className={styles.btnGhost}
                                    onClick={() => {
                                      setCampaignRecipientsPage(1);
                                      setCampaignRecipientsFilter(chip.key as CampaignRecipientsFilterId);
                                    }}
                                    style={{
                                      ...(active ? pillBtnActive : {}),
                                      minHeight: 34,
                                      padding: "0 12px",
                                      borderRadius: 999,
                                      background: active ? "rgba(76,195,255,0.10)" : "rgba(255,255,255,0.03)",
                                    }}
                                  >
                                    {chip.label} • {chip.value}
                                  </button>
                                );
                              })}
                            </div>
                            <div style={{ color: "rgba(255,255,255,0.68)", fontSize: 12, marginBottom: 12 }}>
                              {campaignHealthLoading ? i18nT("actualisation_des_statuts_campagne_1a30101c") : i18nT("filtre_actif_value_9a9ded06", { value0: localizedCampaignFilter(campaignRecipientsFilter, runtimeT) })}
                              {campaignHealth && campaignHealth.retryable > 0 ? i18nT("relancables_value_fd2a0195", { value0: campaignHealth.retryable }) : ""}
                            </div>
                            {campaignRecipientsLoading ? (
                              <div style={{ color: "rgba(255,255,255,0.68)" }}>{i18nT("chargement_des_destinataires_bd59ba00")}</div>
                            ) : campaignRecipients.length === 0 ? (
                              <div style={{ color: "rgba(255,255,255,0.68)" }}>{i18nT("aucun_destinataire_charge_c80ee554")}</div>
                            ) : (
                              <>
                                <div className={styles.attachmentsList}>
                                {campaignRecipients.map((recipient) => {
                                  const attemptLabel = recipient.attempt_count != null && recipient.max_attempts != null
                                    ? i18nT("campaign_attempt_count", { current: recipient.attempt_count, total: recipient.max_attempts })
                                    : null;
                                  const statusLabel = localizedRecipientStatus(recipient, locale, runtimeT);
                                  return (
                                    <div key={recipient.id} className={styles.attachmentItem}>
                                      <span className={styles.attachmentName}>{recipient.display_name ? `${recipient.display_name} — ${recipient.email}` : recipient.email}</span>
                                      <span className={styles.attachmentMeta}>{statusLabel}</span>
                                      {attemptLabel ? <span className={styles.attachmentMeta}>{attemptLabel}</span> : null}
                                      {recipient.last_error || recipient.error ? (
                                        <span className={styles.attachmentMeta} style={{ color: "#ffb0b0" }}>{i18nT("mail_action_failed")}</span>
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </div>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
                                <div style={{ color: "rgba(255,255,255,0.68)", fontSize: 12 }}>
                                  {campaignRecipientsTotal > 0
                                    ? i18nT("affichage_value_value_sur_value_value_25fe612c", { value0: (campaignRecipientsPage - 1) * MAILBOX_RECIPIENTS_PAGE_SIZE + 1, value1: Math.min(campaignRecipientsPage * MAILBOX_RECIPIENTS_PAGE_SIZE, campaignRecipientsTotal), value2: campaignRecipientsTotal, value3: localizedCampaignFilter(campaignRecipientsFilter, runtimeT).toLocaleLowerCase(locale) })
                                    : i18nT("aucun_destinataire_value_c7e8914d", { value0: localizedCampaignFilter(campaignRecipientsFilter, runtimeT).toLocaleLowerCase(locale) })}
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                                  <button
                                    type="button"
                                    className={styles.btnGhost}
                                    onClick={() => setCampaignRecipientsPage((prev) => Math.max(1, prev - 1))}
                                    disabled={campaignRecipientsPage <= 1 || campaignRecipientsLoading}
                                  >
                                    {i18nT("precedent_3ec988c1")}{" "}</button>
                                  <div style={{ color: "rgba(255,255,255,0.82)", fontSize: 12 }}>
                                    {i18nT("page_value_value_e9b2eea1", { value0: campaignRecipientsPage, value1: campaignRecipientsPageCount })}</div>
                                  <button
                                    type="button"
                                    className={styles.btnGhost}
                                    onClick={() => setCampaignRecipientsPage((prev) => Math.min(campaignRecipientsPageCount, prev + 1))}
                                    disabled={campaignRecipientsPage >= campaignRecipientsPageCount || campaignRecipientsLoading}
                                  >
                                    {i18nT("suivant_ea96c11e")}{" "}</button>
                                </div>
                                </div>
                              </>
                            )}
                          </section>
                        ) : null}

                        {(imageAttachments.length > 0 || fileAttachments.length > 0 || (videoAttachments.length > 0 && !(detailsItem.source === "app_events" && isVideoPublication))) && !(detailsItem.source === "app_events" && detailsEditMode) ? (
                          <section className={styles.detailSectionCard}>
                            <div className={styles.detailSectionHeader}>
                              <div className={styles.messageHeaderTitle}>
                                {detailsItem.source === "app_events" ? i18nT("images_de_la_publication_85bb3522") : i18nT("documents_envoyes_37df8416")}
                              </div>
                            </div>

                            <div className={styles.attachmentsPanel}>
                              {imageAttachments.length ? (
                                <div className={styles.attachmentGallery}>
                                  {imageAttachments.map((a, idx) => (
                                    <a
                                      key={`${a.url || a.name}-${idx}`}
                                      className={styles.attachmentPreviewCard}
                                      href={a.url || undefined}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      <img src={a.url || ""} alt={a.name || `Pièce jointe ${idx + 1}`} className={styles.attachmentPreviewImage} />
                                      <div className={styles.attachmentPreviewCaption}>{a.name}</div>
                                      {a.url ? <span className={styles.attachmentDownloadHint}>{i18nT("telecharger_b332d06d")}</span> : null}
                                    </a>
                                  ))}
                                </div>
                              ) : null}

                              {videoAttachments.length && !(detailsItem.source === "app_events" && isVideoPublication) ? (
                                <div className={styles.attachmentGallery}>
                                  {videoAttachments.map((a, idx) => (
                                    <div key={`${a.url || a.name}-${idx}`} className={styles.attachmentPreviewCard}>
                                      <video
                                        src={a.url || ""}
                                        className={styles.attachmentPreviewImage}
                                        controls
                                        preload="metadata"
                                      />
                                      <div className={styles.attachmentPreviewCaption}>{a.name}</div>
                                      {a.url ? (
                                        <a className={styles.attachmentDownloadHint} href={a.url} target="_blank" rel="noreferrer">
                                          {i18nT("telecharger_b332d06d")}{" "}</a>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                              ) : null}

                              {fileAttachments.length ? (
                                <div className={styles.attachmentsList}>
                                  {fileAttachments.map((a, idx) => (
                                    <div key={`${a.url || a.name}-${idx}`} className={styles.attachmentItem}>
                                      <span className={styles.attachmentName}>{a.name}</span>
                                      {a.type ? <span className={styles.attachmentMeta}>{a.type}</span> : null}
                                      {typeof a.size === "number" ? <span className={styles.attachmentMeta}>{i18nT("value_ko_07f2c21f", { value0: Math.round(a.size / 1024) })}</span> : null}
                                      {a.downloadUrl || a.url ? (
                                        <a className={styles.attachmentLink} href={a.downloadUrl || a.url || "#"} target="_blank" rel="noreferrer">
                                          {i18nT("telecharger_b332d06d")}{" "}</a>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          </section>
                        ) : null}
                      </div>

                      {isDraftItem ? (
                        <div style={{ marginTop: 14, color: "rgba(255,255,255,0.62)", fontSize: 12 }}>
                          {i18nT("astuce_utilisez_reprendre_l_edition_pour_1731718c")}{" "}</div>
                      ) : null}
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
  );
}
