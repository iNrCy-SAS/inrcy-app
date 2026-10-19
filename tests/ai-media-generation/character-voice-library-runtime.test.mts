import assert from "node:assert/strict";
import test from "node:test";
import { ACCOUNT, load, sample, wav } from "./character-voice-runtime-fixtures.mts";
import { AI_MEDIA_CHARACTER_VOICE_MAX_UPLOAD_BYTES, normalizeAiMediaCharacterVoiceSample } from "../../lib/aiMediaCharacterVoices.ts";

const LIBRARY_ID = "00000000-0000-4000-8000-000000000001";
const PATH = `users/${ACCOUNT}/audio/2026/${LIBRARY_ID}.wav`;
const runtime = load<typeof import("../../lib/aiMediaCharacterVoiceLibrary.ts")>("lib/aiMediaCharacterVoiceLibrary.ts", {
  "@/lib/supabaseAdmin": { supabaseAdmin: new Proxy({}, { get() { throw new Error("real_database_forbidden_in_test"); } }) },
});

test("sample normalization preserves a valid library identifier while discarding invalid hints", () => {
  assert.deepEqual(normalizeAiMediaCharacterVoiceSample({ ...sample(), libraryMediaId: LIBRARY_ID }), { ...sample(), libraryMediaId: LIBRARY_ID });
  assert.deepEqual(normalizeAiMediaCharacterVoiceSample({ ...sample(), libraryMediaId: "https://untrusted.invalid/audio.wav" }), sample());
  assert.deepEqual(normalizeAiMediaCharacterVoiceSample(sample()), sample());
});

type LibraryRow = {
  id: string; user_id: string; is_active: boolean; bucket_name: string; storage_path: string;
  media_type: string; mime_type: string; size_bytes: number; title: string | null; original_file_name: string | null;
};
function libraryClient(options: {
  row?: Partial<LibraryRow>; queryError?: boolean; queryThrows?: boolean; public?: boolean;
  bucketError?: boolean; bucketThrows?: boolean; downloadError?: boolean; downloadThrows?: boolean;
  bytes?: Buffer; onQuery?: () => void; onDownload?: () => void;
} = {}) {
  const calls: { operation: string; args: unknown[] }[] = [];
  const filters: [string, unknown][] = [];
  const row: LibraryRow = { id: LIBRARY_ID, user_id: ACCOUNT, is_active: true, bucket_name: "inrcy-pro-media", storage_path: PATH,
    media_type: "audio", mime_type: "audio/wav", size_bytes: 64_044, title: "Library title", original_file_name: "voice-original.wav", ...options.row };
  const query = {
    select(columns: string) { calls.push({ operation: "select", args: [columns] }); return query; },
    eq(column: string, value: unknown) { filters.push([column, value]); return query; },
    async maybeSingle() {
      calls.push({ operation: "query", args: [...filters] }); options.onQuery?.();
      if (options.queryThrows) throw new Error("query failed https://private.invalid?token=secret");
      const matches = filters.every(([column, value]) => row[column as keyof LibraryRow] === value);
      return { data: matches ? row : null, error: options.queryError ? new Error("private database diagnostic") : null };
    },
  };
  const client = {
    from(table: string) { calls.push({ operation: "table", args: [table] }); assert.equal(table, "pro_media_library"); return query; },
    storage: {
      async getBucket(name: string) {
        calls.push({ operation: "bucket", args: [name] });
        if (options.bucketThrows) throw new Error("bucket diagnostic token=secret");
        return { data: { public: options.public ?? false }, error: options.bucketError ? new Error("bucket diagnostic token=secret") : null };
      },
      from(name: string) {
        assert.equal(name, "inrcy-pro-media");
        return { async download(path: string) {
          calls.push({ operation: "download", args: [path] }); options.onDownload?.();
          if (options.downloadThrows) throw new Error("download diagnostic token=secret");
          return { data: new Blob([new Uint8Array(options.bytes ?? wav())]), error: options.downloadError ? new Error("download diagnostic token=secret") : null };
        } };
      },
    },
  };
  return { client: client as unknown as NonNullable<Parameters<typeof runtime.readAiMediaCharacterVoiceFromLibrary>[0]["client"]>, calls };
}

test("library voice lookup filters by exact active account, active audio type and requested identifier", async () => {
  const mock = libraryClient();
  const result = await runtime.readAiMediaCharacterVoiceFromLibrary({ accountId: ACCOUNT, mediaId: LIBRARY_ID, client: mock.client });
  assert.deepEqual(result, { buffer: wav(), name: "voice-original.wav", mediaId: LIBRARY_ID });
  assert.deepEqual(mock.calls.find((call) => call.operation === "query")?.args, [["id", LIBRARY_ID], ["user_id", ACCOUNT], ["media_type", "audio"], ["is_active", true]]);
  assert.deepEqual(mock.calls.filter((call) => ["bucket", "download"].includes(call.operation)), [
    { operation: "bucket", args: ["inrcy-pro-media"] }, { operation: "download", args: [PATH] },
  ]);
});

test("another account, inactive media and non-audio media never reach privileged Storage", async () => {
  for (const row of [{ user_id: "another-account" }, { is_active: false }, { media_type: "image" }, { media_type: "video" }, { id: "00000000-0000-4000-8000-000000000002" }]) {
    const mock = libraryClient({ row });
    await assert.rejects(runtime.readAiMediaCharacterVoiceFromLibrary({ accountId: ACCOUNT, mediaId: LIBRARY_ID, client: mock.client }), /voice_library_reference_unavailable/);
    assert.ok(mock.calls.every((call) => !["bucket", "download"].includes(call.operation)));
  }
});

