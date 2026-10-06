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
