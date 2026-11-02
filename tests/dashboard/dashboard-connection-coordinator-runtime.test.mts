/* eslint-disable @typescript-eslint/no-explicit-any -- isolated browser and Realtime adapters exercise the real coordinator */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { normalizeDashboardConnectionPatch, projectDashboardConnectionCachePatch, projectDashboardConnectionBlock } from "../../app/dashboard/dashboard.connection-projection.ts";
import { inferChannelsFromRealtimePayload } from "../../app/dashboard/dashboard.shared.ts";
import { ACTIVE_INRCY_ACCOUNT_EVENT } from "../../lib/multicompte/constants.ts";
import type { InrstatsChannelBlock } from "../../lib/inrstats/channelBlocks.ts";

type Dict = Record<string, any>;
const ACTOR = "11111111-1111-4111-8111-111111111111";
const ACCOUNT = "22222222-2222-4222-8222-222222222222";
const NEXT = "33333333-3333-4333-8333-333333333333";
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const compiled = ts.transpileModule(readFileSync(new URL("../../app/dashboard/dashboard.channel-realtime.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function realtime(options: { hidden?: boolean; account?: string | null } = {}) {
  let account = options.account === undefined ? ACCOUNT : options.account;
  let authResolve!: (data: { data: { user: { id: string } | null } }) => void;
  const auth = new Promise<{ data: { user: { id: string } | null } }>(resolve => { authResolve = resolve; });
  let timerId = 0, clock = 10000, lastRefreshAt = 0, clears = 0;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const document = Object.assign(new EventTarget(), { visibilityState: options.hidden ? "hidden" : "visible" });
  const window = Object.assign(new EventTarget(), {
    setTimeout(callback: () => void, delay: number) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id: number) { timers.delete(id); },
  });
  const subscriptions: Dict[] = [], removed: Dict[] = [], calls: string[] = [], refreshed: string[][] = [];
  const supabase = {
    auth: { getUser: () => auth },
    channel(name: string) {
      const sub: Dict = { name, filters: [], callbacks: [],
        on(_event: string, filter: Dict, callback: (payload: unknown) => void) { sub.filters.push(filter); sub.callbacks.push(callback); return sub; },
        subscribe() { subscriptions.push(sub); calls.push("subscribe:" + name.split(":").at(-1)); return sub; },
      };
      return sub;
    },
    removeChannel(sub: Dict) { removed.push(sub); return Promise.resolve(); },
  };
  const dependencies: Dict = {
    "@/lib/supabaseClient": { createClient: () => supabase },
    "@/lib/browserAccountCache": { resolveActiveBrowserUserId: (fallback: string) => account || fallback },
    "@/lib/multicompte/constants": { ACTIVE_INRCY_ACCOUNT_EVENT },
    "./dashboard.shared": { inferChannelsFromRealtimePayload },
  };
  const mod = { exports: {} as { startDashboardChannelRealtime(options: Dict): () => void } };
  new Function("require", "module", "exports", "window", "document", "Date", compiled)(
    (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; },
    mod, mod.exports, window, document, { now: () => clock },
  );
  const cleanup = mod.exports.startDashboardChannelRealtime({
    readLastRefreshAt: () => lastRefreshAt,
    refreshChannels: (channels: string[]) => { refreshed.push(channels); },
    refreshFallback: () => { calls.push("fallback"); },
    onAccountChange: () => { calls.push("invalidate"); },
    refreshSiteSettings: () => { calls.push("settings"); },
    clearScheduledRefreshes: () => { clears++; },
  });
  return {
    cleanup, subscriptions, removed, calls, refreshed, timers,
    authenticate: async (id: string | null = ACTOR) => { authResolve({ data: { user: id ? { id } : null } }); await tick(); },
    emit: (payload: unknown) => subscriptions.at(-1)?.callbacks[0](payload),
    changeAccount: (id: string) => { account = id; window.dispatchEvent(new CustomEvent(ACTIVE_INRCY_ACCOUNT_EVENT, { detail: { activeUserId: id } })); },
    visibility: (hidden: boolean) => { document.visibilityState = hidden ? "hidden" : "visible"; document.dispatchEvent(new Event("visibilitychange")); },
    flush: () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(timer => timer.callback()); },
    lastRefresh: (at: number) => { lastRefreshAt = at; },
    clock: (at: number) => { clock = at; },
    clears: () => clears,
  };
}