test("invalid account and media identifiers stop before querying the database", async () => {
  for (const [accountId, mediaId] of [["../account", LIBRARY_ID], [ACCOUNT, "../file.wav"], [ACCOUNT, "https://untrusted.invalid/audio.wav"], [ACCOUNT, ""]]) {
    const mock = libraryClient();
    await assert.rejects(runtime.readAiMediaCharacterVoiceFromLibrary({ accountId, mediaId, client: mock.client }), /voice_library_reference_invalid/);
    assert.equal(mock.calls.length, 0);
  }
});

test("library metadata must name a private audio object inside the exact account audio prefix", async () => {
  for (const row of [
    { bucket_name: "booster" }, { storage_path: `users/another-account/audio/2026/file.wav` },
    { storage_path: `users/${ACCOUNT}/image/file.wav` }, { storage_path: `users/${ACCOUNT}/audio/../../another-account/file.wav` },
    { storage_path: `users/${ACCOUNT}/audio/./file.wav` }, { storage_path: `users/${ACCOUNT}/audio//file.wav` },
    { storage_path: `users/${ACCOUNT}/audio/2026\\file.wav` }, { storage_path: `users/${ACCOUNT}/audio/%2e%2e/file.wav` },
    { storage_path: `users/${ACCOUNT}/audio/file.wav?token=secret` }, { storage_path: `users/${ACCOUNT}/audio/file.wav#fragment` },
    { storage_path: `users/${ACCOUNT}/audio/file\u0000.wav` }, { mime_type: "video/mp4" }, { mime_type: "text/html" },
    { size_bytes: 0 }, { size_bytes: AI_MEDIA_CHARACTER_VOICE_MAX_UPLOAD_BYTES + 1 },
  ]) {
    const mock = libraryClient({ row });
    await assert.rejects(runtime.readAiMediaCharacterVoiceFromLibrary({ accountId: ACCOUNT, mediaId: LIBRARY_ID, client: mock.client }), /voice_library_reference_unavailable/);
    assert.ok(mock.calls.every((call) => !["bucket", "download"].includes(call.operation)), JSON.stringify(row));
  }
});

test("MPEG audio remains eligible and displayed names fall back to title with a bounded length", async () => {
  const mock = libraryClient({ row: { mime_type: "audio/mpeg", original_file_name: null, title: "x".repeat(300) } });
  const result = await runtime.readAiMediaCharacterVoiceFromLibrary({ accountId: ACCOUNT, mediaId: LIBRARY_ID, client: mock.client });
  assert.equal(result.name, "x".repeat(120));
  const unnamed = libraryClient({ row: { original_file_name: null, title: null } });
  assert.equal((await runtime.readAiMediaCharacterVoiceFromLibrary({ accountId: ACCOUNT, mediaId: LIBRARY_ID, client: unnamed.client })).name, "vocal.wav");
});

test("public or unavailable buckets and missing or oversized audio bodies fail with fixed diagnostics", async () => {
  for (const [options, expected] of [
    [{ public: true }, "voice_storage_unavailable"], [{ bucketError: true }, "voice_storage_unavailable"], [{ bucketThrows: true }, "voice_storage_unavailable"],
    [{ downloadError: true }, "voice_library_reference_unavailable"], [{ downloadThrows: true }, "voice_library_reference_unavailable"],
    [{ bytes: Buffer.alloc(0) }, "voice_library_reference_unavailable"], [{ bytes: Buffer.alloc(AI_MEDIA_CHARACTER_VOICE_MAX_UPLOAD_BYTES + 1) }, "voice_library_reference_unavailable"],
    [{ queryError: true }, "voice_library_reference_unavailable"], [{ queryThrows: true }, "voice_library_reference_unavailable"],
  ] as const) {
    const mock = libraryClient(options);
    await assert.rejects(runtime.readAiMediaCharacterVoiceFromLibrary({ accountId: ACCOUNT, mediaId: LIBRARY_ID, client: mock.client }), (error: unknown) => {
      assert.ok(error instanceof Error); assert.equal(error.message, expected); assert.equal(error.cause, undefined); return true;
    });
    if ("public" in options || "bucketError" in options || "bucketThrows" in options) assert.equal(mock.calls.some((call) => call.operation === "download"), false);
  }
});

test("cancellation before or during the scoped query prevents audio download", async () => {
  const early = libraryClient();
  await assert.rejects(runtime.readAiMediaCharacterVoiceFromLibrary({ accountId: ACCOUNT, mediaId: LIBRARY_ID, client: early.client, signal: AbortSignal.abort(new Error("cancelled")) }), /cancelled/);
  assert.equal(early.calls.length, 0);
  const controller = new AbortController();
  const during = libraryClient({ onQuery: () => controller.abort(new Error("cancelled")) });
  await assert.rejects(runtime.readAiMediaCharacterVoiceFromLibrary({ accountId: ACCOUNT, mediaId: LIBRARY_ID, client: during.client, signal: controller.signal }), /cancelled/);
  assert.ok(during.calls.every((call) => !["bucket", "download"].includes(call.operation)));
});

test("cancellation during download stops before the helper returns data for decoding", async () => {
  const controller = new AbortController();
  const mock = libraryClient({ onDownload: () => controller.abort(new Error("cancelled")) });
  await assert.rejects(runtime.readAiMediaCharacterVoiceFromLibrary({ accountId: ACCOUNT, mediaId: LIBRARY_ID, client: mock.client, signal: controller.signal }), /cancelled/);
});
