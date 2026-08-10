export type BillingCycle = "monthly" | "yearly";

export const STANDARD_SUBSCRIPTION_OFFER = {
  edition: "standard",
  plan: "Standard",
  monthlyPriceEur: 69,
  yearlyPriceEur: 730,
  annualSavingPercent: 12,
} as const;

export const PREMIUM_SUBSCRIPTION_OFFER = {
  edition: "premium",
  plan: "Premium",
  monthlyPriceEur: 129,
  yearlyPriceEur: 1390,
  annualSavingPercent: 10,
} as const;

export function subscriptionChargeLabel(
  cycle: BillingCycle,
  offer = STANDARD_SUBSCRIPTION_OFFER,
): string {
  return cycle === "yearly"
    ? `${offer.yearlyPriceEur} EUR TTC / an`
    : `${offer.monthlyPriceEur} EUR TTC / mois`;
}
