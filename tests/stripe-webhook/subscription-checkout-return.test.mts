import assert from "node:assert/strict";
import test from "node:test";
import { isCheckoutReturnSynchronized, parseCheckoutReturnTarget } from "../../lib/subscriptionCheckoutReturn.ts";

test("complimentary Standard to Premium waits through the billing-link webhook until Premium rights arrive", () => {
  const target = parseCheckoutReturnTarget(new URLSearchParams("checkout_plan=Premium&billing=yearly"));
  const row = { app_edition: "standard", status: "active", billing_cycle: "yearly", scheduled_plan: "Premium" };
  assert.equal(isCheckoutReturnSynchronized(row, target), false);
  const linked = { ...row, stripe_subscription_id: "sub_verified" };
  assert.equal(isCheckoutReturnSynchronized(linked, target), false);
  assert.equal(isCheckoutReturnSynchronized({ ...linked, app_edition: "premium", scheduled_plan: null }, target), true);
  assert.equal(row.app_edition, "standard", "waiting never mutates access");
});

for (const plan of ["Standard", "Premium"] as const) {
  for (const cycle of ["monthly", "yearly"] as const) {
    test(`${plan} ${cycle} return requires the selected edition, cycle and verified active or trial subscription`, () => {
      const target = parseCheckoutReturnTarget(new URLSearchParams({ checkout_plan: plan, billing: cycle }));
      const row = { app_edition: plan.toLowerCase(), stripe_subscription_id: "sub_verified", status: "active", billing_cycle: cycle };
      assert.equal(isCheckoutReturnSynchronized(row, target), true);
      assert.equal(isCheckoutReturnSynchronized({ ...row, status: "trialing" }, target), true);
      for (const status of ["trial_expired", "past_due", "incomplete", "canceled"]) {
        assert.equal(isCheckoutReturnSynchronized({ ...row, status }, target), false);
      }
      assert.equal(isCheckoutReturnSynchronized({ ...row, billing_cycle: cycle === "yearly" ? "monthly" : "yearly" }, target), false);
      assert.equal(isCheckoutReturnSynchronized({ ...row, stripe_subscription_id: null }, target), false);
    });
  }
}

test("untrusted return parameters cannot grant an edition or authorize a missing contract", () => {
  const target = parseCheckoutReturnTarget(new URLSearchParams("checkout_plan=Premium&billing=yearly"));
  const free = { app_edition: "standard", status: "active", billing_cycle: "monthly" };
  assert.equal(isCheckoutReturnSynchronized(free, target), false);
  assert.deepEqual(free, { app_edition: "standard", status: "active", billing_cycle: "monthly" });
  assert.deepEqual(parseCheckoutReturnTarget(new URLSearchParams("checkout_plan=Founder&billing=free")), { plan: null, billingCycle: null });
});

test("earlier Checkout links may use the persisted target, but never accept the prior edition as a fallback", () => {
  const target = parseCheckoutReturnTarget(new URLSearchParams("billing=monthly"));
  const row = { app_edition: "standard", status: "active", billing_cycle: "monthly", stripe_subscription_id: "sub_verified" };
  assert.equal(isCheckoutReturnSynchronized(row, target), false);
  assert.equal(isCheckoutReturnSynchronized({ ...row, scheduled_plan: "Premium" }, target), false);
  assert.equal(isCheckoutReturnSynchronized({ ...row, scheduled_plan: "Premium", app_edition: "premium" }, target), true);
});

test("a Premium choice during Trial waits for Stripe renewal synchronization without requiring Premium trial rights", () => {
  const target = { plan: "Premium", billingCycle: "yearly" } as const;
  const linked = { app_edition: "standard", plan: "Trial", status: "trialing", scheduled_plan: "Premium",
    stripe_subscription_id: "sub_verified", billing_cycle: "yearly", trial_end_at: "2030-01-03T12:00:00.000Z" };
  assert.equal(isCheckoutReturnSynchronized(linked, target), false);
  assert.equal(isCheckoutReturnSynchronized({ ...linked, next_renewal_date: "2030-01-02" }, target), false);
  assert.equal(isCheckoutReturnSynchronized({ ...linked, next_renewal_date: "2030-01-03" }, target), true);
  assert.equal(linked.app_edition, "standard");
});
