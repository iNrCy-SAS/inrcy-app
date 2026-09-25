/**
 * Permissions strictly required by the iNr’ADS Meta workflow.
 *
 * The product uses Facebook Login to read the connected person's Ads accounts,
 * choose a Facebook Page, and resolve its linked professional Instagram identity.
 * `instagram_business_basic` intentionally does not belong here: it is for the
 * separate Instagram Login product and cannot replace this Page-linked Ads flow.
 * `business_management` is not needed for the current `/me/adaccounts` and
 * `/me/accounts` calls, so it is intentionally not requested.
 */
export const META_ADS_REQUIRED_PERMISSIONS = [
  "ads_management",
  "pages_show_list",
  "pages_read_engagement",
  "instagram_basic",
] as const;

export const META_ADS_OAUTH_SCOPE = META_ADS_REQUIRED_PERMISSIONS.join(",");

/**
 * Ask Meta again for declined or newly approved permissions when a user
 * reconnects iNr’ADS. The callback still verifies the final grants via Graph.
 */
export function applyMetaAdsOAuthParameters(params: URLSearchParams) {
  params.set("scope", META_ADS_OAUTH_SCOPE);
  params.set("auth_type", "rerequest");
}
