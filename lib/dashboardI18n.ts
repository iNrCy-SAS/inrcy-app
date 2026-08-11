import type { AppLanguageCode } from "@/lib/appLanguage";
import type { ModuleStatus } from "@/app/dashboard/dashboard.types";

export type DashboardCopy = {
  locale: string;
  topbar: {
    brandTag: string;
    admin: string;
    adminTitle: string;
    notifications: string;
    openNotifications: string;
    inrAgentOpen: string;
    inrAgentDisabled: string;
    inrAgentAction: string;
    inrAgentActions: string;
    inrAgentPending: string;
    gps: string;
    gpsAria: string;
    contact: string;
    openMenu: string;
    menu: string;
  };
  language: {
    buttonAria: string;
    buttonTitle: string;
    panelAria: string;
  };
  userMenu: {
    title: string;
    label: string;
    profileIncomplete: string;
    activityIncomplete: string;
    completeProfileHint: string;
    completeActivityHint: string;
    account: string;
    profile: string;
    activity: string;
    preferences: string;
    ai: string;
    media: string;
    notifications: string;
    subscription: string;
    inertia: string;
    shop: string;
    referral: string;
    legal: string;
    rgpd: string;
    logout: string;
  };
  notifications: {
    aria: string;
    title: string;
    subtitle: string;
    settings: string;
    markAllRead: string;
    markAllReadConfirmTitle: string;
    markAllReadConfirmMessage: string;
    markAllReadConfirmCancel: string;
    loading: string;
    empty: string;
    delete: string;
    markRead: string;
  };
  drawer: {
    close: string;
    titles: Record<string, string>;
  };
  hero: {
    powerDialogAria: string;
    powerPanelTitle: string;
    kicker: string;
    title: string;
    subtitle: string;
    flowContacts: string;
    flowQuotes: string;
    flowRevenue: string;
    powerTitle: string;
    powerDetailsAria: string;
    powerDetailsTitle: string;
    fullPower: string;
    stepSingular: string;
    stepPlural: string;
    remainingSingular: string;
    remainingPlural: string;
    progressAria: string;
    nextRise: string;
    completeHint: string;
    generatorTitle: string;
    generatorHelpTitle: string;
    generatorDesc: string;
    refreshAria: string;
    refreshTitle: string;
    active: string;
    waiting: string;
    inertiaUnits: string;
    channels: string;
    potentialRevenue: string;
    basedOnProfile: string;
    opportunities: string;
    projection30: string;
    capturedLeads: string;
    last7: string;
    last30: string;
  };
  generatorSteps: Record<string, { label: string; shortLabel: string }>;
  channels: {
    title: string;
    helpTitle: string;
    connected: string;
    available: string;
    displayAria: string;
    list: string;
    carousel: string;
    railAria: string;
    positionAria: string;
    prev: string;
    next: string;
    goToChannel: string;
    showChannel: string;
    connectedAria: string;
  };
  modules: {
    requiredSetupLocked: string;
    dashboardTitle: string;
    dashboardSub: string;
    statsSub: string;
    mailsSettingsAria: string;
    mailsSub: string;
    agendaSettingsAria: string;
    agendaSub: string;
    crmSub: string;
    gearboxTitle: string;
    gearboxSub: string;
    boosterStatsTitle: string;
    boosterSub: string;
    publishTitle: string;
    publishCta: string;
    propulserTitle: string;
    propulserSub: string;
    propulserCta: string;
    fideliserTitle: string;
    fideliserSub: string;
    fideliserCta: string;
    cashSettingsTitle: string;
    cashTitle: string;
    cashSub: string;
    cashCta: string;
    reputationTitle: string;
    reputationSub: string;
    reputationCta: string;
    cashModalTitle: string;
    cashModalLabel: string;
    cashModalSettings: string;
    cashModalIntroStrong: string;
    cashModalIntroText: string;
    invoiceEyebrow: string;
    invoiceTitle: string;
    invoiceText: string;
    invoiceCta: string;
    quoteEyebrow: string;
    quoteTitle: string;
    quoteText: string;
    quoteCta: string;
  };
  moduleCards: Record<string, {
    name: string;
    description: string;
    view?: string;
    connect?: string;
    disabledTitle?: string;
    siteOnlyTitle?: string;
  }>;
  bubble: {
    viewFallback: string;
    configure: string;
    disabled: string;
  };
  status: Record<string, string>;
};

const drawerTitlesFr = {
  contact: "Nous contacter",
  compte: "Compte iNrCytizen",
  profil: "Mon profil",
  preferences: "Préférences générales",
  inrbadge: "Réglages iNr'Badge",
  activite: "Mon activité",
  ia: "Configuration IA",
  abonnement: "Mon abonnement",
  legal: "Informations légales",
  rgpd: "Mes données (RGPD)",
  mails: "Réglages Mails",
  agenda: "Réglages iNr’Calendar",
  site_inrcy: "Configuration — Site iNrCy",
  site_web: "Configuration — Site web",
  instagram: "Configuration — Instagram",
  linkedin: "Configuration — LinkedIn",
  gmb: "Configuration — Google Business",
  inr_search: "Configuration — iNr'Search",
  facebook: "Configuration — Facebook",
  tiktok: "Configuration — TikTok",
  youtube_shorts: "Configuration — YouTube",
  pinterest: "Configuration — Pinterest",
  inertie: "Mon inertie",
  boutique: "Boutique",
  parrainage: "Parrainer avec iNrCy",
  notifications: "Notifications",
  documents: "Réglages par défaut",
};

