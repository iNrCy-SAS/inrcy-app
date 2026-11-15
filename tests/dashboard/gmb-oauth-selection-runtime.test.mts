import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Transpiled modules and mocked React slots have heterogeneous runtime shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RuntimeValue = any;
type Model = Record<string, RuntimeValue>;
type Reply = { ok: boolean; json(): Promise<unknown> };
const response = (payload: unknown, ok = true): Reply => ({ ok, json: async () => payload });
const settle = () => new Promise(setImmediate);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const listUrl = "/api/integrations/google-business/locations";
const selectUrl = "/api/integrations/google-business/select-location";
const disconnectUrl = "/api/integrations/google-business/disconnect-account";
const oneLocation = { accounts: [{ name: "accounts/1" }], accountName: "accounts/1", locations: [{ name: "locations/1", title: "Fixture" }] };
const saved = { ok: true, url: "https://www.google.com/maps/search/?api=1&query=Fixture" };

/** Persistent hook state and dependency-aware effects reproduce the actual OAuth/hydration lifecycle. */
function runtime(options: {
  initial?: Model;
  panel?: string | null;
  params?: string;
  accountScope?: string | null;
  fetch?: (url: string, init?: RequestInit) => Promise<Reply>;
  refresh?: () => Promise<void>;
} = {}) {
  const slots: RuntimeValue[] = [];
  let cursor = 0;
  let accountScope = options.accountScope === undefined ? "account-1" : options.accountScope;
  const effects: Array<() => void> = [];
  const differs = (a: unknown[] | undefined, b: unknown[] | undefined) => !a || !b || a.length !== b.length || a.some((value, index) => !Object.is(value, b[index]));
  const hooks = {
    useState(initial: RuntimeValue) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next: RuntimeValue) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useRef(initial: unknown) { return slots[cursor++] ??= { current: initial }; },
    useCallback(callback: unknown, deps: unknown[]) {
      const index = cursor++;
      if (!slots[index] || differs(slots[index].deps, deps)) slots[index] = { deps, callback };
      return slots[index].callback;
    },
    useEffect(effect: () => unknown, deps: unknown[]) {
      const index = cursor++;
      if (slots[index] && !differs(slots[index].deps, deps)) return;
      const previous = slots[index];
      slots[index] = { deps };
      effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = effect(); });
    },
  };
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const patches: Model[] = [];
  let refreshes = 0;
  let nextTimer = 0;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const require = (name: string) => {
    if (name === "react") return hooks;
    if (name.endsWith("browserAccountCache")) return { getActiveBrowserUserId: () => accountScope };
    if (name.endsWith("userFacingErrors")) return { getClientUserFacingApiError: async (_response: Reply, fallback: string) => fallback, getClientUserFacingErrorMessage: (input: unknown, fallback: string) => input instanceof Error ? input.message : typeof input === "string" ? input : fallback };
    throw new Error(`Unmocked dependency ${name}`);
  };
  const source = readFileSync(new URL("../../app/dashboard/_hooks/channels/useGoogleBusinessChannel.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const fixtureModule = { exports: {} as Model };
  const fetch = async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    return options.fetch ? options.fetch(url, init) : response(url === listUrl ? oneLocation : url === selectUrl ? saved : { ok: true });
  };
  new Function("module", "exports", "require", "fetch", "window", code)(fixtureModule, fixtureModule.exports, require, fetch, { location: { href: "" }, setTimeout() {}, setInterval(callback: () => void, delay: number) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; }, clearInterval(id: number) { timers.delete(id); } });
  const props = {
    initialState: options.initial || {}, panel: options.panel ?? "gmb", searchParams: new URLSearchParams(options.params ?? "linked=gmb&ok=1"),
    patchChannelConnectionLocally: (_key: string, patch: Model) => patches.push(patch),
    triggerChannelRefresh: () => { refreshes++; return options.refresh?.() ?? Promise.resolve(); },
    updateRootSettingsKey: () => { throw new Error("The authoritative selection route already persists settings"); },
  };
  return {
    render: (): Model => { cursor = 0; return fixtureModule.exports.useGoogleBusinessChannel(props); },
    flushEffects: () => { effects.splice(0).forEach(effect => effect()); },
    setScope: (scope: string | null) => { accountScope = scope; },
    requests, patches, props, get refreshes() { return refreshes; },
    timers,
    tick: () => { for (const timer of [...timers.values()]) timer.callback(); },
  };
}

