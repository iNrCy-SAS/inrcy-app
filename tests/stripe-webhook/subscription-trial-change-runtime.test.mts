import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import test from "node:test";
import ts from "typescript";
import * as planChange from "../../lib/subscriptionPlanChange.ts";
import * as periods from "../../lib/stripeSubscription.ts";
import * as offers from "../../lib/subscriptionOffers.ts";

type Plan = "Standard" | "Premium";
type Cycle = "monthly" | "yearly";
type Row = Record<string, unknown>;
const price = (plan: Plan, cycle: Cycle, legacy = false) => `price_${plan}_${cycle}_${legacy ? "v1" : "v2"}`;
const output = ts.transpileModule(readFileSync(new URL("../../app/api/billing/change-plan/route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(options: { plan?: Plan; cycle?: Cycle; legacy?: boolean; subscription?: Row; row?: Row; returned?: Row; preview?: Row; invoice?: Row; updateFails?: boolean } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const trialEnd = now + 5 * 86_400;
  const currentPlan = options.plan ?? "Standard";
  const currentCycle = options.cycle ?? "monthly";
  const currentPrice = price(currentPlan, currentCycle, options.legacy);
  const catalog = new Map<string, { plan: Plan; edition: string; billingCycle: Cycle; pricingVersion: string }>();
  for (const plan of ["Standard", "Premium"] as const) for (const cycle of ["monthly", "yearly"] as const) for (const legacy of [false, true]) {
    catalog.set(price(plan, cycle, legacy), { plan, edition: plan.toLowerCase(), billingCycle: cycle,
      pricingVersion: legacy ? "legacy_ttc_v1" : "international_ht_v2" });
  }
  const item = (priceId: string) => ({ id: "si_trial", quantity: 1, current_period_end: trialEnd,
    price: { id: priceId, recurring: { interval: catalog.get(priceId)!.billingCycle === "monthly" ? "month" : "year", interval_count: 1 } } });
  const live: Row = { id: "sub_trial", customer: "cus_trial", metadata: { user_id: "user_trial" }, status: "trialing",
    trial_end: trialEnd, collection_method: "charge_automatically", automatic_tax: { enabled: true },
    latest_invoice: "in_zero_trial", items: { data: [item(currentPrice)], has_more: false }, ...options.subscription };
  const row = { app_edition: currentPlan.toLowerCase(), billing_provider: "stripe",
    stripe_customer_id: "cus_trial", stripe_subscription_id: "sub_trial", ...options.row };
  const posts: Array<{ path: string; params: URLSearchParams; idempotencyKey?: string }> = [];
  const gets: string[] = [];
  const modules = new Map<string, unknown>([
    ["node:crypto", { randomUUID }],
    ["next/server", { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } }],
    ["@/lib/billingCatalog", {
      commercialPriceFromId: (id: string) => catalog.get(id) ?? null,
      configuredPremiumPriceId: (cycle: Cycle, version: string) => price("Premium", cycle, version === "legacy_ttc_v1"),
      configuredStandardPriceId: (cycle: Cycle, version: string) => price("Standard", cycle, version === "legacy_ttc_v1"),
    }],
    ["@/lib/subscriptionOffers", offers], ["@/lib/subscriptionPlanChange", planChange], ["@/lib/stripeSubscription", periods],
    ["@/lib/requireUser", { requireUser: async () => {
      // No write methods are provided: entitlements remain webhook-owned.
      const query = { select() { return query; }, eq() { return query; }, maybeSingle: async () => ({ data: row, error: null }) };
      return { user: { id: "user_trial" }, supabase: { from: () => query } };
    } }],
    ["@/lib/stripeRest", {
      stripeGet: async (path: string) => {
        gets.push(path);
        if (path === "/subscriptions/sub_trial") return structuredClone(live);
        if (path === "/invoices/in_zero_trial") return { status: "paid", ...options.invoice };
        if (path === "/subscription_schedules/sched_other") return { id: "sched_other", status: "active", metadata: {} };
        throw new Error(`Unexpected Stripe read: ${path}`);
      },
      stripePost: async (path: string, body: URLSearchParams, config?: { idempotencyKey?: string }) => {
        const params = new URLSearchParams(body);
        posts.push({ path, params, idempotencyKey: config?.idempotencyKey });
        if (path === "/invoices/create_preview") {
          const priceId = params.get("subscription_details[items][0][price]")!;
          return { amount_due: 12960, currency: "eur", automatic_tax: { enabled: true, status: "complete" },
            lines: { data: [{ price: { id: priceId }, period: { end: now + 31 * 86_400 } }], has_more: false },
            ...options.preview };
        }
        if (path !== "/subscriptions/sub_trial") throw new Error(`Unexpected billing mutation: ${path}`);
        if (options.updateFails) throw new Error("Simulated transport failure");
        const immediate = params.get("trial_end") === "now";
        return { ...live, ...(immediate ? { status: "active", trial_end: now,
          latest_invoice: { status: "open", hosted_invoice_url: "https://pay.stripe.test/invoice" } } : {}),
          items: { data: [item(params.get("items[0][price]")!)] }, ...options.returned };
      },
    }],
  ]);
  const runtime = { exports: {} as { GET: (request: Request) => Promise<Response>; POST: (request: Request) => Promise<Response> } };
  new Function("module", "exports", "require", "console", "process", output)(runtime, runtime.exports, (name: string) => {
    assert.ok(modules.has(name), `Unmocked dependency: ${name}`);
    return modules.get(name);
  }, { error() {} }, { env: { STRIPE_SECRET_KEY: "not-a-real-key" } });
  return { posts, gets, now, trialEnd, currentPrice, live,
    get: (target: Plan, cycle: Cycle, activation?: "now" | "trial_end") => runtime.exports.GET(new Request(`https://example.invalid/api/billing/change-plan?target=${target}&billingCycle=${cycle}${activation ? `&activation=${activation}` : ""}`)),
    post: (body: unknown) => runtime.exports.POST(new Request("https://example.invalid/api/billing/change-plan", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    })),
  };
}

