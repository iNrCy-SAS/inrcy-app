import type { DashboardEdition } from "./dashboardEdition.ts";
import type { InrAssistantUiAction, InrAssistantUiResult } from "./inrAssistantUiActions.ts";
import { inrAssistantUiSuccessStatus } from "./inrAssistantUiActions.ts";
import { isInrAssistantScreenCommandAllowed } from "./inrAssistantScreenCommandPolicy.ts";

export const INR_ASSISTANT_MAX_AUTO_UI_CONTINUATIONS = 24;
export const INR_ASSISTANT_AUTO_UI_MAX_AGE_MS = 15 * 60_000;

/** Scheduling hint only. The next HTTP request must still load the same saved
 * task and its immutable server-side receipts; this flag is never authority. */
export function canOfferInrAssistantAutoContinuation(input: {
  edition: DashboardEdition; taskSaved: boolean; outcome?: string; needsHuman?: boolean;
  remaining: number; uncertain: boolean; actions: InrAssistantUiAction[];
}): boolean {
  return input.edition === "basic" && input.taskSaved && input.outcome === "partial"
    && !input.needsHuman && !input.uncertain && input.remaining > 0 && input.actions.length > 0
    && input.actions.every(action => action.type === "navigate"
      || isInrAssistantScreenCommandAllowed("basic", action.command.command));
}

export function canResumeInrAssistantAfterUi(input: {
  offered: boolean; actions: InrAssistantUiAction[]; results: InrAssistantUiResult[];
  hops: number; startedAt: number; now?: number; current: boolean; draftPending: boolean;
}): boolean {
  if (!input.offered || !input.current || input.draftPending || input.hops >= INR_ASSISTANT_MAX_AUTO_UI_CONTINUATIONS
    || !Number.isFinite(input.startedAt) || (input.now ?? Date.now()) - input.startedAt > INR_ASSISTANT_AUTO_UI_MAX_AGE_MS
    || !input.actions.length) return false;
  return input.actions.every(action => input.results.some(result => result.actionId === action.id
    && result.source === "browser_reported" && result.status === inrAssistantUiSuccessStatus(action)));
}
