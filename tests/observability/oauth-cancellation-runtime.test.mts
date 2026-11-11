import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function fixture() {
  const events: Array<{level: string; name: string; payload: unknown}> = [];
  const captured: Array<{kind: string; value: unknown}> = [];
  const scope = { setTag() {}, setUser() {}, setContext() {} };
  const loaded = { exports: {} as typeof import("../../lib/observability/oauth.ts") };
  const compiled = ts.transpileModule(readFileSync(new URL("../../lib/observability/oauth.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mocks: Record<string, unknown> = {
    "@sentry/nextjs": { withScope: (callback: (value: typeof scope) => void) => callback(scope), captureMessage: (value: unknown) => captured.push({kind: "message", value}), captureException: (value: unknown) => captured.push({kind: "exception", value}) },
    "@/lib/observability/logger": { log: Object.fromEntries(["info", "warn", "error"].map(level => [level, (name: string, payload: unknown) => events.push({level,name,payload})])) },
    "@/lib/observability/request": { getRequestId: () => "controlled-request", getRequestMeta: () => ({pathname: "/api/integrations/linkedin/callback", method: "GET"}) },
  };
  new Function("require", "module", "exports", compiled)((name: string) => { assert.ok(name in mocks); return mocks[name]; }, loaded, loaded.exports);
  return { ...loaded.exports, events, captured };
}

test("LinkedIn user_cancelled_login is an informational event even when an older caller reports failed", () => {
  const native = fixture();
  native.oauthCallbackEvent(new Request("https://app.example/api/integrations/linkedin/callback"), {provider: "linkedin", outcome: "failed", error: "user_cancelled_login", message: "The user cancelled LinkedIn login", capture_in_sentry: true});
  assert.equal(native.events.length, 1);
  assert.equal(native.events[0].level, "info");
  assert.equal(native.captured.length, 0);
});

test("a handled cancellation exception stays visible in the business log without creating a Sentry incident", () => {
  const native = fixture();
  native.oauthCallbackException(new Request("https://app.example/callback"), "linkedin", new Error("user_cancelled_login"));
  assert.equal(native.events[0].level, "info");
  assert.equal(native.captured.length, 0);
});

test("real OAuth provider and configuration failures still produce error logs and Sentry incidents", () => {
  const native = fixture();
  const req = new Request("https://app.example/callback");
  native.oauthCallbackEvent(req, {provider: "linkedin", outcome: "failed", error: "token_exchange_failed", status_code: 502, capture_in_sentry: true});
  native.oauthCallbackException(req, "linkedin", new Error("Provider token service unavailable"));
  assert.deepEqual(native.events.map(event => event.level), ["error", "error"]);
  assert.deepEqual(native.captured.map(event => event.kind), ["message", "exception"]);
});

test("state validation failures retain their warning and never become a successful connection", () => {
  const native = fixture();
  native.oauthCallbackEvent(new Request("https://app.example/callback"), {provider: "linkedin", outcome: "state_invalid", error: "missing_state", capture_in_sentry: true});
  assert.equal(native.events[0].level, "warn");
  assert.equal((native.events[0].payload as {outcome: string}).outcome, "state_invalid");
  assert.equal(native.captured.length, 0);
});
