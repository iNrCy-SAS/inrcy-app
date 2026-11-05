/** Public navigation shared by the interface, help and assistant.
 * These destinations describe where an action lives; they never grant access
 * or claim that opening an editor has completed the action. */
export const PRODUCT_CHANNELS_HREF = "/dashboard?action=channels";
export const PRODUCT_PERSONALIZATION_HREF = "/dashboard/personnalisation";
export const PRODUCT_GOOGLE_REVIEWS_HREF = "/dashboard?panel=gmb&googleReviews=1";

export type ProductNavigation = {
  id: string;
  label: string;
  href: string;
  steps: readonly string[];
  keywords: readonly string[];
  sourceFiles: readonly string[];
  conditions?: string;
};

export const PRODUCT_NAVIGATION = [
  { id: "channels", label: "Mes canaux", href: PRODUCT_CHANNELS_HREF,
    steps: ["Accueil", "Connecter mes canaux", "bulle du canal"],
    keywords: ["canaux", "canal", "connexion", "connecter", "reconnecter", "channels", "connect"],
    sourceFiles: ["app/dashboard/_components/DashboardChannelWorkspace.tsx", "app/dashboard/_components/DashboardChannelsModal.tsx"],
    conditions: "Utilisez Connecter ou Reconnecter seulement si le bouton est proposé. Si le canal est déjà connecté, conservez sa connexion et sélectionnez sa fiche/page si nécessaire." },
  { id: "personalization", label: "Personnaliser mon application", href: PRODUCT_PERSONALIZATION_HREF,
    steps: ["Accueil", "Personnaliser mon application"],
    keywords: ["personnalisation", "personnaliser", "personalization", "customize"],
    sourceFiles: ["app/dashboard/personnalisation/page.tsx"],
    conditions: "Choisissez Analyse, Mon entreprise ou Ma communication selon les informations à préparer. Vérifiez le statut d’enregistrement automatique." },
  { id: "reviews", label: "Avis Google", href: PRODUCT_GOOGLE_REVIEWS_HREF,
    steps: ["Accueil", "Connecter mes canaux", "Google Business", "Avis"],
    keywords: ["avis", "réputation", "reputation", "google reviews", "review", "étoiles", "rating"],
    sourceFiles: ["app/dashboard/_components/DashboardChannelWorkspace.tsx", "app/dashboard/e-reputation/page.tsx", "app/dashboard/e-reputation/EReputationReviewsClient.tsx"],
    conditions: "Le bouton Avis se trouve dans la bulle Google Business, après connexion et sélection de la fiche. Si le bouton manque, vérifiez cette sélection." },
  { id: "publish", label: "Booster", href: "/dashboard?action=publish",
    steps: ["Accueil", "Booster", "Publier"], keywords: ["booster", "publier", "publication", "publish", "post"],
    sourceFiles: ["app/dashboard/_components/DashboardModulesCard.tsx"],
    conditions: "La publication manuelle suit les droits natifs du compte ; l’ouverture de Booster ne publie ni ne programme rien." },
  { id: "studio", label: "iNr’Studio", href: "/dashboard/generer-media",
    steps: ["Accueil", "iNr’Studio"], keywords: ["studio", "image", "vidéo", "video", "générer", "generate"],
    sourceFiles: ["app/dashboard/generer-media/page.tsx", "lib/dashboardEdition.ts"],
    conditions: "Basique, Standard et Premium ont accès aux outils manuels inclus. Une génération IA exige les crédits et un moteur disponibles dans le compte ; une recharge ne débloque pas les outils Premium ni les agents." },
  { id: "media", label: "Médiathèque", href: "/dashboard/mediatheque",
    steps: ["Accueil", "Médiathèque"], keywords: ["médiathèque", "mediatheque", "mes médias", "bibliothèque", "media library"],
    sourceFiles: ["app/dashboard/mediatheque/page.tsx", "lib/dashboardEdition.ts"],
    conditions: "Basique, Standard et Premium ont accès à la médiathèque du seul établissement actif. Importer et télécharger ne lancent pas de génération IA." },
  { id: "stats", label: "iNr’Stats", href: "/dashboard/stats",
    steps: ["Accueil", "iNr’Stats"], keywords: ["stats", "statistiques", "résultats", "statistics", "impressions"],
    sourceFiles: ["app/dashboard/stats/StatsClient.tsx", "lib/dashboardEdition.ts"],
    conditions: "Basique inclut la consultation des statistiques manuelles disponibles. Standard ajoute l’agent et la génération/envoi du bilan selon les droits natifs. Une donnée indisponible n’est pas zéro." },
  { id: "send", label: "iNr’Send", href: "/dashboard/mails",
    steps: ["Accueil", "iNr’Send"], keywords: ["send", "historique", "messagerie", "mails", "mailbox", "history"],
    sourceFiles: ["app/dashboard/mails/MailboxClient.tsx", "lib/dashboardEdition.ts"],
    conditions: "L’historique des publications manuelles reste distinct de la messagerie et des campagnes Premium. Les dossiers et actions visibles dépendent des droits du compte." },
  { id: "crm", label: "iNr’CRM", href: "/dashboard/crm",
    steps: ["Accueil", "Outils Premium", "iNr’CRM"], keywords: ["crm", "contacts", "clients", "prospects"],
    sourceFiles: ["app/dashboard/crm/CRMClient.tsx", "lib/dashboardEdition.ts"], conditions: "Accès Premium requis ; Basique et Standard, essai Standard compris, ne débloquent pas le CRM." },
  { id: "calendar", label: "iNr’Calendar", href: "/dashboard/agenda",
    steps: ["Accueil", "Outils Premium", "iNr’Calendar"], keywords: ["calendar", "agenda", "calendrier", "rendez-vous", "appointment"],
    sourceFiles: ["app/dashboard/agenda/AgendaClient.tsx", "lib/dashboardEdition.ts"], conditions: "Accès Premium requis. Ouvrir l’agenda ou un brouillon ne confirme aucun rendez-vous." },
  { id: "campaigns", label: "Campagnes mails", href: "/dashboard?action=campaigns",
    steps: ["Accueil", "Outils Premium", "Campagnes mails"], keywords: ["campagnes", "emailing", "propulser", "fidéliser", "campaigns"],
    sourceFiles: ["app/dashboard/_components/DashboardModulesCard.tsx", "lib/dashboardEdition.ts"], conditions: "Accès Premium requis. Choisissez Propulser ou Fidéliser ; préparer ou ouvrir une campagne ne l’envoie pas." },
  { id: "ads", label: "iNr’ADS", href: "/dashboard/ads",
    steps: ["Accueil", "Outils Premium", "iNr’ADS"], keywords: ["ads", "publicité", "publicitaire", "advertising"],
    sourceFiles: ["app/dashboard/ads/page.tsx", "lib/dashboardEdition.ts"], conditions: "Accès Premium et autorisations du canal requis. Lancer une publicité exige la validation native de sa campagne et de son budget." },
  { id: "account", label: "Mon compte", href: "/dashboard?panel=compte&panelSource=settings",
    steps: ["Accueil", "Mon compte"], keywords: ["compte", "account", "préférences", "preferences"],
    sourceFiles: ["app/dashboard/_components/DashboardAccountTabs.tsx", "app/dashboard/settings/_components/AccountContent.tsx"] },
  { id: "subscription", label: "Mon abonnement", href: "/dashboard?panel=abonnement",
    steps: ["Mon compte", "Mon abonnement"], keywords: ["abonnement", "offre", "forfait", "résilier", "subscription", "billing", "plan"],
    sourceFiles: ["app/dashboard/settings/_components/SubscriptionWorkspace.tsx"], conditions: "Vérifiez le contrat et le récapitulatif affichés. Un abonnement acheté sur iPhone/Android se gère dans l’App Store ou Google Play ; l’assistant ne paie ni ne résilie à la simple ouverture." },
  { id: "subscription-invoices", label: "Factures d’abonnement", href: "/dashboard?panel=factures",
    steps: ["Mon compte", "Factures"], keywords: ["factures abonnement", "facture stripe", "subscription invoices", "reçu abonnement"],
    sourceFiles: ["app/dashboard/settings/_components/SubscriptionInvoicesPanel.tsx"], conditions: "Ces factures concernent l’abonnement iNrCy, pas les factures à envoyer aux clients." },
  { id: "business-dna", label: "Mon entreprise", href: "/dashboard/personnalisation?section=company",
    steps: ["Accueil", "Personnaliser mon application", "Mon entreprise"], keywords: ["adn", "entreprise", "coordonnées", "logo", "business profile"],
    sourceFiles: ["app/dashboard/personnalisation/page.tsx"], conditions: "L’onglet Analyse sert à analyser les sources ; Mon entreprise permet de corriger les informations enregistrées." },
  { id: "ai-configuration", label: "Ma communication", href: "/dashboard/personnalisation?section=communication",
    steps: ["Accueil", "Personnaliser mon application", "Ma communication"], keywords: ["configuration ia", "consignes", "interdictions", "ton", "cta", "ai settings"],
    sourceFiles: ["app/dashboard/personnalisation/page.tsx"], conditions: "Ces réglages concernent les futurs contenus ; ils ne modifient pas automatiquement les anciennes publications." },
  { id: "invoices", label: "Créer une facture", href: "/dashboard/factures/new",
    steps: ["Accueil", "Encaisser", "Créer une facture"], keywords: ["facture client", "facturer", "encaisser", "customer invoice"],
    sourceFiles: ["app/dashboard/factures/new/page.tsx", "lib/dashboardEdition.ts"], conditions: "Droits comptables spécifiques requis ; Premium seul ne débloque pas Encaisser. Sauvegarder, figer et envoyer sont des étapes distinctes." },
  { id: "invoices-list", label: "Mes factures", href: "/dashboard/factures",
    steps: ["Mes factures"], keywords: ["mes factures", "factures clients", "factures enregistrées", "liste factures", "customer invoices"],
    sourceFiles: ["app/dashboard/factures/page.tsx", "app/dashboard/factures/ListPage.tsx", "lib/dashboardEdition.ts"],
    conditions: "Ce lien ouvre directement la liste des factures clients existantes. Droits comptables spécifiques requis ; Premium seul ne les débloque pas. Les factures d’abonnement se trouvent dans Mon compte → Factures." },
  { id: "quotes", label: "Créer un devis", href: "/dashboard/devis/new",
    steps: ["Accueil", "Encaisser", "Créer un devis"], keywords: ["devis", "deviser", "quote", "estimate"],
    sourceFiles: ["app/dashboard/devis/new/page.tsx", "lib/dashboardEdition.ts"], conditions: "Droits comptables spécifiques requis ; Premium seul ne débloque pas Encaisser. Préparer un devis ne signifie ni acceptation ni envoi." },
  { id: "quotes-list", label: "Mes devis", href: "/dashboard/devis",
    steps: ["Mes devis"], keywords: ["mes devis", "devis enregistrés", "liste devis", "existing quotes"],
    sourceFiles: ["app/dashboard/devis/page.tsx", "app/dashboard/factures/ListPage.tsx", "lib/dashboardEdition.ts"],
    conditions: "Ce lien ouvre directement la liste des devis clients existants. Droits comptables spécifiques requis ; Premium seul ne les débloque pas. Ouvrir un devis ne l’envoie ni ne l’accepte." },
] as const satisfies readonly ProductNavigation[];

export type ProductNavigationId = typeof PRODUCT_NAVIGATION[number]["id"];

export function getProductNavigation(id: string): ProductNavigation | undefined {
  return PRODUCT_NAVIGATION.find(entry => entry.id === id);
}

export function productNavigationSummary(id: ProductNavigationId, includeConditions = true): string {
  const entry = getProductNavigation(id)!;
  return `Accès actuel : ${entry.steps.join(" → ")}. [${entry.label}](${entry.href}).${includeConditions && entry.conditions ? ` ${entry.conditions}` : ""}`;
}

export function productNavigationReply(id: ProductNavigationId): string {
  const entry = getProductNavigation(id)!;
  return `**${entry.steps.join(" → ")}**.\n\n[${entry.label}](${entry.href})${entry.conditions ? `\n\n${entry.conditions}` : ""}`;
}
