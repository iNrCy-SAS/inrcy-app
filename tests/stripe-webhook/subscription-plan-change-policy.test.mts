import assert from "node:assert/strict";
import test from "node:test";
import { canPreviewSubscriptionPlanChange, currentSubscriptionBillingPlan } from "../../lib/subscriptionPlanChangePolicy.ts";
import { canStartSubscriptionCheckout } from "../../lib/subscriptionCheckoutPolicy.ts";
import { resolveDashboardEdition } from "../../lib/dashboardEdition.ts";

const now = Date.parse("2030-01-01T12:00:00Z");
const base = { stripe_subscription_id: "sub_verified", billing_provider: "stripe", status: "trialing",
  app_edition: "standard", plan: "Trial", billing_cycle: "monthly", trial_end_at: "2030-01-05T12:00:00Z" };

for (const currentPlan of ["Standard", "Premium"] as const) {
  for (const currentCycle of ["monthly", "yearly"] as const) {
    test(`a linked ${currentPlan} ${currentCycle} trial may choose either plan/cadence through its existing contract`, () => {
      const subscription = { ...base, app_edition: currentPlan.toLowerCase(), scheduled_plan: currentPlan, billing_cycle: currentCycle };
      for (const targetPlan of ["Standard", "Premium"] as const) {
        assert.equal(canStartSubscriptionCheckout(subscription, targetPlan), false, "never create a second subscription");
        for (const targetCycle of ["monthly", "yearly"] as const) {
          assert.equal(canPreviewSubscriptionPlanChange(subscription, targetPlan, targetCycle, now),
            targetPlan !== currentPlan || targetCycle !== currentCycle);
        }
      }
    });
  }
}

test("paid Standard upgrade and cadence changes remain immediate; paid Premium downgrade remains deferred", () => {
  const standard = { ...base, status: "active", plan: "Standard" };
  const premium = { ...standard, app_edition: "premium", plan: "Premium" };
  assert.equal(canPreviewSubscriptionPlanChange(standard, "Premium", "monthly", now), true);
  assert.equal(canPreviewSubscriptionPlanChange(standard, "Standard", "yearly", now), true);
  assert.equal(canPreviewSubscriptionPlanChange(premium, "Premium", "yearly", now), true);
  for (const cycle of ["monthly", "yearly"] as const) assert.equal(canPreviewSubscriptionPlanChange(premium, "Standard", cycle, now), false);
});

test("the chosen Premium contract during a trial does not change the Trial access policy", () => {
  const subscription = { ...base, app_edition: "standard", scheduled_plan: "Premium" };
  assert.equal(currentSubscriptionBillingPlan(subscription), "Premium");
  assert.equal(canPreviewSubscriptionPlanChange(subscription, "Standard", "monthly", now), true);
  assert.equal(canPreviewSubscriptionPlanChange(subscription, "Premium", "monthly", now), false);
  assert.equal(resolveDashboardEdition({ edition: subscription.app_edition, plan: subscription.plan }), "standard");
});

test("free, expired, recovering, native, managed and cancelling accounts cannot enter an immediate plan-change quote", () => {
  for (const overrides of [
    { stripe_subscription_id: null }, { status: "past_due" }, { status: "unpaid" }, { status: "trial_expired" },
    { billing_provider: "app_store" }, { native_product_id: "native_plan" }, { app_edition: "founder", plan: "Founder" },
    { cancel_requested_at: "2030-01-01", end_date: "2030-01-05" },
    { trial_end_at: "2029-12-31T12:00:00Z" }, { trial_end_at: null },
  ]) assert.equal(canPreviewSubscriptionPlanChange({ ...base, ...overrides }, "Premium", "yearly", now), false);
  assert.equal(canStartSubscriptionCheckout({ ...base, stripe_subscription_id: null }, "Premium"), true);
});
