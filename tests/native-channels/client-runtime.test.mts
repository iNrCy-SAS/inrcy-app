import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import * as React from "react";
import ts from "typescript";
import { normalizeNativeChannelStates, readNativeChannelSnapshot } from "../../app/dashboard/_components/native-channel-state.ts";
import type { NativeChannelKey, NativeChannelStates } from "../../lib/nativeChannelActivation.ts";
import { channelRuntime, channelNodes, channelItem } from "../helpers/channel-bubble-runtime.mts";
import type { ChannelBubbleConnection } from "../../app/dashboard/_components/channel-bubble.types.ts";

const require = createRequire(import.meta.url);
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const messages = JSON.parse(read("messages/fr-FR/dashboard.json"));
const state = (requested = false, ready = false) => ({ requested, ready, published: requested && ready, pending: requested && !ready, allowed: true, missingFields: ready ? [] : ["company", "city"] });
const states = (requested = false, ready = false) => Object.fromEntries(["inrbadge", "inr_search", "inr_directory"].map(key => [key, state(requested, ready)])) as NativeChannelStates;
const payload = (requested = false, ready = false, accountId = "account-a") => ({ ok: true, accountId, states: states(requested, ready), companyName: "Atelier Cosmos", badgeUrl: "https://app.inrcy.com/badge/cosmos", searchSlug: "cosmos" });

test("only published, ready, allowed native channels expose URLs, with strict account scope", () => {
  assert.equal(readNativeChannelSnapshot(payload(true, true, "other-account"), "account-a"), null);
  assert.equal(readNativeChannelSnapshot(payload(true, false), "account-a")?.badgeUrl, "");
  assert.match(readNativeChannelSnapshot(payload(true, true), "account-a")!.badgeUrl, /badge\/cosmos/);
  const forged = payload(true, false); forged.states.inrbadge.published = true;
  assert.equal(normalizeNativeChannelStates(forged.states)?.inrbadge.published, false);
  assert.equal(normalizeNativeChannelStates({}), null);
  const unknown = payload(); unknown.states.inrbadge.missingFields = ["secret" as never];
  assert.equal(normalizeNativeChannelStates(unknown.states), null);
});

