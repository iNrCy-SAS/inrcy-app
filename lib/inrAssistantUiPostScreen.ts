import { parseInrAssistantClientContext, type InrAssistantClientScreen } from "./inrAssistantClientContext.ts";
import type { InrAssistantUiAction } from "./inrAssistantUiActions.ts";

/** Post-commit browser metadata only; neither form contents nor a native receipt. */
export type InrAssistantUiPostScreen = {
  pathname: string;
  selection: NonNullable<InrAssistantClientScreen["selection"]>;
  revision: string;
  documentPrefill?: InrAssistantClientScreen["documentPrefill"];
};

export function parseInrAssistantUiPostScreen(value: unknown): InrAssistantUiPostScreen | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(value).length > 600) return null;
  const screen = parseInrAssistantClientContext({ screen: value })?.screen;
  return screen?.selection && screen.revision ? { pathname: screen.pathname, selection: screen.selection, revision: screen.revision,
    ...(screen.documentPrefill ? { documentPrefill: screen.documentPrefill } : {}) } : null;
}

/** A report cannot substitute another form for the action's signed target. */
export function inrAssistantUiPostScreenMatchesAction(action: InrAssistantUiAction, screen: InrAssistantUiPostScreen): boolean {
  if (action.type === "navigate") return Boolean(action.navigation.documentPrefill
    && JSON.stringify(action.navigation.documentPrefill) === JSON.stringify(screen.documentPrefill)
    && screen.selection.kind === action.navigation.documentPrefill.kind
    && screen.pathname === (screen.selection.kind === "quote" ? "/dashboard/devis/new" : "/dashboard/factures/new"));
  if (action.type !== "command" || !("revision" in action.command) || !action.command.revision) return false;
  const command = action.command;
  if (command.command === "prepare_document_mail") return screen.pathname === "/dashboard/mails" && screen.selection.kind === "mail";
  const permitted = parseInrAssistantClientContext({ screen: { ...screen, availableCommands: [command.command] } })?.screen;
  return permitted?.availableCommands?.includes(command.command) === true
    && command.selection.kind === screen.selection.kind && command.selection.id === screen.selection.id;
}
