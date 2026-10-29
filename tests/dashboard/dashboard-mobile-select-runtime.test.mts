import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import ts from "typescript";
import * as statsNavigation from "../../app/dashboard/stats/stats.navigation.ts";
import * as adsLifecycle from "../../lib/adsCampaignLifecycle.ts";
import * as adsMetrics from "../../lib/adsCampaignMetrics.ts";
import * as adsLabels from "../../app/dashboard/mails/_components/adsCampaignsFolder.shared.ts";
import * as reviewPageCache from "../../app/dashboard/e-reputation/review-page-cache.ts";

const require = createRequire(import.meta.url);
type Props = Record<string, unknown>;
type Element = ReactElement<Props>;
function nodes(tree: ReactNode): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return isValidElement<Props>(tree) ? [tree, ...nodes(tree.props.children as ReactNode)] : [];
}
function load(file: string, stubs: Record<string, unknown> = {}, localFetch: typeof fetch = () => { throw new Error("No network request expected"); }) {
  const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loadedModule = { exports: {} as { default: (props: Props) => ReactNode } };
  new Function("module", "exports", "require", "document", "HTMLElement", "fetch", compiled)(loadedModule, loadedModule.exports, (name: string) => {
    if (Object.hasOwn(stubs, name)) return stubs[name];
    if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
    return require(name);
  }, { activeElement: null, body: {}, addEventListener() {}, removeEventListener() {} }, class {}, localFetch);
  return loadedModule.exports;
}
const mobile = load("app/dashboard/_components/DashboardMobileSelect.tsx");
const selector = (props: Props) => nodes(mobile.default(props)).find((node) => node.type === "select")!;

test("the compact selector enforces global and individual disabled choices, keeping routed selection authoritative", () => {
  const selected: string[] = [];
  const props = { value: "image", ariaLabel: "Média", controls: "studio-panel", describedBy: "studio-warning", options: [{ value: "image", label: "Image" }, { value: "video", label: "Vidéo", disabled: true }, { value: "edit", label: "Retoucher" }], onChange: (value: string) => selected.push(value) };
  const control = selector(props);
  const change = control.props.onChange as (event: { currentTarget: { value: string } }) => void;
  for (const value of ["image", "video", "unknown"]) change({ currentTarget: { value } });
  assert.deepEqual(selected, []);
  assert.equal(control.props["aria-controls"], "studio-panel");
  assert.equal(control.props["aria-describedby"], "studio-warning");
  assert.equal(nodes(control).find((node) => node.type === "option" && node.props.value === "video")?.props.disabled, true);
  change({ currentTarget: { value: "edit" } });
  assert.deepEqual(selected, ["edit"]);
  assert.equal(control.props.value, "image");
  const disabled = selector({ ...props, disabled: true });
  assert.equal(disabled.props.disabled, true);
  (disabled.props.onChange as typeof change)({ currentTarget: { value: "edit" } });
  assert.deepEqual(selected, ["edit"]);
});

function statefulHooks(runEffects = false) {
  let cursor = 0;
  let dirty = false;
  const values: unknown[] = [];
  const dependencies: (unknown[] | undefined)[] = [];
  const effects: (() => void)[] = [];
  const react = {
    useState(initial: unknown) {
      const slot = cursor++;
      if (!(slot in values)) values[slot] = typeof initial === "function" ? initial() : initial;
      return [values[slot], (next: unknown) => { const value = typeof next === "function" ? next(values[slot]) : next; if (!Object.is(value, values[slot])) { values[slot] = value; dirty = true; } }];
    },
    useMemo: (get: () => unknown) => get(),
    useCallback: (callback: unknown) => callback,
    useRef(initial: unknown) { const slot = cursor++; return values[slot] ||= { current: initial }; },
    useEffect(effect: () => void, deps?: unknown[]) {
      const slot = cursor++;
      if (!runEffects) return;
      if (!dependencies[slot] || !deps || deps.some((item, index) => item !== dependencies[slot]![index])) { dependencies[slot] = deps; effects.push(effect); }
    },
  };
  return { react, render(component: (props: Props) => ReactNode, props: Props) { let tree: ReactNode; let attempts = 0; do { assert.ok(++attempts < 10); dirty = false; cursor = 0; tree = component(props); effects.splice(0).forEach((effect) => effect()); } while (dirty); return tree; } };
}

