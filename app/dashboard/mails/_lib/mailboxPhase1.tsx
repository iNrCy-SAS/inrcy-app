import React from "react";
import styles from "../mails.module.css";
import type { MailCampaignRecipientInput } from "@/lib/crmRecipients";
import type { MailCampaignExperienceReport } from "@/lib/mailCampaignReport";
import { getUserFacingMailError } from "@/lib/mailDeliveryErrors";
import { getFrenchPublicationErrorMessage } from "@/lib/publicationErrorFrench";
import {
  getDefaultChannelVideoSettings,
  isBoosterVideoChannelKey,
  normalizeChannelVideoSettings,
  type ChannelVideoSettings,
} from "@/lib/boosterVideoSettings";
import {
  getBoosterImageSafetyBackgroundMode,
  type BoosterImageChannel,
} from "@/lib/boosterImageDecision";

export const MAILBOX_PAGE_SIZE = 20;
export const MAILBOX_RECIPIENTS_PAGE_SIZE = 20;
export const BULK_CONFIRM_WARNING_THRESHOLD = 100;
export const BULK_CONFIRM_STRONG_THRESHOLD = 500;

export function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

export function stripText(v: unknown): string {
  return String(v || "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

export function safeS(v: unknown, fallback = ""): string {
  const s = stripText(v);
  return s || fallback;
}

export function applySignaturePreview(text: string, signature: string): string {
  const base = String(text || "").trimEnd();
  const sig = String(signature || "").trim();
  if (!sig) return base;
  if (!base) return sig;
  if (base.replace(/\r\n/g, "\n").trim().endsWith(sig.replace(/\r\n/g, "\n").trim())) return base;
  return `${base}\n\n${sig}`;
}

export function buildDefaultMailText(opts: { kind: SendType; name?: string; docRef?: string; signature?: string }): string {
  const name = (opts.name || "").trim();
  const hello = name ? `Bonjour ${name},` : "Bonjour,";

  const ref = (opts.docRef || "").trim();
  const refPart = ref ? ` ${ref}` : "";
  if (opts.kind === "facture") {
    return [
      hello,
      "",
      `Veuillez trouver ci-joint votre facture${refPart}.`,
      "",
      "Je reste à votre disposition si besoin.",
    ].join("\n");
  }

  if (opts.kind === "devis") {
    return [
      hello,
      "",
      `Veuillez trouver ci-joint votre devis${refPart}.`,
      "",
      "Je reste disponible pour toute question ou modification.",
    ].join("\n");
  }

  return [
    hello,
    "",
    "Je me permets de vous contacter.",
  ].join("\n");
}
// iNrSend : centre d'historique des envois + envoi simple de mails.
export type Folder =
  | "mails"
  | "factures"
  | "devis"
  | "publications"
  | "recoltes"
  | "offres"
  | "informations"
  | "suivis"
  | "enquetes"
  | "propulsions"
  | "fidelisations"
  | "stats";

// Onglets affichés dans iNr'Send : navigation simplifiée, sans scroll horizontal.
export const ALL_FOLDERS: Folder[] = [
  "publications",
  "propulsions",
  "fidelisations",
  "mails",
  "factures",
  "devis",
  "stats",
];

export const LEGACY_ACTION_FOLDERS: Folder[] = [
  "recoltes",
  "offres",
  "informations",
  "suivis",
  "enquetes",
];

export const ALL_KNOWN_FOLDERS: Folder[] = [
  ...ALL_FOLDERS,
  ...LEGACY_ACTION_FOLDERS,
];

export type FolderCounts = Record<Folder, number>;

export function emptyFolderCounts(): FolderCounts {
  return {
    mails: 0,
    factures: 0,
    devis: 0,
    publications: 0,
    recoltes: 0,
    offres: 0,
    informations: 0,
    suivis: 0,
    enquetes: 0,
    propulsions: 0,
    fidelisations: 0,
    stats: 0,
  };
}

export function normalizeFolderCounts(input: unknown): FolderCounts {
  const counts = emptyFolderCounts();
  if (!input || typeof input !== "object") return counts;
  for (const folder of ALL_KNOWN_FOLDERS) {
    const value = Number((input as Record<string, unknown>)[folder] ?? 0);
    counts[folder] = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }
  return counts;
}

export function isFolderValue(value: string): value is Folder {
  return (ALL_KNOWN_FOLDERS as string[]).includes(value);
}

export function folderFromTrack(trackKind: string | null | undefined, trackType: string | null | undefined, fallback: Folder = "mails"): Folder {
  const kind = String(trackKind || "").toLowerCase();
  const type = String(trackType || "").toLowerCase();

  if (kind === "booster" || kind === "propulser") {
    if (type === "valorize" || type === "review_mail" || type === "promo_mail") return "propulsions";
  }

  if (kind === "fideliser") {
    if (type === "newsletter_mail" || type === "thanks_mail" || type === "satisfaction_mail") return "fidelisations";
  }

  return fallback;
}

export function defaultFolderFromSendType(type: SendType | string | null | undefined): Folder {
  if (type === "facture") return "factures";
  if (type === "devis") return "devis";
  return "mails";
}

export function resolveCampaignFolder(raw: any): Folder {
  const explicit = String(raw?.folder || "").toLowerCase();
  if (isFolderValue(explicit)) return explicit;
  const tracked = folderFromTrack(raw?.track_kind, raw?.track_type, defaultFolderFromSendType(raw?.type));
  return tracked;
}

export function campaignTitleFromFolder(folder: Folder, subject: string) {
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

export function groupedFolderFor(folder: Folder): Folder {
  if (folder === "recoltes" || folder === "offres") return "propulsions";
  if (folder === "informations" || folder === "suivis" || folder === "enquetes") return "fidelisations";
  return folder;
}

export function isGroupedActionFolder(folder: Folder) {
  return folder === "propulsions" || folder === "fidelisations";
}

export function workflowActionLabelFromFolder(folder: Folder): string | null {
  if (folder === "recoltes") return "Récolter";
  if (folder === "offres") return "Offrir";
  if (folder === "informations") return "Informer";
  if (folder === "suivis") return "Suivre";
  if (folder === "enquetes") return "Enquêter";
  return null;
}

export function workflowActionLabelForItem(item: Pick<OutboxItem, "folder" | "workflowActionLabel">): string {
  return String(item.workflowActionLabel || workflowActionLabelFromFolder(item.folder) || "Action");
}

export function isBusinessMailFolder(folder: Folder) {
  return folder === "recoltes" || folder === "offres" || folder === "propulsions" || folder === "informations" || folder === "suivis" || folder === "enquetes" || folder === "fidelisations";
}

// Typage historique d'envoi (ancienne table send_items)
export type SendType = "mail" | "facture" | "devis";
export type Status = "draft" | "sent" | "error" | "queued" | "processing" | "paused" | "partial" | "completed" | "failed";

export type MailAccount = {
  id: string;
  provider: "gmail" | "microsoft" | "imap";
  email_address: string;
  display_name: string | null;
  status: string;
  connection_status?: "connected" | "needs_update" | "disconnected";
  requires_update?: boolean;
};

export const MAIL_ACCOUNTS_UPDATED_EVENT = "inrsend:mail-accounts-updated";

export type ComposeAttachmentRef = {
  bucket: string;
  path: string;
  name: string;
  type?: string | null;
  size?: number | null;
};

export type ComposeCrmRecipientHint = MailCampaignRecipientInput;

export type CampaignRecipientLog = {
  id: string;
  email: string;
  display_name?: string | null;
  status: string;
  error?: string | null;
  last_error?: string | null;
  attempt_count?: number | null;
  max_attempts?: number | null;
  next_attempt_at?: string | null;
  sent_at?: string | null;
  updated_at?: string | null;
  suppression_reason?: string | null;
  bounce_type?: string | null;
  bounced_at?: string | null;
  unsubscribed_at?: string | null;
  delivery_status?: string | null;
  delivery_event?: string | null;
  delivery_last_event_at?: string | null;
  delivered_at?: string | null;
  failure_kind?: string | null;
  failure_retryable?: boolean | null;
  provider_status?: number | null;
};

export type CampaignRecipientsFilterId =
  | "all"
  | "sent"
  | "queued"
  | "processing"
  | "failed"
  | "blocked"
  | "opt_out"
  | "blacklist";

export type CampaignHealthSummary = {
  total: number;
  queued: number;
  processing: number;
  sent: number;
  failed: number;
  blocked: number;
  opt_out: number;
  blacklist: number;
  retryable: number;
};

export type CampaignExperienceReport = MailCampaignExperienceReport;

export type SendItem = {
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
  // present in DB (used by Gmail), but not always selected previously
  provider_thread_id?: string | null;
  source_doc_save_id?: string | null;
  source_doc_type?: "devis" | "facture" | null;
  source_doc_number?: string | null;
  folder?: Folder | string | null;
  track_kind?: string | null;
  track_type?: string | null;
  template_key?: string | null;
  attachments?: unknown;
  error: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
};

export type OutboxItem = {
  id: string;
  source: "send_items" | "app_events" | "mail_campaigns" | "inr_agent_actions";
  module?: "booster" | "propulser" | "fideliser";
  folder: Folder;
  groupedFolder?: Folder | null;
  workflowAction?: "publier" | "valoriser" | "recolter" | "offrir" | "informer" | "suivre" | "enqueter" | null;
  workflowActionLabel?: string | null;
  workflowTool?: "booster" | "propulser" | "fideliser" | null;
  workflowToolLabel?: string | null;
  provider: string | null; // Gmail / Microsoft / IMAP / Booster / Propulser / Fidéliser / Admin
  status: Status;
  created_at: string;
  sent_at?: string | null;
  error?: string | null;

  // Affichage liste
  title: string;
  subTitle?: string;
  target: string;
  preview: string;

  // Détails
  detailHtml?: string | null;
  detailText?: string | null;
  // Optional richer details (when available)
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

export type PublicationAttachment = {
  name: string;
  type?: string | null;
  size?: number | null;
  url?: string | null;
  downloadUrl?: string | null;
  role?: string | null;
  renderedUrl?: string | null;
  publicUrl?: string | null;
  originalUrl?: string | null;
  originalPublicUrl?: string | null;
  originalStoragePath?: string | null;
  originalName?: string | null;
  originalType?: string | null;
  imageKey?: string | null;
  storagePath?: string | null;
  duration?: number | null;
  thumbnailUrl?: string | null;
  thumbnailStoragePath?: string | null;
  transform?: PublicationImageTransform | null;
  imageMeta?: { width?: number; height?: number; ratio?: number } | null;
};

export type PublicationParts = {
  title?: string | null;
  content?: string | null;
  cta?: string | null;
  ctaMode?: string | null;
  ctaUrl?: string | null;
  ctaPhone?: string | null;
  hashtags?: string[];
  attachments?: PublicationAttachment[];
  mediaMode?: string | null;
  videoSettings?: ChannelVideoSettings | null;
  sourceVideo?: PublicationAttachment | null;
};

export type ChannelPublication = {
  key: string;
  label: string;
  parts: PublicationParts;
};

export type PublicationEditForm = {
  title: string;
  content: string;
  cta: string;
  ctaMode: string;
  ctaUrl: string;
  ctaPhone: string;
  hashtags: string;
};

export type EditablePublicationAttachment = PublicationAttachment;

export type PublicationImageFitMode = "contain" | "cover";
export type PublicationImageBackgroundMode = "transparent" | "color" | "white" | "black" | "gray" | "sand" | "brand";

export type PublicationImageTransform = {
  fit: PublicationImageFitMode;
  zoom: number;
  offsetX: number;
  offsetY: number;
  blurBackground: boolean;
  backgroundMode?: PublicationImageBackgroundMode;
  backgroundColor?: string;
};

export type PublicationImageAsset = {
  key: string;
  name: string;
  type: string;
  previewUrl: string;
  sourceUrl: string | null;
  originalUrl?: string | null;
  renderedUrl?: string | null;
  originalStoragePath?: string | null;
  originalName?: string | null;
  originalType?: string | null;
  file: File | null;
  selected: boolean;
  transform: PublicationImageTransform;
  savedTransform?: PublicationImageTransform | null;
  imageMeta?: { width?: number; height?: number; ratio?: number } | null;
};

export type PublicationChannelImagesState = {
  assets: PublicationImageAsset[];
};

export type PublicationImageRenderPreset = {
  width: number;
  height: number;
  defaultFit: PublicationImageFitMode;
  defaultBlurBackground: boolean;
};

export type PublicationPreviewLayout = {
  drawW: number;
  drawH: number;
  dx: number;
  dy: number;
};

export const PUBLICATION_CHANNEL_PRESETS: Record<string, PublicationImageRenderPreset> = {
  inrcy_site: { width: 1440, height: 900, defaultFit: "contain", defaultBlurBackground: false },
  site_web: { width: 1440, height: 900, defaultFit: "contain", defaultBlurBackground: false },
  inr_search: { width: 1440, height: 900, defaultFit: "contain", defaultBlurBackground: false },
  gmb: { width: 1200, height: 900, defaultFit: "contain", defaultBlurBackground: false },
  facebook: { width: 1200, height: 1200, defaultFit: "contain", defaultBlurBackground: false },
  instagram: { width: 1080, height: 1350, defaultFit: "contain", defaultBlurBackground: false },
  linkedin: { width: 1200, height: 1200, defaultFit: "contain", defaultBlurBackground: false },
  tiktok: { width: 1080, height: 1920, defaultFit: "contain", defaultBlurBackground: false },
  pinterest: { width: 1000, height: 1500, defaultFit: "contain", defaultBlurBackground: false },
};

export function getPublicationSafetyBackgroundMode(
  channel: string,
): PublicationImageBackgroundMode {
  const normalized = normalizeChannelKey(channel) as BoosterImageChannel;
  return getBoosterImageSafetyBackgroundMode(normalized);
}

export function publicationClamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function getPublicationEffectiveZoom(transform: Pick<PublicationImageTransform, "fit" | "zoom">) {
  const maxZoom = transform.fit === "cover" ? 3 : 1;
  return publicationClamp(transform.zoom || 1, 0.4, maxZoom);
}

export function getPublicationChannelPreset(channel: string): PublicationImageRenderPreset {
  return PUBLICATION_CHANNEL_PRESETS[normalizeChannelKey(channel)] || { width: 1200, height: 900, defaultFit: "contain", defaultBlurBackground: false };
}

export function buildPublicationDefaultTransform(channel: string): PublicationImageTransform {
  const preset = getPublicationChannelPreset(channel);
  const backgroundMode =
    preset.defaultFit === "contain"
      ? getPublicationSafetyBackgroundMode(channel)
      : "black";
  return {
    fit: preset.defaultFit,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    blurBackground: false,
    backgroundMode,
    backgroundColor:
      backgroundMode === "white"
        ? "#ffffff"
        : backgroundMode === "black"
          ? "#0d1320"
          : undefined,
  };
}

export function getPublicationBackgroundMode(transform: PublicationImageTransform): PublicationImageBackgroundMode {
  const rawMode = String(transform.backgroundMode || "").trim().toLowerCase();
  if (rawMode === "blur" || transform.blurBackground) return "black";
  if (rawMode) return rawMode as PublicationImageBackgroundMode;
  return "black";
}

export function withPublicationBackgroundMode(transform: PublicationImageTransform, backgroundMode: PublicationImageBackgroundMode): PublicationImageTransform {
  return {
    ...transform,
    backgroundMode,
    blurBackground: false,
  };
}

export function getPublicationBackgroundFill(mode: PublicationImageBackgroundMode, backgroundColor?: string): string {
  if (backgroundColor) return backgroundColor;
  switch (mode) {
    case "white": return "#ffffff";
    case "gray": return "#d6dae2";
    case "sand": return "#efe4d3";
    case "brand": return "#ffffff";
    case "color": return "#ffffff";
    default: return "#0d1320";
  }
}

export function arePublicationTransformsEquivalent(a: PublicationImageTransform, b: PublicationImageTransform): boolean {
  return (
    a.fit === b.fit &&
    Math.abs((a.zoom || 1) - (b.zoom || 1)) <= 0.001 &&
    Math.abs((a.offsetX || 0) - (b.offsetX || 0)) <= 0.001 &&
    Math.abs((a.offsetY || 0) - (b.offsetY || 0)) <= 0.001 &&
    getPublicationBackgroundMode(a) === getPublicationBackgroundMode(b) &&
    String(a.backgroundColor || "") === String(b.backgroundColor || "")
  );
}

export function isPublicationTransformModified(transform: PublicationImageTransform, channel: string): boolean {
  const defaults = buildPublicationDefaultTransform(channel);
  return !arePublicationTransformsEquivalent(transform, defaults);
}

export function computePublicationPreviewLayout(params: {
  containerWidth: number;
  containerHeight: number;
  imageWidth: number;
  imageHeight: number;
  transform: PublicationImageTransform;
}): PublicationPreviewLayout {
  const { containerWidth, containerHeight, imageWidth, imageHeight, transform } = params;
  if (!containerWidth || !containerHeight || !imageWidth || !imageHeight) {
    return { drawW: 0, drawH: 0, dx: 0, dy: 0 };
  }

  const baseScale = transform.fit === "cover"
    ? Math.max(containerWidth / imageWidth, containerHeight / imageHeight)
    : Math.min(containerWidth / imageWidth, containerHeight / imageHeight);
  const scale = baseScale * getPublicationEffectiveZoom(transform);
  const drawW = imageWidth * scale;
  const drawH = imageHeight * scale;
  const maxX = Math.abs(drawW - containerWidth) / 2;
  const maxY = Math.abs(drawH - containerHeight) / 2;
  const dx = (containerWidth - drawW) / 2 - maxX * publicationClamp(transform.offsetX || 0, -100, 100) / 100;
  const dy = (containerHeight - drawH) / 2 - maxY * publicationClamp(transform.offsetY || 0, -100, 100) / 100;

  return { drawW, drawH, dx, dy };
}

export function offsetFromPublicationDrawPosition(params: {
  containerWidth: number;
  containerHeight: number;
  drawW: number;
  drawH: number;
  dx: number;
  dy: number;
}): Pick<PublicationImageTransform, "offsetX" | "offsetY"> {
  const { containerWidth, containerHeight, drawW, drawH, dx, dy } = params;
  const maxX = Math.abs(drawW - containerWidth) / 2;
  const maxY = Math.abs(drawH - containerHeight) / 2;
  const offsetX = maxX ? publicationClamp((((containerWidth - drawW) / 2 - dx) / maxX) * 100, -100, 100) : 0;
  const offsetY = maxY ? publicationClamp((((containerHeight - drawH) / 2 - dy) / maxY) * 100, -100, 100) : 0;
  return { offsetX, offsetY };
}

export function makePublicationImageAssetKey(prefix: string, name: string, suffix: string) {
  return `${prefix}:${name}:${suffix}`;
}

export function loadPublicationHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (!src) {
      reject(new Error("Image manquante."));
      return;
    }
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image illisible. Utilisez une image JPG, PNG ou WebP."));
    img.src = src;
  });
}

export async function renderPublicationImageAsset(params: {
  source: string | File;
  transform: PublicationImageTransform;
  channel: string;
  name: string;
  type: string;
}): Promise<{ name: string; type: string; dataUrl: string }> {
  const { source, transform, channel, name, type } = params;
  const preset = getPublicationChannelPreset(channel);
  const sourceUrl = typeof source === "string" ? source : URL.createObjectURL(source);
  try {
    const img = await loadPublicationHtmlImage(sourceUrl);
    const canvas = document.createElement("canvas");
    canvas.width = preset.width;
    canvas.height = preset.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas indisponible.");

    const cw = canvas.width;
    const ch = canvas.height;
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const baseScale = transform.fit === "cover" ? Math.max(cw / iw, ch / ih) : Math.min(cw / iw, ch / ih);
    const scale = baseScale * getPublicationEffectiveZoom(transform);
    const drawW = iw * scale;
    const drawH = ih * scale;
    const maxX = Math.abs(drawW - cw) / 2;
    const maxY = Math.abs(drawH - ch) / 2;
    const dx = (cw - drawW) / 2 - maxX * publicationClamp(transform.offsetX || 0, -100, 100) / 100;
    const dy = (ch - drawH) / 2 - maxY * publicationClamp(transform.offsetY || 0, -100, 100) / 100;

    ctx.clearRect(0, 0, cw, ch);

    const backgroundMode = getPublicationBackgroundMode(transform);
    if (transform.fit === "contain" && backgroundMode !== "transparent") {
      ctx.fillStyle = getPublicationBackgroundFill(backgroundMode, transform.backgroundColor);
      ctx.fillRect(0, 0, cw, ch);
    }

    ctx.drawImage(img, dx, dy, drawW, drawH);
    const outputType = backgroundMode === "transparent" ? "image/png" : (type || "image/jpeg");
    return { name: name.replace(/\.[^.]+$/, "") + (backgroundMode === "transparent" ? ".png" : name.match(/\.[^.]+$/)?.[0] || ".jpg"), type: outputType, dataUrl: canvas.toDataURL(outputType, 0.92) };
  } finally {
    if (typeof source !== "string") URL.revokeObjectURL(sourceUrl);
  }
}

export function splitList(v?: string | null): string[] {
  if (!v) return [];
  return String(v)
    .split(/[;,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function firstNonEmpty(...vals: any[]) {
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

function normalizeChannelCandidates(candidates: any[]): string[] {
  const seen = new Set<string>();
  return candidates
    .flat()
    .map((x) => (typeof x === "string" ? x : x?.key || x?.name || x?.label || ""))
    .map((s: string) => String(s).trim())
    .filter((value) => Boolean(value) && !looksLikeDelimitedChannelList(value))
    .filter((value) => {
      const key = normalizeChannelKey(value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function extractChannelsFromPayload(payload: any): string[] {
  if (!payload || typeof payload !== "object") return [];

  const explicitCandidates: any[] = [];
  // Si un brouillon/publication déclare explicitement ses canaux, on respecte cette liste.
  // Les contenus gardés en mémoire pour d'autres canaux ne doivent pas recréer des bulles fantômes.
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

export function extractMessageFromPayload(payload: any): { html?: string | null; text?: string | null } {
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

  // 1) HTML (flat or nested)
  const html =
    pickStr(payload, "html", "body_html", "bodyHtml", "content_html", "contentHtml", "message_html", "messageHtml") ||
    pickStr(payload?.post, "html", "body_html", "bodyHtml", "content_html", "contentHtml") ||
    pickStr(payload?.mail, "html", "body_html", "bodyHtml", "content_html", "contentHtml") ||
    null;

  // 2) Text (flat or nested)
  let text =
    pickStr(
      payload,
      "text",
      "body_text",
      "bodyText",
      "message",
      "content",
      "caption",
      "description",
      "prompt"
    ) ||
    coerceText(payload?.post?.content) ||
    coerceText(payload?.post?.text) ||
    coerceText(payload?.post?.message) ||
    coerceText(payload?.mail?.text) ||
    coerceText(payload?.mail?.body_text) ||
    coerceText(payload?.mail?.bodyText) ||
    coerceText(payload?.message) ||
    null;

  // Booster "publish-now" payload: payload.post is an object { title, content, cta, hashtags }
  if (!text && payload?.post && typeof payload.post === "object") {
    const title = pickStr(payload.post, "title") || pickStr(payload, "title");
    const content =
      coerceText(payload.post.content) || coerceText(payload.post.text) || coerceText(payload.post.caption) || null;
    const cta = pickStr(payload.post, "cta") || pickStr(payload, "cta");
    const parts = [title, content, cta].filter(Boolean);
    if (parts.length) text = parts.join("\n");
  }

  // If there are hashtags, append them at the end (nice for publications)
  const tags = (payload as any).hashtags ?? (payload as any)?.post?.hashtags;
  if (Array.isArray(tags) && tags.length) {
    const hashLine = tags
      .map((t) => String(t || "").trim())
      .filter(Boolean)
      .join(" ");
    if (hashLine) text = `${text ? text.trim() + "\n\n" : ""}${hashLine}`;
  }

  return { html, text };
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

function downloadUrlForDraftAttachment(bucket: string, path: string, name?: string | null) {
  const params = new URLSearchParams();
  params.set("bucket", bucket);
  params.set("path", path);
  if (name) params.set("name", name);
  return `/api/inrsend/attachments/download?${params.toString()}`;
}

export function extractAttachmentsFromPayload(payload: any): PublicationAttachment[] {
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
      const originalUrl = a.originalUrl || a.original_url || a.originalPublicUrl || a.original_public_url || null;
      const renderedUrl = a.renderedUrl || a.rendered_url || a.url || a.href || a.publicUrl || a.public_url || a.videoUrl || a.video_url || null;
      // iNrSend is the reusable archive: prefer the source over any cropped
      // or channel-adapted rendition stored alongside it.
      const url = originalUrl || renderedUrl || (storagePath && isLikelyUrl(storagePath) ? storagePath : null);
      const hasReusableOriginal = Boolean(originalUrl);
      const name = a.originalName || a.original_name || a.originalname || a.name || a.filename || a.fileName || (storagePath && !isLikelyUrl(storagePath) ? storagePath.split("/").pop() : null) || url;
      if (!name && !url) return null;
      const finalName = String(name || buildNameFromUrl(String(url || "")));
      const downloadUrl = bucket && storagePath && !isLikelyUrl(storagePath)
        ? downloadUrlForDraftAttachment(bucket, storagePath, finalName)
        : null;
      return {
        name: finalName,
        type: a.originalType || a.original_type || a.type || a.mime || a.mimeType || null,
        size: typeof a.originalSize === "number"
          ? a.originalSize
          : typeof a.original_size === "number"
          ? a.original_size
          : typeof a.size === "number"
          ? a.size
          : typeof a.bytes === "number"
          ? a.bytes
          : null,
        url: url || null,
        renderedUrl: hasReusableOriginal ? url : renderedUrl || url || null,
        publicUrl: hasReusableOriginal ? url : a.publicUrl || a.public_url || renderedUrl || url || null,
        originalUrl: originalUrl || null,
        originalPublicUrl: a.originalPublicUrl || a.original_public_url || originalUrl || null,
        originalStoragePath: a.originalStoragePath || a.original_storage_path || null,
        originalName: a.originalName || a.original_name || null,
        originalType: a.originalType || a.original_type || null,
        imageKey: a.imageKey || a.image_key || null,
        storagePath: storagePath || a.storagePath || a.video_path || null,
        duration: typeof a.duration === "number" ? a.duration : typeof a.video_duration_seconds === "number" ? a.video_duration_seconds : null,
        thumbnailUrl: a.thumbnailUrl || a.thumbnail_url || a.video_thumbnail_url || null,
        thumbnailStoragePath: a.thumbnailStoragePath || a.thumbnail_storage_path || null,
        transform: hasReusableOriginal ? null : a.transform || null,
        imageMeta: a.imageMeta || a.image_meta || null,
        downloadUrl,
      };
    })
    .filter(Boolean) as PublicationAttachment[];
}


export function hasAttachmentFields(payload: any): boolean {
  if (!payload || typeof payload !== "object") return false;
  return [
    payload.attachments,
    payload.files,
    payload.images,
    payload.media,
    payload?.post?.attachments,
    payload?.post?.files,
    payload?.post?.images,
    payload?.post?.media,
    payload.video,
    payload.videoDraft,
    payload?.post?.video,
    payload.video_url,
    payload.videoUrl,
    payload?.media_metadata?.video,
    payload?.mediaMetadata?.video,
  ].some((value) => {
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return false;
      const parsed = parseMaybeJsonArray(trimmed);
      return parsed.length > 0 || !trimmed.startsWith("[");
    }
    return Boolean(value);
  });
}

export function extractPublicationParts(payload: any): PublicationParts {
  if (!payload || typeof payload !== "object") return {};
  const post = payload.post && typeof payload.post === "object" ? payload.post : payload;

  const title =
    (typeof post.title === "string" && post.title.trim() ? post.title.trim() : null) ||
    (typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : null) ||
    null;

  const content =
    (typeof post.content === "string" && post.content.trim() ? post.content.trim() : null) ||
    (typeof post.text === "string" && post.text.trim() ? post.text.trim() : null) ||
    (typeof post.message === "string" && post.message.trim() ? post.message.trim() : null) ||
    null;

  const cta =
    (typeof post.cta === "string" && post.cta.trim() ? post.cta.trim() : null) ||
    (typeof payload.cta === "string" && payload.cta.trim() ? payload.cta.trim() : null) ||
    null;

  const ctaMode =
    (typeof post.ctaMode === "string" && post.ctaMode.trim() ? post.ctaMode.trim() : null) ||
    (typeof payload.ctaMode === "string" && payload.ctaMode.trim() ? payload.ctaMode.trim() : null) ||
    null;

  const ctaUrl =
    (typeof post.ctaUrl === "string" && post.ctaUrl.trim() ? post.ctaUrl.trim() : null) ||
    (typeof payload.ctaUrl === "string" && payload.ctaUrl.trim() ? payload.ctaUrl.trim() : null) ||
    null;

  const ctaPhone =
    (typeof post.ctaPhone === "string" && post.ctaPhone.trim() ? post.ctaPhone.trim() : null) ||
    (typeof payload.ctaPhone === "string" && payload.ctaPhone.trim() ? payload.ctaPhone.trim() : null) ||
    null;

  const hashtagsRaw = (post as any).hashtags ?? (payload as any).hashtags;
  const hashtags = Array.isArray(hashtagsRaw)
    ? hashtagsRaw.map((x: any) => String(x || "").trim()).filter(Boolean)
    : [];

  const attachments = extractAttachmentsFromPayload(payload);
  const postVideoRecord = (post as any).video && typeof (post as any).video === "object" ? (post as any).video : null;
  const payloadVideoRecord = (payload as any).video && typeof (payload as any).video === "object" ? (payload as any).video : null;
  const sourceVideoCandidate =
    (post as any).sourceVideo ||
    (post as any).source_video ||
    postVideoRecord?.sourceVideo ||
    postVideoRecord?.source_video ||
    (payload as any).sourceVideo ||
    (payload as any).source_video ||
    payloadVideoRecord?.sourceVideo ||
    payloadVideoRecord?.source_video ||
    null;
  const sourceVideo = sourceVideoCandidate
    ? extractAttachmentsFromPayload({ video: sourceVideoCandidate })[0] || null
    : null;
  const mediaMode =
    (typeof post.mediaMode === "string" && post.mediaMode.trim() ? post.mediaMode.trim() : null) ||
    (typeof payload.mediaMode === "string" && payload.mediaMode.trim() ? payload.mediaMode.trim() : null) ||
    null;
  const videoSettings =
    payload.videoSettings && typeof payload.videoSettings === "object"
      ? normalizeChannelVideoSettings("inrcy_site", payload.videoSettings)
      : null;

  return { title, content, cta, ctaMode, ctaUrl, ctaPhone, hashtags, attachments, mediaMode, videoSettings, sourceVideo };
}

export function normalizeChannelKey(channel: string): string {
  const normalized = String(channel || "").trim().toLowerCase();
  switch (normalized) {
    case "inrcy_site":
    case "site_inrcy":
    case "site inrcy":
      return "inrcy_site";
    case "site_web":
    case "site web":
    case "website":
    case "web":
      return "site_web";
    case "inr_search":
    case "inr search":
    case "inr'search":
    case "inr’search":
      return "inr_search";
    case "gmb":
    case "google_business":
    case "google business":
    case "googlebusiness":
      return "gmb";
    case "linked in":
      return "linkedin";
    default:
      return normalized;
  }
}

export function formatChannelLabel(channel: string): string {
  const normalized = normalizeChannelKey(channel);
  switch (normalized) {
    case "inrcy_site":
      return "Site iNrCy";
    case "site_web":
      return "Site web";
    case "inr_search":
      return "iNr’Search";
    case "gmb":
      return "Google Business";
    case "facebook":
      return "Facebook";
    case "instagram":
      return "Instagram";
    case "linkedin":
      return "LinkedIn";
    case "tiktok":
      return "TikTok";
    case "youtube_shorts":
      return "YouTube";
    case "pinterest":
      return "Pinterest";
    default:
      return normalized || "canal";
  }
}

export function channelApiPath(channel: string): string {
  const normalized = normalizeChannelKey(channel);
  switch (normalized) {
    case "inrcy_site":
      return "site-inrcy";
    case "site_web":
      return "site-web";
    case "inr_search":
      return "inr-search";
    case "gmb":
      return "gmb";
    case "facebook":
      return "facebook";
    case "instagram":
      return "instagram";
    case "linkedin":
      return "linkedin";
    case "tiktok":
      return "tiktok";
    case "pinterest":
      return "pinterest";
    default:
      return normalized || channel;
  }
}

function getVideoSettingsNode(payload: any, channel: string) {
  if (!payload || typeof payload !== "object") return null;
  const normalized = normalizeChannelKey(channel);
  const direct = payload.videoSettings && typeof payload.videoSettings === "object" ? payload.videoSettings : null;
  if (direct) return direct;
  const byChannel = payload.videoSettingsByChannel && typeof payload.videoSettingsByChannel === "object" ? payload.videoSettingsByChannel : null;
  if (byChannel && normalized && (byChannel as any)[normalized]) return (byChannel as any)[normalized];
  return null;
}

export function extractVideoSettingsForChannel(payload: any, channel: string, channelPayload?: any): ChannelVideoSettings | null {
  const normalized = normalizeChannelKey(channel);
  if (!isBoosterVideoChannelKey(normalized)) return null;

  const root = payload && typeof payload === "object" ? payload : {};
  const local = channelPayload && typeof channelPayload === "object" ? channelPayload : {};
  const settingsNode = getVideoSettingsNode(local, normalized) || getVideoSettingsNode(root, normalized);
  const formatByChannel = root.videoFormatByChannel && typeof root.videoFormatByChannel === "object" ? root.videoFormatByChannel : {};
  const adaptationByChannel = root.videoAdaptationModeByChannel && typeof root.videoAdaptationModeByChannel === "object" ? root.videoAdaptationModeByChannel : {};
  const localFormat = local.videoFormat ?? local.format;
  const localAdaptation = local.videoAdaptationMode ?? local.adaptationMode ?? local.fitMode;
  const formatFallback = localFormat ?? (formatByChannel as any)[normalized];
  const adaptationFallback = localAdaptation ?? (adaptationByChannel as any)[normalized];

  if (!settingsNode && !formatFallback && !adaptationFallback) {
    return getDefaultChannelVideoSettings(normalized);
  }

  return normalizeChannelVideoSettings(normalized, settingsNode, formatFallback, adaptationFallback);
}

export function isDeletedChannelResult(result: any): boolean {
  if (!result || typeof result !== "object") return false;
  return result.deleted === true || String(result.status || "").toLowerCase() === "deleted";
}

export function isCancelledChannelResult(result: any): boolean {
  if (!result || typeof result !== "object") return false;
  const status = String(result.tiktok_status || result.status || "").toLowerCase();
  return result.cancelled === true || status === "cancelled" || status === "canceled";
}

export function orderChannelKeys(channels: string[]): string[] {
  const priority = ["inrcy_site", "site_web", "inr_search", "gmb", "facebook", "instagram", "linkedin", "tiktok", "youtube_shorts", "pinterest"];
  const normalizedUnique = Array.from(new Set(channels.map((channel) => normalizeChannelKey(channel)).filter(Boolean)));
  return normalizedUnique.sort((a, b) => {
    const indexA = priority.indexOf(a);
    const indexB = priority.indexOf(b);
    const rankA = indexA === -1 ? Number.MAX_SAFE_INTEGER : indexA;
    const rankB = indexB === -1 ? Number.MAX_SAFE_INTEGER : indexB;
    if (rankA !== rankB) return rankA - rankB;
    return a.localeCompare(b);
  });
}

export function extractPublicationResults(payload: any): Record<string, any> {
  return payload?.results && typeof payload.results === "object" ? payload.results : {};
}

export function isFailedChannelResult(result: any): boolean {
  if (!result || typeof result !== "object") return false;
  if (isDeletedChannelResult(result) || isCancelledChannelResult(result)) return false;
  if (result.ok === false) return true;
  const status = String(result.status || "").toLowerCase();
  return status === "failed" || status === "error";
}

export function isWarningChannelResult(result: any, channel = ""): boolean {
  if (!result || typeof result !== "object") return false;
  if (
    isFailedChannelResult(result) ||
    isDeletedChannelResult(result) ||
    isCancelledChannelResult(result)
  ) {
    return false;
  }
  const normalizedChannel = normalizeChannelKey(channel);
  const tiktokStatus = String(
    result?.tiktok_status ||
      result?.status ||
      result?.diagnostics?.status?.status ||
      "",
  ).toUpperCase();
  const tiktokTerminal = [
    "PUBLISH_COMPLETE",
    "DONE",
    "SUCCESS",
    "FAILED",
    "PUBLISH_FAILED",
    "ERROR",
    "PROCESSING_TIMEOUT",
    "CANCELLED",
    "CANCELED",
  ].includes(tiktokStatus);
  if (
    normalizedChannel === "tiktok" &&
    !tiktokTerminal &&
    Boolean(
      tiktokStatus ||
        result?.external_id ||
        result?.publish_id ||
        result?.diagnostics?.publish_id,
    )
  ) {
    return false;
  }
  const warning = String(result.warning || result.code || "").trim();
  return Boolean(warning || result.warning_message || result.warningMessage);
}

export function isProcessingChannelResult(result: any, channel = ""): boolean {
  if (!result || typeof result !== "object") return false;
  if (
    isFailedChannelResult(result) ||
    isDeletedChannelResult(result) ||
    isCancelledChannelResult(result)
  ) {
    return false;
  }

  const status = String(
    result?.tiktok_status ||
      result?.technicalStatus ||
      result?.status ||
      result?.diagnostics?.status?.status ||
      "",
  )
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const terminalStatuses = new Set([
    "published",
    "published_with_warning",
    "completed",
    "complete",
    "success",
    "succeeded",
    "done",
    "publish_complete",
  ]);
  if (terminalStatuses.has(status)) return false;

  if (
    result.pending === true ||
    result.processing === true ||
    result.queued === true
  ) {
    return true;
  }
  if (
    [
      "processing",
      "queued",
      "pending",
      "submitted",
      "accepted",
      "uploading",
      "external_processing",
      "in_progress",
      "publishing",
      "preparing",
    ].includes(status)
  ) {
    return true;
  }

  return (
    normalizeChannelKey(channel) === "tiktok" &&
    Boolean(
      result?.external_id ||
        result?.publish_id ||
        result?.diagnostics?.publish_id,
    )
  );
}

export function getWarningChannelMessage(result: any, channel = ""): string {
  if (!isWarningChannelResult(result, channel)) return "";
  const message =
    result?.warning_message ??
    result?.warningMessage ??
    result?.error ??
    result?.message ??
    "Publication publiée avec un avertissement.";
  return getFrenchPublicationErrorMessage(
    channel || "site_web",
    message,
    "Publication publiée avec un avertissement.",
  );
}

export function getChannelIndicatorMeta(result: any, channel = ""): { kind: "failed" | "deleted" | "cancelled" | "warning" | "processing"; title: string; className: string } | null {
  if (isCancelledChannelResult(result)) {
    return {
      kind: "cancelled",
      title: "Publication annulée dans iNr’Send",
      className: styles.channelCancelledDot,
    };
  }
  if (isDeletedChannelResult(result)) {
    return {
      kind: "deleted",
      title: "Publication supprimée sur ce canal",
      className: styles.channelDeletedDot,
    };
  }
  if (isFailedChannelResult(result)) {
    return {
      kind: "failed",
      title: "Échec sur ce canal",
      className: styles.channelFailedDot,
    };
  }
  if (isProcessingChannelResult(result, channel)) {
    return {
      kind: "processing",
      title: "En traitement sur ce canal",
      className: styles.channelProcessingDot,
    };
  }
  if (isWarningChannelResult(result, channel)) {
    return {
      kind: "warning",
      title: getWarningChannelMessage(result, channel) || "Publication publiée avec avertissement",
      className: styles.channelWarningDot,
    };
  }
  return null;
}

export function getFailedChannelMessage(result: any, channel = ""): string {
  if (!isFailedChannelResult(result)) return "";
  const message = result?.error ?? result?.message ?? result?.last_error ?? "";
  return getFrenchPublicationErrorMessage(
    channel || "site_web",
    message,
    "La publication n'a pas pu aboutir sur ce canal. Merci de réessayer.",
  );
}

export function getPublicationChannelStatuses(payload: any, fallbackChannels: string[] = []) {
  const results = extractPublicationResults(payload);
  const channels = orderChannelKeys([
    ...fallbackChannels.filter((channel) => !looksLikeDelimitedChannelList(String(channel || ""))),
    ...extractChannelsFromPayload(payload),
    ...Object.keys(results),
  ]);

  return channels.map((channel) => {
    const result = (results as any)?.[channel] || null;
    const indicator = getChannelIndicatorMeta(result, channel);
    return {
      key: channel,
      label: formatChannelLabel(channel),
      failed: indicator?.kind === "failed",
      deleted: indicator?.kind === "deleted",
      warning: indicator?.kind === "warning",
      processing: indicator?.kind === "processing",
      indicator,
      result,
    };
  });
}

export function renderPublicationChannelsWithFailures(payload: any, fallbackChannels: string[] = []) {
  const channels = getPublicationChannelStatuses(payload, fallbackChannels);
  if (!channels.length) return null;

  return (
    <span className={styles.channelStatusInlineWrap}>
      {channels.map((entry, index) => (
        <span className={styles.channelStatusInline} key={`${entry.key}-${index}`}>
          <span className={styles.channelStatusLabel}>{entry.label}</span>
          {entry.indicator ? (
            <span
              className={entry.indicator.className}
              title={entry.indicator.title}
              aria-label={entry.indicator.title}
            />
          ) : null}
        </span>
      ))}
    </span>
  );
}

export function extractChannelPublications(payload: any): ChannelPublication[] {
  if (!payload || typeof payload !== "object") return [];

  const explicitChannels = [
    ...extractChannelsFromPayload(payload),
    ...Object.keys(payload?.results && typeof payload.results === "object" ? payload.results : {}),
  ]
    .map((ch) => normalizeChannelKey(String(ch || "")))
    .filter(Boolean);

  const channelSet = new Set(explicitChannels);
  const hasExplicitChannels = channelSet.size > 0;
  const postByChannel = payload?.postByChannel && typeof payload.postByChannel === "object" ? payload.postByChannel : {};
  const postByNormalizedChannel = Object.entries(postByChannel).reduce<Record<string, any>>((acc, [key, value]) => {
    const cleaned = normalizeChannelKey(String(key || ""));
    if (!cleaned) return acc;
    if (!(cleaned in acc)) acc[cleaned] = value;
    if (channelSet.has(cleaned)) return acc;

    const isSiteMirror = (cleaned === "inrcy_site" || cleaned === "site_web") && (channelSet.has("inrcy_site") || channelSet.has("site_web"));
    if (!hasExplicitChannels && !isSiteMirror) {
      channelSet.add(cleaned);
    }
    return acc;
  }, {});

  const orderedChannels = orderChannelKeys(Array.from(channelSet));
  if (!orderedChannels.length) {
    const baseParts = extractPublicationParts(payload);
    const hasBase = !!(baseParts.title || baseParts.content || baseParts.cta || baseParts.hashtags?.length || baseParts.attachments?.length);
    return hasBase ? [{ key: "default", label: "publication", parts: baseParts }] : [];
  }

  return orderedChannels.map((channel) => {
    const channelPayload = postByNormalizedChannel[channel];
    const channelParts = extractPublicationParts(channelPayload);
    const fallbackParts = extractPublicationParts(payload);

    const channelOwnsAttachments =
      hasAttachmentFields(channelPayload) || channelParts.mediaMode === "none";

    const channelVideoSettings = extractVideoSettingsForChannel(payload, channel, channelPayload);

    return {
      key: channel,
      label: formatChannelLabel(channel),
      parts: {
        title: channelParts.title || fallbackParts.title || null,
        content: channelParts.content || fallbackParts.content || null,
        cta: channelParts.cta || fallbackParts.cta || null,
        ctaMode: channelParts.ctaMode || fallbackParts.ctaMode || null,
        ctaUrl: channelParts.ctaUrl || fallbackParts.ctaUrl || null,
        ctaPhone: channelParts.ctaPhone || fallbackParts.ctaPhone || null,
        hashtags: channelParts.hashtags?.length ? channelParts.hashtags : fallbackParts.hashtags || [],
        attachments: channelOwnsAttachments ? channelParts.attachments || [] : fallbackParts.attachments || [],
        mediaMode: channelParts.mediaMode || fallbackParts.mediaMode || null,
        videoSettings: channelVideoSettings,
        sourceVideo: channelParts.sourceVideo || fallbackParts.sourceVideo || null,
      },
    };
  });
}

export function tagsToEditorString(tags?: string[]): string {
  return Array.isArray(tags) ? tags.map((tag) => String(tag || "").trim().replace(/^#/, "")).filter(Boolean).join(" ") : "";
}

export function isImageAttachment(att: { name: string; type?: string | null; url?: string | null }): boolean {
  const type = String(att.type || "").toLowerCase();
  const raw = String(att.url || att.name || "").toLowerCase().split("?")[0];
  return (type.startsWith("image/") && type !== "image/heic" && type !== "image/heif") || /\.(png|jpe?g|webp|gif|bmp|svg|avif)$/.test(raw);
}

export function isVideoAttachment(att: { name: string; type?: string | null; url?: string | null }): boolean {
  const type = String(att.type || "").toLowerCase();
  const raw = String(att.url || att.name || "").toLowerCase().split("?")[0];
  return type.startsWith("video/") || /\.(mp4|mov|webm|ogg|m4v)$/.test(raw);
}

export function folderTheme(f: Folder): React.CSSProperties {
  const themes: Record<Folder, { start: string; end: string; glow: string; border: string }> = {
    mails: {
      start: "rgba(56,189,248,0.30)",
      end: "rgba(167,139,250,0.26)",
      glow: "rgba(56,189,248,0.30)",
      border: "rgba(56,189,248,0.42)",
    },
    factures: {
      start: "rgba(251,146,60,0.30)",
      end: "rgba(244,114,182,0.22)",
      glow: "rgba(251,146,60,0.26)",
      border: "rgba(251,146,60,0.40)",
    },
    devis: {
      start: "rgba(167,139,250,0.30)",
      end: "rgba(56,189,248,0.24)",
      glow: "rgba(167,139,250,0.28)",
      border: "rgba(167,139,250,0.42)",
    },
    publications: {
      start: "rgba(244,114,182,0.28)",
      end: "rgba(251,146,60,0.22)",
      glow: "rgba(244,114,182,0.26)",
      border: "rgba(244,114,182,0.40)",
    },
    recoltes: {
      start: "rgba(56,189,248,0.26)",
      end: "rgba(34,197,94,0.20)",
      glow: "rgba(56,189,248,0.26)",
      border: "rgba(56,189,248,0.38)",
    },
    offres: {
      start: "rgba(251,146,60,0.28)",
      end: "rgba(167,139,250,0.22)",
      glow: "rgba(251,146,60,0.24)",
      border: "rgba(251,146,60,0.38)",
    },
    informations: {
      start: "rgba(56,189,248,0.24)",
      end: "rgba(244,114,182,0.18)",
      glow: "rgba(56,189,248,0.24)",
      border: "rgba(56,189,248,0.34)",
    },
    suivis: {
      start: "rgba(34,197,94,0.22)",
      end: "rgba(56,189,248,0.20)",
      glow: "rgba(34,197,94,0.20)",
      border: "rgba(34,197,94,0.34)",
    },
    enquetes: {
      start: "rgba(244,114,182,0.26)",
      end: "rgba(167,139,250,0.24)",
      glow: "rgba(244,114,182,0.24)",
      border: "rgba(244,114,182,0.36)",
    },
    propulsions: {
      start: "rgba(251,146,60,0.30)",
      end: "rgba(244,114,182,0.24)",
      glow: "rgba(251,146,60,0.26)",
      border: "rgba(251,146,60,0.40)",
    },
    fidelisations: {
      start: "rgba(34,197,94,0.24)",
      end: "rgba(56,189,248,0.20)",
      glow: "rgba(34,197,94,0.22)",
      border: "rgba(34,197,94,0.36)",
    },
    stats: {
      start: "rgba(125,92,255,0.30)",
      end: "rgba(56,189,248,0.22)",
      glow: "rgba(125,92,255,0.26)",
      border: "rgba(167,139,250,0.42)",
    },
  };

  const theme = themes[f];
  return {
    ["--folder-accent-start" as any]: theme.start,
    ["--folder-accent-end" as any]: theme.end,
    ["--folder-accent-glow" as any]: theme.glow,
    ["--folder-accent-border" as any]: theme.border,
  } as React.CSSProperties;
}

export function toolbarActionTheme(f: Folder): React.CSSProperties {
  const base = folderTheme(f) as React.CSSProperties & Record<string, string>;
  return {
    ["--toolbar-cta-start" as any]: String(base["--folder-accent-start"] || "rgba(56,189,248,0.26)"),
    ["--toolbar-cta-end" as any]: String(base["--folder-accent-end"] || "rgba(167,139,250,0.22)"),
    ["--toolbar-cta-glow" as any]: String(base["--folder-accent-glow"] || "rgba(56,189,248,0.16)"),
    ["--toolbar-cta-border" as any]: String(base["--folder-accent-border"] || "rgba(56,189,248,0.42)"),
  } as React.CSSProperties;
}


export function bulkConfirmationMessage(recipientCount: number): string {
  if (recipientCount >= BULK_CONFIRM_STRONG_THRESHOLD) {
    return `Confirmer l’envoi de cette campagne à ${recipientCount} destinataires ?\n\nChaque contact recevra un email individuel. Les quotas, pauses automatiques et reprises par vagues s’appliqueront si nécessaire.\n\nVérifiez l’objet, le contenu et la boîte d’envoi avant de continuer.`;
  }
  return `Confirmer l’envoi de cette campagne à ${recipientCount} destinataires ?\n\nChaque contact recevra un email individuel.`;
}

export function historyEmptyState(folder: Folder, view: BoxView, query: string): string {
  const trimmed = query.trim();
  if (trimmed) return `Aucun résultat pour “${trimmed}”.`;
  if (view === "drafts") return `Aucun brouillon dans ${folderLabel(folder).toLowerCase()}.`;
  switch (folder) {
    case "publications":
      return "Aucune publication pour le moment.";
    case "recoltes":
      return "Aucune récolte pour le moment.";
    case "offres":
      return "Aucune offre pour le moment.";
    case "informations":
      return "Aucune information envoyée pour le moment.";
    case "suivis":
      return "Aucun suivi envoyé pour le moment.";
    case "enquetes":
      return "Aucune enquête envoyée pour le moment.";
    case "propulsions":
      return "Aucune propulsion pour le moment.";
    case "fidelisations":
      return "Aucune fidélisation pour le moment.";
    case "stats":
      return "Aucun bilan statistique pour le moment.";
    case "factures":
      return "Aucune facture envoyée pour le moment.";
    case "devis":
      return "Aucun devis envoyé pour le moment.";
    default:
      return "Aucun mail pour le moment.";
  }
}

export function folderLabel(f: Folder) {
  switch (f) {
    case "mails":
      return "Mails";
    case "factures":
      return "Factures";
    case "devis":
      return "Devis";
    case "publications":
      return "Publications";
    case "recoltes":
      return "Récoltes";
    case "offres":
      return "Offres";
    case "propulsions":
      return "Propulsions";
    case "informations":
      return "Informations";
    case "suivis":
      return "Suivis";
    case "enquetes":
      return "Enquêtes";
    case "fidelisations":
      return "Fidélisations";
    case "stats":
      return "Stats";
  }
}

export type BoxView = "sent" | "drafts";

export function isVisibleInFolder(folder: Folder, item: OutboxItem, view: BoxView) {
  const itemGroupedFolder = (item.groupedFolder as Folder | null | undefined) || groupedFolderFor(item.folder);
  const folderMatches = isGroupedActionFolder(folder) ? itemGroupedFolder === folder : item.folder === folder;
  if (!folderMatches) return false;

  // Brouillons : uniquement pour l'historique send_items.
  if (view === "drafts") return (item.source === "send_items" || item.source === "app_events") && item.status === "draft";

  // Vue principale: uniquement les éléments réellement "envoyés" (ou en erreur), jamais les drafts.
  return item.status !== "draft";
}

export function pill(provider?: string | null) {
  const p = (provider || "").toLowerCase();
  if (p === "gmail") return { label: "Gmail", cls: styles.badgeGmail };
  if (p === "microsoft") return { label: "Microsoft", cls: styles.badgeMicrosoft };
  if (p === "imap") return { label: "IMAP", cls: styles.badgeImap };
  return { label: provider || "Mail", cls: styles.badgeDefault };
}

export function campaignCounts(raw: any) {
  return {
    total: Math.max(0, Number(raw?.total_count || 0) || 0),
    queued: Math.max(0, Number(raw?.queued_count || 0) || 0),
    processing: Math.max(0, Number(raw?.processing_count || 0) || 0),
    sent: Math.max(0, Number(raw?.sent_count || 0) || 0),
    failed: Math.max(0, Number(raw?.failed_count || 0) || 0),
  };
}

export function formatCampaignProgress(raw: any, locale = "fr-FR") {
  const counts = campaignCounts(raw);
  const formatNumber = new Intl.NumberFormat(locale).format;
  const bits = [`${formatNumber(counts.sent)}/${formatNumber(counts.total || counts.sent)} acceptés`];
  if (counts.processing > 0) bits.push(`${formatNumber(counts.processing)} en cours`);
  if (counts.queued > 0) bits.push(`${formatNumber(counts.queued)} en attente`);
  if (counts.failed > 0) bits.push(`${formatNumber(counts.failed)} en échec`);
  return bits.join(" • ");
}

export function formatCampaignDuration(
  value: number | null | undefined,
  lessThanMinute = "moins d’une minute",
) {
  const totalSeconds = Math.max(0, Math.round(Number(value || 0) / 1000));
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return lessThanMinute;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours} h ${minutes.toString().padStart(2, "0")}`;
  if (minutes > 0) return `${minutes} min${seconds >= 30 ? " 30 s" : ""}`;
  return `${seconds} s`;
}

export function campaignReportToHealth(report: CampaignExperienceReport | null | undefined): CampaignHealthSummary | null {
  if (!report) return null;
  return {
    total: report.counts.total,
    queued: report.counts.queued,
    processing: report.counts.processing,
    sent: report.counts.sent,
    failed: report.counts.failed,
    blocked: report.counts.blocked,
    opt_out: report.counts.unsubscribed,
    blacklist: report.counts.blacklist,
    retryable: report.counts.retryable,
  };
}


export function applyCampaignRecipientsFilter(query: any, filter: CampaignRecipientsFilterId) {
  switch (filter) {
    case "sent":
      return query.eq("status", "sent");
    case "queued":
      return query.eq("status", "queued");
    case "processing":
      return query.eq("status", "processing");
    case "failed":
      return query.eq("status", "failed");
    case "blocked":
      return query.eq("status", "failed").not("suppression_reason", "is", null);
    case "opt_out":
      return query.eq("suppression_reason", "opt_out");
    case "blacklist":
      return query.eq("suppression_reason", "blacklist");
    default:
      return query;
  }
}

export function formatCampaignFilterLabel(filter: CampaignRecipientsFilterId) {
  switch (filter) {
    case "sent":
      return "Envoyés";
    case "queued":
      return "En attente";
    case "processing":
      return "En cours";
    case "failed":
      return "Échecs";
    case "blocked":
      return "Bloqués";
    case "opt_out":
      return "Désinscrits";
    case "blacklist":
      return "Blacklist";
    default:
      return "Tous";
  }
}

export function getCampaignRecipientStatusLabel(recipient: CampaignRecipientLog, locale = "fr-FR") {
  if (recipient.status === "sent") {
    if (recipient.unsubscribed_at) {
      return `Envoyé • désinscrit le ${new Date(recipient.unsubscribed_at).toLocaleString(locale)}`;
    }
    if (recipient.delivery_status === "delivered" && recipient.delivered_at) {
      return `Délivré • ${new Date(recipient.delivered_at).toLocaleString(locale)}`;
    }
    if (recipient.delivery_status === "accepted") {
      return recipient.sent_at
        ? `Accepté par la messagerie d’envoi • ${new Date(recipient.sent_at).toLocaleString(locale)}`
        : "Accepté par la messagerie d’envoi";
    }
    if (recipient.sent_at) {
      return `Envoyé • ${new Date(recipient.sent_at).toLocaleString(locale)}`;
    }
    return "Envoyé";
  }

  if (recipient.status === "failed") {
    if (recipient.suppression_reason === "opt_out") return "Bloqué • désinscription";
    if (recipient.suppression_reason === "blacklist") return "Bloqué • blacklist";
    if (recipient.suppression_reason === "hard_bounce") return "Bloqué • rebond dur";
    if (recipient.suppression_reason === "complaint") return "Bloqué • plainte spam";
    if (recipient.bounce_type === "hard") return "Échec final • rebond dur";
    if (recipient.bounce_type === "soft") return "Échec final • rebond souple";
    if (recipient.failure_kind === "invalid_recipient") return "Échec final • adresse invalide";
    if (recipient.failure_kind === "blocked_recipient") return "Échec final • refus destinataire";
    return "Échec final";
  }

  if (recipient.status === "processing") return "En cours";
  if (recipient.next_attempt_at) {
    const retryLabel = recipient.failure_retryable ? "Nouvel essai" : "En attente";
    return `${retryLabel} • ${new Date(recipient.next_attempt_at).toLocaleString(locale)}`;
  }
  return "En attente";
}


export function formatOutboxStatusLabel(item: OutboxItem, locale = "fr-FR") {
  if (item.source === "mail_campaigns") {
    const raw = (item.raw || {}) as any;
    const status = String(raw?.status || item.status || "").toLowerCase();
    const counts = campaignCounts(raw);
    if (status === "queued") return `En attente • ${formatCampaignProgress(raw, locale)}`;
    if (status === "processing") return `Campagne en cours • ${formatCampaignProgress(raw, locale)}`;
    if (status === "paused") {
      const resumeAt = raw?.resume_at ? new Date(raw.resume_at) : null;
      const hasValidResumeAt = resumeAt && Number.isFinite(resumeAt.getTime());
      if (hasValidResumeAt) return `Campagne en pause • reprise automatique le ${resumeAt.toLocaleString(locale)}`;
      return raw?.last_error
        ? `Campagne en pause • ${getUserFacingMailError(raw.last_error, raw?.provider)}`
        : `Campagne en pause • ${formatCampaignProgress(raw, locale)}`;
    }
    if (status === "partial") return `Campagne partielle • ${formatCampaignProgress(raw, locale)}`;
    if (status === "failed") return `Campagne en échec • ${new Intl.NumberFormat(locale).format(counts.failed)}/${new Intl.NumberFormat(locale).format(counts.total || counts.failed)} en échec`;
    if (status === "sent" || status === "completed") return item.sent_at ? `Campagne terminée • ${new Date(item.sent_at).toLocaleString(locale)}` : `Campagne terminée • ${formatCampaignProgress(raw, locale)}`;
    return `Campagne • ${formatCampaignProgress(raw, locale)}`;
  }

  if (item.status === "draft") return "Brouillon";
  if (item.status === "error" || item.status === "failed") return "En échec";
  if (item.source === "inr_agent_actions") {
    return item.sent_at ? `Bilan envoyé • ${new Date(item.sent_at).toLocaleString(locale)}` : `Bilan généré • ${new Date(item.created_at).toLocaleString(locale)}`;
  }
  return item.sent_at ? `Envoyé • ${new Date(item.sent_at).toLocaleString(locale)}` : `Historique • ${new Date(item.created_at).toLocaleString(locale)}`;
}

export function isRetryableCampaignItem(item: OutboxItem | null) {
  if (!item || item.source !== "mail_campaigns") return false;
  const raw = (item.raw || {}) as any;
  const counts = campaignCounts(raw);
  return String(raw?.status || item.status || "").toLowerCase() === "paused" || counts.failed > 0;
}

export function listGridTemplateColumns(folder: Folder) {
  if (isGroupedActionFolder(folder)) {
    return "minmax(360px, 2.35fr) minmax(88px, 108px) minmax(150px, 0.82fr) minmax(145px, 170px) 78px";
  }
  if (folder === "publications") {
    return "minmax(0, 1.35fr) minmax(190px, 0.95fr) minmax(150px, 180px) 86px";
  }
  if (folder === "factures" || folder === "devis") {
    return "minmax(0, 1.35fr) minmax(190px, 0.95fr) minmax(150px, 180px) 86px";
  }
  return "minmax(0, 1.35fr) minmax(190px, 0.95fr) minmax(150px, 180px) 86px";
}
