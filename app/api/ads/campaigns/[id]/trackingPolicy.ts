export const ADS_CAMPAIGN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MutableAdsCampaign = {
  status: string;
  published_at: string | null;
  provider_resources: unknown;
};

/** Never mutate a local record which might already represent provider resources. */
export function canMutateAdsDraft(campaign: MutableAdsCampaign): boolean {
  const resources = campaign.provider_resources;
  return campaign.status === "draft"
    && campaign.published_at === null
    && resources !== null
    && typeof resources === "object"
    && !Array.isArray(resources)
    && Object.keys(resources).length === 0;
}

export function validateDraftExtension(currentEndDate: string, nextEndDate: unknown, now = new Date()): string | null {
  if (typeof nextEndDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(nextEndDate)) {
    return "Choisissez une date de fin valide.";
  }
  const timestamp = Date.parse(`${nextEndDate}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== nextEndDate) {
    return "Choisissez une date de fin valide.";
  }
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = (timestamp - today) / 86_400_000;
  if (days < 1 || days > 89) {
    return "La nouvelle date doit être comprise entre demain et dans 89 jours.";
  }
  if (nextEndDate <= currentEndDate) {
    return "La nouvelle date doit être postérieure à la fin actuelle.";
  }
  return null;
}
