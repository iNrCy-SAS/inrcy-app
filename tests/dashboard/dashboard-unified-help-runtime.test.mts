import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import type { ReactElement, ReactNode } from "react";
import type { DashboardEdition } from "../../lib/dashboardEdition.ts";
import type { GpsArticleSource } from "../../app/dashboard/gps/noticeContent.ts";

const root = process.cwd();
const require = createRequire(join(root, "package.json"));
const React = require("react") as typeof import("react");
const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");
const ts = require("typescript") as typeof import("typescript");
const jsxRuntime = require("react/jsx-runtime");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");
const messages = {
  dashboard: JSON.parse(read("messages/fr-FR/dashboard.json")),
  gps: JSON.parse(read("messages/fr-FR/gps.json")),
  shell: JSON.parse(read("messages/fr-FR/shell.json")),
};
if (process.env.DASHBOARD_HELP_TRANSLATIONS_SOURCE) {
  messages.dashboard.helpCenter = JSON.parse(readFileSync(process.env.DASHBOARD_HELP_TRANSLATIONS_SOURCE, "utf8"))["fr-FR"];
}
assert.ok(messages.dashboard.helpCenter, "The integrated help catalogue is required");

function translator(namespace: string, catalog = messages) {
  const dictionary = namespace.split(".").reduce<unknown>((value, key) => (value as Record<string, unknown>)[key], catalog);
  const raw = (key: string) => key.split(".").reduce<unknown>((value, part) => (value as Record<string, unknown>)[part], dictionary);
  const translate = (key: string, values: Record<string, string | number> = {}) => {
    const value: unknown = raw(key);
    assert.equal(typeof value, "string", `Translated text is missing: ${namespace}.${key}`);
    return String(value).replace(/\{(\w+)\}/g, (_match, name: string) => String(values[name] ?? `{${name}}`));
  };
  return Object.assign(translate, { raw });
}

const sourceOverrides = new Map<string, string>();
for (const [file, source] of [
  ["app/dashboard/_components/DashboardUsageGuide.tsx", process.env.DASHBOARD_HELP_GUIDE_SOURCE],
  ["app/dashboard/_components/dashboardUsageGuideModel.ts", process.env.DASHBOARD_HELP_MODEL_SOURCE],
]) if (source) sourceOverrides.set(resolve(root, file!), readFileSync(source, "utf8"));

type Props = Record<string, unknown>;
type Element = ReactElement<Props>;
const css = new Proxy({}, { get: (_target, name) => name });
const sourceCache = new Map<string, Record<string, unknown>>();
function loadActual(file: string): Record<string, unknown> {
  if (sourceCache.has(file)) return sourceCache.get(file)!;
  const loadedModule = { exports: {} as Record<string, unknown> };
  sourceCache.set(file, loadedModule.exports);
  const output = ts.transpileModule(sourceOverrides.get(file) ?? readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", "process", output)((specifier: string) => {
    const base = specifier.startsWith("@/") ? resolve(root, specifier.slice(2)) : resolve(dirname(file), specifier);
    const dependency = [base, `${base}.ts`, `${base}.tsx`].find(candidate => sourceOverrides.has(candidate) || existsSync(candidate));
    assert.ok(dependency, `Dependency must resolve: ${specifier}`);
    return loadActual(dependency);
  }, loadedModule, loadedModule.exports, process);
  return loadedModule.exports;
}
const model = loadActual(resolve(root, "app/dashboard/_components/dashboardUsageGuideModel.ts")) as {
  getHelpArticles: (edition: DashboardEdition, pilot?: boolean) => { sectionId: string; article: GpsArticleSource }[];
};

function elements(tree: ReactNode): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return React.isValidElement<Props>(tree) ? [tree, ...elements(tree.props.children as ReactNode)] : [];
}
function text(tree: ReactNode): string {
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  if (!React.isValidElement<Props>(tree)) return "";
  if (typeof tree.type === "function") return text((tree.type as (props: Props) => ReactNode)(tree.props));
  return text(tree.props.children as ReactNode);
}
function find(tree: ReactNode, predicate: (node: Element) => boolean): Element {
  const result = elements(tree).find(predicate);
  assert.ok(result, "Expected rendered control is missing");
  return result;
}
function hasClass(node: Element, name: string) { return String(node.props.className ?? "").split(/\s+/).includes(name); }
function section(tree: ReactNode, name: string) { return find(tree, node => hasClass(node, name)); }
function button(tree: ReactNode, label: string) { return find(tree, node => node.type === "button" && text(node).includes(label)); }
function click(node: Element) {
  assert.equal(node.type, "button");
  assert.notEqual(node.props.disabled, true);
  (node.props.onClick as () => void)();
}
function change(node: Element, value: string) { (node.props.onChange as (event: unknown) => void)({ target: { value } }); }

