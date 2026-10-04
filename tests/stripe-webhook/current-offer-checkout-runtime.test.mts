import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as offers from "../../lib/subscriptionOffers.ts";
import * as checkoutPolicy from "../../lib/subscriptionCheckoutPolicy.ts";
import * as dashboardEdition from "../../lib/dashboardEdition.ts";
import type { CommercialPriceMatch } from "../../lib/billingCatalog.ts";
import { startSubscriptionCheckout } from "../../lib/clientSubscriptionBilling.ts";
import type { CheckoutSessionInput, StripeCheckoutGuard } from "../../lib/stripeCheckoutSessionGuard.ts";

type Row = Record<string, unknown>;
type Plan = "Standard" | "Premium";
type Cycle = "monthly" | "yearly";
const priceEnv = Object.fromEntries([
  "STANDARD_MONTHLY", "STANDARD_YEARLY", "PREMIUM_MONTHLY", "PREMIUM_YEARLY",
  "STANDARD_58HT_MONTHLY", "STANDARD_58HT_YEARLY", "PREMIUM_108HT_MONTHLY", "PREMIUM_108HT_YEARLY",
].map((key) => [`STRIPE_PRICE_${key}_ID`, `price_fixture_${key}`]));
const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const compiled = new Map<string, string>();

function load<T>(path: string, modules: Record<string, unknown>, env: Record<string, string> = {}): T {
  if (!compiled.has(path)) compiled.set(path, ts.transpileModule(source(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText);
  const runtime = { exports: {} as T };
  new Function("module", "exports", "require", "process", "console", compiled.get(path)!)(
    runtime, runtime.exports,
    (name: string) => {
      assert.ok(Object.hasOwn(modules, name), `Unexpected dependency: ${name}`);
      return modules[name];
    },
    { env }, { error() {} },
  );
  return runtime.exports;
}

function fixture(options: { createdAt?: string | null; row?: Row; missingPrice?: string; recovered?: boolean; recoveredPrice?: string;
  guardError?: { code: string; status: 409 | 503 }; guardedTrialEnd?: number } = {}) {
  const configured = { ...priceEnv };
  if (options.missingPrice) delete configured[options.missingPrice];
  const catalog = load<{ commercialPriceFromId(value: unknown): CommercialPriceMatch | null }>("lib/billingCatalog.ts", {
    "@/lib/env": { optionalEnv: (name: string) => configured[name] ?? "" },
    "@/lib/subscriptionOffers": offers,
  });
  const row = { status: "trial_expired", plan: "Standard", app_edition: "standard", stripe_customer_id: "cus_account", ...options.row };
  const writes: Row[] = [];
  const posts: Array<{ path: string; params: URLSearchParams }> = [];
  let guardHeld = false;
  let ownershipChecks = 0;
  const guardedSessions: CheckoutSessionInput[] = [];
  class CheckoutGuardError extends Error {
    readonly code: string;
    readonly status: 409 | 503;
    constructor(code: string, status: 409 | 503 = 409) { super(code); this.code = code; this.status = status; }
  }
  const reader = (table: string) => {
    assert.equal(guardHeld, true, "billing state must be reread inside the account guard");
    const query = { select() { return query; }, eq() { return query; },
      async maybeSingle() { return { data: table === "subscriptions" ? row : {}, error: null }; } };
    return query;
  };
  const writer = () => {
    const query = {
      update(patch: Row) {
        assert.equal(guardHeld, true, "billing writes must remain inside the account guard");
        assert.ok(ownershipChecks > 0, "ownership is checked before a billing write");
        writes.push(patch); return query;
      },
      eq() { return query; }, is() { return query; }, select() { return query; },
      async maybeSingle() { return { data: { user_id: "user_account" }, error: null }; },
      then(resolve: (value: { error: null }) => unknown) { return Promise.resolve(resolve({ error: null })); },
    };
    return query;
  };
  const route = load<{ POST(request: Request): Promise<Response> }>("app/api/billing/checkout/route.ts", {
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/billingCatalog": catalog,
    "@/lib/dashboardEdition": dashboardEdition,
    "@/lib/subscriptionOffers": offers,
    "@/lib/subscriptionCheckoutPolicy": checkoutPolicy,
    "@/lib/stripeCheckoutSessionGuard": {
      CheckoutGuardError,
      withStripeCheckoutGuard: async <T,>(userId: string, work: (guard: StripeCheckoutGuard) => Promise<T>) => {
        assert.equal(userId, "user_account");
        if (options.guardError) throw new CheckoutGuardError(options.guardError.code, options.guardError.status);
        guardHeld = true;
        try {
          return await work({
            assertOwned: async () => { assert.equal(guardHeld, true); ownershipChecks++; },
            resolveSession: async (input) => {
              assert.equal(guardHeld, true);
              assert.equal(input.customerId, "cus_account");
              assert.ok(input.isCommercialPrice(input.params.get("line_items[0][price]")!));
              guardedSessions.push(input);
              await input.assertNoLiveSubscription();
              const session = await input.post("/checkout/sessions", input.params, { idempotencyKey: "fixture-guarded-attempt" }) as { url: string };
              return { id: "cs_fixture", url: session.url, reused: options.guardedTrialEnd !== undefined,
                trialEndUnix: options.guardedTrialEnd ?? (input.params.has("subscription_data[trial_end]") ? Number(input.params.get("subscription_data[trial_end]")) : null) };
            },
          });
        } finally { guardHeld = false; }
      },
    },
    "@/lib/requireUser": { requireUser: async () => ({ supabase: { from: reader }, user: { id: "user_account", email: "account@example.invalid", created_at: options.createdAt }, errorResponse: null }) },
    "@/lib/supabaseAdmin": { supabaseAdmin: { from: writer } },
    "@/lib/stripeRest": {
      getAppUrl: () => "https://app.example.invalid",
      stripeGet: async () => { throw new Error("Unexpected Stripe read"); },
      stripePost: async (path: string, params: URLSearchParams) => {
        posts.push({ path, params: new URLSearchParams(params) });
        assert.equal(path, "/checkout/sessions", "only an explicit checkout may create a session");
        return { url: "https://checkout.example.invalid/session" };
      },
    },
    "@/lib/trialSubscription": { computeTrialDatesFromStartDate: () => { throw new Error("Unexpected trial calculation"); }, getTrialDays: () => 21 },
    "@/lib/userFacingErrors": { getSimpleFrenchErrorMessage: (_error: unknown, fallback: string) => fallback },
    "@/lib/stripeCheckoutPreflight": {
      findLiveStripeSubscriptions: async () => [],
      inspectComplimentaryCheckout: async () => ({ customerId: "cus_account", existingSubscription: options.recovered
        ? { id: "sub_legacy", customerId: "cus_account", status: "active", priceId: options.recoveredPrice ?? priceEnv.STRIPE_PRICE_STANDARD_MONTHLY_ID } : null }),
    },
  }, { STRIPE_SECRET_KEY: "test-placeholder-not-a-real-key" });
  return { posts, writes, catalog, guardedSessions,
    post: (plan: Plan, billingCycle: Cycle) => route.POST(new Request("https://app.example.invalid/api/billing/checkout", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan, billingCycle }),
    })) as Promise<Response>,
  };
}