test("Realtime subscribes only the active account on the two connector tables and tears down once", async () => {
  const h = realtime();
  await h.authenticate();
  assert.equal(h.subscriptions.length, 1);
  assert.equal(h.subscriptions[0].name, "inrcy-generator-sync:" + ACCOUNT);
  assert.deepEqual(h.subscriptions[0].filters, [
    { event: "*", schema: "public", table: "integrations", filter: "user_id=eq." + ACCOUNT },
    { event: "*", schema: "public", table: "pro_tools_configs", filter: "user_id=eq." + ACCOUNT },
  ]);
  h.cleanup();
  assert.deepEqual(h.removed, h.subscriptions);
  assert.equal(h.clears(), 1);
  h.changeAccount(NEXT); h.visibility(false);
  assert.equal(h.subscriptions.length, 1, "cleanup removes both event listeners");
});

test("Realtime debounces changed channels for 500ms, preserves the 2500ms gate and uses fallback only without a known channel", async () => {
  const h = realtime();
  await h.authenticate();
  h.emit({ table: "integrations", new: { provider: "facebook" } });
  h.emit({ table: "integrations", new: { provider: "facebook" } });
  assert.equal(h.timers.size, 1);
  assert.equal([...h.timers.values()][0].delay, 500);
  assert.deepEqual(h.refreshed, []);
  h.flush();
  assert.deepEqual(h.refreshed, [["facebook"]]);
  h.lastRefresh(9800);
  h.emit({ table: "integrations", new: { provider: "facebook" } });
  assert.equal(h.timers.size, 0);
  h.clock(13000);
  h.emit({ table: "unknown" }); h.flush();
  assert.equal(h.calls.filter(call => call === "fallback").length, 1);
  h.cleanup();
});

test("hiding the tab removes pending work and subscription; revealing reconciles without polling", async () => {
  const h = realtime();
  await h.authenticate();
  h.emit({ table: "integrations", new: { provider: "linkedin" } });
  h.visibility(true);
  assert.equal(h.timers.size, 0);
  assert.equal(h.removed.length, 1);
  h.flush();
  assert.deepEqual(h.refreshed, []);
  h.visibility(false);
  assert.equal(h.subscriptions.length, 2);
  assert.equal(h.calls.filter(call => call === "fallback").length, 1);
  h.visibility(false);
  assert.equal(h.subscriptions.length, 2, "visible event never duplicates an active subscription");
  assert.equal(h.calls.filter(call => call === "fallback").length, 1);
  h.cleanup();
});

test("account change invalidates old state before subscribing the new scope, then refreshes settings", async () => {
  const h = realtime();
  await h.authenticate();
  h.changeAccount(NEXT);
  assert.deepEqual(h.calls.slice(-3), ["invalidate", "subscribe:" + NEXT, "settings"]);
  assert.equal(h.removed.length, 1);
  assert.ok(h.subscriptions[1].filters.every((filter: Dict) => filter.filter === "user_id=eq." + NEXT));
  h.cleanup();
});

test("late authentication after cleanup and an invalid unauthenticated scope cannot subscribe", async () => {
  const late = realtime();
  late.cleanup(); await late.authenticate();
  assert.equal(late.subscriptions.length, 0);
  const invalid = realtime({ account: null });
  await invalid.authenticate(null);
  invalid.changeAccount("not-an-account");
  assert.deepEqual(invalid.calls, []);
  invalid.cleanup();
});

