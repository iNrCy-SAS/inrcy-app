import assert from "node:assert/strict";
import test from "node:test";
import * as voices from "../../lib/aiMediaCharacterVoices.ts";
import { ACCOUNT, NOW, audio, fakeStorage, sample, storageRuntime, voicePath, wav } from "./character-voice-runtime-fixtures.mts";

const storage = storageRuntime();
const safeError = (message: string) => (error: unknown) => {
  assert.ok(error instanceof Error); assert.equal(error.message, message); assert.equal(error.cause, undefined); return true;
};

test("voice paths bind account, UTC date, timestamp and a 24-hour lifetime without trusting client metadata", () => {
  const path = voicePath();
  assert.deepEqual(voices.parseAiMediaCharacterVoicePath(path), { path, accountId: ACCOUNT, createdAt: NOW });
  assert.equal(voices.isOwnedAiMediaCharacterVoicePath(ACCOUNT, path, NOW), true);
  assert.equal(voices.isOwnedAiMediaCharacterVoicePath("another-account", path, NOW), false);
  assert.equal(voices.isOwnedAiMediaCharacterVoicePath(ACCOUNT, voicePath(ACCOUNT, NOW - voices.AI_MEDIA_CHARACTER_VOICE_RETENTION_MS), NOW), false);
  assert.equal(voices.isOwnedAiMediaCharacterVoicePath(ACCOUNT, voicePath(ACCOUNT, NOW + 60_001), NOW), false);
  assert.equal(voices.parseAiMediaCharacterVoicePath(path.replace("2026-10-19", "2026-10-18")), null);
  assert.equal(voices.parseAiMediaCharacterVoicePath(`../${path}`), null);
  assert.equal(voices.normalizeAiMediaCharacterVoiceSample({ ...sample(), durationSeconds: 11 }), null);
  assert.equal(voices.normalizeAiMediaCharacterVoiceSample({ ...sample(), sizeBytes: 320_045 }), null);
  assert.equal(voices.normalizeAiMediaCharacterVoiceSample({ ...sample(), mimeType: "audio/mpeg" }), null);
  assert.equal(voices.normalizeAiMediaCharacterVoiceSample({ ...sample(), name: "../a\u0000/b.wav" })?.name, ".. a  b.wav");
});

test("only valid canonical mono PCM WAV between one and ten seconds can be stored", async () => {
  for (const seconds of [1, 2, 10]) assert.equal(audio.inspectAiMediaCharacterVoiceWav(wav(seconds)).durationSeconds, seconds);
  for (const buffer of [wav(.9), wav(10.01), wav(2, 44_100), wav(2, 16_000, 2), Buffer.from("not audio")]) {
    assert.throws(() => audio.inspectAiMediaCharacterVoiceWav(buffer), /voice_audio_(invalid|duration_invalid)/);
  }
  const mock = fakeStorage();
  const saved = await storage.saveAiMediaCharacterVoice({ accountId: ACCOUNT, name: "../vocal.wav", buffer: wav(), storage: mock.storage, now: NOW });
  assert.equal(voices.isOwnedAiMediaCharacterVoicePath(ACCOUNT, saved.path, NOW), true);
  assert.equal(saved.durationSeconds, 2); assert.equal(saved.sizeBytes, 64_044); assert.equal(saved.mimeType, "audio/wav");
  assert.equal(saved.name, ".. vocal.wav");
  const upload = mock.calls.find((call) => call.operation === "upload")!;
  assert.deepEqual(upload.args[2], { contentType: "audio/wav", cacheControl: "0", upsert: false });
  assert.deepEqual(upload.args[1], wav());
  await assert.rejects(storage.saveAiMediaCharacterVoice({ accountId: "../bad", name: "a", buffer: wav(), storage: mock.storage }), /voice_account_invalid/);
});

test("public or unavailable buckets fail before uploading, downloading, signing or removing any sample", async () => {
  for (const mock of [fakeStorage({ public: true }), fakeStorage({ fail: "getBucket" }), fakeStorage({ throws: "getBucket" })]) {
    await assert.rejects(storage.saveAiMediaCharacterVoice({ accountId: ACCOUNT, name: "vocal", buffer: wav(), storage: mock.storage, now: NOW }), safeError("voice_storage_unavailable"));
    await assert.rejects(storage.readAiMediaCharacterVoice({ accountId: ACCOUNT, path: voicePath(), storage: mock.storage, now: NOW }), safeError("voice_storage_unavailable"));
    await assert.rejects(storage.removeAiMediaCharacterVoice({ accountId: ACCOUNT, path: voicePath(), storage: mock.storage }), safeError("voice_storage_unavailable"));
    assert.ok(mock.calls.every((call) => call.operation === "getBucket"));
  }
});

