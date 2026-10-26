import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { AI_MEDIA_INSPIRATION_MAX_IMAGE_BASE64_CHARS, AI_MEDIA_INSPIRATION_SOURCE_MAX_BYTES, resolveAiMediaPreviewFormat } from "../../lib/aiMediaGenerationContracts.ts";
import type * as MediaSource from "../../lib/inrAssistantMediaSource.ts";

const accountId = "10000000-0000-4000-8000-000000000001";
const mediaId = "20000000-0000-4000-8000-000000000001";
const source = { id: mediaId, user_id: accountId, media_type: "image", mime_type: "image/png", size_bytes: 128,
  bucket_name: "inrcy-pro-media", storage_path: `users/${accountId}/atelier.png`, original_file_name: "atelier.png", is_active: true, source: "manual_upload" };
type Options = { row?: Record<string, unknown> | null; dbError?: boolean; authError?: boolean; hang?: "db" | "download" | "read" | "normalize";
  downloadError?: boolean; empty?: boolean; tooLarge?: boolean; previewTooLarge?: boolean };

function harness(options: Options = {}) {
  const scopes: unknown[][] = [], storage: unknown[][] = [], timers = new Set<ReturnType<typeof setTimeout>>();
  let cancelled = 0, normalizations = 0, dbSignal: AbortSignal | undefined;
  const builder = {
    select: (columns: string) => { scopes.push(["select", columns]); return builder; },
    eq: (key: string, value: unknown) => { scopes.push(["eq", key, value]); return builder; },
    abortSignal: (signal: AbortSignal) => { dbSignal = signal; return builder; },
    maybeSingle: async () => options.hang === "db" ? await new Promise<never>(() => {}) : { data: options.row === undefined ? source : options.row, error: options.dbError ? {} : null },
  };
  const stubs: Record<string, unknown> = {
    "server-only": {},
    "@/lib/requireUser": { requireUser: async () => options.authError ? { errorResponse: Response.json({}, { status: 401 }) } : {
      activeUserId: accountId,
      supabase: { from: (table: string) => { scopes.push(["from", table]); return builder; }, storage: {
        from: (bucket: string) => ({ download: (path: string) => {
          storage.push([bucket, path]);
          return { asStream: async () => {
            if (options.hang === "download") return await new Promise<never>(() => {});
            return { error: options.downloadError ? {} : null, data: new ReadableStream<Uint8Array>({
              start(controller) {
                if (options.hang === "read") return;
                if (!options.empty) controller.enqueue(options.tooLarge ? { byteLength: AI_MEDIA_INSPIRATION_SOURCE_MAX_BYTES + 1 } as Uint8Array : new Uint8Array([137, 80, 78, 71]));
                controller.close();
              }, cancel() { cancelled++; },
            }) };
          } };
        } }),
      } },
    } },
    "./aiMediaGenerationContracts.ts": { AI_MEDIA_INSPIRATION_MAX_IMAGE_BASE64_CHARS, AI_MEDIA_INSPIRATION_SOURCE_MAX_BYTES, resolveAiMediaPreviewFormat },
    "./mediaImageNormalizer.ts": { normalizeImageAiPreviewBuffer: async (input: { buffer: Buffer }) => {
      normalizations++; assert.ok(Buffer.isBuffer(input.buffer));
      if (options.hang === "normalize") return await new Promise<never>(() => {});
      return { source: { width: 1080, height: 1350 }, aiPreview: { mimeType: "image/jpeg", buffer: options.previewTooLarge ? Buffer.alloc(AI_MEDIA_INSPIRATION_MAX_IMAGE_BASE64_CHARS) : Buffer.from("normalized-preview") } };
    } },
  };
  const compiled = ts.transpileModule(readFileSync(new URL("../../lib/inrAssistantMediaSource.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const record = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, {
    Buffer, AbortController, setTimeout: (callback: () => void, ms: number) => {
      const timer = setTimeout(callback, options.hang ? 5 : ms); timers.add(timer); return timer;
    }, clearTimeout: (timer: ReturnType<typeof setTimeout>) => { timers.delete(timer); clearTimeout(timer); },
  })((id: string) => { if (!(id in stubs)) throw new Error(`Unexpected dependency ${id}`); return stubs[id]; }, record, record.exports);
  return { runtime: record.exports as typeof MediaSource, scopes, storage, timers,
    get cancelled() { return cancelled; }, get normalizations() { return normalizations; }, get dbSignal() { return dbSignal; } };
}

test("only an authenticated, scoped image becomes an internal normalized reference", async () => {
  const h = harness();
  const result = await h.runtime.loadInrAssistantImageReference(mediaId);
  assert.equal(result.format, "portrait"); assert.equal(result.width, 1080); assert.equal(result.height, 1350);
  assert.equal(result.reference.mimeType, "image/jpeg"); assert.equal(result.reference.usage, "required");
  assert.deepEqual(h.scopes.filter(row => row[0] === "eq"), [["eq", "id", mediaId], ["eq", "user_id", accountId]]);
  assert.match(String(h.scopes.find(row => row[0] === "select")?.[1]), /size_bytes/);
  assert.deepEqual(h.storage, [["inrcy-pro-media", source.storage_path]]);
  assert.doesNotMatch(JSON.stringify(result), /users\/|token|accountId|supabase|https?:/);
  assert.equal(h.timers.size, 0);
});

test("foreign, inactive, unpublished and malformed image sources never reach Storage", async () => {
  for (const row of [null, { ...source, user_id: "another-account" }, { ...source, is_active: false }, { ...source, is_active: null },
    { ...source, media_type: "video" }, { ...source, source: "ai_media_generation_draft" }, { ...source, bucket_name: "private-admin-bucket" },
    { ...source, storage_path: "users/another-account/image.png" }, { ...source, storage_path: `users/${accountId}/../private.png` },
    { ...source, storage_path: `users/${accountId}/folder\\private.png` }, { ...source, size_bytes: 0 }, { ...source, size_bytes: null },
    { ...source, size_bytes: Number.NaN }, { ...source, size_bytes: AI_MEDIA_INSPIRATION_SOURCE_MAX_BYTES + 1 }]) {
    const h = harness({ row });
    await assert.rejects(h.runtime.loadInrAssistantImageReference(mediaId), /owned_image_unavailable/);
    assert.equal(h.storage.length, 0); assert.equal(h.normalizations, 0); assert.equal(h.timers.size, 0);
  }
  for (const id of ["https://foreign.invalid/image.png", "../private", "invalid"]) {
    const h = harness(); await assert.rejects(h.runtime.loadInrAssistantImageReference(id), /invalid_media/);
    assert.equal(h.scopes.length, 0);
  }
});

test("source failures and oversized or empty streams cannot reach image normalization", async () => {
  for (const options of [{ dbError: true }, { authError: true }, { downloadError: true }, { empty: true }, { tooLarge: true }]) {
    const h = harness(options);
    await assert.rejects(h.runtime.loadInrAssistantImageReference(mediaId), /(?:owned_image_unavailable|unauthenticated_media)/);
    assert.equal(h.normalizations, 0); assert.equal(h.timers.size, 0);
  }
  const h = harness({ previewTooLarge: true });
  await assert.rejects(h.runtime.loadInrAssistantImageReference(mediaId), /image_reference_too_large/);
});

test("database, Storage, stream and normalization waits are bounded and timers cleaned", async () => {
  for (const hang of ["db", "download", "read", "normalize"] as const) {
    const h = harness({ hang });
    await assert.rejects(h.runtime.loadInrAssistantImageReference(mediaId), /owned_image_unavailable/);
    assert.equal(h.timers.size, 0);
    if (hang === "db") assert.equal(h.dbSignal?.aborted, true);
    if (hang === "read") assert.equal(h.cancelled, 1);
  }
});
