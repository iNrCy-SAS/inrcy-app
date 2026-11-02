import { parseInrAssistantNavigation, parseInrAssistantUiCommand, type InrAssistantNavigation, type InrAssistantUiCommand } from "./inrAssistantUiCommands.ts";

/** Ordered effects of one server response. This is not a business authorization. */
export type InrAssistantUiAction =
  | { id: string; type: "navigate"; navigation: InrAssistantNavigation }
  | { id: string; type: "command"; command: InrAssistantUiCommand };
export type InrAssistantUiResult = {
  actionId: string;
  source: "browser_reported";
  status: "applied" | "handed_to_browser" | "failed" | "cancelled";
};
export const INR_ASSISTANT_MAX_UI_ACTIONS = 24;
const ID = /^[a-zA-Z0-9_-]{1,100}$/;

export function parseInrAssistantUiActions(value: unknown): InrAssistantUiAction[] | null {
  if (!Array.isArray(value) || value.length > INR_ASSISTANT_MAX_UI_ACTIONS) return null;
  const actions: InrAssistantUiAction[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const row = raw as Record<string, unknown>;
    if (typeof row.id !== "string" || !ID.test(row.id) || actions.some(action => action.id === row.id)) return null;
    if (row.type === "navigate") {
      const navigation = parseInrAssistantNavigation(row.navigation);
      if (!navigation) return null;
      actions.push({ id: row.id, type: "navigate", navigation });
    } else if (row.type === "command") {
      const command = parseInrAssistantUiCommand(row.command);
      if (!command) return null;
      actions.push({ id: row.id, type: "command", command });
    } else return null;
  }
  return actions;
}

/** Called for each actual tool result; append, never overwrite earlier actions. */
export function inrAssistantUiActionsFromToolResult(toolCallId: string, output: unknown): InrAssistantUiAction[] {
  if (!output || typeof output !== "object" || Array.isArray(output)) return [];
  const row = output as Record<string, unknown>;
  if (row.ok !== true) return [];
  const prefix = toolCallId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  if (!prefix) return [];
  const actions: InrAssistantUiAction[] = [];
  const navigation = parseInrAssistantNavigation(row.navigation);
  const command = parseInrAssistantUiCommand(row.uiCommand);
  if (navigation) actions.push({ id: `${prefix}_navigate`, type: "navigate", navigation });
  if (command) actions.push({ id: `${prefix}_command`, type: "command", command });
  return actions;
}

export function parseInrAssistantUiResult(value: unknown): InrAssistantUiResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.actionId !== "string" || !ID.test(row.actionId) || row.source !== "browser_reported" ||
    !["applied", "handed_to_browser", "failed", "cancelled"].includes(String(row.status))) return null;
  return { actionId: row.actionId, source: "browser_reported", status: row.status as InrAssistantUiResult["status"] };
}

/** A failed/cancelled step stops its dependent sequence; later steps never run on the old screen. */
export async function runInrAssistantUiActions(actions: InrAssistantUiAction[], ports: {
  isCurrent: () => boolean;
  navigate: (navigation: InrAssistantNavigation) => Promise<boolean>;
  command: (command: InrAssistantUiCommand) => Promise<boolean>;
  onResult?: (result: InrAssistantUiResult) => Promise<void> | void;
}): Promise<InrAssistantUiResult[]> {
  const results: InrAssistantUiResult[] = [];
  let stopped = false;
  for (const action of actions) {
    let status: InrAssistantUiResult["status"] = "cancelled";
    if (!stopped && ports.isCurrent()) {
      try {
        const applied = action.type === "navigate" ? await ports.navigate(action.navigation) : await ports.command(action.command);
        status = !ports.isCurrent() ? "cancelled" : !applied ? "failed" : action.type === "navigate" ? "applied" : "handed_to_browser";
      } catch { status = ports.isCurrent() ? "failed" : "cancelled"; }
    }
    if (status === "failed" || status === "cancelled") stopped = true;
    const result: InrAssistantUiResult = { actionId: action.id, source: "browser_reported", status };
    results.push(result);
    // A failed receipt transport must not repeat the already executed action.
    try { await ports.onResult?.(result); } catch { /* The caller retains the local result. */ }
  }
  return results;
}
