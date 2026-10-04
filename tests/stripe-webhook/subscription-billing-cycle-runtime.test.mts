import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import test from "node:test";
import ts from "typescript";
import * as planChange from "../../lib/subscriptionPlanChange.ts";
import * as subscriptionPeriods from "../../lib/stripeSubscription.ts";
import * as subscriptionOffers from "../../lib/subscriptionOffers.ts";

type Plan = "Standard" | "Premium";
type Cycle = "monthly" | "yearly";
type Version = "legacy_ttc_v1" | "international_ht_v2";
type ObjectRow = Record<string, unknown>;
const price = (plan: Plan, cycle: Cycle, version: Version) => `price_${plan}_${cycle}_${version}`;
const output = ts.transpileModule(readFileSync(new URL("../../app/api/billing/change-plan/route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(options: {
  plan?: Plan; cycle?: Cycle; version?: Version; pendingPayment?: boolean; paymentFails?: boolean;
  authenticated?: boolean; row?: ObjectRow; subscription?: ObjectRow; invoiceStatus?: string;
  schedule?: ObjectRow; missingRenewal?: boolean; previewAmount?: number; secondPreviewAmount?: number;
  statefulSchedules?: boolean;
  targetPricesMissing?: boolean; previewTaxStatus?: string | null; createdPhase?: ObjectRow;
} = {}) {
  const now = Math.floor(Date.now() / 1000);
  const plan = options.plan ?? "Standard";
  const cycle = options.cycle ?? "monthly";
  const version = options.version ?? "legacy_ttc_v1";
  const currentPrice = price(plan, cycle, version);
  const periodEnd = now + 86_400 * 10;
  const item = (id: string, billingCycle: Cycle, end = periodEnd) => ({
    id: "si_current", quantity: 1, current_period_end: end,
    price: { id, recurring: { interval: billingCycle === "yearly" ? "year" : "month", interval_count: 1 } },
  });
  const catalog = new Map<string, { plan: Plan; edition: string; billingCycle: Cycle; pricingVersion: Version }>();
  for (const plan of ["Standard", "Premium"] as const) for (const cycle of ["monthly", "yearly"] as const) {
    for (const version of ["legacy_ttc_v1", "international_ht_v2"] as const) {
      catalog.set(price(plan, cycle, version), { plan, edition: plan.toLowerCase(), billingCycle: cycle, pricingVersion: version });
    }
  }
  const live = {
    id: "sub_account", customer: "cus_account", metadata: { user_id: "user_1" }, status: "active",
    collection_method: "charge_automatically", latest_invoice: "in_paid",
    automatic_tax: { enabled: true },
    items: { data: [item(currentPrice, cycle)], has_more: false },
    ...(options.schedule ? { schedule: "sched_existing" } : {}), ...options.subscription,
  };
  const row = { app_edition: plan.toLowerCase(), billing_provider: "stripe", stripe_customer_id: "cus_account", stripe_subscription_id: "sub_account", ...options.row };
  const posts: Array<{ path: string; params: URLSearchParams; idempotencyKey?: string }> = [];
  const gets: string[] = [];
  const applied = new Map<string, ObjectRow>();
  const createdSchedules = new Map<string, ObjectRow>();
  const schedules = new Map<string, ObjectRow>();
  if (options.schedule) schedules.set("sched_existing", options.schedule);
  let scheduleExecutions = 0;
  let executions = 0;
  let previewCount = 0;
  const modules = new Map<string, unknown>([
    ["node:crypto", { randomUUID }],
    ["next/server", { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } }],
    ["@/lib/billingCatalog", {
      commercialPriceFromId: (id: string) => catalog.get(id) ?? null,
      configuredPremiumPriceId: (cycle: Cycle, version: Version) => options.targetPricesMissing ? "" : price("Premium", cycle, version),
      configuredStandardPriceId: (cycle: Cycle, version: Version) => options.targetPricesMissing ? "" : price("Standard", cycle, version),
    }],
    ["@/lib/subscriptionOffers", subscriptionOffers],
    ["@/lib/subscriptionPlanChange", planChange],
    ["@/lib/stripeSubscription", subscriptionPeriods],
    ["@/lib/requireUser", { requireUser: async () => {
      const query = {
        select() { return query; }, eq() { return query; },
        maybeSingle: async () => ({ data: row, error: null }),
      };
      return options.authenticated === false
        ? { errorResponse: Response.json({ error: "Unauthorized" }, { status: 401 }) }
        : { user: { id: "user_1" }, supabase: { from: () => query } };
    } }],
    ["@/lib/stripeRest", {
      stripeGet: async (path: string) => {
        gets.push(path);
        if (path === "/subscriptions/sub_account") return live;
        if (path === "/invoices/in_paid") return { status: options.invoiceStatus ?? "paid" };
        if (path.startsWith("/subscription_schedules/")) {
          const schedule = schedules.get(path.split("/").at(-1)!);
          if (schedule) return schedule;
        }
        throw new Error(`Unexpected read: ${path}`);
      },
      stripePost: async (path: string, original: URLSearchParams, { idempotencyKey }: { idempotencyKey?: string } = {}) => {
        const params = new URLSearchParams(original);
        posts.push({ path, params, idempotencyKey });
        if (path === "/invoices/create_preview") {
          previewCount++;
          const targetId = params.get("subscription_details[items][0][price]")!;
          const end = now + 86_400 * (catalog.get(targetId)?.billingCycle === "yearly" ? 365 : 30);
          return {
            amount_due: previewCount > 1 ? options.secondPreviewAmount ?? options.previewAmount ?? 1234 : options.previewAmount ?? 1234,
            currency: "eur",
            automatic_tax: { enabled: true, status: options.previewTaxStatus === undefined ? "complete" : options.previewTaxStatus },
            lines: { has_more: false, data: options.missingRenewal ? [] : [
              { pricing: { price_details: { price: targetId } }, parent: { subscription_item_details: { proration: false } }, period: { start: now, end } },
            ] },
          };
        }
        if (path === "/subscriptions/sub_account") {
          if (idempotencyKey && applied.has(idempotencyKey)) return applied.get(idempotencyKey);
          if (options.paymentFails) throw new Error("Simulated payment transport failure");
          executions++;
          const targetId = params.get("items[0][price]")!;
          const targetCycle = catalog.get(targetId)!.billingCycle;
          const end = targetCycle === cycle ? periodEnd : now + 86_400 * (targetCycle === "yearly" ? 365 : 30);
          const updated = options.pendingPayment
            ? { ...live, pending_update: { subscription_items: [{ price: targetId }] }, latest_invoice: { hosted_invoice_url: "https://invoice.stripe.test/pay" } }
            : { ...live, items: { data: [item(targetId, targetCycle, end)] } };
          if (idempotencyKey) applied.set(idempotencyKey, updated);
          return updated;
        }
        if (options.statefulSchedules && path === "/subscription_schedules") {
          if (idempotencyKey && createdSchedules.has(idempotencyKey)) return createdSchedules.get(idempotencyKey);
          if (live.schedule) throw new Error("Subscription already has an attached schedule");
          const created = { id: `sched_new_${++scheduleExecutions}`, subscription: "sub_account", status: "active", metadata: {}, phases: [{ start_date: now - 1000, end_date: periodEnd, items: [{ price: currentPrice, quantity: 1 }] }] };
          live.schedule = created.id;
          schedules.set(created.id, created);
          if (idempotencyKey) createdSchedules.set(idempotencyKey, structuredClone(created));
          return created;
        }
        if (options.statefulSchedules && path.startsWith("/subscription_schedules/")) {
          const id = path.split("/")[2];
          const schedule = schedules.get(id)!;
          if (path.endsWith("/release")) {
            schedule.status = "released";
            delete live.schedule;
            return schedule;
          }
          if (schedule.status !== "active") throw new Error("Released schedules cannot be updated");
          schedule.metadata = { inrcy_plan_change: params.get("metadata[inrcy_plan_change]"), inrcy_user_id: params.get("metadata[inrcy_user_id]") };
          schedule.phases = [{ items: [{ price: currentPrice }] }, { items: [{ price: params.get("phases[1][items][0][price]") }] }];
          return schedule;
        }
        if (path === "/subscription_schedules") return {
          id: "sched_new", subscription: "sub_account", phases: [{ start_date: now - 1000, end_date: periodEnd, items: [{ price: currentPrice, quantity: 1 }], ...options.createdPhase }],
        };
        if (path === "/subscription_schedules/sched_new" || path.endsWith("/release")) return {};
        throw new Error(`Unexpected mutation: ${path}`);
      },
    }],
  ]);
  const runtime = { exports: {} as { GET: (request: Request) => Promise<Response>; POST: (request: Request) => Promise<Response>; DELETE: () => Promise<Response> } };
  new Function("module", "exports", "require", "console", "process", output)(runtime, runtime.exports, (name: string) => {
    assert.ok(modules.has(name), `Unmocked dependency: ${name}`);
    return modules.get(name);
  }, { error() {} }, { env: { STRIPE_SECRET_KEY: "test-placeholder-not-a-real-key" } });
  return {
    posts, gets, currentPrice, periodEnd, now, catalog, executions: () => executions, scheduleExecutions: () => scheduleExecutions,
    get: (target: Plan, billingCycle?: string) => runtime.exports.GET(new Request(`https://example.invalid/api/billing/change-plan?target=${target}${billingCycle === undefined ? "" : `&billingCycle=${billingCycle}`}`)),
    post: (body: unknown) => runtime.exports.POST(new Request("https://example.invalid/api/billing/change-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })),
    delete: runtime.exports.DELETE,
  };
}

const confirmation = (quote: ObjectRow) => ({
  targetPlan: quote.targetPlan, billingCycle: quote.billingCycle, prorationDate: quote.prorationDate,
  expectedAmountDue: quote.amountDue, expectedTargetPriceId: quote.targetPriceId, expectedCurrentPriceId: quote.currentPriceId,
});

const downgradeConfirmation = (route: ReturnType<typeof fixture>, billingCycle: Cycle) => ({
  targetPlan: "Standard", billingCycle, expectedCurrentPriceId: route.currentPrice,
  expectedTargetPriceId: price("Standard", billingCycle, "international_ht_v2"),
});

for (const version of ["legacy_ttc_v1", "international_ht_v2"] as const) {
  for (const [plan, cycle, target, targetCycle] of [
    ["Standard", "monthly", "Standard", "yearly"], ["Standard", "yearly", "Standard", "monthly"],
    ["Premium", "monthly", "Premium", "yearly"], ["Premium", "yearly", "Premium", "monthly"],
    ["Standard", "monthly", "Premium", "yearly"], ["Standard", "yearly", "Premium", "monthly"],
    ["Standard", "monthly", "Premium", "monthly"], ["Standard", "yearly", "Premium", "yearly"],
  ] as const) test(`${version}: ${plan} ${cycle} → ${target} ${targetCycle} confirms the exact quote on the existing item`, async () => {
    const route = fixture({ plan, cycle, version });
    const preview = await route.get(target, targetCycle);
    assert.equal(preview.status, 200);
    const { quote } = await preview.json();
    assert.equal(quote.targetPriceId, price(target, targetCycle, "international_ht_v2"));
    assert.equal(quote.currentPriceId, route.currentPrice);
    assert.equal(quote.billingCycleChanged, cycle !== targetCycle);
    assert.ok(Number.isFinite(Date.parse(quote.renewalAt)));
    assert.deepEqual(route.posts.map(({ path }) => path), ["/invoices/create_preview"]);
    assert.equal(route.executions(), 0, "a quote must never change the paid contract");
    const response = await route.post(confirmation(quote));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.applied, true);
    assert.equal(body.pendingPayment, false);
    assert.equal(body.billingCycle, targetCycle);
    const update = route.posts.find((call) => call.path === "/subscriptions/sub_account")!;
    assert.equal(update.params.get("items[0][id]"), "si_current");
    assert.equal(update.params.get("items[0][price]"), quote.targetPriceId);
    assert.equal(update.params.get("payment_behavior"), "pending_if_incomplete");
    assert.equal(update.params.get("proration_behavior"), "always_invoice");
    assert.equal(update.params.get("proration_date"), String(quote.prorationDate));
    assert.equal(update.params.get("billing_cycle_anchor"), cycle !== targetCycle ? "now" : null);
    const secondPreview = route.posts.filter((call) => call.path === "/invoices/create_preview")[1];
    assert.equal(secondPreview.params.get("subscription_details[proration_behavior]"), "always_invoice");
    assert.equal(secondPreview.params.get("subscription_details[billing_cycle_anchor]"), cycle !== targetCycle ? "now" : null);
    assert.equal(secondPreview.params.get("subscription_details[proration_date]"), String(quote.prorationDate));
    assert.equal(secondPreview.params.get("automatic_tax[enabled]"), "true");
    assert.equal([...update.params.keys()].some((key) => /automatic_tax|tax_rates|discount/.test(key)), false);
    assert.ok(update.idempotencyKey?.includes(quote.targetPriceId));
    assert.ok(update.idempotencyKey?.includes(targetCycle));
    assert.equal(route.posts.some((call) => /checkout|customers/.test(call.path)), false);
  });
}

test("same plan and same cadence is unchanged; an invalid cadence fails closed", async () => {
  const route = fixture();
  assert.equal((await (await route.get("Standard", "monthly")).json()).changeType, "unchanged");
  assert.equal((await (await route.post({ targetPlan: "Standard", billingCycle: "monthly" })).json()).code, "ALREADY_ON_PLAN");
  assert.equal((await route.get("Premium", "weekly")).status, 400);
  assert.equal((await route.post({ targetPlan: "Premium", billingCycle: "" })).status, 400);
  assert.equal(route.posts.length, 0);
});

test("older clients omitting cadence keep the existing yearly cycle", async () => {
  const route = fixture({ cycle: "yearly", version: "international_ht_v2" });
  const { quote } = await (await route.get("Premium")).json();
  assert.equal(quote.billingCycle, "yearly");
  const response = await route.post({ targetPlan: "Premium", prorationDate: quote.prorationDate, expectedAmountDue: quote.amountDue });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).applied, true);
});

