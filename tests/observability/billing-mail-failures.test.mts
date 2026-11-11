import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

type Context = { operation: "trial_reminder" | "annual_renewal_reminder" | "admin_trial_followup"; userId: string };
type Tracker = { record(error: unknown, context: Context): void; summary(): { mail_failures: number; mail_deferred: number; smtp_auth_blocked: boolean; degraded: boolean } };
function runtime() {
  const reported: unknown[] = [];
  const exports: { createBillingMailFailureTracker?: (report: (error: unknown) => void) => Tracker } = {};
  const code = ts.transpileModule(readFileSync(new URL("../../lib/billingMailFailures.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function("exports", "require", code)(exports, (id: string) => {
    assert.equal(id, "@/lib/txSmtpCircuit");
    return {
      isTxSmtpCircuitOpenError: (e: {code?: string}) => e.code === "TX_SMTP_AUTH_BACKOFF",
      isTxSmtpAuthenticationFailure: (e: {code?: string}) => e.code === "EAUTH",
    };
  });
  return { reported, tracker: exports.createBillingMailFailureTracker!(error => reported.push(error)) };
}
const context: Context = { operation: "trial_reminder", userId: "synthetic-account" };

test("a known authentication outage counts every deferred reminder without a Sentry event per customer", () => {
  const {reported, tracker} = runtime();
  for (let i = 0; i < 47; i++) tracker.record({code:"TX_SMTP_AUTH_BACKOFF"}, {...context, userId:`account-${i}`});
  assert.equal(reported.length, 0);
  assert.deepEqual(tracker.summary(), {mail_failures:47, mail_deferred:47, smtp_auth_blocked:true, degraded:true});
});

test("the original provider authentication failure is still reported once", () => {
  const {reported, tracker} = runtime();
  const original = {code:"EAUTH", responseCode:535};
  tracker.record(original, context);
  tracker.record({code:"EAUTH"}, {...context, operation:"admin_trial_followup"});
  tracker.record({code:"TX_SMTP_AUTH_BACKOFF"}, context);
  assert.deepEqual(reported, [original]);
  assert.equal(tracker.summary().mail_failures, 3);
  assert.equal(tracker.summary().degraded, true);
});

test("other SMTP, recipient and database errors remain visible", () => {
  const {reported, tracker} = runtime();
  for (const code of ["ETIMEDOUT", "EENVELOPE", "23505"]) tracker.record({code}, context);
  assert.equal(reported.length, 3);
  assert.equal(tracker.summary().mail_deferred, 0);
  assert.equal(tracker.summary().smtp_auth_blocked, false);
});

test("a new successful cron is healthy and does not inherit a previous failure count", () => {
  const old = runtime(); old.tracker.record({code:"TX_SMTP_AUTH_BACKOFF"}, context);
  assert.deepEqual(runtime().tracker.summary(), {mail_failures:0, mail_deferred:0, smtp_auth_blocked:false, degraded:false});
});
