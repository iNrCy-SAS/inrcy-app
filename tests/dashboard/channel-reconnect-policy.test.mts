import assert from "node:assert/strict";
import test from "node:test";

import {
  OAUTH_PUBLICATION_CHANNELS,
  isApplicationSessionAuthenticationError,
  isProviderReconnectRequired,
} from "../../lib/channelReconnectPolicy.ts";
import {
  hasUsableRefreshCredential,
  isOfficialPublicationChannelConnected,
  publicationChannelRequiresReconnect,
} from "../../lib/publicationChannelAvailability.ts";

test("real provider OAuth failures require reconnection on every publication channel", () => {
  const cases = [
    ["gmb", "Request had invalid authentication credentials."],
    ["facebook", "OAuthException (#190): Invalid OAuth access token"],
    ["instagram", '{"error":{"code":190,"message":"Invalid token"}}'],
    ["linkedin", "invalid_grant: refresh token revoked"],
    ["tiktok", "access_token_invalid"],
    ["youtube_shorts", "refresh token has been revoked"],
    ["pinterest", "AUTHENTICATION_FAILED: access token expired"],
  ] as const;

  for (const [channel, error] of cases) {
    assert.equal(
      isProviderReconnectRequired({ channel, error, stage: "publish" }),
      true,
      `${channel} should require reconnect`,
    );
  }
});

test("an inRcy session failure never expires any provider channel", () => {
  for (const channel of OAUTH_PUBLICATION_CHANNELS) {
    for (const error of [
      "Non authentifié.",
      "auth_session_missing",
      "JWT expired",
      "Supabase auth session missing",
    ]) {
      assert.equal(
        isProviderReconnectRequired({
          channel,
          error,
          userMessage: "Votre session a expiré. Merci de vous reconnecter.",
          stage: "exception",
        }),
        false,
        `${channel} must ignore application session error: ${error}`,
      );
      assert.equal(isApplicationSessionAuthenticationError(error), true);
    }
  }
});

test("network, quota, provider policy and media errors stay operational failures", () => {
  const cases = [
    ["gmb", "GMB image URL media fetch failed HTTP 401"],
    ["facebook", "Facebook application request limit reached"],
    ["instagram", "Instagram video processing timed out"],
    ["linkedin", "LinkedIn media upload failed HTTP 500"],
    ["tiktok", "TikTok photo_pull_failed"],
    ["youtube_shorts", "YouTube HTTP 403 quotaExceeded"],
    ["pinterest", "Pinterest restricted feature pin_edit HTTP 403"],
  ] as const;

  for (const [channel, error] of cases) {
    assert.equal(
      isProviderReconnectRequired({ channel, error, stage: "publish" }),
      false,
      `${channel} operational failure must not poison OAuth`,
    );
  }
});

test("a translated reconnect message is only a fallback when raw evidence is absent", () => {
  assert.equal(
    isProviderReconnectRequired({
      channel: "gmb",
      error: "",
      userMessage: "Google Business à reconnecter. Rendez-vous dans Canaux.",
    }),
    true,
  );
  assert.equal(
    isProviderReconnectRequired({
      channel: "gmb",
      error: "quota exceeded",
      userMessage: "Google Business à reconnecter. Rendez-vous dans Canaux.",
    }),
    false,
  );
  assert.equal(
    isProviderReconnectRequired({
      channel: "gmb",
      error: "",
      userMessage: "Pinterest à reconnecter. Rendez-vous dans Canaux.",
    }),
    false,
  );
});

test("the same availability rule drives green, orange and Booster selection", () => {
  assert.equal(
    isOfficialPublicationChannelConnected({
      connected: true,
      connection_status: "connected",
    }),
    true,
  );
  assert.equal(
    isOfficialPublicationChannelConnected({
      connected: true,
      connection_status: "needs_update",
    }),
    false,
  );
  assert.equal(
    publicationChannelRequiresReconnect({
      connected: false,
      expired: true,
      connection_status: "needs_update",
    }),
    true,
  );
});

test("known-expired refresh credentials are not treated as reusable", () => {
  const nowMs = Date.parse("2026-08-09T18:00:00.000Z");
  assert.equal(hasUsableRefreshCredential(false, null, { nowMs }), false);
  assert.equal(hasUsableRefreshCredential(true, null, { nowMs }), true);
  assert.equal(
    hasUsableRefreshCredential(true, "2026-08-09T17:59:00.000Z", {
      nowMs,
      skewSeconds: 0,
    }),
    false,
  );
  assert.equal(
    hasUsableRefreshCredential(true, "2026-08-09T19:00:00.000Z", {
      nowMs,
      skewSeconds: 0,
    }),
    true,
  );
});
