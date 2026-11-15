import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as authPolicy from "../../lib/authMailPolicy.ts";
import { resendFailureDetails } from "../../lib/resendFailurePolicy.ts";

type Row = Record<string, unknown>;
type Quota = { scope: "daily" | "monthly"; retryAt: string; observedAt: string; retryAtIsEstimate: boolean; storage: "shared" };
function load<T>(file: string, dependencies: Row, globals: Row = {}): T {
  const source = ts.transpileModule(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { Date, console, setTimeout, clearTimeout, Response, Request, URL, ...globals })(
    (name: string) => { assert.ok(Object.hasOwn(dependencies, name), `Unmocked service: ${name}`); return dependencies[name]; }, loadedModule, loadedModule.exports,
  );
  return loadedModule.exports as T;
}
const message: authPolicy.PreparedAuthEmail = {
  deliveryKey: `v1:${"a".repeat(64)}`, deliveryHash: "a".repeat(64), providerIdempotencyKey: "auth-event-fixed",
  hookId: "hook-local-fixed", sequence: 0, userId: "10000000-0000-4000-8000-000000000001",
  recipient: "synthetic@example.test", action: "signup", subject: "Synthetic", text: "Synthetic only", html: "<p>Synthetic only</p>",
};

function harness(code = "daily_quota_exceeded", retryAfter?: string, providerStatus = 429) {
  let now = Date.parse("2026-11-15T11:01:00.000Z"), quota: Quota | null = null;
  const ledger: Row = { status: "pending", status_rank: 0, send_attempt_count: 0, provider_message_id: null, retry_at: null };
  const requests: Array<{ payload: Row; options: Row }> = [], rpcCalls: string[] = [];
  class Clock extends Date { constructor(value?: number | string) { super(value ?? now); } static now() { return now; } }
  const supabase = { async rpc(name: string, input: Row) {
    rpcCalls.push(name);
    if (name === "reserve_auth_email_delivery") {
      if (!(ledger.status === "deferred" && Date.parse(String(ledger.retry_at)) > now)) {
        ledger.send_attempt_count = Number(ledger.send_attempt_count) + 1;
        if (ledger.status === "deferred") Object.assign(ledger, { status: "pending", retry_at: null });
      }
    } else if (name === "defer_auth_email_delivery") {
      assert.equal(ledger.status_rank, 0);
      Object.assign(ledger, { status: "deferred", retry_at: input.p_retry_at, last_error_code: input.p_error_code, last_error_message: input.p_error_message });
    } else if (name === "accept_auth_email_delivery") Object.assign(ledger, { status: "accepted", status_rank: 10, provider_message_id: input.p_provider_message_id });
    else if (name === "fail_auth_email_delivery") Object.assign(ledger, { status: "failed", status_rank: 70 });
    else if (name === "mark_auth_email_delivery_acceptance_uncertain") Object.assign(ledger, { status: "acceptance_uncertain", status_rank: 15 });
    else if (name === "claim_auth_email_delivery_alerts") return { data: [], error: null };
    else assert.fail(`Unexpected RPC ${name}`);
    return { data: [{ ...ledger }], error: null };
  } };
  class Provider {
    emails = { send: async (payload: Row, options: Row) => {
      requests.push({ payload, options });
      if (code === "network_error") throw new Error("Synthetic lost response");
      return requests.length === 1
        ? { data: null, error: { name: code, statusCode: providerStatus, message: "Untrusted provider details" }, headers: retryAfter ? { "retry-after": retryAfter } : null }
        : { data: { id: "provider-accepted" }, error: null, headers: null };
    } };
  }
  const runtime = load<typeof import("../../lib/authMailDelivery.ts")>("lib/authMailDelivery.ts", {
    "server-only": {}, "node:crypto": crypto, resend: { Resend: Provider }, "@/lib/supabaseAdmin": { supabaseAdmin: supabase },
    "@/lib/authMailPolicy": authPolicy,
    "@/lib/resendFailurePolicy": { resendFailureDetails: (status: number, name: unknown, header: string | null) => resendFailureDetails(status, name, header, now) },
    "@/lib/txResendQuota": {
      readTxResendQuotaState: async () => quota && Date.parse(quota.retryAt) > now ? quota : null,
      rememberTxResendQuota: async (_key: string, state: Omit<Quota, "storage">) => (quota = { ...state, storage: "shared" }),
    },
  }, { Date: Clock, process: { env: { AUTH_RESEND_API_KEY: "fixture-only-key" } } });
  return { runtime, ledger, requests, rpcCalls, advanceTo: (value: string) => { now = Date.parse(value) + 1; }, quota: () => quota };
}

