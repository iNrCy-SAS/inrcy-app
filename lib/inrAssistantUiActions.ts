import { parseInrAssistantNavigation, parseInrAssistantUiCommand, type InrAssistantNavigation, type InrAssistantUiCommand, type InrAssistantTaskProgress } from "./inrAssistantUiCommands.ts";
import type { InrAssistantClientContext } from "./inrAssistantClientContext.ts";
import { parseInrAssistantUiPostScreen, inrAssistantUiPostScreenMatchesAction, type InrAssistantUiPostScreen } from "./inrAssistantUiPostScreen.ts";

/** Ordered effects of one server response. This is not a business authorization. */
export type InrAssistantUiAction =
  | { id: string; type: "navigate"; navigation: InrAssistantNavigation }
  | { id: string; type: "command"; command: InrAssistantUiCommand };
export type InrAssistantUiResult = {
  actionId: string;
  source: "browser_reported";
  status: "applied" | "handed_to_browser" | "failed" | "cancelled";
  postScreen?: InrAssistantUiPostScreen;
};
export const INR_ASSISTANT_MAX_UI_ACTIONS = 24;
export function inrAssistantUiSuccessStatus(action: InrAssistantUiAction): "applied" | "handed_to_browser" {
  return action.type === "command" && ["export_document_pdf", "download_media", "download_stats_report", "download_badge_qr", "download_account_export", "download_subscription_invoice"].includes(action.command.command) ? "handed_to_browser" : "applied";
}
const ID = /^[a-zA-Z0-9_-]{1,100}$/;

/** Bind deictic library requests to the checked IDs, not merely another owned set. */
export function bindInrAssistantUiActionsToScreen(actions: InrAssistantUiAction[], context: InrAssistantClientContext | null, request: string): InrAssistantUiAction[] | null {
  const screen = context?.screen;
  const selectedRequest = /\b(?:selection|selectionn\w*|coch\w*|selected|checked)\b/.test(request.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase());
  if (screen?.pathname !== "/dashboard/mediatheque" || !selectedRequest) return actions;
  const bound: InrAssistantUiAction[] = [];
  for (const action of actions) {
    if (action.type !== "command" || action.command.command !== "download_media") { bound.push(action); continue; }
    const ids = screen.selectedMediaIds;
    if (screen.selectionOverflow || !ids?.length || ids.length !== action.command.mediaIds.length || !action.command.mediaIds.every(id => ids.includes(id))) return null;
    bound.push({ ...action, command: { ...action.command, selectionMode: "current" } });
  }
  return bound;
}

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
  const postScreen = row.postScreen === undefined ? undefined : parseInrAssistantUiPostScreen(row.postScreen);
  if (row.postScreen !== undefined && (!postScreen || row.status !== "applied")) return null;
  return { actionId: row.actionId, source: "browser_reported", status: row.status as InrAssistantUiResult["status"], ...(postScreen ? { postScreen } : {}) };
}

/** Display projection only: browser handoffs leave the server-business progress list.
 * No browser claim is added to its completed business confirmations. */
export function inrAssistantBusinessProgressAfterUi(progress: InrAssistantTaskProgress | undefined, actions: InrAssistantUiAction[], results: InrAssistantUiResult[]): InrAssistantTaskProgress | undefined {
  if (!progress) return undefined;
  const reportedLabels = new Set<string>();
  for (const [command, label] of [["download_media", "télécharger les médias"], ["download_stats_report", "télécharger le bilan PDF"]]) {
    const matching = actions.filter(action => action.type === "command" && action.command.command === command);
    if (matching.length && matching.every(action => results.some(result => result.actionId === action.id))) reportedLabels.add(label);
  }
  const remaining = progress.remaining.filter(label => !reportedLabels.has(label));
  const completed = progress.completed.filter(label => !reportedLabels.has(label));
  if (!remaining.length && !completed.length) return undefined;
  return { ...progress, remaining, completed, ...(!remaining.length && completed.length ? { outcome: "completed" as const } : {}) };
}

/** A failed/cancelled step stops its dependent sequence; later steps never run on the old screen. */
export async function runInrAssistantUiActions(actions: InrAssistantUiAction[], ports: {
  isCurrent: () => boolean;
  navigate: (navigation: InrAssistantNavigation) => Promise<boolean>;
  command: (command: InrAssistantUiCommand) => Promise<boolean>;
  beforeAction?: (action: InrAssistantUiAction) => Promise<boolean>;
  onResult?: (result: InrAssistantUiResult) => Promise<void> | void;
  postScreen?: (action: InrAssistantUiAction) => InrAssistantUiPostScreen | undefined;
}): Promise<InrAssistantUiResult[]> {
  const results: InrAssistantUiResult[] = [];
  let stopped = false;
  for (const action of actions) {
    let status: InrAssistantUiResult["status"] = "cancelled";
    if (!stopped && ports.isCurrent()) {
      try {
        const claimed = ports.beforeAction ? await ports.beforeAction(action) : true;
        const applied = claimed && ports.isCurrent() && (action.type === "navigate" ? await ports.navigate(action.navigation) : await ports.command(action.command));
        status = !ports.isCurrent() ? "cancelled" : !applied ? "failed" : inrAssistantUiSuccessStatus(action);
      } catch { status = ports.isCurrent() ? "failed" : "cancelled"; }
    }
    if (status === "failed" || status === "cancelled") stopped = true;
    const postScreen = status === "applied" ? ports.postScreen?.(action) : undefined;
    const result: InrAssistantUiResult = { actionId: action.id, source: "browser_reported", status,
      ...(postScreen && inrAssistantUiPostScreenMatchesAction(action, postScreen) ? { postScreen } : {}) };
    results.push(result);
    // A failed receipt transport must not repeat the already executed action.
    try { await ports.onResult?.(result); } catch { /* The caller retains the local result. */ }
  }
  return results;
}
