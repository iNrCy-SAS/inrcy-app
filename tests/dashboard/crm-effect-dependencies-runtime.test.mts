import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

type Slot = { deps?: readonly unknown[]; cleanup?: () => void; value?: unknown };
function reactEffects() {
  const slots: Slot[] = [];
  const pending: Array<() => void> = [];
  let cursor = 0;
  const changed = (before: readonly unknown[] | undefined, after: readonly unknown[]) =>
    !before || before.length !== after.length || after.some((value, index) => !Object.is(value, before[index]));
  const react = {
    useEffect(callback: () => void | (() => void), deps: readonly unknown[]) {
      const slot = slots[cursor++] ??= {};
      if (!changed(slot.deps, deps)) return;
      slot.deps = deps;
      pending.push(() => { slot.cleanup?.(); slot.cleanup = callback() || undefined; });
    },
    useCallback<T>(callback: T, deps: readonly unknown[]): T {
      const slot = slots[cursor++] ??= {};
      if (changed(slot.deps, deps)) { slot.value = callback; slot.deps = deps; }
      return slot.value as T;
    },
  };
  return {
    react,
    render<T>(run: () => T) { cursor = 0; const value = run(); pending.splice(0).forEach(effect => effect()); return value; },
    unmount() { slots.forEach(slot => slot.cleanup?.()); },
  };
}

function browser() {
  let serial = 0, registrations = 0;
  const timers = new Map<number, () => void>();
  const listeners = new Map<string, Set<(event: { target: unknown }) => void>>();
  const window = {
    setTimeout(callback: () => void) { timers.set(++serial, callback); return serial; },
    clearTimeout(id: number) { timers.delete(id); },
    addEventListener(name: string, callback: (event: { target: unknown }) => void) {
      const set = listeners.get(name) ?? new Set(); set.add(callback); listeners.set(name, set); registrations++;
    },
    removeEventListener(name: string, callback: (event: { target: unknown }) => void) { listeners.get(name)?.delete(callback); },
    requestAnimationFrame(callback: () => void) { return window.setTimeout(callback); },
    cancelAnimationFrame(id: number) { timers.delete(id); },
  };
  return {
    window, timers, listeners,
    get registrations() { return registrations; },
    fireTimers() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback()); },
    dispatch(name: string, target: unknown = {}) { listeners.get(name)?.forEach(callback => callback({ target })); },
  };
}

