import type { Dispatch, SetStateAction } from "react";
import type { MediaLibraryPickerItem } from "@/app/dashboard/_components/MediaLibraryPickerModal";
import type { BoosterVideoPreparationState } from "@/app/dashboard/booster/publier/components/BoosterVideoFormatManager";
import type { VideoAdaptationMode, VideoFormat } from "@/app/dashboard/booster/publier/publishModal.shared";
import { getUserFacingMailError } from "@/lib/mailDeliveryErrors";
import {
  ensureFrenchPublicationErrorMessage,
  getFrenchPublicationErrorMessage,
  getProviderPublicationErrorMessage,
} from "@/lib/publicationErrorFrench";
import {
  formatCampaignProgress,
  type CampaignExperienceReport,
  type CampaignRecipientsFilterId,
  type PublicationEditForm,
} from "./mailboxPhase1";

export function formatCampaignProgressFromHealth(raw: any, health: any | null, locale = "fr-FR") {
  if (!health || typeof health !== "object") return formatCampaignProgress(raw || {}, locale);

  const total = Math.max(0, Number(health.total ?? raw?.total_count ?? 0) || 0);
  const sent = Math.max(0, Number(health.sent ?? raw?.sent_count ?? 0) || 0);
  const processing = Math.max(0, Number(health.processing ?? raw?.processing_count ?? 0) || 0);
  const queued = Math.max(0, Number(health.queued ?? raw?.queued_count ?? 0) || 0);
  const failed = Math.max(0, Number(health.failed ?? raw?.failed_count ?? 0) || 0);

  const formatNumber = new Intl.NumberFormat(locale).format;
  const bits = [`${formatNumber(sent)}/${formatNumber(total || sent)} acceptés`];
  if (processing > 0) bits.push(`${formatNumber(processing)} en cours`);
  if (queued > 0) bits.push(`${formatNumber(queued)} en attente`);
  if (failed > 0) bits.push(`${formatNumber(failed)} en échec`);
  return bits.join(" • ");
}

export function isCampaignFinishedStatus(statusValue: unknown) {
  return ["completed", "partial", "failed", "sent"].includes(
    String(statusValue || "").toLowerCase(),
  );
}

export function campaignStatusLabel(statusValue: unknown) {
  const status = String(statusValue || "").toLowerCase();
  if (status === "queued") return "En attente de distribution";
  if (status === "processing") return "Distribution en cours";
  if (status === "paused") return "Campagne en pause";
  if (status === "partial") return "Terminée avec des erreurs";
  if (status === "failed") return "Campagne en échec";
  if (status === "completed" || status === "sent") return "Campagne terminée";
  return "Suivi de campagne";
}

export function completionEmailLabel(statusValue: unknown) {
  const status = String(statusValue || "pending").toLowerCase();
  if (status === "sent") return "Bilan envoyé";
  if (status === "sending") return "Envoi du bilan en cours";
  if (status === "failed") return "Bilan non envoyé";
  if (status === "skipped") return "Bilan non configuré";
  return "Bilan en attente";
}

export type PublicationEditVideoState = {
  file: File | null;
  previewUrl: string;
  name: string;
  type: string;
  size: number;
  duration: number | null;
  sourceMetadata: any | null;
  sourceVideo: any | null;
  transformedVariants: any[];
  format: VideoFormat;
  adaptationMode: VideoAdaptationMode;
  preparation?: BoosterVideoPreparationState | null;
  preparing?: boolean;
  removed?: boolean;
};

