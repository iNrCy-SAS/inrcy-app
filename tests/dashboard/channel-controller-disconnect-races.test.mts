import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import * as React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
// Transpiled modules and mocked React slots have heterogeneous runtime shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RuntimeValue = any;
type Model = Record<string, RuntimeValue>;
const settle = () => new Promise(setImmediate);
const response = (payload: unknown, ok = true) => ({ ok, json: async () => payload });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

/** Execute the real controller hooks while independently controlling response order. */
function controller(file: string, initial: unknown, fetch: (url: string, init?: RequestInit) => unknown) {
  const slots: RuntimeValue[] = [];
  const effects: Array<() => void> = [];
  const events: Array<{ type: string; detail?: Model }> = [];
  const snapshots: unknown[] = [];
  let cursor = 0;
  let model: Model;
  const changed = (before: unknown[] | undefined, after: unknown[] | undefined) => !before || !after || before.length !== after.length || before.some((value, index) => !Object.is(value, after[index]));
  const hooks = {
    ...React,
    useState(value: RuntimeValue) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof value === "function" ? value() : value;
      return [slots[index], (next: RuntimeValue) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useRef(value: unknown) { return slots[cursor++] ??= { current: value }; },
    useMemo(factory: () => unknown, deps?: unknown[]) {
      const index = cursor++;
      if (!slots[index] || changed(slots[index].deps, deps)) slots[index] = { deps, value: factory() };
      return slots[index].value;
    },
    useCallback(callback: unknown, deps?: unknown[]) { return hooks.useMemo(() => callback, deps); },
    useEffect(effect: () => unknown, deps?: unknown[]) {
      const index = cursor++;
      if (slots[index] && !changed(slots[index].deps, deps)) return;
      const previous = slots[index];
      slots[index] = { deps };
      effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = effect(); });
    },
  };
  const stub = (props: Model) => React.createElement("div", {}, props.children);
  const localRequire = (specifier: string): RuntimeValue => {
    if (specifier === "react") return hooks;
    if (specifier === "react/jsx-runtime") return require(specifier);
    if (specifier.endsWith(".css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
    if (specifier === "next-intl") return { useTranslations: () => (key: string) => key };
    if (specifier.endsWith("channel-workspace-snapshot")) return { readChannelWorkspaceSnapshot: () => initial, writeChannelWorkspaceSnapshot: (_key: string, value: unknown) => snapshots.push(value) };
    if (specifier === "@/lib/browserAccountCache") return { getActiveBrowserUserId: () => "account-1", readAccountCacheValue: () => JSON.stringify({ pinterestConnected: true }), resolveActiveBrowserUserId: (id: string) => id };
    if (specifier === "@/lib/dashboardCacheKeys") return { DASHBOARD_CACHE_KEYS: { channelState: "channel-state" } };
    if (specifier === "@/lib/pinterestUiSessionCache") return { readPinterestBoardUiCache: () => ({ boards: [{ id: "board-1", name: "Board" }], defaultBoardId: "board-1" }), writePinterestBoardUiCache() {} };
    if (specifier.endsWith("userFacingErrors")) return { getSimpleFrenchApiError: async () => "Disconnect failed", getSimpleFrenchErrorMessage: (_error: unknown, fallback: string) => fallback };
    return { __esModule: true, default: stub };
  };
  const source = readFileSync(new URL(`../../app/dashboard/settings/_components/${file}.tsx`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const fixtureModule = { exports: {} as Model };
  const window = { location: { search: "", href: "http://localhost:3000/dashboard?panel=mails" }, dispatchEvent: (event: { type: string; detail?: Model }) => events.push(event), setTimeout() {}, clearTimeout() {}, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
  new Function("module", "exports", "require", "fetch", "window", "console", code)(fixtureModule, fixtureModule.exports, localRequire, fetch, window, { ...console, warn() {} });
  const props = { renderBubble: (value: Model) => { model = value; return null; } };
  return {
    render() { cursor = 0; fixtureModule.exports.default(props); return model; },
    effects() { for (const effect of effects.splice(0)) effect(); },
    unmount() { for (const slot of slots) if (typeof slot?.cleanup === "function") slot.cleanup(); },
    events, snapshots,
  };
}

const channels = [
  { name: "X", file: "XSettingsContent", initial: { connected: true, username: "fixture" }, status: { connected: true, username: "fixture" }, disconnected: { ok: true }, endpoint: "/api/integrations/x/disconnect" },
  { name: "YouTube", file: "YoutubeShortsSettingsContent", initial: { connected: true, accountConnected: true, channelName: "Fixture" }, status: { youtube_shorts: { connected: true, accountConnected: true, channelName: "Fixture" } }, disconnected: { ok: true, youtube_shorts: { connected: false, accountConnected: false } }, endpoint: "/api/integrations/youtube-shorts/disconnect" },
  { name: "Pinterest", file: "PinterestSettingsContent", initial: {}, status: { ok: true, connected: true, username: "fixture", boards: [{ id: "board-1", name: "Board" }], defaultBoardId: "board-1" }, disconnected: { ok: true }, endpoint: "/api/integrations/pinterest/disconnect" },
];

for (const channel of channels) {
  test(`${channel.name}: confirmed disconnect wins over an older connected status response`, async () => {
    const status = deferred<ReturnType<typeof response>>();
    const mutation = deferred<ReturnType<typeof response>>();
    const posts: string[] = [];
    const h = controller(channel.file, channel.initial, (url, init) => {
      if (init?.method === "POST") { posts.push(url); return mutation.promise; }
      return status.promise;
    });
    let model = h.render();
    h.effects();
    assert.equal(model.accountConnected, true);
    const pending = model.onDisconnect();
    await model.onDisconnect();
    assert.deepEqual(posts, [channel.endpoint], "Repeated clicks must not duplicate the mutation");
    assert.equal(h.render().accountConnected, true, "Do not announce success before the server confirms it");
    mutation.resolve(response(channel.disconnected));
    await pending;
    model = h.render();
    assert.equal(model.accountConnected, false);
    assert.equal(model.loading, false);
    const eventsAfterDisconnect = h.events.length;
    status.resolve(response(channel.status));
    await settle();
    model = h.render();
    assert.equal(model.accountConnected, false);
    assert.equal(h.events.length, eventsAfterDisconnect, "An obsolete GET must not republish a connected state");
    assert.equal(h.events.at(-1)?.detail?.connected, false);
    assert.equal(h.events.at(-1)?.detail?.refresh, true, "Successful mutations must refresh the rest of the dashboard");
  });

  test(`${channel.name}: reading connection metadata does not request a statistics refresh`, async () => {
    const h = controller(channel.file, channel.initial, async () => response(channel.status));
    h.render(); h.effects(); await settle();
    h.render(); h.effects(); await settle();
    assert.ok(h.events.length > 0);
    assert.ok(h.events.every(event => event.detail?.refresh === false));
  });

  test(`${channel.name}: failed disconnect preserves the account and exposes an error`, async () => {
    const h = controller(channel.file, channel.initial, async () => response({ ok: false, error: "Failure" }, false));
    await h.render().onDisconnect();
    const model = h.render();
    assert.equal(model.accountConnected, true);
    assert.ok(model.error);
    assert.equal(h.events.length, 0);
  });

  test(`${channel.name}: navigating to another bubble during disconnect still updates shared status`, async () => {
    const mutation = deferred<ReturnType<typeof response>>();
    const h = controller(channel.file, channel.initial, () => mutation.promise);
    const pending = h.render().onDisconnect();
    h.effects();
    h.unmount();
    mutation.resolve(response(channel.disconnected));
    await pending;
    assert.equal(h.events.at(-1)?.detail?.connected, false);
  });
}

const mailAccounts = [
  { id: "gmail-1", provider: "gmail", email_address: "first@example.test", status: "connected" },
  { id: "outlook-1", provider: "microsoft", email_address: "second@example.test", status: "connected" },
];

for (const delay of ["mailbox-list", "signature"]) {
  test(`Mails: delayed ${delay} cannot restore a disconnected mailbox`, async () => {
    const delayed = deferred<ReturnType<typeof response>>();
    const requests: string[] = [];
    const h = controller("MailsSettingsContent", mailAccounts, async (url, init) => {
      requests.push(url);
      if (init?.method === "POST") return response({ ok: true });
      if (url === (delay === "signature" ? "/api/inrsend/signature" : "/api/integrations/status")) return delayed.promise;
      return response({ mailAccounts });
    });
    h.render(); h.effects(); await settle();
    const pending = h.render().mailboxes[1].onDisconnect();
    assert.equal(h.render().mailboxes[1].address, "second@example.test");
    await pending;
    assert.equal(h.render().mailboxes[1].address, undefined);
    assert.equal(h.render().loading, false);
    delayed.resolve(response(delay === "signature" ? {} : { mailAccounts }));
    await settle();
    const model = h.render();
    assert.equal(model.mailboxes[0].address, "first@example.test");
    assert.equal(model.mailboxes[1].address, undefined);
    assert.equal(requests.filter(url => url === "/api/integrations/status").length, 1, "No extra global GET after confirmed removal");
    assert.deepEqual((h.snapshots.at(-1) as Model[]).map(account => account.id), ["gmail-1"]);
    assert.deepEqual(h.events.at(-1)?.detail?.mailAccounts.map((account: Model) => account.id), ["gmail-1"]);
    assert.equal(h.events.at(-1)?.detail?.refresh, true);
  });
}

test("Mails: a failed mailbox disconnect leaves the exact account in its slot", async () => {
  const h = controller("MailsSettingsContent", mailAccounts, async () => response({ error: "Failure" }, false));
  await h.render().mailboxes[1].onDisconnect();
  const model = h.render();
  assert.equal(model.mailboxes[1].address, "second@example.test");
  assert.ok(model.error);
  assert.equal(h.events.length, 0);
});
