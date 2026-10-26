import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as workspacePolicy from "../../lib/inrAgentWorkspaces.ts";
import * as editionPolicy from "../../lib/dashboardEdition.ts";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const require = createRequire(import.meta.url);
const dashboardMessages = JSON.parse(read("messages/fr-FR/dashboard.json"));
const shellMessages = JSON.parse(read("messages/fr-FR/shell.json"));
const localeMessages = new Map([["fr-FR", { dashboard: dashboardMessages, shell: shellMessages, agent: JSON.parse(read("messages/fr-FR/agent.json")) }]]);
function messagesFor(locale: string) {
  if (!localeMessages.has(locale)) localeMessages.set(locale, {
    dashboard: JSON.parse(read(`messages/${locale}/dashboard.json`)),
    shell: JSON.parse(read(`messages/${locale}/shell.json`)),
    agent: JSON.parse(read(`messages/${locale}/agent.json`)),
  });
  return localeMessages.get(locale)!;
}
const compiled = new Map<string, string>();
for (const file of ["DashboardModulesCard", "DashboardStandardModulesCard", "DashboardAgentLogoButton", "DashboardPremiumLockIcon", "DashboardToolArtwork", "StudioIcon", "BoosterIcon"]) {
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
  const buttons = elements(card(tree, cardName)).filter((node) => node.type === "button" && !node.props["data-agent-workspace"] && !node.props["data-agent-planning-workspace"]);
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
    if (specifier === "next/dynamic") return { __esModule: true, default: () => (props: Props) => createElement("div", { "data-agent-planning": "true", "data-standard-mode": props.standardMode, "data-workspace": props.workspace }) };
    if (specifier.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
    if (specifier === "./WorkflowBaseModal") return { __esModule: true, default: (props: Props) => createElement("div", { role: "dialog", "aria-label": props.title, onClose: props.onClose }, props.headerActions as ReactNode, ...(Array.isArray(props.children) ? props.children : [props.children]) as ReactNode[]) };
    if (specifier === "./AdsChannelInfoModal") return { __esModule: true, default: (props: Props) => createElement("div", { role: "dialog", "aria-label": "iNr’ADS", onClick: props.onClose }) };
    if (specifier === "../_hooks/useDashboardI18n") return { useDashboardI18n: () => ({ ...messages.dashboard, locale }) };
    if (specifier === "../_hooks/useInrAgentPendingCount") return { useInrAgentPendingCount: (enabled: boolean) => { calls.enabled.push(enabled); return enabled ? options.pendingCount ?? 0 : 0; } };
    if (specifier === "./DashboardToolWarmup") return { requestDashboardToolWarmup: (path: string) => { calls.warmups.push(path); } };
    if (specifier === "@/hooks/useDelayedPendingAction") return { useDelayedPendingAction: () => pending };
    if (specifier === "@/lib/inrAgentWorkspaces") return workspacePolicy;
    if (specifier === "@/lib/dashboardEdition") return editionPolicy;
    if (specifier === "./DashboardEditionProvider") return { useDashboardEdition: () => options.edition ?? "premium", useDashboardSubscriptionEdition: () => options.edition ?? "premium" };
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
  const expected = ["boosterCard", "statsCard", "sendCard", "studioCard", "reputationCard", "adsCard", "campaignCard", "calendarCard", "crmCard"];
  for (const variant of variants) {
    const { tree, html } = harness(variant).render();
    const cards = elements(tree).flatMap((node) => expected.filter((name) => hasClass(node, name)));
    assert.deepEqual(cards, expected);
    assert.equal(elements(tree).filter((node) => hasClass(node, "signatureGrid")).length, 2);
    const toolsGrid = find(tree, (node) => node.props["data-dashboard-relationship-tools"] === "true");
    assert.deepEqual(elements(toolsGrid).filter((node) => node.type === "article").map((node) => expected.find((name) => hasClass(node, name))), ["statsCard", "sendCard", "studioCard", "reputationCard"]);
    const premiumGrid = find(tree, (node) => node.props["data-dashboard-premium-tools"] === "true");
    assert.deepEqual(elements(premiumGrid).filter((node) => node.type === "article").map((node) => expected.find((name) => hasClass(node, name))), ["adsCard", "campaignCard", "calendarCard", "crmCard"]);
    assert.equal(elements(premiumGrid).filter((node) => hasClass(node, "boosterCard")).length, 0);
    assert.ok(html.includes(dashboardMessages.signatureTools.premiumTitle));
    assert.ok(html.includes(dashboardMessages.signatureTools.pilotTitle));
    assert.doesNotMatch(html, /undefined|standardActionStack|premiumDashboardList/);
  }
});

