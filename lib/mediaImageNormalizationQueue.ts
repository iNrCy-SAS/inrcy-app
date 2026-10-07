import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  BOOSTER_IMAGE_PREPARATION_PURPOSES,
  type BoosterPreparationMission,
} from "@/lib/boosterMediaPipelineMissions";
import {
  IMAGE_NORMALIZATION_PIPELINE_VERSION,
  isImageNormalizationEnabled,
} from "@/lib/mediaImageNormalizationPolicy";
import { loadNormalizationRepairCandidates } from "@/lib/mediaNormalizationRepairQueue";
import { claimLegacyTruncatedJpegReplay, persistOwnedImageMediaUpdate } from "@/lib/mediaImageRecoveryPolicy";

type EnqueueImageNormalizationParams = {
  mediaId: string;
  accountId: string;
  workspaceId?: string | null;
  mission?: BoosterPreparationMission;
};

export type ImageNormalizationEnqueueResult = {
  enabled: boolean;
  queued: boolean;
  reason?: string;
  jobId?: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function persistPreparationMission(params: {
  accountId: string;
  mediaId: string;
  jobId: string | null;
  mission?: BoosterPreparationMission;
}) {
  if (!params.mission) return;

  const requiredOutputs =
    BOOSTER_IMAGE_PREPARATION_PURPOSES[params.mission];
  const operations: PromiseLike<unknown>[] = [];

  if (params.jobId) {
    const currentJob = await supabaseAdmin
      .from("media_processing_jobs")
      .select("payload")
      .eq("id", params.jobId)
      .eq("account_id", params.accountId)
      .maybeSingle();
    if (currentJob.error) throw currentJob.error;
    operations.push(
      supabaseAdmin
        .from("media_processing_jobs")
        .update({
          payload: {
            ...asRecord(currentJob.data?.payload),
            pipelineMission: params.mission,
            requiredOutputs: [...requiredOutputs],
          },
        })
        .eq("id", params.jobId)
        .eq("account_id", params.accountId),
    );
  }

  operations.push(
    persistOwnedImageMediaUpdate({
      supabase: supabaseAdmin,
      accountId: params.accountId,
      mediaId: params.mediaId,
      buildPatch: (currentMedia) => ({
        media_metadata: {
          ...asRecord(currentMedia.media_metadata),
          pipeline_mission: params.mission,
          preparation_scope: params.mission,
          preparation_required_outputs: [...requiredOutputs],
        },
      }),
    }).then(() => ({ error: null })),
  );

  const results = await Promise.all(operations);
  for (const result of results) {
    const error = (result as { error?: unknown })?.error;
    if (error) throw error;
  }
}

export async function enqueueImageNormalization(
  params: EnqueueImageNormalizationParams,
): Promise<ImageNormalizationEnqueueResult> {
  if (!isImageNormalizationEnabled()) {
    return { enabled: false, queued: false, reason: "feature_disabled" };
  }

  const mediaId = String(params.mediaId || "").trim();
  const accountId = String(params.accountId || "").trim();
  const workspaceId = String(params.workspaceId || "").trim() || null;
  if (!mediaId || !accountId) {
    throw new Error("image_normalization_scope_missing");
  }

  const result = await supabaseAdmin.rpc("inrcy_enqueue_image_normalization", {
    p_media_id: mediaId,
    p_account_id: accountId,
    p_workspace_id: workspaceId,
    p_pipeline_version: IMAGE_NORMALIZATION_PIPELINE_VERSION,
  });
  if (result.error) throw result.error;

  const payload = asRecord(result.data);
  const jobId = payload.jobId ? String(payload.jobId) : null;
  await persistPreparationMission({
    accountId,
    mediaId,
    jobId,
    mission: params.mission,
  });
  return {
    enabled: true,
    queued: Boolean(payload.queued),
    reason: payload.reason ? String(payload.reason) : undefined,
    jobId,
  };
}

export async function repairPendingImageNormalizationQueue(params?: {
  limit?: number;
}) {
  if (!isImageNormalizationEnabled()) {
    return { enabled: false, scanned: 0, queued: 0, failed: 0 };
  }

  const limit = Math.max(1, Math.min(50, Math.round(params?.limit || 20)));
  const candidates = await loadNormalizationRepairCandidates({
    supabase: supabaseAdmin,
    mediaType: "image",
    minimumPipelineVersion: IMAGE_NORMALIZATION_PIPELINE_VERSION,
    limit,
  });

  let queued = 0;
  let failed = 0;
  for (const row of candidates) {
    const metadata = asRecord(row.media_metadata);
    const mission =
      metadata.pipeline_mission === "ai_preparation" ||
      metadata.pipeline_mission === "publication_preparation"
        ? metadata.pipeline_mission
        : undefined;
    try {
      const enqueued = await enqueueImageNormalization({
        mediaId: String(row.id),
        accountId: String(row.user_id),
        workspaceId: metadata.workspace_id
          ? String(metadata.workspace_id)
          : null,
        mission,
      });
      if (enqueued.queued) queued += 1;
    } catch (error) {
      failed += 1;
      console.error("[media-pipeline] image queue repair failed", {
        mediaId: row.id,
        error,
      });
    }
  }

  return {
    enabled: true,
    scanned: candidates.length,
    queued,
    failed,
  };
}

/** Reopens only an owned workspace's historical, deterministic JPEG failure. */
export async function retryLegacyTruncatedJpegNormalization(params: {
  accountId: string;
  mediaId: string;
  workspaceId: string;
}) {
  if (!isImageNormalizationEnabled()) return false;
  const claimed = await claimLegacyTruncatedJpegReplay({
    ...params,
    supabase: supabaseAdmin,
  });
  if (!claimed) return false;
  // The claim leaves a durable publication intent. If this enqueue fails, the
  // existing requested-normalization repair picks it up without another replay.
  await enqueueImageNormalization({ ...params, mission: "publication_preparation" });
  return true;
}
