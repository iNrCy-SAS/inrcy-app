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
const EXTERNAL_SERVICES = ["deliver welcome", "deliver conversion", "calendar reminder", "admin alert"] as const;
type ExternalService = typeof EXTERNAL_SERVICES[number];

type FixtureOptions = {
  existing?: boolean;
  authDuplicate?: boolean;
  failProvision?: boolean;
  mailFailure?: boolean;
  mailHangs?: boolean;
  hangService?: ExternalService;
  failService?: ExternalService;
  attributionFailure?: boolean;
  enqueueFailure?: boolean;
  persistedEventId?: string;
};

function fixture(options: FixtureOptions = {}) {
  const calls: string[] = [];
  const logs: unknown[] = [];
  const accessInputs: unknown[] = [];
  const background: Array<() => void | Promise<void>> = [];
  const releases = new Map<ExternalService, () => void>();
  const finished = new Set<ExternalService>();
  const serviceInputs: Array<{ service: ExternalService; input: unknown }> = [];
  const attributionInputs: unknown[] = [];
  const registrationInputs: unknown[] = [];
  const metaEventIdInputs: unknown[][] = [];
  const access = {
    email: EMAIL, password: PASSWORD, ticket: "synthetic-only-encrypted-handoff",
    expires_at: "2026-11-19T13:00:00.000Z", login_url: "https://app.inrcy.com/api/auth/signup-access",
  };
  const profileWrite = { upsert: async () => ({ error: null }) };
  async function external(service: ExternalService, input: unknown) {
    calls.push(service); serviceInputs.push({ service, input });
    if (options.hangService === service || service === "deliver welcome" && options.mailHangs) {
      await new Promise<void>(resolve => { releases.set(service, resolve); });
    }
    if (options.failService === service || service === "deliver welcome" && options.mailFailure) {
      throw new Error(`provider unavailable ${PASSWORD} ${access.ticket} ${EMAIL}`);
    }
    finished.add(service);
  }
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
    "@/lib/subscriptionAdmin": { sendAdminSubscriptionAlertForUser: (input: unknown) => external("admin alert", input) },
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
      deliverSignupWelcome: async (input: unknown) => {
        await external("deliver welcome", input);
        return { delivered: true };
      },
    },
    "@/lib/signupImmediateAccessServer": { createSignupImmediateAccess: async (input: unknown) => {
      calls.push("create access"); accessInputs.push(input); return access;
    } },
    "@/lib/visioBookingToken": { createVisioBookingToken: () => "synthetic-booking-token" },
    "@/lib/visioBookingGoogle": { ensurePendingSignupCalendarReminder: (input: unknown) => external("calendar reminder", input) },
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
    "@/lib/metaConversionOutbox": {
      buildMetaConversionEventId: (...input: unknown[]) => { metaEventIdInputs.push(input); return "synthetic-event"; },
      enqueueMetaConversionEvent: async (input: unknown) => {
        calls.push("enqueue conversion"); registrationInputs.push(input);
        if (options.enqueueFailure) throw new Error(`outbox unavailable ${PASSWORD} ${access.ticket} ${EMAIL}`);
      },
      processMetaConversionEvents: (input: unknown) => external("deliver conversion", input),
    },
    "@/lib/signupAttributionPersistence": { persistSignupAttribution: async (input: unknown) => {
      calls.push("persist attribution"); attributionInputs.push(input);
      if (options.attributionFailure) throw new Error(`persistence unavailable ${PASSWORD} ${access.ticket} ${EMAIL}`);
      return { eventId: options.persistedEventId ?? "synthetic-event" };
    } },
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
  const release = (service: ExternalService) => { const resolve = releases.get(service); assert.ok(resolve); resolve(); };
  return { post, calls, logs, accessInputs, access, background, finished, serviceInputs, attributionInputs, registrationInputs, metaEventIdInputs, release,
    runBackground: () => Promise.all(background.splice(0).map(callback => callback())),
    releaseMail: () => release("deliver welcome"),
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
  assert.equal(f.attributionInputs.length, 1, "the idempotent attribution/Lead outbox is durable before the receipt");
  assert.equal(f.registrationInputs.length, 1, "the CompleteRegistration outbox is durable before the receipt too");
  assert.equal(f.serviceInputs.length, 0, "no optional provider is contacted before the receipt");
  assert.equal(f.background.length, 4, "welcome, CAPI, calendar and admin alert have independent after callbacks");
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
  assert.equal(f.background.length, 4); assert.equal(f.calls.includes("deliver welcome"), false);
  const delivery = f.runBackground();
  assert.ok(f.calls.includes("deliver welcome"));
  f.releaseMail(); await delivery;
});

