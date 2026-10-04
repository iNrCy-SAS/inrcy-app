import assert from "node:assert/strict";
import test from "node:test";
import { canStartSubscriptionCheckout } from "../../lib/subscriptionCheckoutPolicy.ts";
import { inspectComplimentaryCheckout } from "../../lib/stripeCheckoutPreflight.ts";

const freeStandard = { status: "active", app_edition: "standard", plan: "Standard" };
const customer = (id = "cus_account", userId: string | null = "user_1") => ({
  id, email: "account@example.test", metadata: userId ? { user_id: userId } : {},
});
const subscription = (overrides: Record<string, unknown> = {}) => ({
  id: "sub_current", customer: "cus_account", status: "active", metadata: { user_id: "user_1" },
  items: { data: [{ price: { id: "price_standard" } }] }, ...overrides,
});
const page = (data: unknown[], hasMore = false) => ({ data, has_more: hasMore });

function fixture(options: {
  localCustomerId?: string;
  emailCustomers?: unknown[];
  searchCustomers?: unknown[];
  subscriptions?: unknown[];
  otherOwner?: boolean;
  getOverride?: (url: URL) => unknown;
} = {}) {
  const paths: string[] = [];
  const ownerChecks: Array<{ customerIds: string[]; subscriptionIds: string[] }> = [];
  const input = {
    userId: "user_1",
    customerId: options.localCustomerId ?? null,
    emails: ["account@example.test", "account@example.test", null],
    get: async (path: string): Promise<unknown> => {
      paths.push(path);
      const url = new URL(path, "https://api.stripe.test");
      const override = options.getOverride?.(url);
      if (override !== undefined) return override;
      if (url.pathname === "/customers") {
        assert.equal(url.searchParams.get("email"), "account@example.test");
        return page(options.emailCustomers ?? []);
      }
      if (url.pathname === "/customers/search") {
        assert.equal(url.searchParams.get("query"), "metadata['user_id']:'user_1'");
        return page(options.searchCustomers ?? []);
      }
      if (url.pathname === "/customers/cus_account") return customer();
      if (url.pathname === "/subscriptions") {
        assert.ok(url.searchParams.get("customer"), "never scan the whole Stripe account");
        assert.equal(url.searchParams.get("status"), "all");
        return page(options.subscriptions ?? []);
      }
      throw new Error(`Unexpected Stripe read: ${url.pathname}`);
    },
    hasOtherOwner: async (customerIds: string[], subscriptionIds: string[]) => {
      ownerChecks.push({ customerIds, subscriptionIds });
      return options.otherOwner ?? false;
    },
  };
  return { input, paths, ownerChecks };
}

test("complimentary active Standard may start Premium but cannot buy Standard again", () => {
  assert.equal(canStartSubscriptionCheckout(freeStandard, "Premium"), true);
  assert.equal(canStartSubscriptionCheckout(freeStandard, "Standard"), false);
  assert.equal(canStartSubscriptionCheckout({ ...freeStandard, app_edition: "premium", plan: "Premium" }, "Premium"), false);
});

test("existing contracts, payment recovery, native references and managed accounts never enter free-account checkout", () => {
  for (const change of [
    { stripe_subscription_id: "sub_current" },
    { billing_provider: "app_store" },
    { billing_provider: "play_store" },
    { native_product_id: "native_product" },
    { billing_provider: "manual" },
    { app_edition: "founder", plan: "Founder" },
    ...["past_due", "unpaid", "paused", "incomplete"].map((status) => ({ status })),
  ]) assert.equal(canStartSubscriptionCheckout({ ...freeStandard, ...change }, "Premium"), false);
});

test("trial and terminated commercial accounts retain their initial subscription paths", () => {
  for (const status of ["trialing", "trial_expired", "canceled", "cancelled", "incomplete_expired", ""]) {
    assert.equal(canStartSubscriptionCheckout({ ...freeStandard, status }, "Standard"), true);
    assert.equal(canStartSubscriptionCheckout({ ...freeStandard, status }, "Premium"), true);
  }
  assert.equal(canStartSubscriptionCheckout({ ...freeStandard, status: "trialing", stripe_subscription_id: "sub_trial" }, "Premium"), false);
  assert.equal(canStartSubscriptionCheckout(null, "Premium"), false);
});

test("a free account with no Stripe contract remains eligible without any payment mutation", async () => {
  const { input, paths } = fixture();
  assert.deepEqual(await inspectComplimentaryCheckout(input), { customerId: null, existingSubscription: null });
  assert.equal(paths.filter((path) => path.startsWith("/customers?")).length, 1, "deduplicate repeated profile emails");
  assert.equal(paths.length, 2);
});

