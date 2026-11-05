import { inrAssistantClauseIsAdvice, inrAssistantRequestClauses } from "./inrAssistantRequestClauses.ts";

export const INR_ASSISTANT_STUDIO_DRAFT_REVIEW_TARGETS = ["studio_draft_reset", "studio_draft_close", "studio_draft_abandon", "studio_recovery_guided", "studio_recovery_free"] as const;
export type InrAssistantStudioDraftReviewTarget = typeof INR_ASSISTANT_STUDIO_DRAFT_REVIEW_TARGETS[number];

/** Permission to open a native review only, never to confirm a job mutation. */
export function isInrAssistantStudioDraftReviewRequest(message: string, target: InrAssistantStudioDraftReviewTarget): boolean {
  if (!INR_ASSISTANT_STUDIO_DRAFT_REVIEW_TARGETS.includes(target)) return false;
  return inrAssistantRequestClauses(message).some(clause => {
    if (inrAssistantClauseIsAdvice(clause) || /\b(?:si|quand|apres|avant|demain|plus tard|sans|jamais|not|never|if|when)\b|\bne\b.{0,50}\bpas\b|\bn['’]/.test(clause) || !/\bstudio\b/.test(clause)) return false;
    const text = clause.replace(/^(?:(?:peux|pourrais)[ -]tu|(?:pouvez|pourriez)[ -]vous)\s+/, "");
    if (target === "studio_draft_reset") return /^(?:reinitialis\w*|remets?\s+a\s+zero)\b/.test(text) || /^(?:ouvre\w*|affiche\w*|prepare\w*)\b.{0,35}(?:confirmation|revue).{0,35}reinitialisation/.test(text);
    if (target === "studio_draft_close") return /^(?:ferme\w*|quitte\w*)\b/.test(text) && !/publication|tentative|recuperation|reinitialis/.test(text);
    if (target === "studio_draft_abandon") return /^abandonne\w*\b/.test(text) && /\b(?:publication|retour|transfert)\b/.test(text) && !/\btentative\b/.test(text);
    return /^(?:abandonne\w*|annule\w*)\b/.test(text) && /\b(?:tentative|recuperation)\b/.test(text) && (target === "studio_recovery_guided" ? /\bguide\b/.test(text) : /\blibre\b/.test(text));
  });
}
