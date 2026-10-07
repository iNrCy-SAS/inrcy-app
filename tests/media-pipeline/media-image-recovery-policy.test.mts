import assert from "node:assert/strict";
import test from "node:test";
import {
  canReplayLegacyTruncatedJpeg,
  claimLegacyTruncatedJpegReplay,
  getImageRecoveryFailure,
  imageSourceRequiresCanonical,
  isCompleteSourcePreviewDownload,
  isLegacyTruncatedJpegMessage,
  mergeCompletedImageNormalizationMetadata,
  persistImageSourcePreviewMetadata,
  persistOwnedImageMediaUpdate,
} from "../../lib/mediaImageRecoveryPolicy.ts";

function legacyMedia(overrides: Record<string, unknown> = {}) {
  return {
    id: "photo", user_id: "owner", media_type: "image",
    bucket_name: "inrcy-pro-media", storage_path: "users/owner/workspace-source/photo.jpg",
    mime_type: "image/jpeg", original_file_name: "photo.jpg", upload_status: "uploaded",
    processing_status: "failed_terminal", processing_error_code: "image_worker_temporary_failure",
    processing_error_message: "VipsJpeg: premature end of JPEG image",
    media_metadata: { pipeline_mission: "publication_preparation", preserved: true },
    updated_at: "2026-10-07T10:00:00.000Z", ...overrides,
  };
}

function fakeDatabase(
  initial = legacyMedia(),
  linked = true,
  beforeUpdate?: (row: Record<string, unknown>, attempt: number) => Record<string, unknown>,
) {
  let row: Record<string, unknown> = structuredClone(initial);
  let mutations = 0;
  let updateAttempts = 0;
  type FakeQuery = {
    eq(key: string, value: unknown): FakeQuery;
    update(value: Record<string, unknown>): FakeQuery;
    select(): FakeQuery | Promise<{ data: { id: unknown }[]; error: null }>;
    maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: null }>;
  };
  const supabase = {
    from(table: string) {
      const filters: [string, unknown][] = [];
      let patch: Record<string, unknown> | null = null;
      const query: FakeQuery = {
        eq(key: string, value: unknown) { filters.push([key, value]); return query; },
        update(value: Record<string, unknown>) { patch = value; return query; },
        select() {
          if (!patch) return query;
          updateAttempts += 1;
          if (beforeUpdate) row = beforeUpdate(row, updateAttempts);
          if (filters.every(([key, value]) => row[key] === value)) {
            row = { ...row, ...structuredClone(patch), updated_at: "2026-10-07T10:01:00.000Z" };
            mutations += 1;
            return Promise.resolve({ data: [{ id: row.id }], error: null });
          }
          return Promise.resolve({ data: [], error: null });
        },
        async maybeSingle() {
          if (table === "publication_workspace_media") {
            const allowed: Record<string, string> = {
              workspace_id: "workspace", media_id: "photo", "publication_workspaces.account_id": "owner",
            };
            return { data: linked && filters.every(([key, value]) => allowed[key] === value) ? { media_id: "photo" } : null, error: null };
          }
          return { data: filters.every(([key, value]) => row[key] === value) ? structuredClone(row) : null, error: null };
        },
      };
      return query;
    },
  };
  return { supabase, row: () => row, mutations: () => mutations, updateAttempts: () => updateAttempts };
}

test("recovered image provenance always requires a derivative, including older recovery-only metadata", () => {
  assert.equal(imageSourceRequiresCanonical({ probeProvenance: "server_sharp", format: "jpeg" }), false);
  assert.equal(imageSourceRequiresCanonical({ requiresCanonical: true }), true);
  assert.equal(imageSourceRequiresCanonical({ recovery: { kind: "truncated_jpeg", requiresReview: true } }), true);
  assert.equal(imageSourceRequiresCanonical(null), false);
});

test("legacy replay recognizes the actual failure including compacted libvips lines, never unrelated errors", () => {
  const message = "VipsJpeg: premature end of JPEG image";
  assert.equal(isLegacyTruncatedJpegMessage(`${message}\n${message}`), true);
  assert.equal(isLegacyTruncatedJpegMessage(`${message} ${message}`), true);
  assert.equal(canReplayLegacyTruncatedJpeg(legacyMedia()), true);
  for (const patch of [
    { processing_status: "failed_retryable" }, { media_type: "video" },
    { upload_status: "removed" }, { processing_error_code: "image_recovery_failed" },
    { processing_error_message: "network timeout" },
    { processing_error_message: `${message}\ninsufficient memory` },
    { bucket_name: "unrelated" }, { storage_path: "users/another/workspace-source/photo.jpg" },
    { mime_type: "image/png", original_file_name: "photo.png" },
    { media_metadata: { jpeg_recovery_replay: { version: 1 } } },
  ]) assert.equal(canReplayLegacyTruncatedJpeg(legacyMedia(patch)), false, JSON.stringify(patch));
});

