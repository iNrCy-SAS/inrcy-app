/* eslint-disable @typescript-eslint/no-explicit-any -- controlled runtime for deferred requests */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
type Dict = Record<string, any>;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const response = (body: Dict, ok = true) => ({ ok, json: async () => body });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function snapshot(connected: boolean, directoryEnabled = connected) {
  return {
    ok: true,
    inrSearch: { enabled: connected, directoryEnabled, slug: "business-a", pageTitle: "Business A" },
    publication: { allowed: connected, reason: connected ? "published" : "page_disabled" },
  };
}

function nodes(tree: any): any[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}

function runtime(fetch: any, initialConnected = true, cached?: Dict) {
  const slots: any[] = [];
  const effects: Array<() => any> = [];
  const cleanups: Array<() => void> = [];
  let cursor = 0;
  let mounted = false;
  let accountId = "account-a";
  let bubble: Dict = {};
  const events: Dict[] = [];
  const session = new Map<string, string>();
  const cacheKey = "inrcy:inr-search-panel:business-a";
  if (cached) session.set(cacheKey, JSON.stringify({ settings: cached.inrSearch, publication: cached.publication }));
  const react = {
    useState(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next: any) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useRef(initial: any) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useMemo: (fn: any) => fn(),
    useCallback: (fn: any) => fn,
    useEffect(effect: () => any) { if (!mounted) effects.push(effect); },
  };
  const localRequire = (name: string): any => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "next-intl") return { useTranslations: () => (key: string) => key };
    if (name === "@/lib/browserAccountCache") return { getActiveBrowserUserId: () => accountId };
    if (name.endsWith(".module.css")) return new Proxy({}, { get: (_target, key) => String(key) });
    if (name.endsWith("ChannelParametersDialog") || name.endsWith("StatusMessage")) return (props: any) => props.children;
    throw new Error(`Unexpected dependency ${name}`);
  };
  const source = readFileSync(new URL("../../app/dashboard/settings/_components/InrSearchSettingsContent.tsx", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} as Dict };
  const win = {
    location: { hostname: "localhost", origin: "http://localhost:3000" },
    sessionStorage: { getItem: (key: string) => session.get(key) ?? null, setItem: (key: string, value: string) => session.set(key, value) },
    dispatchEvent: (event: Dict) => events.push(event), addEventListener() {}, removeEventListener() {},
  };
  new Function("module", "exports", "require", "fetch", "window", "document", "CustomEvent", code)(
    loaded, loaded.exports, localRequire, fetch, win,
    { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    class { type: string; detail: Dict; constructor(type: string, options: Dict) { this.type = type; this.detail = options.detail; } },
  );
  const render = () => {
    cursor = 0;
    const tree = loaded.exports.default({ initialConnected, initialPublicUrl: "https://app.inrcy.com/entreprises/business-a", initialDirectoryEnabled: initialConnected, renderBubble: (value: Dict) => { bubble = value; return null; } });
    if (!mounted) {
      mounted = true;
      for (const effect of effects) { const cleanup = effect(); if (typeof cleanup === "function") cleanups.push(cleanup); }
    }
    return { tree, bubble };
  };
  const disconnect = () => {
    render().bubble.onDisconnect();
    const confirm = nodes(render().tree).find(node => node.type === "button" && node.props.children === "deconnecter_quand_meme_dcf686d8");
    assert.ok(confirm, "the disconnect confirmation remains available");
    confirm.props.onClick();
    return confirm.props.onClick;
  };
  return { render, disconnect, events, cache: () => JSON.parse(session.get(cacheKey) || "null"), changeAccount: () => { accountId = "account-b"; }, unmount: () => cleanups.forEach(cleanup => cleanup()) };
}

test("iNrSearch: a confirmed connection supersedes a GET started before the action", async () => {
  const oldRead = deferred<any>();
  const write = deferred<any>();
  const calls: Dict[] = [];
  const h = runtime((_url: string, options: Dict) => { calls.push(options); return options.method === "POST" ? write.promise : oldRead.promise; }, false);
  const action = h.render().bubble.onConnect();
  await h.render().bubble.onConnect();
  assert.equal(h.render().bubble.accountConnected, false, "pending writes must not advertise success");
  write.resolve(response(snapshot(true)));
  await action;
  assert.equal(h.render().bubble.accountConnected, true);
  assert.equal(h.render().bubble.busy, false, "no second GET keeps the action pending");
  oldRead.resolve(response(snapshot(false)));
  await tick();
  assert.equal(h.render().bubble.accountConnected, true);
  assert.equal(calls.length, 2, "one GET and one POST, including a duplicate click");
  assert.equal(h.events.length, 1);
  assert.deepEqual(h.events[0].detail, { connected: true, directoryEnabled: true, profileUrl: "http://localhost:3000/entreprises/business-a", refresh: true });
  assert.equal(h.cache().settings.enabled, true);
});

