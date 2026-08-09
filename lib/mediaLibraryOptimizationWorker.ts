import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { optimizeMediaLibraryImage } from "@/lib/mediaLibraryImageOptimizer";
import {
  MEDIA_LIBRARY_IMAGE_OPTIMIZATION_JOB_TYPE,
  MEDIA_LIBRARY_IMAGE_SOURCE_MAX_BYTES,
  MEDIA_LIBRARY_IMAGE_SOURCE_MAX_MB_LABEL,
  MEDIA_LIBRARY_MIN_TARGET_BYTES,
  MEDIA_LIBRARY_OPTIMIZATION_JOB_TYPES,
  MEDIA_LIBRARY_OPTIMIZATION_PIPELINE_VERSION,
  MEDIA_LIBRARY_OPTIMIZATION_WORKER_LEASE_SECONDS,
  MEDIA_LIBRARY_VIDEO_OPTIMIZATION_JOB_TYPE,
  MEDIA_LIBRARY_VIDEO_SOURCE_MAX_BYTES,
  MEDIA_LIBRARY_VIDEO_SOURCE_MAX_MB_LABEL,
  buildOptimizedMediaTitle,
  buildOptimizedStoragePath,
  getMediaLibraryOptimizationRequirements,
  getMediaLibraryOptimizationOutputLimit,
  mapMediaLibraryOptimizationStage,
  normalizeMediaLibraryOptimizationTarget,
  type MediaLibraryOptimizationJobType,
  type MediaLibraryOptimizationMediaType,
} from "@/lib/mediaLibraryOptimizationPolicy";
import { claimTargetedProcessingJob } from "@/lib/mediaProcessingTargetedClaim";
import { compressMediaLibraryVideo } from "@/lib/mediaLibraryVideoCompressor";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const MEDIA_LIBRARY_BUCKET = "inrcy-pro-media";
const SOURCE_DOWNLOAD_TIMEOUT_MS = 900_000;

type OptimizationJob = {
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

type OptimizationMedia = {
  id: string;
  user_id: string;
  created_by_auth_user_id: string | null;
  bucket_name: string;
  storage_path: string;
  media_type: string;
  mime_type: string | null;
  detected_mime_type: string | null;
  size_bytes: number | null;
  title: string | null;
  tags: unknown;
  source: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  is_active: boolean;
  original_file_name: string | null;
  upload_status: string;
  media_metadata: Record<string, unknown> | null;
};

type OptimizationSummary = {
  jobId: string;
  mediaId: string;
  status: "succeeded" | "retry_wait" | "failed" | "cancelled";
  outputMediaId?: string;
  errorCode?: string;
};

class MediaLibraryOptimizationError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = "MediaLibraryOptimizationError";
    this.code = code;
    this.retryable = retryable;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function compactMessage(error: unknown) {
  const record = error as { message?: unknown; stderr?: unknown } | null;
  return String(record?.stderr || record?.message || error || "Erreur inconnue")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1_500);
}

function normalizeWorkerError(error: unknown) {
  if (error instanceof MediaLibraryOptimizationError) return error;
  const message = compactMessage(error);
  const lower = message.toLowerCase();
  const terminal =
    lower.includes("too_large") ||
    lower.includes("dimensions_unavailable") ||
    lower.includes("duration_unavailable") ||
    lower.includes("codec_invalid") ||
    lower.includes("decode") ||
    lower.includes("invalid data") ||
    lower.includes("moov atom") ||
    lower.includes("unsupported") ||
    lower.includes("empty");
  return new MediaLibraryOptimizationError(
    terminal ? "media_optimization_invalid_source" : "media_optimization_temporary_failure",
    message,
    !terminal,
  );
}

function mediaTypeForJob(jobType: string): MediaLibraryOptimizationMediaType {
  return jobType === MEDIA_LIBRARY_VIDEO_OPTIMIZATION_JOB_TYPE
    ? "video"
    : "image";
}

function targetBytesForJob(
  job: OptimizationJob,
  mediaType: MediaLibraryOptimizationMediaType,
) {
  return normalizeMediaLibraryOptimizationTarget({
    mediaType,
    targetBytes: Number(job.payload?.targetBytes || 0) || null,
  });
}