const fr: DashboardCopy = {
  locale: "fr-FR",
  topbar: {
    brandTag: "Générateur de business",
    admin: "Admin",
    adminTitle: "Administration iNrCy",
    notifications: "Notifications",
    openNotifications: "Ouvrir les notifications",
    inrAgentOpen: "Ouvrir iNr'Agent",
    inrAgentDisabled: "iNr'Agent est désactivé dans les accès du compte",
    inrAgentAction: "action",
    inrAgentActions: "actions",
    inrAgentPending: "à valider",
    gps: "GPS d’utilisation",
    gpsAria: "Ouvrir le GPS d’utilisation",
    contact: "Nous contacter",
    openMenu: "Ouvrir le menu",
    menu: "Menu",
  },
  language: {
    buttonAria: "Changer la langue de l'application",
    buttonTitle: "Langue de l'application",
    panelAria: "Choisir la langue de l'application",
  },
  userMenu: {
    title: "Menu utilisateur",
    label: "Menu",
    profileIncomplete: "Profil incomplet",
    activityIncomplete: "Activité incomplète",
    completeProfileHint: "Cliquez pour compléter votre profil et activer pleinement iNrCy.",
    completeActivityHint: "Cliquez pour compléter votre activité et activer pleinement iNrCy.",
    account: "Compte iNrCytizen",
    profile: "Mon profil",
    activity: "Mon activité",
    preferences: "Préférences générales",
    ai: "Configuration IA",
    media: "Médiathèque",
    notifications: "Notifications",
    subscription: "Mon abonnement",
    inertia: "Mon inertie",
    shop: "Boutique",
    referral: "Parrainer avec iNrCy",
    legal: "Informations légales",
    rgpd: "Mes données (RGPD)",
    logout: "Déconnexion",
  },
  notifications: {
    aria: "Notifications",
    title: "Actions à mener",
    subtitle: "Votre cockpit vous relance au bon moment.",
    settings: "Réglages",
    markAllRead: "Tout lire",
    markAllReadConfirmTitle: "Marquer toutes les notifications comme lues ?",
    markAllReadConfirmMessage: "Elles seront ensuite supprimées définitivement.",
    markAllReadConfirmCancel: "Annuler",
    loading: "Chargement des notifications…",
    empty: "Votre cloche est vide pour l’instant. Les prochaines relances business arriveront ici.",
    delete: "Supprimer la notification",
    markRead: "Marquer comme lu",
  },
  drawer: {
    close: "Fermer",
    titles: drawerTitlesFr,
  },
  hero: {
    powerDialogAria: "Détail de la puissance du générateur",
    powerPanelTitle: "Détail puissance",
    kicker: "Votre cockpit iNrCy",
    title: "Le Générateur est lancé\u00a0!",
    subtitle: "Tous vos canaux alimentent maintenant une seule et même machine.",
    flowContacts: "Publications",
    flowQuotes: "Visibilité",
    flowRevenue: "Résultats",
    powerTitle: "Puissance du générateur :",
    powerDetailsAria: "Voir le détail de la puissance du générateur",
    powerDetailsTitle: "Voir le détail",
    fullPower: "Pleine puissance",
    stepSingular: "étape",
    stepPlural: "étapes",
    remainingSingular: "restante",
    remainingPlural: "restantes",
    progressAria: "Puissance du générateur",
    nextRise: "Prochaine montée :",
    completeHint: "Tous vos leviers alimentent la machine à pleine puissance.",
    generatorTitle: "Générateur iNrCy",
    generatorHelpTitle: "Aide : Générateur iNrCy",
    generatorDesc: "Production de prospects et de clients dès qu’un module est connecté",
    refreshAria: "Actualiser le générateur",
    refreshTitle: "Actualiser",
    active: "Actif",
    waiting: "En attente",
    inertiaUnits: "Unités d'Inertie",
    channels: "canaux",
    potentialRevenue: "CA POTENTIEL 30 jours",
    basedOnProfile: "Basé sur profil + opportunités",
    opportunities: "Opportunités activables",
    projection30: "Projection 30 jours",
    capturedLeads: "Demandes captées",
    last7: "7 derniers jours",
    last30: "30 derniers jours",
  },
  generatorSteps: {
    profile: { label: "Compléter mon profil", shortLabel: "Profil" },
    activity: { label: "Compléter mon activité", shortLabel: "Activité" },
    site_link: { label: "Connecter un site internet", shortLabel: "Site internet" },
    site_ga4: { label: "Brancher GA4", shortLabel: "GA4" },
    site_gsc: { label: "Brancher GSC", shortLabel: "GSC" },
    gmb: { label: "Connecter Google Business", shortLabel: "Google Business" },
    facebook: { label: "Connecter Facebook", shortLabel: "Facebook" },
    instagram: { label: "Connecter Instagram", shortLabel: "Instagram" },
    pro_network: { label: "Connecter LinkedIn ou Pinterest", shortLabel: "LinkedIn / Pinterest" },
    mails: { label: "Connecter Mails", shortLabel: "Mails" },
    video: { label: "Connecter TikTok ou YouTube", shortLabel: "TikTok / YouTube" },
  },
  channels: {
    title: "Canaux",
    helpTitle: "Aide : Canaux",
    connected: "connectés",
    available: "disponibles",
    displayAria: "Affichage des canaux",
    list: "Liste",
    carousel: "Carrousel",
    railAria: "Liste des canaux",
    positionAria: "Position dans le carrousel",
    prev: "Canal précédent",
    next: "Canal suivant",
    goToChannel: "Aller au canal",
    showChannel: "Afficher",
    connectedAria: "canaux connectés sur",
  },
  modules: {
    requiredSetupLocked: "Mon profil et/ou Mon activité sont incomplets.",
    dashboardTitle: "Tableau de bord",
    dashboardSub: "Pilotage",
    statsSub: "Tous vos leads, enfin visibles",
    mailsSettingsAria: "Réglages Mails",
    mailsSub: "Tous vos messages partent d'ici",
    agendaSettingsAria: "Réglages Agenda",
    agendaSub: "Transformez les contacts en RDV",
    crmSub: "Vos prospects et clients centralisés",
    gearboxTitle: "Boîte de vitesse",
    gearboxSub: "Conversion",
    boosterStatsTitle: "Bilan Booster",
    boosterSub: "Active vos canaux",
    publishTitle: "Booster",
    publishCta: "Publier",
    propulserTitle: "Propulser",
    propulserSub: "Accélère votre activité",
    propulserCta: "Développer",
    fideliserTitle: "Fidéliser",
    fideliserSub: "Pérennise l’activité",
    fideliserCta: "Communiquer",
    cashSettingsTitle: "Réglages par défaut",
    cashTitle: "Encaisser",
    cashSub: "Devis et factures",
    cashCta: "Encaisser",
    reputationTitle: "E-réputation",
    reputationSub: "Pilotez vos avis Google",
    reputationCta: "Gérer",
    cashModalTitle: "Encaisser",
    cashModalLabel: "Devis et factures",
    cashModalSettings: "Réglages",
    cashModalIntroStrong: "Encaisser",
    cashModalIntroText: "regroupe vos devis et vos factures sans changer vos habitudes. Choisissez simplement l’action à lancer.",
    invoiceEyebrow: "Factures",
    invoiceTitle: "Créer une facture",
    invoiceText: "Facturer un client et suivre le paiement.",
    invoiceCta: "Facturer →",
    quoteEyebrow: "Devis",
    quoteTitle: "Créer un devis",
    quoteText: "Chiffrer une demande et déclencher une opportunité.",
    quoteCta: "Deviser →",
  },
  moduleCards: {
    inrbadge: { name: "iNr'Badge", description: "Mon entreprise en QR Code", view: "Voir mon badge", connect: "Configurer" },
    mails: { name: "Mails", description: "Diffuse à votre réseau ✉️", view: "Ouvrir iNr'Send", connect: "Configurer" },
    site_inrcy: { name: "Site iNrCy", description: "Votre machine à leads ⚡", view: "Voir le site", connect: "Connecter Google Analytics", siteOnlyTitle: "Disponible uniquement si vous avez un site iNrCy" },
    site_web: { name: "Site web", description: "Convertit vos visiteurs 💡", view: "Voir le site", connect: "Connecter Google Analytics" },
    gmb: { name: "Google Business", description: "Augmente les appels 📞", view: "Voir la page", connect: "Configurer" },
    inr_search: { name: "iNr'Search", description: "Votre page créée par iNrCy 🔎", view: "Voir ma page", connect: "Configurer" },
    facebook: { name: "Facebook", description: "Crée de la demande 📈", view: "Voir le compte", connect: "Connecter Facebook" },
    instagram: { name: "Instagram", description: "Développe votre marque 📸", view: "Voir le compte", connect: "Connecter Instagram" },
    linkedin: { name: "LinkedIn", description: "Crédibilise votre expertise 💼", view: "Voir le compte", connect: "Connecter LinkedIn" },
    tiktok: { name: "TikTok", description: "Développe votre audience 🎬", view: "Voir le compte", connect: "Configurer" },
    youtube_shorts: { name: "YouTube", description: "Diffuse en vidéo ▶️", view: "Voir la chaîne", connect: "Configurer" },
    pinterest: { name: "Pinterest", description: "Inspire vos clients 📌", view: "Voir le compte", connect: "Configurer" },
    inr_agent: { name: "iNr'Agent", description: "Automatise vos actions 🤖", view: "Ouvrir", connect: "Configurer" },
  },
  bubble: {
    viewFallback: "Voir",
    configure: "Configurer",
    disabled: "Option désactivée",
  },
  status: {
    connected: "Connecté",
    disconnected: "Déconnecté",
    toConnect: "A connecter",
    toConfigure: "A configurer",
    toUpdate: "À actualiser",
    reconnect: "À reconnecter",
    disabled: "Désactivé",
    noSite: "Aucun site",
    soon: "Bientôt",
  },
};

