/* eslint-disable @typescript-eslint/no-explicit-any -- dynamic module and hook test harness */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
type Dict = Record<string, any>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const response = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

function runtime(path: string, dependencies: Dict = {}, browser: Dict = {}) {
  let cursor = 0;
  const slots: any[] = [];
  const localRequire = (name: string): any => {
    if (name in dependencies) return dependencies[name];
    if (name === "react") return {
      useState(initial: any) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
        return [slots[index], (next: any) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
      },
      useRef(initial: any) { const index = cursor++; return slots[index] ??= { current: initial }; },
      useCallback: (fn: any) => fn,
      useEffect() {},
    };
    if (name === "@/lib/tiktokSettings") return require("../../lib/tiktokSettings.ts");
    if (name === "@/lib/userFacingErrors") return { getClientUserFacingErrorMessage: (value: any, fallback = "Erreur") => value instanceof Error ? value.message : fallback };
    if (name === "@/lib/dashboardCacheKeys") return require("../../lib/dashboardCacheKeys.ts");
    if (name === "@/lib/multicompte/constants") return { ACTIVE_INRCY_ACCOUNT_COOKIE: "active-account", ACTIVE_INRCY_ACCOUNT_STORAGE_KEY: "active-account", ACTIVE_INRCY_ACCOUNT_EVENT: "active-account-change" };
    if (name === "@/lib/inrcyDialog") return { confirmInrcy: async () => true };
    if (name === "@/lib/supabaseClient") return { createClient() { throw new Error("Unexpected extra database write"); } };
    throw new Error(`Unmocked dependency ${name}`);
  };
  const code = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} as Dict };
  const win = { dispatchEvent() {}, setTimeout() {}, location: { href: "", protocol: "http:" }, ...browser };
  new Function("module", "exports", "require", "fetch", "window", "document", code)(loaded, loaded.exports, localRequire, dependencies.fetch, win, { cookie: "active-account=account-a" });
  return { exports: loaded.exports, render(name: string, args: Dict) { cursor = 0; return loaded.exports[name](args); } };
}

for (const [baseKey, timestamp] of [["inrcy_dashboard_channel_state_v2", "cachedAt"], ["inrcy_channel_workspace_ui_v1:x", "updatedAt"]]) {
  test(`${baseKey}: returning to another tab hydrates the newer confirmed snapshot`, () => {
    const scopedKey = `${baseKey}:uid:account-a`;
    const old = JSON.stringify({ [timestamp]: 10, state: { connected: true } });
    const recent = JSON.stringify({ [timestamp]: 20, state: { connected: false } });
    const session = new Map([[scopedKey, old]]);
    const local = new Map([[scopedKey, recent]]);
    const h = runtime("lib/browserAccountCache.ts", {}, { sessionStorage: { getItem: (key: string) => session.get(key) ?? null }, localStorage: { getItem: (key: string) => local.get(key) ?? null } });
    assert.equal(h.exports.readAccountCacheValue(baseKey), recent);
    session.set(scopedKey, JSON.stringify({ [timestamp]: 30, state: { connected: true } }));
    assert.equal(h.exports.readAccountCacheValue(baseKey), session.get(scopedKey), "newer session survives a failed persistent write");
    assert.equal(h.exports.readAccountCacheValue(baseKey, "account-b"), null, "another establishment cannot inherit the connection");
    session.set(scopedKey, "not-json");
    assert.equal(h.exports.readAccountCacheValue(baseKey), recent);
  });
}

test("non-connection caches retain their original session-first behavior", () => {
  const h = runtime("lib/browserAccountCache.ts", {}, { sessionStorage: { getItem: () => "session" }, localStorage: { getItem: () => "local" } });
  assert.equal(h.exports.readAccountCacheValue("other-cache"), "session");
});