function outputClientKey(job: OptimizationJob) {
  const mediaType = mediaTypeForJob(String(job.payload?.jobType || ""));
  const targetBytes = targetBytesForJob(job, mediaType);
  return `media-library-optimization-v${MEDIA_LIBRARY_OPTIMIZATION_PIPELINE_VERSION}:${job.media_id}:${targetBytes}`;
}

function optimizationRequirementsForMedia(
  job: OptimizationJob,
  media: OptimizationMedia,
) {
  const mediaType = media.media_type as MediaLibraryOptimizationMediaType;
  return getMediaLibraryOptimizationRequirements({
    mediaType,
    sizeBytes: media.size_bytes,
    targetBytes: targetBytesForJob(job, mediaType),
    name: media.original_file_name || media.storage_path || media.title,
    mimeType: media.detected_mime_type || media.mime_type,
  });
}

function processingTargetBytesForMedia(
  job: OptimizationJob,
  media: OptimizationMedia,
) {
  const mediaType = media.media_type as MediaLibraryOptimizationMediaType;
  const targetBytes = targetBytesForJob(job, mediaType);
  const requirements = optimizationRequirementsForMedia(job, media);
  if (mediaType === "video" && requirements.needsConversion && !requirements.needsCompression) {
    return Math.min(
      targetBytes,
      Math.max(MEDIA_LIBRARY_MIN_TARGET_BYTES, Number(media.size_bytes || 0)),
    );
  }
  return targetBytes;
}

async function loadMedia(job: OptimizationJob): Promise<OptimizationMedia> {
  const result = await supabaseAdmin
    .from("pro_media_library")
    .select(
      "id,user_id,created_by_auth_user_id,bucket_name,storage_path,media_type,mime_type,detected_mime_type,size_bytes,title,tags,source,width,height,duration_seconds,is_active,original_file_name,upload_status,media_metadata",
    )
    .eq("id", job.media_id)
    .eq("user_id", job.account_id)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) {
    throw new MediaLibraryOptimizationError(
      "media_library_source_not_found",
      "Le média source est introuvable dans la Médiathèque.",
      false,
    );
  }
  return result.data as OptimizationMedia;
}

function validateMedia(job: OptimizationJob, media: OptimizationMedia) {
  const expectedType = mediaTypeForJob(
    String(job.payload?.jobType ||
      (media.media_type === "video"
        ? MEDIA_LIBRARY_VIDEO_OPTIMIZATION_JOB_TYPE
        : MEDIA_LIBRARY_IMAGE_OPTIMIZATION_JOB_TYPE)),
  );
  if (media.media_type !== expectedType) {
    throw new MediaLibraryOptimizationError(
      "media_library_type_mismatch",
      "Le type du média ne correspond pas à la tâche d’optimisation.",
      false,
    );
  }
  if (!media.is_active || media.upload_status !== "uploaded") {
    throw new MediaLibraryOptimizationError(
      "media_library_source_unavailable",
      "Le média source n’est plus disponible.",
      false,
    );
  }
  if (
    media.bucket_name !== MEDIA_LIBRARY_BUCKET ||
    !media.storage_path.startsWith(`users/${job.account_id}/`)
  ) {
    throw new MediaLibraryOptimizationError(
      "media_library_source_scope_invalid",
      "Le fichier source ne se trouve pas dans l’espace autorisé.",
      false,
    );
  }

  const mediaType = media.media_type as MediaLibraryOptimizationMediaType;
  const sizeBytes = Number(media.size_bytes || 0);
  if (!sizeBytes) {
    throw new MediaLibraryOptimizationError(
      "media_library_source_empty",
      "Le fichier source est vide.",
      false,
    );
  }
  const targetBytes = targetBytesForJob(job, mediaType);
  const requirements = optimizationRequirementsForMedia(job, media);
  if (!requirements.needsOptimization) {
    throw new MediaLibraryOptimizationError(
      "media_library_already_optimized",
      "Ce média est déjà compatible et respecte le plafond de cet outil.",
      false,
    );
  }
  const sourceLimit =
    mediaType === "video"
      ? MEDIA_LIBRARY_VIDEO_SOURCE_MAX_BYTES
      : MEDIA_LIBRARY_IMAGE_SOURCE_MAX_BYTES;
  if (sizeBytes > sourceLimit) {
    throw new MediaLibraryOptimizationError(
      "media_library_source_too_large",
      `La source dépasse le plafond de ${
        mediaType === "video"
          ? MEDIA_LIBRARY_VIDEO_SOURCE_MAX_MB_LABEL
          : MEDIA_LIBRARY_IMAGE_SOURCE_MAX_MB_LABEL
      } de la Médiathèque.`,
      false,
    );
  }
}

