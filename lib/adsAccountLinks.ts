import type { AdsChannelId } from "./adsValidation";

/**
 * Builds the public manager URL for an advertiser account selected in iNr’ADS.
 *
 * Account identifiers come from third-party APIs, so accept only their known
 * safe formats. Google displays customer IDs with optional dashes and Meta
 * often prefixes them with `act_`. External managers use stable provider URLs
 * rather than interpolating an untrusted identifier into their destination.
 */
export function getAdsAdvertiserAccountUrl(
  provider: AdsChannelId,
  rawAccountId: string | null | undefined,
): string | null {
  const rawId = String(rawAccountId ?? "").trim();

  if (provider === "pinterest") {
    return /^\d{5,30}$/.test(rawId) ? "https://ads.pinterest.com/" : null;
  }
  if (provider === "linkedin") {
    return /^\d{3,30}$/.test(rawId) ? "https://www.linkedin.com/campaignmanager/" : null;
  }
  if (provider === "tiktok") {
    return /^\d{5,30}$/.test(rawId) ? "https://ads.tiktok.com/i18n/perf/" : null;
  }
  if (provider === "x") {
    return /^[A-Za-z0-9_-]{1,100}$/.test(rawId) ? "https://ads.x.com/" : null;
  }
  if (provider === "openai") {
    return /^adacct_[A-Za-z0-9_-]{1,100}$/.test(rawId) ? "https://ads.openai.com/" : null;
  }

  const accountId = rawId.replace(/^act_/i, "").replace(/-/g, "");

  if (!/^\d{5,25}$/.test(accountId)) return null;

  if (provider === "google") {
    return `https://ads.google.com/aw/overview?ocid=${encodeURIComponent(accountId)}`;
  }

  return `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${encodeURIComponent(`act_${accountId}`)}`;
}
