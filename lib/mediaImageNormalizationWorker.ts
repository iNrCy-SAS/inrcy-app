import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { normalizeImageSourcePurposes } from "@/lib/mediaImageNormalizer";
import {
  BOOSTER_IMAGE_PREPARATION_PURPOSES,
  type BoosterPreparationMission,
} from "@/lib/boosterMediaPipelineMissions";
import { claimTargetedProcessingJob } from "@/lib/mediaProcessingTargetedClaim";
import {
  IMAGE_NORMALIZATION_DEFAULT_BATCH_SIZE,
  IMAGE_NORMALIZATION_JOB_TYPE,
  IMAGE_NORMALIZATION_MAX_BATCH_SIZE,
  IMAGE_NORMALIZATION_MAX_SOURCE_BYTES,
  IMAGE_NORMALIZATION_PIPELINE_VERSION,
  IMAGE_NORMALIZATION_PURPOSES,
  IMAGE_NORMALIZATION_WORKER_LEASE_SECONDS,
  buildImageNormalizationStoragePath,
  getImageNormalizationRetryDelaySeconds,
  isImageNormalizationEnabled,
  type ImageNormalizationPurpose,
} from "@/lib/mediaImageNormalizationPolicy";
import { refreshPublicationWorkspaceStatusesForMedia } from "@/lib/mediaWorkspaceServer";
import { createSafeStorageSignedUrl } from "@/lib/safeStorageSignedUrl";
import {
  toExactStorageArrayBuffer,
  withStorageBinaryMetadata,
} from "@/lib/supabaseStorageBinary";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type ClaimedImageJob = {
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
  upload_status: string;
  processing_status: string;
  publication_status: string;
  original_file_name: string | null;
  media_metadata: Record<string, unknown> | null;
};

type VariantRow = {
  id: string;
  purpose: ImageNormalizationPurpose;
  status: string;
  bucket_name: string | null;
  storage_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
};

type ImageVariantOutput = {
  purpose: ImageNormalizationPurpose;
  variantId: string;
  bucket: string;
  storagePath: string;
  mimeType: "image/jpeg" | "image/png";
  sizeBytes: number;
  width: number;
  height: number;
};

type ProcessedJobSummary = {
  jobId: string;
  mediaId: string;
  status: "succeeded" | "retry_wait" | "failed" | "cancelled";
  errorCode?: string;
};

class ImageNormalizationError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = "ImageNormalizationError";
    this.code = code;
    this.retryable = retryable;
  }
}

function compactMessage(error: unknown) {
  return String(error instanceof Error ? error.message : error || "Erreur inconnue")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1_500);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readPreparationMission(
  job: ClaimedImageJob,
): BoosterPreparationMission | null {
  const value = String(job.payload?.pipelineMission || "").trim();
  return value === "ai_preparation" || value === "publication_preparation"
    ? value
    : null;
}

function requiredImagePurposes(job: ClaimedImageJob) {
  const mission = readPreparationMission(job);
  return {
    mission,
    purposes: mission
      ? [...BOOSTER_IMAGE_PREPARATION_PURPOSES[mission]]
      : [...IMAGE_NORMALIZATION_PURPOSES],
  };
}

function classifyWorkerError(error: unknown) {
  if (error instanceof ImageNormalizationError) return error;
  const message = compactMessage(error).toLowerCase();
  const terminal =
    message.includes("unsupported image") ||
    message.includes("input file contains unsupported") ||
    message.includes("image_dimensions_unavailable") ||
    message.includes("heic_fallback_source_too_large") ||
    message.includes("image_source_too_large") ||
    message.includes("invalid image") ||
    message.includes("corrupt") ||
    message.includes("decode");

  return new ImageNormalizationError(
    terminal ? "image_decode_failed" : "image_worker_temporary_failure",
    compactMessage(error),
    !terminal,
  );
}