function runtime(initial = payload(), key: NativeChannelKey = "inrbadge") {
  const slots: unknown[] = [];
  let cursor = 0, account = "account-a";
  const effects: Array<() => void> = [];
  const events: Array<{ type: string; detail: unknown }> = [];
  const calls: Array<{ method: string; body?: Record<string, unknown> }> = [];
  const hooks = { ...React,
    useState(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], (value: unknown) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef(initial: unknown) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback: (fn: unknown) => fn,
    useEffect: (fn: () => void) => effects.push(fn),
  };
  const localRequire = (id: string) => {
    if (id === "react") return hooks;
    if (id === "react/jsx-runtime") return require(id);
    if (id === "next-intl") return { useTranslations: (scope: string) => (key: string) => key.split(".").reduce((value, part) => value[part], scope === "dashboard.nativeChannels" ? messages.nativeChannels : messages.channelBubble) };
    if (id.endsWith("browserAccountCache")) return { getActiveBrowserUserId: () => account };
    if (id.endsWith("inrDirectorySettings")) return { getInrDirectoryUrl: () => "https://inrcy.com/annuaire/" };
    if (id.endsWith("native-channel-state")) return { normalizeNativeChannelStates, readNativeChannelSnapshot };
    if (id.endsWith(".css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
    return new Proxy({}, { get: (_, key) => key });
  };
  let nextResponse = initial;
  let release: (() => void) | undefined;
  const fetch = async (_url: string, init: RequestInit = {}) => {
    calls.push({ method: init.method || "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (release) await new Promise<void>(resolve => { release = resolve; });
    return { ok: true, json: async () => nextResponse };
  };
  const source = read("app/dashboard/settings/_components/NativeChannelSettingsContent.tsx");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} as { default: (props: unknown) => ChannelBubbleConnection } };
  new Function("module", "exports", "require", "window", "fetch", code)(mod, mod.exports, localRequire, { location: { origin: "http://localhost:3000" }, dispatchEvent: (event: { type: string; detail: unknown }) => events.push(event) }, fetch);
  return { calls, events, render() { cursor = 0; return mod.exports.default({ channelKey: key, renderBubble: (connection: ChannelBubbleConnection) => connection, badgeProfile: {}, initialStates: null }); },
    async mount() { effects.splice(0).forEach(effect => effect()); await new Promise(resolve => setImmediate(resolve)); },
    respond(value: ReturnType<typeof payload>) { nextResponse = value; },
    switchAccount() { account = "account-b"; },
    block() { release = () => {}; },
    release() { const resolve = release; release = undefined; resolve?.(); },
  };
}

for (const key of ["inrbadge", "inr_search", "inr_directory"] as const) {
  test(`${key}: activation can wait for ADN; pending can be deactivated without changing public readiness`, async () => {
    const h = runtime(payload(false, false), key);
    h.render(); await h.mount();
    let connection = h.render();
    let button = channelNodes(connection.resourceContent).find(node => node.type === "button")!;
    assert.equal(button.props.disabled, false);
    h.respond(payload(true, false));
    await button.props.onClick(); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(h.calls[1].body, { accountId: "account-a", key, enabled: true });
    connection = h.render();
    assert.equal(connection.status, "available");
    assert.equal(connection.publicView?.disabled, true);
    assert.match(String(connection.statusText), /attente/);
    const details = channelNodes(connection.resourceContent).find(node => node.props.role === "status")!;
    assert.ok(details, "One short waiting status stays inside the circle");
    assert.deepEqual(channelNodes(details).filter(node => node.type === "strong").map(node => node.props.children), [messages.nativeChannels.pending]);
    assert.equal(channelNodes(details).some(node => ["li", "ul", "p", "a", "button"].includes(String(node.type))), false, "The waiting status has no information list, explanatory paragraph or navigation action");
    assert.equal(channelNodes(connection.afterContent).filter(node => node.type === "aside").length, 0);
    assert.equal(channelNodes(connection.resourceContent).filter(node => node.type === "button").length, 1, "Pending activation only offers deactivation so the pro can finish connecting channels");
    assert.ok(channelNodes(connection.extraActions).every(node => node.props.publicUrl === "" || !Object.hasOwn(node.props, "publicUrl")));
    button = channelNodes(connection.resourceContent).find(node => node.type === "button" && node.props.children === "Désactiver")!;
    assert.equal(button.props.children, "Désactiver");
    h.respond(payload(false, false)); await button.props.onClick(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.calls[2].body?.enabled, false);
    assert.equal(h.render().accountConnected, false);
  });
}

test("published state enables public actions; stale POST completion cannot update another account", async () => {
  const h = runtime(payload(true, true));
  h.render(); await h.mount();
  let connection = h.render();
  assert.equal(connection.status, "connected");
  assert.equal(connection.publicView?.disabled, false);
  assert.match(connection.publicView!.href, /badge\/cosmos/);
  const previousEvents = h.events.length;
  h.block();
  const button = channelNodes(connection.resourceContent).find(node => node.type === "button")!;
  void button.props.onClick();
  h.switchAccount(); h.respond(payload(false, false)); h.release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.events.length, previousEvents);
  connection = h.render();
  assert.equal(connection.accountConnected, true, "The old response is discarded; account remount owns the new account state");
});

test("orange public view remains a disabled button, never an actionable anchor", () => {
  const h = channelRuntime("app/dashboard/_components/DashboardFluxBubble.tsx");
  const nodes = channelNodes(h.render({ item: { ...channelItem, key: "inrbadge", bubbleStatus: "available", specialViewHref: "https://example.test/stale", canViewSpecial: false, connection: { resourceLabel: "", publicView: { href: "", disabled: true } } } }));
  assert.ok(nodes.some(node => node.type === "button" && node.props.disabled && String(node.props.title).startsWith("Voir")));
  assert.equal(nodes.some(node => node.type === "a" && node.props.href === "https://example.test/stale"), false);
});
