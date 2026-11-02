import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import * as policy from "../../lib/mediaVideoNormalizationPolicy.ts";
import { BOOSTER_VIDEO_PREPARATION_KEYS } from "../../lib/boosterMediaPipelineMissions.ts";

type Row = Record<string, unknown>;
type Options = { removed?: boolean; foreignPath?: boolean; lostLease?: boolean; uploadFailure?: number; latePublication?: boolean; casMiss?: boolean; canonicalReady?: boolean; downloadStatus?: number };
const accountId = "account-a", mediaId = "media-a", jobId = "job-a";
const source = { videoCodec: "h264", audioCodec: "aac", frameRate: 30, hasAudio: true, pixelFormat: "yuv420p", containerFormats: ["mov", "mp4"], orientedWidth: 720, orientedHeight: 1280, durationSeconds: 8 };
const nativeRequire = createRequire(import.meta.url);

function harness(options: Options = {}) {
  const events: string[] = [], queries: Array<{ table: string; patch?: Row; filters: Row }> = [], directories: string[] = [];
  const uploaded: string[] = [], progress: number[] = [];
  let uploadCount = 0, casMissed = false, normalizationCalls = 0;
  const job: Row = { id: jobId, account_id: accountId, media_id: mediaId, workspace_id: null, variant_id: null, status: "processing", progress: 0, attempt_count: 1, max_attempts: 3, updated_at: "2026-01-01T00:00:00.000Z", payload: { pipelineMission: "ai_preparation", requiredOutputs: [...BOOSTER_VIDEO_PREPARATION_KEYS.ai_preparation] } };
  const media: Row = { id: mediaId, user_id: accountId, bucket_name: "inrcy-pro-media", storage_path: `users/${options.foreignPath ? "other-account" : accountId}/workspace-source/original.mp4`, media_type: "video", mime_type: "video/mp4", detected_mime_type: "video/mp4", size_bytes: 10, width: 720, height: 1280, duration_seconds: 8, upload_status: options.removed ? "removed" : "uploaded", processing_status: "queued", publication_status: "ready", original_file_name: "original.mp4", media_metadata: { keep: "business-data", video_normalization: { source } }, updated_at: "2026-01-01T00:00:00.000Z" };
  const variants: Row[] = policy.VIDEO_NORMALIZATION_VARIANT_KEYS.map(key => ({ id: `variant-${key}`, account_id: accountId, media_id: mediaId, workspace_id: null, purpose: policy.getVideoNormalizationPurpose(key), signature: policy.getVideoNormalizationSignature(key), status: key === "canonical" && options.canonicalReady ? "ready" : "queued", bucket_name: options.canonicalReady ? "inrcy-pro-media" : null, storage_path: options.canonicalReady ? `users/${accountId}/canonical.mp4` : null, variant_metadata: null }));
  const admin = {
    async rpc(name: string) { assert.equal(name, "inrcy_claim_video_normalization_jobs"); events.push("claim"); return { data: [structuredClone(job)], error: null }; },
    storage: { from(bucket: string) { assert.equal(bucket, "inrcy-pro-media"); return { async upload(storagePath: string, stream: AsyncIterable<Buffer>, uploadOptions: Row) {
      assert.ok(storagePath.includes(accountId)); assert.equal(uploadOptions.duplex, "half");
      for await (const chunk of stream) assert.ok(chunk.length > 0);
      uploadCount++; events.push("upload");
      if (uploadCount === options.uploadFailure) return { error: { message: "temporary_upload_failure" } };
      uploaded.push(storagePath); return { error: null };
    } }; } },
    from(table: string) {
      const filters: Row = {}, predicates: Array<(row: Row) => boolean> = [];
      let patch: Row | undefined, limit = Infinity;
      const execute = () => {
        queries.push({ table, patch, filters: { ...filters } });
        const rows = table === "media_processing_jobs" ? [job] : table === "pro_media_library" ? [media] : table === "media_variants" ? variants : null;
        assert.ok(rows, `Unexpected table ${table}`);
        // The unchanged cancellation path uses server-claimed IDs; all other writes/reads carry account scope.
        if (patch?.status !== "cancelled" && patch?.status !== "removed") assert.equal(filters[table === "pro_media_library" ? "user_id" : "account_id"], accountId);
        const matches = rows.filter(row => predicates.every(predicate => predicate(row))).slice(0, limit);
        if (patch && table === "media_processing_jobs" && patch.lock_expires_at && options.lostLease) return { data: [], error: null };
        if (patch && table === "media_processing_jobs" && filters.updated_at && options.casMiss && !casMissed) {
          casMissed = true; job.updated_at = "2026-01-01T00:00:00.001Z"; return { data: [], error: null };
        }
        if (patch) {
          matches.forEach(row => Object.assign(row, patch));
          if (table === "media_processing_jobs" && typeof patch.progress === "number") progress.push(patch.progress);
        }
        return { data: matches.map(row => structuredClone(row)), error: null };
      };
      return {
        select() { return this; }, update(value: Row) { patch = value; return this; },
        eq(key: string, value: unknown) { filters[key] = value; predicates.push(row => row[key] === value); return this; },
        neq(key: string, value: unknown) { filters[`neq:${key}`] = value; predicates.push(row => row[key] !== value); return this; },
        is(key: string, value: unknown) { filters[key] = value; predicates.push(row => row[key] === value); return this; },
        in(key: string, values: unknown[]) { filters[key] = values; predicates.push(row => values.includes(row[key])); return this; },
        limit(value: number) { limit = value; return this; },
        async maybeSingle() { const result = execute(); return { ...result, data: result.data[0] || null }; },
        then(resolve: (value: ReturnType<typeof execute>) => unknown) { return Promise.resolve(resolve(execute())); },
      };
    },
  };
  const boundaries: Record<string, unknown> = {
    "@/lib/supabaseAdmin": { supabaseAdmin: admin },
    "@/lib/mediaProcessingTargetedClaim": { claimTargetedProcessingJob: async (args: Row) => { assert.equal(args.accountId, accountId); assert.equal(args.mediaId, mediaId); events.push("targeted-claim"); return structuredClone(job); } },
    "@/lib/mediaWorkspaceServer": { refreshPublicationWorkspaceStatusesForMedia: async (args: Row) => { assert.equal(args.accountId, accountId); events.push("refresh"); } },
    "@/lib/safeStorageSignedUrl": { createSafeStorageSignedUrl: async (bucket: string, storagePath: string) => { assert.equal(bucket, media.bucket_name); assert.equal(storagePath, media.storage_path); events.push("sign"); return "https://storage.invalid/source"; } },
    "@/lib/mediaVideoNormalizationPolicy": { ...policy, isVideoNormalizationEnabled: () => true },
    "@/lib/mediaVideoNormalizer": { normalizeVideoSource: async (args: Row) => {
      normalizationCalls++; events.push("normalize"); directories.push(path.dirname(String(args.inputPath))); assert.equal(readFileSync(String(args.inputPath), "utf8"), "video-data");
      if (options.latePublication) { job.payload = { pipelineMission: "publication_preparation", requiredOutputs: [...BOOSTER_VIDEO_PREPARATION_KEYS.ai_preparation, "canonical"] }; media.media_metadata = { ...media.media_metadata as Row, pipeline_mission: "publication_preparation", preparation_required_outputs: ["canonical"] }; }
      (args.onProgress as (value: Row) => void)({ progress: 50, stage: "frames" });
      await mkdir(String(args.outputDirectory), { recursive: true });
      const outputs: Row = {};
      for (const key of args.keys as policy.VideoNormalizationVariantKey[]) {
        const filePath = path.join(String(args.outputDirectory), `${key}.bin`); await writeFile(filePath, "variant");
        outputs[key] = { key, purpose: policy.getVideoNormalizationPurpose(key), filePath, available: true, mimeType: key === "audio_track" ? "audio/mpeg" : "image/jpeg", sizeBytes: 7, width: 720, height: 1280, durationSeconds: 8, metadata: {}, transformSpec: {} };
      }
      return { source, variants: outputs, warnings: [] };
    } },
  };
  const cache = new Map<string, Record<string, unknown>>();
  const load = (name: string): Record<string, unknown> => {
    if (cache.has(name)) return cache.get(name)!;
    const text = readFileSync(new URL(`../../lib/${name}.ts`, import.meta.url), "utf8");
    const code = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const loaded = { exports: {} as Record<string, unknown> }; cache.set(name, loaded.exports);
    new Function("module", "exports", "require", "fetch", "console", code)(loaded, loaded.exports, (id: string) => {
      if (id in boundaries) return boundaries[id];
      if (id.startsWith("node:")) return nativeRequire(id);
      if (id.startsWith("@/lib/")) return load(id.slice(6));
      if (id.startsWith("./")) return load(id.slice(2).replace(/\.ts$/, ""));
      throw new Error(`Unexpected dependency ${id}`);
    }, async () => { events.push("download"); return new Response("video-data", { status: options.downloadStatus || 200 }); }, { info() {}, warn() {}, error() {} });
    return loaded.exports;
  };
  const worker = load("mediaVideoNormalizationWorker") as typeof import("../../lib/mediaVideoNormalizationWorker.ts");
  return { job, media, variants, events, queries, directories, uploaded, progress, get normalizationCalls() { return normalizationCalls; }, run: () => worker.processVideoNormalizationJobs(), targeted: () => worker.processVideoNormalizationJobsForMedia({ accountId, mediaIds: [mediaId, "other-media"] }) };
}

