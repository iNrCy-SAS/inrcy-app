import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import type * as Diagnostics from "../../lib/observability/accountDiagnostics.ts";

const require = createRequire(import.meta.url);
const ACCOUNT_A = "10000000-0000-4000-8000-000000000001";
const ACCOUNT_B = "20000000-0000-4000-8000-000000000002";
const ACTOR = "30000000-0000-4000-8000-000000000003";
const REQUEST = "40000000-0000-4000-8000-000000000004";

function harness() {
  const storage = new Map<string, unknown[]>();
  const writes: { key: string; values: unknown[] }[] = [];
  let bypass = false;
  let failed = false;
  class Redis {
    async eval(_script: string, keys: string[], values: unknown[]) {
      if (failed) throw new Error("Storage unavailable");
      writes.push({ key: keys[0], values });
      storage.set(keys[0], [String(values[0]), ...(storage.get(keys[0]) || [])].slice(0, Number(values[1])));
      return 1;
    }
    async lrange(key: string) {
      if (failed) throw new Error("Storage unavailable");
      return storage.get(key) || [];
    }
  }
  const source = readFileSync(new URL("../../lib/observability/accountDiagnostics.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const record = { exports: {} };
  new Function("require", "module", "exports", "process", compiled)((name: string) => {
    if (name === "server-only") return {};
    if (name.startsWith("node:")) return require(name);
    if (name === "@upstash/redis") return { Redis };
    if (name === "../upstashMode.ts") return { shouldBypassUpstashInCurrentEnv: () => bypass };
    assert.fail(name);
  }, record, record.exports, { env: { KV_REST_API_URL: "https://test.invalid", KV_REST_API_TOKEN: "not-a-real-secret" } });
  return { runtime: record.exports as typeof Diagnostics, storage, writes, setBypass: () => { bypass = true; }, fail: () => { failed = true; } };
}

test("diagnostic traces are attached only to server-authenticated scope and isolated across concurrent requests", async () => {
  const { runtime } = harness();
  const scopes = await Promise.all([ACCOUNT_A, ACCOUNT_B].map(accountId => runtime.runWithAccountDiagnosticContext({ route: "/api/booster/publish-now", requestId: REQUEST }, async () => {
    assert.equal(runtime.getAccountDiagnosticLogContext().account_id, undefined);
    runtime.registerAuthenticatedDiagnosticScope({ accountId, actorUserId: ACTOR });
    await Promise.resolve();
    runtime.registerAuthenticatedDiagnosticScope({ accountId: accountId === ACCOUNT_A ? ACCOUNT_B : ACCOUNT_A, actorUserId: ACTOR });
    const current = runtime.getAccountDiagnosticLogContext();
    assert.equal(current.account_id, accountId);
    await runtime.recordCurrentAccountDiagnosticError(503, "ai_gateway_unavailable");
    return current;
  })));
  assert.equal(scopes[0].account_id, ACCOUNT_A);
  assert.equal(scopes[1].account_id, ACCOUNT_B);
  assert.deepEqual(runtime.getAccountDiagnosticLogContext(), {});
  assert.equal((await runtime.readAccountDiagnosticEvents(ACCOUNT_A)).events.length, 1);
  assert.equal((await runtime.readAccountDiagnosticEvents(ACCOUNT_B)).events.length, 1);
  assert.equal(await runtime.recordCurrentAccountDiagnosticError(500), false);
});

test("the journal retains only bounded public facts, not payloads, credentials, identities or private routes", async () => {
  const { runtime, writes } = harness();
  const error = { accountId: ACCOUNT_A, requestId: REQUEST, route: `/api/booster/posts/${ACCOUNT_B}?token=never-record-this`, statusCode: 500, errorCode: "Bearer never-record-this" };
  assert.equal(await runtime.recordAccountDiagnosticError(error), true);
  const row = (await runtime.readAccountDiagnosticEvents(ACCOUNT_A)).events[0];
  assert.equal(row.route, "/api/booster/posts/[id]");
  assert.equal(row.errorCode, "http_500");
  assert.doesNotMatch(JSON.stringify(row), /never-record-this|Bearer|accountId|actorUserId|user_id/);
  assert.equal(writes[0].values[1], 80);
  assert.equal(writes[0].values[2], 7 * 86400);
  for (const route of ["/api/admin/diagnostics", "/api/cron/process", "/api/auth/callback", "/api/diagnostic/send-report", "/api/media/%2fsecret", "https://private.test/api/error"]) {
    assert.equal(await runtime.recordAccountDiagnosticError({ ...error, route }), false, route);
  }
  for (const statusCode of [200, 399, 600, Number.NaN]) assert.equal(await runtime.recordAccountDiagnosticError({ ...error, statusCode }), false);
  assert.equal(await runtime.recordAccountDiagnosticError({ ...error, accountId: "account-a" }), false);
  await assert.rejects(() => runtime.readAccountDiagnosticEvents("../../other-account"));
});

test("malformed, expired and future records cannot become apparent current facts or leak extra stored fields", async () => {
  const { runtime, storage, writes } = harness();
  await runtime.recordAccountDiagnosticError({ accountId: ACCOUNT_A, requestId: REQUEST, route: "/api/ai-memory", statusCode: 503 });
  const key = writes[0].key;
  const row = (await runtime.readAccountDiagnosticEvents(ACCOUNT_A)).events[0];
  storage.set(key, [
    { ...row, privateSecret: "never-expose-me" },
    { ...row, occurredAt: new Date(Date.now() - 8 * 86400_000).toISOString() },
    { ...row, occurredAt: new Date(Date.now() + 86400_000).toISOString() },
    { ...row, route: "/api/admin/private" }, "not-json", { ...row, errorCode: "token_super_private" },
  ]);
  const result = await runtime.readAccountDiagnosticEvents(ACCOUNT_A);
  assert.equal(result.available, true);
  assert.equal(result.events.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /never-expose-me|privateSecret|token_super_private/);
});

test("missing or failed diagnostic storage is unknown and cannot fail the user's original operation", async () => {
  for (const state of ["disabled", "failed"] as const) {
    const { runtime, setBypass, fail } = harness();
    if (state === "disabled") setBypass(); else fail();
    assert.equal(await runtime.recordAccountDiagnosticError({ accountId: ACCOUNT_A, requestId: REQUEST, route: "/api/booster/publish-now", statusCode: 500 }), false);
    assert.deepEqual(await runtime.readAccountDiagnosticEvents(ACCOUNT_A), { available: false, events: [], retentionDays: 7 });
  }
});

test("the existing API wrapper correlates authenticated failures with Vercel logs and the same request reference", async () => {
  const { runtime } = harness();
  const logs: Record<string, unknown>[] = [];
  const source = readFileSync(new URL("../../lib/observability/withApi.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const record = { exports: {} as { withApi: (handler: (req: Request) => Promise<Response>) => (req: Request) => Promise<Response> } };
  new Function("require", "module", "exports", compiled)((name: string) => {
    if (name === "next/server") return { NextResponse: { json: (body: unknown, options: ResponseInit) => Response.json(body, options) } };
    if (name.endsWith("/logger")) return { log: { info: (_name: string, value: Record<string, unknown>) => logs.push(value), error: (_name: string, value: Record<string, unknown>) => logs.push(value) } };
    if (name.endsWith("/request")) return { getRequestId: () => REQUEST, getRequestMeta: (req: Request) => ({ pathname: new URL(req.url).pathname, method: req.method, ip: "not-exposed-to-assistant" }) };
    if (name.endsWith("/sentry")) return { captureApiException: () => {} };
    if (name.endsWith("/accountDiagnostics")) return runtime;
    assert.fail(name);
  }, record, record.exports);
  const response = await record.exports.withApi(async () => {
    runtime.registerAuthenticatedDiagnosticScope({ accountId: ACCOUNT_A, actorUserId: ACTOR });
    runtime.noteAccountDiagnosticErrorCode("ai_gateway_guard_unavailable");
    return Response.json({ error: "No secret response body is copied" }, { status: 503 });
  })(new Request("https://app.inrcy.com/api/assistant/chat"));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("x-request-id"), REQUEST);
  assert.equal(logs[0].account_id, ACCOUNT_A);
  assert.equal(logs[0].user_id, ACTOR);
  const events = await runtime.readAccountDiagnosticEvents(ACCOUNT_A);
  assert.equal(events.events[0].requestId, REQUEST);
  assert.equal(events.events[0].errorCode, "ai_gateway_guard_unavailable");
  assert.doesNotMatch(JSON.stringify(events), /No secret response body|not-exposed-to-assistant/);
});
