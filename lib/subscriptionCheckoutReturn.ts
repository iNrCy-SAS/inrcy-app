import type { BillingCycle } from "./subscriptionOffers.ts";

type CommercialPlan = "Standard" | "Premium";
export type CheckoutReturnTarget = { plan: CommercialPlan | null; billingCycle: BillingCycle | null };
type CheckoutSubscription = {
  app_edition?: string | null;
  plan?: string | null;
  scheduled_plan?: string | null;
  status?: string | null;
  stripe_subscription_id?: string | null;
  billing_cycle?: string | null;
  trial_end_at?: string | null;
  next_renewal_date?: string | null;
};

export function parseCheckoutReturnTarget(params: { get(name: string): string | null }): CheckoutReturnTarget {
  const plan = params.get("checkout_plan");
  const cycle = params.get("billing");
  return {
    plan: plan === "Standard" || plan === "Premium" ? plan : null,
    billingCycle: cycle === "monthly" || cycle === "yearly" ? cycle : null,
  };
}

/** URL parameters only control waiting; access always comes from the authenticated row. */
export function isCheckoutReturnSynchronized(
  subscription: CheckoutSubscription | null,
  target: CheckoutReturnTarget,
): boolean {
  if (!subscription?.stripe_subscription_id?.trim()
      || !["active", "trialing"].includes(String(subscription.status ?? "").toLowerCase())) return false;
  // Compatibility for earlier Checkout links: only a persisted requested plan
  // can supply the missing target, never the account's previous edition.
  const plan = target.plan ?? subscription.scheduled_plan;
  if (plan !== "Standard" && plan !== "Premium") return false;
  if (!target.billingCycle || subscription.billing_cycle !== target.billingCycle) return false;
  if (subscription.status === "trialing" && subscription.plan?.toLowerCase() === "trial") {
    const trialEnd = Date.parse(subscription.trial_end_at ?? "");
    // Trial access stays Standard. The subscription webhook, unlike Checkout's
    // billing-link event, persists the chosen plan and Stripe renewal date.
    return subscription.scheduled_plan === plan && Number.isFinite(trialEnd)
      && subscription.next_renewal_date === new Date(trialEnd).toISOString().slice(0, 10);
  }
  return subscription.app_edition?.toLowerCase() === plan.toLowerCase();
}
