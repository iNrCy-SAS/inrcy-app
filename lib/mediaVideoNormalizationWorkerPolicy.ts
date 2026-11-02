import { type BoosterPreparationMission } from "@/lib/boosterMediaPipelineMissions";
import { readRequestedVideoPreparationKeys, readVideoPreparationMission } from "@/lib/mediaVideoNormalizationMissionState";
import { getVideoNormalizationPurpose } from "@/lib/mediaVideoNormalizationPolicy";
import { canPublishVideoSourceDirectly } from "@/lib/mediaVideoSourceCompatibility";
import { INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES } from "@/lib/mediaRules";
import { type ClaimedVideoJob, type MediaRow, type VariantRow } from "@/lib/mediaVideoNormalizationWorkerTypes";

export class VideoNormalizationError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = "VideoNormalizationError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function compactMessage(error: unknown) {
  const record = error as { stderr?: unknown; message?: unknown } | null;
  return String(record?.stderr || record?.message || error || "Erreur inconnue")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1_500);
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function canPublishOriginalVideo(params: {
  media: Pick<
    MediaRow,
    | "original_file_name"
    | "mime_type"
    | "detected_mime_type"
    | "storage_path"
    | "size_bytes"
  >;
  sourceProbe: Record<string, unknown>;
}) {
  return canPublishVideoSourceDirectly({
    name: params.media.original_file_name,
    mimeType: params.media.detected_mime_type || params.media.mime_type,
    storagePath: params.media.storage_path,
    sizeBytes: params.media.size_bytes,
    maxBytes: INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES,
    videoCodec: params.sourceProbe.videoCodec,
    audioCodec: params.sourceProbe.audioCodec,
    frameRate: params.sourceProbe.frameRate,
    hasAudio: params.sourceProbe.hasAudio,
    pixelFormat: params.sourceProbe.pixelFormat,
    containerFormats: params.sourceProbe.containerFormats,
    requireCodecProof: true,
  });
}

export function persistedSourceProbe(mediaMetadata: unknown) {
  const normalization = asRecord(asRecord(mediaMetadata).video_normalization);
  return asRecord(normalization.source);
}

export function readPreparationMission(
  job: ClaimedVideoJob,
): BoosterPreparationMission | null {
  return readVideoPreparationMission(job.payload);
}

export function requiredVideoKeys(job: ClaimedVideoJob) {
  const mission = readPreparationMission(job);
  return {
    mission,
    keys: readRequestedVideoPreparationKeys({
      payload: job.payload,
      fallbackMission: mission,
    }),
  };
}

export function classifyWorkerError(error: unknown) {
  if (error instanceof VideoNormalizationError) return error;
  const message = compactMessage(error).toLowerCase();
  const terminal =
    message.includes("video_source_too_large") ||
    message.includes("video_dimensions_unavailable") ||
    message.includes("video_duration_unavailable") ||
    message.includes("video_output_too_large") ||
    message.includes("video_frame_too_large") ||
    message.includes("video_audio_too_large") ||
    message.includes("invalid data found") ||
    message.includes("moov atom not found") ||
    message.includes("could not find codec parameters") ||
    message.includes("unsupported codec") ||
    message.includes("video_probe_failed") ||
    message.includes("corrupt") ||
    message.includes("decode");

  return new VideoNormalizationError(
    terminal ? "video_decode_failed" : "video_worker_temporary_failure",
    compactMessage(error),
    !terminal,
  );
}

export function readyVariantOutput(variant: VariantRow) {
  if (variant.status !== "ready") return null;
  const metadata = asRecord(variant.variant_metadata);
  const available = metadata.available !== false;
  if (available && (!variant.bucket_name || !variant.storage_path)) return null;
  const fallbackMimeType =
    variant.key === "audio_track"
      ? ("audio/mpeg" as const)
      : variant.key.startsWith("frame_") || variant.key === "thumbnail"
        ? ("image/jpeg" as const)
        : ("video/mp4" as const);
  const mimeType =
    variant.mime_type === "video/mp4" ||
    variant.mime_type === "image/jpeg" ||
    variant.mime_type === "audio/mpeg"
      ? variant.mime_type
      : fallbackMimeType;
  return {
    key: variant.key,
    purpose: getVideoNormalizationPurpose(variant.key),
    variantId: variant.id,
    available,
    bucket: variant.bucket_name,
    storagePath: variant.storage_path,
    mimeType,
    sizeBytes: Number(variant.size_bytes || 0),
    width: variant.width,
    height: variant.height,
    durationSeconds: Number(variant.duration_seconds || 0),
  };
}