async function updateJobProgress(job: ClaimedImageJob, progress: number) {
  const safe = Math.max(1, Math.min(99, Math.round(progress)));
  const now = new Date().toISOString();
  await Promise.all([
    supabaseAdmin
      .from("media_processing_jobs")
      .update({
        progress: safe,
        lock_expires_at: new Date(
          Date.now() + IMAGE_NORMALIZATION_WORKER_LEASE_SECONDS * 1_000,
        ).toISOString(),
        updated_at: now,
      })
      .eq("id", job.id)
      .eq("account_id", job.account_id),
    supabaseAdmin
      .from("pro_media_library")
      .update({
        processing_status: "processing",
        publication_status: "processing",
        processing_progress: safe,
        processing_started_at: now,
        processing_error_code: null,
        processing_error_message: null,
      })
      .eq("id", job.media_id)
      .eq("user_id", job.account_id),
  ]);
}

async function loadMedia(job: ClaimedImageJob): Promise<MediaRow> {
  const result = await supabaseAdmin
    .from("pro_media_library")
    .select(
      "id,user_id,bucket_name,storage_path,media_type,mime_type,detected_mime_type,size_bytes,upload_status,processing_status,publication_status,original_file_name,media_metadata",
    )
    .eq("id", job.media_id)
    .eq("user_id", job.account_id)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) {
    throw new ImageNormalizationError(
      "image_media_not_found",
      "Média image introuvable.",
      false,
    );
  }
  return result.data as MediaRow;
}

async function loadVariants(job: ClaimedImageJob): Promise<VariantRow[]> {
  const result = await supabaseAdmin
    .from("media_variants")
    .select(
      "id,purpose,status,bucket_name,storage_path,mime_type,size_bytes,width,height",
    )
    .eq("account_id", job.account_id)
    .eq("media_id", job.media_id)
    .is("workspace_id", null)
    .in("purpose", [...IMAGE_NORMALIZATION_PURPOSES]);
  if (result.error) throw result.error;

  const rows = (result.data || []).filter((row: any) =>
    IMAGE_NORMALIZATION_PURPOSES.includes(
      String(row.purpose) as ImageNormalizationPurpose,
    ),
  ) as VariantRow[];
  const purposes = new Set(rows.map((row) => row.purpose));
  for (const purpose of IMAGE_NORMALIZATION_PURPOSES) {
    if (!purposes.has(purpose)) {
      throw new ImageNormalizationError(
        "image_variant_missing",
        `Variante ${purpose} absente du registre.`,
        true,
      );
    }
  }
  return rows;
}

function readyVariantOutput(variant: VariantRow): ImageVariantOutput | null {
  if (
    variant.status !== "ready" ||
    !variant.bucket_name ||
    !variant.storage_path ||
    !variant.size_bytes ||
    !variant.width ||
    !variant.height
  ) {
    return null;
  }
  const mimeType = variant.mime_type;
  if (mimeType !== "image/jpeg" && mimeType !== "image/png") {
    return null;
  }
  return {
    purpose: variant.purpose,
    variantId: variant.id,
    bucket: variant.bucket_name,
    storagePath: variant.storage_path,
    mimeType,
    sizeBytes: variant.size_bytes,
    width: variant.width,
    height: variant.height,
  };
}

async function markVariantsProcessing(job: ClaimedImageJob, variants: VariantRow[]) {
  if (!variants.length) return;
  const result = await supabaseAdmin
    .from("media_variants")
    .update({
      status: "processing",
      error_code: null,
      error_message: null,
      pipeline_version: IMAGE_NORMALIZATION_PIPELINE_VERSION,
    })
    .eq("account_id", job.account_id)
    .eq("media_id", job.media_id)
    .in(
      "id",
      variants.map((variant) => variant.id),
    );
  if (result.error) throw result.error;
}