export type MailboxDetailsModalProps = {
  open: boolean;
  onClose: () => void;
  detailsItem: any | null;
  detailsAccountLabel: string | null;
  detailsChannelKey: string | null;
  setDetailsChannelKey: Dispatch<SetStateAction<string | null>>;
  detailsEditMode: boolean;
  setDetailsEditMode: Dispatch<SetStateAction<boolean>>;
  detailsActionBusy: boolean;
  detailsActionError: string | null;
  detailsActionSuccess: string | null;
  setDetailsActionError: Dispatch<SetStateAction<string | null>>;
  setDetailsActionSuccess: Dispatch<SetStateAction<string | null>>;
  detailsSourceDocPayload: any | null;
  canNavigatePrevious: boolean;
  canNavigateNext: boolean;
  navigationLabel: string;
  navigationBusy: boolean;
  onNavigate: (direction: -1 | 1) => Promise<void> | void;
  campaignRecipients: any[];
  campaignRecipientsLoading: boolean;
  campaignRecipientsPage: number;
  setCampaignRecipientsPage: Dispatch<SetStateAction<number>>;
  campaignRecipientsPageCount: number;
  campaignRecipientsTotal: number;
  campaignRecipientsFilter: CampaignRecipientsFilterId;
  setCampaignRecipientsFilter: Dispatch<SetStateAction<CampaignRecipientsFilterId>>;
  campaignHealth: any | null;
  campaignHealthLoading: boolean;
  campaignReport: CampaignExperienceReport | null;
  campaignSummaryBusyId: string | null;
  campaignActionBusyId: string | null;
  publicationEditForm: PublicationEditForm;
  setPublicationEditForm: Dispatch<SetStateAction<PublicationEditForm>>;
  publicationEditFileInputId: string;
  activePublicationEditChannelKey: string;
  activePublicationEditPreset: any;
  activePublicationEditAssets: any[];
  togglePublicationImage: (channel: string, imageKey: string) => void;
  openPublicationImageAdapter: (channel: string, imageKey: string) => void;
  resetPublicationImage?: (channel: string, imageKey: string) => void;
  movePublicationImage?: (channel: string, imageKey: string, direction: -1 | 1) => void;
  addPublicationFiles: (fileList: FileList | File[] | null) => void;
  addPublicationPhoto: (file: File) => void;
  addPublicationMediaLibraryItems: (items: MediaLibraryPickerItem[]) => void | Promise<void>;
  replacePublicationMediaLibraryItem: (item: MediaLibraryPickerItem) => Promise<void>;
  publicationVideoInputId: string;
  activePublicationEditVideo: PublicationEditVideoState | null;
  addPublicationVideo: (fileList: FileList | File[] | null) => void;
  removePublicationVideo: (channel?: string) => void;
  setPublicationVideoFormatForChannel: (channel: string, format: VideoFormat) => void;
  setPublicationVideoAdaptationModeForChannel: (channel: string, mode: VideoAdaptationMode) => void;
  applyPublicationVideoFormatForChannel: (channel: string) => Promise<void>;
  saveChannelPublication: () => Promise<void>;
  deleteChannelPublication: () => Promise<{ payload: any; channel: string } | null>;
  retryCampaignFailedRecipients: (campaignId: string) => Promise<void>;
  resendCampaignCompletionSummary: (campaignId: string) => Promise<void>;
  openCampaignComposeFromHistory: (item: any, mode: "reuse" | "resend") => Promise<void>;
  loadCampaignRecipients: (campaignId: string, targetPage?: number, targetFilter?: CampaignRecipientsFilterId) => Promise<void>;
  loadCampaignHealth: (campaignId: string, raw?: any) => Promise<void>;
  refreshHistory?: () => Promise<unknown>;
  resumeDraft: (item: any) => void;
};

export function formatVideoBytes(value: unknown) {
  const bytes = typeof value === "number" ? value : Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} Mo`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${Math.round(bytes)} o`;
}

