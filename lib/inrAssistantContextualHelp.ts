import { parseInrAssistantClientContext, type InrAssistantClientScreen } from "./inrAssistantClientContext.ts";

export type InrAssistantContextualHelp = { tool: string; suggestions: readonly string[] };
type HelpKey = "booster" | "studio" | "media" | "stats" | "ads" | "grow" | "loyalty" | "campaigns" | "mail" | "crm" | "calendar" | "dna" | "ai" | "channels" | "account" | "subscription" | "reputation" | "agents" | "agent-publications" | "agent-stats" | "agent-emailing" | "quotes" | "invoices" | "documents" | "shop" | "generator";
type Entry = readonly [tool: string, first: string, second: string, third: string];

// Product names come from reviewed navigation, never arbitrary browser text.
const TOPICS: Readonly<Record<string, HelpKey>> = {
  Booster: "booster", iNrStudio: "studio", "Mes médias": "media", "iNr’Stats": "stats", "iNr’ADS": "ads",
  Propulser: "grow", Fidéliser: "loyalty", "Campagnes mails": "campaigns", "iNr’Send": "mail", Messagerie: "mail",
  "iNr’CRM": "crm", "iNr’Calendar": "calendar", "ADN de l’entreprise": "dna", "Configuration IA": "ai",
  "Mes canaux": "channels", "Mon compte": "account", Préférences: "account", "Infos légales": "account", "Données RGPD": "account", Parrainage: "account",
  "Mon abonnement": "subscription", "Factures d’abonnement": "subscription", Réputation: "reputation",
  "Agents IA": "agents", "Agent Publications": "agent-publications", "Agent Stats": "agent-stats", "Agent Emailings": "agent-emailing",
  "Mes devis": "quotes", "Créer un devis": "quotes", "Mes factures": "invoices", "Créer une facture": "invoices", Documents: "documents",
  Boutique: "shop", "Crédits médias": "shop", "Mon inertie": "shop", "Générateur de visibilité": "generator",
  "Site web": "channels", "Google Business": "channels", Facebook: "channels", Instagram: "channels", Threads: "channels", LinkedIn: "channels", TikTok: "channels", YouTube: "channels", Pinterest: "channels", X: "channels", "iNr’Search": "channels", "iNr’Badge": "channels",
};