test("reading or resubmitting an unchanged legacy plan never migrates its price or taxes", async () => {
  const route = fixture({ targetPricesMissing: true, subscription: { automatic_tax: { enabled: false } } });
  const body = await (await route.get("Standard", "monthly")).json();
  assert.equal(body.changeType, "unchanged");
  assert.equal(body.targetPriceId, route.currentPrice);
  assert.equal((await (await route.post({ targetPlan: "Standard", billingCycle: "monthly" })).json()).code, "ALREADY_ON_PLAN");
  assert.equal(route.posts.length, 0);
});

test("missing current commercial prices never falls back to a legacy offer", async () => {
  const route = fixture({ targetPricesMissing: true });
  assert.equal((await (await route.get("Premium", "monthly")).json()).code, "TARGET_PRICE_UNAVAILABLE");
  assert.equal((await (await route.post({ targetPlan: "Premium", billingCycle: "monthly" })).json()).code, "TARGET_PRICE_UNAVAILABLE");
  assert.equal(route.posts.length, 0);
});

test("a cross-version zero-euro credit still requires both exact price IDs, even without cadence", async () => {
  const route = fixture({ cycle: "yearly", previewAmount: 0 });
  const { quote } = await (await route.get("Premium")).json();
  const originalClient = { targetPlan: "Premium", prorationDate: quote.prorationDate, expectedAmountDue: 0 };
  for (const ids of [
    {}, { expectedTargetPriceId: quote.targetPriceId }, { expectedCurrentPriceId: quote.currentPriceId },
    { expectedTargetPriceId: price("Premium", "yearly", "legacy_ttc_v1"), expectedCurrentPriceId: quote.currentPriceId },
  ]) {
    assert.equal((await (await route.post({ ...originalClient, ...ids })).json()).code, "QUOTE_CHANGED");
    assert.equal(route.executions(), 0);
  }
  assert.equal(route.posts.length, 1, "rejected confirmations must not issue another Stripe preview or update");
  assert.equal((await route.post({ ...confirmation(quote), billingCycle: undefined })).status, 200);
});