const en: DashboardCopy = {
  ...fr,
  locale: "en-GB",
  topbar: {
    brandTag: "Business generator",
    admin: "Admin",
    adminTitle: "iNrCy admin",
    notifications: "Alerts",
    openNotifications: "Open alerts",
    inrAgentOpen: "Open iNr'Agent",
    inrAgentDisabled: "iNr'Agent is off for this account",
    inrAgentAction: "action",
    inrAgentActions: "actions",
    inrAgentPending: "to review",
    gps: "Usage GPS",
    gpsAria: "Open usage GPS",
    contact: "Contact us",
    openMenu: "Open menu",
    menu: "Menu",
  },
  language: {
    buttonAria: "Change app language",
    buttonTitle: "App language",
    panelAria: "Choose app language",
  },
  userMenu: {
    title: "User menu",
    label: "Menu",
    profileIncomplete: "Profile missing",
    activityIncomplete: "Activity missing",
    completeProfileHint: "Click to complete your profile and activate iNrCy.",
    completeActivityHint: "Click to complete your activity and activate iNrCy.",
    account: "iNrCytizen account",
    profile: "My profile",
    activity: "My activity",
    preferences: "General settings",
    ai: "AI settings",
    media: "Media library",
    notifications: "Alerts",
    subscription: "My plan",
    inertia: "My inertia",
    shop: "Shop",
    referral: "Refer with iNrCy",
    legal: "Legal info",
    rgpd: "My data (GDPR)",
    logout: "Log out",
  },
  notifications: {
    aria: "Alerts",
    title: "To-do actions",
    subtitle: "Your cockpit nudges you on time.",
    settings: "Settings",
    markAllRead: "Read all",
    markAllReadConfirmTitle: "Mark all notifications as read?",
    markAllReadConfirmMessage: "They will then be permanently deleted.",
    markAllReadConfirmCancel: "Cancel",
    loading: "Loading alerts…",
    empty: "Your bell is empty for now. Next business nudges will appear here.",
    delete: "Delete alert",
    markRead: "Mark read",
  },
  drawer: {
    close: "Close",
    titles: {
      contact: "Contact us",
      compte: "iNrCytizen account",
      profil: "My profile",
      preferences: "General settings",
      inrbadge: "iNr'Badge settings",
      activite: "My activity",
      ia: "AI settings",
      abonnement: "My plan",
      legal: "Legal info",
      rgpd: "My data (GDPR)",
      mails: "Mail settings",
      agenda: "iNr’Calendar settings",
      site_inrcy: "Settings — Site iNrCy",
      site_web: "Settings — Website",
      instagram: "Settings — Instagram",
      linkedin: "Settings — LinkedIn",
      gmb: "Settings — Google Business",
      inr_search: "Settings — iNr'Search",
      facebook: "Settings — Facebook",
      tiktok: "Settings — TikTok",
      youtube_shorts: "Settings — YouTube",
      pinterest: "Settings — Pinterest",
      inertie: "My inertia",
      boutique: "Shop",
      parrainage: "Refer with iNrCy",
      notifications: "Alerts",
      documents: "Default settings",
    },
  },
  hero: {
    powerDialogAria: "Generator power detail",
    powerPanelTitle: "Power detail",
    kicker: "Your iNrCy cockpit",
    title: "Generator is live!",
    subtitle: "All channels now feed one single engine.",
    flowContacts: "Publications",
    flowQuotes: "Visibility",
    flowRevenue: "Results",
    powerTitle: "Generator power:",
    powerDetailsAria: "See generator power detail",
    powerDetailsTitle: "See detail",
    fullPower: "Full power",
    stepSingular: "step",
    stepPlural: "steps",
    remainingSingular: "left",
    remainingPlural: "left",
    progressAria: "Generator power",
    nextRise: "Next boost:",
    completeHint: "All levers feed the engine at full power.",
    generatorTitle: "iNrCy Generator",
    generatorHelpTitle: "Help: iNrCy Generator",
    generatorDesc: "Prospects and clients as soon as a module is connected",
    refreshAria: "Refresh generator",
    refreshTitle: "Refresh",
    active: "Active",
    waiting: "Pending",
    inertiaUnits: "Inertia Units",
    channels: "channels",
    potentialRevenue: "30-day revenue",
    basedOnProfile: "Based on profile + opportunities",
    opportunities: "Open opportunities",
    projection30: "30-day forecast",
    capturedLeads: "Captured leads",
    last7: "Last 7 days",
    last30: "Last 30 days",
  },
  generatorSteps: {
    profile: { label: "Complete my profile", shortLabel: "Profile" },
    activity: { label: "Complete activity", shortLabel: "Activity" },
    site_link: { label: "Connect a website", shortLabel: "Website" },
    site_ga4: { label: "Link GA4", shortLabel: "GA4" },
    site_gsc: { label: "Link GSC", shortLabel: "GSC" },
    gmb: { label: "Connect Google Business", shortLabel: "Google Business" },
    facebook: { label: "Connect Facebook", shortLabel: "Facebook" },
    instagram: { label: "Connect Instagram", shortLabel: "Instagram" },
    pro_network: { label: "Connect LinkedIn or Pinterest", shortLabel: "LinkedIn / Pinterest" },
    mails: { label: "Connect Mails", shortLabel: "Mails" },
    video: { label: "Connect TikTok or YouTube", shortLabel: "TikTok / YouTube" },
  },
  channels: {
    title: "Channels",
    helpTitle: "Help: Channels",
    connected: "connected",
    available: "available",
    displayAria: "Channel display",
    list: "List",
    carousel: "Carousel",
    railAria: "Channel list",
    positionAria: "Carousel position",
    prev: "Previous channel",
    next: "Next channel",
    goToChannel: "Go to channel",
    showChannel: "Show",
    connectedAria: "channels connected out of",
  },
  modules: {
    requiredSetupLocked: "Your profile and/or business activity are incomplete.",
    dashboardTitle: "Dashboard",
    dashboardSub: "Control",
    statsSub: "All your leads, finally visible",
    mailsSettingsAria: "Mail settings",
    mailsSub: "All messages start here",
    agendaSettingsAria: "Agenda settings",
    agendaSub: "Turn contacts into meetings",
    crmSub: "Prospects and clients in one place",
    gearboxTitle: "Gearbox",
    gearboxSub: "Conversion",
    boosterStatsTitle: "Booster summary",
    boosterSub: "Activates channels",
    publishTitle: "Booster",
    publishCta: "Publish",
    propulserTitle: "Grow",
    propulserSub: "Boost your activity",
    propulserCta: "Grow",
    fideliserTitle: "Retain",
    fideliserSub: "Keeps clients close",
    fideliserCta: "Communicate",
    cashSettingsTitle: "Default settings",
    cashTitle: "Collect",
    cashSub: "Quotes and invoices",
    cashCta: "Collect",
    reputationTitle: "E-reputation",
    reputationSub: "Manage Google reviews",
    reputationCta: "Manage",
    cashModalTitle: "Collect",
    cashModalLabel: "Quotes and invoices",
    cashModalSettings: "Settings",
    cashModalIntroStrong: "Collect",
    cashModalIntroText: "groups your quotes and invoices without changing habits. Just choose the action to launch.",
    invoiceEyebrow: "Invoices",
    invoiceTitle: "Create invoice",
    invoiceText: "Invoice a client and track payment.",
    invoiceCta: "Invoice →",
    quoteEyebrow: "Quotes",
    quoteTitle: "Create quote",
    quoteText: "Price a request and trigger an opportunity.",
    quoteCta: "Quote →",
  },
  moduleCards: {
    inrbadge: { name: "iNr'Badge", description: "My business QR Code", view: "View badge", connect: "Set up" },
    mails: { name: "Mails", description: "Reach your network ✉️", view: "Open iNr'Send", connect: "Set up" },
    site_inrcy: { name: "Site iNrCy", description: "Your lead engine ⚡", view: "View site", connect: "Link Analytics", siteOnlyTitle: "Only with an iNrCy site" },
    site_web: { name: "Website", description: "Turns visits into leads 💡", view: "View site", connect: "Link Analytics" },
    gmb: { name: "Google Business", description: "Boosts calls 📞", view: "View page", connect: "Set up" },
    inr_search: { name: "iNr'Search", description: "Your page created by iNrCy 🔎", view: "View my page", connect: "Set up" },
    facebook: { name: "Facebook", description: "Creates demand 📈", view: "View account", connect: "Link Facebook" },
    instagram: { name: "Instagram", description: "Grows your brand 📸", view: "View account", connect: "Link Instagram" },
    linkedin: { name: "LinkedIn", description: "Boosts credibility 💼", view: "View account", connect: "Link LinkedIn" },
    tiktok: { name: "TikTok", description: "Grows your audience 🎬", view: "View account", connect: "Set up" },
    youtube_shorts: { name: "YouTube", description: "Video broadcast ▶️", view: "View channel", connect: "Set up" },
    pinterest: { name: "Pinterest", description: "Inspires clients 📌", view: "View account", connect: "Set up" },
    inr_agent: { name: "iNr'Agent", description: "Automates actions 🤖", view: "Open", connect: "Set up" },
  },
  bubble: { viewFallback: "View", configure: "Set up", disabled: "Option off" },
  status: {
    connected: "Connected",
    disconnected: "Disconnected",
    toConnect: "To connect",
    toConfigure: "Set up",
    toUpdate: "Update",
    reconnect: "Reconnect",
    disabled: "Disabled",
    noSite: "No site",
    soon: "Soon",
  },
};

