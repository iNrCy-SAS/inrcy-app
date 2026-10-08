import { createHash } from "node:crypto";
import { INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES } from "./mediaRules.ts";

// Server orchestration only. Upload checkpoints contain signed capabilities;
// persist them with the publication operation, never return them to a client.
export const LINKEDIN_ADS_VIDEO_MAX_BYTES = Math.min(500_000_000, INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES, 100 * 1024 * 1024);
export const LINKEDIN_ADS_VIDEO_MIN_BYTES = 75_000;
export const LINKEDIN_ADS_VIDEO_MIN_DURATION_MS = 3_000;
export const LINKEDIN_ADS_VIDEO_MAX_DURATION_MS = 30 * 60_000;

type VideoPhase = "initializing" | "uploading" | "uploaded" | "finalizing" | "processing" | "available";
export type LinkedInVideoUploadPart = {
  firstByte: number;
  lastByte: number;
  uploadUrl: string;
  partId?: string;
};

export type LinkedInVideoCheckpoint = {
  schemaVersion: 1;
  operationKey: string;
  ownerUrn: string;
  sourceIdentity: string;
  sourceDigest: string;
  fileSizeBytes: number;
  durationMs: number;
  phase: VideoPhase;
  videoUrn?: string;
  uploadToken?: string;
  uploadUrlsExpireAt?: number;
  parts: LinkedInVideoUploadPart[];
};