test("new legacy downgrades require confirmation of the V2 destination before creating any schedule", async () => {
  const route = fixture({ plan: "Premium" });
  const preview = await (await route.get("Standard", "yearly")).json();
  assert.equal(preview.currentPriceId, route.currentPrice);
  assert.equal(preview.targetPriceId, price("Standard", "yearly", "international_ht_v2"));
  for (const body of [
    { targetPlan: "Standard" }, { targetPlan: "Standard", billingCycle: "yearly" },
    { ...downgradeConfirmation(route, "yearly"), expectedTargetPriceId: price("Standard", "yearly", "legacy_ttc_v1") },
  ]) assert.equal((await (await route.post(body)).json()).code, "QUOTE_CHANGED");
  assert.equal(route.posts.length, 0);
});

test("an exclusive-tax change cannot silently enable or omit tax on incompatible contracts", async () => {
  for (const version of ["legacy_ttc_v1", "international_ht_v2"] as const) {
    for (const automaticTax of [undefined, { enabled: false }]) {
      const route = fixture({ version, subscription: { automatic_tax: automaticTax } });
      assert.equal((await (await route.get("Premium", "yearly")).json()).code, "TAX_CONFIGURATION_REQUIRED");
      assert.equal((await (await route.post({ targetPlan: "Premium", billingCycle: "yearly" })).json()).code, "TAX_CONFIGURATION_REQUIRED");
      assert.equal(route.posts.length, 0);
      const downgrade = fixture({ plan: "Premium", version, subscription: { automatic_tax: automaticTax } });
      assert.equal((await (await downgrade.get("Standard", "yearly")).json()).code, "TAX_CONFIGURATION_REQUIRED");
      assert.equal((await (await downgrade.post(downgradeConfirmation(downgrade, "yearly"))).json()).code, "TAX_CONFIGURATION_REQUIRED");
      assert.equal(downgrade.posts.length, 0);
    }
  }
});