function tiktokRuntime(fetch: any) {
  let accountId = "account-a";
  const patches: Dict[] = [];
  let refreshes = 0;
  const h = runtime("app/dashboard/_hooks/channels/useTiktokChannel.ts", {
    fetch,
    "@/lib/browserAccountCache": { getActiveBrowserUserId: () => accountId, readAccountCacheValue: () => null, writeAccountCacheValue() {} },
  });
  const args = { initialState: { tiktokConnected: true, tiktokUsername: "original" }, panel: null, patchChannelConnectionLocally: (_channel: string, patch: Dict) => patches.push(patch), triggerChannelRefresh: async () => { refreshes++; } };
  return { render: () => h.render("useTiktokChannel", args), patches, refreshes: () => refreshes, changeAccount: () => { accountId = "account-b"; } };
}

test("TikTok: pre-disconnect status cannot restore a disconnected account", async () => {
  const status = deferred<any>();
  const disconnect = deferred<any>();
  const calls: string[] = [];
  const h = tiktokRuntime((url: string) => { calls.push(url); return url.endsWith("status") ? status.promise : disconnect.promise; });
  const hook = h.render();
  const oldRead = hook.loadTiktokStatus();
  assert.equal(hook.loadTiktokStatus(), oldRead, "concurrent reads share one request");
  const write = hook.disconnectTiktok();
  await hook.disconnectTiktok();
  await hook.loadTiktokStatus();
  assert.equal(calls.length, 2, "pending writes prevent duplicate mutation and status reloads");
  assert.equal(h.render().tiktokConnected, true, "connection remains honest until persistence succeeds");
  disconnect.resolve(response({ ok: true, tiktok: { connected: false } }));
  await write;
  status.resolve(response({ ok: true, tiktok: { connected: true, username: "stale" } }));
  await oldRead;
  assert.equal(h.render().tiktokConnected, false);
  assert.equal(h.render().tiktokLoading, false);
  assert.equal(h.patches.length, 1);
  assert.equal(h.patches[0].connected, false);
});

test("TikTok: canonical hydration supersedes a stale detail response without triggering stats work", async () => {
  const status = deferred<any>();
  const h = tiktokRuntime(() => status.promise);
  const hook = h.render();
  const oldRead = hook.loadTiktokStatus();
  hook.applyTiktokConnectionState({ connected: false, requiresUpdate: true });
  status.resolve(response({ ok: true, tiktok: { connected: true } }));
  await oldRead;
  assert.equal(h.render().tiktokConnected, false);
  assert.equal(h.render().tiktokLoading, false);
  assert.equal(h.refreshes(), 0);
});

test("TikTok: a failed disconnection preserves the confirmed state and exposes its error", async () => {
  const h = tiktokRuntime(async () => response({ ok: false, error: "denied" }, false));
  await h.render().disconnectTiktok();
  assert.equal(h.render().tiktokConnected, true);
  assert.ok(h.render().tiktokProfileUrlError);
  assert.equal(h.patches.length, 0);
});

test("TikTok: a delayed response from a previous account cannot overwrite the new account", async () => {
  const disconnect = deferred<any>();
  const h = tiktokRuntime(() => disconnect.promise);
  const write = h.render().disconnectTiktok();
  h.changeAccount();
  h.render().applyTiktokConnectionState({ connected: true, username: "other" });
  disconnect.resolve(response({ ok: true, tiktok: { connected: false } }));
  await write;
  assert.equal(h.render().tiktokConnected, true);
  assert.equal(h.render().tiktokUsername, "other");
});

function siteRuntime(fetch: any) {
  let accountId = "account-a";
  const patches: Dict[] = [];
  let cache = JSON.stringify({ state: { gmbConnected: true, siteWebSettingsText: JSON.stringify({ ga4: {}, gsc: {}, actus_widget: { limit: 9 } }) } });
  const refresh = deferred<void>();
  const h = runtime("app/dashboard/_hooks/channels/useSiteWebChannel.ts", {
    fetch,
    "@/lib/browserAccountCache": { getActiveBrowserUserId: () => accountId, resolveActiveBrowserUserId: () => accountId, readAccountCacheValue: () => cache, writeAccountCacheValue: (_key: string, value: string) => { cache = value; } },
  });
  const args = { extractDomain: (x: string) => x, fetchWidgetToken: async () => "token", patchChannelConnectionLocally: (_channel: string, patch: Dict) => patches.push(patch), triggerChannelRefresh: () => refresh.promise };
  const render = () => h.render("useSiteWebChannel", args);
  const hook = render();
  hook.setSiteWebSavedUrl("https://example.test");
  hook.setSiteWebSettingsText(JSON.stringify({ url: "https://example.test", ga4: { property_id: "12" }, gsc: { property: "sc-domain:example.test" }, actus_widget: { limit: 9 } }));
  hook.setSiteWebGa4Connected(true); hook.setSiteWebGscConnected(true);
  return { render, patches, cache: () => JSON.parse(cache).state, changeAccount: () => { accountId = "account-b"; } };
}