test("iNrSearch: disconnect cannot be undone by an older connected GET", async () => {
  const oldRead = deferred<any>();
  const write = deferred<any>();
  let posts = 0;
  const h = runtime((_url: string, options: Dict) => { if (options.method === "POST") { posts++; return write.promise; } return oldRead.promise; });
  const duplicate = h.disconnect();
  duplicate();
  assert.equal(h.render().bubble.accountConnected, true);
  write.resolve(response(snapshot(false, false)));
  await tick();
  assert.equal(h.render().bubble.accountConnected, false);
  assert.equal(h.render().bubble.busy, false);
  oldRead.resolve(response(snapshot(true)));
  await tick();
  assert.equal(h.render().bubble.accountConnected, false);
  assert.equal(posts, 1);
  assert.equal(h.cache().settings.enabled, false);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].detail.connected, false);
  assert.equal(h.events[0].detail.directoryEnabled, false);
});

test("iNrSearch: directory changes preserve the page connection and ignore old directory state", async () => {
  const oldRead = deferred<any>();
  const write = deferred<any>();
  const calls: Dict[] = [];
  const h = runtime((_url: string, options: Dict) => { calls.push(options); return options.method === "POST" ? write.promise : oldRead.promise; });
  const params = h.render().bubble.parameters;
  const toggle = nodes(params).find(node => node.type === "button" && "aria-pressed" in node.props);
  assert.ok(toggle);
  toggle.props.onClick();
  const refresh = nodes(params).find(node => node.type === "button" && node.props.children === "actualiser_9d3b2a7d");
  refresh.props.onClick();
  assert.equal(calls.length, 2, "focus/manual refresh cannot race an ongoing write");
  assert.deepEqual(JSON.parse(calls[1].body), { action: "directory", enabled: false });
  write.resolve(response(snapshot(true, false)));
  await tick();
  oldRead.resolve(response(snapshot(true, true)));
  await tick();
  assert.equal(h.render().bubble.accountConnected, true);
  assert.equal(h.cache().settings.directoryEnabled, false);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].detail.directoryEnabled, false);
});

test("iNrSearch: a failed mutation preserves confirmed state and exposes the failure", async () => {
  const oldRead = deferred<any>();
  const h = runtime((_url: string, options: Dict) => options.method === "POST" ? response({ ok: false, error: "Could not save" }, false) : oldRead.promise);
  h.disconnect();
  await tick();
  assert.equal(h.render().bubble.accountConnected, true);
  assert.equal(h.render().bubble.error, "Could not save");
  assert.equal(h.render().bubble.busy, false);
  assert.equal(h.events.length, 0);
  oldRead.resolve(response(snapshot(false)));
  await tick();
  assert.equal(h.render().bubble.accountConnected, true);
  assert.equal(h.render().bubble.error, "Could not save");
});

test("iNrSearch: responses from a previous account do not update the dashboard or cache", async () => {
  const oldRead = deferred<any>();
  const write = deferred<any>();
  const h = runtime((_url: string, options: Dict) => options.method === "POST" ? write.promise : oldRead.promise);
  h.disconnect();
  h.changeAccount();
  write.resolve(response(snapshot(false)));
  oldRead.resolve(response(snapshot(true)));
  await tick();
  assert.equal(h.events.length, 0);
  assert.equal(h.cache(), null);
});

test("iNrSearch: initial dashboard connection takes precedence over old panel cache", () => {
  const h = runtime(() => new Promise(() => {}), true, snapshot(false));
  assert.equal(h.render().bubble.accountConnected, true);
  const disconnected = runtime(() => new Promise(() => {}), false, snapshot(true));
  assert.equal(disconnected.render().bubble.accountConnected, false);
  assert.equal(disconnected.render().bubble.resourceLabel, "business-a");
});

test("iNrSearch: passive status reads update display without scheduling expensive stats refresh", async () => {
  const h = runtime(async () => response(snapshot(true)));
  h.render();
  await tick();
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].detail.refresh, false);
  assert.equal(h.render().bubble.accountConnected, true);
});

test("iNrSearch: late responses after unmount cannot publish connection changes", async () => {
  const oldRead = deferred<any>();
  const write = deferred<any>();
  const h = runtime((_url: string, options: Dict) => options.method === "POST" ? write.promise : oldRead.promise);
  h.disconnect();
  h.unmount();
  write.resolve(response(snapshot(false)));
  oldRead.resolve(response(snapshot(true)));
  await tick();
  assert.equal(h.events.length, 0);
  assert.equal(h.cache(), null);
});

