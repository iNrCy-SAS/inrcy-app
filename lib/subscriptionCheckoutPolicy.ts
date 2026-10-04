import { resolveDashboardEdition } from "./dashboardEdition.ts";

type CheckoutSubscription = {
  status?: string | null;
  billing_provider?: string | null;
  stripe_subscription_id?: string | null;
  native_product_id?: string | null;
  app_edition?: string | null;
  plan?: string | null;
};

export function canStartSubscriptionCheckout(
  subscription: CheckoutSubscription | null | undefined,
  targetPlan: "Standard" | "Premium",
): boolean {
  if (!subscription) return false;
  const status = String(subscription.status ?? "").trim().toLowerCase();
  const provider = String(subscription.billing_provider ?? "").trim().toLowerCase();
  const edition = resolveDashboardEdition({ edition: subscription.app_edition, plan: subscription.plan });
  if (edition === "founder" || (provider && provider !== "stripe") || subscription.native_product_id?.trim()) {
    return false;
  }
  if (["trial_expired", "canceled", "cancelled", "incomplete_expired", ""].includes(status)) return true;
  if (subscription.stripe_subscription_id?.trim()) return false;
  if (status === "trialing") return true;
  // A complimentary Standard account has access, but no paid contract to amend.
  // The server still checks Stripe before creating its first paid subscription.
  return status === "active" && edition === "standard" && targetPlan === "Premium";
}