const es: DashboardCopy = {
  ...fr,
  locale: "es-ES",
  topbar: { ...en.topbar, brandTag: "Generador negocio", notifications: "Avisos", openNotifications: "Abrir avisos", inrAgentPending: "por validar", gps: "GPS de uso", gpsAria: "Abrir GPS de uso", contact: "Contacto", openMenu: "Abrir menú" },
  language: { buttonAria: "Cambiar idioma", buttonTitle: "Idioma app", panelAria: "Elegir idioma" },
  userMenu: { ...en.userMenu, title: "Menú usuario", profileIncomplete: "Perfil incompleto", activityIncomplete: "Actividad incompleta", completeProfileHint: "Haz clic para completar tu perfil y activar iNrCy.", completeActivityHint: "Haz clic para completar tu actividad y activar iNrCy.", account: "Cuenta iNrCytizen", profile: "Mi perfil", activity: "Mi actividad", preferences: "Ajustes generales", ai: "Ajustes IA", media: "Mediateca", notifications: "Avisos", subscription: "Mi plan", inertia: "Mi inercia", shop: "Tienda", referral: "Invitar con iNrCy", legal: "Info legal", rgpd: "Mis datos (RGPD)", logout: "Salir" },
  notifications: { ...en.notifications, aria: "Avisos", title: "Acciones", subtitle: "Tu cockpit avisa a tiempo.", settings: "Ajustes", markAllRead: "Leer todo", markAllReadConfirmTitle: "¿Marcar todos los avisos como leídos?", markAllReadConfirmMessage: "Después se eliminarán definitivamente.", markAllReadConfirmCancel: "Cancelar", loading: "Cargando avisos…", empty: "Tu campana está vacía. Los próximos avisos aparecerán aquí.", delete: "Eliminar aviso", markRead: "Marcar leído" },
  drawer: { close: "Cerrar", titles: { ...en.drawer.titles, contact: "Contacto", compte: "Cuenta iNrCytizen", profil: "Mi perfil", preferences: "Ajustes generales", inrbadge: "Ajustes iNr'Badge", activite: "Mi actividad", ia: "Ajustes IA", abonnement: "Mi plan", legal: "Info legal", rgpd: "Mis datos (RGPD)", mails: "Ajustes Mails", agenda: "Ajustes iNr’Calendar", site_web: "Ajustes — Web", inertie: "Mi inercia", boutique: "Tienda", parrainage: "Invitar con iNrCy", notifications: "Avisos", documents: "Ajustes por defecto" } },
  hero: { ...en.hero, powerDialogAria: "Detalle potencia", powerPanelTitle: "Detalle potencia", kicker: "Tu cockpit iNrCy", title: "¡Generador activo!", subtitle: "Todos los canales alimentan un solo motor.", flowContacts: "Publicaciones", flowQuotes: "Visibilidad", flowRevenue: "Resultados", powerTitle: "Potencia generador:", powerDetailsAria: "Ver detalle de potencia", powerDetailsTitle: "Ver detalle", fullPower: "Plena potencia", stepSingular: "etapa", stepPlural: "etapas", remainingSingular: "restante", remainingPlural: "restantes", progressAria: "Potencia generador", nextRise: "Próximo impulso:", completeHint: "Todos los motores alimentan la máquina.", generatorTitle: "Generador iNrCy", generatorHelpTitle: "Ayuda: Generador iNrCy", generatorDesc: "Prospectos y clientes desde que un módulo está conectado", refreshAria: "Actualizar generador", refreshTitle: "Actualizar", active: "Activo", waiting: "Espera", inertiaUnits: "Unidades inercia", channels: "canales", potentialRevenue: "Ventas 30 días", basedOnProfile: "Basado en perfil + oportunidades", opportunities: "Oportunidades", projection30: "Proyección 30 días", capturedLeads: "Solicitudes", last7: "Últimos 7 días", last30: "Últimos 30 días" },
  generatorSteps: { ...en.generatorSteps, profile: { label: "Completar perfil", shortLabel: "Perfil" }, activity: { label: "Completar actividad", shortLabel: "Actividad" }, site_link: { label: "Conectar web", shortLabel: "Web" }, site_ga4: { label: "Vincular GA4", shortLabel: "GA4" }, site_gsc: { label: "Vincular GSC", shortLabel: "GSC" }, gmb: { label: "Conectar Google Business", shortLabel: "Google Business" }, facebook: { label: "Conectar Facebook", shortLabel: "Facebook" }, instagram: { label: "Conectar Instagram", shortLabel: "Instagram" }, pro_network: { label: "Conectar LinkedIn o Pinterest", shortLabel: "LinkedIn / Pinterest" }, mails: { label: "Conectar Mails", shortLabel: "Mails" }, video: { label: "Conectar TikTok o YouTube", shortLabel: "TikTok / YouTube" } },
  channels: { ...en.channels, title: "Canales", helpTitle: "Ayuda: Canales", connected: "conectados", available: "disponibles", displayAria: "Vista canales", list: "Lista", carousel: "Carrusel", railAria: "Lista canales", positionAria: "Posición carrusel", prev: "Canal anterior", next: "Canal siguiente", goToChannel: "Ir al canal", showChannel: "Mostrar", connectedAria: "canales conectados de" },
  modules: { ...en.modules, dashboardTitle: "Panel", dashboardSub: "Control", statsSub: "Todos tus leads visibles", mailsSettingsAria: "Ajustes Mails", mailsSub: "Tus mensajes salen de aquí", agendaSettingsAria: "Ajustes Agenda", agendaSub: "Convierte contactos en citas", crmSub: "Prospectos y clientes unidos", gearboxTitle: "Caja de cambios", boosterSub: "Activa canales", publishTitle: "Booster", publishCta: "Publicar", propulserTitle: "Impulsar", propulserSub: "Acelera tu actividad", propulserCta: "Crecer", fideliserTitle: "Fidelizar", fideliserSub: "Fideliza clientes", fideliserCta: "Comunicar", cashSettingsTitle: "Ajustes por defecto", cashTitle: "Cobrar", cashSub: "Presupuestos y facturas", cashCta: "Cobrar", reputationTitle: "E-reputation", reputationSub: "Gestiona reseñas Google", reputationCta: "Gestionar", cashModalTitle: "Cobrar", cashModalLabel: "Presupuestos y facturas", cashModalSettings: "Ajustes", cashModalIntroStrong: "Cobrar", cashModalIntroText: "agrupa presupuestos y facturas sin cambiar hábitos. Elige la acción a lanzar.", invoiceEyebrow: "Facturas", invoiceTitle: "Crear factura", invoiceText: "Factura a un cliente y sigue el pago.", invoiceCta: "Facturar →", quoteEyebrow: "Presupuestos", quoteTitle: "Crear presupuesto", quoteText: "Valora una solicitud y activa una oportunidad.", quoteCta: "Presupuestar →" },
  moduleCards: { ...en.moduleCards, inrbadge: { name: "iNr'Badge", description: "Mi negocio en QR", view: "Ver badge", connect: "Configurar" }, mails: { name: "Mails", description: "Difunde a tu red ✉️", view: "Abrir iNr'Send", connect: "Configurar" }, site_inrcy: { name: "Site iNrCy", description: "Tu motor de leads ⚡", view: "Ver sitio", connect: "Vincular Analytics", siteOnlyTitle: "Solo con un sitio iNrCy" }, site_web: { name: "Sitio web", description: "Convierte visitas 💡", view: "Ver sitio", connect: "Vincular Analytics" }, gmb: { name: "Google Business", description: "Aumenta llamadas 📞", view: "Ver página", connect: "Configurar" }, inr_search: { name: "iNr'Search", description: "Tu página creada por iNrCy 🔎", view: "Ver mi página", connect: "Configurar" }, facebook: { name: "Facebook", description: "Crea demanda 📈", view: "Ver cuenta", connect: "Vincular Facebook" }, instagram: { name: "Instagram", description: "Crece tu marca 📸", view: "Ver cuenta", connect: "Vincular Instagram" }, linkedin: { name: "LinkedIn", description: "Da credibilidad 💼", view: "Ver cuenta", connect: "Vincular LinkedIn" }, tiktok: { name: "TikTok", description: "Crece audiencia 🎬", view: "Ver cuenta", connect: "Configurar" }, youtube_shorts: { name: "YouTube", description: "Difunde vídeo ▶️", view: "Ver canal", connect: "Configurar" }, pinterest: { name: "Pinterest", description: "Inspira clientes 📌", view: "Ver cuenta", connect: "Configurar" }, inr_agent: { name: "iNr'Agent", description: "Automatiza acciones 🤖", view: "Abrir", connect: "Configurar" } },
  bubble: { viewFallback: "Ver", configure: "Configurar", disabled: "Opción off" },
  status: { connected: "Conectado", disconnected: "Desconectado", toConnect: "Conectar", toConfigure: "Configurar", toUpdate: "Actualizar", reconnect: "Reconectar", disabled: "Desactivado", noSite: "Sin sitio", soon: "Pronto" },
};

