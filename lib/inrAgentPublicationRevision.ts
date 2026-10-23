type PublicationRevisionAction = {
  automationKey: string | null;
  actionType: string;
  targetTool: string;
  status: string;
  validatedAt?: string | null;
  completedAt?: string | null;
  scheduledFor?: string | null;
  payload: Record<string, unknown>;
};

const editableStatuses = new Set([
  "prepared", "pending_validation", "pending", "draft", "validated", "scheduled",
]);

/** A revision never reopens an action whose publication has already started. */
export function canReviseInrAgentPublication(action: PublicationRevisionAction | null | undefined) {
  return Boolean(action && action.automationKey === "publish" && action.actionType === "publication"
    && action.targetTool === "booster" && !action.completedAt
    && (editableStatuses.has(action.status) || action.status === "failed" && !action.validatedAt));
}

export function inrAgentPublicationNeedsRevisionReview(payload: Record<string, unknown> | null | undefined) {
  const review = payload?.publicationRevisionReview;
  return Boolean(review && typeof review === "object" && !Array.isArray(review)
    && (review as Record<string, unknown>).required === true);
}

export function inrAgentPublicationRevisionSchedule(payload: Record<string, unknown>) {
  const review = payload.publicationRevisionReview as Record<string, unknown> | undefined;
  return inrAgentPublicationNeedsRevisionReview(payload) && Array.isArray(review?.scheduleSelections)
    ? review.scheduleSelections as Array<{ channel: string; scheduledAt: string }>
    : [];
}
