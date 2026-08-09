import { randomUUID } from "node:crypto";
import { after, NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { enforceRateLimit } from "@/lib/rateLimit";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  isBoosterMediaPipelineMission,
  type BoosterMediaPipelineMission,
} from "@/lib/boosterMediaPipelineMissions";
import { enqueueImageNormalization } from "@/lib/mediaImageNormalizationQueue";
import { enqueueVideoNormalization } from "@/lib/mediaVideoNormalizationQueue";
import { processImageNormalizationJobsForMedia } from "@/lib/mediaImageNormalizationWorker";
import { processVideoNormalizationJobsForMedia } from "@/lib/mediaVideoNormalizationWorker";
import { refreshPublicationWorkspaceMediaStatus } from "@/lib/mediaWorkspaceServer";
import {
  canPublishVideoSourceDirectly,
  hasServerVideoProbeProvenance,
} from "@/lib/mediaVideoSourceCompatibility";
import { INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES } from "@/lib/mediaRules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 1_800;

type PreparationMission = Exclude<
  BoosterMediaPipelineMission,
  "source_metadata"
>;

type WorkspaceMedia = {
  mediaId: string;
  mediaType: "image" | "video";
  position: number;
  uploadStatus: string;
  uploadProgress: number;
  processingStatus: string;
  processingProgress: number;
  processingErrorCode: string | null;
  processingErrorMessage: string | null;
  publicationStatus: string;
  bucket: string;
  storagePath: string;
  fileName: string;
  clientMediaKey: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  mediaMetadata: Record<string, unknown>;
};

type ReadyVariantState = Map<string, Map<string, number>>;

