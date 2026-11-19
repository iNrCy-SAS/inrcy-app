import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as direct from "../../lib/directSignupPolicy.ts";

type Row = Record<string, unknown>;
const USER = "11111111-1111-4111-8111-111111111111", EMAIL = "synthetic@example.invalid";
const PASSWORD = "Synthetic-Password-123!", SECRET = "synthetic-signup-secret";
const temporary = { version: 1, welcome_id: "22222222-2222-4222-8222-222222222222", issued_at: new Date().toISOString(), expires_at: new Date(Date.now() + 30 * 86400_000).toISOString() };

function load<T>(path: string, modules: Record<string, unknown>): T {
  const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const output = { exports: {} as T };
  new Function("module", "exports", "require", "console", code)(output, output.exports, (name: string) => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected direct-signup dependency ${name}`); return modules[name];
  }, { error() {}, warn() {} });
  return output.exports;
}

function fixture(options: { existing?: boolean; duplicate?: boolean; pendingFails?: boolean } = {}) {
  const calls: string[] = [], created: Row[] = [], writes: Array<{ table: string; row: Row }> = [];
  const background: Array<() => Promise<void>> = [];
  const access = { email: EMAIL, password: PASSWORD, ticket: "synthetic-private-handoff", expires_at: new Date(Date.now() + 3600_000).toISOString(), login_url: "https://app.inrcy.com/api/auth/signup-access" };
  const admin = { from: (table: string) => ({ upsert: (row: Row) => {
    writes.push({ table, row });
    const result = () => ({ data: row, error: table === "subscriptions" && options.pendingFails ? { code: "synthetic_pending_failure" } : null });
    const query = { select: () => query, single: async () => result(), then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(resolve(result())) };
    return query;
  } }), auth: { admin: { createUser: async (input: Row) => {
    calls.push("create user"); created.push(input);
    return options.duplicate ? { data: {}, error: { code: "email_exists" } }
      : { data: { user: { ...input, id: USER } }, error: null };
  } } } };
  const pending = load("lib/directSignupServer.ts", { "server-only": {}, "@/lib/supabaseAdmin": { supabaseAdmin: admin }, "@/lib/directSignupPolicy": direct,
    "@/lib/inrcyAccountProvisioning": { ensurePrincipalInrcyAccountProvisioned: () => assert.fail("initial signup must not enter repair") } });
  const modules = {
    "node:crypto": { randomUUID }, "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) }, after: (task: () => Promise<void>) => background.push(task) },
    "@/lib/env": { optionalEnv: (_key: string, fallback: string) => fallback, requireEnv: () => SECRET },
    "@/lib/directSignupPolicy": direct, "@/lib/directSignupServer": pending,
    "@/lib/supabaseAdmin": { supabaseAdmin: admin },
    "@/lib/notifications": { ensureNotificationPreferences: async () => calls.push("notifications"), seedWelcomeNotifications: async () => calls.push("welcome notifications") },
    "@/lib/ensureProfileRow": { ensureProfileRow: async () => calls.push("profile") },
    "@/lib/appBubbleAccessProvisioning": { provisionNewAccountBubbleAccess: async () => calls.push("bubble defaults") },
    "@/lib/inrcyAccountProvisioning": { ensurePrincipalInrcyAccountProvisioned: async () => calls.push("principal account") },
    "@/lib/rateLimit": { getClientIp: () => "127.0.0.1", enforceRateLimit: async () => null },
    "@/lib/observability/logger": { log: { error() {}, info() {}, warn() {} } },
    "@/lib/observability/request": { getRequestId: () => "synthetic-request" }, "@/lib/observability/sentry": { captureApiException() {} },
    "@/lib/subscriptionAdmin": { sendAdminSubscriptionAlertForUser: async () => calls.push("trial admin alert") },
    "@/lib/signupFailureAlert": { sendSignupFailureAlert: async () => ({}) },
    "@/lib/signupFailureAlertPolicy": { getSignupFailureErrorCode: () => "synthetic_failure", getSignupFailureSafeMessage: () => "Synthetic failure", maskSignupEmailForLog: () => "masked" },
    "@/lib/trialSubscription": { getTrialDays: () => 21, ensureTrialSubscription: async () => {
      calls.push("grant trial"); return { edition: "standard", trialDays: 21, end: new Date("2030-01-22T00:00:00.000Z") };
    } },
    "@/lib/signupTrialCompletion": { markPublicSignupTrialCompleted: async () => calls.push("trial completed") },
    "@/lib/signupRecoveryProof": { SIGNUP_RECOVERY_METADATA_KEY: "inrcy_signup_recovery_v1", createSignupRecoveryProof: () => { calls.push("trial recovery proof"); return "synthetic-signed-trial-proof"; } },
    "@/lib/userFacingErrors": { getSimpleFrenchErrorMessage: (_error: unknown, fallback: string) => fallback },
    "@/lib/temporaryPasswordPolicy": { TEMPORARY_PASSWORD_METADATA_KEY: "inrcy_temporary_password" },
    "@/lib/signupWelcomeMail": { prepareSignupWelcome: async () => ({ password: PASSWORD, metadata: temporary }),
      attachSignupWelcome: async () => calls.push("attach welcome"), completeSignupWelcome: async () => calls.push("ready welcome"),
      deliverSignupWelcome: async () => calls.push("deliver welcome") },
    "@/lib/signupImmediateAccessServer": { createSignupImmediateAccess: async () => { calls.push("access receipt"); return access; } },
    "@/lib/visioBookingToken": { createVisioBookingToken: () => { calls.push("booking token"); return "synthetic-booking-token"; } },
    "@/lib/visioBookingGoogle": { ensurePendingSignupCalendarReminder: async () => calls.push("calendar") },
    "@/lib/supabaseAuthBusinessErrors": { hasKnownInrcyAccountForEmail: async () => Boolean(options.existing), isExistingAuthUserError: (error: Row) => error.code === "email_exists" },
    "@/lib/signupFormSnapshot": { SIGNUP_FORM_METADATA_KEY: "inrcy_signup_form", createSignupFormSnapshot: (input: unknown) => input },
    "@/lib/signupAttribution": { SIGNUP_ATTRIBUTION_METADATA_KEY: "inrcy_signup_attribution", createMetaBrowserMatch: (input: unknown) => input,
      createSignupAttributionSnapshot: (input: unknown) => input, getSignupAdLabel: () => "", getSignupCampaignLabel: () => "", getSignupAttributionSourceLabel: () => "synthetic" },
    "@/lib/metaConversionOutbox": { buildMetaConversionEventId: () => "synthetic-event", enqueueMetaConversionEvent: async () => {}, processMetaConversionEvents: async () => {} },
    "@/lib/signupAttributionPersistence": { persistSignupAttribution: async () => ({ eventId: "synthetic-event" }) },
    "@/i18n/config": { DEFAULT_APP_LOCALE: "fr-FR", appLanguageFromLocale: () => "fr", tryNormalizeAppLocale: () => "fr-FR" },
  };
  const trial = load<{ POST(request: Request): Promise<Response> }>("app/api/public/trial-signup/route.ts", modules);
  const basic = load<{ POST(request: Request): Promise<Response> }>("app/api/public/basic-signup/route.ts", { "../trial-signup/route": trial });
  return { calls, created, writes, access, background,
    post: (path: "basic-signup" | "trial-signup" = "basic-signup", body: Row = {}) => (path === "basic-signup" ? basic : trial).POST(new Request(`https://app.inrcy.com/api/public/${path}?token=${SECRET}&trial_days=365`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, first_name: "Synthetic", consent: true, ...body }),
    })),
    finish: () => Promise.all(background.splice(0).map(task => task())),
  };
}

