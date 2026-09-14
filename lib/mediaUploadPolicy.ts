import {
  INR_MEDIA_IMAGE_MAX_BYTES,
  INR_MEDIA_IMAGE_MAX_MB_LABEL,
  INR_MEDIA_VIDEO_SOURCE_MAX_BYTES,
  INR_MEDIA_VIDEO_SOURCE_MAX_MB_LABEL,
} from "./mediaRules.ts";

/**
 * Règles de transport du pipeline média universel iNrCy.
 *
 * Ces valeurs ne sont pas des limites éditoriales visibles par le professionnel.
 * Elles protègent uniquement l'infrastructure contre les fichiers anormaux ou
 * les abus. La normalisation et les limites finales des réseaux sont traitées
 * par les étapes suivantes du pipeline.
 */

export const UNIVERSAL_MEDIA_STANDARD_UPLOAD_MAX_BYTES = 6 * 1024 * 1024;
export const UNIVERSAL_MEDIA_TUS_CHUNK_SIZE_BYTES = 6 * 1024 * 1024;
export const UNIVERSAL_MEDIA_TUS_RETRY_DELAYS_MS = [
  0,
  3_000,
  5_000,
  10_000,
  20_000,
] as const;

export const UNIVERSAL_MEDIA_IMAGE_HARD_MAX_BYTES = 500 * 1024 * 1024;
export const UNIVERSAL_MEDIA_VIDEO_HARD_MAX_BYTES = 5 * 1024 * 1024 * 1024;

export const UNIVERSAL_MEDIA_UPLOAD_TARGETS = [
  "booster_prepared_image",
  "booster_draft_image",
  "booster_video_source",
  "media_library_source",
  "workspace_source",
  "ai_identity_reference",
] as const;

export type UniversalMediaUploadTarget =
  (typeof UNIVERSAL_MEDIA_UPLOAD_TARGETS)[number];
export type UniversalMediaUploadProtocol = "signed" | "tus";
export type UniversalUploadMediaType = "image" | "video";

const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/x-png",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
  "image/tif",
  "image/tiff",
  "image/bmp",
  "image/x-bmp",
  "image/x-ms-bmp",
]);

export const UNIVERSAL_MEDIA_VIDEO_MIME_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/x-m4v",
  "video/webm",
  "video/mpeg",
  "video/x-msvideo",
  "video/x-matroska",
  "video/3gpp",
  "video/3gpp2",
  "video/mp2t",
  "video/x-ms-wmv",
  "video/x-flv",
  "video/ogg",
] as const;

const VIDEO_MIME_TYPES = new Set<string>(UNIVERSAL_MEDIA_VIDEO_MIME_TYPES);

const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "jpe",
  "jfif",
  "png",
  "webp",
  "gif",
  "avif",
  "heic",
  "heif",
  "tif",
  "tiff",
  "bmp",
]);

export const UNIVERSAL_MEDIA_VIDEO_EXTENSIONS = [
  "mp4",
  "mov",
  "m4v",
  "webm",
  "mpeg",
  "mpg",
  "avi",
  "mkv",
  "3gp",
  "3g2",
  "ts",
  "mts",
  "m2ts",
  "wmv",
  "flv",
  "ogv",
  "qt",
] as const;

const VIDEO_EXTENSIONS = new Set<string>(UNIVERSAL_MEDIA_VIDEO_EXTENSIONS);

const MIME_TO_EXTENSION: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/x-png": "png",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/heic-sequence": "heic",
  "image/heif-sequence": "heif",
  "image/tif": "tiff",
  "image/tiff": "tiff",
  "image/bmp": "bmp",
  "image/x-bmp": "bmp",
  "image/x-ms-bmp": "bmp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/x-m4v": "m4v",
  "video/webm": "webm",
  "video/mpeg": "mpeg",
  "video/x-msvideo": "avi",
  "video/x-matroska": "mkv",
  "video/3gpp": "3gp",
  "video/3gpp2": "3g2",
  "video/mp2t": "ts",
  "video/x-ms-wmv": "wmv",
  "video/x-flv": "flv",
  "video/ogg": "ogv",
};

export function normalizeUniversalMediaMime(value: unknown): string {
  return (
    String(value || "")
      .toLowerCase()
      .split(";")[0]
      ?.trim() || ""
  );
}

export function getUniversalMediaFileExtension(name: unknown): string {
  const rawName = String(name || "")
    .replace(/\\/g, "/")
    .split("/")
    .pop();
  if (!rawName || !rawName.includes(".")) return "";
  return rawName.split(".").pop()?.toLowerCase() || "";
}

export function detectUniversalUploadMediaType(params: {
  name?: unknown;
  mimeType?: unknown;
}): UniversalUploadMediaType | null {
  const mime = normalizeUniversalMediaMime(params.mimeType);
  const extension = getUniversalMediaFileExtension(params.name);

  if (IMAGE_MIME_TYPES.has(mime) || IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }
  if (VIDEO_MIME_TYPES.has(mime) || VIDEO_EXTENSIONS.has(extension)) {
    return "video";
  }
  return null;
}

