export const DASHBOARD_CHANNEL_SETUP = [
  // Les 14 canaux totalisent 100 %, classés par contribution décroissante.
  // Mails et les trois outils iNr représentent chacun 4 %.
  { key: "gmb", weight: 12, createHref: "https://business.google.com/create" },
  { key: "site_web", weight: 12, createHref: null },
  { key: "facebook", weight: 10, createHref: "https://www.facebook.com/pages/create" },
  { key: "instagram", weight: 10, createHref: "https://www.instagram.com/accounts/emailsignup/" },
  { key: "linkedin", weight: 10, createHref: "https://www.linkedin.com/company/setup/new/" },
  { key: "tiktok", weight: 6, createHref: "https://www.tiktok.com/signup" },
  { key: "youtube_shorts", weight: 6, createHref: "https://www.youtube.com/channel_switcher" },
  { key: "pinterest", weight: 6, createHref: "https://www.pinterest.com/business/create/" },
  { key: "x", weight: 6, createHref: "https://x.com/i/flow/signup" },
  { key: "threads", weight: 6, createHref: "https://www.threads.com" },
  { key: "mails", weight: 4, createHref: null },
  { key: "inr_search", weight: 4, createHref: null },
  { key: "inr_directory", weight: 4, createHref: null },
  { key: "inrbadge", weight: 4, createHref: null },
] as const;

export function getDashboardChannelSetup(metaPilotEnabled = false) {
  return DASHBOARD_CHANNEL_SETUP.filter(channel => channel.key !== "threads" || metaPilotEnabled);
}

export function getDashboardChannelPowerSetup(metaPilotEnabled = false) {
  return getDashboardChannelSetup(metaPilotEnabled).filter(channel => channel.weight > 0);
}

export type DashboardSetupChannelKey = (typeof DASHBOARD_CHANNEL_SETUP)[number]["key"];

export const DASHBOARD_CHANNEL_POWER_SETUP = DASHBOARD_CHANNEL_SETUP.filter(
  (channel) => channel.weight > 0 && channel.key !== "threads",
);

export const DASHBOARD_CHANNEL_FORCE_BY_KEY: Readonly<Record<DashboardSetupChannelKey, number>> =
  Object.freeze(Object.fromEntries(
    DASHBOARD_CHANNEL_SETUP.map((channel) => [channel.key, channel.weight]),
  ) as Record<DashboardSetupChannelKey, number>);

export const DASHBOARD_CHANNEL_CREATE_HREF_BY_KEY: Readonly<Record<DashboardSetupChannelKey, string | null>> =
  Object.freeze(Object.fromEntries(
    DASHBOARD_CHANNEL_SETUP.map((channel) => [channel.key, channel.createHref]),
  ) as Record<DashboardSetupChannelKey, string | null>);
