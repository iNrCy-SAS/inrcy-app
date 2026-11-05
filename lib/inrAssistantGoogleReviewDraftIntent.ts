import { matchesInrAssistantActionClause } from "./inrAssistantActionClause.ts";
import { inrAssistantUnquotedRequest, inrAssistantRequestClauses } from "./inrAssistantRequestClauses.ts";

/** A draft request never authorizes publishing a reply or another generation. */
export function isInrAssistantGoogleReviewDraftRequest(message: string, reference: string, instructionQuote = message): boolean {
  if (!/^avis-[1-9]\d{0,3}$/.test(reference) || message.length > 4000) return false;
  return matchesInrAssistantActionClause(message, instructionQuote, (current, quote) => [current, quote].every(value => {
    const text = inrAssistantUnquotedRequest(value);
    if (inrAssistantRequestClauses(value).length !== 1 || /\b(?:comment|pourquoi|explique|expliquer|si|quand|lorsque|if|when|unless|demain|apres|avant|sans|not|never|ne|pas|jamais|publie|publier|envoie|envoyer|poste|poster)\b|\bn'/.test(text)) return false;
    const direct = /^(?:(?:peux|pourrais)[ -]tu\s+|(?:pouvez|pourriez)[ -]vous\s+)?(?:(?:me|nous)\s+)?(?:gener(?:e|er|ez)|redig(?:e|er|ez)|prepar(?:e|er|ez)|cre(?:e|er|ez))\s+(?:(?:un|une|le|la|mon|ma)\s+)?(?:brouillon\s+(?:de\s+)?(?:reponse\s+)?|(?:proposition\s+de\s+)?reponse\s+)/;
    if (!direct.test(text) || !/\b(?:avis|review)\b/.test(text) || !/\bgoogle\b/.test(text)) return false;
    const references = [...text.matchAll(/\bavis-([1-9]\d{0,3})\b/g)].map(match => `avis-${match[1]}`);
    return references.every(item => item === reference);
  }));
}