test("the shared dashboard preserves supplied cockpit and generator content and shows real overview metrics only inside Stats", () => {
  for (const variant of variants) {
    const view = harness({ ...variant, props: {
      cockpit: createElement("section", { "data-slot": "cockpit" }, "Cockpit conservé"),
      generator: createElement("section", { "data-slot": "generator" }, "Générateur conservé"),
      overview: { leadsWeek: 125, leadsMonth: 689, oppTotal: 286, estimatedValue: 5720 },
    } });
    const { tree } = view.render();
    const layout = card(tree, "lowerRow");
    const children = elements(layout).filter((node) => node.props["data-slot"] || hasClass(node, "boosterCard") || hasClass(node, "creationPanel") || hasClass(node, "pilotPanel"));
    assert.deepEqual(children.map((node) => node.props["data-slot"] ?? ["boosterCard", "creationPanel", "pilotPanel"].find((name) => hasClass(node, name))), ["cockpit", "boosterCard", "generator", "creationPanel", "pilotPanel"]);
    const overview = card(tree, "statsOverview");
    assert.ok(elements(card(tree, "statsCard")).includes(overview));
    assert.deepEqual(elements(overview).filter((node) => node.type === "dd").map(content), ["125", "689", "+286", `${(5720).toLocaleString("fr-FR")} €`]);
    assert.equal(elements(tree).filter((node) => hasClass(node, "statsOverview")).length, 1);

    const unavailable = harness({ ...variant, props: { overview: { leadsWeek: null, leadsMonth: null, oppTotal: null, estimatedValue: null } } }).render().tree;
    assert.deepEqual(elements(card(unavailable, "statsOverview")).filter((node) => node.type === "dd").map(content), ["—", "—", "—", "—"]);
  }
});

test("Stats settings reuse the supplied generator settings action without intercepting Stats or agent navigation", () => {
  for (const variant of variants) {
    const callbacks: string[] = [];
    const view = harness({ ...variant, props: {
      onOpenGeneratorSettings: () => { callbacks.push("settings"); },
      onOpenStats: () => { callbacks.push("stats"); },
    } });
    const tree = view.render().tree;
    const settings = find(card(tree, "statsCard"), (node) => node.props["data-testid"] === "dashboard-stats-settings");
    assert.equal(settings.props["aria-haspopup"], "dialog");
    click(settings);
    assert.deepEqual(callbacks, ["settings"]);
    assert.deepEqual(view.calls.routes, []);
    assert.deepEqual(view.calls.panels, []);
    assert.deepEqual(view.calls.warmups, []);
    assert.deepEqual(view.calls.begun, []);

    click(action(tree, "statsCard"));
    assert.deepEqual(callbacks, ["settings", "stats"]);
    assert.deepEqual(view.calls.warmups, ["/dashboard/stats"]);
    view.release();
    click(find(card(tree, "statsCard"), (node) => node.props["data-agent-workspace"] === "stats"));
    assert.deepEqual(view.calls.routes, [workspacePolicy.INR_AGENT_WORKSPACES.stats.href]);

    const withoutCallback = harness(variant).render().tree;
    assert.equal(elements(withoutCallback).filter((node) => node.props["data-testid"] === "dashboard-stats-settings").length, 0);
  }
});