for (const [code, retryAfter, expectedRetryAt] of [
  ["daily_quota_exceeded", undefined, "2026-11-16T00:00:00.000Z"],
  ["monthly_quota_exceeded", undefined, "2026-11-15T12:01:00.000Z"],
  ["rate_limit_exceeded", "120", "2026-11-15T11:03:00.000Z"],
] as const) {
  test(`${code}: a confirmed refusal waits durably and later reuses the same idempotent email`, async () => {
    const h = harness(code, retryAfter);
    const isDeferred = (error: unknown) => {
      const value = error as { code: string; httpStatus: number; retryable: boolean; retryAt: string };
      assert.equal(value.code, code); assert.equal(value.httpStatus, 429); assert.equal(value.retryable, true); assert.equal(value.retryAt, expectedRetryAt);
      return true;
    };
    await assert.rejects(h.runtime.sendPreparedAuthEmail(message), isDeferred);
    assert.equal(h.ledger.status, "deferred"); assert.equal(h.ledger.status_rank, 0); assert.equal(h.ledger.last_error_code, code);
    await assert.rejects(h.runtime.sendPreparedAuthEmail(message), isDeferred);
    assert.equal(h.requests.length, 1); assert.equal(h.ledger.send_attempt_count, 1);
    assert.equal(h.rpcCalls.includes("fail_auth_email_delivery"), false);
    assert.equal(h.rpcCalls.includes("mark_auth_email_delivery_acceptance_uncertain"), false);
    h.advanceTo(expectedRetryAt);
    assert.equal((await h.runtime.sendPreparedAuthEmail(message)).accepted, true);
    assert.equal(h.ledger.status, "accepted"); assert.equal(h.requests.length, 2);
    assert.deepEqual(h.requests[1], h.requests[0]);
    if (code === "monthly_quota_exceeded") assert.equal(h.quota()?.retryAtIsEstimate, true, "an hourly probe is not a claimed monthly reset");
  });
}

test("a shared observed quota stops internal alerts before claiming or sending them", async () => {
  const h = harness();
  await assert.rejects(h.runtime.sendPreparedAuthEmail(message));
  const summary = await h.runtime.processDueAuthEmailFailureAlerts({ limit: 10 });
  assert.equal(summary.claimed, 0); assert.equal(h.requests.length, 1);
  assert.equal(h.rpcCalls.includes("claim_auth_email_delivery_alerts"), false);
  assert.equal((await h.runtime.processAuthEmailFailureAlert({ deliveryId: "local" })).outcome, "deferred");
});

test("an unknown network acceptance keeps the existing uncertainty guard and is never resent", async () => {
  const h = harness("network_error");
  assert.equal((await h.runtime.sendPreparedAuthEmail(message)).uncertain, true);
  assert.equal(h.ledger.status, "acceptance_uncertain");
  assert.equal((await h.runtime.sendPreparedAuthEmail(message)).replay, true);
  assert.equal(h.requests.length, 1);
  assert.equal(h.rpcCalls.includes("defer_auth_email_delivery"), false);
});

test("a provider 5xx is acceptance uncertainty rather than a terminal failure or an automatic resend", async () => {
  const h = harness("application_error", undefined, 500);
  assert.equal((await h.runtime.sendPreparedAuthEmail(message)).uncertain, true);
  assert.equal(h.ledger.status, "acceptance_uncertain"); assert.equal(h.ledger.status_rank, 15);
  assert.equal(h.rpcCalls.includes("fail_auth_email_delivery"), false);
  assert.equal(h.rpcCalls.includes("defer_auth_email_delivery"), false);
  assert.equal((await h.runtime.sendPreparedAuthEmail(message)).replay, true);
  assert.equal(h.requests.length, 1);
});

test("the reconciliation cron preserves welcome priority through deferred mail and full backlog batches", async () => {
  for (const [claimed, deferred, skipped] of [
    [0, 0, null], [9, 0, null], [10, 0, "welcome_backlog"], [20, 0, "welcome_backlog"],
    [1, 1, "welcome_deferred"], [10, 1, "welcome_deferred"],
  ] as const) {
    const calls: string[] = [];
    const route = load<typeof import("../../app/api/cron/auth-email-alerts/route.ts")>("app/api/cron/auth-email-alerts/route.ts", {
      "next/server": { NextResponse: { json: Response.json } }, "@/lib/cronAuth": { isAuthorizedCronRequest: () => true },
      "@/lib/signupWelcomeMail": { processPendingSignupWelcomes: async () => { calls.push("welcome"); return { claimed, delivered: claimed - deferred, failed: 0, deferred }; } },
      "@/lib/authMailDelivery": { processDueAuthEmailFailureAlerts: async () => { calls.push("alerts"); return { claimed: 0 }; } },
    }, { console: { info() {}, error() {} } });
    const response = await route.GET(new Request("https://local.invalid/api/cron/auth-email-alerts", { headers: { authorization: "Bearer fixture" } }));
    assert.equal(response.status, 200); assert.deepEqual(calls, skipped ? ["welcome"] : ["welcome", "alerts"]);
    const body = await response.json() as { alerts: { skipped?: string }; welcomes: { claimed: number } };
    assert.equal(body.alerts.skipped ?? null, skipped); assert.equal(body.welcomes.claimed, claimed);
  }
});
