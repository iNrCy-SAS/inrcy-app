/* eslint-disable @typescript-eslint/no-explicit-any -- browser effects execute against isolated event and network adapters */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { ACTIVE_INRCY_ACCOUNT_EVENT } from "../../lib/multicompte/constants.ts";

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

function browser(initialAccountId: string | null = "account-a") {
  let accountId = initialAccountId;
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
    changeAccount: (next: string | null) => {
      if (next === accountId) return;
      accountId = next;
      window.dispatchEvent(new CustomEvent(ACTIVE_INRCY_ACCOUNT_EVENT, { detail: { activeUserId: next } }));
    },
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

function connectedChannelsCallback(dependencies: Dict): (next: Dict) => void {
  const path = "app/dashboard/booster/publier/PublishModal.tsx";
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "applyConnectedChannels" &&
      node.initializer && ts.isCallExpression(node.initializer)) found = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, "Missing channel selection callback");
  const compiled = ts.transpileModule(`const callback = (${found.getText(source)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function(...Object.keys(dependencies), `${compiled}\nreturn callback;`)(...Object.values(dependencies));
}

function boosterEffect(options: {
  fetch: (url: string) => Promise<Dict>;
  browser?: ReturnType<typeof browser>;
  details?: Dict;
  detailScope?: string | null;
  connected?: Dict;
  readSnapshot?: (actor: string, scope: string | null) => Dict | null;
}) {
  const b = options.browser ?? browser();
  const applied: Dict[] = [];
  const writes: Dict[] = [];
  let details: Dict = options.details ?? {};
  let loadState = "loading";
  let hasKnown = Boolean(options.details);
  const channelKeys = ["gmb", "facebook", "pinterest", "tiktok"];
  let selection = Object.fromEntries(channelKeys.map(key => [key, false]));
  let connected: Dict = options.connected ?? {};
  const draftChannelsRestoredRef = { current: false };
  const manuallyControlledChannelsRef = { current: new Set<string>() };
  const setConnected = (next: Dict) => { connected = next; applied.push(next); };
  const applyConnectedChannels = connectedChannelsCallback({
    CHANNEL_KEYS: channelKeys,
    draftChannelsRestoredRef,
    manuallyControlledChannelsRef,
    setConnected,
    setChannels: (update: any) => { selection = typeof update === "function" ? update(selection) : update; },
  });
  const cleanup = runEffect("app/dashboard/booster/publier/PublishModal.tsx", "const refreshConnectedChannels", {
    window: b.window,
    document: b.document,
    ACTIVE_INRCY_ACCOUNT_EVENT,
    getActiveBrowserUserId: b.account,
    actorUserId: "actor-a", activeAccountId: "",
    connectedChannelsActorRef: { current: "actor-a" },
    readBoosterConnectionSnapshot: options.readSnapshot ?? (() => null),
    setHasKnownChannelConnections: (next: boolean) => { hasKnown = next; },
    subscribeToChannelConnectionUpdates: b.subscribe,
    connectedChannelsScopeRef: { current: options.detailScope === undefined ? (options.details ? b.account() : undefined) : options.detailScope },
    authoritativeChannelsRef: { current: false },
    fetch: options.fetch,
    CHANNEL_KEYS: channelKeys,
    EMPTY_CHANNEL_DETAILS: Object.fromEntries(channelKeys.map(key => [key, { label: "", href: null }])),
    setConnected,
    applyConnectedChannels,
    normalizeExternalHref: (href: string) => href,
    setChannelDetails: (update: any) => {
      details = typeof update === "function" ? update(details) : update;
      writes.push(details);
    },
    setConnectedChannelsLoadState: (update: any) => { loadState = typeof update === "function" ? update(loadState) : update; },
  });
  return {
    browser: b, cleanup, applied, writes, details: () => details, loadState: () => loadState,
    selection: () => selection,
    connected: () => connected,
    hasKnown: () => hasKnown,
    restoreDraft: (next: Dict) => {
      draftChannelsRestoredRef.current = true;
      selection = { ...selection, ...next };
    },
    chooseChannel: (key: string, selected: boolean) => {
      manuallyControlledChannelsRef.current.add(key);
      selection = { ...selection, [key]: selected };
    },
  };
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
      ACTIVE_INRCY_ACCOUNT_EVENT,
      getActiveBrowserUserId: b.account,
      actorUserId: "actor-a", activeAccountId: "",
      connectedChannelsActorRef: { current: "actor-a" },
      readBoosterConnectionSnapshot: () => null,
      setHasKnownChannelConnections() {},
      subscribeToChannelConnectionUpdates: b.subscribe,
      connectedChannelsScopeRef: { current: undefined },
      authoritativeChannelsRef: { current: false },
      fetch: async () => { const next = deferred<Dict>(); requests.push(next); return next.promise; },
      CHANNEL_KEYS: ["gmb", "pinterest", "tiktok"],
      EMPTY_CHANNEL_DETAILS: {},
      setConnected: (next: Dict) => applied.push(next),
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
    const initialWrites = applied.length;
    b.confirm();
    await tick();
    assert.equal(requests.length, 2, "Revalidation must not wait for focus or a polling interval");
    const data = (connected: boolean) => consumer === "Booster" ? { channels: { gmb: connected, pinterest: false, tiktok: false } } : { gmb: { connected } };
    requests[1].resolve({ ok: true, json: async () => data(false) });
    await tick();
    requests[0].resolve({ ok: true, json: async () => data(true) });
    await tick();
    assert.equal(applied.length, initialWrites + 1);
    assert.equal(applied.at(-1)?.gmb, false);
    cleanup();
    b.confirm();
    await tick();
    assert.equal(requests.length, 2);
  });
}

test("Booster: account hydration retries immediately and ignores the response started without an account", async () => {
  const b = browser(null);
  const requests: Array<{ scope: string | null; response: ReturnType<typeof deferred<Dict>> }> = [];
  const harness = boosterEffect({
    browser: b,
    fetch: async () => {
      const response = deferred<Dict>();
      requests.push({ scope: b.account(), response });
      return response.promise;
    },
  });
  b.changeAccount("account-a");
  await tick();
  const current = requests.find(request => request.scope === "account-a");
  assert.ok(current, "Hydration must revalidate without waiting for focus, polling or Mes canaux");
  current.response.resolve({ ok: true, json: async () => ({ channels: { gmb: true }, channelDetails: { gmb: { label: "Société A" } } }) });
  await tick();
  assert.equal(harness.applied.at(-1)?.gmb, true);
  assert.equal(harness.details().gmb.label, "Société A");
  assert.equal(harness.loadState(), "ready");
  const writesBefore = harness.writes.length;
  const appliedBefore = harness.applied.length;
  for (const request of requests.filter(request => request.scope === null)) {
    request.response.resolve({ ok: true, json: async () => ({ channels: { gmb: false }, channelDetails: { gmb: { label: "Périmètre périmé" } } }) });
  }
  await tick();
  assert.equal(harness.writes.length, writesBefore);
  assert.equal(harness.applied.length, appliedBefore);
  harness.cleanup();
  const requestsBefore = requests.length;
  b.changeAccount("account-b");
  await tick();
  assert.equal(requests.length, requestsBefore, "Unmount must remove the account listener");
});

for (const selectionSource of ["draft", "manual"] as const) {
  test(`Booster: account hydration preserves ${selectionSource} selection while availability is revalidated`, async () => {
    const b = browser(null);
    const requests: Array<ReturnType<typeof deferred<Dict>>> = [];
    const harness = boosterEffect({
      browser: b,
      fetch: async () => {
        const response = deferred<Dict>();
        requests.push(response);
        return response.promise;
      },
    });
    const available = () => ({
      ok: true,
      json: async () => ({ channels: { gmb: true, facebook: true }, channelDetails: {} }),
    });
    // The server can resolve the authenticated account before its browser hint hydrates.
    requests[0].resolve(available());
    await tick();
    if (selectionSource === "draft") {
      harness.restoreDraft({ gmb: true, facebook: false });
    } else {
      harness.chooseChannel("gmb", true);
      harness.chooseChannel("facebook", false);
    }
    const intendedSelection = { ...harness.selection() };
    b.changeAccount("account-a");
    await tick();
    assert.equal(requests.length, 2);
    assert.equal(harness.loadState(), "loading");
    assert.equal(harness.connected().gmb, false, "The old scope must not remain available during hydration");
    assert.deepEqual(harness.selection(), intendedSelection, "Temporary unavailability must not erase intent");
    requests[1].resolve(available());
    await tick();
    assert.equal(harness.connected().gmb, true);
    assert.equal(harness.loadState(), "ready");
    assert.deepEqual(harness.selection(), intendedSelection, "The real selection callback must preserve checked and unchecked choices");
    harness.cleanup();
  });
}

test("Booster: all server account names render immediately while Pinterest identity is still pending", async () => {
  const identities: Array<ReturnType<typeof deferred<Dict>>> = [];
  const serverDetails = {
    gmb: { type: "account", label: "Entreprise Google", href: "https://maps.google.com/" },
    facebook: { type: "account", label: "Page Facebook", href: "https://www.facebook.com/company/" },
    pinterest: { type: "account", label: "Compte Pinterest connecté", href: null },
  };
  const harness = boosterEffect({
    fetch: async (url: string) => {
      if (url.includes("/pinterest/")) {
        const identity = deferred<Dict>();
        identities.push(identity);
        return identity.promise;
      }
      return { ok: true, json: async () => ({ channels: { gmb: true, facebook: true, pinterest: true }, channelDetails: serverDetails }) };
    },
  });
  await tick();
  assert.equal(harness.applied.at(-1)?.pinterest, true, "Connectivity must not wait for the live profile");
  assert.equal(identities.length, 1);
  assert.equal(harness.details().gmb.label, "Entreprise Google", "Google's name must not wait for Pinterest");
  assert.equal(harness.details().facebook.label, "Page Facebook", "Facebook's name must not wait for Pinterest");
  assert.equal(harness.loadState(), "ready", "Availability is authoritative before optional identity enrichment");
  identities[0].resolve({ ok: true, json: async () => ({ ok: true, connected: true, username: "@fresh-account", accountName: "Compte Pinterest précis" }) });
  await tick();
  assert.equal(harness.details().pinterest.label, "Compte Pinterest précis");
  assert.equal(harness.details().pinterest.href, "https://www.pinterest.fr/fresh-account/");
  assert.equal(harness.details().pinterest.availabilityError, false);
  assert.equal(harness.details().gmb.label, "Entreprise Google");
  assert.equal(harness.details().facebook.label, "Page Facebook");
  assert.equal(serverDetails.pinterest.label, "Compte Pinterest connecté", "The response snapshot must not be mutated");
  assert.equal(serverDetails.pinterest.href, null, "The generic server snapshot carries no profile identity");
  harness.browser.window.dispatchEvent(new Event("focus"));
  await tick();
  assert.equal(identities.length, 2);
  assert.equal(harness.details().pinterest.label, "Compte Pinterest précis", "A generic null-href snapshot in the same account must not erase a known identity");
  identities[1].resolve({ ok: true, json: async () => ({ ok: true, connected: true, username: "new-account" }) });
  await tick();
  assert.equal(harness.details().pinterest.label, "new-account", "A fresh identity must replace the old one instead of hiding it behind a display cache");
  harness.cleanup();
});

for (const failure of ["http", "network", "json"] as const) {
  test(`Booster: Pinterest ${failure} failure retains a known identity without blocking other names`, async () => {
    const identity = deferred<Dict>();
    const profileHref = "https://www.pinterest.fr/known/";
    const harness = boosterEffect({
      details: { pinterest: { label: "Compte connu", href: profileHref } },
      fetch: async (url: string) => {
        if (url.includes("/pinterest/")) {
          const response = await identity.promise;
          if (failure === "network") throw new Error("Network unavailable");
          return response;
        }
        return { ok: true, json: async () => ({ channels: { gmb: true, pinterest: true }, channelDetails: { gmb: { label: "Société à jour" }, pinterest: { label: "Compte Pinterest connecté", href: profileHref } } }) };
      },
    });
    await tick();
    assert.equal(harness.details().gmb.label, "Société à jour");
    assert.equal(harness.details().pinterest.label, "Compte connu");
    identity.resolve({ ok: failure !== "http", json: async () => { throw new Error("Invalid JSON"); } });
    await tick();
    assert.equal(harness.details().pinterest.label, "Compte connu");
    assert.equal(harness.details().pinterest.href, profileHref);
    assert.equal(harness.loadState(), "ready");
    harness.cleanup();
  });
}

test("Booster: a different Pinterest profile cannot inherit the previous profile's label", async () => {
  const identity = deferred<Dict>();
  const harness = boosterEffect({
    details: { pinterest: { label: "Ancien profil", href: "https://www.pinterest.fr/old/" } },
    fetch: async (url: string) => url.includes("/pinterest/") ? identity.promise : {
      ok: true,
      json: async () => ({ channels: { pinterest: true }, channelDetails: { pinterest: { label: "Compte Pinterest connecté", href: "https://www.pinterest.fr/new/" } } }),
    },
  });
  await tick();
  assert.notEqual(harness.details().pinterest.label, "Ancien profil");
  assert.equal(harness.details().pinterest.href, "https://www.pinterest.fr/new/");
  identity.resolve({ ok: false });
  await tick();
  assert.notEqual(harness.details().pinterest.label, "Ancien profil");
  harness.cleanup();
});

test("Booster: switching accounts revalidates names and a pending old Pinterest identity is ignored", async () => {
  const b = browser();
  const identity = deferred<Dict>();
  const requestedScopes: Array<string | null> = [];
  const harness = boosterEffect({
    browser: b,
    fetch: async (url: string) => {
      if (url.includes("/pinterest/")) return identity.promise;
      const scope = b.account();
      requestedScopes.push(scope);
      return { ok: true, json: async () => ({ channels: { gmb: true, pinterest: scope === "account-a" }, channelDetails: { gmb: { label: scope === "account-a" ? "Société A" : "Société B" }, pinterest: { label: scope === "account-a" ? "Profil A" : "", href: null } } }) };
    },
  });
  await tick();
  assert.equal(harness.details().gmb.label, "Société A");
  b.changeAccount("account-b");
  await tick();
  assert.deepEqual(requestedScopes, ["account-a", "account-b"]);
  assert.equal(harness.details().gmb.label, "Société B");
  assert.equal(harness.details().pinterest.label, "");
  assert.equal(harness.applied.at(-1)?.pinterest, false);
  const detailWrites = harness.writes.length;
  identity.resolve({ ok: true, json: async () => ({ ok: true, connected: true, username: "stale-account" }) });
  await tick();
  assert.equal(harness.writes.length, detailWrites);
  assert.equal(harness.details().gmb.label, "Société B");
  assert.equal(harness.details().pinterest.label, "");
  harness.cleanup();
});

test("Booster: an account switch clears known identities even when both accounts have the same Pinterest href", async () => {
  const b = browser();
  const newAccountSnapshot = deferred<Dict>();
  const identity = deferred<Dict>();
  const profileHref = "https://www.pinterest.fr/shared/";
  const harness = boosterEffect({
    browser: b,
    details: { pinterest: { label: "Identité du compte A", href: profileHref } },
    fetch: async (url: string) => {
      if (url.includes("/pinterest/")) return identity.promise;
      if (b.account() === "account-b") return newAccountSnapshot.promise;
      return { ok: true, json: async () => ({ channels: { pinterest: true }, channelDetails: { pinterest: { label: "Compte Pinterest connecté", href: profileHref } } }) };
    },
  });
  await tick();
  assert.equal(harness.details().pinterest.label, "Identité du compte A");
  b.changeAccount("account-b");
  await tick();
  assert.equal(harness.details().pinterest.label, "", "Account A's identity must be cleared before account B responds");
  assert.equal(harness.applied.at(-1)?.pinterest, false);
  assert.equal(harness.loadState(), "loading");
  newAccountSnapshot.resolve({ ok: true, json: async () => ({ channels: { pinterest: true }, channelDetails: { pinterest: { label: "Compte Pinterest connecté", href: profileHref } } }) });
  await tick();
  assert.notEqual(harness.details().pinterest.label, "Identité du compte A", "A shared profile URL does not permit identity reuse across iNrCy accounts");
  harness.cleanup();
  identity.resolve({ ok: false });
  await tick();
});

test("Booster: a late Pinterest profile request cannot restore details after disconnect", async () => {
  const identity = deferred<Dict>();
  let connected = true;
  const harness = boosterEffect({
    fetch: async (url: string) => url.includes("/pinterest/") ? identity.promise : { ok: true, json: async () => ({ channels: { pinterest: connected }, channelDetails: { pinterest: { label: connected ? "initial" : "" } } }) },
  });
  await tick();
  connected = false;
  harness.browser.confirm();
  await tick();
  assert.equal(harness.details().pinterest.label, "");
  const writesBefore = harness.writes.length;
  identity.resolve({ ok: true, json: async () => ({ ok: true, connected: true, username: "stale-account" }) });
  await tick();
  assert.equal(harness.writes.length, writesBefore);
  assert.equal(harness.details().pinterest.label, "");
  harness.cleanup();
});

test("Booster: unmount cancels a pending Pinterest identity update", async () => {
  const identity = deferred<Dict>();
  const harness = boosterEffect({
    fetch: async (url: string) => url.includes("/pinterest/") ? identity.promise : { ok: true, json: async () => ({ channels: { pinterest: true }, channelDetails: { pinterest: { label: "Snapshot" } } }) },
  });
  await tick();
  const writesBefore = harness.writes.length;
  harness.cleanup();
  identity.resolve({ ok: true, json: async () => ({ ok: true, connected: true, username: "late-profile" }) });
  await tick();
  assert.equal(harness.writes.length, writesBefore);
});


test("Booster: reopening preserves cached names and Pinterest while revalidation remains mandatory", async () => {
  const response = deferred<Dict>();
  const harness = boosterEffect({
    connected: { gmb: true, pinterest: true },
    details: { gmb: { label: "Société connue" }, pinterest: { label: "Profil connu" } },
    fetch: () => response.promise,
  });
  assert.equal(harness.connected().gmb, true);
  assert.equal(harness.connected().pinterest, true);
  assert.equal(harness.details().gmb.label, "Société connue");
  assert.equal(harness.details().pinterest.label, "Profil connu");
  assert.equal(harness.hasKnown(), true);
  assert.equal(harness.loadState(), "loading", "Display cache cannot authorize the next wizard step");
  response.resolve({ ok: true, json: async () => ({ channels: { gmb: true, pinterest: false }, channelDetails: { gmb: { label: "Société confirmée" } } }) });
  await tick();
  assert.equal(harness.connected().pinterest, false, "A fresh disconnect must override cached availability");
  assert.equal(harness.details().gmb.label, "Société confirmée");
  assert.equal(harness.loadState(), "ready");
  harness.cleanup();
});

test("Booster: switching accounts restores only the new account display while its response is pending", async () => {
  const b = browser();
  const requests: Array<ReturnType<typeof deferred<Dict>>> = [];
  const harness = boosterEffect({
    browser: b, connected: { gmb: true }, details: { gmb: { label: "Entreprise A" } },
    readSnapshot: (actor, scope) => {
      assert.equal(actor, "actor-a");
      return scope === "account-b" ? { channels: { facebook: true, gmb: false }, channelDetails: { facebook: { label: "Entreprise B" } } } : null;
    },
    fetch: () => { const response=deferred<Dict>(); requests.push(response); return response.promise; },
  });
  b.changeAccount("account-b");
  assert.equal(harness.details().facebook.label, "Entreprise B");
  assert.equal(harness.details().gmb, undefined);
  assert.equal(harness.connected().gmb, false);
  assert.equal(harness.hasKnown(), true);
  assert.equal(harness.loadState(), "loading");
  requests[0].resolve({ ok: true, json: async () => ({ channels: { gmb: true }, channelDetails: { gmb: { label: "Ancien compte" } } }) });
  await tick();
  assert.equal(harness.details().facebook.label, "Entreprise B");
  harness.cleanup();
});

test("Booster: a network failure preserves the known display and selection but never confirms availability", async () => {
  const response=deferred<Dict>();
  const harness=boosterEffect({ connected: { gmb: true }, details: { gmb: { label: "Compte connu" } }, fetch:()=>response.promise });
  harness.restoreDraft({ gmb:true, facebook:false });
  response.resolve({ ok:false });
  await tick();
  assert.equal(harness.connected().gmb,true);
  assert.equal(harness.details().gmb.label,"Compte connu");
  assert.equal(harness.details().gmb.availabilityError,true);
  assert.equal(harness.selection().gmb,true);
  assert.equal(harness.selection().facebook,false);
  assert.equal(harness.loadState(),"error");
  harness.cleanup();
});

test("Booster: cold opening remains unknown until an actual connection response arrives", async () => {
  const response=deferred<Dict>();
  const harness=boosterEffect({ fetch:()=>response.promise });
  assert.equal(harness.hasKnown(),false);
  assert.equal(harness.loadState(),"loading");
  response.resolve({ ok:true,json:async()=>({ channels:{gmb:false},channelDetails:{} }) });
  await tick();
  assert.equal(harness.hasKnown(),true,"Only a real response can establish that the channels are disconnected");
  assert.equal(harness.connected().gmb,false);
  harness.cleanup();
});

for(const action of ["runPublish", "performSchedulePublication"]) {
  test("Booster: "+action+" refuses a display-only connection snapshot before any network work", async()=>{
    const path="app/dashboard/booster/publier/PublishModal.tsx";
    const source=ts.createSourceFile(path,read(path),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    let found:ts.Expression|undefined;
    function visit(node:ts.Node) {
      if(ts.isVariableDeclaration(node) && node.name.getText(source)===action) found=node.initializer;
      ts.forEachChild(node,visit);
    }
    visit(source); assert.ok(found);
    const compiled=ts.transpileModule("const action=("+found.getText(source)+");",{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
    const errors:string[]=[];
    const dependencies={saving:false,draftSaving:false,voiceInputBusy:false,publishStartGuardRef:{current:false},
      authoritativeChannelsRef:{current:false},connectedChannelsScopeRef:{current:"account-a"},getActiveBrowserUserId:()=>"account-a",activeAccountId:"",
      i18nT:(key:string)=>key,setPublishError:(message:string)=>errors.push(message),setScheduleError:(message:string)=>errors.push(message)};
    const invoke=new Function(...Object.keys(dependencies),compiled+"; return action;")(...Object.values(dependencies));
    await invoke();
    assert.deepEqual(errors,["connections_loading"]);
  });
}


function modalInitializer(name: string) {
  const path="app/dashboard/booster/publier/PublishModal.tsx";
  const source=ts.createSourceFile(path,read(path),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let found:ts.Expression|undefined;
  function visit(node:ts.Node) {
    if(ts.isVariableDeclaration(node) && node.name.getText(source).replace(/[\[\]]/g,"")===name) found=node.initializer;
    ts.forEachChild(node,visit);
  }
  visit(source); assert.ok(found,name);
  return (dependencies:Dict)=>new Function(...Object.keys(dependencies),ts.transpileModule("const value=("+found!.getText(source)+");",{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText+";return value;")(...Object.values(dependencies));
}

test("Booster: a transient connection check failure preserves the rendered account name and disables its link",()=>{
  const detail=modalInitializer("getChannelDetailInfo")({
    channelDetails:{gmb:{label:"Société connue",href:"https://example.com/",availabilityError:true,connectionStatus:"unavailable"}},
    EMPTY_CHANNEL_DETAILS:{}, simplifyChannelDetail:(_key:string,label:string)=>label,
    truncateText:(text:string)=>text,i18nT:(key:string)=>key,
  })("gmb");
  assert.equal(detail.fullLabel,"Société connue");
  assert.equal(detail.href,null);
  assert.equal(detail.connectionStatus,"unavailable");
});

test("Booster: the first render reads the cached display using the trusted account before the browser hint hydrates",()=>{
  const snapshot={channels:{gmb:true,pinterest:true},channelDetails:{gmb:{label:"Société connue"},pinterest:{label:"Profil connu"}}};
  const [bootstrap]=modalInitializer("initialConnectionBootstrap")({
    useState:(initialize:()=>unknown)=>[initialize()],getActiveBrowserUserId:()=>null,activeAccountId:"account-a",actorUserId:"actor-a",CHANNEL_KEYS:["gmb","pinterest"],
    readBoosterConnectionSnapshot:(actor:string,account:string)=>{ assert.equal(actor,"actor-a");assert.equal(account,"account-a");return snapshot; },
  });
  assert.equal(bootstrap.accountId,"account-a");
  assert.equal(bootstrap.snapshot,snapshot);
  const getInitial=modalInitializer("getInitialConnectedChannels")({initialConnectionBootstrap:bootstrap});
  assert.deepEqual(getInitial(),snapshot.channels);
});
