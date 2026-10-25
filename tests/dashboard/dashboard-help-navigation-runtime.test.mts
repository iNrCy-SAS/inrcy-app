import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { isDashboardDestinationAllowedForEdition, type DashboardEdition } from "../../lib/dashboardEdition.ts";

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const parse = (file: string) => ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const client = parse("app/dashboard/DashboardClient.tsx");
const provider = parse("app/dashboard/_components/DashboardUnsavedNavigationProvider.tsx");

function findNode(root: ts.Node, predicate: (node: ts.Node) => boolean): ts.Node {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node) => { if (found) return; if (predicate(node)) found = node; else ts.forEachChild(node, visit); };
  visit(root);
  assert.ok(found, "Expected production navigation callback is missing");
  return found;
}
function callback(file: ts.SourceFile, name: string) {
  const node = findNode(file, (candidate) => ts.isVariableDeclaration(candidate) && ts.isIdentifier(candidate.name) && candidate.name.text === name) as ts.VariableDeclaration;
  assert.ok(node.initializer);
  return (ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer).getText(file);
}
function evaluate(expression: string, context: Record<string, unknown>): (...args: unknown[]) => unknown {
  return vm.runInNewContext(ts.transpileModule(`(${expression})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
}

/** Executes the actual dashboard callbacks and shared dirty-form guard. The
 * isolated router records destinations without touching a browser or API. */
function harness(options: { edition?: DashboardEdition; query?: string; agent?: boolean; meta?: boolean } = {}) {
  const state = { help: true, dirty: true, channels: false, generator: false, booster: null as string | null, session: 3 };
  const history: { action: string; href: string }[] = [];
  const prompts: Array<(allowed: boolean) => void> = [];
  const pending: Promise<boolean>[] = [];
  const searchParams = new URLSearchParams(options.query ?? "help=1&keep=1");
  const guard = { sequence: 1, shouldBlock: () => state.dirty, confirmExit: () => new Promise<boolean>((resolve) => prompts.push((allowed) => { if (allowed) state.dirty = false; resolve(allowed); })) };
  const request = evaluate(callback(provider, "requestNavigation"), { guardsRef: { current: new Map([["draft", guard]]) }, navigationPendingRef: { current: false }, console });
  const context: Record<string, unknown> = {
    URL, URLSearchParams,
    requestNavigation: (action: () => void) => { const navigation = request(action) as Promise<boolean>; pending.push(navigation); return navigation; },
    dashboardEdition: options.edition ?? "premium", canAccessInrAgent: options.agent ?? true, metaPilotEnabled: options.meta ?? true,
    isDashboardDestinationAllowedForEdition, searchParams,
    router: { push: (href: string) => history.push({ action: "push", href }), replace: (href: string) => history.push({ action: "replace", href }) },
    setHelpGeneratorOpen: (open: boolean) => { state.help = open; },
    setChannelConnectionsOpen: (open: boolean) => { state.channels = open; },
    setGeneratorSettingsOpen: (open: boolean) => { state.generator = open; },
    setDashboardBoosterModal: (modal: string | null) => { state.booster = modal; },
    setBoosterPublishSession: (update: (current: number) => number) => { state.session = update(state.session); },
    window: { location: { href: "" } },
  };
  for (const name of ["navigateDashboardCta", "openBoosterPublish", "openUsageGuide", "closeUsageGuide", "navigateUsageGuide"]) context[name] = evaluate(callback(client, name), context);
  return {
    state, prompts, pending, history, context,
    open: context.openUsageGuide as () => void,
    close: context.closeUsageGuide as () => void,
    navigate: context.navigateUsageGuide as (href: string) => void,
    async decide(allowed: boolean) { assert.equal(prompts.length, 1); prompts[0](allowed); await Promise.all(pending); },
  };
}

for (const allowed of [false, true]) {
  for (const helpAction of ["channels", "generator-settings"] as const) {
    test(`help ${helpAction} ${allowed ? "opens after approved exit" : "retains a refused dirty exit"}`, async () => {
      const h = harness({ query: "panel=preferences&action=publish&stats=1&help=1&keep=1" });
      h.navigate(`/dashboard?helpAction=${helpAction}`);
      assert.equal(h.state.help, true);
      assert.deepEqual(h.history, []);
      assert.equal(h.state.channels || h.state.generator, false);
      await h.decide(allowed);
      assert.equal(h.state.help, !allowed);
      assert.equal(h.state.channels, allowed && helpAction === "channels");
      assert.equal(h.state.generator, allowed && helpAction === "generator-settings");
      assert.deepEqual(h.history, allowed ? [{ action: "replace", href: "/dashboard?keep=1" }] : []);
      assert.equal(h.state.booster, null);
    });
  }
  test(`the help publication action ${allowed ? "retains the normal new-publication reset" : "does not reset a rejected publication"}`, async () => {
    const h = harness();
    h.navigate("/dashboard?action=publish");
    assert.equal(h.state.help, true);
    assert.equal(h.state.session, 3);
    await h.decide(allowed);
    assert.equal(h.state.help, !allowed);
    assert.equal(h.state.session, allowed ? 4 : 3);
    assert.equal(h.state.booster, allowed ? "publish" : null);
    assert.deepEqual(h.history, allowed ? [{ action: "replace", href: "/dashboard?action=publish" }] : []);
  });
  test(`a help link to Stats ${allowed ? "navigates once" : "keeps the guide and draft"}`, async () => {
    const h = harness();
    h.navigate("/dashboard/stats");
    await h.decide(allowed);
    assert.equal(h.state.help, !allowed);
    assert.deepEqual(h.history, allowed ? [{ action: "push", href: "/dashboard/stats" }] : []);
    assert.equal(h.state.booster, null);
    assert.equal(h.state.channels || h.state.generator, false);
  });
}

for (const href of ["/dashboard/ads", "/dashboard/crm", "/dashboard/agenda", "/dashboard/propulser", "/dashboard/fideliser", "/dashboard?panel=mails"]) {
  test(`Standard help preserves the existing permission gate for ${href}`, () => {
    const h = harness({ edition: "standard" });
    h.navigate(href);
    assert.deepEqual(h.history, []);
    assert.equal(h.prompts.length, 0);
    assert.equal(h.state.help, true);
  });
}
test("disabled agent access and the Threads pilot retain their independent gates", () => {
  for (const [options, href] of [[{ agent: false }, "/dashboard/agent/publications"], [{ meta: false }, "/dashboard?panel=threads"]] as const) {
    const h = harness(options);
    h.navigate(href);
    assert.deepEqual(h.history, []);
    assert.equal(h.prompts.length, 0);
    assert.equal(h.state.help, true);
  }
});
test("opening and closing help changes no channel, generator or publication state", () => {
  const h = harness({ query: "panel=preferences&help=1&keep=1" });
  h.state.help = false;
  h.open();
  assert.equal(h.state.help, true);
  h.close();
  assert.equal(h.state.help, false);
  assert.deepEqual(h.history, [{ action: "replace", href: "/dashboard?panel=preferences&keep=1" }]);
  assert.equal(h.state.dirty, true);
  assert.equal(h.prompts.length, 0);
  assert.equal(h.state.channels || h.state.generator, false);
  assert.equal(h.state.booster, null);
  const local = harness({ query: "keep=1" });
  local.close();
  assert.deepEqual(local.history, [], "Closing a locally opened help dialog must not initiate a route change");
});
test("the legacy GPS URL redirects to the shared help entry", () => {
  const built = ts.transpileModule(read("app/dashboard/gps/page.tsx"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const destinations: string[] = [];
  const record = { exports: {} as { default: () => void } };
  new Function("module", "exports", "require", built)(record, record.exports, (name: string) => {
    assert.equal(name, "next/navigation");
    return { redirect: (href: string) => { destinations.push(href); } };
  });
  record.exports.default();
  assert.deepEqual(destinations, ["/dashboard?help=1"]);
});
test("the mobile help action and completion key target the final URL, avoiding an endless redirect loader", () => {
  const file = parse("app/dashboard/_components/ResponsiveBottomNav.tsx");
  const navigation: string[] = [];
  const button = findNode(file, (node) => ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === "MobileMenuActionButton" && node.getText(file).includes('navigate("/dashboard?help=1")')) as ts.JsxSelfClosingElement;
  const attr = button.attributes.properties.find((node) => ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === "onClick") as ts.JsxAttribute;
  assert.ok(attr.initializer && ts.isJsxExpression(attr.initializer) && attr.initializer.expression);
  evaluate(attr.initializer.expression.getText(file), { navigate: (href: string) => navigation.push(href) })();
  assert.deepEqual(navigation, ["/dashboard?help=1"]);
  const destinationKey = evaluate(`() => (${callback(file, "helpActionKey")})`, { resolveHrefDestination: (href: string) => ({ key: `route:${href}` }) })();
  assert.equal(destinationKey, "route:/dashboard?help=1");
  const loading = button.attributes.properties.find((node) => ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === "loading") as ts.JsxAttribute;
  assert.ok(loading.initializer && ts.isJsxExpression(loading.initializer) && loading.initializer.expression);
  assert.equal(evaluate(`() => (${loading.initializer.expression.getText(file)})`, { helpActionKey: destinationKey, isVisible: (key: string) => key === destinationKey })(), true);
});