test("review platform navigation keeps the active selection and blocks changes while refreshing", async () => {
  const hooks = statefulHooks();
  let resolveRead!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { resolveRead = resolve; });
  const reviews = load("app/dashboard/e-reputation/EReputationReviewsClient.tsx", {
    react: hooks.react,
    "react-dom": { createPortal: (node: unknown) => node },
    "next-intl": { useLocale: () => "fr-FR", useTranslations: () => (key: string) => key },
    "next/link": { __esModule: true, default: "a" },
    "@/lib/inrcyDialog": { confirmInrcy() {} },
    "@/app/dashboard/_components/EmojiPickerButton": { __esModule: true, default: "emoji-picker" },
    "@/app/dashboard/_components/AiContentReportButton": { __esModule: true, default: "report-button" },
    "@/app/dashboard/_components/AiConfigurationIcon": { __esModule: true, default: "ai-icon" },
    "@/app/dashboard/booster/publier/components/PublishAiConfigurationDrawer": { __esModule: true, default: "ai-drawer" },
    "@/app/dashboard/_components/DashboardMobileSelect": mobile,
    "@/lib/browserModuleSnapshotCache": { MODULE_SNAPSHOT_KEYS: { eReputationGoogle: "reviews" }, readModuleSnapshot: () => null, writeModuleSnapshot() {} },
    "@/lib/browserAccountCache": { getActiveBrowserUserId: () => "reviews-account" },
    "./review-page-cache": reviewPageCache,
  }, () => pending);
  // The second source is a fixture for the already-supported multi-platform branch.
  const platforms = ["google", "fixture-source"].map((id) => ({ id, label: id, shortLabel: id, iconSrc: "/fixture.svg", reviews: [], reviewsReady: true, reviewsError: null, connected: true }));
  const props = { platforms, reviews: [], reviewsReady: true, reviewsError: null };
  let tree = hooks.render(reviews.default, props);
  const choice = () => nodes(tree).find((node) => node.type === mobile.default)!;
  let control = selector(choice().props);
  assert.equal(control.props.value, "google");
  (control.props.onChange as (event: unknown) => void)({ currentTarget: { value: "fixture-source" } });
  tree = hooks.render(reviews.default, props);
  assert.equal(choice().props.value, "fixture-source");
  (nodes(tree).find((node) => node.props["aria-label"] === "refresh_reviews_aria")!.props.onClick as () => void)();
  tree = hooks.render(reviews.default, props);
  control = selector(choice().props);
  assert.equal(control.props.disabled, true);
  (control.props.onChange as (event: unknown) => void)({ currentTarget: { value: "google" } });
  tree = hooks.render(reviews.default, props);
  assert.equal(choice().props.value, "fixture-source");
  resolveRead(new Response(JSON.stringify({ connected: true, configured: true, reviews: [] }), { status: 200 }));
  await new Promise((resolve) => setImmediate(resolve));
  tree = hooks.render(reviews.default, props);
  assert.equal(choice().props.disabled, false);
});

