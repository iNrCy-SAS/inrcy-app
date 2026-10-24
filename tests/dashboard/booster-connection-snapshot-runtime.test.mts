/* eslint-disable @typescript-eslint/no-explicit-any -- isolated browser storage runtime */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const keys = ["gmb", "pinterest", "facebook", "site_web"] as const;
const channels = { gmb: true, pinterest: true, facebook: true, site_web: true };
const details = {
  gmb: { type: "location", label: "iNrCy", href: "https://maps.google.com/?cid=123" },
  pinterest: { type: "account", label: "iNrCy Pinterest", href: "https://www.pinterest.fr/inrcy/" },
  facebook: { type: "page", label: "iNrCy Facebook", href: "https://www.facebook.com/inrcy/" },
  site_web: { type: "url", label: "inrcy.com", href: "https://inrcy.com/" },
};

function storage() {
  const values = new Map<string, string>();
  return {
    values,
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

function harness() {
  let activeAccount: string | null = "account-a";
  let now = 1_800_000_000_000;
  const sessionStorage = storage();
  const localStorage = storage();
  const document = { get cookie() { return activeAccount ? `inrcy_uid=${activeAccount}` : ""; } };
  const window = { sessionStorage, localStorage };
  const loaded = new Map<string, any>();
  const load = (path: string): any => {
    if (loaded.has(path)) return loaded.get(path);
    const loadedModule = { exports: {} };
    loaded.set(path, loadedModule.exports);
    const source = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function("module", "exports", "require", "window", "document", "Date", output)(
      loadedModule, loadedModule.exports,
      (name: string) => {
        assert.ok(name.startsWith("@/lib/"), `Unexpected dependency ${name}`);
        return load(`${name.slice(2)}.ts`);
      }, window, document, class extends Date { static now() { return now; } },
    );
    return loadedModule.exports;
  };
  const api = load("app/dashboard/booster/publier/publishConnectionSnapshot.ts");
  const cache = load("lib/browserAccountCache.ts");
  const cacheKeys = load("lib/dashboardCacheKeys.ts").DASHBOARD_CACHE_KEYS;
  const read = (actor = "actor-one", account: string | null = "account-a") => api.readBoosterConnectionSnapshot(actor, account, keys);
  const write = (actor = "actor-one", account: string | null = "account-a", states: any = channels, names: any = details) => api.writeBoosterConnectionSnapshot(actor, account, keys, states, names);
  const snapshotKey = () => [...localStorage.values.keys()].find(key => key.startsWith(`${cacheKeys.boosterConnections}:uid:`))!;
  const modify = (change: (value: any) => void) => {
    const key = snapshotKey();
    const value = JSON.parse(localStorage.getItem(key)!);
    change(value);
    for (const store of [sessionStorage, localStorage]) store.setItem(key, JSON.stringify(value));
  };
  return {
    read, write, modify, snapshotKey, sessionStorage, localStorage, cache, cacheKeys,
    account: (next: string | null) => { activeAccount = next; },
    time: (elapsed: number) => { now += elapsed; },
    dashboard: (state: unknown, offset = 0) => cache.writeAccountCacheValue(cacheKeys.channelState, JSON.stringify({ cachedAt: now + offset, state }), "account-a"),
  };
}

test("Booster: warm restore preserves public account names and separates authenticated actors", () => {
  const h = harness();
  h.write("actor-one", "account-a", channels, { ...details, pinterest: { ...details.pinterest, access_token: "not-public", refresh_token: "also-private" } });
  assert.deepEqual(h.read()?.channels, channels);
  assert.equal(h.read()?.channelDetails.pinterest.label, "iNrCy Pinterest");
  assert.equal(h.read("actor-two"), null);
  assert.equal(h.read("actor-one", "account-b"), null);
  h.write("actor-two", "account-a", channels, { ...details, pinterest: { ...details.pinterest, label: "Other actor view" } });
  assert.equal(h.read("actor-two")?.channelDetails.pinterest.label, "Other actor view");
  assert.equal(h.read()?.channelDetails.pinterest.label, "iNrCy Pinterest");
  assert.doesNotMatch([...h.localStorage.values.values()].join(""), /not-public|also-private|access_token|refresh_token/);
});

test("Booster: account changes reject obsolete reads and writes; hydration never writes anonymously", () => {
  const h = harness();
  h.write();
  h.account("account-b");
  assert.equal(h.read(), null);
  h.write("actor-one", "account-a", { ...channels, pinterest: false });
  h.account("account-a");
  assert.equal(h.read()?.channels.pinterest, true, "old request cannot replace account A while B is active");
  h.account(null);
  assert.equal(h.read()?.channelDetails.gmb.label, "iNrCy", "explicit trusted server scope can restore before the browser cookie hydrates");
  h.write("actor-one", "account-a", { ...channels, pinterest: false });
  assert.equal(h.read()?.channels.pinterest, true);
  assert.equal(h.read("", "account-a"), null);
  assert.equal(h.read("actor-one", null), null);
  h.write("", "account-a");
  h.write("actor-one", null);
  assert.equal(h.localStorage.length, 1);
});

test("Booster: snapshots expire after 24 hours and reject future or corrupt timestamps", () => {
  const h = harness();
  h.write();
  h.time(24 * 60 * 60 * 1_000);
  assert.ok(h.read());
  h.time(1);
  assert.equal(h.read(), null);
  h.write();
  h.modify(value => { value.cachedAt += 1; });
  assert.equal(h.read(), null);
  h.modify(value => { value.cachedAt = "yesterday"; });
  assert.equal(h.read(), null);
});

test("Booster: only complete boolean snapshots are restored, and availability errors cannot replace a good cache", () => {
  const h = harness();
  h.write();
  h.write("actor-one", "account-a", channels, { ...details, gmb: { availabilityError: true } });
  assert.equal(h.read()?.channelDetails.gmb.label, "iNrCy");
  h.write("actor-one", "account-a", { gmb: true, pinterest: true });
  assert.ok(h.read());
  h.modify(value => { value.channels.facebook = "true"; });
  assert.equal(h.read(), null);
  h.write();
  h.modify(value => { delete value.channelDetails.pinterest; });
  assert.equal(h.read(), null);
});

test("Booster: invalid versions, actor metadata and malformed JSON are ignored", () => {
  const h = harness();
  for (const change of [
    (value: any) => { value.version = 2; },
    (value: any) => { value.actorUserId = "other-actor"; },
    (value: any) => { value.accountId = "other-account"; },
  ]) {
    h.write(); h.modify(change); assert.equal(h.read(), null);
  }
  for (const store of [h.localStorage, h.sessionStorage]) store.setItem(h.snapshotKey(), "not-json");
  assert.equal(h.read(), null);
});

test("Booster: a newer cross-tab snapshot wins over the older session copy", () => {
  const h = harness();
  h.write();
  const key = h.snapshotKey();
  const old = h.sessionStorage.getItem(key)!;
  h.time(50);
  h.write("actor-one", "account-a", { ...channels, pinterest: false });
  const latest = h.localStorage.getItem(key)!;
  h.sessionStorage.setItem(key, old);
  assert.equal(h.read()?.channels.pinterest, false);
  h.sessionStorage.setItem(key, latest);
  h.localStorage.setItem(key, old);
  assert.equal(h.read()?.channels.pinterest, false, "a newer successful session write survives an older persistent copy");
});

test("Booster: a newer confirmed dashboard disconnect or reconnect requirement invalidates stale connected cards", () => {
  const cases = [
    { pinterestConnected: false }, { facebookPageConnected: false },
    { gmbConnectionStatus: "disconnected" }, { gmbConnectionStatus: "needs_update" },
    { pinterestRequiresUpdate: true },
    { gmbAccountConnected: false }, { gmbConfigured: false }, { siteWebSavedUrl: "" },
  ];
  for (const state of cases) {
    const h = harness(); h.write(); h.time(1); h.dashboard(state);
    assert.equal(h.read(), null, JSON.stringify(state));
  }
  const h = harness(); h.write(); h.dashboard({ pinterestConnected: false }, -1);
  assert.ok(h.read(), "older dashboard data does not erase a newer confirmed Booster connection");
  h.dashboard({ pinterestConnected: false });
  assert.equal(h.read(), null, "equal timestamps prefer the known disconnect");
});

test("Booster: logout cache purge includes every actor/account snapshot in both storages", () => {
  const h = harness(); h.write(); h.write("actor-two");
  h.localStorage.setItem("unrelated-setting", "keep");
  h.cache.purgeAllBrowserAccountCaches();
  assert.equal(h.read(), null);
  assert.equal(h.sessionStorage.length, 0);
  assert.deepEqual([...h.localStorage.values.entries()], [["unrelated-setting", "keep"]]);
});

test("Booster: only safe public HTTP links enter the snapshot", () => {
  const h = harness();
  for (const href of ["javascript:alert(1)", "https://user:secret@example.com/", "https://example.com/?access_token=secret"]) {
    h.write("actor-one", "account-a", channels, { ...details, pinterest: { ...details.pinterest, href } });
    assert.equal(h.read()?.channelDetails.pinterest.href, null);
    assert.doesNotMatch(h.localStorage.getItem(h.snapshotKey())!, /secret|alert\(1\)/);
  }
});

test("Booster: unavailable browser storage remains a harmless cache miss", () => {
  const h = harness();
  for (const store of [h.localStorage, h.sessionStorage]) {
    store.setItem = () => { throw new Error("Storage denied"); };
    store.getItem = () => { throw new Error("Storage denied"); };
  }
  assert.doesNotThrow(() => h.write());
  assert.equal(h.read(), null);
});
