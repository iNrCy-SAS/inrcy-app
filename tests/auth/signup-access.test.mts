import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { NextResponse } from "next/server.js";
import * as policy from "../../lib/signupImmediateAccessPolicy.ts";
import * as temporary from "../../lib/temporaryPasswordPolicy.ts";

const secret = "synthetic-test-secret-32-characters-only";
const USER = "11111111-1111-4111-8111-111111111111";
const WELCOME = "22222222-2222-4222-8222-222222222222";
function claims(): policy.SignupAccessClaims {
  return { v: 1, userId: USER, email: "synthetic@example.invalid", welcomeId: WELCOME,
    password: "Synthetic-Password-123!", tokenHash: "synthetic-provider-token-hash-12345", language: "fr",
    issuedAt: Date.now(), expiresAt: Date.now() + 3_500_000 };
}
function user(c: policy.SignupAccessClaims) {
  return { id: c.userId, email: c.email, app_metadata: { inrcy_temporary_password: { version: 1,
    welcome_id: c.welcomeId, issued_at: new Date(c.issuedAt).toISOString(), expires_at: new Date(c.issuedAt + 30 * 86400000).toISOString() } } };
}
function compile<T>(path: string, modules: Record<string, unknown>): T {
  const source = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const record = { exports: {} };
  new Function("module", "exports", "require", source)(record, record.exports, (name: string) => {
    if (Object.hasOwn(modules, name)) return modules[name];
    assert.fail(`Non-isolated dependency ${name}`);
  });
  return record.exports as T;
}
test("access ticket protects credentials, binds their purpose, rejects tampering, expiry and overlong grants", () => {
  const c = claims(), ticket = policy.sealSignupAccess(c, secret);
  assert.equal(ticket.includes(c.password), false);
  assert.equal(ticket.includes(c.email), false);
  assert.deepEqual(policy.openSignupAccess(ticket, secret), c);
  assert.equal(policy.openSignupAccess(ticket, secret + "wrong"), null);
  const bytes = Buffer.from(ticket, "base64url"); bytes[35] ^= 1;
  assert.equal(policy.openSignupAccess(bytes.toString("base64url"), secret), null);
  assert.equal(policy.openSignupAccess(ticket, secret, c.expiresAt), null);
  assert.equal(policy.openSignupAccess(policy.sealSignupAccess({ ...c, expiresAt: c.issuedAt + 7200000 }, secret), secret), null);
  assert.equal(policy.signupAccessMatchesUser(c, user(c)), true);
  assert.equal(policy.signupAccessMatchesUser(c, { ...user(c), id: WELCOME }), false);
  assert.equal(policy.signupAccessMatchesUser(c, { ...user(c), app_metadata: {} }), false);
});