const it: DashboardCopy = {
  ...es,
  locale: "it-IT",
  topbar: { ...es.topbar, brandTag: "Generatore business", notifications: "Avvisi", openNotifications: "Apri avvisi", inrAgentPending: "da validare", gps: "GPS d'uso", gpsAria: "Apri GPS d'uso", contact: "Contattaci", openMenu: "Apri menu" },
  language: { buttonAria: "Cambia lingua", buttonTitle: "Lingua app", panelAria: "Scegli lingua" },
  userMenu: { ...es.userMenu, title: "Menu utente", profileIncomplete: "Profilo incompleto", activityIncomplete: "Attività incompleta", completeProfileHint: "Clicca per completare il profilo e attivare iNrCy.", completeActivityHint: "Clicca per completare l’attività e attivare iNrCy.", account: "Account iNrCytizen", profile: "Il mio profilo", activity: "La mia attività", preferences: "Impostazioni", ai: "Impostazioni IA", media: "Mediateca", notifications: "Avvisi", subscription: "Il mio piano", inertia: "La mia inerzia", shop: "Negozio", referral: "Invita con iNrCy", legal: "Info legali", rgpd: "I miei dati (GDPR)", logout: "Disconnetti" },
  notifications: { ...es.notifications, aria: "Avvisi", title: "Azioni", subtitle: "Il cockpit avvisa al momento giusto.", settings: "Impostazioni", markAllRead: "Leggi tutto", markAllReadConfirmTitle: "Segnare tutte le notifiche come lette?", markAllReadConfirmMessage: "Verranno poi eliminate definitivamente.", markAllReadConfirmCancel: "Annulla", loading: "Caricamento avvisi…", empty: "La campana è vuota. I prossimi avvisi saranno qui.", delete: "Elimina avviso", markRead: "Segna letto" },
  drawer: { close: "Chiudi", titles: { ...es.drawer.titles, contact: "Contattaci", profil: "Il mio profilo", preferences: "Impostazioni", activite: "La mia attività", ia: "Impostazioni IA", abonnement: "Il mio piano", legal: "Info legali", rgpd: "I miei dati (GDPR)", mails: "Impostazioni Mails", agenda: "Impostazioni iNr’Calendar", site_web: "Impostazioni — Sito", inertie: "La mia inerzia", boutique: "Negozio", parrainage: "Invita con iNrCy", notifications: "Avvisi", documents: "Impostazioni predefinite" } },
  hero: { ...es.hero, powerDialogAria: "Dettaglio potenza", powerPanelTitle: "Dettaglio potenza", kicker: "Il tuo cockpit iNrCy", title: "Generatore attivo!", subtitle: "Tutti i canali alimentano un solo motore.", flowContacts: "Pubblicazioni", flowQuotes: "Visibilità", flowRevenue: "Risultati", powerTitle: "Potenza generatore:", powerDetailsAria: "Vedi dettaglio potenza", powerDetailsTitle: "Vedi dettaglio", fullPower: "Piena potenza", stepSingular: "fase", stepPlural: "fasi", remainingSingular: "rimasta", remainingPlural: "rimaste", progressAria: "Potenza generatore", nextRise: "Prossimo boost:", completeHint: "Tutte le leve alimentano la macchina.", generatorTitle: "Generatore iNrCy", generatorHelpTitle: "Aiuto: Generatore iNrCy", generatorDesc: "Prospect e clienti appena un modulo è connesso", refreshAria: "Aggiorna generatore", refreshTitle: "Aggiorna", active: "Attivo", waiting: "In attesa", inertiaUnits: "Unità inerzia", channels: "canali", potentialRevenue: "Fatturato 30 gg", basedOnProfile: "Basato su profilo + opportunità", opportunities: "Opportunità", projection30: "Proiezione 30 gg", capturedLeads: "Richieste", last7: "Ultimi 7 giorni", last30: "Ultimi 30 giorni" },
  generatorSteps: { ...es.generatorSteps, profile: { label: "Completa profilo", shortLabel: "Profilo" }, activity: { label: "Completa attività", shortLabel: "Attività" }, site_link: { label: "Connetti sito", shortLabel: "Sito" }, site_ga4: { label: "Collega GA4", shortLabel: "GA4" }, site_gsc: { label: "Collega GSC", shortLabel: "GSC" }, gmb: { label: "Connetti Google Business", shortLabel: "Google Business" }, facebook: { label: "Connetti Facebook", shortLabel: "Facebook" }, instagram: { label: "Connetti Instagram", shortLabel: "Instagram" }, pro_network: { label: "Connetti LinkedIn o Pinterest", shortLabel: "LinkedIn / Pinterest" }, mails: { label: "Connetti Mails", shortLabel: "Mails" }, video: { label: "Connetti TikTok o YouTube", shortLabel: "TikTok / YouTube" } },
  channels: { ...es.channels, title: "Canali", helpTitle: "Aiuto: Canali", connected: "connessi", available: "disponibili", displayAria: "Vista canali", list: "Lista", carousel: "Carosello", railAria: "Lista canali", positionAria: "Posizione carosello", prev: "Canale precedente", next: "Canale seguente", goToChannel: "Vai al canale", showChannel: "Mostra", connectedAria: "canali connessi su" },
  modules: { ...es.modules, dashboardTitle: "Cruscotto", dashboardSub: "Guida", statsSub: "Tutti i lead visibili", mailsSettingsAria: "Impostazioni Mails", mailsSub: "I messaggi partono da qui", agendaSettingsAria: "Impostazioni Agenda", agendaSub: "Trasforma contatti in appuntamenti", crmSub: "Prospect e clienti centralizzati", gearboxTitle: "Cambio", boosterSub: "Attiva canali", publishTitle: "Booster", publishCta: "Pubblica", propulserTitle: "Spingere", propulserSub: "Accelera l’attività", propulserCta: "Crescere", fideliserTitle: "Fidelizza", fideliserSub: "Fidelizza clienti", fideliserCta: "Comunicare", cashSettingsTitle: "Impostazioni predefinite", cashTitle: "Incassare", cashSub: "Preventivi e fatture", cashCta: "Incassare", reputationTitle: "E-reputation", reputationSub: "Gestisci recensioni Google", reputationCta: "Gestire", cashModalTitle: "Incassare", cashModalLabel: "Preventivi e fatture", cashModalSettings: "Impostazioni", cashModalIntroStrong: "Incassare", cashModalIntroText: "raggruppa preventivi e fatture senza cambiare abitudini. Scegli l’azione da lanciare.", invoiceEyebrow: "Fatture", invoiceTitle: "Crea fattura", invoiceText: "Fattura un cliente e segui il pagamento.", invoiceCta: "Fattura →", quoteEyebrow: "Preventivi", quoteTitle: "Crea preventivo", quoteText: "Quota una richiesta e attiva un’opportunità.", quoteCta: "Preventivo →" },
  moduleCards: { ...es.moduleCards, inrbadge: { name: "iNr'Badge", description: "Azienda in QR", view: "Vedi badge", connect: "Configura" }, mails: { name: "Mails", description: "Diffondi alla rete ✉️", view: "Apri iNr'Send", connect: "Configura" }, site_inrcy: { name: "Site iNrCy", description: "Motore di lead ⚡", view: "Vedi sito", connect: "Collega Analytics", siteOnlyTitle: "Solo con un sito iNrCy" }, site_web: { name: "Sito web", description: "Converte visite 💡", view: "Vedi sito", connect: "Collega Analytics" }, gmb: { name: "Google Business", description: "Aumenta chiamate 📞", view: "Vedi pagina", connect: "Configura" }, inr_search: { name: "iNr'Search", description: "La tua pagina creata da iNrCy 🔎", view: "Vedi la mia pagina", connect: "Configura" }, facebook: { name: "Facebook", description: "Crea domanda 📈", view: "Vedi account", connect: "Collega Facebook" }, instagram: { name: "Instagram", description: "Cresce il brand 📸", view: "Vedi account", connect: "Collega Instagram" }, linkedin: { name: "LinkedIn", description: "Dà credibilità 💼", view: "Vedi account", connect: "Collega LinkedIn" }, tiktok: { name: "TikTok", description: "Cresce l’audience 🎬", view: "Vedi account", connect: "Configura" }, youtube_shorts: { name: "YouTube", description: "Diffonde video ▶️", view: "Vedi canale", connect: "Configura" }, pinterest: { name: "Pinterest", description: "Ispira clienti 📌", view: "Vedi account", connect: "Configura" }, inr_agent: { name: "iNr'Agent", description: "Automatizza azioni 🤖", view: "Apri", connect: "Configura" } },
  bubble: { viewFallback: "Vedi", configure: "Configura", disabled: "Opzione off" },
  status: { connected: "Connesso", disconnected: "Disconnesso", toConnect: "Da connettere", toConfigure: "Configura", toUpdate: "Aggiorna", reconnect: "Ricollega", disabled: "Disattivato", noSite: "Nessun sito", soon: "Presto" },
};

