import type { StoredAdsCampaign } from "@/app/dashboard/ads/AdsCampaignTracking";

export const adsChannelLabels: Record<StoredAdsCampaign["provider"], string> = {
  google: "Google Ads", meta: "Meta Ads", linkedin: "LinkedIn Ads",
  tiktok: "TikTok Ads", pinterest: "Pinterest Ads", x: "X Ads",
};

export const adsStatusLabels: Record<StoredAdsCampaign["status"], string> = {
  draft: "Brouillon", publishing: "Création en cours", active: "Active",
  paused: "En pause", needs_review: "Contrôle requis", demo_paused: "Démo en pause",
};

const dateTimeFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris",
});

export function adsDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? dateTimeFormatter.format(parsed) : "—";
}

export function adsDate(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC",
  }).format(parsed) : "—";
}
