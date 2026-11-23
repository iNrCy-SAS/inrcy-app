import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as direct from "../../lib/directSignupPolicy.ts";
import * as offers from "../../lib/subscriptionOffers.ts";
import * as editions from "../../lib/dashboardEdition.ts";
import * as checkoutPolicy from "../../lib/subscriptionCheckoutPolicy.ts";
import * as preflight from "../../lib/stripeCheckoutPreflight.ts";
import * as webhookPayload from "../../lib/stripeWebhookPayload.ts";
import * as reconciliation from "../../lib/stripeWebhookReconciliation.ts";
import * as terms from "../../lib/adminSubscriberStripe.ts";
import * as dates from "../../lib/stripeSubscription.ts";

type Row = Record<string, unknown>;
type Plan = "Basic" | "Standard" | "Premium";
type Cycle = "monthly" | "yearly";
const USER = "11111111-1111-4111-8111-111111111111", CUSTOMER = "cus_account";
const marker = { [direct.DIRECT_SIGNUP_METADATA_KEY]: { version: 1, entry: "basique", created_at: "2026-11-19T12:00:00.000Z" } };
const priceEnv = Object.fromEntries(["BASIC_29HT_MONTHLY", "BASIC_309HT_YEARLY", "STANDARD_58HT_MONTHLY", "STANDARD_58HT_YEARLY", "PREMIUM_108HT_MONTHLY", "PREMIUM_108HT_YEARLY"].map(name => [`STRIPE_PRICE_${name}_ID`, `price_${name}`]));
const compiled = new Map<string, string>();
function load<T>(path: string, modules: Row, env: Record<string, string> = {}): T {
  if (!compiled.has(path)) compiled.set(path, ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText);
  const result = { exports: {} as T };
  new Function("module", "exports", "require", "process", "console", compiled.get(path)!)(result, result.exports, (name: string) => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected direct billing dependency ${name}`); return modules[name];
  }, { env }, { error() {}, warn() {}, info() {} });
  return result.exports;
}

/** The actual Checkout route, Redis guard, signature verifier, webhook and status
 * route share one account/Stripe state. No real SDK, account or network is used. */
function fixture(options: { legacyTrial?: boolean; userMetadataOnly?: boolean } = {}) {
  const row: Row = { user_id: USER, plan: options.legacyTrial ? "Trial" : "Basic", app_edition: options.legacyTrial ? "standard" : "basic",
    status: options.legacyTrial ? "trialing" : "incomplete", stripe_customer_id: CUSTOMER, stripe_subscription_id: null,
    billing_provider: "stripe", monthly_price_eur: 0, trial_start_at: options.legacyTrial ? new Date().toISOString() : null,
    trial_end_at: options.legacyTrial ? new Date(Date.now() + 7 * 86400_000).toISOString() : null };
  const auth = { user: { id: USER, email: "synthetic@example.invalid", app_metadata: options.legacyTrial || options.userMetadataOnly ? {} : marker,
    user_metadata: options.userMetadataOnly ? marker : {} } as Row | null };
  const writes: Array<{ table: string; patch: Row }> = [], requests: Array<{ path: string; params?: URLSearchParams; key?: string }> = [];
  const sessions = new Map<string, Row>(), subscriptions = new Map<string, Row>(), events = new Map<string, Row>();
  const redis = new Map<string, unknown>(), attempts = new Map<string, string>();
  const control = { lostResponse: false, redisDown: false, beforeCreate: null as (() => Promise<void>) | null };
  function from(table: string) {
    assert.ok(["subscriptions", "profiles", "stripe_webhook_events"].includes(table));
    let operation = "select", patch: Row = {};
    const filters: Array<(value: Row) => boolean> = [];
    function execute(single = false) {
      if (operation === "insert") {
        assert.equal(table, "stripe_webhook_events"); const id = String(patch.event_id);
        if (events.has(id)) return { data: null, error: { code: "23505" } };
        events.set(id, { ...patch }); return { data: null, error: null };
      }
      const rows = table === "subscriptions" ? [row] : table === "profiles" ? [{ user_id: USER, admin_email: "synthetic@example.invalid", contact_email: "synthetic@example.invalid" }] : [...events.values()];
      const matched = rows.filter(value => filters.every(filter => filter(value)));
      if (operation === "update") for (const value of matched) { Object.assign(value, patch); writes.push({ table, patch: { ...patch } }); }
      return { data: single ? matched[0] ? { ...matched[0] } : null : matched.map(value => ({ ...value })), error: null };
    }
    const q = { select: () => q, limit: () => q,
      eq: (field: string, value: unknown) => { filters.push(item => (item[field] ?? null) === value); return q; },
      neq: (field: string, value: unknown) => { filters.push(item => item[field] !== value); return q; },
      is: (field: string, value: unknown) => { filters.push(item => (item[field] ?? null) === value); return q; },
      in: (field: string, values: unknown[]) => { filters.push(item => values.includes(item[field])); return q; },
      ilike: (field: string, value: string) => { filters.push(item => String(item[field] ?? "").toLowerCase() === value.toLowerCase()); return q; },
      update: (value: Row) => { operation = "update"; patch = value; return q; },
      insert: (value: Row) => { operation = "insert"; patch = value; return q; },
      maybeSingle: async () => execute(true), then: (resolve: (value: ReturnType<typeof execute>) => unknown) => Promise.resolve(execute()).then(resolve),
    };
    return q;
  }
  class FakeRedis {
    async set(key: string, value: unknown) { if (control.redisDown) throw new Error("synthetic Redis unavailable"); if (redis.has(key)) return null; redis.set(key, value); return "OK"; }
    async get(key: string) { if (control.redisDown) throw new Error("synthetic Redis unavailable"); return redis.get(key) ?? null; }
    async eval(script: string, keys: string[], args: unknown[]) {
      if (control.redisDown) throw new Error("synthetic Redis unavailable");
      if (redis.get(keys[0]) !== args[0]) return 0;
      if (script.startsWith("-- checkout-save")) { if (redis.get(keys[1]) !== args[0]) return 0; redis.set(keys[2], JSON.parse(String(args[1]))); }
      if (script.startsWith("-- checkout-release")) redis.delete(keys[0]);
      return 1;
    }
  }
  const env = { optionalEnv: (name: string, fallback = "") => priceEnv[name] ?? (name === "NEXT_PUBLIC_APP_URL" ? "https://app.example.invalid" : name.startsWith("KV_") ? "synthetic-redis" : fallback),
    requireEnv: (name: string) => name === "STRIPE_WEBHOOK_SECRET" ? "synthetic-webhook-secret" : "synthetic-stripe-key" };
  const catalog = load<Row>("lib/billingCatalog.ts", { "@/lib/env": env, "@/lib/subscriptionOffers": offers });
  const guard = load<Row>("lib/stripeCheckoutSessionGuard.ts", { "server-only": {}, "node:crypto": crypto,
    "@upstash/redis": { Redis: FakeRedis }, "@/lib/env": env, "@/lib/upstashMode": { shouldBypassUpstashInCurrentEnv: () => false } });
  const signature = load<{ verifyStripeWebhookSignature(payload: string, signature: string | null): void }>("lib/stripeRest.ts", { "server-only": {}, crypto, "@/lib/env": env });
  async function get(path: string): Promise<unknown> {
    requests.push({ path }); const url = new URL(path, "https://stripe.example.invalid");
    if (url.pathname === `/customers/${CUSTOMER}`) return { id: CUSTOMER, metadata: { user_id: USER }, email: "synthetic@example.invalid" };
    if (url.pathname === "/customers" || url.pathname === "/customers/search") return { data: [{ id: CUSTOMER, metadata: { user_id: USER } }], has_more: false };
    if (url.pathname === "/subscriptions") return { data: [...subscriptions.values()], has_more: false };
    if (url.pathname.startsWith("/subscriptions/")) { const sub = subscriptions.get(url.pathname.split("/")[2]); assert.ok(sub); return structuredClone(sub); }
    if (url.pathname === "/checkout/sessions") return { data: [...sessions.values()].filter(session => !url.searchParams.has("status") || session.status === url.searchParams.get("status")), has_more: false };
    const session = sessions.get(url.pathname.split("/")[3]); assert.ok(session, `Unexpected Stripe read ${path}`);
    if (url.pathname.endsWith("/line_items")) return { data: [{ price: { id: session.price }, quantity: 1 }], has_more: false };
    return structuredClone(session);
  }
  async function post(path: string, params: URLSearchParams, options?: { idempotencyKey?: string | null }): Promise<unknown> {
    requests.push({ path, params: new URLSearchParams(params), key: options?.idempotencyKey ?? undefined });
    if (path === "/billing_portal/sessions") return { url: "https://billing.stripe.com/synthetic" };
    if (path.endsWith("/expire")) { const session = sessions.get(path.split("/")[3]); assert.ok(session); assert.equal(session.status, "open"); session.status = "expired"; return structuredClone(session); }
    assert.equal(path, "/checkout/sessions"); await control.beforeCreate?.();
    const key = options?.idempotencyKey; assert.ok(key);
    const previous = attempts.get(key); if (previous) return structuredClone(sessions.get(previous));
    const metadata: Row = {}; for (const [field, value] of params) { const match = field.match(/^metadata\[(.+)\]$/); if (match) metadata[match[1]] = value; }
    const id = `cs_${sessions.size + 1}`;
    const session = { id, customer: CUSTOMER, client_reference_id: USER, mode: "subscription", status: "open", metadata,
      url: `https://checkout.stripe.com/synthetic/${id}`, price: params.get("line_items[0][price]"), quantity: 1 };
    sessions.set(id, session); attempts.set(key, id);
    if (control.lostResponse) { control.lostResponse = false; throw new Error("synthetic Stripe response lost"); }
    return structuredClone(session);
  }
  const common = { "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/supabaseAdmin": { supabaseAdmin: { from } }, "@/lib/directSignupPolicy": direct,
    "@/lib/stripeRest": { ...signature, stripeGet: get, stripePost: post, getAppUrl: () => "https://app.example.invalid" }, "@/lib/billingCatalog": catalog };
  const checkout = load<{ POST(request: Request): Promise<Response> }>("app/api/billing/checkout/route.ts", { ...common,
    "@/lib/requireUser": { requireUser: async () => auth.user ? { supabase: { from }, user: structuredClone(auth.user), activeUserId: "unrelated-establishment", errorResponse: null } : { errorResponse: Response.json({ error: "auth_required" }, { status: 401 }) } },
    "@/lib/subscriptionOffers": offers, "@/lib/dashboardEdition": editions, "@/lib/subscriptionCheckoutPolicy": checkoutPolicy,
    "@/lib/stripeCheckoutSessionGuard": guard, "@/lib/stripeCheckoutPreflight": preflight,
    "@/lib/trialSubscription": { getTrialDays: () => 21, computeTrialDatesFromStartDate: () => assert.fail("a complete date must not need trial repair") },
    "@/lib/userFacingErrors": { getSimpleFrenchErrorMessage: (_error: unknown, fallback: string) => fallback },
  }, { STRIPE_SECRET_KEY: "synthetic-stripe-key" });
  const webhook = load<{ POST(request: Request): Promise<Response> }>("app/api/stripe/webhook/route.ts", { ...common,
    "@/lib/accountBillingSubscriptionServer": { getApprovedAccountSubscriptionByStripeId: async () => null },
    "@/lib/apiUserFacingErrors": { jsonUserFacingError: (_error: unknown, init: ResponseInit) => Response.json({ error: "synthetic_failure" }, init) },
    "@/lib/adminSubscriberStripe": terms, "@/lib/stripeSubscription": dates, "@/lib/stripeWebhookPayload": webhookPayload, "@/lib/stripeWebhookReconciliation": reconciliation,
    "@/lib/subscriptionAdmin": { sendAdminSubscriptionAlertForUser: async () => {} }, "@/lib/metaConversionOutbox": { enqueueMetaConversionEvent: async () => {} },
    "@/lib/boutique/videoCreditPayments": { VIDEO_CREDIT_PAYMENT_KIND: "inrcy_video_credits_v1", fulfillVideoCreditCheckout: async () => false, reconcileVideoCreditRefund: async () => false, reconcileVideoCreditDispute: async () => false },
    "@/lib/boutique/imageCreditPayments": { IMAGE_CREDIT_PAYMENT_KIND: "inrcy_image_credits_v1", fulfillImageCreditCheckout: async () => false, reconcileImageCreditRefund: async () => false, reconcileImageCreditDispute: async () => false },
  });
  const repair = load("lib/directSignupServer.ts", { "server-only": {}, "@/lib/directSignupPolicy": direct, "@/lib/supabaseAdmin": { supabaseAdmin: { from } },
    "@/lib/inrcyAccountProvisioning": { ensurePrincipalInrcyAccountProvisioned: () => assert.fail("known billing contract must not be repaired") } });
  const status = load<{ GET(): Promise<Response> }>("app/api/auth/direct-signup/status/route.ts", { ...common, "@/lib/directSignupServer": repair,
    "@/lib/supabaseServer": { createSupabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user: structuredClone(auth.user) }, error: null }) } }) },
  });
  function completePayment(plan: Plan, cycle: Cycle, subStatus = "active") {
    const session = [...sessions.values()].find(item => item.status === "open"); assert.ok(session);
    const offer = offers.currentSubscriptionOffer(plan), amount = cycle === "yearly" ? offer.yearlyPriceEur : offer.monthlyPriceEur;
    const sub = { id: "sub_verified", customer: CUSTOMER, status: subStatus, metadata: { user_id: USER, plan, billing_cycle: cycle },
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
      items: { data: [{ quantity: 1, price: { id: session.price, unit_amount: Math.round(amount * 100), currency: "eur", tax_behavior: "exclusive", recurring: { interval: cycle === "yearly" ? "year" : "month", interval_count: 1 } } }] } };
    subscriptions.set(sub.id, sub); session.status = "complete"; session.subscription = sub.id;
    return { session, sub };
  }
  return { row, auth, writes, requests, sessions, subscriptions, events, control, completePayment,
    checkout: (plan: Plan = "Basic", cycle: Cycle = "monthly", extra: Row = {}) => checkout.POST(new Request("https://app.example.invalid/api/billing/checkout", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan, billingCycle: cycle, ...extra }),
    })),
    status: () => status.GET(),
    deliver: (type: string, object: Row, id = `evt_${type}`, valid = true) => {
      const raw = JSON.stringify({ id, type, created: Math.floor(Date.now() / 1000), data: { object } });
      const timestamp = Math.floor(Date.now() / 1000);
      const hmac = crypto.createHmac("sha256", "synthetic-webhook-secret").update(`${timestamp}.${raw}`).digest("hex");
      return webhook.POST(new Request("https://app.example.invalid/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": `t=${timestamp},v1=${valid ? hmac : "0".repeat(64)}` }, body: raw }));
    },
    creates: () => requests.filter(request => request.path === "/checkout/sessions" && request.params),
  };
}