test("the fixed basic signup route provisions an unpaid Basic account and immediate access without a trial recovery proof or calendar offer", async () => {
  const f = fixture(); const response = await f.post("basic-signup", { trial_days: 365, plan: "Premium", signup_mode: "trial", direct_signup: false });
  const body = await response.json(); assert.equal(response.status, 200);
  assert.equal(body.direct_signup, true); assert.equal(body.activation_required, true); assert.equal(body.app_edition, "basic");
  assert.equal(body.trial_days, 0); assert.equal(body.trial_end_at, null); assert.equal(body.booking_token, undefined); assert.deepEqual(body.signup_access, f.access);
  assert.equal(f.created.length, 1);
  const user = f.created[0], server = user.app_metadata as Row, editable = user.user_metadata as Row;
  const marker = direct.getDirectSignupMetadata(server); assert.ok(marker); assert.equal(marker.entry, "basique");
  assert.equal(editable.inrcy_signup_recovery_v1, undefined); assert.equal(editable[direct.DIRECT_SIGNUP_METADATA_KEY], undefined);
  assert.ok(server.inrcy_temporary_password);
  const subscription = f.writes.find(write => write.table === "subscriptions")!.row;
  assert.equal(subscription.status, "incomplete"); assert.equal(subscription.plan, "Basic"); assert.equal(subscription.trial_end_at, null);
  assert.equal(subscription.stripe_subscription_id, undefined); assert.equal(direct.isDirectSignupPaid(subscription), false);
  assert.ok(f.calls.includes("principal account")); assert.ok(f.calls.includes("bubble defaults")); assert.ok(f.calls.includes("access receipt"));
  for (const call of ["grant trial", "trial completed", "trial recovery proof", "booking token", "calendar", "trial admin alert"]) assert.equal(f.calls.includes(call), false, call);
  assert.equal(f.calls.includes("deliver welcome"), false); await f.finish(); assert.ok(f.calls.includes("deliver welcome"));
  assert.equal(f.calls.includes("calendar"), false); assert.equal(f.calls.includes("trial admin alert"), false);
});

