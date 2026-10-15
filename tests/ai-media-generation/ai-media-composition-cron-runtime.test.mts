import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function harness(authorized: boolean, fail = false) {
  const calls: string[] = [];
  const source = ts.transpileModule(readFileSync(new URL("../../app/api/cron/media-generation-recovery/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const record = { exports: {} as { GET: (r: Request) => Promise<Response>; POST: (r: Request) => Promise<Response> } };
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/cronAuth": { isAuthorizedCronRequest: () => authorized },
    "@/lib/aiMediaCompositionRecovery": { recoverNextAiMediaCompositionCheckpoint: async () => { calls.push("recover"); if (fail) throw new Error("internal storage diagnostics"); return { status: "idle" }; } },
    "@/lib/aiMediaGenerationQuota": { expireAiMediaGenerationReservations: async (args: unknown) => { assert.deepEqual(args, { batchSize: 100 }); calls.push("expire"); return 0; } },
  };
  new Function("module", "exports", "require", "console", source)(record, record.exports, (id: string) => { assert.ok(id in dependencies); return dependencies[id]; }, { info() {}, error() {} });
  return { calls, run: () => record.exports.GET(new Request("https://example.invalid/api/cron/media-generation-recovery")) };
}

test("recovery cron authenticates before claiming work, handles one montage and expires orphaned reservations", async () => {
  const rejected = harness(false); assert.equal((await rejected.run()).status, 401); assert.deepEqual(rejected.calls, []);
  const accepted = harness(true); const response = await accepted.run();
  assert.equal(response.status, 200); assert.match(response.headers.get("cache-control")!, /no-store/);
  assert.deepEqual(accepted.calls, ["recover", "expire"]);
});
test("recovery cron returns an explicit generic failure without provider calls or raw diagnostics", async () => {
  const h = harness(true, true); const response = await h.run(); assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, code: "AI_MEDIA_RECOVERY_UNAVAILABLE" });
  assert.deepEqual(h.calls, ["recover"]);
});