for (const createdAt of ["2020-01-01T00:00:00Z", "2030-01-01T00:00:00Z", null]) {
  for (const plan of ["Standard", "Premium"] as const) {
    for (const cycle of ["monthly", "yearly"] as const) {
      test(`new ${plan} ${cycle} checkout uses the current HT offer for account ${createdAt ?? "without a creation date"}`, async () => {
        const run = fixture({ createdAt });
        assert.equal((await run.post(plan, cycle)).status, 200);
        assert.equal(run.posts.length, 1);
        const params = run.posts[0].params;
        const selected = run.catalog.commercialPriceFromId(params.get("line_items[0][price]"));
        assert.ok(selected);
        const offer = offers.currentSubscriptionOffer(plan);
        assert.equal(selected.plan, plan);
        assert.equal(selected.billingCycle, cycle);
        assert.equal(selected.pricingVersion, "international_ht_v2");
        assert.equal(selected.chargeAmountEur, cycle === "yearly" ? offer.yearlyPriceEur : offer.monthlyPriceEur);
        assert.equal(params.get("metadata[pricing_version]"), "international_ht_v2");
        assert.equal(params.get("subscription_data[metadata][pricing_version]"), "international_ht_v2");
        assert.equal(params.get("automatic_tax[enabled]"), "true");
        assert.equal(params.get("tax_id_collection[enabled]"), "true");
        assert.ok(run.writes.every((patch) => !("app_edition" in patch) && !("monthly_price_eur" in patch)), "checkout cannot grant rights or overwrite a contractual amount");
      });
    }
  }
}

