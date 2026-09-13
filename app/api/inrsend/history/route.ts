import { NextResponse } from "next/server";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { resolveActiveInrcyAccountId } from "@/lib/multicompte/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { buildStorageContentUrl } from "@/lib/storageContentUrl";
import { createSafeStorageSignedUrl } from "@/lib/safeStorageSignedUrl";
import { runTransientPostgrestRead } from "@/lib/supabaseTransientRetry";
import { getInrSendRetentionCutoffIso, getOldestAutoRetentionCutoffIso, isInrSendItemRetained } from "@/lib/inrsendRetention";
import { fetchInrSendHistoryFiles } from "@/lib/inrsend/historyFiles";
import { sanitizeInrSendHistoryStorageUrls } from "@/lib/inrsend/historyStorageUrls";
import {
  INRCY_WORKFLOW_ACTIONS,
  INRSEND_GROUPED_FOLDERS,
  INRSEND_LEGACY_FOLDERS,
  getActionFromLegacyFolder,
  getActionFromTrack,
  getGroupedHistoryFolder,
  getWorkflowActionLabel,
  getWorkflowToolForAction,
  isGroupedHistoryFolder,
  type InrcyGroupedHistoryFolder,
  type InrcyLegacyHistoryFolder,
  type InrcyWorkflowAction,
  type InrcyWorkflowTool,
} from "@/lib/inrcyWorkflow";

type Folder = InrcyLegacyHistoryFolder | InrcyGroupedHistoryFolder;

type BoxView = "sent" | "drafts";
type Status = "draft" | "sent" | "error" | "queued" | "processing" | "paused" | "partial" | "completed" | "failed";

type OutboxItem = {
  id: string;
  source: "send_items" | "app_events" | "mail_campaigns" | "inr_agent_actions";
  module?: "booster" | "propulser" | "fideliser";
  /**
   * Dossier historique réel ou dossier groupé.
   * Les anciennes valeurs restent supportées pour ne pas casser l'historique existant.
   */
  folder: Folder;
  /** Regroupement cible de la nouvelle navigation iNr'Send. */
  groupedFolder?: InrcyGroupedHistoryFolder | null;
  /** Action métier affichable dans la colonne Actions des futurs onglets groupés. */
  workflowAction?: InrcyWorkflowAction | null;
  workflowActionLabel?: string | null;
  workflowTool?: InrcyWorkflowTool | null;
  workflowToolLabel?: string | null;
  provider: string | null;
  status: Status;
  created_at: string;
  sent_at?: string | null;
  error?: string | null;
  title: string;
  subTitle?: string;
  target: string;
  preview: string;
  detailHtml?: string | null;
  detailText?: string | null;
  subject?: string | null;
  to?: string | null;
  from?: string | null;
  channels?: string[];
  attachments?: { name: string; type?: string | null; size?: number | null; url?: string | null; downloadUrl?: string | null; role?: string | null; storagePath?: string | null; duration?: number | null; thumbnailUrl?: string | null }[];
  /** Origine de l'action quand elle vient d'un moteur automatisé comme iNr'Agent. */
  originSource?:
    | "manual"
    | "inr_agent"
    | "booster_scheduled"
    | "booster_manual"
    | "inrsend_scheduled"
    | "propulser_scheduled"
    | "fideliser_scheduled"
    | null;
  originLabel?: string | null;
  originIcon?: string | null;
  raw?: any;
  reopenHref?: string | null;
};

type FolderCounts = Record<Folder, number>;

type SendType = "mail" | "facture" | "devis";

type SendItemRow = {
  id: string;
  integration_id: string | null;
  type: SendType;
  status: Status;
  to_emails: string;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  provider: string | null;
  provider_message_id: string | null;
  provider_thread_id?: string | null;
  source_doc_save_id?: string | null;
  source_doc_type?: "devis" | "facture" | null;
  source_doc_number?: string | null;
  folder?: Folder | string | null;
  track_kind?: string | null;
  track_type?: string | null;
  template_key?: string | null;
  attachments?: any;
  error: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
};

type InrAgentActionRow = {
  id: string;
  automation_key: string | null;
  action_type: string | null;
  target_tool: string | null;
  title: string | null;
  summary: string | null;
  preview_text: string | null;
  recipients: unknown[] | null;
  payload: Record<string, unknown> | null;
  status: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string | null;
  last_error: string | null;
};

type InrAgentScheduledActionRow = {
  id: string;
  automation_key: string | null;
  action_type: string | null;
  target_tool: string | null;
  source: string | null;
  title: string | null;
  summary: string | null;
  channels: string[] | null;
  payload: Record<string, unknown> | null;
  status: string | null;
  executed_at: string | null;
  created_at: string;
  updated_at: string | null;
  last_error: string | null;
};

type StoredReportDocument = {
  bucket: string;
  storagePath: string;
  filename: string;
  mimeType: string;
  bytes: number;
  createdAt: string;
};

const MAILBOX_PAGE_SIZE = 20;
const SOURCE_BATCH_SIZE = 60;
const MAX_HISTORY_PAGE = 100;
const MIN_SOURCE_BATCHES_PER_REQUEST = 1;
const MAX_SOURCE_BATCHES_PER_REQUEST = 40;
const COUNT_SOURCE_BATCH_SIZE = 150;
const COUNT_SOURCE_ROW_LIMIT = 300;
const HISTORY_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
};
const HISTORY_PRIVATE_STORAGE_URL_TTL_SECONDS = 15 * 60;
const ALL_FOLDERS: Folder[] = Array.from(
  new Set<string>([...INRSEND_LEGACY_FOLDERS, ...INRSEND_GROUPED_FOLDERS]),
) as Folder[];

function emptyFolderCounts(): FolderCounts {
  return ALL_FOLDERS.reduce((acc, folder) => {
    acc[folder] = 0;
    return acc;
  }, {} as FolderCounts);
}

async function resolvePrivateHistoryStorageUrl(bucket: string, storagePath: string) {
  return createSafeStorageSignedUrl(
    bucket,
    storagePath,
    HISTORY_PRIVATE_STORAGE_URL_TTL_SECONDS,
  );
}

function parsePositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function cleanString(value: unknown) {
  return String(value || "").trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function extractStoredReportDocument(value: unknown): StoredReportDocument | null {
  const record = asRecord(value);
  const bucket = cleanString(String(record.bucket || "inr-agent-reports"));
  const storagePath = cleanString(String(record.storagePath || record.storage_path || record.path || ""));
  const filename = cleanString(String(record.filename || "bilan-inrstats.pdf"));
  const mimeType = cleanString(String(record.mimeType || record.mime_type || "application/pdf"));
  const bytes = Math.max(0, Math.round(Number(record.bytes || 0) || 0));
  const createdAt = cleanString(String(record.createdAt || record.created_at || ""));
  if (!bucket || !storagePath || !filename) return null;
  return { bucket, storagePath, filename, mimeType, bytes, createdAt };
}

async function withStatsReportContentUrls(items: OutboxItem[]): Promise<OutboxItem[]> {
  const statsItems = items.filter((item) => item.source === "inr_agent_actions");
  if (!statsItems.length) return items;

  await Promise.all(statsItems.map(async (item) => {
    const attachment = item.attachments?.[0];
    const rawPayload = asRecord((item.raw as InrAgentActionRow | undefined)?.payload);
    const document = extractStoredReportDocument(rawPayload.reportDocument);
    const storagePath = document?.storagePath || attachment?.storagePath || "";
    const bucket = document?.bucket || "inr-agent-reports";
    if (!storagePath) return;

    const contentUrl = buildStorageContentUrl(bucket, storagePath) || "";
    if (!contentUrl) return;
    item.attachments = (item.attachments || []).map((current) => (
      current.storagePath === storagePath
        ? { ...current, url: contentUrl, downloadUrl: contentUrl }
        : current
    ));
    const documentPayload = asRecord(rawPayload.reportDocument);
    item.raw = {
      ...(item.raw as Record<string, unknown>),
      payload: {
        ...rawPayload,
        reportDocument: {
          ...documentPayload,
          downloadUrl: contentUrl,
        },
      },
    };
  }));

  return items;
}

function isMissingAgentActionsError(error: { code?: string; message?: string } | null | undefined) {
  const message = String(error?.message || "").toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "42703" ||
    error?.code === "PGRST205" ||
    message.includes("inr_agent_actions")
  );
}

function isMissingAgentScheduledActionsError(error: { code?: string; message?: string } | null | undefined) {
  const message = String(error?.message || "").toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "42703" ||
    error?.code === "PGRST205" ||
    message.includes("inr_agent_scheduled_actions")
  );
}

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

