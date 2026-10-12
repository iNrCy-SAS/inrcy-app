export const DASHBOARD_CHANNEL_SETUP = [
  // Les 12 connexions ont des poids fixes qui totalisent 100 %.
  // iNr'Badge reste présent dans le bilan, sans contribuer à la jauge Canaux.
  { key: "inrbadge", weight: 0, createHref: null },
  { key: "site_web", weight: 15, createHref: null },
  { key: "gmb", weight: 15, createHref: "https://business.google.com/create" },
  { key: "inr_search", weight: 5, createHref: null },
  { key: "facebook", weight: 10, createHref: "https://www.facebook.com/pages/create" },
  { key: "threads", weight: 4, createHref: "https://www.threads.com" },
  { key: "instagram", weight: 10, createHref: "https://www.instagram.com/accounts/emailsignup/" },
  { key: "linkedin", weight: 10, createHref: "https://www.linkedin.com/company/setup/new/" },
  { key: "tiktok", weight: 7, createHref: "https://www.tiktok.com/signup" },
  { key: "youtube_shorts", weight: 7, createHref: "https://www.youtube.com/channel_switcher" },
  { key: "pinterest", weight: 5, createHref: "https://www.pinterest.com/business/create/" },
  { key: "x", weight: 5, createHref: "https://x.com/i/flow/signup" },
  { key: "mails", weight: 7, createHref: null },

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
