import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

class CancellationError extends Error { code = "BILLING_MANAGEMENT_REQUIRED"; provider = "manual"; }
function load(file: string, mocks: Record<string, unknown>) {
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exported = {} as { POST: (request: Request) => Promise<Response> };
  new Function("exports", "require", code)(exported, (name: string) => {
    assert.ok(name in mocks, `unexpected module ${name}`); return mocks[name];
  });
  return exported;
}
const requestId = "12345678-1234-1234-1234-123456789abc";
const request = () => new Request("https://app.test/api", { method: "POST", headers: { "x-request-id": requestId } });

test("unexpected billing failures keep HTTP500 and produce code/stage diagnostics without raw provider data", async () => {
  const logs: unknown[] = [];
  const native = load("app/api/billing/cancel/route.ts", {
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/requireUser": { requireUser: async () => ({ user: { id: "account" } }) },
    "@/lib/userFacingErrors": { getSimpleFrenchErrorMessage: () => "Service indisponible" },
    "@/lib/scheduleSubscriptionCancellation": { SubscriptionCancellationError: CancellationError, scheduleSubscriptionCancellationForUser: async () => { throw { code: "57014", message: "private provider text secret_token", details: "customer-data" }; } },
    "@/lib/observability/logger": { log: { error: (...args: unknown[]) => logs.push(args) } },
    "@/lib/observability/request": { getRequestId: (req: Request) => req.headers.get("x-request-id") },
  });
  assert.equal((await native.POST(request())).status, 500);
  assert.deepEqual(logs, [["billing_cancellation_failed", { route: "/api/billing/cancel", stage: "schedule_cancellation", status_code: 500, error_code: "57014", request_id: requestId }]]);
  assert.doesNotMatch(JSON.stringify(logs), /private|secret_token|customer-data/);
});

test("billing business preconditions stay HTTP409 without reporting a server fault", async () => {
  const native = load("app/api/billing/cancel/route.ts", {
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/requireUser": { requireUser: async () => ({ user: { id: "account" } }) },
    "@/lib/userFacingErrors": { getSimpleFrenchErrorMessage: () => "Service indisponible" },
    "@/lib/scheduleSubscriptionCancellation": { SubscriptionCancellationError: CancellationError, scheduleSubscriptionCancellationForUser: async () => { throw new CancellationError("manual management"); } },
    "@/lib/observability/logger": { log: { error: () => { throw new Error("preconditions are not server faults"); } } },
    "@/lib/observability/request": { getRequestId: (req: Request) => req.headers.get("x-request-id") },
  });
  assert.equal((await native.POST(request())).status, 409);
});

test("a DNA claim failure keeps HTTP503, records only safe diagnostics and never executes an analysis", async () => {
  const logs: unknown[] = [];
  const native = load("app/api/cron/business-dna-analysis/route.ts", {
    "next/server": { NextResponse: { json: Response.json }, after: () => { throw Error("No task may start"); } },
    "@/lib/cronAuth": { isAuthorizedCronRequest: () => true },
    "@/lib/supabaseAdmin": { supabaseAdmin: { rpc: async (name: string) => { assert.equal(name, "claim_due_business_dna_automatic_analysis"); return { data: null, error: { code: "57014", message: "private provider text", details: "private" } }; } } },
    "@/lib/businessDnaManualAnalysisJobs": { getQueuedBusinessDnaManualAnalysisJobs: async () => [] },
    "@/lib/businessDnaAnalysisTiming": { BUSINESS_DNA_AUTOMATIC_LEASE_SECONDS: 600 },
    "@/lib/observability/logger": { log: { error: (...args: unknown[]) => logs.push(args) } },
    "@/lib/observability/request": { getRequestId: (req: Request) => req.headers.get("x-request-id") },
  });
  assert.equal((await native.POST(request())).status, 503);
  assert.deepEqual(logs, [["business_dna_claim_failed", { route: "/api/cron/business-dna-analysis", stage: "claim", status_code: 503, error_code: "57014", migration_required: false, request_id: requestId }]]);
  assert.doesNotMatch(JSON.stringify(logs), /private provider|details/);
});
