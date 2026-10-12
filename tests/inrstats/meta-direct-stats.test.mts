/* eslint-disable @typescript-eslint/no-explicit-any -- Runtime-transpiled modules and fluent fixtures intentionally expose dynamic shapes. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import * as crypto from "node:crypto";
import ts from "typescript";

function load<T = Record<string, any>>(file: string, dependencies: Record<string, unknown> = {}): T {
  const code = ts.transpileModule(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  new Function("exports", "require", code)(exports, (id: string) => {
    if (id === "server-only") return {};
    assert.ok(id in dependencies, `Unexpected dependency: ${id}`);
    return dependencies[id];
  });
  return exports as T;
}
const graph = load("lib/metaGraphApi.ts");
const instagramAuth = load("lib/instagramAuthMode.ts", { "@/lib/metaGraphApi": graph });
const threadsGraph = load("lib/threadsGraphApi.ts");
const threads = load("lib/threadsInsights.ts", { "@/lib/threadsGraphApi": threadsGraph });
const pilotData = load("lib/stats/metaPilotData.ts");
const start = new Date("2026-09-01T00:00:00Z"), end = new Date("2026-10-01T00:00:00Z");
async function withFetch(fake: typeof fetch, body: () => Promise<void>) {
  const previous = globalThis.fetch; globalThis.fetch = fake;
  try { await body(); } finally { globalThis.fetch = previous; }
}

test("Instagram direct and legacy tokens use their respective versioned hosts", async () => {
  const metrics = load("lib/metaInsights.ts", { "@/lib/instagramAuthMode": instagramAuth });
  for (const [mode, host] of [["instagram_login", "graph.instagram.com"], ["facebook_login", "graph.facebook.com"]]) {
    const urls: URL[] = [];
    await withFetch(async (input) => {
      const url = new URL(String(input)); urls.push(url);
      const name = url.searchParams.get("metric");
      return Response.json({ data: name === "views" ? [{ name, total_value: { value: 37 } }] : [] });
    }, async () => {
      const snapshot = await metrics.igFetchDailyInsights("fixture-token", "business-17", start, end, mode);
      assert.equal(snapshot.totals.views, 37);
      assert.deepEqual(snapshot.daily, [], "A range total must not masquerade as a daily sample");
      assert.equal(snapshot.totals.likes, undefined);
      assert.ok(snapshot.raw.unsupportedMetrics.account.includes("likes"));
    });
    assert.ok(urls.length > 0);
    assert.ok(urls.every(url => url.host === host && /^\/v\d+\.\d+\/business-17\/insights$/.test(url.pathname)));
  }
  assert.equal(instagramAuth.resolveInstagramAuthMode({}), "facebook_login");
});

test("Threads account periods preserve true zero, missing metrics, daily views and current audience", () => {
  const snapshot = threads.normalizeThreadsInsights([
    { name: "views", values: [{ value: 11, end_time: "2026-09-02T00:00:00Z" }, { value: 9, end_time: "2026-09-03T00:00:00Z" }, { value: 99, end_time: "2026-10-02T00:00:00Z" }] },
    { name: "likes", total_value: { value: 0 } },
    { name: "replies", total_value: { value: 4 } },
    { name: "clicks", link_total_values: [{ value: 3 }, { value: 7 }] },
    { name: "followers_count", total_value: { value: 123 } },
    { name: "quotes", values: [] },
  ], start, end);
  assert.deepEqual(snapshot.totals, { views: 20, likes: 0, replies: 4, clicks: 10 });
  assert.deepEqual(snapshot.audience, { followers_count: 123 });
  assert.equal(snapshot.daily.length, 2);
  assert.ok(snapshot.daily.every((row: any) => Object.keys(row.values).join() === "views"));
  assert.equal(snapshot.totals.followers_count, undefined, "Current follower stock is not period demand");
  assert.equal(snapshot.totals.quotes, undefined);
});

test("Threads partial API errors do not erase supported period metrics or create fake zeroes", async () => {
  const urls: URL[] = [];
  await withFetch(async (input, init) => {
    const url = new URL(String(input)); urls.push(url);
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer fixture-token");
    assert.equal(url.searchParams.has("access_token"), false);
    const name = url.searchParams.get("metric");
    if (name === "likes") return Response.json({ error: { message: "Permission unavailable" } }, { status: 403 });
    if (name === "views") return Response.json({ data: [{ name, values: [{ value: 10, end_time: "2026-09-02T00:00:00Z" }] }] });
    if (name === "followers_count") return Response.json({ data: [{ name, total_value: { value: 91 } }] });
    return Response.json({ data: [] });
  }, async () => {
    const snapshot = await threads.fetchThreadsAccountInsights("fixture-token", "thread-user", start, end);
    assert.equal(snapshot.totals.views, 10);
    assert.equal(snapshot.totals.likes, undefined);
    assert.ok(snapshot.raw.unsupportedMetrics.account.includes("likes"));
    assert.equal(snapshot.error, undefined);
  });
  assert.ok(urls.every(url => url.host === "graph.threads.com" && url.pathname === "/v1.0/thread-user/threads_insights" && url.searchParams.get("since") === String(start.getTime() / 1000) && url.searchParams.get("until") === String(end.getTime() / 1000)));
});

test("A completely unavailable Threads API returns explicit unavailability, not a zero snapshot", async () => {
  await withFetch(async () => Response.json({ error: { message: "Missing insights scope" } }, { status: 403 }), async () => {
    const snapshot = await threads.fetchThreadsAccountInsights("fixture-token", "thread-user", start, end);
    assert.deepEqual(snapshot.totals, {});
    assert.ok(snapshot.error);
    assert.equal(snapshot.raw.supportedMetrics.account.length, 0);
  });
});

test("Post insights are labeled lifetime and never fabricate period days", async () => {
  await withFetch(async (input) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/v1.0/post-17/insights");
    assert.equal(url.searchParams.has("since"), false);
    return Response.json({ data: [{ name: "views", period: "lifetime", values: [{ value: 501 }] }, { name: "shares", values: [{ value: 7 }] }] });
  }, async () => {
    const snapshot = await threads.fetchThreadsMediaInsights("fixture-token", "post-17");
    assert.equal(snapshot.scope, "media_lifetime");
    assert.deepEqual(snapshot.totals, { views: 501, shares: 7 });
    assert.deepEqual(snapshot.daily, []);
  });
});

test("Threads content pagination deduplicates and respects both dates without following arbitrary URLs", async () => {
  let calls = 0;
  await withFetch(async (input) => {
    const url = new URL(String(input)); assert.equal(url.host, "graph.threads.com"); calls++;
    const post = { id: "post", timestamp: "2026-09-10T00:00:00Z", text: "Owned content" };
    return Response.json(calls === 1 ? { data: [post, { id: "older", timestamp: "2026-08-01T00:00:00Z" }], paging: { next: "https://untrusted.example/token", cursors: { after: "safe-cursor" } } } : { data: [post, { id: "second", timestamp: "2026-09-12T00:00:00Z" }, { id: "future", timestamp: "2026-10-03T00:00:00Z" }] });
  }, async () => {
    assert.deepEqual((await threads.fetchThreadsContent("fixture-token", "thread-user", start, end)).map((post: any) => post.id), ["post", "second"]);
  });
  assert.equal(calls, 2);
});

test("Pilot server gate requires an ADMIN actor and ADMIN account and fails closed for staff/read errors", async () => {
  for (const actorAdmin of [false, true]) for (const role of ["user", "staff", "admin"]) {
    const gate = load("lib/metaChannelRolloutServer.ts", {
      "next/server": { NextResponse: { json: () => ({}) } },
      "@/lib/roles": { ADMIN_USER_IDS: [], getMyRole: async () => ({ isAdmin: actorAdmin }) },
      "@/lib/metaChannelRollout": { META_DIRECT_CHANNELS_PUBLIC_ENABLED: false },
    });
    const query = { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { role }, error: null }; } };
    assert.equal(await gate.isMetaChannelPilotEnabledForActorAndAccount({ from: () => query }, "account"), actorAdmin && role === "admin");
    assert.equal(await gate.isMetaChannelPilotEnabledForAccount({ from: () => ({ ...query, maybeSingle: async () => ({ data: { role: "admin" }, error: { message: "RLS denied" } }) }) }, "account"), false);
  }
});

test("Pilot projection stripping covers cache maps, camelCase states and channel arrays", () => {
  const input = { sources: { instagram: { connected: true }, threads: { connected: true, metrics: { totals: { views: 999 } } } }, blocks: { threads: { opportunities: 50 }, instagram: {} }, threadsConnected: true, selected: ["instagram", "threads"], channels: [{ key: "threads", url: "https://www.threads.com/@private" }, { key: "instagram" }] };
  const user = pilotData.withoutThreadsData(input, false);
  assert.equal(JSON.stringify(user).includes("threads"), false);
  assert.equal(user.sources.instagram.connected, true);
  assert.equal(pilotData.withoutThreadsData(input, true), input);
});

test("USER requests never fetch a Threads cube; ADMIN-to-USER does not reuse the in-memory pilot cache", async () => {
  let enabled = true; const calls: string[] = [];
  const metrics = load("lib/metrics/computeMetrics.ts", {
    "@/lib/stats/buildOverview": { buildStatsOverview: async (args: any) => { calls.push(args.includeRaw); return { days: args.days, sources: { [args.includeRaw]: { connected: true, metrics: { totals: { views: 100 } } } } }; } },
    "@/lib/stats/buildOverview.activity": { createInrcyPublishedActivityLoader: () => async () => ({}) },
    "@/lib/stats/cacheSchema": { INRCY_STATS_CACHE_SCHEMA_VERSION: "fixture" },
    "@/lib/metaChannelRolloutServer": { isMetaChannelPilotEnabledForAccount: async () => enabled },
    "@/lib/stats/metaPilotData": pilotData,
  });
  const admin = await metrics.fetchCubeOverviews({ supabase: {}, userId: "same-account", days: 30 });
  assert.ok(admin.threads); assert.ok(calls.includes("threads")); calls.length = 0; enabled = false;
  const user = await metrics.fetchCubeOverviews({ supabase: {}, userId: "same-account", days: 30 });
  assert.equal(user.threads, undefined); assert.equal(calls.includes("threads"), false);
  assert.equal(JSON.stringify(user).includes("threads"), false);
  assert.equal(metrics.computeCapturedForCube("threads", { days: 30, sources: { threads: { connected: true, metrics: { audience: { followers_count: 1000000 }, media: { totals: { views: 1000000 } } } } } }), 0);
});

test("Public Badge rejects forged USER Threads actions and excludes historic pilot actions from USER statistics", async () => {
  for (const enabled of [false, true]) {
    let inserted = 0;
    const badge = load("lib/inrBadgeAnalytics.ts", { "node:crypto": crypto, "@/lib/stats/metaPilotData": pilotData, "@/lib/metaChannelRolloutServer": { isMetaChannelPilotEnabledForAccount: async () => enabled } });
    const query = { select() { return this; }, eq() { return this; }, gte() { return this; }, order() { return this; }, async limit() { return { data: [{ event_type: "action_click", action_key: "threads", created_at: new Date().toISOString() }, { event_type: "action_click", action_key: "instagram", created_at: new Date().toISOString() }], error: null }; }, async insert() { inserted++; return { error: null }; } };
    const snapshot = await badge.readInrBadgeStats({ from: () => query }, "owner");
    assert.equal(snapshot.actions.month, enabled ? 2 : 1);
    assert.equal(snapshot.actionsByKey.threads?.month, enabled ? 1 : undefined);
    const recorded = await badge.recordInrBadgeEvent({ from: () => query }, { userId: "owner", slug: "public-badge", eventType: "action_click", actionKey: "threads" });
    assert.equal(recorded.ok, enabled); assert.equal(inserted, enabled ? 1 : 0);
  }
});

test("Pilot channel weights stay fixed and inertia excludes Threads from USER denominators", () => {
  const setup = load("app/dashboard/dashboard.channel-setup.ts");
  assert.equal(setup.getDashboardChannelSetup(false).some((channel: any) => channel.key === "threads"), false);
  const basePower = setup.getDashboardChannelPowerSetup(false).reduce((sum: number, row: any) => sum + row.weight, 0);
  const adminPower = setup.getDashboardChannelPowerSetup(true);
  assert.equal(basePower, 96);
  assert.equal(adminPower.reduce((sum: number, row: any) => sum + row.weight, 0), 100);
  assert.equal(adminPower.find((row: any) => row.key === "threads").weight, 4);
  const inertia = load("lib/loyalty/inertia.ts");
  const input = { site_web: false, gmb: false, facebook: false, instagram: false, linkedin: false, x: false, tiktok: false, youtube_shorts: false };
  assert.equal(inertia.computeInertiaSnapshot(input).totalChannels, 8);
  assert.equal(inertia.computeInertiaSnapshot({ ...input, threads: true }).totalChannels, 9);
  assert.equal(inertia.computeInertiaSnapshot({ ...input, threads: true }).multiplier, 1.5);
});

test("Threads public URL accepts a profile on official domains and rejects posts/other hosts", () => {
  const urls = load("lib/channelPublicUrl.ts");
  for (const url of ["https://www.threads.com/@business", "https://www.threads.net/@business"]) assert.equal(urls.normalizeChannelPublicUrl("threads", url).ok, true);
  for (const url of ["https://www.threads.com/@business/post/123", "https://evil.threads.com/@business", "https://threads.com.evil.test/@business"]) assert.equal(urls.normalizeChannelPublicUrl("threads", url).ok, false);
});

test("Canonical state retains legacy Instagram and blocks expired direct tokens and USER pilot identities", async () => {
  const safe = load("lib/tsSafe.ts");
  const stateModule = (enabled: boolean) => load("lib/channelConnectionState.ts", {
    "@/lib/tsSafe": safe,
    "@/lib/connectionVersions": { getConnectionDisplayStatus: (connected: boolean, _kind: string, meta: any) => meta?.needs_reconnect ? "needs_update" : connected ? "connected" : "disconnected", mailConnectionKind: () => "mail" },
    "@/lib/supabaseAdmin": { supabaseAdmin: {} },
    "@/lib/tiktokSettings": { normalizeTiktokSettings: () => ({}) },
    "@/lib/tiktokOAuth": { buildTiktokProfileUrl: () => null },
    "@/lib/youtubeShortsOAuth": { applyYoutubeShortsIntegrationState: () => ({ connected: false }) },
    "@/lib/publicationChannelAvailability": { hasUsableRefreshCredential: () => false },
    "@/lib/pinterestOAuth": { getPinterestApiEnvironment: () => "production" },
    "@/lib/observability/logger": { log: { error() {}, info() {}, warn() {} } },
    "@/lib/googleStatsConnectionPolicy": { isGoogleStatsSiteBindingConnected: () => false },
    "@/lib/instagramAuthMode": instagramAuth,
    "@/lib/metaChannelRolloutServer": { isMetaChannelPilotEnabledForAccount: async () => enabled },
  });
  const expired = new Date(Date.now() - 3600000).toISOString();
  const ig = { provider: "instagram", source: "instagram", product: "instagram", resource_id: "ig-17", resource_label: "brand", access_token_enc: "encrypted-fixture", status: "connected", expires_at: expired };
  const legacy = await stateModule(false).getChannelConnectionStates({}, "account", { proToolsConfig: {}, integrations: [ig] });
  assert.equal(legacy.instagram.connected, true, "Legacy selected-profile semantics remain compatible");
  const direct = await stateModule(true).getChannelConnectionStates({}, "account", { proToolsConfig: {}, integrations: [{ ...ig, meta: { auth_mode: "instagram_login" } }] });
  assert.equal(direct.instagram.connected, false);
  assert.equal(direct.instagram.requiresUpdate, true);
  const thread = { provider: "threads", source: "threads", product: "threads", resource_id: "thread-17", resource_label: "private-user", access_token_enc: "encrypted-fixture", status: "connected" };
  const admin = await stateModule(true).getChannelConnectionStates({}, "account", { proToolsConfig: {}, integrations: [thread] });
  assert.equal(admin.threads.connected, true);
  assert.equal(admin.threads.profile_url, "https://www.threads.com/@private-user");
  const user = await stateModule(false).getChannelConnectionStates({}, "account", { proToolsConfig: {}, integrations: [thread] });
  assert.equal(user.threads.connected, false);
  assert.equal(user.threads.resource_id, null);
  assert.equal(user.threads.username, null);
  assert.equal(user.threads.profile_url, null);
  const forbiddenActor = await stateModule(true).getChannelConnectionStates({}, "account", { proToolsConfig: {}, integrations: [thread] }, { metaPilotEnabled: false });
  assert.equal(forbiddenActor.threads.connected, false);
});

test("Business DNA availability and GPS expose Threads only for a trusted pilot account", () => {
  const dna = load("lib/businessDnaChannelAvailability.ts");
  const states = { threads: { connected: true, connection_status: "connected" } };
  assert.equal(dna.buildBusinessDnaDashboardChannelAvailability({ channelStates: states }).some((row: any) => row.key === "threads"), false);
  assert.equal(dna.buildBusinessDnaDashboardChannelAvailability({ channelStates: states, metaPilotEnabled: true }).find((row: any) => row.key === "threads").status, "connected");
  const notice = load("app/dashboard/gps/noticeContent.ts");
  const gps = load("app/dashboard/gps/gpsEditionPolicy.ts", { "./noticeContent": notice });
  for (const edition of ["standard", "premium", "founder"]) {
    assert.equal(gps.getGpsSectionsForEdition(edition, false).flatMap((row: any) => row.articles).some((row: any) => row.id === "canaux-threads"), false);
    assert.equal(gps.getGpsSectionsForEdition(edition, true).flatMap((row: any) => row.articles).filter((row: any) => row.id === "canaux-threads").length, 1);
  }
});