for (const plan of ["Basic", "Standard", "Premium"] as const) for (const cycle of ["monthly", "yearly"] as const) {
  test(`direct ${plan} ${cycle} creates the exact paid offer without any Stripe trial or premature access`, async () => {
    const f = fixture(); const response = await f.checkout(plan, cycle); assert.equal(response.status, 200);
    assert.equal(f.creates().length, 1); const params = f.creates()[0].params!;
    const expected = plan === "Basic" ? cycle === "yearly" ? "BASIC_309HT_YEARLY" : "BASIC_29HT_MONTHLY" : `${plan === "Standard" ? "STANDARD_58HT" : "PREMIUM_108HT"}_${cycle.toUpperCase()}`;
    assert.equal(params.get("line_items[0][price]"), priceEnv[`STRIPE_PRICE_${expected}_ID`]);
    assert.equal(params.get("subscription_data[trial_end]"), null); assert.equal(params.get("subscription_data[trial_period_days]"), null);
    assert.equal([...params.keys()].some(key => key.startsWith("custom_text[")), false, "direct Checkout sends no custom text block");
    assert.equal(params.get("subscription_data[metadata][plan]"), plan); assert.equal(params.get("client_reference_id"), USER);
    assert.match(params.get("success_url")!, new RegExp(`/activer-mon-compte\\?checkout=success&billing=${cycle}&checkout_plan=${plan}$`));
    assert.match(params.get("cancel_url")!, /\/dashboard\?panel=abonnement&checkout=cancel$/);
    assert.equal(f.row.status, "incomplete"); assert.equal(f.row.plan, "Basic"); assert.equal(f.row.trial_end_at, null);
    assert.equal((await (await f.status()).json()).paid, false);
    const forbidden = ["status", "app_edition", "plan", "trial_start_at", "trial_end_at", "monthly_price_eur"];
    assert.ok(f.writes.filter(write => write.table === "subscriptions").every(write => forbidden.every(key => !(key in write.patch))));
  });
}

