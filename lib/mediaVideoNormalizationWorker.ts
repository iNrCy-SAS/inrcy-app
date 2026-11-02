import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { refreshPublicationWorkspaceStatusesForMedia } from "@/lib/mediaWorkspaceServer";
import { claimTargetedProcessingJob } from "@/lib/mediaProcessingTargetedClaim";
import { planVideoNormalizationExecution } from "@/lib/mediaVideoNormalizationExecutionPlan";
import { mapVideoNormalizationStageProgress, resolveVideoNormalizationProgressWindow, type VideoNormalizationProgressWindow } from "@/lib/mediaVideoNormalizationProgress";
import { VIDEO_NORMALIZATION_DEFAULT_BATCH_SIZE, VIDEO_NORMALIZATION_JOB_TYPE, VIDEO_NORMALIZATION_MAX_BATCH_SIZE, VIDEO_NORMALIZATION_PIPELINE_VERSION, VIDEO_NORMALIZATION_WORKER_LEASE_SECONDS, isVideoNormalizationEnabled, type VideoNormalizationVariantKey } from "@/lib/mediaVideoNormalizationPolicy";
import { normalizeVideoSource } from "@/lib/mediaVideoNormalizer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { type ClaimedVideoJob, type VariantRow, type ProcessedJobSummary } from "@/lib/mediaVideoNormalizationWorkerTypes";
import { VideoNormalizationError, compactMessage, asRecord, canPublishOriginalVideo, requiredVideoKeys, readyVariantOutput } from "@/lib/mediaVideoNormalizationWorkerPolicy";
import { updateJobProgress, loadMedia, loadVariants, markVariantsProcessing } from "@/lib/mediaVideoNormalizationRepository";
import { downloadSourceToTemp, uploadVariant } from "@/lib/mediaVideoNormalizationStorage";
import { markJobCancelled, markJobFailure, updateMediaAfterSuccessfulNormalization, settleSuccessfulVideoJob } from "@/lib/mediaVideoNormalizationSettlement";

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
