import "server-only";

import gpsFrench from "../messages/fr-FR/gps.json";
import shellFrench from "../messages/fr-FR/shell.json";
import settingsFrench from "../messages/fr-FR/settings.json";
import dashboardFrench from "../messages/fr-FR/dashboard.json";
import {
  HELP_GOALS,
  getHelpArticles,
  getHelpArticleDestination,
  getHelpGoalTools,
  normalizeHelpSearch,
} from "../app/dashboard/_components/dashboardUsageGuideModel.ts";
import type { GpsArticleSource, GpsMessageKey } from "../app/dashboard/gps/noticeContent.ts";
import { DASHBOARD_CHANNEL_CREATE_HREF_BY_KEY } from "../app/dashboard/dashboard.channel-setup.ts";
import { currentSubscriptionOffer, subscriptionChargeLabel } from "./subscriptionOffers.ts";
import { INR_ASSISTANT_ACCOUNT_GUIDES, INR_ASSISTANT_CHANNELS_HREF } from "./inrAssistantGuidesAccount.ts";

export const INR_ASSISTANT_KNOWLEDGE_MAX_CHARS = 5_000;

const STOP_WORDS = new Set(["comment", "faire", "quoi", "dois", "veux", "peux", "pour", "dans", "avec", "sans", "pourquoi", "mon", "mes", "une", "des", "les", "est", "sur", "pas", "que", "qui", "this", "what", "with", "have", "can", "how", "the"]);
const ARTICLES = getHelpArticles("premium");
const STANDARD_ARTICLES = new Map(getHelpArticles("standard").map(({ article }) => [article.id, article]));

function currentDestination(href: string): string {
  const destination = getHelpArticleDestination(href);
  return destination === "/dashboard?helpAction=channels" ? INR_ASSISTANT_CHANNELS_HREF : destination;
}

function gps(key: GpsMessageKey): string {
  return gpsFrench[key];
}

function shell(...keys: (keyof typeof shellFrench)[]): string {
  return keys.map(key => shellFrench[key]).join(" ").replace(/\s+([.,])/g, "$1");
}

/** Same destinations and edition restrictions as the public help's tool buttons. */
function toolMap(): string {
  const premium = HELP_GOALS.flatMap(goal => getHelpGoalTools(goal, "premium", true));
  const standard = HELP_GOALS.flatMap(goal => getHelpGoalTools(goal, "standard", true));
  const seen = new Set<string>();
  const rows = premium.filter(tool => !seen.has(tool.href) && Boolean(seen.add(tool.href))).map(tool => {
    const base = standard.find(candidate => candidate.label === tool.label && !candidate.premium);
    return base && base.href !== tool.href
      ? `${tool.label}: Standard ${base.href}; Premium ${tool.href}`
      : `${tool.label}: ${tool.href}${base ? "" : " (Premium)"}`;
  });
  const start = ARTICLES.find(({ article }) => article.id === "demarrer-express")?.article;
  rows.push(...(start?.links ?? []).map(link => `${gps(link.label)}: ${currentDestination(link.href)}`));
  return `Repères des outils (aide actuelle) :\n${rows.join("\n")}`;
}

function articleText(article: GpsArticleSource, heading = "Aide"): string {
  const text = [
    `${heading} — ${gps(article.title)}`,
    gps(article.intro),
    ...article.steps.slice(0, 4).map((key, index) => `${index + 1}. ${gps(key)}`),
    ...(article.checks ?? []).slice(0, 2).map(gps),
    ...(article.links ?? []).slice(0, 2).map(link => `${gps(link.label)}: ${currentDestination(link.href)}`),
  ].join("\n");
  return text.length <= 1_000 ? text : `${text.slice(0, 997)}…`;
}

