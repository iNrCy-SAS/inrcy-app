import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { evaluatePassword } from "../../lib/passwordPolicy.ts";
import { TEMPORARY_PASSWORD_METADATA_KEY } from "../../lib/temporaryPasswordPolicy.ts";

function fixture(options: { authenticated?: boolean; wrongCurrent?: boolean; otherUser?: boolean; mfa?: boolean; aal2?: boolean; writeFailed?: boolean; lostResponse?: boolean; restoreFailed?: boolean; permanent?: boolean } = {}) {
  const calls: Array<{ operation: string; args: unknown }> = [];
  const user = { id: "actor-account", email: "actor@example.com", app_metadata: options.permanent ? { unchanged: true } : { unchanged: true, [TEMPORARY_PASSWORD_METADATA_KEY]: { version: 1 } }, factors: options.mfa ? [{ status: "verified" }] : [] };
  const modules = new Map<string, unknown>([
    ["next/server", { NextResponse: { json: (body: unknown, init: ResponseInit) => Response.json(body, init) } }],
    ["@/lib/passwordPolicy", { evaluatePassword }],
    ["@/lib/temporaryPasswordPolicy", { TEMPORARY_PASSWORD_METADATA_KEY }],
    ["@/lib/rateLimit", { getClientIp: () => "test", enforceRateLimit: async () => null }],
    ["@/lib/supabaseServer", { createSupabaseServer: async () => ({ auth: {
      getUser: async () => ({ data: { user: options.authenticated === false ? null : user }, error: null }),
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: options.aal2 ? "aal2" : "aal1" }, error: null }) },
      signInWithPassword: async (args: unknown) => {
        calls.push({ operation: "restore", args });
        if (options.restoreFailed) throw new Error("private provider failure");
        return { data: { session: { access_token: "must-not-be-in-json" } }, error: null };
      },
    } }) }],
    ["@supabase/supabase-js", { createClient: () => ({ auth: { signInWithPassword: async (args: { password: string }) => {
      calls.push({ operation: "verify", args });
      const rejected = options.wrongCurrent || (options.writeFailed && args.password === "New-Password42!");
      return { error: rejected ? { message: "invalid" } : null, data: { user: rejected ? null : { id: options.otherUser ? "somebody-else" : user.id } } };
    } } }) }],
    ["@/lib/supabaseAdmin", { supabaseAdmin: { auth: { admin: { updateUserById: async (id: string, patch: unknown) => {
      calls.push({ operation: "write", args: { id, patch } });
      if (options.lostResponse) throw new Error("response lost after write");
      return { data: { user }, error: options.writeFailed ? { message: "private provider failure" } : null };
    } } } } }],
  ]);
  const output = ts.transpileModule(readFileSync("app/api/auth/change-password/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const record = { exports: {} as { POST: (request: Request) => Promise<Response> } };
  new Function("module", "exports", "require", output)(record, record.exports, (name: string) => {
    assert.ok(modules.has(name), `Non-isolated dependency: ${name}`); return modules.get(name);
  });
  const request = (body: unknown = { currentPassword: "Old-Password42!", password: "New-Password42!", userId: "victim-account", email: "victim@example.com", app_metadata: { bypass: true } }, origin = "https://app.inrcy.com") => record.exports.POST(new Request("https://app.inrcy.com/api/auth/change-password", { method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(body) }));
  return { calls, request };
}

test("own current password is verified before an atomic password/temp-status write; target parameters and secrets never escape", async () => {
  const f = fixture();
  const response = await f.request();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, requires_login: false });
  assert.deepEqual(f.calls.map((call) => call.operation), ["verify", "write", "restore"]);
  assert.deepEqual(f.calls[0].args, { email: "actor@example.com", password: "Old-Password42!" });
  assert.deepEqual(f.calls[1].args, { id: "actor-account", patch: { password: "New-Password42!", app_metadata: { [TEMPORARY_PASSWORD_METADATA_KEY]: null } } });
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("unauthenticated, cross-origin, malformed, weak and same-password requests never write", async () => {
  const unauth = fixture({ authenticated: false }); assert.equal((await unauth.request()).status, 401); assert.equal(unauth.calls.length, 0);
  const cross = fixture(); assert.equal((await cross.request({}, "https://evil.invalid")).status, 403); assert.equal(cross.calls.length, 0);
  for (const body of [null, [], {}, { currentPassword: "Old-Password42!", password: "weak" }, { currentPassword: "Old-Password42!", password: "Old-Password42!" }]) {
    const f = fixture(); assert.equal((await f.request(body)).status, 400); assert.equal(f.calls.length, 0);
  }
});

test("incorrect credentials or a different verified user can never change the authenticated account", async () => {
  for (const option of [{ wrongCurrent: true }, { otherUser: true }]) {
    const f = fixture(option); assert.equal((await f.request()).status, 400);
    assert.deepEqual(f.calls.map((call) => call.operation), ["verify"]);
  }
});

test("server write preserves MFA requirements and normal accounts", async () => {
  const protectedAccount = fixture({ mfa: true }); assert.equal((await protectedAccount.request()).status, 403); assert.equal(protectedAccount.calls.length, 0);
  const aal2 = fixture({ mfa: true, aal2: true }); assert.equal((await aal2.request()).status, 200);
  const normal = fixture({ permanent: true }); assert.equal((await normal.request()).status, 200);
  assert.deepEqual(normal.calls[1].args, { id: "actor-account", patch: { password: "New-Password42!" } });
});

test("lost write response is verified and a failed session restore reports password success with reconnect", async () => {
  const lost = fixture({ lostResponse: true }); assert.equal((await lost.request()).status, 200);
  assert.deepEqual(lost.calls.map((call) => call.operation), ["verify", "write", "verify", "restore"]);
  const reconnect = fixture({ restoreFailed: true }); assert.deepEqual(await (await reconnect.request()).json(), { ok: true, requires_login: true });
  const failed = fixture({ writeFailed: true }); const response = await failed.request();
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /private provider|Password42|must-not/);
});