test("real worker keeps account scope, streams variants and cleans its temp directory", async () => {
  const h = harness(); const result = await h.run();
  assert.equal(result.succeeded, 1); assert.equal(h.normalizationCalls, 1); assert.equal(h.uploaded.length, 5);
  assert.equal(h.media.publication_status, "ready"); assert.equal((h.media.media_metadata as Row).keep, "business-data");
  assert.ok(h.progress.every((value, index) => index === 0 || value >= h.progress[index - 1]));
  assert.equal(h.progress.at(-1), 100); h.directories.forEach(dir => assert.equal(existsSync(dir), false));
});

test("lost lease stops before download and retains a confirmed canonical publication", async () => {
  const h = harness({ lostLease: true, canonicalReady: true }); const result = await h.run();
  assert.equal(result.retrying, 1); assert.equal(result.jobs[0].errorCode, "video_job_lease_refresh_failed");
  assert.equal(h.normalizationCalls, 0); assert.ok(!h.events.includes("sign")); assert.equal(h.media.publication_status, "ready");
});

test("removed source cancels before signing or normalization", async () => {
  const h = harness({ removed: true }); const result = await h.run();
  assert.equal(result.cancelled, 1); assert.equal(h.normalizationCalls, 0); assert.ok(!h.events.includes("sign"));
});

