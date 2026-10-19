import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import test from "node:test";
import ts from "typescript";
import * as audio from "../../lib/mediaLibraryAudio.ts";
import { wav } from "../ai-media-generation/character-voice-runtime-fixtures.mts";

const nativeRequire = createRequire(import.meta.url);
const ACCOUNT = "account-test";
const PATH = `users/${ACCOUNT}/audio/2026/library-sample.wav`;
function load<T>(filename: string, dependencies: Record<string, unknown>): T {
  const source = readFileSync(new URL(`../../${filename}`, import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const record = { exports: {} };
  new Function("module", "exports", "require", javascript)(record, record.exports, (name: string) => {
    if (name in dependencies) return dependencies[name];
    if (name === "server-only") return {};
    if (name === "./mediaLibraryAudio.ts" || name === "@/lib/mediaLibraryAudio") return audio;
    if (name.startsWith("node:") || name === "crypto") return nativeRequire(name);
    throw new Error(`unexpected_dependency:${name}`);
  });
  return record.exports as T;
}

function validationRuntime(duration = 2) {
  const calls: { args: string[]; options: Record<string, unknown> }[] = [];
  const exec = Object.assign(() => { throw new Error("unexpected_direct_exec"); }, {
    [promisify.custom]: async (_binary: string, args: string[], options: Record<string, unknown>) => {
      calls.push({ args, options });
      return { stdout: Buffer.alloc(duration * 16_000), stderr: Buffer.alloc(0) };
    },
  });
  const runtime = load<typeof import("../../lib/mediaLibraryAudioValidation.ts")>("lib/mediaLibraryAudioValidation.ts", {
    "node:child_process": { execFile: exec }, "@/lib/mediaVideoNormalizer": { resolveVideoNormalizationFfmpegPath: async () => "unit-test-ffmpeg" },
  });
  return { runtime, calls };
}

test("MP3/WAV recognition belongs only to the media library and is bounded to 3 MiB", () => {
  assert.equal(audio.MEDIA_LIBRARY_AUDIO_MAX_BYTES, 3 * 1024 * 1024);
  assert.equal(audio.MEDIA_LIBRARY_AUDIO_MAX_DURATION_SECONDS, 300);
  for (const mimeType of ["audio/wav", "audio/x-wav", "audio/wave"]) assert.equal(audio.getMediaLibraryAudioContentType({ name: "vocal.wav", mimeType }), "audio/wav");
  assert.equal(audio.detectMediaLibraryAudioType({ name: "sample.mp3", mimeType: "" }), "audio");
  assert.equal(audio.getMediaLibraryAudioExtension({ name: "sample.mp3", mimeType: "audio/mpeg" }), "mp3");
  assert.equal(audio.detectMediaLibraryAudioType({ name: "sample.mp3", mimeType: "image/png" }), null);
  assert.equal(audio.isOwnedMediaLibraryAudioPath(ACCOUNT, PATH), true);
  for (const path of [PATH.replace(ACCOUNT, "another-account"), PATH.replace("/audio/", "/video/"), PATH.replace("library-sample", "../library-sample")]) assert.equal(audio.isOwnedMediaLibraryAudioPath(ACCOUNT, path), false);
});

test("server audio validation rejects false bytes and caps decoding and duration independently of client claims", async () => {
  const { runtime, calls } = validationRuntime();
  await assert.rejects(runtime.validateMediaLibraryAudioBuffer({ buffer: Buffer.from("not audio"), mimeType: "audio/wav" }), /format_invalid/);
  await assert.rejects(runtime.validateMediaLibraryAudioBuffer({ buffer: Buffer.alloc(audio.MEDIA_LIBRARY_AUDIO_MAX_BYTES + 1), mimeType: "audio/wav" }), /size_invalid/);
  assert.equal(calls.length, 0);
  const result = await runtime.validateMediaLibraryAudioBuffer({ buffer: wav(), mimeType: "audio/wav" });
  assert.equal(result.durationSeconds, 2); assert.equal(result.mimeType, "audio/wav");
  assert.ok(calls[0].args.includes("file,pipe")); assert.ok(calls[0].args.includes("301")); assert.ok(calls[0].args.includes("0:a:0"));
  assert.equal(calls[0].options.timeout, 20_000); assert.equal(calls[0].options.maxBuffer, 5 * 1024 * 1024);
  await assert.rejects(validationRuntime(301).runtime.validateMediaLibraryAudioBuffer({ buffer: wav(), mimeType: "audio/wav" }), /duration_invalid/);
});

test("permanent audio saves an account-owned private object and rolls back its new file if row insertion fails", async () => {
  const validator = validationRuntime().runtime;
  const runtime = load<typeof import("../../lib/mediaLibraryAudioStorage.ts")>("lib/mediaLibraryAudioStorage.ts", {
    "@/lib/supabaseAdmin": { supabaseAdmin: {} }, "./mediaLibraryAudioValidation.ts": validator,
  });
  for (const failInsert of [false, true]) {
    const uploads: string[] = []; const removes: string[][] = []; const rows: Record<string, unknown>[] = [];
    const storage = { getBucket: async () => ({ data: { public: false }, error: null }), from: () => ({
      upload: async (path: string) => { uploads.push(path); return { error: null }; }, remove: async (paths: string[]) => { removes.push(paths); return { error: null }; },
    }) };
    const database = { from: (table: string) => { assert.equal(table, "pro_media_library"); return { insert: (row: Record<string, unknown>) => {
      rows.push(row); return { select: () => ({ single: async () => ({ data: failInsert ? null : { id: "library-id", storage_path: String(row.storage_path) }, error: failInsert ? { message: "private diagnostic" } : null }) }) };
    } }; } };
    const pending = runtime.saveMediaLibraryAudio({ accountId: ACCOUNT, name: "vocal.wav", buffer: wav(), mimeType: "audio/wav", durationSeconds: 2, storage, database });
    if (failInsert) { await assert.rejects(pending, /^Error: media_library_audio_save_failed$/); assert.deepEqual(removes, [[uploads[0]]]); }
    else { const saved = await pending; assert.equal(saved.id, "library-id"); assert.equal(audio.isOwnedMediaLibraryAudioPath(ACCOUNT, saved.storagePath), true); assert.deepEqual(removes, []); }
    assert.equal(rows[0].user_id, ACCOUNT); assert.equal(rows[0].media_type, "audio"); assert.equal(rows[0].duration_seconds, 2); assert.equal(rows[0].width, null);
  }
  await assert.rejects(runtime.saveMediaLibraryAudio({ accountId: "../other", name: "a.wav", buffer: wav(), mimeType: "audio/wav", durationSeconds: 2 }), /account_invalid/);
  await assert.rejects(runtime.saveMediaLibraryAudio({ accountId: ACCOUNT, name: "a.wav", buffer: Buffer.from("bad"), mimeType: "audio/wav", durationSeconds: 2 }), /format_invalid/);
});

const next = { NextResponse: { json: (body: unknown, options?: ResponseInit) => Response.json(body, options) } };
const auth = { requireUser: async () => ({ user: { id: "auth-user" }, activeUserId: ACCOUNT, errorResponse: null }) };

test("library audio finalization derives duration from validated bytes and never invokes visual normalization", async () => {
  const inserted: Record<string, unknown>[] = []; const removed: string[][] = []; let validated = 0;
  const client = { storage: { getBucket: async () => ({ data: { public: false }, error: null }), from: () => ({
    download: async () => ({ data: new Blob([new Uint8Array(wav())]), error: null }), remove: async (paths: string[]) => { removed.push(paths); return { error: null }; },
    createSignedUploadUrl: async () => ({ data: { token: "test-token", signedUrl: "https://storage.invalid/upload" }, error: null }),
  }) }, from: () => ({ insert: (row: Record<string, unknown>) => { inserted.push(row); return { select: () => ({ single: async () => ({ data: { id: "library-id", storage_path: PATH }, error: null }) }) }; } }) };
  const runtime = load<{ POST: (request: Request) => Promise<Response> }>("app/api/media-library/upload/route.ts", {
    "next/server": next, "@/lib/requireUser": auth, "@/lib/supabaseAdmin": { supabaseAdmin: client },
    "@/lib/mediaLibraryContentUrl": { buildMediaLibraryContentUrl: (id: string) => `/content/${id}` },
    "@/lib/mediaClientMetadata": { sanitizeClientMediaMetadata: (value: unknown) => value },
    "@/lib/mediaStoredUploadIntegrity": { verifyMediaLibraryStoredUpload: async () => true },
    "@/lib/mediaImageNormalizationQueue": { enqueueImageNormalization: async () => { throw new Error("visual_pipeline_must_not_run"); } },
    "@/lib/mediaImageNormalizationWorker": { processImageNormalizationJobsForMedia: async () => { throw new Error("visual_pipeline_must_not_run"); } },
    "@/lib/supabaseStorageUpload": { createSignedUploadUrlWithRetry: (operation: () => unknown) => operation() },
    "@/lib/mediaRules": { INR_MEDIA_UPLOAD_BATCH_SIZE: 30 }, "@/lib/mediaLibraryOptimizationPolicy": { MEDIA_LIBRARY_IMAGE_SOURCE_MAX_BYTES: 300_000_000, MEDIA_LIBRARY_VIDEO_SOURCE_MAX_BYTES: 300_000_000 },
    "@/lib/mediaUploadPolicy": { detectUniversalUploadMediaType: () => null, getUniversalMediaContentType: () => { throw new Error("visual_policy_must_not_run"); }, getUniversalMediaSafeExtension: () => { throw new Error("visual_policy_must_not_run"); } },
    "@/lib/mediaLibraryAudioValidation": { validateMediaLibraryAudioBuffer: async ({ buffer }: { buffer: Buffer }) => { validated++; assert.deepEqual(buffer, wav()); return { mimeType: "audio/wav", durationSeconds: 2 }; } },
  });
  const prepare = await runtime.POST(new Request("https://app.invalid/api/media-library/upload", { method: "POST", body: JSON.stringify({ mode: "prepare", files: [{ name: "vocal.wav", type: "audio/wav", size: wav().length }] }) }));
  const prepared = await prepare.json(); assert.equal(prepared.items[0].media_type, "audio"); assert.equal(prepared.items[0].content_type, "audio/wav");
  assert.equal(audio.isOwnedMediaLibraryAudioPath(ACCOUNT, prepared.items[0].storage_path), true);
  const response = await runtime.POST(new Request("https://app.invalid/api/media-library/upload", { method: "POST", body: JSON.stringify({ mode: "finalize", uploads: [{ original_name: "vocal.wav", storage_path: PATH, mime_type: "audio/wav", size_bytes: wav().length, duration_seconds: 999, width: 999, height: 999 }] }) }));
  assert.equal((await response.json()).uploaded, 1); assert.equal(validated, 1); assert.equal(inserted[0].duration_seconds, 2); assert.equal(inserted[0].width, null); assert.equal(inserted[0].height, null); assert.deepEqual(removed, []);
  const invalidPath = await runtime.POST(new Request("https://app.invalid/api/media-library/upload", { method: "POST", body: JSON.stringify({ mode: "finalize", uploads: [{ original_name: "vocal.wav", storage_path: PATH.replace("/audio/", "/video/"), mime_type: "audio/wav", size_bytes: wav().length }] }) }));
  assert.equal((await invalidPath.json()).uploaded, 0); assert.equal(validated, 1); assert.deepEqual(removed, [], "an invalid audio path must not delete an existing visual asset");
});

test("default library lists stay visual, while the main library explicitly opts into Audio", async () => {
  const rows = [{ id: "audio-id", user_id: ACCOUNT, media_type: "audio", duration_seconds: 2, size_bytes: 100 }, { id: "image-id", user_id: ACCOUNT, media_type: "image", size_bytes: 200 }];
  const queries: Array<{ column: string; values: unknown }> = [];
  const client = { from: (table: string) => {
    const filters: Array<(row: Record<string, unknown>) => boolean> = [];
    const builder = { select: () => builder, order: () => builder, limit: () => builder, neq: () => builder,
      eq: (column: string, value: unknown) => { if (table === "pro_media_library") { queries.push({ column, values: value }); if (column === "media_type" || column === "user_id") filters.push((row) => row[column] === value); } return builder; },
      in: (column: string, values: unknown[]) => { if (table === "pro_media_library") { queries.push({ column, values }); filters.push((row) => values.includes(row[column])); } return builder; },
      then: (resolve: (value: unknown) => unknown) => resolve({ data: table === "pro_media_library" ? rows.filter((row) => filters.every((filter) => filter(row))) : [], error: null }),
    }; return builder;
  } };
  const runtime = load<{ GET: (request: Request) => Promise<Response> }>("app/api/media-library/items/route.ts", {
    "next/server": next, "@/lib/requireUser": auth, "@/lib/supabaseAdmin": { supabaseAdmin: client },
    "@/lib/mediaLibraryContentUrl": { buildMediaLibraryContentUrl: (id: string) => `/content/${id}` },
    "@/lib/mediaImageRecoverySummary": { getMediaImageRecoverySummary: () => ({}) }, "@/lib/inrAgentVideoContextCache": {},
    "@/lib/mediaLibraryOptimizationPolicy": { MEDIA_LIBRARY_OPTIMIZATION_JOB_TYPES: [] },
    "@/lib/mediaMetadataTransfer": { normalizeTransferredMediaMetadata: (row: { duration_seconds?: number }) => ({ width: null, height: null, durationSeconds: row.duration_seconds || null }) },
  });
  assert.deepEqual((await (await runtime.GET(new Request("https://app.invalid/items?type=all"))).json()).items.map((row: { media_type: string }) => row.media_type), ["image"]);
  const optedIn = await (await runtime.GET(new Request("https://app.invalid/items?type=all&includeAudio=true"))).json();
  assert.equal(optedIn.items.length, 2); assert.equal(optedIn.stats.audios, 1);
  const audioOnly = await (await runtime.GET(new Request("https://app.invalid/items?type=audio&includeAudio=true"))).json(); assert.equal(audioOnly.items.length, 1); assert.equal(audioOnly.items[0].media_type, "audio");
  assert.equal((await runtime.GET(new Request("https://app.invalid/items?type=audio"))).status, 400);
  assert.ok(queries.some((query) => query.column === "user_id" && query.values === ACCOUNT));
});

test("audio content checks its active account and owned path, then streams through a signed redirect with a safe download name", async () => {
  let path = PATH; let probes = 0; const accountChecks: unknown[] = [];
  const row = { id: "audio-id", user_id: ACCOUNT, bucket_name: "inrcy-pro-media", media_type: "audio", mime_type: "audio/wav", original_file_name: "Vocal pro.wav", is_active: true };
  const query = { select: () => query, eq: (column: string, value: unknown) => { if (column === "user_id") accountChecks.push(value); return query; }, maybeSingle: async () => ({ data: { ...row, storage_path: path }, error: null }) };
  const runtime = load<{ GET: (request: object, context: object) => Promise<Response> }>("app/api/media-library/items/[id]/content/route.ts", {
    "next/server": next, "@/lib/requireUser": auth, "@/lib/supabaseAdmin": { supabaseAdmin: { from: () => query } },
    "@/lib/mediaLibraryContentUrl": { verifyMediaLibraryContentToken: () => true },
    "@/lib/safeStorageSignedUrl": { probeStorageObject: async () => { probes++; return "present"; }, createSafeStorageSignedUrl: async () => "https://private.invalid/object.wav?token=unit-test" },
    "@/lib/mediaImageRecoverySummary": { getMediaImageRecoverySummary: () => ({ requiresCanonical: false }) }, "@/lib/mediaImageNormalizationPolicy": {},
  });
  const context = { params: Promise.resolve({ id: "audio-id" }) };
  const response = await runtime.GET({ nextUrl: new URL("https://app.invalid/audio?token=test&download=1") }, context);
  assert.equal(response.status, 307); assert.equal(new URL(response.headers.get("Location")!).searchParams.get("download"), "Vocal pro.wav");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store"); assert.deepEqual(accountChecks, [ACCOUNT]);
  path = PATH.replace(ACCOUNT, "other-account");
  assert.equal((await runtime.GET({ nextUrl: new URL("https://app.invalid/audio?token=test") }, context)).status, 404);
  assert.equal(probes, 1);
});
