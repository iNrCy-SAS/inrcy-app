import { inrAssistantClauseIsAdvice, inrAssistantUnquotedRequest, inrAssistantMaskQuotedText } from "./inrAssistantRequestClauses.ts";
export { inrAssistantMaskQuotedText } from "./inrAssistantRequestClauses.ts";

/** An approval promised by a named person or for a later time is not current consent.
 * Quoted message bodies and field values remain data, never authority. */
export function hasInrAssistantDeferredApproval(message: string): boolean {
    const current = inrAssistantUnquotedRequest(message);
    const approval = "(?:confirm\\w*|valid\\w*|approuv\\w*|autoris\\w*|accord\\w*|approv\\w*|authoriz\\w*|authoris\\w*|agree\\w*|accept\\w*)";
    return new RegExp(`\\b(?:si|quand|lorsque|if|when|unless)\\b[^.!?;]{0,140}\\b${approval}\\b`).test(current)
        || new RegExp(`\\b(?:apres|une fois|des que|sous reserve|a condition|only after|after|once|pending|wait for|attends?|attendre)\\b[^.!?;]{0,140}\\b${approval}\\b`).test(current);
}
/** Keep the native guard as the authority. Only an independently delimited
 * imperative may be checked separately from an explanation in the same turn.
 * Original bytes (including field values) and exact quote containment survive.
 * Negative/conditional mixed requests fail closed rather than borrowing intent. */
export function matchesInrAssistantActionClause(message: string, quote: string, validate: (message: string, quote: string) => boolean): boolean {
    if (!quote.trim() || !message.includes(quote.trim()))
        return false;
    const unquoted = inrAssistantUnquotedRequest(message);
    // A condition is not the current instruction to execute. Check this before
    // the native fast path, including when a condition precedes the action.
    if (hasInrAssistantDeferredApproval(message) || /^(?:si|quand|lorsque|if|when|unless)\b|\b(?:si|quand|lorsque|if|when|unless)\s+(?:je|j'|tu|vous|nous|on|il|elle|le|la|les|un|une|the|i|you|we|they)\b/.test(unquoted))
        return false;
    if (validate(message, quote))
        return true;
    if (message.length > 4000)
        return false;
    if (/\b(?:ne|pas|jamais|sans|not|never|don't|do not|si|if|unless|quand|lorsque)\b|\bn'/.test(unquoted))
        return false;
    // Mask quoted data without changing UTF-16 indices used to take original text.
    const masked = inrAssistantMaskQuotedText(message);
    const directive = "(?:cr[ée]e(?:z)?|g[ée]n[èe]re(?:z)?|ajoute(?:z)?|pr[ée]pare(?:z)?|r[ée]dige(?:z)?|publie(?:z)?|poste(?:z)?|envoie|envoyez|modifie(?:z)?|corrige(?:z)?|configure(?:z)?|change(?:z)?|remplace(?:z)?|supprime(?:z)?|renomme(?:z)?|compl[èe]te(?:z)?|remplis(?:sez)?|mets|mettez|explique(?:z)?)";
    const boundary = new RegExp(`(?:[,;.!?]\\s+|\\s+(?:et|puis|ensuite)\\s+)(?=${directive}\\b)`, "gi");
    const clauses: string[] = [];
    let start = 0;
    for (const match of masked.matchAll(boundary)) {
        clauses.push(message.slice(start, match.index).trim());
        start = match.index! + match[0].length;
    }
    clauses.push(message.slice(start).trim());
    if (clauses.length < 2 || !clauses.some(clause => inrAssistantClauseIsAdvice(inrAssistantUnquotedRequest(clause))))
        return false;
    return clauses.some(clause => {
        if (inrAssistantClauseIsAdvice(inrAssistantUnquotedRequest(clause)))
            return false;
        const exact = clause.includes(quote.trim()) ? quote.trim() : quote.includes(clause) ? clause : null;
        return exact !== null && validate(clause, exact);
    });
}
