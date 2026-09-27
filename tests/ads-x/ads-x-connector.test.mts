import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { signXAdsOAuthRequest, xAdsPercentEncode } from "../../lib/adsXOAuth1.ts";
import { isXAdsCallbackUri, normalizeXAdsAccount, verifyXAdsAccount, xAdsReadiness } from "../../lib/adsXPolicy.ts";

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("OAuth 1.0a signature matches X's published HMAC-SHA1 example", () => {
  // https://docs.x.com/fundamentals/authentication/oauth-1-0a/creating-a-signature
  const signed = signXAdsOAuthRequest({
    method: "POST",
    url: "https://api.x.com/1.1/statuses/update.json?include_entities=true",
    apiKey: "xvz1evFS4wEEPTGEFPHBog",
    apiSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
    token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
    tokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
    nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
    timestamp: "1318622958",
    formParams: new URLSearchParams({ status: "Hello Ladies + Gentlemen, a signed OAuth request!" }),
  });
  assert.equal(signed.signature, "Ls93hJiZbQ3akF3HF3x1Bz8/zU4=");
  assert.match(signed.authorization, /oauth_signature="Ls93hJiZbQ3akF3HF3x1Bz8%2FzU4%3D"/);
});

test("OAuth escaping uses RFC 3986 and unsigned HTTP is rejected", () => {
  assert.equal(xAdsPercentEncode("!'()* +/"), "%21%27%28%29%2A%20%2B%2F");
  assert.throws(() => signXAdsOAuthRequest({
    method: "GET", url: "http://ads-api.x.com/11/accounts", apiKey: "key", apiSecret: "secret",
  }), /HTTPS/);
});

test("Ads OAuth callback is HTTPS and cannot be confused with the organic X callback", () => {
  assert.equal(isXAdsCallbackUri("https://app.inrcy.com/api/ads/x/callback"), true);
  assert.equal(isXAdsCallbackUri("http://localhost:3000/api/ads/x/callback"), true);
  assert.equal(isXAdsCallbackUri("https://app.inrcy.com/api/integrations/x/callback"), false);
  assert.equal(isXAdsCallbackUri("http://app.inrcy.com/api/ads/x/callback"), false);
  assert.equal(isXAdsCallbackUri("https://app.inrcy.com/api/ads/x/callback?token=secret"), false);
  assert.equal(isXAdsCallbackUri("https://attacker@app.inrcy.com/api/ads/x/callback"), false);
});

test("X Ads association requires accepted account, verified EUR and management permission", () => {
  const raw = normalizeXAdsAccount({ id: "abc123", name: "Mon entreprise", approval_status: "ACCEPTED", deleted: false });
  assert.ok(raw);
  assert.equal(raw.currency, null);
  assert.equal(raw.eligibleToAssociate, false);
  const verified = verifyXAdsAccount(
    raw,
    { permissions: ["AD_MANAGER"] },
    [{ id: "funding1", currency: "EUR", able_to_fund: true }],
  );
  assert.equal(verified.eligibleToAssociate, true);
  assert.equal(xAdsReadiness({ connected: true, accounts: [verified], selectedAccountId: verified.id }), "ready_for_review");
  assert.equal(xAdsReadiness({ connected: true, accounts: [verified] }), "account_selection_required");
  assert.equal(xAdsReadiness({ connected: true, accounts: [verified], selectedAccountId: "elsewhere" }), "account_verification_required");
  assert.equal(xAdsReadiness({ connected: true, accounts: [{ ...verified, billingReady: false }], selectedAccountId: verified.id }), "billing_verification_required");
  assert.equal(verifyXAdsAccount(raw, { permissions: ["VIEWER"] }, [{ currency: "EUR" }]).eligibleToAssociate, false);
  assert.equal(verifyXAdsAccount(raw, { permissions: ["ACCOUNT_ADMIN"] }, [{ currency: "USD" }]).eligibleToAssociate, false);
  assert.equal(verifyXAdsAccount(raw, { permissions: ["ACCOUNT_ADMIN"] }, [{ currency: "EUR" }, { currency: "USD" }]).eligibleToAssociate, false);
  assert.equal(verifyXAdsAccount({ ...raw, approvalStatus: "PENDING" }, { permissions: ["AD_MANAGER"] }, [{ currency: "EUR" }]).eligibleToAssociate, false);
});

test("X Ads keeps paid publication disabled and isolates its integration from organic X", () => {
  const server = source("lib/adsXServer.ts");
  const accountsRoute = source("app/api/ads/x/accounts/route.ts");
  const statusRoute = source("app/api/ads/x/status/route.ts");
  const disconnectRoute = source("app/api/ads/x/disconnect/route.ts");
  assert.match(server, /X_ADS_SOURCE = "x_ads"/);
  assert.match(server, /X_ADS_PRODUCT = "ads"/);
  assert.match(server, /sameXUser \? previous\?\.resource_id : null/);
  assert.match(server, /isXAdsCallbackUri\(callbackUri\)/);
  assert.match(server, /\/11\/accounts/);
  assert.match(server, /authenticated_user_access/);
  assert.match(server, /funding_instruments/);
  assert.match(accountsRoute, /eligibleToAssociate/);
  assert.match(accountsRoute, /publicationEnabled: false/);
  assert.match(statusRoute, /publicationEnabled: false/);
  assert.match(disconnectRoute, /adsRequestOriginAllowed/);
  assert.match(disconnectRoute, /requirePremiumAdsUser/);
  assert.match(disconnectRoute, /\.eq\("provider", X_ADS_PROVIDER\)/);
  assert.match(disconnectRoute, /\.eq\("source", X_ADS_SOURCE\)/);
  assert.match(disconnectRoute, /\.eq\("product", X_ADS_PRODUCT\)/);
  assert.doesNotMatch(server + accountsRoute + statusRoute, /\/campaigns\b|\/tweets\b|\/promoted_tweets\b/);
});
