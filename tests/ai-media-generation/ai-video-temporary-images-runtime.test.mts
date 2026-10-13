import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as timeline from "../../lib/aiMediaVideoTimeline.ts";

type StoreFactory = typeof import("../../lib/aiMediaVideoTemporaryImages.ts").createAiMediaVideoTemporaryImageStore;
type Preflight = typeof import("../../lib/aiMediaVideoTemporaryImages.ts").preflightAiMediaVideoTemporaryImages;
const nativeRequire = createRequire(import.meta.url);
const source = readFileSync(path.join(process.cwd(), "lib/aiMediaVideoTemporaryImages.ts"), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const commonJsModule = { exports: {} };
const factory = vm.runInThisContext(`(function(exports,require,module){${javascript}\n})`);
factory(commonJsModule.exports, (id: string) => {
  if (id === "server-only") return {};
  if (id === "@/lib/supabaseAdmin") return { supabaseAdmin: { get storage() { throw new Error("real_storage_forbidden_in_test"); } } };
  if (id === "./aiMediaVideoTimeline.ts") return timeline;
  if (id.startsWith("node:")) return nativeRequire(id);
  throw new Error(`unexpected_dependency:${id}`);
}, commonJsModule);
const createStore = (commonJsModule.exports as { createAiMediaVideoTemporaryImageStore: StoreFactory }).createAiMediaVideoTemporaryImageStore;
const preflight = (commonJsModule.exports as { preflightAiMediaVideoTemporaryImages: Preflight }).preflightAiMediaVideoTemporaryImages;

function fakeStorage(mode: "success" | "public" | "upload-failed" | "sign-failed" | "cleanup-failed" | "upload-threw" = "success") {
  const uploads: { path: string; body: Uint8Array; options: { upsert: boolean; contentType: string; cacheControl: string } }[] = [];
  const signed: { path: string; seconds: number }[] = [];
  const removed: string[][] = [];
  const buckets: string[] = [];
  const storage = {
    async getBucket(bucket: string) { buckets.push(bucket); return { data: { public: mode === "public" }, error: null }; },
    from(bucket: string) {
      assert.equal(bucket, "inrcy-pro-media");
      return {
        async upload(path: string, body: Uint8Array, options: { upsert: boolean; contentType: string; cacheControl: string }) {
          uploads.push({ path, body, options });
          if (mode === "upload-threw") throw new Error("https://storage.example.com/path?token=secret");
          return { error: mode === "upload-failed" ? new Error("secret upload diagnostic") : null };
        },
        async createSignedUrl(path: string, seconds: number) {
          signed.push({ path, seconds });
          return { data: mode === "sign-failed" ? null : { signedUrl: `https://storage.example.com/storage/v1/object/sign/inrcy-pro-media/${path}?token=secret` }, error: null };
        },
        async remove(paths: string[]) { removed.push(paths); return { error: mode === "cleanup-failed" ? new Error("signed URL secret") : null }; },
      };
    },
  };
  return { storage, uploads, signed, removed, buckets };
}
const image = { mimeType: "image/jpeg" as const, data: Buffer.from("sanitized-image-bytes").toString("base64") };

test("storage preflight reads bucket privacy without uploading for original references or a future continuation frame", async () => {
  for (const engine of ["minimax-h3", "wan-flash"] as const) {
    const mock = fakeStorage();
    await preflight({ accountId: "account-test", storage: mock.storage, request: {
      videoEngine: engine, videoResolution: engine === "minimax-h3" ? "768p" : "720p",
      durationSeconds: 30, sceneMode: "single", inspirationImages: engine === "wan-flash" ? [image] : [],
    } });
    assert.equal(mock.buckets.length, 1);
    assert.equal(mock.uploads.length, 0); assert.equal(mock.signed.length, 0); assert.equal(mock.removed.length, 0);
  }
  const publicBucket = fakeStorage("public");
  await assert.rejects(preflight({ accountId: "account-test", storage: publicBucket.storage, request: {
    videoEngine: "minimax-h3", durationSeconds: 30, sceneMode: "single", inspirationImages: [],
  } }), /private_bucket_required/);
  assert.equal(publicBucket.uploads.length, 0);
});

test("storage preflight does not access Storage for an inline provider or a text-only H3 film with independent scenes", async () => {
  for (const request of [
    { videoEngine: "grok-lite" as const, durationSeconds: 30, sceneMode: "single" as const, inspirationImages: [image] },
    { videoEngine: "minimax-h3" as const, durationSeconds: 30, sceneMode: "multi" as const, inspirationImages: [] },
    { videoEngine: "minimax-h3" as const, durationSeconds: 8, sceneMode: "single" as const, inspirationImages: [] },
  ]) await preflight({ accountId: "account-test", request });
});

test("hosted provider images use only a private bucket, unique account-scoped paths and thirty-minute signed URLs", async () => {
  const mock = fakeStorage();
  const store = createStore({ accountId: "account-test", storage: mock.storage });
  const first = await store.uploadImages([image, image]);
  const second = await store.uploadImages([image]);
  assert.equal(first.length, 2); assert.equal(second.length, 1);
  assert.equal(mock.buckets.length, 1);
  assert.equal(new Set(mock.uploads.map((entry) => entry.path)).size, 3);
  for (const entry of mock.uploads) {
    assert.match(entry.path, /^account-test\/_provider-temp\/[0-9a-f-]{36}\/[0-9]+\.jpg$/);
    assert.deepEqual(entry.options, { contentType: "image/jpeg", cacheControl: "0", upsert: false });
    assert.deepEqual(entry.body, Buffer.from("sanitized-image-bytes"));
  }
  assert.ok(mock.signed.every((entry) => entry.seconds === 1800));
  await store.cleanup(); await store.cleanup();
  assert.equal(mock.removed.length, 1);
  assert.deepEqual(mock.removed[0], mock.uploads.map((entry) => entry.path));
});

test("a thrown transport error is replaced with a fixed storage failure code", async () => {
  const mock = fakeStorage("upload-threw");
  const store = createStore({ accountId: "account-test", storage: mock.storage });
  await assert.rejects(store.uploadImages([image]), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, "ai_video_input_storage_upload_failed");
    assert.equal(error.cause, undefined);
    return true;
  });
});

