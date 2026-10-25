import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(path.join(process.cwd(), "package.json"));
const ts = require("typescript") as typeof import("typescript");

function source(relativePath: string) {
  return ts.createSourceFile(relativePath, readFileSync(relativePath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function findNode(root: import("typescript").Node, predicate: (node: import("typescript").Node) => boolean): import("typescript").Node {
  let found: import("typescript").Node | undefined;
  const visit = (node: import("typescript").Node) => {
    if (found) return;
    if (predicate(node)) found = node;
    else ts.forEachChild(node, visit);
  };
  visit(root);
  assert.ok(found, "production callback must exist");
  return found;
}

function namedCallback(file: import("typescript").SourceFile, name: string) {
  const declaration = findNode(file, (node) => ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) as import("typescript").VariableDeclaration;
  assert.ok(declaration.initializer);
  return (ts.isCallExpression(declaration.initializer) ? declaration.initializer.arguments[0] : declaration.initializer).getText(file);
}

function confirmCallback(file: import("typescript").SourceFile) {
  const registration = findNode(file, (node) => ts.isCallExpression(node) && node.expression.getText(file) === "useUnsavedExitGuard") as import("typescript").CallExpression;
  const callback = findNode(registration.arguments[0], (node) => ts.isPropertyAssignment(node) && node.name.getText(file) === "onConfirmExit") as import("typescript").PropertyAssignment;
  return callback.initializer.getText(file);
}

function evaluate(expression: string, globals: Record<string, unknown>) {
  const output = ts.transpileModule(`(function () { return (${expression}); })()`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return vm.runInNewContext(output, globals);
}

function harness(options: { panel?: string; boutiqueView?: "products" | "orders"; unsaved?: boolean } = {}) {
  const client = source("app/dashboard/DashboardClient.tsx");
  const provider = source("app/dashboard/_components/DashboardUnsavedNavigationProvider.tsx");
  const routing = source("app/dashboard/_hooks/useDashboardPanelRouting.ts");
  const ref = { current: false };
  const draft = { displayName: "Modification locale non enregistrée" };
  const history: { kind: "push" | "replace"; href: string }[] = [];
  const confirmations: ((allowed: boolean) => void)[] = [];
  const state = {
    panel: (options.panel ?? "preferences") as string | null,
    boutiqueView: options.boutiqueView ?? "products",
    unsaved: options.unsaved ?? true,
    closes: 0,
  };
  const guard = {
    sequence: 1,
    shouldBlock: () => state.unsaved,
    confirmExit: async () => {
      const allowed = await new Promise<boolean>((resolve) => confirmations.push(resolve));
      if (allowed) onConfirmExit();
      return allowed;
    },
  };
  const requestNavigation = evaluate(namedCallback(provider, "requestNavigation"), {
    guardsRef: { current: new Map([["settings", guard]]) },
    navigationPendingRef: { current: false },
    console,
  }) as (action: () => void | Promise<void>) => Promise<boolean>;
  const storage = new Map<string, string>();
  const params = new URLSearchParams(`panel=${state.panel}&keep=1`);
  const router = {
    push: (href: string) => { history.push({ kind: "push", href }); },
    replace: (href: string) => { history.push({ kind: "replace", href }); },
  };
  const routeContext: Record<string, unknown> = {
    URLSearchParams,
    metaPilotEnabled: true,
    router,
    searchParams: params,
    requestNavigation,
    sessionStorage: {
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    setPanel: (panel: string | null) => {
      // Leaving the active form unmounts its local edit state.
      if (panel !== state.panel) draft.displayName = "";
      state.panel = panel;
    },
    PANEL_RETURN_QUERY_KEYS: ["panelSource"],
  };
  routeContext.markPanelAsExplicitlyOpened = evaluate(namedCallback(routing, "markPanelAsExplicitlyOpened"), routeContext);
  const closePanel = evaluate(namedCallback(routing, "closePanel"), routeContext) as () => void;
  const openPanel = evaluate(namedCallback(routing, "openPanel"), routeContext) as (panel: string) => Promise<boolean>;
  const clientContext: Record<string, unknown> = {
    settingsDrawerTabSwitchRef: ref,
    setSettingsDrawerHasUnsavedChanges: (unsaved: boolean) => { state.unsaved = unsaved; },
    setBoutiqueView: (view: "products" | "orders") => { state.boutiqueView = view; },
    closeSettingsDrawer: async () => { state.closes += 1; closePanel(); },
    openPanel,
  };
  Object.defineProperty(clientContext, "panel", { get: () => state.panel });
  const onConfirmExit = evaluate(confirmCallback(client), clientContext) as () => void;
  const select = evaluate(namedCallback(client, "selectSettingsTab"), clientContext) as (panel: string) => Promise<boolean | undefined>;
  clientContext.selectSettingsTab = select;
  const selectBoutique = evaluate(namedCallback(client, "selectBoutiqueTab"), clientContext) as (tab: "inertie" | "products" | "orders") => Promise<void>;
  return { select, selectBoutique, onConfirmExit, ref, draft, state, history, confirmations, clientContext };
}

test("cancelling a dirty settings tab switch retains the selected tab and local draft", async () => {
  const h = harness();
  const pending = h.select("compte");
  assert.equal(h.ref.current, true, "the tab-switch marker must remain set until the guard settles");
  assert.equal(h.confirmations.length, 1);
  h.confirmations[0](false);
  await pending;
  assert.equal(h.state.panel, "preferences");
  assert.equal(h.state.unsaved, true);
  assert.equal(h.draft.displayName, "Modification locale non enregistrée");
  assert.equal(h.state.closes, 0);
  assert.deepEqual(h.history, []);
  assert.equal(h.ref.current, false);
});

test("confirming a dirty settings tab switch navigates once without closing the drawer", async () => {
  const h = harness();
  const pending = h.select("compte");
  assert.equal(h.ref.current, true);
  h.confirmations[0](true);
  await pending;
  assert.equal(h.state.panel, "compte");
  assert.equal(h.state.unsaved, false);
  assert.equal(h.state.closes, 0);
  assert.deepEqual(h.history, [{ kind: "push", href: "/dashboard?panel=compte&keep=1" }]);
  assert.equal(h.ref.current, false);
});

test("a second tab click cannot clear the first pending switch marker", async () => {
  const h = harness();
  const pending = h.select("compte");
  await h.select("boutique");
  assert.equal(h.ref.current, true);
  assert.equal(h.confirmations.length, 1);
  h.confirmations[0](true);
  await pending;
  assert.equal(h.state.closes, 0);
  assert.equal(h.state.panel, "compte");
  assert.equal(h.history.length, 1);
  assert.equal(h.ref.current, false);
});

test("a failed tab navigation resets the switch marker and preserves normal close behavior", async () => {
  const h = harness();
  h.clientContext.openPanel = async () => { throw new Error("navigation failed"); };
  await assert.rejects(h.select("compte"), /navigation failed/);
  assert.equal(h.ref.current, false);
  assert.equal(h.state.panel, "preferences");
  assert.equal(h.state.unsaved, true);
  h.onConfirmExit();
  assert.equal(h.state.closes, 1);
  assert.equal(h.state.panel, null);
  assert.deepEqual(h.history, [{ kind: "replace", href: "/dashboard?keep=1" }]);
});

test("selecting the current tab leaves edits untouched without prompting", async () => {
  const h = harness();
  await h.select("preferences");
  assert.equal(h.confirmations.length, 0);
  assert.equal(h.state.unsaved, true);
  assert.deepEqual(h.history, []);
  assert.equal(h.ref.current, false);
});

test("boutique orders opens its panel and products/orders switches do not navigate again", async () => {
  const h = harness({ panel: "inertie", unsaved: false });
  await h.selectBoutique("orders");
  assert.equal(h.state.panel, "boutique");
  assert.equal(h.state.boutiqueView, "orders");
  assert.deepEqual(h.history, [{ kind: "push", href: "/dashboard?panel=boutique&keep=1" }]);
  await h.selectBoutique("products");
  assert.equal(h.state.boutiqueView, "products");
  await h.selectBoutique("orders");
  assert.equal(h.state.boutiqueView, "orders");
  assert.equal(h.history.length, 1);
  assert.equal(h.state.closes, 0);
});

test("opening inertia resets the boutique view to products", async () => {
  const h = harness({ panel: "boutique", boutiqueView: "orders", unsaved: false });
  await h.selectBoutique("inertie");
  assert.equal(h.state.panel, "inertie");
  assert.equal(h.state.boutiqueView, "products");
  assert.deepEqual(h.history, [{ kind: "push", href: "/dashboard?panel=inertie&keep=1" }]);
  assert.equal(h.state.closes, 0);
  assert.equal(h.ref.current, false);
});

test("a rejected or busy boutique tab switch cannot change its controlled view", async () => {
  const cancelled = harness();
  const pending = cancelled.selectBoutique("orders");
  assert.equal(cancelled.state.boutiqueView, "products", "view cannot change before navigation is approved");
  cancelled.confirmations[0](false);
  await pending;
  assert.equal(cancelled.state.boutiqueView, "products");
  assert.equal(cancelled.state.panel, "preferences");
  assert.deepEqual(cancelled.history, []);
  assert.equal(cancelled.ref.current, false);

  const busy = harness({ panel: "boutique", unsaved: false });
  busy.ref.current = true;
  await busy.selectBoutique("orders");
  assert.equal(busy.state.boutiqueView, "products");
  assert.equal(busy.state.panel, "boutique");
  assert.deepEqual(busy.history, []);
  assert.equal(busy.ref.current, true, "the existing navigation owns the pending marker");
});


for (const allowed of [false, true]) {
  test(`the main invoice tab ${allowed ? "opens" : "stays closed"} through the existing unsaved-changes guard`, async () => {
    const h = harness({ panel: "preferences" });
    const pending = h.select("factures");
    assert.equal(h.confirmations.length, 1);
    assert.equal(h.state.panel, "preferences", "invoice navigation waits for the existing confirmation");
    h.confirmations[0](allowed);
    await pending;
    assert.equal(h.state.panel, allowed ? "factures" : "preferences");
    assert.equal(h.state.unsaved, !allowed);
    assert.equal(h.state.closes, 0, "switching to invoices does not close the account drawer");
    assert.deepEqual(h.history, allowed ? [{ kind: "push", href: "/dashboard?panel=factures&keep=1" }] : []);
    assert.equal(h.draft.displayName, allowed ? "" : "Modification locale non enregistrée");
    assert.equal(h.ref.current, false);
  });
}
