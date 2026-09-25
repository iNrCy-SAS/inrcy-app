export type AdsPublishMode = "live" | "demo_paused";

export const ADS_LIVE_PUBLISH_CONFIRMATION = "PUBLIER_ET_DEPENSER";
export const ADS_PAUSED_DEMO_CONFIRMATION = "CREER_DEMO_EN_PAUSE";

type AdsPublishEnvironment = Record<string, string | undefined>;

/**
 * Unknown request values always resolve to the live path. That path stays
 * locked unless its own explicit environment flag and confirmation are set.
 */
export function parseAdsPublishMode(value: unknown): AdsPublishMode {
  return value === "demo_paused" ? "demo_paused" : "live";
}

export function isAdsPublishModeEnabled(mode: AdsPublishMode, environment: AdsPublishEnvironment): boolean {
  return mode === "demo_paused"
    ? environment.INRCY_ADS_DEMO_PAUSED_PUBLISH_ENABLED === "true"
    : environment.INRCY_ADS_LIVE_PUBLISH_ENABLED === "true";
}

export function hasAdsPublishConfirmation(mode: AdsPublishMode, value: unknown): boolean {
  return mode === "demo_paused"
    ? value === ADS_PAUSED_DEMO_CONFIRMATION
    : value === ADS_LIVE_PUBLISH_CONFIRMATION;
}