function confirmation(quote: Row) {
  return { targetPlan: quote.targetPlan, billingCycle: quote.billingCycle, expectedAmountDue: quote.amountDue,
    prorationDate: quote.prorationDate, expectedCurrentPriceId: quote.currentPriceId, expectedTargetPriceId: quote.targetPriceId,
    expectedTrialEndUnix: quote.trialEndUnix, trialChange: quote.trialChange };
}

for (const legacy of [false, true]) for (const plan of ["Standard", "Premium"] as const) for (const cycle of ["monthly", "yearly"] as const) {
  for (const target of ["Standard", "Premium"] as const) for (const targetCycle of ["monthly", "yearly"] as const) {
    if (plan === target && cycle === targetCycle) continue;
    test(`${legacy ? "legacy" : "HT"} trial ${plan}/${cycle} → ${target}/${targetCycle}: one contract, no debit, exact trial end`, async () => {
      const route = fixture({ plan, cycle, legacy });
      const response = await route.get(target, targetCycle);
      assert.equal(response.status, 200);
      const { quote, changeType } = await response.json();
      assert.equal(changeType, "trial");
      assert.equal(quote.trialChange, true);
      assert.equal(quote.amountDue, 0);
      assert.equal(quote.trialEndUnix, route.trialEnd);
      assert.equal(quote.renewalAt, new Date(route.trialEnd * 1000).toISOString());
      assert.equal(quote.targetPriceId, price(target, targetCycle));
      assert.equal(route.posts.length, 0, "reading a trial quote creates no invoice or contract");
      const applied = await route.post(confirmation(quote));
      assert.equal(applied.status, 200);
      assert.deepEqual(await applied.json(), { applied: true, pendingPayment: false, paymentUrl: null,
        targetPlan: target, billingCycle: targetCycle, renewalAt: quote.renewalAt, trialEndUnix: route.trialEnd, trialChange: true });
      assert.equal(route.posts.length, 1);
      assert.equal(route.posts[0].path, "/subscriptions/sub_trial");
      assert.deepEqual(Object.fromEntries(route.posts[0].params), {
        "items[0][id]": "si_trial", "items[0][price]": price(target, targetCycle),
        proration_behavior: "none", trial_end: String(route.trialEnd), payment_behavior: "error_if_incomplete",
      });
      assert.ok(route.posts[0].idempotencyKey?.includes(String(route.trialEnd)));
      assert.deepEqual(route.gets, ["/subscriptions/sub_trial", "/subscriptions/sub_trial"]);
    });
  }
}