test("saved language and request body cannot add custom Checkout text or create another payable session", async () => {
  const f = fixture(); assert.ok(f.auth.user);
  f.auth.user.user_metadata = { app_language: "en_GB", app_locale: "fr-FR" };
  assert.equal((await f.checkout("Basic", "monthly", { app_language: "de", app_locale: "de-DE", locale: "de",
    custom_text: { submit: { message: "Untrusted custom text" } }, "custom_text[submit][message]": "Untrusted form text" })).status, 200);
  assert.equal([...f.creates()[0].params!.keys()].some(key => key.startsWith("custom_text[")), false);
  assert.equal(f.creates()[0].params!.has("subscription_data[trial_end]"), false);
  assert.equal((await f.checkout("Basic", "monthly", { app_language: "zh", locale: "zh" })).status, 200);
  assert.equal(f.creates().length, 1, "body display preferences do not create another billing intent");
  f.auth.user.user_metadata = { app_language: "unsupported", app_locale: "nl-BE" };
  assert.equal((await f.checkout()).status, 200);
  assert.equal(f.creates().length, 1, "a language change keeps the same text-free Checkout");
  assert.equal([...f.sessions.values()].filter(session => session.status === "open").length, 1);
  assert.equal([...f.sessions.values()].filter(session => session.status === "expired").length, 0);
  assert.equal(f.row.status, "incomplete"); assert.equal((await (await f.status()).json()).paid, false);
});

