import assert from "node:assert/strict";
import test from "node:test";
import {
  assertLinkedInVideoCheckpoint, isSafeLinkedInVideoUploadUrl,
  LINKEDIN_ADS_VIDEO_MAX_BYTES, LinkedInVideoUploadError,
  uploadLinkedInAdsVideo, validateLinkedInAdsVideoSource,
  type LinkedInAdsVideoDependencies, type LinkedInVideoCheckpoint,
} from "../lib/adsLinkedInVideo.ts";
import { INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES } from "../lib/mediaRules.ts";

const owner = "urn:li:organization:123";
const videoUrn = "urn:li:video:fixture_123";
const operationKey = "linkedin:video-test";

function mp4(duration = 32_000, version = 0): Uint8Array {
  const bytes = new Uint8Array(75_000);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, value: string) => { for (let i = 0; i < value.length; i += 1) bytes[offset + i] = value.charCodeAt(i); };
  view.setUint32(0, 24); ascii(4, "ftyp"); ascii(8, "isom"); ascii(16, "isommp42");
  const mvhdSize = version === 1 ? 40 : 28;
  view.setUint32(24, mvhdSize + 8); ascii(28, "moov");
  view.setUint32(32, mvhdSize); ascii(36, "mvhd"); bytes[40] = version;
  view.setUint32(40 + (version === 1 ? 20 : 12), 1_000);
  view.setUint32(40 + (version === 1 ? 28 : 16), duration);
  const mdat = 32 + mvhdSize;
  view.setUint32(mdat, bytes.length - mdat); ascii(mdat + 4, "mdat");
  return bytes;
}

function fixture() {
  const source = { bytes: mp4(), contentType: "video/mp4", sourceIdentity: "owned-library-media" };
  const saved: LinkedInVideoCheckpoint[] = [];
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  const uploads: Array<{ url: string; options: RequestInit }> = [];
  let states: Array<Record<string, unknown>> = [];
  const deps: LinkedInAdsVideoDependencies = {
    now: () => 100, sleep: async () => {}, pollAttempts: 2,
    persist: async (cp) => { saved.push(structuredClone(cp)); },
    read: async () => states.shift() || { id: videoUrn, owner, status: "AVAILABLE", duration: 32_000 },
    write: async (path, body) => {
      writes.push({ path, body });
      if (path.includes("initializeUpload")) {
        assert.equal(saved.at(-1)?.phase, "initializing");
        return { value: { video: videoUrn, uploadToken: "opaque-server-session", uploadUrlsExpireAt: 10_000,
          uploadInstructions: [
            { firstByte: 0, lastByte: 39_999, uploadUrl: "https://www.linkedin.com/dms-uploads/part0?sig=fixture" },
            { firstByte: 40_000, lastByte: 74_999, uploadUrl: "https://www.linkedin.com/dms-uploads/part1?sig=fixture" },
          ] } };
      }
      assert.equal(saved.at(-1)?.phase, "finalizing");
      return {};
    },
    fetchImpl: (async (url, options) => {
      uploads.push({ url: String(url), options: options || {} });
      return new Response(null, { status: 200, headers: { etag: `"part-${uploads.length}"` } });
    }) as typeof fetch,
  };
  return { input: { operationKey, ownerUrn: owner, source }, deps, saved, writes, uploads,
    setStates: (next: Array<Record<string, unknown>>) => { states = next; } };
}

test("MP4 duration is read from actual metadata, including version 1, under the app publication limit", () => {
  assert.equal(LINKEDIN_ADS_VIDEO_MAX_BYTES, INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES);
  for (const version of [0, 1]) assert.equal(validateLinkedInAdsVideoSource({ bytes: mp4(32_000, version), contentType: "video/mp4", sourceIdentity: "media" }).durationMs, 32_000);
  for (const duration of [2_999, 1_800_001, 0]) assert.throws(() => validateLinkedInAdsVideoSource({ bytes: mp4(duration), contentType: "video/mp4", sourceIdentity: "media" }));
  assert.throws(() => validateLinkedInAdsVideoSource({ bytes: new Uint8Array(75_000), contentType: "video/mp4", sourceIdentity: "media" }));
  assert.throws(() => validateLinkedInAdsVideoSource({ bytes: mp4(), contentType: "video/quicktime", sourceIdentity: "media" }));
  const broken = mp4(); new DataView(broken.buffer).setUint32(24, 99_999);
  assert.throws(() => validateLinkedInAdsVideoSource({ bytes: broken, contentType: "video/mp4", sourceIdentity: "media" }));
});

test("signed upload URLs stay on the documented LinkedIn origin", () => {
  assert.equal(isSafeLinkedInVideoUploadUrl("https://www.linkedin.com/dms-uploads/test?sig=opaque"), true);
  for (const url of ["http://www.linkedin.com/dms-uploads/test", "https://evil.example/dms-uploads/test", "https://user:secret@www.linkedin.com/dms-uploads/test", "https://www.linkedin.com/other/test", "https://www.linkedin.com/dms-uploads/test#leak", "https://www.linkedin.com:444/dms-uploads/test"]) assert.equal(isSafeLinkedInVideoUploadUrl(url), false);
});