function statsRuntime(fetch: any) {
  let state: Dict = { enabled: true, loading: false, publicUrl: "https://example.test/page", views: { total: 17 } };
  const effects: Array<() => any> = [];
  const listeners = new Map<string, (event?: Dict) => void>();
  const documentState = { hidden: false, addEventListener() {}, removeEventListener() {} };
  const noOp = () => {};
  const fallback = new Proxy({}, { get: () => noOp });
  const localRequire = (name: string): any => {
    if (name === "react") return { useCallback: (fn: any) => fn, useRef: (value: any) => ({ current: value }), useEffect: (effect: () => any) => effects.push(effect) };
    if (name.endsWith("DashboardViewerAccessProvider")) return { useDashboardViewerAccess: () => ({ metaPilotEnabled: true }) };
    if (name === "@/lib/browserAccountCache") return { getActiveBrowserUserId: () => "account-a" };
    if (name.endsWith("stats.client-stability")) return {
      hasCommittedStatsSnapshot: () => true,
      isLatestStatsRequest: (value: Dict) => value.requestSeq === value.latestRequestSeq && value.requestAccountScope === value.activeAccountScope,
    };
    if (name.endsWith("stats.client-foundations")) return { normalizeInrSearchStatsSnapshot: (value: Dict) => ({ ...value, loading: false }) };
    return fallback;
  };
  const source = readFileSync(new URL("../../app/dashboard/stats/stats.client-hooks.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} as Dict };
  new Function("module", "exports", "require", "fetch", "window", "document", code)(loaded, loaded.exports, localRequire, fetch, {
    addEventListener: (name: string, listener: (event?: Dict) => void) => listeners.set(name, listener),
    removeEventListener: (name: string) => listeners.delete(name), setInterval: () => 1, clearInterval() {},
  }, documentState);
  loaded.exports.useStatsDataController({
    period: 30, refreshNonce: 0, dailyBootReady: false, isRefreshing: false, includeMailStats: false,
    setInrSearchStats: (next: any) => { state = typeof next === "function" ? next(state) : next; },
  });
  // Mount only the iNrSearch polling effect; unrelated statistics endpoints
  // remain outside this targeted regression test.
  const effect = effects.find(value => value.toString().includes("inrcy:inr-search-settings-updated"));
  assert.ok(effect);
  const cleanup = effect();
  return { state: () => state, documentState, cleanup, emit: (detail: Dict) => listeners.get("inrcy:inr-search-settings-updated")?.({ detail }), focus: () => listeners.get("focus")?.() };
}

test("iNrSearch stats: a confirmed mutation invalidates pending analytics and preserves historical metrics", async () => {
  const oldRead = deferred<any>();
  const freshRead = deferred<any>();
  let calls = 0;
  const h = statsRuntime(() => ++calls === 1 ? oldRead.promise : freshRead.promise);
  h.emit({ connected: false, refresh: true });
  assert.equal(calls, 2, "the refresh cannot reuse analytics started before disconnection");
  assert.equal(h.state().enabled, false, "confirmed connection state is applied immediately");
  assert.equal(h.state().views.total, 17, "historical activity is preserved");
  oldRead.resolve(response({ enabled: true, views: { total: 12 } }));
  await tick();
  assert.equal(h.state().enabled, false);
  assert.equal(h.state().views.total, 17);
  freshRead.resolve(response({ enabled: false, views: { total: 18 } }));
  await tick();
  assert.equal(h.state().enabled, false);
  assert.equal(h.state().views.total, 18);
  h.emit({ connected: false, refresh: false });
  assert.equal(calls, 2, "passive settings reads do not schedule analytics");
  h.cleanup();
});

test("iNrSearch stats: a hidden tab keeps confirmed state and refreshes analytics only on return", async () => {
  const oldRead = deferred<any>();
  const freshRead = deferred<any>();
  let calls = 0;
  const h = statsRuntime(() => ++calls === 1 ? oldRead.promise : freshRead.promise);
  h.documentState.hidden = true;
  h.emit({ connected: false, refresh: true });
  assert.equal(calls, 1);
  assert.equal(h.state().enabled, false);
  oldRead.resolve(response({ enabled: true }));
  await tick();
  assert.equal(h.state().enabled, false);
  h.documentState.hidden = false;
  h.focus();
  assert.equal(calls, 2);
  freshRead.resolve(response({ enabled: false }));
  await tick();
  assert.equal(h.state().enabled, false);
  h.cleanup();
});