for (const plan of ["Standard", "Premium"] as const) {
  for (const cycle of ["monthly", "yearly"] as const) {
    test(`an old complimentary Standard account may choose ${plan} ${cycle} while retaining free access until payment`, async () => {
      const run = fixture({ createdAt: "2020-01-01T00:00:00Z", row: { status: "active" } });
      assert.equal((await run.post(plan, cycle)).status, 200);
      assert.equal(run.posts.length, 1);
      const selected = run.catalog.commercialPriceFromId(run.posts[0].params.get("line_items[0][price]"));
      assert.equal(selected?.plan, plan);
      assert.equal(selected?.billingCycle, cycle);
      assert.equal(selected?.pricingVersion, "international_ht_v2");
      assert.equal(run.posts[0].params.get("subscription_data[trial_end]"), null, "a complimentary account must not invent a trial or delay the chosen paid subscription");
      assert.ok(run.writes.every((patch) => !("app_edition" in patch) && !("plan" in patch) && !("status" in patch) && !("monthly_price_eur" in patch)), "an abandoned checkout retains the free access and its stored price");
    });
  }
}

for (const plan of ["Standard", "Premium"] as const) {
  for (const cycle of ["monthly", "yearly"] as const) {
    test(`web ${plan} ${cycle} keeps the selected offer through client, API, Stripe session and redirect`, async () => {
      const run = fixture({ createdAt: "2020-01-01T00:00:00Z", row: { status: "active" } });
      const assigned: string[] = [];
      const result = await startSubscriptionCheckout({
        plan, billingCycle: cycle, fallbackError: "Checkout unavailable",
        runtime: { location: { assign: (url: string) => { assigned.push(url); } } },
        fetchImpl: async (input, init) => {
          assert.equal(input, "/api/billing/checkout");
          assert.equal(init?.method, "POST");
          const request = JSON.parse(String(init?.body));
          assert.deepEqual(request, { plan, billingCycle: cycle });
          return run.post(request.plan, request.billingCycle);
        },
      });
      assert.deepEqual(result, { platform: "web", provider: "stripe" });
      assert.deepEqual(assigned, ["https://checkout.example.invalid/session"]);
      assert.equal(run.posts.length, 1);
      const session = run.posts[0].params;
      const selected = run.catalog.commercialPriceFromId(session.get("line_items[0][price]"));
      assert.equal(selected?.plan, plan);
      assert.equal(selected?.billingCycle, cycle);
      assert.equal(selected?.chargeAmountEur, cycle === "yearly" ? offers.currentSubscriptionOffer(plan).yearlyPriceEur : offers.currentSubscriptionOffer(plan).monthlyPriceEur);
      assert.match(session.get("success_url") ?? "", new RegExp(`checkout=success&billing=${cycle}&checkout_plan=${plan}$`));
      assert.match(session.get("cancel_url") ?? "", /checkout=cancel$/);
    });
  }
}

test("an active legacy paid contract is never migrated or given a duplicate checkout", async () => {
  const run = fixture({ row: { status: "active", stripe_subscription_id: "sub_legacy", billing_provider: "stripe" } });
  const response = await run.post("Premium", "yearly");
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "SUBSCRIPTION_ALREADY_EXISTS");
  assert.deepEqual(run.posts, []);
  assert.deepEqual(run.writes, []);
  assert.equal(run.catalog.commercialPriceFromId(priceEnv.STRIPE_PRICE_STANDARD_MONTHLY_ID)?.chargeAmountEur, 69);
});

test("a recovered legacy contract is linked unchanged and requires an explicit plan-change quote", async () => {
  const run = fixture({ row: { status: "active" }, recovered: true });
  assert.deepEqual(await (await run.post("Premium", "yearly")).json(), { recoveredSubscription: true, nextAction: "change_plan" });
  assert.deepEqual(run.posts, []);
  assert.equal(run.writes.length, 1);
  assert.equal(run.writes[0].stripe_subscription_id, "sub_legacy");
  assert.ok(!("stripe_price_id" in run.writes[0]) && !("monthly_price_eur" in run.writes[0]) && !("app_edition" in run.writes[0]));
});

for (const [target, cycle, recoveredPrice, nextAction] of [
  ["Standard", "monthly", priceEnv.STRIPE_PRICE_STANDARD_MONTHLY_ID, "reload"],
  ["Standard", "yearly", priceEnv.STRIPE_PRICE_STANDARD_MONTHLY_ID, "change_plan"],
  ["Premium", "yearly", priceEnv.STRIPE_PRICE_PREMIUM_YEARLY_ID, "reload"],
  ["Premium", "monthly", priceEnv.STRIPE_PRICE_PREMIUM_YEARLY_ID, "change_plan"],
  ["Standard", "monthly", priceEnv.STRIPE_PRICE_PREMIUM_YEARLY_ID, "reload"],
] as const) {
  test(`recovering ${recoveredPrice} for ${target} ${cycle} resumes only the appropriate existing-contract flow`, async () => {
    const run = fixture({ row: { status: "active" }, recovered: true, recoveredPrice });
    assert.deepEqual(await (await run.post(target, cycle)).json(), { recoveredSubscription: true, nextAction });
    assert.deepEqual(run.posts, []);
    assert.equal(run.writes.length, 1);
    assert.ok(!("stripe_price_id" in run.writes[0]) && !("monthly_price_eur" in run.writes[0]) && !("app_edition" in run.writes[0]));
  });
}