function compileComponent(name: string, dependencies: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const file = resolve(root, `app/dashboard/_components/${name}.tsx`);
  const output = ts.transpileModule(sourceOverrides.get(file) ?? readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const loadedModule = { exports: {} as { default?: (props: Props) => ReactNode } };
  new Function("require", "module", "exports", ...Object.keys(globals), output)((specifier: string) => {
    if (specifier in dependencies) return dependencies[specifier];
    if (specifier === "react/jsx-runtime") return jsxRuntime;
    if (specifier === "./DashboardAssistantTrigger") return { __esModule: true, default: () => null };
    if (specifier === "next-intl") return { useTranslations: translator };
    if (specifier.endsWith(".module.css")) return { __esModule: true, default: css };
    if (specifier === "@/lib/dashboardEdition") return loadActual(resolve(root, "lib/dashboardEdition.ts"));
    if (specifier === "./dashboardUsageGuideModel") return model;
    throw new Error(`Unexpected runtime dependency: ${specifier}`);
  }, loadedModule, loadedModule.exports, ...Object.values(globals));
  return loadedModule.exports.default!;
}

function guideHarness(edition: DashboardEdition = "standard", inrAgentEnabled = true, faq?: { articleId: string; q: GpsArticleSource["title"]; a: GpsArticleSource["intro"] }, locale = "fr-FR") {
  const routes: string[] = [];
  const focused: unknown[] = [];
  const pendingFrames: (() => void)[] = [];
  const state: unknown[] = [];
  let index = 0;
  const headingRef = { current: { focus: (options: unknown) => focused.push(options) } };
  const dictionary = locale === "fr-FR" ? messages : {
    dashboard: JSON.parse(read(`messages/${locale}/dashboard.json`)),
    gps: JSON.parse(read(`messages/${locale}/gps.json`)),
    shell: JSON.parse(read(`messages/${locale}/shell.json`)),
  };
  const Guide = compileComponent("DashboardUsageGuide", {
    "next-intl": { useTranslations: (namespace: string) => translator(namespace, dictionary) },
    react: {
      ...React,
      useId: () => "help-test",
      useRef: () => headingRef,
      useMemo: (callback: () => unknown) => callback(),
      useState: (initial: unknown) => {
        const slot = index++;
        if (!(slot in state)) state[slot] = initial;
        return [state[slot], (next: unknown) => { state[slot] = typeof next === "function" ? next(state[slot]) : next; }];
      },
    },
    "next/image": { __esModule: true, default: (props: Props) => React.createElement("img", props) },
    "./DashboardToolArtwork": { __esModule: true, default: () => React.createElement("svg", { "aria-hidden": true }) },
    "./DashboardMobileSelect": { __esModule: true, default: compileComponent("DashboardMobileSelect", {}) },
    ...(faq ? { "./dashboardUsageGuideModel": { ...model, getHelpArticles: (nextEdition: DashboardEdition, pilot: boolean) =>
      model.getHelpArticles(nextEdition, pilot).map(item => item.article.id === faq.articleId
        ? { ...item, article: { ...item.article, faq: [{ q: faq.q, a: faq.a }] } } : item) } } : {}),
  }, { requestAnimationFrame: (callback: () => void) => pendingFrames.push(callback) });
  const props = {
    edition, metaPilotEnabled: false, inrAgentEnabled,
    progress: { channels: 35.4, dna: 100, ai: 82, connected: 4, total: 13, uiBalance: 2425, isActive: true },
    onNavigate: (href: string) => routes.push(href),
  };
  const render = () => { index = 0; return Guide(props); };
  const flushFocus = () => { pendingFrames.splice(0).forEach(callback => callback()); };
  return { props, routes, focused, dictionary, render, flushFocus };
}

const goals = ["publish", "media", "grow", "reviews", "contacts", "stats"] as const;
function themeLabels(h: ReturnType<typeof guideHarness>) {
  const copy = h.dictionary.dashboard.helpCenter;
  return [copy.setupTitle, ...["channels", "dna", "ai"].map(key => copy[key].title), ...goals.map(key => copy.goals[key].title), copy.landmarksTitle] as string[];
}
function selectTheme(h: ReturnType<typeof guideHarness>, label: string) {
  click(button(section(h.render(), "sidebar"), label));
  const tree = h.render();
  assert.equal(text(find(section(tree, "main"), node => node.type === "h2")), label);
  return tree;
}
function currentInput(h: ReturnType<typeof guideHarness>) { return find(section(h.render(), "sidebar"), node => node.type === "input"); }
function currentMobileSelect(h: ReturnType<typeof guideHarness>) {
  const component = find(section(h.render(), "sidebar"), node => node.props.controls === "help-test-sheet");
  return find((component.type as (props: Props) => ReactNode)(component.props), node => node.type === "select");
}

test("the mobile theme selector opens the same sheet and actions, retaining context during search", () => {
  const h = guideHarness();
  const initial = currentMobileSelect(h);
  assert.equal(initial.props["aria-controls"], "help-test-sheet");
  assert.equal(elements(initial).filter(node => node.type === "option").length, 11);
  (initial.props.onChange as (event: unknown) => void)({ currentTarget: { value: "dna" } });
  assert.equal(text(find(section(h.render(), "main"), node => node.type === "h2")), messages.dashboard.helpCenter.dna.title);
  click(button(section(h.render(), "main"), messages.dashboard.helpCenter.dna.action));
  assert.deepEqual(h.routes, ["/dashboard/adn-entreprise"]);
  change(currentInput(h), "zzzz-no-guide-matches-this");
  const filtered = currentMobileSelect(h);
  assert.equal(filtered.props.value, "dna");
  const retained = elements(filtered).filter(node => node.type === "option");
  assert.equal(retained.length, 1);
  assert.equal(retained[0].props.disabled, true);
  assert.equal(text(section(h.render(), "mobileEmpty")), messages.dashboard.helpCenter.noResults);
  (filtered.props.onChange as (event: unknown) => void)({ currentTarget: { value: "missing" } });
  assert.equal(currentMobileSelect(h).props.value, "dna");
  change(currentInput(h), "");
  assert.equal(elements(currentMobileSelect(h)).filter(node => node.type === "option").length, 11);
});

test("the unified help starts with real preparation values and a single list of eleven themes", () => {
  const h = guideHarness();
  const tree = h.render();
  const main = section(tree, "main");
  assert.equal(text(find(main, node => node.type === "h2")), messages.dashboard.helpCenter.setupTitle);
  const navigation = elements(section(tree, "navigation")).filter(node => node.type === "button");
  assert.equal(navigation.length, 11);
  assert.equal(elements(section(tree, "goals")).filter(node => node.type === "button").length, 6);
  assert.equal(navigation.some(node => text(node).includes(messages.dashboard.helpCenter.articles)), false);
  const gauges = elements(main).filter(node => node.props.role === "progressbar");
  assert.deepEqual(gauges.map(node => node.props["aria-valuenow"]), [35, 100, 82]);
  assert.ok(text(main).includes("4 / 13 connectés"));
  assert.ok(text(main).includes("Terminé"));
  const html = renderToStaticMarkup(tree);
  assert.ok(html.includes('data-testid="dashboard-unified-help"'));
  assert.ok(html.includes('style="width:35%"'));
  h.props.progress.channels = -20;
  h.props.progress.ai = 140;
  assert.deepEqual(elements(h.render()).filter(node => node.props.role === "progressbar").map(node => node.props["aria-valuenow"]), [0, 100, 100]);
  assert.deepEqual(h.routes, []);
});

test("every theme changes its detail and focus while actual setup and cockpit buttons navigate explicitly", () => {
  const h = guideHarness();
  for (const label of themeLabels(h)) {
    const tree = selectTheme(h, label);
    assert.equal(button(section(tree, "sidebar"), label).props["aria-current"], "page");
    assert.deepEqual(h.routes, []);
  }
  h.flushFocus();
  assert.equal(h.focused.length, 11);
  assert.ok(h.focused.every(options => JSON.stringify(options) === JSON.stringify({ preventScroll: true })));
  const setup = [
    ["channels", "/dashboard?helpAction=channels"],
    ["dna", "/dashboard/adn-entreprise"],
    ["ai", "/dashboard/configuration-ia"],
  ] as const;
  for (const [key, route] of setup) {
    selectTheme(h, messages.dashboard.helpCenter[key].title);
    click(button(section(h.render(), "main"), messages.dashboard.helpCenter[key].action));
    assert.equal(h.routes.at(-1), route);
  }
  selectTheme(h, messages.dashboard.helpCenter.landmarksTitle);
  const landmarks = section(h.render(), "main");
  assert.match(text(landmarks), /2[ , ]425 UI disponibles/u);
  assert.equal(find(landmarks, node => hasClass(node, "statusPoint")).props["data-active"], true);
  h.props.progress.isActive = false;
  assert.equal(find(h.render(), node => hasClass(node, "statusPoint")).props["data-active"], false);
  for (const [label, route] of [
    ["Ouvrir la Boutique", "/dashboard?panel=boutique"],
    ["Réglages des estimations", "/dashboard?helpAction=generator-settings"],
    ["iNr’Stats", "/dashboard/stats"],
    ["Mon compte", "/dashboard?panel=compte"],
    ["Notifications", "/dashboard?panel=notifications"],
  ]) {
    click(button(section(h.render(), "toolActions"), label));
    assert.equal(h.routes.at(-1), route);
  }
});

test("all main tool buttons reach the right tool or the Standard subscription gate", () => {
  const cases = [
    ["publish", [["Booster", "/dashboard?action=publish"]]],
    ["media", [["iNr’Studio", "/dashboard/generer-media"], ["Médiathèque", "/dashboard/mediatheque"]]],
    ["grow", [["iNr’ADS", "/dashboard?panel=abonnement"], ["Propulser", "/dashboard?panel=abonnement"], ["Fidéliser", "/dashboard?panel=abonnement"]]],
    ["reviews", [["Réputation", "/dashboard/e-reputation"]]],
    ["contacts", [["iNr’Send", "/dashboard/mails?folder=publications&boxView=sent"], ["iNr’CRM", "/dashboard?panel=abonnement"], ["iNr’Calendar", "/dashboard?panel=abonnement"]]],
    ["stats", [["iNr’Stats", "/dashboard/stats"]]],
  ] as const;
  const h = guideHarness("standard", false);
  for (const [goal, actions] of cases) {
    selectTheme(h, messages.dashboard.helpCenter.goals[goal].title);
    for (const [label, route] of actions) {
      click(button(section(h.render(), "toolActions"), label));
      assert.equal(h.routes.at(-1), route);
    }
  }
  for (const edition of ["founder", "premium"] as const) {
    const paid = guideHarness(edition);
    selectTheme(paid, messages.dashboard.helpCenter.goals.contacts.title);
    for (const [label, route] of [["iNr’Send", "/dashboard/mails"], ["iNr’CRM", "/dashboard/crm"], ["iNr’Calendar", "/dashboard/agenda"]]) {
      click(button(section(paid.render(), "toolActions"), label));
      assert.equal(paid.routes.at(-1), route);
    }
    assert.ok(!text(section(paid.render(), "toolActions")).includes("Inclus avec Premium"));
  }
});

test("the same eleven detailed themes are translated in all nine locales and pilot content stays gated", () => {
  const locales = ["fr-FR", "en-GB", "es-ES", "de-DE", "it-IT", "pt-PT", "nl-NL", "th-TH", "zh-CN"];
  for (const locale of locales) {
    const h = guideHarness("standard", true, undefined, locale);
    for (const label of themeLabels(h)) {
      const main = section(selectTheme(h, label), "main");
      const html = renderToStaticMarkup(main);
      assert.ok(html.includes("<p>"), `${locale}: ${label} needs practical detail`);
      assert.ok(text(main).length > 250, `${locale}: ${label} must not be an empty sheet`);
    }
    assert.deepEqual(h.routes, []);
  }
  const h = guideHarness();
  selectTheme(h, messages.dashboard.helpCenter.channels.title);
  assert.equal(text(section(h.render(), "main")).includes(messages.gps.threads_intro), false);
  h.props.metaPilotEnabled = true;
  assert.ok(text(section(h.render(), "main")).includes(messages.gps.threads_intro));
  h.props.metaPilotEnabled = false;
  assert.equal(text(section(h.render(), "main")).includes(messages.gps.threads_intro), false);
});

test("FAQ search selects its theme and exposes the answer on the same sheet without clearing the query", () => {
  const faqSource = model.getHelpArticles("standard").find(item => item.article.id === "abonnement-express")!.article;
  // Production GPS articles currently have no FAQ. Exercise the supported optional field
  // with real translated keys, on a selected source used by the preparation theme.
  const h = guideHarness("standard", true, { articleId: "demarrer-express", q: faqSource.title, a: faqSource.intro });
  const question = messages.gps[faqSource.title] as string;
  const query = question.toUpperCase();
  change(currentInput(h), query);
  const tree = selectTheme(h, messages.dashboard.helpCenter.dna.title);
  assert.equal(currentInput(h).props.value, query);
  assert.equal(button(section(tree, "navigation"), messages.dashboard.helpCenter.dna.title).props["aria-current"], "page");
  assert.ok(text(section(tree, "main")).includes(question));
  assert.ok(text(section(tree, "main")).includes(messages.gps[faqSource.intro]));
  assert.ok(text(section(tree, "main")).includes(messages.dashboard.helpCenter.faq));
  assert.deepEqual(h.routes, []);
});

test("the practical sheets contain the important checks and explain outcomes without article subpages", () => {
  const h = guideHarness();
  selectTheme(h, messages.dashboard.helpCenter.goals.publish.title);
  assert.ok(text(section(h.render(), "main")).includes("Un statut orange signifie"));
  assert.ok(text(section(h.render(), "main")).includes("Un canal refusé n’annule pas ceux qui ont réussi"));
  selectTheme(h, messages.dashboard.helpCenter.goals.media.title);
  const media = section(h.render(), "main");
  const mediaDetails = messages.dashboard.helpCenter.mediaDetails;
  for (const key of ["brief", "format", "engine", "references", "dna", "review", "save"]) assert.ok(text(media).includes(mediaDetails[key]));
  const mediaCards = elements(media).filter(node => node.type === "article" && hasClass(node, "infoCard"));
  assert.equal(mediaCards.length, 4);
  assert.ok(mediaCards.every(node => elements(node).filter(child => child.type === "li").length <= 3));
  selectTheme(h, messages.dashboard.helpCenter.goals.stats.title);
  assert.ok(text(section(h.render(), "main")).includes(messages.dashboard.helpCenter.goals.stats.steps.step3));
  selectTheme(h, messages.dashboard.helpCenter.goals.contacts.title);
  const send = model.getHelpArticles("standard").find(item => item.article.id === "inrsend-express")!.article;
  assert.ok(text(section(h.render(), "main")).includes(messages.gps[send.intro]));
  selectTheme(h, messages.dashboard.helpCenter.landmarksTitle);
  for (const phrase of ["Factures", "Préférences", "Notifications", "historique des commandes"]) assert.ok(text(section(h.render(), "main")).includes(phrase));
  assert.deepEqual(h.routes, []);
});

test("empty search keeps the current sheet and Escape restores all themes without navigation", () => {
  const h = guideHarness();
  selectTheme(h, messages.dashboard.helpCenter.goals.media.title);
  change(currentInput(h), "zzzz-no-guide-matches-this");
  assert.ok(text(section(h.render(), "navigation")).includes(messages.dashboard.helpCenter.noResults));
  assert.equal(text(find(section(h.render(), "main"), node => node.type === "h2")), messages.dashboard.helpCenter.goals.media.title);
  const calls: string[] = [];
  (currentInput(h).props.onKeyDown as (event: unknown) => void)({ key: "Escape", preventDefault: () => calls.push("prevent"), stopPropagation: () => calls.push("stop") });
  assert.deepEqual(calls, ["prevent", "stop"]);
  assert.equal(currentInput(h).props.value, "");
  assert.equal(elements(section(h.render(), "navigation")).filter(node => node.type === "button").length, 11);
  assert.deepEqual(h.routes, []);
});

test("disabled agents never appear among any of the goal actions", () => {
  for (const edition of ["standard", "premium", "founder"] as const) {
    const h = guideHarness(edition, false);
    for (const goal of goals) {
      selectTheme(h, messages.dashboard.helpCenter.goals[goal].title);
      assert.equal(elements(section(h.render(), "toolActions")).some(node => hasClass(node, "agent")), false);
    }
    assert.deepEqual(h.routes, []);
  }
});

test("enabled agents retain their exact workspaces and contact actions remain distinct", () => {
  const h = guideHarness("premium", true);
  for (const [goal, label, route] of [
    ["publish", "iNr’Agent Publications", "/dashboard/agent/publications"],
    ["grow", "iNr’Agent Campagnes mails", "/dashboard/agent/campagnes-mails"],
    ["stats", "iNr’Agent Stats", "/dashboard/agent/stats"],
  ]) {
    selectTheme(h, messages.dashboard.helpCenter.goals[goal].title);
    click(button(section(h.render(), "toolActions"), label));
    assert.equal(h.routes.at(-1), route);
  }
  selectTheme(h, messages.dashboard.helpCenter.goals.contacts.title);
  const actions = elements(section(h.render(), "toolActions")).filter(node => node.type === "button");
  assert.equal(actions.length, 3);
  assert.equal(actions.filter(node => text(node).includes("iNr’CRM")).length, 1);
  assert.equal(actions.filter(node => text(node).includes("iNr’Send")).length, 1);
  assert.equal(actions.filter(node => text(node).includes("iNr’Calendar")).length, 1);
  click(button(section(h.render(), "toolActions"), "iNr’CRM"));
  click(button(section(h.render(), "toolActions"), "iNr’Send"));
  assert.deepEqual(h.routes.slice(-2), ["/dashboard/crm", "/dashboard/mails"]);
  const standard = guideHarness("standard", true);
  selectTheme(standard, messages.dashboard.helpCenter.goals.grow.title);
  assert.equal(elements(section(standard.render(), "toolActions")).some(node => hasClass(node, "agent")), false);
});

test("search moves from one theme to another with accent-insensitive terms while preserving context and focus", () => {
  const h = guideHarness();
  selectTheme(h, messages.dashboard.helpCenter.goals.media.title);
  change(currentInput(h), "PÉRIODES");
  const sidebar = section(h.render(), "sidebar");
  assert.ok(elements(sidebar).filter(node => node.type === "button").length < 11);
  selectTheme(h, messages.dashboard.helpCenter.goals.stats.title);
  assert.equal(currentInput(h).props.value, "PÉRIODES");
  assert.equal(button(section(h.render(), "navigation"), messages.dashboard.helpCenter.goals.stats.title).props["aria-current"], "page");
  h.flushFocus();
  assert.deepEqual(h.focused, [{ preventScroll: true }, { preventScroll: true }]);
  assert.deepEqual(h.routes, []);
});
test("native HelpModal owns focus and restores its opener without unlocking a parent dialog", () => {
  const effects: (() => void | (() => void))[] = [];
  const references: { current: unknown }[] = [];
  const calls: string[] = [];
  class FakeHTMLElement {
    isConnected = true;
    focus() { calls.push("opener-focus"); }
  }
  const opener = new FakeHTMLElement();
  const document = { activeElement: opener, body: { style: { overflow: "hidden" } } };
  const dialog = { open: false, showModal() { this.open = true; calls.push("show-modal"); }, close() { this.open = false; calls.push("close-modal"); } };
  const Modal = compileComponent("HelpModal", { react: {
    ...React,
    useEffect: (effect: () => void | (() => void)) => effects.push(effect),
    useRef: () => { const ref = { current: null as unknown }; references.push(ref); return ref; },
  } }, { document, HTMLElement: FakeHTMLElement, window: { addEventListener() { throw new Error("Native modal must not add a global Escape listener"); } } });
  const tree = Modal({ open: true, nativeLayer: true, variant: "guide", title: "Aide iNrCy", onClose: () => calls.push("on-close"), children: React.createElement("p", null, "Guide") });
  references[0].current = dialog;
  references[1].current = { focus: () => calls.push("close-focus") };
  const cleanups = effects.map(effect => effect()).filter((cleanup): cleanup is () => void => typeof cleanup === "function");
  assert.deepEqual(calls, ["show-modal", "close-focus"]);
  const native = find(tree, node => node.type === "dialog");
  assert.equal(native.props["aria-modal"], "true");
  (native.props.onCancel as (event: unknown) => void)({ preventDefault: () => calls.push("prevent-default"), stopPropagation: () => calls.push("stop-propagation") });
  assert.deepEqual(calls.slice(-3), ["prevent-default", "stop-propagation", "on-close"]);
  cleanups.forEach(cleanup => cleanup());
  assert.deepEqual(calls.slice(-2), ["close-modal", "opener-focus"]);
  assert.equal(document.body.style.overflow, "hidden");
});
