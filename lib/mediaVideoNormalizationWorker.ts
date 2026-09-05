import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { refreshPublicationWorkspaceStatusesForMedia } from "@/lib/mediaWorkspaceServer";
import { createSafeStorageSignedUrl } from "@/lib/safeStorageSignedUrl";
import type { BoosterPreparationMission } from "@/lib/boosterMediaPipelineMissions";
import { claimTargetedProcessingJob } from "@/lib/mediaProcessingTargetedClaim";
import {
  findUnfulfilledVideoPreparationKeys,
  mergeVideoPreparationRequest,
  readRequestedVideoPreparationKeys,
  readVideoPreparationMission,
} from "@/lib/mediaVideoNormalizationMissionState";
import { planVideoNormalizationExecution } from "@/lib/mediaVideoNormalizationExecutionPlan";
import { planVideoNormalizationFailure } from "@/lib/mediaVideoNormalizationFailurePlan";
import {
  mapVideoNormalizationStageProgress,
  resolveVideoNormalizationProgressWindow,
  type VideoNormalizationProgressWindow,
} from "@/lib/mediaVideoNormalizationProgress";
import {
  VIDEO_NORMALIZATION_DEFAULT_BATCH_SIZE,
  VIDEO_NORMALIZATION_JOB_TYPE,
  VIDEO_NORMALIZATION_MAX_BATCH_SIZE,
  VIDEO_NORMALIZATION_MAX_SOURCE_BYTES,
  VIDEO_NORMALIZATION_MAX_SOURCE_MB_LABEL,
  VIDEO_NORMALIZATION_PIPELINE_VERSION,
  VIDEO_NORMALIZATION_VARIANT_KEYS,
  VIDEO_NORMALIZATION_WORKER_LEASE_SECONDS,
  buildVideoNormalizationStoragePath,
  getVideoNormalizationKeyFromSignature,
  getVideoNormalizationPurpose,
  getVideoNormalizationRetryDelaySeconds,
  getVideoNormalizationSignature,
  isVideoNormalizationEnabled,
  type VideoNormalizationVariantKey,
} from "@/lib/mediaVideoNormalizationPolicy";
import { canPublishVideoSourceDirectly } from "@/lib/mediaVideoSourceCompatibility";
import { INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES } from "@/lib/mediaRules";
import {
  normalizeVideoSource,
  type NormalizedVideoVariant,
} from "@/lib/mediaVideoNormalizer";
import { withStorageBinaryMetadata } from "@/lib/supabaseStorageBinary";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type ClaimedVideoJob = {
  id: string;
  account_id: string;
  media_id: string;
  workspace_id: string | null;
  variant_id: string | null;
  status: string;
  progress: number;
  attempt_count: number;
  max_attempts: number;
  payload: Record<string, unknown> | null;
};

type MediaRow = {
  id: string;
  user_id: string;
  bucket_name: string;
  storage_path: string;
  media_type: string;
  mime_type: string | null;
  detected_mime_type: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  upload_status: string;
  processing_status: string;
  publication_status: string;
  original_file_name: string | null;
  media_metadata: Record<string, unknown> | null;
  updated_at: string;
};

type VariantRow = {
  id: string;
  purpose: string;
  signature: string;
  status: string;
  key: VideoNormalizationVariantKey;
  bucket_name: string | null;
  storage_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  variant_metadata: Record<string, unknown> | null;
};

type ProcessedJobSummary = {
  jobId: string;
  mediaId: string;
  status: "succeeded" | "queued" | "retry_wait" | "failed" | "cancelled";
  errorCode?: string;
};

// The source is capped at exactly 75,000,000 bytes before this worker. Keep a bounded transfer
// timeout while still tolerating a slow private Storage link.
const VIDEO_SOURCE_DOWNLOAD_TIMEOUT_MS = 240_000;

class VideoNormalizationError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = "VideoNormalizationError";
    this.code = code;
    this.retryable = retryable;
  }
}

