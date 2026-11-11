/** Routing vocabulary only. A clause never grants a native executor permission. */
export function inrAssistantMaskQuotedText(message: string): string {
    // Apostrophes inside words (l'adresse, d’Alice, don't) are not quote starts.
    // Preserve UTF-16 offsets so native guards can retain original field bytes.
    return message.replace(/```[\s\S]*?(?:```|(?![\s\S]))|`[^`]*`|«[^»]*»|"[^"]*"|“[^”]*”|‘[^’]*’|(?<![\p{L}\p{N}])'(?:[^'\r\n]|'(?=[\p{L}\p{N}]))*'(?![\p{L}\p{N}])|^>.*$/gmu, match => " ".repeat(match.length));
}
export function inrAssistantUnquotedRequest(message: string): string {
    return inrAssistantMaskQuotedText(message)
        .normalize("NFD").replace(/\p{M}/gu, "").replace(/[’‘]/g, "'").toLowerCase().trim();
}
export function inrAssistantRequestClauses(message: string): string[] {
    const directive = "(?:(?:ne|not|never|do not)\\s+|n['’]|don't\\s+)?(?:converti\\w*|transform\\w*|appliqu\\w*|charge\\w*|prerempli\\w*|selectionn\\w*|choisi\\w*|utilis\\w*|sauvegard\\w*|optimis\\w*|compress\\w*|joins|joindre|attache\\w*|ouvre\\w*|ouvrir|emmene\\w*|amene\\w*|va|marqu\\w*|enregistr\\w*|actualis\\w*|rafraich\\w*|synchronis\\w*|telecharg\\w*|import\\w*|export\\w*|restaur\\w*|refus\\w*|reordonn\\w*|download|refresh|import|export|ajout\\w*|cree\\w*|creer|gener\\w*|modifi\\w*|retouch\\w*|prepar\\w*|redig\\w*|publie\\w*|poste\\w*|envoi\\w*|configur\\w*|activ\\w*|desactiv\\w*|coup\\w*|regl\\w*|chang\\w*|repond\\w*|annul\\w*|supprim\\w*|deplac\\w*|mets|renomm\\w*|archive\\w*|retrouv\\w*|recherch\\w*|cherche\\w*|consulte\\w*|verifi\\w*|lis|lire|liste\\w*|regarde\\w*|montre\\w*|affiche\\w*|explique\\w*|analyse\\w*|diagnostiqu\\w*|compare\\w*|create|generate|prepare|add|edit|publish|send|find|read|search|list|check|disable|enable|reply)\\b";
    const decisionDirective = "(?:(?:ne|not|never|do not)\\s+|n['’]|don't\\s+)?(?:confirm\\w*|valid\\w*|accept\\w*|finalis\\w*)\\b";
    const clauses = inrAssistantUnquotedRequest(message).split(new RegExp(`(?:\\s+(?:et\\s+(?:puis\\s+)?|puis\\s+|ensuite\\s+|mais\\s+|and\\s+(?:then\\s+)?|then\\s+)|[,;.!?]\\s+)(?=(?:${directive}|${decisionDirective}))`, "i"))
        .map(clause => clause.trim()).filter(Boolean);
    return inrAssistantMergeAdviceClauses(clauses);
}
export function inrAssistantMergeAdviceClauses(clauses: string[]): string[] {
    const result: string[] = [];
    for (const clause of clauses) {
        // "Comment créer puis publier ?" is one explanation. A new imperative
        // ("puis crée") starts its own explicit request, not a global advice ban.
        if (result.length && inrAssistantClauseIsAdvice(result.at(-1)!) && /^(?:creer|generer|publier|envoyer|modifier|configurer|ajouter|supprimer|preparer|consulter|rechercher|lire|confirmer|valider|accepter|finaliser)\b/.test(clause))
            result[result.length - 1] += ` puis ${clause}`;
        else
            result.push(clause);
    }
    return result;
}
export function inrAssistantClauseIsAdvice(clause: string): boolean {
    return /^(?:comment|pourquoi|explique|how|why|what|wie|como)\b/.test(clause) || /\b(?:explique|explain|me dire)\b.{0,60}\b(?:comment|how|pourquoi|why)\b/.test(clause);
}