for (const plan of ["Standard", "Premium"] as const) for (const cycle of ["monthly", "yearly"] as const) {
  test(`linked trial ${plan}/${cycle} can start Premium now after an exact taxed invoice preview`, async () => {
    const route = fixture({ plan, cycle });
    const response = await route.get("Premium", cycle, "now");
    assert.equal(response.status, 200);
    const { changeType, quote } = await response.json();
    assert.equal(changeType, "trial_immediate");
    assert.equal(quote.activation, "now");
    assert.equal(quote.trialChange, true);
    assert.equal(quote.amountDue, 12960);
    assert.equal(quote.trialEndUnix, route.trialEnd);
    assert.equal(route.posts.length, 1);
    assert.equal(route.posts[0].path, "/invoices/create_preview");
    assert.equal(route.posts[0].params.get("subscription_details[trial_end]"), "now");
    assert.equal(route.posts[0].params.get("subscription_details[items][0][price]"), price("Premium", cycle));
    assert.equal(route.posts[0].params.get("automatic_tax[enabled]"), "true");
    const applied = await route.post({ ...confirmation(quote), activation: "now" });
    assert.equal(applied.status, 200);
    assert.deepEqual(await applied.json(), { applied: true, pendingPayment: true,
      paymentUrl: "https://pay.stripe.test/invoice", targetPlan: "Premium", billingCycle: cycle,
      renewalAt: quote.renewalAt, trialChange: true, activation: "now" });
    assert.equal(route.posts.length, 3);
    assert.equal(route.posts[1].path, "/invoices/create_preview", "quote is rechecked immediately before mutation");
    assert.equal(route.posts[2].path, "/subscriptions/sub_trial");
    assert.deepEqual(Object.fromEntries(route.posts[2].params), {
      "items[0][id]": "si_trial", "items[0][price]": price("Premium", cycle),
      trial_end: "now", proration_behavior: "always_invoice", proration_date: String(quote.prorationDate),
      payment_behavior: "error_if_incomplete", "expand[]": "latest_invoice",
    });
    assert.ok(route.posts[2].idempotencyKey?.includes(String(route.trialEnd)));
  });
}

test("immediate trial activation is never offered for Standard", async () => {
  const route = fixture();
  assert.equal((await (await route.get("Standard", "monthly", "now")).json()).code, "INVALID_ACTIVATION");
  assert.equal((await (await route.post({ targetPlan: "Standard", activation: "now" })).json()).code, "INVALID_ACTIVATION");
  assert.equal(route.posts.length, 0);
});

test("an explicit trial activation choice cannot silently become an ordinary paid change after trial end", async () => {
  const route = fixture();
  route.live.status = "active";
  assert.equal((await (await route.get("Premium", "monthly", "trial_end")).json()).code, "QUOTE_CHANGED");
  assert.equal((await (await route.get("Premium", "monthly", "now")).json()).code, "QUOTE_CHANGED");
  assert.equal((await (await route.post({ targetPlan: "Premium", activation: "trial_end" })).json()).code, "QUOTE_CHANGED");
  assert.equal(route.posts.length, 0);
});

for (const [name, patch, code] of [
  ["amount", { expectedAmountDue: 1 }, "QUOTE_CHANGED"],
  ["trial end", { expectedTrialEndUnix: 1 }, "QUOTE_CHANGED"],
  ["source price", { expectedCurrentPriceId: "price_other" }, "QUOTE_CHANGED"],
  ["target price", { expectedTargetPriceId: "price_other" }, "QUOTE_CHANGED"],
  ["expired quote", { prorationDate: 1 }, "QUOTE_EXPIRED"],
] as const) test(`immediate activation rejects a changed ${name} before subscription update`, async () => {
  const route = fixture();
  const { quote } = await (await route.get("Premium", "monthly", "now")).json();
  assert.equal((await (await route.post({ ...confirmation(quote), activation: "now", ...patch })).json()).code, code);
  assert.equal(route.posts.filter(({ path }) => path === "/subscriptions/sub_trial").length, 0);
});

test("immediate activation refuses an unpaid trial invoice and an incomplete tax preview", async () => {
  const unpaid = fixture({ invoice: { status: "open" } });
  assert.equal((await (await unpaid.get("Premium", "monthly", "now")).json()).code, "UNPAID_INVOICE");
  assert.equal(unpaid.posts.length, 0);
  const untaxed = fixture({ preview: { automatic_tax: { enabled: true, status: "requires_location_inputs" } } });
  assert.equal((await (await untaxed.get("Premium", "monthly", "now")).json()).code, "QUOTE_UNAVAILABLE");
  assert.equal(untaxed.posts.filter(({ path }) => path === "/subscriptions/sub_trial").length, 0);
});

test("immediate activation does not claim success if Stripe leaves the trial active", async () => {
  const route = fixture({ returned: { status: "trialing" } });
  const { quote } = await (await route.get("Premium", "monthly", "now")).json();
  const response = await route.post({ ...confirmation(quote), activation: "now" });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "TRIAL_CHANGE_UNCONFIRMED");
});

