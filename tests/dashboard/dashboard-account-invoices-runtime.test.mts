import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import ts from "typescript";
import { isDashboardDestinationAllowedForEdition, type DashboardEdition } from "../../lib/dashboardEdition.ts";

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const require = createRequire(import.meta.url);
const locales = ["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"] as const;
const panelOrder = ["compte", "abonnement", "factures", "parrainage", "preferences", "legal", "rgpd"];
type Props = Record<string, unknown>;
type Element = ReactElement<Props>;
const compiled = new Map(["DashboardAccountTabs", "DashboardBoutiqueTabs", "DashboardSettingsTabs", "DashboardMobileSelect", "DashboardSettingsDrawerContent"].map((name) => [name, ts.transpileModule(read(`app/dashboard/_components/${name}.tsx`), {
  fileName: `${name}.tsx`,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText]));

function nodes(tree: ReactNode): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return isValidElement<Props>(tree) ? [tree, ...nodes(tree.props.children as ReactNode)] : [];
}
function content(tree: ReactNode): string {
  if (Array.isArray(tree)) return tree.map(content).join("");
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  return isValidElement<Props>(tree) ? content(tree.props.children as ReactNode) : "";
}
function find(tree: ReactNode, predicate: (node: Element) => boolean): Element {
  const node = nodes(tree).find(predicate);
  assert.ok(node, "Expected account navigation element is missing");
  return node;
}

/** Real account tab order and keyboard/click callbacks, with content panes
 * replaced by passive markers so no account, invoice or payment request runs. */
function harness(locale: string = "fr-FR", edition: DashboardEdition = "standard") {
  const copy = JSON.parse(read(`messages/${locale}/dashboard.json`));
  const settingsCopy = JSON.parse(read(`messages/${locale}/settings.json`));
  const loaded = new Map<string, Record<string, unknown>>();
  const stubs = new Map<string, (props: Props) => null>();
  const effects: Array<() => void> = [];
  const selected: string[] = [];
  const headerContext = { Provider: ({ children }: { children: ReactNode }) => children };
  const stub = (name: string) => {
    if (!stubs.has(name)) stubs.set(name, (_props: Props) => null);
    return stubs.get(name)!;
  };
  const loader = (specifier: string): unknown => {
    if (specifier === "react/jsx-runtime") return require(specifier);
    if (specifier === "react") return { useRef: (initial: unknown) => ({ current: initial }), useContext: () => undefined, useLayoutEffect: (effect: () => void) => effects.push(effect) };
    if (specifier === "next-intl") return { useTranslations: (namespace: string) => (key: string) => {
      const messages = namespace === "settings" ? settingsCopy : copy.accountTabs;
      assert.ok(namespace === "settings" || namespace === "dashboard.accountTabs");
      assert.equal(typeof messages[key], "string", `${locale}/${key}`);
      return messages[key];
    } };
    if (specifier === "../_hooks/useDashboardI18n") return { useDashboardI18n: () => copy };
    if (specifier.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
    if (specifier === "../DrawerHeaderTabs") return { DrawerHeaderTabsContext: headerContext };
    if (specifier === "./DashboardEditionProvider") return { useDashboardSubscriptionEdition: () => edition };
    if (specifier.startsWith("../settings/_components/") || specifier === "./ReferralPanel" || specifier === "./GoogleOAuthConsentBanner") return { __esModule: true, default: stub(specifier) };
    const name = specifier.replace(/^\.\//u, "");
    assert.ok(compiled.has(name), `Unexpected account dependency ${specifier}`);
    return load(name);
  };
  function load(name: string) {
    if (loaded.has(name)) return loaded.get(name)!;
    const record = { exports: {} as Record<string, unknown> };
    new Function("module", "exports", "require", compiled.get(name)!)(record, record.exports, loader);
    loaded.set(name, record.exports);
    return record.exports;
  }
  function expand(tree: ReactNode): ReactNode {
    if (Array.isArray(tree)) return tree.map(expand);
    if (!isValidElement<Props>(tree)) return tree;
    if (typeof tree.type === "function" && ![...stubs.values()].includes(tree.type as (props: Props) => null)) {
      return expand((tree.type as (props: Props) => ReactNode)(tree.props));
    }
    const children = tree.props.children as ReactNode;
    return Array.isArray(children) ? cloneElement(tree, {}, ...children.map(expand)) : cloneElement(tree, {}, expand(children));
  }
  const tabs = load("DashboardAccountTabs");
  return {
    copy, settingsCopy, selected, effects,
    panels: tabs.DASHBOARD_ACCOUNT_PANELS as string[],
    isAccountPanel: tabs.isDashboardAccountPanel as (panel: string | null | undefined) => boolean,
    tabs(panel = "factures") { return expand((tabs.default as (props: Props) => ReactNode)({ panel, onSelect: (next: string) => selected.push(next) })); },
    boutiqueTabs(panel = "boutique", view = "products") {
      return expand((load("DashboardBoutiqueTabs").default as (props: Props) => ReactNode)({ panel, view, onSelect: (next: string) => selected.push(next) }));
    },
    drawer(panel = "factures") {
      return expand((load("DashboardSettingsDrawerContent").default as (props: Props) => ReactNode)({
        panel, edition, inertiaSnapshot: {}, openPanel: (next: string) => selected.push(next),
        referralName: "", referralPhone: "", referralEmail: "", referralFrom: "", referralSubmitting: false,
        referralNotice: null, referralError: null,
      }));
    },
    stub,
  };
}

for (const locale of locales) {
  test(`the seven main account tabs keep their order and translated invoice entry in ${locale}`, () => {
    const h = harness(locale);
    assert.deepEqual(h.panels, panelOrder);
    assert.equal(h.isAccountPanel("factures"), true);
    assert.equal(h.isAccountPanel("documents"), false);
    assert.equal(h.isAccountPanel(null), false);
    const tree = h.tabs();
    const tabs = nodes(tree).filter((node) => node.props.role === "tab");
    assert.equal(tabs.length, 7);
    assert.deepEqual(tabs.map(content), panelOrder.map((panel) => h.copy.accountTabs[panel]));
    assert.equal(tabs[2].props.id, "dashboard-account-tab-factures");
    assert.equal(tabs[2].props["aria-selected"], true);
    assert.equal(tabs[2].props.tabIndex, 0);
    assert.equal(tabs[2].props["aria-controls"], "dashboard-account-tabpanel");
    assert.equal(tabs[3].props.id, "dashboard-account-tab-parrainage");
    (tabs[2].props.onClick as () => void)();
    assert.deepEqual(h.selected, [], "Clicking the selected tab does not navigate");
    (tabs[3].props.onClick as () => void)();
    assert.deepEqual(h.selected, ["parrainage"]);
    for (const label of [h.copy.accountTabs.factures, h.copy.drawer.titles.factures, h.copy.userMenu.invoices]) assert.ok(typeof label === "string" && label.trim());
  });

  test(`the compact mobile account selector exposes all seven translated destinations in ${locale}`, () => {
    const h = harness(locale);
    const selector = find(h.tabs("abonnement"), (node) => node.type === "select");
    const options = nodes(selector).filter((node) => node.type === "option");
    assert.deepEqual(options.map((option) => option.props.value), panelOrder);
    assert.deepEqual(options.map(content), panelOrder.map((panel) => h.copy.accountTabs[panel]));
    assert.equal(selector.props["aria-label"], h.copy.accountTabs.compte);
    assert.equal(selector.props["aria-controls"], "dashboard-account-tabpanel");
    assert.equal(selector.props.value, "abonnement");

    const change = selector.props.onChange as (event: { currentTarget: { value: string } }) => void;
    change({ currentTarget: { value: "abonnement" } });
    change({ currentTarget: { value: "unknown" } });
    assert.deepEqual(h.selected, [], "Current or unrecognized destinations do not navigate");
    change({ currentTarget: { value: "factures" } });
    assert.deepEqual(h.selected, ["factures"]);
    assert.equal(selector.props.value, "abonnement", "The routed panel stays authoritative while an exit guard is pending or cancelled");
    const acceptedSelector = find(h.tabs("factures"), (node) => node.type === "select");
    assert.equal(acceptedSelector.props.value, "factures", "Selection changes once the route change is accepted");
  });

  test(`the shared compact selector preserves Boutique, inertia and order navigation in ${locale}`, () => {
    const h = harness(locale);
    const tree = h.boutiqueTabs("boutique", "orders");
    const selectors = nodes(tree).filter((node) => node.type === "select");
    assert.equal(selectors.length, 1, "Only one compact selector is rendered");
    const selector = selectors[0];
    const options = nodes(selector).filter((node) => node.type === "option");
    assert.deepEqual(options.map((option) => option.props.value), ["boutique", "inertie", "orders"]);
    assert.deepEqual(options.map(content), [h.copy.userMenu.shop, h.copy.userMenu.inertia, h.settingsCopy.historique_des_commandes_3b9f0e3d]);
    assert.equal(selector.props["aria-label"], h.copy.userMenu.shop);
    assert.equal(selector.props["aria-controls"], "dashboard-boutique-tabpanel");
    assert.equal(selector.props.value, "orders");
    const desktopTabs = nodes(tree).filter((node) => node.props.role === "tab");
    assert.equal(desktopTabs.length, 3);
    assert.equal(desktopTabs[2].props.id, "dashboard-boutique-tab-orders");
    assert.equal(desktopTabs[2].props["aria-selected"], true);

    const change = selector.props.onChange as (event: { currentTarget: { value: string } }) => void;
    for (const value of ["orders", "unknown"]) change({ currentTarget: { value } });
    assert.deepEqual(h.selected, []);
    change({ currentTarget: { value: "inertie" } });
    assert.deepEqual(h.selected, ["inertie"]);
    assert.equal(selector.props.value, "orders", "Pending or cancelled navigation does not replace the routed view");
    assert.equal(find(h.boutiqueTabs("inertie"), (node) => node.type === "select").props.value, "inertie");
    assert.equal(find(h.boutiqueTabs(), (node) => node.type === "select").props.value, "boutique");
  });
}

test("keyboard navigation reaches invoices from Subscription and retains routed selection until approved", () => {
  const h = harness();
  const tree = h.tabs("abonnement");
  const tabs = nodes(tree).filter((node) => node.props.role === "tab");
  const focus: string[] = [];
  tabs.forEach((tab) => (tab.props.ref as (node: unknown) => void)({ focus: () => focus.push(String(tab.props.id)) }));
  let prevented = false;
  (tabs[1].props.onKeyDown as (event: unknown) => void)({ key: "ArrowRight", preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(focus, ["dashboard-account-tab-factures"]);
  assert.deepEqual(h.selected, ["factures"]);
  assert.equal(tabs[1].props["aria-selected"], true, "The existing unsaved guard owns the eventual route change");
  assert.equal(tabs[2].props["aria-selected"], false);
});

for (const edition of ["standard", "premium", "founder"] as const) {
  test(`the main invoice panel mounts once for ${edition} without mounting billing controls`, () => {
    const h = harness("fr-FR", edition);
    const tree = h.drawer();
    const panel = h.stub("../settings/_components/SubscriptionInvoicesPanel");
    assert.equal(nodes(tree).filter((node) => node.type === panel).length, 1);
    for (const path of ["AccountContent", "AbonnementContent", "StandardSubscriptionContent", "DocumentsSettingsContent"]) {
      assert.equal(nodes(tree).filter((node) => node.type === h.stub(`../settings/_components/${path}`)).length, 0);
    }
    assert.ok(find(tree, (node) => node.props["data-dashboard-settings-drawer-content"] === "true").props.className?.toString().includes("workspace"));
    assert.deepEqual(h.selected, []);
    assert.equal(isDashboardDestinationAllowedForEdition("/dashboard?panel=factures", edition), true);
    assert.equal(isDashboardDestinationAllowedForEdition("/dashboard/factures", edition), edition === "founder", "Client invoicing retains its separate financial permission");
  });
}

function findNode(root: ts.Node, predicate: (node: ts.Node) => boolean): ts.Node {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node) => { if (found) return; if (predicate(node)) found = node; else ts.forEachChild(node, visit); };
  visit(root);
  assert.ok(found, "Production navigation callback must exist");
  return found;
}
function callback(file: ts.SourceFile, name: string) {
  const declaration = findNode(file, (node) => ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) as ts.VariableDeclaration;
  assert.ok(declaration.initializer);
  return (ts.isCallExpression(declaration.initializer) ? declaration.initializer.arguments[0] : declaration.initializer).getText(file);
}
function evaluate(expression: string, globals: Record<string, unknown>): (...args: unknown[]) => unknown {
  const output = ts.transpileModule(`(${expression})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return vm.runInNewContext(output, globals);
}

for (const allowed of [false, true]) {
  test(`mobile account entry keeps invoices accessible through the account tabs and ${allowed ? "navigate after approval" : "preserve a rejected exit"}`, async () => {
    const file = ts.createSourceFile("ResponsiveBottomNav.tsx", read("app/dashboard/_components/ResponsiveBottomNav.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const accountButton = findNode(file, (node) => ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === "MobileMenuActionButton" && node.getText(file).includes('openDashboardPanel("compte")')) as ts.JsxSelfClosingElement;
    assert.ok(accountButton.getText(file).includes('isVisible("panel:compte")'));
    const attr = accountButton.attributes.properties.find((prop) => ts.isJsxAttribute(prop) && ts.isIdentifier(prop.name) && prop.name.text === "onClick") as ts.JsxAttribute;
    assert.ok(attr.initializer && ts.isJsxExpression(attr.initializer) && attr.initializer.expression);
    const click = attr.initializer.expression.getText(file);
    const history: string[] = [], begun: string[] = [], completed: string[] = [];
    const storage = new Map<string, string>();
    const pendingDestinationRef = { current: null };
    let pending: Promise<unknown> | undefined;
    const delayed = evaluate(callback(file, "runDelayedNavigation"), {
      beginAction: (key: string) => { begun.push(key); return true; }, pendingDestinationRef,
      requestNavigation: async (action: () => void) => { if (allowed) action(); return allowed; },
      completeAction: (key: string) => completed.push(key), console,
    });
    const open = evaluate(callback(file, "openDashboardPanel"), {
      destinationIsReached: () => false, closeMobileOverlays: () => assert.fail("Pending navigation must retain its overlay"),
      runDelayedNavigation: (...args: unknown[]) => { pending = delayed(...args) as Promise<unknown>; return pending; },
      sessionStorage: { setItem: (key: string, value: string) => storage.set(key, value) },
      router: { push: (href: string) => history.push(href) }, encodeURIComponent,
    });
    evaluate(click, { openDashboardPanel: open })();
    await pending;
    assert.deepEqual(begun, ["panel:compte"]);
    assert.deepEqual(history, allowed ? ["/dashboard?panel=compte"] : []);
    assert.deepEqual(completed, allowed ? [] : ["panel:compte"]);
    assert.equal(storage.get("inrcy_last_panel"), allowed ? "compte" : undefined);
  });
}

test("the invoice deep link is registered as a settings drawer with a translated title", () => {
  const file = ts.createSourceFile("dashboard.constants.ts", read("app/dashboard/dashboard.constants.ts"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = findNode(file, (node) => ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "DRAWER_TITLES") as ts.VariableDeclaration;
  assert.ok(declaration.initializer);
  const titles = evaluate(`() => (${declaration.initializer.getText(file)})`, {})() as Record<string, string>;
  assert.equal(titles.factures, "Factures d’abonnement");
  const built = ts.transpileModule(read("app/dashboard/dashboard.utils.ts"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const record = { exports: {} as { isDrawerPanel: (panel: string) => boolean; getDrawerTitle: (panel: string, copy: unknown) => string } };
  new Function("module", "exports", "require", built)(record, record.exports, (name: string) => {
    if (name.endsWith(".module.css")) return {};
    if (name === "./dashboard.constants") return { DRAWER_TITLES: titles, DRAWER_PANELS: new Set(Object.keys(titles)) };
    if (name === "@/i18n/dashboard") return {};
    assert.fail(`Unexpected drawer dependency ${name}`);
  });
  assert.equal(record.exports.isDrawerPanel("factures"), true);
  for (const locale of locales) {
    const copy = JSON.parse(read(`messages/${locale}/dashboard.json`));
    assert.equal(record.exports.getDrawerTitle("factures", copy), copy.drawer.titles.factures);
  }
});
