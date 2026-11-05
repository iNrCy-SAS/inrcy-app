import { inrAssistantClauseIsAdvice, inrAssistantRequestClauses } from "./inrAssistantRequestClauses.ts";
export function isInrAssistantExistingCreditOrderReconciliationRequest(message: string) {
  return inrAssistantRequestClauses(message).some(text => {
    if (inrAssistantClauseIsAdvice(text) || /\b(?:si|if|quand|when|apres|avant|demain|later|sans|not|never)\b|\bne\b.{0,50}\bpas\b/.test(text)) return false;
    // A wallet/quota question never authorizes reconciliation. Both the native
    // verification verb and the existing order target must be in this clause.
    const target = /\brecharge\w*\b/.test(text) || /\bcommande\w*\b/.test(text) && (
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/.test(text)
      || /\b(?:credit\w*|image\w*|video\w*|existante?\w*|derniere?\w*|precedente?\w*|latest|last|existing)\b/.test(text)
    );
    return target && /\b(?:actualis\w*|verifi\w*|reconcili\w*|check|refresh|reconcile)\b/.test(text);
  });
}
