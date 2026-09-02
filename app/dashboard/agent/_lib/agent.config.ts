import type { CSSProperties } from "react";
import {
  INR_MEDIA_IMAGE_MAX_BYTES,
  INR_MEDIA_VIDEO_SOURCE_MAX_BYTES,
} from "@/lib/mediaRules";
import type { DisplayKey as BoosterDisplayKey } from "../../booster/publier/publishModal.shared";
import type {
  InrAgentChannel,
  InrAgentTheme,
} from "@/lib/inrAgentSettings";
import type { InrAgentActionStatus } from "@/lib/inrAgentActions";
import type {
  Automation,
  AutomationConfig,
  AutomationKey,
  AutomationSettingsOptions,
  ChannelKey,
} from "./agent.types";

export const AGENT_MEDIA_MAX_IMAGE_BYTES = INR_MEDIA_IMAGE_MAX_BYTES;

export const AGENT_MEDIA_MAX_VIDEO_BYTES = INR_MEDIA_VIDEO_SOURCE_MAX_BYTES;

export const ROBOT_SRC = "/agent/inr-agent-robot-cutout.webp";

export const channelOptions: Record<ChannelKey, { name: string; src: string }> = {
  siteInrcy: { name: "Site iNrCy", src: "/icons/inrcy.png" },
  siteWeb: { name: "Site Web", src: "/icons/site-web.jpg" },
  gmb: { name: "Google Business", src: "/icons/google.jpg" },
  inrSearch: { name: "iNr'Search", src: "/icons/inr-search-bubble-128.png" },
  facebook: { name: "Facebook", src: "/icons/facebook.png" },
  instagram: { name: "Instagram", src: "/icons/instagram.jpg" },
  linkedin: { name: "LinkedIn", src: "/icons/linkedin.png" },
  tiktok: { name: "TikTok", src: "/icons/tiktok.png" },
  youtube: { name: "YouTube", src: "/icons/youtube-shorts.png" },
  pinterest: { name: "Pinterest", src: "/icons/pinterest-logo-128.png" },
  mails: { name: "Mails", src: "/icons/mails-inrcy-dashboard-v2.png" },
};

export const statsRubriqueOptions: Record<
  string,
  { name: string; src: string; channelKey?: ChannelKey }
> = {
  "Vue globale": { name: "Vue globale", src: "/icons/stats-global.svg" },
  iNrBadge: { name: "iNrBadge", src: "/icons/inrbadge-dashboard.png" },
  Mails: {
    name: "Mails",
    src: "/icons/mails-inrcy-dashboard-v2.png",
    channelKey: "mails",
  },
  "Site iNrCy": {
    name: "Site iNrCy",
    src: "/icons/inrcy.png",
    channelKey: "siteInrcy",
  },
  "Site Web": {
    name: "Site Web",
    src: "/icons/site-web.jpg",
    channelKey: "siteWeb",
  },
  "Google Business": {
    name: "Google Business",
    src: "/icons/google.jpg",
    channelKey: "gmb",
  },
  "iNr'Search": {
    name: "iNr'Search",
    src: "/icons/inr-search-bubble-128.png",
    channelKey: "inrSearch",
  },
  Facebook: {
    name: "Facebook",
    src: "/icons/facebook.png",
    channelKey: "facebook",
  },
  Instagram: {
    name: "Instagram",
    src: "/icons/instagram.jpg",
    channelKey: "instagram",
  },
  LinkedIn: {
    name: "LinkedIn",
    src: "/icons/linkedin.png",
    channelKey: "linkedin",
  },
  TikTok: { name: "TikTok", src: "/icons/tiktok.png", channelKey: "tiktok" },
  YouTube: {
    name: "YouTube",
    src: "/icons/youtube-shorts.png",
    channelKey: "youtube",
  },
  Pinterest: { name: "Pinterest", src: "/icons/pinterest-logo-128.png", channelKey: "pinterest" },
};

export const channelOrder: ChannelKey[] = [
  "siteInrcy",
  "siteWeb",
  "gmb",
  "inrSearch",
  "facebook",
  "instagram",
  "linkedin",
  "tiktok",
  "youtube",
  "pinterest",
  "mails",
];

export const channelOrderRank = Object.fromEntries(
  channelOrder.map((channel, index) => [channel, index]),
) as Record<ChannelKey, number>;

