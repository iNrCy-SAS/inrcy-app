import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
type Snapshot = { multiplier: number; connectedCount: number; totalChannels: number };
type State = { isActive: boolean | null; inertiaSnapshot?: Snapshot };
type Update = State & { accountId: string };
type Element = { props: { value: unknown; children: Element } };

function providerHarness() {
  let stored: Update | null = null;
  let browserAccount: string | null = null;
  const react = {
    createContext: (fallback: unknown) => ({ Provider: "provider", fallback }),
    useContext: (context: { fallback: unknown }) => context.fallback,
    useState: () => [stored, (next: (before: Update | null) => Update | null) => { stored = next(stored); }],
    useCallback: (callback: unknown) => callback,
    useMemo: (callback: () => unknown) => callback(),
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  };
  const exports: { default?: (props: unknown) => Element } = {};
  const source = ts.transpileModule(read("app/dashboard/_components/DashboardGeneratorStateProvider.tsx"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function("exports", "require", source)(exports, (name: string) => {
    if (name === "react") return react;
    if (name === "@/lib/browserAccountCache") return { getActiveBrowserUserId: () => browserAccount };
    if (name === "@/lib/multicompte/constants") return { ACTIVE_INRCY_ACCOUNT_EVENT: "account-changed" };
    return require(name);
  });
  const render = (accountId = "account-a") => {
    const tree = exports.default!({ accountId, children: null });
    return { publish: tree.props.value as (update: Update) => void, state: tree.props.children.props.value as State };
  };
  return { render, scope: (id: string | null) => { browserAccount = id; } };
}

const snapshot = { multiplier: 3, connectedCount: 5, totalChannels: 9 };

test("the layout bridge begins unknown and accepts only the confirmed active account", () => {
  const h = providerHarness();
  assert.deepEqual(h.render().state, { isActive: null });
  h.render().publish({ accountId: "account-a", isActive: true, inertiaSnapshot: snapshot });
  assert.deepEqual(h.render().state, { isActive: null }, "no active claim before browser account scope is restored");
  h.scope("account-a");
  h.render().publish({ accountId: "account-a", isActive: false, inertiaSnapshot: snapshot });
  assert.deepEqual(h.render().state, { isActive: false, inertiaSnapshot: snapshot });
});

test("a previous account cannot paint or overwrite the next account's generator", () => {
  const h = providerHarness();
  h.scope("account-a");
  const previousPublisher = h.render().publish;
  previousPublisher({ accountId: "account-a", isActive: true, inertiaSnapshot: snapshot });
  h.scope("account-b");
  assert.deepEqual(h.render().state, { isActive: null }, "account event hides the old state before the layout refresh");
  previousPublisher({ accountId: "account-a", isActive: true, inertiaSnapshot: snapshot });
  assert.deepEqual(h.render("account-b").state, { isActive: null });
  h.render("account-b").publish({ accountId: "account-a", isActive: true, inertiaSnapshot: snapshot });
  assert.deepEqual(h.render("account-b").state, { isActive: null });
  h.render("account-b").publish({ accountId: "account-b", isActive: false });
  assert.deepEqual(h.render("account-b").state, { isActive: false, inertiaSnapshot: undefined });
  h.scope(null);
  assert.deepEqual(h.render("account-b").state, { isActive: null }, "sign-out cannot retain an active lamp");
});

test("same-account tool navigation retains the last real snapshot without global or persistent storage", () => {
  const h = providerHarness();
  h.scope("account-a");
  h.render().publish({ accountId: "account-a", isActive: true, inertiaSnapshot: snapshot });
  assert.deepEqual(h.render().state, { isActive: true, inertiaSnapshot: snapshot });
  h.render().publish({ accountId: "account-a", isActive: null });
  assert.deepEqual(h.render().state, { isActive: true, inertiaSnapshot: snapshot });
  const independent = providerHarness();
  independent.scope("account-a");
  assert.deepEqual(independent.render().state, { isActive: null });
  const layout = read("app/dashboard/layout.tsx");
  assert.match(layout, /<DashboardGeneratorStateProvider key=\{accountScope\.activeUserId\} accountId=\{accountScope\.activeUserId\}>/);
});

function clientExpression(name: string) {
  const file = ts.createSourceFile("DashboardClient.tsx", read("app/dashboard/DashboardClient.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer && ts.isCallExpression(node.initializer)) expression = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(expression);
  return ts.transpileModule(`exports.callback = (${expression.getText(file)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}

test("closing the routed generator cleans only its own query and closes the real modal", () => {
  const effects: unknown[] = [];
  const exports: { callback?: () => void } = {};
  new Function("exports", "setGeneratorSettingsOpen", "searchParams", "router", clientExpression("closeGeneratorSettings"))(
    exports, (open: boolean) => effects.push(open), new URLSearchParams("generator=1&keep=42"),
    { replace: (href: string, options: unknown) => effects.push([href, options]) },
  );
  exports.callback!();
  assert.deepEqual(effects, [false, ["/dashboard?keep=42", { scroll: false }]]);
});

test("generator query opening remains behind the shared dirty-navigation guard", async () => {
  const client = read("app/dashboard/DashboardClient.tsx");
  const file = ts.createSourceFile("DashboardClient.tsx", client, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(file) === "useEffect" && node.arguments[0]?.getText(file).includes("if (!generatorRequested)")) callback = node.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(callback);
  const code = ts.transpileModule(`exports.callback = (${callback.getText(file)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const accepted of [false, true]) {
    const opens: boolean[] = [];
    const ref = { current: false };
    const exports: { callback?: () => void } = {};
    new Function("exports", "generatorRequested", "generatorOpenedFromRoute", "setGeneratorSettingsOpen", "requestNavigation", code)(
      exports, true, ref, (open: boolean) => opens.push(open), async (action: () => void) => { if (accepted) action(); return accepted; },
    );
    exports.callback!();
    await Promise.resolve();
    assert.deepEqual(opens, accepted ? [true] : []);
    assert.equal(ref.current, accepted);
  }
});
