import "server-only";

import { jsonSchema, tool } from "ai";
import { INR_ASSISTANT_BASIC_GUIDES } from "./inrAssistantGuidesBasic.ts";
import { INR_ASSISTANT_ACCOUNT_GUIDES } from "./inrAssistantGuidesAccount.ts";
import { INR_ASSISTANT_CREATION_GUIDES } from "./inrAssistantGuidesCreation.ts";
import { INR_ASSISTANT_MANAGEMENT_GUIDES } from "./inrAssistantGuidesManagement.ts";
import { INR_ASSISTANT_CODE_INDEX } from "./inrAssistantCodeIndex.generated.ts";
import { inrAssistantCapabilityGuide } from "./inrAssistantCapabilities.ts";
import { INR_ASSISTANT_RECOVERY_GUIDES } from "./inrAssistantGuidesRecovery.ts";
import { INR_ASSISTANT_CONTENT_LIMIT_GUIDES } from "./inrAssistantGuidesContentLimits.ts";
import { PRODUCT_NAVIGATION, productNavigationSummary, productNavigationReply } from "./productNavigation.ts";

export type InrAssistantAppGuide = {
  id: string; title: string; keywords: string[]; content: string; sourceFiles: string[]; directNavigation?: string;
};

export const INR_ASSISTANT_APP_GUIDES: readonly InrAssistantAppGuide[] = [
  {id:"assistant-capabilities",title:"iNr’Assistant : capacités par offre et validations",keywords:["assistant","capacités","capable","tout gérer","basique","standard","premium","fusion","annulation"],content:inrAssistantCapabilityGuide(),sourceFiles:["lib/inrAssistantCapabilities.ts","lib/inrAssistantActionCoverage.ts","lib/inrAssistantEditionPolicy.ts","lib/inrAssistantToolRegistry.ts","lib/inrAssistantUiTools.ts","lib/inrAssistantScreenCommandPolicy.ts","lib/inrAssistantUiCommands.ts","lib/productNavigation.ts"]},
  ...INR_ASSISTANT_CONTENT_LIMIT_GUIDES,
  ...INR_ASSISTANT_BASIC_GUIDES, ...INR_ASSISTANT_ACCOUNT_GUIDES, ...INR_ASSISTANT_CREATION_GUIDES, ...INR_ASSISTANT_MANAGEMENT_GUIDES,
  ...INR_ASSISTANT_RECOVERY_GUIDES.map(guide => ({ ...guide, keywords: [...guide.keywords], sourceFiles: [...guide.sourceFiles] })),
];

const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const STOP = new Set(["comment", "quoi", "faire", "pourquoi", "peux", "veux", "dois", "dans", "avec", "pour", "depuis", "cette", "quel", "quelle", "quels", "mes", "mon", "des", "les", "une", "est", "sur", "the", "what", "how", "with", "from"]);
for (const word of ["modifier", "changer", "gerer", "trouver", "retrouver", "consulter", "creer", "generer", "envoyer", "importer", "exporter", "ajouter", "supprimer", "aider", "manage", "find", "change", "edit", "create", "generate", "please", "puis", "peut"]) STOP.add(word);
const NAVIGATION_IDS: Readonly<Record<string, (typeof PRODUCT_NAVIGATION)[number]["id"]>> = {
  "channels-overview": "channels", reputation: "reviews",
  "studio-create": "studio", "basic-studio-create": "studio", "studio-edit": "studio", "media-library": "media", booster: "publish",
  stats: "stats", send: "send", crm: "crm", calendar: "calendar", emailing: "campaigns", ads: "ads",
  subscription: "subscription", "subscription-cancel-invoices": "subscription", account: "account",
  invoices: "invoices", quotes: "quotes", "business-dna": "business-dna", "ai-configuration": "ai-configuration",
};

function navigationId(guideId: string, query: string) {
  if (guideId === "subscription-cancel-invoices" && /factur|invoice|recu|receipt/.test(searchQuery(query))) return "subscription-invoices" as const;
  if ((guideId === "invoices" || guideId === "quotes") && !/creer|nouveau|preparer|facturer|deviser|create|new|prepare/.test(searchQuery(query))) return guideId === "invoices" ? "invoices-list" as const : "quotes-list" as const;
  return NAVIGATION_IDS[guideId];
}

