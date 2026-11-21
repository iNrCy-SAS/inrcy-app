import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function load<T extends object>(path: string, mocks: Record<string, unknown>): T {
  const source = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)((name: string) => {
    assert.ok(name in mocks, `Unexpected dependency ${name}`);
    return mocks[name];
  }, loaded, loaded.exports);
  return loaded.exports as T;
}

function routeFixture(edition = "premium", failure: object | null = null, denied = false) {
  const publication = { user_id: "active-account", automation_key: "publish", action_type: "publication", target_tool: "booster", validation_required: true, status: "prepared" };
  const rows = [publication, { ...publication, status: "pending_validation" }, { ...publication, status: "pending" },
    { ...publication, status: "scheduled" }, { ...publication, validation_required: false }, { ...publication, user_id: "another-account" },
    { ...publication, automation_key: "stats", action_type: "analysis", target_tool: "stats" },
    { ...publication, automation_key: "campaign", action_type: "campaign", target_tool: "mails" }];
  let queryCount = 0;
  const api = load<{ GET: () => Promise<unknown> }>("app/api/agent/actions/pending-count/route.ts", {
    "next/server": { NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }) } },
    "@/lib/requireUser": { requireUser: async () => ({ authUserId: "actor-account", activeUserId: "active-account", errorResponse: denied ? { status: 401 } : null }) },
    "@/lib/dashboardEditionServer": { getDashboardEditionForAuthUser: async (id: string) => { assert.equal(id, "actor-account"); return edition; } },
    "@/lib/supabaseAdmin": { supabaseAdmin: { from(table: string) {
      assert.equal(table, "inr_agent_actions"); queryCount++;
      const filters: Array<(row: typeof publication) => boolean> = [];
      const query = {
        select(columns: string, options: unknown) { assert.equal(columns, "id"); assert.deepEqual(options, { count: "exact", head: true }); return this; },
        eq(key: keyof typeof publication, value: unknown) { filters.push(row => row[key] === value); return this; },
        in(key: keyof typeof publication, values: unknown[]) { filters.push(row => values.includes(row[key])); return this; },
        then(resolve: (value: unknown) => unknown) { return Promise.resolve({ count: failure ? null : rows.filter(row => filters.every(fn => fn(row))).length, error: failure }).then(resolve); },
      };
      return query;
    } } },
  });
  return { get: api.GET, queryCount: () => queryCount };
}

test("premium pending totals preserve all agents while publication count excludes non-publications, other accounts and automatic jobs", async () => {
  const fixture = routeFixture();
  assert.deepEqual(await fixture.get(), { status: 200, body: { count: 5, publicationCount: 3, tableMissing: false } });
  assert.equal(fixture.queryCount(), 2);
});

test("standard reuses its one publication-only query", async () => {
  const fixture = routeFixture("standard");
  assert.deepEqual(await fixture.get(), { status: 200, body: { count: 3, publicationCount: 3, tableMissing: false } });
  assert.equal(fixture.queryCount(), 1);
});

test("unauthorized requests do not query actions and a missing table yields two zero counts", async () => {
  const denied = routeFixture("premium", null, true);
  assert.deepEqual(await denied.get(), { status: 401 }); assert.equal(denied.queryCount(), 0);
  const missing = routeFixture("premium", { code: "42P01" });
  assert.deepEqual(await missing.get(), { status: 200, body: { count: 0, publicationCount: 0, tableMissing: true } });
});

