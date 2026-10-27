import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

test("Story photo staging preserves source order, whole images and content identities across new retry parents", async () => {
  const stored = new Map<string, { buffer: Buffer; type: string }>(); let uploads = 0;
  const colors = [[220, 40, 40], [34, 170, 102], [51, 85, 221], [221, 170, 34], [165, 45, 190]];
  const sources = await Promise.all(colors.map(async (color, index) => {
    const key = `account/source-${index}.jpg`;
    const buffer = await sharp({ create: { width: index % 2 ? 300 : 600, height: index % 2 ? 600 : 400, channels: 3, background: { r: color[0], g: color[1], b: color[2] } } }).jpeg().toBuffer();
    stored.set(key, { buffer, type: "image/jpeg" }); return key;
  }));
  const load = runtimeModules({
    "@/lib/supabaseAdmin": { supabaseAdmin: { storage: { from: () => ({
      download: async (key: string) => { const value = stored.get(key); return value ? { data: new Blob([new Uint8Array(value.buffer)], { type: value.type }), error: null } : { data: null, error: { message: "missing" } }; },
      getPublicUrl: (key: string) => ({ data: { publicUrl: `https://storage.example/${key}` } }),
      upload: async (key: string, data: ArrayBuffer, options: { upsert: boolean; contentType: string }) => { assert.equal(options.upsert, false); assert.equal(options.contentType, "image/jpeg"); stored.set(key, { buffer: Buffer.from(data), type: options.contentType }); uploads++; return { error: null }; },
    }) } } },
    "@/lib/aiMediaGenerationSoundtracks": { loadAiMediaSoundtrack: async () => { assert.fail("Photo staging never picks five separate soundtracks"); } },
  });
  const { prepareMetaImageStoryPhotos } = load<typeof import("../../lib/instagramImageMotionVideo.ts")>("lib/instagramImageMotionVideo.ts");
  const args = { accountId: "account", publicationId: "original-parent", imageStoragePaths: sources };
  const first = await prepareMetaImageStoryPhotos(args);
  assert.equal(first.length, 5); assert.equal(uploads, 5);
  for (const [index, photo] of first.entries()) {
    const data = stored.get(photo.storagePath)!;
    assert.equal(photo.sourceIdentity, `jpeg-sha256:${createHash("sha256").update(data.buffer).digest("hex")}`);
    const metadata = await sharp(data.buffer).metadata(); assert.equal(metadata.width, 1080); assert.equal(metadata.height, 1920); assert.equal(metadata.format, "jpeg");
    const { data: pixel } = await sharp(data.buffer).extract({ left: 540, top: 960, width: 1, height: 1 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.ok(colors[index].every((value, channel) => Math.abs(pixel[channel] - value) < 15));
  }
  assert.deepEqual(await prepareMetaImageStoryPhotos(args), first); assert.equal(uploads, 5);
  const retry = await prepareMetaImageStoryPhotos({ ...args, publicationId: "new-retry-parent" });
  assert.deepEqual(retry.map(photo => photo.sourceIdentity), first.map(photo => photo.sourceIdentity));
  assert.ok(retry.every((photo, index) => photo.url !== first[index].url), "The content fingerprint must not depend on its new parent URL");
  const reversed = await prepareMetaImageStoryPhotos({ ...args, imageStoragePaths: [...sources].reverse() });
  assert.deepEqual(reversed.map(photo => photo.sourceIdentity), [...first].reverse().map(photo => photo.sourceIdentity));
  const before = uploads;
  await assert.rejects(prepareMetaImageStoryPhotos({ ...args, imageStoragePaths: [...sources, sources[0]] }), /source_invalid/);
  await assert.rejects(prepareMetaImageStoryPhotos({ ...args, signal: AbortSignal.abort() })); assert.equal(uploads, before);
});
