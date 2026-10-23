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

test("Booster: Pinterest refresh commits one enriched detail snapshot while connectivity updates immediately", async () => {
  const b = browser();
  const identities: Array<ReturnType<typeof deferred<Dict>>> = [];
  const applied: Dict[] = [];
  const writes: Dict[] = [];
  const serverDetails = { pinterest: { type: "account", label: "Compte Pinterest connecté", href: null } };
  let details: Dict = { pinterest: { label: "Compte déjà chargé", href: "https://www.pinterest.fr/previous/" } };
  const cleanup = runEffect("app/dashboard/booster/publier/PublishModal.tsx", "const refreshConnectedChannels", {
    window: b.window,
    getActiveBrowserUserId: b.account,
    subscribeToChannelConnectionUpdates: b.subscribe,
    fetch: async (url: string) => {
      if (url.includes("/pinterest/")) {
        const identity = deferred<Dict>();
        identities.push(identity);
        return identity.promise;
      }
      return { ok: true, json: async () => ({ channels: { pinterest: true }, channelDetails: serverDetails }) };
    },
    CHANNEL_KEYS: ["pinterest"],
    EMPTY_CHANNEL_DETAILS: {},
    applyConnectedChannels: (next: Dict) => applied.push(next),
    normalizeExternalHref: (href: string) => href,
    setChannelDetails: (update: any) => { details = typeof update === "function" ? update(details) : update; writes.push(details); },
  });
  await tick();
  assert.equal(applied[0].pinterest, true, "Connectivity must not wait for the live profile");
  assert.equal(identities.length, 1);
  assert.equal(writes.length, 0, "The generic server label must not be emitted while enrichment is pending");
  assert.equal(details.pinterest.label, "Compte déjà chargé");
  identities[0].resolve({ ok: true, json: async () => ({ ok: true, connected: true, username: "@fresh-account", accountName: "Compte Pinterest précis" }) });
  await tick();
  assert.equal(writes.length, 1);
  assert.equal(details.pinterest.label, "Compte Pinterest précis");
  assert.equal(details.pinterest.href, "https://www.pinterest.fr/fresh-account/");
  assert.equal(details.pinterest.availabilityError, false);
  assert.equal(serverDetails.pinterest.label, "Compte Pinterest connecté", "The response snapshot must not be mutated");
  b.window.dispatchEvent(new Event("focus"));
  await tick();
  assert.equal(applied.length, 2);
  assert.equal(writes.length, 1, "Focus refresh must keep the complete label until its new snapshot is ready");
  identities[1].resolve({ ok: true, json: async () => ({ ok: true, connected: true, username: "new-account" }) });
  await tick();
  assert.equal(writes.length, 2);
  assert.equal(details.pinterest.label, "new-account", "A fresh identity must replace the old one instead of hiding it behind a display cache");
  assert.ok(writes.every((snapshot) => snapshot.pinterest.label !== "Compte Pinterest connecté"));
  cleanup();
});

for (const failure of ["http", "network", "json"] as const) {
  test(`Booster: Pinterest ${failure} failure commits the server fallback once after enrichment settles`, async () => {
    const b = browser();
    const identity = deferred<Dict>();
    const writes: Dict[] = [];
    let details: Dict = { pinterest: { label: "Ancien compte" } };
    const cleanup = runEffect("app/dashboard/booster/publier/PublishModal.tsx", "const refreshConnectedChannels", {
      window: b.window,
      getActiveBrowserUserId: b.account,
      subscribeToChannelConnectionUpdates: b.subscribe,
      fetch: async (url: string) => {
        if (url.includes("/pinterest/")) {
          const response = await identity.promise;
          if (failure === "network") throw new Error("Network unavailable");
          return response;
        }
        return { ok: true, json: async () => ({ channels: { pinterest: true }, channelDetails: { pinterest: { label: "Compte Pinterest connecté" } } }) };
      },
      CHANNEL_KEYS: ["pinterest"],
      EMPTY_CHANNEL_DETAILS: {},
      applyConnectedChannels() {},
      normalizeExternalHref: (href: string) => href,
      setChannelDetails: (update: any) => { details = typeof update === "function" ? update(details) : update; writes.push(details); },
    });
    await tick();
    assert.equal(writes.length, 0);
    identity.resolve({ ok: failure !== "http", json: async () => { throw new Error("Invalid JSON"); } });
    await tick();
    assert.equal(writes.length, 1);
    assert.equal(details.pinterest.label, "Compte Pinterest connecté");
    cleanup();
  });
}

test("Booster: a pending Pinterest identity is ignored after an account switch", async () => {
  const b = browser();
  const identity = deferred<Dict>();
  let detailWrites = 0;
  const cleanup = runEffect("app/dashboard/booster/publier/PublishModal.tsx", "const refreshConnectedChannels", {
    window: b.window,
    getActiveBrowserUserId: b.account,
    subscribeToChannelConnectionUpdates: b.subscribe,
    fetch: async (url: string) => url.includes("/pinterest/") ? identity.promise : { ok: true, json: async () => ({ channels: { pinterest: true }, channelDetails: { pinterest: { label: "Compte Pinterest connecté" } } }) },
    CHANNEL_KEYS: ["pinterest"],
    EMPTY_CHANNEL_DETAILS: {},
    applyConnectedChannels() {},
    normalizeExternalHref: (href: string) => href,
    setChannelDetails: () => { detailWrites++; },
  });
  await tick();
  assert.equal(detailWrites, 0);
  b.changeAccount("account-b");
  identity.resolve({ ok: true, json: async () => ({ ok: true, connected: true, username: "stale-account" }) });
  await tick();
  assert.equal(detailWrites, 0);
  cleanup();
});

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
