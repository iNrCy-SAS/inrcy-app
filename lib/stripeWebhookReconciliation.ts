export const STRIPE_WEBHOOK_RECONCILIATION_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "invoice.paid",
  "invoice.payment_succeeded",
]);

export type StripeWebhookReconciliationReason = "local_subscription_not_found";

export function stripeWebhookNeedsReconciliation(
  eventType: unknown,
  localSubscriptionFound: boolean,
) {
  if (localSubscriptionFound) return false;
  return STRIPE_WEBHOOK_RECONCILIATION_EVENT_TYPES.has(
    String(eventType || "").trim(),
  );
}

export function stripeWebhookReconciliationLastError(
  reason: StripeWebhookReconciliationReason,
) {
  return `stripe_webhook_reconciliation_required:${reason}`;
}
