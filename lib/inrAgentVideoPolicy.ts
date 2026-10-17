/** One shared selection for generation, duration limits and manual preflight. */
export const INR_AGENT_VIDEO_ENGINE = "veo-lite" as const;
export const INR_AGENT_VIDEO_RESOLUTION = "720p" as const;
export const INR_AGENT_VIDEO_FALLBACK_ENGINE = "grok-lite" as const;

/** A lost response or an existing paid asset cannot fund a fresh automatic job. */
export function inrAgentVideoFailureNeedsRecovery(errorCode: unknown): boolean {
  return /billable|uncertain|timeout|timed.?out|fetch failed|socket|econn|network/i.test(String(errorCode || ""));
}
