import { inrAssistantClauseIsAdvice, inrAssistantUnquotedRequest } from "./inrAssistantRequestClauses.ts";
export function isInrAssistantGoogleBusinessDraftReviewRequest(message: string) {
  const text = inrAssistantUnquotedRequest(message);
  return !inrAssistantClauseIsAdvice(text) && !/\b(?:si|if|quand|when|apres|avant|demain|later|sans|not|never)\b|\bne\b.{0,50}\bpas\b/.test(text)
    && /(?:fiche|profil|etablissement).{0,35}google|google.{0,35}(?:fiche|profil|etablissement)/.test(text)
    && /brouillon|saisies?|modifications?|changements?|draft|current edits/.test(text)
    && /\b(?:enregistr\w*|sauvegard\w*|prepar\w*|affich\w*|montre\w*|ouvre\w*|present\w*|save|review|show|open)\b/.test(text);
}
