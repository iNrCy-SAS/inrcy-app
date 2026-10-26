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
  const sent: PreparedAuthEmail[] = [];
  const requests: string[] = [];
  const client = createClient("https://signup.example.invalid", "synthetic-server-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input)); const method = init?.method || "GET";
      requests.push(`${method} ${url.pathname}`);
      if (url.pathname === `/auth/v1/admin/users/${USER}`) return Response.json({ id: USER, email: "synthetic@example.com", app_metadata: { inrcy_temporary_password: metadata } });
      assert.equal(url.pathname, "/rest/v1/signup_welcome_credentials");
      if (method === "POST") { row = { ...JSON.parse(String(init?.body)), user_id: null, ready_at: null, delivered_at: null }; return new Response(null, { status: 201 }); }
      if (method === "PATCH") {
        assert.ok(row); Object.assign(row, JSON.parse(String(init?.body)));
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
      if (failures-- > 0) throw Object.assign(new Error("synthetic persistence unavailable"), { code: "auth_mail_reservation_failed" });
      sent.push(mail); return { accepted: true, replay: false, ...(uncertain ? { uncertain: true } : {}) };
    } }],
  ]);
  const output = ts.transpileModule(readFileSync("lib/signupWelcomeMail.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const load = () => {
    const record = { exports: {} as typeof import("../../lib/signupWelcomeMail.ts") };
    new Function("module", "exports", "require", "process", output)(record, record.exports, (name: string) => {
      assert.ok(modules.has(name), `Non-isolated dependency: ${name}`); return modules.get(name);
    }, { env: { INRCY_SIGNUP_CREDENTIAL_ENCRYPTION_KEY: "synthetic-only-encryption-key-32chars", NEXT_PUBLIC_APP_URL: "https://app.inrcy.com" } });
    return record.exports;
  };
  const setup = async () => {
    const server = load();
    const credential = await server.prepareSignupWelcome({ email: "synthetic@example.com", firstName: "Synthetic", language: "fr" });
    metadata = credential.metadata;
    await server.attachSignupWelcome(credential.metadata.welcome_id, USER);
    return { server, credential };
  };
  return { setup, load, sent, requests, getRow: () => row!, setMetadata: (value: unknown) => { metadata = value; }, failOnce: () => { failures = 1; }, uncertain: () => { uncertain = true; } };
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