test("storage cannot save a WAV larger than its returned sample contract permits", async () => {
  const metadata = Buffer.alloc(32); metadata.write("JUNK"); metadata.writeUInt32LE(24, 4);
  const buffer = Buffer.concat([wav(10), metadata]); buffer.writeUInt32LE(buffer.length - 8, 4);
  const mock = fakeStorage();
  await assert.rejects(storage.saveAiMediaCharacterVoice({ accountId: ACCOUNT, name: "oversized.wav", buffer, storage: mock.storage, now: NOW }), /voice_audio_(size_)?invalid/);
  assert.deepEqual(mock.calls, []);
});

test("another account and expired references cannot reach privileged Storage", async () => {
  const mock = fakeStorage();
  for (const path of [voicePath("another-account"), voicePath(ACCOUNT, NOW - 86_400_000), "bad-path"]) {
    await assert.rejects(storage.readAiMediaCharacterVoice({ accountId: ACCOUNT, path, storage: mock.storage, now: NOW }), safeError("voice_reference_invalid_or_expired"));
  }
  await assert.rejects(storage.removeAiMediaCharacterVoice({ accountId: ACCOUNT, path: voicePath("another-account"), storage: mock.storage }), safeError("voice_reference_invalid_or_expired"));
  assert.equal(mock.calls.length, 0);
  await storage.removeAiMediaCharacterVoice({ accountId: ACCOUNT, path: voicePath(ACCOUNT, NOW - 86_400_000), storage: mock.storage });
  assert.deepEqual(mock.calls.at(-1)?.args, [[voicePath(ACCOUNT, NOW - 86_400_000)]], "Owners may remove an expired sample without extending its lifetime");
});

test("signed voice URLs retain original image indices and only validate provided character voices", async () => {
  const mock = fakeStorage();
  const second = voicePath(ACCOUNT, NOW, "000000000002");
  const urls = await storage.getAiMediaCharacterVoiceSignedUrls({ accountId: ACCOUNT, now: NOW, storage: mock.storage, images: [
    { role: "product" }, { role: "character", voiceMode: "provided", voiceSample: sample() },
    { role: "character", voiceMode: "ai" }, { role: "character", voiceMode: "provided", voiceSample: sample(second) },
  ] });
  assert.equal(urls.length, 4); assert.equal(urls[0], null); assert.equal(urls[2], null);
  assert.ok(urls[1]?.includes(voicePath())); assert.ok(urls[3]?.includes(second));
  assert.deepEqual(mock.calls.filter((call) => call.operation === "createSignedUrl").map((call) => call.args), [[voicePath(), 1800], [second, 1800]]);
  for (const image of [{ role: "character", voiceMode: "provided" as const }, { role: "product", voiceMode: "provided" as const, voiceSample: sample() }]) {
    await assert.rejects(storage.getAiMediaCharacterVoiceSignedUrls({ accountId: ACCOUNT, images: [image], storage: mock.storage, now: NOW }), /voice_reference_missing/);
  }
});

test("upload, download, delete and signing failures hide Storage diagnostics and unsafe signed URLs", async () => {
  for (const operation of ["upload", "download", "remove", "createSignedUrl"] as const) for (const mode of ["fail", "throws"] as const) {
    const mock = fakeStorage({ [mode]: operation });
    const promise = operation === "upload" ? storage.saveAiMediaCharacterVoice({ accountId: ACCOUNT, name: "vocal", buffer: wav(), storage: mock.storage, now: NOW })
      : operation === "download" ? storage.readAiMediaCharacterVoice({ accountId: ACCOUNT, path: voicePath(), storage: mock.storage, now: NOW })
        : operation === "remove" ? storage.removeAiMediaCharacterVoice({ accountId: ACCOUNT, path: voicePath(), storage: mock.storage })
          : storage.getAiMediaCharacterVoiceSignedUrls({ accountId: ACCOUNT, images: [{ role: "character", voiceMode: "provided", voiceSample: sample() }], storage: mock.storage, now: NOW });
    await assert.rejects(promise, safeError(operation === "download" ? "voice_reference_unavailable" : "voice_storage_unavailable"));
  }
  for (const signedUrl of ["http://storage.invalid/object", "https://user:secret@storage.invalid/object", "invalid-url"]) {
    const mock = fakeStorage({ signedUrl });
    await assert.rejects(storage.getAiMediaCharacterVoiceSignedUrls({ accountId: ACCOUNT, images: [{ role: "character", voiceMode: "provided", voiceSample: sample() }], storage: mock.storage, now: NOW }), safeError("voice_storage_unavailable"));
  }
  const oversized = fakeStorage({ body: Buffer.alloc(320_045) });
  await assert.rejects(storage.readAiMediaCharacterVoice({ accountId: ACCOUNT, path: voicePath(), storage: oversized.storage, now: NOW }), safeError("voice_reference_unavailable"));
});