test("the shared visual copy and Ads channel information are translated in all nine locales", () => {
  const keys = ["createTitle", "pilotTitle", "premiumTitle", "mailCampaigns", "mailCampaignDescription", "businessSpace", "amplify", "imagine", "automate", "adsDescription", "createCampaign", "comingSoon", "openStudio", "access", "manage", "open", "viewStats", "dnaDescription"].sort();
  const adsInfoKeys = ["open", "title", "close", "google", "pinterest", "openai", "meta", "linkedin", "tiktok", "x"].sort();
  for (const locale of ["fr-FR", "en-GB", "de-DE", "es-ES", "it-IT", "nl-NL", "pt-PT", "th-TH", "zh-CN"]) {
    const translated = messagesFor(locale).dashboard.signatureTools as Record<string, string | Record<string, string>>;
    assert.ok(translated, `${locale} signatureTools catalog`);
    assert.deepEqual(Object.keys(translated).sort(), [...keys, "adsInfo"].sort(), locale);
    for (const key of keys) assert.ok(typeof translated[key] === "string" && translated[key].trim(), `${locale}/${key}`);
    const adsInfo = translated.adsInfo as Record<string, string>;
    assert.deepEqual(Object.keys(adsInfo).sort(), adsInfoKeys, `${locale}/adsInfo`);
    for (const key of adsInfoKeys) assert.ok(adsInfo[key]?.trim(), `${locale}/adsInfo.${key}`);
    for (const variant of variants.slice(0, 2)) {
      const { tree } = harness({ ...variant, locale }).render();
      const rendered = content(tree);
      for (const key of ["premiumTitle", "pilotTitle", "mailCampaigns", "adsDescription"]) {
        const expected = translated[key];
        assert.ok(typeof expected === "string" && rendered.includes(expected), `${locale} rendered ${key}`);
      }
    }
  }
});