test("Ads mobile details selector opens the matching Info and Stats panels without triggering an action", () => {
  const hooks = statefulHooks(true);
  const details = load("app/dashboard/mails/_components/AdsCampaignDetailsModal.tsx", {
    react: hooks.react,
    "react-dom": { createPortal: (node: unknown) => node },
    "next/navigation": { useRouter: () => ({ push() { assert.fail("Navigation is not a tab switch"); } }) },
    "../../_components/DashboardMobileSelect": mobile,
    "@/lib/adsAccountLinks": { getAdsAdvertiserAccountUrl: () => null },
    "@/lib/adsCampaignLifecycle": adsLifecycle,
    "@/lib/adsCampaignMetrics": adsMetrics,
    "./adsCampaignsFolder.shared": adsLabels,
  });
  const props = { campaigns: [{ id: "fixture", provider: "google", status: "draft", name: "Campagne", draft: {}, provider_resources: {}, daily_budget_cents: 500 }], selectedId: "fixture", onSelect() {}, onClose() {}, onRefresh: async () => true };
  let tree = hooks.render(details.default, props);
  for (const destination of ["stats", "info"]) {
    const control = selector(nodes(tree).find((node) => node.type === mobile.default)!.props);
    (control.props.onChange as (event: unknown) => void)({ currentTarget: { value: destination } });
    tree = hooks.render(details.default, props);
    assert.equal(nodes(tree).find((node) => node.props.role === "tabpanel")?.props.id, `ads-campaign-${destination}-panel`);
    assert.equal(nodes(tree).find((node) => node.type === mobile.default)?.props.controls, `ads-campaign-${destination}-panel`);
  }
});

test("iNrStats mobile choices include overview, evolution and only available channels without intercepting the selector gesture", () => {
  const selected: string[] = [];
  const navigator = load("app/dashboard/stats/StatsViewNavigator.tsx", {
    react: { useRef: (value: unknown) => ({ current: value }) },
    "next/image": { __esModule: true, default: "img" },
    "next-intl": { useTranslations: () => (key: string) => key },
    "./stats.navigation": statsNavigation,
    "../_components/DashboardMobileSelect": mobile,
  });
  const pages = statsNavigation.buildStatsNavigationPages([{ key: "facebook", title: "Facebook" }], "Vue globale", {}, "Évolution");
  const tree = navigator.default({ pages, activeKey: "evolution", onSelect: (value: string) => selected.push(value), summary: "Résumé" });
  const selectNode = nodes(tree).find((node) => node.type === mobile.default)!;
  const control = selector(selectNode.props);
  assert.deepEqual(nodes(control).filter((node) => node.type === "option").map((node) => node.props.value), ["all", "evolution", "facebook"]);
  assert.equal(control.props.value, "evolution");
  (control.props.onChange as (event: unknown) => void)({ currentTarget: { value: "facebook" } });
  assert.deepEqual(selected, ["facebook"]);
  let capture = false;
  (nodes(tree)[0].props.onPointerDown as (event: unknown) => void)({ isPrimary: true, button: 0, target: { closest: (query: string) => { assert.match(query, /select/); return {}; } }, currentTarget: { setPointerCapture: () => { capture = true; } } });
  assert.equal(capture, false);
});

test("iNrStats evolution selector preserves the existing measured/index state setter", () => {
  const selected: unknown[] = [];
  const measured = () => null;
  const index = () => null;
  const evolution = load("app/dashboard/stats/StatsEvolution.tsx", {
    react: { useState: (value: unknown) => [value, (next: unknown) => selected.push(next)], useCallback: (callback: unknown) => callback },
    "next-intl": { useTranslations: () => (key: string) => key },
    "../_components/DashboardMobileSelect": mobile,
    "./StatsMeasuredEvolution": { __esModule: true, default: measured },
    "./StatsVisibilityIndex": { __esModule: true, default: index },
  });
  const tree = evolution.default({ enabled: true, accountId: "fixture", refreshKey: 0, channels: [], ready: true });
  const panel = nodes(tree).find((node) => node.type === measured)!;
  assert.equal(panel.props.enabled, true);
  assert.equal(nodes(tree).find((node) => node.type === index)?.props.enabled, false);
  const choice = nodes(panel.props.tabs as ReactNode).find((node) => node.type === mobile.default)!;
  const control = selector(choice.props);
  assert.deepEqual(nodes(control).filter((node) => node.type === "option").map((node) => node.props.value), ["measured", "index"]);
  (control.props.onChange as (event: unknown) => void)({ currentTarget: { value: "index" } });
  assert.deepEqual(selected, ["index"]);
});