async function findExistingOutput(job: OptimizationJob) {
  const result = await supabaseAdmin
    .from("pro_media_library")
    .select(
      "id,user_id,bucket_name,storage_path,media_type,mime_type,size_bytes,title,is_active,created_at",
    )
    .eq("user_id", job.account_id)
    .eq("client_media_key", outputClientKey(job))
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data || null;
}

async function updateJobProgress(
  job: OptimizationJob,
  progress: number,
  stage?: string,
) {
  const safe = Math.max(1, Math.min(99, Math.round(progress)));
  const now = new Date().toISOString();
  const update = await supabaseAdmin
    .from("media_processing_jobs")
    .update({
      progress: safe,
      result: { stage: stage || mapMediaLibraryOptimizationStage(safe) },
      lock_expires_at: new Date(
        Date.now() + MEDIA_LIBRARY_OPTIMIZATION_WORKER_LEASE_SECONDS * 1_000,
      ).toISOString(),
      updated_at: now,
    })
    .eq("id", job.id)
    .eq("account_id", job.account_id)
    .eq("status", "processing")
    .select("id");
  if (update.error || !update.data?.[0]) {
    throw new MediaLibraryOptimizationError(
      "media_library_optimization_lease_lost",
      update.error?.message || "Le verrou de l’optimisation n’est plus actif.",
      true,
    );
  }
}

