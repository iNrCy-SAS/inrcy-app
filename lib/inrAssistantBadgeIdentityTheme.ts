import { inrAssistantClauseIsAdvice, inrAssistantRequestClauses } from "./inrAssistantRequestClauses.ts";
import { runInrAssistantLocalInterface } from "./inrAssistantLocalInterface.ts";

export type InrAssistantBadgeIdentityThemeCommand = { command: "refresh_badge_theme_from_logo"; selection: { kind: "channel"; id: "inrbadge" }; revision: string };
export function isInrAssistantBadgeLogoThemeRequest(message: string): boolean {
  return inrAssistantRequestClauses(message).some(text => !inrAssistantClauseIsAdvice(text)
    && !/\b(?:si|if|quand|when|apres|avant|demain|later|sans|never|not)\b|\bne\b.{0,50}\bpas\b|\bn['’]/.test(text)
    && /\b(?:badge|inr['’ ]?badge)\b/.test(text) && /\blogo\b/.test(text) && /\b(?:theme|couleurs?|palette|identite)\b/.test(text)
    && /\b(?:actualis\w*|rafraich\w*|appliqu\w*|extrais|extraire|recuper\w*|recalcul\w*|utilis\w*|choisis|selectionn\w*|mets|refresh|apply|extract)\b/.test(text));
}
export function parseInrAssistantBadgeIdentityThemeCommand(value: unknown): InrAssistantBadgeIdentityThemeCommand | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>, selection = row.selection as Record<string, unknown> | undefined;
  return Object.keys(row).length === 3 && row.command === "refresh_badge_theme_from_logo" && selection?.kind === "channel" && selection.id === "inrbadge" && Object.keys(selection).length === 2 && typeof row.revision === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(row.revision)
    ? { command: row.command, selection: { kind: "channel", id: "inrbadge" }, revision: row.revision } : null;
}
/** Only the dedicated server tool can request this native persistent operation. */
export async function runInrAssistantBadgeIdentityThemeCommand(command: InrAssistantBadgeIdentityThemeCommand, scope: { accountId: string; actorUserId: string; pathname: string }, stillCurrent: () => boolean) {
  if (!parseInrAssistantBadgeIdentityThemeCommand(command)) return false;
  return runInrAssistantLocalInterface({ command: "control_local_interface", selection: { kind: "account_document", id: "badge_identity_theme" }, revision: command.revision, operation: "retry", value: null }, scope, stillCurrent);
}