function compactMessage(error: unknown) {
  const record = error as { stderr?: unknown; message?: unknown } | null;
  return String(record?.stderr || record?.message || error || "Erreur inconnue")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1_500);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function canPublishOriginalVideo(params: {
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

function persistedSourceProbe(mediaMetadata: unknown) {
  const normalization = asRecord(asRecord(mediaMetadata).video_normalization);
  return asRecord(normalization.source);
}

async function hasReadyCanonicalVariant(params: {
  accountId: string;
  mediaId: string;
}) {
  const result = await supabaseAdmin
    .from("media_variants")
    .select("id")
    .eq("account_id", params.accountId)
    .eq("media_id", params.mediaId)
    .is("workspace_id", null)
    .eq("purpose", "canonical")
    .eq("signature", getVideoNormalizationSignature("canonical"))
    .eq("status", "ready")
    .limit(1);
  if (result.error) throw result.error;
  return Boolean(result.data?.length);
}

function readPreparationMission(
  job: ClaimedVideoJob,
): BoosterPreparationMission | null {
  return readVideoPreparationMission(job.payload);
}

function requiredVideoKeys(job: ClaimedVideoJob) {
  const mission = readPreparationMission(job);
  return {
    mission,
    keys: readRequestedVideoPreparationKeys({
      payload: job.payload,
      fallbackMission: mission,
    }),
  };
}

function classifyWorkerError(error: unknown) {
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

async function updateJobProgress(job: ClaimedVideoJob, progress: number) {
  const safe = Math.max(1, Math.min(99, Math.round(progress)));
  const now = new Date().toISOString();
  const [jobUpdate, mediaUpdate, publicationStatusUpdate] = await Promise.all([
    supabaseAdmin
      .from("media_processing_jobs")
      .update({
        progress: safe,
        lock_expires_at: new Date(
          Date.now() + VIDEO_NORMALIZATION_WORKER_LEASE_SECONDS * 1_000,
        ).toISOString(),
        updated_at: now,
      })
      .eq("id", job.id)
      .eq("account_id", job.account_id)
      .eq("status", "processing")
      .select("id"),
    supabaseAdmin
      .from("pro_media_library")
      .update({
        processing_status: "processing",
        processing_progress: safe,
        processing_started_at: now,
        processing_error_code: null,
        processing_error_message: null,
      })
      .eq("id", job.media_id)
      .eq("user_id", job.account_id),
    supabaseAdmin
      .from("pro_media_library")
      .update({ publication_status: "processing" })
      .eq("id", job.media_id)
      .eq("user_id", job.account_id)
      .neq("publication_status", "ready"),
  ]);
  if (mediaUpdate.error) {
    console.warn("[media-pipeline] video media progress update failed", {
      jobId: job.id,
      mediaId: job.media_id,
      progress: safe,
      message: compactMessage(mediaUpdate.error),
    });
  }
  if (publicationStatusUpdate.error) {
    console.warn("[media-pipeline] video publication progress update failed", {
      jobId: job.id,
      mediaId: job.media_id,
      progress: safe,
      message: compactMessage(publicationStatusUpdate.error),
    });
  }
  if (jobUpdate.error || !jobUpdate.data?.[0]) {
    throw new VideoNormalizationError(
      "video_job_lease_refresh_failed",
      jobUpdate.error
        ? compactMessage(jobUpdate.error)
        : "Le verrou du traitement video n'est plus actif.",
      true,
    );
  }
}

async function loadMedia(job: ClaimedVideoJob): Promise<MediaRow> {
  const result = await supabaseAdmin
    .from("pro_media_library")
    .select(
      "id,user_id,bucket_name,storage_path,media_type,mime_type,detected_mime_type,size_bytes,width,height,duration_seconds,upload_status,processing_status,publication_status,original_file_name,media_metadata,updated_at",
    )
    .eq("id", job.media_id)
    .eq("user_id", job.account_id)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) {
    throw new VideoNormalizationError(
      "video_media_not_found",
      "Média vidéo introuvable.",
      false,
    );
  }
  return result.data as MediaRow;
}

async function loadVariants(job: ClaimedVideoJob): Promise<VariantRow[]> {
  const signatures = VIDEO_NORMALIZATION_VARIANT_KEYS.map((key) =>
    getVideoNormalizationSignature(key),
  );
  const result = await supabaseAdmin
    .from("media_variants")
    .select(
      "id,purpose,signature,status,bucket_name,storage_path,mime_type,size_bytes,width,height,duration_seconds,variant_metadata",
    )
    .eq("account_id", job.account_id)
    .eq("media_id", job.media_id)
    .is("workspace_id", null)
    .in("signature", signatures);
  if (result.error) throw result.error;

  const rows = (result.data || [])
    .map((row: any) => {
      const key = getVideoNormalizationKeyFromSignature(String(row.signature));
      return key ? ({ ...row, key } as VariantRow) : null;
    })
    .filter((row): row is VariantRow => Boolean(row));
  const keys = new Set(rows.map((row) => row.key));
  for (const key of VIDEO_NORMALIZATION_VARIANT_KEYS) {
    if (!keys.has(key)) {
      throw new VideoNormalizationError(
        "video_variant_missing",
        `Variante vidéo ${key} absente du registre.`,
        true,
      );
    }
  }
  return rows;
}

function readyVariantOutput(variant: VariantRow) {
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

async function markVariantsProcessing(
  job: ClaimedVideoJob,
  variants: VariantRow[],
) {
  if (!variants.length) return;
  const result = await supabaseAdmin
    .from("media_variants")
    .update({
      status: "processing",
      error_code: null,
      error_message: null,
      pipeline_version: VIDEO_NORMALIZATION_PIPELINE_VERSION,
    })
    .eq("account_id", job.account_id)
    .eq("media_id", job.media_id)
    .in(
      "id",
      variants.map((variant) => variant.id),
    );
  if (result.error) throw result.error;
}

async function downloadSourceToTemp(
  media: MediaRow,
  jobId: string,
) {
  // `loadMedia` already proves that the registry row belongs to the job
  // account. Storage remains allow-listed to the account-owned paths only.
  const allowedPrivatePrefixes = [
    `users/${media.user_id}/workspace-source/`,
    `users/${media.user_id}/ai-generated/video/`,
  ];
  const boosterAccount = String(media.user_id || "").replace(/\./g, "-");
  const boosterPath = String(media.storage_path || "");
  const ownedBoosterSource =
    media.bucket_name === "booster" &&
    ["booster-videos", "booster-drafts", "booster-video-source"].some(
      (folder) => boosterPath.startsWith(`${boosterAccount}/${folder}/`),
    );
  if (
    !(
      (media.bucket_name === "inrcy-pro-media" &&
        allowedPrivatePrefixes.some((prefix) =>
          String(media.storage_path || "").startsWith(prefix),
        )) ||
      ownedBoosterSource
    )
  ) {
    throw new VideoNormalizationError(
      "video_source_scope_invalid",
      "La source vidéo ne se trouve pas dans l’espace de stockage autorisé.",
      false,
    );
  }

  const declaredSize = Number(media.size_bytes || 0);
  if (declaredSize > VIDEO_NORMALIZATION_MAX_SOURCE_BYTES) {
    throw new VideoNormalizationError(
      "video_source_too_large",
      `La source dépasse le plafond technique de ${VIDEO_NORMALIZATION_MAX_SOURCE_MB_LABEL} du worker vidéo.`,
      false,
    );
  }

  const signedUrl = await createSafeStorageSignedUrl(
    media.bucket_name,
    media.storage_path,
    600,
  );
  if (!signedUrl) {
    throw new VideoNormalizationError(
      "video_source_signing_failed",
      "URL source privée indisponible.",
      true,
    );
  }

  const abortController = new AbortController();
  const downloadTimeout = setTimeout(
    () => abortController.abort(),
    VIDEO_SOURCE_DOWNLOAD_TIMEOUT_MS,
  );
  let workDir: string | null = null;
  try {
    const response = await fetch(signedUrl, {
      cache: "no-store",
      signal: abortController.signal,
    });
    if (!response.ok || !response.body) {
      throw new VideoNormalizationError(
        "video_source_download_failed",
        `Téléchargement source impossible (${response.status}).`,
        response.status >= 500 ||
          response.status === 408 ||
          response.status === 429,
      );
    }

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > VIDEO_NORMALIZATION_MAX_SOURCE_BYTES) {
      throw new VideoNormalizationError(
        "video_source_too_large",
        `La source dépasse le plafond technique de ${VIDEO_NORMALIZATION_MAX_SOURCE_MB_LABEL} du worker vidéo.`,
        false,
      );
    }

    workDir = await mkdtemp(path.join(tmpdir(), "inrcy-video-normalize-"));
    const inputPath = path.join(workDir, `${jobId || randomUUID()}.source`);
    let bytes = 0;
    const hash = createHash("sha256");
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.byteLength;
        if (bytes > VIDEO_NORMALIZATION_MAX_SOURCE_BYTES) {
          callback(
            new VideoNormalizationError(
              "video_source_too_large",
              `La source dépasse le plafond technique de ${VIDEO_NORMALIZATION_MAX_SOURCE_MB_LABEL} du worker vidéo.`,
              false,
            ),
          );
          return;
        }
        hash.update(buffer);
        callback(null, buffer);
      },
    });

    await pipeline(
      Readable.fromWeb(response.body as any),
      meter,
      createWriteStream(inputPath, { flags: "wx" }),
    );
    if (!bytes) {
      throw new VideoNormalizationError(
        "video_source_empty",
        "La source vidéo est vide.",
        false,
      );
    }
    return {
      workDir,
      inputPath,
      sizeBytes: bytes,
      sha256: hash.digest("hex"),
    };
  } catch (error) {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
    if (abortController.signal.aborted) {
      throw new VideoNormalizationError(
        "video_source_download_timeout",
        "Le téléchargement de la source vidéo a dépassé son délai de sécurité.",
        true,
      );
    }
    throw error;
  } finally {
    clearTimeout(downloadTimeout);
  }
}