const de: DashboardCopy = {
  ...en,
  locale: "de-DE",
  topbar: { ...en.topbar, brandTag: "Business-Generator", notifications: "Infos", openNotifications: "Infos öffnen", inrAgentPending: "zu prüfen", gps: "Nutzungs-GPS", gpsAria: "Nutzungs-GPS öffnen", contact: "Kontakt", openMenu: "Menü öffnen" },
  language: { buttonAria: "App-Sprache ändern", buttonTitle: "App-Sprache", panelAria: "App-Sprache wählen" },
  userMenu: { ...en.userMenu, title: "Benutzermenü", profileIncomplete: "Profil fehlt", activityIncomplete: "Aktivität fehlt", completeProfileHint: "Klicken, um Ihr Profil zu vervollständigen und iNrCy zu aktivieren.", completeActivityHint: "Klicken, um Ihre Aktivität zu vervollständigen und iNrCy zu aktivieren.", account: "iNrCytizen-Konto", profile: "Mein Profil", activity: "Meine Aktivität", preferences: "Einstellungen", ai: "KI-Einstellungen", media: "Mediathek", notifications: "Infos", subscription: "Mein Tarif", inertia: "Meine Inertia", shop: "Shop", referral: "Empfehlen", legal: "Rechtliches", rgpd: "Meine Daten (DSGVO)", logout: "Abmelden" },
  notifications: { ...en.notifications, aria: "Infos", title: "Aktionen", subtitle: "Ihr Cockpit erinnert rechtzeitig.", settings: "Einstellungen", markAllRead: "Alles lesen", markAllReadConfirmTitle: "Alle Benachrichtigungen als gelesen markieren?", markAllReadConfirmMessage: "Sie werden anschließend dauerhaft gelöscht.", markAllReadConfirmCancel: "Abbrechen", loading: "Infos werden geladen…", empty: "Die Glocke ist leer. Neue Business-Infos erscheinen hier.", delete: "Info löschen", markRead: "Als gelesen" },
  drawer: { close: "Schließen", titles: { ...en.drawer.titles, contact: "Kontakt", profil: "Mein Profil", preferences: "Einstellungen", activite: "Meine Aktivität", ia: "KI-Einstellungen", abonnement: "Mein Tarif", legal: "Rechtliches", rgpd: "Meine Daten (DSGVO)", mails: "Mail-Einstellungen", agenda: "iNr’Calendar Einstellungen", site_web: "Einstellungen — Website", inertie: "Meine Inertia", boutique: "Shop", parrainage: "Empfehlen", notifications: "Infos", documents: "Standardwerte" } },
  hero: { ...en.hero, kicker: "Ihr iNrCy Cockpit", title: "Generator läuft!", subtitle: "Alle Kanäle speisen jetzt eine Engine.", flowContacts: "Publikationen", flowQuotes: "Sichtbarkeit", flowRevenue: "Ergebnisse", powerTitle: "Generatorleistung:", fullPower: "Volle Leistung", stepSingular: "Schritt", stepPlural: "Schritte", remainingSingular: "offen", remainingPlural: "offen", nextRise: "Nächster Boost:", completeHint: "Alle Hebel speisen die Maschine.", generatorTitle: "iNrCy Generator", generatorHelpTitle: "Hilfe: iNrCy Generator", generatorDesc: "Leads und Kunden, sobald ein Modul aktiv ist", active: "Aktiv", waiting: "Warten", inertiaUnits: "Inertia Units", channels: "Kanäle", potentialRevenue: "30-Tage-Umsatz", basedOnProfile: "Basierend auf Profil + Chancen", opportunities: "Chancen", projection30: "30-Tage-Prognose", capturedLeads: "Anfragen", last7: "Letzte 7 Tage", last30: "Letzte 30 Tage" },
  generatorSteps: { ...en.generatorSteps, profile: { label: "Profil vervollständigen", shortLabel: "Profil" }, activity: { label: "Aktivität ergänzen", shortLabel: "Aktivität" }, site_link: { label: "Website verbinden", shortLabel: "Website" }, site_ga4: { label: "GA4 verbinden", shortLabel: "GA4" }, site_gsc: { label: "GSC verbinden", shortLabel: "GSC" }, gmb: { label: "Google Business verbinden", shortLabel: "Google Business" }, facebook: { label: "Facebook verbinden", shortLabel: "Facebook" }, instagram: { label: "Instagram verbinden", shortLabel: "Instagram" }, pro_network: { label: "LinkedIn oder Pinterest", shortLabel: "LinkedIn / Pinterest" }, mails: { label: "Mails verbinden", shortLabel: "Mails" }, video: { label: "TikTok oder YouTube", shortLabel: "TikTok / YouTube" } },
  channels: { ...en.channels, title: "Kanäle", helpTitle: "Hilfe: Kanäle", connected: "verbunden", available: "verfügbar", displayAria: "Kanalansicht", list: "Liste", carousel: "Karussell", railAria: "Kanalliste", positionAria: "Karussellposition", prev: "Voriger Kanal", next: "Nächster Kanal", goToChannel: "Zum Kanal", showChannel: "Anzeigen", connectedAria: "Kanäle verbunden von" },
  modules: { ...en.modules, dashboardTitle: "Dashboard", dashboardSub: "Steuerung", statsSub: "Alle Leads sichtbar", mailsSettingsAria: "Mail-Einstellungen", mailsSub: "Alle Nachrichten starten hier", agendaSettingsAria: "Agenda-Einstellungen", agendaSub: "Kontakte zu Terminen machen", crmSub: "Leads und Kunden zentral", gearboxTitle: "Getriebe", boosterSub: "Kanäle aktivieren", publishTitle: "Booster", publishCta: "Posten", propulserTitle: "Wachsen", propulserSub: "Aktivität boosten", propulserCta: "Wachsen", fideliserTitle: "Binden", fideliserSub: "Kunden binden", fideliserCta: "Kommunizieren", cashSettingsTitle: "Standardwerte", cashTitle: "Kassieren", cashSub: "Angebote und Rechnungen", cashCta: "Kassieren", reputationTitle: "E-reputation", reputationSub: "Google-Bewertungen steuern", reputationCta: "Steuern", cashModalTitle: "Kassieren", cashModalLabel: "Angebote und Rechnungen", cashModalSettings: "Einstellungen", cashModalIntroStrong: "Kassieren", cashModalIntroText: "bündelt Angebote und Rechnungen ohne neue Gewohnheiten. Wählen Sie die Aktion.", invoiceEyebrow: "Rechnungen", invoiceTitle: "Rechnung erstellen", invoiceText: "Kunden abrechnen und Zahlung verfolgen.", invoiceCta: "Rechnen →", quoteEyebrow: "Angebote", quoteTitle: "Angebot erstellen", quoteText: "Anfrage bepreisen und Chance auslösen.", quoteCta: "Anbieten →" },
  moduleCards: { ...en.moduleCards, inrbadge: { name: "iNr'Badge", description: "Firma als QR-Code", view: "Badge ansehen", connect: "Einrichten" }, mails: { name: "Mails", description: "Netzwerk erreichen ✉️", view: "iNr'Send öffnen", connect: "Einrichten" }, site_inrcy: { name: "Site iNrCy", description: "Ihre Lead-Engine ⚡", view: "Site ansehen", connect: "Analytics verbinden", siteOnlyTitle: "Nur mit iNrCy-Site" }, site_web: { name: "Website", description: "Besuche werden Leads 💡", view: "Site ansehen", connect: "Analytics verbinden" }, gmb: { name: "Google Business", description: "Mehr Anrufe 📞", view: "Seite ansehen", connect: "Einrichten" }, inr_search: { name: "iNr'Search", description: "Ihre von iNrCy erstellte Seite 🔎", view: "Meine Seite ansehen", connect: "Einrichten" }, facebook: { name: "Facebook", description: "Erzeugt Nachfrage 📈", view: "Konto ansehen", connect: "Facebook verbinden" }, instagram: { name: "Instagram", description: "Marke wächst 📸", view: "Konto ansehen", connect: "Instagram verbinden" }, linkedin: { name: "LinkedIn", description: "Stärkt Expertise 💼", view: "Konto ansehen", connect: "LinkedIn verbinden" }, tiktok: { name: "TikTok", description: "Reichweite wächst 🎬", view: "Konto ansehen", connect: "Einrichten" }, youtube_shorts: { name: "YouTube", description: "Video senden ▶️", view: "Kanal ansehen", connect: "Einrichten" }, pinterest: { name: "Pinterest", description: "Inspiriert Kunden 📌", view: "Konto ansehen", connect: "Einrichten" }, inr_agent: { name: "iNr'Agent", description: "Automatisiert Aktionen 🤖", view: "Öffnen", connect: "Einrichten" } },
  bubble: { viewFallback: "Ansehen", configure: "Einrichten", disabled: "Option aus" },
  status: { connected: "Verbunden", disconnected: "Getrennt", toConnect: "Verbinden", toConfigure: "Einrichten", toUpdate: "Aktualisieren", reconnect: "Neu verbinden", disabled: "Aus", noSite: "Keine Site", soon: "Bald" },
};

