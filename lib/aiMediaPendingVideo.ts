export const AI_MEDIA_MAX_PROVIDER_VIDEO_DURATION_SECONDS = 3_600;

/** Bounded to the maximum two-plan speech envelope at HeyGen pricing. */
export const AI_MEDIA_HEYGEN_MAX_ESTIMATED_COST_MICRO_USD = 400_000_000;

/** Persisted provider identifiers only; never credentials, recordings or signed URLs. */
export type AiMediaPendingVideo = {
  provider: "heygen-direct";
  model: "heygen-avatar-iv" | "heygen-video-1";
  videoId: string;
  temporaryVoiceIds: string[];
  temporaryAvatarGroupIds: string[];
  temporaryAssetIds: string[];
  estimatedCostMicroUsd: number;
};

const ID = /^[a-zA-Z0-9_-]{1,180}$/;
export function isAiMediaPendingVideo(value: unknown): value is AiMediaPendingVideo {
  if (!value || typeof value !== "object") return false;
  const task = value as AiMediaPendingVideo;
  return task.provider === "heygen-direct" && ["heygen-avatar-iv", "heygen-video-1"].includes(task.model) &&
    typeof task.videoId === "string" && ID.test(task.videoId) &&
    Array.isArray(task.temporaryVoiceIds) && task.temporaryVoiceIds.length <= 4 &&
    task.temporaryVoiceIds.every(id => typeof id === "string" && ID.test(id)) &&
    [task.temporaryAvatarGroupIds, task.temporaryAssetIds].every(ids => Array.isArray(ids) && ids.length <= 5 && ids.every(id => typeof id === "string" && ID.test(id))) &&
    Number.isSafeInteger(task.estimatedCostMicroUsd) && task.estimatedCostMicroUsd >= 0 && task.estimatedCostMicroUsd <= AI_MEDIA_HEYGEN_MAX_ESTIMATED_COST_MICRO_USD;
}

/** A successful asynchronous submission, not a provider or quality failure. */
export class AiVideoProviderPending extends Error {
  readonly task: AiMediaPendingVideo;
  private readonly accepted?: () => Promise<void>;
  private acceptance?: Promise<void>;
  constructor(task: AiMediaPendingVideo, accepted?: () => Promise<void>) {
    super("ai_media_provider_pending");
    this.name = "AiVideoProviderPending";
    if (!isAiMediaPendingVideo(task)) throw new Error("ai_media_pending_video_invalid");
    this.task = task;
    this.accepted = accepted;
  }
  /** Run only after the caller has anchored this accepted ID in its checkpoint. */
  recordAcceptance(): Promise<void> { return this.acceptance ??= this.accepted?.() ?? Promise.resolve(); }
}

export function isAiVideoProviderPending(error: unknown): error is AiVideoProviderPending {
  return error instanceof AiVideoProviderPending;
}
