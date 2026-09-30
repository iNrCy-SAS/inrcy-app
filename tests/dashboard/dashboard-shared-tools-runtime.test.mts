import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as editionPolicy from "../../lib/dashboardEdition.ts";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const require = createRequire(import.meta.url);
const dashboardMessages = JSON.parse(read("messages/fr-FR/dashboard.json"));
const shellMessages = JSON.parse(read("messages/fr-FR/shell.json"));
const localeMessages = new Map([["fr-FR", { dashboard: dashboardMessages, shell: shellMessages }]]);
function messagesFor(locale: string) {
  if (!localeMessages.has(locale)) localeMessages.set(locale, {
    dashboard: JSON.parse(read(`messages/${locale}/dashboard.json`)),
    shell: JSON.parse(read(`messages/${locale}/shell.json`)),
  });
  return localeMessages.get(locale)!;
}
const compiled = new Map<string, string>();
for (const file of ["DashboardModulesCard", "DashboardStandardModulesCard", "DashboardAgentLogoButton", "DashboardPremiumLockIcon"]) {
  compiled.set(file, ts.transpileModule(read(`app/dashboard/_components/${file}.tsx`), {
    fileName: `${file}.tsx`,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText);
}

type Props = Record<string, unknown>;
type Element = ReactElement<Props>;
type Effect = () => void | (() => void);
type HarnessOptions = {
  edition?: editionPolicy.DashboardEdition;
  adapter?: boolean;
  props?: Props;
  query?: string;
  pendingKey?: string | null;
  visibleKey?: string | null;
  pendingCount?: number;
  locale?: string;
};

function elements(tree: ReactNode): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!isValidElement<Props>(tree)) return [];
  return [tree, ...elements(tree.props.children as ReactNode)];
}

function content(tree: ReactNode): string {
  if (Array.isArray(tree)) return tree.map(content).join("");
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  return isValidElement<Props>(tree) ? content(tree.props.children as ReactNode) : "";
}

function find(tree: ReactNode, predicate: (node: Element) => boolean): Element {
  const found = elements(tree).find(predicate);
  assert.ok(found, "Expected rendered control is missing");
  return found;
}

function hasClass(node: Element, name: string): boolean {
  return String(node.props.className ?? "").split(/\s+/u).includes(name);
}

function card(tree: ReactNode, name: string): Element {
  return find(tree, (node) => hasClass(node, name));
}

function action(tree: ReactNode, cardName: string): Element {
  const buttons = elements(card(tree, cardName)).filter((node) => node.type === "button");
  assert.ok(buttons.length, `No action in ${cardName}`);
  return buttons[buttons.length - 1];
}

function click(node: Element) {
  assert.equal(node.type, "button");
  assert.notEqual(node.props.disabled, true, "A disabled control must not be clicked");
  assert.equal(typeof node.props.onClick, "function");
  (node.props.onClick as () => void)();
}

/** Execute the real TSX with isolated hooks/navigation, retain its actual React elements
 * and callbacks, then use React's server renderer to validate the resulting markup.
 * No DOM, real account, network request or runtime production dependency is touched. */
