type StripeLooseObject = Record<string, unknown>;

export type StripeBillingInterval = "day" | "week" | "month" | "year";

export type StripeSubscriptionCadence = {
  interval: StripeBillingInterval;
  intervalCount: number;
};

function positiveInteger(value: unknown, fallback = 1): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function stripeSubscriptionCadence(
  subscription: unknown,
): StripeSubscriptionCadence | null {
  const sub = (subscription ?? {}) as StripeLooseObject;
  const items = (sub.items ?? {}) as StripeLooseObject;
  const data = Array.isArray(items.data) ? items.data : [];
  const firstItem = (data[0] ?? {}) as StripeLooseObject;
  const price = (firstItem.price ?? {}) as StripeLooseObject;
  const recurring = (price.recurring ?? {}) as StripeLooseObject;
  const interval = String(recurring.interval || "") as StripeBillingInterval;

  if (!["day", "week", "month", "year"].includes(interval)) return null;
  return {
    interval,
    intervalCount: positiveInteger(recurring.interval_count),
  };
}

function addClampedUtcMonths(date: Date, months: number): Date {
  const sourceDay = date.getUTCDate();
  const result = new Date(date.getTime());
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDayOfTargetMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(sourceDay, lastDayOfTargetMonth));
  return result;
}

export function addStripeBillingIntervalUnix(
  periodEndUnix: number,
  cadence: StripeSubscriptionCadence,
): number | null {
  if (!Number.isFinite(periodEndUnix) || periodEndUnix <= 0) return null;

  const periodEnd = new Date(periodEndUnix * 1000);
  if (!Number.isFinite(periodEnd.getTime())) return null;

  if (cadence.interval === "day") {
    return periodEndUnix + cadence.intervalCount * 24 * 60 * 60;
  }
  if (cadence.interval === "week") {
    return periodEndUnix + cadence.intervalCount * 7 * 24 * 60 * 60;
  }

  const months = cadence.interval === "year"
    ? cadence.intervalCount * 12
    : cadence.intervalCount;
  return Math.floor(addClampedUtcMonths(periodEnd, months).getTime() / 1000);
}

/**
 * Un essai s'arrête sans débit à son échéance. Une fois payant, un abonnement
 * mensuel iNrCy conserve toujours un renouvellement complet après la demande :
 * ce renouvellement paie le mois de préavis. Les offres annuelles, elles,
 * s'arrêtent à leur échéance en cours sans facturer une nouvelle année entière.
 */
export function stripeCancellationSchedule(
  subscription: unknown,
  currentPeriodEndUnix: number,
): { mode: "custom" | "period_end" | "trial_end"; cancelAtUnix: number } {
  const sub = (subscription ?? {}) as StripeLooseObject;
  if (String(sub.status || "").toLowerCase() === "trialing") {
    return { mode: "trial_end", cancelAtUnix: currentPeriodEndUnix };
  }

  const cadence = stripeSubscriptionCadence(subscription);
  if (cadence?.interval === "month") {
    const nextPeriodEnd = addStripeBillingIntervalUnix(currentPeriodEndUnix, cadence);
    if (nextPeriodEnd) return { mode: "custom", cancelAtUnix: nextPeriodEnd };
  }

  return { mode: "period_end", cancelAtUnix: currentPeriodEndUnix };
}
