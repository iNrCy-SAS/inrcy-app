import { hasPremiumDashboardAccess, type DashboardEdition } from "./dashboardEdition.ts";
import type { AdsChannelId } from "./adsValidation.ts";

export const ADS_PUBLIC_CHANNELS: readonly AdsChannelId[] = ["google", "pinterest", "openai"];

export function isAdsPublicChannel(channel: AdsChannelId): boolean {
  return ADS_PUBLIC_CHANNELS.includes(channel);
}

export function adsAccessAllowed(edition: DashboardEdition, pilotAdmin: boolean, channel?: AdsChannelId): boolean {
  if (pilotAdmin) return true;
  return hasPremiumDashboardAccess(edition) && (channel === undefined || isAdsPublicChannel(channel));
}
