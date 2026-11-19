import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as policy from "../../lib/directSignupPolicy.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const marker = { version: 1, entry: "basique", created_at: "2026-11-19T12:00:00.000Z" };
const appMetadata = { [policy.DIRECT_SIGNUP_METADATA_KEY]: marker };
type Row = Record<string, unknown>;

function load<T>(path: string, modules: Record<string, unknown>): T {
  const code = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const result = { exports: {} as T };
  new Function("module", "exports", "require", code)(result, result.exports, (name: string) => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected direct-signup dependency ${name}`);
    return modules[name];
  });
  return result.exports;
}

test("direct purchase accepts only the server app-metadata marker and never treats a trial or browser success as payment", () => {
  assert.deepEqual(policy.getDirectSignupMetadata(appMetadata), marker);
  for (const metadata of [null, {}, { user_metadata: appMetadata }, { [policy.DIRECT_SIGNUP_METADATA_KEY]: { ...marker, version: 2 } },
    { [policy.DIRECT_SIGNUP_METADATA_KEY]: { ...marker, entry: "trial" } }, { [policy.DIRECT_SIGNUP_METADATA_KEY]: { ...marker, created_at: "invalid" } }]) {
    assert.equal(policy.getDirectSignupMetadata(metadata), null);
  }
  for (const status of ["incomplete", "incomplete_expired", "trialing", "past_due", "unpaid", "canceled", "paused"]) {
    assert.equal(policy.isDirectSignupPaid({ status, stripe_subscription_id: "sub_verified" }), false, status);
    assert.equal(policy.directSignupNeedsActivation(appMetadata, { status, stripe_subscription_id: "sub_verified" }), true);
  }
  for (const stripe_subscription_id of [null, "", "   "]) assert.equal(policy.isDirectSignupPaid({ status: "active", stripe_subscription_id }), false);
  for (const plan of ["Basic", "Standard", "Premium"]) {
    const subscription = { plan, status: "active", stripe_subscription_id: "sub_verified" };
    assert.equal(policy.isDirectSignupPaid(subscription), true);
    assert.equal(policy.directSignupNeedsActivation(appMetadata, subscription), false);
  }
  assert.equal(policy.directSignupNeedsActivation({}, { plan: "Trial", status: "trialing" }), false, "legacy trial cohort keeps its existing routing");
});

function pendingFixture(returned?: Row, error: unknown = null) {
  const writes: Row[] = [];
  const query = {
    select: () => query,
    single: async () => ({ data: returned ?? { user_id: USER, plan: "Basic", status: "incomplete", trial_start_at: null, trial_end_at: null }, error }),
  };
  const api = load<{ ensureDirectSignupPendingSubscription(userId: string, email: string): Promise<Row> }>("lib/directSignupServer.ts", {
    "server-only": {},
    "@/lib/directSignupPolicy": policy,
    "@/lib/inrcyAccountProvisioning": { ensurePrincipalInrcyAccountProvisioned: () => assert.fail("initial pending verification does not repair a principal") },
    "@/lib/supabaseAdmin": { supabaseAdmin: { from: (table: string) => {
      assert.equal(table, "subscriptions"); return { upsert: (row: Row, options: Row) => {
        assert.deepEqual(options, { onConflict: "user_id" }); writes.push(row); return query;
      } };
    } } },
  });
  return { writes, run: () => api.ensureDirectSignupPendingSubscription(USER, "synthetic@example.invalid") };
}

test("direct provisioning commits Basic incomplete with no trial dates and verifies the database postcondition", async () => {
  const f = pendingFixture(); const result = await f.run();
  assert.deepEqual(result, { edition: "basic", trialDays: 0, end: null });
  assert.equal(f.writes.length, 1);
  const row = f.writes[0];
  assert.equal(row.user_id, USER); assert.equal(row.plan, "Basic"); assert.equal(row.status, "incomplete");
  assert.equal(row.app_edition, "basic"); assert.equal(row.trial_start_at, null); assert.equal(row.trial_end_at, null);
  assert.equal(row.monthly_price_eur, 0); assert.equal(row.scheduled_plan, null);
  assert.equal(policy.isDirectSignupPaid(row), false);
  for (const changed of [{ user_id: OTHER }, { plan: "Trial" }, { status: "active" }, { trial_start_at: marker.created_at }, { trial_end_at: marker.created_at }]) {
    const broken = pendingFixture({ user_id: USER, plan: "Basic", status: "incomplete", trial_start_at: null, trial_end_at: null, ...changed });
    await assert.rejects(broken.run(), /direct_signup_pending_subscription_failed/);
  }
  await assert.rejects(pendingFixture(undefined, { code: "synthetic_database_failure" }).run(), /direct_signup_pending_subscription_failed/);
});

function statusFixture() {
  const auth = { user: { id: USER, email: "synthetic@example.invalid", app_metadata: appMetadata, user_metadata: {} as Row } as Row | null, error: null as unknown };
  const rows = new Map<string, Row>([[USER, { user_id: USER, plan: "Basic", status: "incomplete", billing_cycle: null, stripe_subscription_id: null }],
    [OTHER, { user_id: OTHER, plan: "Premium", status: "active", billing_cycle: "yearly", stripe_subscription_id: "sub_other" }]]);
  const reads: string[] = [];
  let dbFailure = false;
  const admin = { from: (table: string) => {
      assert.equal(table, "subscriptions"); let userId = "";
      const query = { select: () => query, eq: (field: string, id: string) => {
        assert.equal(field, "user_id"); userId = id; reads.push(id); return query;
      }, maybeSingle: async () => ({ data: rows.get(userId) ?? null, error: dbFailure ? { code: "synthetic_failure" } : null }) };
      return query;
    } };
  const repair = load("lib/directSignupServer.ts", { "server-only": {}, "@/lib/directSignupPolicy": policy,
    "@/lib/supabaseAdmin": { supabaseAdmin: admin }, "@/lib/inrcyAccountProvisioning": { ensurePrincipalInrcyAccountProvisioned: () => assert.fail("known contracts must not be repaired") } });
  const api = load<{ GET(): Promise<Response> }>("app/api/auth/direct-signup/status/route.ts", {
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/directSignupPolicy": policy, "@/lib/directSignupServer": repair,
    "@/lib/supabaseServer": { createSupabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user: auth.user }, error: auth.error }) } }) },
    "@/lib/supabaseAdmin": { supabaseAdmin: admin },
  });
  return { api, auth, rows, reads, fail: () => { dbFailure = true; } };
}

test("refresh and reconnect read the authenticated user's current pending or paid state without modifying it", async () => {
  const f = statusFixture();
  for (let i = 0; i < 3; i++) {
    const response = await f.api.GET(); assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /private.*no-store/);
    assert.deepEqual(await response.json(), { directSignup: true, paid: false, status: "incomplete", plan: "Basic", billingCycle: null, nextUrl: policy.DIRECT_SIGNUP_ACTIVATION_PATH });
  }
  assert.deepEqual(f.reads, [USER, USER, USER]);
  f.rows.set(USER, { user_id: USER, plan: "Basic", status: "active", billing_cycle: "monthly", stripe_subscription_id: "sub_verified" });
  assert.deepEqual(await (await f.api.GET()).json(), { directSignup: true, paid: true, status: "active", plan: "Basic", billingCycle: "monthly", nextUrl: "/dashboard" });
  f.auth.user = null; assert.equal((await f.api.GET()).status, 401); assert.equal(f.reads.length, 4);
  f.auth.user = { id: USER, email: "synthetic@example.invalid", app_metadata: appMetadata }; assert.equal((await (await f.api.GET()).json()).paid, true);
});

test("client metadata cannot opt a legacy account into direct signup and another account's paid contract cannot unlock the caller", async () => {
  const f = statusFixture();
  f.auth.user = { id: USER, app_metadata: {}, user_metadata: appMetadata };
  const result = await (await f.api.GET()).json();
  assert.equal(result.directSignup, false); assert.equal(result.paid, false); assert.deepEqual(f.reads, [USER]);
  f.fail(); const response = await f.api.GET();
  assert.equal(response.status, 503); assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.equal((await response.json()).paid, undefined);
});

test("a direct account cannot recover a free trial even when editable metadata contains a trial signup snapshot", async () => {
  const forbidden = () => assert.fail("direct purchase must not enter trial recovery, provisioning or secret lookup");
  const api = load<{ recoverInterruptedPublicInviteSignupForUser(user: Row): Promise<string> }>("lib/interruptedInviteSignupRecoveryServer.ts", {
    "server-only": {}, "@/lib/directSignupPolicy": policy,
    "@/lib/appBubbleAccessProvisioning": { provisionNewAccountBubbleAccess: forbidden }, "@/lib/env": { requireEnv: forbidden },
    "@/lib/ensureProfileRow": { ensureProfileRow: forbidden }, "@/lib/inrcyAccountProvisioning": { ensurePrincipalInrcyAccountProvisioned: forbidden },
    "@/lib/notifications": { ensureNotificationPreferences: forbidden, seedWelcomeNotifications: forbidden },
    "@/lib/supabaseAdmin": { supabaseAdmin: { from: forbidden, auth: { admin: { getUserById: forbidden } } } },
    "@/lib/trialSubscription": { NEW_ACCOUNT_EDITION: "standard" },
    "@/lib/signupFormSnapshot": { SIGNUP_FORM_METADATA_KEY: "inrcy_signup_form" },
    "@/lib/interruptedInviteSignupRecoveryFlow": { recoverInterruptedPublicInviteSignup: forbidden },
    "@/lib/signupRecoveryProof": { SIGNUP_TRIAL_COMPLETED_APP_METADATA_KEY: "inrcy_public_trial_completed_at" },
    "@/lib/signupTrialCompletion": { markPublicSignupTrialCompleted: forbidden },
    "@/lib/observability/logger": { log: { warn: forbidden } }, "@/i18n/config": {},
  });
  assert.equal(await api.recoverInterruptedPublicInviteSignupForUser({ id: USER, email: "synthetic@example.invalid", app_metadata: appMetadata,
    invited_at: marker.created_at, user_metadata: { inrcy_signup_form: { consent: true }, inrcy_signup_recovery_v1: { trialDays: 365 } } }), "ineligible");
});