async function uploadVariant(params: {
  job: ClaimedVideoJob;
  variant: VariantRow;
  normalized: NormalizedVideoVariant;
}) {
  const bucket = "inrcy-pro-media";
  const storagePath = buildVideoNormalizationStoragePath({
    accountId: params.job.account_id,
    mediaId: params.job.media_id,
    key: params.normalized.key,
  });
  let storedBucket: string | null = null;
  let storedPath: string | null = null;

  if (params.normalized.available && params.normalized.filePath) {
    const fileSize = Number((await stat(params.normalized.filePath)).size || 0);
    if (!fileSize) {
      throw new VideoNormalizationError(
        "video_variant_empty",
        `La variante ${params.normalized.key} est vide.`,
        true,
      );
    }
    const upload = await supabaseAdmin.storage
      .from(bucket)
      .upload(storagePath, createReadStream(params.normalized.filePath), {
        upsert: true,
        contentType: params.normalized.mimeType,
        cacheControl: "31536000",
        duplex: "half",
        headers: { "content-length": String(fileSize) },
      });
    if (upload.error) {
      throw new VideoNormalizationError(
        "video_variant_upload_failed",
        upload.error.message,
        true,
      );
    }
    storedBucket = bucket;
    storedPath = storagePath;
  }

  const update = await supabaseAdmin
    .from("media_variants")
    .update({
      status: "ready",
      bucket_name: storedBucket,
      storage_path: storedPath,
      mime_type: params.normalized.mimeType,
      size_bytes: params.normalized.sizeBytes,
      width: params.normalized.width,
      height: params.normalized.height,
      duration_seconds: params.normalized.durationSeconds,
      pipeline_version: VIDEO_NORMALIZATION_PIPELINE_VERSION,
      transform_spec: params.normalized.transformSpec,
      variant_metadata: withStorageBinaryMetadata({
        ...params.normalized.metadata,
        available: params.normalized.available,
      }),
      error_code: null,
      error_message: null,
      ready_at: new Date().toISOString(),
    })
    .eq("id", params.variant.id)
    .eq("account_id", params.job.account_id)
    .eq("media_id", params.job.media_id);
  if (update.error) throw update.error;

  return {
    key: params.normalized.key,
    purpose: params.normalized.purpose,
    variantId: params.variant.id,
    available: params.normalized.available,
    bucket: storedBucket,
    storagePath: storedPath,
    mimeType: params.normalized.mimeType,
    sizeBytes: params.normalized.sizeBytes,
    width: params.normalized.width,
    height: params.normalized.height,
    durationSeconds: params.normalized.durationSeconds,
  };
}

