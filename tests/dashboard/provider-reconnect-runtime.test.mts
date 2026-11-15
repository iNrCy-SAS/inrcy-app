import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as policy from "../../lib/channelReconnectPolicy.ts";
import * as tsSafe from "../../lib/tsSafe.ts";
import { projectCanonicalChannelConnection } from "../../lib/dashboardChannelSync.ts";

const INVALIDATED_SESSION = "Error validating access token: The session has been invalidated because the user changed their password or Facebook has changed the session for security reasons.";
const oauthFailure = (channel: policy.OAuthPublicationChannel) => ({
  gmb: { error: { status: "UNAUTHENTICATED", code: 401, message: "Invalid authentication credentials." } },
  facebook: { error: { code: 190, error_subcode: 460, message: INVALIDATED_SESSION } },
  instagram: new Error(INVALIDATED_SESSION),
  threads: Object.assign(new Error("Reconnectez ce compte pour renouveler ses autorisations."), {
    code: "meta_direct_reconnect_required", status: 400, diagnostics: { httpStatus: 400, metaCode: 190, metaSubcode: 463 },
  }),
  linkedin: Object.assign(new Error("Provider rejected this request"), { statusCode: 401 }),
  tiktok: { error: { code: "scope_permission_missed", message: "Additional scopes needed." } },
  youtube_shorts: { error: { code: 403, errors: [{ reason: "insufficientPermissions" }] } },
  pinterest: { code: 2, message: "Authentication failed." },
  x: { status: 401, title: "Unauthorized" },
})[channel];

