import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  canRetryGoogleStatsIntegration,
  isGoogleStatsRefreshRetryDeferred,
  isGoogleStatsSiteBindingConnected,
} from "../../lib/googleStatsConnectionPolicy.ts";

test("a runtime Google refresh failure cannot turn a saved site binding off", () => {
  const row = {
    status: "disconnected",
    refresh_token_enc: "still-stored",
    meta: {
      needs_reconnect: true,
      needs_reconnect_reason: "google_refresh_token_invalid",
    },
  };

  assert.equal(isGoogleStatsSiteBindingConnected({ row, settingsConnected: true }), true);
  assert.equal(canRetryGoogleStatsIntegration(row), true);
});

test("the explicit Disconnect action still wins", () => {
  const row = {
    status: "disconnected",
    refresh_token_enc: null,
    meta: {},
  };

  assert.equal(isGoogleStatsSiteBindingConnected({ row, settingsConnected: false }), false);
  assert.equal(isGoogleStatsSiteBindingConnected({ row, settingsConnected: true }), false);
  assert.equal(canRetryGoogleStatsIntegration(row), false);
});

test("saved IDs alone cannot impersonate a Google connection", () => {
  assert.equal(isGoogleStatsSiteBindingConnected({ row: null, settingsConnected: true }), false);
  assert.equal(
    isGoogleStatsSiteBindingConnected({
      row: { status: "connected", access_token_enc: null, refresh_token_enc: null, meta: {} },
      settingsConnected: true,
    }),
    false,
  );
  assert.equal(
    isGoogleStatsSiteBindingConnected({
      row: { status: "connected", access_token_enc: "stored", refresh_token_enc: null, meta: {} },
      settingsConnected: true,
    }),
    true,
  );
});

test("a failed refresh is throttled without changing the business connection", () => {
  const now = Date.parse("2026-08-23T10:00:00.000Z");
  const row = {
    status: "connected",
    refresh_token_enc: "stored",
    meta: { google_stats_refresh_retry_at: "2026-08-23T10:15:00.000Z" },
  };

  assert.equal(isGoogleStatsSiteBindingConnected({ row, settingsConnected: true }), true);
  assert.equal(isGoogleStatsRefreshRetryDeferred(row, now), true);
  assert.equal(isGoogleStatsRefreshRetryDeferred(row, now + 16 * 60 * 1000), false);
});

test("GA4/GSC refresh failures no longer persist status=disconnected", () => {
  const source = readFileSync(new URL("../../lib/googleStats.ts", import.meta.url), "utf8");
  const softFailureStart = source.indexOf("async function markGoogleStatsRefreshFailure");
  const hardFailureStart = source.indexOf("async function markGoogleIntegrationDisconnected");
  const softFailure = source.slice(softFailureStart, hardFailureStart);

  assert.ok(softFailureStart >= 0);
  assert.match(softFailure, /status:\s*"connected"/);
  assert.doesNotMatch(softFailure, /status:\s*"disconnected"/);
  assert.match(source, /allowStatsRecovery:\s*true/);
  assert.match(source, /markGoogleStatsRefreshFailure\(row, effectiveUserId\)/);
});

test("Dashboard and iNrStats consume the same canonical site state", () => {
  const dashboard = readFileSync(new URL("../../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8");
  const foundations = readFileSync(new URL("../../app/dashboard/stats/stats.client-foundations.ts", import.meta.url), "utf8");
  const blocks = readFileSync(new URL("../../lib/inrstats/channelBlocks.ts", import.meta.url), "utf8");
  const state = readFileSync(new URL("../../lib/channelConnectionState.ts", import.meta.url), "utf8");

  assert.match(dashboard, /siteInrcyGa4Connected = states\?\.site_inrcy\?\.ga4 === true/);
  assert.match(dashboard, /siteWebGscConnected = states\?\.site_web\?\.gsc === true/);
  assert.doesNotMatch(dashboard, /states\?\.site_inrcy\?\.ga4 \|\| ga4MeasurementIdValue/);
  assert.match(foundations, /site_inrcy: states\.site_inrcy\?\.statsConnected === true/);
  assert.match(foundations, /site_web: states\.site_web\?\.statsConnected === true/);
  assert.doesNotMatch(foundations, /site_inrcy\?\.ga4 \|\|/);
  assert.match(blocks, /case 'site_inrcy':[\s\S]*connected: state\.statsConnected[\s\S]*connectionStatus: state\.statsConnected/);
  assert.match(state, /const inrcyStatsConnected = inrcyGa4 \|\| inrcyGsc/);
  assert.match(state, /const webStatsConnected = webGa4 \|\| webGsc/);
});

test("obsolete Google Stats connection overrides are gone", () => {
  const source = readFileSync(new URL("../../lib/googleStats.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /legacyOverrideDisconnected/);
  assert.doesNotMatch(source, /normStatus/);
});
