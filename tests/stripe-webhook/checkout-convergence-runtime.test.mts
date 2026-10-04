import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as offers from "../../lib/subscriptionOffers.ts";
import * as payload from "../../lib/stripeWebhookPayload.ts";
import * as reconciliation from "../../lib/stripeWebhookReconciliation.ts";
import * as subscriberTerms from "../../lib/adminSubscriberStripe.ts";
import * as subscriptionDates from "../../lib/stripeSubscription.ts";
import { isCheckoutReturnSynchronized } from "../../lib/subscriptionCheckoutReturn.ts";

type Row = Record<string, unknown>;
type Plan = "Standard" | "Premium";
type Cycle = "monthly" | "yearly";
const compiled = new Map<string, string>();
function load<T>(path: string, modules: Record<string, unknown>): T {
  if (!compiled.has(path)) compiled.set(path, ts.transpileModule(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText);
  const runtime = { exports: {} as T };
  new Function("module", "exports", "require", "console", compiled.get(path)!)(runtime, runtime.exports, (name: string) => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected dependency: ${name}`);
    return modules[name];
  }, { info() {}, warn() {}, error() {} });
  return runtime.exports;
}

function fixture(plan: Plan, cycle: Cycle, trial = false) {
  const priceEnv = Object.fromEntries([
    "STANDARD_58HT_MONTHLY", "STANDARD_58HT_YEARLY", "PREMIUM_108HT_MONTHLY", "PREMIUM_108HT_YEARLY",
  ].map((key) => [`STRIPE_PRICE_${key}_ID`, `price_fixture_${key}`]));
  const catalog = load("lib/billingCatalog.ts", {
    "@/lib/env": { optionalEnv: (name: string) => priceEnv[name] ?? "" }, "@/lib/subscriptionOffers": offers,
  });
  const offer = offers.currentSubscriptionOffer(plan);
  const priceId = `price_fixture_${plan === "Premium" ? "PREMIUM_108HT" : "STANDARD_58HT"}_${cycle.toUpperCase()}`;
  const trialStart = 1_900_000_000;
  const trialEnd = trialStart + 48 * 3600 + 120;
  const row: Row = {
    user_id: "user_account", app_edition: "standard", plan: trial ? "Trial" : "Standard",
    status: trial ? "trialing" : "active", billing_cycle: cycle, scheduled_plan: plan,
    stripe_customer_id: "cus_account", stripe_subscription_id: null, monthly_price_eur: 0,
    trial_end_at: trial ? new Date((trialStart + 3600) * 1000).toISOString() : null,
  };
  const live: Row = {
    id: "sub_verified", customer: "cus_account", status: trial ? "trialing" : "active",
    metadata: { user_id: "user_account", billing_cycle: cycle, plan },
    ...(trial ? { trial_start: trialStart, trial_end: trialEnd } : {}),
    items: { data: [{ quantity: 1, current_period_end: trial ? trialEnd : trialStart + 30 * 86400,
      price: { id: priceId, unit_amount: (cycle === "yearly" ? offer.yearlyPriceEur : offer.monthlyPriceEur) * 100,
        currency: "eur", tax_behavior: "exclusive", recurring: { interval: cycle === "yearly" ? "year" : "month", interval_count: 1 } },
    }] },
  };
  const events = new Map<string, Row>();
  const writes: Row[] = [];
  const from = (table: string) => {
    let operation = "select";
    let patch: Row = {};
    const filters: Array<[string, unknown]> = [];
    const execute = (single: boolean) => {
      if (operation === "insert") {
        const id = String(patch.event_id);
        if (events.has(id)) return { data: null, error: { code: "23505" } };
        events.set(id, { ...patch });
        return { data: null, error: null };
      }
      const candidates = table === "subscriptions" ? [row] : table === "stripe_webhook_events" ? [...events.values()] : [];
      const matched = candidates.filter((record) => filters.every(([key, value]) => (record[key] ?? null) === value));
      if (operation === "update") for (const record of matched) {
        Object.assign(record, patch);
        if (table === "subscriptions") {
          // Mirror the database's authoritative Trial -> Standard trigger.
          if (record.plan === "Trial") record.app_edition = "standard";
          writes.push({ ...patch });
        }
      }
      return { data: single ? matched[0] ? { ...matched[0] } : null : matched.map((record) => ({ ...record })), error: null };
    };
    const query = {
      select() { return query; }, limit() { return query; },
      eq(key: string, value: unknown) { filters.push([key, value]); return query; },
      is(key: string, value: unknown) { filters.push([key, value]); return query; },
      ilike(key: string, value: unknown) { filters.push([key, value]); return query; },
      update(value: Row) { operation = "update"; patch = value; return query; },
      insert(value: Row) { operation = "insert"; patch = value; return query; },
      async maybeSingle() { return execute(true); },
      then(resolve: (value: unknown) => unknown) { return Promise.resolve(resolve(execute(false))); },
    };
    return query;
  };
  const route = load<{ POST(req: Request): Promise<Response> }>("app/api/stripe/webhook/route.ts", {
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/apiUserFacingErrors": { jsonUserFacingError: (error: unknown, init: { status: number }) => Response.json({ error: String(error) }, init) },
    "@/lib/supabaseAdmin": { supabaseAdmin: { from } },
    "@/lib/stripeRest": {
      verifyStripeWebhookSignature: (_body: string, sig: string) => { if (sig !== "fixture-verified") throw new Error("Invalid signature"); },
      stripeGet: async (path: string) => {
        if (path === "/subscriptions/sub_verified") return structuredClone(live);
        if (path === "/customers/cus_account") return { id: "cus_account", metadata: { user_id: "user_account" } };
        throw new Error(`Unexpected Stripe read: ${path}`);
      },
    },
    "@/lib/billingCatalog": catalog,
    "@/lib/adminSubscriberStripe": subscriberTerms,
    "@/lib/stripeSubscription": subscriptionDates,
    "@/lib/stripeWebhookPayload": payload,
    "@/lib/stripeWebhookReconciliation": reconciliation,
    "@/lib/subscriptionAdmin": { sendAdminSubscriptionAlertForUser: async () => {} },
    "@/lib/metaConversionOutbox": { enqueueMetaConversionEvent: async () => {} },
  });
  const checkout = {
    mode: "subscription", customer: "cus_account", subscription: "sub_verified", client_reference_id: "user_account",
    metadata: { user_id: "user_account", plan, billing_cycle: cycle },
  };
  const post = (type: string, object: Row, id = `evt_${type}`, signature = "fixture-verified") => route.POST(new Request("https://example.invalid/api/stripe/webhook", {
    method: "POST", headers: { "stripe-signature": signature }, body: JSON.stringify({ id, type, data: { object } }),
  }));
  return { row, writes, live, checkout, post, trialEnd };
}

for (const plan of ["Standard", "Premium"] as const) {
  for (const cycle of ["monthly", "yearly"] as const) {
    for (const trial of [false, true]) {
      test(`${trial ? "trial" : "complimentary"} account converges to ${plan} ${cycle} only through verified webhook events`, async () => {
        const run = fixture(plan, cycle, trial);
        const originalTrialEnd = run.row.trial_end_at;
        assert.equal((await run.post("checkout.session.completed", run.checkout)).status, 200);
        assert.equal(run.row.stripe_subscription_id, "sub_verified");
        assert.equal(run.row.app_edition, "standard", "checkout completion itself does not grant Premium");
        assert.equal(run.row.monthly_price_eur, 0);
        assert.equal(run.row.trial_end_at, originalTrialEnd, "checkout link does not change trial dates");
        if (plan === "Premium") assert.equal(isCheckoutReturnSynchronized(run.row, { plan, billingCycle: cycle }), false);
        const response = await run.post("customer.subscription.created", { id: "sub_verified", status: "past_due" });
        assert.equal(response.status, 200, JSON.stringify(await response.json()));
        assert.equal(run.row.app_edition, trial ? "standard" : plan.toLowerCase());
        assert.equal(run.row.billing_cycle, cycle);
        assert.equal(run.row.status, trial ? "trialing" : "active", "the live Stripe state overrides an out-of-order event snapshot");
        assert.equal(run.row.plan, trial ? "Trial" : plan);
        assert.equal(isCheckoutReturnSynchronized(run.row, { plan, billingCycle: cycle }), true);
        if (trial) assert.equal(run.row.trial_end_at, new Date(run.trialEnd * 1000).toISOString());
        else assert.ok(Number(run.row.monthly_price_eur) > 0);
        const writesBeforeDuplicate = run.writes.length;
        assert.deepEqual(await (await run.post("customer.subscription.created", { id: "sub_verified" })).json(), { received: true, duplicate: true });
        assert.equal(run.writes.length, writesBeforeDuplicate);
      });
    }
  }
}

test("a forged signature or contradictory Checkout identity cannot link or upgrade an account", async () => {
  const run = fixture("Premium", "monthly");
  assert.equal((await run.post("checkout.session.completed", run.checkout, "evt_bad_sig", "invalid")).status, 400);
  const response = await run.post("checkout.session.completed", { ...run.checkout, client_reference_id: "another_user" }, "evt_bad_identity");
  assert.deepEqual(await response.json(), { received: true, ignored: "identity_conflict" });
  assert.equal(run.row.app_edition, "standard");
  assert.equal(run.row.stripe_subscription_id, null);
  assert.deepEqual(run.writes, []);
});
