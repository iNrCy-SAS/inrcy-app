import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMetaAdsOAuthParameters,
  META_ADS_OAUTH_SCOPE,
  META_ADS_REQUIRED_PERMISSIONS,
} from "../lib/adsMetaScopes.ts";

test("iNr’ADS demande uniquement les permissions Meta de son parcours Ads Facebook + Instagram", () => {
  assert.deepEqual(META_ADS_REQUIRED_PERMISSIONS, [
    "ads_management",
    "pages_show_list",
    "pages_read_engagement",
    "instagram_basic",
  ]);
  assert.equal(META_ADS_OAUTH_SCOPE, "ads_management,pages_show_list,pages_read_engagement,instagram_basic");
  assert.equal(META_ADS_REQUIRED_PERMISSIONS.includes("ads_read" as never), false);
  assert.equal(META_ADS_REQUIRED_PERMISSIONS.includes("instagram_business_basic" as never), false);
  assert.equal(META_ADS_REQUIRED_PERMISSIONS.includes("business_management" as never), false);
});

test("une reconnexion iNr’ADS redemande les permissions Meta manquantes", () => {
  const params = new URLSearchParams({ client_id: "test" });
  applyMetaAdsOAuthParameters(params);

  assert.equal(params.get("scope"), META_ADS_OAUTH_SCOPE);
  assert.equal(params.get("auth_type"), "rerequest");
});