test("multipart upload uses inclusive ranges, preserves ETag order, and sends no OAuth token to upload URLs", async () => {
  const run = fixture();
  const result = await uploadLinkedInAdsVideo(run.input, run.deps);
  assert.equal(result.videoUrn, videoUrn);
  assert.deepEqual(run.uploads.map((entry) => (entry.options.body as Uint8Array).byteLength), [40_000, 35_000]);
  assert.deepEqual(run.uploads[0].options.body, run.input.source.bytes.slice(0, 40_000));
  for (const { options } of run.uploads) {
    assert.equal(options.method, "PUT"); assert.equal(options.redirect, "error");
    assert.deepEqual(options.headers, { "Content-Type": "application/octet-stream" });
  }
  assert.deepEqual(run.writes[0].body, { initializeUploadRequest: { owner, fileSizeBytes: 75_000, uploadCaptions: false, uploadThumbnail: false } });
  assert.deepEqual(run.writes[1].body, { finalizeUploadRequest: { video: videoUrn, uploadToken: "opaque-server-session", uploadedPartIds: ["part-1", "part-2"] } });
  assert.equal(result.checkpoint.phase, "available");
  assert.equal(result.checkpoint.uploadToken, undefined); assert.deepEqual(result.checkpoint.parts, []);
});

test("recovery skips durable uploaded parts and does not initialize another video", async () => {
  const run = fixture(); let attempts = 0;
  run.deps.fetchImpl = (async () => { if (++attempts === 2) throw new Error("network"); return new Response(null, { headers: { etag: "confirmed-first" } }); }) as typeof fetch;
  await assert.rejects(uploadLinkedInAdsVideo(run.input, run.deps), (error: unknown) => error instanceof LinkedInVideoUploadError && error.retrySafe);
  const checkpoint = run.saved.at(-1)!;
  assert.equal(checkpoint.parts[0].partId, "confirmed-first");
  run.deps.fetchImpl = (async (url) => { run.uploads.push({ url: String(url), options: {} }); return new Response(null, { headers: { etag: "confirmed-second" } }); }) as typeof fetch;
  await uploadLinkedInAdsVideo({ ...run.input, checkpoint }, run.deps);
  assert.equal(run.uploads.length, 1); assert.match(run.uploads[0].url, /part1/);
  assert.equal(run.writes.filter((entry) => entry.path.includes("initializeUpload")).length, 1);
});

test("unknown initialization never triggers another remote create on retry", async () => {
  const run = fixture(); let calls = 0;
  run.deps.write = async () => { calls += 1; throw new Error("lost response"); };
  await assert.rejects(uploadLinkedInAdsVideo(run.input, run.deps), (error: unknown) => error instanceof LinkedInVideoUploadError && error.code === "initialize_unknown" && !error.retrySafe);
  await assert.rejects(uploadLinkedInAdsVideo({ ...run.input, checkpoint: run.saved.at(-1) }, run.deps), /initialisation vidéo est inconnu/);
  assert.equal(calls, 1);
});

test("unknown finalize is recovered by reads without another finalize or upload", async () => {
  const run = fixture(); const write = run.deps.write;
  run.deps.write = async (path, body) => { const result = await write(path, body); if (path.includes("finalizeUpload")) throw new Error("lost response"); return result; };
  await assert.rejects(uploadLinkedInAdsVideo(run.input, run.deps), /finalisation vidéo/);
  const checkpoint = run.saved.at(-1)!;
  assert.equal(checkpoint.phase, "finalizing");
  await uploadLinkedInAdsVideo({ ...run.input, checkpoint }, run.deps);
  assert.equal(run.writes.length, 2); assert.equal(run.uploads.length, 2);
});

test("processing remains retryable while failed processing and wrong ownership block publication", async () => {
  for (const status of ["PROCESSING", "PROCESSING_FAILED", "AVAILABLE"]) {
    const run = fixture();
    const state = { id: videoUrn, owner: status === "AVAILABLE" ? "urn:li:organization:999" : owner, status, duration: 32_000 };
    run.setStates([state, state]);
    await assert.rejects(uploadLinkedInAdsVideo(run.input, run.deps), (error: unknown) => error instanceof LinkedInVideoUploadError && (status === "PROCESSING" ? error.code === "video_processing_pending" && error.retrySafe : !error.retrySafe));
  }
});

test("invalid provider ranges or URLs are rejected before uploading any bytes", async () => {
  for (const change of ["gap", "foreign", "overflow"]) {
    const run = fixture(); const write = run.deps.write;
    run.deps.write = async (path, body) => {
      const result = await write(path, body);
      const value = result.value as { uploadInstructions: Array<{ firstByte: number; lastByte: number; uploadUrl: string }> };
      if (change === "gap") value.uploadInstructions[1].firstByte += 1;
      if (change === "foreign") value.uploadInstructions[0].uploadUrl = "https://evil.example/steal";
      if (change === "overflow") value.uploadInstructions[1].lastByte += 1;
      return result;
    };
    await assert.rejects(uploadLinkedInAdsVideo(run.input, run.deps)); assert.equal(run.uploads.length, 0);
  }
});

test("checkpoints bind the exact source bytes, Page, and operation and recheck AVAILABLE state", async () => {
  const run = fixture(); const done = await uploadLinkedInAdsVideo(run.input, run.deps);
  for (const input of [
    { ...run.input, operationKey: "another" },
    { ...run.input, ownerUrn: "urn:li:organization:999" },
    { ...run.input, source: { ...run.input.source, bytes: mp4(40_000) } },
  ]) await assert.rejects(uploadLinkedInAdsVideo({ ...input, checkpoint: done.checkpoint }, run.deps), /ne correspond pas/);
  assert.throws(() => assertLinkedInVideoCheckpoint({ ...done.checkpoint, uploadToken: "leak" }));
  const writes = run.writes.length; await uploadLinkedInAdsVideo({ ...run.input, checkpoint: done.checkpoint }, run.deps);
  assert.equal(run.writes.length, writes);
});

test("persistence failure before initialization cannot create a remote upload", async () => {
  const run = fixture(); run.deps.persist = async () => { throw new Error("database down"); };
  await assert.rejects(uploadLinkedInAdsVideo(run.input, run.deps), /progression/);
  assert.equal(run.writes.length, 0); assert.equal(run.uploads.length, 0);
});
