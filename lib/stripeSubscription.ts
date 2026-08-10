type StripeLooseObject = Record<string, unknown>;

function positiveUnixSeconds(value: unknown): number | null {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/**
 * Stripe Basil expose la periode sur les subscription items. Les anciennes
 * versions l'exposaient aussi a la racine : on accepte les deux formes.
 */
export function stripeSubscriptionPeriodEndUnix(subscription: unknown): number | null {
  const sub = (subscription ?? {}) as StripeLooseObject;
  const rootValue = positiveUnixSeconds(sub.current_period_end);
  const items = (sub.items ?? {}) as StripeLooseObject;
  const data = Array.isArray(items.data) ? items.data : [];
  const itemValues = data
    .map((item) => positiveUnixSeconds((item as StripeLooseObject | null)?.current_period_end))
    .filter((value): value is number => value !== null);

  if (itemValues.length > 0) return Math.max(...itemValues);
  return rootValue;
}

export function stripeSubscriptionPeriodEndIso(subscription: unknown): string | null {
  const seconds = stripeSubscriptionPeriodEndUnix(subscription);
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}
