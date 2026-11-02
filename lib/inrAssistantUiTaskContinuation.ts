import { parseInrAssistantUiActions, type InrAssistantUiAction, type InrAssistantUiResult } from "./inrAssistantUiActions.ts";
import { inrAssistantUiStepResult, parseInrAssistantUiSteps, type InrAssistantUiStep, type InrAssistantUiStepResult } from "./inrAssistantUiTask.ts";

/** Callers close both readers over the authenticated account/actor/conversation.
 * Never accept results or a turn binding supplied by the HTTP request. */
export async function resolveInrAssistantUiTaskResults(
  steps: InrAssistantUiStep[],
  loadReply: (source: NonNullable<InrAssistantUiStep["source"]>) => Promise<{ uiActions?: unknown } | null>,
  loadResults: (source: NonNullable<InrAssistantUiStep["source"]>, actions: InrAssistantUiAction[]) => Promise<InrAssistantUiResult[]>,
): Promise<InrAssistantUiStepResult[]> {
  const validated = parseInrAssistantUiSteps(steps);
  if (!validated) throw new Error("Invalid browser continuation plan");
  const sources = new Map<string, Promise<{ actions: InrAssistantUiAction[]; results: InrAssistantUiResult[] }>>();
  return Promise.all(validated.map(async step => {
    if (!step.source || !step.actions?.length) return { stepId: step.id, status: "pending" as const };
    const source = step.source;
    const key = `${source.turnId}:${source.createdAt}`;
    if (!sources.has(key)) sources.set(key, (async () => {
      const replay = await loadReply(source);
      const actions = parseInrAssistantUiActions(replay?.uiActions);
      if (!actions?.length) throw new Error("Browser continuation replay unavailable");
      return { actions, results: await loadResults(source, actions) };
    })());
    const saved = await sources.get(key)!;
    if (!step.actions.every(action => saved.actions.some(candidate => JSON.stringify(candidate) === JSON.stringify(action)))) throw new Error("Browser continuation plan changed");
    return inrAssistantUiStepResult(step, saved.results);
  }));
}