test("OAuth discovery never selects even its sole location; an explicit choice is required", async () => {
  const list = deferred<Reply>();
  const selection = deferred<Reply>();
  const h = runtime({ panel: "mails", fetch: url => url === listUrl ? list.promise : selection.promise });
  h.render(); h.flushEffects();
  assert.deepEqual(h.requests.map(request => request.url), [listUrl]);
  list.resolve(response(oneLocation));
  await settle();
  const discovered = h.render(); h.flushEffects();
  assert.equal(discovered.gmbConfigured, false);
  assert.equal(discovered.gmbLocationsPhase, "idle");
  assert.equal(h.requests.length, 1, "A GET must never trigger a selection POST");
  const manual = discovered.saveGmbLocation("locations/1");
  const duplicate = h.render().saveGmbLocation("locations/1");
  assert.equal(h.requests.filter(request => request.url === selectUrl).length, 1);
  selection.resolve(response(saved));
  assert.equal(await manual, true);
  assert.equal(await duplicate, true);
  assert.equal(h.render().gmbLocationName, "locations/1");
  assert.equal(h.render().gmbConfigured, true);
});

test("A selector GET already in flight is shared with OAuth discovery without any write", async () => {
  const list = deferred<Reply>();
  const h = runtime({ initial: { gmbAccountConnected: true }, fetch: async url => url === listUrl ? list.promise : response(saved) });
  const manualRead = h.render().loadGmbAccountsAndLocations({ autoSelect: false });
  h.flushEffects();
  h.render().setGmbAccountConnected(true);
  h.render(); h.flushEffects();
  assert.equal(h.requests.length, 1);
  list.resolve(response(oneLocation));
  await manualRead;
  await settle();
  assert.equal(h.requests.filter(request => request.url === listUrl).length, 1);
  assert.equal(h.requests.filter(request => request.url === selectUrl).length, 0);
  assert.equal(h.render().gmbConfigured, false);
});

test("Repeated read-only selector loads share one request and never select a location", async () => {
  const list = deferred<Reply>();
  const h = runtime({ params: "", initial: { gmbAccountConnected: true }, fetch: () => list.promise });
  const first = h.render().loadGmbAccountsAndLocations({ autoSelect: false });
  const second = h.render().loadGmbAccountsAndLocations({ autoSelect: false });
  h.flushEffects();
  assert.equal(h.requests.length, 1);
  list.resolve(response(oneLocation));
  await Promise.all([first, second]);
  assert.equal(h.render().gmbConfigured, false);
  assert.equal(h.render().gmbLocationName, "");
  assert.equal(h.requests.length, 1);
  assert.equal(h.patches.length, 0);
});

test("A consumed OAuth callback cannot select or reconnect after the user disconnects", async () => {
  const list = deferred<Reply>();
  const h = runtime({ initial: { gmbAccountConnected: true }, fetch: async url => url === listUrl ? list.promise : response({ ok: true }) });
  h.render(); h.flushEffects();
  assert.equal(await h.render().disconnectGmbAccount(), true);
  list.resolve(response(oneLocation));
  await settle();
  h.render(); h.flushEffects();
  h.render(); h.flushEffects();
  assert.deepEqual(h.requests.map(request => request.url), [listUrl, disconnectUrl]);
  assert.equal(h.render().gmbAccountConnected, false);
  assert.equal(h.render().gmbConfigured, false);
  assert.equal(h.patches.filter(patch => patch.connected === true).length, 0);
});

test("Several OAuth locations require a real user choice and preserve its exact target", async () => {
  const h = runtime({ fetch: async url => response(url === listUrl ? { ...oneLocation, locations: [...oneLocation.locations, { name: "locations/2", title: "Other" }] } : saved) });
  h.render(); h.flushEffects();
  await settle();
  const model = h.render(); h.flushEffects();
  assert.equal(h.requests.length, 1);
  assert.equal(model.gmbConfigured, false);
  assert.equal(model.gmbLocationName, "");
  assert.equal(await model.saveGmbLocation("locations/2"), true);
  assert.deepEqual(JSON.parse(String(h.requests[1].init?.body)), { accountName: "accounts/1", locationName: "locations/2", locationTitle: "Other" });
  assert.equal(h.render().gmbLocationName, "locations/2");
});

