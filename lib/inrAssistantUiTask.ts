import { parseInrAssistantClientContext, type InrAssistantClientContext, type InrAssistantClientScreen } from "./inrAssistantClientContext.ts";
import { getDirectInrAssistantNavigationRequest, isInrAssistantScreenCommandRequest } from "./inrAssistantUiCommands.ts";
import { parseInrAssistantUiActions, inrAssistantUiSuccessStatus, type InrAssistantUiAction, type InrAssistantUiResult } from "./inrAssistantUiActions.ts";
import { inrAssistantRequestClauses } from "./inrAssistantRequestClauses.ts";
import { matchesInrAssistantActionClause } from "./inrAssistantActionClause.ts";

/** Private plan bookkeeping. Browser reports never become business receipts. */
export type InrAssistantUiStep = {
  id: string;
  instruction: string;
  command: NonNullable<Parameters<typeof isInrAssistantScreenCommandRequest>[1]> | "navigateApplication";
  screen?: InrAssistantClientScreen;
  actions?: InrAssistantUiAction[];
  source?: { turnId: string; createdAt: string };
};
export type InrAssistantUiStepResult = { stepId: string; status: "applied" | "pending" | "failed" | "cancelled" };

/** Capabilities are parsed before matching; adding a native form command to the
 * context/parser and its detector also makes it eligible for ordered tracking. */
export function inrAssistantUiSteps(message: string, context?: InrAssistantClientContext | null): InrAssistantUiStep[] {
  const screen = parseInrAssistantClientContext(context)?.screen;
  const commands = new Set<NonNullable<Parameters<typeof isInrAssistantScreenCommandRequest>[1]>>(["export_document_pdf"]);
  if (screen?.revision) for (const command of screen.availableCommands ?? []) commands.add(command);
  return inrAssistantRequestClauses(message).flatMap((instruction, index): InrAssistantUiStep[] => {
    const command = [...commands].find(value => isInrAssistantScreenCommandRequest(instruction, value)
      && matchesInrAssistantActionClause(message, message, candidate => inrAssistantRequestClauses(candidate).some(clause => isInrAssistantScreenCommandRequest(clause, value))));
    if (!command) {
      const navigation = getDirectInrAssistantNavigationRequest(instruction);
      return navigation && matchesInrAssistantActionClause(message, message, () => true)
        ? [{ id: `ui_${index}`, instruction, command: "navigateApplication" }] : [];
    }
    return [{ id: `ui_${index}`, instruction, command, ...(command !== "export_document_pdf" && screen ? { screen } : {}) }];
  });
}

export function parseInrAssistantUiSteps(value: unknown): InrAssistantUiStep[] | null {
  if (!Array.isArray(value) || value.length > 24 || JSON.stringify(value).length > 24_000) return null;
  const parsed: InrAssistantUiStep[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const step = raw as InrAssistantUiStep;
    if (typeof step.id !== "string" || !/^ui_\d{1,2}$/.test(step.id) || parsed.some(item => item.id === step.id) || typeof step.instruction !== "string" || !step.instruction || step.instruction.length > 4000) return null;
    const screen = step.screen === undefined ? undefined : parseInrAssistantClientContext({ screen: step.screen })?.screen;
    if (!["export_document_pdf", "navigateApplication"].includes(step.command) && (!screen?.revision || !screen.availableCommands?.some(command => command === step.command))) return null;
    if (step.command === "navigateApplication" ? !getDirectInrAssistantNavigationRequest(step.instruction) : !isInrAssistantScreenCommandRequest(step.instruction, step.command)) return null;
    const actions = step.actions === undefined ? undefined : parseInrAssistantUiActions(step.actions);
    if (step.actions !== undefined && (!actions?.length || !actions.some(action => step.command === "navigateApplication" ? action.type === "navigate" : action.type === "command" && action.command.command === step.command))) return null;
    if (step.source && (!actions?.length || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(step.source.turnId) || !/^\d{4}-\d{2}-\d{2}T/.test(step.source.createdAt) || !Number.isFinite(Date.parse(step.source.createdAt)))) return null;
    parsed.push({ id: step.id, instruction: step.instruction, command: step.command, ...(screen ? { screen } : {}), ...(actions ? { actions } : {}), ...(step.source ? { source: { ...step.source } } : {}) });
  }
  return parsed;
}

export function inrAssistantUiStepResult(step: InrAssistantUiStep, results: InrAssistantUiResult[]): InrAssistantUiStepResult {
  const failed = step.actions?.map(action => results.find(result => result.actionId === action.id)).find(result => result?.status === "failed" || result?.status === "cancelled");
  const complete = step.actions?.length && step.actions.every(action => results.some(result => result.actionId === action.id && result.status === inrAssistantUiSuccessStatus(action)));
  return { stepId: step.id, status: failed?.status === "cancelled" ? "cancelled" : failed ? "failed" : complete ? "applied" : "pending" };
}

/** Bind only newly emitted steps. An old unbound checkpoint is uncertain and
 * must not acquire a fresh source or be replayed during a reclaimed request. */
export function bindInrAssistantUiSteps(steps: InrAssistantUiStep[], actions: InrAssistantUiAction[], source: { turnId: string; createdAt: string }): InrAssistantUiStep[] {
  return steps.map(step => !step.source && step.actions?.length && step.actions.every(action => actions.some(candidate => JSON.stringify(candidate) === JSON.stringify(action))) ? { ...step, source } : step);
}
