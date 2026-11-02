import { parseInrAssistantNavigation, parseInrAssistantUiCommand, parseInrAssistantTaskProgress, type InrAssistantNavigation, type InrAssistantUiCommand, type InrAssistantTaskProgress } from "./inrAssistantUiCommands.ts";
import { parseInrAssistantStudioDraft, type InrAssistantStudioDraft } from "./inrAssistantStudioDraft.ts";
import { parseInrAssistantRefresh, type InrAssistantRefresh } from "./inrAssistantRefresh.ts";
import { parseInrAssistantUiActions, type InrAssistantUiAction } from "./inrAssistantUiActions.ts";

/** Only bounded display/UI data can survive a lost HTTP response. Never store
 * tool results, approval capabilities, signed media URLs or an executable task. */
export type InrAssistantReplyReplay = {
  refresh?: InrAssistantRefresh;
  navigation?: InrAssistantNavigation;
  uiCommand?: InrAssistantUiCommand;
  uiActions?: InrAssistantUiAction[];
  taskProgress?: InrAssistantTaskProgress;
  studioDraft?: InrAssistantStudioDraft;
  insertStudioDraft?: boolean;
  outcome?: InrAssistantTaskProgress["outcome"];
};
export function parseInrAssistantReplyReplay(value: unknown): InrAssistantReplyReplay {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>, result: InrAssistantReplyReplay = {};
  const navigation = parseInrAssistantNavigation(input.navigation);
  const uiCommand = parseInrAssistantUiCommand(input.uiCommand);
  const uiActions = parseInrAssistantUiActions(input.uiActions);
  if (uiActions) result.uiActions = uiActions;
  const taskProgress = parseInrAssistantTaskProgress(input.taskProgress);
  const studioDraft = parseInrAssistantStudioDraft(input.studioDraft);
  const refresh = parseInrAssistantRefresh(input.refresh);
  if (refresh) result.refresh = refresh;
  if (navigation) result.navigation = navigation;
  if (uiCommand) result.uiCommand = uiCommand;
  if (taskProgress) result.taskProgress = taskProgress;
  if (studioDraft) {
    result.studioDraft = studioDraft;
    if (typeof input.insertStudioDraft === "boolean") result.insertStudioDraft = input.insertStudioDraft;
  }
  if (["completed", "partial", "needs_input", "processing", "blocked", "failed"].includes(String(input.outcome))) result.outcome = input.outcome as InrAssistantReplyReplay["outcome"];
  return result;
}