test("An already connected bubble without an OAuth return starts no automatic discovery", async () => {
  const h = runtime({ params: "", initial: { gmbAccountConnected: true, gmbConfigured: true, gmbConnected: true } });
  h.render(); h.flushEffects();
  assert.equal(h.requests.length, 0);
});

test("Failed OAuth discovery remains retryable without an automatic request loop", async () => {
  let failed = true;
  const h = runtime({ fetch: async () => failed ? response({ error: "Temporary failure" }, false) : response(oneLocation) });
  h.render(); h.flushEffects();
  await settle();
  const model = h.render(); h.flushEffects();
  assert.ok(model.gmbListError);
  model.setGmbAccountConnected(true);
  h.render(); h.flushEffects();
  assert.equal(h.requests.length, 1);
  failed = false;
  await h.render().loadGmbAccountsAndLocations({ autoSelect: false });
  assert.equal(h.requests.length, 2);
  assert.equal(h.render().gmbLocations.length, 1);
});

test("OAuth waits for the active account scope, then starts before channel-state hydration", () => {
  const h = runtime({ accountScope: null, fetch: () => new Promise(() => {}) });
  h.render(); h.flushEffects();
  assert.equal(h.requests.length, 0);
  h.setScope("account-1");
  h.render(); h.flushEffects();
  assert.equal(h.requests.length, 1);
  assert.equal(h.render().gmbAccountConnected, false);
});

test("A persisted OAuth URL never reloads or selects an already configured channel", async () => {
  const h = runtime({ initial: { gmbAccountConnected: true, gmbConfigured: true, gmbConnected: true, gmbLocationName: "locations/selected" } });
  h.render(); h.flushEffects();
  await settle();
  assert.equal(h.requests.length, 0);
  assert.equal(h.render().gmbLocationName, "locations/selected");
});

test("Confirmed selection hydrated during OAuth discovery prevents another auto-selection", async () => {
  const list = deferred<Reply>();
  const h = runtime({ fetch: async url => url === listUrl ? list.promise : response(saved) });
  h.render(); h.flushEffects();
  const hydrating = h.render();
  hydrating.setGmbConfigured(true);
  hydrating.setGmbLocationName("locations/confirmed");
  h.render(); h.flushEffects();
  list.resolve(response(oneLocation));
  await settle();
  assert.deepEqual(h.requests.map(request => request.url), [listUrl]);
  assert.equal(h.render().gmbLocationName, "locations/confirmed");
});

test("A manual choice made while discovery is pending prevents a late automatic choice", async () => {
  const list = deferred<Reply>();
  const h = runtime({ fetch: async url => url === listUrl ? list.promise : response(saved) });
  h.render(); h.flushEffects();
  const choosing = h.render();
  choosing.setGmbAccountName("accounts/1");
  choosing.setGmbLocations([{ name: "locations/2", title: "Manual choice" }]);
  assert.equal(await h.render().saveGmbLocation("locations/2"), true);
  list.resolve(response(oneLocation));
  await settle();
  assert.equal(h.requests.filter(request => request.url === selectUrl).length, 1);
  assert.equal(h.render().gmbLocationName, "locations/2");
  assert.equal(h.patches.at(-1)?.resourceId, "locations/2");
});

test("A newer explicit target waits for the older POST and remains the last server and UI choice", async () => {
  const automatic = deferred<Reply>();
  const manual = deferred<Reply>();
  let selectionCount = 0;
  const h = runtime({ fetch: async url => url === listUrl ? response(oneLocation) : ++selectionCount === 1 ? automatic.promise : manual.promise });
  h.render(); h.flushEffects();
  await settle();
  void h.render().saveGmbLocation("locations/1");
  assert.equal(selectionCount, 1);
  const choosing = h.render();
  choosing.setGmbLocations([...oneLocation.locations, { name: "locations/2", title: "Manual choice" }]);
  const result = h.render().saveGmbLocation("locations/2");
  assert.equal(selectionCount, 1, "The newer POST must be sent after the older server write finishes");
  automatic.resolve(response(saved));
  await settle();
  assert.equal(selectionCount, 2);
  assert.equal(h.patches.length, 0, "Superseded automatic selection must not publish connected state");
  manual.resolve(response(saved));
  assert.equal(await result, true);
  assert.equal(h.render().gmbLocationName, "locations/2");
  assert.equal(h.patches.length, 1);
  assert.deepEqual(h.requests.filter(request => request.url === selectUrl).map(request => JSON.parse(String(request.init?.body)).locationName), ["locations/1", "locations/2"]);
});

