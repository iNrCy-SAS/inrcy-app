import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { randomUUID } from "node:crypto";
import ts from "typescript";

const USER = "00000000-0000-4000-8000-000000000001";
const EMAIL = "synthetic@example.com";
const PASSWORD = "SyntheticOnly!Access27";
const SECRET = "synthetic-only-signup-secret";
const METADATA = {
  version: 1, welcome_id: "00000000-0000-4000-8000-000000000002",
  issued_at: "2026-11-19T12:00:00.000Z", expires_at: "2026-12-19T12:00:00.000Z",
};

type FixtureOptions = {
  existing?: boolean;
  authDuplicate?: boolean;
  failProvision?: boolean;
  mailFailure?: boolean;
  mailHangs?: boolean;
};

function fixture(options: FixtureOptions = {}) {
  const calls: string[] = [];
  const logs: unknown[] = [];
  const accessInputs: unknown[] = [];
  const background: Array<() => void | Promise<void>> = [];
  let releaseMail: (() => void) | null = null;
  const access = {
    email: EMAIL, password: PASSWORD, ticket: "synthetic-only-encrypted-handoff",
    expires_at: "2026-11-19T13:00:00.000Z", login_url: "https://app.inrcy.com/api/auth/signup-access",
  };
  const profileWrite = { upsert: async () => ({ error: null }) };
  const dependencies: Record<string, unknown> = {
    "node:crypto": { randomUUID },
    "next/server": {
      after: (callback: () => void | Promise<void>) => { background.push(callback); },
      NextResponse: class extends Response {
        static json(body: unknown, init?: ResponseInit) {
          return new Response(JSON.stringify(body), { ...init, headers: { "Content-Type": "application/json", ...Object.fromEntries(new Headers(init?.headers).entries()) } });
        }
      },
    },
    "@/lib/env": { optionalEnv: (_key: string, fallback: string) => fallback, requireEnv: () => SECRET },
    "@/lib/notifications": {
      ensureNotificationPreferences: async () => { calls.push("notification preferences"); },
      seedWelcomeNotifications: async () => { calls.push("welcome notifications"); },
    },
    "@/lib/ensureProfileRow": { ensureProfileRow: async () => { calls.push("profile"); } },
    "@/lib/appBubbleAccessProvisioning": { provisionNewAccountBubbleAccess: async () => { calls.push("bubble access"); } },
    "@/lib/inrcyAccountProvisioning": { ensurePrincipalInrcyAccountProvisioned: async () => {
      calls.push("provision"); if (options.failProvision) throw new Error("synthetic provisioning failure");
    } },
    "@/lib/rateLimit": { getClientIp: () => "127.0.0.1", enforceRateLimit: async () => null },
    "@/lib/observability/logger": { log: { error: (...args: unknown[]) => logs.push(args), info: (...args: unknown[]) => logs.push(args), warn: (...args: unknown[]) => logs.push(args) } },
    "@/lib/observability/request": { getRequestId: () => "synthetic-request-id" },
    "@/lib/observability/sentry": { captureApiException: () => { calls.push("capture failure"); } },
    "@/lib/subscriptionAdmin": { sendAdminSubscriptionAlertForUser: async () => { calls.push("admin alert"); } },
    "@/lib/signupFailureAlert": { sendSignupFailureAlert: async () => ({}) },
    "@/lib/signupFailureAlertPolicy": {
      getSignupFailureErrorCode: () => "synthetic_failure", getSignupFailureSafeMessage: () => "Synthetic failure",
      maskSignupEmailForLog: () => "sy******@example.com",
    },
    "@/lib/supabaseAdmin": { supabaseAdmin: {
      from: () => profileWrite,
      auth: { admin: { createUser: async (input: { email: string; password: string }) => {
        calls.push("create user"); assert.equal(input.password, PASSWORD); assert.equal(input.email, EMAIL);
        return options.authDuplicate
          ? { data: {}, error: { code: "email_exists" } }
          : { data: { user: { id: USER, email: EMAIL } }, error: null };
      } } },
    } },
    "@/lib/trialSubscription": { getTrialDays: () => 21, ensureTrialSubscription: async () => {
      calls.push("trial"); return { edition: "standard", trialDays: 21, end: new Date("2026-12-10T12:00:00.000Z") };
    } },
    "@/lib/signupTrialCompletion": { markPublicSignupTrialCompleted: async () => { calls.push("trial completed"); } },
    "@/lib/signupRecoveryProof": { createSignupRecoveryProof: () => "synthetic-recovery-proof", SIGNUP_RECOVERY_METADATA_KEY: "inrcy_signup_recovery" },
    "@/lib/userFacingErrors": { getSimpleFrenchErrorMessage: (_error: unknown, fallback: string) => fallback },
    "@/lib/temporaryPasswordPolicy": { TEMPORARY_PASSWORD_METADATA_KEY: "inrcy_temporary_password" },
    "@/lib/signupWelcomeMail": {
      prepareSignupWelcome: async () => { calls.push("prepare welcome"); return { password: PASSWORD, metadata: METADATA }; },
      attachSignupWelcome: async () => { calls.push("attach welcome"); },
      completeSignupWelcome: async () => { calls.push("welcome ready"); },
      deliverSignupWelcome: async () => {
        calls.push("deliver welcome");
        if (options.mailHangs) await new Promise<void>(resolve => { releaseMail = resolve; });
        if (options.mailFailure) throw new Error(`provider unavailable ${PASSWORD} ${access.ticket}`);
        return { delivered: true };
      },
    },
    "@/lib/signupImmediateAccessServer": { createSignupImmediateAccess: async (input: unknown) => {
      calls.push("create access"); accessInputs.push(input); return access;
    } },
    "@/lib/visioBookingToken": { createVisioBookingToken: () => "synthetic-booking-token" },
    "@/lib/visioBookingGoogle": { ensurePendingSignupCalendarReminder: async () => { calls.push("calendar reminder"); } },
    "@/lib/supabaseAuthBusinessErrors": {
      hasKnownInrcyAccountForEmail: async () => Boolean(options.existing),
      isExistingAuthUserError: (error: { code: string }) => error.code === "email_exists",
    },
    "@/lib/signupFormSnapshot": { createSignupFormSnapshot: (input: unknown) => input, SIGNUP_FORM_METADATA_KEY: "inrcy_signup_form" },
    "@/lib/signupAttribution": {
      createMetaBrowserMatch: (input: unknown) => input, createSignupAttributionSnapshot: (input: unknown) => input,
      getSignupAdLabel: () => "", getSignupCampaignLabel: () => "", getSignupAttributionSourceLabel: () => "synthetic test",
      SIGNUP_ATTRIBUTION_METADATA_KEY: "inrcy_signup_attribution",
    },
    "@/lib/metaConversionOutbox": { buildMetaConversionEventId: () => "synthetic-event", enqueueMetaConversionEvent: async () => {}, processMetaConversionEvents: async () => {} },
    "@/lib/signupAttributionPersistence": { persistSignupAttribution: async () => ({ eventId: "synthetic-event" }) },
    "@/i18n/config": { DEFAULT_APP_LOCALE: "fr-FR", appLanguageFromLocale: () => "fr", tryNormalizeAppLocale: () => "fr-FR" },
  };
  const source = ts.transpileModule(readFileSync("app/api/public/trial-signup/route.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const record = { exports: {} as { POST: (request: Request) => Promise<Response> } };
  new Function("module", "exports", "require", "console", source)(record, record.exports, (name: string) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unmocked signup dependency: ${name}`); return dependencies[name];
  }, { error: (...args: unknown[]) => logs.push(args), warn: (...args: unknown[]) => logs.push(args) });
  const post = (overrides: Record<string, unknown> = {}, token = SECRET) => record.exports.POST(new Request(`https://app.inrcy.com/api/public/trial-signup?token=${token}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, first_name: "Synthetic", last_name: "Professional", consent: true, ...overrides }),
  }));
  return { post, calls, logs, accessInputs, access, background,
    runBackground: () => Promise.all(background.splice(0).map(callback => callback())),
    releaseMail: () => { assert.ok(releaseMail); releaseMail(); },
  };
}

