import "server-only";

import { randomUUID } from "node:crypto";
import { enqueueImageNormalization } from "@/lib/mediaImageNormalizationQueue";
import { getImageNormalizationSignature } from "@/lib/mediaImageNormalizationPolicy";
import { processImageNormalizationJobsForMedia } from "@/lib/mediaImageNormalizationWorker";
import { INR_MEDIA_IMAGE_MAX_BYTES, INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES } from "@/lib/mediaRules";
import { enqueueVideoNormalization } from "@/lib/mediaVideoNormalizationQueue";
import { getVideoNormalizationSignature } from "@/lib/mediaVideoNormalizationPolicy";
import {
  probeVideoSource,
  resolveVideoNormalizationFfmpegPath,
  type VideoSourceProbe,
} from "@/lib/mediaVideoNormalizer";
import {
  canPublishVideoSourceDirectly,
  getDirectVideoCompatibility,
  hasServerVideoProbeProvenance,
} from "@/lib/mediaVideoSourceCompatibility";
import { refreshPublicationWorkspaceMediaStatus } from "@/lib/mediaWorkspaceServer";
import { createSafeStorageSignedUrl } from "@/lib/safeStorageSignedUrl";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type JsonRecord = Record<string, unknown>;

type WorkspacePublicationMedia = {
  mediaId: string;
  mediaType: "image" | "video";
  uploadStatus: string;
  processingStatus: string;
  publicationStatus: string;
  bucket: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  mediaMetadata: JsonRecord;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function positiveNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function sourceProof(media: WorkspacePublicationMedia) {
  const normalization = asRecord(media.mediaMetadata.video_normalization);
  // Codec/FPS reported by the browser is descriptive only. It must never
  // authorize sending the original binary to a provider.
  const source = asRecord(normalization.source);
  return hasServerVideoProbeProvenance(source) ? source : {};
}

function isDirectPublicationVideo(media: WorkspacePublicationMedia) {
  if (media.mediaType !== "video" || !media.storagePath) return false;
  const proof = sourceProof(media);
  return (
    hasServerVideoProbeProvenance(proof) &&
    canPublishVideoSourceDirectly({
      name: media.fileName,
      mimeType: media.mimeType,
      storagePath: media.storagePath,
      sizeBytes: media.sizeBytes,
      maxBytes: INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES,
      videoCodec: proof.videoCodec || proof.video_codec,
      audioCodec: proof.audioCodec || proof.audio_codec,
      frameRate: proof.frameRate || proof.frame_rate || proof.fps,
      hasAudio: proof.hasAudio ?? proof.has_audio,
      containerFormats:
        proof.containerFormats ||
        proof.container_formats ||
        proof.source_container_formats,
      pixelFormat:
        proof.pixelFormat || proof.pixel_format || proof.source_pixel_format,
      requireCodecProof: true,
    })
  );
}

function isDirectPublicationImage(media: WorkspacePublicationMedia) {
  if (media.mediaType !== "image" || !media.storagePath) return false;
  const mimeType = media.mimeType.toLowerCase().split(";")[0]?.trim();
  const normalization = asRecord(media.mediaMetadata.image_normalization);
  const proof = asRecord(normalization.source);
  if (proof.probeProvenance !== "server_sharp") return false;
  const format = String(proof.format || "").trim().toLowerCase();
  const formatMatchesMime =
    (mimeType === "image/jpeg" && ["jpeg", "jpg"].includes(format)) ||
    (mimeType === "image/png" && format === "png") ||
    (mimeType === "image/webp" && format === "webp");
  const width = positiveNumber(proof.width);
  const height = positiveNumber(proof.height);
  return (
    ["image/jpeg", "image/png", "image/webp"].includes(mimeType) &&
    formatMatchesMime &&
    media.sizeBytes > 0 &&
    media.sizeBytes <= INR_MEDIA_IMAGE_MAX_BYTES &&
    Boolean(width && height)
  );
}

function isTerminalFailure(media: WorkspacePublicationMedia) {
  return (
    ["failed", "removed"].includes(media.uploadStatus) ||
    media.processingStatus === "failed_terminal" ||
    ["failed", "removed"].includes(media.publicationStatus)
  );
}

async function loadOwnedWorkspaceMedia(params: {
  accountId: string;
  workspaceId: string;
}) {
  const workspace = await supabaseAdmin
    .from("publication_workspaces")
    .select("id")
    .eq("id", params.workspaceId)
    .eq("account_id", params.accountId)
    .maybeSingle();
  if (workspace.error) throw workspace.error;
  if (!workspace.data) throw new Error("workspace_not_found");

  const result = await supabaseAdmin
    .from("publication_workspace_media")
    .select(
      "media_id,pro_media_library!inner(id,user_id,media_type,upload_status,processing_status,publication_status,bucket_name,storage_path,original_file_name,mime_type,detected_mime_type,size_bytes,width,height,duration_seconds,media_metadata)",
    )
    .eq("workspace_id", params.workspaceId)
    .eq("pro_media_library.user_id", params.accountId)
    .order("position", { ascending: true });
  if (result.error) throw result.error;

  return (result.data || []).map((row: any): WorkspacePublicationMedia => {
    const item = Array.isArray(row.pro_media_library)
      ? row.pro_media_library[0]
      : row.pro_media_library;
    return {
      mediaId: String(row.media_id || item?.id || ""),
      mediaType: item?.media_type === "video" ? "video" : "image",
      uploadStatus: String(item?.upload_status || "pending"),
      processingStatus: String(item?.processing_status || "not_requested"),
      publicationStatus: String(item?.publication_status || "not_requested"),
      bucket: String(item?.bucket_name || ""),
      storagePath: String(item?.storage_path || ""),
      fileName: String(item?.original_file_name || "media-inrcy"),
      mimeType: String(
        item?.detected_mime_type ||
          item?.mime_type ||
          (item?.media_type === "video" ? "video/mp4" : "image/jpeg"),
      ),
      sizeBytes: Number(item?.size_bytes || 0),
      width: positiveNumber(item?.width),
      height: positiveNumber(item?.height),
      durationSeconds: positiveNumber(item?.duration_seconds),
      mediaMetadata: asRecord(item?.media_metadata),
    };
  });
}

async function loadReadyCanonicalMediaIds(params: {
  accountId: string;
  mediaIds: string[];
}) {
  if (!params.mediaIds.length) return new Set<string>();
  const result = await supabaseAdmin
    .from("media_variants")
    .select("media_id")
    .eq("account_id", params.accountId)
    .in("media_id", params.mediaIds)
    .eq("purpose", "canonical")
    .in("signature", [
      getImageNormalizationSignature("canonical"),
      getVideoNormalizationSignature("canonical"),
    ])
    .eq("status", "ready");
  if (result.error) throw result.error;
  return new Set(
    (result.data || [])
      .map((row: any) => String(row.media_id || ""))
      .filter(Boolean),
  );
}

async function loadReadyVideoThumbnailMediaIds(params: {
  accountId: string;
  mediaIds: string[];
}) {
  if (!params.mediaIds.length) return new Set<string>();
  const result = await supabaseAdmin
    .from("media_variants")
    .select("media_id")
    .eq("account_id", params.accountId)
    .in("media_id", params.mediaIds)
    .eq("purpose", "thumbnail")
    .eq("signature", getVideoNormalizationSignature("thumbnail"))
    .eq("status", "ready");
  if (result.error) throw result.error;
  return new Set(
    (result.data || [])
      .map((row: any) => String(row.media_id || ""))
      .filter(Boolean),
  );
}

function hasReadyPublicationVariants(params: {
  media: WorkspacePublicationMedia;
  canonicalMediaIds: ReadonlySet<string>;
  videoThumbnailMediaIds: ReadonlySet<string>;
  requiresVideoThumbnail: boolean;
}) {
  if (params.media.mediaType === "image") {
    return params.canonicalMediaIds.has(params.media.mediaId);
  }
  const videoSourceReady =
    isDirectPublicationVideo(params.media) ||
    params.canonicalMediaIds.has(params.media.mediaId);
  return Boolean(
    videoSourceReady &&
      (!params.requiresVideoThumbnail ||
        params.videoThumbnailMediaIds.has(params.media.mediaId)),
  );
}

async function markCanonicalMediaReadyForPublication(params: {
  accountId: string;
  mediaIds: Iterable<string>;
}) {
  const mediaIds = [...new Set(params.mediaIds)].filter(Boolean);
  if (!mediaIds.length) return;
  const result = await supabaseAdmin
    .from("pro_media_library")
    .update({ publication_status: "ready" })
    .eq("user_id", params.accountId)
    .in("id", mediaIds)
    .eq("upload_status", "uploaded");
  if (result.error) throw result.error;
}

async function resetFailuresFromAnotherMission(params: {
  accountId: string;
  media: WorkspacePublicationMedia[];
}) {
  const mediaIds = params.media
    .filter((item) => {
      const previousMission = String(
        item.mediaMetadata.pipeline_mission || "",
      ).trim();
      return (
        item.uploadStatus === "uploaded" &&
        previousMission &&
        previousMission !== "publication_preparation" &&
        (item.processingStatus === "failed_terminal" ||
          item.processingStatus === "failed_retryable" ||
          item.publicationStatus === "failed")
      );
    })
    .map((item) => item.mediaId)
    .filter(Boolean);
  if (!mediaIds.length) return;

  const result = await supabaseAdmin
    .from("pro_media_library")
    .update({
      processing_status: "not_requested",
      processing_progress: 0,
      publication_status: "not_requested",
      processing_error_code: null,
      processing_error_message: null,
      processing_completed_at: null,
    })
    .eq("user_id", params.accountId)
    .in("id", mediaIds);
  if (result.error) throw result.error;
  params.media.forEach((item) => {
    if (!mediaIds.includes(item.mediaId)) return;
    item.processingStatus = "not_requested";
    item.publicationStatus = "not_requested";
  });
}

function canBenefitFromDirectVideoProbe(media: WorkspacePublicationMedia) {
  return getDirectVideoCompatibility({
    name: media.fileName,
    mimeType: media.mimeType,
    storagePath: media.storagePath,
    sizeBytes: media.sizeBytes,
    maxBytes: INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES,
    requireCodecProof: false,
  }).compatible;
}

async function persistVideoSourceProbe(params: {
  accountId: string;
  media: WorkspacePublicationMedia;
  probe: VideoSourceProbe;
}) {
  const normalization = asRecord(params.media.mediaMetadata.video_normalization);
  const nowIso = new Date().toISOString();
  const mediaMetadata = {
    ...params.media.mediaMetadata,
    pipeline_mission: "publication_preparation",
    preparation_scope: "publication_preparation",
    video_normalization: {
      ...normalization,
      source: {
        ...params.probe,
        probeProvenance: "server_ffmpeg",
        probedAt: nowIso,
      },
    },
  };
  const proofReady = isDirectPublicationVideo({
    ...params.media,
    width: params.probe.orientedWidth,
    height: params.probe.orientedHeight,
    durationSeconds: params.probe.durationSeconds,
    mediaMetadata,
  });
  const patch: JsonRecord = {
    width: params.probe.orientedWidth,
    height: params.probe.orientedHeight,
    duration_seconds: params.probe.durationSeconds,
    detected_mime_type: params.media.mimeType || null,
    media_metadata: mediaMetadata,
  };
  if (proofReady) {
    Object.assign(patch, {
      processing_status: "ready",
      publication_status: "ready",
      processing_progress: 100,
      processing_error_code: null,
      processing_error_message: null,
      processing_completed_at: nowIso,
    });
  }

  const update = await supabaseAdmin
    .from("pro_media_library")
    .update(patch)
    .eq("id", params.media.mediaId)
    .eq("user_id", params.accountId);
  if (update.error) throw update.error;

  params.media.width = params.probe.orientedWidth;
  params.media.height = params.probe.orientedHeight;
  params.media.durationSeconds = params.probe.durationSeconds;
  params.media.mediaMetadata = mediaMetadata;
  if (proofReady) {
    params.media.processingStatus = "ready";
    params.media.publicationStatus = "ready";
  }
  return proofReady;
}

async function probePotentialDirectVideo(params: {
  accountId: string;
  media: WorkspacePublicationMedia;
  ffmpegPath: string;
}) {
  if (!params.media.bucket || !params.media.storagePath) return false;
  const signedUrl = await createSafeStorageSignedUrl(
    params.media.bucket,
    params.media.storagePath,
    180,
  );
  if (!signedUrl) throw new Error("video_source_signing_failed");
  const probe = await probeVideoSource({
    ffmpegPath: params.ffmpegPath,
    inputPath: signedUrl,
    fallbackWidth: params.media.width,
    fallbackHeight: params.media.height,
    fallbackDurationSeconds: params.media.durationSeconds,
  });
  return persistVideoSourceProbe({ ...params, probe });
}

async function prioritizeJobs(params: {
  accountId: string;
  mediaIds: string[];
}) {
  if (!params.mediaIds.length) return;
  const result = await supabaseAdmin
    .from("media_processing_jobs")
    .update({ priority: 10_000, available_at: new Date().toISOString() })
    .eq("account_id", params.accountId)
    .in("media_id", params.mediaIds)
    .in("status", ["queued", "retry_wait"]);
  if (result.error) throw result.error;
}

/**
 * Owns the bounded publication-preparation step for durable publish jobs.
 * It probes an otherwise-unproven MP4 so a compatible H.264/AAC source is
 * published directly. When the source is not directly publishable, the
 * durable worker prepares a bounded MP4/H.264/AAC canonical fallback. The
 * thumbnail remains available for Pinterest and previews.
 */
export async function prepareWorkspaceMediaForPublication(params: {
  accountId: string;
  workspaceId: string;
  mediaTypes?: readonly ("image" | "video")[];
  videoChannels?: readonly string[];
}) {
  const requiresVideoThumbnail = Boolean(
    params.videoChannels?.includes("pinterest"),
  );
  const requestedMediaTypes = params.mediaTypes?.length
    ? new Set(params.mediaTypes)
    : null;
  const media = (await loadOwnedWorkspaceMedia(params)).filter(
    (item) => !requestedMediaTypes || requestedMediaTypes.has(item.mediaType),
  );
  await resetFailuresFromAnotherMission({
    accountId: params.accountId,
    media,
  });
  const canonicalMediaIds = await loadReadyCanonicalMediaIds({
    accountId: params.accountId,
    mediaIds: media.map((item) => item.mediaId).filter(Boolean),
  });
  const videoThumbnailMediaIds = requiresVideoThumbnail
    ? await loadReadyVideoThumbnailMediaIds({
        accountId: params.accountId,
        mediaIds: media
          .filter((item) => item.mediaType === "video")
          .map((item) => item.mediaId)
          .filter(Boolean),
      })
    : new Set<string>();
  await markCanonicalMediaReadyForPublication({
    accountId: params.accountId,
    mediaIds: canonicalMediaIds,
  });
  const pendingImages: string[] = [];
  const pendingVideos: string[] = [];
  let ffmpegPath: string | null = null;

  for (const item of media) {
    if (
      !item.mediaId ||
      item.uploadStatus !== "uploaded" ||
      isTerminalFailure(item) ||
      hasReadyPublicationVariants({
        media: item,
        canonicalMediaIds,
        videoThumbnailMediaIds,
        requiresVideoThumbnail,
      })
    ) {
      continue;
    }

    if (item.mediaType === "image") {
      if (isDirectPublicationImage(item)) continue;
      const enqueued = await enqueueImageNormalization({
        mediaId: item.mediaId,
        accountId: params.accountId,
        workspaceId: params.workspaceId,
        mission: "publication_preparation",
      });
      if (!enqueued.enabled) throw new Error("media_processing_disabled");
      pendingImages.push(item.mediaId);
      continue;
    }

    if (!isDirectPublicationVideo(item) && canBenefitFromDirectVideoProbe(item)) {
      try {
        ffmpegPath ||= await resolveVideoNormalizationFfmpegPath();
        await probePotentialDirectVideo({
          accountId: params.accountId,
          media: item,
          ffmpegPath,
        });
      } catch {
        // The durable preparation worker retries the bounded source probe.
      }
    }

    if (
      (isDirectPublicationVideo(item) || canonicalMediaIds.has(item.mediaId)) &&
      (!requiresVideoThumbnail || videoThumbnailMediaIds.has(item.mediaId))
    ) {
      continue;
    }

    const enqueued = await enqueueVideoNormalization({
      mediaId: item.mediaId,
      accountId: params.accountId,
      workspaceId: params.workspaceId,
      mission: "publication_preparation",
    });
    if (!enqueued.enabled) throw new Error("media_processing_disabled");
    pendingVideos.push(item.mediaId);
  }

  const pendingMediaIds = [...new Set([...pendingImages, ...pendingVideos])];
  await prioritizeJobs({
    accountId: params.accountId,
    mediaIds: pendingMediaIds,
  });

  const workerId = randomUUID();
  if (pendingImages.length) {
    await processImageNormalizationJobsForMedia({
      accountId: params.accountId,
      mediaIds: [...new Set(pendingImages)],
      workerId: `publish-preparation-image-${workerId}`,
    });
  }
  // Do not run the video worker here. The durable recovery cron owns the
  // thumbnail/probe retry so publish-now remains free to dispatch every other
  // channel. Normal upload/prepare paths already start the targeted worker.

  await refreshPublicationWorkspaceMediaStatus(params);
  const refreshedMedia = (await loadOwnedWorkspaceMedia(params)).filter(
    (item) => !requestedMediaTypes || requestedMediaTypes.has(item.mediaType),
  );
  const refreshedCanonicalMediaIds = await loadReadyCanonicalMediaIds({
    accountId: params.accountId,
    mediaIds: refreshedMedia.map((item) => item.mediaId).filter(Boolean),
  });
  const refreshedVideoThumbnailMediaIds = requiresVideoThumbnail
    ? await loadReadyVideoThumbnailMediaIds({
        accountId: params.accountId,
        mediaIds: refreshedMedia
          .filter((item) => item.mediaType === "video")
          .map((item) => item.mediaId)
          .filter(Boolean),
      })
    : new Set<string>();
  await markCanonicalMediaReadyForPublication({
    accountId: params.accountId,
    mediaIds: refreshedCanonicalMediaIds,
  });
  if (refreshedCanonicalMediaIds.size) {
    await refreshPublicationWorkspaceMediaStatus(params);
  }
  const terminalMediaIds = refreshedMedia
    .filter(
      (item) =>
        isTerminalFailure(item) &&
        !hasReadyPublicationVariants({
          media: item,
          canonicalMediaIds: refreshedCanonicalMediaIds,
          videoThumbnailMediaIds: refreshedVideoThumbnailMediaIds,
          requiresVideoThumbnail,
        }) &&
        !(item.mediaType === "image" && isDirectPublicationImage(item)),
    )
    .map((item) => item.mediaId)
    .filter(Boolean);
  const stillPendingMediaIds = refreshedMedia
    .filter(
      (item) =>
        !(isTerminalFailure(item) &&
          !hasReadyPublicationVariants({
            media: item,
            canonicalMediaIds: refreshedCanonicalMediaIds,
            videoThumbnailMediaIds: refreshedVideoThumbnailMediaIds,
            requiresVideoThumbnail,
          })) &&
        (item.uploadStatus !== "uploaded" ||
          (!hasReadyPublicationVariants({
            media: item,
            canonicalMediaIds: refreshedCanonicalMediaIds,
            videoThumbnailMediaIds: refreshedVideoThumbnailMediaIds,
            requiresVideoThumbnail,
          }) &&
            !(item.mediaType === "image" && isDirectPublicationImage(item)))),
    )
    .map((item) => item.mediaId)
    .filter(Boolean);
  const terminalMediaIdSet = new Set(terminalMediaIds);
  const pendingMediaIdSet = new Set(stillPendingMediaIds);
  const terminalImageMediaIds = refreshedMedia
    .filter(
      (item) =>
        item.mediaType === "image" && terminalMediaIdSet.has(item.mediaId),
    )
    .map((item) => item.mediaId)
    .filter(Boolean);
  const terminalVideoMediaIds = refreshedMedia
    .filter(
      (item) =>
        item.mediaType === "video" && terminalMediaIdSet.has(item.mediaId),
    )
    .map((item) => item.mediaId)
    .filter(Boolean);
  const pendingImageMediaIds = refreshedMedia
    .filter(
      (item) =>
        item.mediaType === "image" && pendingMediaIdSet.has(item.mediaId),
    )
    .map((item) => item.mediaId)
    .filter(Boolean);
  const pendingVideoMediaIds = refreshedMedia
    .filter(
      (item) =>
        item.mediaType === "video" && pendingMediaIdSet.has(item.mediaId),
    )
    .map((item) => item.mediaId)
    .filter(Boolean);
  const videoThumbnailMissingMedia = requiresVideoThumbnail
    ? refreshedMedia.filter(
        (item) =>
          item.mediaType === "video" &&
          !refreshedVideoThumbnailMediaIds.has(item.mediaId),
      )
    : [];
  return {
    mediaCount: refreshedMedia.length,
    queuedMediaIds: pendingMediaIds,
    pendingMediaIds: stillPendingMediaIds,
    pendingImageMediaIds,
    pendingVideoMediaIds,
    terminalMediaIds,
    terminalImageMediaIds,
    terminalVideoMediaIds,
    pendingVideoThumbnailMediaIds: videoThumbnailMissingMedia
      .filter((item) => !isTerminalFailure(item))
      .map((item) => item.mediaId)
      .filter(Boolean),
    terminalVideoThumbnailMediaIds: videoThumbnailMissingMedia
      .filter((item) => isTerminalFailure(item))
      .map((item) => item.mediaId)
      .filter(Boolean),
  };
}