test("an incomplete tax calculation cannot become a payable quote", async () => {
  for (const previewTaxStatus of [null, "failed", "requires_location_inputs"]) {
    const route = fixture({ previewTaxStatus });
    assert.equal((await (await route.get("Premium", "yearly")).json()).code, "QUOTE_UNAVAILABLE");
    assert.equal(route.executions(), 0);
    assert.deepEqual(route.posts.map(({ path }) => path), ["/invoices/create_preview"]);
  }
});

test("immediate price updates leave existing subscription discounts and taxes untouched", async () => {
  const route = fixture({ subscription: { discounts: [{ id: "di_existing" }] } });
  const { quote } = await (await route.get("Premium", "monthly")).json();
  assert.equal((await route.post(confirmation(quote))).status, 200);
  for (const call of route.posts) {
    assert.equal([...call.params.keys()].some((key) => /discount|tax_rates/.test(key)), false);
  }
  assert.equal(route.posts.at(-1)!.params.has("automatic_tax[enabled]"), false);
});

test("downgrades refuse custom discounts or manual taxes without removing them or attaching a schedule", async () => {
  for (const subscription of [
    { discounts: [{ id: "di_existing" }] }, { discount: { id: "di_old" } },
    { default_tax_rates: ["txr_manual"] },
    { items: { data: [{ id: "si_current", quantity: 1, current_period_end: Math.floor(Date.now() / 1000) + 86_400,
      price: { id: price("Premium", "monthly", "legacy_ttc_v1"), recurring: { interval: "month", interval_count: 1 } }, discounts: [{ id: "di_item" }] }] } },
  ]) {
    const route = fixture({ plan: "Premium", subscription });
    assert.equal((await (await route.get("Standard", "yearly")).json()).code, "SCHEDULE_UNSUPPORTED");
    assert.equal((await (await route.post(downgradeConfirmation(route, "yearly"))).json()).code, "SCHEDULE_UNSUPPORTED");
    assert.equal(route.posts.length, 0);
  }
});

