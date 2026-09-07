import { optionalEnv } from "@/lib/env";
import {
  PREMIUM_SUBSCRIPTION_OFFER,
  PREMIUM_SUBSCRIPTION_OFFER_V2,
  STANDARD_SUBSCRIPTION_OFFER,
  STANDARD_SUBSCRIPTION_OFFER_V2,
  type BillingCycle,
  type PricingVersion,
  type SubscriptionOffer,
} from "@/lib/subscriptionOffers";

export type CommercialPriceMatch = {
  edition: "standard" | "premium";
  plan: "Standard" | "Premium";
  billingCycle: BillingCycle;
  chargeAmountEur: number;
  monthlyReferenceEur: number;
  pricingVersion: PricingVersion;
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

export function configuredStandardPriceId(
  cycle: BillingCycle,
  pricingVersion: PricingVersion = "legacy_ttc_v1",
): string {
  if (pricingVersion === "international_ht_v2") {
    return clean(
      cycle === "yearly"
        ? optionalEnv("STRIPE_PRICE_STANDARD_58HT_YEARLY_ID")
        : optionalEnv("STRIPE_PRICE_STANDARD_58HT_MONTHLY_ID"),
    );
  }
  return clean(
    cycle === "yearly"
      ? optionalEnv("STRIPE_PRICE_STANDARD_YEARLY_ID")
      : optionalEnv("STRIPE_PRICE_STANDARD_MONTHLY_ID"),
  );
}

export function configuredPremiumPriceId(
  cycle: BillingCycle,
  pricingVersion: PricingVersion = "legacy_ttc_v1",
): string {
  if (pricingVersion === "international_ht_v2") {
    return clean(
      cycle === "yearly"
        ? optionalEnv("STRIPE_PRICE_PREMIUM_108HT_YEARLY_ID")
        : optionalEnv("STRIPE_PRICE_PREMIUM_108HT_MONTHLY_ID"),
    );
  }
  return clean(
    cycle === "yearly"
      ? optionalEnv("STRIPE_PRICE_PREMIUM_YEARLY_ID")
      : optionalEnv("STRIPE_PRICE_PREMIUM_MONTHLY_ID"),
  );
}

export function commercialPriceFromId(priceId: unknown): CommercialPriceMatch | null {
  const normalizedPriceId = clean(priceId);
  if (!normalizedPriceId) return null;

  const candidate = (
    configuredPriceId: string,
    offer: SubscriptionOffer,
    billingCycle: BillingCycle,
  ): [string, CommercialPriceMatch] => [
    configuredPriceId,
    {
      edition: offer.edition,
      plan: offer.plan,
      billingCycle,
      chargeAmountEur:
        billingCycle === "yearly" ? offer.yearlyPriceEur : offer.monthlyPriceEur,
      monthlyReferenceEur: offer.monthlyPriceEur,
      pricingVersion: offer.pricingVersion,
    },
  ];

  const candidates: Array<[string, CommercialPriceMatch]> = [
    candidate(configuredStandardPriceId("monthly"), STANDARD_SUBSCRIPTION_OFFER, "monthly"),
    candidate(configuredStandardPriceId("yearly"), STANDARD_SUBSCRIPTION_OFFER, "yearly"),
    candidate(configuredPremiumPriceId("monthly"), PREMIUM_SUBSCRIPTION_OFFER, "monthly"),
    candidate(configuredPremiumPriceId("yearly"), PREMIUM_SUBSCRIPTION_OFFER, "yearly"),
    candidate(
      configuredStandardPriceId("monthly", "international_ht_v2"),
      STANDARD_SUBSCRIPTION_OFFER_V2,
      "monthly",
    ),
    candidate(
      configuredStandardPriceId("yearly", "international_ht_v2"),
      STANDARD_SUBSCRIPTION_OFFER_V2,
      "yearly",
    ),
    candidate(
      configuredPremiumPriceId("monthly", "international_ht_v2"),
      PREMIUM_SUBSCRIPTION_OFFER_V2,
      "monthly",
    ),
    candidate(
      configuredPremiumPriceId("yearly", "international_ht_v2"),
      PREMIUM_SUBSCRIPTION_OFFER_V2,
      "yearly",
    ),
  ];

  for (const [configuredPriceId, match] of candidates) {
    if (configuredPriceId && configuredPriceId === normalizedPriceId) return match;
  }

  return null;
}

export function configuredCommercialAnnualPriceIds(): string[] {
  return [
    configuredStandardPriceId("yearly"),
    configuredPremiumPriceId("yearly"),
    configuredStandardPriceId("yearly", "international_ht_v2"),
    configuredPremiumPriceId("yearly", "international_ht_v2"),
  ].filter(Boolean);
}
