import { after, NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { enforceRateLimit } from "@/lib/rateLimit";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { clampUniversalUploadProgress } from "@/lib/mediaUploadPolicy";
import {
  enqueueImageNormalization,
  type ImageNormalizationEnqueueResult,
} from "@/lib/mediaImageNormalizationQueue";
import { processImageNormalizationJobsForMedia } from "@/lib/mediaImageNormalizationWorker";
import {
  enqueueVideoNormalization,
  type VideoNormalizationEnqueueResult,
} from "@/lib/mediaVideoNormalizationQueue";
import { processVideoNormalizationJobsForMedia } from "@/lib/mediaVideoNormalizationWorker";
import { refreshPublicationWorkspaceStatusesForMedia } from "@/lib/mediaWorkspaceServer";
import {
  canPublishVideoSourceDirectly,
  hasServerVideoProbeProvenance,
} from "@/lib/mediaVideoSourceCompatibility";
import { INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES } from "@/lib/mediaRules";
import { sanitizeClientMediaMetadata } from "@/lib/mediaClientMetadata";
import { probeStoredBoosterVideoForPublication } from "@/lib/boosterVideoVariantServer";

export const runtime = "nodejs";
// The response is returned as soon as the durable job is committed. Vercel
// Fluid Compute may then use this budget for the best-effort immediate kick;
// the one-minute cron remains the recovery owner if the invocation stops.
export const maxDuration = 1_800;

type UploadEvent = "uploading" | "uploaded" | "failed" | "removed";

function cleanText(value: unknown, fallback = "", max = 2_000) {
  return String(value ?? fallback).trim().slice(0, max);
}

function isUploadEvent(value: unknown): value is UploadEvent {
  return ["uploading", "uploaded", "failed", "removed"].includes(
    String(value || ""),
  );
}

async function verifyStoredUpload(params: {
  bucket: string;
  storagePath: string;
  expectedSize: number;
}) {
  const cleanPath = String(params.storagePath || "").replace(/^\/+/, "");
  const segments = cleanPath.split("/").filter(Boolean);
  const objectName = segments.pop() || "";
  const folder = segments.join("/");
  if (!params.bucket || !objectName || params.expectedSize <= 0) return false;

  const retryDelays = [0, 250, 650, 1_200];
  let lastError: unknown = null;
  for (const delayMs of retryDelays) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    const listed = await supabaseAdmin.storage.from(params.bucket).list(folder, {
      limit: 20,
      search: objectName,
    });
    if (listed.error) {
      lastError = listed.error;
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
    if (
      Boolean(stored) &&
      Number.isFinite(storedSize) &&
      storedSize === params.expectedSize
    ) {
      return true;
    }
  }
  if (lastError) throw lastError;
  return false;
}

function processVideoNormalizationAfterUpload(params: {
  accountId: string;
  mediaId: string;
  context: string;
}) {
  after(async () => {
    try {
      await processVideoNormalizationJobsForMedia({
        accountId: params.accountId,
        mediaIds: [params.mediaId],
      });
    } catch (processingError) {
      console.warn(
        `[media-pipeline] ${params.context} deferred to durable cron`,
        {
          mediaId: params.mediaId,
          accountId: params.accountId,
          error: processingError,
        },
      );
    }
  });
}

export async function POST(request: Request) {
  try {
    const { errorResponse, activeUserId } = await requireUser();
    if (errorResponse) return errorResponse;

    const limited = await enforceRateLimit({
      name: "media_pipeline_upload_event",
      identifier: activeUserId,
      limit: 240,
      fallbackLimit: 240,
      window: "2 m",
      failClosed: false,
    });
    if (limited) return limited;

    const body = await request.json().catch(() => null);
    const mediaId = cleanText(body?.mediaId, "", 80);
    const event = body?.event;
    if (!mediaId || !isUploadEvent(event)) {
      return NextResponse.json(
        { ok: false, error: "Événement d’upload invalide." },
        { status: 400 },
      );
    }

    const current = await supabaseAdmin
      .from("pro_media_library")
      .select(
        "id,user_id,media_type,media_metadata,bucket_name,storage_path,size_bytes,original_file_name,mime_type,processing_status,publication_status",
      )
      .eq("id", mediaId)
      .eq("user_id", activeUserId)
      .maybeSingle();
    if (current.error) throw current.error;
    if (!current.data) {
      return NextResponse.json(
        { ok: false, error: "Média introuvable pour cet établissement." },
        { status: 404 },
      );
    }

    const progress = clampUniversalUploadProgress(Number(body?.progress || 0));
    const now = new Date().toISOString();
    const persistedMetadata = current.data.media_metadata || {};
    const metadata = {
      ...persistedMetadata,
      ...sanitizeClientMediaMetadata(body?.metadata),
    };
    const patch: Record<string, unknown> = { media_metadata: metadata };
    const normalization =
      persistedMetadata.video_normalization &&
      typeof persistedMetadata.video_normalization === "object"
        ? (persistedMetadata.video_normalization as Record<string, unknown>)
        : {};
    const probedSource =
      normalization.source && typeof normalization.source === "object"
        ? (normalization.source as Record<string, unknown>)
        : {};
    // Les codecs/FPS envoyÃ©s par le navigateur ne sont jamais une preuve.
    const directProof = probedSource;
    const directVideoSource =
      current.data.media_type === "video" &&
      hasServerVideoProbeProvenance(directProof) &&
      canPublishVideoSourceDirectly({
        name: current.data.original_file_name,
        mimeType: current.data.mime_type,
        storagePath: current.data.storage_path,
        sizeBytes: current.data.size_bytes,
        maxBytes: INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES,
        videoCodec:
          directProof.videoCodec ||
          directProof.video_codec ||
          directProof.source_video_codec,
        audioCodec:
          directProof.audioCodec ||
          directProof.audio_codec ||
          directProof.source_audio_codec,
        frameRate:
          directProof.frameRate ||
          directProof.frame_rate ||
          directProof.fps ||
          directProof.source_frame_rate,
        hasAudio:
          directProof.hasAudio ??
          directProof.has_audio ??
          directProof.source_has_audio,
        containerFormats:
          directProof.containerFormats ??
          directProof.container_formats ??
          directProof.source_container_formats,
        pixelFormat:
          directProof.pixelFormat ??
          directProof.pixel_format ??
          directProof.source_pixel_format,
        requireCodecProof: true,
      });
    const sourceMetadataOnly =
      cleanText(current.data.media_metadata?.upload_target, "", 80) ===
        "workspace_source" &&
      (cleanText(current.data.media_metadata?.pipeline_mission, "", 80) ===
        "source_metadata" ||
        cleanText(
          current.data.media_metadata?.preparation_scope,
          "",
          80,
        ) === "source_only");
    const workspaceAiSource =
      sourceMetadataOnly &&
      cleanText(metadata.creation_mode, "", 20).toLowerCase() === "ai";
    const boosterPublicationSource =
      cleanText(current.data.media_metadata?.upload_target, "", 80) ===
        "booster_video_source" &&
      current.data.media_type === "video";
    if (event === "uploaded") {
      const verified = await verifyStoredUpload({
        bucket: String(current.data.bucket_name || ""),
        storagePath: String(current.data.storage_path || ""),
        expectedSize: Number(current.data.size_bytes || 0),
      });
      if (!verified) {
        return NextResponse.json(
          {
            ok: false,
            code: "upload_storage_unverified",
            error:
              "Le stockage n’a pas encore confirmé le fichier complet. L’envoi peut reprendre sans recommencer.",
          },
          { status: 409 },
        );
      }
    }

    if (event === "uploading") {
      patch.upload_status = "uploading";
      patch.upload_progress = Math.min(99, progress);
      patch.upload_started_at = now;
      patch.upload_error_code = null;
      patch.upload_error_message = null;
    } else if (event === "uploaded") {
      patch.upload_status = "uploaded";
      patch.upload_progress = 100;
      patch.uploaded_at = now;
      patch.upload_error_code = null;
      patch.upload_error_message = null;
      if (directVideoSource && !sourceMetadataOnly) {
        patch.processing_status = "ready";
        patch.processing_progress = 100;
        patch.publication_status = "ready";
        patch.detected_mime_type =
          cleanText(current.data.mime_type, "video/mp4", 120) || "video/mp4";
        patch.processing_error_code = null;
        patch.processing_error_message = null;
        patch.processing_completed_at = now;
      }
    } else if (event === "failed") {
      patch.upload_status = "failed";
      patch.upload_progress = 0;
      patch.upload_error_code = "upload_failed";
      patch.upload_error_message = cleanText(
        body?.errorMessage,
        "Envoi du média interrompu.",
      );
    } else {
      patch.upload_status = "removed";
      patch.upload_progress = 0;
      patch.publication_status = "removed";
      patch.upload_error_code = "upload_cancelled";
      patch.upload_error_message = cleanText(
        body?.errorMessage,
        "Envoi du média annulé.",
      );
    }

    const updated = await supabaseAdmin
      .from("pro_media_library")
      .update(patch)
      .eq("id", mediaId)
      .eq("user_id", activeUserId)
      .select(
        "id,upload_status,upload_progress,uploaded_at,upload_error_code,upload_error_message",
      );
    if (updated.error) throw updated.error;
    const updatedMedia = updated.data?.[0] ?? null;
    if (!updatedMedia) {
      return NextResponse.json(
        { ok: false, error: "Média introuvable.", code: "media_missing" },
        { status: 404 },
      );
    }

    let imageNormalization: ImageNormalizationEnqueueResult | null = null;
    let videoNormalization: VideoNormalizationEnqueueResult | null = null;
    if (
      event === "uploaded" &&
      current.data.media_type === "image"
    ) {
      const workspaceId = cleanText(
        current.data.media_metadata?.workspace_id,
        "",
        80,
      );
      try {
        imageNormalization = await enqueueImageNormalization({
          mediaId,
          accountId: activeUserId,
          workspaceId: workspaceId || null,
          mission: sourceMetadataOnly
            ? "publication_preparation"
            : undefined,
        });
        if (imageNormalization.enabled && imageNormalization.jobId) {
          after(async () => {
            try {
              await processImageNormalizationJobsForMedia({
                accountId: activeUserId,
                mediaIds: [mediaId],
              });
            } catch (processingError) {
              console.warn(
                "[media-pipeline] image publication prewarm deferred to cron",
                {
                  mediaId,
                  accountId: activeUserId,
                  error: processingError,
                },
              );
            }
          });
        }
      } catch (queueError) {
        console.error("[media-pipeline] image normalization enqueue failed", {
          mediaId,
          accountId: activeUserId,
          error: queueError,
        });
        imageNormalization = {
          enabled: true,
          queued: false,
          reason: "enqueue_failed",
        };
      }
    }

    if (
      event === "uploaded" &&
      current.data.media_type === "video" &&
      sourceMetadataOnly
    ) {
      const workspaceId = cleanText(
        current.data.media_metadata?.workspace_id,
        "",
        80,
      );
      if (!workspaceAiSource) {
        try {
          // Le mode manuel suit le mÃªme pipeline durable que le mode IA. Le
          // worker atteste l'original et extrait seulement sa miniature ;
          // l'ACK d'upload reste immÃ©diat.
          videoNormalization = await enqueueVideoNormalization({
            mediaId,
            accountId: activeUserId,
            workspaceId: workspaceId || null,
            mission: "publication_preparation",
          });
          if (videoNormalization.enabled && videoNormalization.jobId) {
            processVideoNormalizationAfterUpload({
              accountId: activeUserId,
              mediaId,
              context: "manual video prewarm",
            });
          }
        } catch (queueError) {
          console.error("[media-pipeline] manual video enqueue failed", {
            mediaId,
            accountId: activeUserId,
            error: queueError,
          });
          videoNormalization = {
            enabled: true,
            queued: false,
            reason: "enqueue_failed",
          };
        }
      } else {
        try {
          const aiNormalization = await enqueueVideoNormalization({
            mediaId,
            accountId: activeUserId,
            workspaceId: workspaceId || null,
            mission: "ai_preparation",
          });
          videoNormalization = {
            enabled: aiNormalization.enabled,
            queued: aiNormalization.queued,
            reason: aiNormalization.reason,
            jobId: aiNormalization.jobId || null,
          };
          if (videoNormalization.enabled && videoNormalization.jobId) {
            processVideoNormalizationAfterUpload({
              accountId: activeUserId,
              mediaId,
              context: "video AI prewarm",
            });
          }
        } catch (queueError) {
          console.error("[media-pipeline] video AI enqueue failed", {
            mediaId,
            accountId: activeUserId,
            error: queueError,
          });
          videoNormalization = {
            enabled: true,
            queued: false,
            reason: "enqueue_failed",
          };
        }
      }
    } else if (
      event === "uploaded" &&
      current.data.media_type === "video" &&
      !sourceMetadataOnly &&
      !directVideoSource
    ) {
      const workspaceId = cleanText(
        current.data.media_metadata?.workspace_id,
        "",
        80,
      );
      if (boosterPublicationSource) {
        const boosterProbeBucket = String(current.data.bucket_name || "");
        const boosterProbeStoragePath = String(
          current.data.storage_path || "",
        );
        // Confirmation upload immédiate. L'attestation serveur range-aware se
        // fait pendant que le pro relit son contenu ; elle ne télécharge jamais
        // la vidéo dans cette requête et sera relue par publish-now.
        videoNormalization = {
          enabled: true,
          queued: true,
          reason: "source_probe_queued",
        };
        after(async () => {
          try {
            await probeStoredBoosterVideoForPublication({
              accountId: activeUserId,
              bucket: boosterProbeBucket,
              storagePath: boosterProbeStoragePath,
            });
          } catch (processingError) {
            console.warn(
              "[media-pipeline] booster video source probe deferred to publication worker",
              {
                mediaId,
                accountId: activeUserId,
                error: processingError,
              },
            );
          }
        });
      } else {
        try {
          videoNormalization = await enqueueVideoNormalization({
            mediaId,
            accountId: activeUserId,
            workspaceId: workspaceId || null,
            mission: "publication_preparation",
          });
          if (videoNormalization.enabled && videoNormalization.jobId) {
            // L'ACK d'upload est deja parti ; le cron durable reprend si ce
            // prechauffage opportuniste depasse la duree de cette invocation.
            processVideoNormalizationAfterUpload({
              accountId: activeUserId,
              mediaId,
              context: "video publication prewarm",
            });
          }
        } catch (queueError) {
          console.error("[media-pipeline] video normalization enqueue failed", {
            mediaId,
            accountId: activeUserId,
            error: queueError,
          });
          videoNormalization = {
            enabled: true,
            queued: false,
            reason: "enqueue_failed",
          };
        }
      }
    } else if (
      event === "uploaded" &&
      directVideoSource
    ) {
      videoNormalization = {
        enabled: true,
        queued: false,
        reason: "source_direct_ready",
      };
    }

    // L'intent a déjà placé le workspace en waiting_media. Un simple palier
    // "uploading" ne peut donc changer son statut et ne doit pas relancer la
    // lecture agrégée. Les événements terminaux restent confirmés avant l'ACK.
    if (event !== "uploading") {
      await refreshPublicationWorkspaceStatusesForMedia({
        mediaId,
        accountId: activeUserId,
      });
    }

    return NextResponse.json({
      ok: true,
      media: updatedMedia,
      imageNormalization,
      videoNormalization,
    });
  } catch (error) {
    console.error("[media-pipeline] upload event failed", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Impossible de mettre à jour l’upload.",
      },
      { status: 500 },
    );
  }
}
