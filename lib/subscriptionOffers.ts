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
  yearlyPriceEur: 628,
  annualSavingPercent: 10,
  pricingVersion: "international_ht_v2",
  taxBehavior: "exclusive",
};

// Tarifs annuels commerciaux ronds : remise affichée de 10 % sur les deux offres.
export const PREMIUM_SUBSCRIPTION_OFFER_V2: SubscriptionOffer = {
  edition: "premium",
  plan: "Premium",
  monthlyPriceEur: 108,
  yearlyPriceEur: 1168,
  annualSavingPercent: 10,
  pricingVersion: "international_ht_v2",
  taxBehavior: "exclusive",
};

/** Offers available for a new purchase or an explicitly requested plan change.
 * Existing contracts remain identified by their actual Stripe price, not this constant.
 */
export const CURRENT_COMMERCIAL_PRICING_VERSION: PricingVersion = "international_ht_v2";

export function currentSubscriptionOffer(plan: "Standard" | "Premium"): SubscriptionOffer {
  return plan === "Premium" ? PREMIUM_SUBSCRIPTION_OFFER_V2 : STANDARD_SUBSCRIPTION_OFFER_V2;
}

export function annualSubscriptionSavingRate(offer: SubscriptionOffer): number {
  const monthlyTotal = offer.monthlyPriceEur * 12;
  return monthlyTotal > 0 ? Math.max(0, 1 - offer.yearlyPriceEur / monthlyTotal) : 0;
}

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
