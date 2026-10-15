import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function harness(rows: unknown[], failList = false, failRemove = false) {
  const removed: string[][] = []; const calls: unknown[] = [];
  const record = { exports: {} as { purgeExpiredAiMediaProviderImages: (limit?: number) => Promise<{ inspected: number; removed: number; errors: string[] }> } };
  const source = ts.transpileModule(readFileSync(new URL("../../lib/aiMediaProviderImageCleanup.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("module", "exports", "require", source)(record, record.exports, (id: string) => {
    if (id === "server-only") return {};
    assert.equal(id, "@/lib/supabaseAdmin");
    return { supabaseAdmin: {
      async rpc(name: string, args: unknown) { assert.equal(name, "list_expired_ai_media_provider_images"); calls.push(args); return { data: rows, error: failList ? {} : null }; },
      storage: { from(bucket: string) { assert.equal(bucket, "inrcy-pro-media"); return { async remove(paths: string[]) { removed.push(paths); return { error: failRemove ? {} : null }; } }; } },
    } };
  });
  return { run: record.exports.purgeExpiredAiMediaProviderImages, removed, calls };
}
const path = "11111111-1111-4111-8111-111111111111/_provider-temp/22222222-2222-4222-8222-222222222222/0.jpg";
test("temporary provider cleanup removes only strictly scoped expired candidates via the Storage API", async () => {
  const h = harness([{ storage_path: path }, { storage_path: path }, { storage_path: path.replace("_provider-temp", "ai-generated") }, { storage_path: "../../important.jpg" }]);
  const result = await h.run(1_000);
  assert.deepEqual(h.calls, [{ p_batch_size: 100 }]); assert.deepEqual(h.removed, [[path]]);
  assert.equal(result.removed, 1); assert.deepEqual(result.errors, ["provider_temp_path_rejected"]);
});
test("listing failure never deletes anything and deletion failure is not counted as success", async () => {
  const listing = harness([{ storage_path: path }], true);
  assert.equal((await listing.run()).removed, 0); assert.equal(listing.removed.length, 0);
  const deletion = harness([{ storage_path: path }], false, true);
  assert.deepEqual((await deletion.run()).errors, ["provider_temp_delete_failed"]);
  const empty = harness([]); assert.deepEqual(await empty.run(), { inspected: 0, removed: 0, errors: [] });
});