/** Search aliases select reviewed content; user wording never becomes knowledge. */
function searchQuery(query: string): string {
  return normalize(query)
    .replace(/\breviews?\b/g, "avis").replace(/\bratings?\b/g, "etoiles")
    .replace(/\b(?:basic)\b/g, "basique").replace(/\bsubscriptions?\b/g, "abonnement")
    .replace(/\binvoices?\b/g, "facture").replace(/\bquotes?\b/g, "devis")
    .replace(/\b(?:calendar|appointments?)\b/g, "agenda").replace(/\bsettings\b/g, "reglages")
    .replace(/\bchannels?\b/g, "canaux").replace(/\blibrary\b/g, "mediatheque")
    .replace(/\b(?:pictures?|images?)\b/g, "image");
}

function isReviewsQuery(query: string): boolean {
  const value = searchQuery(query);
  return /\b(?:avis|reputation|etoiles)\b/.test(value) && !/\b(?:ton|votre|un) avis sur\b/.test(value);
}

function isOtherReviewsQuery(query: string): boolean {
  return isReviewsQuery(query) && /trustpilot|facebook|tripadvisor|yelp|booking|instagram/.test(searchQuery(query));
}

function rankGuides(query: string) {
  const exact = INR_ASSISTANT_APP_GUIDES.find(guide => guide.id === query.trim());
  if (exact) return [{ guide: exact, score: 1000, index: 0 }];
  const normalized = searchQuery(query);
  const tokens = normalized.split(/[^a-z0-9]+/).filter((token) => token.length >= 3 && !STOP.has(token));
  const mediaGeneration = /\b(?:generer|genere|generation|generate|generating)\b(?:(?!\b(?:post|publication|contenu|texte|legende|caption|content)\b)[^.!?;]){0,50}\b(?:image|videos?|medias?|visuels?|pictures?|photos?)\b/.test(normalized);
  const publicationGeneration = /\b(?:generer|genere|generation|generate|generating)\b(?:(?!\b(?:image|video|media|visuel|picture|photo)\b)[^.!?;]){0,50}\b(?:post|publication|caption)\b/.test(normalized);
  return INR_ASSISTANT_APP_GUIDES.map((guide, index) => {
    const title = normalize(guide.title);
    const destination = NAVIGATION_IDS[guide.id];
    const navigation = PRODUCT_NAVIGATION.find(entry => entry.id === destination);
    const keywords = [...guide.keywords, ...(navigation?.keywords ?? [])].map(normalize);
    const content = normalize(guide.content);
    const metadataMatch = tokens.some(token => title.includes(token) || keywords.some(keyword => keyword.includes(token)));
    const subscriptionInvoice = /factur|recu|receipt/.test(normalized) && /abonn|stripe/.test(normalized);
    const companyDetails = /\b(?:logo|coordonnees|telephone|numero|adresse|horaires|metier)\b/.test(normalized)
      && /\b(?:mon|mes|notre|entreprise|activite)\b/.test(normalized) && !/google|gmb|facebook|instagram|linkedin|crm|client|contact|cta|image|video|retouch|visuel/.test(normalized);
    const interfaceLanguage = /\blangue\b/.test(normalized) && !/contenu|publication|communication|generation|redaction/.test(normalized);
    const receivedMail = /mail|email|message|messagerie/.test(normalized) && /recu|recep|repondre|inbox|received/.test(normalized);
    const score = (isReviewsQuery(query) && guide.id === "reputation" ? 200 : 0)
      + (mediaGeneration && guide.id === "studio-create" ? 220 : 0)
      + (publicationGeneration && guide.id === "booster" ? 220 : 0)
      + (subscriptionInvoice && guide.id === "subscription-cancel-invoices" ? 250 : 0)
      + (companyDetails && guide.id === "business-dna" ? 220 : 0)
      + (interfaceLanguage && guide.id === "account-preferences-privacy" ? 220 : 0)
      + (receivedMail && guide.id === "send" ? 220 : 0) + tokens.reduce((total, token) => total +
      (keywords.some((keyword) => keyword.includes(token)) ? 8 : 0) + (title.includes(token) ? 4 : 0) + (content.includes(token) ? 1 : 0), 0);
    return { guide, score: metadataMatch || score >= 200 ? score : 0, index };
  }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
}

/** Exact common navigation needs no generative paraphrase (or paid model call). */
export function getVerifiedInrAssistantNavigation(query: string): string | null {
  const value = normalize(query);
  const asksForLocation = /^(?:ou\b|quel chemin\b|quel parcours\b)|\bou (?:est|sont|se trouve|trouver|gerer|consulter|acceder|puis.je|peut.on)\b/.test(value);
  const asksForSteps = asksForLocation || /(?:quels?|comment).*(?:boutons?|cliqu|connect|canaux|canal)|(?:boutons?).*(?:exacts?|connect)/.test(value);
  const needsDiagnosis = /(?:erreur|bloqu|impossible|echec|refus|permission|ne fonctionne|n.apparait|pas.*(?:page|compte)|probleme)/.test(value);
  const recallsHistory = /(?:\bhier\b|avant.hier|semaine derniere|mois dernier|precedem|souviens|souvenir|memoire|avions|parlait|parle|convenu|dernier(?:e)?(?:s)? (?:echange|discussion|conversation)|remember|previous|last (?:time|chat|conversation)|yesterday)/.test(value);
  const requestsOtherWork = /\b(?:genere|cree|publie|envoie|supprime|modifie|analyse|compare|prepare|telecharge|importe|exporte|redige|reponds|ouvre|liste|lis|cherche|enregistre|programme|planifie|applique)\b|\b(?:puis|ensuite)\b.*\b(?:creer|generer|publier|envoyer|supprimer|modifier|analyser|preparer|telecharger|importer|ouvrir|rediger)\b/.test(value);
  const extraSentences = value.split(/[?!.]\s+/).slice(1).filter(part => part.trim());
  const hasOtherClause = extraSentences.some(part => !/^(?:indique|donne|explique)\b[^.!?]*(?:chemin|parcours|etapes|interface)[^.!?]*(?:[.!?]|$)/.test(part));
  const hasMultipleTopics = /\b(?:et|puis|ensuite|and|then)\b/.test(value) && !/\b(?:puis|et) choisir (?:ma|la|une) page[?!. ]*$/.test(value);
  if (!asksForSteps || needsDiagnosis || recallsHistory || requestsOtherWork || hasOtherClause || hasMultipleTopics || /[;\n]/.test(value)) return null;
  if (asksForLocation && isOtherReviewsQuery(query) && !/\b(?:google|gmb)\b/.test(value)) {
    const platform = [[/facebook/, "Facebook"], [/trustpilot/, "Trustpilot"], [/tripadvisor/, "TripAdvisor"], [/yelp/, "Yelp"], [/booking/, "Booking"], [/instagram/, "Instagram"]] as const;
    const label = platform.find(([pattern]) => pattern.test(value))?.[1];
    if (label) return `La gestion des avis ${label} n’est pas intégrée dans iNrCy. Pour consulter ces avis ou y répondre, utilisez directement ${label}.`;
  }
  const guide = rankGuides(query)[0]?.guide;
  if (!guide) return null;
  // Only the unambiguous Google reviews FAQ bypasses generation. Other topics,
  // languages and detailed operations retain the complete guide/tool pipeline.
  const needsOperationDetails = /supprim|effac|fusion|annul|payer|acheter|prix|tarif|gratuit|illimit|basique|\bbasic\b|premium|standard|\d/.test(value);
  const explicitGoogleReviews = isReviewsQuery(query) && /\b(?:google|gmb)\b/.test(value) && !isOtherReviewsQuery(query);
  if (asksForLocation && explicitGoogleReviews && !needsOperationDetails && !/\b(?:where|how|which|and|et|puis|ensuite)\b/.test(value)) {
    return productNavigationReply("reviews");
  }
  if (!guide.id.startsWith("channel-") && guide.id !== "channels-overview") return null;
  // Only explicitly reviewed, user-facing steps can bypass the LLM. The longer
  // internal guide also contains instructions that must not become UI copy.
  return guide.directNavigation ?? null;
}

/** Current verified procedures outrank old chat messages and legacy help articles. */
export function getInrAssistantAppKnowledge(query: string, maxChars = 4_800): string {
  const limit = Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : 4_800;
  const ranked = rankGuides(query).slice(0, 2);
  const lines = ["Référence de l’interface actuelle, prioritaire sur les anciennes réponses ou notices :"];
  const append = (text: string) => {
    if ([...lines, text].join("\n").length > limit) return false;
    lines.push(text); return true;
  };
  if (isOtherReviewsQuery(query)) {
    append("Périmètre des avis : les avis intégrés pris en charge sont uniquement les avis Google. La gestion d’avis Facebook, Trustpilot, TripAdvisor ou d’autres plateformes n’est pas intégrée dans iNrCy. Répondre pour la plateforme demandée : ne proposer ni chemin ni lien vers les avis Google. Indiquer la limite et inviter à utiliser directement la plateforme concernée, sans inventer ses boutons.");
    return lines.join("\n").slice(0, limit);
  }
  if (/\blangue\b/.test(searchQuery(query))) {
    append("Langue : distinguer la langue de l’interface (sélecteur de langue du cockpit, ou Menu → Langue sur mobile) de la langue de rédaction (Personnaliser → Ma communication → Style et préférences). Si la demande est ambiguë, demander laquelle avant de guider.");
  }
  // Preserve access rules before long screen guides when comparing offers.
  if (/\b(?:basique|standard|premium|offre|forfait)\b/.test(searchQuery(query))) {
    append(`Droits et validations [assistant-capabilities]\n${inrAssistantCapabilityGuide().split("\n")[0]}`);
  }
  const navigationIds = [...new Set(ranked.flatMap(({ guide }) => {
    const destination = navigationId(guide.id, query);
    return destination ? [destination] : [];
  }))];
  for (const id of navigationIds) {
    if (!append(productNavigationSummary(id))) append(productNavigationSummary(id, false));
  }
  let omitted = false;
  for (const { guide } of ranked) {
    const text = `\n${guide.title} [${guide.id}]\n${guide.content}`;
    if (append(text)) continue;
    omitted = true;
    // An oversized first guide must not silently give way to an unrelated one.
    // Shared navigation already preserves its path and conditions; keep a bounded
    // excerpt for guides without a navigation entry (e.g. CTA compatibility).
    if (!NAVIGATION_IDS[guide.id]) {
      const notice = `\n[Extrait : lire readAppGuide avec la rubrique ${guide.id} avant de donner des détails absents.]`;
      const available = limit - lines.join("\n").length - guide.title.length - guide.id.length - notice.length - 10;
      if (available > 150) append(`${guide.title} [${guide.id}]\n${guide.content.slice(0, available)}${notice}`);
    }
  }
  if (!ranked.length) {
    append("Aucune procédure précise identifiée. Pour une question sur un outil, consulte readAppGuide puis demande une précision si nécessaire. Ne déduis aucun écran ni bouton d’un ancien échange.");
    for (const id of ["channels", "personalization", "publish"] as const) append(productNavigationSummary(id));
  }
  if (omitted) append("Référence abrégée : consulte readAppGuide pour les détails et conditions manquants. Ne complète pas une procédure par supposition.");
  return lines.join("\n").slice(0, limit);
}

/** Bounded public product knowledge only: no filesystem path or SQL execution. */
export function createInrAssistantAppGuideTool() {
  return tool({
    strict: true,
      description: "Consulter les procédures revues d’iNrCy et leurs parcours partagés avec l’interface. Chercher par outil ou question : Booster, Studio, Mes médias, ADN, réglages IA, canaux, abonnement, agents, Stats, Send, CRM, Agenda, Avis Google, campagnes, devis ou factures. Ne jamais inventer de bouton ni reprendre un ancien parcours.",
    inputSchema: jsonSchema<{ topic: string }>({
      type: "object", properties: { topic: { type: "string", minLength: 1, maxLength: 140, description: "Identifiant de rubrique, nom d’outil ou courte question de navigation." } },
      required: ["topic"], additionalProperties: false,
    }, { validate: (value) => {
      const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
      return Object.keys(input).length === 1 && typeof input.topic === "string" && input.topic.trim().length > 0 && input.topic.length <= 140
        ? { success: true, value: { topic: input.topic.trim() } }
        : { success: false, error: new Error("Rubrique d’aide invalide.") };
    } }),
    execute: async ({ topic }) => {
      const sourcePathRequest = /(?:^|[\\/])\.\.(?:[\\/]|$)|^\.|^[a-z]:[\\/]|\.(?:tsx?|json|env)(?:$|[?#])/i.test(topic);
      const guides = (sourcePathRequest ? [] : rankGuides(topic)).slice(0, 2).map(({ guide }) => ({ id: guide.id, title: guide.title, content: guide.content }));
      return {
        source: "reviewed_current_application_code", codeVersion: INR_ASSISTANT_CODE_INDEX.sourceDigest.slice(0, 16),
        found: guides.length > 0, guides,
        ...(!guides.length ? { message: "Aucune procédure vérifiée ne correspond à cette recherche. Demander une précision ; ne pas inventer de bouton, de chemin ou d’action." } : {}),
      };
    },
  });
}