for (const service of EXTERNAL_SERVICES) {
  test(`a suspended ${service} cannot delay the receipt or the independent signup tasks`, { timeout: 2_000 }, async () => {
    const f = fixture({ hangService: service });
    const response = await f.post(); const body = await response.json();
    assert.equal(response.status, 200); assert.deepEqual(body.signup_access, f.access);
    assert.equal(body.booking_token, "synthetic-booking-token");
    assert.equal(f.serviceInputs.length, 0, "providers start after the JSON response");
    const tasks = f.runBackground();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.ok(f.calls.includes(service)); assert.equal(f.finished.has(service), false);
    for (const independent of ["deliver welcome", "calendar reminder", "admin alert"] as const) {
      if (independent !== service) assert.ok(f.finished.has(independent), `${independent} is independent of ${service}`);
    }
    if (service !== "deliver conversion") assert.ok(f.finished.has("deliver conversion"));
    assert.equal(f.calls.filter(call => call === "persist attribution").length, 1);
    f.release(service); await tasks;
    assert.ok(f.finished.has(service));
  });

  test(`a rejected ${service} leaves the account receipt, other tasks and credentials privacy intact`, { timeout: 2_000 }, async () => {
    const f = fixture({ failService: service });
    const response = await f.post(); const body = await response.json();
    assert.equal(response.status, 200); assert.deepEqual(body.signup_access, f.access);
    assert.equal(body.booking_token, "synthetic-booking-token");
    await f.runBackground();
    for (const other of EXTERNAL_SERVICES) if (other !== service) assert.ok(f.finished.has(other), `${other} still completes`);
    assert.equal(f.calls.includes("capture failure"), false);
    assert.equal(f.calls.filter(call => call === "create user").length, 1);
    assert.equal(f.calls.filter(call => call === "persist attribution").length, 1);
    const logged = JSON.stringify(f.logs);
    for (const privateValue of [PASSWORD, f.access.ticket, EMAIL]) assert.equal(logged.includes(privateValue), false);
    const optionalPayloads = JSON.stringify(f.serviceInputs);
    assert.equal(optionalPayloads.includes(PASSWORD), false); assert.equal(optionalPayloads.includes(f.access.ticket), false);
  });
}

test("post-response tasks retain the canonical signup snapshot and the persisted deduplicated Meta event", async () => {
  const f = fixture({ persistedEventId: "winning-event" });
  const response = await f.post({ company_name: "Synthetic Company", phone: "0102030405", event_id: "browser-event" });
  assert.equal(response.status, 200);
  const persisted = f.attributionInputs[0] as { userId: string; attribution: object; browserMatch: object };
  assert.equal(persisted.userId, USER); assert.ok(Object.isFrozen(persisted.attribution)); assert.ok(Object.isFrozen(persisted.browserMatch));
  assert.deepEqual(f.metaEventIdInputs, [["Lead", USER, "winning-event"]]);
  await f.runBackground();
  assert.deepEqual(f.registrationInputs[0], {
    userId: USER, eventName: "CompleteRegistration", occurredAt: (f.serviceInputs.find(item => item.service === "calendar reminder")?.input as { createdAt: string }).createdAt,
    source: "public_signup_temporary_password",
  });
  const calendar = f.serviceInputs.find(item => item.service === "calendar reminder")?.input as Record<string, unknown>;
  assert.deepEqual({ ...calendar, createdAt: undefined }, { userId: USER, bookingToken: "synthetic-booking-token", email: EMAIL, firstName: "Synthetic", lastName: "Professional", company: "Synthetic Company", phone: "0102030405", createdAt: undefined });
  const admin = f.serviceInputs.find(item => item.service === "admin alert")?.input as Record<string, unknown>;
  assert.equal(admin.userId, USER); assert.equal(admin.accountEmail, EMAIL); assert.equal(admin.trialEndAt, "2026-12-10T12:00:00.000Z");
  assert.deepEqual(f.serviceInputs.find(item => item.service === "deliver conversion")?.input, { eventId: "synthetic-event", limit: 1 });
});

test("an attribution persistence failure cannot issue an uncommitted CAPI event or prevent other signup tasks", async () => {
  const f = fixture({ attributionFailure: true }); const response = await f.post();
  const body = await response.json(); assert.equal(response.status, 200); assert.deepEqual(body.signup_access, f.access);
  assert.equal(body.booking_token, "synthetic-booking-token"); assert.equal(f.background.length, 3);
  await f.runBackground();
  assert.equal(f.registrationInputs.length, 0);
  assert.equal(f.serviceInputs.some(item => item.service === "deliver conversion"), false);
  for (const service of ["deliver welcome", "calendar reminder", "admin alert"] as const) assert.ok(f.finished.has(service));
  for (const privateValue of [PASSWORD, f.access.ticket, EMAIL]) assert.equal(JSON.stringify(f.logs).includes(privateValue), false);
});

test("a registration outbox write failure preserves the durable Lead attempt and the signup receipt", async () => {
  const f = fixture({ enqueueFailure: true }); const response = await f.post();
  const body = await response.json(); assert.equal(response.status, 200); assert.deepEqual(body.signup_access, f.access);
  assert.equal(body.booking_token, "synthetic-booking-token");
  assert.equal(f.attributionInputs.length, 1); assert.equal(f.registrationInputs.length, 1);
  await f.runBackground();
  for (const service of EXTERNAL_SERVICES) assert.ok(f.finished.has(service));
  for (const privateValue of [PASSWORD, f.access.ticket, EMAIL]) assert.equal(JSON.stringify(f.logs).includes(privateValue), false);
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
