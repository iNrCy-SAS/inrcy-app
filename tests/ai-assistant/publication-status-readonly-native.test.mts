import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as policy from "../../lib/boosterPublicationPolicy.ts";
import * as outcome from "../../lib/boosterPublicationOutcome.ts";
type Row = Record<string, unknown>;
function assertSummary(result: unknown): asserts result is { summary: { entries: Array<{ status: string }> } } {
  assert.ok(result && typeof result === "object" && "summary" in result);
  const summary = result.summary;
  assert.ok(summary && typeof summary === "object" && "entries" in summary && Array.isArray(summary.entries));
  assert.ok(summary.entries.every((entry: unknown) => entry && typeof entry === "object" && "status" in entry && typeof entry.status === "string"));
}
const ACCOUNT = "10000000-0000-4000-8000-000000000001", ID = "30000000-0000-4000-8000-000000000003", CHILD = "40000000-0000-4000-8000-000000000004";
function harness(status: string, missing = false) {
  const reads: Row[] = [], noWrite = () => assert.fail("A read-only status cannot claim, finalize, sync, update, delete or send anything");
  const rows = [{ id: ID, user_id: ACCOUNT, type: "publish_async_job", payload: { channels: ["facebook"], channelEventIds: { facebook: CHILD } } }, ...(missing ? [] : [{ id: CHILD, user_id: ACCOUNT, type: "publish_async_channel", payload: { status, result: status === "completed" ? { ok: true, external_id: "provider-id" } : { ok: false, error: "Publication failed" } } }])];
  const db = { from(table: string) { assert.equal(table, "app_events"); const filters: Array<[string, string, unknown]> = []; const result = () => { assert.ok(filters.some(([,key,value]) => key === "user_id" && value === ACCOUNT)); reads.push({ filters }); return rows.filter(row => filters.every(([kind,key,value]) => kind === "in" ? (value as unknown[]).includes(row[key as keyof typeof row]) : row[key as keyof typeof row] === value)); }; const q = { select() { return q; }, eq(key: string, value: unknown) { filters.push(["eq",key,value]); return q; }, in(key: string, value: unknown) { filters.push(["in",key,value]); return q; }, maybeSingle: async () => ({ data: result()[0] ?? null, error: null }), then(resolve: (v: unknown) => unknown) { return Promise.resolve({ data: result(), error: null }).then(resolve); }, update: noWrite, insert: noWrite, delete: noWrite }; return q; } };
  const deps: Row = { "server-only": {}, "node:crypto": { randomUUID }, "@/lib/executionIdempotency": { acquireExecutionIdempotencyLock: noWrite, completeExecutionIdempotencyLock: noWrite, completeExecutionIdempotencyLockOrThrow: noWrite, failExecutionIdempotencyLock: noWrite }, "@/lib/mediaWorkspaceConsumption": { syncPublicationWorkspaceContext: noWrite }, "@/lib/boosterPublicationPolicy": policy, "@/lib/boosterPublicationOutcome": outcome, "@/lib/mediaPreparationDisplay": { resolveMediaPreparationDisplayState: noWrite }, "@/lib/supabaseAdmin": { supabaseAdmin: db } };
  const source = ts.transpileModule(readFileSync(new URL("../../lib/boosterAsyncPublication.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loadedModule = { exports: {} as typeof import("../../lib/boosterAsyncPublication.ts") }; vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { Date, console })((key: string) => { assert.ok(Object.hasOwn(deps,key),key); return deps[key]; }, loadedModule, loadedModule.exports);
  return { read: async () => { const result = await loadedModule.exports.readAsyncPublicationStatus({ userId: ACCOUNT, publicationId: ID, readOnly: true }); assert.ok(result); assertSummary(result); return result; }, reads };
}
test("native readonly status projects terminal channel proof without finalization or idempotency writes", async () => {
  for (const state of ["completed", "failed"]) { const h = harness(state), result = await h.read(); assert.equal(result.done, true); assert.ok("finalizationPending" in result); assert.equal(result.finalizationPending, true); assert.equal(result.summary.entries[0].status, state === "completed" ? "published" : "failed"); assert.equal(h.reads.length, 2); }
});
test("native readonly status keeps running work pending and missing technical proof failed, never inventing publication", async () => {
  const pending = await harness("processing").read(); assert.equal(pending.done, false); assert.equal(pending.summary.entries[0].status, "processing");
  const missing = await harness("completed", true).read(); assert.equal(missing.done, true); assert.equal(missing.summary.entries[0].status, "failed");
});