test("a discount discovered on the newly created phase releases the schedule without overwriting it", async () => {
  const route = fixture({ plan: "Premium", createdPhase: { items: [{ price: price("Premium", "monthly", "legacy_ttc_v1"), quantity: 1, discounts: [{ id: "di_item" }] }] } });
  assert.equal((await (await route.post(downgradeConfirmation(route, "yearly"))).json()).code, "SCHEDULE_UNSUPPORTED");
  assert.deepEqual(route.posts.map(({ path }) => path), ["/subscription_schedules", "/subscription_schedules/sched_new/release"]);
});

test("historical schedules remain readable and cancellable without current prices or enabled tax", async () => {
  const scheduledPrice = price("Standard", "yearly", "legacy_ttc_v1");
  const schedule = { status: "active", metadata: { inrcy_plan_change: planChange.INRcy_DOWNGRADE_SCHEDULE_TAG, inrcy_user_id: "user_1" }, phases: [{}, { items: [{ price: scheduledPrice }] }] };
  const route = fixture({ plan: "Premium", schedule, targetPricesMissing: true, subscription: { automatic_tax: { enabled: false } } });
  assert.equal((await (await route.get("Standard")).json()).targetPriceId, scheduledPrice);
  assert.equal((await route.post({ targetPlan: "Standard" })).status, 200);
  assert.equal((await route.delete()).status, 200);
  assert.deepEqual(route.posts.map(({ path }) => path), ["/subscription_schedules/sched_existing/release"]);
});

