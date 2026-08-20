import { createClient } from "./supabaseClient.ts";
import type { ClientBillingPlatform } from "./clientSubscriptionBilling.ts";
import {
  nativeEntitlementForPlan,
  nativeProductIdFor,
  type NativeBillingCycle,
  type NativeSubscriptionPlan,
} from "./nativeBillingCatalog.ts";

export class NativeBillingNotConfiguredError extends Error {
  readonly platform: Exclude<ClientBillingPlatform, "web">;

  constructor(platform: Exclude<ClientBillingPlatform, "web">) {
    super(
      platform === "ios"
        ? "Le paiement iPhone n’est pas encore configuré."
        : "Le paiement Android n’est pas encore configuré.",
    );
    this.name = "NativeBillingNotConfiguredError";
    this.platform = platform;
  }
}

export class NativePurchaseCancelledError extends Error {
  constructor() {
    super("Le paiement a été annulé.");
    this.name = "NativePurchaseCancelledError";
  }
}

type RevenueCatModule = typeof import("@revenuecat/purchases-capacitor");

function revenueCatApiKey(platform: Exclude<ClientBillingPlatform, "web">): string {
  const envName =
    platform === "ios"
      ? "NEXT_PUBLIC_REVENUECAT_IOS_API_KEY"
      : "NEXT_PUBLIC_REVENUECAT_ANDROID_API_KEY";
  return String(process.env[envName] || "").trim();
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (record.userCancelled === true) return "";
    const nested = record.underlyingErrorMessage || record.message;
    if (typeof nested === "string" && nested.trim()) return nested.trim();
  }
  return error instanceof Error ? error.message : String(error || "");
}

async function configureRevenueCat(
  platform: Exclude<ClientBillingPlatform, "web">,
  appUserId: string,
): Promise<RevenueCatModule> {
  const apiKey = revenueCatApiKey(platform);
  if (!apiKey) throw new NativeBillingNotConfiguredError(platform);

  const revenueCat = await import("@revenuecat/purchases-capacitor");
  await revenueCat.Purchases.setLogLevel({ level: revenueCat.LOG_LEVEL.ERROR });

  const configured = await revenueCat.Purchases.isConfigured();
  if (!configured.isConfigured) {
    await revenueCat.Purchases.configure({
      apiKey,
      appUserID: appUserId,
      shouldShowInAppMessagesAutomatically: true,
    });
  } else {
    const currentUser = await revenueCat.Purchases.getAppUserID();
    if (currentUser.appUserID !== appUserId) {
      await revenueCat.Purchases.logIn({ appUserID: appUserId });
    }
  }

  return revenueCat;
}

export type NativeSubscriptionPurchaseResult = {
  platform: Exclude<ClientBillingPlatform, "web">;
  provider: "app_store" | "play_store";
  plan: NativeSubscriptionPlan;
  billingCycle: NativeBillingCycle;
  productId: string;
};

export async function startNativeSubscriptionPurchase({
  platform,
  plan = "Standard",
  billingCycle,
  fallbackError,
  fetchImpl = fetch,
}: {
  platform: Exclude<ClientBillingPlatform, "web">;
  plan?: NativeSubscriptionPlan;
  billingCycle: NativeBillingCycle;
  fallbackError: string;
  fetchImpl?: typeof fetch;
}): Promise<NativeSubscriptionPurchaseResult> {
  const apiKey = revenueCatApiKey(platform);
  if (!apiKey) throw new NativeBillingNotConfiguredError(platform);

  const supabase = createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) throw new Error(fallbackError);

  const eligibilityResponse = await fetchImpl("/api/billing/native/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan, billingCycle }),
  });
  const eligibilityBody = (await eligibilityResponse.json().catch(() => null)) as { error?: string } | null;
  if (!eligibilityResponse.ok) throw new Error(eligibilityBody?.error || fallbackError);

  const productId = nativeProductIdFor(plan, billingCycle);
  const revenueCat = await configureRevenueCat(platform, authData.user.id);
  let productsResponse: Awaited<ReturnType<RevenueCatModule["Purchases"]["getProducts"]>>;
  try {
    productsResponse = await revenueCat.Purchases.getProducts({
      productIdentifiers: [productId],
    });
  } catch (error) {
    throw new Error(errorMessage(error) || fallbackError);
  }
  const product = productsResponse.products[0];
  if (!product) {
    throw new Error("Cette formule mobile n’est pas encore disponible.");
  }

  try {
    const purchase = await revenueCat.Purchases.purchaseStoreProduct({ product });
    const entitlementId = nativeEntitlementForPlan(plan);
    const entitlement = purchase.customerInfo.entitlements.active[entitlementId];
    if (!entitlement?.isActive) {
      throw new Error("L’achat n’a pas encore été confirmé par le magasin.");
    }
  } catch (error) {
    if (error && typeof error === "object" && (error as Record<string, unknown>).userCancelled === true) {
      throw new NativePurchaseCancelledError();
    }
    const message = errorMessage(error);
    throw new Error(message || "Le paiement mobile n’a pas pu être finalisé.");
  }

  return {
    platform,
    provider: platform === "ios" ? "app_store" : "play_store",
    plan,
    billingCycle,
    productId,
  };
}