test("A choice uses its own Google account parent, not the first account hint", async () => {
  const h = runtime({ fetch: async url => response(url === listUrl ? { ...oneLocation, locations: [{ name: "locations/2", title: "Second account", accountName: "accounts/second" }] } : saved) });
  h.render(); h.flushEffects(); await settle();
  assert.equal(await h.render().saveGmbLocation("locations/2"), true);
  assert.equal(JSON.parse(String(h.requests.at(-1)?.init?.body)).accountName, "accounts/second");
});

test("Confirmed stale selection asks for a new choice while keeping Google authorized", async () => {
  const h = runtime({ params: "", initial: { gmbAccountConnected: true, gmbConfigured: true, gmbConnected: true, gmbLocationName: "locations/old" }, fetch: async () => response({ ...oneLocation, complete: true, selectionValidation: { status: "invalid", cleared: true, locationName: "locations/old" } }) });
  await h.render().loadGmbAccountsAndLocations();
  const model = h.render();
  assert.equal(model.gmbAccountConnected, true);
  assert.equal(model.gmbConfigured, false);
  assert.equal(model.gmbConnected, false);
  assert.equal(model.gmbLocationUnavailable, true);
  assert.equal(model.gmbLocationName, "locations/old", "The old option remains explicitly identified, never silently replaced");
  assert.equal(h.requests.filter(request => request.url === selectUrl).length, 0);
});

test("Incomplete listing and failed CAS do not turn a selected fiche off", async () => {
  for (const payload of [{ complete: false, selectionValidation: { status: "invalid", cleared: true, locationName: "locations/old" } }, { complete: true, selectionValidation: { status: "unknown", cleared: false, locationName: "locations/old" } }]) {
    const h = runtime({ params: "", initial: { gmbAccountConnected: true, gmbConfigured: true, gmbConnected: true, gmbLocationName: "locations/old" }, fetch: async () => response({ ...oneLocation, ...payload }) });
    await h.render().loadGmbAccountsAndLocations();
    assert.equal(h.render().gmbConfigured, true);
    assert.equal(h.render().gmbLocationUnavailable, false);
    assert.equal(h.patches.length, 0);
  }
});

test("A late invalidation response cannot erase a newer explicit selection or leave loading stuck", async () => {
  const list = deferred<Reply>();
  const h = runtime({ params: "", initial: { gmbAccountConnected: true, gmbConfigured: true, gmbConnected: true, gmbLocationName: "locations/old" }, fetch: async url => url === listUrl ? list.promise : response(saved) });
  const pending = h.render().loadGmbAccountsAndLocations();
  h.render().setGmbLocations([{ name: "locations/new", title: "Explicit", accountName: "accounts/1" }]);
  assert.equal(await h.render().saveGmbLocation("locations/new"), true);
  list.resolve(response({ ...oneLocation, complete: true, selectionValidation: { status: "invalid", cleared: true, locationName: "locations/old" } }));
  await pending;
  assert.equal(h.render().gmbLocationName, "locations/new");
  assert.equal(h.render().gmbConfigured, true);
  assert.equal(h.render().gmbLocationUnavailable, false);
  assert.equal(h.render().gmbLoadingList, false);
});

test("Canonical hydration of a newer target also defeats a late invalidation response", async () => {
  const list = deferred<Reply>();
  const h = runtime({ params: "", initial: { gmbAccountConnected: true, gmbConfigured: true, gmbConnected: true, gmbLocationName: "locations/old" }, fetch: async () => list.promise });
  const pending = h.render().loadGmbAccountsAndLocations();
  h.render().setGmbLocationName("locations/new");
  list.resolve(response({ ...oneLocation, complete: true, selectionValidation: { status: "invalid", cleared: true, locationName: "locations/old" } }));
  await pending;
  assert.equal(h.render().gmbConfigured, true);
  assert.equal(h.patches.length, 0);
});

