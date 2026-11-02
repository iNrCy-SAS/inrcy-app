import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createSafeStorageSignedUrl } from "@/lib/safeStorageSignedUrl";
import { VIDEO_NORMALIZATION_MAX_SOURCE_BYTES, VIDEO_NORMALIZATION_MAX_SOURCE_MB_LABEL, VIDEO_NORMALIZATION_PIPELINE_VERSION, buildVideoNormalizationStoragePath } from "@/lib/mediaVideoNormalizationPolicy";
import { type NormalizedVideoVariant } from "@/lib/mediaVideoNormalizer";
import { withStorageBinaryMetadata } from "@/lib/supabaseStorageBinary";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { type ClaimedVideoJob, type MediaRow, type VariantRow } from "@/lib/mediaVideoNormalizationWorkerTypes";
import { VideoNormalizationError } from "@/lib/mediaVideoNormalizationWorkerPolicy";

// The source is capped at exactly 75,000,000 bytes before this worker. Keep a bounded transfer
// timeout while still tolerating a slow private Storage link.
const VIDEO_SOURCE_DOWNLOAD_TIMEOUT_MS = 240_000;

export async function downloadSourceToTemp(
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

export async function uploadVariant(params: {
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
