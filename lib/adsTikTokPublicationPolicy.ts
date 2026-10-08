/** Enables only the suspended-creation adapter. It never enables delivery or grants native permissions. */
export const TIKTOK_ADS_PAUSED_CREATION_FLAG = "TIKTOK_ADS_PAUSED_CREATION_ENABLED";
export function tikTokAdsPausedCreationEnabled(environment: Record<string, string | undefined>): boolean {
  return environment[TIKTOK_ADS_PAUSED_CREATION_FLAG] === "true";
}