const FR: Readonly<Record<HelpKey, Entry>> = {
  booster: ["Booster", "Aidez-moi à préparer une publication.", "Comment programmer ma publication ?", "Comment choisir mes canaux de publication ?"],
  studio: ["iNr’Studio", "Aidez-moi à créer une image pour mon activité.", "Aidez-moi à préparer une vidéo.", "Comment améliorer un média existant ?"],
  media: ["Mes médias", "Comment retrouver un média ?", "Aidez-moi à organiser mes titres et mes tags.", "Comment importer mes fichiers ?"],
  stats: ["iNr’Stats", "Mes impressions ont-elles progressé cette semaine ?", "Aidez-moi à comprendre mes résultats.", "Quels canaux méritent mon attention ?"],
  ads: ["iNr’ADS", "Aidez-moi à préparer une campagne publicitaire.", "Comment choisir mon objectif et mon budget ?", "Comment vérifier l’état de mes campagnes ?"],
  grow: ["Propulser", "Aidez-moi à préparer une campagne pour attirer des clients.", "Aidez-moi à présenter une offre.", "Comment choisir les destinataires de ma campagne ?"],
  loyalty: ["Fidéliser", "Aidez-moi à préparer une campagne pour mes clients.", "Aidez-moi à rédiger un message de suivi.", "Comment préparer une enquête de satisfaction ?"],
  campaigns: ["Campagnes mails", "Quelle campagne convient à mon objectif ?", "Aidez-moi à préparer un brouillon de campagne mail.", "Comment retrouver mes campagnes ?"],
  mail: ["iNr’Send", "Aidez-moi à préparer un brouillon d’email.", "Comment retrouver un message ?", "Aidez-moi à connecter ma messagerie."],
  crm: ["iNr’CRM", "Aidez-moi à ajouter un contact.", "Aidez-moi à modifier une fiche contact.", "Comment retrouver un client ?"],
  calendar: ["iNr’Calendar", "Aidez-moi à préparer un rendez-vous.", "Comment consulter mes prochains rendez-vous ?", "Aidez-moi à modifier un évènement."],
  dna: ["ADN de l’entreprise", "Aidez-moi à compléter l’ADN de mon entreprise.", "Analysez mes canaux pour enrichir mon ADN.", "Aidez-moi à décrire mes prestations."],
  ai: ["Configuration IA", "Aidez-moi à adapter le ton de mes contenus.", "Comment personnaliser mes consignes IA ?", "Aidez-moi à choisir les coordonnées à afficher."],
  channels: ["Mes canaux", "Aidez-moi à connecter un canal.", "Aidez-moi à reconnecter un canal.", "Comment comprendre l’état de mes connexions ?"],
  account: ["Mon compte", "Comment mettre à jour mes informations ?", "Aidez-moi à comprendre mes préférences.", "Comment retrouver mes factures d’abonnement ?"],
  subscription: ["Mon abonnement", "Aidez-moi à comprendre mon abonnement.", "Quelles différences entre Standard et Premium ?", "Comment gérer ou résilier mon abonnement ?"],
  reputation: ["Réputation", "Aidez-moi à comprendre mes avis Google.", "Aidez-moi à préparer une réponse à un avis.", "Comment vérifier ma connexion Google ?"],
  agents: ["Agents IA", "Quel agent peut m’aider dans mon activité ?", "Comment consulter le planning des agents ?", "Aidez-moi à régler mes automatisations."],
  "agent-publications": ["Agent Publications", "Aidez-moi à régler le planning de mes publications.", "Comment choisir les thèmes et les canaux ?", "Comment vérifier les publications préparées ?"],
  "agent-stats": ["Agent Stats", "Aidez-moi à régler la fréquence de mes bilans.", "Comment comprendre mon dernier bilan ?", "Comment consulter le planning de l’Agent Stats ?"],
  "agent-emailing": ["Agent Emailings", "Aidez-moi à préparer une campagne mail.", "Comment régler le planning de mes campagnes ?", "Comment choisir les destinataires et la validation ?"],
  quotes: ["Mes devis", "Aidez-moi à préparer un brouillon de devis.", "Quelles informations faut-il pour mon devis ?", "Comment retrouver ou modifier un devis ?"],
  invoices: ["Mes factures", "Aidez-moi à préparer un brouillon de facture.", "Quelles informations faut-il vérifier avant de finaliser ?", "Comment retrouver mes factures ?"],
  documents: ["Devis et factures", "Comment régler mes devis et mes factures ?", "Aidez-moi à préparer un brouillon de document.", "Que faut-il vérifier avant de finaliser un document ?"],
  shop: ["Boutique", "Aidez-moi à comprendre mes crédits médias.", "Comment consulter mes commandes ?", "À quoi servent mes Unités d’Inertie ?"],
  generator: ["Générateur de visibilité", "Comment comprendre ma puissance d’inertie ?", "Que puis-je améliorer dans mon cockpit ?", "Aidez-moi à choisir ma prochaine étape."],
};

