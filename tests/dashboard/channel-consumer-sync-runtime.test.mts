/* eslint-disable @typescript-eslint/no-explicit-any -- browser effects execute against isolated event and network adapters */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

type Dict = Record<string, any>;
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const EVENT = "inrcy:channel-connection-updated";
const CACHE = "inrcy_dashboard_channel_state_v2";
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function browser() {
  let accountId = "account-a";
  const window = Object.assign(new EventTarget(), { setInterval: () => 1, clearInterval() {} });
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const cacheKey = () => `${CACHE}:uid:${accountId}`;
  const exports: Dict = {};
  const code = ts.transpileModule(read("lib/channelConnectionUpdates.ts"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const require = (name: string) => {
    if (name === "@/lib/browserAccountCache") return { getActiveBrowserUserId: () => accountId, accountScopedStorageKey: cacheKey };
    if (name === "@/lib/dashboardCacheKeys") return { DASHBOARD_CACHE_KEYS: { channelState: CACHE } };
    throw new Error(`Unexpected dependency: ${name}`);
  };
  new Function("require", "exports", "window", "queueMicrotask", code)(require, exports, window, queueMicrotask);
  return {
    window, document, cacheKey,
    subscribe: exports.subscribeToChannelConnectionUpdates,
    account: () => accountId,
    changeAccount: (next: string) => { accountId = next; },
    confirm: (scope = accountId) => window.dispatchEvent(new CustomEvent(EVENT, { detail: { accountId: scope, channel: "gmb" } })),
    storage: (oldValue: string | null, newValue: string | null, key = cacheKey()) => window.dispatchEvent(Object.assign(new Event("storage"), { oldValue, newValue, key })),
  };
}

function runEffect(path: string, marker: string, dependencies: Dict) {
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" && node.arguments[0]?.getText(source).includes(marker)) found = node.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, `Missing effect: ${marker}`);
  const compiled = ts.transpileModule(`const effect = (${found.getText(source)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function(...Object.keys(dependencies), `${compiled}\nreturn effect();`)(...Object.values(dependencies));
}

test("connection updates: confirmed changes are immediate, account scoped and coalesced", async () => {
  const b = browser();
  let refreshes = 0;
  const unsubscribe = b.subscribe(() => refreshes++);
  b.confirm("account-b");
  await tick();
  assert.equal(refreshes, 0);
  b.confirm();
  b.confirm();
  await tick();
  assert.equal(refreshes, 1);
  unsubscribe();
});

test("connection updates: another tab's changed state refreshes but timestamps and unrelated accounts do not", async () => {
  const b = browser();
  let refreshes = 0;
  const unsubscribe = b.subscribe(() => refreshes++);
  const before = JSON.stringify({ cachedAt: 1, state: { gmbConnected: true, facebookPageConnected: true } });
  const same = JSON.stringify({ cachedAt: 2, state: { facebookPageConnected: true, gmbConnected: true } });
  const changed = JSON.stringify({ cachedAt: 3, state: { gmbConnected: false, facebookPageConnected: true } });
  b.storage(before, same);
  b.storage(before, changed, `${CACHE}:uid:account-b`);
  await tick();
  assert.equal(refreshes, 0);
  b.storage(same, changed);
  await tick();
  assert.equal(refreshes, 1);
  unsubscribe();
});

test("connection updates: queued work is cancelled on unmount or account change", async () => {
  const b = browser();
  let refreshes = 0;
  let unsubscribe = b.subscribe(() => refreshes++);
  b.confirm();
  unsubscribe();
  await tick();
  assert.equal(refreshes, 0);
  unsubscribe = b.subscribe(() => refreshes++);
  b.confirm();
  b.changeAccount("account-b");
  await tick();
  assert.equal(refreshes, 0);
  unsubscribe();
});

for (const consumer of ["Booster", "iNrAgent"] as const) {
  test(`${consumer}: confirmed disconnect immediately revalidates and a stale connected response cannot win`, async () => {
    const b = browser();
    const requests: Array<ReturnType<typeof deferred<Dict>>> = [];
    const applied: Dict[] = [];
    let details: Dict = {};
    let loadState = "loading";
    const dependencies = {
      window: b.window,
      document: b.document,
      getActiveBrowserUserId: b.account,
      subscribeToChannelConnectionUpdates: b.subscribe,
      fetch: async () => { const next = deferred<Dict>(); requests.push(next); return next.promise; },
      CHANNEL_KEYS: ["gmb", "pinterest", "tiktok"],
      EMPTY_CHANNEL_DETAILS: {},
      applyConnectedChannels: (next: Dict) => applied.push(next),
      setChannelDetails: (update: any) => { details = typeof update === "function" ? update(details) : update; },
      setConnectedChannelsLoadState: (update: any) => { loadState = typeof update === "function" ? update(loadState) : update; },
      setAgentConnectedChannels: (next: Dict) => applied.push(next),
      writeCachedAgentViewSnapshot() {},
      channelMapFromConnectionStates: (state: Dict) => ({ gmb: state.gmb.connected, threads: false }),
      metaPilotEnabled: false,
      i18nT: (key: string) => key,
    };
    const cleanup = consumer === "Booster"
      ? runEffect("app/dashboard/booster/publier/PublishModal.tsx", "const refreshConnectedChannels", dependencies)
      : runEffect("app/dashboard/agent/_hooks/useAgentRuntimeData.ts", "async function loadConnectedChannels", dependencies);
    assert.equal(requests.length, 1);
    b.confirm();
    await tick();
    assert.equal(requests.length, 2, "Revalidation must not wait for focus or a polling interval");
    const data = (connected: boolean) => consumer === "Booster" ? { channels: { gmb: connected, pinterest: false, tiktok: false } } : { gmb: { connected } };
    requests[1].resolve({ ok: true, json: async () => data(false) });
    await tick();
    requests[0].resolve({ ok: true, json: async () => data(true) });
    await tick();
    assert.equal(applied.length, 1);
    assert.equal(applied[0].gmb, false);
    cleanup();
    b.confirm();
    await tick();
    assert.equal(requests.length, 2);
  });
}

test("Booster: a late Pinterest profile request cannot restore details after disconnect", async () => {
  const b = browser();
  const identity = deferred<Dict>();
  let connected = true;
  let details: Dict = {};
  let detailWrites = 0;
  const cleanup = runEffect("app/dashboard/booster/publier/PublishModal.tsx", "const refreshConnectedChannels", {
    window: b.window,
    getActiveBrowserUserId: b.account,
    subscribeToChannelConnectionUpdates: b.subscribe,
    fetch: async (url: string) => url.includes("/pinterest/") ? identity.promise : { ok: true, json: async () => ({ channels: { pinterest: connected }, channelDetails: { pinterest: { label: connected ? "initial" : "" } } }) },
    CHANNEL_KEYS: ["pinterest"],
    EMPTY_CHANNEL_DETAILS: {},
    applyConnectedChannels() {},
    normalizeExternalHref: (href: string) => href,
    setChannelDetails: (update: any) => { detailWrites++; details = typeof update === "function" ? update(details) : update; },
  });
  await tick();
  connected = false;
  b.confirm();
  await tick();
  assert.equal(details.pinterest.label, "");
  const writesBefore = detailWrites;
  identity.resolve({ ok: true, json: async () => ({ ok: true, connected: true, username: "stale-account" }) });
  await tick();
  assert.equal(detailWrites, writesBefore);
  assert.equal(details.pinterest.label, "");
  cleanup();
});