const nl: DashboardCopy = {
  ...en,
  locale: "nl-NL",
  topbar: { ...en.topbar, brandTag: "Business generator", notifications: "Meldingen", openNotifications: "Meldingen openen", inrAgentPending: "te keuren", gps: "Gebruik-GPS", gpsAria: "Gebruik-GPS openen", contact: "Contact", openMenu: "Menu openen" },
  language: { buttonAria: "Taal wijzigen", buttonTitle: "App-taal", panelAria: "Kies taal" },
  userMenu: { ...en.userMenu, title: "Gebruikersmenu", profileIncomplete: "Profiel mist", activityIncomplete: "Activiteit mist", completeProfileHint: "Klik om uw profiel te voltooien en iNrCy te activeren.", completeActivityHint: "Klik om uw activiteit te voltooien en iNrCy te activeren.", account: "iNrCytizen account", profile: "Mijn profiel", activity: "Mijn activiteit", preferences: "Instellingen", ai: "AI-instellingen", media: "Mediatheek", notifications: "Meldingen", subscription: "Mijn pakket", inertia: "Mijn inertia", shop: "Shop", referral: "Doorverwijzen", legal: "Juridische info", rgpd: "Mijn data (GDPR)", logout: "Uitloggen" },
  notifications: { ...en.notifications, aria: "Meldingen", title: "Acties", subtitle: "Uw cockpit herinnert op tijd.", settings: "Instellingen", markAllRead: "Alles lezen", markAllReadConfirmTitle: "Alle meldingen als gelezen markeren?", markAllReadConfirmMessage: "Ze worden daarna definitief verwijderd.", markAllReadConfirmCancel: "Annuleren", loading: "Meldingen laden…", empty: "De bel is leeg. Nieuwe businessmeldingen komen hier.", delete: "Melding wissen", markRead: "Gelezen" },
  drawer: { close: "Sluiten", titles: { ...en.drawer.titles, contact: "Contact", profil: "Mijn profiel", preferences: "Instellingen", activite: "Mijn activiteit", ia: "AI-instellingen", abonnement: "Mijn pakket", legal: "Juridische info", rgpd: "Mijn data (GDPR)", mails: "Mail-instellingen", agenda: "iNr’Calendar instellingen", site_web: "Instellingen — Website", inertie: "Mijn inertia", boutique: "Shop", parrainage: "Doorverwijzen", notifications: "Meldingen", documents: "Standaardwaarden" } },
  hero: { ...en.hero, kicker: "Uw iNrCy cockpit", title: "Generator live!", subtitle: "Alle kanalen voeden nu één motor.", flowContacts: "Publicaties", flowQuotes: "Zichtbaarheid", flowRevenue: "Resultaten", powerTitle: "Generator kracht:", fullPower: "Volle kracht", stepSingular: "stap", stepPlural: "stappen", remainingSingular: "over", remainingPlural: "over", nextRise: "Volgende boost:", completeHint: "Alle hefbomen voeden de machine.", generatorTitle: "iNrCy Generator", generatorHelpTitle: "Hulp: iNrCy Generator", generatorDesc: "Leads en klanten zodra een module is verbonden", active: "Actief", waiting: "Wacht", inertiaUnits: "Inertia Units", channels: "kanalen", potentialRevenue: "30-d omzet", basedOnProfile: "Op profiel + kansen gebaseerd", opportunities: "Kansen", projection30: "30-d prognose", capturedLeads: "Aanvragen", last7: "Laatste 7 dagen", last30: "Laatste 30 dagen" },
  generatorSteps: { ...en.generatorSteps, profile: { label: "Profiel voltooien", shortLabel: "Profiel" }, activity: { label: "Activiteit vullen", shortLabel: "Activiteit" }, site_link: { label: "Website verbinden", shortLabel: "Website" }, site_ga4: { label: "GA4 koppelen", shortLabel: "GA4" }, site_gsc: { label: "GSC koppelen", shortLabel: "GSC" }, gmb: { label: "Google Business verbinden", shortLabel: "Google Business" }, facebook: { label: "Facebook verbinden", shortLabel: "Facebook" }, instagram: { label: "Instagram verbinden", shortLabel: "Instagram" }, pro_network: { label: "LinkedIn of Pinterest", shortLabel: "LinkedIn / Pinterest" }, mails: { label: "Mails verbinden", shortLabel: "Mails" }, video: { label: "TikTok of YouTube", shortLabel: "TikTok / YouTube" } },
  channels: { ...en.channels, title: "Kanalen", helpTitle: "Hulp: Kanalen", connected: "verbonden", available: "beschikbaar", displayAria: "Kanaalweergave", list: "Lijst", carousel: "Carrousel", railAria: "Kanalenlijst", positionAria: "Carrouselpositie", prev: "Vorig kanaal", next: "Volgend kanaal", goToChannel: "Naar kanaal", showChannel: "Tonen", connectedAria: "kanalen verbonden van" },
  modules: { ...en.modules, dashboardTitle: "Dashboard", dashboardSub: "Sturing", statsSub: "Al uw leads zichtbaar", mailsSettingsAria: "Mail-instellingen", mailsSub: "Alle berichten starten hier", agendaSettingsAria: "Agenda-instellingen", agendaSub: "Maak afspraken van contacten", crmSub: "Leads en klanten centraal", gearboxTitle: "Versnelling", boosterSub: "Kanalen activeren", publishTitle: "Booster", publishCta: "Posten", propulserTitle: "Groeien", propulserSub: "Versnel uw activiteit", propulserCta: "Groeien", fideliserTitle: "Binden", fideliserSub: "Klanten binden", fideliserCta: "Communiceren", cashSettingsTitle: "Standaardwaarden", cashTitle: "Innen", cashSub: "Offertes en facturen", cashCta: "Innen", reputationTitle: "E-reputation", reputationSub: "Beheer Google reviews", reputationCta: "Beheer", cashModalTitle: "Innen", cashModalLabel: "Offertes en facturen", cashModalSettings: "Instellingen", cashModalIntroStrong: "Innen", cashModalIntroText: "bundelt offertes en facturen zonder gewoonten te veranderen. Kies de actie.", invoiceEyebrow: "Facturen", invoiceTitle: "Factuur maken", invoiceText: "Factureer een klant en volg betaling.", invoiceCta: "Factuur →", quoteEyebrow: "Offertes", quoteTitle: "Offerte maken", quoteText: "Prijs een aanvraag en start een kans.", quoteCta: "Offerte →" },
  moduleCards: { ...en.moduleCards, inrbadge: { name: "iNr'Badge", description: "Bedrijf als QR-code", view: "Badge bekijken", connect: "Instellen" }, mails: { name: "Mails", description: "Bereik uw netwerk ✉️", view: "Open iNr'Send", connect: "Instellen" }, site_inrcy: { name: "Site iNrCy", description: "Uw leadmotor ⚡", view: "Site bekijken", connect: "Analytics koppelen", siteOnlyTitle: "Alleen met iNrCy-site" }, site_web: { name: "Website", description: "Bezoek wordt lead 💡", view: "Site bekijken", connect: "Analytics koppelen" }, gmb: { name: "Google Business", description: "Meer oproepen 📞", view: "Pagina bekijken", connect: "Instellen" }, inr_search: { name: "iNr'Search", description: "Uw door iNrCy gemaakte pagina 🔎", view: "Mijn pagina bekijken", connect: "Instellen" }, facebook: { name: "Facebook", description: "Creëert vraag 📈", view: "Account bekijken", connect: "Facebook koppelen" }, instagram: { name: "Instagram", description: "Merk groeit 📸", view: "Account bekijken", connect: "Instagram koppelen" }, linkedin: { name: "LinkedIn", description: "Versterkt expertise 💼", view: "Account bekijken", connect: "LinkedIn koppelen" }, tiktok: { name: "TikTok", description: "Bereik groeit 🎬", view: "Account bekijken", connect: "Instellen" }, youtube_shorts: { name: "YouTube", description: "Video verspreiden ▶️", view: "Kanaal bekijken", connect: "Instellen" }, pinterest: { name: "Pinterest", description: "Inspireert klanten 📌", view: "Account bekijken", connect: "Instellen" }, inr_agent: { name: "iNr'Agent", description: "Automatiseert acties 🤖", view: "Openen", connect: "Instellen" } },
  bubble: { viewFallback: "Bekijken", configure: "Instellen", disabled: "Optie uit" },
  status: { connected: "Verbonden", disconnected: "Losgekoppeld", toConnect: "Koppelen", toConfigure: "Instellen", toUpdate: "Bijwerken", reconnect: "Opnieuw koppelen", disabled: "Uit", noSite: "Geen site", soon: "Binnenkort" },
};

