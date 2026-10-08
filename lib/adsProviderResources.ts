/** Provider upload capabilities are durable server state, never browser state. */
export function publicAdsProviderResources(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const resources = { ...value } as Record<string, unknown>;
  delete resources.videoCheckpoint;
  delete resources.preparedCampaignCheckpoint;
  delete resources.preparedCampaignLock;
  return resources;
}

/** Even an upload with an unknown response must not reset to an editable draft. */
export function hasLinkedInAdsPublicationResources(resources: Record<string, unknown>): boolean {
  return ["imageUrn", "videoUrn", "videoCheckpoint", "campaignUrn", "postUrn", "creativeUrn"]
    .some((key) => key in resources);
}