export const apiChannelToUi: Record<string, ChannelKey> = {
  site_inrcy: "siteInrcy",
  siteInrcy: "siteInrcy",
  site_web: "siteWeb",
  siteWeb: "siteWeb",
  inr_search: "inrSearch",
  inrSearch: "inrSearch",
  gmb: "gmb",
  google_business: "gmb",
  facebook: "facebook",
  instagram: "instagram",
  linkedin: "linkedin",
  tiktok: "tiktok",
  youtube: "youtube",
  pinterest: "pinterest",
  youtube_shorts: "youtube",
  mails: "mails",
  mail: "mails",
};

export const channelPayloadKeys: Record<ChannelKey, string[]> = {
  siteInrcy: ["inrcy_site", "site_inrcy", "siteInrcy"],
  siteWeb: ["site_web", "siteWeb"],
  inrSearch: ["inr_search", "inrSearch"],
  gmb: ["gmb", "google_business"],
  facebook: ["facebook"],
  instagram: ["instagram"],
  linkedin: ["linkedin"],
  tiktok: ["tiktok"],
  youtube: ["youtube_shorts", "youtube"],
  pinterest: ["pinterest"],
  mails: ["mails", "mail"],
};

export const agentChannelToBoosterDisplay: Partial<
  Record<ChannelKey, BoosterDisplayKey>
> = {
  siteInrcy: "inrcy_site",
  siteWeb: "site_web",
  inrSearch: "inr_search",
  gmb: "gmb",
  facebook: "facebook",
  instagram: "instagram",
  linkedin: "linkedin",
  tiktok: "tiktok",
  youtube: "youtube_shorts",
  pinterest: "pinterest",
};

export const pendingActionStatuses = new Set<InrAgentActionStatus>([
  "prepared",
  "pending_validation",
  "pending",
]);

export const weekDays = [
  "Lundi",
  "Mardi",
  "Mercredi",
  "Jeudi",
  "Vendredi",
  "Samedi",
  "Dimanche",
];

export const hourOptions = [
  "06:00",
  "06:30",
  "07:00",
  "07:30",
  "08:00",
  "08:30",
  "09:00",
  "09:30",
  "10:00",
  "10:30",
  "11:00",
  "11:30",
  "12:00",
  "12:30",
  "13:00",
  "13:30",
  "14:00",
  "14:30",
  "15:00",
  "15:30",
  "16:00",
  "16:30",
  "17:00",
  "17:30",
  "18:00",
  "18:30",
  "19:00",
  "19:30",
  "20:00",
  "20:30",
  "21:00",
];

export const settingsOptions: Record<AutomationKey, AutomationSettingsOptions> = {
  publish: {
    frequency: [
      { value: "weekly", label: "1 fois par semaine" },
      { value: "twice_weekly", label: "2 fois par semaine" },
      { value: "three_times_weekly", label: "3 fois par semaine" },
      { value: "monthly", label: "1 fois par mois" },
      { value: "biweekly", label: "2 fois par mois" },
      { value: "three_times_monthly", label: "3 fois par mois" },
    ],
    validation: [
      {
        value: "validation_required",
        label: "Validation obligatoire avant publication",
      },
      { value: "draft_only", label: "Préparer en brouillon" },
      {
        value: "notify_before_validation",
        label: "Notification avant validation",
      },
    ],
  },
  grow: {
    frequency: [
      { value: "weekly", label: "1 fois par semaine" },
      { value: "twice_weekly", label: "2 fois par semaine" },
      { value: "three_times_weekly", label: "3 fois par semaine" },
      { value: "monthly", label: "1 fois par mois" },
      { value: "biweekly", label: "2 fois par mois" },
      { value: "three_times_monthly", label: "3 fois par mois" },
      { value: "one_off", label: "Campagne ponctuelle" },
    ],
    validation: [
      {
        value: "validation_required",
        label: "Validation obligatoire avant envoi",
      },
      { value: "draft_only", label: "Préparer en brouillon" },
      {
        value: "notify_before_validation",
        label: "Notification avant validation",
      },
    ],
  },
  loyalty: {
    frequency: [
      { value: "weekly", label: "1 fois par semaine" },
      { value: "twice_weekly", label: "2 fois par semaine" },
      { value: "three_times_weekly", label: "3 fois par semaine" },
      { value: "monthly", label: "1 fois par mois" },
      { value: "biweekly", label: "2 fois par mois" },
      { value: "three_times_monthly", label: "3 fois par mois" },
      { value: "quarterly", label: "Chaque trimestre" },
    ],
    validation: [
      {
        value: "validation_required",
        label: "Validation obligatoire avant envoi",
      },
      { value: "draft_only", label: "Préparer en brouillon" },
      {
        value: "notify_before_validation",
        label: "Notification avant validation",
      },
    ],
  },
  stats: {
    frequency: [
      { value: "weekly", label: "Chaque semaine" },
      { value: "twice_weekly", label: "2 fois par semaine" },
      { value: "three_times_weekly", label: "3 fois par semaine" },
      { value: "monthly", label: "Chaque mois" },
      { value: "biweekly", label: "Tous les 15 jours" },
      { value: "three_times_monthly", label: "3 fois par mois" },
      { value: "quarterly", label: "Chaque trimestre" },
    ],
    validation: [
      { value: "automatic_report", label: "Bilan automatique sans validation" },
    ],
  },
};

