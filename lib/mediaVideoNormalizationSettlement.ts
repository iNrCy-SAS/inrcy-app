import { refreshPublicationWorkspaceStatusesForMedia } from "@/lib/mediaWorkspaceServer";
import { type BoosterPreparationMission } from "@/lib/boosterMediaPipelineMissions";
import { findUnfulfilledVideoPreparationKeys, mergeVideoPreparationRequest, readRequestedVideoPreparationKeys, readVideoPreparationMission } from "@/lib/mediaVideoNormalizationMissionState";
import { planVideoNormalizationFailure } from "@/lib/mediaVideoNormalizationFailurePlan";
import { VIDEO_NORMALIZATION_PIPELINE_VERSION, getVideoNormalizationRetryDelaySeconds, type VideoNormalizationVariantKey } from "@/lib/mediaVideoNormalizationPolicy";
import { normalizeVideoSource } from "@/lib/mediaVideoNormalizer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { type ClaimedVideoJob, type MediaRow, type VariantRow, type ProcessedJobSummary } from "@/lib/mediaVideoNormalizationWorkerTypes";
import { VideoNormalizationError, asRecord, canPublishOriginalVideo, persistedSourceProbe, readPreparationMission, classifyWorkerError } from "@/lib/mediaVideoNormalizationWorkerPolicy";
import { hasReadyCanonicalVariant } from "@/lib/mediaVideoNormalizationRepository";
import { uploadVariant } from "@/lib/mediaVideoNormalizationStorage";

export async function markJobCancelled(
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

export async function markJobFailure(params: {
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

export async function updateMediaAfterSuccessfulNormalization(params: {
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

export async function settleSuccessfulVideoJob(params: {
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