function loadHooks(react: unknown, globals: Record<string, unknown>) {
  const source = readFileSync(new URL("../../app/dashboard/crm/crm.client-hooks.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} as Record<string, (props: unknown) => void> };
  new Function("module", "exports", "require", ...Object.keys(globals), code)(loaded, loaded.exports, (id: string) => {
    if (id === "react") return react;
    if (id === "./crm.shared") return { DEFAULT_PAGE_SIZE: 20 };
    throw new Error(`Unexpected dependency ${id}`);
  }, ...Object.values(globals));
  return loaded.exports;
}

function lifecycleProps() {
  const loads: unknown[] = [], queries: string[] = [];
  return {
    loads, queries,
    props: {
      query: "", setServerQuery: (value: string) => queries.push(value), pageSize: 20, serverQuery: "",
      categoryFilter: "", typeFilter: "", departmentFilter: "", importantOnly: false,
      setExpandedMobileContactId() {}, setPage() {}, isResponsive: false, mobileAppendNextRef: { current: false },
      page: 1, loadContacts: async (options: unknown) => { loads.push(options); },
      mergeContactWithLocalState: (contact: unknown) => contact, setContacts() {},
      selectedContactIds: new Set<string>(), setSelectedContactsById() {}, contacts: [], initialSnapshotAvailable: true,
    },
  };
}

test("CRM debounce retains one timer on repeated renders and cancels obsolete queries or callback sinks", () => {
  const effects = reactEffects(), dom = browser(), h = lifecycleProps();
  const hooks = loadHooks(effects.react, { window: dom.window });
  const render = () => effects.render(() => hooks.useCrmContactLifecycleEffects(h.props));
  render(); render(); render();
  assert.equal(dom.timers.size, 1);
  h.props.query = "  Alice  "; render();
  const latestQueries: string[] = [];
  h.props.setServerQuery = value => latestQueries.push(value); render();
  dom.fireTimers();
  assert.deepEqual(h.queries, []);
  assert.deepEqual(latestQueries, ["Alice"]);
  h.props.query = "cancelled"; render(); effects.unmount();
  assert.equal(dom.timers.size, 0);
});

test("CRM local edits do not refetch contacts, while page and loader changes use the current inputs", () => {
  const effects = reactEffects(), dom = browser(), h = lifecycleProps();
  const hooks = loadHooks(effects.react, { window: dom.window });
  const render = () => effects.render(() => hooks.useCrmContactLifecycleEffects(h.props));
  render(); render();
  assert.equal(h.loads.length, 1);
  h.props.selectedContactIds = new Set(["contact-a"]); render();
  h.props.mergeContactWithLocalState = contact => ({ ...(contact as object), important: true }); render();
  assert.equal(h.loads.length, 1, "editing local metadata must not restart the request");
  h.props.isResponsive = true; h.props.page = 2; h.props.mobileAppendNextRef.current = true; render();
  assert.equal((h.loads.at(-1) as { append: boolean }).append, true);
  assert.equal(h.props.mobileAppendNextRef.current, false);
  const accountB: unknown[] = [];
  h.props.loadContacts = async options => { accountB.push(options); }; render(); render();
  assert.equal(accountB.length, 1, "a replacement account loader runs exactly once");
  effects.unmount();
});

test("CRM floating menus replace event sinks cleanly and never multiply listeners on stable renders", () => {
  const effects = reactEffects(), dom = browser();
  const hooks = loadHooks(effects.react, { window: dom.window });
  const original: boolean[] = [], replacement: boolean[] = [];
  const ref = () => ({ current: { contains: () => false } });
  const props = {
    actionsOpen: true, actionsRef: ref(), setActionsOpen() {}, statsRef: ref(), setStatsOpen: (open: boolean) => original.push(open),
    exportOpen: false, exportRef: ref(), setExportOpen() {}, headerSearchOpen: false, headerSearchRef: ref(),
    headerSearchInputRef: { current: null }, setHeaderSearchOpen() {}, desktopFiltersOpen: false, desktopFiltersRef: ref(),
    setDesktopFiltersOpen() {}, isResponsive: false, setMobileFiltersOpen() {}, setExpandedMobileContactId() {},
  };
  const render = () => effects.render(() => hooks.useCrmFloatingUiEffects(props));
  render(); const registrations = dom.registrations; render();
  assert.equal(dom.registrations, registrations);
  props.setStatsOpen = open => replacement.push(open); props.statsRef = ref(); render();
  assert.equal(dom.listeners.get("mousedown")?.size, 2);
  dom.dispatch("mousedown");
  assert.deepEqual(original, []); assert.deepEqual(replacement, [false]);
  effects.unmount();
  assert.equal(dom.listeners.get("mousedown")?.size, 0);
});

test("CRM mobile sentinel observes the replacement viewport and gates duplicate page increments", () => {
  const effects = reactEffects(), dom = browser();
  const observers: Array<{ callback: (entries: Array<{ isIntersecting: boolean }>) => void; root: unknown; disconnected: boolean }> = [];
  class Observer {
    record: (typeof observers)[number];
    constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void, options: { root: unknown }) {
      this.record = { callback, root: options.root, disconnected: false }; observers.push(this.record);
    }
    observe() {} disconnect() { this.record.disconnected = true; }
  }
  const hooks = loadHooks(effects.react, { window: dom.window, IntersectionObserver: Observer });
  let page = 1;
  const props = {
    isResponsive: true, loading: false, page: 1, pageSize: 20, visibleContactsLength: 20, showDesktopEmptyMessage: false,
    tableWrapRef: { current: {} }, setDesktopRowHeight() {}, mobileLoadMoreRef: { current: {} },
    contactsLength: 20, total: 60, pageCount: 3, mobileAppendNextRef: { current: false },
    setPage: (update: (previous: number) => number) => { page = update(page); },
  };
  const render = () => effects.render(() => hooks.useCrmTableViewportEffects(props));
  render(); render(); assert.equal(observers.length, 1);
  observers[0].callback([{ isIntersecting: true }]); observers[0].callback([{ isIntersecting: true }]);
  assert.equal(page, 2);
  props.tableWrapRef = { current: { changed: true } }; render();
  assert.equal(observers[0].disconnected, true); assert.equal(observers[1].root, props.tableWrapRef.current);
  effects.unmount(); assert.equal(observers[1].disconnected, true);
});

test("CRM next-contact callback reads changed important flags even when the contact list stays identical", async () => {
  const source = readFileSync(new URL("../../app/dashboard/crm/CRMClient.tsx", import.meta.url), "utf8");
  const file = ts.createSourceFile("CRMClient.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const statements: string[] = [];
  const names = new Set(["startEdit", "navigateEditingContact"]);
  function visit(node: ts.Node) {
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => names.has(d.name.getText(file)))) statements.push(node.getText(file));
    else if (ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text)) statements.push(node.getText(file));
    else ts.forEachChild(node, visit);
  }
  visit(file); assert.equal(statements.length, 2);
  const effects = reactEffects();
  const props = {
    importantIds: new Set<string>(), editingId: "a", contactNavigationBusy: false,
    contacts: [{ id: "a" }, { id: "b" }], loadContacts: async () => ({ contacts: [] }), page: 1, pageCount: 1, pageSize: 20, serverQuery: "",
    setEditingId() {}, setAddOpen() {}, setContactNavigationBusy() {}, setDraft: (value: unknown) => { drafts.push(value); },
  };
  const drafts: unknown[] = [];
  const code = ts.transpileModule(`return function render({${Object.keys(props).join(",")}}) { ${statements.join("\n")} return navigateEditingContact; }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const renderCallback = new Function("useCallback", "buildDisplayName", "window", code)(effects.react.useCallback, () => "contact", { matchMedia: () => ({ matches: true }) });
  const render = () => effects.render(() => renderCallback(props)) as (direction: number) => Promise<void>;
  const initial = render(); assert.equal(render(), initial);
  props.importantIds = new Set(["b"]);
  const current = render(); await current(1);
  assert.equal((drafts.at(-1) as { important: boolean }).important, true);
});
