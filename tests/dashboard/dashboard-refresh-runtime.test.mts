import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as pullPolicy from "../../lib/mobilePullToRefresh.ts";

function load<T>(file: string, dependencies: Record<string, unknown>, globals: Record<string, unknown>): T {
  const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loadedModule = { exports: {} };
  new Function("module", "exports", "require", ...Object.keys(globals), js)(loadedModule, loadedModule.exports, (name: string) => {
    if (name in dependencies) return dependencies[name];
    throw new Error(`unexpected_dependency:${name}`);
  }, ...Object.values(globals));
  return loadedModule.exports as T;
}

function completionHarness({ auth, snapshot, cached }: { auth?: () => Promise<unknown>; snapshot?: () => Promise<unknown>; cached?: Record<string, unknown> } = {}) {
  const updates: unknown[] = []; const broadcasts: Event[] = []; const effects: Array<() => (() => void) | void> = []; const cleanups: Array<() => void> = [];
  const windowMock = { dispatchEvent: (event: Event) => { broadcasts.push(event); }, addEventListener() {}, removeEventListener() {} };
  const client = { auth: { getUser: auth ?? (async () => ({ data: { user: { id: "auth-user" } }, error: null })) }, from: () => {
    const builder = { select: () => builder, eq: () => builder, maybeSingle: snapshot ?? (async () => ({ data: {}, error: null })) }; return builder;
  } };
  const hook = load<{ useDashboardCompletionChecks(): { refreshCompletion(): Promise<unknown> } }>("app/dashboard/_hooks/useDashboardCompletionChecks.ts", {
    react: { useState: (initial: () => unknown) => [initial(), (value: unknown) => updates.push(value)], useRef: (current: unknown) => ({ current }), useCallback: (callback: unknown) => callback, useEffect: (effect: () => (() => void) | void) => effects.push(effect) },
    "@/lib/browserAccountCache": { readAccountCacheValue: () => cached ? JSON.stringify(cached) : null, writeAccountCacheValue() {}, resolveActiveBrowserUserId: () => "active-account" },
    "@/lib/dashboardCompletion": { DASHBOARD_PROFILE_COMPLETION_SELECT: "profile", DASHBOARD_ACTIVITY_COMPLETION_SELECT: "activity", evaluateDashboardPreparationCompletion: () => ({ profile: { incomplete: false, completed: true, missingFields: [] }, activity: { incomplete: false, completed: true, missingFields: [] }, missingSections: [] }) },
    "@/lib/multicompte/constants": { ACTIVE_INRCY_ACCOUNT_EVENT: "account-change" }, "@/lib/supabaseClient": { createClient: () => client },
    "../_components/DashboardCompletionBypassProvider": { useDashboardCompletionBypass: () => false },
  }, { window: windowMock, CustomEvent });
  const state = hook.useDashboardCompletionChecks();
  return { ...state, updates, broadcasts, mount: () => effects.forEach((effect) => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); }), unmount: () => cleanups.forEach((cleanup) => cleanup()) };
}

test("cancelled Supabase auth does not reject an effect's fire-and-forget completion refresh", async () => {
  const h = completionHarness({ auth: async () => { throw new DOMException("navigation interrupted", "AbortError"); } });
  h.mount();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await h.refreshCompletion(), null);
  assert.deepEqual(h.updates, []); assert.deepEqual(h.broadcasts, []);
});

test("cancelled profile queries keep the last completion state and do not broadcast a false incomplete state", async () => {
  const h = completionHarness({ snapshot: async () => { throw new DOMException("HMR interrupted", "AbortError"); } });
  assert.equal(await h.refreshCompletion(), null); assert.deepEqual(h.updates, []); assert.deepEqual(h.broadcasts, []);
});

test("a pending completion request cannot publish state after its hook unmounts", async () => {
  let resolveAuth!: (value: unknown) => void;
  const h = completionHarness({ auth: () => new Promise((resolve) => { resolveAuth = resolve; }) });
  h.mount(); h.unmount(); resolveAuth({ data: { user: { id: "auth-user" } }, error: null });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.updates, []); assert.deepEqual(h.broadcasts, []);
});

test("normal completion and non-cancellation authentication failures still settle readiness", async () => {
  const success = completionHarness();
  const ready = await success.refreshCompletion() as Record<string, unknown>;
  assert.equal(ready.accountId, "active-account"); assert.equal(ready.completionCheckReady, true); assert.equal(ready.profileCompleted, true);
  const failure = completionHarness({ auth: async () => { throw new Error("offline"); } });
  const failed = await failure.refreshCompletion() as Record<string, unknown>;
  assert.equal(failed.accountId, null); assert.equal(failed.completionCheckReady, true); assert.equal(failed.profileCompleted, false);
});

