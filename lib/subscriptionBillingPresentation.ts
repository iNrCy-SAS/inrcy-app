type SubscriptionDates = {
  plan?: string | null;
  status?: string | null;
  next_renewal_date?: string | null;
  cancel_requested_at?: string | null;
  end_date?: string | null;
};

function calendarDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

/** A stored period boundary is not a charge when access ends on that date. */
export function getSubscriptionBillingPresentation(subscription: SubscriptionDates | null | undefined, fallbackRenewalDate?: string | null) {
  const status = String(subscription?.status || "").trim().toLowerCase();
  const ended = ["canceled", "cancelled", "trial_expired", "incomplete_expired"].includes(status);
  const endDate = calendarDate(subscription?.end_date);
  const cancellationRequested = Boolean(subscription?.cancel_requested_at);
  // A legacy anniversary estimate cannot establish another payment after a
  // cancellation request. Only the synchronized billing date can do that.
  const renewalDate = calendarDate(subscription?.next_renewal_date || (!cancellationRequested ? fallbackRenewalDate : null));
  const cancellationScheduled = cancellationRequested && Boolean(endDate) && !ended;
  const trial = ["trialing", "trailing", "essai"].includes(status) || String(subscription?.plan || "").toLowerCase() === "trial";
  const finalChargeBeforeEnd = Boolean(cancellationScheduled && !trial && renewalDate && endDate && renewalDate < endDate);
  const nextChargeDate = ended || (cancellationRequested && !finalChargeBeforeEnd) ? null : renewalDate;
  const noFurtherRenewal = ended || Boolean(cancellationScheduled && renewalDate && endDate && renewalDate >= endDate) || Boolean(cancellationScheduled && trial);
  return { ended, cancellationScheduled, finalChargeBeforeEnd, nextChargeDate, noFurtherRenewal };
}
