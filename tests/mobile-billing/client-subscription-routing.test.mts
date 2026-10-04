import assert from "node:assert/strict";
import test from "node:test";

import {
  NativeBillingNotConfiguredError,
  billingProviderForPlatform,
  detectClientBillingPlatform,
  loadStandardSubscriptionStorePrices,
  startStandardSubscriptionCheckout,
  startSubscriptionCheckout,
} from "../../lib/clientSubscriptionBilling.ts";

test("a recovered Stripe subscription resumes its plan change without opening a second checkout", async () => {
  const browser = runtime();
  const result = await startSubscriptionCheckout({
    plan: "Premium", billingCycle: "monthly", fallbackError: "Erreur", runtime: browser.value,
    fetchImpl: (async () => ({ ok: true, json: async () => ({ recoveredSubscription: true, nextAction: "change_plan" }) }) as Response) as typeof fetch,
  });
  assert.deepEqual(result, { platform: "web", provider: "stripe", recoveredSubscription: true, nextAction: "change_plan" });
  assert.deepEqual(browser.assigned, []);
});

for (const accepted of [true, false]) {
  test(`technical trial extension displays the actual date before Stripe and respects confirmation=${accepted}`, async () => {
    const browser = runtime();
    const trialEndAt = "2030-01-03T18:02:00.000Z";
    let confirmed = false;
    const result = await startSubscriptionCheckout({
      plan: "Premium", billingCycle: "yearly", fallbackError: "Erreur", runtime: browser.value,
      confirmTrialExtension: (date) => {
        assert.equal(date, trialEndAt);
        assert.deepEqual(browser.assigned, [], "the date is shown before leaving the application");
        confirmed = true;
        return accepted;
      },
      fetchImpl: (async () => Response.json({ url: "https://checkout.stripe.com/test", trialExtended: true, trialEndAt })) as typeof fetch,
    });
    assert.equal(confirmed, true);
    assert.deepEqual(browser.assigned, accepted ? ["https://checkout.stripe.com/test"] : []);
    if (!accepted) assert.deepEqual(result, { platform: "web", provider: "stripe", checkoutCancelled: true });
  });
}

test("an extension without a valid date and explicit confirmation cannot silently open Stripe", async () => {
  const browser = runtime();
  await assert.rejects(startSubscriptionCheckout({
    plan: "Standard", billingCycle: "monthly", fallbackError: "Trial verification required", runtime: browser.value,
    fetchImpl: (async () => Response.json({ url: "https://checkout.stripe.com/test", trialExtended: true })) as typeof fetch,
  }), /Trial verification required/);
  assert.deepEqual(browser.assigned, []);
});

function runtime(platform?: "ios" | "android") {
  const assigned: string[] = [];
  return {
    assigned,
    value: {
      ...(platform
        ? {
            Capacitor: {
              isNativePlatform: () => true,
              getPlatform: () => platform,
            },
          }
        : {}),
      location: {
        assign: (url: string) => assigned.push(url),
      },
    },
  };
}

test("routes each client platform to its official billing provider", () => {
  assert.equal(billingProviderForPlatform("web"), "stripe");
  assert.equal(billingProviderForPlatform("ios"), "app_store");
  assert.equal(billingProviderForPlatform("android"), "play_store");
});

test("detects Capacitor iOS and Android without changing normal web clients", () => {
  assert.equal(detectClientBillingPlatform(runtime().value), "web");
  assert.equal(detectClientBillingPlatform(runtime("ios").value), "ios");
  assert.equal(detectClientBillingPlatform(runtime("android").value), "android");
});

test("keeps Stripe prices on the web without loading store products", async () => {
  let nativeLoaderCalled = false;
  const result = await loadStandardSubscriptionStorePrices({
    runtime: runtime().value,
    loadNativePrices: async () => {
      nativeLoaderCalled = true;
      return { monthly: "69,90 €", yearly: "749,99 €" };
    },
  });

  assert.equal(result, null);
  assert.equal(nativeLoaderCalled, false);
});

test("loads the localized Store prices for native clients", async () => {
  const result = await loadStandardSubscriptionStorePrices({
    runtime: runtime("ios").value,
    loadNativePrices: async ({ platform, plan }) => {
      assert.equal(platform, "ios");
      assert.equal(plan, "Standard");
      return { monthly: "69,90 €", yearly: "749,99 €" };
    },
  });

  assert.deepEqual(result, {
    platform: "ios",
    labels: { monthly: "69,90 €", yearly: "749,99 €" },
  });
});

test("preserves the current Stripe checkout on the web", async () => {
  const browser = runtime();
  let requestBody = "";

  await startStandardSubscriptionCheckout({
    billingCycle: "yearly",
    fallbackError: "Erreur",
    runtime: browser.value,
    fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = String(init?.body || "");
      return {
        ok: true,
        json: async () => ({ url: "https://checkout.stripe.com/test" }),
      } as Response;
    }) as typeof fetch,
  });

  assert.deepEqual(JSON.parse(requestBody), {
    plan: "Standard",
    billingCycle: "yearly",
  });
  assert.deepEqual(browser.assigned, ["https://checkout.stripe.com/test"]);
});

test("never redirects a native app to Stripe before native billing is configured", async () => {
  const ios = runtime("ios");
  let fetchCalled = false;

  await assert.rejects(
    startStandardSubscriptionCheckout({
      billingCycle: "monthly",
      fallbackError: "Erreur",
      runtime: ios.value,
      fetchImpl: (async () => {
        fetchCalled = true;
        throw new Error("unexpected");
      }) as typeof fetch,
    }),
    (error: unknown) => error instanceof NativeBillingNotConfiguredError && error.platform === "ios",
  );

  assert.equal(fetchCalled, false);
  assert.deepEqual(ios.assigned, []);
});
