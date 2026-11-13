import type { StoredAdsCampaign } from "@/app/dashboard/ads/AdsCampaignTracking";

export const adsChannelLabels: Record<StoredAdsCampaign["provider"], string> = {
  google: "Google Ads", meta: "Meta Ads", linkedin: "LinkedIn Ads",
  tiktok: "TikTok Ads", pinterest: "Pinterest Ads", x: "X Ads",
  openai: "ChatGPT Ads",
};

export const adsStatusLabels: Record<StoredAdsCampaign["status"], string> = {
  draft: "Brouillon", publishing: "Création en cours", active: "Active",
  paused: "En pause", needs_review: "Contrôle requis", demo_paused: "Démo en pause",
};

export type MailsTranslator = (key: string, values?: Record<string, string | number>) => string;

export const adsStatusMessageKeys: Record<StoredAdsCampaign["status"], string> = {
  draft: "ads_status_draft", publishing: "ads_status_publishing", active: "ads_status_active",
  paused: "ads_status_paused", needs_review: "ads_status_needs_review", demo_paused: "ads_status_demo_paused",
};

export function adsDateTime(value: string | null | undefined, locale = "fr-FR") {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat(locale, {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris",
  }).format(parsed) : "—";
}

export function adsDate(value: string | null | undefined, locale = "fr-FR") {
  if (!value) return "—";
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat(locale, {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC",
  }).format(parsed) : "—";
}