test("refresh, abandonment and reconnect reuse one payable Checkout without activating the pending account", async () => {
  const f = fixture(); const first = await (await f.checkout()).json();
  f.auth.user = null; assert.equal((await f.checkout()).status, 401);
  f.auth.user = { id: USER, email: "synthetic@example.invalid", app_metadata: marker };
  const second = await (await f.checkout()).json(); assert.equal(first.url, second.url); assert.equal(f.creates().length, 1);
  assert.equal((await (await f.status()).json()).paid, false); assert.equal(f.row.trial_end_at, null);
  assert.equal((await f.checkout("Premium", "monthly")).status, 200);
  assert.equal([...f.sessions.values()].filter(session => session.status === "open").length, 1);
  assert.equal([...f.sessions.values()].filter(session => session.status === "expired").length, 1);
  assert.equal(f.row.status, "incomplete");
});

test("overlapping tabs and a lost Stripe response cannot create duplicate subscriptions or independent payable sessions", async () => {
  const f = fixture(); let release!: () => void, enter!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { enter = resolve; });
  f.control.beforeCreate = async () => { enter(); await waiting; };
  const first = f.checkout(); await started;
  const overlap = await f.checkout("Premium"); assert.equal(overlap.status, 409); assert.equal((await overlap.json()).code, "CHECKOUT_IN_PROGRESS");
  release(); assert.equal((await first).status, 200); assert.equal(f.creates().length, 1);
  const lost = fixture(); lost.control.lostResponse = true; assert.equal((await lost.checkout()).status, 500);
  assert.equal((await lost.checkout()).status, 200); assert.equal(lost.creates().length, 1); assert.equal(lost.sessions.size, 1);
  const closed = fixture(); closed.control.redisDown = true;
  assert.equal((await closed.checkout()).status, 503); assert.equal(closed.creates().length, 0);
});