const EN: Readonly<Record<HelpKey, Entry>> = {
  booster: ["Booster", "Help me prepare a post.", "How can I schedule my post?", "How can I choose my publishing channels?"],
  studio: ["iNr’Studio", "Help me create an image for my business.", "Help me prepare a video.", "How can I improve an existing media file?"],
  media: ["My media", "How can I find a media file?", "Help me organise my titles and tags.", "How can I import my files?"],
  stats: ["iNr’Stats", "Have my impressions improved this week?", "Help me understand my results.", "Which channels need my attention?"],
  ads: ["iNr’ADS", "Help me prepare an advertising campaign.", "How can I choose my objective and budget?", "How can I check my campaigns’ status?"],
  grow: ["Propulser", "Help me prepare a campaign to attract customers.", "Help me present an offer.", "How can I choose my campaign’s recipients?"],
  loyalty: ["Fidéliser", "Help me prepare a campaign for my customers.", "Help me write a follow-up message.", "How can I prepare a satisfaction survey?"],
  campaigns: ["Email campaigns", "Which campaign suits my objective?", "Help me prepare an email campaign draft.", "How can I find my campaigns?"],
  mail: ["iNr’Send", "Help me prepare an email draft.", "How can I find a message?", "Help me connect my mailbox."],
  crm: ["iNr’CRM", "Help me add a contact.", "Help me edit a contact record.", "How can I find a customer?"],
  calendar: ["iNr’Calendar", "Help me prepare an appointment.", "How can I view my upcoming appointments?", "Help me edit an event."],
  dna: ["Business profile", "Help me complete my business profile.", "Analyse my channels to enrich my business profile.", "Help me describe my services."],
  ai: ["AI settings", "Help me adjust the tone of my content.", "How can I customise my AI instructions?", "Help me choose which contact details to display."],
  channels: ["My channels", "Help me connect a channel.", "Help me reconnect a channel.", "How can I understand my connection statuses?"],
  account: ["My account", "How can I update my information?", "Help me understand my preferences.", "How can I find my subscription invoices?"],
  subscription: ["My subscription", "Help me understand my subscription.", "How do Standard and Premium differ?", "How can I manage or cancel my subscription?"],
  reputation: ["Reputation", "Help me understand my Google reviews.", "Help me prepare a reply to a review.", "How can I check my Google connection?"],
  agents: ["AI agents", "Which agent can help my business?", "How can I view the agents’ schedule?", "Help me adjust my automations."],
  "agent-publications": ["Publications Agent", "Help me adjust my publishing schedule.", "How can I choose topics and channels?", "How can I review prepared posts?"],
  "agent-stats": ["Stats Agent", "Help me adjust how often I receive reports.", "How can I understand my latest report?", "How can I view the Stats Agent’s schedule?"],
  "agent-emailing": ["Emailings Agent", "Help me prepare an email campaign.", "How can I adjust my campaign schedule?", "How can I choose recipients and approval settings?"],
  quotes: ["My quotes", "Help me prepare a quote draft.", "What information do I need for my quote?", "How can I find or edit a quote?"],
  invoices: ["My invoices", "Help me prepare an invoice draft.", "What should I check before finalising it?", "How can I find my invoices?"],
  documents: ["Quotes and invoices", "How can I adjust my quote and invoice settings?", "Help me prepare a document draft.", "What should I check before finalising a document?"],
  shop: ["Shop", "Help me understand my media credits.", "How can I view my orders?", "What are my Inertia Units used for?"],
  generator: ["Visibility generator", "How can I understand my inertia power?", "What can I improve in my cockpit?", "Help me choose my next step."],
};

/** UI suggestions only: opening a tool never invokes a model or business action. */
export function getInrAssistantContextualHelp(screen: InrAssistantClientScreen | undefined, locale: string): InrAssistantContextualHelp | null {
  if (!screen || typeof locale !== "string") return null;
  const language = locale.trim().toLowerCase().replaceAll("_", "-").split("-")[0];
  const catalogue = language === "fr" ? FR : language === "en" ? EN : null;
  if (!catalogue) return null; // Other locales keep their existing translated suggestions.
  const verified = parseInrAssistantClientContext({ screen })?.screen;
  const topic = verified && TOPICS[verified.tool];
  if (!topic) return null;
  const [tool, ...suggestions] = catalogue[topic];
  return { tool, suggestions };
}