const pt: DashboardCopy = {
  ...es,
  locale: "pt-PT",
  topbar: { ...es.topbar, brandTag: "Gerador negócios", notifications: "Avisos", openNotifications: "Abrir avisos", inrAgentPending: "por validar", gps: "GPS de uso", gpsAria: "Abrir GPS de uso", contact: "Contacto", openMenu: "Abrir menu" },
  language: { buttonAria: "Mudar idioma", buttonTitle: "Idioma app", panelAria: "Escolher idioma" },
  userMenu: { ...es.userMenu, title: "Menu utilizador", profileIncomplete: "Perfil incompleto", activityIncomplete: "Atividade incompleta", completeProfileHint: "Clique para completar o perfil e ativar iNrCy.", completeActivityHint: "Clique para completar a atividade e ativar iNrCy.", account: "Conta iNrCytizen", profile: "Meu perfil", activity: "Minha atividade", preferences: "Definições gerais", ai: "Definições IA", media: "Mediateca", notifications: "Avisos", subscription: "Meu plano", inertia: "Minha inércia", shop: "Loja", referral: "Indicar com iNrCy", legal: "Info legal", rgpd: "Meus dados (RGPD)", logout: "Sair" },
  notifications: { ...es.notifications, aria: "Avisos", title: "Ações", subtitle: "O cockpit avisa no momento certo.", settings: "Definições", markAllRead: "Ler tudo", markAllReadConfirmTitle: "Marcar todas as notificações como lidas?", markAllReadConfirmMessage: "Depois serão eliminadas definitivamente.", markAllReadConfirmCancel: "Cancelar", loading: "A carregar avisos…", empty: "A campainha está vazia. Novos avisos aparecerão aqui.", delete: "Apagar aviso", markRead: "Marcar lido" },
  drawer: { close: "Fechar", titles: { ...es.drawer.titles, contact: "Contacto", compte: "Conta iNrCytizen", profil: "Meu perfil", preferences: "Definições gerais", activite: "Minha atividade", ia: "Definições IA", abonnement: "Meu plano", legal: "Info legal", rgpd: "Meus dados (RGPD)", mails: "Definições Mails", agenda: "Definições iNr’Calendar", site_web: "Definições — Site", inertie: "Minha inércia", boutique: "Loja", parrainage: "Indicar com iNrCy", notifications: "Avisos", documents: "Definições padrão" } },
  hero: { ...es.hero, kicker: "Seu cockpit iNrCy", title: "Gerador ativo!", subtitle: "Todos os canais alimentam um só motor.", flowContacts: "Publicações", flowQuotes: "Visibilidade", flowRevenue: "Resultados", powerTitle: "Potência gerador:", powerDetailsAria: "Ver detalhe potência", powerDetailsTitle: "Ver detalhe", fullPower: "Plena potência", stepSingular: "etapa", stepPlural: "etapas", remainingSingular: "restante", remainingPlural: "restantes", progressAria: "Potência gerador", nextRise: "Próximo impulso:", completeHint: "Todas as alavancas alimentam a máquina.", generatorTitle: "Gerador iNrCy", generatorHelpTitle: "Ajuda: Gerador iNrCy", generatorDesc: "Prospectos e clientes logo que um módulo é ligado", refreshAria: "Atualizar gerador", refreshTitle: "Atualizar", active: "Ativo", waiting: "Espera", inertiaUnits: "Unidades inércia", channels: "canais", potentialRevenue: "Vendas 30 dias", basedOnProfile: "Baseado no perfil + oportunidades", opportunities: "Oportunidades", projection30: "Projeção 30 dias", capturedLeads: "Pedidos", last7: "Últimos 7 dias", last30: "Últimos 30 dias" },
  generatorSteps: { ...es.generatorSteps, profile: { label: "Completar perfil", shortLabel: "Perfil" }, activity: { label: "Completar atividade", shortLabel: "Atividade" }, site_link: { label: "Ligar site", shortLabel: "Site" }, site_ga4: { label: "Ligar GA4", shortLabel: "GA4" }, site_gsc: { label: "Ligar GSC", shortLabel: "GSC" }, gmb: { label: "Ligar Google Business", shortLabel: "Google Business" }, facebook: { label: "Ligar Facebook", shortLabel: "Facebook" }, instagram: { label: "Ligar Instagram", shortLabel: "Instagram" }, pro_network: { label: "Ligar LinkedIn ou Pinterest", shortLabel: "LinkedIn / Pinterest" }, mails: { label: "Ligar Mails", shortLabel: "Mails" }, video: { label: "Ligar TikTok ou YouTube", shortLabel: "TikTok / YouTube" } },
  channels: { ...es.channels, title: "Canais", helpTitle: "Ajuda: Canais", connected: "ligados", available: "disponíveis", displayAria: "Vista canais", list: "Lista", carousel: "Carrossel", railAria: "Lista canais", positionAria: "Posição carrossel", prev: "Canal anterior", next: "Canal seguinte", goToChannel: "Ir ao canal", showChannel: "Mostrar", connectedAria: "canais ligados de" },
  modules: { ...es.modules, dashboardTitle: "Painel", dashboardSub: "Controlo", statsSub: "Todos os leads visíveis", mailsSettingsAria: "Definições Mails", mailsSub: "As mensagens saem daqui", agendaSettingsAria: "Definições Agenda", agendaSub: "Converta contactos em reuniões", crmSub: "Prospectos e clientes juntos", gearboxTitle: "Caixa", boosterSub: "Ativa canais", publishTitle: "Booster", publishCta: "Publicar", propulserTitle: "Impulsar", propulserSub: "Acelera a atividade", propulserCta: "Crescer", fideliserTitle: "Fidelizar", fideliserSub: "Fideliza clientes", fideliserCta: "Comunicar", cashSettingsTitle: "Definições padrão", cashTitle: "Cobrar", cashSub: "Orçamentos e faturas", cashCta: "Cobrar", reputationTitle: "E-reputation", reputationSub: "Gira avaliações Google", reputationCta: "Gerir", cashModalTitle: "Cobrar", cashModalLabel: "Orçamentos e faturas", cashModalSettings: "Definições", cashModalIntroStrong: "Cobrar", cashModalIntroText: "agrupa orçamentos e faturas sem mudar hábitos. Escolha a ação.", invoiceEyebrow: "Faturas", invoiceTitle: "Criar fatura", invoiceText: "Fature um cliente e siga o pagamento.", invoiceCta: "Faturar →", quoteEyebrow: "Orçamentos", quoteTitle: "Criar orçamento", quoteText: "Orçamente um pedido e ative uma oportunidade.", quoteCta: "Orçamentar →" },
  moduleCards: { ...es.moduleCards, inrbadge: { name: "iNr'Badge", description: "Empresa em QR", view: "Ver badge", connect: "Configurar" }, mails: { name: "Mails", description: "Difunde à rede ✉️", view: "Abrir iNr'Send", connect: "Configurar" }, site_inrcy: { name: "Site iNrCy", description: "Motor de leads ⚡", view: "Ver site", connect: "Ligar Analytics", siteOnlyTitle: "Só com site iNrCy" }, site_web: { name: "Site web", description: "Converte visitas 💡", view: "Ver site", connect: "Ligar Analytics" }, gmb: { name: "Google Business", description: "Aumenta chamadas 📞", view: "Ver página", connect: "Configurar" }, inr_search: { name: "iNr'Search", description: "A sua página criada pela iNrCy 🔎", view: "Ver a minha página", connect: "Configurar" }, facebook: { name: "Facebook", description: "Cria procura 📈", view: "Ver conta", connect: "Ligar Facebook" }, instagram: { name: "Instagram", description: "Faz crescer a marca 📸", view: "Ver conta", connect: "Ligar Instagram" }, linkedin: { name: "LinkedIn", description: "Dá credibilidade 💼", view: "Ver conta", connect: "Ligar LinkedIn" }, tiktok: { name: "TikTok", description: "Aumenta audiência 🎬", view: "Ver conta", connect: "Configurar" }, youtube_shorts: { name: "YouTube", description: "Difunde vídeo ▶️", view: "Ver canal", connect: "Configurar" }, pinterest: { name: "Pinterest", description: "Inspira clientes 📌", view: "Ver conta", connect: "Configurar" }, inr_agent: { name: "iNr'Agent", description: "Automatiza ações 🤖", view: "Abrir", connect: "Configurar" } },
  bubble: { viewFallback: "Ver", configure: "Configurar", disabled: "Opção off" },
  status: { connected: "Ligado", disconnected: "Desligado", toConnect: "Ligar", toConfigure: "Configurar", toUpdate: "Atualizar", reconnect: "Religar", disabled: "Desativado", noSite: "Sem site", soon: "Breve" },
};

export const DASHBOARD_I18N: Record<AppLanguageCode, DashboardCopy> = {
  fr,
  en,
  es,
  it,
  de,
  nl,
  pt,
};

export function getDashboardTranslations(language: AppLanguageCode | string | null | undefined): DashboardCopy {
  const key = String(language || "fr").toLowerCase() as AppLanguageCode;
  return DASHBOARD_I18N[key] || DASHBOARD_I18N.fr;
}

export function getDashboardDrawerTitle(panel: string | null | undefined, language: AppLanguageCode | string | null | undefined) {
  if (!panel) return "";
  const copy = getDashboardTranslations(language);
  return copy.drawer.titles[panel] || DASHBOARD_I18N.fr.drawer.titles[panel] || "";
}

export function getDashboardStatusLabel(status: ModuleStatus, language?: AppLanguageCode | string | null) {
  const copy = getDashboardTranslations(language);
  if (status === "connected") return copy.status.connected;
  if (status === "available") return copy.status.toConnect;
  if (status === "reconnect") return copy.status.reconnect;
  return copy.status.soon;
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function translateDashboardStatusText(value: string, language?: AppLanguageCode | string | null) {
  const raw = String(value || "").trim();
  if (!raw) return raw;
  const copy = getDashboardTranslations(language);
  const normalized = normalizeText(raw);
  const progress = raw.match(/\d\s*\/\s*\d/)?.[0]?.replace(/\s+/g, "");
  const suffix = progress ? ` ${progress}` : "";

  if (normalized.includes("aucun site") || normalized.includes("no site")) return `${copy.status.noSite}${suffix}`;
  if (normalized.includes("desactive") || normalized.includes("disabled")) return `${copy.status.disabled}${suffix}`;
  if (normalized.includes("actualiser") || normalized.includes("update")) return `${copy.status.toUpdate}${suffix}`;
  if (normalized.includes("reconnexion") || normalized.includes("reconnect")) return `${copy.status.reconnect}${suffix}`;
  if (normalized.includes("deconnect") || normalized.includes("disconnected")) return `${copy.status.disconnected}${suffix}`;
  if (normalized.includes("configurer") || normalized.includes("set up")) return `${copy.status.toConfigure}${suffix}`;
  if (normalized.includes("connecter") || normalized.includes("to connect")) return `${copy.status.toConnect}${suffix}`;
  if (normalized.includes("connecte") || normalized.includes("connected")) return `${copy.status.connected}${suffix}`;
  if (normalized.includes("bientot") || normalized.includes("soon")) return `${copy.status.soon}${suffix}`;

  return raw;
}

export function getDashboardModuleCopy(key: string, language?: AppLanguageCode | string | null) {
  const copy = getDashboardTranslations(language);
  return copy.moduleCards[key] || DASHBOARD_I18N.fr.moduleCards[key];
}
