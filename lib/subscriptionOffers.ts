export type BillingCycle = "monthly" | "yearly";

export type PricingVersion = "legacy_ttc_v1" | "international_ht_v2";
export type TaxBehavior = "inclusive" | "exclusive";

export type SubscriptionOffer = {
  edition: "standard" | "premium";
  plan: "Standard" | "Premium";
  monthlyPriceEur: number;
  yearlyPriceEur: number;
  annualSavingPercent: number;
  pricingVersion: PricingVersion;
  taxBehavior: TaxBehavior;
};

export const PRICING_V2_CUTOVER_ENV = "NEXT_PUBLIC_INRCY_PRICING_V2_CUTOVER_AT";

// Contrats historiques : ne jamais modifier ces montants.
export const STANDARD_SUBSCRIPTION_OFFER: SubscriptionOffer = {
  edition: "standard",
  plan: "Standard",
  monthlyPriceEur: 69,
  yearlyPriceEur: 730,
  annualSavingPercent: 12,
  pricingVersion: "legacy_ttc_v1",
  taxBehavior: "inclusive",
};

export const PREMIUM_SUBSCRIPTION_OFFER: SubscriptionOffer = {
  edition: "premium",
  plan: "Premium",
  monthlyPriceEur: 129,
  yearlyPriceEur: 1390,
  annualSavingPercent: 10,
  pricingVersion: "legacy_ttc_v1",
  taxBehavior: "inclusive",
};

export const STANDARD_SUBSCRIPTION_OFFER_V2: SubscriptionOffer = {
  edition: "standard",
  plan: "Standard",
  monthlyPriceEur: 58,
  yearlyPriceEur: 612.48,
  annualSavingPercent: 12,
  pricingVersion: "international_ht_v2",
  taxBehavior: "exclusive",
};

// 1 163,72 € = 108 × 12 × (1 - 158 / 1 548), arrondi au centime.
// Cela conserve la remise effective de l'ancien annuel Premium (1 390 vs 129 × 12), soit 10,2067 %.
export const PREMIUM_SUBSCRIPTION_OFFER_V2: SubscriptionOffer = {
  edition: "premium",
  plan: "Premium",
  monthlyPriceEur: 108,
  yearlyPriceEur: 1163.72,
  annualSavingPercent: 10.21,
  pricingVersion: "international_ht_v2",
  taxBehavior: "exclusive",
};

export function pricingVersionForAccountCreatedAt(
  accountCreatedAt: unknown,
  cutoverAt: unknown = process.env.NEXT_PUBLIC_INRCY_PRICING_V2_CUTOVER_AT,
): PricingVersion {
  const createdAtMs = new Date(String(accountCreatedAt ?? "")).getTime();
  const cutoverAtMs = new Date(String(cutoverAt ?? "")).getTime();
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(cutoverAtMs)) {
    return "legacy_ttc_v1";
  }
  return createdAtMs >= cutoverAtMs ? "international_ht_v2" : "legacy_ttc_v1";
}

export function standardSubscriptionOfferForAccountCreatedAt(
  accountCreatedAt: unknown,
  cutoverAt?: unknown,
): SubscriptionOffer {
  return pricingVersionForAccountCreatedAt(accountCreatedAt, cutoverAt) === "international_ht_v2"
    ? STANDARD_SUBSCRIPTION_OFFER_V2
    : STANDARD_SUBSCRIPTION_OFFER;
}

export function premiumSubscriptionOfferForAccountCreatedAt(
  accountCreatedAt: unknown,
  cutoverAt?: unknown,
): SubscriptionOffer {
  return pricingVersionForAccountCreatedAt(accountCreatedAt, cutoverAt) === "international_ht_v2"
    ? PREMIUM_SUBSCRIPTION_OFFER_V2
    : PREMIUM_SUBSCRIPTION_OFFER;
}

export function subscriptionChargeLabel(
  cycle: BillingCycle,
  offer: SubscriptionOffer = STANDARD_SUBSCRIPTION_OFFER,
): string {
  const taxLabel = offer.taxBehavior === "exclusive" ? "HT" : "TTC";
  return cycle === "yearly"
    ? `${offer.yearlyPriceEur} EUR ${taxLabel} / an`
    : `${offer.monthlyPriceEur} EUR ${taxLabel} / mois`;
}
