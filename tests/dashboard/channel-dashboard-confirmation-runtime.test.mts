/* eslint-disable @typescript-eslint/no-explicit-any -- isolated callbacks execute against controlled browser and network adapters */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import {
  buildOfficialDashboardChannelState,
  createLatestChannelResponseGate,
  hasCompleteOfficialDashboardChannelState,
  mergeDashboardHydrationState,
} from "../../lib/dashboardChannelSync.ts";

type Dict = Record<string, any>;
const source = ts.createSourceFile(
  "DashboardClient.tsx",
  readFileSync(new URL("../../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

// Extract the actual callback, rather than reimplementing its race handling.
function callbackSource(name: string) {
  let found: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer) {
      found = ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, `Missing dashboard callback ${name}`);
  return found.getText(source);
}

function callback(name: string, dependencies: Dict) {
  const code = ts.transpileModule(`const callback = (${callbackSource(name)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function(...Object.keys(dependencies), `${code}\nreturn callback;`)(...Object.values(dependencies));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function payload(connected = true) {
  const common = { connected, accountConnected: connected, configured: connected, connection_status: connected ? "connected" : "disconnected" };
  return {
    gmb: { ...common, resource_id: connected ? "locations/1" : null },
    facebook: { ...common, pageConnected: connected },
    instagram: { ...common },
    threads: { ...common, pilotEnabled: true },
    linkedin: { ...common },
    tiktok: { ...common },
    youtube_shorts: { ...common },
    pinterest: { ...common },
    x: { ...common },
    inr_search: { ...common },
    mails: { connectedCount: connected ? 1 : 0, requiresUpdate: false },
  };
}

function harness() {
  let account = "account-a";
  let cache: Dict = buildOfficialDashboardChannelState(payload())!;
  const ui: Dict = {};
  const snapshots: Dict[] = [];
  const notifications: unknown[][] = [];
  const appliedStates: Dict[] = [];
  const appliedStats: unknown[][] = [];
  const appliedGenerator: unknown[][] = [];
  const events: Event[] = [];
  const emptyBlock = (channel: string) => ({ channel, connection: {}, overview: null, opportunities: 0, capturedLeads: { week: 0, month: 0 }, estimatedValue: 0 });
  const dependencies: Dict = {
    window: { dispatchEvent: (event: Event) => { events.push(event); return true; } },
    officialChannelStatesRequestSeqRef: { current: 0 },
    channelResponseGateRef: { current: createLatestChannelResponseGate<string>() },
    confirmedChannelStateRef: { current: { ...cache } },
    confirmedChannelAccountRef: { current: account },
    canonicalChannelStatesReadyRef: { current: true },
    displayedGeneratorPowerAccountIdRef: { current: account },
    channelBlocksRef: { current: { gmb: { ...emptyBlock("gmb"), connection: { connected: true }, overview: { views: 9 }, opportunities: 3, capturedLeads: { week: 2, month: 4 }, estimatedValue: 12, error: "old error", live: true } } },
    createEmptyChannelBlocks: () => ({}),
    createEmptyChannelBlock: emptyBlock,
    buildOfficialDashboardChannelState,
    hasCompleteOfficialDashboardChannelState,
    mergeDashboardHydrationState,
    isConnectionStatus: (value: unknown) => ["connected", "disconnected", "needs_update"].includes(String(value)),
    getActiveBrowserUserId: () => account,
    readCachedDashboardChannelState: () => cache,
    mergeCachedDashboardChannelState: (patch: Dict) => { cache = { ...cache, ...patch }; },
    writeCachedDashboardChannelState: (next: Dict) => { cache = next; },
    applyDashboardChannelState: (next: Dict) => { appliedStates.push(next); return true; },
    resetAccountScopedDashboardState: () => { throw new Error("Unexpected empty account snapshot"); },
    expectedUiSnapshotDate: () => "2026-10-23",
    mergeChannelBlockIntoCachedSnapshots: (args: Dict) => snapshots.push(args),
    notifyStatsRefresh: (...args: unknown[]) => notifications.push(args),
    readCachedGeneratorPowerPercent: () => null,
    readCachedGeneratorPowerSnapshot: () => null,
    readCachedGeneratorIsActive: () => null,
    readCachedSiteBubbleProgress: () => null,
    inFlightStatsChannelRefreshesRef: { current: {} },
    inFlightGeneratorChannelRefreshesRef: { current: {} },
    lastStatsChannelRefreshAtRef: { current: {} },
    lastGeneratorChannelRefreshAtRef: { current: {} },
    CHANNEL_REFRESH_DEDUP_MS: 1500,
    applyChannelRefreshPayload: (...args: unknown[]) => { appliedStats.push(args); return { preferredBlock: null, syncAt: Date.now() }; },
    applyGeneratorChannelRefreshPayload: (...args: unknown[]) => { appliedGenerator.push(args); return { block: null, syncAt: Date.now() }; },
  };
  const callbackNames = ["patchChannelConnectionLocally", "updateChannelBlockLocally", "applyOfficialChannelStates", "refreshOfficialChannelStates", "hydrateActiveAccountCaches"];
  for (const name of callbackNames) {
    for (const match of callbackSource(name).matchAll(/\b(set[A-Z]\w*)\(/g)) {
      dependencies[match[1]] = (value: any) => { ui[match[1]] = typeof value === "function" ? value(ui[match[1]]) : value; };
    }
  }
  dependencies.updateChannelBlockLocally = callback("updateChannelBlockLocally", dependencies);
  dependencies.patchChannelConnectionLocally = callback("patchChannelConnectionLocally", dependencies);
  dependencies.applyOfficialChannelStates = callback("applyOfficialChannelStates", dependencies);
  return {
    dependencies, ui, snapshots, notifications, appliedStates, appliedStats, appliedGenerator, events,
    cache: () => cache,
    setCache: (next: Dict) => { cache = next; },
    changeAccount: (next: string) => { account = next; },
    patch: dependencies.patchChannelConnectionLocally,
    compile: (name: string, extra: Dict = {}) => callback(name, { ...dependencies, ...extra }),
  };
}

const disconnected = { connected: false, accountConnected: false, configured: false, connectionStatus: "disconnected", resourceId: null, resourceLabel: null, resourceUrl: null };

test("Dashboard: a confirmed disconnect invalidates an older canonical read and pending statistics", async () => {
  const h = harness();
  const network = deferred<Dict>();
  const refresh = h.compile("refreshOfficialChannelStates", { fetch: () => network.promise });
  const oldToken = h.dependencies.channelResponseGateRef.current.capture("gmb");
  const job = refresh();
  h.patch("gmb", disconnected, { clearData: true });
  assert.equal(h.dependencies.channelResponseGateRef.current.isCurrent("gmb", oldToken), false);
  network.resolve({ ok: true, json: async () => payload(true) });
  assert.equal(await job, null);
  assert.equal(h.appliedStates.length, 0);
  assert.equal(h.cache().gmbConnected, false);
  assert.equal(h.dependencies.confirmedChannelStateRef.current.gmbConnected, false);
  assert.equal(h.ui.setGeneratorPowerRevalidating, false);
});

test("Dashboard: auth rehydration retains the last confirmed disconnect over an obsolete browser snapshot", () => {
  const h = harness();
  h.patch("gmb", disconnected, { clearData: true });
  h.setCache(buildOfficialDashboardChannelState(payload(true))!);
  h.compile("hydrateActiveAccountCaches")("account-a");
  assert.equal(h.appliedStates.at(-1)?.gmbConnected, false);
  assert.equal(h.cache().gmbConnected, false);
  assert.equal(h.ui.setOfficialChannelStatesReady, true);
});

test("Dashboard: another account never inherits a previous account's confirmed state", () => {
  const h = harness();
  h.changeAccount("account-b");
  h.setCache(buildOfficialDashboardChannelState(payload(false))!);
  h.compile("hydrateActiveAccountCaches")("account-b");
  assert.equal(h.appliedStates.at(-1)?.gmbConnected, false);
  assert.equal(h.dependencies.canonicalChannelStatesReadyRef.current, false);
});

test("Dashboard: disconnecting LinkedIn clears organization and profile identities from later auth hydration", () => {
  const h = harness();
  Object.assign(h.dependencies.confirmedChannelStateRef.current, {
    linkedinSelectedOrganizationId: "organization-1",
    linkedinSelectedOrganizationName: "Old organization",
    linkedinProfileUrl: "https://www.linkedin.com/in/old-profile",
    linkedinOrganizationUrl: "https://www.linkedin.com/company/old-organization",
  });
  h.patch("linkedin", disconnected, { clearData: true });
  h.compile("hydrateActiveAccountCaches")("account-a");
  const hydrated = h.appliedStates.at(-1);
  assert.equal(hydrated?.linkedinConnected, false);
  assert.equal(hydrated?.linkedinSelectedOrganizationId, "");
  assert.equal(hydrated?.linkedinSelectedOrganizationName, "");
  assert.equal(hydrated?.linkedinProfileUrl, "");
  assert.equal(hydrated?.linkedinOrganizationUrl, "");
});

test("Dashboard: canonical responses from the previous account are ignored", async () => {
  const h = harness();
  const network = deferred<Dict>();
  const job = h.compile("refreshOfficialChannelStates", { fetch: () => network.promise })();
  h.changeAccount("account-b");
  network.resolve({ ok: true, json: async () => payload(true) });
  assert.equal(await job, null);
  assert.equal(h.appliedStates.length, 0);
});

test("Dashboard: a subsequent successful canonical read becomes the new hydration authority", async () => {
  const h = harness();
  h.patch("gmb", disconnected, { clearData: true });
  await h.compile("refreshOfficialChannelStates", { fetch: async () => ({ ok: true, json: async () => payload(true) }) })();
  h.compile("hydrateActiveAccountCaches")("account-a");
  assert.equal(h.appliedStates.at(-1)?.gmbConnected, true);
  assert.equal(h.dependencies.confirmedChannelStateRef.current.gmbConnected, true);
});

test("Dashboard: confirmed mutation immediately updates both Stats periods and dispatches their synchronization", () => {
  const h = harness();
  h.patch("gmb", disconnected, { clearData: true });
  assert.deepEqual(h.snapshots.map(s => s.period), [7, 30]);
  for (const snapshot of h.snapshots) {
    assert.equal(snapshot.block.connection.connected, false);
    assert.equal(snapshot.block.overview, null);
    assert.equal(snapshot.block.opportunities, 0);
    assert.equal(snapshot.block.estimatedValue, 0);
    assert.equal(snapshot.block.error, null);
  }
  assert.deepEqual(h.notifications[0]?.[1], ["gmb"]);
  assert.equal(h.events[0]?.type, "inrcy:channel-connection-updated");
  assert.deepEqual((h.events[0] as CustomEvent).detail, { channel: "gmb", accountId: "account-a" });
  h.patch("gmb", disconnected, { clearData: true });
  assert.equal(h.events.length, 1, "Identical status reads must not cause availability refresh loops");
});

for (const [name, applied] of [
  ["refreshChannelBlocksFromApi", "appliedStats"],
  ["refreshGeneratorChannelFromApi", "appliedGenerator"],
] as const) {
  test(`Dashboard: ${name} discards a late response after confirmed disconnect`, async () => {
    const h = harness();
    const network = deferred<Dict>();
    const refresh = h.compile(name, { fetchSharedDashboardRefreshJson: () => network.promise });
    const job = refresh("gmb", Date.now(), { force: true, forceFresh: true });
    h.patch("gmb", disconnected, { clearData: true });
    network.resolve({ periods: {}, generator: { block: { channel: "gmb" } } });
    await job;
    assert.equal(h[applied].length, 0);
    assert.equal(h.cache().gmbConnected, false);
  });
}

test("Dashboard: channel refresh keeps canonical confirmation before fresh Stats and generator requests", async () => {
  const h = harness();
  const canonical = deferred<void>();
  const calls: string[] = [];
  const refresh = h.compile("triggerChannelRefresh", {
    lastGeneratorRefreshAtRef: { current: 0 },
    clearScheduledGeneratorRefreshes() {},
    refreshOfficialChannelStates: () => { calls.push("canonical"); return canonical.promise; },
    refreshGeneratorChannelFromApi: async (_channel: string, _at: number, options: Dict) => { assert.equal(options.forceFresh, true); calls.push("generator"); },
    refreshChannelBlocksFromApi: async (_channel: string, _at: number, options: Dict) => { assert.equal(options.forceFresh, true); calls.push("stats"); },
    syncInstagramStateFromServer: async () => {},
    reportHandledClientError: (error: Error) => { throw error; },
    fallbackToServerSyncThenGlobal: async () => { throw new Error("Unexpected fallback"); },
  });
  const job = refresh("gmb");
  assert.deepEqual(calls, ["canonical"]);
  canonical.resolve();
  await job;
  assert.deepEqual(calls, ["canonical", "generator", "stats"]);
  assert.deepEqual(h.notifications.at(-1)?.[1], ["gmb"]);
});
