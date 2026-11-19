import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server.js";
import * as edition from "../../lib/dashboardEdition.ts";
import * as reviewer from "../../lib/reviewerAccess.ts";
import * as accounts from "../../lib/multicompte/normalize.ts";
import * as directSignupPolicy from "../../lib/directSignupPolicy.ts";

const source = ts.transpileModule(readFileSync("proxy.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

async function request(pathname: string, method = "POST") {
  const dependencies = {
    "next/server": { NextRequest, NextResponse },
    "@supabase/ssr": { createServerClient: () => ({ auth: { getClaims: async () => ({ data: null, error: new Error("synthetic_stale_session") }) } }) },
    "./lib/dashboardEdition": edition, "./lib/reviewerAccess": reviewer, "./lib/multicompte/normalize": accounts,
    "./lib/directSignupPolicy": directSignupPolicy,
    "./lib/multicompte/constants": { ACTIVE_INRCY_ACCOUNT_COOKIE: "inrcy_uid" },
    "./lib/rateLimit": { enforceQuota: async () => null, enforceRateLimit: async () => null },
    "./lib/actusWidgetEmbed": { isPublicEmbedPath: () => false },
    "./lib/checkoutReturnRouting": { CHECKOUT_RETURN_HEADER: "checkout-return", checkoutReturnQuery: () => "" },
    "./i18n/config": {
      APP_LOCALE_COOKIE: "app-locale", APP_LOCALE_COOKIE_MAX_AGE: 3600, APP_LOCALE_QUERY_PARAMS: ["lang"],
      APP_LOCALE_REQUEST_HEADER: "app-locale", APP_LOCALE_SHARED_DOMAIN: ".inrcy.com", LEGACY_APP_LOCALE_COOKIE: "legacy-app-locale",
      tryNormalizeAppLocale: () => null,
    },
  };
  const record = { exports: {} as { proxy: (value: NextRequest) => Promise<NextResponse> } };
  new Function("module", "exports", "require", "fetch", "process", source)(record, record.exports, (name: string) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name as keyof typeof dependencies];
    assert.fail(`Non-isolated dependency ${name}`);
  }, () => assert.fail("A stale-session recovery must not fetch privileged account data"), {
    env: { NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://fixture.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic" },
  });
  return await record.exports.proxy(new NextRequest(`https://app.inrcy.com${pathname}`, {
    method, headers: { origin: "https://inrcy.com", cookie: "sb-synthetic-auth-token.0=old; sb-synthetic-auth-token.1=old; preference=keep" },
    ...(method === "POST" ? { body: "ticket=synthetic" } : {}),
  }));
}

test("a fresh signup POST reaches grant verification after expired session cookies are removed", async () => {
  const response = await request("/api/auth/signup-access");
  assert.equal(response.status, 200); assert.equal(response.headers.get("x-middleware-next"), "1");
  assert.equal(response.headers.get("x-middleware-request-cookie"), "preference=keep");
  for (const name of ["sb-synthetic-auth-token.0", "sb-synthetic-auth-token.1"]) {
    const cleared = response.cookies.get(name);
    assert.ok(cleared); assert.equal(cleared.value, ""); assert.equal(cleared.maxAge, 0);
  }
});

test("the stale-session exception is limited to the exact signup POST and preserves protected APIs", async () => {
  for (const [path, method] of [
    ["/api/auth/signup-access", "GET"], ["/api/auth/signup-access/password", "GET"],
    ["/api/auth/signup-access/password", "POST"], ["/api/auth/signup-access/other", "POST"],
  ]) {
    const response = await request(path, method);
    assert.equal(response.status, 401, `${method} ${path}`);
    assert.equal((await response.json()).code, "SESSION_EXPIRED");
  }
});
