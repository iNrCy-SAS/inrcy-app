type StripeObjectLoose = Record<string, unknown>;

function asRecord(value: unknown): StripeObjectLoose | null {
  return value && typeof value === "object" ? (value as StripeObjectLoose) : null;
}

export function stripeObjectId(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  const record = asRecord(value);
  return typeof record?.id === "string" && record.id.trim() ? record.id.trim() : null;
}

function metadataUserId(value: unknown): string | null {
  const metadata = asRecord(value);
  const userId = metadata?.user_id;
  return typeof userId === "string" && userId.trim() ? userId.trim() : null;
}

export function invoiceSubscriptionId(invoiceValue: unknown): string | null {
  const invoice = asRecord(invoiceValue);
  if (!invoice) return null;

  const legacySubscriptionId = stripeObjectId(invoice.subscription);
  if (legacySubscriptionId) return legacySubscriptionId;

  const parent = asRecord(invoice.parent);
  const subscriptionDetails = asRecord(parent?.subscription_details);
  return stripeObjectId(subscriptionDetails?.subscription);
}

export function invoiceCustomerId(invoiceValue: unknown): string | null {
  const invoice = asRecord(invoiceValue);
  return stripeObjectId(invoice?.customer);
}

export function invoiceCustomerEmail(invoiceValue: unknown): string | null {
  const invoice = asRecord(invoiceValue);
  if (!invoice) return null;

  if (typeof invoice.customer_email === "string" && invoice.customer_email.trim()) {
    return invoice.customer_email.trim();
  }

  const customer = asRecord(invoice.customer);
  return typeof customer?.email === "string" && customer.email.trim() ? customer.email.trim() : null;
}

export function invoiceUserIdentity(invoiceValue: unknown): {
  userId: string | null;
  conflict: boolean;
} {
  const invoice = asRecord(invoiceValue);
  if (!invoice) return { userId: null, conflict: false };

  const invoiceMetadataUserId = metadataUserId(invoice.metadata);
  const parent = asRecord(invoice.parent);
  const subscriptionDetails = asRecord(parent?.subscription_details);
  const subscriptionMetadataUserId = metadataUserId(subscriptionDetails?.metadata);
  return consistentStripeWebhookUserId([
    invoiceMetadataUserId,
    subscriptionMetadataUserId,
  ]);
}

export function invoiceUserId(invoiceValue: unknown): string | null {
  return invoiceUserIdentity(invoiceValue).userId;
}

export function subscriptionCancellationReason(subscriptionValue: unknown): string | null {
  const subscription = asRecord(subscriptionValue);
  const cancellationDetails = asRecord(subscription?.cancellation_details);
  const reason = cancellationDetails?.reason;
  return typeof reason === "string" && reason.trim() ? reason.trim().toLowerCase() : null;
}

export function consistentStripeWebhookUserId(values: unknown[]): {
  userId: string | null;
  conflict: boolean;
} {
  const userIds = new Set(
    values
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean),
  );
  return {
    userId: userIds.size === 1 ? Array.from(userIds)[0] : null,
    conflict: userIds.size > 1,
  };
}

export function resolveStripeWebhookStrongUser(input: {
  metadataUserIds: unknown[];
  subscriptionUserIds: unknown[];
  customerUserIds: unknown[];
  subscriptionAmbiguous?: boolean;
  metadataAmbiguous?: boolean;
}): { userId: string | null; conflict: boolean; source: string | null } {
  const metadata = consistentStripeWebhookUserId(input.metadataUserIds);
  const subscription = consistentStripeWebhookUserId(input.subscriptionUserIds);
  const customer = consistentStripeWebhookUserId(input.customerUserIds);
  if (
    metadata.conflict ||
    subscription.conflict ||
    input.subscriptionAmbiguous ||
    input.metadataAmbiguous
  ) {
    return { userId: null, conflict: true, source: null };
  }

  let winner = subscription.userId;
  let source: string | null = winner ? "subscription_id" : null;
  if (metadata.userId) {
    if (winner && winner !== metadata.userId) {
      return { userId: null, conflict: true, source: null };
    }
    winner ||= metadata.userId;
    source ||= "metadata_user_id";
  }

  // A customer can legitimately be shared. It is decisive only when unique;
  // multiple customer owners do not veto a stronger sub/metadata winner.
  if (!winner) {
    if (customer.conflict) {
      return { userId: null, conflict: true, source: null };
    }
    if (customer.userId) {
      winner = customer.userId;
      source = "customer_id";
    }
  }

  return { userId: winner, conflict: false, source };
}

export function paymentFailureStatus(
  _existingStatusValue: unknown,
  stripeStatusValue: unknown,
): string | null {
  const stripeStatus = String(stripeStatusValue || "").trim().toLowerCase();
  return STRIPE_AUTHORITATIVE_SUBSCRIPTION_STATUSES.has(stripeStatus)
    ? stripeStatus
    : null;
}

export function paymentSuccessStatus(_existingStatusValue: unknown, stripeStatusValue: unknown): string | null {
  const stripeStatus = String(stripeStatusValue || "").trim().toLowerCase();
  return STRIPE_AUTHORITATIVE_SUBSCRIPTION_STATUSES.has(stripeStatus)
    ? stripeStatus
    : null;
}

const STRIPE_RECONCILABLE_LOCAL_STATUSES = new Set([
  "active",
  "trialing",
  "trial_expired",
  "cancelled",
  "past_due",
  "unpaid",
  "incomplete",
  "paused",
  "canceled",
]);

const STRIPE_AUTHORITATIVE_SUBSCRIPTION_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
  "canceled",
]);

/**
 * Once a deterministic Stripe relationship is established, Stripe remains
 * authoritative in both directions (including active -> past_due). Returning
 * null deliberately means "do not write" for unknown/equal states.
 */
export function reconciledStripeSubscriptionStatus(
  existingStatusValue: unknown,
  stripeStatusValue: unknown,
): string | null {
  const existingStatus = String(existingStatusValue || "").trim().toLowerCase();
  const stripeStatus = String(stripeStatusValue || "").trim().toLowerCase();

  if (!STRIPE_RECONCILABLE_LOCAL_STATUSES.has(existingStatus)) return null;
  if (!STRIPE_AUTHORITATIVE_SUBSCRIPTION_STATUSES.has(stripeStatus)) return null;
  if (existingStatus === stripeStatus) return null;
  return stripeStatus;
}
