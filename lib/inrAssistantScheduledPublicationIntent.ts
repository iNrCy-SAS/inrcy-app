import { matchesInrAssistantActionClause } from './inrAssistantActionClause.ts';
import { inrAssistantUnquotedRequest } from './inrAssistantRequestClauses.ts';

/** Publish the existing manual schedule, without preparing a second post. */
export function isInrAssistantScheduledPublishNowRequest(message: string, instructionQuote = message): boolean {
  return matchesInrAssistantActionClause(message, instructionQuote, (current, quote) => [current, quote].every(value => {
    const text = inrAssistantUnquotedRequest(value);
    if (/\b(?:comment|pourquoi|explique|si|quand|lorsque|if|when|unless|demain|apres|avant|sans|not|never|ne|pas|jamais)\b|\bn'/.test(text)) return false;
    return /^(?:(?:peux|pourrais)[ -]tu\s+|(?:pouvez|pourriez)[ -]vous\s+)?(?:publie(?:r|z)?|poste(?:r|z)?|lance(?:r|z)?|execute(?:r|z)?)\b/.test(text)
      && /\b(?:publication|post|programmation)\b/.test(text)
      && /programm|planifi/.test(text)
      && /\bmaintenant\b|\bimmediatement\b|tout de suite/.test(text);
  }));
}
