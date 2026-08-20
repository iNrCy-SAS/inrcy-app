import assert from "node:assert/strict";
import test from "node:test";

import {
  NativeBillingNotConfiguredError,
  billingProviderForPlatform,
  detectClientBillingPlatform,
  startStandardSubscriptionCheckout,
} from "../../lib/clientSubscriptionBilling.ts";

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
