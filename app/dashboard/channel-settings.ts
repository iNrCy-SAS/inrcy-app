import type { CSSProperties } from "react";

export const CHANNEL_SETTINGS_PANEL_ORDER = [
  "inrbadge",
  "site_web",
  "gmb",
  "inr_search",
  "facebook",
  "instagram",
  "linkedin",
  "tiktok",
  "youtube_shorts",
  "pinterest",
  "x",
  "mails",
  "site_inrcy",
] as const;

export type ChannelSettingsPanelName = typeof CHANNEL_SETTINGS_PANEL_ORDER[number];

export const CENTERED_CHANNEL_SETTINGS_PANELS = new Set<string>(
  CHANNEL_SETTINGS_PANEL_ORDER,
);

const CHANNEL_HEADER_BACKGROUNDS: Record<ChannelSettingsPanelName, string> = {
  inrbadge:
    "linear-gradient(135deg, rgba(139,92,246,0.34), rgba(14,165,233,0.18)), rgba(15,23,42,0.96)",
  site_web:
    "linear-gradient(135deg, rgba(14,165,233,0.30), rgba(59,130,246,0.18)), rgba(15,23,42,0.96)",
  gmb:
    "linear-gradient(135deg, rgba(66,133,244,0.30), rgba(251,188,5,0.16)), rgba(15,23,42,0.96)",
  inr_search:
    "linear-gradient(135deg, rgba(6,182,212,0.28), rgba(124,58,237,0.24)), rgba(15,23,42,0.96)",
  facebook:
    "linear-gradient(135deg, rgba(24,119,242,0.34), rgba(59,130,246,0.16)), rgba(15,23,42,0.96)",
  instagram:
    "linear-gradient(135deg, rgba(225,48,108,0.30), rgba(131,58,180,0.25), rgba(252,175,69,0.14)), rgba(15,23,42,0.96)",
  linkedin:
    "linear-gradient(135deg, rgba(10,102,194,0.34), rgba(14,165,233,0.16)), rgba(15,23,42,0.96)",
  tiktok:
    "linear-gradient(135deg, rgba(37,244,238,0.18), rgba(254,44,85,0.24)), rgba(15,23,42,0.96)",
  youtube_shorts:
    "linear-gradient(135deg, rgba(255,0,0,0.28), rgba(219,39,119,0.18)), rgba(15,23,42,0.96)",
  pinterest:
    "linear-gradient(135deg, rgba(230,0,35,0.30), rgba(190,24,93,0.16)), rgba(15,23,42,0.96)",
  x:
    "linear-gradient(135deg, rgba(148,163,184,0.22), rgba(30,41,59,0.34)), rgba(15,23,42,0.96)",
  mails:
    "linear-gradient(135deg, rgba(59,130,246,0.28), rgba(168,85,247,0.23)), rgba(15,23,42,0.96)",
  site_inrcy:
    "linear-gradient(135deg, rgba(236,72,153,0.25), rgba(124,58,237,0.24), rgba(14,165,233,0.14)), rgba(15,23,42,0.96)",
};

export function isChannelSettingsPanel(value: string | null): value is ChannelSettingsPanelName {
  return Boolean(value && CENTERED_CHANNEL_SETTINGS_PANELS.has(value));
}

export function getChannelSettingsHeaderStyle(
  panel: ChannelSettingsPanelName,
): CSSProperties {
  return {
    minHeight: 68,
    borderBottom: "1px solid rgba(148,163,184,0.24)",
    background: CHANNEL_HEADER_BACKGROUNDS[panel],
    boxShadow:
      "inset 0 1px 0 rgba(255,255,255,0.11), 0 12px 30px rgba(15,23,42,0.24)",
  };
}