class TestElement {
  parentElement: TestElement | null = null;
  scrollHeight = 100; clientHeight = 100; scrollTop = 0; overflowY = "visible";
  dataset: Record<string, string> = {};
  editable = false; blocking = false;
  closest(selector: string): TestElement | null {
    const matches = selector.includes("input,") ? this.editable : this.blocking;
    return matches ? this : this.parentElement?.closest(selector) ?? null;
  }
}

function pullHarness(pathname: string, allowed = true, touch = true) {
  const listeners = new Map<string, (event: unknown) => void>(); let reloads = 0; let guards = 0;
  const effects: Array<() => void> = [];
  const root = new TestElement(), body = new TestElement(), list = new TestElement(), target = new TestElement();
  list.parentElement = body; list.overflowY = "auto"; list.scrollHeight = 1000; list.clientHeight = 400; target.parentElement = list;
  const documentMock = { documentElement: root, body, activeElement: null as TestElement | null, addEventListener: (name: string, handler: (event: unknown) => void) => listeners.set(name, handler), removeEventListener: (name: string) => listeners.delete(name) };
  const windowMock = { navigator: { maxTouchPoints: touch ? 5 : 0 }, matchMedia: () => ({ matches: touch }), scrollY: 0, getComputedStyle: (element: TestElement) => ({ overflowY: element.overflowY }), setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame: (callback: () => void) => callback(), location: { reload: () => { reloads++; } } };
  const component = load<{ default(props: { beforeRefresh: () => Promise<boolean> }): unknown }>("app/_components/PullToRefresh.tsx", {
    react: { useState: (initial: unknown) => [initial, () => {}], useRef: (current: unknown) => ({ current }), useCallback: (callback: unknown) => callback, useEffect: (effect: () => void) => effects.push(effect) },
    "react/jsx-runtime": { jsx: () => null }, "next/navigation": { usePathname: () => pathname }, "next-intl": { useTranslations: () => (key: string) => key }, "@/lib/mobilePullToRefresh": pullPolicy,
  }, { window: windowMock, document: documentMock, Element: TestElement, HTMLElement: TestElement });
  component.default({ beforeRefresh: async () => { guards++; return allowed; } }); effects.forEach((effect) => effect());
  return { list, target, documentMock, listeners, reloads: () => reloads, guards: () => guards,
    async swipe(diffY = 160, diffX = 0) {
      const point = (x: number, y: number) => ({ clientX: x, clientY: y });
      listeners.get("touchstart")?.({ target, touches: [point(30, 40)] });
      listeners.get("touchmove")?.({ target, touches: [point(30 + diffX, 40 + diffY)], preventDefault() {} });
      listeners.get("touchend")?.({ target, changedTouches: [point(30 + diffX, 40 + diffY)] });
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

test("pull-to-refresh reloads dashboard and media library from the internal list's real top", async () => {
  for (const route of ["/dashboard", "/dashboard/mediatheque"]) {
    const h = pullHarness(route); await h.swipe();
    assert.equal(h.guards(), 1); assert.equal(h.reloads(), 1);
  }
});

test("scrolled media lists, horizontal gestures, editable controls and dialogs do not refresh", async () => {
  const scrolled = pullHarness("/dashboard/mediatheque"); scrolled.list.scrollTop = 100; await scrolled.swipe(); assert.equal(scrolled.reloads(), 0);
  const horizontal = pullHarness("/dashboard/mediatheque"); await horizontal.swipe(130, 200); assert.equal(horizontal.reloads(), 0);
  const editing = pullHarness("/dashboard/mediatheque"); editing.target.editable = true; await editing.swipe(); assert.equal(editing.reloads(), 0);
  const dialog = pullHarness("/dashboard/mediatheque"); dialog.target.blocking = true; await dialog.swipe(); assert.equal(dialog.reloads(), 0);
  const cancelled = pullHarness("/dashboard/mediatheque", false); await cancelled.swipe(); assert.equal(cancelled.guards(), 1); assert.equal(cancelled.reloads(), 0);
  const desktop = pullHarness("/dashboard/mediatheque", true, false); assert.equal(desktop.listeners.size, 0);
});

test("the library still performs a fresh media request after the global reload, even with a cached snapshot", () => {
  const source = readFileSync(new URL("../../app/dashboard/mediatheque/MediaLibraryClient.tsx", import.meta.url), "utf8");
  assert.match(source, /void loadItems\(\{ silent: Boolean\(initialSnapshot\) \}\)/);
  assert.match(source, /`\/api\/media-library\/items\?\$\{params\.toString\(\)\}`,[\s\S]*?cache: "no-store"/);
});
