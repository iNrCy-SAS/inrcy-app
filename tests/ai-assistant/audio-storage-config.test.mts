import assert from "node:assert/strict";
import test from "node:test";
import { configureAssistantAudioStorage } from "../../scripts/configure-assistant-audio-storage.mjs";

function fixture(overrides: Record<string, unknown> = {}) {
  let bucket = { public: false, file_size_limit: 20 * 1024 * 1024, allowed_mime_types: ["image/png", "application/json"], ...overrides };
  const changes: Record<string, unknown>[] = [];
  const client = { storage: { getBucket: async (id: string) => { assert.equal(id, "inrcy-assistant-attachments"); return { data: bucket, error: null }; },
    updateBucket: async (id: string, patch: { public: boolean; fileSizeLimit: number; allowedMimeTypes: string[] }) => {
      assert.equal(id, "inrcy-assistant-attachments"); changes.push(patch);
      bucket = { public: patch.public, file_size_limit: patch.fileSizeLimit, allowed_mime_types: patch.allowedMimeTypes }; return { error: null };
    } } };
  return { client, changes };
}
test("assistant audio storage check is read-only by default and reports its exact missing prerequisites", async () => {
  const f = fixture(), result = await configureAssistantAudioStorage(f.client);
  assert.equal(result.ready, false); assert.deepEqual(result.missingMimeTypes, ["audio/mpeg", "audio/wav"]); assert.deepEqual(f.changes, []);
});
test("explicit audio storage configuration preserves privacy/size/existing types and is idempotent", async () => {
  const f = fixture(); assert.equal((await configureAssistantAudioStorage(f.client, true)).ready, true);
  assert.deepEqual(f.changes, [{ public: false, fileSizeLimit: 20 * 1024 * 1024, allowedMimeTypes: ["image/png", "application/json", "audio/mpeg", "audio/wav"] }]);
  assert.equal((await configureAssistantAudioStorage(f.client, true)).applied, false); assert.equal(f.changes.length, 1);
});
test("configuration refuses a public, unexpected-size or malformed bucket instead of silently changing its access", async () => {
  for (const overrides of [{ public: true }, { file_size_limit: 123 }, { allowed_mime_types: {} }]) {
    const f = fixture(overrides); await assert.rejects(configureAssistantAudioStorage(f.client, true)); assert.deepEqual(f.changes, []);
  }
  const unrestricted = fixture({ allowed_mime_types: null }); assert.equal((await configureAssistantAudioStorage(unrestricted.client, true)).ready, true); assert.deepEqual(unrestricted.changes, []);
});
