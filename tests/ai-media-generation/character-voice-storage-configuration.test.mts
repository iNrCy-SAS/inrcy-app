import assert from "node:assert/strict";
import test from "node:test";
import { configureCharacterVoiceStorage, parseCharacterVoiceStorageArguments } from "../../scripts/configure-character-voice-storage.mjs";

type Bucket = { public: boolean; file_size_limit?: number | null; allowed_mime_types?: string[] | null };
function mockStorage(initial: Bucket, options: { failUpdate?: boolean; throwsRead?: boolean; after?: Bucket } = {}) {
  let bucket = structuredClone(initial);
  let reads = 0;
  const updates: { id: string; options: { public: boolean; fileSizeLimit?: number | null; allowedMimeTypes: string[] } }[] = [];
  const storage = {
    async getBucket(id: string) {
      assert.equal(id, "inrcy-pro-media"); reads++;
      if (options.throwsRead) throw new Error("https://private.invalid?token=secret");
      return { data: structuredClone(bucket), error: null };
    },
    async updateBucket(id: string, config: { public: boolean; fileSizeLimit?: number | null; allowedMimeTypes: string[] }) {
      updates.push({ id, options: structuredClone(config) });
      if (options.failUpdate) return { error: new Error("private server diagnostics") };
      bucket = options.after ?? { public: config.public, file_size_limit: config.fileSizeLimit, allowed_mime_types: [...config.allowedMimeTypes] };
      return { error: null };
    },
  };
  return { storage, updates, reads: () => reads };
}

test("the storage setup defaults to check and requires a single explicit apply flag to mutate", () => {
  assert.deepEqual(parseCharacterVoiceStorageArguments([]), { apply: false });
  assert.deepEqual(parseCharacterVoiceStorageArguments(["--check"]), { apply: false });
  assert.deepEqual(parseCharacterVoiceStorageArguments(["--apply"]), { apply: true });
  for (const args of [["apply"], ["--check", "--apply"], ["--apply", "anything"]]) assert.throws(() => parseCharacterVoiceStorageArguments(args), /voice_storage_arguments_invalid/);
});

test("the default check reports missing WAV support without changing the bucket", async () => {
  const mock = mockStorage({ public: false, file_size_limit: 52_428_800, allowed_mime_types: ["image/jpeg", "audio/mpeg"] });
  const result = await configureCharacterVoiceStorage({ storage: mock.storage });
  assert.equal(result.ready, false); assert.equal(result.changed, false); assert.equal(result.action, "run_with_apply");
  assert.equal(mock.reads(), 1); assert.equal(mock.updates.length, 0);
});

test("apply retains the size limit and every existing MIME, verifies the change and becomes a no-op on repeat", async () => {
  const original = { public: false, file_size_limit: 52_428_800, allowed_mime_types: ["image/jpeg", "audio/mpeg", "video/mp4"] };
  const mock = mockStorage(original);
  const first = await configureCharacterVoiceStorage({ storage: mock.storage, apply: true });
  assert.equal(first.ready, true); assert.equal(first.changed, true); assert.equal(mock.reads(), 2);
  assert.deepEqual(mock.updates, [{ id: "inrcy-pro-media", options: { public: false, fileSizeLimit: 52_428_800, allowedMimeTypes: ["image/jpeg", "audio/mpeg", "video/mp4", "audio/wav"] } }]);
  assert.deepEqual(original.allowed_mime_types, ["image/jpeg", "audio/mpeg", "video/mp4"]);
  const repeated = await configureCharacterVoiceStorage({ storage: mock.storage, apply: true });
  assert.equal(repeated.changed, false); assert.equal(mock.updates.length, 1);
});

test("unrestricted or already compatible MIME settings require no update", async () => {
  for (const allowed_mime_types of [undefined, null, [], ["audio/wav"], ["audio/*"]]) {
    const mock = mockStorage({ public: false, file_size_limit: null, allowed_mime_types });
    const result = await configureCharacterVoiceStorage({ storage: mock.storage, apply: true });
    assert.equal(result.ready, true); assert.equal(result.changed, false); assert.equal(mock.updates.length, 0);
  }
});

test("public buckets and failed reads or updates stop with fixed diagnostics", async () => {
  const publicBucket = mockStorage({ public: true, allowed_mime_types: ["audio/mpeg"] });
  await assert.rejects(configureCharacterVoiceStorage({ storage: publicBucket.storage, apply: true }), /voice_storage_private_bucket_required/);
  assert.equal(publicBucket.updates.length, 0);
  const unreadable = mockStorage({ public: false }, { throwsRead: true });
  await assert.rejects(configureCharacterVoiceStorage({ storage: unreadable.storage }), (error: unknown) => error instanceof Error && error.message === "voice_storage_bucket_read_failed");
  const updateFailed = mockStorage({ public: false, allowed_mime_types: ["audio/mpeg"] }, { failUpdate: true });
  await assert.rejects(configureCharacterVoiceStorage({ storage: updateFailed.storage, apply: true }), /voice_storage_bucket_update_failed/);
});

test("read-back verification detects lost MIME entries, a changed size limit or a public bucket", async () => {
  const initial = { public: false, file_size_limit: 1_000_000, allowed_mime_types: ["audio/mpeg"] };
  for (const after of [
    { public: false, file_size_limit: 1_000_000, allowed_mime_types: ["audio/wav"] },
    { public: false, file_size_limit: 2_000_000, allowed_mime_types: ["audio/mpeg", "audio/wav"] },
    { public: true, file_size_limit: 1_000_000, allowed_mime_types: ["audio/mpeg", "audio/wav"] },
  ]) {
    const mock = mockStorage(initial, { after });
    await assert.rejects(configureCharacterVoiceStorage({ storage: mock.storage, apply: true }), /voice_storage_(bucket_verification_failed|private_bucket_required)/);
  }
});
