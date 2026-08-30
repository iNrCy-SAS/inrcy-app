import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  isOfficialPublicationChannelConnected,
  publicationChannelRequiresReconnect,
} from "../../lib/publicationChannelAvailability.ts";

const ROOT = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("the publication availability truth table is strict and shared", () => {
  assert.equal(isOfficialPublicationChannelConnected({ connected: true, connection_status: "connected" }), true);
  assert.equal(isOfficialPublicationChannelConnected({ connected: true, connection_status: "needs_update" }), false);
  assert.equal(isOfficialPublicationChannelConnected({ connected: false, connection_status: "connected" }), false);
  assert.equal(isOfficialPublicationChannelConnected(undefined), false);

  assert.equal(publicationChannelRequiresReconnect({ connected: false, expired: true }), true);
  assert.equal(publicationChannelRequiresReconnect({ connected: false, requiresUpdate: true }), true);
  assert.equal(publicationChannelRequiresReconnect({ connected: false, connection_status: "disconnected" }), false);
});

test("Google Business reconnect preserves the selected establishment for the same Google identity", () => {
  const callback = read("app/api/integrations/google-business/callback/route.ts");
  const state = read("lib/channelConnectionState.ts");
  const overview = read("lib/stats/buildOverview.ts");
  const googleStats = read("lib/googleStats.ts");

  assert.match(callback, /const sameGoogleIdentity = !existingEmail \|\| existingEmail === nextEmail/);
  assert.match(callback, /const preserveSelection = Boolean\([\s\S]*preservedLocationName && preservedAccountName/);
  assert.match(callback, /resource_id: preserveSelection \? preservedLocationName : null/);
  assert.match(callback, /status: preserveSelection \? "connected" : "account_connected"/);
  assert.match(state, /const gmbResourceId = asString\(gmb\.resource_id\) \|\| null/);
  assert.match(state, /const gmbAccountName = asString\(gmbMeta\.account\) \|\| asString\(gmbSettings\.accountName\)/);
  assert.match(overview, /const resourceId = String\(channelStates\.gmb\.resource_id \|\| ""\)\.trim\(\)/);
  assert.match(overview, /const preferredAccountName = channelStates\.gmb\.account_name/);
  assert.match(googleStats, /\.in\("status", \["connected", "account_connected"\]\)/);
});

test("iNrStats zeros unavailable channels and renders reconnect yellow versus disconnected gray", () => {
  const bulk = read("app/api/stats/dashboard-bulk/route.ts");
  const client = read("app/dashboard/stats/StatsClient.tsx");
  const ui = read("app/dashboard/stats/stats.ui.tsx");
  const css = read("app/dashboard/stats/stats.module.css");
  const foundations = read("app/dashboard/stats/stats.client-foundations.ts");
  const hooks = read("app/dashboard/stats/stats.client-hooks.ts");
  const inrSearchAnalytics = read("app/api/inr-search/analytics/route.ts");

  assert.match(bulk, /for \(const channel of DASHBOARD_CHANNEL_KEYS\)/);
  assert.match(bulk, /opportunities\.byCube\[channel\] = blocks\[channel\]\.opportunities/);
  assert.match(client, /status !== "connected"[\s\S]*next\[key as CubeKey\] = 0/);
  assert.match(client, /forceUnavailable/);
  assert.match(client, /reconnectRequired \? styles\.statsRailItemReconnect/);
  assert.match(ui, /styles\.cubeReconnect/);
  assert.match(ui, /styles\.pillReconnect/);
  assert.match(css, /\.statsRailItemReconnect/);
  assert.match(css, /\.cubeReconnect/);
  assert.match(css, /\.cubeOff \.pillOff[\s\S]*#c1c7d4/i);
  assert.doesNotMatch(foundations, /inr_search:\s*normalize\("inr_search"\)/);
  assert.doesNotMatch(foundations, /inr_search:\s*isUsable\("inr_search"\)/);
  assert.match(inrSearchAnalytics, /enabled: publicStatus\.published/);
  assert.match(foundations, /FAIL_CLOSED_STATS_CHANNEL_KEYS/);
  assert.match(foundations, /"unavailable"/);
  assert.match(hooks, /markOfficialChannelStatesUnavailable/);
  assert.match(hooks, /\.catch\(\(\) => markOfficialChannelStatesUnavailable\(requestSeq, accountScope\)\)/);
});

test("Booster applies connection and Bubble Access guards in UI, worker, and iNrSend", () => {
  const connectedRoute = read("app/api/booster/connected-channels/route.ts");
  const publishNow = read("app/api/booster/publish-now/route.ts");
  const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
  const inrSend = read("lib/inrsend/publicationChannelActions.ts");
  const bubbleServer = read("lib/appBubbleAccessServer.ts");

  const publicationChannels = ["site_inrcy", "site_web", "inr_search", "gmb", "facebook", "instagram", "linkedin", "tiktok", "youtube_shorts", "pinterest"];
  for (const key of publicationChannels) {
    assert.ok(connectedRoute.includes(`isBubbleEnabled(bubbleAccess, "${key}")`), `missing Bubble Access state for ${key}`);
    assert.ok(publishNow.includes(`${key === "site_inrcy" ? "inrcy_site" : key}: "${key}"`), `missing final Bubble Access mapping for ${key}`);
  }
  assert.match(publishNow, /const PUBLICATION_BUBBLE_KEYS: Record<ChannelKey, AppBubbleKey>/);
  assert.match(publishNow, /for \(const ch of selected\)[\s\S]*getChannelConnectionStates\(supabaseAdmin, userId\)[\s\S]*getAppBubbleAccessMapForUser\(supabaseAdmin as any, userId\)/);
  assert.match(publishNow, /if \(!isOfficialPublicationChannelConnected\(liveChannelState\)\)/);
  assert.match(publishNow, /if \(!isBubbleEnabled\(liveBubbleAccess, bubbleKey\)\)/);
  assert.match(publishNow, /code: "channel_state_unavailable"/);
  assert.match(modal, /\[key\]: connected\[key\] \? selected : false/);
  assert.match(modal, /window\.setInterval\(refreshConnectedChannels, 60_000\)/);
  assert.match(modal, /failClosedConnectedChannels\(\)/);
  assert.match(modal, /connectionStatus: "unavailable"/);
  assert.match(inrSend, /getAppBubbleAccessMapForUser\(supabaseAdmin, userId\)/);
  assert.match(inrSend, /if \(!isBubbleEnabled\(bubbleAccess, CHANNEL_BUBBLE_KEYS\[channel\]\)\)/);
  assert.match(inrSend, /const gmbState = publicationStates\.gmb/);
  assert.match(bubbleServer, /if \(error\) throw error/);
  assert.match(connectedRoute, /code: "channel_state_unavailable"[\s\S]*status: 503/);
});

test("OAuth display mirrors cannot authorize a channel without a canonical integration", () => {
  const state = read("lib/channelConnectionState.ts");
  const dashboard = read("app/dashboard/DashboardClient.tsx");

  assert.doesNotMatch(state, /:\s*Boolean\(fbSettings\.accountConnected\)/);
  assert.doesNotMatch(state, /:\s*Boolean\(igSettings\.accountConnected\)/);
  assert.doesNotMatch(state, /:\s*Boolean\(liSettings\.accountConnected \|\| liSettings\.connected\)/);
  assert.doesNotMatch(state, /:\s*Boolean\(gmbSettings\.connected \|\| gmbSettings\.accountEmail\)/);
  assert.doesNotMatch(state, /const fbResourceId =[^;]*fbSettings\.pageId/);
  assert.doesNotMatch(state, /const igResourceId =[^;]*igSettings\.(?:igId|pageId)/);
  assert.doesNotMatch(state, /const gmbResourceId =[^;]*gmbSettings\.locationName/);
  assert.match(state, /OAuth integrations are the only publication authority/);

  assert.match(dashboard, /fetch\("\/api\/integrations\/channel-states"/);
  assert.match(dashboard, /\.\.\.\(readCachedDashboardChannelState\(\) \?\? \{\}\)/);
  assert.match(dashboard, /A transient network failure must keep the last server-confirmed/);
  assert.doesNotMatch(dashboard, /instagramAccountConnected:\s*Boolean\(igObj/);
  assert.doesNotMatch(dashboard, /gmbConnected:\s*Boolean\(gmbObj/);
});

test("Dashboard and iNrStats continuously reconcile canonical state without stale-response rollback", () => {
  const dashboard = read("app/dashboard/DashboardClient.tsx");
  const statsHooks = read("app/dashboard/stats/stats.client-hooks.ts");
  const bubbles = read("app/dashboard/dashboard.flux-bubbles.ts");

  assert.match(dashboard, /officialChannelStatesRequestSeqRef/);
  assert.match(dashboard, /accountScope !== getActiveBrowserUserId\(\)/);
  assert.match(dashboard, /window\.setInterval\(refreshCanonicalState, 30_000\)/);
  assert.match(dashboard, /mergeCachedDashboardChannelState\(officialState\)/);
  assert.match(dashboard, /if \(Object\.keys\(cachePatch\)\.length\) mergeCachedDashboardChannelState\(cachePatch\)/);
  assert.match(dashboard, /resetAccountScopedDashboardState\(\)[\s\S]*void loadSiteInrcy\(\)/);

  assert.match(statsHooks, /channelStatesRequestSeq/);
  assert.match(statsHooks, /requestSeq === channelStatesRequestSeq/);
  assert.match(statsHooks, /accountScope === getActiveBrowserUserId\(\)/);

  assert.match(bubbles, /projectCanonicalChannelConnection\(officialConnection\)/);
  assert.doesNotMatch(bubbles, /getBubbleStatusFromBlock/);
  assert.doesNotMatch(bubbles, /blockDrivenStatus/);
});

test("iNrAgent uses the same official state and Bubble Access matrix as Booster", () => {
  const agent = read("app/api/agent/actions/prepare-publish/route.ts");
  assert.match(agent, /const bubbleKeyByChannel: Record<BoosterChannels, AppBubbleKey>/);
  assert.match(agent, /isOfficialPublicationChannelConnected\(states\.site_inrcy\)/);
  assert.match(agent, /isOfficialPublicationChannelConnected\(states\.gmb\)/);
  assert.match(agent, /isOfficialPublicationChannelConnected\(states\.youtube_shorts\)/);
  assert.match(agent, /isBubbleEnabled\(bubbleAccess, bubbleKeyByChannel\[channel\]\)/);
});

test("provider failures have native Vercel warning and error severity", () => {
  const logger = read("lib/observability/logger.ts");
  const state = read("lib/channelConnectionState.ts");
  assert.match(logger, /if \(level === "error"\) console\.error\(line\)/);
  assert.match(logger, /else if \(level === "warn"\) console\.warn\(line\)/);
  assert.match(state, /channel_connection_state_read_failed/);
  assert.match(state, /throw new Error\("Impossible de synchroniser l'état des canaux\."\)/);
});
