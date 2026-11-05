import { matchesInrAssistantActionClause } from "./inrAssistantActionClause.ts";
import { parseInrAssistantClientContext } from "./inrAssistantClientContext.ts";
import { inrAssistantClauseIsAdvice, inrAssistantMaskQuotedText, inrAssistantRequestClauses, inrAssistantUnquotedRequest } from "./inrAssistantRequestClauses.ts";
import { isInrAssistantStatsUiCommandAvailable, isInrAssistantStatsUiCommandText, parseInrAssistantStatsUiCommand } from "./inrAssistantStatsUiCommands.ts";

export type InrAssistantPureStatsViewRequest = {
  command: "configure_stats_view";
  patch: { panel: "all" | "evolution" };
  instructionQuote: string;
};

const directView = "(?:(?:affiche(?:z)?|ouvre(?:z)?|selectionne(?:z)?|montre(?:z)?)(?:-moi|-nous)?\\s+(?:la\\s+)?vue|passe(?:z)?\\s+(?:a\\s+(?:la\\s+)?|en\\s+)vue)";
const politeView = "(?:(?:peux|pourrais)[ -]tu|(?:pouvez|pourriez)[ -]vous)\\s+(?:me\\s+|m'|nous\\s+)?(?:(?:afficher|ouvrir|selectionner|montrer)\\s+(?:la\\s+)?vue|passer\\s+(?:a\\s+(?:la\\s+)?|en\\s+)vue)";
const singleViewRequest = new RegExp(`^(?:${directView}|${politeView})\\s+(globale|evolution)(?:\\s+(?:des|de mes|de nos|de vos)\\s+(?:stats|statistiques))?(?:,?\\s+(?:s'il (?:te|vous) plait|stp|svp|merci))?\\s*[.!?]?$`);

/** Resolve only the two explicitly named native buttons on an already mounted
 * Stats screen. This is a parsing shortcut, never an execution/ownership grant:
 * the normal authenticated screen tool and its browser ACK remain required. */
export function getPureInrAssistantStatsViewRequest(message: string, clientContext?: unknown): InrAssistantPureStatsViewRequest | null {
  const instructionQuote = message.trim();
  if (!instructionQuote || instructionQuote.length > 1200 || inrAssistantMaskQuotedText(message) !== message) return null;
  const screen = parseInrAssistantClientContext(clientContext)?.screen;
  if (!screen?.availableCommands?.includes("configure_stats_view")
    || !isInrAssistantStatsUiCommandAvailable("configure_stats_view", screen.pathname, screen.selection?.kind)) return null;

  const text = inrAssistantUnquotedRequest(message).replace(/\s+/g, " ");
  if (inrAssistantRequestClauses(message).length !== 1 || inrAssistantClauseIsAdvice(text)) return null;
  const match = text.match(singleViewRequest);
  if (!match || !matchesInrAssistantActionClause(message, instructionQuote, (current, quote) =>
    isInrAssistantStatsUiCommandText(current) && isInrAssistantStatsUiCommandText(quote))) return null;

  const panel = match[1] === "globale" ? "all" : "evolution";
  if (!parseInrAssistantStatsUiCommand({ command: "configure_stats_view", selection: screen.selection, revision: screen.revision, patch: { panel } })) return null;
  return { command: "configure_stats_view", patch: { panel }, instructionQuote };
}

/** Preserve every requested button in order, including repeated selections.
 * Only the existing clause parser may separate requests; every resulting clause
 * must independently satisfy the same mounted-screen/native-button guard. */
export function getPureInrAssistantStatsViewSequence(message: string, clientContext?: unknown): InrAssistantPureStatsViewRequest[] | null {
  const instructionQuote = message.trim();
  if (!instructionQuote || message.length > 4000 || inrAssistantMaskQuotedText(message) !== message) return null;
  const clauses = inrAssistantRequestClauses(message);
  if (clauses.length < 2 || clauses.length > 24) return null;
  const requests: InrAssistantPureStatsViewRequest[] = [];
  for (const clause of clauses) {
    const request = getPureInrAssistantStatsViewRequest(clause, clientContext);
    if (!request) return null;
    requests.push({ ...request, instructionQuote });
  }
  return requests;
}
