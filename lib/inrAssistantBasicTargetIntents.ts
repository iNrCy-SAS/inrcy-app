import { inrAssistantMaskQuotedText } from "./inrAssistantRequestClauses.ts";

const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").replace(/[’‘]/g, "'").toLowerCase();
const COMMAND = "(?:reprogramme|reprogrammer|programme|programmer|replanifie|replanifier|planifie|planifier|configure|configurer|modifie|modifier|change|changer|regle|regler|active|activer|desactive|desactiver|coupe|couper|arrete|arreter|autorise|autoriser|cree|creer|ajoute|ajouter|renomme|renommer|supprime|supprimer|efface|effacer|retire|retirer|deconnecte|deconnecter|reinitialise|reinitialiser|reset|definis|definir|mets|mettez|prepare|preparer|publie|publier|envoie|envoyer|explique|expliquer|lis|affiche|afficher|masque|masquer|cache|cacher|personnalise|personnaliser|corrige|corriger|remplace|remplacer|enregistre|enregistrer|complete|completer|remplis|remplir|utilise|utiliser|rattache|rattacher|genere|generer)";
const BOUNDARY = new RegExp(`(?:[;.!?]\\s*|\\n+|\\s+(?:et(?:\\s+puis)?|puis|ensuite|mais)\\s+)(?=(?:ne\\s+|n')?${COMMAND}\\b)`, "i");
const START = new RegExp(`^(?:(?:s'il te plait|s'il vous plait|svp|merci de|peux[- ]tu|pourrais[- ]tu|tu peux|je veux que tu|je souhaite que tu|j'aimerais que tu)\\s+)?(${COMMAND})\\b\\s+([\\s\\S]+)$`, "i");
const DETERMINERS = /^(?:(?:le|la|les|un|une|mon|ma|mes|notre|nos|ce|cet|cette|ces|des|nouveau|nouvelle|nouveaux|nouvelles|tout|toute|tous|toutes)\s+|l')+/i;
const WITHOUT_INSTRUCTION = /\b(?:comment|pourquoi|explique|expliquer|imagine|suppose|si|quand|lorsque|unless|not|never|jamais|demain|plus tard|ce soir)\b|\bne\b.{0,80}\bpas\b|\bn'(?:active|autorise|arrete|efface|enregistre|utilise|affiche)\b|\b(?:programme|planifie|configure|modifie|change|active|desactive|cree|ajoute|renomme|supprime|retire|deconnecte|reinitialise|mets|definis|affiche|masque|cache|personnalise|corrige|remplace|enregistre|complete|remplis|utilise)\s+pas\b|\bdans\s+(?:\d+|un|une|deux|trois)\s*(?:minutes?|heures?|jours?)\b/;
type Directive = { verb: string; object: string; clause: string };

/** The quote must contain the actual requested object. Context words from
 * another clause or quoted content can never supply that object for it. */
function directives(message: string, instructionQuote: string): Directive[] {
  if (typeof message !== "string" || message.length > 4000 || typeof instructionQuote !== "string" || !instructionQuote.trim() || instructionQuote.length > 1200 || !message.includes(instructionQuote)) return [];
  const maskedMessage = inrAssistantMaskQuotedText(message), maskedQuote = inrAssistantMaskQuotedText(instructionQuote);
  if (!maskedQuote.trim() || !maskedMessage.includes(maskedQuote)) return [];
  const current = normalize(maskedMessage), quote = normalize(maskedQuote);
  if (WITHOUT_INSTRUCTION.test(current) || WITHOUT_INSTRUCTION.test(quote)) return [];
  const parse = (value: string) => value.split(BOUNDARY).flatMap(clause => {
    const match = START.exec(clause.trim());
    return match ? [{ verb: match[1], object: match[2].trim().replace(DETERMINERS, "").trim(), clause: clause.trim() }] : [];
  });
  const currentDirectives = parse(current);
  return parse(quote).filter(candidate => currentDirectives.some(own => own.verb === candidate.verb && own.clause.includes(candidate.clause) && own.object.startsWith(candidate.object)));
}

export function isInrAssistantDnaScheduleRequest(message: string, instructionQuote = message): boolean {
  return directives(message, instructionQuote).some(({ verb, object }) => {
    if (!/^(?:reprogramme|reprogrammer|programme|programmer|replanifie|replanifier|planifie|planifier|configure|configurer|modifie|modifier|change|changer|regle|regler|active|activer|desactive|desactiver|coupe|couper|arrete|arreter|mets|mettez)$/.test(verb) || !/^(?:reanalyse|analyse|analyses|programmation|planification)\b/.test(object)) return false;
    const directTarget = object.split(/\b(?:a partir|depuis|selon|avec|grace a|d'apres|basee? sur|en utilisant|sur la base)\b/, 1)[0];
    const dna = /\b(?:adn|dna|inradn)\b/.exec(directTarget);
    if (!dna || dna.index > 120) return false;
    if (!/^(?:reprogramme|reprogrammer|programme|programmer|replanifie|replanifier|planifie|planifier)$/.test(verb) && !/^(?:programmation|planification)\b/.test(object) && !/\b(?:mensuelle?|automatique?|recurrente?|horaires?|echeance)\b/.test(object)) return false;
    return !/\b(?:publication|post|image|photo|video|mail|campagne|brouillon|contenu|tableau|widget|site|offre|produit)\b/.test(directTarget.slice(0, dna.index));
  });
}

export function isInrAssistantPinterestBoardRequest(message: string, action: "create" | "rename" | "delete", instructionQuote = message): boolean {
  const verbs = action === "create" ? /^(?:cree|creer|ajoute|ajouter)$/ : action === "rename" ? /^(?:renomme|renommer|modifie|modifier|change|changer)$/ : /^(?:supprime|supprimer|efface|effacer|retire|retirer)$/;
  return directives(message, instructionQuote).some(({ verb, object, clause }) => verbs.test(verb) && /^(?:tableau|board)\b/.test(object) && /\bpinterest\b/.test(clause));
}

export function isInrAssistantSocialPreferencesRequest(message: string, channel: "facebook" | "instagram" | "threads", instructionQuote = message): boolean {
  return directives(message, instructionQuote).some(({ verb, object, clause }) => {
    if (!/^(?:active|activer|desactive|desactiver|coupe|couper|autorise|autoriser|modifie|modifier|change|changer|configure|configurer|regle|regler|definis|definir|mets|mettez)$/.test(verb) || !new RegExp(`\\b${channel}\\b`).test(clause)) return false;
    // A publication-specific format is handled by the publication tools. Its
    // channel/format words do not authorize a change to account-wide defaults.
    if (/\b(?:cette|ce|cet|une?|la|le|ma|mon|ta|ton|sa|son)\s+(?:publication|post|brouillon|contenu|message|campagne)\b/.test(clause)) return false;
    if (/^(?:preferences|reglages|options|formats)\b/.test(object)) return true;
    if (/^(?:reels?|stor(?:y|ies)|ghost)\b/.test(object)) return /^(?:active|activer|desactive|desactiver|coupe|couper|autorise|autoriser)$/.test(verb) || /\b(?:par defaut|defaut|globaux|globales)\b/.test(clause);
    if (/^(?:format|mode|facebook|instagram|threads)\b/.test(object)) return /\b(?:par defaut|defaut|global|globale|globaux|globales)\b/.test(clause) || /^(?:mode|format)\s+(?:ghost|reels?|stor(?:y|ies))\b/.test(object) && /^(?:active|activer|desactive|desactiver|coupe|couper|autorise|autoriser)$/.test(verb);
    return false;
  });
}

export function isInrAssistantWebsiteLifecycleRequest(message: string, mode: "remove_url" | "reset", instructionQuote = message): boolean {
  const verbs = mode === "reset" ? /^(?:reinitialise|reinitialiser|reset)$/ : /^(?:supprime|supprimer|efface|effacer|retire|retirer|deconnecte|deconnecter)$/;
  return directives(message, instructionQuote).some(({ verb, object }) => {
    if (!verbs.test(verb)) return false;
    // Only the site itself or its direct URL/configuration is the target.
    // A photo, widget, article or individual Google binding has its own action.
    if (/\b(?:photo|image|video|article|publication|post|widget|ga4|gsc|analytics|search console)\b/.test(object)) return false;
    if (/^site(?:[ _-]?web| internet)?\b/.test(object)) return true;
    const nouns = mode === "reset" ? "(?:configuration|canal|bulle)" : "(?:lien|url|adresse|connexion|canal|bulle)";
    return new RegExp(`^${nouns}\\s+(?:(?:complete?|globale?|totale?|entiere?|de|du|des|mon|ma|notre|le|la|au|pour)\\s+|d'|l')*site(?:[ _-]?web| internet)?\\b`).test(object);
  });
}

const EDIT = /^(?:modifie|modifier|change|changer|configure|configurer|regle|regler|definis|definir|mets|mettez|corrige|corriger|remplace|remplacer|enregistre|enregistrer|personnalise|personnaliser|complete|completer|remplis|remplir|utilise|utiliser)$/;
const MEDIA_OBJECT = /\b(?:image|photo|video|media|visuel|illustration|publication|post|brouillon|campagne)\b/;
const targetPart = (object: string) => object.split(/\b(?:par|avec|pour|a partir|en utilisant)\b/, 1)[0];

export function isInrAssistantBusinessIdentityRequest(message: string, instructionQuote = message): boolean {
  return directives(message, instructionQuote).some(({ verb, object }) => {
    if (!EDIT.test(verb)) return false;
    const target = targetPart(object);
    if (MEDIA_OBJECT.test(target) || /\b(?:facebook|instagram|threads|linkedin|pinterest|tiktok|youtube|google business|fiche google|cta|bouton)\b/.test(target)) return false;
    if (/^logo\b/.test(object)) return /^(?:remplace|remplacer|mets|mettez|definis|definir|utilise|utiliser|enregistre|enregistrer)$/.test(verb);
    return /^(?:entreprise|societe|profil|identite|coordonnees|nom|prenom|raison sociale|telephone|email|adresse|ville|code postal|metier|profession|secteur|forme juridique|capital|siren|tva|informations juridiques)\b/.test(object);
  });
}

export function isInrAssistantNativePresentationRequest(message: string, channel: "inrbadge" | "inr_search", instructionQuote = message): boolean {
  return directives(message, instructionQuote).some(({ verb, object, clause }) => {
    const toggle = /^(?:masque|masquer|cache|cacher|affiche|afficher|active|activer|desactive|desactiver)$/.test(verb);
    if (!EDIT.test(verb) && !toggle) return false;
    const alias = channel === "inrbadge" ? /\b(?:inr[' _-]*)?badge\b/ : /\b(?:inr[' _-]*)?search\b/;
    const target = targetPart(object), at = alias.exec(target);
    if (!at || MEDIA_OBJECT.test(target) || /\b(?:google search|search console)\b/.test(clause)) return false;
    if (channel === "inrbadge") return !/\blogo\b/.test(target.slice(0, at.index)) && /^(?:theme|palette|couleurs?|presentation|apparence)\b/.test(object);
    if (/\blogo\b/.test(target.slice(0, at.index)) && !toggle) return false;
    return /^(?:presentation|apparence|affichage|visibilite|sections?|titre|description|texte de presentation|telephone|email|adresse|coordonnees|contact|nom du contact|logo|badge|site|reseaux|services|horaires|actualites)\b/.test(object);
  });
}

export function isInrAssistantWebsiteConfigurationRequest(message: string, section: "analytics" | "widget", instructionQuote = message): boolean {
  return directives(message, instructionQuote).some(({ verb, object }) => {
    if (!EDIT.test(verb) && !/^(?:rattache|rattacher|genere|generer)$/.test(verb)) return false;
    const target = targetPart(object);
    if (MEDIA_OBJECT.test(target)) return false;
    if (section === "widget") return /\bwidget\b/.test(target) && /^(?:widget|configuration|parametres|reglages|apparence|presentation|design|couleurs?|theme|accent|disposition|mise en page|layout|affichage|nombre|limite|quantite)\b/.test(object);
    return /\b(?:ga4|gsc|analytics|search console)\b/.test(target) && /^(?:rattachement|configuration|reglages|parametres|identifiant|id|propriete|ga4|gsc|google analytics|analytics|search console)\b/.test(object);
  });
}
