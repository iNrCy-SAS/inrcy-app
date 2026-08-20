export type NativeSubscriptionPlan = "Standard" | "Premium";

export type NativeBillingCycle = "monthly" | "yearly";

type NativeProductIds = Record<NativeSubscriptionPlan, Record<NativeBillingCycle, string>>;

const DEFAULT_NATIVE_PRODUCT_IDS: NativeProductIds = {
  Standard: {
    monthly: "com.inrcy.standard.monthly",
    yearly: "com.inrcy.standard.yearly",
  },
  Premium: {
    monthly: "com.inrcy.premium.monthly",
    yearly: "com.inrcy.premium.yearly",
  },
};

function publicEnv(name: string, fallback: string): string {
  const value = typeof process === "undefined" ? "" : String(process.env[name] || "").trim();
  return value || fallback;
}

export function nativeProductIdFor(
  plan: NativeSubscriptionPlan,
  billingCycle: NativeBillingCycle,
): string {
  const envName = `NEXT_PUBLIC_REVENUECAT_${plan.toUpperCase()}_${billingCycle.toUpperCase()}_PRODUCT_ID`;
  return publicEnv(envName, DEFAULT_NATIVE_PRODUCT_IDS[plan][billingCycle]);
}

export function nativeEntitlementForPlan(plan: NativeSubscriptionPlan): string {
  return plan.toLowerCase();
}

export function nativeSubscriptionFromProductId(productId: unknown): {
  plan: NativeSubscriptionPlan;
  billingCycle: NativeBillingCycle;
} | null {
  const normalized = String(productId || "").trim();
  if (!normalized) return null;

  for (const plan of ["Standard", "Premium"] as const) {
    for (const billingCycle of ["monthly", "yearly"] as const) {
      if (nativeProductIdFor(plan, billingCycle) === normalized) {
        return { plan, billingCycle };
      }
    }
  }

  return null;
}

export function nativeProductIds(): string[] {
  return (Object.keys(DEFAULT_NATIVE_PRODUCT_IDS) as NativeSubscriptionPlan[]).flatMap((plan) =>
    (Object.keys(DEFAULT_NATIVE_PRODUCT_IDS[plan]) as NativeBillingCycle[]).map((billingCycle) =>
      nativeProductIdFor(plan, billingCycle),
    ),
  );
}
