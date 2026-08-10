import type { DashboardEdition } from "@/lib/dashboardEdition";

import { GPS_SECTIONS, type GpsArticle, type GpsSection } from "./noticeContent";

const PREMIUM_ONLY_SECTION_IDS = new Set([
  "propulser",
  "fideliser",
  "crm",
  "agenda",
  "documents",
]);

type GpsArticleOverride = Partial<Omit<GpsArticle, "id">>;

const STANDARD_SECTION_DESCRIPTIONS: Record<string, string> = {
  canaux: "Relier les 10 destinations de publication Standard et configurer iNr’Badge, inclus en bonus.",
  inragent: "Programmer les publications Booster et recevoir les bilans automatiques iNrStats.",
  inrsend: "Retrouver l’historique et le résultat de toutes les publications Booster.",
};

const STANDARD_ARTICLE_OVERRIDES: Record<string, GpsArticleOverride> = {
  "demarrer-express": {
    intro:
      "Avant de publier ou d’analyser les résultats, iNrCy doit connaître l’entreprise. Sans Mon activité, Mon profil et Configuration IA, les contenus restent trop généraux.",
    pitfalls: [
      "Donner les bonnes informations à l’IA avant de lui demander de publier ou d’analyser les résultats.",
      "Une IA bien configurée produit des contenus beaucoup plus naturels, locaux et efficaces.",
    ],
  },
  "demarrer-rangement": {
    intro:
      "Chaque donnée a un seul emplacement : les coordonnées dans Mon profil, le métier dans Mon activité et les paramètres de communication dans le Générateur.",
    steps: [
      "Utiliser **Mon profil** pour l’identité, les coordonnées, l’entreprise, la ville et le logo.",
      "Utiliser **Mon activité** pour le métier, les prestations, zones, forces, clientèle et horaires publics.",
      "Ouvrir **Réglages du générateur** pour le panier moyen et le taux de transformation.",
    ],
    checks: [
      "Les informations déjà enregistrées sont conservées lors de cette organisation.",
      "Les horaires publics de Mon activité décrivent correctement l’entreprise.",
      "Les informations indispensables à Booster et iNrStats sont complètes.",
    ],
    links: [
      { label: "Mon profil", href: "/dashboard?panel=profil&panelSource=gps" },
      { label: "Mon activité", href: "/dashboard?panel=activite&panelSource=gps" },
    ],
  },
  "canaux-express": {
    intro:
      "L’édition Standard réunit 10 destinations de publication et iNr’Badge en bonus. Les bulles servent à configurer, reconnecter et contrôler chaque canal avant de publier.",
    steps: [
      "Ouvrir **Les canaux**, choisir la bulle concernée, puis cliquer sur **Configurer**.",
      "Relier les destinations utiles : Site iNrCy, Site web, Google Business, iNr’Search, Facebook, Instagram, LinkedIn, TikTok, YouTube et Pinterest.",
      "Configurer **iNr’Badge**, inclus en bonus, pour partager la fiche et le QR Code de l’entreprise.",
      "Vérifier l’état de chaque bulle avant de lancer une publication Booster.",
    ],
    pitfalls: [
      "Commencer par les canaux sur lesquels les clients sont réellement présents.",
      "Un canal expiré doit être reconnecté avant de redevenir sélectionnable dans Booster.",
    ],
  },
  "inragent-express": {
    intro:
      "Avec Standard, iNr’Agent accompagne deux parcours : programmer les publications Booster et préparer les bilans automatiques iNrStats.",
    steps: [
      "Ouvrir **iNr’Agent** depuis le header du dashboard.",
      "Choisir **Publications** pour préparer ou programmer une publication Booster.",
      "Choisir **Statistiques** pour préparer un bilan iNrStats.",
      "Relire l’aperçu, puis **valider** ou **refuser** l’action avant son exécution.",
    ],
    checks: [
      "Votre activité, votre profil et votre Configuration IA sont bien renseignés.",
      "Les canaux utiles à Booster sont réellement connectés.",
      "Rien n’est publié ou envoyé sans votre validation.",
      "Les rubriques Propulser et Fidéliser nécessitent le forfait Premium.",
    ],
    pitfalls: [
      "iNr’Agent ne remplace pas votre décision : il prépare, propose et accélère.",
      "Plus vos informations et vos canaux sont complets, plus ses propositions sont utiles.",
      "Objectif : garder une publication régulière et recevoir des bilans faciles à lire.",
    ],
  },
  "generateur-express": {
    pitfalls: [
      "Le Générateur n’est pas un tableau technique : c’est le compteur global de la communication.",
      "Plus le pro publie et utilise les outils Standard, plus ses Unités d’Inertie progressent.",
      "Les Unités d’Inertie sont aussi utiles pour accéder à des avantages dans la Boutique.",
    ],
  },
  "inrstats-express": {
    intro:
      "iNrStats traduit les données des canaux Standard en lecture business simple : appels, clics, visites, formulaires, demandes et interactions utiles.",
    steps: [
      "Connecter les canaux utiles pour laisser iNrCy récupérer les données disponibles.",
      "Lire les résultats par canal : Google Business, sites, Facebook, Instagram, LinkedIn, TikTok, YouTube, Pinterest ou iNr’Badge selon les connexions.",
      "Repérer ce qui fonctionne : appels, clics, itinéraires, visites, formulaires et interactions.",
      "Utiliser ensuite **Booster** ou demander un bilan à **iNr’Agent**.",
    ],
    links: [
      { label: "Ouvrir iNrStats", href: "/dashboard/stats" },
      { label: "Ouvrir les canaux", href: "/dashboard" },
      { label: "Ouvrir Booster", href: "/dashboard?action=publish" },
    ],
  },
  "booster-express": {
    steps: [
      "Cliquer sur **Publier maintenant** pour ouvrir directement l’outil de publication.",
      "Préparer un contenu : chantier, nouveauté, conseil, photo, actualité ou preuve terrain.",
      "Choisir parmi les 10 destinations Standard réellement connectées.",
      "Vérifier le texte, le média, le ton et l’appel à l’action avant l’envoi.",
      "Consulter ensuite le **Bilan Booster** pour suivre la régularité et les canaux utilisés.",
    ],
  },
  "booster-bilan": {
    links: [
      { label: "Ouvrir Booster", href: "/dashboard?action=publish" },
      { label: "Voir les publications", href: "/dashboard/mails?folder=publications&boxView=sent" },
    ],
  },
  "inrsend-express": {
    title: "Retrouver toutes les publications",
    keywords: ["inrsend", "publications", "historique", "booster", "résultat", "canaux", "réutiliser"],
    goal: "Publications retrouvées",
    intro:
      "Avec Standard, iNr’Send conserve la colonne Publications : contenus Booster, résultat par canal, liens publics et détails utiles.",
    steps: [
      "Ouvrir **iNr’Send** depuis la Boîte de pilotage.",
      "Consulter la colonne **Publications** pour retrouver chaque envoi Booster.",
      "Ouvrir le détail pour distinguer les canaux publiés, en traitement ou en échec.",
      "Réutiliser une publication existante lorsque son contenu reste pertinent.",
    ],
    checks: [
      "La publication apparaît bien dans l’historique.",
      "Les détails indiquent les réussites, erreurs ou traitements en cours.",
      "Les liens publics sont proposés lorsque la plateforme les transmet.",
    ],
    pitfalls: [
      "En Standard, iNr’Send est volontairement limité aux Publications.",
      "Les campagnes mails et leurs autres colonnes sont disponibles avec Premium.",
    ],
    links: [
      { label: "Voir les publications", href: "/dashboard/mails?folder=publications&boxView=sent" },
    ],
  },
  "abonnement-express": {
    intro:
      "La période d’essai et les nouveaux comptes démarrent en Standard. Le passage à Premium se fait après un échange avec l’équipe iNrCy.",
    steps: [
      "Utiliser la période d’essai pour configurer les canaux et tester Booster.",
      "Consulter Mon abonnement pour vérifier l’édition et l’état de l’accès.",
      "Continuer avec Standard ou contacter l’équipe iNrCy pour étudier Premium.",
      "Aucun passage à Premium ne se fait automatiquement depuis l’application.",
    ],
  },
  "problemes-express": {
    steps: [
      "Pas de données : vérifier qu’au moins un canal utile est connecté et attendre la prochaine mise à jour.",
      "Publication refusée : ouvrir le détail du canal, corriger la cause puis relancer.",
      "Canal indisponible : reconnecter le compte avant de le sélectionner dans Booster.",
      "Image non visible : réduire le poids, adapter le format, puis réessayer.",
    ],
  },
  "problemes-mobile-reseau": {
    links: [
      { label: "Voir les publications", href: "/dashboard/mails?folder=publications&boxView=sent" },
    ],
  },
  "conseils-express": {
    steps: [
      "Publier une fois par semaine une preuve d’activité : chantier, conseil, photo, offre ou actualité.",
      "Piloter les avis depuis **Réputation** et demander un retour aux clients satisfaits.",
      "Mettre à jour les informations visibles dès qu’un horaire, numéro ou service change.",
      "Lire régulièrement iNrStats et le Bilan Booster pour ajuster les prochaines publications.",
    ],
    links: [
      { label: "Ouvrir Booster", href: "/dashboard?action=publish" },
      { label: "Gérer les avis", href: "/dashboard/e-reputation" },
      { label: "Ouvrir iNrStats", href: "/dashboard/stats" },
    ],
  },
};

export function isGpsSectionPremiumOnly(sectionId: string): boolean {
  return PREMIUM_ONLY_SECTION_IDS.has(sectionId);
}

function applyStandardArticleOverride(article: GpsArticle): GpsArticle {
  const override = STANDARD_ARTICLE_OVERRIDES[article.id];
  return override ? { ...article, ...override } : article;
}

export function getGpsSectionsForEdition(edition: DashboardEdition): GpsSection[] {
  if (edition !== "standard") return GPS_SECTIONS;

  return GPS_SECTIONS.map((section) => ({
    ...section,
    description: STANDARD_SECTION_DESCRIPTIONS[section.id] ?? section.description,
    articles: section.articles.map(applyStandardArticleOverride),
  }));
}
