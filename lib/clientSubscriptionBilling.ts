import type { BillingCycle } from "./subscriptionOffers.ts";
import { Capacitor } from "@capacitor/core";
import { startNativeSubscriptionPurchase, type NativeSubscriptionPurchaseResult } from "./nativeBilling.ts";

export { NativeBillingNotConfiguredError } from "./nativeBilling.ts";

export type ClientBillingPlatform = "web" | "ios" | "android";
export type ClientBillingProvider = "stripe" | "app_store" | "play_store";

type CapacitorLike = {
  getPlatform?: () => string;
  isNativePlatform?: () => boolean;
};

type BrowserRuntime = {
  Capacitor?: CapacitorLike;
  location: {
    assign: (url: string) => void;
  };
};

type CheckoutResponse = {
  error?: string;
  url?: string;
};

export type SubscriptionCheckoutResult =
  | { platform: "web"; provider: "stripe" }
  | NativeSubscriptionPurchaseResult;

export class NativeBillingRequiredError extends Error {
  readonly platform: Exclude<ClientBillingPlatform, "web">;

  constructor(platform: Exclude<ClientBillingPlatform, "web">) {
    super(
      platform === "ios"
        ? "Le paiement Apple doit être utilisé dans l’application iPhone."
        : "Le paiement Google Play doit être utilisé dans l’application Android.",
    );
    this.name = "NativeBillingRequiredError";
    this.platform = platform;
  }
}

function currentBrowserRuntime(): BrowserRuntime | null {
  if (typeof window === "undefined") return null;
  const browserRuntime = window as unknown as BrowserRuntime;
  return {
    ...browserRuntime,
    Capacitor: browserRuntime.Capacitor || {
      isNativePlatform: () => Capacitor.isNativePlatform(),
      getPlatform: () => Capacitor.getPlatform(),
    },
  };
}

export function detectClientBillingPlatform(
  runtime: BrowserRuntime | null = currentBrowserRuntime(),
): ClientBillingPlatform {
  const capacitor = runtime?.Capacitor;
  if (!capacitor?.isNativePlatform?.()) return "web";

  const platform = String(capacitor.getPlatform?.() || "").trim().toLowerCase();
  if (platform === "ios") return "ios";
  if (platform === "android") return "android";
  return "web";
}

export function billingProviderForPlatform(
  platform: ClientBillingPlatform,
): ClientBillingProvider {
  if (platform === "ios") return "app_store";
  if (platform === "android") return "play_store";
  return "stripe";
}

export async function startStandardSubscriptionCheckout({
  billingCycle,
  fallbackError,
  fetchImpl = fetch,
  runtime = currentBrowserRuntime(),
}: {
  billingCycle: BillingCycle;
  fallbackError: string;
  fetchImpl?: typeof fetch;
  runtime?: BrowserRuntime | null;
}): Promise<SubscriptionCheckoutResult> {
  const platform = detectClientBillingPlatform(runtime);
  if (platform !== "web") {
    return startNativeSubscriptionPurchase({
      platform,
      billingCycle,
      fallbackError,
      fetchImpl,
    });
  }

  if (!runtime) throw new Error(fallbackError);

  const response = await fetchImpl("/api/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan: "Standard", billingCycle }),
  });
  const body = (await response.json().catch(() => null)) as CheckoutResponse | null;
  if (!response.ok) throw new Error(body?.error || fallbackError);
  if (!body?.url) throw new Error("La page de paiement n’a pas pu être ouverte.");

  runtime.location.assign(body.url);
  return { platform: "web", provider: "stripe" };
}