async function markJobCancelled(
  job: ClaimedVideoJob,
  variants: VariantRow[],
  reason: string,
): Promise<ProcessedJobSummary> {
  const now = new Date().toISOString();
  const operations: PromiseLike<unknown>[] = [
    supabaseAdmin
      .from("media_processing_jobs")
      .update({
        status: "cancelled",
        progress: 0,
        error_code: "video_normalization_cancelled",
        error_message: reason,
        completed_at: now,
        locked_at: null,
        lock_expires_at: null,
        locked_by: null,
      })
      .eq("id", job.id),
  ];
  if (variants.length) {
    operations.push(
      supabaseAdmin
        .from("media_variants")
        .update({
          status: "removed",
          error_code: "source_removed",
          error_message: reason,
        })
        .in(
          "id",
          variants.map((variant) => variant.id),
        ),
    );
  }
  await Promise.all(operations);
  return { jobId: job.id, mediaId: job.media_id, status: "cancelled" };
}

async function markJobFailure(params: {
  job: ClaimedVideoJob;
  claimedKeys: readonly VideoNormalizationVariantKey[];
  variants: VariantRow[];
  error: unknown;
}): Promise<ProcessedJobSummary> {
  const normalized = classifyWorkerError(params.error);
  if (params.variants.length) {
    const variantFailure = await supabaseAdmin
      .from("media_variants")
      .update({
        status: "failed",
        error_code: normalized.code,
        error_message: normalized.message,
      })
      .in(
        "id",
        params.variants.map((variant) => variant.id),
      )
      .eq("account_id", params.job.account_id)
      .neq("status", "ready");
    if (variantFailure.error) throw variantFailure.error;
  }

  const claimedMission = readPreparationMission(params.job);
  let finalStatus: "queued" | "retry_wait" | "failed" | null = null;

  // Compare the complete request captured by the claim, not the smaller stage
  // currently executing. Deferred derivatives are not late work; only keys
  // added durably after the claim may reset attempts and start immediately.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const [current, currentMedia] = await Promise.all([
      supabaseAdmin
        .from("media_processing_jobs")
        .select("payload,status,updated_at")
        .eq("id", params.job.id)
        .eq("account_id", params.job.account_id)
        .maybeSingle(),
      supabaseAdmin
        .from("pro_media_library")
        .select(
          "media_metadata,publication_status,original_file_name,mime_type,detected_mime_type,storage_path,size_bytes",
        )
        .eq("id", params.job.media_id)
        .eq("user_id", params.job.account_id)
        .maybeSingle(),
    ]);
    if (current.error) throw current.error;
    if (currentMedia.error) throw currentMedia.error;
    if (!current.data) throw new Error("video_job_not_found");

    const currentStatus = String(current.data.status || "");
    const mergedRequest = claimedMission
      ? mergeVideoPreparationRequest({
          jobPayload: current.data.payload,
          mediaMetadata: currentMedia.data?.media_metadata,
          requestedMission: claimedMission,
        })
      : null;
    const latestMission =
      mergedRequest?.mission || readVideoPreparationMission(current.data.payload);
    const latestKeys =
      mergedRequest?.requiredOutputs ||
      readRequestedVideoPreparationKeys({
        payload: current.data.payload,
        fallbackMission: latestMission || claimedMission,
      });
    const failurePlan = planVideoNormalizationFailure({
      claimedKeys: params.claimedKeys,
      latestKeys,
      retryableError: normalized.retryable,
      attemptCount: params.job.attempt_count,
      maxAttempts: params.job.max_attempts,
    });
    const hasUntreatedRequest = failurePlan.hasLateRequest;
    if (currentStatus === "queued") {
      finalStatus = "queued";
      break;
    }
    if (
      (currentStatus === "retry_wait" || currentStatus === "failed") &&
      !hasUntreatedRequest
    ) {
      finalStatus = currentStatus;
      break;
    }
    if (
      currentStatus !== "processing" &&
      currentStatus !== "retry_wait" &&
      currentStatus !== "failed"
    ) {
      throw new Error("video_job_failure_state_invalid");
    }
    const followUpMission = latestMission || claimedMission;
    const now = new Date();
    const previousUpdatedAt = String(current.data.updated_at || "");
    const nextUpdatedAt = new Date(
      Math.max(now.getTime(), Date.parse(previousUpdatedAt) + 1 || 0),
    ).toISOString();
    const availableAt = new Date(
      now.getTime() +
        getVideoNormalizationRetryDelaySeconds(params.job.attempt_count) * 1_000,
    ).toISOString();
    const status = failurePlan.status;
    const payload = hasUntreatedRequest && followUpMission
      ? {
          ...asRecord(current.data.payload),
          pipelineMission: followUpMission,
          requiredOutputs: [...latestKeys],
          previousMissionFailure: {
            mission: claimedMission || "legacy_full_normalization",
            code: normalized.code,
          },
        }
      : current.data.payload;
    const update = await supabaseAdmin
      .from("media_processing_jobs")
      .update({
        status,
        payload,
        progress: 0,
        attempt_count: failurePlan.attemptCount,
        available_at: hasUntreatedRequest
          ? nextUpdatedAt
          : status === "retry_wait"
            ? availableAt
            : nextUpdatedAt,
        error_code: hasUntreatedRequest ? null : normalized.code,
        error_message: hasUntreatedRequest ? null : normalized.message,
        completed_at: status === "failed" ? nextUpdatedAt : null,
        locked_at: null,
        lock_expires_at: null,
        locked_by: null,
        updated_at: nextUpdatedAt,
      })
      .eq("id", params.job.id)
      .eq("account_id", params.job.account_id)
      .eq("status", currentStatus)
      .eq("updated_at", previousUpdatedAt)
      .select("id");
    if (update.error) throw update.error;
    if (!update.data?.[0]) continue;
    finalStatus = status;
    break;
  }
  if (!finalStatus) throw new Error("video_job_failure_contention");

  const latestMediaResult = await supabaseAdmin
    .from("pro_media_library")
    .select(
      "media_metadata,publication_status,original_file_name,mime_type,detected_mime_type,storage_path,size_bytes",
    )
    .eq("id", params.job.media_id)
    .eq("user_id", params.job.account_id)
    .maybeSingle();
  if (latestMediaResult.error) throw latestMediaResult.error;
  const latestMedia = latestMediaResult.data;
  const originalReady = latestMedia
    ? canPublishOriginalVideo({
        media: latestMedia,
        sourceProbe: persistedSourceProbe(latestMedia.media_metadata),
      })
    : false;
  const canonicalReady = await hasReadyCanonicalVariant({
    accountId: params.job.account_id,
    mediaId: params.job.media_id,
  });
  const publicationMediaReady = originalReady || canonicalReady;
  const publicationMissionFailed = claimedMission === "publication_preparation";
  const chained = finalStatus === "queued";
  const mediaStatus = publicationMediaReady
    ? "ready"
    : chained
      ? "queued"
      : finalStatus === "retry_wait"
        ? "failed_retryable"
        : "failed_terminal";
  const publicationStatus = publicationMediaReady
    ? "ready"
    : publicationMissionFailed
      ? finalStatus === "failed"
        ? "failed"
        : "processing"
      : String(latestMedia?.publication_status || "not_requested");
  const mediaUpdate = await supabaseAdmin
    .from("pro_media_library")
    .update({
      processing_status: mediaStatus,
      // Captures/audio IA are best-effort and never invalidate a compatible
      // original. Only a publication-preparation failure may fail publication.
      publication_status: publicationStatus,
      processing_progress: publicationMediaReady ? 100 : 0,
      processing_error_code:
        chained || publicationMediaReady ? null : normalized.code,
      processing_error_message:
        chained || publicationMediaReady ? null : normalized.message,
      processing_completed_at:
        finalStatus === "failed" ? new Date().toISOString() : null,
    })
    .eq("id", params.job.media_id)
    .eq("user_id", params.job.account_id);
  if (mediaUpdate.error) throw mediaUpdate.error;

  await refreshPublicationWorkspaceStatusesForMedia({
    mediaId: params.job.media_id,
    accountId: params.job.account_id,
  }).catch((error) => {
    console.error("[media-pipeline] video failure workspace refresh failed", error);
  });

  return {
    jobId: params.job.id,
    mediaId: params.job.media_id,
    status: finalStatus,
    errorCode: chained ? undefined : normalized.code,
  };
}

