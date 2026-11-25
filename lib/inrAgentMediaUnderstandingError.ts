export const INR_AGENT_MEDIA_UNREADABLE = "inr_agent_media_unreadable";
export const INR_AGENT_MEDIA_UNDERSTANDING_UNAVAILABLE = "inr_agent_media_understanding_unavailable";

type MediaUnderstandingFailureReason = "missing" | "invalid_image" | "storage" | "vision";

export class InrAgentMediaUnderstandingError extends Error {
  readonly code: typeof INR_AGENT_MEDIA_UNREADABLE | typeof INR_AGENT_MEDIA_UNDERSTANDING_UNAVAILABLE;
  readonly reason: MediaUnderstandingFailureReason;

  constructor(reason: MediaUnderstandingFailureReason, cause?: unknown) {
    const code = reason === "missing" || reason === "invalid_image"
      ? INR_AGENT_MEDIA_UNREADABLE
      : INR_AGENT_MEDIA_UNDERSTANDING_UNAVAILABLE;
    super(code, { cause });
    this.name = "InrAgentMediaUnderstandingError";
    this.code = code;
    this.reason = reason;
  }
}

export function isPermanentlyUnreadableInrAgentMedia(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === INR_AGENT_MEDIA_UNREADABLE);
}