test("public storage, invalid account paths and non-image bytes fail before creating provider inputs", async () => {
  const mock = fakeStorage("public");
  assert.throws(() => createStore({ accountId: "../other-account", storage: mock.storage }), /account_invalid/);
  const store = createStore({ accountId: "account-test", storage: mock.storage });
  await assert.rejects(store.uploadImages([image]), /private_bucket_required/);
  assert.equal(mock.uploads.length, 0);
  await assert.rejects(store.uploadImages([{ ...image, mimeType: "text/html" }]), /image_invalid/);
  await assert.rejects(store.uploadImages([{ ...image, data: "" }]), /image_invalid/);
});

test("an image that uploaded but failed signing is removed and raw Storage diagnostics never escape", async () => {
  const mock = fakeStorage("sign-failed");
  const store = createStore({ accountId: "account-test", storage: mock.storage });
  await assert.rejects(store.uploadImages([image]), /ai_video_input_storage_sign_failed/);
  await store.cleanup();
  assert.equal(mock.uploads.length, 1);
  assert.deepEqual(mock.removed[0], [mock.uploads[0].path]);
});

test("cancellation before upload produces no object and cleanup errors use a fixed warning without URLs", async () => {
  const cancelled = fakeStorage();
  const signal = AbortSignal.abort(new Error("cancelled"));
  const abortedStore = createStore({ accountId: "account-test", storage: cancelled.storage, signal });
  await assert.rejects(abortedStore.uploadImages([image]), /cancelled/);
  assert.equal(cancelled.uploads.length, 0);
  const failed = fakeStorage("cleanup-failed");
  const warnings: string[] = [];
  const store = createStore({ accountId: "account-test", storage: failed.storage, warn: (code) => warnings.push(code) });
  await store.uploadImages([image]);
  await store.cleanup();
  assert.deepEqual(warnings, ["ai_video_input_storage_cleanup_unavailable"]);
});