export function getUniversalMediaContentType(params: {
  name?: unknown;
  mimeType?: unknown;
  mediaType: UniversalUploadMediaType;
}): string {
  const mime = normalizeUniversalMediaMime(params.mimeType);
  if (
    (params.mediaType === "image" && IMAGE_MIME_TYPES.has(mime)) ||
    (params.mediaType === "video" && VIDEO_MIME_TYPES.has(mime))
  ) {
    return mime;
  }

  const extension = getUniversalMediaFileExtension(params.name);
  const extensionMime: Readonly<Record<string, string>> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    jpe: "image/jpeg",
    jfif: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    avif: "image/avif",
    heic: "image/heic",
    heif: "image/heif",
    tif: "image/tiff",
    tiff: "image/tiff",
    bmp: "image/bmp",
    mp4: "video/mp4",
    mov: "video/quicktime",
    m4v: "video/x-m4v",
    webm: "video/webm",
    mpeg: "video/mpeg",
    mpg: "video/mpeg",
    avi: "video/x-msvideo",
    mkv: "video/x-matroska",
    "3gp": "video/3gpp",
    "3g2": "video/3gpp2",
    ts: "video/mp2t",
    mts: "video/mp2t",
    m2ts: "video/mp2t",
    wmv: "video/x-ms-wmv",
    flv: "video/x-flv",
    ogv: "video/ogg",
    qt: "video/quicktime",
  };

  return (
    extensionMime[extension] ||
    (params.mediaType === "video" ? "video/mp4" : "image/jpeg")
  );
}

export function getUniversalMediaSafeExtension(params: {
  name?: unknown;
  mimeType?: unknown;
  mediaType: UniversalUploadMediaType;
}): string {
  const mime = getUniversalMediaContentType(params);
  const byMime = MIME_TO_EXTENSION[mime];
  if (byMime) return byMime;

  const extension = getUniversalMediaFileExtension(params.name);
  const allowed =
    params.mediaType === "image" ? IMAGE_EXTENSIONS : VIDEO_EXTENSIONS;
  if (allowed.has(extension)) return extension === "jpeg" ? "jpg" : extension;
  return params.mediaType === "video" ? "mp4" : "jpg";
}

export function selectUniversalMediaUploadProtocol(
  sizeBytes: number,
): UniversalMediaUploadProtocol {
  return Number(sizeBytes || 0) > UNIVERSAL_MEDIA_STANDARD_UPLOAD_MAX_BYTES
    ? "tus"
    : "signed";
}

export function getUniversalMediaProductMaxBytes(
  mediaType: UniversalUploadMediaType,
): number {
  return mediaType === "video"
    ? INR_MEDIA_VIDEO_SOURCE_MAX_BYTES
    : INR_MEDIA_IMAGE_MAX_BYTES;
}

export function getUniversalMediaProductMaxLabel(
  mediaType: UniversalUploadMediaType,
): string {
  return mediaType === "video"
    ? INR_MEDIA_VIDEO_SOURCE_MAX_MB_LABEL
    : INR_MEDIA_IMAGE_MAX_MB_LABEL;
}

export function getUniversalMediaHardMaxBytes(
  mediaType: UniversalUploadMediaType,
): number {
  return mediaType === "video"
    ? UNIVERSAL_MEDIA_VIDEO_HARD_MAX_BYTES
    : UNIVERSAL_MEDIA_IMAGE_HARD_MAX_BYTES;
}

export function isUniversalMediaUploadTarget(
  value: unknown,
): value is UniversalMediaUploadTarget {
  return UNIVERSAL_MEDIA_UPLOAD_TARGETS.includes(
    String(value || "") as UniversalMediaUploadTarget,
  );
}

export function targetAcceptsUniversalMediaType(
  target: UniversalMediaUploadTarget,
  mediaType: UniversalUploadMediaType,
): boolean {
  if (
    target === "booster_prepared_image" ||
    target === "booster_draft_image" ||
    target === "ai_identity_reference"
  ) {
    return mediaType === "image";
  }
  if (target === "booster_video_source") return mediaType === "video";
  return true;
}

export function buildDirectStorageResumableEndpoint(
  supabaseUrl: string,
): string {
  const parsed = new URL(String(supabaseUrl || "").trim());
  const hostname = parsed.hostname;
  const projectRef = hostname.split(".")[0] || "";
  if (!projectRef) {
    throw new Error("URL Supabase invalide pour l'upload résumable.");
  }
  return `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable/sign`;
}

export function sanitizeUniversalMediaSegment(
  value: unknown,
  fallback: string,
  maxLength = 90,
): string {
  const safe = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’'`]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/[-_]{2,}/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, maxLength);
  return safe || fallback;
}

export function sanitizeUniversalMediaFileName(params: {
  name?: unknown;
  mimeType?: unknown;
  mediaType: UniversalUploadMediaType;
}): string {
  const rawName =
    String(params.name || "media-inrcy")
      .replace(/\\/g, "/")
      .split("/")
      .pop() || "media-inrcy";
  const base = sanitizeUniversalMediaSegment(
    rawName.replace(/\.[^.]*$/, ""),
    "media-inrcy",
    80,
  );
  return `${base}.${getUniversalMediaSafeExtension(params)}`.toLowerCase();
}

export function clampUniversalUploadProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}