async function downloadSourceToTemp(media: MediaRow, jobId: string) {
  // `loadMedia` scopes the registry row to job.account_id before this point.
  // Keep the Storage allow-list just as strict: only the account-owned upload
  // workspace or the account-owned output of the AI media studio may be read.
  const allowedPrefixes = [
    `users/${media.user_id}/workspace-source/`,
    `users/${media.user_id}/ai-generated/image/`,
  ];
  if (
    media.bucket_name !== "inrcy-pro-media" ||
    !allowedPrefixes.some((prefix) =>
      String(media.storage_path || "").startsWith(prefix),
    )
  ) {
    throw new ImageNormalizationError(
      "image_source_scope_invalid",
      "La source image ne se trouve pas dans l’espace de stockage autorisé.",
      false,
    );
  }

  const declaredSize = Number(media.size_bytes || 0);
  if (declaredSize > IMAGE_NORMALIZATION_MAX_SOURCE_BYTES) {
    throw new ImageNormalizationError(
      "image_source_too_large",
      "La source dépasse le plafond technique du worker image.",
      false,
    );
  }

  const signedUrl = await createSafeStorageSignedUrl(
    media.bucket_name,
    media.storage_path,
    300,
  );
  if (!signedUrl) {
    throw new ImageNormalizationError(
      "image_source_signing_failed",
      "URL source privée indisponible.",
      true,
    );
  }

  const response = await fetch(signedUrl, { cache: "no-store" });
  if (!response.ok || !response.body) {
    throw new ImageNormalizationError(
      "image_source_download_failed",
      `Téléchargement source impossible (${response.status}).`,
      response.status >= 500 || response.status === 408 || response.status === 429,
    );
  }

  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > IMAGE_NORMALIZATION_MAX_SOURCE_BYTES) {
    throw new ImageNormalizationError(
      "image_source_too_large",
      "La source dépasse le plafond technique du worker image.",
      false,
    );
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "inrcy-image-normalize-"));
  const inputPath = path.join(workDir, `${jobId || randomUUID()}.source`);
  let bytes = 0;
  const hash = createHash("sha256");
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > IMAGE_NORMALIZATION_MAX_SOURCE_BYTES) {
        callback(
          new ImageNormalizationError(
            "image_source_too_large",
            "La source dépasse le plafond technique du worker image.",
            false,
          ),
        );
        return;
      }
      hash.update(buffer);
      callback(null, buffer);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(response.body as any),
      meter,
      createWriteStream(inputPath, { flags: "wx" }),
    );
    return {
      workDir,
      inputPath,
      sizeBytes: bytes,
      sha256: hash.digest("hex"),
    };
  } catch (error) {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function uploadVariant(params: {
  job: ClaimedImageJob;
  variant: VariantRow;
  normalized: NonNullable<
    Awaited<ReturnType<typeof normalizeImageSourcePurposes>>["variants"][ImageNormalizationPurpose]
  >;
}): Promise<ImageVariantOutput> {
  const storagePath = buildImageNormalizationStoragePath({
    accountId: params.job.account_id,
    mediaId: params.job.media_id,
    purpose: params.variant.purpose,
    extension: params.normalized.extension,
  });
  const bucket = "inrcy-pro-media";
  const upload = await supabaseAdmin.storage
    .from(bucket)
    .upload(
      storagePath,
      toExactStorageArrayBuffer(params.normalized.buffer),
      {
        upsert: true,
        contentType: params.normalized.mimeType,
        cacheControl: "31536000",
      },
    );
  if (upload.error) {
    throw new ImageNormalizationError(
      "image_variant_upload_failed",
      upload.error.message,
      true,
    );
  }

  const update = await supabaseAdmin
    .from("media_variants")
    .update({
      status: "ready",
      bucket_name: bucket,
      storage_path: storagePath,
      mime_type: params.normalized.mimeType,
      size_bytes: params.normalized.sizeBytes,
      width: params.normalized.width,
      height: params.normalized.height,
      duration_seconds: null,
      pipeline_version: IMAGE_NORMALIZATION_PIPELINE_VERSION,
      transform_spec: params.normalized.transformSpec,
      variant_metadata: withStorageBinaryMetadata(params.normalized.metadata),
      error_code: null,
      error_message: null,
      ready_at: new Date().toISOString(),
    })
    .eq("id", params.variant.id)
    .eq("account_id", params.job.account_id)
    .eq("media_id", params.job.media_id);
  if (update.error) throw update.error;

  return {
    purpose: params.variant.purpose,
    variantId: params.variant.id,
    bucket,
    storagePath,
    mimeType: params.normalized.mimeType,
    sizeBytes: params.normalized.sizeBytes,
    width: params.normalized.width,
    height: params.normalized.height,
  };
}

async function markJobCancelled(
  job: ClaimedImageJob,
  variants: VariantRow[],
  reason: string,
): Promise<ProcessedJobSummary> {
  const now = new Date().toISOString();
  await Promise.all([
    supabaseAdmin
      .from("media_processing_jobs")
      .update({
        status: "cancelled",
        progress: 0,
        error_code: "image_normalization_cancelled",
        error_message: reason,
        completed_at: now,
        locked_at: null,
        lock_expires_at: null,
        locked_by: null,
      })
      .eq("id", job.id),
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
  ]);
  return { jobId: job.id, mediaId: job.media_id, status: "cancelled" };
}

async function markJobFailure(params: {
  job: ClaimedImageJob;
  variants: VariantRow[];
  error: unknown;
}): Promise<ProcessedJobSummary> {
  const normalized = classifyWorkerError(params.error);
  const exhausted = params.job.attempt_count >= params.job.max_attempts;
  const retryable = normalized.retryable && !exhausted;
  const jobStatus = retryable ? "retry_wait" : "failed";
  const mediaStatus = retryable ? "failed_retryable" : "failed_terminal";
  const now = new Date();
  const availableAt = new Date(
    now.getTime() +
      getImageNormalizationRetryDelaySeconds(params.job.attempt_count) * 1_000,
  ).toISOString();

  const pendingVariantIds = params.variants
    .filter((variant) => variant.status !== "ready")
    .map((variant) => variant.id);

  const variantFailureUpdate = pendingVariantIds.length
    ? supabaseAdmin
        .from("media_variants")
        .update({
          status: "failed",
          error_code: normalized.code,
          error_message: normalized.message,
        })
        .in("id", pendingVariantIds)
        .eq("account_id", params.job.account_id)
    : Promise.resolve({ data: null, error: null });

  await Promise.all([
    supabaseAdmin
      .from("media_processing_jobs")
      .update({
        status: jobStatus,
        progress: 0,
        available_at: retryable ? availableAt : now.toISOString(),
        error_code: normalized.code,
        error_message: normalized.message,
        completed_at: retryable ? null : now.toISOString(),
        locked_at: null,
        lock_expires_at: null,
        locked_by: null,
      })
      .eq("id", params.job.id)
      .eq("account_id", params.job.account_id),
    variantFailureUpdate,
    supabaseAdmin
      .from("pro_media_library")
      .update({
        processing_status: mediaStatus,
        publication_status: retryable ? "processing" : "failed",
        processing_progress: 0,
        processing_error_code: normalized.code,
        processing_error_message: normalized.message,
        processing_completed_at: retryable ? null : now.toISOString(),
      })
      .eq("id", params.job.media_id)
      .eq("user_id", params.job.account_id),
  ]);

  await refreshPublicationWorkspaceStatusesForMedia({
    mediaId: params.job.media_id,
    accountId: params.job.account_id,
  }).catch((error) => {
    console.error("[media-pipeline] image failure workspace refresh failed", error);
  });

  return {
    jobId: params.job.id,
    mediaId: params.job.media_id,
    status: jobStatus,
    errorCode: normalized.code,
  };
}

async function processClaimedImageJob(
  job: ClaimedImageJob,
): Promise<ProcessedJobSummary> {
  let variants: VariantRow[] = [];
  let workDir = "";
  try {
    const media = await loadMedia(job);
    variants = await loadVariants(job);

    if (media.upload_status === "removed") {
      return await markJobCancelled(job, variants, "La source a été retirée.");
    }
    if (media.media_type !== "image") {
      return await markJobCancelled(job, variants, "Le média n’est pas une image.");
    }
    if (media.upload_status !== "uploaded") {
      throw new ImageNormalizationError(
        "image_source_not_uploaded",
        "La source image n’est pas encore disponible.",
        true,
      );
    }

    const { mission, purposes } = requiredImagePurposes(job);
    const requiredPurposeSet = new Set<ImageNormalizationPurpose>(purposes);
    const hasReadyCanonicalVariant = variants.some(
      (variant) =>
        variant.purpose === "canonical" &&
        variant.status === "ready" &&
        Boolean(variant.bucket_name && variant.storage_path),
    );
    const selectedVariants = variants.filter((variant) =>
      requiredPurposeSet.has(variant.purpose),
    );
    variants = selectedVariants;

    const reusableOutputs = Object.fromEntries(
      selectedVariants
        .map((variant) => [variant.purpose, readyVariantOutput(variant)] as const)
        .filter(
          (entry): entry is readonly [
            ImageNormalizationPurpose,
            NonNullable<ReturnType<typeof readyVariantOutput>>,
          ] => Boolean(entry[1]),
        ),
    ) as Partial<
      Record<
        ImageNormalizationPurpose,
        NonNullable<ReturnType<typeof readyVariantOutput>>
      >
    >;
    const pendingVariants = selectedVariants.filter(
      (variant) => !reusableOutputs[variant.purpose],
    );

    await markVariantsProcessing(job, pendingVariants);
    await updateJobProgress(job, 5);

    const downloaded = await downloadSourceToTemp(media, job.id);
    workDir = downloaded.workDir;
    await updateJobProgress(job, 25);

    const normalized = await normalizeImageSourcePurposes({
      inputPath: downloaded.inputPath,
      mimeType: media.detected_mime_type || media.mime_type || "",
      originalFileName: media.original_file_name,
      purposes: pendingVariants.map((variant) => variant.purpose),
    });
    await updateJobProgress(job, 60);

    const outputs: Partial<
      Record<ImageNormalizationPurpose, Awaited<ReturnType<typeof uploadVariant>>>
    > = {
      ...reusableOutputs,
    };
    for (const variant of pendingVariants) {
      const normalizedVariant = normalized.variants[variant.purpose];
      if (!normalizedVariant) {
        throw new ImageNormalizationError(
          "image_variant_output_missing",
          `La variante ${variant.purpose} n’a pas été produite.`,
          true,
        );
      }
      outputs[variant.purpose] = await uploadVariant({
        job,
        variant,
        normalized: normalizedVariant,
      });
    }
    await updateJobProgress(job, 90);

    const canonical = outputs.canonical;
    if (mission === "publication_preparation" && !canonical) {
      throw new ImageNormalizationError(
        "image_canonical_missing",
        "La variante canonique n’a pas été produite.",
        true,
      );
    }

    const completedAt = new Date().toISOString();
    const existingMetadata = asRecord(media.media_metadata);
    const previousNormalization = asRecord(existingMetadata.image_normalization);
    const previousVariants = asRecord(previousNormalization.variants);
    const mediaPatch: Record<string, unknown> = {
      width: normalized.source.width,
      height: normalized.source.height,
      content_hash_sha256: downloaded.sha256,
      detected_mime_type:
        media.detected_mime_type || media.mime_type || canonical?.mimeType || null,
      processing_status: "ready",
      publication_status: canonical || hasReadyCanonicalVariant
        ? "ready"
        : mission === "ai_preparation"
          ? "not_requested"
          : media.publication_status,
      processing_progress: 100,
      processing_error_code: null,
      processing_error_message: null,
      processing_completed_at: completedAt,
      pipeline_version: IMAGE_NORMALIZATION_PIPELINE_VERSION,
      media_metadata: {
        ...existingMetadata,
        image_normalization: {
          ...previousNormalization,
          version: IMAGE_NORMALIZATION_PIPELINE_VERSION,
          source: normalized.source,
          variants: { ...previousVariants, ...outputs },
          last_mission: mission || "legacy_full_normalization",
          completed_at: completedAt,
        },
      },
    };
    if (canonical) {
      Object.assign(mediaPatch, {
        canonical_bucket_name: canonical.bucket,
        canonical_storage_path: canonical.storagePath,
        canonical_mime_type: canonical.mimeType,
        canonical_size_bytes: canonical.sizeBytes,
      });
    }

    const mediaUpdate = await supabaseAdmin
      .from("pro_media_library")
      .update(mediaPatch)
      .eq("id", job.media_id)
      .eq("user_id", job.account_id);
    if (mediaUpdate.error) throw mediaUpdate.error;

    const jobUpdate = await supabaseAdmin
      .from("media_processing_jobs")
      .update({
        status: "succeeded",
        progress: 100,
        result: {
          pipelineVersion: IMAGE_NORMALIZATION_PIPELINE_VERSION,
          pipelineMission: mission || "legacy_full_normalization",
          sourceSha256: downloaded.sha256,
          sourceSizeBytes: downloaded.sizeBytes,
          source: normalized.source,
          variants: outputs,
        },
        error_code: null,
        error_message: null,
        completed_at: completedAt,
        locked_at: null,
        lock_expires_at: null,
        locked_by: null,
      })
      .eq("id", job.id)
      .eq("account_id", job.account_id);
    if (jobUpdate.error) throw jobUpdate.error;

    await refreshPublicationWorkspaceStatusesForMedia({
      mediaId: job.media_id,
      accountId: job.account_id,
    });

    return { jobId: job.id, mediaId: job.media_id, status: "succeeded" };
  } catch (error) {
    return await markJobFailure({ job, variants, error });
  } finally {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

async function claimImageJobs(params: { workerId: string; limit: number }) {
  const result = await supabaseAdmin.rpc("inrcy_claim_image_normalization_jobs", {
    p_worker_id: params.workerId,
    p_limit: params.limit,
    p_lease_seconds: IMAGE_NORMALIZATION_WORKER_LEASE_SECONDS,
  });
  if (result.error) throw result.error;
  return (Array.isArray(result.data) ? result.data : []) as ClaimedImageJob[];
}

export async function processImageNormalizationJobs(params?: {
  limit?: number;
  workerId?: string;
}) {
  if (!isImageNormalizationEnabled()) {
    return {
      enabled: false,
      claimed: 0,
      succeeded: 0,
      retrying: 0,
      failed: 0,
      cancelled: 0,
      jobs: [] as ProcessedJobSummary[],
    };
  }

  const limit = Math.max(
    1,
    Math.min(
      IMAGE_NORMALIZATION_MAX_BATCH_SIZE,
      Math.round(params?.limit || IMAGE_NORMALIZATION_DEFAULT_BATCH_SIZE),
    ),
  );
  const workerId =
    String(params?.workerId || "").trim() ||
    `image-worker-${process.env.VERCEL_REGION || "local"}-${randomUUID()}`;
  const jobs = await claimImageJobs({ workerId, limit });
  const summaries: ProcessedJobSummary[] = [];

  // Séquentiel par défaut : une image 4K et ses trois sorties peuvent déjà
  // consommer une quantité significative de mémoire dans un runtime serverless.
  for (let index = 0; index < jobs.length; index += 2) {
    summaries.push(
      ...(await Promise.all(
        jobs.slice(index, index + 2).map(processClaimedImageJob),
      )),
    );
  }

  return {
    enabled: true,
    claimed: jobs.length,
    succeeded: summaries.filter((item) => item.status === "succeeded").length,
    retrying: summaries.filter((item) => item.status === "retry_wait").length,
    failed: summaries.filter((item) => item.status === "failed").length,
    cancelled: summaries.filter((item) => item.status === "cancelled").length,
    jobs: summaries,
  };
}

export async function processImageNormalizationJobsForMedia(params: {
  accountId: string;
  mediaIds: readonly string[];
  workerId?: string;
}) {
  if (!isImageNormalizationEnabled()) {
    return {
      enabled: false,
      requested: 0,
      claimed: 0,
      succeeded: 0,
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
  ).slice(0, 5);
  if (!accountId || mediaIds.length === 0) {
    return {
      enabled: true,
      requested: mediaIds.length,
      claimed: 0,
      succeeded: 0,
      retrying: 0,
      failed: 0,
      cancelled: 0,
      jobs: [] as ProcessedJobSummary[],
    };
  }

  const workerId =
    String(params.workerId || "").trim() ||
    `image-workspace-${process.env.VERCEL_REGION || "local"}-${randomUUID()}`;
  const claimedJobs: ClaimedImageJob[] = [];
  for (const mediaId of mediaIds) {
    const job = await claimTargetedProcessingJob({
      accountId,
      mediaId,
      jobType: IMAGE_NORMALIZATION_JOB_TYPE,
      workerId: workerId.slice(0, 180),
      leaseSeconds: IMAGE_NORMALIZATION_WORKER_LEASE_SECONDS,
    });
    if (job) claimedJobs.push(job as ClaimedImageJob);
  }

  const summaries: ProcessedJobSummary[] = [];
  for (let index = 0; index < claimedJobs.length; index += 2) {
    summaries.push(
      ...(await Promise.all(
        claimedJobs.slice(index, index + 2).map(processClaimedImageJob),
      )),
    );
  }

  return {
    enabled: true,
    requested: mediaIds.length,
    claimed: claimedJobs.length,
    succeeded: summaries.filter((item) => item.status === "succeeded").length,
    retrying: summaries.filter((item) => item.status === "retry_wait").length,
    failed: summaries.filter((item) => item.status === "failed").length,
    cancelled: summaries.filter((item) => item.status === "cancelled").length,
    jobs: summaries,
  };
}
