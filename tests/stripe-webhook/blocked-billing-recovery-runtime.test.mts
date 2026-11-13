import { userFacingErrorsFixture } from "../helpers/user-facing-errors-fixture.mts";
import { catalogTranslator } from "../helpers/catalog-translator.mts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import * as offers from "../../lib/subscriptionOffers.ts";
import * as edition from "../../lib/dashboardEdition.ts";
import * as checkoutPolicy from "../../lib/subscriptionCheckoutPolicy.ts";
import * as accountPolicy from "../../lib/accountSubscriptionPolicy.ts";
import * as preflight from "../../lib/stripeCheckoutPreflight.ts";
import * as reviewerAccess from "../../lib/reviewerAccess.ts";
import * as accountNormalization from "../../lib/multicompte/normalize.ts";
import type { StripeCheckoutGuard } from "../../lib/stripeCheckoutSessionGuard.ts";

const require = createRequire(import.meta.url);
const { NextRequest, NextResponse } = require("next/server");
const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const compiled = new Map<string, string>();
function load<T>(path: string, modules: Record<string, unknown>, env: Record<string, string> = {}): T {
  if (!compiled.has(path)) compiled.set(path, ts.transpileModule(source(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText);
  const loaded = { exports: {} as T };
  new Function("module", "exports", "require", "process", compiled.get(path)!)(loaded, loaded.exports, (id: string) => {
    assert.ok(Object.hasOwn(modules, id), `Unexpected dependency: ${id}`);
    return modules[id];
  }, { env });
  return loaded.exports;
}

type Row = Record<string, unknown>;
const actor = "user_payer";
const stripeSubscription = (status: string, overrides: Row = {}) => ({
  id: "sub_current", customer: "cus_payer", status, metadata: { user_id: actor },
  items: { data: [{ price: { id: "price_standard_monthly" } }] }, ...overrides,
});
const expiredAt = "2020-01-22T00:00:00.000Z";

function billingFixture(options: {
  row?: Row; live?: Row[]; linked?: Row; customerOwner?: string; otherOwner?: boolean;
  unauthenticated?: boolean; noCustomerFound?: boolean; stripeFailure?: boolean; legacyMetadata?: boolean;
} = {}) {
  const row: Row = { status: "trial_expired", plan: "Standard", app_edition: "standard",
    stripe_customer_id: "cus_payer", stripe_subscription_id: null, billing_provider: "stripe", ...options.row };
  const posts: Array<{ path: string; params: URLSearchParams }> = [];
  const writes: Row[] = [];
  const payerReads: string[] = [];
  const stripeReads: string[] = [];
  let guardHeld = false;
  let guardChecks = 0;
  let checkoutSessions = 0;
  const query = (table: string) => {
    let ownershipQuery = false;
    const q = {
      select() { return q; },
      eq(key: string, value: unknown) {
        if (key === "user_id") { assert.equal(value, actor, "billing is scoped to the verified payer"); payerReads.push(String(value)); }
        return q;
      },
      neq(key: string, value: unknown) { assert.equal(key, "user_id"); assert.equal(value, actor); ownershipQuery = true; return q; },
      in(key: string, values: string[]) {
        assert.ok(["stripe_customer_id", "stripe_subscription_id"].includes(key)); assert.ok(values.length); return q;
      },
      limit() { return q; }, is() { return q; },
      update(patch: Row) { assert.ok(guardHeld); assert.ok(guardChecks); writes.push(patch); return q; },
      async maybeSingle() { return { data: table === "subscriptions" ? { ...row, user_id: actor } : {}, error: null }; },
      then(resolve: (value: { data: Row[]; error: null }) => unknown) {
        assert.ok(ownershipQuery || writes.length);
        return Promise.resolve(resolve({ data: ownershipQuery && options.otherOwner ? [{ user_id: "user_other" }] : [], error: null }));
      },
    };
    return q;
  };
  const stripeGet = async (path: string) => {
    stripeReads.push(path);
    if (options.stripeFailure) throw new Error("fixture Stripe unavailable");
    const url = new URL(path, "https://stripe.invalid");
    if (url.pathname === "/subscriptions/sub_current") return options.linked ?? stripeSubscription(String(row.status));
    if (url.pathname === "/customers/cus_payer") return { id: "cus_payer", metadata: options.legacyMetadata ? {} : { user_id: options.customerOwner ?? actor } };
    if (url.pathname === "/subscriptions") {
      assert.equal(url.searchParams.get("customer"), "cus_payer");
      return { data: options.live ?? [], has_more: false };
    }
    if (url.pathname === "/customers" || url.pathname === "/customers/search") {
      return { data: options.noCustomerFound ? [] : [{ id: "cus_payer", metadata: { user_id: options.customerOwner ?? actor } }], has_more: false };
    }
    throw new Error(`Unexpected Stripe read ${path}`);
  };
  class CheckoutGuardError extends Error {
    readonly code: string;
    readonly status: number;
    constructor(code: string, status = 409) { super(code); this.code = code; this.status = status; }
  }
  const catalog = load<Record<string, unknown>>("lib/billingCatalog.ts", {
    "@/lib/env": { optionalEnv: (key: string) => key.startsWith("STRIPE_PRICE_") ? `price_${key.toLowerCase()}` : "" },
    "@/lib/subscriptionOffers": offers,
  });
  const modules = {
    "next/server": { NextResponse },
    "@/lib/requireUser": { requireUser: async () => options.unauthenticated
      ? { errorResponse: Response.json({ error: "Non authentifié" }, { status: 401 }) }
      : { user: { id: actor, email: "payer@example.invalid" }, activeUserId: "account_other", errorResponse: null, supabase: { from: query } } },
    "@/lib/supabaseAdmin": { supabaseAdmin: { from: query } },
    "@/lib/stripeRest": {
      getAppUrl: () => "https://app.example.invalid", stripeGet,
      stripePost: async (path: string, params: URLSearchParams) => {
        posts.push({ path, params: new URLSearchParams(params) });
        if (path === "/billing_portal/sessions") return { url: "https://billing.stripe.invalid/session" };
        if (path === "/checkout/sessions") return { id: "cs_recovery", url: "https://checkout.stripe.invalid/session" };
        if (path === "/customers") return { id: "cus_payer" };
        throw new Error(`Unexpected Stripe write ${path}`);
      },
    },
    "@/lib/userFacingErrors": { getSimpleFrenchErrorMessage: (_error: unknown, fallback: string) => fallback },
    "@/lib/stripeCheckoutPreflight": preflight,
    "@/lib/accountSubscriptionPolicy": accountPolicy,
    "@/lib/subscriptionOffers": offers,
    "@/lib/subscriptionCheckoutPolicy": checkoutPolicy,
    "@/lib/dashboardEdition": edition,
    "@/lib/billingCatalog": catalog,
    "@/lib/trialSubscription": {
      getTrialDays: () => 21,
      computeTrialDatesFromStartDate: (date: string, days: number) => ({
        trialEndAt: new Date(Date.parse(date) + days * 86400_000).toISOString(),
      }),
    },
    "@/lib/stripeCheckoutSessionGuard": {
      CheckoutGuardError,
      withStripeCheckoutGuard: async <T,>(userId: string, action: (guard: StripeCheckoutGuard) => Promise<T>) => {
        assert.equal(userId, actor); guardHeld = true;
        try { return await action({
          assertOwned: async () => { assert.ok(guardHeld); guardChecks++; },
          resolveSession: async (input) => {
            await input.assertNoLiveSubscription(); checkoutSessions++;
            const result = await input.post("/checkout/sessions", input.params) as { url: string };
            return { id: "cs_recovery", url: result.url, reused: false, trialEndUnix: null };
          },
        }); } finally { guardHeld = false; }
      },
    },
  };
  const portal = load<{ POST(req: Request): Promise<Response> }>("app/api/billing/portal/route.ts", modules, { STRIPE_SECRET_KEY: "fixture_not_a_key" });
  const checkout = load<{ POST(req: Request): Promise<Response> }>("app/api/billing/checkout/route.ts", modules, { STRIPE_SECRET_KEY: "fixture_not_a_key" });
  const request = (path: string) => new Request(`https://app.example.invalid/api/billing/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan: "Standard", billingCycle: "monthly", userId: "user_other", customerId: "cus_other", activeAccountId: "account_other" }),
  });
  return { row, posts, writes, payerReads, stripeReads, get checkoutSessions() { return checkoutSessions; },
    portal: () => portal.POST(request("portal")), checkout: () => checkout.POST(request("checkout")) };
}

for (const status of ["past_due", "unpaid", "incomplete", "paused"]) {
  test(`${status} opens existing recovery billing without a new subscription or entitlement change`, async () => {
    for (const route of ["portal", "checkout"] as const) {
      const f = billingFixture({ row: { status, stripe_subscription_id: "sub_current" }, live: [stripeSubscription(status)] });
      const response = await f[route]();
      assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
      assert.equal((await response.json()).url, "https://billing.stripe.invalid/session");
      assert.equal(f.posts.length, 1); assert.equal(f.posts[0].path, "/billing_portal/sessions");
      assert.equal(f.posts[0].params.get("customer"), "cus_payer");
      assert.equal(f.posts[0].params.get("return_url"), "https://app.example.invalid/compte-bloque");
      assert.deepEqual(f.writes, []); assert.equal(f.checkoutSessions, 0);
    }
  });
}

for (const status of ["trial_expired", "canceled", "incomplete_expired"]) {
  test(`${status} may start a guarded fresh checkout after Stripe confirms no live subscription`, async () => {
    const f = billingFixture({ row: { status, stripe_subscription_id: "sub_current" }, linked: stripeSubscription("canceled") });
    assert.equal((await f.checkout()).status, 200);
    assert.equal(f.checkoutSessions, 1);
    assert.equal(f.posts[0].path, "/checkout/sessions");
    assert.equal(f.posts[0].params.get("subscription_data[trial_end]"), null);
    assert.ok(f.writes.every((patch) => !["status", "plan", "app_edition", "trial_end_at"].some((key) => key in patch)));
    assert.ok(f.stripeReads.filter((path) => path.startsWith("/subscriptions?")).length >= 2, "guard rechecks live subscriptions before Checkout");
  });
}

test("a locally trialing but actually expired trial with a Stripe link is no longer rejected as live", async () => {
  for (const dateFields of [{ trial_end_at: expiredAt }, { trial_end_at: null, start_date: "2020-01-01" }]) {
    const f = billingFixture({ row: { status: "trialing", stripe_subscription_id: "sub_current", ...dateFields }, linked: stripeSubscription("canceled") });
    assert.equal((await f.checkout()).status, 200);
    assert.equal(f.posts[0].path, "/checkout/sessions");
    assert.equal(f.posts[0].params.get("subscription_data[trial_end]"), null);
    assert.ok(f.writes.every((patch) => !("status" in patch) && !("trial_end_at" in patch)));
  }
});

test("an expired local trial whose Stripe subscription is still trialing goes to that contract instead of creating another", async () => {
  const f = billingFixture({ row: { status: "trialing", trial_end_at: expiredAt, stripe_subscription_id: "sub_current" }, live: [stripeSubscription("trialing")] });
  assert.equal((await f.checkout()).status, 200);
  assert.equal(f.posts[0].path, "/billing_portal/sessions"); assert.deepEqual(f.writes, []);
});

test("an open linked trial remains protected from an additional subscription", async () => {
  const f = billingFixture({ row: { status: "trialing", trial_end_at: new Date(Date.now() + 86400_000).toISOString(), stripe_subscription_id: "sub_current" } });
  assert.equal((await f.checkout()).status, 409); assert.deepEqual(f.posts, []);
});

test("missing local customer recovers the verified linked subscription customer for payment recovery", async () => {
  const f = billingFixture({ row: { status: "past_due", stripe_customer_id: null, stripe_subscription_id: "sub_current" }, live: [stripeSubscription("past_due")] });
  assert.equal((await f.portal()).status, 200);
  assert.equal(f.posts[0].params.get("customer"), "cus_payer"); assert.deepEqual(f.writes, []);
});

test("missing local billing links can recover an exact owner-marked Stripe customer without opening someone else's billing", async () => {
  const f = billingFixture({ row: { status: "unpaid", stripe_customer_id: null }, live: [stripeSubscription("unpaid")] });
  assert.equal((await f.portal()).status, 200);
  assert.ok(f.stripeReads.some((path) => path.startsWith("/customers/search?")));
  assert.equal(f.posts[0].params.get("customer"), "cus_payer"); assert.deepEqual(f.writes, []);
});

test("a legacy database-linked customer and subscription remain manageable without Stripe user metadata", async () => {
  for (const route of ["portal", "checkout"] as const) {
    const legacy = stripeSubscription("past_due", { metadata: {} });
    const f = billingFixture({ row: { status: "past_due", stripe_subscription_id: "sub_current" }, legacyMetadata: true, linked: legacy, live: [legacy] });
    assert.equal((await f[route]()).status, 200);
    assert.equal(f.posts[0].path, "/billing_portal/sessions"); assert.equal(f.posts[0].params.get("customer"), "cus_payer");
    assert.deepEqual(f.writes, []);
  }
});

test("an active payer may still open the portal for historical invoices even without a live subscription", async () => {
  const f = billingFixture({ row: { status: "active" }, legacyMetadata: true });
  assert.equal((await f.portal()).status, 200);
  assert.equal(f.posts[0].params.get("return_url"), "https://app.example.invalid/dashboard?panel=abonnement");
  assert.deepEqual(f.writes, []);
});

test("no recoverable contract returns a specific offer-selection signal without granting access", async () => {
  const f = billingFixture({ row: { status: "unpaid", stripe_customer_id: null }, noCustomerFound: true });
  const response = await f.portal(); assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "BILLING_SUBSCRIPTION_NOT_FOUND"); assert.deepEqual(f.posts, []); assert.deepEqual(f.writes, []);
});

test("a new payer with no customer can start a single guarded checkout after an exhaustive empty owner lookup", async () => {
  const f = billingFixture({ row: { stripe_customer_id: null }, noCustomerFound: true });
  assert.equal((await f.checkout()).status, 200);
  assert.deepEqual(f.posts.map((post) => post.path), ["/customers", "/checkout/sessions"]);
  assert.equal(f.posts[0].params.get("metadata[user_id]"), actor); assert.equal(f.checkoutSessions, 1);
  assert.ok(f.writes.every((patch) => !("status" in patch) && !("app_edition" in patch)));
});

for (const conflict of ["customer metadata", "subscription metadata", "another database owner", "customer mismatch", "two live subscriptions"] as const) {
  test(`${conflict} fails closed before creating a portal or checkout`, async () => {
    const option = conflict === "customer metadata" ? { customerOwner: "user_other" }
      : conflict === "subscription metadata" ? { linked: stripeSubscription("past_due", { metadata: { user_id: "user_other" } }) }
      : conflict === "another database owner" ? { otherOwner: true }
      : conflict === "customer mismatch" ? { linked: stripeSubscription("past_due", { customer: "cus_other" }) }
      : { live: [stripeSubscription("past_due"), stripeSubscription("active", { id: "sub_second" })] };
    for (const route of ["portal", "checkout"] as const) {
      const f = billingFixture({ row: { status: "past_due", stripe_subscription_id: "sub_current" }, live: [stripeSubscription("past_due")], ...option });
      const response = await f[route](); assert.equal(response.status, 409);
      assert.equal((await response.json()).code, "BILLING_VERIFICATION_REQUIRED");
      assert.deepEqual(f.posts, []); assert.deepEqual(f.writes, []);
    }
  });
}

test("an establishment scope and forged request IDs cannot select another payer", async () => {
  const f = billingFixture({ row: { status: "unpaid" }, live: [stripeSubscription("unpaid")] });
  assert.equal((await f.portal()).status, 200);
  assert.ok(f.payerReads.length); assert.ok(f.payerReads.every((id) => id === actor));
  assert.equal(f.posts[0].params.get("customer"), "cus_payer");
});

test("unauthenticated routes reject before accessing any billing state or Stripe", async () => {
  for (const route of ["portal", "checkout"] as const) {
    const f = billingFixture({ unauthenticated: true }); assert.equal((await f[route]()).status, 401);
    assert.deepEqual(f.payerReads, []); assert.deepEqual(f.stripeReads, []); assert.deepEqual(f.posts, []);
  }
});

test("Stripe verification errors and native subscriptions never fall back to creating a web subscription", async () => {
  for (const route of ["portal", "checkout"] as const) {
    const offline = billingFixture({ row: { status: "unpaid" }, stripeFailure: true });
    assert.equal((await offline[route]()).status, 409); assert.deepEqual(offline.posts, []);
    const native = billingFixture({ row: { status: "unpaid", billing_provider: "app_store" } });
    assert.equal((await native[route]()).status, 409); assert.deepEqual(native.posts, []); assert.deepEqual(native.stripeReads, []);
  }
});

async function proxyResponse(path: string, status: string) {
  const runtime = load<{ proxy(request: Request): Promise<Response> }>("proxy.ts", {
    "next/server": { NextRequest, NextResponse },
    "@supabase/ssr": { createServerClient: () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: actor } }, error: null }) } }) },
    "./lib/dashboardEdition": edition, "./lib/reviewerAccess": reviewerAccess,
    "./lib/multicompte/normalize": accountNormalization,
    "./lib/multicompte/constants": { ACTIVE_INRCY_ACCOUNT_COOKIE: "inrcy_uid" },
    "./lib/rateLimit": { enforceQuota: async () => null, enforceRateLimit: async () => null },
    "./lib/actusWidgetEmbed": { isPublicEmbedPath: () => false },
    "./lib/checkoutReturnRouting": { CHECKOUT_RETURN_HEADER: "checkout-return", checkoutReturnQuery: () => "" },
    "./i18n/config": { APP_LOCALE_COOKIE: "app-locale", APP_LOCALE_COOKIE_MAX_AGE: 3600,
      APP_LOCALE_QUERY_PARAMS: ["lang"], APP_LOCALE_REQUEST_HEADER: "app-locale", APP_LOCALE_SHARED_DOMAIN: ".inrcy.com",
      LEGACY_APP_LOCALE_COOKIE: "legacy-app-locale", tryNormalizeAppLocale: () => null },
  }, { NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://billing-fixture.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture" });
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/app_settings")) return Response.json([{ maintenance_mode: false }]);
    if (url.pathname.endsWith("/subscriptions")) {
      assert.equal(url.searchParams.get("user_id"), "eq." + actor);
      return Response.json([{ status, plan: "Standard", app_edition: "standard", trial_end_at: expiredAt }]);
    }
    if (url.pathname.endsWith("/profiles")) return Response.json([{ role: "user" }]);
    if (url.pathname.endsWith("/inrcy_account_members")) return Response.json([{ account_id: actor, role: "owner", is_default: true }]);
    throw new Error(`Unexpected proxy fetch ${url.pathname}`);
  };
  try { return await runtime.proxy(new NextRequest("https://app.inrcy.com" + path)); }
  finally { globalThis.fetch = original; }
}

test("the real proxy lets blocked payers reach only exact billing recovery and checkout while keeping paid tools blocked", async () => {
  for (const status of ["trialing", "past_due", "unpaid", "canceled"]) {
    for (const path of ["/api/billing/portal", "/api/billing/checkout"]) {
      const response = await proxyResponse(path, status); assert.equal(response.status, 200, path + " " + status);
      assert.equal(response.headers.get("x-middleware-next"), "1");
    }
    for (const path of ["/api/billing/portal/other", "/api/billing/change-plan"]) {
      const response = await proxyResponse(path, status); assert.equal(response.status, 403, path + " " + status);
      assert.equal((await response.json()).code, "ACCOUNT_BLOCKED");
    }
    const dashboard = await proxyResponse("/dashboard", status);
    assert.equal(dashboard.status, 307); assert.equal(new URL(dashboard.headers.get("location")!).pathname, "/compte-bloque");
  }
});

function clientCallbacks(options: { checkoutResult?: unknown; response?: Response } = {}) {
  const ast = ts.createSourceFile("BlockedBillingActions.tsx", source("app/compte-bloque/BlockedBillingActions.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const wanted = new Map<string, string>();
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name && ["startCheckout", "openPortal"].includes(node.name.text)) wanted.set(node.name.text, node.getText(ast));
    ts.forEachChild(node, visit);
  }; visit(ast);
  assert.equal(wanted.size, 2);
  const emitted = ts.transpileModule([...wanted.values()].join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const busy: boolean[] = [], errors: string[] = [], missing: boolean[] = [], assigned: string[] = [];
  let refreshes = 0;
  const handlers = new Function("setBusy", "setError", "setSubscriptionNotFound", "router", "cycles", "i18nT", "startSubscriptionCheckout", "fetch", "window", "locale", "getLocalizedApiError", "getLocalizedErrorMessage",
    emitted + "; return {startCheckout,openPortal};")(
    (value: boolean) => busy.push(value), (value: string) => errors.push(value), (value: boolean) => missing.push(value),
    { refresh() { refreshes++; } }, { Standard: "monthly" }, catalogTranslator("public"),
    async () => options.checkoutResult ?? { platform: "web", provider: "stripe" },
    async (path: string, init: RequestInit) => { assert.equal(path, "/api/billing/portal"); assert.equal(init.method, "POST"); return options.response!; },
    { location: { assign(url: string) { assigned.push(url); } } },
    "fr-FR", userFacingErrorsFixture.getLocalizedApiError, userFacingErrorsFixture.getLocalizedErrorMessage,
  ) as { startCheckout(plan: string): Promise<void>; openPortal(): Promise<void> };
  return { handlers, busy, errors, missing, assigned, get refreshes() { return refreshes; } };
}

test("the real blocked-page checkout callback clears its busy state and refreshes after recovered subscription or native success", async () => {
  for (const result of [{ platform: "web", recoveredSubscription: true, nextAction: "reload" }, { platform: "ios" }]) {
    const f = clientCallbacks({ checkoutResult: result }); await f.handlers.startCheckout("Standard");
    assert.equal(f.refreshes, 1); assert.deepEqual(f.busy, [true, false]); assert.deepEqual(f.assigned, []);
  }
});

test("the real blocked-page callback offers resubscription only after the server confirms no live contract", async () => {
  const f = clientCallbacks({ response: Response.json({ code: "BILLING_SUBSCRIPTION_NOT_FOUND" }, { status: 409 }) });
  await f.handlers.openPortal(); assert.deepEqual(f.missing, [true]); assert.deepEqual(f.busy, [true, false]); assert.deepEqual(f.assigned, []);
});

test("blocked API errors stay human-readable and a normal portal response redirects without unlocking access", async () => {
  const failed = clientCallbacks({ response: Response.json({ error: "ACCOUNT_BLOCKED", code: "ACCOUNT_BLOCKED" }, { status: 403 }) });
  await failed.handlers.openPortal(); assert.equal(failed.errors.at(-1), userFacingErrorsFixture.getLocalizedErrorMessage({ code: "ACCOUNT_BLOCKED", status: 403 }, "fr-FR")); assert.doesNotMatch(failed.errors.at(-1)!, /ACCOUNT_BLOCKED/); assert.deepEqual(failed.missing, []);
  const opened = clientCallbacks({ response: Response.json({ url: "https://billing.stripe.invalid/session" }) });
  await opened.handlers.openPortal(); assert.deepEqual(opened.assigned, ["https://billing.stripe.invalid/session"]);
  assert.equal(opened.refreshes, 0); assert.deepEqual(opened.missing, []);
});