function fixture() {
  const c = claims(), ticket = policy.sealSignupAccess(c, secret);
  let freshUser = user(c);
  let currentUser: ReturnType<typeof user> | null = null;
  let otpCalls = 0;
  let consumed = false;
  const writes: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
  const cookieJar = new Map<string, string>();
  const modules = {
    "next/headers": { cookies: async () => ({ get: (name: string) => cookieJar.has(name) ? { value: cookieJar.get(name) } : undefined,
      set: (name: string, value: string, options: Record<string, unknown>) => { writes.push({ name, value, options }); if (options.maxAge === 0) cookieJar.delete(name); else cookieJar.set(name, value); } }) },
    "next/server": { NextResponse },
    "@/lib/supabaseServer": { createSupabaseServer: async () => ({ auth: {
      getUser: async () => ({ data: { user: currentUser }, error: null }),
      verifyOtp: async (value: unknown) => { assert.deepEqual(value, { type: "email", token_hash: c.tokenHash }); otpCalls++;
        if (consumed) return { error: new Error("already used"), data: {} }; consumed = true; currentUser = freshUser;
        return { error: null, data: { user: freshUser, session: { access_token: "synthetic-session-never-returned" } } };
      },
    } }) },
    "@/lib/supabaseAdmin": { supabaseAdmin: { auth: { admin: { getUserById: async (id: string) => { assert.equal(id, c.userId); return { data: { user: freshUser }, error: null }; } } } } },
    "@/lib/rateLimit": { getClientIp: () => "synthetic", enforceRateLimit: async () => null },
    "@/lib/signupImmediateAccessPolicy": policy,
    "@/lib/signupImmediateAccessServer": { signupAccessSecret: () => secret },
    "@/lib/multicompte/constants": { ACTIVE_INRCY_ACCOUNT_COOKIE: "active_account" },
    "@/lib/temporaryPasswordPolicy": temporary,
  };
  const route = compile<{ POST: (r: Request) => Promise<NextResponse> }>("app/api/auth/signup-access/route.ts", modules);
  const passwordRoute = compile<{ GET: (r: Request) => Promise<NextResponse> }>("app/api/auth/signup-access/password/route.ts", modules);
  const request = (origin = "https://inrcy.com", rawTicket = ticket) => new Request("https://app.inrcy.com/api/auth/signup-access", {
    method: "POST", headers: { origin, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ticket: rawTicket }),
  });
  return { c, ticket, route, passwordRoute, request, writes, cookieJar, otpCalls: () => otpCalls,
    setFreshUser: (v: ReturnType<typeof user>) => { freshUser = v; }, setCurrentUser: (v: ReturnType<typeof user> | null) => { currentUser = v; } };
}
test("new-tab POST consumes provider OTP, redirects without credentials, sets private account-bound handoff cookie", async () => {
  const f = fixture(); const result = await f.route.POST(f.request());
  assert.equal(result.status, 303);
  assert.equal(result.headers.get("location"), "https://app.inrcy.com/dashboard?lang=fr");
  assert.match(result.headers.get("cache-control")!, /no-store/);
  assert.equal(result.headers.get("referrer-policy"), "no-referrer");
  assert.equal(f.otpCalls(), 1);
  const cookie = f.writes.find(x => x.name === policy.SIGNUP_ACCESS_COOKIE)!;
  assert.equal(cookie.options.httpOnly, true); assert.equal(cookie.options.secure, true);
  assert.equal(cookie.options.path, "/api/auth/signup-access"); assert.ok(Number(cookie.options.maxAge) <= 3600);
  const response = await f.passwordRoute.GET(new Request("https://app.inrcy.com/api/auth/signup-access/password"));
  assert.deepEqual(await response.json(), { required: true, email: f.c.email, currentPassword: f.c.password });
  assert.equal(f.cookieJar.has(policy.SIGNUP_ACCESS_COOKIE), false);
  assert.deepEqual(await (await f.passwordRoute.GET(new Request("https://app.inrcy.com/api/auth/signup-access/password"))).json(), { required: true, email: f.c.email });
  assert.equal((await f.route.POST(f.request())).status, 400, "provider OTP cannot replay");
});
test("untrusted or absent origins and forged tickets cannot reach OTP verification", async () => {
  for (const origin of ["https://evil.invalid", "null", ""]) {
    const f = fixture(); assert.equal((await f.route.POST(f.request(origin))).status, 403); assert.equal(f.otpCalls(), 0);
  }
  const f = fixture(); assert.equal((await f.route.POST(f.request("https://inrcy.com", "invalid"))).status, 400); assert.equal(f.otpCalls(), 0);
});
test("changed password, expired metadata or an already connected different account never get replaced", async () => {
  for (const type of ["changed", "expired", "other"] as const) {
    const f = fixture();
    if (type === "changed") f.setFreshUser({ ...user(f.c), app_metadata: {} } as ReturnType<typeof user>);
    if (type === "expired") { const u = user(f.c); u.app_metadata.inrcy_temporary_password.expires_at = new Date(0).toISOString(); f.setFreshUser(u); }
    if (type === "other") f.setCurrentUser(user({ ...f.c, userId: WELCOME }));
    assert.ok((await f.route.POST(f.request())).status >= 400); assert.equal(f.otpCalls(), 0); assert.equal(f.writes.length, 0);
  }
});
test("password endpoint does not disclose to another user, an anonymous caller or a cross-site request", async () => {
  const f = fixture(); f.cookieJar.set(policy.SIGNUP_ACCESS_COOKIE, f.ticket);
  assert.equal((await f.passwordRoute.GET(new Request("https://app.inrcy.com/api/auth/signup-access/password"))).status, 401);
  f.setCurrentUser(user({ ...f.c, userId: WELCOME }));
  const response = await f.passwordRoute.GET(new Request("https://app.inrcy.com/api/auth/signup-access/password"));
  assert.equal(JSON.stringify(await response.json()).includes(f.c.password), false);
  assert.equal((await f.passwordRoute.GET(new Request("https://app.inrcy.com/api/auth/signup-access/password", { headers: { origin: "https://inrcy.com" } }))).status, 403);
});

