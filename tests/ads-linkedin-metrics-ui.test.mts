import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as metrics from "../lib/adsCampaignMetrics.ts";

type Element = { type: unknown; props: Record<string, unknown> };
type Campaign = Record<string, unknown> & { id: string; provider: string; status: string };
type RequestRecord = { url: string; options: RequestInit; resolve: (response: Response) => void };
const componentPaths = {
  details: "../app/dashboard/mails/_components/AdsCampaignDetailsModal.tsx",
  tracking: "../app/dashboard/ads/AdsCampaignTracking.tsx",
};
type Component = keyof typeof componentPaths;
const accountId = "558357276";
const campaignId = "987654321";
const uuid = "bf523971-5884-466d-9cc4-09cdf4a08d53";
function campaign(provider = "linkedin", changes: Record<string, unknown> = {}): Campaign {
  return {
    id: uuid, provider, name: "Campagne de test", status: "paused", ad_account_id: accountId,
    provider_resources: provider === "linkedin"
      ? { accountId, campaignId, campaignUrn: `urn:li:sponsoredCampaign:${campaignId}` }
      : provider === "google" ? { campaignResourceName: `customers/${accountId}/campaigns/${campaignId}` }
        : { provider: "meta", adAccountId: accountId, campaignId },
    draft: {}, daily_budget_cents: 1000, end_date: "2026-12-01",
    published_at: "2026-10-09T10:00:00Z", created_at: "2026-10-09T10:00:00Z", last_error: null,
    ...changes,
  };
}
function report(source = "linkedin", changes: Record<string, unknown> = {}) {
  return {
    period: "last_30_days", source, impressions: 1234, clicks: 17,
    spendEuros: 22.5, conversions: source === "meta" ? null : 3, fetchedAt: "2026-10-09T12:00:00.000Z", ...changes,
  };
}
function descendants(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(descendants);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Element;
  return [node, ...descendants(node.props.children)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join(" ");
  if (value && typeof value === "object" && "props" in value) return text((value as Element).props.children);
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function runtime(kind: Component, campaigns = [campaign()]) {
  const slots: unknown[] = [];
  const effects = new Map<number, { deps?: unknown[]; cleanup?: () => void }>();
  const callbacks = new Map<number, { deps: unknown[]; callback: unknown }>();
  const requests: RequestRecord[] = [];
  let index = 0, dirty = false, pending: Array<() => void> = [], tree: unknown;
  let props: Record<string, unknown> = {
    campaigns, selectedId: campaigns[0]?.id ?? null, total: campaigns.length,
    loading: false, loadingMore: false, hasMore: false, loadError: "",
    onRefresh: async () => true, onLoadMore: async () => {}, onClose: () => {}, onEdit: () => {},
    onSelect: (id: string) => { props = { ...props, selectedId: id }; dirty = true; },
  };
  const react = {
    useState: (value: unknown) => {
      const at = index++;
      if (!(at in slots)) slots[at] = typeof value === "function" ? value() : value;
      return [slots[at], (next: unknown) => {
        const result = typeof next === "function" ? next(slots[at]) : next;
        if (!Object.is(result, slots[at])) { slots[at] = result; dirty = true; }
      }];
    },
    useRef: (value: unknown) => { const at = index++; return slots[at] ?? (slots[at] = { current: value }); },
    useCallback: (callback: unknown, deps: unknown[]) => {
      const at = index++, previous = callbacks.get(at);
      if (!previous || deps.some((value, position) => !Object.is(value, previous.deps[position]))) callbacks.set(at, { deps, callback });
      return callbacks.get(at)!.callback;
    },
    useEffect: (effect: () => unknown, deps?: unknown[]) => {
      const at = index++, previous = effects.get(at);
      if (!previous || !deps || !previous.deps || deps.some((value, position) => !Object.is(value, previous.deps?.[position]))) {
        pending.push(() => {
          previous?.cleanup?.();
          const cleanup = effect();
          effects.set(at, { deps, cleanup: typeof cleanup === "function" ? cleanup as () => void : undefined });
        });
      }
    },
  };
  const css = { default: new Proxy({}, { get: (_target, key) => String(key) }) };
  const labels = { google: "Google Ads", meta: "Meta Ads", linkedin: "LinkedIn Ads", openai: "ChatGPT Ads", pinterest: "Pinterest Ads", x: "X Ads", tiktok: "TikTok Ads" };
  const modules: Record<string, unknown> = {
    react,
    "react/jsx-runtime": { jsx: (type: unknown, props: Record<string, unknown>) => ({ type, props }), jsxs: (type: unknown, props: Record<string, unknown>) => ({ type, props }), Fragment: Symbol("Fragment") },
    "react-dom": { createPortal: (node: unknown) => node },
    "next/navigation": { useRouter: () => ({ push: () => assert.fail("Stats must not navigate or mutate") }) },
    "next/image": { default: () => null },
    "@/lib/adsCampaignMetrics": metrics,
    "@/lib/adsAccountLinks": { getAdsAdvertiserAccountUrl: () => null },
    "@/lib/adsCampaignLifecycle": {
      canDiscardInterruptedInitialPublish: () => false,
      canManageRemoteAdsCampaign: () => false,
      canRecoverInterruptedAdsCampaign: () => false,
      ADS_LOCAL_RECOVERY_DISCARD_CONFIRMATION: "UNUSED", ADS_OPENAI_REMOTE_RESUME_CONFIRMATION: "UNUSED", ADS_REMOTE_DELETE_CONFIRMATION: "UNUSED",
    },
    "./adsCampaignsFolder.shared": { adsChannelLabels: labels, adsStatusLabels: { paused: "En pause" }, adsDate: String, adsDateTime: String },
    "../mails.module.css": css, "./AdsCampaignsFolder.module.css": css, "./AdsCampaignTracking.module.css": css,
  };
  const exported: { default?: (props: Record<string, unknown>) => unknown } = {};
  const compiled = ts.transpileModule(readFileSync(new URL(componentPaths[kind], import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const document = { activeElement: null, body: {}, addEventListener: () => {}, removeEventListener: () => {} };
  new Function("exports", "require", "fetch", "document", "HTMLElement", compiled)(exported, (name: string) => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected UI dependency ${name}`);
    return modules[name];
  }, (url: string, options: RequestInit = {}) => {
    assert.match(url, /^\/api\/ads\/campaigns\/[a-z0-9-]+\/metrics$/);
    assert.equal(options.cache, "no-store");
    assert.ok(options.method === undefined || options.method === "GET");
    return new Promise<Response>((resolve) => requests.push({ url, options, resolve }));
  }, document, class HTMLElement {});
  function render(changes: Record<string, unknown> = {}) {
    props = { ...props, ...changes };
    let cycles = 0;
    do {
      dirty = false; index = 0; pending = [];
      tree = exported.default!(props);
      const tasks = pending; pending = [];
      tasks.forEach((effect) => effect());
      if (++cycles > 20) assert.fail("Stats UI effect loop");
    } while (dirty);
    return tree;
  }
  function click(label: string) {
    const button = descendants(tree).find((node) => node.type === "button" && text(node) === label);
    assert.ok(button, `Missing button ${label}`);
    assert.equal(typeof button.props.onClick, "function");
    (button.props.onClick as () => void)();
    render();
  }
  function openStats() { click(kind === "details" ? "Stats" : "Voir les statistiques"); }
  async function finish(at: number, body: unknown, status = 200) {
    assert.ok(requests[at]);
    requests[at].resolve(Response.json(body, { status }));
    await tick();
    render();
  }
  function metricValues() {
    const result: Record<string, string> = {};
    for (const node of descendants(tree).filter((node) => node.type === "div")) {
      const children = Array.isArray(node.props.children) ? node.props.children : [node.props.children];
      const dt = children.find((child) => child && typeof child === "object" && (child as Element).type === "dt");
      const dd = children.find((child) => child && typeof child === "object" && (child as Element).type === "dd");
      if (dt && dd) result[text(dt)] = text(dd);
    }
    return result;
  }
  return { render, click, openStats, finish, requests, metricValues, text: () => text(tree), elements: () => descendants(tree) };
}

for (const kind of Object.keys(componentPaths) as Component[]) {
  test(`${kind}: LinkedIn paused campaign loads real metrics in the existing accessible UI`, async () => {
    const h = runtime(kind); h.render();
    if (kind === "details") assert.equal(h.metricValues()["Identifiant sur la plateforme"], campaignId);
    h.openStats();
    assert.equal(h.requests.length, 1);
    await h.finish(0, { metrics: report() });
    assert.match(h.text(), /LinkedIn Ads/);
    assert.equal(h.metricValues().Impressions.replace(/\s/g, ""), "1234");
    assert.equal(h.metricValues().Clics, "17");
    assert.match(h.metricValues().Dépenses, /22,50/);
    assert.equal(h.metricValues().Conversions, "3");
    assert.match(h.text(), /attribuées par LinkedIn Ads/);
    assert.match(h.text(), /pas nécessairement à des abonnements/);
    if (kind === "details") {
      const selected = h.elements().find((node) => node.type === "button" && text(node) === "Stats");
      assert.equal(selected?.props["aria-selected"], true);
      assert.ok(h.elements().some((node) => node.props.role === "tabpanel" && node.props["aria-labelledby"] === "ads-campaign-stats-tab"));
    }
  });

  test(`${kind}: eligible statuses retain Google and Meta reporting`, async () => {
    for (const provider of ["linkedin", "google", "meta"]) for (const status of ["paused", "demo_paused", "active", "needs_review"]) {
      const h = runtime(kind, [campaign(provider, { status })]); h.render(); h.openStats();
      assert.equal(h.requests.length, 1, `${provider}/${status}`);
      await h.finish(0, { metrics: report(provider) });
      assert.equal(h.metricValues().Clics, "17", `${provider}/${status}`);
      assert.match(h.text(), new RegExp(metrics.adsCampaignMetricsSourceLabel(provider as metrics.AdsCampaignMetrics["source"])));
    }
  });

  test(`${kind}: unpublished or inconsistent LinkedIn account/campaign references never fetch metrics`, () => {
    const invalid = [
      { status: "draft" }, { status: "publishing" },
      { ad_account_id: "different-account" }, { provider_resources: {} },
      { provider_resources: { accountId, campaignUrn: `urn:li:sponsoredCampaign:${campaignId}`, campaignId: "555" } },
      { provider_resources: { accountId, campaignUrn: "urn:li:sponsoredCampaign:0" } },
      { provider_resources: { provider: "meta", accountId, campaignUrn: `urn:li:sponsoredCampaign:${campaignId}` } },
    ];
    for (const changes of invalid) {
      const h = runtime(kind, [campaign("linkedin", changes)]); h.render();
      if (kind === "details") h.openStats();
      assert.equal(h.requests.length, 0, JSON.stringify(changes));
      assert.equal(h.metricValues().Impressions, undefined);
    }
  });

  test(`${kind}: a valid empty report displays no data without fabricated zeroes`, async () => {
    const h = runtime(kind); h.render(); h.openStats();
    await h.finish(0, { metrics: null, reason: "no_data" });
    assert.match(h.text(), /Aucune donnée de diffusion retournée par LinkedIn Ads/);
    for (const key of ["Impressions", "Clics", "Dépenses", "Conversions"]) assert.equal(h.metricValues()[key], undefined);
  });

  test(`${kind}: malformed or wrong-provider data is an error, not empty or zero performance`, async () => {
    for (const body of [
      { metrics: null }, { metrics: report("google") },
      { metrics: report("linkedin", { impressions: "1234" }) },
      { metrics: report("linkedin", { clicks: -1 }) },
      { metrics: report("linkedin", { fetchedAt: "not-a-date" }) },
      { metrics: { source: "linkedin", period: "last_30_days" } },
    ]) {
      const h = runtime(kind); h.render(); h.openStats(); await h.finish(0, body);
      assert.match(h.text(), /pas retourné de statistiques exploitables/);
      assert.equal(h.metricValues().Impressions, undefined);
      assert.ok(h.elements().some((node) => node.props.role === "alert"));
    }
  });

  test(`${kind}: backend authorization errors remain actionable and can be retried`, async () => {
    const h = runtime(kind); h.render(); h.openStats();
    await h.finish(0, { error: "Reconnectez LinkedIn Ads avec l’autorisation de statistiques." }, 403);
    assert.match(h.text(), /Reconnectez LinkedIn Ads/);
    assert.equal(h.metricValues().Impressions, undefined);
    h.click(kind === "details" ? "Actualiser" : "Actualiser les statistiques");
    assert.equal(h.requests.length, 2);
    await h.finish(1, { metrics: report() });
    assert.equal(h.metricValues().Clics, "17");
  });

  test(`${kind}: concurrent refresh clicks share one in-flight read`, async () => {
    const h = runtime(kind); h.render(); h.openStats();
    const button = h.elements().find((node) => node.type === "button" && text(node) === (kind === "details" ? "Lecture…" : "Lecture des statistiques…"));
    assert.ok(button);
    assert.equal(button.props.disabled, true);
    (button.props.onClick as () => void)();
    (button.props.onClick as () => void)();
    assert.equal(h.requests.length, 1);
    await h.finish(0, { metrics: report() });
  });
}

test("iNrSend campaign navigation keeps asynchronous LinkedIn reports with their original campaign", async () => {
  const secondId = "73888634-753e-4092-bb2b-73b63a251dd5";
  const first = campaign(), second = campaign("linkedin", { id: secondId, name: "Seconde campagne" });
  const h = runtime("details", [first, second]); h.render(); h.openStats();
  h.render({ selectedId: secondId }); h.openStats();
  assert.equal(h.requests.length, 2);
  assert.match(h.requests[0].url, new RegExp(first.id));
  assert.match(h.requests[1].url, new RegExp(secondId));
  await h.finish(1, { metrics: report("linkedin", { clicks: 88 }) });
  assert.equal(h.metricValues().Clics, "88");
  await h.finish(0, { metrics: report("linkedin", { clicks: 17 }) });
  assert.equal(h.metricValues().Clics, "88");
  h.render({ selectedId: first.id }); h.openStats();
  assert.equal(h.metricValues().Clics, "17");
  assert.equal(h.requests.length, 2);
});