function facebookHelp(): string {
  // These are the same translation keys, in the same order, as DashboardHelpModals.
  return [
    "Connexion Facebook — aide du canal :",
    shell("pour_connecter_facebook_a_inrcy_utilisez_930a6ffc", "compte_facebook_personnel_aa2b9d94", "qui_possede_les_droits_sur_votre_dae928a0", "page_facebook_professionnelle_bc97c28e", "inrcy_ne_publie_pas_sur_votre_418c9a4e"),
    shell("vous_connectez_ce_compte_facebook_a_ef8626a5", "vous_selectionnez_ensuite_la_bonne_14661ff2", "page_professionnelle_9a3b53ce"),
    shell("creer_une_page_professionnelle_dbfc09f4", "ouvrez_facebook_avec_votre_d2e26aa2", "compte_personnel_a017c87e", "allez_dans_7695bb57", "pages_600584c2", "cliquez_sur_487bfa49", "creer_une_page_e1c32b3b", "ajoutez_le_nom_de_l_entreprise_9eb80590"),
    shell("attention_si_votre_page_entreprise_a_46904e09"),
    `Créer une Page : ${DASHBOARD_CHANNEL_CREATE_HREF_BY_KEY.facebook}`,
    `Ouvrir les canaux iNrCy : ${INR_ASSISTANT_CHANNELS_HREF}`,
  ].join("\n");
}

function subscriptionHelp(query: string): string {
  // Public UI labels and navigation from DashboardAccountTabs / StandardSubscriptionContent.
  // No Stripe identifier, balance, renewal date or customer contract is loaded here.
  const lines = [
    "Abonnement — parcours existant dans Mon compte, onglet Abonnement : /dashboard?panel=abonnement.",
    `Comparer les cartes Standard / Premium, choisir ${settingsFrench.subscription_cycle_monthly} ou ${settingsFrench.subscription_cycle_yearly}, puis utiliser l’action proposée (${settingsFrench.subscription_subscribe_premium} ou souscription Standard).`,
    `${settingsFrench.subscription_standard_plus}. Standard : ${settingsFrench.subscription_ai_agents_included.replace("{count}", "3")}; Premium : ${settingsFrench.subscription_ai_agents_included.replace("{count}", "4")}. Les outils marqués Premium dans les repères complètent Standard.`,
    `Pour changer d’offre ou de périodicité : ${settingsFrench.subscription_change_quote_notice} ${settingsFrench.subscription_confirm_change}. Ne jamais annoncer le prorata ni la date personnelle sans les données vérifiées.`,
  ];
  if (/tarif|prix|cout|combien|offre|forfait|compar|mensuel|annuel|price|cost/.test(query)) {
    lines.push(["Standard", "Premium"].map(name => {
      const offer = currentSubscriptionOffer(name as "Standard" | "Premium");
      return `${name} : ${subscriptionChargeLabel("monthly", offer)} ou ${subscriptionChargeLabel("yearly", offer)}`;
    }).join("; "));
    lines.push("Ces tarifs sont le catalogue des nouvelles souscriptions web. Les contrats historiques et les prix Apple/Google peuvent différer ; le prix et les taxes présentés au paiement font foi.");
  }
  if (/factur|invoice|recu|receipt/.test(query)) {
    lines.push(`Factures d’abonnement : Mon compte > Factures, /dashboard?panel=factures. ${settingsFrench.factures_stripe_abonnement_description_5a1c9e32} Actions ${settingsFrench.facture_stripe_voir_7a1d5c30} et ${settingsFrench.facture_stripe_pdf_3e8b2a61} lorsqu’elles sont disponibles. Ce sont les factures d’abonnement, distinctes des factures clients d’Encaisser.`);
  }
  if (/resili|arreter|annul|cancel|stop|prelev/.test(query)) {
    lines.push(`Dans la gestion de Mon abonnement : utiliser « ${settingsFrench.programmer_ma_resiliation_d074ca2d} » si l’action est proposée, sinon « ${settingsFrench.gerer_ma_facturation_dc5027ac} ». Si une résiliation est déjà programmée, « ${settingsFrench.annuler_ma_resiliation_902e43a0} » est proposé selon le contrat.`);
    lines.push("Règle des abonnements web Stripe : l’essai s’arrête à son échéance sans débit ; un mensuel actif garde un renouvellement complet pour le mois de préavis ; un annuel s’arrête à son échéance sans nouvelle année facturée. Vérifier la confirmation et la date affichées dans le compte. L’assistant ne résilie rien dans cette conversation.");
  }
  lines.push("Pour un abonnement acheté dans l’application iPhone/Android, Gérer ma facturation ouvre sa gestion App Store ou Google Play. Utiliser le parcours et le prix du store ; ne pas diriger son annulation vers Stripe.");
  return lines.join("\n");
}