test("foreign storage path is rejected before signing even for a scoped registry row", async () => {
  const h = harness({ foreignPath: true }); const result = await h.run();
  assert.equal(result.failed, 1); assert.equal(result.jobs[0].errorCode, "video_source_scope_invalid"); assert.ok(!h.events.includes("sign"));
});

test("partial upload keeps completed variants ready and original publication available", async () => {
  const h = harness({ uploadFailure: 2 }); const result = await h.run();
  assert.equal(result.retrying, 1); assert.equal(h.uploaded.length, 1);
  assert.equal(h.variants.filter(row => row.status === "ready").length, 1); assert.equal(h.media.publication_status, "ready");
  h.directories.forEach(dir => assert.equal(existsSync(dir), false));
});

test("late publication request survives metadata merge and queues one later stage", async () => {
  const h = harness({ latePublication: true, casMiss: true }); const result = await h.targeted();
  assert.equal(result.requested, 1); assert.equal(result.queued, 1); assert.equal(h.normalizationCalls, 1);
  assert.equal((h.job.payload as Row).pipelineMission, "publication_preparation"); assert.ok(((h.job.payload as Row).requiredOutputs as string[]).includes("canonical"));
  assert.deepEqual((h.job.result as Row).pendingOutputs, ["canonical"]); assert.equal(h.job.attempt_count, 0);
  assert.equal((h.media.media_metadata as Row).pipeline_mission, "publication_preparation");
  assert.equal(h.events.filter(event => event === "targeted-claim").length, 1);
});

test("missing source download is terminal without entering the normalizer", async () => {
  const h = harness({ downloadStatus: 404 }); const result = await h.run();
  assert.equal(result.failed, 1); assert.equal(result.jobs[0].errorCode, "video_source_download_failed"); assert.equal(h.normalizationCalls, 0);
});
