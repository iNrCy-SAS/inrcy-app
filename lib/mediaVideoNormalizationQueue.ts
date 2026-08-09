import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { BoosterPreparationMission } from "@/lib/boosterMediaPipelineMissions";
import {
  VIDEO_NORMALIZATION_PIPELINE_VERSION,
  isVideoNormalizationEnabled,
} from "@/lib/mediaVideoNormalizationPolicy";
import { loadNormalizationRepairCandidates } from "@/lib/mediaNormalizationRepairQueue";
import { UNIVERSAL_MEDIA_PIPELINE_VERSION } from "@/lib/mediaPipelineRegistry";
import { mergeVideoPreparationRequest } from "@/lib/mediaVideoNormalizationMissionState";

type EnqueueVideoNormalizationParams = {
  mediaId: string;
  accountId: string;
  workspaceId?: string | null;
  mission?: BoosterPreparationMission;
};

export type VideoNormalizationEnqueueResult = {
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

  // Le RPC d'enqueue est idempotent et peut réutiliser un job déjà queued ou
  // processing. Il réinitialise son payload technique : on fusionne donc la
  // demande depuis le job ET le média, avec verrou optimiste sur updated_at.
  // Deux appels AI/publication simultanés convergent ainsi sans qu'une mission
  // tardive puisse écraser la publication déjà demandée.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const [currentJob, currentMedia] = await Promise.all([
      params.jobId
        ? supabaseAdmin
            .from("media_processing_jobs")
            .select("payload,updated_at")
            .eq("id", params.jobId)
            .eq("account_id", params.accountId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabaseAdmin
        .from("pro_media_library")
        .select("media_metadata,updated_at")
        .eq("id", params.mediaId)
        .eq("user_id", params.accountId)
        .maybeSingle(),
    ]);
    if (currentJob.error) throw currentJob.error;
    if (currentMedia.error) throw currentMedia.error;
    if (!currentMedia.data) throw new Error("video_media_not_found");

    const merged = mergeVideoPreparationRequest({
      jobPayload: currentJob.data?.payload,
      mediaMetadata: currentMedia.data.media_metadata,
      requestedMission: params.mission,
    });
    const previousJobUpdatedAt = String(currentJob.data?.updated_at || "");
    const previousMediaUpdatedAt = String(currentMedia.data.updated_at || "");
    const nextTimestamp = new Date(
      Math.max(
        Date.now(),
        Date.parse(previousJobUpdatedAt) + 1 || 0,
        Date.parse(previousMediaUpdatedAt) + 1 || 0,
      ),
    ).toISOString();

    const jobUpdate = params.jobId
      ? supabaseAdmin
          .from("media_processing_jobs")
          .update({
            payload: {
              ...asRecord(currentJob.data?.payload),
              pipelineMission: merged.mission,
              requiredOutputs: merged.requiredOutputs,
            },
            updated_at: nextTimestamp,
          })
          .eq("id", params.jobId)
          .eq("account_id", params.accountId)
          .eq("updated_at", previousJobUpdatedAt)
          .select("id")
      : Promise.resolve({ data: [{ id: "no-job" }], error: null });
    const mediaUpdate = supabaseAdmin
      .from("pro_media_library")
      .update({
        media_metadata: {
          ...asRecord(currentMedia.data.media_metadata),
          pipeline_mission: merged.mission,
          preparation_scope: merged.mission,
          preparation_required_outputs: merged.requiredOutputs,
        },
        updated_at: nextTimestamp,
      })
      .eq("id", params.mediaId)
      .eq("user_id", params.accountId)
      .eq("updated_at", previousMediaUpdatedAt)
      .select("id");
    const [jobResult, mediaResult] = await Promise.all([jobUpdate, mediaUpdate]);
    if (jobResult.error) throw jobResult.error;
    if (mediaResult.error) throw mediaResult.error;
    if (jobResult.data?.[0] && mediaResult.data?.[0]) return;
  }

  throw new Error("video_preparation_request_contention");
}

export async function enqueueVideoNormalization(
  params: EnqueueVideoNormalizationParams,
): Promise<VideoNormalizationEnqueueResult> {
  if (!isVideoNormalizationEnabled()) {
    return { enabled: false, queued: false, reason: "feature_disabled" };
  }

  const mediaId = String(params.mediaId || "").trim();
  const accountId = String(params.accountId || "").trim();
  const workspaceId = String(params.workspaceId || "").trim() || null;
  if (!mediaId || !accountId) {
    throw new Error("video_normalization_scope_missing");
  }

  // Journaliser l'intention avant l'enqueue ferme la petite fenêtre entre le
  // RPC (qui peut conserver un job processing) et la fusion de son payload.
  // Si le worker termine dans cette fenêtre, il relit le média et voit déjà la
  // publication à chaîner. En cas d'échec RPC, le cron de réparation conserve
  // également une intention durable au lieu de perdre le clic Publier.
  if (params.mission) {
    await persistPreparationMission({
      accountId,
      mediaId,
      jobId: null,
      mission: params.mission,
    });
  }

  const result = await supabaseAdmin.rpc("inrcy_enqueue_video_normalization", {
    p_media_id: mediaId,
    p_account_id: accountId,
    p_workspace_id: workspaceId,
    p_pipeline_version: VIDEO_NORMALIZATION_PIPELINE_VERSION,
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

export async function repairPendingVideoNormalizationQueue(params?: {
  limit?: number;
}) {
  if (!isVideoNormalizationEnabled()) {
    return { enabled: false, scanned: 0, queued: 0, failed: 0 };
  }

  const limit = Math.max(1, Math.min(20, Math.round(params?.limit || 10)));
  const candidates = await loadNormalizationRepairCandidates({
    supabase: supabaseAdmin,
    mediaType: "video",
    minimumPipelineVersion: VIDEO_NORMALIZATION_PIPELINE_VERSION,
    // L'upload universel persiste d'abord une ligne v1. Si l'enqueue v2 tombe
    // après l'écriture de la mission, le cron reprend cette intention durable,
    // puis le RPC d'enqueue met atomiquement le média au niveau v2.
    minimumRequestedPipelineVersion: UNIVERSAL_MEDIA_PIPELINE_VERSION,
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
      const enqueued = await enqueueVideoNormalization({
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
      console.error("[media-pipeline] video queue repair failed", {
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
