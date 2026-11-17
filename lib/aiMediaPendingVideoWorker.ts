import "server-only";
import { setTimeout as delay } from "node:timers/promises";
import {
  hasActiveAiMediaCompositionCheckpoint,
  recoverNextAiMediaCompositionCheckpoint,
  releaseAiMediaCompositionCheckpoint,
  type AiMediaCompositionCheckpoint,
} from "./aiMediaCompositionRecovery.ts";

/** Finish this accepted job also in local development, which has no Vercel cron. */
export async function continuePendingAiMediaVideo(
  scope: { accountId: string; jobId: string },
  deadlineAt: number,
  heldCheckpoint?: AiMediaCompositionCheckpoint | null,
): Promise<void> {
  if (heldCheckpoint && (heldCheckpoint.accountId !== scope.accountId || heldCheckpoint.jobId !== scope.jobId)) {
    throw new Error("ai_media_composition_scope_invalid");
  }
  const end = Math.min(deadlineAt, Date.now() + 720_000);
  let checkpointToRelease = heldCheckpoint;
  while (Date.now() < end - 10_000) {
    if (checkpointToRelease) {
      try {
        // A false result means another owner already has the lease. Never release its token.
        await releaseAiMediaCompositionCheckpoint(checkpointToRelease);
        checkpointToRelease = undefined;
      } catch {
        console.warn("[ai-media] accepted render lease release deferred", { jobId: scope.jobId });
      }
    }
    try {
      const result = await recoverNextAiMediaCompositionCheckpoint(scope);
      if (result.status === "completed" || result.status === "failed") return;
      if (result.status === "idle") {
        // A still-owned lease is temporarily unclaimable, not a completed or missing job.
        if (!await hasActiveAiMediaCompositionCheckpoint(scope)) return;
      } else {
        checkpointToRelease = undefined;
      }
    } catch {
      // Retry only the existing render status, never a billable submission.
      console.warn("[ai-media] provider status temporarily unavailable", { jobId: scope.jobId });
    }
    await delay(Math.min(30_000, Math.max(0, end - Date.now() - 10_000)));
  }
}
