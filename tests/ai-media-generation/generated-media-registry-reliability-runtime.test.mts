import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import type * as Registry from "../../lib/aiGeneratedMediaRegistry.ts";

function harness(mode: "lost-response" | "thrown-response" | "unresolved" | "recovery-unavailable") {
  let row: Record<string, unknown> | null = null;
  let reads = 0;
  let storageExists = false;
  let removals = 0;
  let signatures = 0;
  const insertError = new Error("insert response lost");
  const supabaseAdmin = {
    from: () => {
      let payload: Record<string, unknown>;
      const query = {
        select: () => query, eq: () => query,
        insert: (value: Record<string, unknown>) => { payload = value; return query; },
        maybeSingle: async () => {
          reads += 1;
          return { data: row, error: reads > 1 && mode === "recovery-unavailable" ? new Error("read unavailable") : null };
        },
        single: async () => {
          if (mode !== "unresolved") row = { ...payload, id: "media-test-0001", created_at: new Date().toISOString() };
          if (mode === "thrown-response") throw insertError;
          return { data: null, error: insertError };
        },
      };
      return query;
    },
    storage: { from: () => ({
      upload: async () => { storageExists = true; return { error: null }; },
      remove: async () => { removals += 1; storageExists = false; return { error: null }; },
    }) },
  };
  const stubs: Record<string, unknown> = {
    "server-only": {},
    "@/lib/supabaseAdmin": { supabaseAdmin },
    "@/lib/mediaImageNormalizationQueue": { enqueueImageNormalization: async () => {} },
    "@/lib/mediaVideoNormalizationQueue": { enqueueVideoNormalization: async () => {} },
    "@/lib/mediaLibraryContentUrl": { buildMediaLibraryContentUrl: (id: string) => `/library/${id}` },
    "@/lib/mediaPipelineRegistry": { UNIVERSAL_MEDIA_PIPELINE_VERSION: 1 },
    "@/lib/safeStorageSignedUrl": { createSafeStorageSignedUrl: async () => { signatures += 1; return "https://test.invalid/signed"; } },
  };
  const source = readFileSync(new URL("../../lib/aiGeneratedMediaRegistry.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const moduleRecord = { exports: {} };
  const nativeRequire = createRequire(import.meta.url);
  vm.runInNewContext(`(function(require,module,exports){${output}\n})`, { Buffer, console: { warn() {} } })((id: string) => {
    if (id.startsWith("node:")) return nativeRequire(id);
    if (!(id in stubs)) throw new Error(`unexpected_dependency:${id}`);
    return stubs[id];
  }, moduleRecord, moduleRecord.exports);
  return {
    runtime: moduleRecord.exports as typeof Registry,
    state: () => ({ storageExists, removals, reads, signatures }),
  };
}

const args = {
  accountId: "account-test-0001", authUserId: "user-test-0001", jobId: "job-test-0001", title: "Test",
  media: { kind: "image", buffer: Buffer.from("test-image"), extension: "jpg", mimeType: "image/jpeg", width: 100, height: 100, durationSeconds: null }, metadata: {},
} as Parameters<typeof Registry.saveGeneratedAiMediaDraft>[0];

for (const mode of ["lost-response", "thrown-response"] as const) test(`committed INSERT with ${mode} recovers the same media and preserves its object`, async () => {
  const h = harness(mode);
  const item = await h.runtime.saveGeneratedAiMediaDraft(args);
  assert.equal(item.id, "media-test-0001");
  assert.equal(item.signed_url, "/api/media-generation/drafts/media-test-0001/content");
  assert.deepEqual(h.state(), { storageExists: true, removals: 0, reads: 2, signatures: 0 });
});

for (const mode of ["unresolved", "recovery-unavailable"] as const) test(`${mode} cannot destroy an upload or claim successful persistence`, async () => {
  const h = harness(mode);
  await assert.rejects(h.runtime.saveGeneratedAiMediaDraft(args), /insert response lost/);
  assert.equal(h.state().storageExists, true);
  assert.equal(h.state().removals, 0);
});
