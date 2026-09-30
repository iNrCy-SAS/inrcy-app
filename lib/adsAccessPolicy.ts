import { hasPremiumDashboardAccess, type DashboardEdition } from "./dashboardEdition.ts";
import type { AdsChannelId } from "./adsValidation.ts";

export function isAdsPublicChannel(channel: AdsChannelId): boolean {
  return channel === "google" || channel === "pinterest";
}

export function adsAccessAllowed(edition: DashboardEdition, pilotAdmin: boolean, channel?: AdsChannelId): boolean {
  if (pilotAdmin) return true;
  return hasPremiumDashboardAccess(edition) && (channel === undefined || isAdsPublicChannel(channel));
}
