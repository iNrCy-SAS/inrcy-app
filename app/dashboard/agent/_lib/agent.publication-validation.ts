import type { AgentPreparedAction } from "./agent.types";

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

export type PublicationValidationFilters = Record<PublicationValidationState, boolean>;
type ValidationAction = Pick<AgentPreparedAction, "status" | "validatedAt">;

export function countPublicationValidationStates(actions: readonly ValidationAction[]): Record<PublicationValidationState, number> {
  const counts = { validated: 0, pending: 0, refused: 0 };
  for (const action of actions) counts[publicationValidationState(action)] += 1;
  return counts;
}

export function filterPublicationsByValidation<T extends ValidationAction>(actions: readonly T[], filters: PublicationValidationFilters): T[] {
  return actions.filter(action => filters[publicationValidationState(action)]);
}