export function formatVideoDuration(value: unknown) {
  const seconds = typeof value === "number" ? value : Number(value || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.round(seconds);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

export function getVideoAttachmentUrl(att: any) {
  return String(att?.url || att?.publicUrl || att?.renderedUrl || att?.downloadUrl || "").trim();
}

export function sameVideoAttachment(a: any, b: any) {
  const au = getVideoAttachmentUrl(a);
  const bu = getVideoAttachmentUrl(b);
  if (au && bu) return au === bu;
  const ap = String(a?.storagePath || "").trim();
  const bp = String(b?.storagePath || "").trim();
  return Boolean(ap && bp && ap === bp);
}

export function getVideoFileLabel(att: any) {
  const pieces = [
    att?.name ? String(att.name) : null,
    formatVideoBytes(att?.size),
    formatVideoDuration(att?.duration),
  ].filter(Boolean);
  return pieces.join(" · ") || "Vidéo iNrCy";
}

export function firstStringDeep(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function getNestedString(record: any, path: string[]) {
  let current = record;
  for (const key of path) {
    if (!current || typeof current !== "object") return "";
    current = current[key];
  }
  return typeof current === "string" ? current.trim() : "";
}

export function formatVisibleMailError(value: unknown, provider?: unknown) {
  const raw = typeof value === "string" ? value.trim() : String(value || "").trim();
  if (!raw) return "";
  return getUserFacingMailError(raw, typeof provider === "string" ? provider : undefined);
}

export function getTiktokPublicationUrl(result: any) {
  const direct = firstStringDeep(
    result?.external_url,
    result?.share_url,
    result?.post_url,
    result?.video_url,
    result?.profile_url,
    getNestedString(result, ["diagnostics", "share_url"]),
    getNestedString(result, ["diagnostics", "status", "shareUrl"]),
    getNestedString(result, ["diagnostics", "status", "raw", "data", "share_url"]),
    getNestedString(result, ["diagnostics", "raw", "data", "share_url"]),
  );
  if (direct) return direct;

  const username = firstStringDeep(result?.username, getNestedString(result, ["diagnostics", "creatorInfo", "creator_username"]));
  const cleanUsername = username.replace(/^@+/, "").trim();
  return cleanUsername ? `https://www.tiktok.com/@${cleanUsername}` : "https://www.tiktok.com";
}

export function getTiktokPublishId(result: any) {
  return firstStringDeep(
    result?.external_id,
    result?.publish_id,
    getNestedString(result, ["diagnostics", "publish_id"]),
    getNestedString(result, ["diagnostics", "raw", "data", "publish_id"]),
    getNestedString(result, ["diagnostics", "raw", "init", "data", "publish_id"]),
  );
}

export function getTiktokStatusMeta(result: any) {
  const status = firstStringDeep(
    result?.tiktok_status,
    result?.status,
    getNestedString(result, ["diagnostics", "status", "status"]),
    getNestedString(result, ["diagnostics", "status", "raw", "data", "status"]),
  ).toUpperCase();
  const cancelled = Boolean(
    result?.cancelled === true ||
      status === "CANCELLED" ||
      status === "CANCELED",
  );
  const statusFetchFailed = Boolean(
    result?.tiktok_status_fetch_failed ||
      status === "STATUS_FETCH_ERROR" ||
      getNestedString(result, ["diagnostics", "status", "statusFetchFailed"]) === "true",
  );
  const stalled = Boolean(result?.tiktok_stalled || getNestedString(result, ["diagnostics", "stalled"]) === "true");
  const timedOut = status === "PROCESSING_TIMEOUT" || result?.tiktok_timed_out === true;
  const failed = !cancelled && (["FAILED", "PUBLISH_FAILED", "ERROR", "PROCESSING_TIMEOUT"].includes(status) || (result?.ok === false && !statusFetchFailed));
  const complete = !cancelled && ["PUBLISH_COMPLETE", "DONE", "SUCCESS"].includes(status);
  const pending = !cancelled && !failed && !complete && Boolean(statusFetchFailed || result?.warning || status || getTiktokPublishId(result));
  const label = cancelled
    ? "Annulé"
    : timedOut
    ? "Délai dépassé"
    : failed
    ? "Échec"
    : complete
      ? "Publié"
      : statusFetchFailed
        ? "Vérification impossible"
        : stalled
          ? "Traitement prolongé"
          : status === "PROCESSING_UPLOAD"
            ? "Upload TikTok en cours"
            : status === "PROCESSING_DOWNLOAD"
              ? "Téléchargement TikTok en cours"
              : pending
                ? "En traitement"
                : "Statut inconnu";
  const rawFailReason = firstStringDeep(
    result?.tiktok_fail_reason,
    getNestedString(result, ["diagnostics", "status", "failReason"]),
  );
  const failReason = rawFailReason
    ? getProviderPublicationErrorMessage("tiktok", rawFailReason) ||
      ensureFrenchPublicationErrorMessage(
        rawFailReason,
        "TikTok a refusé la publication.",
      )
    : "";
  const rawMessage = firstStringDeep(
    result?.tiktok_status_message,
    result?.error,
    result?.warning_message,
    result?.tiktok_status_fetch_error,
    failReason,
  );
  const message = rawMessage
    ? getFrenchPublicationErrorMessage(
        "tiktok",
        rawMessage,
        "TikTok n'a pas pu finaliser la publication.",
      )
    : "";
  const uploadedBytes = Number(result?.tiktok_uploaded_bytes ?? getNestedString(result, ["diagnostics", "status", "uploadedBytes"]) ?? 0) || 0;
  const downloadedBytes = Number(result?.tiktok_downloaded_bytes ?? getNestedString(result, ["diagnostics", "status", "downloadedBytes"]) ?? 0) || 0;
  const providerErrorCode = firstStringDeep(
    result?.tiktok_provider_error_code,
    getNestedString(result, ["diagnostics", "status", "providerErrorCode"]),
  );
  const checkedAt = firstStringDeep(
    result?.tiktok_status_checked_at,
    getNestedString(result, ["diagnostics", "status_checked_at"]),
  );
  const progressAt = firstStringDeep(
    result?.tiktok_status_progress_at,
    getNestedString(result, ["diagnostics", "status_progress_at"]),
  );
  const submittedAt = firstStringDeep(
    result?.tiktok_submitted_at,
    getNestedString(result, ["diagnostics", "submitted_at"]),
  );
  const checkCount = Number(
    result?.tiktok_status_check_count ??
      getNestedString(result, ["diagnostics", "status_check_count"]) ??
      0,
  ) || 0;
  const processingDurationSeconds = Number(
    result?.tiktok_processing_duration_seconds ??
      getNestedString(result, ["diagnostics", "processing_duration_seconds"]) ??
      0,
  ) || 0;
  return {
    status,
    cancelled,
    failed,
    complete,
    pending,
    label,
    message,
    failReason,
    providerErrorCode,
    statusFetchFailed,
    stalled,
    timedOut,
    uploadedBytes,
    downloadedBytes,
    checkedAt,
    progressAt,
    submittedAt,
    checkCount,
    processingDurationSeconds,
  };
}

export function getTiktokAutoPollTarget(detailsItem: any) {
  if (!detailsItem || detailsItem.source !== "app_events") return null;
  const payload = detailsItem?.raw?.payload;
  if (!payload || typeof payload !== "object") return null;
  const publicationId = String(payload?.publication_id || "").trim();
  const result = payload?.results && typeof payload.results === "object" ? payload.results.tiktok : null;
  const publishId = getTiktokPublishId(result);
  const statusMeta = getTiktokStatusMeta(result);
  if (!publicationId || !publishId || statusMeta.failed || statusMeta.complete || !statusMeta.pending) return null;
  return {
    publicationId,
    publishId,
    checkedAt: firstStringDeep(result?.tiktok_status_checked_at, getNestedString(result, ["diagnostics", "status_checked_at"])),
    statusFetchFailed: statusMeta.statusFetchFailed,
  };
}

export function getYoutubeShortsPublicationUrl(result: any) {
  const publicationType = String(
    result?.youtube_publication_type ||
      result?.youtubePublicationType ||
      getNestedString(result, ["diagnostics", "publicationType"]) ||
      "",
  ).toLowerCase();
  const idToUrl = (id: string) => publicationType === "video"
    ? `https://www.youtube.com/watch?v=${id}`
    : `https://www.youtube.com/shorts/${id}`;
  const direct = firstStringDeep(
    result?.external_url,
    publicationType === "video" ? result?.video_url : result?.shorts_url,
    publicationType === "video" ? getNestedString(result, ["diagnostics", "videoUrl"]) : getNestedString(result, ["diagnostics", "shortsUrl"]),
    result?.post_url,
    publicationType === "video" ? result?.shorts_url : result?.video_url,
    publicationType === "video" ? getNestedString(result, ["diagnostics", "shortsUrl"]) : getNestedString(result, ["diagnostics", "videoUrl"]),
    getNestedString(result, ["diagnostics", "raw", "id"]),
  );
  if (direct) {
    if (/^[A-Za-z0-9_-]{8,}$/.test(direct) && !direct.startsWith("http")) return idToUrl(direct);
    return direct;
  }

  const videoId = firstStringDeep(
    result?.external_id,
    result?.videoId,
    result?.video_id,
    getNestedString(result, ["diagnostics", "videoId"]),
    getNestedString(result, ["diagnostics", "raw", "id"]),
  );
  return videoId ? idToUrl(videoId) : "https://www.youtube.com";
}
