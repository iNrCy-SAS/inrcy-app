import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";
import * as policy from "../../lib/signupWelcomeMailPolicy.ts";
import * as temporaryPolicy from "../../lib/temporaryPasswordPolicy.ts";
import type { PreparedAuthEmail } from "../../lib/authMailPolicy.ts";
const USER = "00000000-0000-4000-8000-000000000001";

function fixture() {
  let row: Record<string, unknown> | null = null;
  let metadata: unknown = null;
  let failures = 0;
  let uncertain = false;
  let deferredFailure: Record<string, unknown> | null = null;
  let now = Date.now();
  class Clock extends Date { constructor(value?: string | number) { super(value ?? now); } static now() { return now; } }
  const sent: PreparedAuthEmail[] = [];
  const attempted: PreparedAuthEmail[] = [];
  const requests: string[] = [];
  const client = createClient("https://signup.example.invalid", "synthetic-server-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input)); const method = init?.method || "GET";
      requests.push(`${method} ${url.pathname}`);
      if (url.pathname === `/auth/v1/admin/users/${USER}`) return Response.json({ id: USER, email: "synthetic@example.com", app_metadata: { inrcy_temporary_password: metadata } });
      if (url.pathname === "/rest/v1/rpc/claim_signup_welcome_credentials") {
        const due = row && row.ready_at && row.user_id && row.encrypted_password && !row.delivered_at && !row.blocked_at
          && Date.parse(String(row.expires_at)) > now && (!row.retry_at || Date.parse(String(row.retry_at)) <= now);
        return Response.json(due ? [row] : []);
      }
      assert.equal(url.pathname, "/rest/v1/signup_welcome_credentials");
      if (method === "POST") { row = { ...JSON.parse(String(init?.body)), user_id: null, ready_at: null, delivered_at: null }; return new Response(null, { status: 201 }); }
      if (method === "PATCH") {
        assert.ok(row);
        const expiredBefore = url.searchParams.get("expires_at");
        if (!expiredBefore || !expiredBefore.startsWith("lte.") || Date.parse(String(row.expires_at)) <= Date.parse(expiredBefore.slice(4))) Object.assign(row, JSON.parse(String(init?.body)));
        const representation = new Headers(init?.headers).get("prefer")?.includes("return=representation");
        return representation ? Response.json({ id: row.id }) : new Response(null, { status: 204 });
      }
      assert.ok(row); return Response.json(row);
    } },
  });
  const modules = new Map<string, unknown>([
    ["server-only", {}], ["@/lib/supabaseAdmin", { supabaseAdmin: client }],
    ["@/lib/signupWelcomeMailPolicy", policy], ["@/lib/temporaryPasswordPolicy", temporaryPolicy],
    ["@/lib/authMailDelivery", { authResendApiKey: () => "synthetic-provider-key", sendPreparedAuthEmail: async (mail: PreparedAuthEmail) => {
      attempted.push(mail);
      if (deferredFailure) { const error = deferredFailure; deferredFailure = null; throw Object.assign(new Error("synthetic quota refusal"), error); }
      if (failures-- > 0) throw Object.assign(new Error("synthetic persistence unavailable"), { code: "auth_mail_reservation_failed" });
      sent.push(mail); return { accepted: true, replay: false, ...(uncertain ? { uncertain: true } : {}) };
    } }],
  ]);
  const output = ts.transpileModule(readFileSync("lib/signupWelcomeMail.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const load = () => {
    const record = { exports: {} as typeof import("../../lib/signupWelcomeMail.ts") };
    new Function("module", "exports", "require", "process", "Date", output)(record, record.exports, (name: string) => {
      assert.ok(modules.has(name), `Non-isolated dependency: ${name}`); return modules.get(name);
    }, { env: { INRCY_SIGNUP_CREDENTIAL_ENCRYPTION_KEY: "synthetic-only-encryption-key-32chars", NEXT_PUBLIC_APP_URL: "https://app.inrcy.com" } }, Clock);
    return record.exports;
  };
  const setup = async () => {
    const server = load();
    const credential = await server.prepareSignupWelcome({ email: "synthetic@example.com", firstName: "Synthetic", language: "fr" });
    metadata = credential.metadata;
    await server.attachSignupWelcome(credential.metadata.welcome_id, USER);
    return { server, credential };
  };
  return { setup, load, sent, attempted, requests, getRow: () => row!, setMetadata: (value: unknown) => { metadata = value; }, failOnce: () => { failures = 1; }, uncertain: () => { uncertain = true; },
    deferOnce: () => { const retryAt = new Date(now + 3_600_000).toISOString(); deferredFailure = { code: "daily_quota_exceeded", httpStatus: 429, retryable: true, retryAt }; return retryAt; },
    advance: (ms: number) => { now += ms; }, now: () => now };
}

