export const DASHBOARD_CHANNEL_SETUP = [
  // iNr'Badge et le Site iNrCy restent bien présents dans le bilan complet,
  // mais ne font pas partie des 11 connexions qui alimentent la jauge Canaux.
  { key: "inrbadge", weight: 0, createHref: null },
  { key: "site_web", weight: 15, createHref: null },
  { key: "gmb", weight: 15, createHref: "https://business.google.com/create" },
  { key: "inr_search", weight: 5, createHref: null },
  { key: "facebook", weight: 10, createHref: "https://www.facebook.com/pages/create" },
  { key: "instagram", weight: 10, createHref: "https://www.instagram.com/accounts/emailsignup/" },
  { key: "linkedin", weight: 10, createHref: "https://www.linkedin.com/company/setup/new/" },
  { key: "tiktok", weight: 8, createHref: "https://www.tiktok.com/signup" },
  { key: "youtube_shorts", weight: 8, createHref: "https://www.youtube.com/channel_switcher" },
  { key: "pinterest", weight: 6, createHref: "https://www.pinterest.com/business/create/" },
  { key: "x", weight: 6, createHref: "https://x.com/i/flow/signup" },
  { key: "mails", weight: 7, createHref: null },
  { key: "site_inrcy", weight: 0, createHref: null },
] as const;

export type DashboardSetupChannelKey = (typeof DASHBOARD_CHANNEL_SETUP)[number]["key"];

export const DASHBOARD_CHANNEL_POWER_SETUP = DASHBOARD_CHANNEL_SETUP.filter(
  (channel) => channel.weight > 0,
);

export const DASHBOARD_CHANNEL_FORCE_BY_KEY: Readonly<Record<DashboardSetupChannelKey, number>> =
  Object.freeze(Object.fromEntries(
    DASHBOARD_CHANNEL_SETUP.map((channel) => [channel.key, channel.weight]),
  ) as Record<DashboardSetupChannelKey, number>);

export const DASHBOARD_CHANNEL_CREATE_HREF_BY_KEY: Readonly<Record<DashboardSetupChannelKey, string | null>> =
  Object.freeze(Object.fromEntries(
    DASHBOARD_CHANNEL_SETUP.map((channel) => [channel.key, channel.createHref]),
  ) as Record<DashboardSetupChannelKey, string | null>);