function stripText(v: unknown): string {
  return String(v || "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function safeS(v: unknown, fallback = ""): string {
  const s = stripText(v);
  return s || fallback;
}

function firstNonEmpty(...vals: any[]) {
  for (const v of vals) {
    const s = typeof v === "string" ? v.trim() : "";
    if (s) return s;
  }
  return "";
}

function looksLikeDelimitedChannelList(value: string) {
  const v = String(value || "").trim();
  if (!v) return false;
  if (/^https?:\/\//i.test(v)) return false;
  return /\s[\/]\s|[,;\n]/.test(v);
}

function downloadUrlForHistoryFile(fileId: string) {
  return `/api/inrsend/history/files/${encodeURIComponent(fileId)}/download`;
}

function mergeAttachments(
  current: NonNullable<OutboxItem["attachments"]>,
  extra: NonNullable<OutboxItem["attachments"]>,
) {
  const seen = new Set<string>();
  const merged: NonNullable<OutboxItem["attachments"]> = [];
  for (const attachment of [...extra, ...current]) {
    const key = `${attachment.downloadUrl || attachment.url || ""}|${attachment.name || ""}|${attachment.size || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(attachment);
  }
  return merged;
}

function isFolderValue(value: string): value is Folder {
  return (ALL_FOLDERS as string[]).includes(value);
}

function normalizeFolder(value: string | null): Folder {
  const cleaned = String(value || "").toLowerCase();
  return isFolderValue(cleaned) ? cleaned : "mails";
}

function normalizeBoxView(value: string | null): BoxView {
  return String(value || "").toLowerCase() === "drafts" ? "drafts" : "sent";
}

function historyFolderForAction(action: InrcyWorkflowAction): Folder {
  const definition = INRCY_WORKFLOW_ACTIONS[action] as { legacyFolder?: Folder; groupedFolder: Folder };
  return definition.legacyFolder || definition.groupedFolder;
}

function workflowMetaFromAction(action: InrcyWorkflowAction | null | undefined) {
  if (!action) {
    return {
      groupedFolder: null,
      workflowAction: null,
      workflowActionLabel: null,
      workflowTool: null,
      workflowToolLabel: null,
    };
  }

  const tool = getWorkflowToolForAction(action);
  return {
    groupedFolder: INRCY_WORKFLOW_ACTIONS[action].groupedFolder,
    workflowAction: action,
    workflowActionLabel: getWorkflowActionLabel(action),
    workflowTool: tool,
    workflowToolLabel: tool === "booster" ? "Booster" : tool === "propulser" ? "Propulser" : "Fidéliser",
  };
}

function workflowMetaFromFolder(folder: Folder) {
  const action = getActionFromLegacyFolder(folder);
  if (action) return workflowMetaFromAction(action);
  return {
    groupedFolder: getGroupedHistoryFolder(folder),
    workflowAction: null,
    workflowActionLabel: null,
    workflowTool: null,
    workflowToolLabel: null,
  };
}

function groupedFolderForItem(item: Pick<OutboxItem, "folder" | "groupedFolder">): InrcyGroupedHistoryFolder | null {
  return item.groupedFolder || getGroupedHistoryFolder(item.folder);
}

function countFolderItem(counts: FolderCounts, item: OutboxItem) {
  counts[item.folder] = (counts[item.folder] || 0) + 1;
  const groupedFolder = groupedFolderForItem(item);
  if (groupedFolder && groupedFolder !== item.folder) {
    counts[groupedFolder] = (counts[groupedFolder] || 0) + 1;
  }
}

function defaultFolderFromSendType(type: SendType | string | null | undefined): Folder {
  if (type === "facture") return "factures";
  if (type === "devis") return "devis";
  return "mails";
}

function folderFromTrack(trackKind: string | null | undefined, trackType: string | null | undefined, fallback: Folder = "mails"): Folder {
  const action = getActionFromTrack(trackKind, trackType);
  return action ? historyFolderForAction(action) : fallback;
}

function resolveCampaignFolder(raw: any): Folder {
  const explicit = String(raw?.folder || "").toLowerCase();
  if (isFolderValue(explicit)) return explicit;
  const tracked = folderFromTrack(raw?.track_kind, raw?.track_type, defaultFolderFromSendType(raw?.type));
  return tracked;
}

function stripWorkflowPrefix(value: string) {
  return String(value || "")
    .replace(/^(Valoriser|Récolter|Récolte|Offrir|Informer|Information|Suivre|Suivi|Enquêter|Enquête|Propulsion|Fidélisation)\s*[—–·-]\s*/i, "")
    .trim();
}

function campaignTitleFromFolder(folder: Folder, subject: string) {
  const safeSubject = safeS(subject, "(sans objet)");
  if (folder === "offres") return `Offre — ${safeSubject}`;
  if (folder === "recoltes") return `Récolte — ${safeSubject}`;
  if (folder === "informations") return `Information — ${safeSubject}`;
  if (folder === "suivis") return `Suivi — ${safeSubject}`;
  if (folder === "enquetes") return `Enquête — ${safeSubject}`;
  if (folder === "propulsions") return safeSubject;
  if (folder === "fidelisations") return safeSubject;
  if (folder === "factures") return `Envoi facture — ${safeSubject}`;
  if (folder === "devis") return `Envoi devis — ${safeSubject}`;
  return `Campagne — ${safeSubject}`;
}

function normalizeChannelCandidates(candidates: any[]): string[] {
  const seen = new Set<string>();
  return candidates
    .flat()
    .map((x) => (typeof x === "string" ? x : x?.key || x?.name || x?.label || ""))
    .map((s: string) => String(s).trim())
    .filter((value) => Boolean(value) && !looksLikeDelimitedChannelList(value))
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function extractChannelsFromPayload(payload: any): string[] {
  if (!payload || typeof payload !== "object") return [];

  const explicitCandidates: any[] = [];
  if (Array.isArray(payload.channels)) explicitCandidates.push(...payload.channels);
  if (Array.isArray(payload.platforms)) explicitCandidates.push(...payload.platforms);
  if (Array.isArray(payload.targets)) explicitCandidates.push(...payload.targets);
  if (Array.isArray(payload.destinations)) explicitCandidates.push(...payload.destinations);

  const explicitChannels = normalizeChannelCandidates(explicitCandidates);
  if (explicitChannels.length) return explicitChannels;

  const candidates: any[] = [];
  const postByChannel = payload?.postByChannel && typeof payload.postByChannel === "object" ? payload.postByChannel : null;
  if (postByChannel) candidates.push(...Object.keys(postByChannel));

  const results = payload?.results && typeof payload.results === "object" ? payload.results : null;
  if (results) candidates.push(...Object.keys(results));

  const single = firstNonEmpty(payload.channel, payload.platform, payload.target, payload.destination);
  if (single && !looksLikeDelimitedChannelList(single)) candidates.push(single);

  return normalizeChannelCandidates(candidates);
}

function extractMessageFromPayload(payload: any): { html?: string | null; text?: string | null } {
  if (!payload || typeof payload !== "object") return { text: null };

  const pickStr = (obj: any, ...keys: string[]) => {
    for (const k of keys) {
      const v = obj?.[k];
      if (typeof v === "string" && v.trim()) return v;
    }
    return null;
  };

  const coerceText = (v: any): string | null => {
    if (typeof v === "string") {
      const t = v.trim();
      return t ? t : null;
    }
    if (Array.isArray(v)) {
      const parts = v
        .map((x) => (typeof x === "string" ? x.trim() : ""))
        .filter(Boolean);
      return parts.length ? parts.join("\n") : null;
    }
    if (v && typeof v === "object") {
      return (
        pickStr(v, "text", "message", "content", "caption", "description", "body_text", "bodyText") ||
        pickStr(v, "prompt")
      );
    }
    return null;
  };

  const html =
    pickStr(payload, "html", "body_html", "bodyHtml", "content_html", "contentHtml", "message_html", "messageHtml") ||
    pickStr(payload?.post, "html", "body_html", "bodyHtml", "content_html", "contentHtml") ||
    pickStr(payload?.mail, "html", "body_html", "bodyHtml", "content_html", "contentHtml") ||
    null;

  let text =
    pickStr(payload, "text", "body_text", "bodyText", "message", "content", "caption", "description", "prompt") ||
    coerceText(payload?.post?.content) ||
    coerceText(payload?.post?.text) ||
    coerceText(payload?.post?.message) ||
    coerceText(payload?.mail?.text) ||
    coerceText(payload?.mail?.body_text) ||
    coerceText(payload?.mail?.bodyText) ||
    coerceText(payload?.message) ||
    null;

  if (!text && payload?.post && typeof payload.post === "object") {
    const title = pickStr(payload.post, "title") || pickStr(payload, "title");
    const content =
      coerceText(payload.post.content) || coerceText(payload.post.text) || coerceText(payload.post.caption) || null;
    const cta = pickStr(payload.post, "cta") || pickStr(payload, "cta");
    const parts = [title, content, cta].filter(Boolean);
    if (parts.length) text = parts.join("\n");
  }

  const tags = payload?.hashtags ?? payload?.post?.hashtags;
  if (Array.isArray(tags) && tags.length) {
    const hashLine = tags
      .map((t) => String(t || "").trim())
      .filter(Boolean)
      .join(" ");
    if (hashLine) text = `${text ? text.trim() + "\n\n" : ""}${hashLine}`;
  }

  return { html, text };
}

function downloadUrlForDraftAttachment(bucket: string, path: string, name?: string | null) {
  const params = new URLSearchParams();
  params.set("bucket", bucket);
  params.set("path", path);
  if (name) params.set("name", name);
  return `/api/inrsend/attachments/download?${params.toString()}`;
}

function parseMaybeJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function extractAttachmentsFromPayload(payload: any): { name: string; type?: string | null; size?: number | null; url?: string | null; downloadUrl?: string | null; storagePath?: string | null; duration?: number | null; thumbnailUrl?: string | null }[] {
  if (!payload || typeof payload !== "object") return [];
  const baseCandidates = parseMaybeJsonArray(
    payload.attachments ||
    payload.files ||
    payload.images ||
    payload.media ||
    payload?.post?.attachments ||
    payload?.post?.files ||
    payload?.post?.images ||
    payload?.post?.media ||
    []
  );

  const singleMediaCandidates = [
    payload.video,
    payload.videoDraft,
    payload.video_draft,
    payload?.post?.video,
    payload?.post?.videoDraft,
    payload?.media_metadata?.video,
    payload?.mediaMetadata?.video,
    payload?.post?.media_metadata?.video,
    payload?.post?.mediaMetadata?.video,
  ].filter(Boolean);

  const flatVideoUrl = String(
    payload.video_url ||
    payload.videoUrl ||
    payload?.post?.video_url ||
    payload?.post?.videoUrl ||
    ""
  ).trim();
  const flatVideoCandidate = flatVideoUrl
    ? [{
        name: payload.video_name || payload.videoName || payload?.post?.video_name || payload?.post?.videoName || "video-inrcy.mp4",
        type: payload.video_mime || payload.videoMime || payload?.post?.video_mime || payload?.post?.videoMime || "video/mp4",
        size: payload.video_size || payload.videoSize || payload?.post?.video_size || payload?.post?.videoSize || null,
        duration: payload.video_duration_seconds || payload.videoDurationSeconds || payload?.post?.video_duration_seconds || payload?.post?.videoDurationSeconds || null,
        url: flatVideoUrl,
        publicUrl: flatVideoUrl,
        storagePath: payload.video_path || payload.videoPath || payload?.post?.video_path || payload?.post?.videoPath || null,
        thumbnailUrl: payload.video_thumbnail_url || payload.videoThumbnailUrl || payload?.post?.video_thumbnail_url || payload?.post?.videoThumbnailUrl || null,
      }]
    : [];

  const candidates = [...baseCandidates, ...singleMediaCandidates, ...flatVideoCandidate];

  if (!Array.isArray(candidates)) return [];

  const isLikelyUrl = (value: string) => /^https?:\/\//i.test(value) || value.startsWith("/");
  const buildNameFromUrl = (value: string) => {
    const cleaned = String(value || "").split("?")[0].trim();
    if (!cleaned) return "Pièce jointe";
    const last = cleaned.split("/").filter(Boolean).pop() || cleaned;
    return safeDecode(last);
  };

  return candidates
    .map((a: any) => {
      if (!a) return null;
      if (typeof a === "string") {
        const raw = String(a).trim();
        if (!raw) return null;
        return isLikelyUrl(raw)
          ? { name: buildNameFromUrl(raw), url: raw }
          : { name: raw };
      }
      const bucket = String(a.bucket || a.storage_bucket || "").trim();
      const storagePath = String(a.path || a.storage_path || a.storagePath || a.video_path || "").trim();
      const url = a.url || a.href || a.publicUrl || a.public_url || a.videoUrl || a.video_url || (storagePath && isLikelyUrl(storagePath) ? storagePath : null);
      const name = a.name || a.filename || a.fileName || a.originalname || (storagePath && !isLikelyUrl(storagePath) ? storagePath.split("/").pop() : null) || url;
      if (!name && !url) return null;
      const finalName = String(name || buildNameFromUrl(String(url || "")));
      const downloadUrl = bucket && storagePath && !isLikelyUrl(storagePath)
        ? downloadUrlForDraftAttachment(bucket, storagePath, finalName)
        : null;
      return {
        name: finalName,
        type: a.type || a.mime || a.mimeType || null,
        size: typeof a.size === "number" ? a.size : typeof a.bytes === "number" ? a.bytes : null,
        url: url || null,
        storagePath: storagePath || a.storagePath || a.video_path || null,
        duration: typeof a.duration === "number" ? a.duration : typeof a.video_duration_seconds === "number" ? a.video_duration_seconds : null,
        thumbnailUrl: a.thumbnailUrl || a.thumbnail_url || a.video_thumbnail_url || null,
        downloadUrl,
      };
    })
    .filter(Boolean) as { name: string; type?: string | null; size?: number | null; url?: string | null; downloadUrl?: string | null; storagePath?: string | null; duration?: number | null; thumbnailUrl?: string | null }[];
}

function isVisibleInFolder(folder: Folder, item: OutboxItem, view: BoxView) {
  const itemGroupedFolder = groupedFolderForItem(item);
  const folderMatches = isGroupedHistoryFolder(folder)
    ? itemGroupedFolder === folder
    : item.folder === folder;

  if (!folderMatches) return false;
  if (view === "drafts") {
    return (item.source === "send_items" || item.source === "app_events") && item.status === "draft";
  }
  return item.status !== "draft";
}

function campaignCounts(raw: any) {
  return {
    total: Math.max(0, Number(raw?.total_count || 0) || 0),
    queued: Math.max(0, Number(raw?.queued_count || 0) || 0),
    processing: Math.max(0, Number(raw?.processing_count || 0) || 0),
    sent: Math.max(0, Number(raw?.sent_count || 0) || 0),
    failed: Math.max(0, Number(raw?.failed_count || 0) || 0),
  };
}

type InrSendOriginSource =
  | "manual"
  | "inr_agent"
  | "booster_scheduled"
  | "booster_manual"
  | "inrsend_scheduled"
  | "propulser_scheduled"
  | "fideliser_scheduled"
  | null;

const TECHNICAL_APP_EVENT_TYPES = new Set([
  "publish_idempotency_lock",
  "execution_idempotency_lock",
  "idempotency_lock",
  "publish_async_job",
  "publish_async_channel",
]);

function isTechnicalAppEvent(raw: any) {
  return TECHNICAL_APP_EVENT_TYPES.has(String(raw?.type || ""));
}

function safeOriginLabel(value: unknown, fallback: string) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function extractOriginMeta(raw: any): { originSource?: InrSendOriginSource; originLabel?: string | null; originIcon?: string | null } {
  const payload = raw?.payload && typeof raw.payload === "object" ? raw.payload : null;
  const metadata = raw?.metadata && typeof raw.metadata === "object" ? raw.metadata : null;
  const origin =
    payload?.origin && typeof payload.origin === "object"
      ? payload.origin
      : metadata?.origin && typeof metadata.origin === "object"
        ? metadata.origin
        : metadata || payload || {};
  const source = String(origin?.source || payload?.source || metadata?.source || "").trim();

  if (source === "inr_agent") {
    const hasScheduledAction = Boolean(origin?.scheduledActionId || metadata?.scheduledActionId);
    const runMode = String(origin?.runMode || metadata?.runMode || "").trim();
    const fallbackLabel = hasScheduledAction || runMode === "scheduled"
      ? "iNr’Agent programmé"
      : runMode === "manual_validation"
        ? "iNr’Agent validé"
        : "iNr’Agent";
    return {
      originSource: "inr_agent",
      originLabel: safeOriginLabel(origin?.label || metadata?.label, fallbackLabel),
      originIcon: "🤖",
    };
  }

  if (source === "booster_scheduled") {
    return {
      originSource: "booster_scheduled",
      originLabel: safeOriginLabel(origin?.label || metadata?.label, "Booster programmé"),
      originIcon: null,
    };
  }

  if (source === "booster_manual") {
    return {
      originSource: "booster_manual",
      originLabel: safeOriginLabel(origin?.label || metadata?.label, "Booster"),
      originIcon: null,
    };
  }

  if (source === "inrsend_scheduled") {
    return {
      originSource: "inrsend_scheduled",
      originLabel: safeOriginLabel(origin?.label || metadata?.label, "Mail programmé"),
      originIcon: null,
    };
  }

  if (source === "propulser_scheduled") {
    return {
      originSource: "propulser_scheduled",
      originLabel: safeOriginLabel(origin?.label || metadata?.label, "Propulser programmé"),
      originIcon: null,
    };
  }

  if (source === "fideliser_scheduled") {
    return {
      originSource: "fideliser_scheduled",
      originLabel: safeOriginLabel(origin?.label || metadata?.label, "Fidéliser programmé"),
      originIcon: null,
    };
  }

  if (source === "manual") {
    return {
      originSource: "manual",
      originLabel: safeOriginLabel(origin?.label || metadata?.label, "Manuel"),
      originIcon: null,
    };
  }

  return {
    originSource: null,
    originLabel: null,
    originIcon: null,
  };
}

function getPublicationTitleFromOrigin(
  isDraft: boolean,
  originMeta: ReturnType<typeof extractOriginMeta>,
) {
  if (isDraft) return "Brouillon publication";
  if (originMeta.originSource === "booster_scheduled") return "Publication programmée";
  if (originMeta.originSource === "inr_agent") {
    const label = String(originMeta.originLabel || "");
    return label.toLowerCase().includes("valid")
      ? "Publication iNr’Agent validée"
      : "Publication iNr’Agent";
  }
  return "Publication";
}

function formatCampaignProgress(raw: any) {
  const counts = campaignCounts(raw);
  const bits = [`${counts.sent}/${counts.total || counts.sent} envoyés`];
  if (counts.processing > 0) bits.push(`${counts.processing} en cours`);
  if (counts.queued > 0) bits.push(`${counts.queued} en attente`);
  if (counts.failed > 0) bits.push(`${counts.failed} en échec`);
  return bits.join(" • ");
}

function matchesQuery(item: OutboxItem, query: string) {
  if (!query) return true;
  const hay = `${item.title || ""} ${item.subTitle || ""} ${item.target || ""} ${item.preview || ""} ${item.provider || ""} ${item.workflowActionLabel || ""} ${item.workflowToolLabel || ""}`.toLowerCase();
  return hay.includes(query);
}

function shouldQuerySendItems(folder: Folder) {
  // Les brouillons iNrSend peuvent désormais être classés dans toutes les catégories
  // (Factures, Devis, Publications, Propulsions, Fidélisations). On filtre ensuite
  // côté JS pour rester compatible avec les anciennes lignes sans colonne folder.
  return folder !== "stats";
}

function shouldQueryCampaigns(folder: Folder, view: BoxView) {
  // Social publications are persisted in app_events. Scanning e-mail
  // campaigns for this tab used to download rows that were all discarded by
  // the JavaScript folder filter.
  return folder !== "stats" && folder !== "publications" && view !== "drafts";
}

function shouldQueryEvents(folder: Folder, view: BoxView) {
  if (view === "drafts") return folder === "publications";
  return folder === "publications"
    || folder === "recoltes"
    || folder === "offres"
    || folder === "propulsions"
    || folder === "informations"
    || folder === "suivis"
    || folder === "enquetes"
    || folder === "fidelisations";
}

function shouldQueryAgentHistory(folder: Folder, view: BoxView) {
  return view !== "drafts" && (folder === "stats" || folder === "publications");
}

function shouldQueryAgentScheduledHistory(folder: Folder, view: BoxView) {
  return view !== "drafts" && folder === "publications";
}

function mapSendItems(rows: SendItemRow[]): OutboxItem[] {
  return rows
    .map<OutboxItem | null>((x) => {
      if ((x as any).status === "deleted") return null;
      const explicitFolder = String((x as any).folder || "").toLowerCase();
      const fallbackFolder: Folder = x.type === "facture" ? "factures" : x.type === "devis" ? "devis" : "mails";
      const folder: Folder = isFolderValue(explicitFolder)
        ? explicitFolder
        : folderFromTrack((x as any).track_kind, (x as any).track_type, fallbackFolder);
      const action = getActionFromTrack((x as any).track_kind, (x as any).track_type) || getActionFromLegacyFolder(folder);
      const workflowMeta = action ? workflowMetaFromAction(action) : workflowMetaFromFolder(folder);
      const title = stripWorkflowPrefix(safeS(x.subject, folder === "factures" ? "Facture" : folder === "devis" ? "Devis" : folder === "publications" ? "Brouillon publication" : "(sans objet)"));
      const preview = safeS(x.body_text || x.body_html, "").slice(0, 140);
      const status: Status = x.status === "sent" && x.error ? "error" : (x.status as Status);
      const rawRecipients = safeS(x.to_emails, "");
      const recipientCount = rawRecipients
        ? rawRecipients.split(/[;,]/).map((v) => v.trim()).filter(Boolean).length
        : 0;
      const target = (folder === "propulsions" || folder === "fidelisations") && recipientCount > 1
        ? `${recipientCount} contacts`
        : rawRecipients;
      const rawModule = String((x as any).track_kind || "").toLowerCase();
      return {
        id: x.id,
        source: "send_items",
        module: rawModule === "booster" || rawModule === "propulser" || rawModule === "fideliser"
          ? rawModule as "booster" | "propulser" | "fideliser"
          : undefined,
        folder,
        ...workflowMeta,
        provider: x.provider || "Mail",
        status,
        created_at: x.created_at,
        sent_at: x.sent_at,
        error: x.error,
        title,
        target,
        preview,
        detailHtml: x.body_html,
        detailText: x.body_text,
        subject: x.subject,
        to: x.to_emails,
        attachments: extractAttachmentsFromPayload(x),
        raw: x,
        reopenHref: x.source_doc_save_id && x.source_doc_type
          ? `/dashboard/${x.source_doc_type === "facture" ? "factures" : "devis"}/new?saveId=${encodeURIComponent(x.source_doc_save_id)}`
          : null,
      };
    })
    .filter(Boolean) as OutboxItem[];
}

function mapCampaignItems(rows: any[]): OutboxItem[] {
  return rows.map<OutboxItem>((x: any) => {
    const folder = resolveCampaignFolder(x);
    const action = getActionFromTrack(x.track_kind, x.track_type) || getActionFromLegacyFolder(folder);
    const workflowMeta = workflowMetaFromAction(action) || workflowMetaFromFolder(folder);
    const rawModule = String(x.track_kind || "").toLowerCase();
    const counts = campaignCounts(x);
    const target = `${counts.total || 0} contact${counts.total > 1 ? "s" : ""}`;
    return {
      id: String(x.id || ""),
      source: "mail_campaigns",
      module: rawModule === "booster" || rawModule === "propulser" || rawModule === "fideliser"
        ? rawModule as "booster" | "propulser" | "fideliser"
        : undefined,
      folder,
      ...workflowMeta,
      provider: x.provider || "Mail",
      status: String(x.status || "processing") as Status,
      created_at: String(x.created_at || new Date().toISOString()),
      sent_at: x.finished_at || null,
      error: x.last_error || null,
      title: stripWorkflowPrefix(safeS(x.subject, "(sans objet)")),
      target,
      preview: formatCampaignProgress(x),
      detailHtml: x.body_html,
      detailText: x.body_text,
      subject: x.subject,
      attachments: extractAttachmentsFromPayload(x),
      ...extractOriginMeta(x),
      raw: x,
      reopenHref: x.source_doc_save_id && x.source_doc_type
        ? `/dashboard/${x.source_doc_type === "facture" ? "factures" : "devis"}/new?saveId=${encodeURIComponent(x.source_doc_save_id)}`
        : null,
    };
  });
}

function mapEventItems(rows: any[]): OutboxItem[] {
  const supportedModules = new Set(["booster", "propulser", "fideliser"]);

  return rows
    .filter(
      (e) =>
        supportedModules.has(String(e.module)) &&
        (!isTechnicalAppEvent(e) || String(e.type || "") === "publish_async_job"),
    )
    .map<OutboxItem>((e: any) => {
      const eventModule = String(e.module || "") as "booster" | "propulser" | "fideliser";
      const t = String(e.type || "");
      const durablePayload = (e.payload || {}) as any;
      const isAsyncPublication = t === "publish_async_job";
      // Avant la conversion terminale du parent, le contenu lisible vit dans
      // ces deux sous-objets. On projette uniquement ce dont iNr'Send a besoin
      // et on garde le statut technique du parent comme `processing`. Si une
      // finalisation interrompue a déjà écrit un bilan terminal avant de
      // convertir le type, ce bilan reste néanmoins visible immédiatement.
      const payload = isAsyncPublication
        ? {
            ...((durablePayload.preparationRequest || {}) as any),
            ...((durablePayload.finalPayloadBase || {}) as any),
            channels: durablePayload.channels || [],
            status: durablePayload.status || "queued",
            publication_id: durablePayload.publication_id || e.id,
          }
        : durablePayload;
      const isDraft = String(payload?.status || "").toLowerCase() === "draft" || t === "publish_draft";
      const actionType =
        t === "publish_draft" || isAsyncPublication ? "publish" : t;
      const action = getActionFromTrack(eventModule, actionType);
      const folder: Folder = action
        ? historyFolderForAction(action)
        : eventModule === "fideliser"
          ? "fidelisations"
          : t === "publish" || isAsyncPublication
            ? "publications"
            : "propulsions";
      const workflowMeta = action ? workflowMetaFromAction(action) : workflowMetaFromFolder(folder);
      const subTitle = firstNonEmpty(
        payload?.post?.title,
        payload?.title,
        payload?.subject,
        payload?.post?.subject,
      );
      const originMeta = extractOriginMeta({ ...e, payload });

      const title = folder === "publications"
        ? getPublicationTitleFromOrigin(isDraft, originMeta)
        : stripWorkflowPrefix(subTitle || safeS(payload?.preview || payload?.text || payload?.message || payload?.content, "Message"));

      const extractedChannels = extractChannelsFromPayload(payload);
      const target = folder === "publications"
        ? (extractedChannels.length ? extractedChannels.join(" / ") : "Google / Réseaux")
        : (
            safeS(payload.to) ||
            safeS(payload.recipients) ||
            safeS(payload.channel) ||
            safeS(payload.platform) ||
            "Contacts"
          );
      const preview = safeS(payload.preview || payload.text || payload.message || payload.content, "").slice(0, 140);
      const extracted = extractMessageFromPayload(payload);
      const payloadStatus = String(payload?.status || "").toLowerCase();
      const eventStatus: Status = isDraft
        ? "draft"
        : isAsyncPublication
          ? payloadStatus === "failed" || payloadStatus === "error"
            ? "failed"
            : payloadStatus === "partial"
              ? "partial"
              : payloadStatus === "completed" || payloadStatus === "done" || payloadStatus === "sent"
                ? "completed"
                : "processing"
        : payloadStatus === "failed"
          ? "failed"
          : payloadStatus === "partial"
            ? "partial"
            : payloadStatus === "processing" || payloadStatus === "queued"
              ? "processing"
              : "sent";
      return {
        id: e.id,
        source: "app_events",
        module: eventModule,
        folder,
        ...workflowMeta,
        provider: eventModule === "fideliser" ? "Fidéliser" : eventModule === "propulser" ? "Propulser" : "Booster",
        status: eventStatus,
        created_at: e.created_at,
        title,
        subTitle: subTitle || undefined,
        target,
        preview,
        detailHtml: extracted.html,
        detailText: extracted.text,
        channels: extractedChannels,
        attachments: extractAttachmentsFromPayload(payload),
        ...originMeta,
          raw: isAsyncPublication ? { ...e, payload } : e,
        reopenHref: isDraft && folder === "publications"
          ? `/dashboard?action=publish&draftId=${encodeURIComponent(String(e.id || ""))}`
          : null,
      };
    });
}


function firstRecord(...values: unknown[]): Record<string, unknown> {
  for (const value of values) {
    const record = asRecord(value);
    if (Object.keys(record).length) return record;
  }
  return {};
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((entry) => cleanString(String(entry || ""))).filter(Boolean)));
}

function firstPostFromChannels(postByChannel: Record<string, unknown>, channels: string[]) {
  for (const channel of channels) {
    const post = asRecord(postByChannel[channel]);
    if (Object.keys(post).length) return post;
  }
  for (const value of Object.values(postByChannel)) {
    const post = asRecord(value);
    if (Object.keys(post).length) return post;
  }
  return {};
}

/**
 * Filet de sécurité iNrAgent -> iNrSend.
 * Une publication réellement exécutée reste visible même si l'écriture de son
 * app_event a échoué ou si une ancienne version ne l'avait pas créée.
 */
function mapAgentPublicationFallbacks(rows: InrAgentActionRow[]): OutboxItem[] {
  const fallbackEvents: any[] = [];

  for (const row of rows) {
    const automationKey = cleanString(row.automation_key).toLowerCase();
    const actionType = cleanString(row.action_type).toLowerCase();
    const targetTool = cleanString(row.target_tool).toLowerCase();
    if (automationKey !== "publish" || actionType !== "publication" || targetTool !== "booster") continue;

    const payload = asRecord(row.payload);
    const execution = firstRecord(
      payload.execution,
      payload.partialImmediateExecution,
      payload.scheduledExecution,
      payload.lastExecution,
    );
    const publishResult = firstRecord(execution.publishResult, payload.publishResult);
    // Depuis ce correctif, publish-now enregistre explicitement si l'historique
    // canonique a échoué. On ne rouvre donc pas d'anciennes actions déjà nettoyées.
    if (execution.historyPersisted !== false) continue;
    const publicationId = cleanString(
      execution.publicationId ||
      execution.publication_id ||
      publishResult.publication_id ||
      publishResult.publicationId ||
      payload.publicationId ||
      payload.publication_id,
    );
    const executedAt = cleanString(
      execution.executedAt || execution.completedAt || row.completed_at || "",
    );

    // Ne pas transformer une simple proposition/pending_validation en historique envoyé.
    if (!publicationId || !executedAt) continue;

    const postByChannel = asRecord(payload.postByChannel);
    const attemptedChannels = Array.from(new Set([
      ...stringArray(execution.channels),
      ...stringArray(payload.selectedChannels),
      ...stringArray(payload.channels),
      ...stringArray(publishResult.attemptedChannels),
    ]));
    const results = firstRecord(execution.results, publishResult.results);
    const summary = firstRecord(execution.summary, publishResult.summary);
    const successChannels = stringArray(summary.successChannels);
    const visibleChannels = successChannels.length ? successChannels : attemptedChannels;
    const firstPost = firstPostFromChannels(postByChannel, attemptedChannels);
    const executionOk = execution.ok !== false && publishResult.ok !== false;
    const failureCount = Math.max(0, Number(summary.failureCount || 0) || 0);
    const status = !executionOk
      ? "failed"
      : cleanString(row.status).toLowerCase() === "executing"
        ? "processing"
        : failureCount > 0
          ? "partial"
          : "completed";

    fallbackEvents.push({
      id: `inr-agent-action:${row.id}`,
      module: "booster",
      type: "publish",
      created_at: executedAt || row.updated_at || row.created_at,
      payload: {
        workflowTool: "booster",
        workflowAction: "publier",
        source: "inr_agent",
        origin: {
          source: "inr_agent",
          label: "iNr’Agent",
          agentActionId: row.id,
          automationKey: "publish",
          reconciled: true,
        },
        publication_id: publicationId,
        channels: visibleChannels,
        attemptedChannels,
        post: firstPost,
        postByChannel,
        idea: payload.idea || row.summary || "",
        mediaType: payload.mediaType || asRecord(payload.media).kind || null,
        mediaModeByChannel: payload.mediaModeByChannel || null,
        video: payload.video || (asRecord(payload.media).kind === "video" ? payload.media : null),
        images: payload.images || (asRecord(payload.media).kind === "image" ? [payload.media] : []),
        results,
        summary,
        status,
        completedAt: executedAt,
        reconciledFromAgentAction: true,
        agentActionId: row.id,
      },
    });
  }

  return mapEventItems(fallbackEvents);
}

function mapAgentHistoryRows(rows: InrAgentActionRow[]): OutboxItem[] {
  return [
    ...mapAgentStatsReports(rows.filter((row) =>
      cleanString(row.automation_key).toLowerCase() === "stats" &&
      cleanString(row.action_type).toLowerCase() === "stats_report"
    )),
    ...mapAgentPublicationFallbacks(rows),
  ];
}

function mapAgentScheduledPublicationFallbacks(
  rows: InrAgentScheduledActionRow[],
): OutboxItem[] {
  const fallbackEvents: any[] = [];

  for (const row of rows) {
    const automationKey = cleanString(row.automation_key).toLowerCase();
    const actionType = cleanString(row.action_type).toLowerCase();
    const targetTool = cleanString(row.target_tool).toLowerCase();
    const status = cleanString(row.status).toLowerCase();
    if (
      automationKey !== "publish" ||
      actionType !== "publication" ||
      targetTool !== "booster" ||
      (status !== "done" && status !== "failed")
    ) {
      continue;
    }

    const payload = asRecord(row.payload);
    const execution = asRecord(payload.lastExecution);
    if (execution.historyPersisted !== false) continue;

    const publishPayload = asRecord(payload.publishPayload);
    const publicationId = cleanString(
      execution.publicationId || execution.publication_id,
    );
    const executedAt = cleanString(
      row.executed_at || execution.at || row.updated_at || row.created_at,
    );
    if (!publicationId || !executedAt) continue;

    const postByChannel = asRecord(publishPayload.postByChannel);
    const attemptedChannels = Array.from(new Set([
      ...stringArray(row.channels),
      ...stringArray(publishPayload.channels),
      ...stringArray(publishPayload.selectedChannels),
    ]));
    const summary = asRecord(execution.summary);
    const results = asRecord(execution.results);
    const executionStatus = cleanString(execution.status).toLowerCase();
    const successChannels = stringArray(summary.successChannels);
    const visibleChannels = successChannels.length
      ? successChannels
      : attemptedChannels;
    const firstPost = firstPostFromChannels(postByChannel, attemptedChannels);
    const failureCount = Math.max(0, Number(summary.failureCount || 0) || 0);

    fallbackEvents.push({
      id: `inr-agent-scheduled:${row.id}`,
      module: "booster",
      type: "publish",
      created_at: executedAt,
      payload: {
        workflowTool: "booster",
        workflowAction: "publier",
        source: "inr_agent",
        origin: {
          source: "inr_agent",
          label: "iNr’Agent programmé",
          scheduledActionId: row.id,
          automationKey: "publish",
          runMode: "scheduled",
          reconciled: true,
        },
        publication_id: publicationId,
        channels: visibleChannels,
        attemptedChannels,
        post: firstPost,
        postByChannel,
        idea: publishPayload.idea || row.summary || "",
        mediaType: publishPayload.mediaType || null,
        mediaModeByChannel: publishPayload.mediaModeByChannel || null,
        video: publishPayload.video || null,
        images: publishPayload.images || [],
        results,
        summary,
        status:
          status === "failed"
            ? "failed"
            : executionStatus === "processing" || execution.entrusted === true
              ? "processing"
              : failureCount > 0
                ? "partial"
                : "completed",
        completedAt: executedAt,
        reconciledFromAgentAction: true,
        scheduledActionId: row.id,
      },
    });
  }

  return mapEventItems(fallbackEvents);
}

function publicationHistoryIdentity(item: OutboxItem): string | null {
  if (item.folder !== "publications" || item.source !== "app_events") return null;
  const payload = asRecord(asRecord(item.raw).payload);
  const publicationId = cleanString(payload.publication_id || payload.publicationId);
  return publicationId ? `publication:${publicationId}` : null;
}

function historyIdentity(item: OutboxItem): string {
  return publicationHistoryIdentity(item) || `${item.source}:${item.id}`;
}

function historyItemPriority(item: OutboxItem): number {
  const payload = asRecord(asRecord(item.raw).payload);
  if (payload.reconciledFromAgentAction === true) return 1;
  return 2;
}

function dedupeHistoryItems(items: OutboxItem[]): OutboxItem[] {
  const result: OutboxItem[] = [];
  const indexByIdentity = new Map<string, number>();
  for (const item of items) {
    const identity = historyIdentity(item);
    const existingIndex = indexByIdentity.get(identity);
    if (existingIndex == null) {
      indexByIdentity.set(identity, result.length);
      result.push(item);
      continue;
    }
    if (historyItemPriority(item) > historyItemPriority(result[existingIndex])) {
      result[existingIndex] = item;
    }
  }
  return result;
}

function mapAgentStatsReports(rows: InrAgentActionRow[]): OutboxItem[] {
  return rows.map<OutboxItem>((row) => {
    const payload = asRecord(row.payload);
    const document = extractStoredReportDocument(payload.reportDocument);
    const delivery = asRecord(payload.delivery);
    const report = asRecord(payload.report);
    const generatedAt = cleanString(String(payload.generatedAt || document?.createdAt || row.completed_at || row.created_at));
    const recipient = safeS(delivery.to || (Array.isArray(row.recipients) ? (row.recipients[0] as any)?.email : ""), "Professionnel");
    const statusValue = String(row.status || "completed").toLowerCase();
    const status: Status = statusValue === "failed"
      ? "failed"
      : statusValue === "executing" || statusValue === "pending" || statusValue === "scheduled"
        ? "processing"
        : "sent";
    const runMode = cleanString(String(payload.runMode || "manual")).toLowerCase();
    const generatedAutomatically = runMode === "automatic";
    const title = safeS(row.title, generatedAutomatically ? "Bilan iNr’Stats automatique envoyé" : "Bilan iNr’Stats manuel envoyé");
    const periodDays = Math.round(Number(report.periodDays || payload.periodDays || 30) || 30);
    const fallbackPreview = periodDays > 0
      ? `Bilan statistique sur ${periodDays} jours.`
      : "Bilan statistique iNr’Stats.";
    const attachments = document
      ? [{
          name: document.filename,
          type: document.mimeType,
          size: document.bytes,
          url: null,
          downloadUrl: null,
          role: "generated_document",
          storagePath: document.storagePath,
        }]
      : [];

    return {
      id: String(row.id || ""),
      source: "inr_agent_actions",
      folder: "stats",
      provider: "iNr’Stats",
      status,
      created_at: generatedAt || row.created_at,
      sent_at: row.completed_at || cleanString(String(delivery.sentAt || "")) || null,
      error: row.last_error,
      title,
      target: recipient,
      preview: safeS(row.preview_text || row.summary, fallbackPreview).slice(0, 180),
      detailText: safeS(row.preview_text || row.summary, fallbackPreview),
      subject: safeS(delivery.subject, title),
      to: recipient,
      attachments,
      originSource: generatedAutomatically ? "inr_agent" : null,
      originLabel: generatedAutomatically ? "iNr’Agent" : null,
      originIcon: generatedAutomatically ? "🤖" : null,
      raw: row,
    };
  });
}

type BoundedRows<T> = {
  rows: T[];
  complete: boolean;
};

async function fetchBoundedRows<T>(
  build: (from: number, to: number) => Promise<{ data: T[] | null; error: any }>,
  batchSize = COUNT_SOURCE_BATCH_SIZE,
  rowLimit = COUNT_SOURCE_ROW_LIMIT,
): Promise<BoundedRows<T>> {
  const rows: T[] = [];

  for (let from = 0; from < rowLimit; from += batchSize) {
    const requestedSize = Math.min(batchSize, rowLimit - from);
    const to = from + requestedSize - 1;
    const { data, error } = await build(from, to);
    if (error) throw error;
    const batch = Array.isArray(data) ? data : [];
    rows.push(...batch);
    if (batch.length < requestedSize) {
      return { rows, complete: true };
    }
  }

  // A full final batch does not prove that the table is exhausted. Returning
  // complete=false prevents a bounded lower bound from being exposed as an
  // exact folder count.
  return { rows, complete: false };
}

async function computeFolderCounts(
  supabase: Awaited<ReturnType<typeof createSupabaseServer>>,
  userId: string,
  boxView: BoxView,
  filterAccountId: string,
  query: string,
): Promise<{ counts: FolderCounts; complete: boolean }> {
  const counts = emptyFolderCounts();
  const eventsCutoffIso = getOldestAutoRetentionCutoffIso(["publications", "recoltes", "offres", "propulsions", "informations", "suivis", "enquetes", "fidelisations"]);

  const sendItemsPromise = fetchBoundedRows<SendItemRow>(async (from, to) => {
    let builder: any = supabase
      .from("send_items")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (boxView === "drafts") builder = builder.eq("status", "draft");
    else builder = builder.neq("status", "draft");

    if (filterAccountId) builder = builder.eq("integration_id", filterAccountId);

    return builder.range(from, to);
  });

  const campaignsPromise = boxView === "drafts"
    ? Promise.resolve({ rows: [] as any[], complete: true })
    : fetchBoundedRows<any>(async (from, to) => runTransientPostgrestRead<any[]>(() => {
        let builder: any = supabase
          .from("mail_campaigns")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: false });

        if (filterAccountId) builder = builder.eq("integration_id", filterAccountId);

        return builder.range(from, to);
      }));

  const eventsPromise = fetchBoundedRows<any>(async (from, to) => {
    let builder: any = supabase
      .from("app_events")
      .select("id, module, type, payload, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (boxView === "drafts") {
      builder = builder.eq("module", "booster").eq("type", "publish_draft");
    } else {
      builder = builder.in("module", ["booster", "propulser", "fideliser"]);
      if (eventsCutoffIso) builder = builder.gte("created_at", eventsCutoffIso);
    }

    return builder.range(from, to);
  });

  const statsReportsPromise = boxView === "drafts"
    ? Promise.resolve({ rows: [] as InrAgentActionRow[], complete: true })
    : fetchBoundedRows<InrAgentActionRow>(async (from, to) => {
        const { data, error } = await supabaseAdmin
          .from("inr_agent_actions")
          .select("id, automation_key, action_type, target_tool, title, summary, preview_text, recipients, payload, status, completed_at, created_at, updated_at, last_error")
          .eq("user_id", userId)
          .order("completed_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .range(from, to);
        if (error && isMissingAgentActionsError(error)) return { data: [], error: null };
        return { data: data as InrAgentActionRow[] | null, error };
      });

  const scheduledActionsPromise = boxView === "drafts"
    ? Promise.resolve({ rows: [] as InrAgentScheduledActionRow[], complete: true })
    : fetchBoundedRows<InrAgentScheduledActionRow>(async (from, to) => {
        const { data, error } = await supabaseAdmin
          .from("inr_agent_scheduled_actions")
          .select("id, automation_key, action_type, target_tool, source, title, summary, channels, payload, status, executed_at, created_at, updated_at, last_error")
          .eq("user_id", userId)
          .in("status", ["done", "failed"])
          .order("executed_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .range(from, to);
        if (error && isMissingAgentScheduledActionsError(error)) return { data: [], error: null };
        return { data: data as InrAgentScheduledActionRow[] | null, error };
      });

  const [sendResult, campaignResult, eventResult, statsReportResult, scheduledActionResult] = await Promise.all([
    sendItemsPromise,
    campaignsPromise,
    eventsPromise,
    statsReportsPromise,
    scheduledActionsPromise,
  ]);

  const allItems = dedupeHistoryItems([
    ...mapSendItems(sendResult.rows),
    ...mapCampaignItems(campaignResult.rows),
    ...mapEventItems(eventResult.rows),
    ...mapAgentHistoryRows(statsReportResult.rows),
    ...mapAgentScheduledPublicationFallbacks(scheduledActionResult.rows),
  ]);

  for (const item of allItems) {
    if (!isVisibleInFolder(item.folder, item, boxView)) continue;
    if (!isInrSendItemRetained(item.folder, item.created_at)) continue;
    if (!matchesQuery(item, query)) continue;
    countFolderItem(counts, item);
  }

  return {
    counts,
    complete: [
      sendResult,
      campaignResult,
      eventResult,
      statsReportResult,
      scheduledActionResult,
    ].every((result) => result.complete),
  };
}

export async function GET(req: Request) {
  const supabase = await createSupabaseServer();

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return NextResponse.json({ error: "Votre session a expiré. Merci de vous reconnecter." }, { status: 401 });
  }

  const activeUserId = await resolveActiveInrcyAccountId(supabase, userData.user.id);

  try {
    const url = new URL(req.url);
    const page = parsePositiveInt(url.searchParams.get("page"), 1, MAX_HISTORY_PAGE);
    const pageSize = parsePositiveInt(url.searchParams.get("pageSize"), MAILBOX_PAGE_SIZE, MAILBOX_PAGE_SIZE);
    const folder = normalizeFolder(url.searchParams.get("folder"));
    const boxView = normalizeBoxView(url.searchParams.get("boxView"));
    const filterAccountId = cleanString(url.searchParams.get("filterAccountId"));
    const query = cleanString(url.searchParams.get("q")).toLowerCase();
    // Exact counters are intentionally opt-in. A normal history read only
    // needs the requested page plus one lookahead item. The dedicated counts-only
    // mode lets the client render the list first, then hydrate every tab counter
    // in the background without downloading the same page twice.
    const includeCounts = url.searchParams.get("includeCounts") === "1";
    const countsOnly = url.searchParams.get("countsOnly") === "1";

    if (countsOnly) {
      const [sentCountsResult, draftCountsResult] = await Promise.all([
        computeFolderCounts(supabase, activeUserId, "sent", filterAccountId, query),
        computeFolderCounts(supabase, activeUserId, "drafts", filterAccountId, query),
      ]);
      const countsIncluded = sentCountsResult.complete && draftCountsResult.complete;
      return NextResponse.json({
        countsIncluded,
        countsComplete: countsIncluded,
        folderCounts: countsIncluded ? sentCountsResult.counts : null,
        draftFolderCounts: countsIncluded ? draftCountsResult.counts : null,
      }, { headers: HISTORY_NO_STORE_HEADERS });
    }

    const folderCutoffIso = getInrSendRetentionCutoffIso(folder);
    const eventSourceCutoffIso = getOldestAutoRetentionCutoffIso(["publications", "recoltes", "offres", "propulsions", "informations", "suivis", "enquetes", "fidelisations"]);
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const targetVisibleCount = end + 1;
    const requestedSourceBatches = Math.ceil(targetVisibleCount / SOURCE_BATCH_SIZE);
    const maxSourceBatches = Math.min(
      MAX_SOURCE_BATCHES_PER_REQUEST,
      Math.max(MIN_SOURCE_BATCHES_PER_REQUEST, requestedSourceBatches + 2),
    );

    const allItems: OutboxItem[] = [];
    const sourceState = {
      send_items: { offset: 0, exhausted: !shouldQuerySendItems(folder) },
      mail_campaigns: { offset: 0, exhausted: !shouldQueryCampaigns(folder, boxView) },
      app_events: { offset: 0, exhausted: !shouldQueryEvents(folder, boxView) },
      inr_agent_actions: { offset: 0, exhausted: !shouldQueryAgentHistory(folder, boxView) },
      inr_agent_scheduled_actions: {
        offset: 0,
        exhausted: !shouldQueryAgentScheduledHistory(folder, boxView),
      },
    };

    const itemIndexByIdentity = new Map<string, number>();
    const pushItems = (items: OutboxItem[]) => {
      for (const item of items) {
        const key = historyIdentity(item);
        const existingIndex = itemIndexByIdentity.get(key);
        if (existingIndex == null) {
          itemIndexByIdentity.set(key, allItems.length);
          allItems.push(item);
          continue;
        }
        if (historyItemPriority(item) > historyItemPriority(allItems[existingIndex])) {
          allItems[existingIndex] = item;
        }
      }
    };

    const buildFiltered = () =>
      allItems
        .filter((item) => isVisibleInFolder(folder, item, boxView))
        .filter((item) => isInrSendItemRetained(item.folder, item.created_at))
        .filter((item) => matchesQuery(item, query))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    let filtered = buildFiltered();

    let completedSourceBatches = 0;
    for (; completedSourceBatches < maxSourceBatches; completedSourceBatches += 1) {
      if (filtered.length >= targetVisibleCount) break;
      if (
        sourceState.send_items.exhausted &&
        sourceState.mail_campaigns.exhausted &&
        sourceState.app_events.exhausted &&
        sourceState.inr_agent_actions.exhausted &&
        sourceState.inr_agent_scheduled_actions.exhausted
      ) break;

      const tasks: Promise<void>[] = [];

      if (!sourceState.send_items.exhausted) {
        tasks.push((async () => {
          let builder: any = supabase
            .from("send_items")
            .select("*")
            .eq("user_id", activeUserId)
            .order("created_at", { ascending: false });

          if (folderCutoffIso) builder = builder.gte("created_at", folderCutoffIso);

          if (boxView === "drafts") builder = builder.eq("status", "draft");
          else builder = builder.neq("status", "draft");

          if (folder === "mails") builder = builder.eq("type", "mail");
          else if (folder === "factures") builder = builder.eq("type", "facture");
          else if (folder === "devis") builder = builder.eq("type", "devis");
          else if (folder === "publications") {
            builder = builder.eq("folder", "publications");
          }

          if (filterAccountId) builder = builder.eq("integration_id", filterAccountId);

          const from = sourceState.send_items.offset;
          const to = from + SOURCE_BATCH_SIZE - 1;
          const { data, error } = await builder.range(from, to);
          if (error) throw error;
          const rows = (data || []) as SendItemRow[];
          sourceState.send_items.offset += rows.length;
          if (rows.length < SOURCE_BATCH_SIZE) sourceState.send_items.exhausted = true;
          pushItems(mapSendItems(rows));
        })());
      }

      if (!sourceState.mail_campaigns.exhausted) {
        tasks.push((async () => {
          const from = sourceState.mail_campaigns.offset;
          const to = from + SOURCE_BATCH_SIZE - 1;
          const { data, error } = await runTransientPostgrestRead<any[]>(() => {
            let builder: any = supabase
              .from("mail_campaigns")
              .select("*")
              .eq("user_id", activeUserId)
              .order("created_at", { ascending: false });

            if (folderCutoffIso) builder = builder.gte("created_at", folderCutoffIso);
            if (filterAccountId) builder = builder.eq("integration_id", filterAccountId);
            return builder.range(from, to);
          });
          if (error) throw error;
          const rows = (data || []) as any[];
          sourceState.mail_campaigns.offset += rows.length;
          if (rows.length < SOURCE_BATCH_SIZE) sourceState.mail_campaigns.exhausted = true;
          pushItems(mapCampaignItems(rows));
        })());
      }

      if (!sourceState.app_events.exhausted) {
        tasks.push((async () => {
          let builder: any = supabase
            .from("app_events")
            .select("id, module, type, payload, created_at")
            .eq("user_id", activeUserId)
            .order("created_at", { ascending: false });

          if (folderCutoffIso) builder = builder.gte("created_at", folderCutoffIso);
          else if (eventSourceCutoffIso) builder = builder.gte("created_at", eventSourceCutoffIso);

          if (boxView === "drafts") {
            builder = builder.eq("type", "publish_draft");
          } else if (folder !== "publications") {
            for (const technicalType of TECHNICAL_APP_EVENT_TYPES) {
              builder = builder.neq("type", technicalType);
            }
          }

          if (folder === "publications") {
            builder = builder
              .eq("module", "booster")
              .in("type", [
                "publish",
                "publish_draft",
                "publish_async_job",
              ]);
          } else if (folder === "recoltes" || folder === "offres" || folder === "propulsions") {
            builder = builder.in("module", ["booster", "propulser"]);
          } else if (folder === "informations" || folder === "suivis" || folder === "enquetes" || folder === "fidelisations") {
            builder = builder.eq("module", "fideliser");
          } else {
            builder = builder.in("module", ["booster", "propulser", "fideliser"]);
          }

          const from = sourceState.app_events.offset;
          const to = from + SOURCE_BATCH_SIZE - 1;
          const { data, error } = await builder.range(from, to);
          if (error) throw error;
          const rows = (data || []) as any[];
          sourceState.app_events.offset += rows.length;
          if (rows.length < SOURCE_BATCH_SIZE) sourceState.app_events.exhausted = true;
          pushItems(mapEventItems(rows));
        })());
      }

      if (!sourceState.inr_agent_actions.exhausted) {
        tasks.push((async () => {
          const from = sourceState.inr_agent_actions.offset;
          const to = from + SOURCE_BATCH_SIZE - 1;
          let builder = supabaseAdmin
            .from("inr_agent_actions")
            .select("id, automation_key, action_type, target_tool, title, summary, preview_text, recipients, payload, status, completed_at, created_at, updated_at, last_error")
            .eq("user_id", activeUserId);
          builder = folder === "publications"
            ? builder
                .eq("automation_key", "publish")
                .eq("action_type", "publication")
                .eq("target_tool", "booster")
            : builder
                .eq("automation_key", "stats")
                .eq("action_type", "stats_report");
          const { data, error } = await builder
            .order("completed_at", { ascending: false, nullsFirst: false })
            .order("created_at", { ascending: false })
            .range(from, to);
          if (error) {
            if (isMissingAgentActionsError(error)) {
              sourceState.inr_agent_actions.exhausted = true;
              return;
            }
            throw error;
          }
          const rows = (data || []) as InrAgentActionRow[];
          sourceState.inr_agent_actions.offset += rows.length;
          if (rows.length < SOURCE_BATCH_SIZE) sourceState.inr_agent_actions.exhausted = true;
          pushItems(mapAgentHistoryRows(rows));
        })());
      }

      if (!sourceState.inr_agent_scheduled_actions.exhausted) {
        tasks.push((async () => {
          const from = sourceState.inr_agent_scheduled_actions.offset;
          const to = from + SOURCE_BATCH_SIZE - 1;
          const { data, error } = await supabaseAdmin
            .from("inr_agent_scheduled_actions")
            .select("id, automation_key, action_type, target_tool, source, title, summary, channels, payload, status, executed_at, created_at, updated_at, last_error")
            .eq("user_id", activeUserId)
            .eq("automation_key", "publish")
            .eq("action_type", "publication")
            .eq("target_tool", "booster")
            .in("status", ["done", "failed"])
            .order("executed_at", { ascending: false, nullsFirst: false })
            .order("created_at", { ascending: false })
            .range(from, to);
          if (error) {
            if (isMissingAgentScheduledActionsError(error)) {
              sourceState.inr_agent_scheduled_actions.exhausted = true;
              return;
            }
            throw error;
          }
          const rows = (data || []) as InrAgentScheduledActionRow[];
          sourceState.inr_agent_scheduled_actions.offset += rows.length;
          if (rows.length < SOURCE_BATCH_SIZE) {
            sourceState.inr_agent_scheduled_actions.exhausted = true;
          }
          pushItems(mapAgentScheduledPublicationFallbacks(rows));
        })());
      }

      await Promise.all(tasks);
      filtered = buildFiltered();
    }

    filtered = buildFiltered();
    const allSourcesExhausted = Object.values(sourceState).every(
      (state) => state.exhausted,
    );
    const scanTruncated =
      completedSourceBatches >= maxSourceBatches &&
      !allSourcesExhausted &&
      filtered.length < targetVisibleCount;
    const hasMoreFromPage =
      page < MAX_HISTORY_PAGE && (filtered.length > end || scanTruncated);

    let items = filtered.slice(start, end);
    const historyFiles = await fetchInrSendHistoryFiles(
      supabase,
      activeUserId,
      items
        .filter((item) => item.source === "send_items" || item.source === "mail_campaigns" || item.source === "app_events")
        .map((item) => ({ source: item.source, id: item.id })),
    );

    if (historyFiles.length) {
      const byHistoryKey = new Map<string, NonNullable<OutboxItem["attachments"]>>();
      for (const file of historyFiles) {
        const key = `${file.history_source}:${file.history_id}`;
        const url = downloadUrlForHistoryFile(file.id);
        const next = byHistoryKey.get(key) || [];
        next.push({
          name: file.file_name,
          type: file.mime_type,
          size: file.size_bytes,
          url,
          downloadUrl: url,
          role: file.file_role,
        });
        byHistoryKey.set(key, next);
      }

      for (const item of items) {
        const extra = byHistoryKey.get(`${item.source}:${item.id}`);
        if (!extra?.length) continue;
        item.attachments = mergeAttachments(item.attachments || [], extra);
      }
    }

    await withStatsReportContentUrls(items);
    items = await sanitizeInrSendHistoryStorageUrls(items, {
      activeUserId,
      supabaseUrl: String(process.env.NEXT_PUBLIC_SUPABASE_URL || ""),
      resolvePrivateUrl: resolvePrivateHistoryStorageUrl,
    });

    if (!includeCounts) {
      // When every relevant source was exhausted by the bounded page scan, the
      // filtered collection is complete: expose its exact total at no extra
      // database cost. Larger histories remain count-free and keep the normal
      // lookahead behavior.
      const exactTotalFromPageScan = allSourcesExhausted ? filtered.length : null;
      return NextResponse.json({
        items,
        page,
        pageSize,
        hasMore:
          exactTotalFromPageScan != null
            ? page < MAX_HISTORY_PAGE && end < exactTotalFromPageScan
            : hasMoreFromPage,
        total: exactTotalFromPageScan,
        totalKnown: exactTotalFromPageScan != null,
        countsIncluded: false,
      }, { headers: HISTORY_NO_STORE_HEADERS });
    }

    const [sentCountsResult, draftCountsResult] = await Promise.all([
      computeFolderCounts(supabase, activeUserId, "sent", filterAccountId, query),
      computeFolderCounts(supabase, activeUserId, "drafts", filterAccountId, query),
    ]);
    if (!sentCountsResult.complete || !draftCountsResult.complete) {
      return NextResponse.json({
        items,
        page,
        pageSize,
        hasMore: hasMoreFromPage,
        total: null,
        totalKnown: false,
        countsIncluded: false,
      }, { headers: HISTORY_NO_STORE_HEADERS });
    }
    const folderCounts = sentCountsResult.counts;
    const draftFolderCounts = draftCountsResult.counts;
    const activeCounts = boxView === "drafts" ? draftFolderCounts : folderCounts;
    const exactTotal = Math.max(0, Number(activeCounts[folder] || 0));
    const hasMore = page < MAX_HISTORY_PAGE && end < exactTotal;

    return NextResponse.json({
      items,
      page,
      pageSize,
      hasMore,
      total: exactTotal,
      totalKnown: true,
      countsIncluded: true,
      folderCounts,
      draftFolderCounts,
    }, { headers: HISTORY_NO_STORE_HEADERS });
  } catch (error) {
    return jsonUserFacingError(error, { status: 500 });
  }
}