test("only a fully provisioned new signup receives its own immediate access and the existing booking token", async () => {
  const f = fixture(); const response = await f.post(); const body = await response.json();
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(body.user_id, USER); assert.deepEqual(body.signup_access, f.access);
  assert.equal(body.booking_token, "synthetic-booking-token");
  assert.equal(body.trial_days, 21); assert.equal(body.app_edition, "standard");
  assert.deepEqual(f.accessInputs, [{ userId: USER, email: EMAIL, password: PASSWORD, metadata: METADATA, language: "fr" }]);
  assert.ok(f.calls.indexOf("provision") < f.calls.indexOf("create access"));
  assert.ok(f.calls.indexOf("trial completed") < f.calls.indexOf("create access"));
  assert.ok(f.calls.indexOf("welcome ready") < f.calls.indexOf("create access"));
  assert.equal(f.calls.filter(call => call === "create user").length, 1);
  assert.equal(f.calls.includes("deliver welcome"), false, "email delivery waits until after the signup response");
  await f.runBackground();
  assert.ok(f.calls.includes("deliver welcome"));
});

test("a welcome provider failure still returns the new account access and never logs credentials", async () => {
  const f = fixture({ mailFailure: true }); const response = await f.post(); const body = await response.json();
  assert.equal(response.status, 200); assert.deepEqual(body.signup_access, f.access);
  await f.runBackground();
  assert.ok(f.calls.includes("deliver welcome")); assert.ok(f.calls.includes("calendar reminder"));
  assert.equal(f.calls.includes("capture failure"), false);
  const logged = JSON.stringify(f.logs); assert.ok(!logged.includes(PASSWORD)); assert.ok(!logged.includes(f.access.ticket));
});