async function updateMediaAfterSuccessfulNormalization(params: {
  job: ClaimedVideoJob;
  media: MediaRow;
  mission: BoosterPreparationMission | null;
  normalized: Awaited<ReturnType<typeof normalizeVideoSource>>;
  outputs: Partial<
    Record<VideoNormalizationVariantKey, Awaited<ReturnType<typeof uploadVariant>>>
  >;
  originalPublicationReady: boolean;
  canonicalPublicationReady: boolean;
  sourceSha256: string;
  completedAt: string;
  continuesWithPendingOutputs?: boolean;
  stageCompletionProgress: number;
}) {
  // Une demande publication peut arriver pendant FFmpeg. Ne jamais réécrire
  // media_metadata depuis le snapshot chargé au début du job : on recharge puis
  // fusionne sous verrou optimiste afin de conserver mission/requiredOutputs.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const current = await supabaseAdmin
      .from("pro_media_library")
      .select("media_metadata,publication_status,updated_at")
      .eq("id", params.job.media_id)
      .eq("user_id", params.job.account_id)
      .maybeSingle();
    if (current.error) throw current.error;
    if (!current.data) {
      throw new VideoNormalizationError(
        "video_media_not_found",
        "Média vidéo introuvable pendant la finalisation.",
        false,
      );
    }

    const existingMetadata = asRecord(current.data.media_metadata);
    const previousNormalization = asRecord(
      existingMetadata.video_normalization,
    );
    const previousVariants = asRecord(previousNormalization.variants);
    const previousUpdatedAt = String(current.data.updated_at || "");
    const nextUpdatedAt = new Date(
      Math.max(Date.now(), Date.parse(previousUpdatedAt) + 1 || 0),
    ).toISOString();
    const mediaPatch: Record<string, unknown> = {
      width: params.normalized.source.orientedWidth,
      height: params.normalized.source.orientedHeight,
      duration_seconds: params.normalized.source.durationSeconds,
      detected_mime_type:
        params.media.detected_mime_type || params.media.mime_type || null,
      processing_status: params.continuesWithPendingOutputs
        ? "queued"
        : "ready",
      publication_status:
        params.originalPublicationReady || params.canonicalPublicationReady
          ? "ready"
          : params.continuesWithPendingOutputs
            ? "processing"
            : params.mission === "ai_preparation"
              ? "not_requested"
              : current.data.publication_status,
      processing_progress: params.continuesWithPendingOutputs
        ? params.stageCompletionProgress
        : 100,
      processing_error_code: null,
      processing_error_message: null,
      processing_completed_at: params.continuesWithPendingOutputs
        ? null
        : params.completedAt,
      pipeline_version: VIDEO_NORMALIZATION_PIPELINE_VERSION,
      media_metadata: {
        ...existingMetadata,
        video_normalization: {
          ...previousNormalization,
          version: VIDEO_NORMALIZATION_PIPELINE_VERSION,
          source: params.normalized.source,
          variants: { ...previousVariants, ...params.outputs },
          warnings: params.normalized.warnings,
          last_mission: params.mission || "legacy_full_normalization",
          completed_at: params.completedAt,
        },
      },
      updated_at: nextUpdatedAt,
    };
    mediaPatch.content_hash_sha256 = params.sourceSha256;

    const update = await supabaseAdmin
      .from("pro_media_library")
      .update(mediaPatch)
      .eq("id", params.job.media_id)
      .eq("user_id", params.job.account_id)
      .eq("updated_at", previousUpdatedAt)
      .select("id");
    if (update.error) throw update.error;
    if (update.data?.[0]) return;
  }

  throw new VideoNormalizationError(
    "video_media_completion_contention",
    "Une nouvelle préparation média a été demandée pendant la finalisation.",
    true,
  );
}

