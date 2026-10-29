import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import ts from "typescript";

type Props = Record<string, unknown>;
type Location = { postalCode: string; city: string };
type Handle = { isReady(): boolean; canAutoSave(): boolean; save(): Promise<boolean>; cancelChanges(): void };
const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../../app/dashboard/settings/_components/BusinessLocationFields.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  fileName: "BusinessLocationFields.tsx",
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const ACCOUNT = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const response = (accountId: string, location: Location) => Response.json({ ok: true, accountId, location });
const settle = async () => { for (let index = 0; index < 18; index++) await Promise.resolve(); };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function elements(tree: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!isValidElement<Props>(tree)) return [];
  return [tree, ...elements(tree.props.children as ReactNode)];
}

/** Executes the actual component and its asynchronous effects with isolated hooks.
 * Requests are fixtures; no authenticated session, provider, or real DB is touched. */
function harness(fetchResponse: (method: string, account: string, body: Props) => Promise<Response>) {
  const slots: Array<{ value?: unknown; deps?: unknown[]; cleanup?: () => void }> = [];
  let cursor = 0;
  let effects: Array<() => void> = [];
  let account = ACCOUNT;
  let value = { useHeadquarters: true, primaryArea: "" };
  let dirty = false;
  let refreshes = 0;
  const requests: Array<{ method: string; account: string; body: Props }> = [];
  const ref = { current: null as Handle | null };
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const browser = new EventTarget();
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  const unchanged = (previous?: unknown[], next?: unknown[]) => previous && next
    && previous.length === next.length && previous.every((item, index) => Object.is(item, next[index]));
  const t = (key: string) => key;
  const hooks = {
    forwardRef: (component: unknown) => component,
    useId: () => { cursor++; return "location-test"; },
    useState(initial: unknown) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === "function" ? initial() : initial };
      return [slots[index].value, (next: unknown) => { slots[index].value = typeof next === "function" ? next(slots[index].value) : next; }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: { current: initial } };
      return slots[index].value;
    },
    useCallback(callback: unknown, deps: unknown[]) {
      const index = cursor++;
      if (!unchanged(slots[index]?.deps, deps)) slots[index] = { value: callback, deps };
      return slots[index].value;
    },
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      const index = cursor++;
      if (unchanged(slots[index]?.deps, deps)) return;
      effects.push(() => {
        slots[index]?.cleanup?.();
        const cleanup = effect();
        slots[index] = { deps, cleanup: typeof cleanup === "function" ? cleanup : undefined };
      });
    },
    useImperativeHandle(target: typeof ref, create: () => Handle) { cursor++; target.current = create(); },
  };
  const onUnsavedChange = (next: boolean) => { dirty = next; };
  const dependencies: Props = {
    react: hooks,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next-intl": { useTranslations: () => t },
    "@/lib/browserAccountCache": { getActiveBrowserUserId: () => account },
    "@/lib/boosterGenerationContextClient": { invalidateBoosterGenerationContextClient: async () => true },
    "@/lib/multicompte/constants": { ACTIVE_INRCY_ACCOUNT_EVENT: "account-change" },
    "@/lib/publicProfileRefreshClient": { PUBLIC_PROFILE_DATA_SAVED_EVENT: "profile-saved", refreshPublicProfileDependents: async () => { refreshes++; return true; } },
    "./BusinessLocationFields.module.css": { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) },
  };
  const loaded = { exports: {} as { default: (props: Props, ref: unknown) => ReactNode } };
  const fetchFixture = async (_url: string, options: RequestInit = {}) => {
    const method = options.method || "GET";
    const body = options.body ? JSON.parse(String(options.body)) : {};
    requests.push({ method, account, body });
    return fetchResponse(method, account, body);
  };
  new Function("module", "exports", "require", "fetch", compiled)(loaded, loaded.exports, (name: string) => {
    assert.ok(Object.hasOwn(dependencies, name), name);
    return dependencies[name];
  }, fetchFixture);
  function render() {
    cursor = 0;
    effects = [];
    const tree = loaded.exports.default({ value, onChange: (next: typeof value) => { value = next; }, onUnsavedChange }, ref);
    effects.forEach((effect) => effect());
    return tree;
  }
  const input = (autoComplete: string) => {
    const result = elements(render()).find((node) => node.type === "input" && node.props.autoComplete === autoComplete);
    assert.ok(result, autoComplete);
    return result;
  };
  return {
    ref, requests, render, input,
    get dirty() { return dirty; },
    get refreshes() { return refreshes; },
    edit(field: "postal-code" | "address-level2", next: string) {
      const fieldInput = input(field);
      assert.notEqual(fieldInput.props.disabled, true);
      (fieldInput.props.onChange as (event: unknown) => void)({ target: { value: next } });
      render();
    },
    switchAccount() { account = OTHER; browser.dispatchEvent(new Event("account-change")); },
    dispose() {
      slots.forEach((slot) => slot?.cleanup?.());
      if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
      else Reflect.deleteProperty(globalThis, "window");
    },
  };
}

