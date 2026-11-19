import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server.js";
import * as policy from "../../lib/directSignupPolicy.ts";
import * as navigation from "../../lib/basicNavigation.ts";
import * as editions from "../../lib/dashboardEdition.ts";
import * as reviewer from "../../lib/reviewerAccess.ts";
import * as normalize from "../../lib/multicompte/normalize.ts";

const USER = "11111111-1111-4111-8111-111111111111", SECONDARY = "22222222-2222-4222-8222-222222222222";
const marker = { [policy.DIRECT_SIGNUP_METADATA_KEY]: { version: 1, entry: "basique", created_at: "2026-11-19T12:00:00.000Z" } };
const compiled = ts.transpileModule(readFileSync("proxy.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
type Options = { legacyTrial?: boolean; paid?: boolean; activeWithoutContract?: boolean; secondary?: boolean };

async function request(path: string, method = "POST", options: Options = {}) {
  const dependencies = {
    "next/server": { NextRequest, NextResponse }, "./lib/directSignupPolicy": policy,
    "./lib/basicNavigation": navigation,
    "@supabase/ssr": { createServerClient: () => ({ auth: { getClaims: async () => ({ data: { claims: {
      sub: USER, app_metadata: options.legacyTrial ? {} : marker, user_metadata: { direct_signup: false, paid: true, plan: "Premium" },
    } }, error: null }) } }) },
    "./lib/dashboardEdition": editions, "./lib/reviewerAccess": reviewer, "./lib/multicompte/normalize": normalize,
    "./lib/multicompte/constants": { ACTIVE_INRCY_ACCOUNT_COOKIE: "inrcy_uid" },
    "./lib/rateLimit": { enforceQuota: async () => null, enforceRateLimit: async () => null },
    "./lib/actusWidgetEmbed": { isPublicEmbedPath: () => false },
    "./lib/checkoutReturnRouting": { CHECKOUT_RETURN_HEADER: "checkout-return", checkoutReturnQuery: () => "" },
    "./i18n/config": { APP_LOCALE_COOKIE: "app-locale", APP_LOCALE_COOKIE_MAX_AGE: 3600, APP_LOCALE_QUERY_PARAMS: ["lang"], APP_LOCALE_REQUEST_HEADER: "app-locale", APP_LOCALE_SHARED_DOMAIN: ".inrcy.com", LEGACY_APP_LOCALE_COOKIE: "legacy-app-locale", tryNormalizeAppLocale: () => null },
  };
  const fetcher = async (input: string) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/app_settings")) return Response.json([{ maintenance_mode: false }]);
    if (url.pathname.endsWith("/profiles")) return Response.json([{ role: "user" }]);
    if (url.pathname.endsWith("/inrcy_account_subscriptions")) return Response.json(options.secondary ? [{ account_id: SECONDARY, auth_user_id: USER, status: "active", plan: "Premium", app_edition: "premium", stripe_subscription_id: "sub_secondary" }] : []);
    if (url.pathname.endsWith("/inrcy_account_members")) {
      if (url.searchParams.get("role") === "eq.owner") return Response.json([{ account_id: SECONDARY, auth_user_id: USER, role: "owner" }]);
      return Response.json([{ account_id: USER, auth_user_id: USER, role: "owner", is_default: true, inrcy_accounts: { display_name: "Principal" } },
        ...(options.secondary ? [{ account_id: SECONDARY, auth_user_id: USER, role: "owner", is_default: false, inrcy_accounts: { display_name: "Secondary" } }] : [])]);
    }
    assert.ok(url.pathname.endsWith("/subscriptions"), `Unexpected proxy read ${url.pathname}`);
    assert.equal(url.searchParams.get("user_id"), `eq.${USER}`);
    return Response.json([{ status: options.legacyTrial ? "trialing" : options.paid || options.activeWithoutContract ? "active" : "incomplete",
      plan: options.legacyTrial ? "Trial" : "Basic", app_edition: options.legacyTrial ? "standard" : "basic",
      trial_end_at: options.legacyTrial ? new Date(Date.now() + 21 * 86400_000).toISOString() : null, stripe_subscription_id: options.paid ? "sub_verified" : null }]);
  };
  const output = { exports: {} as { proxy(value: NextRequest): Promise<NextResponse> } };
  new Function("module", "exports", "require", "fetch", "process", compiled)(output, output.exports, (name: string) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected proxy dependency ${name}`); return dependencies[name as keyof typeof dependencies];
  }, fetcher, { env: { NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://fixture.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-key" } });
  return output.exports.proxy(new NextRequest(`https://app.inrcy.com${path}`, { method,
    headers: { cookie: `inrcy_uid=${options.secondary ? SECONDARY : USER}`, accept: "text/html" } }));
}

test("direct pending blocks all private APIs by default, including assistant and future expensive routes", async () => {
  for (const path of ["/api/assistant/chat", "/api/assistant/attachments", "/api/voice/transcribe", "/api/ai-memory/read", "/api/e-reputation/reviews", "/api/future-paid-operation"]) {
    for (const method of ["GET", "POST"]) {
      const response = await request(path, method); assert.equal(response.status, 403, `${method} ${path}`);
      const body = await response.json(); assert.equal(body.code, "DIRECT_SIGNUP_PAYMENT_REQUIRED"); assert.equal(body.redirectTo, policy.DIRECT_SIGNUP_ACTIVATION_PATH);
      assert.equal(response.headers.get("x-middleware-next"), null);
    }
  }
  const forged = await request("/dashboard?checkout=success&paid=true&status=active", "GET", { activeWithoutContract: true });
  assert.equal(new URL(forged.headers.get("location")!).pathname, policy.DIRECT_SIGNUP_ACTIVATION_PATH);
});

test("authentication, subscription status and payment recovery remain reachable without allowing paid tools", async () => {
  for (const path of ["/api/auth/direct-signup/status", "/api/auth/change-password", "/api/auth/sign-out", "/api/billing/checkout", "/api/billing/portal", "/api/public/basic-signup", "/api/stripe/webhook"]) {
    const response = await request(path); assert.equal(response.status, 200, path); assert.equal(response.headers.get("x-middleware-next"), "1", path);
  }
});

test("legacy trials, verified paid Basic and approved secondary contracts keep their own existing access", async () => {
  for (const options of [{ legacyTrial: true }, { paid: true }, { secondary: true }]) {
    const response = await request("/api/assistant/chat", "POST", options);
    assert.equal(response.status, 200, JSON.stringify(options)); assert.equal(response.headers.get("x-middleware-next"), "1");
  }
});
