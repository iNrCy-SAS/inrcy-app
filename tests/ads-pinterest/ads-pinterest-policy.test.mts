import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import {
  buildPinterestAdsAuthorizeUrl,
  isPinterestAdsCallbackUri,
  missingPinterestAdsScopes,
  normalizePinterestAdsAccount,
  parsePinterestAdsScopes,
  pinterestAdsReadiness,
} from "../../lib/adsPinterestPolicy.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("OAuth Ads uses a dedicated redirect, CSRF state and exact advertising scopes", () => {
  const redirect = "https://example.com/api/ads/pinterest/callback";
  const url = new URL(buildPinterestAdsAuthorizeUrl("app-123", redirect, "state-123"));
  assert.equal(url.origin, "https://www.pinterest.com");
  assert.equal(url.pathname, "/oauth/");
  assert.equal(url.searchParams.get("client_id"), "app-123");
  assert.equal(url.searchParams.get("redirect_uri"), redirect);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("state"), "state-123");
  assert.deepEqual(parsePinterestAdsScopes(url.searchParams.get("scope")), ["ads:read", "ads:write"]);
});

test("Pinterest Ads callback stays on its dedicated HTTPS route", () => {
  assert.equal(isPinterestAdsCallbackUri("https://app.inrcy.com/api/ads/pinterest/callback"), true);
  assert.equal(isPinterestAdsCallbackUri("http://localhost:3000/api/ads/pinterest/callback"), true);
  assert.equal(isPinterestAdsCallbackUri("http://127.0.0.1:3000/api/ads/pinterest/callback"), true);
  assert.equal(isPinterestAdsCallbackUri("http://app.inrcy.com/api/ads/pinterest/callback"), false);
  assert.equal(isPinterestAdsCallbackUri("https://app.inrcy.com/api/integrations/pinterest/callback"), false);
  assert.equal(isPinterestAdsCallbackUri("https://app.inrcy.com/api/ads/pinterest/callback?next=other"), false);
});

test("scope parser accepts Pinterest space/comma formats without inventing grants", () => {
  assert.deepEqual(parsePinterestAdsScopes("ads:read, ads:write ads:read"), ["ads:read", "ads:write"]);
  assert.deepEqual(missingPinterestAdsScopes("ads:read"), ["ads:write"]);
  assert.deepEqual(missingPinterestAdsScopes("ads:read,ads:write"), []);
  assert.deepEqual(missingPinterestAdsScopes(undefined), ["ads:read", "ads:write"]);
});

test("account normalization distinguishes campaign managers from analysts and unknown roles", () => {
  const manager = normalizePinterestAdsAccount({ id: "123456", name: "Studio", currency: "EUR", country: "FR", permissions: ["CAMPAIGN_MANAGER"] });
  const campaign = normalizePinterestAdsAccount({ id: "123457", permissions: ["CAMPAIGN"] });
  const analyst = normalizePinterestAdsAccount({ id: "234567", permissions: ["ANALYST"] });
  const unknown = normalizePinterestAdsAccount({ id: "345678", permissions: [] });
  assert.equal(manager?.canManageCampaigns, true);
  assert.equal(manager?.eligibleToAssociate, true);
  assert.equal(campaign?.canManageCampaigns, true);
  assert.equal(analyst?.canManageCampaigns, false);
  assert.equal(analyst?.eligibleToAssociate, false);
  assert.equal(unknown?.canManageCampaigns, null);
  assert.equal(unknown?.eligibleToAssociate, true);
  assert.equal(normalizePinterestAdsAccount({ id: "../bad" }), null);
});

test("readiness fails closed until scoped account and campaign permission are known", () => {
  const manager = normalizePinterestAdsAccount({ id: "123", permissions: ["CAMPAIGN_MANAGER"] })!;
  const analyst = normalizePinterestAdsAccount({ id: "456", permissions: ["ANALYST"] })!;
  const unknown = normalizePinterestAdsAccount({ id: "789", permissions: [] })!;
  const common = { connected: true, scopes: "ads:read,ads:write", accounts: [manager, analyst, unknown] };
  assert.equal(pinterestAdsReadiness({ connected: false }), "disconnected");
  assert.equal(pinterestAdsReadiness({ ...common, needsReconnect: true }), "needs_reconnect");
  assert.equal(pinterestAdsReadiness({ ...common, scopes: "ads:read" }), "missing_scopes");
  assert.equal(pinterestAdsReadiness({ ...common, accounts: [] }), "no_ad_account");
  assert.equal(pinterestAdsReadiness(common), "account_selection_required");
  assert.equal(pinterestAdsReadiness({ ...common, selectedAccountId: "456" }), "insufficient_account_permissions");
  assert.equal(pinterestAdsReadiness({ ...common, selectedAccountId: "789" }), "permission_verification_required");
  assert.equal(pinterestAdsReadiness({ ...common, selectedAccountId: "123" }), "ready_for_review");
});

test("Pinterest Ads connector cannot create or publish paid campaigns", () => {
  const connector = readFileSync(path.join(root, "lib/adsPinterestServer.ts"), "utf8");
  const accounts = readFileSync(path.join(root, "app/api/ads/pinterest/accounts/route.ts"), "utf8");
  assert.match(connector, /method: "POST"/); // token exchange only
  assert.doesNotMatch(connector, /\/campaigns|\/ad_groups|\/ad_accounts\/[^?]+\/ads/);
  assert.doesNotMatch(accounts, /createCampaign|publishCampaign/);
  assert.match(accounts, /publicationEnabled: false/);
});
