import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test, { type TestContext } from "node:test";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
import { statsCalendarMonths } from "../../app/dashboard/stats/stats.months.ts";
import type { MeasuredEvolutionMonth } from "../../app/dashboard/stats/stats.evolution-cache.ts";

type Loader = {
  loadMeasuredEvolution(options: { accountId: string; channels: string; force?: boolean }): Promise<MeasuredEvolutionMonth[] | null>;
  readBrowserMeasuredEvolution(accountId: string, channels: string): MeasuredEvolutionMonth[] | null;
};
const require = createRequire(import.meta.url);
function setup(t: TestContext) {
  let account = "account-a";
  const stored = new Map<string, string>();
  const writes: string[] = [];
  const target = new EventTarget();
  const boundaries = {
    getActiveBrowserUserId: () => account,
    readAccountCacheValue: (key: string, scope: string) => stored.get(`${key}:${scope}`) ?? null,
    writeAccountCacheValue: (key: string, value: string, scope: string) => { stored.set(`${key}:${scope}`, value); writes.push(scope); },
  };
  const calls: Array<{ url: string; signal?: AbortSignal | null; resolve: (response: Response) => void }> = [];
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target), setTimeout, clearTimeout,
  } });
  t.after(() => { if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else Reflect.deleteProperty(globalThis, "window"); });
  t.mock.method(globalThis, "fetch", (input: string | URL | Request, init?: RequestInit) => new Promise<Response>(resolve => { calls.push({ url: String(input), signal: init?.signal, resolve }); }));
  const modules = runtimeModules({ "@/lib/browserAccountCache": boundaries, "@/lib/multicompte/constants": { ACTIVE_INRCY_ACCOUNT_EVENT: "account-change" } });
  const loader = modules<Loader>("app/dashboard/stats/stats.evolution-loader.ts");
  const respond = (from = 0, ok = true) => {
    for (const call of calls.slice(from)) {
      const query = new URL(call.url, "https://fixture.invalid").searchParams;
      const body = call.url === "/api/inrstats/evolution"
        ? { results: statsCalendarMonths().map(month => ({ month: month.key, inrbadge: { visibility: 0, clicks: 0 }, inr_search: { visibility: 2, clicks: 1 } })) }
        : { days: Number(query.get("days")), meta: { snapshotDate: query.get("snapshotDate") }, sources: { facebook: { connected: true, metrics: { totals: { page_media_view: 42000 } } } } };
      call.resolve(Response.json(body, { status: ok ? 200 : 503 }));
    }
  };
  return { loader, modules, boundaries, calls, writes, respond, switchAccount(value: string) { account = value; target.dispatchEvent(new Event("account-change")); } };
}

test("dashboard preload and tool opening share one monthly request regardless of channel order", async t => {
  const h = setup(t);
  const warm = h.loader.loadMeasuredEvolution({ accountId: "account-a", channels: "inrbadge,facebook" });
  const open = h.loader.loadMeasuredEvolution({ accountId: "account-a", channels: "facebook,inrbadge" });
  assert.equal(warm, open);
  assert.equal(h.calls.length, 1 + statsCalendarMonths().filter(month => month.days >= 7).length);
  for (const call of h.calls.filter(call => call.url.includes("/overview?"))) {
    const params = new URL(call.url, "https://fixture.invalid").searchParams;
    const month = statsCalendarMonths().find(period => period.end === params.get("snapshotDate"));
    assert.equal(params.get("days"), String(month?.days));
    assert.equal(params.get("include"), "facebook");
  }
  h.respond();
  const months = await open;
  assert.equal(months?.[0].values.facebook?.visibility, 42000);
  assert.equal(months?.[0].values.inrbadge?.visibility, 0);
  assert.deepEqual(h.loader.readBrowserMeasuredEvolution("account-a", "inrbadge,facebook"), months);
  const count = h.calls.length;
  assert.deepEqual(await h.loader.loadMeasuredEvolution({ accountId: "account-a", channels: "facebook,inrbadge" }), months);
  assert.equal(h.calls.length, count);
});

test("changing establishment aborts preload and late responses cannot render or populate its cache", async t => {
  const h = setup(t);
  const warm = h.loader.loadMeasuredEvolution({ accountId: "account-a", channels: "facebook" });
  h.switchAccount("account-b");
  assert.ok(h.calls.every(call => call.signal?.aborted));
  h.respond();
  assert.equal(await warm, null);
  assert.deepEqual(h.writes, []);
  assert.equal(h.loader.readBrowserMeasuredEvolution("account-a", "facebook"), null);
  assert.equal(await h.loader.loadMeasuredEvolution({ accountId: "account-a", channels: "facebook" }), null);
  const start = h.calls.length;
  const next = h.loader.loadMeasuredEvolution({ accountId: "account-b", channels: "facebook" });
  assert.ok(h.calls.length > start);
  h.respond(start);
  assert.equal((await next)?.[0].values.facebook?.visibility, 42000);
  assert.deepEqual(h.writes, ["account-b"]);
});

test("an unavailable forced refresh does not replace measured history with zeroes", async t => {
  const h = setup(t);
  const first = h.loader.loadMeasuredEvolution({ accountId: "account-a", channels: "facebook" });
  h.respond();
  const original = await first;
  const start = h.calls.length;
  const refresh = h.loader.loadMeasuredEvolution({ accountId: "account-a", channels: "facebook", force: true });
  h.respond(start, false);
  const failed = await refresh;
  assert.equal(failed?.[0].loaded, false);
  assert.equal(failed?.[0].values.facebook, undefined);
  assert.deepEqual(h.loader.readBrowserMeasuredEvolution("account-a", "facebook"), original);
  assert.equal(h.writes.length, 1);
});

test("the first rendered frame contains preloaded monthly totals even while the overview is not ready", async t => {
  const h = setup(t);
  const warm = h.loader.loadMeasuredEvolution({ accountId: "account-a", channels: "facebook" });
  h.respond();
  await warm;
  const source = readFileSync("app/dashboard/stats/StatsMeasuredEvolution.tsx", "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} as { default: ComponentType<Record<string, unknown>> } };
  new Function("module", "exports", "require", compiled)(loaded, loaded.exports, (name: string) => {
    if (name === "next-intl") return { useLocale: () => "en-US", useTranslations: () => (key: string) => key };
    if (name === "@/lib/browserAccountCache") return h.boundaries;
    if (name === "./stats.evolution-loader") return h.loader;
    if (name === "./stats.months" || name === "./stats.monthly-metrics") return h.modules(`app/dashboard/stats/${name.slice(2)}.ts`);
    if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
    return require(name);
  });
  const props = { enabled: true, accountId: "account-a", refreshKey: 0, channels: [{ key: "facebook", title: "Facebook" }], ready: false };
  const beforeEffects = renderToStaticMarkup(createElement(loaded.exports.default, props));
  assert.match(beforeEffects, /<strong>42,000<\/strong>/);
  assert.doesNotMatch(beforeEffects, /panorama_loading_months/);
  h.switchAccount("account-b");
  const otherAccount = renderToStaticMarkup(createElement(loaded.exports.default, { ...props, accountId: "account-b" }));
  assert.doesNotMatch(otherAccount, /42,000/);
});
