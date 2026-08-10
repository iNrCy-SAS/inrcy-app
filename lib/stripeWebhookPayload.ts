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

export function invoiceUserId(invoiceValue: unknown): string | null {
  const invoice = asRecord(invoiceValue);
  if (!invoice) return null;

  const invoiceMetadataUserId = metadataUserId(invoice.metadata);
  if (invoiceMetadataUserId) return invoiceMetadataUserId;

  const parent = asRecord(invoice.parent);
  const subscriptionDetails = asRecord(parent?.subscription_details);
  return metadataUserId(subscriptionDetails?.metadata);
}

export function subscriptionCancellationReason(subscriptionValue: unknown): string | null {
  const subscription = asRecord(subscriptionValue);
  const cancellationDetails = asRecord(subscription?.cancellation_details);
  const reason = cancellationDetails?.reason;
  return typeof reason === "string" && reason.trim() ? reason.trim().toLowerCase() : null;
}

export function paymentFailureStatus(existingStatusValue: unknown, stripeStatusValue: unknown): string {
  const existingStatus = String(existingStatusValue || "").trim().toLowerCase();
  const stripeStatus = String(stripeStatusValue || "").trim().toLowerCase();

  if (["canceled", "unpaid", "paused", "incomplete_expired"].includes(stripeStatus)) {
    return stripeStatus;
  }

  if (["canceled", "unpaid"].includes(existingStatus)) {
    return existingStatus;
  }

  return "past_due";
}

export function paymentSuccessStatus(existingStatusValue: unknown, stripeStatusValue: unknown): string | null {
  const existingStatus = String(existingStatusValue || "").trim().toLowerCase();
  const stripeStatus = String(stripeStatusValue || "").trim().toLowerCase();

  if (stripeStatus === "active" || stripeStatus === "trialing") return stripeStatus;
  if (["canceled", "unpaid", "past_due", "paused", "incomplete", "incomplete_expired"].includes(stripeStatus)) return null;

  if (["past_due", "unpaid", "incomplete"].includes(existingStatus)) return "active";
  return null;
}