test("unchanged trial preserves its current historical offer without repricing or writing", async () => {
  const route = fixture({ legacy: true });
  const body = await (await route.get("Standard", "monthly")).json();
  assert.equal(body.changeType, "unchanged");
  assert.equal(body.targetPriceId, route.currentPrice);
  assert.equal((await (await route.post({ targetPlan: "Standard", billingCycle: "monthly" })).json()).code, "ALREADY_ON_PLAN");
  assert.equal(route.posts.length, 0);
});

for (const [name, options, code] of [
  ["tax disabled", { subscription: { automatic_tax: { enabled: false } } }, "TAX_CONFIGURATION_REQUIRED"],
  ["missing trial end", { subscription: { trial_end: null } }, "TRIAL_ENDING"],
  ["expired trial", { subscription: { trial_end: 1 } }, "TRIAL_ENDING"],
  ["invalid trial end", { subscription: { trial_end: "invalid" } }, "TRIAL_ENDING"],
  ["cancellation pending", { subscription: { cancel_at_period_end: true } }, "SUBSCRIPTION_CHANGE_PENDING"],
  ["payment pending", { subscription: { pending_update: {} } }, "SUBSCRIPTION_CHANGE_PENDING"],
  ["scheduled change", { subscription: { schedule: "sched_other" } }, "SCHEDULE_MANAGED"],
  ["manual collection", { subscription: { collection_method: "send_invoice" } }, "MANUAL_COLLECTION"],
  ["native account", { row: { billing_provider: "app_store" } }, "NATIVE_MANAGEMENT_REQUIRED"],
] as const) test(`trial ${name} fails closed`, async () => {
  const route = fixture(options);
  assert.equal((await (await route.get("Premium", "yearly")).json()).code, code);
  assert.equal(route.posts.length, 0);
});

for (const [name, patch, code] of [
  ["target price", { expectedTargetPriceId: "price_other" }, "QUOTE_CHANGED"],
  ["source price", { expectedCurrentPriceId: "price_other" }, "QUOTE_CHANGED"],
  ["trial end", { expectedTrialEndUnix: 1 }, "QUOTE_CHANGED"],
  ["immediate payment", { expectedAmountDue: 20 }, "QUOTE_CHANGED"],
  ["missing trial confirmation", { trialChange: undefined }, "QUOTE_CHANGED"],
  ["expired quote", { prorationDate: 1 }, "QUOTE_EXPIRED"],
] as const) test(`trial confirmation rejects changed ${name} before mutation`, async () => {
  const route = fixture();
  const { quote } = await (await route.get("Premium", "yearly")).json();
  assert.equal((await (await route.post({ ...confirmation(quote), ...patch })).json()).code, code);
  assert.equal(route.posts.length, 0);
});

test("a trial quote cannot become a paid change after Stripe activates the subscription", async () => {
  const route = fixture();
  const { quote } = await (await route.get("Premium", "yearly")).json();
  route.live.status = "active";
  assert.equal((await (await route.post(confirmation(quote))).json()).code, "QUOTE_CHANGED");
  assert.equal(route.posts.length, 0);
});

test("an approaching trial end is refused before it can expire during a Stripe update", async () => {
  const route = fixture();
  const { quote } = await (await route.get("Premium", "yearly")).json();
  route.live.trial_end = Math.floor(Date.now() / 1000) + 30;
  assert.equal((await (await route.post(confirmation(quote))).json()).code, "TRIAL_ENDING");
  assert.equal(route.posts.length, 0);
});

for (const returned of [{ status: "active" }, { trial_end: 1 }, { pending_update: {} }, { id: "sub_other" }, { customer: "cus_other" }]) {
  test(`unexpected Stripe result cannot report trial success: ${JSON.stringify(returned)}`, async () => {
    const route = fixture({ returned });
    const { quote } = await (await route.get("Premium", "yearly")).json();
    const response = await route.post(confirmation(quote));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "TRIAL_CHANGE_UNCONFIRMED");
    assert.equal(route.posts.length, 1, "never retries through checkout or payment");
  });
}

test("an uncertain update is not reported as success and an exact retry reuses the same Stripe key", async () => {
  const route = fixture({ updateFails: true });
  const { quote } = await (await route.get("Premium", "yearly")).json();
  assert.equal((await route.post(confirmation(quote))).status, 503);
  assert.equal((await route.post(confirmation(quote))).status, 503);
  assert.equal(route.posts[0].idempotencyKey, route.posts[1].idempotencyKey);
  assert.deepEqual([...route.posts[0].params], [...route.posts[1].params]);
});