function hookFixture() {
  const originals = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  const events = new EventTarget();
  const doc = Object.assign(new EventTarget(), { hidden: false });
  const cache = new Map<string, string>();
  const subscriptions: Array<{ subscribe: (fn: () => void) => () => void; snapshot: () => number }> = [];
  let account = "account-a", calls = 0, intervals = 0;
  let payload: unknown = { count: 8, publicationCount: 3 };
  let fetchResult: (() => Promise<Response>) | null = null;
  Object.assign(globalThis, {
    window: { addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
      setInterval: () => { intervals++; return 1; }, clearInterval: () => { intervals--; } },
    document: doc,
    fetch: async () => { calls++; return fetchResult ? fetchResult() : { ok: true, json: async () => payload }; },
  });
  const hook = load<{
    useInrAgentPendingCount: (enabled?: boolean, workspace?: "publications") => number;
    refreshInrAgentPendingCount: () => Promise<void>;
    INR_AGENT_PENDING_COUNT_CACHE_KEY: string;
    INR_AGENT_PENDING_PUBLICATION_COUNT_CACHE_KEY: string;
  }>("app/dashboard/_hooks/useInrAgentPendingCount.ts", {
    react: { useSyncExternalStore: (subscribe: (fn: () => void) => () => void, snapshot: () => number) => { subscriptions.push({ subscribe, snapshot }); return snapshot(); } },
    "@/lib/browserAccountCache": { getActiveBrowserUserId: () => account, readAccountCacheValue: (key: string, id: string) => cache.get(`${id}:${key}`),
      writeAccountCacheValue: (key: string, value: string, id: string) => cache.set(`${id}:${key}`, value) },
    "@/lib/multicompte/constants": { ACTIVE_INRCY_ACCOUNT_EVENT: "active-account-changed" },
  });
  const unsubscribe: Array<() => void> = [];
  function subscribe(workspace?: "publications") {
    hook.useInrAgentPendingCount(true, workspace);
    const subscription = subscriptions.at(-1)!;
    unsubscribe.push(subscription.subscribe(() => {}));
    return subscription.snapshot;
  }
  return { hook, subscribe, cache, calls: () => calls, intervals: () => intervals,
    payload(value: unknown) { payload = value; },
    account(value: string) { account = value; events.dispatchEvent(new Event("active-account-changed")); },
    defer(value: () => Promise<Response>) { fetchResult = value; },
    cleanup() { unsubscribe.forEach(fn => fn()); Object.assign(globalThis, originals); },
  };
}

test("global and publication subscriptions share a single request/poller and use distinct account caches", async () => {
  const fixture = hookFixture();
  try {
    const globalCount = fixture.subscribe(), publicationCount = fixture.subscribe("publications");
    await fixture.hook.refreshInrAgentPendingCount();
    assert.equal(fixture.calls(), 1); assert.equal(fixture.intervals(), 1);
    assert.equal(globalCount(), 8); assert.equal(publicationCount(), 3);
    assert.equal(fixture.cache.get(`account-a:${fixture.hook.INR_AGENT_PENDING_COUNT_CACHE_KEY}`), "8");
    assert.equal(fixture.cache.get(`account-a:${fixture.hook.INR_AGENT_PENDING_PUBLICATION_COUNT_CACHE_KEY}`), "3");
    fixture.payload({ count: 9 }); await fixture.hook.refreshInrAgentPendingCount();
    assert.equal(globalCount(), 9); assert.equal(publicationCount(), 0, "a legacy payload must never reuse the global count as publication count");
  } finally { fixture.cleanup(); }
});

test("switching accounts clears publication count and discards a response from the previous account", async () => {
  const fixture = hookFixture();
  try {
    const publicationCount = fixture.subscribe("publications");
    await fixture.hook.refreshInrAgentPendingCount(); assert.equal(publicationCount(), 3);
    let resolveOld: (value: Response) => void = () => {};
    fixture.defer(() => new Promise(resolve => { resolveOld = resolve; }));
    const old = fixture.hook.refreshInrAgentPendingCount();
    fixture.payload({ count: 5, publicationCount: 1 });
    fixture.defer(async () => ({ ok: true, json: async () => ({ count: 5, publicationCount: 1 }) }) as Response);
    fixture.account("account-b");
    assert.equal(publicationCount(), 0);
    await fixture.hook.refreshInrAgentPendingCount(); assert.equal(publicationCount(), 1);
    resolveOld({ ok: true, json: async () => ({ count: 99, publicationCount: 90 }) } as Response);
    await old;
    assert.equal(publicationCount(), 1);
    assert.equal(fixture.cache.get(`account-b:${fixture.hook.INR_AGENT_PENDING_PUBLICATION_COUNT_CACHE_KEY}`), "1");
  } finally { fixture.cleanup(); }
});
