import assert from "node:assert/strict";
import test from "node:test";
import { linkedInAdsAccountAllowedByTier } from "../lib/adsLinkedInPolicy.ts";

test("Standard application tier accepts numeric account IDs without a local customer allowlist", () => {
  assert.equal(linkedInAdsAccountAllowedByTier("123456789", { LINKEDIN_ADS_ACCESS_TIER: "standard" }), true);
  for (const accountId of ["", "abc", "123/456", "1".repeat(26)]) {
    assert.equal(linkedInAdsAccountAllowedByTier(accountId, { LINKEDIN_ADS_ACCESS_TIER: "standard" }), false);
  }
});

test("Development defaults retain account mapping and unknown application tiers fail closed", () => {
  const env = { LINKEDIN_ADS_DEVELOPMENT_ACCOUNT_IDS: "123, 456\n789" };
  for (const id of ["123", "456", "789"]) assert.equal(linkedInAdsAccountAllowedByTier(id, env), true);
  assert.equal(linkedInAdsAccountAllowedByTier("999", env), false);
  assert.equal(linkedInAdsAccountAllowedByTier("123", {}), false);
  assert.equal(linkedInAdsAccountAllowedByTier("123", { ...env, LINKEDIN_ADS_ACCESS_TIER: "invalid" }), false);
});
