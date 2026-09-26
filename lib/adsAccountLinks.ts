import type { AdsProvider } from "./adsValidation";

/**
 * Builds the public manager URL for an advertiser account selected in iNr’ADS.
 *
 * Account identifiers come from third-party APIs, so accept only their known
 * numeric formats before putting them in an external URL. Google displays its
 * customer IDs with optional dashes and Meta often prefixes them with `act_`.
 */
export function getAdsAdvertiserAccountUrl(
  provider: AdsProvider,
  rawAccountId: string | null | undefined,
): string | null {
  const accountId = String(rawAccountId ?? "")
    .trim()
    .replace(/^act_/i, "")
    .replace(/-/g, "");

  if (!/^\d{5,25}$/.test(accountId)) return null;

  if (provider === "google") {
    return `https://ads.google.com/aw/overview?ocid=${encodeURIComponent(accountId)}`;
  }

  return `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${encodeURIComponent(`act_${accountId}`)}`;
}
