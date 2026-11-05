import { matchesInrAssistantActionClause } from "./inrAssistantActionClause.ts";
import { inrAssistantUnquotedRequest } from "./inrAssistantRequestClauses.ts";

/** Forget one saved Studio block, never a media, conversation or current draft. */
export function isInrAssistantStudioForgetPreferenceRequest(message: string, blockId: number, instructionQuote = message): boolean {
  if (!Number.isInteger(blockId) || blockId < 1 || blockId > 6) return false;
  return matchesInrAssistantActionClause(message, instructionQuote, (current, quote) => [current, quote].every(value => {
    const text = inrAssistantUnquotedRequest(value);
    if (/\b(?:comment|pourquoi|explique|expliquer|si|quand|lorsque|if|when|unless|demain|apres|avant|sans|not|never)\b|\bne\b|\bn'|\bpas\b/.test(text)) return false;
    const start = /^(?:(?:peux|pourrais)[ -]tu\s+|(?:pouvez|pourriez)[ -]vous\s+)?(?:desactiv(?:e|er|ez)|effac(?:e|er|ez)|supprim(?:e|er|ez)|oubli(?:e|er|ez)|retir(?:e|er|ez))\s+(?:(?:la|les|le|mes|ces|nos)\s+)?(?:memorisation|(?:preferences|reglages|criteres)\s+memorise(?:e)?s?)\b/;
    const blocks = [...text.matchAll(/\bbloc(?:\s+(?:numero|n°))?\s*([1-6])\b/g)];
    return start.test(text) && /\bstudio\b|\bgenerateur\s+(?:de\s+)?medias?\b/.test(text) && blocks.length === 1 && Number(blocks[0][1]) === blockId;
  }));
}
