import type { ClientBillingProvider } from "@/lib/clientSubscriptionBilling";

const STORE_MANAGEMENT_URLS: Record<Exclude<ClientBillingProvider, "stripe">, string> = {
  app_store: "https://apps.apple.com/account/subscriptions",
  play_store: "https://play.google.com/store/account/subscriptions?package=com.inrcy.app",
};

export async function openNativeSubscriptionManagement(
  provider: Exclude<ClientBillingProvider, "stripe">,
): Promise<void> {
  const url = STORE_MANAGEMENT_URLS[provider];
  if (typeof window === "undefined") throw new Error("La gestion de l’abonnement est indisponible.");

  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url });
    return;
  } catch {
    // The browser fallback below is intentional for the web dashboard.
  }

  window.open(url, "_blank", "noopener,noreferrer");
}
