import assert from "node:assert/strict";
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import type * as Route from "../../app/api/cron/assistant-memory-retention/route.ts";

const { NextResponse } = createRequire(import.meta.url)("next/server") as typeof import("next/server");
const CUTOFF = "2026-08-26T12:00:00.000Z";
function harness(options: { secret?: string; error?: boolean; throws?: boolean } = {}) {
  const calls: Array<Record<string, unknown>> = [];
  const builder = {
    delete(value: unknown) { calls.push({ delete: value }); return builder; },
    lt(column: string, value: unknown) { calls.push({ column, value }); return builder; },
    abortSignal(signal: AbortSignal) { assert.ok(signal instanceof AbortSignal); return builder; },
    then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
      return (options.throws ? Promise.reject(new Error("PRIVATE DB STACK AND CREDENTIAL")) : Promise.resolve({
        count: 7, data: [{ user_text: "PRIVATE PROSE" }], error: options.error ? { message: "PRIVATE SQL SECRET" } : null,
      })).then(resolve, reject);
    },
  };
  const dependencies: Record<string, unknown> = {
    "node:crypto": { timingSafeEqual }, "next/server": { NextResponse },
    "@/lib/supabaseAdmin": { supabaseAdmin: { from(table: string) { calls.push({ table }); return builder; } } },
    "@/lib/inrAssistantMemory": { inrAssistantMemoryCutoff() { return CUTOFF; } },
  };
  const source = readFileSync(new URL("../../app/api/cron/assistant-memory-retention/route.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const moduleRecord = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${output}\n})`, { Buffer, AbortSignal,
    process: { env: { CRON_SECRET: options.secret ?? "retention-server-secret" } },
  })((id: string) => { assert.ok(Object.hasOwn(dependencies, id)); return dependencies[id]; }, moduleRecord, moduleRecord.exports);
  const route = moduleRecord.exports as typeof Route;
  return { calls, get: (authorization?: string, query = "") => route.GET(new Request(`https://app.inrcy.com/api/cron/assistant-memory-retention${query}`, { headers: authorization ? { authorization } : {} })) };
}

test("cleanup requires the server Bearer secret and rejects query tokens or missing server configuration before touching storage", async () => {
  for (const [authorization, query, secret] of [
    [undefined, "", undefined], ["Bearer wrong", "", undefined], [undefined, "?secret=retention-server-secret", undefined],
    ["Bearer retention-server-secret", "", ""],
  ] as const) {
    const h = harness({ secret }); const response = await h.get(authorization, query);
    assert.equal(response.status, 401); assert.equal(h.calls.length, 0);
  }
});

test("authorized cleanup has one fixed table and calendar cutoff, ignores caller scope and returns no row data", async () => {
  const h = harness();
  const response = await h.get("Bearer retention-server-secret", "?cutoff=2099-01-01&accountId=foreign&table=clients");
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store, private");
  assert.deepEqual(await response.json(), { success: true, deleted: 7, cutoff: CUTOFF, retentionMonths: 2 });
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [{ table: "inr_assistant_turns" }, { delete: { count: "exact" } }, { column: "created_at", value: CUTOFF }]);
  const config = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));
  assert.deepEqual(config.crons.filter((entry: { path: string }) => entry.path === "/api/cron/assistant-memory-retention"), [{ path: "/api/cron/assistant-memory-retention", schedule: "45 3 * * *" }]);
});

test("database errors and thrown failures remain sanitized and never claim a successful deletion", async () => {
  for (const options of [{ error: true }, { throws: true }]) {
    const h = harness(options), response = await h.get("Bearer retention-server-secret");
    assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /PRIVATE|SQL|SECRET|STACK|success/);
  }
});
