import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildLinkedInAdsAuthorizationUrl,
  linkedInAdsAccessTokenIsFresh,
  linkedInAdsCanRetainAccount,
  linkedInAdsCanManageCampaigns,
  linkedInAdsHasReadAccess,
  linkedInAdsScopes,
  normalizeLinkedInAdsAccount,
  normalizeLinkedInAdsAccountUser,
} from "../lib/adsLinkedInPolicy.ts";

const root = new URL("../", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), "utf8");

test("LinkedIn Ads requests only its own read or manage Marketing scopes", () => {
  for (const [mode, expected] of [["read", "r_ads"], ["manage", "rw_ads"]] as const) {
    const url = new URL(buildLinkedInAdsAuthorizationUrl("ads-client", "https://example.com/api/ads/linkedin/callback", "opaque-state", mode));
    assert.equal(url.origin, "https://www.linkedin.com");
    assert.equal(url.pathname, "/oauth/v2/authorization");
    assert.equal(url.searchParams.get("scope"), expected);
    assert.equal(url.searchParams.get("state"), "opaque-state");
    assert.equal(url.searchParams.get("redirect_uri"), "https://example.com/api/ads/linkedin/callback");
  }
});

test("scope parsing accepts comma or space separators but refuses organic scopes", () => {
  assert.deepEqual(linkedInAdsScopes("r_ads rw_ads,r_ads"), ["r_ads", "rw_ads"]);
  assert.equal(linkedInAdsHasReadAccess("r_ads"), true);
  assert.equal(linkedInAdsHasReadAccess("rw_ads"), true);
  assert.equal(linkedInAdsHasReadAccess("w_member_social openid"), false);
});

test("ad-account roles and URNs are parsed strictly", () => {
  assert.deepEqual(normalizeLinkedInAdsAccountUser({
    account: "urn:li:sponsoredAccount:516413367",
    role: "CAMPAIGN_MANAGER",
    user: "urn:li:person:Ab_Cd-3",
  }), { id: "516413367", role: "CAMPAIGN_MANAGER", memberUrn: "urn:li:person:Ab_Cd-3" });
  assert.equal(normalizeLinkedInAdsAccountUser({ account: "urn:li:organization:516413367", role: "CAMPAIGN_MANAGER", user: "urn:li:person:abc" }), null);
  assert.equal(normalizeLinkedInAdsAccountUser({ account: "urn:li:sponsoredAccount:516413367", role: "ADMIN", user: "urn:li:person:abc" }), null);
});

test("rw_ads never overrides a read-only LinkedIn account role", () => {
  assert.equal(linkedInAdsCanManageCampaigns("VIEWER", "rw_ads", "ACTIVE", "BUSINESS"), false);
  assert.equal(linkedInAdsCanManageCampaigns("CREATIVE_MANAGER", "rw_ads", "ACTIVE", "BUSINESS"), false);
  assert.equal(linkedInAdsCanManageCampaigns("CAMPAIGN_MANAGER", "r_ads", "ACTIVE", "BUSINESS"), false);
  assert.equal(linkedInAdsCanManageCampaigns("CAMPAIGN_MANAGER", "rw_ads", "PAUSED", "BUSINESS"), false);
  assert.equal(linkedInAdsCanManageCampaigns("CAMPAIGN_MANAGER", "rw_ads", "ACTIVE", "BUSINESS"), true);
  assert.equal(linkedInAdsCanManageCampaigns("ACCOUNT_MANAGER", "rw_ads", "ACTIVE", "ENTERPRISE"), true);
  assert.equal(linkedInAdsCanManageCampaigns("ACCOUNT_BILLING_ADMIN", "rw_ads", "ACTIVE", "BUSINESS"), true);
});

test("account metadata cannot be substituted for a different accessible account", () => {
  const membership = normalizeLinkedInAdsAccountUser({
    account: "urn:li:sponsoredAccount:123456",
    role: "VIEWER",
    user: "urn:li:person:abc",
  });
  assert.ok(membership);
  assert.equal(normalizeLinkedInAdsAccount({ id: 789012, name: "Other", status: "ACTIVE", type: "BUSINESS" }, membership, "rw_ads"), null);
  const account = normalizeLinkedInAdsAccount({ id: 123456, name: " Example ", currency: "EUR", status: "ACTIVE", type: "BUSINESS" }, membership, "rw_ads");
  assert.equal(account?.name, "Example");
  assert.equal(account?.canManageCampaigns, false);
  assert.deepEqual(account?.permissions, ["VIEWER"]);
});

test("reauthorization retains only an account still accessible by the same LinkedIn member", () => {
  const membership = normalizeLinkedInAdsAccountUser({
    account: "urn:li:sponsoredAccount:123456", role: "VIEWER", user: "urn:li:person:abc",
  });
  assert.ok(membership);
  assert.equal(linkedInAdsCanRetainAccount("123456", true, [membership]), true);
  assert.equal(linkedInAdsCanRetainAccount("123456", false, [membership]), false);
  assert.equal(linkedInAdsCanRetainAccount("999999", true, [membership]), false);
  assert.equal(linkedInAdsCanRetainAccount("123456", true, []), false);
});

test("LinkedIn connection status cannot rely on missing or malformed access expiry", () => {
  const now = Date.parse("2026-09-27T10:00:00Z");
  assert.equal(linkedInAdsAccessTokenIsFresh(null, now), false);
  assert.equal(linkedInAdsAccessTokenIsFresh("invalid", now), false);
  assert.equal(linkedInAdsAccessTokenIsFresh("2026-09-27T10:01:00Z", now), false);
  assert.equal(linkedInAdsAccessTokenIsFresh("2026-09-27T10:03:00Z", now), true);
});

test("connector stays separate from organic LinkedIn and has no ad publishing endpoint", () => {
  const server = source("lib/adsLinkedInServer.ts");
  const start = source("app/api/ads/linkedin/start/route.ts");
  const accounts = source("app/api/ads/linkedin/accounts/route.ts");
  const status = source("app/api/ads/linkedin/status/route.ts");
  assert.match(server, /LINKEDIN_ADS_PROVIDER = "linkedin_ads"/);
  assert.match(server, /LINKEDIN_ADS_SOURCE = "linkedin_ads"/);
  assert.match(server, /LINKEDIN_ADS_CLIENT_ID/);
  assert.match(server, /oauth\/v2\/introspectToken/);
  assert.doesNotMatch(server, /process\.env\.LINKEDIN_CLIENT_ID/);
  assert.match(start, /"ads_linkedin"/);
  assert.match(accounts, /adsRequestOriginAllowed\(request\)/);
  assert.match(status, /publicationEnabled: false/);
  assert.doesNotMatch(server, /POST https:\/\/api\.linkedin\.com\/rest\/adCampaigns/);
});