async function settleSuccessfulVideoJob(params: {
  job: ClaimedVideoJob;
  fulfilledKeys: Iterable<VideoNormalizationVariantKey>;
  result: Record<string, unknown>;
  completedAt: string;
  stageCompletionProgress: number;
}): Promise<"succeeded" | "queued"> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const [current, currentMedia] = await Promise.all([
      supabaseAdmin
        .from("media_processing_jobs")
        .select("payload,status,updated_at")
        .eq("id", params.job.id)
        .eq("account_id", params.job.account_id)
        .maybeSingle(),
      supabaseAdmin
        .from("pro_media_library")
        .select("media_metadata")
        .eq("id", params.job.media_id)
        .eq("user_id", params.job.account_id)
        .maybeSingle(),
    ]);
    if (current.error) throw current.error;
    if (currentMedia.error) throw currentMedia.error;
    if (!current.data) {
      throw new VideoNormalizationError(
        "video_job_not_found",
        "Job vidéo introuvable pendant la finalisation.",
        true,
      );
    }

    const currentStatus = String(current.data.status || "");
    if (currentStatus === "succeeded") return "succeeded";
    if (currentStatus === "queued" || currentStatus === "retry_wait") {
      return "queued";
    }
    if (currentStatus !== "processing") {
      throw new VideoNormalizationError(
        "video_job_completion_state_invalid",
        `État job vidéo inattendu (${currentStatus || "inconnu"}).`,
        true,
      );
    }

    const claimedMission = readPreparationMission(params.job);
    const mergedRequest = claimedMission
      ? mergeVideoPreparationRequest({
          jobPayload: current.data.payload,
          mediaMetadata: currentMedia.data?.media_metadata,
          requestedMission: claimedMission,
        })
      : null;
    const latestPayload = mergedRequest
      ? {
          ...asRecord(current.data.payload),
          pipelineMission: mergedRequest.mission,
          requiredOutputs: mergedRequest.requiredOutputs,
        }
      : current.data.payload;
    const pendingOutputs = findUnfulfilledVideoPreparationKeys({
      payload: latestPayload,
      fulfilledKeys: params.fulfilledKeys,
      fallbackMission: claimedMission,
    });
    const previousUpdatedAt = String(current.data.updated_at || "");
    const nextUpdatedAt = new Date(
      Math.max(Date.now(), Date.parse(previousUpdatedAt) + 1 || 0),
    ).toISOString();
    const chained = pendingOutputs.length > 0;
    const patch = chained
      ? {
          status: "queued",
          payload: latestPayload,
          progress: params.stageCompletionProgress,
          attempt_count: 0,
          available_at: nextUpdatedAt,
          result: {
            ...params.result,
            chained: true,
            pendingOutputs,
          },
          error_code: null,
          error_message: null,
          completed_at: null,
          locked_at: null,
          lock_expires_at: null,
          locked_by: null,
          updated_at: nextUpdatedAt,
        }
      : {
          status: "succeeded",
          progress: 100,
          result: params.result,
          error_code: null,
          error_message: null,
          completed_at: params.completedAt,
          locked_at: null,
          lock_expires_at: null,
          locked_by: null,
          updated_at: nextUpdatedAt,
        };
    const update = await supabaseAdmin
      .from("media_processing_jobs")
      .update(patch)
      .eq("id", params.job.id)
      .eq("account_id", params.job.account_id)
      .eq("status", "processing")
      .eq("updated_at", previousUpdatedAt)
      .select("id");
    if (update.error) throw update.error;
    if (!update.data?.[0]) continue;

    if (chained) {
      const mediaUpdate = await supabaseAdmin
        .from("pro_media_library")
        .update({
          processing_status: "queued",
          processing_progress: params.stageCompletionProgress,
          processing_completed_at: null,
        })
        .eq("id", params.job.media_id)
        .eq("user_id", params.job.account_id);
      if (mediaUpdate.error) throw mediaUpdate.error;
      return "queued";
    }
    return "succeeded";
  }

  throw new VideoNormalizationError(
    "video_job_completion_contention",
    "Une nouvelle mission vidéo a été enregistrée pendant la finalisation.",
    true,
  );
}

