import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

type Row = Record<string, unknown>;
function harness(t: TestContext, options: { authorized?: boolean; ids?: string[]; active?: string[]; response?: (request: Request) => Promise<Response> } = {}) {
  const ids = options.ids ?? ["account-a"];
  const calls: Request[] = [];
  const updates: Array<{ userId: string; nextCaptureAt: string }> = [];
  let claims = 0;
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    calls.push(request);
    if (request.signal.aborted) throw new DOMException("Request aborted", "AbortError");
    return options.response?.(request) ?? Response.json({ visibilityIndex: { recorded: true, reason: "recorded" } });
  });
  const load = runtimeModules({
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/cronAuth": {
      isAuthorizedCronRequest: () => options.authorized !== false,
      getAppOriginFromRequest: () => "https://protected-deployment.invalid",
      buildInternalCronHeaders: (id: string) => ({ "x-inr-agent-user-id": id, "x-cron-secret": "synthetic-cron-secret" }),
    },
    "@/lib/accountSubscriptionAccess": { getActiveSubscriptionAccountIds: async () => new Set(options.active ?? ids) },
    "@/lib/supabaseAdmin": { supabaseAdmin: {
      rpc: async (name: string, params: Row) => { assert.equal(name, "claim_inrstats_visibility_accounts"); assert.deepEqual(params, { p_limit: 6 }); claims++; return { data: ids.map(user_id => ({ user_id })), error: null }; },
      from: (table: string) => {
        assert.equal(table, "inrstats_visibility_tracking");
        return { update: (row: { next_capture_at: string }) => ({ eq: async (key: string, userId: string) => { assert.equal(key, "user_id"); updates.push({ userId, nextCaptureAt: row.next_capture_at }); return { error: null }; } }) };
      },
    } },
  });
  const route = load<{ GET(request: Request): Promise<Response> }>("app/api/cron/inrstats-visibility/route.ts");
  return { calls, updates, claims: () => claims, run: () => route.GET(new Request("https://protected-deployment.invalid/api/cron/inrstats-visibility")) };
}

test("visibility cron keeps its trusted per-account headers and only captures active subscriptions", async t => {
  const h = harness(t, { ids: ["account-a", "inactive", "account-b"], active: ["account-a", "account-b"] });
  const response = await h.run();
  assert.deepEqual(await response.json(), { ok: true, recorded: 2, failed: 0, skipped: 1 });
  assert.deepEqual(h.calls.map(request => request.headers.get("x-inr-agent-user-id")).sort(), ["account-a", "account-b"]);
  for (const request of h.calls) {
    assert.equal(request.headers.get("x-cron-secret"), "synthetic-cron-secret");
    assert.equal(new URL(request.url).pathname, "/api/stats/dashboard-bulk");
    assert.equal(new URL(request.url).search, "?days=30");
    assert.equal(request.cache, "no-store");
  }
  assert.equal(h.updates[0].userId, "inactive");
  assert.ok(Date.parse(h.updates[0].nextCaptureAt) - Date.now() > 86_000_000);
});

test("visibility captures remain bounded to three simultaneous account requests", async t => {
  let inFlight = 0, maxInFlight = 0;
  const h = harness(t, { ids: ["a", "b", "c", "d", "e", "f"], response: async () => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise<void>(resolve => setImmediate(resolve));
    inFlight--;
    return Response.json({ visibilityIndex: { recorded: true } });
  } });
  assert.equal((await (await h.run()).json()).recorded, 6);
  assert.equal(maxInFlight, 3);
});

test("unauthorized cron requests cannot claim accounts or enter the internal handler", async t => {
  const h = harness(t, { authorized: false });
  assert.equal((await h.run()).status, 401);
  assert.equal(h.claims(), 0);
  assert.equal(h.calls.length, 0);
});

