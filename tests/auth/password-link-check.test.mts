import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {
  checkPasswordEmailLink,
  isUnavailableAuthSessionCheck,
  withAuthLinkDeadline,
} from "../../lib/authPasswordLinkCheck.ts";

const INPUT = { mode: "invite" as const, tokenHash: "a".repeat(64), email: "invitee@example.com" };

test("preflight posts the proof without putting it in a URL or consuming an OTP", async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const fetcher = (async (url, init) => {
    requests.push({ url: String(url), init });
    return Response.json({ valid: true, expires_at: expiresAt });
  }) as typeof fetch;
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(await checkPasswordEmailLink(INPUT, { fetcher }), { state: "valid", expiresAt: Date.parse(expiresAt) });
  }
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.url, "/api/auth/password-link-status");
    assert.equal(request.init?.method, "POST");
    assert.equal(request.init?.cache, "no-store");
    assert.deepEqual(JSON.parse(String(request.init?.body)), { mode: "invite", token_hash: INPUT.tokenHash, email: INPUT.email });
  }
});

test("an invalid/expired proof is distinct from an unavailable check", async () => {
  const run = (body: unknown, status = 200) => checkPasswordEmailLink(INPUT, { fetcher: (async () => Response.json(body, { status })) as typeof fetch });
  assert.deepEqual(await run({ valid: false }), { state: "invalid" });
  assert.deepEqual(await run({ valid: true, expires_at: new Date(Date.now() - 1).toISOString() }), { state: "invalid" });
  for (const status of [429, 500, 503]) {
    assert.deepEqual(await run({ valid: false }, status), { state: "unavailable" });
  }
  assert.deepEqual(await run({ valid: true }), { state: "unavailable" });
  assert.deepEqual(await run({}), { state: "unavailable" });
  assert.deepEqual(await checkPasswordEmailLink(INPUT, { fetcher: (async () => { throw new Error("network down"); }) as typeof fetch }), { state: "unavailable" });
});

test("a check or Auth lock that never settles has a bounded wait and can be retried", async () => {
  await assert.rejects(withAuthLinkDeadline(new Promise(() => {}), 10), /auth_link_check_timeout/);
  assert.equal(await withAuthLinkDeadline(Promise.resolve("ready"), 10), "ready");
  await assert.rejects(withAuthLinkDeadline(Promise.reject(new Error("unavailable")), 10), /unavailable/);
});

test("a rejected/missing session is different from a network or Auth service failure", () => {
  assert.equal(isUnavailableAuthSessionCheck(null), false);
  assert.equal(isUnavailableAuthSessionCheck({ name: "AuthSessionMissingError" }), false);
  for (const status of [400, 401, 403]) assert.equal(isUnavailableAuthSessionCheck({ status }), false);
  for (const status of [0, 429, 500, 503]) assert.equal(isUnavailableAuthSessionCheck({ status }), true);
  assert.equal(isUnavailableAuthSessionCheck(new Error("failed to fetch")), true);
});

function browserClientFixture() {
  const source = readFileSync(new URL("../../lib/supabaseClient.ts", import.meta.url), "utf8");
  const tasks: (() => void)[] = [];
  const events: string[] = [];
  let status = 401;
  let signOutCalls = 0;
  let releaseSignOut: () => void = () => {};
  const authLock = new Promise<void>((resolve) => { releaseSignOut = resolve; });
  const client = { auth: { signOut: async () => { signOutCalls++; await authLock; } } };
  const moduleValue = { exports: {} as { createClient: () => unknown; guardedFetch: typeof fetch } };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    module: moduleValue, exports: moduleValue.exports, process: { env: {} }, URL, Request, Response,
    require: (name: string) => {
      assert.equal(name, "@supabase/ssr");
      return { createBrowserClient: () => client };
    },
    fetch: async () => new Response(null, { status }),
    setTimeout: (fn: () => void) => { tasks.push(fn); return tasks.length; },
    window: { dispatchEvent: (event: Event) => { events.push(event.type); return true; } },
    CustomEvent: class { type: string; constructor(type: string) { this.type = type; } },
  });
  moduleValue.exports.createClient();
  return { ...moduleValue.exports, tasks, events, releaseSignOut, setStatus: (next: number) => { status = next; }, signOutCalls: () => signOutCalls };
}

test("401 Auth responses return before signOut waits for the getUser lock", async () => {
  const fixture = browserClientFixture();
  const responses = await withAuthLinkDeadline(Promise.all([
    fixture.guardedFetch("https://project.example/auth/v1/user"),
    fixture.guardedFetch("https://project.example/auth/v1/user"),
  ]), 200);
  assert.ok(responses.every((response) => response.status === 401));
  assert.equal(fixture.signOutCalls(), 0, "cleanup cannot run within the response chain");
  assert.equal(fixture.tasks.length, 1, "invalid-session bursts schedule one cleanup");
  fixture.tasks[0]();
  assert.equal(fixture.signOutCalls(), 1);
  assert.deepEqual(fixture.events, []);
  fixture.releaseSignOut();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.deepEqual(fixture.events, ["inrcy:auth-session-invalid"]);
});

test("a successful response cancels old invalid-session cleanup", async () => {
  const fixture = browserClientFixture();
  await fixture.guardedFetch("https://project.example/auth/v1/user");
  fixture.setStatus(200);
  await fixture.guardedFetch("https://project.example/auth/v1/user");
  fixture.tasks[0]();
  assert.equal(fixture.signOutCalls(), 0);
  assert.deepEqual(fixture.events, []);
  fixture.releaseSignOut();
});
