import assert from "node:assert/strict";
import test from "node:test";

import {
  DASHBOARD_OAUTH_CHANNELS,
  buildOfficialDashboardChannelState,
  hasCompleteOfficialDashboardChannelState,
  projectCanonicalChannelConnection,
} from "../../lib/dashboardChannelSync.ts";

const completePayload = () => ({
  gmb: { connected: true, accountConnected: true, configured: true, connection_status: "connected", resource_id: "locations/1" },
  facebook: { connected: true, accountConnected: true, pageConnected: true, connection_status: "connected", resource_id: "page-1" },
  instagram: { connected: true, accountConnected: true, connection_status: "connected", resource_id: "ig-1" },
  linkedin: { connected: true, accountConnected: true, connection_status: "connected", resource_id: "urn:li:person:1" },
  tiktok: { connected: true, connection_status: "connected", username: "demo" },
  youtube_shorts: { connected: true, connection_status: "connected", channel_url: "https://youtube.test/channel/1" },
  pinterest: { connected: true, connection_status: "connected" },
  mails: { connectedCount: 1, requiresUpdate: false },
});

for (const channel of DASHBOARD_OAUTH_CHANNELS) {
  test(`${channel}: canonical connected wins over a stale disconnected stats snapshot`, () => {
    const staleStatsSnapshot = { connected: false, statsConnected: false };
    const projection = projectCanonicalChannelConnection({
      connected: true,
      connectionStatus: "connected",
    });

    assert.equal(staleStatsSnapshot.connected, false);
    assert.deepEqual(projection, {
      bubbleStatus: "connected",
      boosterConnected: true,
      statsConnected: true,
      connectionStatus: "connected",
    });
  });

  test(`${channel}: canonical disconnected wins over a stale connected stats snapshot`, () => {
    const staleStatsSnapshot = { connected: true, statsConnected: true };
    const projection = projectCanonicalChannelConnection({
      connected: false,
      connectionStatus: "disconnected",
    });

    assert.equal(staleStatsSnapshot.connected, true);
    assert.deepEqual(projection, {
      bubbleStatus: "available",
      boosterConnected: false,
      statsConnected: false,
      connectionStatus: "disconnected",
    });
  });

  test(`${channel}: reconnect marker wins over every connected hint`, () => {
    const projection = projectCanonicalChannelConnection({
      connected: true,
      connectionStatus: "connected",
      requiresUpdate: true,
    });

    assert.deepEqual(projection, {
      bubbleStatus: "reconnect",
      boosterConnected: false,
      statsConnected: false,
      connectionStatus: "needs_update",
    });
  });
}

test("a provider expiry is always projected as reconnect", () => {
  assert.equal(projectCanonicalChannelConnection({ connected: true, expired: true }).bubbleStatus, "reconnect");
});

test("the complete canonical payload updates every dashboard channel in one atomic projection", () => {
  const projected = buildOfficialDashboardChannelState(completePayload());
  assert.ok(projected);
  assert.equal(hasCompleteOfficialDashboardChannelState(projected), true);
  assert.equal(projected.gmbConnected, true);
  assert.equal(projected.facebookPageConnected, true);
  assert.equal(projected.instagramConnected, true);
  assert.equal(projected.linkedinConnected, true);
  assert.equal(projected.tiktokConnected, true);
  assert.equal(projected.youtubeShortsConnected, true);
  assert.equal(projected.pinterestConnected, true);
  assert.equal(projected.mailAccountsConnectedCount, 1);
});

test("only a complete last-known snapshot may drive the first dashboard paint", () => {
  const projected = buildOfficialDashboardChannelState(completePayload());
  assert.equal(hasCompleteOfficialDashboardChannelState(projected), true);

  const partial = { ...projected };
  delete partial.facebookConnectionStatus;
  assert.equal(hasCompleteOfficialDashboardChannelState(partial), false);
  assert.equal(hasCompleteOfficialDashboardChannelState({ ...projected, mailAccountsConnectedCount: 99 }), false);
});

test("a partial server response is rejected instead of inventing false disconnections", () => {
  const partial = completePayload();
  delete (partial as Partial<typeof partial>).facebook;
  assert.equal(buildOfficialDashboardChannelState(partial), null);
});

test("needs_update always disables the corresponding dashboard channel", () => {
  const payload = completePayload();
  payload.youtube_shorts = { ...payload.youtube_shorts, connection_status: "needs_update" };
  const projected = buildOfficialDashboardChannelState(payload);
  assert.equal(projected?.youtubeShortsConnected, false);
  assert.equal(projected?.youtubeShortsRequiresUpdate, true);
});