test("historical or provider-deferred observations stay unrecorded and produce actionable safe reason counts", async t => {
  const warning = t.mock.method(console, "warn", () => undefined);
  const h = harness(t, { ids: ["historical", "provider"], response: async request => Response.json({ visibilityIndex: { recorded: false, reason: request.headers.get("x-inr-agent-user-id") === "historical" ? "historical_request" : "visibility_provider_unavailable" } }) });
  assert.deepEqual(await (await h.run()).json(), { ok: false, recorded: 0, failed: 2, skipped: 0 });
  assert.equal(h.updates.length, 2);
  assert.ok(h.updates.every(row => Date.parse(row.nextCaptureAt) - Date.now() > 3_500_000));
  assert.deepEqual(warning.mock.calls[0].arguments[1], { recorded: 0, failed: 2, skipped: 0, failureReasons: { historical_request: 1, visibility_provider_unavailable: 1 } });
});

test("HTTP failures and arbitrary provider text are classified without leaking the response or a private error message", async t => {
  const warning = t.mock.method(console, "warn", () => undefined);
  const h = harness(t, { ids: ["denied", "private"], response: async request => request.headers.get("x-inr-agent-user-id") === "denied" ? Response.json({ error: "private response" }, { status: 401 }) : Response.json({ visibilityIndex: { recorded: false, reason: "private provider error with credentials" } }) });
  assert.equal((await (await h.run()).json()).failed, 2);
  assert.deepEqual(warning.mock.calls[0].arguments[1], { recorded: 0, failed: 2, skipped: 0, failureReasons: { capture_http_401: 1, capture_not_recorded: 1 } });
});

test("the original 100-second HTTP deadline is retained and aborted reads remain unrecorded", async t => {
  t.mock.method(AbortSignal, "timeout", (milliseconds: number) => { assert.equal(milliseconds, 100_000); return AbortSignal.abort(); });
  t.mock.method(console, "warn", () => undefined);
  const h = harness(t);
  assert.deepEqual(await (await h.run()).json(), { ok: false, recorded: 0, failed: 1, skipped: 0 });
  assert.equal(h.updates.length, 1);
});

test("a connected provider failure still prevents a fabricated snapshot and identifies only the safe channel key", async t => {
  const warning = t.mock.method(console, "warn", () => undefined);
  let writes = 0;
  const counts = { select() { return counts; }, eq() { return counts; }, gte() { return counts; }, lt() { return counts; }, in() { return counts; }, then(resolve: (result: unknown) => unknown) { return Promise.resolve(resolve({ count: 0, error: null })); } };
  const account = { select() { return account; }, eq() { return account; }, maybeSingle: async () => ({ data: { created_at: "2026-01-01T00:00:00Z" }, error: null }) };
  const load = runtimeModules({
    "@/lib/supabaseAdmin": { supabaseAdmin: {
      from(table: string) { return table === "inrstats_visibility_tracking" ? { upsert: async () => ({ error: null }) } : table === "inrcy_accounts" ? account : counts; },
      rpc: async () => { writes++; return { data: 14, error: null }; },
    } },
    "@/lib/inrstats/visibilityIndexRewards": { reconcileVisibilityRewards: async () => undefined },
  });
  const store = load<{ captureVisibilityIndex: (args: unknown) => Promise<{ recorded: boolean; reason: string; channel?: string }> }>("lib/inrstats/visibilityIndexStore.ts");
  const result = await store.captureVisibilityIndex({
    userId: "account-test", now: new Date("2026-10-30T12:00:00Z"), activity: {},
    channelStates: { inr_search: { connected: false }, mails: { connected: false } },
    bulk: { period: 30, overviews: {}, meta: { snapshotDate: "2026-10-29" }, blocks: { facebook: { connection: { statsConnected: true, requiresUpdate: false }, error: "private provider details" } } },
  });
  assert.deepEqual(result, { recorded: false, reason: "visibility_provider_unavailable", channel: "facebook" });
  assert.equal(writes, 0);
  assert.deepEqual(warning.mock.calls[0].arguments[1], { reason: "visibility_provider_unavailable", channel: "facebook" });
});
