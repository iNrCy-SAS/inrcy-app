import { resolveDashboardEdition } from "./dashboardEdition.ts";
import type { BillingCycle } from "./subscriptionOffers.ts";

type Subscription = {
  status?: string | null;
  app_edition?: string | null;
  plan?: string | null;
  scheduled_plan?: string | null;
  billing_cycle?: string | null;
  billing_provider?: string | null;
  stripe_subscription_id?: string | null;
  native_product_id?: string | null;
  trial_end_at?: string | null;
  cancel_requested_at?: string | null;
  end_date?: string | null;
};

/** Billing selection during a linked trial is distinct from Trial access rights. */
export function currentSubscriptionBillingPlan(subscription: Subscription | null): "Standard" | "Premium" | "Founder" {
  const edition = resolveDashboardEdition({ edition: subscription?.app_edition, plan: subscription?.plan });
  if (edition === "founder") return "Founder";
  if (String(subscription?.status ?? "").trim().toLowerCase() === "trialing" && subscription?.stripe_subscription_id?.trim()) {
    if (subscription.scheduled_plan === "Standard" || subscription.scheduled_plan === "Premium") return subscription.scheduled_plan;
    if (subscription.app_edition?.trim().toLowerCase() === "premium") return "Premium";
  }
  return edition === "premium" ? "Premium" : "Standard";
}

/** Determines which card may request a quote; the API remains the billing authority. */
export function canPreviewSubscriptionPlanChange(
  subscription: Subscription | null,
  targetPlan: "Standard" | "Premium",
  targetCycle: BillingCycle,
  now = Date.now(),
): boolean {
  if (!subscription?.stripe_subscription_id?.trim() || subscription.native_product_id?.trim()) return false;
  const provider = String(subscription.billing_provider ?? "").trim().toLowerCase();
  if (provider && provider !== "stripe") return false;
  if (subscription.cancel_requested_at && subscription.end_date) return false;
  const status = String(subscription.status ?? "").trim().toLowerCase();
  if (status !== "active" && status !== "trialing") return false;
  if (status === "trialing" && !(Date.parse(subscription.trial_end_at ?? "") > now)) return false;
  const currentPlan = currentSubscriptionBillingPlan(subscription);
  if (currentPlan === "Founder") return false;
  // An already paid Premium period keeps the deferred downgrade workflow.
  if (status === "active" && currentPlan === "Premium" && targetPlan === "Standard") return false;
  return currentPlan !== targetPlan
    || targetCycle !== (subscription.billing_cycle === "yearly" ? "yearly" : "monthly");
}