test("real SDK transport keeps only ciphertext, forbids sending before provisioning, then erases it after provider acceptance", async () => {
  const f = fixture(); const { server, credential } = await f.setup();
  assert.equal(JSON.stringify(f.getRow()).includes(credential.password), false);
  assert.deepEqual(await server.deliverSignupWelcome(credential.metadata.welcome_id), { delivered: false });
  assert.equal(f.sent.length, 0);
  await server.completeSignupWelcome(credential.metadata.welcome_id, USER);
  assert.deepEqual(await server.deliverSignupWelcome(credential.metadata.welcome_id), { delivered: true, uncertain: false });
  assert.equal(f.sent.length, 1); assert.ok(f.sent[0].text.includes(credential.password));
  assert.equal(f.getRow().encrypted_password, null);
  await f.load().deliverSignupWelcome(credential.metadata.welcome_id);
  assert.equal(f.sent.length, 1, "restart after acceptance must not resend");
});

test("restart after a pre-send failure reuses the original credential and stable email identity", async () => {
  const f = fixture(); const { server, credential } = await f.setup();
  await server.completeSignupWelcome(credential.metadata.welcome_id, USER);
  f.failOnce(); await assert.rejects(server.deliverSignupWelcome(credential.metadata.welcome_id));
  assert.ok(f.getRow().encrypted_password);
  await f.load().deliverSignupWelcome(credential.metadata.welcome_id);
  assert.equal(f.sent.length, 1); assert.ok(f.sent[0].text.includes(credential.password));
  assert.equal(f.requests.some((request) => /PUT.*admin\/users/.test(request)), false, "retry never rotates a password");
});

test("a changed password/email state stops delayed welcome delivery instead of sending an obsolete password", async () => {
  const f = fixture(); const { server, credential } = await f.setup();
  await server.completeSignupWelcome(credential.metadata.welcome_id, USER);
  f.setMetadata(null);
  assert.deepEqual(await server.deliverSignupWelcome(credential.metadata.welcome_id), { delivered: false });
  assert.equal(f.sent.length, 0); assert.equal(f.getRow().encrypted_password, null);
});

test("uncertain provider acceptance is not retried and passwords never appear in the result", async () => {
  const f = fixture(); const { server, credential } = await f.setup();
  await server.completeSignupWelcome(credential.metadata.welcome_id, USER); f.uncertain();
  const result = await server.deliverSignupWelcome(credential.metadata.welcome_id);
  assert.deepEqual(result, { delivered: true, uncertain: true });
  assert.equal(JSON.stringify(result).includes(credential.password), false);
  assert.equal(f.getRow().encrypted_password, null);
  await server.deliverSignupWelcome(credential.metadata.welcome_id); assert.equal(f.sent.length, 1);
});

test("a confirmed quota refusal keeps the welcome credential until the due retry succeeds with the same email", async () => {
  const f = fixture(); const { server, credential } = await f.setup();
  await server.completeSignupWelcome(credential.metadata.welcome_id, USER);
  const ciphertext = f.getRow().encrypted_password, retryAt = f.deferOnce();
  assert.deepEqual(await server.deliverSignupWelcome(credential.metadata.welcome_id), { delivered: false, deferred: true, retryAt });
  assert.equal(f.getRow().encrypted_password, ciphertext); assert.equal(f.getRow().delivered_at, null);
  assert.equal(f.getRow().retry_at, retryAt); assert.equal(f.sent.length, 0);
  assert.deepEqual(await f.load().processPendingSignupWelcomes(), { claimed: 0, delivered: 0, failed: 0, deferred: 0 });
  assert.equal(f.attempted.length, 1, "the outbox must not claim work before retry_at");
  f.advance(3_600_001);
  assert.deepEqual(await f.load().processPendingSignupWelcomes(), { claimed: 1, delivered: 1, failed: 0, deferred: 0 });
  assert.equal(f.sent.length, 1); assert.deepEqual(f.attempted[1], f.attempted[0]);
  assert.equal(f.getRow().encrypted_password, null); assert.equal(f.getRow().retry_at, null);
});

test("a welcome that expires while deferred is erased without sending or extending its password validity", async () => {
  const f = fixture(); const { server, credential } = await f.setup();
  await server.completeSignupWelcome(credential.metadata.welcome_id, USER);
  f.deferOnce(); await server.deliverSignupWelcome(credential.metadata.welcome_id);
  f.getRow().expires_at = new Date(f.now() + 1000).toISOString();
  f.advance(3_600_001);
  assert.deepEqual(await f.load().processPendingSignupWelcomes(), { claimed: 0, delivered: 0, failed: 0, deferred: 0 });
  assert.equal(f.getRow().encrypted_password, null); assert.equal(f.attempted.length, 1); assert.equal(f.sent.length, 0);
});