function harness(options: HarnessOptions = {}) {
  const locale = options.locale ?? "fr-FR";
  const messages = messagesFor(locale);
  const calls = { routes: [] as string[], panels: [] as string[], warmups: [] as string[], begun: [] as string[], completed: [] as string[], enabled: [] as boolean[], callbacks: [] as string[] };
  const states: unknown[] = [];
  const modules = new Map<string, { default?: (props: Props) => ReactNode; [key: string]: unknown }>();
  let stateIndex = 0;
  let idIndex = 0;
  let effects: Effect[] = [];
  let pendingKey = options.pendingKey ?? null;
  let visibleKey = options.visibleKey ?? null;
  let pathname = "/dashboard";
  let query = new URLSearchParams(options.query);
  const pending = {
    get pendingKey() { return pendingKey; },
    beginAction(key: string) {
      if (pendingKey) return false;
      pendingKey = key;
      calls.begun.push(key);
      return true;
    },
    completeAction(key: string) { calls.completed.push(key); if (pendingKey === key) pendingKey = null; },
    isVisible(key: string) { return visibleKey === key; },
  };
  const mockRequire = (specifier: string): unknown => {
    if (specifier === "react/jsx-runtime") return require(specifier);
    if (specifier === "react") return {
      useId: () => `tools-test-${idIndex++}`,
      useState(initial: unknown) {
        const index = stateIndex++;
        if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
        return [states[index], (next: unknown) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
      },
      useEffect: (effect: Effect) => { effects.push(effect); },
    };
    if (specifier === "next-intl") return { useTranslations: (namespace: string) => (key: string) => {
      const value: unknown = `${namespace}.${key}`.split(".").reduce<unknown>((current, segment) => current && typeof current === "object" ? (current as Props)[segment] : undefined, messages);
      assert.equal(typeof value, "string", `Missing translation ${locale}/${namespace}.${key}`);
      return value;
    } };
    if (specifier === "next/navigation") return {
      usePathname: () => pathname, useSearchParams: () => query,
      useRouter: () => ({ replace: (path: string) => { calls.routes.push(path); } }),
    };
    if (specifier === "next/image") return { __esModule: true, default: ({ src, alt, width, height, className }: Props) => createElement("img", { src, alt, width, height, className }) };
    if (specifier === "next/dynamic") return { __esModule: true, default: () => (props: Props) => createElement("div", { "data-agent-planning": "true", "data-standard-mode": props.standardMode }) };
    if (specifier.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
    if (specifier === "./WorkflowBaseModal") return { __esModule: true, default: (props: Props) => createElement("div", { role: "dialog", "aria-label": props.title }, props.headerActions as ReactNode, ...(Array.isArray(props.children) ? props.children : [props.children]) as ReactNode[]) };
    if (specifier === "../_hooks/useDashboardI18n") return { useDashboardI18n: () => ({ ...messages.dashboard, locale }) };
    if (specifier === "../_hooks/useInrAgentPendingCount") return { useInrAgentPendingCount: (enabled: boolean) => { calls.enabled.push(enabled); return enabled ? options.pendingCount ?? 0 : 0; } };
    if (specifier === "./DashboardToolWarmup") return { requestDashboardToolWarmup: (path: string) => { calls.warmups.push(path); } };
    if (specifier === "@/hooks/useDelayedPendingAction") return { useDelayedPendingAction: () => pending };
    if (specifier === "@/lib/dashboardEdition") return editionPolicy;
    if (specifier === "./DashboardEditionProvider") return { useDashboardEdition: () => options.edition ?? "premium" };
    if (specifier === "../dashboard.scroll") return { DASHBOARD_GEARBOX_ANCHOR_ID: "dashboard-gearbox" };
    const localName = specifier.replace(/^\.\//u, "");
    assert.ok(compiled.has(localName), `Unexpected dashboard dependency: ${specifier}`);
    return load(localName);
  };
  function load(name: string) {
    if (modules.has(name)) return modules.get(name)!;
    const record = { exports: {} as { default?: (props: Props) => ReactNode; [key: string]: unknown } };
    modules.set(name, record.exports);
    new Function("module", "exports", "require", compiled.get(name)!)(record, record.exports, mockRequire);
    return record.exports;
  }
  function expand(tree: ReactNode): ReactNode {
    if (Array.isArray(tree)) return tree.map(expand);
    if (!isValidElement<Props>(tree)) return tree;
    if (typeof tree.type === "function") return expand((tree.type as (props: Props) => ReactNode)(tree.props));
    const children = tree.props.children as ReactNode;
    // Keep static JSX siblings as separate arguments; replacing them with a new
    // dynamic array would manufacture React key warnings absent in the component.
    return Array.isArray(children)
      ? cloneElement(tree, {}, ...children.map(expand))
      : cloneElement(tree, {}, expand(children));
  }
  const component = load(options.adapter ? "DashboardStandardModulesCard" : "DashboardModulesCard").default!;
  return {
    calls,
    render() {
      stateIndex = 0;
      idIndex = 0;
      effects = [];
      const tree = expand(component({
        goToModule: (path: string) => { calls.routes.push(path); },
        openPanel: (panel: string) => { calls.panels.push(panel); },
        onOpenPremium: () => { calls.panels.push("abonnement"); },
        ...options.props,
      }));
      const html = renderToStaticMarkup(tree);
      return { tree, html };
    },
    flushEffects() { effects.forEach((effect) => effect()); },
    release() { pendingKey = null; visibleKey = null; },
    navigate(path: string, search = "") { pathname = path; query = new URLSearchParams(search); },
  };
}

const variants = [{ adapter: true, edition: "standard" as const }, { edition: "premium" as const }, { edition: "founder" as const }];

test("Standard, Premium and Founder render the same signature cards, hierarchy and shared CSS", () => {
  const expected = ["boosterCard", "adsCard", "studioCard", "agentCard", "dnaCard", "sendCard", "statsCard", "calendarCard", "crmCard", "reputationCard", "mailCampaignCard"];
  for (const variant of variants) {
    const { tree, html } = harness(variant).render();
    const cards = elements(tree).flatMap((node) => expected.filter((name) => hasClass(node, name)));
    assert.deepEqual(cards, expected);
    assert.equal(elements(tree).filter((node) => hasClass(node, "signatureGrid")).length, 1);
    assert.equal(elements(tree).filter((node) => hasClass(node, "relationshipGrid")).length, 1);
    assert.match(html, /Créer &amp; amplifier/);
    assert.match(html, /Piloter &amp; développer/);
    assert.doesNotMatch(html, /undefined|standardActionStack|premiumDashboardList/);
  }
});

test("the shared visual copy has the same sixteen translated keys in all nine locales", () => {
  const keys = ["createTitle", "pilotTitle", "mailCampaigns", "businessSpace", "amplify", "imagine", "automate", "adsDescription", "createCampaign", "comingSoon", "openStudio", "access", "manage", "open", "viewStats", "dnaDescription"].sort();
  for (const locale of ["fr-FR", "en-GB", "de-DE", "es-ES", "it-IT", "nl-NL", "pt-PT", "th-TH", "zh-CN"]) {
    const translated = messagesFor(locale).dashboard.signatureTools as Record<string, string>;
    assert.ok(translated, `${locale} signatureTools catalog`);
    assert.deepEqual(Object.keys(translated).sort(), keys, locale);
    for (const key of keys) assert.ok(typeof translated[key] === "string" && translated[key].trim(), `${locale}/${key}`);
    for (const variant of variants.slice(0, 2)) {
      const { tree } = harness({ ...variant, locale }).render();
      const rendered = content(tree);
      for (const key of ["createTitle", "pilotTitle", "mailCampaigns", "dnaDescription", "adsDescription"]) assert.ok(rendered.includes(translated[key]), `${locale} rendered ${key}`);
    }
  }
});

test("Standard Send opens publication history only without any settings control or Premium lock", () => {
  for (const variant of [variants[0], { edition: "standard" as const, props: { standardMode: false } }]) {
    const standard = harness(variant);
    const tree = standard.render().tree;
    const sendCard = card(tree, "sendCard");
    assert.equal(elements(sendCard).filter((node) => hasClass(node, "settingsButton")).length, 0);
    assert.equal(elements(sendCard).filter((node) => node.type === "button").length, 1);
    assert.doesNotMatch(renderToStaticMarkup(sendCard), /settingsButton|Premium|M8 10V7a4 4 0 0 1 8 0v3/);
    const send = action(tree, "sendCard");
    const path = "/dashboard/mails?folder=publications&boxView=sent";
    assert.equal(send.props["data-dashboard-prefetch"], path);
    click(send);
    assert.deepEqual(standard.calls.routes, [path]);
    assert.deepEqual(standard.calls.warmups, [path]);
    assert.deepEqual(standard.calls.panels, []);
  }
});

test("Standard Calendar, CRM and email campaigns stay visible and locked without warming a forbidden route", () => {
  for (const name of ["calendarCard", "crmCard", "mailCampaignCard"]) {
    const standard = harness(variants[0]);
    const button = action(standard.render().tree, name);
    assert.match(content(button), /Premium/);
    assert.equal(button.props["data-dashboard-prefetch"], undefined);
    click(button);
    assert.deepEqual(standard.calls.panels, ["abonnement"], name);
    assert.deepEqual(standard.calls.routes, [], name);
    assert.deepEqual(standard.calls.warmups, [], name);
    assert.equal(elements(standard.render().tree).some((node) => node.props.role === "dialog"), false);
  }
  const standard = harness(variants[0]);
  const tree = standard.render().tree;
  const calendarSettings = elements(card(tree, "calendarCard")).filter((node) => hasClass(node, "settingsButton"));
  assert.equal(calendarSettings.length, 1);
  assert.match(String(calendarSettings[0].props["aria-label"]), /Premium/);
  assert.match(renderToStaticMarkup(calendarSettings[0]), /M8 10V7a4 4 0 0 1 8 0v3/);
  assert.equal(elements(card(tree, "crmCard")).filter((node) => hasClass(node, "settingsButton")).length, 0, "CRM must not gain a top settings lock");
  click(calendarSettings[0]);
  assert.deepEqual(standard.calls.panels, ["abonnement"]);
});

test("Premium and Founder retain direct tool routes, settings panels and the real campaign chooser", () => {
  for (const edition of ["premium", "founder"] as const) {
    for (const [name, path] of [["sendCard", "/dashboard/mails"], ["calendarCard", "/dashboard/agenda"], ["crmCard", "/dashboard/crm"]]) {
      const unlocked = harness({ edition });
      click(action(unlocked.render().tree, name));
      assert.deepEqual(unlocked.calls.routes, [path]);
      assert.deepEqual(unlocked.calls.warmups, [path]);
    }
    for (const [name, panel] of [["sendCard", "mails"], ["calendarCard", "agenda"]]) {
      const unlocked = harness({ edition });
      const tree = unlocked.render().tree;
      assert.equal(elements(tree).filter((node) => hasClass(node, "settingsButton")).length, 2);
      const settings = find(card(tree, name), (node) => hasClass(node, "settingsButton"));
      assert.match(renderToStaticMarkup(settings), /M12 15\.5a3\.5 3\.5/);
      assert.doesNotMatch(renderToStaticMarkup(settings), /M8 10V7a4 4 0 0 1 8 0v3/);
      click(settings);
      assert.deepEqual(unlocked.calls.panels, [panel]);
    }
    for (const path of ["/dashboard/propulser", "/dashboard/fideliser"]) {
      const campaigns = harness({ edition });
      click(action(campaigns.render().tree, "mailCampaignCard"));
      const chooser = campaigns.render().tree;
      assert.ok(elements(chooser).some((node) => node.props.role === "dialog"));
      campaigns.release();
      const label = path.endsWith("propulser") ? dashboardMessages.modules.propulserTitle : dashboardMessages.modules.fideliserTitle;
      click(find(chooser, (node) => node.type === "button" && content(node).includes(label)));
      assert.deepEqual(campaigns.calls.routes, [path]);
    }
  }
});

test("both editions preserve Booster publish, distinct Bilan and Stats callbacks plus their route fallbacks", () => {
  for (const variant of variants) {
    for (const [name, callbackName, fallback] of [
      ["publish", "onOpenBoosterPublish", "/dashboard?action=publish"],
      ["bilan", "onOpenBoosterStats", "/dashboard?stats=1"],
      ["stats", "onOpenStats", "/dashboard/stats"],
    ]) {
      for (const useCallback of [false, true]) {
        let count = 0;
        const view = harness({ ...variant, props: useCallback ? { [callbackName]: () => { count += 1; } } : {} });
        const tree = view.render().tree;
        const button = name === "bilan" ? find(tree, (node) => hasClass(node, "boosterStats")) : name === "publish" ? find(tree, (node) => String(node.props["data-testid"]).endsWith("booster-publish")) : action(tree, "statsCard");
        click(button);
        assert.equal(count, useCallback ? 1 : 0);
        assert.deepEqual(view.calls.routes, useCallback ? [] : [fallback]);
      }
    }
  }
});

test("ADN, Studio, Agent and Reputation keep their existing accessible routes in every edition", () => {
  for (const variant of variants) {
    for (const [name, path] of [["dnaCard", "/dashboard/adn-entreprise"], ["studioCard", "/dashboard/generer-media"], ["agentCard", "/dashboard/agent"], ["reputationCard", "/dashboard/e-reputation"]]) {
      const view = harness(variant);
      click(action(view.render().tree, name));
      assert.deepEqual(view.calls.routes, [path]);
      assert.deepEqual(view.calls.warmups, [path]);
      assert.equal(editionPolicy.isStandardDashboardRouteAllowed(path), true);
    }
  }
});

test("Agent planning receives the real edition, keeping campaign automation hidden for Standard", () => {
  for (const variant of variants) {
    const view = harness(variant);
    click(find(view.render().tree, (node) => hasClass(node, "planningButton")));
    const planning = find(view.render().tree, (node) => node.props["data-agent-planning"] === "true");
    assert.equal(planning.props["data-standard-mode"], variant.edition === "standard");
    assert.deepEqual(view.calls.routes, []);
  }
});

test("Ads keeps the independent administrator pilot gate and does not grant Standard server rights", () => {
  for (const variant of variants) {
    const unavailable = harness(variant);
    const coming = action(unavailable.render().tree, "adsCard");
    assert.equal(coming.props.disabled, true);
    assert.equal(coming.props.onClick, undefined);
    assert.equal(coming.props["data-dashboard-prefetch"], undefined);
    assert.match(content(coming), /À venir/);
    const pilot = harness({ ...variant, props: { adsPilotEnabled: true } });
    click(action(pilot.render().tree, "adsCard"));
    assert.deepEqual(pilot.calls.routes, ["/dashboard/ads"]);
  }
  assert.equal(editionPolicy.isStandardDashboardRouteAllowed("/dashboard/ads"), false);
  assert.equal(editionPolicy.isStandardApiRouteAllowed("/api/ads/campaigns"), false);
});

test("the provider remains fail-closed when Standard is rendered directly or overrides a Founder preview", () => {
  for (const options of [{ edition: "standard" as const, props: { standardMode: false } }, { edition: "founder" as const, adapter: true }]) {
    const view = harness(options);
    click(action(view.render().tree, "crmCard"));
    assert.deepEqual(view.calls.panels, ["abonnement"]);
    assert.deepEqual(view.calls.routes, []);
  }
  for (const variant of [...variants, { edition: "founder" as const, adapter: true }]) {
    const cash = harness({ ...variant, query: "action=cash" });
    cash.render();
    cash.flushEffects();
    const hasCash = elements(cash.render().tree).some((node) => node.props.role === "dialog");
    assert.equal(hasCash, variant.edition === "founder" && !variant.adapter);
  }
});

test("shared Agent logo uses the real counter input, caps its badge and obeys account availability", () => {
  for (const variant of variants) {
    for (const [enabled, pendingCount, label] of [[true, 0, null], [true, 3, "3"], [true, 120, "99+"], [false, 120, null]] as const) {
      const view = harness({ ...variant, pendingCount, props: { inrAgentEnabled: enabled } });
      const tree = view.render().tree;
      const logo = find(tree, (node) => node.props["data-testid"] === "dashboard-agent-logo");
      const badge = elements(tree).find((node) => node.props["data-testid"] === "dashboard-agent-pending-badge");
      assert.equal(badge ? content(badge) : null, label);
      assert.equal(logo.props.disabled, !enabled);
      assert.deepEqual(view.calls.enabled, [enabled]);
      if (enabled) {
        click(logo);
        assert.deepEqual(view.calls.routes, ["/dashboard/agent"]);
      } else assert.equal(logo.props["data-dashboard-prefetch"], undefined);
    }
  }
});

test("the shared delayed action guard blocks repeat clicks and preserves Standard publish panel completion", () => {
  for (const variant of variants) {
    const view = harness(variant);
    const button = action(view.render().tree, "studioCard");
    click(button);
    click(button);
    assert.deepEqual(view.calls.routes, ["/dashboard/generer-media"]);
    assert.deepEqual(view.calls.begun, ["route:/dashboard/generer-media"]);
    view.navigate("/dashboard/generer-media");
    view.render();
    view.flushEffects();
    assert.deepEqual(view.calls.completed, ["route:/dashboard/generer-media"]);

    const publish = harness({ ...variant, pendingKey: "modal:publish", query: "panel=abonnement" });
    publish.render();
    publish.flushEffects();
    assert.deepEqual(publish.calls.completed, variant.edition === "standard" ? ["modal:publish"] : []);

    const busy = harness({ ...variant, visibleKey: "route:/dashboard/agent" });
    const busyTree = busy.render().tree;
    assert.equal(action(busyTree, "agentCard").props.disabled, true);
    assert.equal(find(busyTree, (node) => node.props["data-testid"] === "dashboard-agent-logo").props["aria-busy"], true);
  }
});
