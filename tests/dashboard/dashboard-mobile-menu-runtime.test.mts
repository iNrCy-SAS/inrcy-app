import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { getDashboardMobileMenu } from "../../app/dashboard/_components/dashboardMobileMenuModel.ts";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const file = ts.createSourceFile("ResponsiveBottomNav.tsx", read("app/dashboard/_components/ResponsiveBottomNav.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate: (node: ts.Node) => boolean) {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node) => { if (found) return; if (predicate(node)) found = node; else ts.forEachChild(node, visit); };
  visit(file);
  assert.ok(found);
  return found;
}
function callback(name: string) {
  const node = find((node) => ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) as ts.VariableDeclaration;
  assert.ok(node.initializer);
  return (ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer).getText(file);
}
function evaluate(expression: string, globals: Record<string, unknown>) {
  return vm.runInNewContext(ts.transpileModule(`(${expression})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, globals);
}

test("the mobile menu presents current tools once, with Founder-only accounting", () => {
  const ids = (edition: "standard" | "premium" | "founder") => getDashboardMobileMenu(edition).flatMap((group) => group.tools.map((tool) => tool.id));
  assert.deepEqual(ids("standard"), ["publish", "studio", "media", "stats", "send"]);
  assert.deepEqual(ids("premium"), ["publish", "studio", "media", "ads", "campaigns", "stats", "send", "calendar", "crm"]);
  assert.deepEqual(ids("founder"), [...ids("premium"), "cash"]);
  for (const edition of ["standard", "premium", "founder"] as const) {
    const tools = getDashboardMobileMenu(edition).flatMap((group) => group.tools);
    assert.equal(new Set(tools.map((tool) => tool.href)).size, tools.length);
    for (const tool of tools) {
      assert.doesNotMatch(tool.href, /agent|channels|business_dna|panel=(?:abonnement|factures|parrainage|preferences|inertia)/);
      if (tool.iconSrc) assert.equal(existsSync(new URL(`../../public${tool.iconSrc}`, import.meta.url)), true, tool.iconSrc);
    }
  }
});

for (const locale of ["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"]) {
  test(`all mobile sections and tools are translated in ${locale}`, () => {
    const copy = JSON.parse(read(`messages/${locale}/dashboard.json`)).mobileMenu;
    const keys = ["space", "account", "establishments", "backToMenu", ...getDashboardMobileMenu("founder").flatMap((group) => [group.id, ...group.tools.map((tool) => tool.id)])];
    for (const key of keys) assert.ok(typeof copy[key] === "string" && copy[key].trim(), `${locale}: ${key}`);
  });
}

for (const allowed of [false, true]) {
  test(`every mobile tool ${allowed ? "navigates after" : "retains its editor when refusing"} the unsaved-change guard`, async () => {
    for (const tool of [...getDashboardMobileMenu("founder").flatMap((group) => group.tools), { id: "generator", href: "/dashboard?generator=1" }]) {
      const history: string[] = [], warmed: string[] = [], completed: string[] = [];
      const pendingDestinationRef = { current: null as null | { key: string } };
      let pending: Promise<unknown> | undefined;
      const resolve = evaluate(callback("resolveHrefDestination"), {});
      const expectedKey = tool.id === "publish" ? "modal:publish" : `route:${tool.href}`;
      const delayed = evaluate(callback("runDelayedNavigation"), {
        beginAction: () => true, pendingDestinationRef, completeAction: (key: string) => completed.push(key), console,
        requestNavigation: async (action: () => void) => { if (allowed) action(); return allowed; },
      });
      const navigate = evaluate(callback("navigate"), {
        resolveHrefDestination: resolve, destinationIsReached: () => false,
        closeMobileOverlays: () => assert.fail("Keep menu visible until navigation completes"),
        requestDashboardToolWarmup: (href: string) => warmed.push(href),
        runDelayedNavigation: (...args: unknown[]) => { pending = delayed(...args); return pending; },
        router: { push: (href: string) => history.push(href) },
      });
      navigate(tool.href);
      await pending;
      assert.deepEqual(history, allowed ? [tool.href] : [], tool.id);
      assert.deepEqual(warmed, [tool.href], tool.id);
      assert.deepEqual(completed, allowed ? [] : [expectedKey], tool.id);
      assert.equal(pendingDestinationRef.current?.key ?? null, allowed ? expectedKey : null, tool.id);
    }
  });
}

test("cash and campaign selectors complete only at their exact destination", () => {
  const declaration = find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "dashboardHrefIsActive") as ts.FunctionDeclaration;
  const isActive = evaluate(declaration.getText(file), { URL });
  for (const action of ["cash", "campaigns"]) {
    const destination = `/dashboard?action=${action}`;
    assert.equal(isActive(destination, "/dashboard", new URLSearchParams(`action=${action}`)), true);
    assert.equal(isActive(destination, "/dashboard", new URLSearchParams()), false);
    assert.equal(isActive(destination, "/dashboard", new URLSearchParams("action=publish")), false);
    assert.equal(isActive(destination, "/dashboard/mails", new URLSearchParams(`action=${action}`)), false);
  }
});

function callbackFrom(path: string, name: string) {
  const parsed = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found: ts.VariableDeclaration | undefined;
  const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) found = node; else ts.forEachChild(node, visit); };
  visit(parsed);
  assert.ok(found?.initializer);
  return (ts.isCallExpression(found.initializer) ? found.initializer.arguments[0] : found.initializer).getText(parsed);
}

test("the establishments back action closes only its panel and restores trigger focus", () => {
  const events: unknown[] = [];
  evaluate(callbackFrom("app/dashboard/_components/EstablishmentMenu.tsx", "closeToMenu"), {
    setOpen: (value: boolean) => events.push(value),
    triggerRef: { current: { focus: () => events.push("focus") } },
  })();
  assert.deepEqual(events, [false, "focus"]);
});

test("saving general preferences preserves the old shortcut data and saves only current settings", async () => {
  const shortcutKey = "inrcy_mobile_shortcuts_v1:auth:account";
  const storage = new Map([[shortcutKey, '["studio","crm"]']]);
  const tables: string[] = [], payloads: Record<string, unknown>[] = [], dirty: boolean[] = [];
  const form = { clientLanguage: "en", timezone: "Europe/London", dateFormat: "yyyy-MM-dd", currency: "GBP" };
  const baseline = { current: "old" };
  await evaluate(callbackFrom("app/dashboard/settings/_components/GeneralPreferencesContent.tsx", "save"), {
    form, STORAGE_KEY: "inrcy_general_preferences", TABLE: "business_profiles", savedPreferencesSignatureRef: baseline,
    localStorage: { setItem: (key: string, value: string) => storage.set(key, value) },
    createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "auth" } } }) }, from: (table: string) => { tables.push(table); return { upsert: async (payload: Record<string, unknown>) => { payloads.push(payload); return {}; } }; } }),
    resolveActiveBrowserUserId: () => "account", markClientLanguageCustom: () => {}, invalidateBoosterGenerationContextClient: async () => {},
    setSaving: () => {}, setSaved: () => {}, setError: (value: string) => assert.equal(value, ""),
    onUnsavedChange: (value: boolean) => dirty.push(value),
  })();
  assert.deepEqual(tables, ["business_profiles"]);
  assert.equal(payloads[0].user_id, "account");
  assert.equal(payloads[0].currency, "GBP");
  assert.equal(Object.hasOwn(payloads[0], "shortcuts"), false);
  assert.equal(storage.get(shortcutKey), '["studio","crm"]');
  assert.equal(baseline.current, JSON.stringify(form));
  assert.deepEqual(dirty, [false]);
});

test("resetting general preferences does not delete account-specific mobile shortcut history", () => {
  const removed: string[] = [];
  evaluate(callbackFrom("app/dashboard/settings/_components/GeneralPreferencesContent.tsx", "reset"), {
    initialForm: {}, readDefaultAppLanguage: () => "fr", setForm: () => {}, setSaved: () => {}, setError: () => {},
    STORAGE_KEY: "inrcy_general_preferences", CLIENT_LANGUAGE_CUSTOM_STORAGE_KEY: "inrcy_client_language_custom_v1",
    localStorage: { removeItem: (key: string) => removed.push(key) },
  })();
  assert.deepEqual(removed, ["inrcy_general_preferences", "inrcy_client_language_custom_v1"]);
});

test("the menu cannot start a second publication or publish naturally inside Ads", () => {
  const unavailable = callback("publicationUnavailable");
  for (const publishActive of [false, true]) {
    for (const adsWorkspaceActive of [false, true]) {
      assert.equal(evaluate(`() => (${unavailable})`, { option: { id: "publish" }, publishActive, adsWorkspaceActive })(), publishActive || adsWorkspaceActive);
      assert.equal(evaluate(`() => (${unavailable})`, { option: { id: "studio" }, publishActive, adsWorkspaceActive })(), false);
    }
  }
  const button = find((node) => ts.isJsxOpeningElement(node) && node.tagName.getText(file) === "button" && node.getText(file).includes("disabled={publicationUnavailable}"));
  assert.ok(button);
});

test("establishment switching still passes through the editor guard", async () => {
  const establishment = find((node) => ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === "EstablishmentMenu") as ts.JsxSelfClosingElement;
  const attr = establishment.attributes.properties.find((node) => ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === "beforeAccountSwitch") as ts.JsxAttribute;
  assert.ok(attr.initializer && ts.isJsxExpression(attr.initializer) && attr.initializer.expression);
  for (const allowed of [false, true]) {
    let switched = 0;
    const beforeSwitch = evaluate(attr.initializer.expression.getText(file), {
      requestNavigation: async (action: () => void) => { if (allowed) action(); return allowed; },
    });
    assert.equal(await beforeSwitch(() => switched++), allowed);
    assert.equal(switched, allowed ? 1 : 0);
  }
});
