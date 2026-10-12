import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

type Draft = { id: string; title: string; preview: string; channels: string[]; savedAt: string };
type Node = { type: unknown; props: Record<string, unknown> };
type Hook = { value?: unknown; dependencies?: readonly unknown[]; cleanup?: () => void };
const draft = (id: string, title: string, channels: string[]): Draft => ({ id, title, channels, preview: "", savedAt: "2026-10-12T12:00:00Z" });
const cachedAdminDrafts = [draft("threads-only", "Admin-only draft", ["threads"]), draft("mixed", "Mixed publication", ["facebook", "threads"]), draft("facebook", "Facebook publication", ["facebook"])];
const compile = (file: string) => ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object") return [];
  const node = value as Node;
  return [node, ...nodes(node.props?.children)];
}
function text(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(text).join("");
  if (!value || typeof value !== "object") return "";
  return text((value as Node).props?.children);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}
const flushAsync = () => new Promise<void>(resolve => setImmediate(resolve));

function menuHarness() {
  const hooks: Hook[] = [];
  let cursor = 0;
  let stateIndex = 0;
  let pilot = true;
  let account = "admin-account";
  const effects: Array<() => void> = [];
  const selected: string[] = [];
  const requests: Array<ReturnType<typeof deferred<{ ok: boolean; json: () => Promise<{ drafts: Draft[] }> }>>> = [];
  const originalGlobals = new Map(["window", "document", "fetch"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, "window", { configurable: true, value: { innerWidth: 1200, innerHeight: 900, addEventListener() {}, removeEventListener() {}, requestAnimationFrame(callback: () => void) { callback(); return 1; } } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { body: {}, addEventListener() {}, removeEventListener() {} } });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: () => { const request = deferred<{ ok: boolean; json: () => Promise<{ drafts: Draft[] }> }>(); requests.push(request); return request.promise; } });
  const sameDependencies = (left: readonly unknown[] | undefined, right: readonly unknown[] | undefined) => Boolean(left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index])));
  const react = {
    useId: () => "draft-menu-test",
    useRef: (initial: unknown) => {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { value: { current: initial } };
      return hooks[index].value;
    },
    useState: (initial: unknown) => {
      const index = cursor++;
      const ordinal = stateIndex++;
      if (!hooks[index]) {
        const seed = [true, { top: 60, left: 100, width: 430 }, false, false, structuredClone(cachedAdminDrafts)];
        hooks[index] = { value: ordinal < seed.length ? seed[ordinal] : typeof initial === "function" ? initial() : initial };
      }
      const hook = hooks[index];
      return [hook.value, (next: unknown) => { hook.value = typeof next === "function" ? next(hook.value) : next; }];
    },
    useCallback: (callback: unknown, dependencies: readonly unknown[]) => {
      const index = cursor++;
      if (!hooks[index] || !sameDependencies(hooks[index].dependencies, dependencies)) hooks[index] = { value: callback, dependencies };
      return hooks[index].value;
    },
    useEffect: (callback: () => unknown, dependencies?: readonly unknown[]) => {
      const index = cursor++;
      const previous = hooks[index];
      if (previous && sameDependencies(previous.dependencies, dependencies)) return;
      const hook: Hook = { dependencies };
      hooks[index] = hook;
      effects.push(() => {
        previous?.cleanup?.();
        const cleanup = callback();
        if (typeof cleanup === "function") hook.cleanup = cleanup as () => void;
      });
    },
  };
  const jsx = (type: unknown, props: Record<string, unknown>): Node => {
    const ref = props.ref as { current: unknown } | undefined;
    if (ref && typeof type === "string") ref.current = { contains: () => false, getBoundingClientRect: () => ({ right: 550, bottom: 60 }) };
    return { type, props };
  };
  const filterModule = { exports: {} as Record<string, unknown> };
  new Function("module", "exports", compile("lib/metaChannelUiAccess.ts"))(filterModule, filterModule.exports);
  const menuModule = { exports: {} as Record<string, unknown> };
  const translation = (key: string) => key;
  const styles = Object.fromEntries(["root", "trigger", "count", "menu", "menuCount", "refreshButton", "draftItem", "list", "loadingState", "emptyState"].map(key => [key, key]));
  const localRequire = (id: string) => {
    if (id === "react") return react;
    if (id === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (id === "react-dom") return { createPortal: (node: Node) => node };
    if (id === "next-intl") return { useTranslations: () => translation };
    if (id.endsWith("DashboardViewerAccessProvider")) return { useDashboardViewerAccess: () => ({ metaPilotEnabled: pilot, activeAccountId: account }) };
    if (id === "@/lib/metaChannelUiAccess") return filterModule.exports;
    if (id.endsWith(".css")) return styles;
    throw new Error("Unexpected dependency " + id);
  };
  new Function("module", "exports", "require", compile("app/dashboard/booster/publier/components/PublishDraftHeaderMenu.tsx"))(menuModule, menuModule.exports, localRequire);
  const Menu = menuModule.exports.default as (props: Record<string, unknown>) => Node;
  return {
    requests, selected,
    render() { cursor = 0; stateIndex = 0; return Menu({ buttonClassName: "test-button", onSelect: (id: string) => { selected.push(id); } }); },
    commit() { while (effects.length) effects.shift()!(); },
    access(enabled: boolean, activeAccount = account) { pilot = enabled; account = activeAccount; },
    dispose() {
      for (const hook of hooks) hook?.cleanup?.();
      for (const [key, descriptor] of originalGlobals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}
function counters(tree: Node) {
  return nodes(tree).filter(node => node.props?.className === "count" || node.props?.className === "menuCount").map(node => text(node));
}
function refresh(tree: Node) {
  const button = nodes(tree).find(node => node.type === "button" && node.props?.className === "refreshButton");
  assert.ok(button);
  (button.props.onClick as () => void)();
}

test("an already open ADMIN draft menu loses Threads rows, channel labels and both counters in the first USER render", () => {
  const harness = menuHarness();
  try {
    assert.deepEqual(counters(harness.render()), ["3", "3"]);
    harness.commit();
    harness.access(false);
    const downgraded = harness.render(); // Before passive scope cleanup or any new request.
    assert.deepEqual(counters(downgraded), ["2", "2"]);
    assert.doesNotMatch(text(downgraded), /Threads|Admin-only draft/);
    assert.match(text(downgraded), /Mixed publication/);
    const choices = nodes(downgraded).filter(node => node.props?.role === "menuitem");
    assert.equal(choices.length, 2);
    for (const choice of choices) (choice.props.onClick as () => void)();
    assert.deepEqual(harness.selected, ["mixed", "facebook"]);
  } finally { harness.dispose(); }
});

test("a late ADMIN response is discarded after pilot removal and a new USER load cannot restore Threads", async () => {
  const harness = menuHarness();
  try {
    harness.render(); harness.commit();
    refresh(harness.render());
    assert.equal(harness.requests.length, 1);
    harness.access(false);
    assert.deepEqual(counters(harness.render()), ["2", "2"]);
    harness.commit();
    harness.requests[0].resolve({ ok: true, json: async () => ({ drafts: [draft("late", "Late ADMIN response", ["facebook"]), draft("late-threads", "Hidden Threads response", ["threads"])] }) });
    await flushAsync();
    const afterLateResponse = harness.render();
    assert.deepEqual(counters(afterLateResponse), ["2", "2"]);
    assert.doesNotMatch(text(afterLateResponse), /Late ADMIN response|Threads/);
    refresh(afterLateResponse);
    assert.equal(harness.requests.length, 2);
    harness.requests[1].resolve({ ok: true, json: async () => ({ drafts: [draft("user", "USER Facebook draft", ["facebook"]), draft("forged", "Unexpected Threads draft", ["threads"])] }) });
    await flushAsync();
    const afterUserResponse = harness.render();
    assert.deepEqual(counters(afterUserResponse), ["1", "1"]);
    assert.match(text(afterUserResponse), /USER Facebook draft/);
    assert.doesNotMatch(text(afterUserResponse), /Threads/);
  } finally { harness.dispose(); }
});

test("changing the active account invalidates its predecessor's pending draft response", async () => {
  const harness = menuHarness();
  try {
    harness.render(); harness.commit();
    refresh(harness.render());
    harness.access(true, "another-admin-account");
    const changedScope = harness.render();
    assert.deepEqual(counters(changedScope), ["0"], "old account rows and trigger count vanish before passive cleanup");
    assert.doesNotMatch(text(changedScope), /Admin-only draft|Mixed publication|Facebook publication/);
    harness.commit();
    harness.requests[0].resolve({ ok: true, json: async () => ({ drafts: [draft("old-account", "Old account response", ["facebook"])] }) });
    await flushAsync();
    const afterLateResponse = harness.render();
    assert.deepEqual(counters(afterLateResponse), ["0"]);
    assert.doesNotMatch(text(afterLateResponse), /Old account response/);
  } finally { harness.dispose(); }
});