async function processClaimedVideoJob(
  job: ClaimedVideoJob,
): Promise<ProcessedJobSummary> {
  const claimedRequest = requiredVideoKeys(job);
  let variants: VariantRow[] = [];
  let failureJob = job;
  let workDir = "";
  try {
    const media = await loadMedia(job);
    variants = await loadVariants(job);
    const allVariants = variants;

    if (media.upload_status === "removed") {
      return await markJobCancelled(job, variants, "La source a été retirée.");
    }
    if (media.media_type !== "video") {
      return await markJobCancelled(job, variants, "Le média n’est pas une vidéo.");
    }
    if (media.upload_status !== "uploaded") {
      throw new VideoNormalizationError(
        "video_source_not_uploaded",
        "La source vidéo n’est pas encore disponible.",
        true,
      );
    }

    const requested = claimedRequest;
    const fulfilledKeys = new Set<VideoNormalizationVariantKey>(
      allVariants
        .filter((variant) => Boolean(readyVariantOutput(variant)))
        .map((variant) => variant.key),
    );
    const execution = planVideoNormalizationExecution({
      mission: requested.mission,
      requestedKeys: requested.keys,
      readyKeys: fulfilledKeys,
    });
    const progressWindow: VideoNormalizationProgressWindow =
      resolveVideoNormalizationProgressWindow({
        continuesWithPendingOutputs: execution.continuesWithPendingOutputs,
        previousProgress: job.progress,
        hasCompletedRequiredOutput: fulfilledKeys.size > 0,
      });
    const persistStageProgress = (stageProgress: number) =>
      updateJobProgress(
        job,
        mapVideoNormalizationStageProgress(stageProgress, progressWindow),
      );
    const requiredKeySet = new Set<VideoNormalizationVariantKey>(execution.keys);
    const selectedVariants = variants.filter((variant) =>
      requiredKeySet.has(variant.key),
    );
    variants = selectedVariants;
    failureJob = {
      ...job,
      payload: {
        ...asRecord(job.payload),
        pipelineMission: execution.mission,
        requiredOutputs: execution.keys,
      },
    };
    const reusableOutputs = Object.fromEntries(
      selectedVariants
        .map((variant) => [variant.key, readyVariantOutput(variant)] as const)
        .filter(
          (entry): entry is readonly [
            VideoNormalizationVariantKey,
            NonNullable<ReturnType<typeof readyVariantOutput>>,
          ] => Boolean(entry[1]),
        ),
    ) as Partial<
      Record<
        VideoNormalizationVariantKey,
        NonNullable<ReturnType<typeof readyVariantOutput>>
      >
    >;
    const pendingVariants = selectedVariants
      .filter((variant) => !reusableOutputs[variant.key])
      .sort((left, right) =>
        left.key === "canonical" ? -1 : right.key === "canonical" ? 1 : 0,
      );

    await markVariantsProcessing(job, pendingVariants);
    await persistStageProgress(5);

    // Captures IA, audio et miniature sont toujours extraits de l'original.
    // La variante canonique, lorsqu'elle est demandée, est uniquement le
    // filet de sécurité MP4/H.264/AAC utilisé si l'original est incompatible.
    const downloaded = await downloadSourceToTemp(media, job.id);
    workDir = downloaded.workDir;
    await persistStageProgress(20);

    let lastQueuedProgress = 20;
    let lastQueuedAt = 0;
    let progressWriteChain: Promise<void> = Promise.resolve();
    const queueNormalizationProgress = (normalizerProgress: number, stage: string) => {
      const mapped = Math.max(
        21,
        Math.min(72, 20 + Math.round((Math.max(0, Math.min(100, normalizerProgress)) / 100) * 52)),
      );
      const now = Date.now();
      if (mapped <= lastQueuedProgress) return;
      if (mapped < 72 && mapped - lastQueuedProgress < 3 && now - lastQueuedAt < 1_800) return;
      lastQueuedProgress = mapped;
      lastQueuedAt = now;
      progressWriteChain = progressWriteChain
        .then(async () => {
          await persistStageProgress(mapped);
          if (mapped === 72 || mapped % 10 <= 2) {
            console.info("[media-pipeline] video normalization progress", {
              mediaId: job.media_id,
              progress: mapped,
              stage,
            });
          }
        })
        .catch((error) => {
          if (
            error instanceof VideoNormalizationError &&
            error.code === "video_job_lease_refresh_failed"
          ) {
            throw error;
          }
          console.warn("[media-pipeline] video progress persistence skipped", {
            mediaId: job.media_id,
            progress: mapped,
            stage,
            message: compactMessage(error),
          });
        });
    };

    const normalized = await normalizeVideoSource({
      inputPath: downloaded.inputPath,
      outputDirectory: path.join(workDir, "outputs"),
      fallbackWidth: media.width,
      fallbackHeight: media.height,
      fallbackDurationSeconds: media.duration_seconds,
      keys: pendingVariants.map((variant) => variant.key),
      onProgress: ({ progress, stage }) => {
        queueNormalizationProgress(progress, stage);
      },
    });
    await progressWriteChain;
    await persistStageProgress(72);

    const outputs: Partial<
      Record<VideoNormalizationVariantKey, Awaited<ReturnType<typeof uploadVariant>>>
    > = { ...reusableOutputs };
    for (let index = 0; index < pendingVariants.length; index += 1) {
      const variant = pendingVariants[index];
      const normalizedVariant = normalized.variants[variant.key];
      if (!normalizedVariant) {
        throw new VideoNormalizationError(
          "video_variant_output_missing",
          `Variante ${variant.key} absente au moment de l’upload.`,
          true,
        );
      }
      outputs[variant.key] = await uploadVariant({
        job,
        variant,
        normalized: normalizedVariant,
      });
      fulfilledKeys.add(variant.key);
      await persistStageProgress(
        74 +
          Math.round(((index + 1) / Math.max(1, pendingVariants.length)) * 20),
      );
    }

    const originalPublicationReady = canPublishOriginalVideo({
      media,
      sourceProbe: normalized.source,
    });
    const canonicalPublicationReady = Boolean(outputs.canonical);
    if (
      execution.mission === "publication_preparation" &&
      !originalPublicationReady &&
      !canonicalPublicationReady
    ) {
      throw new VideoNormalizationError(
        "video_source_incompatible",
        "Cette vidéo ne peut pas être publiée telle quelle. Utilisez un fichier MP4/M4V/MOV H.264 avec audio AAC, de 75 Mo maximum.",
        false,
      );
    }

    const completedAt = new Date().toISOString();
    await updateMediaAfterSuccessfulNormalization({
      job,
      media,
      mission: execution.mission,
      normalized,
      outputs,
      originalPublicationReady,
      canonicalPublicationReady,
      sourceSha256: downloaded.sha256,
      completedAt,
      continuesWithPendingOutputs: execution.continuesWithPendingOutputs,
      stageCompletionProgress: progressWindow.end,
    });
    const result = {
      pipelineVersion: VIDEO_NORMALIZATION_PIPELINE_VERSION,
      pipelineMission: execution.mission || "legacy_full_normalization",
      sourceSha256: downloaded.sha256,
      sourceSizeBytes: downloaded.sizeBytes,
      source: normalized.source,
      variants: outputs,
      warnings: normalized.warnings,
    };
    const disposition = await settleSuccessfulVideoJob({
      job,
      fulfilledKeys,
      result,
      completedAt,
      stageCompletionProgress: progressWindow.end,
    });

    await refreshPublicationWorkspaceStatusesForMedia({
      mediaId: job.media_id,
      accountId: job.account_id,
    });

    return { jobId: job.id, mediaId: job.media_id, status: disposition };
  } catch (error) {
    return await markJobFailure({
      job: failureJob,
      claimedKeys: claimedRequest.keys,
      variants,
      error,
    });
  } finally {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

async function claimVideoJobs(params: { workerId: string; limit: number }) {
  const result = await supabaseAdmin.rpc("inrcy_claim_video_normalization_jobs", {
    p_worker_id: params.workerId,
    p_limit: params.limit,
    p_lease_seconds: VIDEO_NORMALIZATION_WORKER_LEASE_SECONDS,
  });
  if (result.error) throw result.error;
  return (Array.isArray(result.data) ? result.data : []) as ClaimedVideoJob[];
}

export async function processVideoNormalizationJobs(params?: {
  limit?: number;
  workerId?: string;
}) {
  if (!isVideoNormalizationEnabled()) {
    return {
      enabled: false,
      claimed: 0,
      succeeded: 0,
      queued: 0,
      retrying: 0,
      failed: 0,
      cancelled: 0,
      jobs: [] as ProcessedJobSummary[],
    };
  }

  const limit = Math.max(
    1,
    Math.min(
      VIDEO_NORMALIZATION_MAX_BATCH_SIZE,
      Math.round(params?.limit || VIDEO_NORMALIZATION_DEFAULT_BATCH_SIZE),
    ),
  );
  const workerId =
    String(params?.workerId || "").trim() ||
    `video-worker-${process.env.VERCEL_REGION || "local"}-${randomUUID()}`;
  const jobs = await claimVideoJobs({ workerId, limit });
  const summaries: ProcessedJobSummary[] = [];

  // Un seul traitement vidéo à la fois : la source peut atteindre 75 Mo et
  // FFmpeg utilise déjà plusieurs threads pour extraire captures et audio.
  for (const job of jobs) {
    summaries.push(await processClaimedVideoJob(job));
  }

  return {
    enabled: true,
    claimed: jobs.length,
    succeeded: summaries.filter((item) => item.status === "succeeded").length,
    queued: summaries.filter((item) => item.status === "queued").length,
    retrying: summaries.filter((item) => item.status === "retry_wait").length,
    failed: summaries.filter((item) => item.status === "failed").length,
    cancelled: summaries.filter((item) => item.status === "cancelled").length,
    jobs: summaries,
  };
}

export async function processVideoNormalizationJobsForMedia(params: {
  accountId: string;
  mediaIds: readonly string[];
  workerId?: string;
}) {
  if (!isVideoNormalizationEnabled()) {
    return {
      enabled: false,
      requested: 0,
      claimed: 0,
      succeeded: 0,
      queued: 0,
      retrying: 0,
      failed: 0,
      cancelled: 0,
      jobs: [] as ProcessedJobSummary[],
    };
  }

  const accountId = String(params.accountId || "").trim();
  const mediaIds = Array.from(
    new Set(
      params.mediaIds
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  ).slice(0, 1);
  if (!accountId || mediaIds.length === 0) {
    return {
      enabled: true,
      requested: mediaIds.length,
      claimed: 0,
      succeeded: 0,
      queued: 0,
      retrying: 0,
      failed: 0,
      cancelled: 0,
      jobs: [] as ProcessedJobSummary[],
    };
  }

  const workerId =
    String(params.workerId || "").trim() ||
    `video-workspace-${process.env.VERCEL_REGION || "local"}-${randomUUID()}`;
  const summaries: ProcessedJobSummary[] = [];
  let claimed = 0;

  for (const mediaId of mediaIds) {
    // Exactly one bounded stage per invocation. A chained stage is persisted as
    // queued and picked up by the next cron tick, never hidden behind the first
    // request's execution budget.
    const job = await claimTargetedProcessingJob({
      accountId,
      mediaId,
      jobType: VIDEO_NORMALIZATION_JOB_TYPE,
      workerId: workerId.slice(0, 180),
      leaseSeconds: VIDEO_NORMALIZATION_WORKER_LEASE_SECONDS,
    });
    if (!job) continue;
    claimed += 1;
    summaries.push(await processClaimedVideoJob(job as ClaimedVideoJob));
  }

  return {
    enabled: true,
    requested: mediaIds.length,
    claimed,
    succeeded: summaries.filter((item) => item.status === "succeeded").length,
    queued: summaries.filter((item) => item.status === "queued").length,
    retrying: summaries.filter((item) => item.status === "retry_wait").length,
    failed: summaries.filter((item) => item.status === "failed").length,
    cancelled: summaries.filter((item) => item.status === "cancelled").length,
    jobs: summaries,
  };
}