test("known customer recovery returns the same active subscription for plan change", async () => {
  const { input, paths, ownerChecks } = fixture({ localCustomerId: "cus_account", subscriptions: [subscription()] });
  const result = await inspectComplimentaryCheckout(input);
  assert.equal(result.existingSubscription?.id, "sub_current");
  assert.equal(result.existingSubscription?.priceId, "price_standard");
  assert.equal(result.customerId, "cus_account");
  assert.deepEqual(ownerChecks, [{ customerIds: ["cus_account"], subscriptionIds: ["sub_current"] }]);
  assert.equal(paths.some((path) => path.includes("/search")), false);
});

test("metadata lookup recovers a missing customer ID after an email change", async () => {
  const { input } = fixture({ searchCustomers: [customer()], subscriptions: [subscription()] });
  assert.equal((await inspectComplimentaryCheckout(input)).existingSubscription?.id, "sub_current");
});

test("subscription metadata establishes ownership when a legacy customer has none", async () => {
  const { input } = fixture({ emailCustomers: [customer("cus_account", null)], subscriptions: [subscription()] });
  assert.equal((await inspectComplimentaryCheckout(input)).customerId, "cus_account");
});

test("email alone never attaches a live subscription to an account", async () => {
  const { input } = fixture({ emailCustomers: [customer("cus_account", null)], subscriptions: [subscription({ metadata: {} })] });
  await assert.rejects(inspectComplimentaryCheckout(input), /identity_ambiguous/);
});

test("contradictory Stripe metadata and another database owner block checkout", async () => {
  const variants = [
    fixture({ emailCustomers: [customer("cus_account", "user_2")], subscriptions: [subscription()] }),
    fixture({ localCustomerId: "cus_account", subscriptions: [subscription({ metadata: { user_id: "user_2" } })] }),
    fixture({ localCustomerId: "cus_account", subscriptions: [subscription()], otherOwner: true }),
  ];
  for (const { input } of variants) await assert.rejects(inspectComplimentaryCheckout(input), /identity_ambiguous/);
});

test("more than one live subscription is ambiguous instead of selecting one", async () => {
  const { input } = fixture({ localCustomerId: "cus_account", subscriptions: [subscription(), subscription({ id: "sub_other" })] });
  await assert.rejects(inspectComplimentaryCheckout(input), /identity_ambiguous/);
});

test("an active subscription beyond the first page cannot be mistaken for a free account", async () => {
  const { input, paths } = fixture({
    localCustomerId: "cus_account",
    getOverride: (url) => url.pathname === "/subscriptions"
      ? url.searchParams.has("starting_after")
        ? page([subscription()])
        : page([subscription({ id: "sub_old", status: "canceled" })], true)
      : undefined,
  });
  assert.equal((await inspectComplimentaryCheckout(input)).existingSubscription?.id, "sub_current");
  assert.ok(paths.some((path) => path.includes("starting_after=sub_old")));
});

test("email and metadata result pagination is exhausted before checkout", async () => {
  const { input } = fixture({
    subscriptions: [subscription()],
    getOverride: (url) => {
      if (url.pathname === "/customers") return url.searchParams.has("starting_after")
        ? page([customer()]) : page([customer("cus_old", null)], true);
      if (url.pathname === "/customers/search") return url.searchParams.has("page")
        ? page([customer()]) : { ...page([], true), next_page: "next_customer_page" };
      if (url.pathname === "/subscriptions" && url.searchParams.get("customer") === "cus_old") return page([]);
    },
  });
  assert.equal((await inspectComplimentaryCheckout(input)).existingSubscription?.id, "sub_current");
});

test("unavailable, partial or malformed Stripe reads never authorize a new checkout", async () => {
  const variants = [
    fixture({ getOverride: (url) => { if (url.pathname.endsWith("search")) throw new Error("Stripe unavailable"); } }),
    fixture({ getOverride: (url) => url.pathname.endsWith("search") ? { data: [] } : undefined }),
    fixture({ localCustomerId: "cus_account", getOverride: (url) => url.pathname === "/customers/cus_account" ? customer("cus_wrong") : undefined }),
    fixture({ localCustomerId: "cus_account", subscriptions: [subscription({ status: "unknown" })] }),
    fixture({ localCustomerId: "cus_account", subscriptions: [subscription({ customer: "cus_wrong" })] }),
  ];
  for (const { input } of variants) await assert.rejects(inspectComplimentaryCheckout(input));
});

test("pagination limits fail closed and a trusted empty customer can be reused", async () => {
  const repeated = fixture({ localCustomerId: "cus_account", getOverride: (url) => url.pathname === "/subscriptions"
    ? page([subscription({ status: "canceled" })], true) : undefined });
  await assert.rejects(inspectComplimentaryCheckout(repeated.input), /pagination/);
  const empty = fixture({ searchCustomers: [customer()] });
  assert.deepEqual(await inspectComplimentaryCheckout(empty.input), { customerId: "cus_account", existingSubscription: null });
});