test("content targeting is separate from the physical location and its API payload", async () => {
  const location = { postalCode: "62440", city: "Harnes" };
  const ui = harness(async (method, account, body) => response(account, method === "PUT" ? body as Location : location));
  try {
    ui.render(); await settle();
    assert.equal(ui.ref.current?.isReady(), true);
    let tree = ui.render();
    const checkbox = elements(tree).find((node) => node.props.type === "checkbox")!;
    assert.equal(checkbox.props.checked, true);
    (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: false } });
    tree = ui.render();
    const target = elements(tree).find((node) => node.type === "input" && String(node.props.id).endsWith("-primary-area"));
    assert.ok(target);
    (target.props.onChange as (event: unknown) => void)({ target: { value: "Lille" } });
    assert.equal(ui.input("address-level2").props.value, "Harnes");
    assert.equal(ui.dirty, false, "targeting is saved by AiMemory, not the implantation endpoint");
    ui.edit("address-level2", "Lens");
    assert.equal(await ui.ref.current!.save(), true);
    assert.deepEqual(ui.requests.find((item) => item.method === "PUT")?.body, { accountId: ACCOUNT, postalCode: "62440", city: "Lens" });
    assert.equal(ui.refreshes, 1);
  } finally { ui.dispose(); }
});

test("late autofill preserves a manual draft and discard restores the persisted channel result", async () => {
  const fill = deferred<Response>();
  const ui = harness(async (method, account) => method === "POST" ? fill.promise : response(account, { postalCode: "", city: "" }));
  try {
    ui.render(); await settle();
    assert.equal(ui.requests.filter((item) => item.method === "POST").length, 1);
    ui.edit("postal-code", "59000"); ui.edit("address-level2", "Lille");
    fill.resolve(response(ACCOUNT, { postalCode: "62000", city: "Arras" })); await settle();
    assert.equal(ui.input("address-level2").props.value, "Lille");
    assert.equal(ui.dirty, true);
    ui.ref.current!.cancelChanges();
    assert.equal(ui.input("address-level2").props.value, "Arras");
    assert.equal(ui.dirty, false);
  } finally { ui.dispose(); }
});

test("an earlier autofill response cannot roll back a newer manual save", async () => {
  const fill = deferred<Response>();
  const ui = harness(async (method, account, body) => method === "POST" ? fill.promise
    : response(account, method === "PUT" ? body as Location : { postalCode: "", city: "" }));
  try {
    ui.render(); await settle();
    ui.edit("postal-code", "59000"); ui.edit("address-level2", "Lille");
    assert.equal(await ui.ref.current!.save(), true);
    fill.resolve(response(ACCOUNT, { postalCode: "62000", city: "Arras" })); await settle();
    assert.equal(ui.input("address-level2").props.value, "Lille");
    assert.equal(ui.dirty, false);
    ui.ref.current!.cancelChanges();
    assert.equal(ui.input("postal-code").props.value, "59000");
  } finally { ui.dispose(); }
});

test("account switching ignores an old load and saves only the new account", async () => {
  const first = deferred<Response>();
  const ui = harness(async (method, account, body) => method === "GET" && account === ACCOUNT ? first.promise
    : response(account, method === "PUT" ? body as Location : { postalCode: "62300", city: "Lens" }));
  try {
    ui.render(); ui.switchAccount(); await settle();
    first.resolve(response(ACCOUNT, { postalCode: "62440", city: "Harnes" })); await settle();
    assert.equal(ui.input("address-level2").props.value, "Lens");
    ui.edit("address-level2", "Liévin");
    assert.equal(await ui.ref.current!.save(), true);
    assert.equal(ui.requests.find((item) => item.method === "PUT")?.body.accountId, OTHER);
  } finally { ui.dispose(); }
});

test("a partial location stays out of automatic saves but can be explicitly saved", async () => {
  const ui = harness(async (method, account, body) => response(account, method === "PUT" ? body as Location : { postalCode: "", city: "" }));
  try {
    ui.render(); await settle();
    ui.edit("address-level2", "Lille");
    assert.equal(ui.dirty, true);
    assert.equal(ui.ref.current!.canAutoSave(), false);
    assert.equal(await ui.ref.current!.save(), true);
    assert.equal(ui.requests.find((item) => item.method === "PUT")?.body.postalCode, "");
    assert.equal(ui.dirty, false);
  } finally { ui.dispose(); }
});

test("an old save cannot change the selected account or keep its form locked", async () => {
  const oldSave = deferred<Response>();
  const ui = harness(async (method, account) => method === "PUT" ? oldSave.promise
    : response(account, account === ACCOUNT ? { postalCode: "62000", city: "Arras" } : { postalCode: "59000", city: "Lille" }));
  try {
    ui.render(); await settle();
    ui.edit("address-level2", "Lens");
    const save = ui.ref.current!.save();
    ui.switchAccount(); await settle();
    assert.equal(ui.input("address-level2").props.value, "Lille");
    assert.notEqual(ui.input("address-level2").props.disabled, true);
    oldSave.resolve(response(ACCOUNT, { postalCode: "62000", city: "Lens" }));
    assert.equal(await save, false);
    assert.equal(ui.input("address-level2").props.value, "Lille");
    assert.equal(ui.refreshes, 0);
  } finally { ui.dispose(); }
});