test("a missing current price fails closed instead of falling back to a historic price", async () => {
  const run = fixture({ missingPrice: "STRIPE_PRICE_STANDARD_58HT_YEARLY_ID" });
  assert.equal((await run.post("Standard", "yearly")).status, 503);
  assert.deepEqual(run.posts, []);
  assert.deepEqual(run.writes, []);
});

for (const plan of ["Standard", "Premium"] as const) {
  for (const cycle of ["monthly", "yearly"] as const) {
    for (const remainingSeconds of [7 * 24 * 60 * 60, 24 * 60 * 60, 30]) {
      test(`trial ${plan} ${cycle} with ${remainingSeconds} seconds remaining never bills before its free period ends`, async () => {
        const before = Math.floor(Date.now() / 1000);
        const originalEnd = before + remainingSeconds;
        const run = fixture({ row: { status: "trialing", plan: "Trial", trial_end_at: new Date(originalEnd * 1000).toISOString() } });
        const response = await run.post(plan, cycle);
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(run.posts.length, 1);
        const trialEnd = Number(run.posts[0].params.get("subscription_data[trial_end]"));
        assert.ok(trialEnd >= originalEnd, "no debit can precede the original trial end");
        assert.ok(trialEnd >= before + 48 * 60 * 60 + 120, "Stripe minimum includes a latency margin");
        if (remainingSeconds > 48 * 60 * 60 + 120) assert.equal(trialEnd, originalEnd);
        assert.equal(body.trialEndAt, new Date(trialEnd * 1000).toISOString());
        assert.equal(body.trialExtended, trialEnd > originalEnd);
        assert.ok(run.writes.every((patch) => !("trial_end_at" in patch) && !("trial_start_at" in patch)
          && !("app_edition" in patch) && !("status" in patch)), "an abandoned checkout cannot extend trial dates or grant rights");
      });
    }
  }
}

for (const trialEnd of [null, "not-a-date"]) {
  test(`an unverifiable trial end (${trialEnd}) cannot create an immediate payment`, async () => {
    const run = fixture({ row: { status: "trialing", plan: "Trial", trial_end_at: trialEnd } });
    const response = await run.post("Premium", "monthly");
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "TRIAL_END_VERIFICATION_REQUIRED");
    assert.deepEqual(run.posts, []);
    assert.deepEqual(run.writes, []);
  });
}

test("an actually expired trial may start the chosen paid offer immediately", async () => {
  const run = fixture({ row: { status: "trialing", plan: "Trial", trial_end_at: new Date(Date.now() - 60_000).toISOString() } });
  const response = await run.post("Standard", "yearly");
  assert.equal(response.status, 200);
  assert.equal(run.posts[0].params.get("subscription_data[trial_end]"), null);
  assert.equal((await response.json()).trialExtended, undefined);
  assert.ok(run.writes.every((patch) => !("trial_end_at" in patch)));
});

for (const [code, status] of [["CHECKOUT_IN_PROGRESS", 409], ["CHECKOUT_GUARD_UNAVAILABLE", 503], ["CHECKOUT_LOCK_LOST", 409]] as const) {
  test(`${code} refuses a new checkout before subscription reads or writes`, async () => {
    const run = fixture({ row: { status: "active" }, guardError: { code, status } });
    const response = await run.post("Premium", "yearly");
    assert.equal(response.status, status);
    assert.equal((await response.json()).code, code);
    assert.deepEqual(run.posts, []);
    assert.deepEqual(run.writes, []);
  });
}

test("a reused Checkout reports its original effective trial date, not the newer requested grace date", async () => {
  const now = Math.floor(Date.now() / 1000);
  const originalEnd = now + 3600;
  const existingCheckoutTrialEnd = now + 48 * 3600 + 30;
  const run = fixture({ row: { status: "trialing", plan: "Trial", trial_end_at: new Date(originalEnd * 1000).toISOString() }, guardedTrialEnd: existingCheckoutTrialEnd });
  const response = await run.post("Premium", "yearly");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.trialEndAt, new Date(existingCheckoutTrialEnd * 1000).toISOString());
  assert.equal(body.trialExtended, true);
  assert.equal(run.guardedSessions[0].trialSourceEndUnix, originalEnd);
  assert.ok(Number(run.guardedSessions[0].params.get("subscription_data[trial_end]")) > existingCheckoutTrialEnd);
  assert.ok(run.writes.every((patch) => !("trial_end_at" in patch)));
});
