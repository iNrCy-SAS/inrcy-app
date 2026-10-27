import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import sharp from "sharp";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

const run = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));

for (const imageCount of [1, 2, 3, 5]) test(`${imageCount} Booster photos produce one complete ordered Meta motion video with constant frame rate, and retry reuses it`, { timeout: 180_000 }, async (context) => {
  const stored = new Map<string, { buffer: Buffer; type: string }>();
  const colors = [[220, 40, 40], [34, 170, 102], [51, 85, 221], [221, 170, 34], [165, 45, 190]].slice(0, imageCount);
  const paths = await Promise.all(colors.map(async (color, index) => {
    const key = `account/photo-${index}.jpg`;
    stored.set(key, { buffer: await sharp({ create: { width: index % 2 ? 600 : 400, height: index % 2 ? 400 : 600, channels: 3, background: { r: color[0], g: color[1], b: color[2] } } }).jpeg().toBuffer(), type: "image/jpeg" });
    return key;
  }));
  let uploads = 0;
  const load = runtimeModules({
    "@/lib/supabaseAdmin": { supabaseAdmin: { storage: { from: () => ({
      getPublicUrl: (key: string) => ({ data: { publicUrl: `https://storage.example.test/${key}` } }),
      download: async (key: string) => { const item = stored.get(key); return item ? { data: new Blob([new Uint8Array(item.buffer)], { type: item.type }), error: null } : { data: null, error: { message: "missing" } }; },
      upload: async (key: string, data: ArrayBuffer, options: { contentType: string; upsert: boolean }) => { assert.equal(options.upsert, false); uploads++; stored.set(key, { buffer: Buffer.from(data), type: options.contentType }); return { error: null }; },
    }) } } },
    "@/lib/aiMediaGenerationSoundtracks": { loadAiMediaSoundtrack: async () => ({ id: "fixture", sha256: "fixture-sha", absolutePath: path.join(root, "assets/media-generation/soundtracks/atelier-vivant-8s.wav") }) },
  });
  const { createFacebookImageMotionVideo } = load<typeof import("../../lib/facebookImageMotionVideo.ts")>("lib/facebookImageMotionVideo.ts");
  const { resolveVideoNormalizationFfmpegPath, probeVideoSource } = load<typeof import("../../lib/mediaVideoNormalizer.ts")>("lib/mediaVideoNormalizer.ts");
  if (imageCount === 1) {
    const enginePath = await resolveVideoNormalizationFfmpegPath(); assert.ok(enginePath);
    const engine = await run(enginePath, ["-version"], { windowsHide: true, timeout: 10_000 });
    context.diagnostic(engine.stdout.split(/\r?\n/)[0]);
  }
  const args = { accountId: "account", publicationId: `${imageCount}-photo-publication`, imageStoragePaths: paths, placement: "reel" as const, soundtrackPrompt: "Un atelier vivant" };
  const created = await createFacebookImageMotionVideo(args);
  assert.equal(created.duration, 8); assert.equal(created.sourceMetadata?.sourceImageCount, imageCount); assert.equal(uploads, 1);
  assert.equal(created.sourceMetadata?.source, "instagram-image-motion-v3-setpts-cfr");
  assert.equal((await createFacebookImageMotionVideo(args)).storagePath, created.storagePath); assert.equal(uploads, 1);
  const temporary = await mkdtemp(path.join(tmpdir(), "inrcy-five-photo-proof-"));
  try {
    const ffmpeg = await resolveVideoNormalizationFfmpegPath();
    const videoPath = path.join(temporary, "five-photos.mp4"); await writeFile(videoPath, stored.get(created.storagePath!)!.buffer);
    const probe = await probeVideoSource({ ffmpegPath: ffmpeg!, inputPath: videoPath, timeoutMs: 30_000 });
    assert.equal(probe.orientedWidth, 1080); assert.equal(probe.orientedHeight, 1920); assert.equal(probe.hasAudio, true); assert.ok(Math.abs(probe.durationSeconds - 8) < 0.15);
    assert.equal(probe.videoCodec, "h264"); assert.equal(probe.audioCodec, "aac"); assert.ok(Math.abs(probe.frameRate - 30) < 0.01);
    const clipDuration = (8 + 0.35 * (imageCount - 1)) / imageCount;
    const sampleTimes = colors.map((_, index) => index * (clipDuration - 0.35) + clipDuration / 2);
    for (const [index, at] of sampleTimes.entries()) {
      const frame = path.join(temporary, `frame-${index}.png`);
      await run(ffmpeg!, ["-v", "error", "-y", "-ss", String(at), "-i", videoPath, "-frames:v", "1", "-vf", "scale=108:192", frame], { windowsHide: true, timeout: 30_000 });
      const { data, info } = await sharp(await readFile(frame)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const offset = (96 * info.width + 54) * info.channels;
      assert.ok(colors[index].every((value, channel) => Math.abs(value - data[offset + channel]) < 25), `Photo ${index + 1} must appear in source order at ${at}s`);
    }
  } finally {
    const resolved = path.resolve(temporary); assert.ok(resolved.startsWith(path.resolve(tmpdir()) + path.sep));
    await rm(resolved, { recursive: true, force: true });
  }
});
