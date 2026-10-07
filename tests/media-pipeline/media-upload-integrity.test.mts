import assert from "node:assert/strict";
import test from "node:test";
import { verifyMediaLibraryStoredUpload } from "../../lib/mediaStoredUploadIntegrity.ts";
import { getMediaImageRecoverySummary } from "../../lib/mediaImageRecoverySummary.ts";
import { sanitizeClientMediaMetadata } from "../../lib/mediaClientMetadata.ts";

test("library import requires an exact object name and complete declared bytes", async () => {
  const sizes = [undefined, 80, 100];
  let attempt = 0;
  const storage = { from: (bucket: string) => ({ list: async (folder: string, options: { search: string }) => {
    assert.equal(bucket, "private-media");
    assert.equal(folder, "users/owner/image/2026");
    assert.equal(options.search, "photo.jpg");
    return { data: [
      { name: "photo.jpg.partial", metadata: { size: 100 } },
      { name: "photo.jpg", metadata: { size: sizes[attempt++] } },
    ], error: null };
  } }) };
  assert.equal(await verifyMediaLibraryStoredUpload({ storage, bucket: "private-media", storagePath: "users/owner/image/2026/photo.jpg", expectedSize: 100, wait: async () => {} }), true);
  assert.equal(attempt, 3);
});

test("library import rejects short objects and propagates storage outages", async () => {
  const params = { bucket: "private", storagePath: "users/a/image/p.jpg", expectedSize: 100, wait: async () => {} };
  assert.equal(await verifyMediaLibraryStoredUpload({ ...params, storage: { from: () => ({ list: async () => ({ data: [{ name: "p.jpg", metadata: { size: 99 } }], error: null }) }) } }), false);
  const error = new Error("storage temporarily unavailable");
  await assert.rejects(verifyMediaLibraryStoredUpload({ ...params, storage: { from: () => ({ list: async () => ({ data: null, error }) }) } }), error);
});

test("recovery display requires server proof and never exposes private metadata", () => {
  const source = { probeProvenance: "server_sharp", requiresCanonical: true, recovery: { kind: "truncated_jpeg", version: 1, requiresReview: true }, secret: "private" };
  const metadata = { image_normalization: { source }, unrelated: "private" };
  assert.deepEqual(getMediaImageRecoverySummary(metadata), { requiresCanonical: true, imageRecovery: { kind: "truncated_jpeg", version: 1, requiresReview: true } });
  assert.deepEqual(getMediaImageRecoverySummary({ image_normalization: { source: { ...source, probeProvenance: "client" } } }), {});
  assert.deepEqual(getMediaImageRecoverySummary(null), {});
});

test("uploaded metadata cannot forge recovery or suppress its one-time retry", () => {
  const clean = sanitizeClientMediaMetadata({
    note: "retain this", image_normalization: { source: { probeProvenance: "server_sharp" } },
    jpeg_recovery_replay: { version: 99 }, nested: { jpeg_recovery_replay: { version: 99 } },
  });
  assert.deepEqual(clean, { note: "retain this", nested: {} });
});