test("confirmed prices, amount and quote age must still match before any payment", async () => {
  for (const override of [
    { expectedTargetPriceId: "price_wrong" }, { expectedCurrentPriceId: "price_stale" },
    { expectedAmountDue: 999 }, { prorationDate: Math.floor(Date.now() / 1000) - 601 },
    { billingCycle: "monthly" },
  ]) {
    const route = fixture();
    const { quote } = await (await route.get("Premium", "yearly")).json();
    assert.equal((await route.post({ ...confirmation(quote), ...override })).status, 409);
    assert.equal(route.executions(), 0);
  }
  const changed = fixture({ secondPreviewAmount: 9999 });
  const { quote } = await (await changed.get("Premium", "yearly")).json();
  assert.equal((await (await changed.post(confirmation(quote))).json()).code, "QUOTE_CHANGED");
  assert.equal(changed.executions(), 0);
});

test("replaying a confirmed cadence change uses the same Stripe idempotency key", async () => {
  const route = fixture();
  const { quote } = await (await route.get("Premium", "yearly")).json();
  assert.equal((await route.post(confirmation(quote))).status, 200);
  assert.equal((await route.post(confirmation(quote))).status, 200);
  assert.equal(route.executions(), 1);
});

test("failed or pending payments never report the cadence or upgrade as applied", async () => {
  const pending = fixture({ pendingPayment: true });
  const { quote } = await (await pending.get("Premium", "yearly")).json();
  const body = await (await pending.post(confirmation(quote))).json();
  assert.equal(body.applied, false);
  assert.equal(body.pendingPayment, true);
  assert.equal(body.renewalAt, null);
  assert.equal(body.paymentUrl, "https://invoice.stripe.test/pay");
  const failed = fixture({ paymentFails: true });
  const failedQuote = (await (await failed.get("Premium", "yearly")).json()).quote;
  assert.equal((await failed.post(confirmation(failedQuote))).status, 503);
  assert.equal(failed.executions(), 0);
});

test("unused annual credit may cover a monthly switch without inventing a minimum charge", async () => {
  const route = fixture({ cycle: "yearly", previewAmount: 0 });
  const { quote } = await (await route.get("Standard", "monthly")).json();
  assert.equal(quote.amountDue, 0);
  const response = await route.post(confirmation(quote));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).applied, true);
});

test("cadence changes retain authentication, ownership, payment and schedule guards", async () => {
  for (const options of [
    { authenticated: false }, { row: { app_edition: "founder" } }, { row: { billing_provider: "app_store" } },
    { row: { stripe_subscription_id: null } }, { subscription: { customer: "cus_other" } },
    { subscription: { metadata: { user_id: "user_other" } } }, { subscription: { status: "past_due" } },
    { subscription: { pending_update: {} } }, { subscription: { cancel_at_period_end: true } },
    { subscription: { collection_method: "send_invoice" } }, { invoiceStatus: "open" },
    { schedule: { status: "active", metadata: {} } },
  ]) {
    const route = fixture(options);
    assert.ok((await route.get("Standard", "yearly")).status >= 400);
    assert.ok((await route.post({ targetPlan: "Standard", billingCycle: "yearly" })).status >= 400);
    assert.equal(route.posts.length, 0);
  }
});

test("an unavailable target renewal date cannot produce a payable cadence quote", async () => {
  const route = fixture({ missingRenewal: true });
  assert.equal((await (await route.get("Premium", "yearly")).json()).code, "QUOTE_UNAVAILABLE");
  assert.equal(route.executions(), 0);
});

test("Premium downgrade preserves the paid period and starts the chosen cadence at renewal", async () => {
  const route = fixture({ plan: "Premium", cycle: "monthly" });
  const preview = await (await route.get("Standard", "yearly")).json();
  assert.equal(preview.changeType, "scheduled");
  assert.equal(preview.renewalAt, new Date(route.periodEnd * 1000).toISOString());
  assert.equal((await route.post(downgradeConfirmation(route, "yearly"))).status, 200);
  const update = route.posts.find((call) => call.path === "/subscription_schedules/sched_new")!;
  assert.equal(update.params.get("phases[0][items][0][price]"), route.currentPrice);
  assert.equal(update.params.get("phases[0][end_date]"), String(route.periodEnd));
  assert.equal(update.params.get("phases[1][items][0][price]"), price("Standard", "yearly", "international_ht_v2"));
  assert.equal(update.params.get("phases[1][proration_behavior]"), "none");
  assert.equal(update.params.get("phases[0][automatic_tax][enabled]"), "true");
  assert.equal(update.params.get("phases[1][automatic_tax][enabled]"), "true");
  assert.equal(route.posts.some((call) => call.path.includes("invoices") || call.path === "/subscriptions/sub_account"), false);
});