function cleanText(value: unknown, fallback = "", max = 500) {
  return String(value ?? fallback).trim().slice(0, max);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function jsonError(error: string, status = 400, code?: string) {
  return NextResponse.json(
    { ok: false, error, ...(code ? { code } : {}) },
    { status },
  );
}

function readMission(value: unknown): PreparationMission | null {
  if (!isBoosterMediaPipelineMission(value) || value === "source_metadata") {
    return null;
  }
  return value;
}

async function loadOwnedWorkspaceMedia(params: {
  workspaceId: string;
  accountId: string;
}) {
  const workspaceResult = await supabaseAdmin
    .from("publication_workspaces")
    .select("id,account_id,status,revision")
    .eq("id", params.workspaceId)
    .eq("account_id", params.accountId)
    .maybeSingle();
  if (workspaceResult.error) throw workspaceResult.error;
  if (!workspaceResult.data) return null;

  const mediaResult = await supabaseAdmin
    .from("publication_workspace_media")
    .select(
      "position,media_id,pro_media_library!inner(id,user_id,media_type,upload_status,upload_progress,processing_status,processing_progress,processing_error_code,processing_error_message,publication_status,bucket_name,storage_path,original_file_name,client_media_key,mime_type,size_bytes,width,height,duration_seconds,media_metadata)",
    )
    .eq("workspace_id", params.workspaceId)
    .eq("pro_media_library.user_id", params.accountId)
    .order("position", { ascending: true });
  if (mediaResult.error) throw mediaResult.error;

  const media: WorkspaceMedia[] = (mediaResult.data || []).map((row: any) => {
    const item = Array.isArray(row.pro_media_library)
      ? row.pro_media_library[0]
      : row.pro_media_library;
    return {
      mediaId: String(row.media_id || item?.id || ""),
      mediaType: item?.media_type === "video" ? "video" : "image",
      position: Number(row.position || 0),
      uploadStatus: String(item?.upload_status || "pending"),
      uploadProgress: Number(item?.upload_progress || 0),
      processingStatus: String(item?.processing_status || "not_requested"),
      processingProgress: Number(item?.processing_progress || 0),
      processingErrorCode: item?.processing_error_code
        ? String(item.processing_error_code)
        : null,
      processingErrorMessage: item?.processing_error_message
        ? String(item.processing_error_message)
        : null,
      publicationStatus: String(item?.publication_status || "not_requested"),
      bucket: String(item?.bucket_name || ""),
      storagePath: String(item?.storage_path || ""),
      fileName: String(item?.original_file_name || "media-inrcy"),
      clientMediaKey: String(item?.client_media_key || ""),
      mimeType: String(item?.mime_type || "application/octet-stream"),
      sizeBytes: Number(item?.size_bytes || 0),
      width: Number(item?.width || 0) || null,
      height: Number(item?.height || 0) || null,
      durationSeconds: Number(item?.duration_seconds || 0) || null,
      mediaMetadata:
        item?.media_metadata &&
        typeof item.media_metadata === "object" &&
        !Array.isArray(item.media_metadata)
          ? item.media_metadata
          : {},
    };
  });

  return {
    workspace: workspaceResult.data,
    media,
  };
}

async function resetFailuresFromAnotherMission(params: {
  accountId: string;
  mission: PreparationMission;
  media: WorkspaceMedia[];
}) {
  const mediaIds = params.media
    .filter((item) => {
      const previousMission = cleanText(
        item.mediaMetadata.pipeline_mission,
        "",
        80,
      );
      const failed =
        ["failed_terminal", "failed_retryable"].includes(
          item.processingStatus,
        ) || item.publicationStatus === "failed";
      return Boolean(
        failed && previousMission && previousMission !== params.mission,
      );
    })
    .map((item) => item.mediaId)
    .filter(Boolean);
  if (!mediaIds.length) return false;

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
  return true;
}

async function loadReadyVariantState(params: {
  accountId: string;
  media: WorkspaceMedia[];
}): Promise<ReadyVariantState> {
  const mediaIds = params.media.map((item) => item.mediaId).filter(Boolean);
  const state: ReadyVariantState = new Map();
  if (!mediaIds.length) return state;

  const result = await supabaseAdmin
    .from("media_variants")
    .select("media_id,purpose,status")
    .eq("account_id", params.accountId)
    .in("media_id", mediaIds)
    .eq("status", "ready")
    .in("purpose", [
      "canonical",
      "ai_preview",
      "thumbnail",
      "video_frame",
      "audio_track",
    ]);
  if (result.error) throw result.error;

  for (const row of result.data || []) {
    const mediaId = cleanText((row as { media_id?: unknown }).media_id, "", 80);
    const purpose = cleanText((row as { purpose?: unknown }).purpose, "", 80);
    if (!mediaId || !purpose) continue;
    const purposes = state.get(mediaId) || new Map<string, number>();
    purposes.set(purpose, (purposes.get(purpose) || 0) + 1);
    state.set(mediaId, purposes);
  }
  return state;
}

function hasVariant(
  variants: ReadyVariantState,
  mediaId: string,
  purpose: string,
) {
  return (variants.get(mediaId)?.get(purpose) || 0) > 0;
}

function hasAiArtifacts(media: WorkspaceMedia, variants: ReadyVariantState) {
  const hasPreview =
    hasVariant(variants, media.mediaId, "ai_preview") ||
    hasVariant(variants, media.mediaId, "canonical");
  if (media.mediaType === "image") return hasPreview;
  return hasVariant(variants, media.mediaId, "video_frame");
}

function canUseOriginalVideo(media: WorkspaceMedia) {
  if (media.mediaType !== "video" || media.uploadStatus !== "uploaded") {
    return false;
  }
  const normalization = asRecord(media.mediaMetadata.video_normalization);
  const source = asRecord(normalization.source);
  return (
    hasServerVideoProbeProvenance(source) &&
    canPublishVideoSourceDirectly({
      name: media.fileName,
      mimeType: media.mimeType,
      storagePath: media.storagePath,
      sizeBytes: media.sizeBytes,
      maxBytes: INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES,
      videoCodec: source.videoCodec ?? source.video_codec,
      audioCodec: source.audioCodec ?? source.audio_codec,
      frameRate: source.frameRate ?? source.frame_rate ?? source.fps,
      hasAudio: source.hasAudio ?? source.has_audio,
      containerFormats:
        source.containerFormats ?? source.container_formats,
      pixelFormat: source.pixelFormat ?? source.pixel_format,
      requireCodecProof: true,
    })
  );
}

function isTerminalMediaFailure(media: WorkspaceMedia) {
  return (
    media.uploadStatus === "failed" ||
    media.uploadStatus === "removed" ||
    media.processingStatus === "failed_terminal" ||
    media.publicationStatus === "failed" ||
    media.publicationStatus === "removed"
  );
}

function isMediaReady(params: {
  media: WorkspaceMedia;
  mission: PreparationMission;
  variants: ReadyVariantState;
}) {
  if (params.media.uploadStatus !== "uploaded") return false;
  if (params.mission === "ai_preparation") {
    return hasAiArtifacts(params.media, params.variants);
  }
  if (params.media.mediaType === "image") {
    return hasVariant(params.variants, params.media.mediaId, "canonical");
  }
  // The server-probed original stays the preferred publication source. A
  // canonical MP4/H.264/AAC is the durable fallback when that proof fails;
  // the thumbnail remains required for previews and Pinterest.
  const sourceReady =
    canUseOriginalVideo(params.media) ||
    hasVariant(params.variants, params.media.mediaId, "canonical");
  return (
    sourceReady &&
    hasVariant(params.variants, params.media.mediaId, "thumbnail")
  );
}

async function alignReadyMissionStatuses(params: {
  accountId: string;
  mission: PreparationMission;
  media: WorkspaceMedia[];
  variants: ReadyVariantState;
}) {
  const readyMedia = params.media.filter((media) =>
    isMediaReady({ media, mission: params.mission, variants: params.variants }),
  );
  if (!readyMedia.length) return false;

  const mediaIds = readyMedia
    .filter((media) =>
      params.mission === "ai_preparation"
        ? media.processingStatus !== "ready"
        : media.processingStatus !== "ready" ||
          !["ready", "legacy_ready"].includes(media.publicationStatus),
    )
    .map((media) => media.mediaId)
    .filter(Boolean);
  if (!mediaIds.length) return false;

  const patch: Record<string, unknown> = {
    processing_status: "ready",
    processing_progress: 100,
    processing_error_code: null,
    processing_error_message: null,
    processing_completed_at: new Date().toISOString(),
  };
  if (params.mission === "publication_preparation") {
    patch.publication_status = "ready";
  }

  const result = await supabaseAdmin
    .from("pro_media_library")
    .update(patch)
    .eq("user_id", params.accountId)
    .in("id", mediaIds);
  if (result.error) throw result.error;
  return true;
}

async function repairCompletedStorageUploads(params: {
  accountId: string;
  workspaceId: string;
  media: WorkspaceMedia[];
}) {
  let repaired = 0;
  for (const item of params.media) {
    if (
      !["pending", "uploading"].includes(item.uploadStatus) ||
      !item.bucket ||
      !item.storagePath ||
      item.sizeBytes <= 0
    ) {
      continue;
    }

    const cleanPath = item.storagePath.replace(/^\/+/, "");
    const segments = cleanPath.split("/").filter(Boolean);
    const objectName = segments.pop() || "";
    const folder = segments.join("/");
    if (!objectName) continue;

    const listed = await supabaseAdmin.storage.from(item.bucket).list(folder, {
      limit: 20,
      search: objectName,
    });
    if (listed.error) {
      console.warn("[media-pipeline] workspace upload repair listing failed", {
        workspaceId: params.workspaceId,
        mediaId: item.mediaId,
        error: listed.error,
      });
      continue;
    }

    const stored = (listed.data || []).find(
      (entry: any) => String(entry?.name || "") === objectName,
    ) as any;
    const metadata =
      stored?.metadata && typeof stored.metadata === "object"
        ? stored.metadata
        : {};
    const storedSize = Number(
      metadata.size ??
        metadata.contentLength ??
        metadata.content_length ??
        stored?.size ??
        0,
    );
    if (!stored || !Number.isFinite(storedSize) || storedSize !== item.sizeBytes) {
      continue;
    }

    const now = new Date().toISOString();
    const updated = await supabaseAdmin
      .from("pro_media_library")
      .update({
        upload_status: "uploaded",
        upload_progress: 100,
        uploaded_at: now,
        upload_error_code: null,
        upload_error_message: null,
      })
      .eq("id", item.mediaId)
      .eq("user_id", params.accountId)
      .in("upload_status", ["pending", "uploading"])
      .select("id");
    if (updated.error) throw updated.error;
    if (updated.data?.[0]) repaired += 1;
  }

  if (repaired > 0) {
    await refreshPublicationWorkspaceMediaStatus({
      workspaceId: params.workspaceId,
      accountId: params.accountId,
    });
  }
  return repaired;
}

function buildStatus(params: {
  media: WorkspaceMedia[];
  mission: PreparationMission;
  variants: ReadyVariantState;
}) {
  const failed = params.media.find(
    (media) =>
      !isMediaReady({
        media,
        mission: params.mission,
        variants: params.variants,
      }) && isTerminalMediaFailure(media),
  );
  if (failed) {
    return {
      status: "failed" as const,
      message:
        failed.processingErrorMessage ||
        (failed.uploadStatus === "failed"
          ? "L’envoi du média a échoué. Retirez-le puis ajoutez-le de nouveau."
          : "La préparation du média a échoué. Retirez-le puis ajoutez-le de nouveau."),
    };
  }
  if (
    params.media.length > 0 &&
    params.media.every((media) =>
      isMediaReady({ media, mission: params.mission, variants: params.variants }),
    )
  ) {
    return { status: "ready" as const, message: null };
  }
  if (params.media.some((item) => item.uploadStatus !== "uploaded")) {
    return {
      status: "uploading" as const,
      message: "L’envoi du média vers le stockage sécurisé est encore en cours.",
    };
  }
  return {
    status: "processing" as const,
    message:
      params.mission === "ai_preparation"
        ? "Le média est en cours de préparation pour l’analyse IA."
        : "Le média est en cours de préparation pour la publication.",
  };
}

async function resetLegacyReadyRowsMissingAiArtifacts(params: {
  accountId: string;
  media: WorkspaceMedia[];
  variants: ReadyVariantState;
}) {
  const mediaIds = params.media
    .filter(
      (item) =>
        item.uploadStatus === "uploaded" &&
        item.processingStatus === "ready" &&
        !hasAiArtifacts(item, params.variants),
    )
    .map((item) => item.mediaId)
    .filter(Boolean);
  if (!mediaIds.length) return false;

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
  return true;
}

async function enqueueWorkspaceMedia(params: {
  accountId: string;
  workspaceId: string;
  media: WorkspaceMedia[];
  mission: PreparationMission;
  variants: ReadyVariantState;
}) {
  let processingEnabled = true;
  for (const item of params.media) {
    if (
      item.uploadStatus !== "uploaded" ||
      isMediaReady({
        media: item,
        mission: params.mission,
        variants: params.variants,
      }) ||
      isTerminalMediaFailure(item)
    ) {
      continue;
    }

    if (item.mediaType === "video") {
      const result = await enqueueVideoNormalization({
        mediaId: item.mediaId,
        accountId: params.accountId,
        workspaceId: params.workspaceId,
        mission: params.mission,
      });
      processingEnabled = processingEnabled && result.enabled;
    } else {
      const result = await enqueueImageNormalization({
        mediaId: item.mediaId,
        accountId: params.accountId,
        workspaceId: params.workspaceId,
        mission: params.mission,
      });
      processingEnabled = processingEnabled && result.enabled;
    }
  }
  return processingEnabled;
}

async function prioritizeWorkspaceJobs(params: {
  accountId: string;
  mediaIds: string[];
}) {
  if (!params.mediaIds.length) return;
  const result = await supabaseAdmin
    .from("media_processing_jobs")
    .update({
      priority: 10_000,
      available_at: new Date().toISOString(),
    })
    .eq("account_id", params.accountId)
    .in("media_id", params.mediaIds)
    .in("status", ["queued", "retry_wait"]);
  if (result.error) throw result.error;
}

export async function POST(request: Request) {
  try {
    const { errorResponse, activeUserId } = await requireUser();
    if (errorResponse) return errorResponse;

    const limited = await enforceRateLimit({
      name: "media_pipeline_workspace_prepare",
      identifier: activeUserId,
      limit: 120,
      fallbackLimit: 120,
      window: "10 m",
      failClosed: false,
    });
    if (limited) return limited;

    const body = await request.json().catch(() => null);
    const workspaceId = cleanText(body?.workspaceId, "", 80);
    const mission = readMission(body?.mission);
    const dispatchWorker = body?.dispatchWorker !== false;
    if (!workspaceId) {
      return jsonError("Espace média manquant.", 400, "workspace_required");
    }
    if (!mission) {
      return jsonError(
        "Mission de préparation média invalide.",
        400,
        "media_preparation_mission_invalid",
      );
    }

    let graph = await loadOwnedWorkspaceMedia({
      workspaceId,
      accountId: activeUserId,
    });
    if (!graph) {
      return jsonError(
        "Espace média introuvable pour cet établissement.",
        404,
        "workspace_not_found",
      );
    }

    const repairedUploads = await repairCompletedStorageUploads({
      accountId: activeUserId,
      workspaceId,
      media: graph.media,
    });
    if (repairedUploads > 0) {
      graph = await loadOwnedWorkspaceMedia({
        workspaceId,
        accountId: activeUserId,
      });
      if (!graph) {
        return jsonError(
          "Espace média introuvable après la réparation de l’upload.",
          404,
          "workspace_not_found",
        );
      }
    }

    if (
      await resetFailuresFromAnotherMission({
        accountId: activeUserId,
        mission,
        media: graph.media,
      })
    ) {
      graph = await loadOwnedWorkspaceMedia({
        workspaceId,
        accountId: activeUserId,
      });
      if (!graph) {
        return jsonError(
          "Espace média introuvable après le changement de mission.",
          404,
          "workspace_not_found",
        );
      }
    }

    let variants = await loadReadyVariantState({
      accountId: activeUserId,
      media: graph.media,
    });
    if (
      mission === "ai_preparation" &&
      (await resetLegacyReadyRowsMissingAiArtifacts({
        accountId: activeUserId,
        media: graph.media,
        variants,
      }))
    ) {
      graph = await loadOwnedWorkspaceMedia({
        workspaceId,
        accountId: activeUserId,
      });
      if (!graph) {
        return jsonError(
          "Espace média introuvable après la remise en préparation IA.",
          404,
          "workspace_not_found",
        );
      }
    }

    const initialStatus = buildStatus({
      media: graph.media,
      mission,
      variants,
    });
    if (initialStatus.status === "ready" || initialStatus.status === "failed") {
      if (
        initialStatus.status === "ready" &&
        (await alignReadyMissionStatuses({
          accountId: activeUserId,
          mission,
          media: graph.media,
          variants,
        }))
      ) {
        graph = await loadOwnedWorkspaceMedia({
          workspaceId,
          accountId: activeUserId,
        });
        if (!graph) {
          return jsonError(
            "Espace média introuvable après l’alignement de son état.",
            404,
            "workspace_not_found",
          );
        }
      }
      return NextResponse.json({
        ok: true,
        workspaceId,
        mission,
        status: initialStatus.status,
        message: initialStatus.message,
        media: graph.media,
      });
    }

    const processingEnabled = await enqueueWorkspaceMedia({
      accountId: activeUserId,
      workspaceId,
      media: graph.media,
      mission,
      variants,
    });
    if (!processingEnabled) {
      return jsonError(
        "La préparation média serveur n’est pas activée. Vérifiez les variables du pipeline média.",
        503,
        "media_processing_disabled",
      );
    }

    const pending = graph.media.filter(
      (item) =>
        item.uploadStatus === "uploaded" &&
        !isMediaReady({ media: item, mission, variants }) &&
        !isTerminalMediaFailure(item),
    );
    await prioritizeWorkspaceJobs({
      accountId: activeUserId,
      mediaIds: pending.map((item) => item.mediaId).filter(Boolean),
    });

    const requestId = randomUUID();
    const pendingImages = pending.filter((item) => item.mediaType === "image");
    const pendingVideos = pending.filter((item) => item.mediaType === "video");

    if (pendingImages.length) {
      await processImageNormalizationJobsForMedia({
        accountId: activeUserId,
        mediaIds: pendingImages.map((item) => item.mediaId),
        workerId: `workspace-${mission}-image-${requestId}`,
      });
    }
    if (pendingVideos.length && dispatchWorker) {
      const mediaIds = pendingVideos.map((item) => item.mediaId);
      // Video probing/capture extraction is durable work, not request work.
      // The job is already committed, so the browser receives `processing`
      // immediately while this best-effort kick runs (cron remains fallback).
      after(async () => {
        try {
          await processVideoNormalizationJobsForMedia({
            accountId: activeUserId,
            mediaIds,
            workerId: `workspace-${mission}-video-${requestId}`,
          });
          await refreshPublicationWorkspaceMediaStatus({
            workspaceId,
            accountId: activeUserId,
          });
        } catch (error) {
          console.error("[media-pipeline] background video preparation failed", {
            workspaceId,
            mission,
            mediaIds,
            error,
          });
        }
      });
    }

    await refreshPublicationWorkspaceMediaStatus({
      workspaceId,
      accountId: activeUserId,
    });

    graph = await loadOwnedWorkspaceMedia({
      workspaceId,
      accountId: activeUserId,
    });
    if (!graph) {
      return jsonError(
        "Espace média introuvable après sa préparation.",
        404,
        "workspace_not_found",
      );
    }
    variants = await loadReadyVariantState({
      accountId: activeUserId,
      media: graph.media,
    });

    const finalStatus = buildStatus({
      media: graph.media,
      mission,
      variants,
    });
    return NextResponse.json({
      ok: true,
      workspaceId,
      mission,
      status: finalStatus.status,
      message: finalStatus.message,
      media: graph.media,
    });
  } catch (error) {
    console.error("[media-pipeline] workspace prepare failed", error);
    return jsonError(
      error instanceof Error
        ? error.message
        : "Impossible de préparer le média sur le serveur.",
      500,
      "workspace_prepare_failed",
    );
  }
}
