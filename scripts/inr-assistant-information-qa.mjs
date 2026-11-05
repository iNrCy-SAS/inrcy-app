/** Answer contracts complement tool-call assertions: a successful tool call does not prove a correct explanation. */
export const INR_ASSISTANT_INFORMATION_QA_CASES = [
  { id: 'reviews-location-fr', prompt: 'Où gérer mes avis Google ? Donne le chemin actuel dans iNrCy, sans effectuer d’action.', calls: {}, readOnly: true, answerContract: 'reviews-fr' },
  { id: 'reviews-button-fr', prompt: 'Où est le bouton pour répondre aux avis Google dans iNrCy ? Explique seulement les étapes.', calls: {}, readOnly: true, answerContract: 'reviews-fr' },
  { id: 'reviews-location-en', prompt: 'Where can I manage my Google reviews in iNrCy? Give only the current steps; do not perform any action.', calls: {}, readOnly: true, answerContract: 'reviews-en' },
  { id: 'basic-studio-access', prompt: 'Le forfait Basique permet-il de générer une image dans Studio ? Explique les conditions, sans rien générer.', calls: {}, readOnly: true, edition: 'basic', answerContract: 'basic-studio' },
  { id: 'subscription-invoices-location', prompt: 'Où retrouver les factures de mon abonnement iNrCy ? Donne le chemin, sans effectuer d’action.', calls: {}, readOnly: true, answerContract: 'subscription-invoices' },
];

const normalize = (value) => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[’‘]/g, "'");

export function evaluateInrAssistantInformationAnswer(contract, message) {
  const text = normalize(message);
  const violations = [];
  const require = (pattern, reason) => { if (!pattern.test(text)) violations.push(reason); };
  const forbid = (pattern, reason) => { if (pattern.test(text)) violations.push(reason); };
  if (contract === 'reviews-fr' || contract === 'reviews-en') {
    require(/(?:canaux|channels)[\s\S]*google business[\s\S]*(?:avis|reviews)/, 'missing_current_channels_google_business_reviews_steps');
    forbid(/menu\s*(?:>|→|:|-|\*|«|\s)+\s*(?:la\s+)?reputation|(?:ouvrez|ouvrir|open)\s+(?:la\s+)?(?:section\s+)?[«"*\s]*reputation/, 'obsolete_reputation_menu');
    forbid(/(?:accueil|home)[\s\S]{0,80}(?:gerer|manage)[\s\S]{0,40}(?:section\s+)?reputation/, 'obsolete_reputation_home_section');
  } else if (contract === 'basic-studio') {
    require(/basique|basic/, 'missing_basic_offer');
    require(/studio/, 'missing_studio');
    require(/credit|recharg/, 'missing_credit_conditions');
    forbid(/(?:studio|generation|generer)[^.\n]{0,100}(?:reserve|uniquement|seulement|exclusif)[^.\n]{0,60}(?:standard|premium)|(?:basique|basic)[^.\n]{0,65}(?:ne permet pas|pas acces|cannot|not available)[^.\n]{0,40}(?:gener|studio|images?|medias?)/, 'obsolete_basic_studio_restriction');
  } else if (contract === 'subscription-invoices') {
    require(/(?:mon compte|my account)[\s\S]*(?:factures|invoices)/, 'missing_account_subscription_invoices_steps');
    forbid(/\/dashboard\/factures(?:[/?#)\s]|$)/, 'client_invoice_path_used_for_subscription');
  } else violations.push('unknown_answer_contract');
  return { evaluated: true, passed: violations.length === 0, violations };
}
