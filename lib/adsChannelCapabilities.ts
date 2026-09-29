/**
 * These channels have their own planning contracts. Pinterest also has a
 * Standard-access publisher; the remaining planned channels stay draft-only.
 */
export const ADS_PLANNED_CHANNELS = ["linkedin", "tiktok", "pinterest", "x"] as const;

export type PlannedAdsChannel = (typeof ADS_PLANNED_CHANNELS)[number];

export type AdsPlannedChannelCapability = {
  channel: PlannedAdsChannel;
  draftSchemaVersion: 1;
  briefSupported: true;
  publicationEnabled: boolean;
  publicationGate: "publisher_not_implemented" | "standard_access_and_oauth";
  officialReference: string;
};

export const ADS_PLANNED_CHANNEL_CAPABILITIES: {
  readonly [Channel in PlannedAdsChannel]: AdsPlannedChannelCapability & { readonly channel: Channel };
} = {
  linkedin: {
    channel: "linkedin",
    draftSchemaVersion: 1,
    briefSupported: true,
    publicationEnabled: false,
    publicationGate: "publisher_not_implemented",
    officialReference: "https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/account-structure/campaign-objectives",
  },
  tiktok: {
    channel: "tiktok",
    draftSchemaVersion: 1,
    briefSupported: true,
    publicationEnabled: false,
    publicationGate: "publisher_not_implemented",
    officialReference: "https://business-api.tiktok.com/portal/docs/create-an-upgraded-smart-lead-generation-campaign-with-location-as-website/v1.3",
  },
  pinterest: {
    channel: "pinterest",
    draftSchemaVersion: 1,
    briefSupported: true,
    publicationEnabled: true,
    publicationGate: "standard_access_and_oauth",
    officialReference: "https://developers.pinterest.com/docs/work-with-ads/create-campaigns-and-ad-groups/",
  },
  x: {
    channel: "x",
    draftSchemaVersion: 1,
    briefSupported: true,
    publicationEnabled: false,
    publicationGate: "publisher_not_implemented",
    officialReference: "https://business.x.com/en/help/campaign-setup/x-ads-manager",
  },
};

export function isPlannedAdsChannel(value: unknown): value is PlannedAdsChannel {
  return typeof value === "string" && (ADS_PLANNED_CHANNELS as readonly string[]).includes(value);
}

export function getPlannedAdsChannelCapability(channel: PlannedAdsChannel): AdsPlannedChannelCapability {
  return ADS_PLANNED_CHANNEL_CAPABILITIES[channel];
}