test("unrecoverable JPEG errors have stable terminal codes and actionable messages", () => {
  for (const error of [new Error("image_recovery_failed"), new Error("VipsJpeg: premature end of JPEG image")]) {
    const failure = getImageRecoveryFailure(error);
    assert.equal(failure?.code, "image_recovery_failed");
    assert.match(failure?.message || "", /original complet/);
  }
  assert.equal(getImageRecoveryFailure({ code: "image_recovery_source_too_large" })?.code, "image_recovery_source_too_large");
  assert.equal(getImageRecoveryFailure(new Error("fetch failed")), null);
});

test("legacy replay atomically claims once, preserves metadata and leaves a durable preparation intent", async () => {
  const db = fakeDatabase();
  const args = { supabase: db.supabase, accountId: "owner", mediaId: "photo", workspaceId: "workspace" };
  const results = await Promise.all([claimLegacyTruncatedJpegReplay(args), claimLegacyTruncatedJpegReplay(args)]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(db.mutations(), 1);
  assert.equal(db.row().processing_status, "not_requested");
  assert.equal(db.row().processing_error_code, null);
  const metadata = db.row().media_metadata as Record<string, unknown>;
  assert.equal(metadata.preserved, true);
  assert.equal(metadata.pipeline_mission, "publication_preparation");
  assert.equal((metadata.jpeg_recovery_replay as { version: number }).version, 1);
  assert.equal(await claimLegacyTruncatedJpegReplay(args), false);
  assert.equal(canReplayLegacyTruncatedJpeg({ ...db.row(), processing_status: "failed_terminal", processing_error_code: "image_worker_temporary_failure", processing_error_message: "VipsJpeg: premature end of JPEG image" }), false);
});

test("replay refuses another account, an unrelated workspace or a missing association", async () => {
  for (const [accountId, workspaceId, linked] of [
    ["other", "workspace", true], ["owner", "other", true], ["owner", "workspace", false],
  ] as const) {
    const db = fakeDatabase(legacyMedia(), linked);
    assert.equal(await claimLegacyTruncatedJpegReplay({ supabase: db.supabase, accountId, workspaceId, mediaId: "photo" }), false);
    assert.equal(db.mutations(), 0);
  }
});

test("source preview rejects partial responses and byte mismatch before decoding", () => {
  const complete = { status: 200, contentRange: null, expectedBytes: 854475, actualBytes: 854475 };
  assert.equal(isCompleteSourcePreviewDownload(complete), true);
  for (const patch of [
    { status: 206 }, { status: 500 }, { contentRange: "bytes 0-99/854475" },
    { actualBytes: 854474 }, { actualBytes: 854476 }, { expectedBytes: 0 },
  ]) assert.equal(isCompleteSourcePreviewDownload({ ...complete, ...patch }), false);
});

test("source preview retries a concurrent worker update and preserves its proof, variants and original dimensions", async () => {
  const recoveredSource = {
    probeProvenance: "server_sharp", width: 1220, height: 1641,
    recovery: { kind: "truncated_jpeg", version: 1, requiresReview: true }, requiresCanonical: true,
  };
  const workerSource = { ...recoveredSource, decoder: "sharp", workerMarker: true };
  const workerMetadata = {
    image_normalization: { source: workerSource, variants: { canonical: { ready: true } }, completed_at: "worker-time" },
    preserved: "worker-value",
  };
  const db = fakeDatabase(legacyMedia(), true, (row, attempt) => attempt === 1 ? {
    ...row, updated_at: "worker-time", media_metadata: workerMetadata,
  } : row);
  const persisted = await persistImageSourcePreviewMetadata({
    supabase: db.supabase, accountId: "owner", mediaId: "photo",
    source: { ...recoveredSource, width: 480, height: 646 },
    thumbnail: { storage_path: "thumbnail.jpg" },
  });
  assert.equal(db.updateAttempts(), 2);
  assert.equal(db.mutations(), 1);
  assert.equal(persisted.preserved, "worker-value");
  assert.deepEqual(persisted.image_normalization, workerMetadata.image_normalization);
  assert.deepEqual(persisted.source_interface_thumbnail, { storage_path: "thumbnail.jpg" });
  assert.equal(db.row().width, 1220);
  assert.equal(db.row().height, 1641);

  const fromCanonical = await persistImageSourcePreviewMetadata({
    supabase: db.supabase, accountId: "owner", mediaId: "photo",
    source: { probeProvenance: "server_sharp", width: 480, height: 646 },
    thumbnail: { storage_path: "thumbnail-from-canonical.jpg" },
  });
  assert.deepEqual(fromCanonical.image_normalization, workerMetadata.image_normalization);
  assert.equal(db.row().width, 1220);
});

test("source preview persists new recovery proof and bounds conflicts without overwriting another account", async () => {
  const source = { width: 1220, height: 1641, requiresCanonical: true, recovery: { kind: "truncated_jpeg" } };
  const db = fakeDatabase();
  const args = { accountId: "owner", mediaId: "photo", source, thumbnail: { ready: true } };
  const saved = await persistImageSourcePreviewMetadata({ ...args, supabase: db.supabase });
  assert.deepEqual((saved.image_normalization as Record<string, unknown>).source, source);
  assert.equal(saved.preserved, true);
  await assert.rejects(persistImageSourcePreviewMetadata({ ...args, accountId: "other", supabase: db.supabase }), /source_preview_media_missing/);
  assert.equal(db.mutations(), 1);

  const busy = fakeDatabase(legacyMedia(), true, (row, attempt) => ({ ...row, updated_at: `conflict-${attempt}` }));
  await assert.rejects(persistImageSourcePreviewMetadata({ ...args, supabase: busy.supabase }), /source_preview_metadata_changed/);
  assert.equal(busy.updateAttempts(), 3);
  assert.equal(busy.mutations(), 0);
});

test("queued mission metadata cannot overwrite recovery proof committed after its read", async () => {
  const workerMetadata = {
    image_normalization: { source: { requiresCanonical: true, recovery: { kind: "truncated_jpeg" } } },
    jpeg_recovery_replay: { version: 1 },
  };
  const db = fakeDatabase(legacyMedia(), true, (row, attempt) => attempt === 1 ? {
    ...row, updated_at: "worker-commit", media_metadata: workerMetadata,
  } : row);
  const metadata = await persistOwnedImageMediaUpdate({
    supabase: db.supabase, accountId: "owner", mediaId: "photo",
    buildPatch: (current) => ({ media_metadata: {
      ...current.media_metadata as Record<string, unknown>, pipeline_mission: "publication_preparation",
    } }),
  });
  assert.equal(db.updateAttempts(), 2);
  assert.deepEqual(metadata.image_normalization, workerMetadata.image_normalization);
  assert.deepEqual(metadata.jpeg_recovery_replay, { version: 1 });
  assert.equal(metadata.pipeline_mission, "publication_preparation");
});

test("worker completion with canonical already ready preserves recovery through a concurrent metadata update", async () => {
  const proof = { probeProvenance: "server_sharp", width: 1220, height: 1641, requiresCanonical: true, recovery: { kind: "truncated_jpeg", version: 1, requiresReview: true } };
  const workerMetadata = {
    image_normalization: { source: proof, variants: { thumbnail: { ready: true } } },
    source_interface_thumbnail: { ready: true }, jpeg_recovery_replay: { version: 1 },
  };
  const db = fakeDatabase(legacyMedia(), true, (row, attempt) => attempt === 1 ? {
    ...row, updated_at: "preview-commit", media_metadata: workerMetadata,
  } : row);
  const completion = {
    source: { probeProvenance: "server_sharp", width: 1220, height: 1641 },
    variants: { canonical: { ready: true } }, sourceDecoded: false,
    pipelineVersion: 1, mission: "publication_preparation", completedAt: "completion-time",
  };
  const metadata = await persistOwnedImageMediaUpdate({
    supabase: db.supabase, accountId: "owner", mediaId: "photo",
    buildPatch: (current) => ({ media_metadata: mergeCompletedImageNormalizationMetadata({ ...completion, metadata: current.media_metadata }) }),
  });
  assert.equal(db.updateAttempts(), 2);
  const normalization = metadata.image_normalization as Record<string, unknown>;
  assert.deepEqual(normalization.source, proof);
  assert.deepEqual(normalization.variants, { thumbnail: { ready: true }, canonical: { ready: true } });
  assert.deepEqual(metadata.jpeg_recovery_replay, { version: 1 });
  assert.deepEqual(metadata.source_interface_thumbnail, { ready: true });

  const noPreviousProof = mergeCompletedImageNormalizationMetadata({ ...completion, metadata: {} });
  assert.equal(imageSourceRequiresCanonical((noPreviousProof.image_normalization as Record<string, unknown>).source), true);
  const canonicalDecode = mergeCompletedImageNormalizationMetadata({ ...completion, metadata, sourceDecoded: true });
  assert.deepEqual((canonicalDecode.image_normalization as Record<string, unknown>).source, proof);
});
