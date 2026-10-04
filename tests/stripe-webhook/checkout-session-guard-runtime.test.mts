import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import type { StripeCheckoutGuard } from "../../lib/stripeCheckoutSessionGuard.ts";

type Row = Record<string, unknown>;
type Session = Row & { id: string; customer: string; mode: string; status: string; metadata: Row; price: string; quantity: number };
const compiled = ts.transpileModule(readFileSync(new URL("../../lib/stripeCheckoutSessionGuard.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture() {
  const redis = new Map<string, unknown>();
  const sessions = new Map<string, Session>();
  const attempts = new Map<string, string>();
  const calls: Array<{ path: string; params?: URLSearchParams; key?: string }> = [];
  const state = { unavailable: false, enabled: true, lostResponse: false, failBeforeCreate: false, hideLists: false, failReadySave: false,
    expireCompletes: false, listHasMore: false, live: false, subscriptionStatus: "active" };
  let beforeCreate: (() => Promise<void>) | null = null;
  let beforeCheck: (() => void) | null = null;
  class FakeRedis {
    async set(key: string, value: unknown) {
      if (state.unavailable) throw new Error("redis unavailable");
      if (redis.has(key)) return null;
      redis.set(key, value); return "OK";
    }
    async get(key: string) {
      if (state.unavailable) throw new Error("redis unavailable");
      return redis.get(key) ?? null;
    }
    async eval(script: string, keys: string[], args: unknown[]) {
      if (state.unavailable) throw new Error("redis unavailable");
      if (script.startsWith("-- checkout-save")) {
        if (redis.get(keys[0]) !== args[0] || redis.get(keys[1]) !== args[0]) return 0;
        const value = JSON.parse(String(args[1]));
        if (state.failReadySave && value.sessionId) { state.failReadySave = false; throw new Error("lost redis response"); }
        redis.set(keys[2], value); return 1;
      }
      if (redis.get(keys[0]) !== args[0]) return 0;
      if (script.startsWith("-- checkout-release")) redis.delete(keys[0]);
      return 1;
    }
  }
  const modules: Record<string, unknown> = {
    "server-only": {}, "node:crypto": crypto, "@upstash/redis": { Redis: FakeRedis },
    "@/lib/env": { optionalEnv: (name: string) => name.endsWith("URL") ? "https://redis.example.invalid" : "test-placeholder" },
    "@/lib/upstashMode": { shouldBypassUpstashInCurrentEnv: () => !state.enabled },
  };
  const runtime = { exports: {} as { withStripeCheckoutGuard<T>(userId: string, callback: (guard: StripeCheckoutGuard) => Promise<T>): Promise<T> } };
  new Function("module", "exports", "require", compiled)(runtime, runtime.exports, (name: string) => {
    assert.ok(Object.hasOwn(modules, name), `unexpected dependency ${name}`); return modules[name];
  });
  function add(options: Partial<Session> = {}) {
    const session: Session = { id: `cs_${sessions.size + 1}`, customer: "cus_account", mode: "subscription", status: "open",
      client_reference_id: "user_account", metadata: { user_id: "user_account", plan: "Standard" }, price: "price_standard", quantity: 1,
      url: "https://checkout.example.invalid/session", ...options };
    sessions.set(session.id, session); return session;
  }
  async function get(path: string) {
    calls.push({ path });
    const url = new URL(`https://stripe.example.invalid${path}`);
    if (url.pathname === "/checkout/sessions") {
      const items = state.hideLists ? [] : [...sessions.values()].filter((session) => !url.searchParams.get("status") || session.status === url.searchParams.get("status"));
      return { data: structuredClone(items), has_more: state.listHasMore };
    }
    if (url.pathname.startsWith("/subscriptions/")) return { id: "sub_paid", customer: "cus_account", status: state.subscriptionStatus };
    const session = sessions.get(url.pathname.split("/")[3]);
    assert.ok(session, `unknown session ${path}`);
    if (url.pathname.endsWith("/line_items")) return { data: [{ price: { id: session.price }, quantity: session.quantity }], has_more: false };
    return structuredClone(session);
  }
  async function post(path: string, params: URLSearchParams, options?: { idempotencyKey?: string | null }) {
    calls.push({ path, params: new URLSearchParams(params), key: options?.idempotencyKey ?? undefined });
    if (path.endsWith("/expire")) {
      const session = sessions.get(path.split("/")[3]); assert.ok(session);
      if (state.expireCompletes) { session.status = "complete"; throw new Error("already completed"); }
      assert.equal(session.status, "open"); session.status = "expired"; return structuredClone(session);
    }
    assert.equal(path, "/checkout/sessions");
    if (beforeCreate) await beforeCreate();
    const attemptKey = options?.idempotencyKey; assert.ok(attemptKey);
    if (state.failBeforeCreate) { state.failBeforeCreate = false; throw new Error("network failed before creation"); }
    const previousId = attempts.get(attemptKey);
    if (previousId) return structuredClone(sessions.get(previousId)!);
    const metadata: Row = {};
    for (const [key, value] of params) { const match = key.match(/^metadata\[(.+)\]$/); if (match) metadata[match[1]] = value; }
    const session = add({ metadata, price: params.get("line_items[0][price]")! });
    attempts.set(attemptKey, session.id);
    if (state.lostResponse) { state.lostResponse = false; throw new Error("network response lost"); }
    return structuredClone(session);
  }
  function params(price = "price_standard", trialEnd?: number) {
    const result = new URLSearchParams({ customer: "cus_account", mode: "subscription", client_reference_id: "user_account",
      "metadata[user_id]": "user_account", "metadata[plan]": "Standard", "line_items[0][price]": price, "line_items[0][quantity]": "1" });
    if (trialEnd) result.set("subscription_data[trial_end]", String(trialEnd));
    return result;
  }
  const withGuard = runtime.exports.withStripeCheckoutGuard;
  const input = (selected = params()) => ({ customerId: "cus_account", params: selected, get, post,
    isCommercialPrice: (price: string) => ["price_standard", "price_premium", "price_yearly"].includes(price),
    assertNoLiveSubscription: async () => { beforeCheck?.(); if (state.live) throw new Error("live subscription"); },
  });
  return { state, redis, sessions, calls, add, params, input, withGuard,
    setBeforeCreate: (callback: () => Promise<void>) => { beforeCreate = callback; },
    setBeforeCheck: (callback: () => void) => { beforeCheck = callback; },
    run: (selected = params()) => withGuard("user_account", (guard) => guard.resolveSession(input(selected))),
    creates: () => calls.filter((call) => call.path === "/checkout/sessions"),
    marker: () => [...redis.values()].find((value) => typeof value === "object") as Row,
  };
}

test("same offer reuses one session, exact trial date and shared Stripe customer", async () => {
  const f = fixture(); const trial = 1_900_000_000;
  const first = await f.run(f.params("price_standard", trial));
  const second = await f.run(f.params("price_standard", trial));
  assert.equal(first.id, second.id); assert.equal(first.reused, false); assert.equal(second.reused, true);
  assert.equal(second.trialEndUnix, trial); assert.equal(f.creates().length, 1);
});

test("different plan or cadence expires the previous payable link before creating a replacement", async () => {
  const f = fixture(); const first = await f.run(); const second = await f.run(f.params("price_yearly"));
  assert.notEqual(first.id, second.id); assert.equal(f.sessions.get(first.id)?.status, "expired");
  assert.equal([...f.sessions.values()].filter((session) => session.status === "open").length, 1);
  assert.notEqual(f.creates()[0].key, f.creates()[1].key);
});

test("two overlapping tabs cannot create independently and account lease remains owned", async () => {
  const f = fixture(); let release!: () => void; let entered!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  f.setBeforeCreate(async () => { entered(); await pending; });
  const first = f.run(); await started;
  await assert.rejects(f.run(f.params("price_premium")), { code: "CHECKOUT_IN_PROGRESS" });
  release(); await first; assert.equal(f.creates().length, 1);
});

for (const kind of ["unavailable", "disabled"] as const) test(`Redis ${kind} fails closed without an in-memory alternative`, async () => {
  const f = fixture(); if (kind === "unavailable") f.state.unavailable = true; else f.state.enabled = false;
  await assert.rejects(f.run(), { code: "CHECKOUT_GUARD_UNAVAILABLE", status: 503 }); assert.equal(f.calls.length, 0);
});

test("a lost creation response is reconciled from Stripe metadata without a second POST", async () => {
  const f = fixture(); f.state.lostResponse = true;
  await assert.rejects(f.run(), /network response lost/);
  assert.equal(f.marker().sessionId, undefined);
  const result = await f.run(); assert.equal(result.id, "cs_1"); assert.equal(result.reused, true);
  assert.equal(f.creates().length, 1); assert.equal(f.marker().sessionId, "cs_1");
});

test("uncertain creation is replayed only with the exact stored parameters and same idempotency key", async () => {
  const f = fixture(); f.state.lostResponse = true; await assert.rejects(f.run());
  f.state.hideLists = true;
  await assert.rejects(f.run(f.params("price_premium")), { code: "CHECKOUT_PENDING_RECONCILIATION" });
  assert.equal(f.creates().length, 1);
  const result = await f.run(); assert.equal(result.id, "cs_1");
  assert.equal(f.creates()[0].key, f.creates()[1].key);
  assert.equal(f.creates()[0].params?.toString(), f.creates()[1].params?.toString());
  assert.equal(f.sessions.size, 1);
});

test("an old unresolved attempt never outlives Stripe's safe idempotency replay window", async () => {
  const f = fixture(); f.state.lostResponse = true; await assert.rejects(f.run());
  f.state.hideLists = true; f.marker().createdAt = Date.now() - 24 * 60 * 60 * 1_000;
  await assert.rejects(f.run(), { code: "CHECKOUT_PENDING_RECONCILIATION" });
  assert.equal(f.creates().length, 1); assert.ok(f.marker(), "marker has no automatic TTL");
});

test("a short trial's changing technical deadline retries the original intent and original Stripe parameters", async () => {
  const f = fixture(); const sourceEnd = 1_900_000_000; const originalEffectiveEnd = sourceEnd + 40_000;
  const runTrial = (effective: number) => f.withGuard("user_account", (guard) => guard.resolveSession({
    ...f.input(f.params("price_standard", effective)), trialSourceEndUnix: sourceEnd,
  }));
  f.state.lostResponse = true;
  await assert.rejects(runTrial(originalEffectiveEnd), /network response lost/);
  f.state.hideLists = true;
  const result = await runTrial(originalEffectiveEnd + 60);
  assert.equal(result.trialEndUnix, originalEffectiveEnd);
  assert.equal(f.creates()[0].params?.toString(), f.creates()[1].params?.toString());
  assert.equal(f.creates()[0].key, f.creates()[1].key); assert.equal(f.sessions.size, 1);
  f.state.hideLists = false;
  const reused = await runTrial(originalEffectiveEnd + 120);
  assert.equal(reused.reused, true); assert.equal(reused.trialEndUnix, originalEffectiveEnd);
});

test("failure before Stripe creation can recover after the short-trial grace deadline moves", async () => {
  const f = fixture(); const sourceEnd = 1_900_000_000;
  const runTrial = (grace: number) => f.withGuard("user_account", (guard) => guard.resolveSession({
    ...f.input(f.params("price_standard", sourceEnd + grace)), trialSourceEndUnix: sourceEnd,
  }));
  f.state.failBeforeCreate = true; await assert.rejects(runTrial(40_000), /before creation/);
  assert.equal(f.sessions.size, 0);
  const recovered = await runTrial(40_060);
  assert.equal(recovered.trialEndUnix, sourceEnd + 40_000); assert.equal(f.sessions.size, 1);
  assert.equal(f.creates()[0].key, f.creates()[1].key);
  assert.equal(f.creates()[0].params?.toString(), f.creates()[1].params?.toString());
});

test("a stale worker completing Stripe creation cannot overwrite or release a successor's ownership", async () => {
  const f = fixture();
  f.setBeforeCreate(async () => {
    for (const key of f.redis.keys()) if (!key.includes(":attempt:")) f.redis.set(key, "successor");
  });
  await assert.rejects(f.run(), { code: "CHECKOUT_LOCK_LOST" });
  assert.equal(f.sessions.size, 1); assert.equal(f.marker().sessionId, undefined);
  assert.ok([...f.redis.values()].includes("successor"));
  for (const key of f.redis.keys()) if (!key.includes(":attempt:")) f.redis.delete(key);
  await f.run(); assert.equal(f.creates().length, 1);
});

test("lost lease before creation performs no Stripe mutation and cannot release a successor's lease", async () => {
  const f = fixture(); let checks = 0;
  f.setBeforeCheck(() => { if (++checks === 2) for (const key of f.redis.keys()) if (!key.includes(":attempt:")) f.redis.set(key, "successor"); });
  await assert.rejects(f.run(), { code: "CHECKOUT_LOCK_LOST" }); assert.equal(f.creates().length, 0);
  assert.ok([...f.redis.values()].includes("successor")); assert.ok(f.marker());
});

test("payment completing during expiration blocks replacement", async () => {
  const f = fixture(); await f.run(); f.state.expireCompletes = true;
  await assert.rejects(f.run(f.params("price_premium")), /already completed/); assert.equal(f.creates().length, 1);
});

test("completed checkout blocks while its subscription is live, even before local webhook synchronization", async () => {
  const f = fixture(); const created = await f.run();
  Object.assign(f.sessions.get(created.id)!, { status: "complete", subscription: "sub_paid" });
  await assert.rejects(f.run(), { code: "CHECKOUT_ALREADY_COMPLETED" }); assert.equal(f.creates().length, 1);
  f.state.subscriptionStatus = "canceled";
  const replacement = await f.run(); assert.notEqual(created.id, replacement.id);
});

test("Boutique payment links and unrelated subscription products are never expired", async () => {
  const f = fixture(); const payment = f.add({ mode: "payment" });
  const other = f.add({ metadata: { user_id: "someone_else", plan: "Other" }, price: "price_other" });
  await f.run(); assert.equal(payment.status, "open"); assert.equal(other.status, "open");
  assert.equal(f.calls.filter((call) => call.path.endsWith("/expire")).length, 0);
});

test("foreign or ambiguous commercial sessions prevent replacement instead of being expired", async () => {
  for (const foreign of [{ client_reference_id: "another_user" }, { quantity: 2 }, { metadata: { plan: "Standard" } }]) {
    const f = fixture(); f.add(foreign); await assert.rejects(f.run(), { code: "CHECKOUT_STATE_UNCERTAIN" });
    assert.equal(f.creates().length, 0); assert.equal(f.calls.filter((call) => call.path.endsWith("/expire")).length, 0);
  }
});

test("historical owned links are retired before the first controlled session", async () => {
  const f = fixture(); const old = f.add(); const second = f.add({ price: "price_premium" });
  await f.run(); assert.equal(old.status, "expired"); assert.equal(second.status, "expired"); assert.equal(f.creates().length, 1);
});

test("Redis failure after Stripe creation retains the attempt for safe reconciliation", async () => {
  const f = fixture(); f.state.failReadySave = true;
  await assert.rejects(f.run(), { code: "CHECKOUT_GUARD_UNAVAILABLE" });
  assert.equal(f.marker().sessionId, undefined); assert.equal(f.sessions.size, 1);
  await f.run(); assert.equal(f.creates().length, 1);
});

test("pagination uncertainty and existing live subscription fail closed", async () => {
  const f = fixture(); f.add(); f.state.listHasMore = true;
  await assert.rejects(f.run(), { code: "CHECKOUT_STATE_UNCERTAIN" }); assert.equal(f.creates().length, 0);
  const active = fixture(); active.state.live = true;
  await assert.rejects(active.run(), /live subscription/); assert.equal(active.creates().length, 0);
});

test("another account sharing a Stripe customer cannot replace the tracked account's checkout", async () => {
  const f = fixture(); await f.run();
  const selected = f.params(); selected.set("client_reference_id", "other_account"); selected.set("metadata[user_id]", "other_account");
  await assert.rejects(f.withGuard("other_account", (guard) => guard.resolveSession(f.input(selected))), { code: "CHECKOUT_STATE_UNCERTAIN" });
  assert.equal(f.creates().length, 1); assert.equal(f.sessions.get("cs_1")?.status, "open");
});
