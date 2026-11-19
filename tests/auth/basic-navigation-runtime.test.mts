import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { NextResponse } from "next/server.js";
import * as navigation from "../../lib/basicNavigation.ts";
import * as emailLinks from "../../lib/authEmailLinks.ts";
import * as config from "../../i18n/config.ts";
import * as security from "../../lib/security.ts";
import * as eligibility from "../../lib/authInviteResendEligibility.ts";
import * as directPolicy from "../../lib/directSignupPolicy.ts";

type Modules = Record<string, unknown>;
function load<T>(file: string, modules: Modules): T {
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const result = { exports: {} as T };
  new Function("require", "module", "exports", "process", code)((name: string) => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected navigation fixture dependency ${name}`); return modules[name];
  }, result, result.exports, { env: { NEXT_PUBLIC_APP_URL: "https://app.inrcy.com" } });
  return result.exports;
}

test("Basic navigation is an explicit presentation flag with fixed links and no authority", () => {
  assert.equal(navigation.isBasicNavigation("basique"), true);
  for (const entry of [undefined, null, "Basic", "basique-other", { plan: "Basic" }]) assert.equal(navigation.isBasicNavigation(entry), false);
  assert.equal(navigation.isBasicNavigation(null, "/activer-mon-compte"), true);
  assert.equal(navigation.isBasicNavigation(null, "/dashboard"), false);
  assert.equal(navigation.withBasicNavigation("/login?lang=fr", false), "/login?lang=fr");
  assert.equal(navigation.withBasicNavigation("/login?lang=fr", true), "/login?lang=fr&entry=basique");
  assert.equal(navigation.withBasicNavigation("/diagnostic?from=login#help", true), "/diagnostic?from=login&entry=basique#help");
  for (const path of ["https://evil.invalid/", "//evil.invalid/", "/\\evil.invalid/"]) assert.throws(() => navigation.withBasicNavigation(path, true));
  for (const href of Object.values(navigation.BASIC_NAVIGATION_LINKS)) assert.match(href, /^https:\/\/inrcy\.com\/basique\//);
  assert.equal(navigation.BASIC_NAVIGATION_LINKS.signup, "https://inrcy.com/basique/inscription/");
  assert.equal(directPolicy.getDirectSignupMetadata({ entry: "basique" }), null);
  assert.equal(directPolicy.isDirectSignupPaid({ status: "incomplete", stripe_subscription_id: null }), false);
});

test("nine deterministic flat aliases fit the current single-star whitelist and keep token parsing unchanged", () => {
  const languages = ["fr", "en", "es", "it", "de", "nl", "pt", "th", "zh"];
  assert.deepEqual(Object.values(navigation.BASIC_RESET_PRESENTATION_ROUTES), languages);
  for (const language of languages) {
    const path = navigation.basicResetPresentationPath(language);
    assert.match(path, /^\/reset-basique-[a-z]{2}$/);
    assert.equal(navigation.basicResetPresentationLanguage(path), language);
    assert.equal(navigation.isBasicNavigation(null, path), true);
    const redirect = emailLinks.buildSupabaseEmailRedirectUrl("https://app.inrcy.com", path);
    assert.equal(redirect, `https://app.inrcy.com/reset-basique-${language}`);
    const mailUrl = new URL(`${redirect}?token_hash=abcdefghijklmnopqrstuvwxyz012345&type=recovery`);
    assert.deepEqual(emailLinks.readAuthEmailLinkParams(mailUrl.searchParams), { tokenHash: "abcdefghijklmnopqrstuvwxyz012345", language: "", recoveredMalformedQuery: false });
    assert.equal(mailUrl.searchParams.get("type"), "recovery");
    const wrapper = readFileSync(`app${path}/page.tsx`, "utf8");
    assert.match(wrapper, /import BasicResetPage from/); assert.ok(wrapper.includes(`path="${path}"`));
  }
  assert.equal(navigation.basicResetPresentationLanguage("/reset-basique-unknown"), null);
  assert.equal(navigation.basicResetPresentationLanguage("/auth/finish-reset/fr"), null);
  assert.equal(emailLinks.buildSupabaseEmailRedirectUrl("https://app.inrcy.com", "/auth/finish-reset", "fr"), "https://app.inrcy.com/auth/finish-reset/fr");
});