test("cleanup removes only matching expired voice objects, retaining fresh, unrelated and future paths", async () => {
  const yesterday = NOW - 86_400_000;
  const oldPath = voicePath(ACCOUNT, yesterday);
  const recentPath = voicePath(ACCOUNT, NOW - 60_000);
  const oldName = oldPath.split("/").at(-1)!;
  const root = voices.AI_MEDIA_CHARACTER_VOICE_STORAGE_ROOT;
  const mock = fakeStorage({ listings: (prefix) => prefix === root ? [
    { name: "2026-10-18" }, { name: "2026-10-19" }, { name: "2026-10-20" }, { name: "unrelated" }, { name: "2026-10-17", id: "object-not-folder" },
  ] : prefix.endsWith("2026-10-18") ? [{ name: oldName }, { name: "other.wav" }, { name: oldName.replace("000000000001", "invalid-uuid") }]
    : [{ name: recentPath.split("/").at(-1)! }] });
  const result = await storage.purgeExpiredAiMediaCharacterVoices({ storage: mock.storage, now: NOW });
  assert.equal(result.removed, 1); assert.deepEqual(result.errors, []);
  assert.deepEqual(mock.calls.filter((call) => call.operation === "remove").map((call) => call.args), [[[oldPath]]]);
  assert.equal(mock.calls.filter((call) => call.operation === "list").length, 3);
});

test("cleanup paginates before deleting batches, avoiding skipped objects when a page shrinks", async () => {
  const root = voices.AI_MEDIA_CHARACTER_VOICE_STORAGE_ROOT;
  const oldPaths = Array.from({ length: 105 }, (_, index) => voicePath(ACCOUNT, NOW - 86_400_000, String(index + 1).padStart(12, "0")));
  const mock = fakeStorage({ listings: (prefix, offset) => prefix === root ? [{ name: "2026-10-18" }]
    : oldPaths.slice(offset, offset + 100).map((path) => ({ name: path.split("/").at(-1)! })) });
  const result = await storage.purgeExpiredAiMediaCharacterVoices({ storage: mock.storage, now: NOW });
  assert.equal(result.removed, 105);
  assert.deepEqual(mock.calls.filter((call) => call.operation === "remove").map((call) => (call.args[0] as string[]).length), [100, 5]);
  assert.ok(mock.calls.findIndex((call) => call.operation === "remove") > mock.calls.findLastIndex((call) => call.operation === "list"));
});

test("cleanup returns fixed error codes for thrown or returned list/remove failures", async () => {
  const oldPath = voicePath(ACCOUNT, NOW - 86_400_000);
  const listings = (prefix: string) => prefix === voices.AI_MEDIA_CHARACTER_VOICE_STORAGE_ROOT
    ? [{ name: "2026-10-18" }] : [{ name: oldPath.split("/").at(-1)! }];
  for (const operation of ["list", "remove"] as const) for (const mode of ["fail", "throws"] as const) {
    const mock = fakeStorage({ [mode]: operation, listings });
    const result = await storage.purgeExpiredAiMediaCharacterVoices({ storage: mock.storage, now: NOW });
    assert.equal(result.removed, 0);
    assert.deepEqual(result.errors, [operation === "list" ? "voice_cleanup_list_failed" : "voice_cleanup_remove_failed"]);
  }
});

test("cleanup snapshots more than one page of date folders before deleting empty folders", async () => {
  const root = voices.AI_MEDIA_CHARACTER_VOICE_STORAGE_ROOT;
  const oldPaths = Array.from({ length: 105 }, (_, index) => voicePath(ACCOUNT, NOW - (index + 1) * 86_400_000));
  const folders = new Map(oldPaths.map((path) => [path.slice(0, path.lastIndexOf("/")), path]));
  const mock = fakeStorage({ listings: (prefix, offset) => prefix === root
    ? [...folders.keys()].sort().slice(offset, offset + 100).map((path) => ({ name: path.split("/").at(-1)! }))
    : folders.has(prefix) ? [{ name: folders.get(prefix)!.split("/").at(-1)! }] : [] });
  const shrinkingStorage = {
    getBucket: mock.storage.getBucket,
    from(bucketName: string) {
      const bucket = mock.storage.from(bucketName);
      return { ...bucket, async remove(paths: string[]) {
        for (const path of paths) folders.delete(path.slice(0, path.lastIndexOf("/")));
        return bucket.remove(paths);
      } };
    },
  };
  const result = await storage.purgeExpiredAiMediaCharacterVoices({ storage: shrinkingStorage, now: NOW });
  assert.equal(result.inspected, 105); assert.equal(result.removed, 105); assert.deepEqual(result.errors, []);
  assert.equal(folders.size, 0);
  const rootPages = mock.calls.filter((call) => call.operation === "list" && call.args[0] === root);
  assert.deepEqual(rootPages.map((call) => (call.args[1] as { offset: number }).offset), [0, 100]);
  assert.ok(mock.calls.findIndex((call) => call.operation === "remove") > mock.calls.findLastIndex((call) => call.operation === "list" && call.args[0] === root));
});
