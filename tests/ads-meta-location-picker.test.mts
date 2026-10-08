import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { normalizeMetaAdsGeoTargets, type MetaAdsGeoTarget } from "../lib/adsMetaResources.ts";

const code = ts.transpileModule(readFileSync(new URL("../app/dashboard/ads/MetaAdsLocationPicker.tsx", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
type Element = { type: unknown; props: Record<string, unknown> };
type Props = { accountId: string; locations: string[]; targets: MetaAdsGeoTarget[]; active: boolean; onChange: (targets: MetaAdsGeoTarget[]) => void; onReadyChange: (ready: boolean, error: string) => void; onAddLocation?: (label: string) => void };
type PickerModule = { default: (props: Props) => Element; metaLocationPickerRows: (response: unknown, accountId: string, queries: readonly string[], targets: readonly MetaAdsGeoTarget[], choices?: Record<string, string>) => Array<{ query: string; options: MetaAdsGeoTarget[]; selected: MetaAdsGeoTarget | null }> };
function load(react: Record<string, unknown> = {}, fetchImpl: unknown = () => { throw new Error("Unexpected fetch"); }) {
  const runtimeModule = { exports: {} };
  new Function("require", "module", "exports", "fetch", "AbortController", code)((name: string) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx: (type: unknown, props: Record<string, unknown>) => ({ type, props }), jsxs: (type: unknown, props: Record<string, unknown>) => ({ type, props }) };
    if (name === "@/lib/adsMetaResources") return { normalizeMetaAdsGeoTargets };
    if (name === "./ads.module.css") return { default: new Proxy({}, { get: (_, key) => key }) };
    throw new Error(`Unexpected import ${name}`);
  }, runtimeModule, runtimeModule.exports, fetchImpl, AbortController);
  return runtimeModule.exports as PickerModule;
}
const rows = load().metaLocationPickerRows;
const lille: MetaAdsGeoTarget = { key: "lille-fr", type: "city", name: "Lille", countryCode: "FR", region: "Hauts-de-France" };
const lilleBe: MetaAdsGeoTarget = { key: "lille-be", type: "city", name: "Lille", countryCode: "BE", region: "Flandre" };
const nord: MetaAdsGeoTarget = { key: "nord-fr", type: "region", name: "Hauts-de-France", countryCode: "FR" };
function response(accountId = "account-a", options = [lille], autoSelectedTarget: MetaAdsGeoTarget | null = lille, query = "Lille") {
  return { selectedAccountId: accountId, options, resolutions: [{ query, options, autoSelectedTarget }], complete: Boolean(autoSelectedTarget) };
}

test("Meta geography selects only the exact native server proof, never the first ambiguous option", () => {
  assert.deepEqual(rows(response(), "account-a", ["Lille"], [])[0].selected, lille);
  assert.equal(rows(response("account-a", [lille, lilleBe], null), "account-a", ["Lille"], [])[0].selected, null);
  assert.equal(rows({ ...response("account-a", [lille, lilleBe], null), complete: true }, "account-a", ["Lille"], [])[0].selected, null);
});

test("An explicit, still verified native selection wins over an automatic suggestion", () => {
  assert.deepEqual(rows(response("account-a", [lille, lilleBe]), "account-a", ["Lille"], [lilleBe])[0].selected, lilleBe);
  assert.deepEqual(rows(response("account-a", [lille, lilleBe]), "account-a", ["Lille"], [], { Lille: "city:lille-be" })[0].selected, lilleBe);
});

test("Explicit deselection and a vanished selection cannot silently fall back", () => {
  assert.equal(rows(response(), "account-a", ["Lille"], [lille], { Lille: "" })[0].selected, null);
  assert.equal(rows(response(), "account-a", ["Lille"], [], { Lille: "city:lille-be" })[0].selected, null);
  assert.equal(rows(response("account-a", [lille], null), "account-a", ["Lille"], [{ ...lille, countryCode: "BE" }])[0].selected, null);
});

test("An unproven automatic identity, account mismatch or incomplete grouped response is refused", () => {
  assert.throws(() => rows(response("account-a", [lille], lilleBe), "account-a", ["Lille"], []));
  assert.throws(() => rows(response("account-b"), "account-a", ["Lille"], []));
  assert.throws(() => rows(response(), "account-a", ["Lille", "Paris"], []));
  assert.throws(() => rows({ ...response(), resolutions: [response().resolutions[0], response().resolutions[0]] }, "account-a", ["Lille", "Paris"], []));
  assert.throws(() => rows({ ...response(), resolutions: [{ ...response().resolutions[0], query: "lille" }] }, "account-a", ["Lille"], []));
});

test("Malformed provider options are refused while a valid native catalogue of 100 remains searchable", () => {
  assert.throws(() => rows(response("account-a", [{ ...lille, countryCode: "FRA" }]), "account-a", ["Lille"], []));
  const options = Array.from({ length: 100 }, (_, index) => ({ ...lille, key: `city-${index}`, name: `Ville ${index}` }));
  assert.equal(rows(response("account-a", options, options[99]), "account-a", ["Lille"], [])[0].options.length, 100);
  assert.throws(() => rows(response("account-a", [...options, lille], null), "account-a", ["Lille"], []));
});

function harness() {
  const slots: unknown[] = [];
  const effects = new Map<number, { deps: unknown[]; cleanup?: () => void }>();
  let index = 0;
  let pending: Array<() => void> = [];
  const requests: Array<{ url: string; signal: AbortSignal; resolve: (value: { ok: boolean; json: () => Promise<unknown> }) => void }> = [];
  const changes: MetaAdsGeoTarget[][] = [];
  const ready: Array<{ ready: boolean; error: string }> = [];
  let props: Props = { accountId: "account-a", locations: ["Lille"], targets: [], active: true, onChange: (targets) => { changes.push(targets); props.targets = targets; }, onReadyChange: (value, error) => ready.push({ ready: value, error }) };
  const api = load({
    useId: () => { const slot = index++; return slots[slot] ?? (slots[slot] = "meta-test"); },
    useRef: (value: unknown) => { const slot = index++; return slots[slot] ?? (slots[slot] = { current: value }); },
    useState: (value: unknown) => { const slot = index++; if (!(slot in slots)) slots[slot] = value; return [slots[slot], (next: unknown) => { slots[slot] = typeof next === "function" ? next(slots[slot]) : next; }]; },
    useEffect: (effect: () => (() => void), deps: unknown[]) => { const slot = index++; const previous = effects.get(slot); if (!previous || deps.some((value, at) => !Object.is(value, previous.deps[at]))) pending.push(() => { previous?.cleanup?.(); effects.set(slot, { deps, cleanup: effect() }); }); },
  }, (url: string, options: { signal: AbortSignal }) => new Promise((resolve) => requests.push({ url, signal: options.signal, resolve })));
  let tree: Element;
  function render(updates: Partial<Props> = {}) { props = { ...props, ...updates }; index = 0; pending = []; tree = api.default(props); const run = pending; pending = []; run.forEach((effect) => effect()); return tree; }
  function descendants(value: unknown): Element[] { if (Array.isArray(value)) return value.flatMap(descendants); if (!value || typeof value !== "object" || !("props" in value)) return []; const element = value as Element; return [element, ...descendants(element.props.children)]; }
  function elements(type: string) { return descendants(tree).filter((element) => element.type === type); }
  async function finish(at: number, body: unknown, ok = true) { requests[at].resolve({ ok, json: async () => body }); await new Promise<void>((resolve) => setImmediate(resolve)); render(); }
  return { render, requests, changes, ready, finish, elements };
}

test("Changing account aborts the old request and only the current account may update native targets", async () => {
  const h = harness(); h.render();
  h.render({ accountId: "account-b" });
  assert.equal(h.requests[0].signal.aborted, true);
  await h.finish(1, response("account-b", [nord], nord));
  await h.finish(0, response());
  assert.deepEqual(h.changes, [[nord]]);
  assert.equal(h.ready.at(-1)?.ready, true);
});

test("Changing labels or leaving the active step discards late responses", async () => {
  const h = harness(); h.render();
  h.render({ locations: ["Hauts-de-France"] });
  assert.match(h.requests[1].url, /query=Hauts-de-France/);
  await h.finish(0, response());
  assert.equal(h.changes.length, 0);
  h.render({ active: false });
  await h.finish(1, response("account-a", [nord], nord, "Hauts-de-France"));
  assert.equal(h.changes.length, 0);
  assert.equal(h.ready.at(-1)?.ready, false);
});

test("Updated callback refs are used without restarting an identical lookup", async () => {
  const h = harness(); h.render();
  const latest: MetaAdsGeoTarget[][] = [];
  h.render({ onChange: (targets) => latest.push(targets) });
  assert.equal(h.requests.length, 1);
  await h.finish(0, response());
  assert.deepEqual(latest, [[lille]]);
  assert.equal(h.changes.length, 0);
});

test("Provider failure keeps readiness false and does not write native targets", async () => {
  const h = harness(); h.render();
  await h.finish(0, { error: "Meta ne peut pas confirmer ce lieu." }, false);
  assert.equal(h.changes.length, 0);
  assert.equal(h.ready.at(-1)?.ready, false);
  assert.match(h.ready.at(-1)?.error || "", /ne peut pas confirmer/);
});

test("A manual choice remains selected on verification, and a removed choice requires a new decision", async () => {
  const h = harness(); h.render();
  await h.finish(0, response("account-a", [lille, lilleBe], null));
  const choose = h.elements("select")[0].props.onChange as (event: unknown) => void;
  choose({ target: { value: "city:lille-be" } }); h.render();
  assert.deepEqual(h.changes.at(-1), [lilleBe]);
  const refresh = h.elements("button").find((element) => element.props.children === "Revérifier les zones")!;
  (refresh.props.onClick as () => void)(); h.render();
  await h.finish(1, response("account-a", [lille, lilleBe]));
  assert.equal(h.elements("select")[0].props.value, "city:lille-be");
  (h.elements("button")[0].props.onClick as () => void)(); h.render();
  await h.finish(2, response());
  assert.equal(h.elements("select")[0].props.value, "");
  assert.equal(h.ready.at(-1)?.ready, false);
  assert.deepEqual(h.changes.at(-1), []);
});
