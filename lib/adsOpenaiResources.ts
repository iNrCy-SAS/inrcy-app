import type { OpenaiAdsAccount, OpenaiAdsResolvedLocation } from "./adsOpenaiConnector.ts";
export type OpenaiAdsLocationOption = OpenaiAdsResolvedLocation & { canonicalName: string };
/** Only safe account/catalog metadata: no API key, token, media URL, or billing data. */
export type OpenaiAdsResources = { selectedAccountId: string; account: OpenaiAdsAccount; geographyOptions: OpenaiAdsLocationOption[]; verifiedAt: string };
export function openaiAdsResourcesConsentKey(resources: OpenaiAdsResources | null): string | null {
  if (!resources || !resources.selectedAccountId || resources.account.id !== resources.selectedAccountId) return null;
  const { id, name, currencyCode, timezone, status, brandReviewStatus, accountReviewStatus } = resources.account;
  // Search results are not campaign selections. The draft's fingerprint covers selected locations/platforms/budget.
  return JSON.stringify({ account: { id, name, currencyCode, timezone, status, brandReviewStatus, accountReviewStatus } });
}