test("the existing signup route retains its signed21-day Standard trial even when the browser asks for direct purchase", async () => {
  const f = fixture(); const response = await f.post("trial-signup", { trial_days: 0, plan: "Basic", direct_signup: true, signup_mode: "basique" });
  const body = await response.json(); assert.equal(response.status, 200);
  assert.equal(body.trial_days, 21); assert.equal(body.app_edition, "standard"); assert.equal(body.direct_signup, undefined);
  assert.equal(body.booking_token, "synthetic-booking-token");
  assert.equal(direct.getDirectSignupMetadata(f.created[0].app_metadata), null);
  assert.equal((f.created[0].user_metadata as Row).inrcy_signup_recovery_v1, "synthetic-signed-trial-proof");
  for (const call of ["grant trial", "trial completed", "trial recovery proof"]) assert.ok(f.calls.includes(call));
  assert.equal(f.writes.some(write => write.table === "subscriptions"), false);
  await f.finish(); assert.ok(f.calls.includes("calendar")); assert.ok(f.calls.includes("trial admin alert"));
});

test("direct duplicate and incomplete provisioning never return credentials or reset an existing subscriber", async () => {
  for (const options of [{ existing: true }, { duplicate: true }, { pendingFails: true }]) {
    const f = fixture(options); const response = await f.post(); const body = await response.json();
    assert.equal(response.status, options.pendingFails ? 500 : 409); assert.equal(body.signup_access, undefined);
    assert.equal(f.calls.includes("access receipt"), false); assert.equal(f.calls.includes("deliver welcome"), false);
    assert.equal(f.calls.includes("grant trial"), false);
    if (!options.pendingFails) assert.equal(f.writes.length, 0);
    assert.equal(JSON.stringify(body).includes(PASSWORD), false);
  }
});