test("a paid Stripe contract found during browser recovery is linked without granting access or creating another subscription", async () => {
  const f = fixture(); await f.checkout(); f.completePayment("Basic", "monthly");
  const response = await f.checkout(); assert.equal(response.status, 200); assert.equal((await response.json()).recoveredSubscription, true);
  assert.equal(f.creates().length, 1); assert.equal(f.row.stripe_subscription_id, "sub_verified");
  assert.equal(f.row.status, "incomplete"); assert.equal((await (await f.status()).json()).paid, false);
});

for (const plan of ["Basic", "Standard", "Premium"] as const) test(`only verified current Stripe activation grants ${plan}; checkout completion, forged signatures, replay and stale events cannot invent access`, async () => {
  const f = fixture(); await f.checkout(plan); const { session } = f.completePayment(plan, "monthly");
  assert.equal((await f.deliver("checkout.session.completed", session, "evt_invalid", false)).status, 400);
  assert.equal(f.row.status, "incomplete"); assert.equal(f.events.has("evt_invalid"), false);
  assert.equal((await f.deliver("checkout.session.completed", session)).status, 200);
  assert.equal(f.row.status, "incomplete"); assert.equal((await (await f.status()).json()).paid, false);
  const activated = await f.deliver("customer.subscription.created", { id: "sub_verified", status: "past_due" }); assert.equal(activated.status, 200);
  assert.equal(f.row.status, "active"); assert.equal(f.row.plan, plan); assert.equal(f.row.trial_end_at, null);
  const paid = await (await f.status()).json(); assert.equal(paid.paid, true); assert.equal(paid.plan, plan); assert.equal(paid.nextUrl, "/dashboard");
  const writes = f.writes.length;
  assert.equal((await f.deliver("customer.subscription.created", { id: "sub_verified" })).status, 200); assert.equal(f.writes.length, writes);
  assert.equal((await f.deliver("customer.subscription.updated", { id: "sub_verified", status: "incomplete" }, "evt_late")).status, 200);
  assert.equal(f.row.status, "active", "current Stripe state wins over a delayed snapshot");
  assert.equal((await f.checkout()).status, 409); assert.equal(f.creates().length, 1);
});

test("a forged user marker cannot remove a real21-day trial, and trial activation parameters cannot enter direct purchase", async () => {
  const legacy = fixture({ legacyTrial: true, userMetadataOnly: true });
  const originalEnd = legacy.row.trial_end_at;
  assert.equal((await legacy.checkout("Basic")).status, 200);
  assert.ok(legacy.creates()[0].params!.has("subscription_data[trial_end]")); assert.equal(legacy.row.trial_end_at, originalEnd);
  assert.equal(legacy.creates()[0].params!.has("custom_text[submit][message]"), false, "existing trial Checkout keeps its own terms");
  const f = fixture(); assert.equal((await f.checkout("Premium", "monthly", { premiumActivation: "trial_end", trial_days: 21, status: "active" })).status, 400);
  assert.equal(f.creates().length, 0); assert.equal(f.row.status, "incomplete");
});
