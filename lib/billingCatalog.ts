import { optionalEnv } from "@/lib/env";
import {
  PREMIUM_SUBSCRIPTION_OFFER,
  STANDARD_SUBSCRIPTION_OFFER,
  type BillingCycle,
} from "@/lib/subscriptionOffers";

export type CommercialPriceMatch = {
  edition: "standard" | "premium";
  plan: "Standard" | "Premium";
  billingCycle: BillingCycle;
  chargeAmountEur: number;
  monthlyReferenceEur: number;
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

export function configuredStandardPriceId(cycle: BillingCycle): string {
  return clean(
    cycle === "yearly"
      ? optionalEnv("STRIPE_PRICE_STANDARD_YEARLY_ID")
      : optionalEnv("STRIPE_PRICE_STANDARD_MONTHLY_ID"),
  );
}

export function configuredPremiumPriceId(cycle: BillingCycle): string {
  return clean(
    cycle === "yearly"
      ? optionalEnv("STRIPE_PRICE_PREMIUM_YEARLY_ID")
      : optionalEnv("STRIPE_PRICE_PREMIUM_MONTHLY_ID"),
  );
}

export function commercialPriceFromId(priceId: unknown): CommercialPriceMatch | null {
  const normalizedPriceId = clean(priceId);
  if (!normalizedPriceId) return null;

  const candidates: Array<[string, CommercialPriceMatch]> = [
    [
      configuredStandardPriceId("monthly"),
      {
        edition: "standard",
        plan: "Standard",
        billingCycle: "monthly",
        chargeAmountEur: STANDARD_SUBSCRIPTION_OFFER.monthlyPriceEur,
        monthlyReferenceEur: STANDARD_SUBSCRIPTION_OFFER.monthlyPriceEur,
      },
    ],
    [
      configuredStandardPriceId("yearly"),
      {
        edition: "standard",
        plan: "Standard",
        billingCycle: "yearly",
        chargeAmountEur: STANDARD_SUBSCRIPTION_OFFER.yearlyPriceEur,
        monthlyReferenceEur: STANDARD_SUBSCRIPTION_OFFER.monthlyPriceEur,
      },
    ],
    [
      configuredPremiumPriceId("monthly"),
      {
        edition: "premium",
        plan: "Premium",
        billingCycle: "monthly",
        chargeAmountEur: PREMIUM_SUBSCRIPTION_OFFER.monthlyPriceEur,
        monthlyReferenceEur: PREMIUM_SUBSCRIPTION_OFFER.monthlyPriceEur,
      },
    ],
    [
      configuredPremiumPriceId("yearly"),
      {
        edition: "premium",
        plan: "Premium",
        billingCycle: "yearly",
        chargeAmountEur: PREMIUM_SUBSCRIPTION_OFFER.yearlyPriceEur,
        monthlyReferenceEur: PREMIUM_SUBSCRIPTION_OFFER.monthlyPriceEur,
      },
    ],
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
  ].filter(Boolean);
}
