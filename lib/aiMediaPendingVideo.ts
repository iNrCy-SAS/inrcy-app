/** Persisted provider identifiers only; never credentials, recordings or signed URLs. */
export type AiMediaPendingVideo = {
  provider: "heygen-direct";
  model: "heygen-avatar-iv";
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
  return task.provider === "heygen-direct" && task.model === "heygen-avatar-iv" &&
    typeof task.videoId === "string" && ID.test(task.videoId) &&
    Array.isArray(task.temporaryVoiceIds) && task.temporaryVoiceIds.length <= 4 &&
    task.temporaryVoiceIds.every(id => typeof id === "string" && ID.test(id)) &&
    [task.temporaryAvatarGroupIds, task.temporaryAssetIds].every(ids => Array.isArray(ids) && ids.length <= 5 && ids.every(id => typeof id === "string" && ID.test(id))) &&
    Number.isSafeInteger(task.estimatedCostMicroUsd) && task.estimatedCostMicroUsd >= 0 && task.estimatedCostMicroUsd <= 20_000_000;
}

/** A successful asynchronous submission, not a provider or quality failure. */
export class AiVideoProviderPending extends Error {
  readonly task: AiMediaPendingVideo;
  constructor(task: AiMediaPendingVideo) {
    super("ai_media_provider_pending");
    this.name = "AiVideoProviderPending";
    if (!isAiMediaPendingVideo(task)) throw new Error("ai_media_pending_video_invalid");
    this.task = task;
  }
}

export function isAiVideoProviderPending(error: unknown): error is AiVideoProviderPending {
  return error instanceof AiVideoProviderPending;
}