export type LinkedInAdsVideoSource = { bytes: Uint8Array; contentType: string; sourceIdentity: string };
export type LinkedInAdsVideoDependencies = {
  /** Existing authenticated/versioned REST adapters; do not retry POST writes. */
  read: (path: string) => Promise<Record<string, unknown>>;
  write: (path: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>;
  fetchImpl: typeof fetch;
  persist: (checkpoint: LinkedInVideoCheckpoint) => Promise<void>;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  pollAttempts?: number;
};

export class LinkedInVideoUploadError extends Error {
  readonly code: string;
  readonly checkpoint: LinkedInVideoCheckpoint | null;
  readonly retrySafe: boolean;
  constructor(
    message: string,
    code: string,
    checkpoint: LinkedInVideoCheckpoint | null,
    retrySafe: boolean,
  ) {
    super(message);
    this.name = "LinkedInVideoUploadError";
    this.code = code;
    this.checkpoint = checkpoint;
    this.retrySafe = retrySafe;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function linkedInAdsVideoUrn(value: unknown): string | null {
  const urn = text(value);
  return /^urn:li:video:[A-Za-z0-9_-]{3,200}$/.test(urn) ? urn : null;
}

export function isSafeLinkedInVideoUploadUrl(value: unknown): boolean {
  try {
    const url = new URL(text(value));
    return url.protocol === "https:" && url.hostname.toLowerCase() === "www.linkedin.com"
      && !url.port && url.pathname.startsWith("/dms-uploads/") && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function uint64(view: DataView, offset: number): number {
  const value = view.getUint32(offset) * 4_294_967_296 + view.getUint32(offset + 4);
  if (!Number.isSafeInteger(value)) throw new TypeError("MP4 integer exceeds safe precision");
  return value;
}

/** Inspect MP4 container metadata without re-encoding or relying on a MIME label. */
export function validateLinkedInAdsVideoSource(source: LinkedInAdsVideoSource): { durationMs: number; digest: string } {
  const bytes = source.bytes;
  const mime = source.contentType.toLowerCase().split(";")[0].trim();
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < LINKEDIN_ADS_VIDEO_MIN_BYTES
    || bytes.byteLength > LINKEDIN_ADS_VIDEO_MAX_BYTES || !["video/mp4", "application/mp4"].includes(mime)) {
    throw new TypeError("La vidéo LinkedIn doit être un MP4 de 75 Ko à 75 Mo, prêt à publier.");
  }
  if (!text(source.sourceIdentity) || source.sourceIdentity.length > 200) throw new TypeError("La source vidéo doit être identifiée.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let mp4Brand = false;
  let durationMs = NaN;
  let boxCount = 0;
  const inspect = (begin: number, end: number, movie = false) => {
    let cursor = begin;
    while (cursor < end) {
      if (++boxCount > 10_000 || end - cursor < 8) throw new TypeError("Invalid MP4 box structure");
      let size = view.getUint32(cursor);
      const type = ascii(bytes, cursor + 4, 4);
      let header = 8;
      if (size === 1) {
        if (end - cursor < 16) throw new TypeError("Invalid extended MP4 box");
        size = uint64(view, cursor + 8);
        header = 16;
      } else if (size === 0) size = end - cursor;
      if (size < header || size > end - cursor) throw new TypeError("Invalid MP4 box size");
      const data = cursor + header;
      if (!movie && type === "ftyp") {
        if (size < header + 8) throw new TypeError("Invalid MP4 brand");
        const brands = [ascii(bytes, data, 4)];
        for (let offset = data + 8; offset + 4 <= cursor + size; offset += 4) brands.push(ascii(bytes, offset, 4));
        mp4Brand = brands.some((brand) => /^(?:isom|iso[2-9]|mp4[12]|avc1|dash|M4V )$/.test(brand));
      } else if (!movie && type === "moov") inspect(data, cursor + size, true);
      else if (movie && type === "mvhd") {
        if (size < header + 20) throw new TypeError("Invalid MP4 duration");
        const version = view.getUint8(data);
        if (version !== 0 && version !== 1) throw new TypeError("Unsupported MP4 metadata version");
        if (version === 1 && size < header + 32) throw new TypeError("Invalid MP4 duration");
        const timescale = view.getUint32(data + (version === 1 ? 20 : 12));
        const duration = version === 1 ? uint64(view, data + 24) : view.getUint32(data + 16);
        durationMs = timescale ? duration * 1_000 / timescale : NaN;
      }
      cursor += size;
    }
  };
  inspect(0, bytes.byteLength);
  if (!mp4Brand || !Number.isFinite(durationMs) || durationMs < LINKEDIN_ADS_VIDEO_MIN_DURATION_MS
    || durationMs > LINKEDIN_ADS_VIDEO_MAX_DURATION_MS) {
    throw new TypeError("La vidéo LinkedIn doit être un MP4 de 3 secondes à 30 minutes avec une durée vérifiable.");
  }
  return { durationMs, digest: createHash("sha256").update(bytes).digest("hex") };
}

function validateParts(parts: LinkedInVideoUploadPart[], size: number): void {
  let next = 0;
  if (!parts.length || parts.length > 128) throw new TypeError("Invalid LinkedIn video upload parts");
  for (const part of parts) {
    if (!Number.isSafeInteger(part.firstByte) || !Number.isSafeInteger(part.lastByte)
      || part.firstByte !== next || part.lastByte < part.firstByte || part.lastByte >= size
      || !isSafeLinkedInVideoUploadUrl(part.uploadUrl)
      || (part.partId !== undefined && (!part.partId || part.partId.length > 4_096 || /[\r\n]/.test(part.partId)))) {
      throw new TypeError("Invalid LinkedIn video upload instructions");
    }
    next = part.lastByte + 1;
  }
  if (next !== size) throw new TypeError("LinkedIn video upload instructions must cover the complete source");
}

export function assertLinkedInVideoCheckpoint(checkpoint: LinkedInVideoCheckpoint): void {
  if (checkpoint.schemaVersion !== 1 || !text(checkpoint.operationKey)
    || !/^urn:li:organization:\d{1,25}$/.test(checkpoint.ownerUrn)
    || !text(checkpoint.sourceIdentity) || checkpoint.sourceIdentity.length > 200
    || !/^[a-f0-9]{64}$/.test(checkpoint.sourceDigest)
    || !Number.isSafeInteger(checkpoint.fileSizeBytes) || checkpoint.fileSizeBytes < LINKEDIN_ADS_VIDEO_MIN_BYTES
    || checkpoint.fileSizeBytes > LINKEDIN_ADS_VIDEO_MAX_BYTES
    || !Number.isFinite(checkpoint.durationMs) || checkpoint.durationMs < LINKEDIN_ADS_VIDEO_MIN_DURATION_MS
    || checkpoint.durationMs > LINKEDIN_ADS_VIDEO_MAX_DURATION_MS
    || !["initializing", "uploading", "uploaded", "finalizing", "processing", "available"].includes(checkpoint.phase)
    || !Array.isArray(checkpoint.parts)) throw new TypeError("Invalid LinkedIn video checkpoint");
  if (checkpoint.phase === "initializing") {
    if (checkpoint.videoUrn || checkpoint.parts.length || checkpoint.uploadToken !== undefined) throw new TypeError("Invalid initialization checkpoint");
    return;
  }
  if (!linkedInAdsVideoUrn(checkpoint.videoUrn)) throw new TypeError("Invalid LinkedIn video checkpoint URN");
  if (checkpoint.phase === "available") {
    if (checkpoint.parts.length || checkpoint.uploadToken !== undefined || checkpoint.uploadUrlsExpireAt !== undefined) {
      throw new TypeError("Available video checkpoints cannot retain upload capabilities");
    }
    return;
  }
  if (typeof checkpoint.uploadToken !== "string" || checkpoint.uploadToken.length > 4_096
    || (checkpoint.uploadUrlsExpireAt !== undefined && !Number.isSafeInteger(checkpoint.uploadUrlsExpireAt))) {
    throw new TypeError("Invalid LinkedIn video upload session");
  }
  validateParts(checkpoint.parts, checkpoint.fileSizeBytes);
  if (checkpoint.phase !== "uploading" && checkpoint.parts.some((part) => !part.partId)) {
    throw new TypeError("Incomplete LinkedIn video part checkpoint");
  }
}

/** Durable multipart upload. An uncertain initialize is never issued a second time. */
export async function uploadLinkedInAdsVideo(input: {
  operationKey: string;
  ownerUrn: string;
  source: LinkedInAdsVideoSource;
  checkpoint?: LinkedInVideoCheckpoint | null;
}, deps: LinkedInAdsVideoDependencies): Promise<{ videoUrn: string; checkpoint: LinkedInVideoCheckpoint }> {
  let checkpoint: LinkedInVideoCheckpoint | null = input.checkpoint || null;
  const fail = (message: string, code: string, retrySafe = true): never => {
    throw new LinkedInVideoUploadError(message, code, checkpoint, retrySafe);
  };
  const persist = async (next: LinkedInVideoCheckpoint) => {
    assertLinkedInVideoCheckpoint(next);
    checkpoint = structuredClone(next);
    try { await deps.persist(structuredClone(checkpoint)); }
    catch { fail("La progression du téléversement vidéo n’a pas pu être enregistrée.", "checkpoint_unavailable", false); }
  };
  try {
    if (!/^urn:li:organization:\d{1,25}$/.test(input.ownerUrn) || !text(input.operationKey)
      || typeof deps.persist !== "function") throw new TypeError("Invalid LinkedIn video operation");
    const media = validateLinkedInAdsVideoSource(input.source);
    if (checkpoint) {
      assertLinkedInVideoCheckpoint(checkpoint);
      if (checkpoint.operationKey !== input.operationKey || checkpoint.ownerUrn !== input.ownerUrn
        || checkpoint.sourceIdentity !== input.source.sourceIdentity || checkpoint.sourceDigest !== media.digest
        || checkpoint.fileSizeBytes !== input.source.bytes.byteLength || checkpoint.durationMs !== media.durationMs) {
        fail("La vidéo ne correspond pas à cette opération de publication.", "checkpoint_mismatch", false);
      }
      checkpoint = structuredClone(checkpoint);
      if (checkpoint.phase === "initializing") fail("Le résultat de l’initialisation vidéo est inconnu. Contrôlez LinkedIn avant de réessayer.", "initialize_unknown", false);
    } else {
      await persist({
        schemaVersion: 1, operationKey: input.operationKey, ownerUrn: input.ownerUrn,
        sourceIdentity: input.source.sourceIdentity, sourceDigest: media.digest,
        fileSizeBytes: input.source.bytes.byteLength, durationMs: media.durationMs, phase: "initializing", parts: [],
      });
      let initialized: Record<string, unknown>;
      try {
        initialized = await deps.write("/rest/videos?action=initializeUpload", {
          initializeUploadRequest: { owner: input.ownerUrn, fileSizeBytes: input.source.bytes.byteLength, uploadCaptions: false, uploadThumbnail: false },
        });
      } catch {
        fail("LinkedIn n’a pas confirmé l’initialisation de la vidéo. Une nouvelle initialisation automatique est bloquée.", "initialize_unknown", false);
      }
      const value = record(initialized!.value);
      const videoUrn = linkedInAdsVideoUrn(value.video);
      if (!videoUrn || !Array.isArray(value.uploadInstructions) || typeof value.uploadToken !== "string") {
        fail("LinkedIn n’a pas fourni une session de téléversement vidéo valide.", "initialize_invalid", false);
      }
      const parts = (value.uploadInstructions as unknown[]).map((item) => {
        const part = record(item);
        return { firstByte: part.firstByte as number, lastByte: part.lastByte as number, uploadUrl: text(part.uploadUrl) };
      });
      await persist({ ...checkpoint!, phase: "uploading", videoUrn: videoUrn!, uploadToken: value.uploadToken as string,
        uploadUrlsExpireAt: value.uploadUrlsExpireAt as number | undefined, parts });
    }
    if (checkpoint!.phase === "uploading") {
      if (checkpoint!.uploadUrlsExpireAt !== undefined && checkpoint!.uploadUrlsExpireAt <= (deps.now || Date.now)()) {
        fail("La session de téléversement vidéo LinkedIn a expiré.", "upload_expired", false);
      }
      for (let index = 0; index < checkpoint!.parts.length; index += 1) {
        const part = checkpoint!.parts[index];
        if (part.partId) continue;
        let response: Response;
        try {
          response = await deps.fetchImpl(part.uploadUrl, {
            method: "PUT", redirect: "error", headers: { "Content-Type": "application/octet-stream" },
            body: input.source.bytes.slice(part.firstByte, part.lastByte + 1) as BodyInit,
          });
        } catch { fail("Le téléversement de la vidéo LinkedIn a été interrompu.", "part_upload_failed"); }
        if (!response!.ok) fail("LinkedIn refuse une partie du téléversement vidéo.", "part_upload_failed");
        const rawId = text(response!.headers.get("etag"));
        const partId = rawId.replace(/^"(.*)"$/, "$1");
        if (!partId || partId.length > 4_096 || /[\r\n]/.test(partId)) fail("LinkedIn n’a pas confirmé une partie de la vidéo.", "part_id_missing");
        await persist({ ...checkpoint!, parts: checkpoint!.parts.map((entry, position) => position === index ? { ...entry, partId } : entry) });
      }
      await persist({ ...checkpoint!, phase: "uploaded" });
    }
    if (checkpoint!.phase === "uploaded") {
      await persist({ ...checkpoint!, phase: "finalizing" });
      try {
        await deps.write("/rest/videos?action=finalizeUpload", {
          finalizeUploadRequest: { video: checkpoint!.videoUrn, uploadToken: checkpoint!.uploadToken,
            uploadedPartIds: checkpoint!.parts.map((part) => part.partId) },
        });
      } catch {
        // Finalize may have succeeded; preserve this session and only read on recovery.
        fail("La finalisation vidéo n’est pas encore confirmée par LinkedIn. La reprise contrôlera son état.", "finalize_unconfirmed");
      }
      await persist({ ...checkpoint!, phase: "processing" });
    }
    const attempts = Math.min(20, Math.max(1, deps.pollAttempts ?? 6));
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const video = await deps.read(`/rest/videos/${encodeURIComponent(checkpoint!.videoUrn!)}`);
      if (video.id !== checkpoint!.videoUrn || video.owner !== input.ownerUrn) {
        fail("LinkedIn n’a pas confirmé le propriétaire de la vidéo.", "video_owner_mismatch", false);
      }
      if (video.status === "AVAILABLE") {
        const duration = Number(video.duration);
        if (!Number.isFinite(duration) || duration < LINKEDIN_ADS_VIDEO_MIN_DURATION_MS || duration > LINKEDIN_ADS_VIDEO_MAX_DURATION_MS) {
          fail("LinkedIn n’a pas confirmé une durée vidéo compatible.", "video_duration_invalid", false);
        }
        await persist({ ...checkpoint!, phase: "available", parts: [], uploadToken: undefined, uploadUrlsExpireAt: undefined });
        return { videoUrn: checkpoint!.videoUrn!, checkpoint: structuredClone(checkpoint!) };
      }
      if (video.status === "PROCESSING_FAILED") fail("LinkedIn n’a pas pu traiter cette vidéo.", "video_processing_failed", false);
      if (video.status !== "PROCESSING" && video.status !== "WAITING_UPLOAD") fail("L’état de la vidéo LinkedIn est inconnu.", "video_status_invalid", false);
      if (attempt + 1 < attempts) await (deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(1_000);
    }
    return fail("La vidéo est encore en cours de traitement par LinkedIn. Reprenez cette même publication dans quelques instants.", "video_processing_pending");
  } catch (error) {
    if (error instanceof LinkedInVideoUploadError) throw error;
    throw new LinkedInVideoUploadError(
      error instanceof TypeError ? error.message : "Le contrôle de la vidéo LinkedIn est indisponible.",
      error instanceof TypeError ? "video_invalid" : "video_read_unavailable", checkpoint,
      !(error instanceof TypeError) && checkpoint?.phase !== "initializing",
    );
  }
}
