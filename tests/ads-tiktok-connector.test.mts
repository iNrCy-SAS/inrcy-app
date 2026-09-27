import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import {
  parseTikTokAccountInfo,
  parseTikTokAdvertiserIds,
  tikTokAdsAuthorizeUrl,
  tikTokAdsAccountCanAssociate,
  tikTokAdsAccessTokenIsFresh,
  tikTokAdsIsLongLivedAuthorization,
  tikTokAdsRefreshTokenIsUsable,
  tikTokAdsRefreshNeedsReconnect,
} from "../lib/adsTikTokPolicy.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("TikTok Ads authorization URL is restricted to the business portal and carries CSRF state", () => {
  const allowed = tikTokAdsAuthorizeUrl("https://business-api.tiktok.com/portal/auth?app_id=123", "nonce");
  assert.equal(allowed?.searchParams.get("state"), "nonce");
  assert.equal(tikTokAdsAuthorizeUrl("https://evil.example/portal/auth", "nonce"), null);
  assert.equal(tikTokAdsAuthorizeUrl("http://business-api.tiktok.com/portal/auth", "nonce"), null);
});

test("TikTok Ads advertiser IDs and account metadata are parsed without organic IDs", () => {
  assert.deepEqual(parseTikTokAdvertiserIds({ data: { list: ["123456", { advertiser_id: "234567" }, "../../bad", "123456"] } }), ["123456", "234567"]);
  assert.deepEqual(parseTikTokAdvertiserIds({ data: { advertiser_ids: [123456] } }), ["123456"]);
  assert.deepEqual(parseTikTokAdvertiserIds({ data: { advertiser_ids: [9007199254740992, "9007199254740993"] } }), ["9007199254740993"]);
  assert.deepEqual(parseTikTokAccountInfo({ data: { list: [
    { advertiser_id: "123456", advertiser_name: "Studio", currency: "eur", status: "STATUS_ENABLE" },
    { advertiser_id: "bad", currency: "EUR" },
    { advertiser_id: 9007199254740992, currency: "EUR" },
  ] } }), [{ id: "123456", name: "Studio", currency: "EUR", status: "STATUS_ENABLE" }]);
});

test("only active EUR advertiser accounts can be associated", () => {
  const account = { id: "123456", name: "Studio", currency: "EUR", status: "STATUS_ENABLE" };
  assert.equal(tikTokAdsAccountCanAssociate(account), true);
  assert.equal(tikTokAdsAccountCanAssociate({ ...account, status: "STATUS_LIMIT" }), false);
  assert.equal(tikTokAdsAccountCanAssociate({ ...account, status: "" }), false);
  assert.equal(tikTokAdsAccountCanAssociate({ ...account, currency: "USD" }), false);
});

test("JSON OAuth failures can request reconnect without mistaking transient errors for revocation", () => {
  assert.equal(tikTokAdsRefreshNeedsReconnect(200, "Refresh token expired"), true);
  assert.equal(tikTokAdsRefreshNeedsReconnect(200, "Invalid refresh_token"), true);
  assert.equal(tikTokAdsRefreshNeedsReconnect(401, ""), true);
  assert.equal(tikTokAdsRefreshNeedsReconnect(429, "Rate limit reached"), false);
  assert.equal(tikTokAdsRefreshNeedsReconnect(200, "Temporary server error"), false);
});

test("missing access expiry triggers refresh and an expired refresh token requires reconnect", () => {
  const now = Date.parse("2026-09-27T10:00:00Z");
  assert.equal(tikTokAdsAccessTokenIsFresh(null, now), false);
  assert.equal(tikTokAdsAccessTokenIsFresh("invalid", now), false);
  assert.equal(tikTokAdsAccessTokenIsFresh("2026-09-27T10:01:00Z", now), false);
  assert.equal(tikTokAdsAccessTokenIsFresh("2026-09-27T10:03:00Z", now), true);
  assert.equal(tikTokAdsRefreshTokenIsUsable(null, null, now), false);
  assert.equal(tikTokAdsRefreshTokenIsUsable("encrypted", null, now), true);
  assert.equal(tikTokAdsRefreshTokenIsUsable("encrypted", "2026-09-27T09:59:00Z", now), false);
  assert.equal(tikTokAdsRefreshTokenIsUsable("encrypted", "2026-09-27T10:01:00Z", now), true);
});

test("TikTok Marketing API long-term tokens are distinct from timed creator tokens", () => {
  assert.equal(tikTokAdsIsLongLivedAuthorization(undefined, undefined), true);
  assert.equal(tikTokAdsIsLongLivedAuthorization(undefined, 86400), false);
  assert.equal(tikTokAdsIsLongLivedAuthorization("refresh", undefined), false);
  assert.equal(tikTokAdsIsLongLivedAuthorization(undefined, 0), false);
});

test("TikTok Ads uses a distinct integration and cannot publish paid campaigns", () => {
  const connector = readFileSync(path.join(root, "lib/adsTikTokServer.ts"), "utf8");
  const accounts = readFileSync(path.join(root, "app/api/ads/tiktok/accounts/route.ts"), "utf8");
  assert.match(connector, /TIKTOK_ADS_SOURCE/);
  assert.match(connector, /TIKTOK_ADS_PRODUCT/);
  assert.doesNotMatch(connector, /\/campaign\/create|\/ad\/create|\/adgroup\/create/);
  assert.match(accounts, /publicationEnabled: false/);
  assert.doesNotMatch(accounts, /publishCampaign|createCampaign/);
});