export const automations: Automation[] = [
  {
    key: "publish",
    title: "Publier",
    shortTitle: "Publier",
    iconLabel: "Visibilité",
    settingsTitle: "Réglages — Publier",
    availableThemes: ["Conseils", "Réalisations", "Offres", "Actualités"],
    availableChannels: [
      "siteInrcy",
      "siteWeb",
      "gmb",
      "inrSearch",
      "facebook",
      "instagram",
      "linkedin",
      "tiktok",
      "youtube",
      "pinterest",
    ],
  },
  {
    key: "grow",
    title: "Propulser",
    shortTitle: "Propulser",
    iconLabel: "Acquisition",
    settingsTitle: "Réglages — Propulser",
    availableThemes: ["Valoriser", "Récolter", "Offrir"],
    availableChannels: ["mails"],
  },
  {
    key: "loyalty",
    title: "Fidéliser",
    shortTitle: "Fidéliser",
    iconLabel: "Relation",
    settingsTitle: "Réglages — Fidéliser",
    availableThemes: ["Informer", "Enquêter", "Suivre"],
    availableChannels: ["mails"],
  },
  {
    key: "stats",
    title: "Statistiques",
    shortTitle: "Stats",
    iconLabel: "Pilotage",
    settingsTitle: "Réglages — Statistiques",
    availableThemes: [
      "Vue globale",
      "iNrBadge",
      "Mails",
      "Site iNrCy",
      "Site Web",
      "Google Business",
      "Facebook",
      "Instagram",
      "LinkedIn",
      "TikTok",
      "YouTube",
      "Pinterest",
    ],
    availableChannels: [],
  },
];

export const robotStepsByAutomation: Record<AutomationKey, [string, string, string]> =
  {
    publish: [
      "J’analyse votre activité",
      "Je prépare une publication",
      "Vous validez avant publication",
    ],
    grow: [
      "J’identifie une opportunité",
      "Je prépare une campagne Propulser",
      "Vous validez avant envoi",
    ],
    loyalty: [
      "J’analyse vos contacts",
      "Je prépare une campagne Fidéliser",
      "Vous validez avant envoi",
    ],
    stats: [
      "J’analyse vos statistiques",
      "Je prépare le bilan PDF",
      "Je vous envoie le rapport",
    ],
  };

export const defaultConfigs: Record<AutomationKey, AutomationConfig> = {
  publish: {
    enabled: true,
    frequency: "1 fois par semaine",
    day: "Lundi",
    time: "09:00",
    scheduleSlots: [
      { day: "Lundi", time: "09:00" },
      { day: "Jeudi", time: "09:00" },
    ],
    monthDays: [10],
    channels: [
      "siteInrcy",
      "siteWeb",
      "gmb",
      "inrSearch",
      "facebook",
      "instagram",
      "linkedin",
      "tiktok",
      "youtube",
      "pinterest",
    ],
    themes: ["Conseils", "Réalisations", "Offres"],
    validation: "Validation obligatoire avant publication",
    source: "Contenus déjà publiés + canaux Booster / Publier connectés",
    signatureAutomatic: true,
    preferredMediaSource: "media_library",
  },
  grow: {
    enabled: false,
    frequency: "2 fois par mois",
    day: "Mercredi",
    time: "10:00",
    scheduleSlots: [
      { day: "Mercredi", time: "10:00" },
      { day: "Samedi", time: "10:00" },
    ],
    monthDays: [10, 20],
    channels: ["mails"],
    themes: ["Valoriser", "Récolter", "Offrir"],
    validation: "Validation obligatoire avant envoi",
    source: "Publications déjà faites + rubriques Propulser",
    signatureAutomatic: true,
    preferredMediaSource: "media_library",
  },
  loyalty: {
    enabled: false,
    frequency: "1 fois par mois",
    day: "Vendredi",
    time: "09:30",
    scheduleSlots: [
      { day: "Vendredi", time: "09:30" },
      { day: "Lundi", time: "09:30" },
    ],
    monthDays: [10],
    channels: ["mails"],
    themes: ["Informer", "Enquêter", "Suivre"],
    validation: "Validation obligatoire avant envoi",
    source: "Publications déjà faites + rubriques Fidéliser",
    signatureAutomatic: true,
    preferredMediaSource: "media_library",
  },
  stats: {
    enabled: false,
    frequency: "Chaque semaine",
    day: "Lundi",
    time: "08:30",
    scheduleSlots: [
      { day: "Lundi", time: "08:30" },
      { day: "Jeudi", time: "08:30" },
    ],
    monthDays: [10],
    channels: [],
    themes: [
      "Vue globale",
      "Google Business",
      "Facebook",
      "Instagram",
      "LinkedIn",
      "Pinterest",
    ],
    validation: "Bilan automatique",
    source: "Rubriques iNr’Stats connectées",
    signatureAutomatic: true,
    preferredMediaSource: "media_library",
  },
};

