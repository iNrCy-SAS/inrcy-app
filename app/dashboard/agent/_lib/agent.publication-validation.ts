import type { AgentPreparedAction } from "./agent.types";
import { publicationReviewStates, type PublicationReviewState } from "../../../../lib/inrAgentPublicationReview.ts";
export { publicationReviewStates, publicationChannelReviewState } from "../../../../lib/inrAgentPublicationReview.ts";
export type { PublicationReviewState } from "../../../../lib/inrAgentPublicationReview.ts";

export type PublicationValidationState = "pending" | "validated" | "refused";

export function publicationValidationState(
  action: Pick<AgentPreparedAction, "status" | "validatedAt"> | null | undefined,
): PublicationValidationState {
  if (action?.status === "refused") return "refused";
  if (
    action?.validatedAt ||
    action?.status === "validated" ||
    action?.status === "scheduled" ||
    action?.status === "completed"
  ) {
    return "validated";
  }
  return "pending";
}

export type PublicationValidationFilters = Record<PublicationReviewState, boolean>;
type ValidationAction = Parameters<typeof publicationReviewStates>[0];

export function countPublicationValidationStates(actions: readonly ValidationAction[], now = Date.now()): Record<PublicationReviewState, number> {
  const counts = { validated: 0, pending: 0, creating: 0, refused: 0 };
  for (const action of actions) {
    for (const state of publicationReviewStates(action, now)) counts[state]++;
  }
  return counts;
}

export function filterPublicationsByValidation<T extends ValidationAction>(actions: readonly T[], filters: PublicationValidationFilters, now = Date.now()): T[] {
  return actions.filter(action => publicationReviewStates(action, now).some(state => filters[state]));
}
