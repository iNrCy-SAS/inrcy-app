import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as stability from "../../app/dashboard/stats/stats.client-stability.ts";
import type { useStatsDataController } from "../../app/dashboard/stats/stats.client-hooks.ts";

type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
type Props = Parameters<typeof useStatsDataController>[0];
type Controller = ReturnType<typeof useStatsDataController>;
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function harness() {
  const slots: Slot[] = [], effects: Array<() => void> = [], values: Record<string, unknown> = {};
  const requests: Array<{ url: string; resolve: (response: Response) => void }> = [];
  const listeners = new Map<string, Set<(event: unknown) => void>>(), timers = new Map<number, () => void>();
  let cursor = 0, dirty = false, serial = 0, gate = false, account = "account-a";
  let controller!: Controller;
  const same = (a: readonly unknown[] | undefined, b: readonly unknown[]) => a?.length === b.length && b.every((value, index) => Object.is(value, a[index]));
  const react = {
    useRef(initial: unknown) { return (slots[cursor++] ??= { value: { current: initial } }).value; },
    useCallback(callback: unknown, deps: readonly unknown[]) {
      const slot = slots[cursor++] ??= {};
      if (!same(slot.deps, deps)) { slot.value = callback; slot.deps = deps; }
      return slot.value;
    },
    useEffect(callback: () => void | (() => void), deps: readonly unknown[]) {
      const slot = slots[cursor++] ??= {};
      if (same(slot.deps, deps)) return;
      slot.deps = deps; effects.push(() => { slot.cleanup?.(); slot.cleanup = callback() || undefined; });
    },
  };
  const events = {
    addEventListener(name: string, fn: (event: unknown) => void) { const set = listeners.get(name) || new Set(); set.add(fn); listeners.set(name, set); },
    removeEventListener(name: string, fn: (event: unknown) => void) { listeners.get(name)?.delete(fn); },
    setTimeout(fn: () => void) { timers.set(++serial, fn); return serial; }, clearTimeout(id: number) { timers.delete(id); },
    setInterval(fn: () => void) { timers.set(++serial, fn); return serial; }, clearInterval(id: number) { timers.delete(id); },
  };
  const shared = {
    expectedUiSnapshotDate: () => "2026-11-02", getOverviewSnapshotDate: () => "2026-11-02", safeNum: (value: unknown) => Number(value) || 0,
    cubeSessionKey: (period: number) => `cube:${period}`, summarySessionKey: (period: number) => `summary:${period}`,
    getStatsLastChannelSyncAt: () => 0, getLocalPeriodSyncAt: () => 0, hasFreshLocalPeriodSnapshot: () => false,
    parseCachedCubeSnapshot: () => null, parseCachedSummarySnapshot: () => null, hasCapturedLeadsBlocks: () => false,
    readUiCacheValue: () => null, writeUiCacheValue() {},
  };
  const foundation = {
    normalizeCapturedLeads: (value: unknown) => value, normalizeInrBadgeStatsSnapshot: (value: unknown) => value,
    normalizeInrSearchStatsSnapshot: (value: unknown) => value, normalizeMailStatsSnapshot: (value: unknown) => value, writeCachedMailStats() {},
  };
  const dependencies: Record<string, unknown> = {
    react, "@/app/dashboard/_components/DashboardViewerAccessProvider": { useDashboardViewerAccess: () => ({ metaPilotEnabled: gate }) },
    "@/lib/dashboardCacheKeys": { DASHBOARD_CACHE_KEYS: {} },
    "@/lib/userFacingErrors": { getClientUserFacingApiError: async () => "failed", getClientUserFacingErrorMessage: (_error: unknown, fallback: string) => fallback },
    "@/lib/profileVersioning": { PROFILE_VERSION_EVENT: "profile-version" },
    "@/lib/dashboardRefreshOrchestrator": {}, "@/lib/dashboardChannels": { isDashboardChannelKey: () => true },
    "@/lib/browserAccountCache": { getActiveBrowserUserId: () => account }, "@/lib/channelConnectionUpdates": {},
    "@/lib/dailyStatsRefreshClient": { markDailyStatsRefreshBootstrapChecked() {}, markServerCacheSyncChecked() {}, runDailyStatsRefreshBootstrap: async () => ({ ran: false }), wasDailyStatsRefreshBootstrapCheckedRecently: () => false, wasServerCacheSyncCheckedRecently: () => false },
    "../dashboard.client-cache": { markChannelsSynced() {}, mergeChannelBlockIntoCachedSnapshots() {}, readCachedChannelSyncAt: () => 0, syncGeneratorOpportunitiesFromStatsSummary() {} },
    "./stats.shared": shared, "./stats.client-foundations": foundation, "./stats.client-stability": stability,
  };
  const props = {
    period: 30, refreshNonce: 0, dailyBootReady: true, isRefreshing: false, includeMailStats: false,
    periodCacheRef: { current: new Map() }, hydratedPeriodsRef: { current: new Set() }, lastAutoRefreshAtRef: { current: 0 }, refreshTimeoutRef: { current: null }, lastServerCacheCheckAtRef: { current: 0 }, serverCacheCheckPromiseRef: { current: null },
  } as unknown as Props;
  for (const name of ["DataByCube", "SummaryHydrated", "SummaryOpp", "SummaryProfile", "SummaryEstimatedByCube", "LastRefreshAt", "IsRefreshing", "RefreshNonce", "DailyBootReady", "MailStats", "InrBadgeStats", "InrSearchStats"]) {
    const key = name[0].toLowerCase() + name.slice(1);
    values[key] = (props as unknown as Record<string, unknown>)[key] ?? {};
    (props as unknown as Record<string, unknown>)[`set${name}`] = (next: unknown) => {
      const value = typeof next === "function" ? next(values[key]) : next;
      if (Object.is(value, values[key])) return;
      values[key] = value;
      if (key in props) (props as unknown as Record<string, unknown>)[key] = value;
      dirty = true;
    };
  }
  const source = readFileSync(new URL("../../app/dashboard/stats/stats.client-hooks.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const loaded = { exports: {} as { useStatsDataController: typeof useStatsDataController } };
  const fetch = (url: string) => {
    if (url === "/api/dashboard/cache-status") return Promise.resolve(Response.json({}));
    return new Promise<Response>(resolve => requests.push({ url, resolve }));
  };
  new Function("module", "exports", "require", "window", "document", "fetch", compiled)(loaded, loaded.exports, (name: string) => {
    assert.ok(name in dependencies, name); return dependencies[name];
  }, events, { ...events, hidden: false }, fetch);
  function render() { cursor = 0; dirty = false; controller = loaded.exports.useStatsDataController(props); effects.splice(0).forEach(run => run()); }
  function flush() { for (let i = 0; dirty && i < 20; i++) render(); assert.equal(dirty, false, "state updates must settle without re-fetching"); }
  return { props, values, requests, timers, render, flush, setGate(value: boolean) { gate = value; }, setAccount(value: string) { account = value; }, get controller() { return controller; }, focus() { listeners.get("focus")?.forEach(fn => fn({})); }, unmount() { slots.forEach(slot => slot.cleanup?.()); }, listeners };
}
const bulk = (threads: number, label: string) => ({ overviews: { threads: { label } }, opportunities: { total: threads, byCube: { threads } }, estimatedByCube: { threads }, profile: {}, meta: { snapshotDate: "2026-11-02" } });
const bulkRequests = (h: ReturnType<typeof harness>) => h.requests.filter(request => request.url.includes("dashboard-bulk"));

test("Stats settles with stable React setters/refs; only period or viewer gate changes start a new bulk load", async () => {
  const h = harness(); h.render(); h.flush(); await settle(); h.flush();
  assert.equal(bulkRequests(h).length, 1);
  bulkRequests(h)[0].resolve(Response.json(bulk(9, "initial"))); await settle(); h.flush(); h.render(); h.flush();
  assert.equal(bulkRequests(h).length, 1);
  assert.equal((h.values.summaryOpp as { byCube: { threads: number } }).byCube.threads, 0);
  h.setGate(true); h.render(); h.flush(); await settle(); h.flush();
  assert.equal(bulkRequests(h).length, 2);
  bulkRequests(h)[1].resolve(Response.json(bulk(9, "enabled"))); await settle(); h.flush();
  assert.equal((h.values.summaryOpp as { byCube: { threads: number } }).byCube.threads, 9);
  h.render(); h.flush(); assert.equal(bulkRequests(h).length, 2); h.unmount();
});

test("Stats rapid period changes ignore previous responses and apply only the current period", async () => {
  const h = harness(); h.render(); h.flush();
  h.props.period = 7; h.render(); h.flush();
  h.props.period = 30; h.render(); h.flush();
  const requests = bulkRequests(h); assert.equal(requests.length, 3);
  requests[1].resolve(Response.json(bulk(1, "obsolete week"))); requests[0].resolve(Response.json(bulk(2, "obsolete month")));
  await settle(); h.flush(); assert.equal(h.props.periodCacheRef.current.size, 0);
  requests[2].resolve(Response.json(bulk(3, "current month"))); await settle(); h.flush();
  assert.equal(h.props.periodCacheRef.current.size, 1);
  assert.equal((h.props.periodCacheRef.current.get(30)?.threads as unknown as { label: string }).label, "current month");
  h.unmount();
});

test("Stats stale account and unmounted analytics replies cannot replace committed values", async () => {
  const h = harness(); h.render(); h.flush();
  const oldBadge = h.requests.find(request => request.url === "/api/inrstats/inrbadge")!;
  h.setAccount("account-b"); h.focus(); h.flush();
  const newBadge = h.requests.filter(request => request.url === "/api/inrstats/inrbadge")[1];
  oldBadge.resolve(Response.json({ marker: "account-a" })); await settle(); h.flush();
  assert.notEqual((h.values.inrBadgeStats as { marker?: string }).marker, "account-a");
  newBadge.resolve(Response.json({ marker: "account-b" })); await settle(); h.flush();
  assert.equal((h.values.inrBadgeStats as { marker?: string }).marker, "account-b");
  h.focus(); h.flush(); const late = h.requests.filter(request => request.url === "/api/inrstats/inrbadge")[2];
  h.unmount(); late.resolve(Response.json({ marker: "after unmount" })); await settle();
  assert.equal((h.values.inrBadgeStats as { marker?: string }).marker, "account-b");
  assert.equal(h.timers.size, 0); for (const listeners of h.listeners.values()) assert.equal(listeners.size, 0);
});
