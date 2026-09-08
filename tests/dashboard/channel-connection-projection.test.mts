import assert from "node:assert/strict";
import test from "node:test";

import {
  DASHBOARD_BOOT_CHANNELS,
  DASHBOARD_OAUTH_CHANNELS,
  buildOfficialDashboardChannelState,
  hasCompleteOfficialDashboardChannelState,
  mergeDashboardHydrationState,
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
  x: { connected: true, connection_status: "connected", username: "inrcy", profile_url: "https://x.com/inrcy" },
  inr_search: { connected: true, connection_status: "connected", profile_url: "https://app.inrcy.test/entreprises/inrcy", directory_enabled: true },
  mails: { connectedCount: 1, requiresUpdate: false },
});

test("the first-paint projection covers every dashboard boot channel", () => {
  assert.deepEqual(DASHBOARD_BOOT_CHANNELS, [...DASHBOARD_OAUTH_CHANNELS, "inr_search"]);
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
  assert.equal(projected.xConnected, true);
  assert.equal(projected.xProfileUrl, "https://x.com/inrcy");
  assert.equal(projected.inrSearchConnected, true);
  assert.equal(projected.inrSearchUrl, "https://app.inrcy.test/entreprises/inrcy");
  assert.equal(projected.inrSearchDirectoryEnabled, true);
  assert.equal(projected.mailAccountsConnectedCount, 1);
});

test("server-confirmed boot state wins over a stale browser snapshot for every channel", () => {
  const official = buildOfficialDashboardChannelState(completePayload());
  assert.ok(official);
  const stale = Object.fromEntries(Object.entries(official).map(([key, value]) => {
    if (typeof value === "boolean") return [key, !value];
    if (typeof value === "number") return [key, value + 1];
    return [key, `stale:${String(value)}`];
  }));
  const hydrated = mergeDashboardHydrationState({
    ...stale,
    localDisplayPreference: "preserved",
  }, official);

  for (const [key, value] of Object.entries(official)) {
    assert.equal(hydrated?.[key], value, `${key} must come from the server projection`);
  }
  assert.equal(hydrated?.xConnected, true, "X is server-confirmed on first paint");
  assert.equal(hydrated?.inrSearchConnected, true, "iNrSearch is server-confirmed on first paint");
  assert.equal(hydrated?.localDisplayPreference, "preserved");
});

test("only a complete last-known snapshot may drive the first dashboard paint", () => {
  const projected = buildOfficialDashboardChannelState(completePayload());
  assert.equal(hasCompleteOfficialDashboardChannelState(projected), true);

  const partial = { ...projected };
  delete partial.facebookConnectionStatus;
  assert.equal(hasCompleteOfficialDashboardChannelState(partial), false);
  assert.equal(hasCompleteOfficialDashboardChannelState({ ...projected, inrSearchConnected: undefined }), false);
  assert.equal(hasCompleteOfficialDashboardChannelState({ ...projected, inrSearchDirectoryEnabled: undefined }), false);
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