function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const code = ts.transpileModule(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  new Function("exports", "require", code)(exports, (id: string) => {
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected dependency: ${id}`);
    return dependencies[id];
  });
  return exports as T;
}

type Row = { id: string; meta: Record<string, unknown> | null; updated_at: string | null };
type MarkerArgs = { channel: policy.OAuthPublicationChannel; userId: string; error: unknown; stage: string; attemptStartedAt: string };
const START = "2026-11-04T09:00:00.000Z";
const versions = load<typeof import("../../lib/connectionVersions.ts")>("lib/connectionVersions.ts", { "@/lib/tsSafe": tsSafe });
const row = (): Row => ({ id: "same-account-integration", meta: { connection_version_updated_at: "2026-11-03T10:19:22.907Z", retained_setting: "keep-me" }, updated_at: "2026-11-03T10:19:22.907Z" });

function harness(initial: Row | null = row(), options: { concurrentReconnect?: boolean; updateError?: boolean; throws?: boolean } = {}) {
  let stored = initial ? structuredClone(initial) : null;
  const filters: Array<[string, unknown]> = [];
  const updates: Array<Record<string, unknown>> = [];
  let writing = false;
  const query = {
    select() { return this; }, order() { return this; }, limit() { return this; },
    eq(key: string, value: unknown) { filters.push([key, value]); return this; },
    is(key: string, value: unknown) { filters.push([key, value]); return this; },
    update(value: Record<string, unknown>) {
      writing = true;
      updates.push(value);
      if (options.concurrentReconnect) stored = { ...row(), meta: { connection_version_updated_at: "2026-11-04T10:00:00.000Z" } };
      return this;
    },
    async maybeSingle() {
      if (options.throws) throw new Error("Database temporarily unreachable");
      if (!writing) return { data: stored ? structuredClone(stored) : null, error: null };
      if (options.updateError) return { data: null, error: { code: "database_unavailable" } };
      const metadata = filters.find(([key]) => key === "meta")?.[1];
      const updatedAt = filters.find(([key]) => key === "updated_at")?.[1];
      if (!stored || metadata !== (stored.meta == null ? null : JSON.stringify(stored.meta)) || updatedAt !== stored.updated_at) return { data: null, error: null };
      stored = { ...stored, ...updates.at(-1) } as Row;
      return { data: { id: stored.id }, error: null };
    },
  };
  const diagnostics = load<{
    markPublishChannelReconnectRequired(args: MarkerArgs): Promise<boolean>;
  }>("lib/channelPublishDiagnostics.ts", {
    "server-only": {}, "@/lib/observability/logger": { log: { warn() {} } },
    "@/lib/supabaseAdmin": { supabaseAdmin: { from: () => query } },
    "@/lib/userFacingErrors": {}, "@/lib/publicationErrorFrench": {},
    "@/lib/channelReconnectPolicy": policy, "@/lib/googleBusinessPostTransport": {},
  });
  return { diagnostics, filters, updates, current: () => stored };
}

for (const channel of policy.OAUTH_PUBLICATION_CHANNELS) {
  test(`${channel}: provider refusal persists a warning for this account and projects orange`, async () => {
    const h = harness();
    const marked = await h.diagnostics.markPublishChannelReconnectRequired({ channel, userId: "account-A", error: oauthFailure(channel), stage: "publish", attemptStartedAt: START });
    assert.equal(marked, true);
    assert.equal(h.current()?.meta?.needs_reconnect, true);
    assert.equal(h.current()?.meta?.retained_setting, "keep-me");
    assert.ok(h.filters.some(([key, value]) => key === "user_id" && value === "account-A"));
    assert.ok(h.filters.some(([key, value]) => key === "source" && value === channel));
    const kind = `channel:${channel}` as const;
    const status = versions.getConnectionDisplayStatus(true, kind, h.current()?.meta);
    assert.equal(status, "needs_update");
    const projection = projectCanonicalChannelConnection({ connected: true, connectionStatus: status });
    assert.equal(projection.bubbleStatus, "reconnect");
    assert.equal(projection.boosterConnected, false);
    const renewedMeta = versions.withCurrentConnectionVersion(kind, h.current()?.meta);
    assert.equal(renewedMeta.retained_setting, "keep-me");
    assert.equal(renewedMeta.needs_reconnect, undefined);
    const renewedStatus = versions.getConnectionDisplayStatus(true, kind, renewedMeta);
    assert.equal(renewedStatus, "connected");
    assert.equal(projectCanonicalChannelConnection({ connected: true, connectionStatus: renewedStatus }).boosterConnected, true);
  });
  test(`${channel}: transient failures never expire a healthy connection`, async () => {
    for (const error of [new Error("HTTP 502 Bad Gateway"), new Error("HTTP 429 quota exceeded"), new Error("auth_session_missing"), new Error("Unauthenticated"), new Error("Media URL fetch HTTP 401 Unauthorized")]) {
      const h = harness();
      assert.equal(await h.diagnostics.markPublishChannelReconnectRequired({ channel, userId: "account-A", error, stage: "publish", attemptStartedAt: START }), false);
      assert.equal(h.updates.length, 0);
    }
  });
}

test("safe Meta permission diagnostics count as refusal, but OAuthException quotas do not", () => {
  for (const channel of ["facebook", "instagram", "threads"] as const) {
    for (const metaCode of [10, 102, 190, 200]) {
      assert.equal(policy.isProviderReconnectRequired({ channel, error: Object.assign(new Error("Message contrôlé."), { diagnostics: { metaCode } }), stage: "stats_provider_metrics" }), true);
    }
    for (const code of [4, 17, 32, 613]) {
      assert.equal(policy.isProviderReconnectRequired({ channel, error: { error: { code, type: "OAuthException", message: "Application request limit reached" } }, stage: "publish" }), false);
    }
  }
});

test("a late failure cannot mark an OAuth connection created after the failed attempt", async () => {
  const updated = row();
  updated.meta = { connection_version_updated_at: "2026-11-04T10:00:00.000Z" };
  const h = harness(updated);
  assert.equal(await h.diagnostics.markPublishChannelReconnectRequired({ channel: "instagram", userId: "account-A", error: INVALIDATED_SESSION, stage: "publish", attemptStartedAt: START }), false);
  assert.equal(h.updates.length, 0);
});

test("a reconnection between marker read and write wins atomically", async () => {
  const h = harness(row(), { concurrentReconnect: true });
  assert.equal(await h.diagnostics.markPublishChannelReconnectRequired({ channel: "instagram", userId: "account-A", error: INVALIDATED_SESSION, stage: "publish", attemptStartedAt: START }), false);
  assert.equal(h.current()?.meta?.connection_version_updated_at, "2026-11-04T10:00:00.000Z");
  assert.equal(h.current()?.meta?.needs_reconnect, undefined);
});

test("missing integration, database failure and existing warning do not mask the provider error", async () => {
  for (const h of [harness(null), harness(row(), { updateError: true }), harness(row(), { throws: true })]) {
    assert.equal(await h.diagnostics.markPublishChannelReconnectRequired({ channel: "instagram", userId: "account-A", error: INVALIDATED_SESSION, stage: "publish", attemptStartedAt: START }), false);
  }
  const existing = row();
  existing.meta!.needs_reconnect = true;
  const h = harness(existing);
  assert.equal(await h.diagnostics.markPublishChannelReconnectRequired({ channel: "instagram", userId: "account-A", error: INVALIDATED_SESSION, stage: "publish", attemptStartedAt: START }), true);
  assert.equal(h.updates.length, 0, "an existing warning does not create repeated realtime writes");
});

test("live Pinterest metrics propagate a refused credential through cached stats without deleting local publication counts", async () => {
  const shared = load<typeof import("../../lib/stats/buildOverview.shared.ts")>("lib/stats/buildOverview.shared.ts", {
    "server-only": {}, "@/lib/stats/overviewPreservation": {},
  });
  for (const error of [new Error("Pinterest access token is invalid"), new Error("HTTP 502 Bad Gateway"), new Error("HTTP 403 quota exceeded")]) {
    const h = harness();
    const live = load<typeof import("../../lib/stats/buildOverview.liveSources.ts")>("lib/stats/buildOverview.liveSources.ts", {
      "server-only": {},
      "@/lib/userFacingErrors": { getSimpleFrenchErrorMessage: (_error: unknown, fallback: string) => fallback },
      "@/lib/pinterestOAuth": { getPinterestAccessToken: async () => "synthetic-token" },
      "@/lib/pinterestAnalytics": { fetchPinterestAnalyticsSnapshot: async () => { throw error; } },
      "@/lib/channelConnectionState": {},
      "@/lib/channelPublishDiagnostics": h.diagnostics,
      "@/lib/stats/buildOverview.shared": shared,
    });
    const state = { pinterest: { connected: true, requiresUpdate: false } };
    const tools = live.createOverviewLiveSourceTools({
      channelStatesPromise: Promise.resolve(state) as Parameters<typeof live.createOverviewLiveSourceTools>[0]["channelStatesPromise"],
      bestIntegrationAny: () => ({}), hasFacebookStoredToken: () => false, hasActiveStoredIntegration: () => false,
      userId: "account-A", attemptStartedAt: START, startDateYmd: "2026-11-01", endDateYmd: "2026-11-04",
      pinterestLocalPublicationStats: { posts: 4, photoPosts: 3, photos: 5, latestAt: null },
      includeAll: true, includeSet: new Set(),
    });
    const result = await tools.hydratePinterestMetricsOnPayload({ sources: { pinterest: { connected: true, metrics: { stale: true } } } });
    const source = shared.asRecord(shared.asRecord(result.sources).pinterest);
    const metrics = shared.asRecord(source.metrics);
    const refused = error.message.includes("token");
    assert.equal(source.connected, !refused);
    assert.equal(metrics.needs_reconnect, refused);
    assert.equal(shared.asRecord(metrics.totals).inrcy_posts, 4);
    assert.equal(h.current()?.meta?.needs_reconnect === true, refused);
  }
});

const overviewSource = ts.createSourceFile("overview.ts", readFileSync(new URL("../../lib/stats/buildOverview.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
function overviewSnippet(match: (node: ts.Node) => boolean) {
  let found: ts.Node | undefined;
  function visit(node: ts.Node) { if (!found && match(node)) found = node; ts.forEachChild(node, visit); }
  visit(overviewSource);
  assert.ok(found, "the real overview stage must remain present");
  return found.getText(overviewSource);
}
const refusalStage = overviewSnippet(node => ts.isFunctionDeclaration(node) && node.name?.text === "recordProviderRefusal");
const threadsStage = overviewSnippet(node => ts.isIfStatement(node) && node.expression.getText(overviewSource) === "metaPilotEnabled && sourcesStatus.threads");
const refusalProjection = overviewSnippet(node => ts.isForOfStatement(node) && node.expression.getText(overviewSource) === "providerReconnectRequired");

async function runReturnedStats(metrics: Record<string, unknown>, channel: "threads" | "linkedin", options: { concurrentReconnect?: boolean } = {}) {
  const h = harness(row(), options);
  const sourcesStatus = { [channel]: { connected: true, metrics } };
  const body = ts.transpileModule(`async function run() {
    const providerReconnectRequired = new Set();
    ${refusalStage}
    ${channel === "threads" ? threadsStage : 'await recordProviderRefusal("linkedin", sourcesStatus.linkedin.metrics);'}
    ${refusalProjection}
    return sourcesStatus;
  }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const result = await new Function("sourcesStatus", "markPublishChannelReconnectRequired", "fetchThreadsAccountInsights", `
    const userId = "account-A", attemptStartedAt = "${START}", metaPilotEnabled = true, includeAll = true;
    const includeSet = new Set(), supabaseAdmin = {}, dateWindow = { start: new Date(), end: new Date() };
    const channelStates = { threads: { connected: true } };
    const isStatsActiveConnection = value => value.connected;
    const bestIntegrationAny = () => ({ resource_id: "fixture-account" });
    const ensureMetaDirectAccessToken = async () => "fixture-token";
    const asRecord = value => value && typeof value === "object" ? value : {};
    const getSimpleFrenchErrorMessage = () => "Statistiques indisponibles.";
    ${body}
    return run();
  `)(sourcesStatus, h.diagnostics.markPublishChannelReconnectRequired, async () => metrics);
  return { result, h };
}

test("returned Threads token invalidation reaches the real overview marker and orange state", async () => {
  const metrics = { error: "Les statistiques Threads ne sont pas disponibles pour ce compte ou cette période.",
    totals: {}, availableMetrics: [], raw: { metricErrors: { account: { views: INVALIDATED_SESSION, likes: INVALIDATED_SESSION } } } };
  const { result, h } = await runReturnedStats(metrics, "threads");
  assert.equal(h.current()?.meta?.needs_reconnect, true);
  assert.equal(result.threads.connected, false);
  assert.equal(result.threads.metrics.needs_reconnect, true);
  assert.deepEqual(result.threads.metrics.totals, {}, "unavailable observations never become measured zeroes");
  assert.equal(result.threads.metrics.error, metrics.error);
});

test("returned LinkedIn Could not authenticate persists the same provider warning", async () => {
  const metrics = { error: "Impossible de récupérer les statistiques LinkedIn pour le moment.",
    raw: { errors: ["member:memberFollowers:Could not authenticate"] } };
  const { result, h } = await runReturnedStats(metrics, "linkedin");
  assert.equal(h.current()?.meta?.needs_reconnect, true);
  assert.equal(result.linkedin.connected, false);
  assert.equal(result.linkedin.metrics.needs_reconnect, true);
});

test("partial observations, missing metrics and quota failures keep healthy provider connections", async () => {
  for (const [channel, metrics] of [
    ["threads", { totals: { views: 5 }, availableMetrics: ["views"], raw: { metricErrors: { account: { clicks: "Unsupported metric clicks" } } } }],
    ["threads", { totals: {}, error: "Statistiques indisponibles.", raw: { metricErrors: { account: { views: "HTTP 429 quota exceeded" } } } }],
    ["linkedin", { totals: { impressionCount: 25 }, raw: { errors: ["organization:Aucune métrique LinkedIn exploitable."] } }],
    ["linkedin", { error: "Statistiques indisponibles.", raw: { errors: ["member:Aucune métrique LinkedIn membre exploitable."] } }],
  ] as const) {
    const original = structuredClone(metrics);
    const { result, h } = await runReturnedStats(metrics, channel);
    assert.equal(h.updates.length, 0);
    assert.equal(result[channel].connected, true);
    assert.deepEqual(result[channel].metrics, original, "available partial source data remains intact");
  }
});

test("a newer reconnection still wins over a returned stale provider refusal", async () => {
  const { result, h } = await runReturnedStats({ error: INVALIDATED_SESSION, totals: {} }, "threads", { concurrentReconnect: true });
  assert.equal(result.threads.connected, true);
  assert.equal(result.threads.metrics.needs_reconnect, undefined);
  assert.equal(h.current()?.meta?.needs_reconnect, undefined);
});