test("Ads information stays disabled in Standard and opens without navigation for Premium and Founder", () => {
  for (const variant of variants) {
    const view = harness(variant);
    const info = find(card(view.render().tree, "adsCard"), (node) => hasClass(node, "adsInfoButton"));
    assert.equal(info.props["aria-haspopup"], "dialog");
    if (variant.edition === "standard") {
      assert.equal(info.props.disabled, true);
      assert.deepEqual(view.calls.routes, []);
      continue;
    }
    click(info);
    const dialog = find(view.render().tree, (node) => node.props.role === "dialog" && node.props["aria-label"] === "iNr’ADS");
    assert.ok(dialog);
    assert.deepEqual(view.calls.routes, []);
    assert.deepEqual(view.calls.panels, []);
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

test("Standard Premium tools stay disabled and the section lock opens subscriptions without warming a forbidden route", () => {
  for (const name of ["calendarCard", "crmCard", "campaignCard"]) {
    const standard = harness(variants[0]);
    const button = action(standard.render().tree, name);
    assert.equal(button.props.disabled, true);
    assert.doesNotMatch(content(button), /Premium/);
    assert.equal(button.props["data-dashboard-prefetch"], undefined);
    assert.deepEqual(standard.calls.panels, [], name);
    assert.deepEqual(standard.calls.routes, [], name);
    assert.deepEqual(standard.calls.warmups, [], name);
    assert.equal(elements(standard.render().tree).some((node) => node.props.role === "dialog"), false);
  }
  const standard = harness(variants[0]);
  const tree = standard.render().tree;
  const calendarSettings = elements(card(tree, "calendarCard")).filter((node) => hasClass(node, "settingsButton"));
  assert.equal(calendarSettings.length, 1);
  assert.equal(calendarSettings[0].props.disabled, true);
  assert.equal(elements(card(tree, "crmCard")).filter((node) => hasClass(node, "settingsButton")).length, 0, "CRM must not gain a top settings lock");
  const unlock = find(tree, (node) => node.props["data-testid"] === "dashboard-premium-unlock");
  assert.equal(unlock.props["aria-label"], dashboardMessages.helpCenter.viewOffers);
  click(unlock);
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
      assert.equal(elements(tree).filter((node) => hasClass(node, "settingsButton")).length, 4, "Send, Calendar, Studio library and Ads information remain available");
      const settings = find(card(tree, name), (node) => hasClass(node, "settingsButton"));
      assert.match(renderToStaticMarkup(settings), /M12 15\.5a3\.5 3\.5/);
      assert.doesNotMatch(renderToStaticMarkup(settings), /M8 10V7a4 4 0 0 1 8 0v3/);
      click(settings);
      assert.deepEqual(unlocked.calls.panels, [panel]);
    }
    for (const path of ["/dashboard/propulser", "/dashboard/fideliser"]) {
      const campaigns = harness({ edition });
      click(action(campaigns.render().tree, "campaignCard"));
      const chooser = campaigns.render().tree;
      assert.ok(elements(chooser).some((node) => node.props.role === "dialog"));
      campaigns.release();
      const label = path.endsWith("propulser") ? dashboardMessages.modules.propulserTitle : dashboardMessages.modules.fideliserTitle;
      click(find(chooser, (node) => node.type === "button" && content(node).includes(label)));
      assert.deepEqual(campaigns.calls.routes, [path]);
    }
  }
});

test("the mobile campaign destination opens the chooser, preserves unrelated query values on close and follows back navigation", () => {
  for (const edition of ["premium", "founder"] as const) {
    const view = harness({ edition, query: "action=campaigns&help=1" });
    view.render();
    view.flushEffects();
    const dialog = find(view.render().tree, (node) => node.props.role === "dialog");
    assert.ok(content(dialog).includes(dashboardMessages.modules.propulserTitle));
    assert.ok(content(dialog).includes(dashboardMessages.modules.fideliserTitle));
    (dialog.props.onClose as () => void)();
    assert.deepEqual(view.calls.routes, ["/dashboard?help=1"]);
    assert.equal(elements(view.render().tree).some((node) => node.props.role === "dialog"), false);

    const back = harness({ edition, query: "action=campaigns" });
    back.render();
    back.flushEffects();
    assert.ok(elements(back.render().tree).some((node) => node.props.role === "dialog"));
    back.navigate("/dashboard");
    back.render();
    back.flushEffects();
    assert.equal(elements(back.render().tree).some((node) => node.props.role === "dialog"), false);
  }
  for (const options of [{ edition: "standard" as const }, { edition: "founder" as const, adapter: true }]) {
    const view = harness({ ...options, query: "action=campaigns" });
    view.render();
    view.flushEffects();
    assert.equal(elements(view.render().tree).some((node) => node.props.role === "dialog"), false);
    assert.deepEqual(view.calls.routes, []);
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

test("Studio, Agent and Reputation keep their existing accessible routes in every edition", () => {
  for (const variant of variants) {
    for (const [name, path] of [["studioCard", "/dashboard/generer-media"], ["reputationCard", "/dashboard/e-reputation"]]) {
      const view = harness(variant);
      click(action(view.render().tree, name));
      assert.deepEqual(view.calls.routes, [path]);
      assert.deepEqual(view.calls.warmups, [path]);
      assert.equal(editionPolicy.isStandardDashboardRouteAllowed(path), true);
    }
  }
});

test("the Studio library shortcut opens the existing media library without replacing Studio or bypassing the action guard", () => {
  for (const variant of variants) {
    const view = harness(variant);
    const tree = view.render().tree;
    const library = find(card(tree, "studioCard"), (node) => hasClass(node, "studioLibrary"));
    assert.equal(library.props["aria-label"], dashboardMessages.userMenu.media);
    assert.equal(library.props.title, dashboardMessages.userMenu.media);
    assert.equal(library.props["data-dashboard-prefetch"], "/dashboard/mediatheque");
    click(library);
    click(library);
    assert.deepEqual(view.calls.routes, ["/dashboard/mediatheque"]);
    assert.deepEqual(view.calls.warmups, ["/dashboard/mediatheque"]);
    assert.deepEqual(view.calls.panels, []);

    view.release();
    click(action(tree, "studioCard"));
    assert.deepEqual(view.calls.routes, ["/dashboard/mediatheque", "/dashboard/generer-media"]);
    assert.deepEqual(view.calls.warmups, ["/dashboard/mediatheque", "/dashboard/generer-media"]);

    const loading = harness({ ...variant, visibleKey: "route:/dashboard/mediatheque" }).render().tree;
    const busyLibrary = find(card(loading, "studioCard"), (node) => hasClass(node, "studioLibrary"));
    assert.equal(busyLibrary.props.disabled, true);
    assert.equal(busyLibrary.props["aria-busy"], true);
    assert.notEqual(action(loading, "studioCard").props.disabled, true);
  }
});

test("the three contextual agents open the correct workspace and preserve campaign access", () => {
  for (const variant of variants) {
    for (const [workspace, path] of Object.entries(workspacePolicy.INR_AGENT_WORKSPACES)) {
      const view = harness(variant);
      const logo = find(view.render().tree, (node) => node.props["data-agent-workspace"] === workspace);
      const locked = variant.edition === "standard" && workspace === "campaigns";
      if (locked) assert.equal(logo.props.disabled, true);
      else click(logo);
      assert.deepEqual(view.calls.routes, locked ? [] : [path.href]);
      assert.deepEqual(view.calls.panels, []);
      assert.deepEqual(view.calls.warmups, locked ? [] : [path.href]);
    }
  }
});

test("planning shortcuts open a scoped read-only plan and keep Standard campaign access locked", () => {
  for (const variant of variants) {
    for (const workspace of Object.keys(workspacePolicy.INR_AGENT_WORKSPACES)) {
      const view = harness(variant);
      const icon = find(view.render().tree, (node) => node.props["data-agent-planning-workspace"] === workspace);
      const locked = variant.edition === "standard" && workspace === "campaigns";
      if (locked) { assert.equal(icon.props.disabled, true); assert.deepEqual(view.calls.panels, []); }
      else {
        click(icon);
        const planning = find(view.render().tree, (node) => node.props["data-agent-planning"] === "true");
        assert.equal(planning.props["data-workspace"], workspace);
      }
      assert.deepEqual(view.calls.routes, []);
    }
  }
});

test("available Ads opens for Premium and Founder while Standard keeps its subscription and server gates", () => {
  for (const variant of variants) {
    const unavailable = harness(variant);
    const coming = action(unavailable.render().tree, "adsCard");
    assert.equal(coming.props.disabled, true);
    assert.equal(coming.props["data-dashboard-prefetch"], undefined);
    assert.match(content(coming), /À venir/);
    const available = harness({ ...variant, props: { adsPilotEnabled: true } });
    const button = action(available.render().tree, "adsCard");
    const standard = variant.edition === "standard";
    if (standard) assert.equal(button.props.disabled, true);
    else click(button);
    assert.deepEqual(available.calls.routes, standard ? [] : ["/dashboard/ads"]);
    assert.deepEqual(available.calls.panels, []);
    assert.equal(button.props["data-dashboard-prefetch"], standard ? undefined : "/dashboard/ads");
  }
  assert.equal(editionPolicy.isStandardDashboardRouteAllowed("/dashboard/ads"), false);
  assert.equal(editionPolicy.isStandardApiRouteAllowed("/api/ads/campaigns"), false);
});

test("the provider remains fail-closed when Standard is rendered directly or overrides a Founder preview", () => {
  for (const options of [{ edition: "standard" as const, props: { standardMode: false } }, { edition: "founder" as const, adapter: true }]) {
    const view = harness(options);
    const tree = view.render().tree;
    assert.equal(action(tree, "crmCard").props.disabled, true);
    click(find(tree, (node) => node.props["data-testid"] === "dashboard-premium-unlock"));
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

test("contextual icons remain distinct and disabled when account access is unavailable", () => {
  for (const variant of variants) {
    for (const enabled of [true, false]) {
      const view = harness({ ...variant, props: { inrAgentEnabled: enabled } });
      const tree = view.render().tree;
      const logos = elements(tree).filter((node) => node.props["data-testid"] === "dashboard-agent-logo");
      assert.equal(logos.length, 3);
      logos.forEach((logo) => assert.equal(logo.props.disabled, !enabled || variant.edition === "standard" && logo.props["data-agent-workspace"] === "campaigns"));
      const sources = elements(tree).filter((node) => node.type === "img" && String(node.props.src).startsWith("/agent/agent-")).map((node) => node.props.src);
      assert.equal(new Set(sources).size, 3);
      // A global count must not be repeated as the count of every specialist.
      assert.equal(elements(tree).filter((node) => node.props["data-testid"] === "dashboard-agent-pending-badge").length, 0);
      if (!enabled) assert.ok(logos.every((logo) => logo.props["data-dashboard-prefetch"] === undefined));
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

    const busy = harness({ ...variant, visibleKey: "route:/dashboard/agent/publications" });
    const busyTree = busy.render().tree;
    const busyAgent = find(busyTree, (node) => node.props["data-agent-workspace"] === "publications");
    assert.equal(busyAgent.props.disabled, true);
    assert.equal(busyAgent.props["aria-busy"], true);
  }
});