test("site: GA4 disconnect waits for its route, avoids duplicate writes and does not wait for statistics", async () => {
  const pending = deferred<any>();
  const calls: Dict[] = [];
  const h = siteRuntime((url: string, options: Dict) => { calls.push({ url, ...options }); return pending.promise; });
  const hook = h.render();
  const write = hook.disconnectSiteWebGa4();
  assert.ok(write instanceof Promise);
  assert.equal(hook.disconnectSiteWebGa4(), write);
  let done = false; void write.then(() => { done = true; });
  await tick();
  assert.equal(done, false);
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].body), { source: "site_web", product: "ga4" });
  pending.resolve(response({ ok: true }));
  await write;
  assert.equal(h.render().siteWebGa4Connected, false);
  assert.equal(h.render().siteWebGscConnected, true);
  const settings = JSON.parse(h.render().siteWebSettingsText);
  assert.equal(settings.ga4, undefined);
  assert.deepEqual(settings.actus_widget, { limit: 9 });
  assert.equal(h.patches[0].statsConnected, true);
  assert.equal(h.cache().siteWebGa4Connected, false);
  assert.equal(h.cache().siteWebGscConnected, true);
  assert.equal(h.cache().siteWebGa4PropertyId, "");
  assert.equal(h.cache().gmbConnected, true);
  assert.equal(JSON.parse(h.cache().siteWebSettingsText).ga4, undefined);
});

test("site: failed disconnect does not clear the product or claim success", async () => {
  const h = siteRuntime(async () => response({ ok: false }, false));
  await assert.rejects(h.render().disconnectSiteWebGsc());
  assert.equal(h.render().siteWebGscConnected, true);
  assert.equal(h.render().siteWebGscNotice, null);
  assert.ok(h.render().siteWebSettingsError);
  assert.equal(h.patches.length, 0);
});

test("site: product disconnects are serialized and preserve both removals", async () => {
  const pending = [deferred<any>(), deferred<any>()];
  const calls: Dict[] = [];
  const h = siteRuntime((_url: string, init: Dict) => { const index = calls.length; calls.push(JSON.parse(init.body)); return pending[index].promise; });
  const hook = h.render();
  const ga4 = hook.disconnectSiteWebGa4();
  const gsc = hook.disconnectSiteWebGsc();
  await tick(); assert.equal(calls.length, 1);
  pending[0].resolve(response({ ok: true })); await ga4; await tick();
  assert.equal(calls.length, 2);
  pending[1].resolve(response({ ok: true })); await gsc;
  assert.equal(h.render().siteWebGa4Connected, false);
  assert.equal(h.render().siteWebGscConnected, false);
  assert.equal(h.patches.at(-1)?.statsConnected, false);
  const settings = JSON.parse(h.render().siteWebSettingsText);
  assert.equal(settings.ga4, undefined); assert.equal(settings.gsc, undefined);
});

test("site: a previous establishment's disconnect response cannot clear the current product", async () => {
  const pending = deferred<any>();
  const h = siteRuntime(() => pending.promise);
  const write = h.render().disconnectSiteWebGa4();
  await tick(); h.changeAccount();
  pending.resolve(response({ ok: true })); await write;
  assert.equal(h.render().siteWebGa4Connected, true);
  assert.equal(h.patches.length, 0);
});