test("a stalled welcome provider cannot delay the credentials response or the booking proposal", async () => {
  const f = fixture({ mailHangs: true }); const response = await f.post(); const body = await response.json();
  assert.equal(response.status, 200); assert.deepEqual(body.signup_access, f.access);
  assert.equal(body.booking_token, "synthetic-booking-token");
  assert.equal(f.background.length, 1); assert.equal(f.calls.includes("deliver welcome"), false);
  const delivery = f.runBackground();
  assert.ok(f.calls.includes("deliver welcome"));
  f.releaseMail(); await delivery;
});

for (const options of [{ existing: true }, { authDuplicate: true }]) test(`existing-account refusal never reveals or creates access: ${JSON.stringify(options)}`, async () => {
  const f = fixture(options); const response = await f.post(); const body = await response.json();
  assert.equal(response.status, 409); assert.equal(body.code, "email_already_used");
  assert.equal(body.signup_access, undefined); assert.equal(f.accessInputs.length, 0);
  assert.equal(f.calls.includes("deliver welcome"), false);
});

test("provisioning failure does not issue an access handoff for an incomplete account", async () => {
  const f = fixture({ failProvision: true }); const response = await f.post(); const body = await response.json();
  assert.equal(response.status, 500); assert.equal(body.signup_access, undefined); assert.equal(f.accessInputs.length, 0);
  assert.equal(f.calls.includes("deliver welcome"), false); assert.ok(!JSON.stringify(body).includes(PASSWORD));
});

test("invalid secret, missing consent and bot success never return credentials", async () => {
  for (const [payload, token, expected] of [[{}, "invalid", 401], [{ consent: false }, SECRET, 400], [{ website: "bot" }, SECRET, 200]] as const) {
    const f = fixture(); const response = await f.post(payload, token); const body = await response.json();
    assert.equal(response.status, expected); assert.equal(body.signup_access, undefined); assert.equal(f.calls.length, 0);
  }
});