test("sign-out changes only its contextual login link, ignores arbitrary next and creates no navigation cookie", async () => {
  let signouts = 0;
  const route = load<{ POST(request: Request): Promise<Response> }>("app/api/auth/sign-out/route.ts", {
    "next/server": { NextResponse }, "@/lib/basicNavigation": navigation,
    "@/lib/supabaseServer": { createSupabaseServer: async () => ({ auth: { signOut: async () => { signouts++; } } }) },
  });
  for (const entry of ["basique", "other", ""] as const) {
    const query = new URLSearchParams({ entry, next: "https://evil.invalid" });
    const response = await route.POST(new Request(`https://app.inrcy.com/api/auth/sign-out?${query}`, { method: "POST" }));
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), `https://app.inrcy.com/login${entry === "basique" ? "?entry=basique" : ""}`);
    assert.equal(response.headers.get("set-cookie"), null);
  }
  assert.equal(signouts, 3);
});

test("existing callback keeps the same recovery token, type and safe next while preserving Basic return links", async () => {
  const route = load<{ GET(request: Request): Promise<Response> }>("app/auth/callback/route.ts", {
    "next/server": { NextResponse }, "@/lib/basicNavigation": navigation, "@/lib/security": security, "@/i18n/config": config,
    "@/lib/notifications": { ensureNotificationPreferences: () => assert.fail("recovery links are not exchanged by the callback") },
    "@/lib/ensureProfileRow": { ensureProfileRow: () => assert.fail("recovery links are not exchanged by the callback") },
    "@/lib/browserAccountCache": { ACTIVE_USER_COOKIE: "fixture-user" },
    "@/lib/supabaseServer": { createSupabaseServer: async () => ({ auth: { verifyOtp: () => assert.fail("callback must keep recovery token unconsumed") } }) },
  });
  for (const entry of ["basique", ""] as const) {
    const query = new URLSearchParams({ token_hash: "synthetic-token", type: "recovery", lang: "fr", next: "/dashboard", entry });
    const response = await route.GET(new Request(`https://app.inrcy.com/auth/callback?${query}`));
    const target = new URL(response.headers.get("location")!);
    assert.equal(target.pathname, "/auth/finish-reset/fr"); assert.equal(target.searchParams.get("token_hash"), "synthetic-token");
    assert.equal(target.searchParams.get("type"), "recovery"); assert.equal(target.searchParams.get("next"), "/dashboard");
    assert.equal(target.searchParams.get("entry"), entry || null);
    const error = await route.GET(new Request(`https://app.inrcy.com/auth/callback?error=otp_expired&type=recovery&lang=fr&entry=${entry}`));
    assert.equal(new URL(error.headers.get("location")!).searchParams.get("entry"), entry || null);
    assert.equal(response.headers.get("set-cookie"), null);
  }
});

test("resending a Basic reset selects only its flat presentation alias and leaves normal reset URLs unchanged", async () => {
  const sends: Array<{ email: string; redirectTo: string }> = [];
  const route = load<{ POST(request: Request): Promise<Response> }>("app/api/auth/resend-link/route.ts", {
    "next/server": { NextResponse }, "next/headers": { cookies: async () => ({ get: () => undefined }) },
    "@/lib/basicNavigation": navigation, "@/lib/authEmailLinks": emailLinks, "@/i18n/config": config,
    "@/lib/authInviteResendEligibility": eligibility,
    "@/lib/supabaseAuthBusinessErrors": { findKnownInrcyAccountUserIdsForEmail: () => assert.fail("reset does not become an invite"), isExistingAuthUserError: () => false },
    "@/lib/observability/logger": { log: { warn: () => assert.fail("reset must succeed") } },
    "@/lib/rateLimit": { getClientIp: () => "synthetic", enforceRateLimit: async () => null },
    "@/lib/supabaseAdmin": { supabaseAdmin: { auth: { resetPasswordForEmail: async (email: string, options: { redirectTo: string }) => { sends.push({ email, ...options }); return { error: null }; } } } },
  });
  for (const language of Object.values(navigation.BASIC_RESET_PRESENTATION_ROUTES)) {
    const response = await route.POST(new Request("https://app.inrcy.com/api/auth/resend-link", { method: "POST", body: JSON.stringify({ email: "synthetic@example.invalid", mode: "reset", language, entry: "basique" }) }));
    assert.equal(response.status, 200); assert.equal(sends.at(-1)!.redirectTo, `https://app.inrcy.com/reset-basique-${language}`);
    assert.equal(new URL(sends.at(-1)!.redirectTo).search, "");
  }
  const normal = await route.POST(new Request("https://app.inrcy.com/api/auth/resend-link", { method: "POST", body: JSON.stringify({ email: "synthetic@example.invalid", mode: "reset", language: "fr", entry: "unknown" }) }));
  assert.equal(normal.status, 200); assert.equal(sends.at(-1)!.redirectTo, "https://app.inrcy.com/auth/finish-reset/fr");
  assert.equal(sends.length, 10);
});
