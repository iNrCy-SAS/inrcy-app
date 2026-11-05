import { inrAssistantUnquotedRequest } from "./inrAssistantRequestClauses.ts";
export function isInrAssistantResumePublicationDraftRequest(message: string): boolean {
  const text = inrAssistantUnquotedRequest(message);
  if (/\b(?:devis|factures?|avis|commentaires?|reponses?|courriels?|courriers?|e[ -]?mails?|mails?|campagnes?|rendez[ -]vous|rdv|evenements?|invoices?|quotes?|reviews?|replies|reply)\b/.test(text)) return false;
  return !/\b(?:comment|explique\w*|pourquoi|si|quand|lorsque|if|when|avant|apres|before|after|demain|tomorrow|later|plus tard|ne|pas|jamais|not|never|mail|email|campagne|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|prochain\w*)\b|\bn'|\bdans\s+(?:\d+|une?|quelques)\s+(?:minutes?|heures?|jours?)\b/.test(text)
    && /^(?:(?:peux|pourrais)[ -]tu\s+|(?:pouvez|pourriez)[ -]vous\s+)?(?:(?:me|nous)\s+)?(?:reprends|reprenez|reprendre|ouvre|ouvrez|ouvrir|reouvre|reouvrez|reouvrir|resume|reopen|open)\s+(?:l'edition\s+(?:du|de ce|de mon)\s+|(?:(?:ce|le|mon|notre|this|the|my)\s+)?)?(?:brouillon|draft)\b/.test(text);
}