test("Hydrating the same resource from a newer OAuth snapshot defeats old invalidation too", async () => {
  const list = deferred<Reply>();
  const h = runtime({ params: "", initial: { gmbAccountConnected: true, gmbConfigured: true, gmbConnected: true, gmbLocationName: "locations/old" }, fetch: async () => list.promise });
  const pending = h.render().loadGmbAccountsAndLocations();
  h.render().setGmbLocationName("locations/old");
  list.resolve(response({ ...oneLocation, complete: true, selectionValidation: { status: "invalid", cleared: true, locationName: "locations/old" } }));
  await pending;
  assert.equal(h.render().gmbConfigured, true);
  assert.equal(h.render().gmbLocationUnavailable, false);
  assert.equal(h.patches.length, 0);
});

test("Unavailable flags and provider verification cannot leak to another iNrCy account", async () => {
  let fail = false;
  const h = runtime({ params: "", initial: { gmbAccountConnected: true, gmbConfigured: true, gmbConnected: true, gmbLocationName: "locations/old" }, fetch: async () => fail ? response({}, false) : response({ ...oneLocation, complete: true, selectionValidation: { status: "invalid", cleared: true, locationName: "locations/old" } }) });
  await h.render().loadGmbAccountsAndLocations();
  assert.equal(h.render().gmbLocationUnavailable, true);
  assert.equal(h.render().gmbLocationsComplete, true);
  h.render().setGmbVerificationStatus("pending");
  h.setScope("account-2");
  assert.equal(h.render().gmbLocationUnavailable, false);
  assert.equal(h.render().gmbLocationsComplete, false);
  assert.equal(h.render().gmbVerificationStatus, "unknown");
  h.render().setGmbLocationName("locations/valid-second");
  h.render().setGmbConfigured(true);
  fail = true;
  await h.render().loadGmbAccountsAndLocations();
  assert.equal(h.render().gmbLocationUnavailable, false);
  assert.equal(h.render().gmbConfigured, true);
});

test("Provider-confirmed pending verification keeps Google linked without starting OAuth", async () => {
  const h = runtime({ params: "", initial: { gmbAccountConnected: true, gmbConfigured: true, gmbConnected: true, gmbLocationName: "locations/1" }, fetch: async () => response({ ...oneLocation, complete: true, selectionValidation: { status: "valid", cleared: false, locationName: "locations/1" }, verification: { status: "pending", locationName: "locations/1", clearedStatsReconnect: false } }) });
  await h.render().loadGmbAccountsAndLocations();
  assert.equal(h.render().gmbVerificationStatus, "pending");
  assert.equal(h.render().gmbConnected, true);
  assert.equal(h.render().gmbConfigured, true);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, listUrl);
});

test("Pending verification checks every five hours and stops automatically after Google validates", async () => {
  let status = "pending";
  const h = runtime({ params: "", initial: { gmbAccountConnected: true, gmbConfigured: true, gmbConnected: true, gmbConnectionStatus: "connected", gmbLocationName: "locations/1", gmbVerificationStatus: "pending" }, fetch: async () => response({ ...oneLocation, complete: true, selectionValidation: { status: "valid", locationName: "locations/1" }, verification: { status, locationName: "locations/1" } }) });
  h.render(); h.flushEffects(); await settle();
  assert.equal(h.requests.length, 1);
  assert.equal([...h.timers.values()][0]?.delay, 5 * 60 * 60 * 1000);
  status = "verified";
  h.tick(); await settle();
  assert.equal(h.requests.at(-1)?.url, `${listUrl}?refreshVerification=1`);
  assert.equal(h.render().gmbVerificationStatus, "verified");
  h.flushEffects();
  assert.equal(h.timers.size, 0);
  assert.equal(h.render().gmbConnected, true);
  const count = h.requests.length;
  await h.render().refreshGmbVerification();
  assert.equal(h.requests.length, count, "A validated fiche exposes no manual refresh operation");
});

test("A temporary unknown verification cannot turn pending green or stop its next check", async () => {
  const h = runtime({ params: "", initial: { gmbAccountConnected: true, gmbConfigured: true, gmbConnected: true, gmbConnectionStatus: "connected", gmbLocationName: "locations/1", gmbVerificationStatus: "pending" }, fetch: async () => response({ ...oneLocation, complete: true, selectionValidation: { status: "valid", locationName: "locations/1" }, verification: { status: "unknown", locationName: "locations/1" } }) });
  h.render(); h.flushEffects(); await settle();
  assert.equal(h.render().gmbVerificationStatus, "pending");
  assert.equal(h.timers.size, 1);
});