function currentGoalHelp(query: string): string {
  const candidates = [
    ["media", /image|video|visuel|studio|media|retouch/],
    ["stats", /statist|\bstats\b|impression|resultat|evolution|bilan/],
    ["reviews", /\bavis\b|reputation|\breviews?\b/],
    ["grow", /propulser|fidelis|publicite|campagne|prospect/],
    ["contacts", /contacts?|rendez.vous|calendar|agenda|\bcrm\b/],
    ["publish", /publier|publication|\bpost\b|contenu|programm|booster/],
  ] as const;
  const goal = candidates.find(([, pattern]) => pattern.test(query))?.[0];
  if (!goal) return "";
  const source = dashboardFrench.helpCenter.goals[goal];
  const lines = [source.title, source.subtitle, source.intro, ...Object.values(source.steps)];
  if (goal === "media") {
    const details = dashboardFrench.helpCenter.mediaDetails;
    lines.push(details.brief, details.format, details.engine, details.references, details.dna, details.review, details.save);
  }
  return `Guide actuel Aide iNrCy :\n${lines.join("\n")}`;
}

/**
 * Retrieve bounded public product guidance, using the same catalogue as Aide.
 * User text selects snippets only: it is never interpolated into trusted knowledge.
 */
export function getInrAssistantKnowledge(prompt: string): string {
  const query = normalizeHelpSearch(String(prompt || "").slice(0, 12_000));
  const parts = ["Connaissance produit publique iNrCy. Ce document décrit les parcours, pas l’état personnel du compte. Les droits vérifiés par le serveur et les confirmations affichées dans l’application priment. Guider dans les outils ; ne pas prétendre exécuter une action depuis la conversation."];
  const append = (value: string) => {
    const available = INR_ASSISTANT_KNOWLEDGE_MAX_CHARS - parts.join("\n\n").length - 2;
    if (available > 100) parts.push(value.length <= available ? value : `${value.slice(0, available - 1)}…`);
  };
  // Actual bubble controls override old GPS commands and old conversation text.
  const channels = INR_ASSISTANT_ACCOUNT_GUIDES.find(guide => guide.id === "channels-overview");
  if (channels) append(channels.content);
  const channelGuides = INR_ASSISTANT_ACCOUNT_GUIDES.filter(guide => guide.id.startsWith("channel-") && guide.keywords.some(keyword => query.includes(normalizeHelpSearch(keyword))));
  for (const guide of channelGuides.slice(0, 2)) append(guide.content);
  const billing = /abonn|offre|forfait|standard|premium|factur|resili|tarif|paiement|mensuel|annuel|cancel|invoice|subscribe|billing/.test(query);
  if (/facebook|\bfb\b/.test(query)) append(facebookHelp());
  if (billing) append(subscriptionHelp(query));
  const goal = currentGoalHelp(query);
  if (goal) append(goal);
  // A compact map is always present, even when the question uses no known keyword.
  append(toolMap());
  const terms = query.split(/[^\p{L}\p{N}]+/u).filter(term => term.length >= 3 && !STOP_WORDS.has(term));
  const ranked = ARTICLES.filter(({ article, sectionId }) => sectionId !== "canaux" && article.id !== "canaux-threads" && article.id !== "abonnement-express" && article.id !== "inragent-express").map(item => {
    const article = item.article;
    const keywords = normalizeHelpSearch([gps(article.title), ...article.keywords.map(gps)].join(" "));
    const body = normalizeHelpSearch([gps(article.intro), ...article.steps.map(gps)].join(" "));
    const score = terms.reduce((sum, term) => sum + (keywords.includes(term) ? 3 : body.includes(term) ? 1 : 0), 0);
    return { ...item, score };
  }).sort((a, b) => b.score - a.score);
  const selected = ranked.filter(item => item.score > 0).slice(0, billing ? 1 : 2);
  if (!selected.length && !billing) {
    const start = ARTICLES.find(({ article }) => article.id === "demarrer-express");
    if (start) append(articleText(start.article, "Bien démarrer"));
  }
  for (const { article } of selected) {
    append(articleText(article));
    // Only retrieve edition-specific differences when that distinction is asked.
    const standard = STANDARD_ARTICLES.get(article.id);
    if (/standard|premium|offre|forfait/.test(query) && standard && JSON.stringify(standard.steps) !== JSON.stringify(article.steps)) {
      append(articleText(standard, "Adaptation Standard"));
    }
  }
  return parts.join("\n\n");
}