export const channelToApi: Record<ChannelKey, InrAgentChannel> = {
  siteInrcy: "site_inrcy",
  siteWeb: "site_web",
  gmb: "gmb",
  inrSearch: "inr_search",
  facebook: "facebook",
  instagram: "instagram",
  linkedin: "linkedin",
  tiktok: "tiktok",
  youtube: "youtube",
  pinterest: "pinterest",
  mails: "mails",
};

export const apiToChannel = Object.fromEntries(
  Object.entries(channelToApi).map(([uiKey, apiKey]) => [apiKey, uiKey]),
) as Record<InrAgentChannel, ChannelKey>;

export const agentPublishChannelToBoosterChannel: Record<string, string> = {
  siteInrcy: "inrcy_site",
  site_inrcy: "inrcy_site",
  siteWeb: "site_web",
  site_web: "site_web",
  inrSearch: "inr_search",
  inr_search: "inr_search",
  gmb: "gmb",
  google_business: "gmb",
  facebook: "facebook",
  instagram: "instagram",
  linkedin: "linkedin",
  tiktok: "tiktok",
  youtube: "youtube_shorts",
  youtube_shorts: "youtube_shorts",
  pinterest: "pinterest",
};

export const DASHBOARD_CHANNEL_STATE_CACHE_KEY = "inrcy_dashboard_channel_state_v1";

export const INR_AGENT_VIEW_CACHE_KEY = "inrcy_agent_view_cache_v1";

export const INR_AGENT_VIEW_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const themeToApi: Record<string, InrAgentTheme> = {
  Conseils: "conseils",
  Réalisations: "realisations",
  Offres: "offres",
  Actualités: "actualites",
  Valoriser: "valoriser",
  Récolter: "recolter",
  Offrir: "offrir",
  Informer: "informer",
  Enquêter: "enqueter",
  Suivre: "suivre",
  "Vue globale": "vue_globale",
  iNrBadge: "inrbadge",
  Mails: "mails",
  "Site iNrCy": "site_inrcy",
  "Site Web": "site_web",
  "iNr'Search": "inr_search",
  "Google Business": "gmb",
  Facebook: "facebook",
  Instagram: "instagram",
  LinkedIn: "linkedin",
  TikTok: "tiktok",
  YouTube: "youtube",
  Pinterest: "pinterest",
};

export const apiToTheme = Object.fromEntries(
  Object.entries(themeToApi).map(([label, apiKey]) => [apiKey, label]),
) as Record<InrAgentTheme, string>;

export const dayToApi: Record<string, number> = {
  Lundi: 1,
  Mardi: 2,
  Mercredi: 3,
  Jeudi: 4,
  Vendredi: 5,
  Samedi: 6,
  Dimanche: 0,
};

export const apiToDay: Record<number, string> = {
  0: "Dimanche",
  1: "Lundi",
  2: "Mardi",
  3: "Mercredi",
  4: "Jeudi",
  5: "Vendredi",
  6: "Samedi",
};

export const AGENT_RICH_TEXT_EDITOR_STYLE: CSSProperties = {
  width: "100%",
  maxHeight: "min(340px, 42vh)",
  overflowY: "auto",
};