for (const scheduledVersion of ["legacy_ttc_v1", "international_ht_v2"] as const) test(`${scheduledVersion}: a scheduled downgrade is read at its exact agreed price and remains cancellable`, async () => {
  const scheduledPrice = price("Standard", "yearly", scheduledVersion);
  const schedule = { status: "active", metadata: { inrcy_plan_change: planChange.INRcy_DOWNGRADE_SCHEDULE_TAG, inrcy_user_id: "user_1" }, phases: [{}, { items: [{ price: scheduledPrice }] }] };
  const route = fixture({ plan: "Premium", schedule });
  assert.equal((await route.get("Standard", "yearly")).status, scheduledVersion === "international_ht_v2" ? 200 : 409);
  const legacyPreview = await (await route.get("Standard")).json();
  assert.equal(legacyPreview.pendingDowngrade, true);
  assert.equal(legacyPreview.billingCycle, "yearly");
  assert.equal(legacyPreview.targetPriceId, scheduledPrice);
  assert.equal((await route.post({ targetPlan: "Standard" })).status, 200);
  assert.equal((await route.post({ targetPlan: "Standard", billingCycle: "yearly" })).status, scheduledVersion === "international_ht_v2" ? 200 : 409);
  assert.equal((await route.post({ targetPlan: "Standard", billingCycle: "monthly" })).status, 409);
  assert.equal((await route.delete()).status, 200);
  assert.deepEqual(route.posts.map(({ path }) => path), ["/subscription_schedules/sched_existing/release"]);
});

for (const nextCycle of ["monthly", "yearly"] as const) {
  test(`cancel then recreate a downgrade with ${nextCycle} does not reuse the released Stripe schedule`, async () => {
    const route = fixture({ plan: "Premium", statefulSchedules: true });
    assert.equal((await route.post(downgradeConfirmation(route, "yearly"))).status, 200);
    assert.equal((await route.delete()).status, 200);
    assert.equal((await route.post(downgradeConfirmation(route, nextCycle))).status, 200);
    assert.equal(route.scheduleExecutions(), 2);
    const creationKeys = route.posts.filter(({ path }) => path === "/subscription_schedules").map(({ idempotencyKey }) => idempotencyKey);
    assert.equal(new Set(creationKeys).size, 2);
  });
}

test("concurrent downgrade confirmations can attach only one schedule and create no invoice", async () => {
  const route = fixture({ plan: "Premium", statefulSchedules: true });
  const responses = await Promise.all([
    route.post(downgradeConfirmation(route, "yearly")),
    route.post(downgradeConfirmation(route, "monthly")),
  ]);
  assert.ok(responses.some(({ status }) => status === 200));
  assert.equal(route.scheduleExecutions(), 1);
  assert.equal(route.executions(), 0);
});

test("renewal parsing supports old and new Stripe invoice lines without using unrelated credits", () => {
  const oldLine = { price: { id: "price_target" }, period: { end: 200 } };
  const newLine = { pricing: { price_details: { price: "price_target" } }, period: { end: 200 }, parent: { subscription_item_details: { proration: false } } };
  for (const line of [oldLine, newLine]) {
    assert.equal(planChange.previewRecurringPeriodEnd({ lines: { data: [line] } }, "price_target", 100), 200);
  }
  assert.equal(planChange.previewRecurringPeriodEnd({ lines: { data: [{ ...oldLine, proration: true }] } }, "price_target", 100), null);
  assert.equal(planChange.previewRecurringPeriodEnd({ lines: { data: [oldLine], has_more: true } }, "price_target", 100), null);
  assert.equal(planChange.previewRecurringPeriodEnd({ lines: { data: [oldLine, { ...oldLine, period: { end: 300 } }] } }, "price_target", 100), null);
});
