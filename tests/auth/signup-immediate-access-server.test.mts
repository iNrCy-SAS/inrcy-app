import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as policy from "../../lib/signupImmediateAccessPolicy.ts";

const input = {
  userId: "11111111-1111-4111-8111-111111111111", email: "synthetic@example.invalid",
  password: "Synthetic-Password-123!", language: "fr",
  metadata: { version: 1 as const, welcome_id: "22222222-2222-4222-8222-222222222222",
    issued_at: new Date().toISOString(), expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString() },
};
const secret = "synthetic-test-secret-32-characters-only";
type ProviderResult = { data: { user?: { id: string }; properties?: { hashed_token: string } }; error: Error | null };
type Access = { email: string; password: string; ticket: string; expires_at: string; login_url: string };
type Timer = { callback: () => void; delay: number; cleared: boolean };

function fixture(generateLink: (value: unknown) => Promise<ProviderResult>) {
  const timers: Timer[] = [];
  const messages: unknown[][] = [];
  const dependencies = {
    "server-only": {}, "@/lib/supabaseAdmin": { supabaseAdmin: { auth: { admin: { generateLink } } } },
    "./signupImmediateAccessPolicy.ts": policy,
  };
  const source = ts.transpileModule(readFileSync("lib/signupImmediateAccessServer.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const record = { exports: {} as { createSignupImmediateAccess: (value: typeof input) => Promise<Access> } };
  new Function("module", "exports", "require", "process", "setTimeout", "clearTimeout", "console", source)(
    record, record.exports, (name: string) => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name as keyof typeof dependencies];
      assert.fail(`Non-isolated dependency ${name}`);
    }, { env: { INRCY_SIGNUP_CREDENTIAL_ENCRYPTION_KEY: secret } },
    (callback: () => void, delay: number) => { const timer = { callback, delay, cleared: false }; timers.push(timer); return timer; },
    (timer: Timer) => { timer.cleared = true; }, { error: (...args: unknown[]) => messages.push(args) },
  );
  return { create: () => record.exports.createSignupImmediateAccess(input), timers, messages };
}

test("a provider response creates the sealed grant and clears its deadline", async () => {
  const fixtureValue = fixture(async value => {
    assert.deepEqual(value, { type: "magiclink", email: input.email });
    return { data: { user: { id: input.userId }, properties: { hashed_token: "synthetic-provider-token-hash-12345" } }, error: null };
  });
  const access = await fixtureValue.create();
  const claims = policy.openSignupAccess(access.ticket, secret)!;
  assert.equal(claims.userId, input.userId); assert.equal(claims.password, input.password);
  assert.equal(claims.welcomeId, input.metadata.welcome_id);
  assert.ok(claims.expiresAt - claims.issuedAt <= 3_600_000);
  assert.equal(fixtureValue.timers[0].delay, 2_500);
  assert.equal(fixtureValue.timers[0].cleared, true);
  assert.deepEqual(fixtureValue.messages, []);
});

test("a stalled provider returns working manual credentials at 2.5 seconds and ignores late completion", async () => {
  let resolveProvider!: (result: ProviderResult) => void;
  const fixtureValue = fixture(() => new Promise(resolve => { resolveProvider = resolve; }));
  const pending = fixtureValue.create();
  assert.equal(fixtureValue.timers.length, 1); assert.equal(fixtureValue.timers[0].delay, 2_500);
  fixtureValue.timers[0].callback();
  const access = await pending;
  assert.equal(access.ticket, ""); assert.equal(access.email, input.email); assert.equal(access.password, input.password);
  assert.equal(fixtureValue.timers[0].cleared, true);
  assert.deepEqual(fixtureValue.messages, [["[signup-access]", "automatic_access_unavailable"]]);
  resolveProvider({ data: { user: { id: input.userId }, properties: { hashed_token: "synthetic-provider-token-hash-12345" } }, error: null });
  await Promise.resolve();
  assert.equal(access.ticket, "", "a late credential cannot change an already returned fallback");
});

test("provider errors and a mismatched user keep the fallback and clear the deadline without logging credentials", async () => {
  for (const generate of [
    async () => { throw new Error(input.password); },
    async () => ({ data: {}, error: new Error(input.password) }),
    async () => ({ data: { user: { id: input.metadata.welcome_id }, properties: { hashed_token: "synthetic-provider-token-hash-12345" } }, error: null }),
  ]) {
    const fixtureValue = fixture(generate);
    const access = await fixtureValue.create();
    assert.equal(access.ticket, ""); assert.equal(access.password, input.password);
    assert.equal(fixtureValue.timers[0].cleared, true);
    assert.equal(JSON.stringify(fixtureValue.messages).includes(input.password), false);
  }
});