async function downloadSource(params: {
  job: OptimizationJob;
  media: OptimizationMedia;
  onProgress: (progress: number, stage?: string) => void;
}) {
  const signed = await supabaseAdmin.storage
    .from(params.media.bucket_name)
    .createSignedUrl(params.media.storage_path, 3_600);
  if (signed.error || !signed.data?.signedUrl) {
    throw new MediaLibraryOptimizationError(
      "media_library_source_signing_failed",
      signed.error?.message || "URL privée indisponible.",
      true,
    );
  }

  const sourceLimit =
    params.media.media_type === "video"
      ? MEDIA_LIBRARY_VIDEO_SOURCE_MAX_BYTES
      : MEDIA_LIBRARY_IMAGE_SOURCE_MAX_BYTES;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOURCE_DOWNLOAD_TIMEOUT_MS);
  let workDir = "";
  try {
    const response = await fetch(signed.data.signedUrl, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      throw new MediaLibraryOptimizationError(
        "media_library_source_download_failed",
        `Téléchargement de la source impossible (${response.status}).`,
        response.status >= 500 || response.status === 408 || response.status === 429,
      );
    }
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > sourceLimit) {
      throw new MediaLibraryOptimizationError(
        "media_library_source_too_large",
        "Le fichier dépasse le plafond de la Médiathèque.",
        false,
      );
    }

    workDir = await mkdtemp(path.join(tmpdir(), "inrcy-library-optimize-"));
    const inputPath = path.join(workDir, `${params.job.id}.source`);
    let bytes = 0;
    let lastProgress = 0;
    const hash = createHash("sha256");
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.byteLength;
        if (bytes > sourceLimit) {
          callback(
            new MediaLibraryOptimizationError(
              "media_library_source_too_large",
              "Le fichier dépasse le plafond de la Médiathèque.",
              false,
            ),
          );
          return;
        }
        hash.update(buffer);
        const total = contentLength || Number(params.media.size_bytes || 0);
        const nextProgress = total
          ? Math.max(5, Math.min(15, Math.round(5 + (bytes / total) * 10)))
          : 10;
        if (nextProgress >= lastProgress + 2) {
          lastProgress = nextProgress;
          params.onProgress(nextProgress, "Lecture du fichier original");
        }
        callback(null, buffer);
      },
    });
    await pipeline(
      Readable.fromWeb(response.body as any),
      meter,
      createWriteStream(inputPath, { flags: "wx" }),
    );
    if (!bytes) {
      throw new MediaLibraryOptimizationError(
        "media_library_source_empty",
        "Le fichier source est vide.",
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
    if (controller.signal.aborted) {
      throw new MediaLibraryOptimizationError(
        "media_library_source_download_timeout",
        "Le téléchargement du média a dépassé son délai de sécurité.",
        true,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function uploadAndRegisterOutput(params: {
  job: OptimizationJob;
  media: OptimizationMedia;
  outputPath: string;
  output: {
    mimeType: string;
    extension: string;
    sizeBytes: number;
    width: number;
    height: number;
    durationSeconds?: number | null;
    metadata: Record<string, unknown>;
  };
  sourceSha256: string;
}) {
  const existing = await findExistingOutput(params.job);
  if (existing) return existing;

  const mediaType = params.media.media_type as MediaLibraryOptimizationMediaType;
  const originalName =
    params.media.original_file_name || params.media.title || `media.${params.output.extension}`;
  const storagePath = buildOptimizedStoragePath({
    accountId: params.job.account_id,
    mediaType,
    originalName,
    jobId: params.job.id,
  });
  const fileSize = Number((await stat(params.outputPath)).size || 0);
  const targetBytes = targetBytesForJob(params.job, mediaType);
  if (
    !fileSize ||
    fileSize > targetBytes ||
    fileSize > getMediaLibraryOptimizationOutputLimit(mediaType)
  ) {
    throw new MediaLibraryOptimizationError(
      "media_library_output_size_invalid",
      "La copie optimisée dépasse le plafond de cet outil.",
      false,
    );
  }
  const outputHash = createHash("sha256");
  for await (const chunk of createReadStream(params.outputPath)) {
    outputHash.update(chunk);
  }
  const outputSha256 = outputHash.digest("hex");

  const upload = await supabaseAdmin.storage
    .from(MEDIA_LIBRARY_BUCKET)
    .upload(storagePath, createReadStream(params.outputPath), {
      upsert: true,
      contentType: params.output.mimeType,
      cacheControl: "31536000",
      duplex: "half",
      headers: { "content-length": String(fileSize) },
    });
  if (upload.error) {
    throw new MediaLibraryOptimizationError(
      "media_library_output_upload_failed",
      upload.error.message,
      true,
    );
  }

  const now = new Date().toISOString();
  const outputName = `${path.basename(originalName, path.extname(originalName)) || "media"}-optimise.${params.output.extension}`;
  const insert = await supabaseAdmin
    .from("pro_media_library")
    .insert({
      user_id: params.job.account_id,
      created_by_auth_user_id:
        String(params.job.payload?.authUserId || "").trim() ||
        params.media.created_by_auth_user_id ||
        null,
      bucket_name: MEDIA_LIBRARY_BUCKET,
      storage_path: storagePath,
      media_type: mediaType,
      mime_type: params.output.mimeType,
      detected_mime_type: params.output.mimeType,
      size_bytes: fileSize,
      title: buildOptimizedMediaTitle(params.media.title || originalName),
      tags: Array.isArray(params.media.tags) ? params.media.tags : [],
      source: "mediatheque_optimization",
      width: params.output.width,
      height: params.output.height,
      duration_seconds: params.output.durationSeconds || null,
      is_active: true,
      original_file_name: outputName,
      content_hash_sha256: outputSha256,
      client_media_key: outputClientKey(params.job),
      upload_protocol: "server_legacy",
      upload_status: "uploaded",
      upload_progress: 100,
      uploaded_at: now,
      processing_status: "not_requested",
      publication_status: "legacy_ready",
      processing_progress: 0,
      pipeline_version: MEDIA_LIBRARY_OPTIMIZATION_PIPELINE_VERSION,
      media_metadata: {
        library_optimization: {
          version: MEDIA_LIBRARY_OPTIMIZATION_PIPELINE_VERSION,
          source_media_id: params.media.id,
          source_sha256: params.sourceSha256,
          output_sha256: outputSha256,
          source_size_bytes: Number(params.media.size_bytes || 0),
          output_size_bytes: fileSize,
          target_bytes: targetBytes,
          job_id: params.job.id,
          completed_at: now,
          ...params.output.metadata,
        },
      },
    })
    .select(
      "id,user_id,bucket_name,storage_path,media_type,mime_type,size_bytes,title,is_active,created_at",
    )
    .single();

  if (insert.error) {
    if (insert.error.code === "23505") {
      const duplicate = await findExistingOutput(params.job);
      if (duplicate) return duplicate;
    }
    await supabaseAdmin.storage
      .from(MEDIA_LIBRARY_BUCKET)
      .remove([storagePath])
      .catch(() => undefined);
    throw insert.error;
  }
  return insert.data;
}

async function markSucceeded(params: {
  job: OptimizationJob;
  outputMedia: Record<string, unknown>;
  sourceSizeBytes: number;
}) {
  const now = new Date().toISOString();
  const update = await supabaseAdmin
    .from("media_processing_jobs")
    .update({
      status: "succeeded",
      progress: 100,
      result: {
        stage: "Copie optimisée créée",
        outputMediaId: params.outputMedia.id,
        outputSizeBytes: Number(params.outputMedia.size_bytes || 0),
        sourceSizeBytes: params.sourceSizeBytes,
      },
      error_code: null,
      error_message: null,
      completed_at: now,
      locked_at: null,
      lock_expires_at: null,
      locked_by: null,
      updated_at: now,
    })
    .eq("id", params.job.id)
    .eq("account_id", params.job.account_id)
    .eq("status", "processing");
  if (update.error) throw update.error;
}

async function markCancelled(job: OptimizationJob, error: MediaLibraryOptimizationError) {
  const now = new Date().toISOString();
  const update = await supabaseAdmin
    .from("media_processing_jobs")
    .update({
      status: "cancelled",
      progress: 0,
      result: { stage: "Optimisation annulée" },
      error_code: error.code,
      error_message: error.message,
      completed_at: now,
      locked_at: null,
      lock_expires_at: null,
      locked_by: null,
      updated_at: now,
    })
    .eq("id", job.id)
    .eq("account_id", job.account_id);
  if (update.error) throw update.error;
  return {
    jobId: job.id,
    mediaId: job.media_id,
    status: "cancelled" as const,
    errorCode: error.code,
  };
}

async function markFailed(job: OptimizationJob, rawError: unknown) {
  const error = normalizeWorkerError(rawError);
  if (
    error.code === "media_library_already_compatible" ||
    error.code === "media_library_already_below_target" ||
    error.code === "media_library_already_optimized"
  ) {
    return markCancelled(job, error);
  }
  const retryable = error.retryable && job.attempt_count < job.max_attempts;
  const now = new Date().toISOString();
  const delaySeconds = Math.min(600, 45 * 3 ** Math.max(0, job.attempt_count - 1));
  const status = retryable ? "retry_wait" : "failed";
  const update = await supabaseAdmin
    .from("media_processing_jobs")
    .update({
      status,
      progress: retryable ? 0 : Math.max(0, Number(job.progress || 0)),
      result: { stage: retryable ? "Nouvelle tentative programmée" : "Optimisation impossible" },
      available_at: retryable
        ? new Date(Date.now() + delaySeconds * 1_000).toISOString()
        : now,
      error_code: error.code,
      error_message: error.message,
      completed_at: retryable ? null : now,
      locked_at: null,
      lock_expires_at: null,
      locked_by: null,
      updated_at: now,
    })
    .eq("id", job.id)
    .eq("account_id", job.account_id);
  if (update.error) throw update.error;
  return {
    jobId: job.id,
    mediaId: job.media_id,
    status: status as "retry_wait" | "failed",
    errorCode: error.code,
  };
}

async function processClaimedJob(job: OptimizationJob): Promise<OptimizationSummary> {
  const startedAt = Date.now();
  const timing = {
    loadMediaMs: 0,
    existingLookupMs: 0,
    downloadMs: 0,
    transformMs: 0,
    uploadRegisterMs: 0,
    finalizeMs: 0,
  };
  let mediaType = mediaTypeForJob(String(job.payload?.jobType || ""));
  let operation = "unknown";
  let sourceSizeBytes = 0;
  let outputSizeBytes = 0;
  let workDir = "";
  try {
    const loadStartedAt = Date.now();
    const media = await loadMedia(job);
    timing.loadMediaMs = Date.now() - loadStartedAt;
    mediaType = media.media_type as MediaLibraryOptimizationMediaType;
    sourceSizeBytes = Number(media.size_bytes || 0);
    validateMedia(job, media);
    operation = optimizationRequirementsForMedia(job, media).operation;

    const existingLookupStartedAt = Date.now();
    const existing = await findExistingOutput(job);
    timing.existingLookupMs = Date.now() - existingLookupStartedAt;
    if (existing) {
      const finalizeStartedAt = Date.now();
      await markSucceeded({
        job,
        outputMedia: existing,
        sourceSizeBytes,
      });
      timing.finalizeMs = Date.now() - finalizeStartedAt;
      outputSizeBytes = Number(existing.size_bytes || 0);
      console.info("[media-library-optimization] timing", {
        jobId: job.id,
        status: "reused",
        mediaType,
        operation,
        sourceSizeBytes,
        outputSizeBytes,
        ...timing,
        totalMs: Date.now() - startedAt,
      });
      return {
        jobId: job.id,
        mediaId: job.media_id,
        outputMediaId: String(existing.id || ""),
        status: "succeeded",
      };
    }

    let lastProgress = 0;
    let lastWriteAt = 0;
    let progressChain: Promise<void> = Promise.resolve();
    let progressError: unknown = null;
    const queueProgress = (progress: number, stage?: string) => {
      const safe = Math.max(1, Math.min(99, Math.round(progress)));
      const now = Date.now();
      if (safe <= lastProgress) return;
      if (safe < 95 && safe - lastProgress < 2 && now - lastWriteAt < 1_500) return;
      lastProgress = safe;
      lastWriteAt = now;
      progressChain = progressChain.then(async () => {
        if (progressError) return;
        try {
          await updateJobProgress(job, safe, stage);
        } catch (error) {
          progressError = error;
        }
      });
    };

    queueProgress(2, "Préparation du média");
    const downloadStartedAt = Date.now();
    const downloaded = await downloadSource({ job, media, onProgress: queueProgress });
    timing.downloadMs = Date.now() - downloadStartedAt;
    workDir = downloaded.workDir;
    queueProgress(16, "Analyse du média");

    let outputPath = "";
    let output: Parameters<typeof uploadAndRegisterOutput>[0]["output"];
    const transformStartedAt = Date.now();
    if (media.media_type === "video") {
      outputPath = path.join(workDir, `${job.id}.mp4`);
      const compressed = await compressMediaLibraryVideo({
        inputPath: downloaded.inputPath,
        outputPath,
        fallbackWidth: media.width,
        fallbackHeight: media.height,
        targetBytes: processingTargetBytesForMedia(job, media),
        fallbackDurationSeconds: media.duration_seconds,
        onProgress: queueProgress,
      });
      output = {
        mimeType: compressed.mimeType,
        extension: compressed.extension,
        sizeBytes: compressed.sizeBytes,
        width: compressed.output.orientedWidth,
        height: compressed.output.orientedHeight,
        durationSeconds: compressed.output.durationSeconds,
        metadata: {
          kind: "video_optimization",
          operation: optimizationRequirementsForMedia(job, media).operation,
          source_conversion_required:
            optimizationRequirementsForMedia(job, media).needsConversion,
          source_compression_required:
            optimizationRequirementsForMedia(job, media).needsCompression,
          source_video_codec: compressed.source.videoCodec,
          source_audio_codec: compressed.source.audioCodec,
          output_video_codec: compressed.output.videoCodec,
          output_audio_codec: compressed.output.audioCodec,
          target_bytes: compressed.profile.targetBytes,
          video_bitrate: compressed.profile.videoBitrate,
          audio_bitrate: compressed.profile.audioBitrate,
        },
      };
    } else {
      const optimized = await optimizeMediaLibraryImage({
        inputPath: downloaded.inputPath,
        outputDirectory: workDir,
        targetBytes: targetBytesForJob(job, "image"),
        onProgress: queueProgress,
      });
      outputPath = optimized.outputPath;
      output = {
        mimeType: optimized.mimeType,
        extension: optimized.extension,
        sizeBytes: optimized.sizeBytes,
        width: optimized.width,
        height: optimized.height,
        durationSeconds: null,
        metadata: {
          kind: "image_optimization",
          output_quality: optimized.quality,
        },
      };
    }
    timing.transformMs = Date.now() - transformStartedAt;
    outputSizeBytes = Number(output.sizeBytes || 0);

    await progressChain;
    if (progressError) throw progressError;
    await updateJobProgress(job, 94, "Vérification du fichier optimisé");
    const uploadStartedAt = Date.now();
    const outputMedia = await uploadAndRegisterOutput({
      job,
      media,
      outputPath,
      output,
      sourceSha256: downloaded.sha256,
    });
    timing.uploadRegisterMs = Date.now() - uploadStartedAt;
    const finalizeStartedAt = Date.now();
    await updateJobProgress(job, 98, "Enregistrement dans la Médiathèque");
    await markSucceeded({
      job,
      outputMedia,
      sourceSizeBytes: downloaded.sizeBytes,
    });
    timing.finalizeMs = Date.now() - finalizeStartedAt;
    console.info("[media-library-optimization] timing", {
      jobId: job.id,
      status: "succeeded",
      mediaType,
      operation,
      sourceSizeBytes: downloaded.sizeBytes,
      outputSizeBytes,
      compressionRatio:
        downloaded.sizeBytes > 0
          ? Number((outputSizeBytes / downloaded.sizeBytes).toFixed(4))
          : null,
      ...timing,
      totalMs: Date.now() - startedAt,
    });
    return {
      jobId: job.id,
      mediaId: job.media_id,
      outputMediaId: String(outputMedia.id || ""),
      status: "succeeded",
    };
  } catch (error) {
    console.error("[media-library-optimization] job failed", {
      jobId: job.id,
      mediaId: job.media_id,
      mediaType,
      operation,
      sourceSizeBytes,
      outputSizeBytes,
      ...timing,
      totalMs: Date.now() - startedAt,
      error: compactMessage(error),
    });
    return markFailed(job, error);
  } finally {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

async function findCandidateJobs(limit: number) {
  const result = await supabaseAdmin
    .from("media_processing_jobs")
    .select(
      "id,account_id,media_id,job_type,status,attempt_count,max_attempts,available_at,lock_expires_at,priority,created_at",
    )
    .in("job_type", [...MEDIA_LIBRARY_OPTIMIZATION_JOB_TYPES])
    .in("status", ["queued", "retry_wait", "processing"])
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(Math.max(8, limit * 8));
  if (result.error) throw result.error;
  const now = Date.now();
  return (result.data || []).filter((row: any) => {
    if (Number(row.attempt_count || 0) >= Number(row.max_attempts || 1)) return false;
    if (row.status === "processing") {
      const expires = Date.parse(String(row.lock_expires_at || ""));
      return Number.isFinite(expires) && expires <= now;
    }
    const available = Date.parse(String(row.available_at || ""));
    return !Number.isFinite(available) || available <= now;
  });
}

export async function processMediaLibraryOptimizationForMedia(params: {
  accountId: string;
  mediaId: string;
  jobType: MediaLibraryOptimizationJobType;
  workerId?: string;
}) {
  const workerId =
    String(params.workerId || "").trim() ||
    `library-optimization-${process.env.VERCEL_REGION || "local"}-${randomUUID()}`;
  const claimed = await claimTargetedProcessingJob({
    accountId: params.accountId,
    mediaId: params.mediaId,
    jobType: params.jobType,
    workerId: workerId.slice(0, 180),
    leaseSeconds: MEDIA_LIBRARY_OPTIMIZATION_WORKER_LEASE_SECONDS,
  });
  if (!claimed) return { claimed: 0, jobs: [] as OptimizationSummary[] };
  const summary = await processClaimedJob(claimed as OptimizationJob);
  return { claimed: 1, jobs: [summary] };
}

export async function processMediaLibraryOptimizationJobs(params?: {
  limit?: number;
  workerId?: string;
}) {
  const limit = Math.max(1, Math.min(2, Math.round(params?.limit || 1)));
  const workerId =
    String(params?.workerId || "").trim() ||
    `library-optimization-cron-${process.env.VERCEL_REGION || "local"}-${randomUUID()}`;
  const candidates = await findCandidateJobs(limit);
  const summaries: OptimizationSummary[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (summaries.length >= limit) break;
    const key = `${candidate.account_id}:${candidate.media_id}:${candidate.job_type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const claimed = await claimTargetedProcessingJob({
      accountId: String(candidate.account_id),
      mediaId: String(candidate.media_id),
      jobType: String(candidate.job_type),
      workerId: workerId.slice(0, 180),
      leaseSeconds: MEDIA_LIBRARY_OPTIMIZATION_WORKER_LEASE_SECONDS,
    });
    if (!claimed) continue;
    summaries.push(await processClaimedJob(claimed as OptimizationJob));
  }
  return {
    claimed: summaries.length,
    succeeded: summaries.filter((job) => job.status === "succeeded").length,
    retrying: summaries.filter((job) => job.status === "retry_wait").length,
    failed: summaries.filter((job) => job.status === "failed").length,
    cancelled: summaries.filter((job) => job.status === "cancelled").length,
    jobs: summaries,
  };
}