test("an initially hidden tab waits until it is visible before subscribing", async () => {
  const h = realtime({ hidden: true });
  await h.authenticate();
  assert.equal(h.subscriptions.length, 0);
  h.visibility(false);
  assert.equal(h.subscriptions.length, 1);
  assert.equal(h.calls.includes("fallback"), false, "no new refresh is invented for an untouched hidden initial state");
  h.cleanup();
});

test("confirmed connection normalization preserves omitted fields and prioritizes explicit reconnect signals", () => {
  const patch = Object.freeze({ connected: true, expired: true, resourceLabel: "A" });
  const result = normalizeDashboardConnectionPatch(patch);
  assert.equal(result.requiresUpdate, true);
  assert.equal(result.normalizedPatch.connectionStatus, "needs_update");
  assert.equal(result.normalizedPatch.expired, true);
  assert.equal(patch.connected, true);
  const partial = normalizeDashboardConnectionPatch({ resourceLabel: "B" }).normalizedPatch;
  assert.deepEqual(partial, { resourceLabel: "B" });
  assert.deepEqual(normalizeDashboardConnectionPatch({ connected: true, expired: false }).normalizedPatch,
    { connected: true, expired: false, requiresUpdate: false, connectionStatus: "connected" });
});

test("LinkedIn disconnect removes organization and profile details while a label-only patch leaves selection untouched", () => {
  const { normalizedPatch, requiresUpdate } = normalizeDashboardConnectionPatch({ connected: false, accountConnected: false });
  const result = projectDashboardConnectionCachePatch("linkedin", normalizedPatch, requiresUpdate);
  assert.equal(result.linkedinSelectedOrganizationId, "");
  assert.equal(result.linkedinProfileUrl, "");
  assert.equal(result.linkedinOrganizationUrl, "");
  assert.equal(result.linkedinShareToPersonalProfile, false);
  assert.deepEqual(projectDashboardConnectionCachePatch("linkedin", { resourceLabel: "Profile" }, false), { linkedinDisplayName: "Profile" });
});

test("website projection copies only already-confirmed website fields and never mutates the cache", () => {
  const cache = Object.freeze({ siteWebUrl: "https://example.test", siteWebGa4Connected: true, facebookUrl: "https://facebook.test" });
  assert.deepEqual(projectDashboardConnectionCachePatch("site_web", {}, false, cache), { siteWebUrl: cache.siteWebUrl, siteWebGa4Connected: true });
  assert.equal(cache.facebookUrl, "https://facebook.test");
  assert.deepEqual(projectDashboardConnectionCachePatch("gmb", { accountConnected: false, resourceId: null }, false), { gmbAccountConnected: false, gmbAccountEmail: "", gmbLocationName: "" });
});

test("block projection clears statistics only when requested and retains errors when explicitly asked", () => {
  const current: InrstatsChannelBlock = {
    channel: "gmb", periodDays: 30, connection: { connected: true, accountConnected: true, configured: true, statsConnected: true, expired: false, requiresUpdate: false, connectionStatus: "connected", resourceId: "location-1", resourceLabel: "Company", resourceUrl: "https://example.test" }, overview: { views: 9 },
    opportunities: 3, capturedLeads: { week: 2, month: 4 }, estimatedValue: 12, live: true,
    error: "existing", syncAt: 1, snapshotDate: "2026-11-01",
  };
  const cleared = projectDashboardConnectionBlock(current, { connected: false }, { clearData: true, clearError: false }, 2, "2026-11-02");
  assert.equal(cleared.overview, null);
  assert.equal(cleared.estimatedValue, 0);
  assert.deepEqual(cleared.capturedLeads, { week: 0, month: 0 });
  assert.equal(cleared.error, "existing");
  assert.equal(cleared.connection.configured, true);
  assert.equal(current.connection.connected, true);
  const retained = projectDashboardConnectionBlock(current, { connected: false }, undefined, 3, "2026-11-03");
  assert.equal(retained.overview, current.overview);
  assert.equal(retained.error, null);
  assert.equal(retained.syncAt, 3);
});
