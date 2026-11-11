import { hasInrAssistantDeferredApproval } from "./inrAssistantActionClause.ts";
import { inrAssistantClauseIsAdvice, inrAssistantRequestClauses, inrAssistantUnquotedRequest } from "./inrAssistantRequestClauses.ts";

export type InrAssistantSettingsAgent = "publish" | "stats";
const targets = {
  publication_agent_settings: { agent: "publish", pathname: "/dashboard/agent/publications" },
  stats_agent_settings: { agent: "stats", pathname: "/dashboard/agent/stats" },
} as const;
export function inrAssistantAgentSettingsTarget(destination: string): { agent: InrAssistantSettingsAgent; pathname: string } | null {
  return Object.hasOwn(targets, destination) ? targets[destination as keyof typeof targets] : null;
}
/** Read-only panel intent. A setting value, activation or publication is never
 * inferred from opening or closing its native interface. */
export function getInrAssistantAgentSettingsRequest(message: string): { agent: InrAssistantSettingsAgent; operation: "open" | "close" } | null {
  if (hasInrAssistantDeferredApproval(message)) return null;
  const clauses = inrAssistantRequestClauses(message);
  const full = inrAssistantUnquotedRequest(message);
  if (/\b(?:si|quand|lorsque|apres|avant|demain|if|when|after|before|tomorrow|later)\b|\bplus tard\b/.test(full)) return null;
  const namedPublish = /\bagent\s+(?:de\s+|des\s+)?publications?\b/.test(full);
  const namedStats = /\bagent\s+(?:de\s+|des\s+)?(?:stats|statistiques)\b/.test(full);
  if (namedPublish === namedStats) return null;
  const relevant = clauses.filter(clause => /\b(?:reglages?|parametres?|settings)\b/.test(clause));
  const candidates = relevant.flatMap(clause => {
    if (inrAssistantClauseIsAdvice(clause) || /\b(?:si|quand|lorsque|apres|avant|demain|if|when|after|before|later)\b|\bplus tard\b/.test(clause)
      || /\b(?:ne|pas|jamais|sans|not|never)\b|\bn['’]/.test(clause)) return [];
    if (/\b(?:emailings?|campagnes?|mails?)\b/.test(clause)) return [];
    const direct = clause.replace(/^(?:(?:peux|pourrais)[- ]tu|(?:pouvez|pourriez)[- ]vous)\s+/, "");
    const open = /^(?:ouvre\w*|ouvrir|affiche\w*|montr\w*|open|show)\b/.test(direct);
    const close = /^(?:ferme\w*|referme\w*|masque\w*|close|hide)\b/.test(direct);
    return open === close ? [] : [{ agent: namedPublish ? "publish" as const : "stats" as const, operation: open ? "open" as const : "close" as const }];
  });
  if (candidates.length !== 1) return null;
  const text = inrAssistantUnquotedRequest(message);
  if (/\b(?:ne\s+|n['’]|sans\s+|do not\s+|don't\s+|never\s+)(?:ouvre\w*|affiche\w*|montre\w*|ferme\w*|referme\w*|masque\w*|open|show|close|hide)\b/.test(text)) return null;
  return candidates[0];
}

export function getInrAssistantAgentSettingsNavigationRequest(message: string): { destination: "publication_agent_settings" | "stats_agent_settings"; instructionQuote: string; pure: boolean } | null {
  const request = getInrAssistantAgentSettingsRequest(message);
  if (request?.operation !== "open") return null;
  const clauses = inrAssistantRequestClauses(message);
  const pure = clauses.every(clause => {
    // This finite purpose is the professional's own consultation, not a new
    // reader instruction. Keep the original instructionQuote unchanged.
    const panelClause = clause.replace(/\s+pour\s+que\s+je\s+puisse\s+les\s+consulter(?=[.!?]*$)/, "");
    return (/\b(?:ouvre\w*|ouvrir|affiche\w*|montr\w*|open|show)\b/.test(panelClause) && /\b(?:reglages?|parametres?|settings)\b/.test(panelClause))
      && !/\b(?:lis|lire|consulte\w*|analyse\w*|explique\w*|donne\w*|calcule\w*|compare\w*)\b/.test(panelClause)
      || /^dans\s+l['’]agent\s+(?:publications?|stats|statistiques)\s+deja\s+ouvert[,;]*$/.test(clause)
      || /^(?:ne\s+(?:modifie\w*|change\w*)\s+(?:rien|aucune?\s+(?:valeurs?|reglages?|parametres?)))(?:\s+et\s+ne\s+lance\s+aucune\s+publication)?[.!?]*$/.test(clause);
  });
  return { destination: request.agent === "publish" ? "publication_agent_settings" : "stats_agent_settings", instructionQuote: message, pure };
}
