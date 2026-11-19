import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as policy from "../../lib/directSignupPolicy.ts";

type Row = Record<string, unknown>;
const USER = "11111111-1111-4111-8111-111111111111", OTHER = "22222222-2222-4222-8222-222222222222";
const user = { id: USER, email: "synthetic@example.invalid", app_metadata: { [policy.DIRECT_SIGNUP_METADATA_KEY]: { version: 1, entry: "basique", created_at: "2026-11-19T12:00:00.000Z" } } };
function load<T>(path: string, modules: Row): T {
  const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const result = { exports: {} as T };
  new Function("module", "exports", "require", code)(result, result.exports, (name: string) => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected repair dependency ${name}`); return modules[name];
  });
  return result.exports;
}

function fixture(initial: Row | null = null) {
  let row = initial, reads = 0;
  const calls: string[] = [], inserts: Array<{ row: Row; options: Row }> = [];
  const control = { failRead: 0, insertFails: false, principalFails: false, foreignRead: false, missingAfterInsert: false, beforeInsert: null as (() => void) | null };
  const admin = { from: (table: string) => {
    assert.equal(table, "subscriptions");
    const query = { select: () => query, eq: (field: string, id: string) => { assert.equal(field, "user_id"); assert.equal(id, USER); return query; },
      maybeSingle: async () => {
        reads++; calls.push("read");
        return { data: control.foreignRead ? { user_id: OTHER, status: "active", stripe_subscription_id: "sub_other" } : row ? { ...row } : null,
          error: control.failRead === reads ? { code: "synthetic_read_failure" } : null };
      }, upsert: async (value: Row, options: Row) => {
        calls.push("insert"); inserts.push({ row: value, options }); control.beforeInsert?.();
        if (control.insertFails) return { error: { code: "synthetic_insert_failure" } };
        if (!control.missingAfterInsert && !(options.ignoreDuplicates && row)) row = { ...value };
        return { error: null };
      } };
    return query;
  } };
  const repair = load<{ loadOrRepairDirectSignupSubscription(value: Row): Promise<Row> }>("lib/directSignupServer.ts", {
    "server-only": {}, "@/lib/directSignupPolicy": policy, "@/lib/supabaseAdmin": { supabaseAdmin: admin },
    "@/lib/inrcyAccountProvisioning": { ensurePrincipalInrcyAccountProvisioned: async (value: Row) => {
      assert.equal(value.id, USER); calls.push("principal"); if (control.principalFails) throw new Error("synthetic_membership_failure");
    } },
  });
  const status = load<{ GET(): Promise<Response> }>("app/api/auth/direct-signup/status/route.ts", {
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/directSignupPolicy": policy, "@/lib/directSignupServer": repair, "@/lib/supabaseAdmin": { supabaseAdmin: admin },
    "@/lib/supabaseServer": { createSupabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }) },
  });
  return { calls, inserts, control, get: () => row, seed: (value: Row) => { row = value; }, run: (value: Row = user) => repair.loadOrRepairDirectSignupSubscription(value), status: () => status.GET() };
}

test("an authenticated direct signup repairs a missing subscription after principal ownership and resumes pending without a trial", async () => {
  const f = fixture(); const result = await f.run();
  assert.equal(result.user_id, USER); assert.equal(result.plan, "Basic"); assert.equal(result.status, "incomplete");
  assert.equal(result.trial_start_at, null); assert.equal(result.trial_end_at, null); assert.equal(policy.isDirectSignupPaid(result), false);
  assert.deepEqual(f.calls, ["read", "principal", "insert", "read"]);
  assert.deepEqual(f.inserts[0].options, { onConflict: "user_id", ignoreDuplicates: true });
  const response = await f.status(); assert.equal(response.status, 200); assert.equal((await response.json()).paid, false);
  assert.equal(f.inserts.length, 1, "refresh never repeats account or subscription creation");
});

test("existing paid or pending subscriptions are read without an update, and a racing paid webhook wins over repair", async () => {
  for (const existing of [
    { user_id: USER, plan: "Basic", status: "incomplete", trial_end_at: null },
    { user_id: USER, plan: "Premium", status: "active", stripe_subscription_id: "sub_verified", monthly_price_eur: 108 },
  ]) {
    const f = fixture(existing); assert.deepEqual(await f.run(), existing); assert.deepEqual(f.calls, ["read"]); assert.equal(f.inserts.length, 0);
  }
  const f = fixture(), paid = { user_id: USER, plan: "Standard", status: "active", stripe_subscription_id: "sub_webhook", monthly_price_eur: 58, trial_end_at: null };
  f.control.beforeInsert = () => f.seed(paid);
  assert.deepEqual(await f.run(), paid); assert.deepEqual(f.get(), paid);
  assert.equal(f.inserts[0].options.ignoreDuplicates, true);
  assert.equal((await (await f.status()).json()).paid, true);
  assert.equal(f.inserts.length, 1, "reconnect cannot downgrade the webhook's active contract");
});

test("read, insertion, missing postcondition and ownership failures fail closed rather than pretending the account is paid", async () => {
  for (const patch of [{ failRead: 1 }, { insertFails: true }, { principalFails: true }, { foreignRead: true }, { missingAfterInsert: true }, { failRead: 2 }]) {
    const f = fixture(); Object.assign(f.control, patch);
    const response = await f.status(); assert.equal(response.status, 503, JSON.stringify(patch));
    assert.match(response.headers.get("cache-control") ?? "", /no-store/); assert.equal((await response.json()).paid, undefined);
    if (patch.failRead === 1 || patch.principalFails || patch.foreignRead) assert.equal(f.inserts.length, 0);
  }
});

test("legacy accounts, client-edited markers and incomplete identities cannot authorize a subscription repair", async () => {
  for (const value of [{ ...user, app_metadata: {} }, { ...user, app_metadata: {}, user_metadata: user.app_metadata }, { ...user, email: "" }, { ...user, id: "" }]) {
    const f = fixture(); await assert.rejects(f.run(value), /direct_signup_required/); assert.deepEqual(f.calls, []); assert.equal(f.inserts.length, 0);
  }
});
