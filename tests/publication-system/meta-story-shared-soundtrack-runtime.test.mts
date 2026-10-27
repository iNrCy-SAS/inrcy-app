import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import sharp from "sharp";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

const execute = promisify(execFile);

test("five four-second Stories and one fifteen-second Reel preserve the same original music asset and cached retries", { timeout: 240_000 }, async () => {
  const actual = runtimeModules();
  const { loadAiMediaSoundtrack } = actual<typeof import("../../lib/aiMediaGenerationSoundtracks.ts")>("lib/aiMediaGenerationSoundtracks.ts");
  const desiredSoundtrackId = "jazz-velours";
  const soundtrack = await loadAiMediaSoundtrack("Une ambiance chaleureuse pour un café artisanal", { selectionKey: "one-stable-story-series", durationSeconds: 24, soundtrackId: desiredSoundtrackId });
  assert.equal(soundtrack.id, desiredSoundtrackId);
  const media = new Map<string, { bytes: Buffer; type: string }>();
  const colors = [[220, 40, 40], [34, 170, 102], [51, 85, 221], [221, 170, 34], [165, 45, 190]];
  for (const [index, color] of colors.entries()) {
    media.set(`account/story-source-${index}.jpg`, { bytes: await sharp({ create: { width: 360, height: 640, channels: 3, background: { r: color[0], g: color[1], b: color[2] } } }).jpeg().toBuffer(), type: "image/jpeg" });
  }
  let uploads = 0;
  const load = runtimeModules({
    "@/lib/supabaseAdmin": { supabaseAdmin: { storage: { from: () => ({
      getPublicUrl: (key: string) => ({ data: { publicUrl: `https://storage.example.test/${key}` } }),
      download: async (key: string) => { const item = media.get(key); return item ? { data: new Blob([new Uint8Array(item.bytes)], { type: item.type }), error: null } : { data: null, error: { message: "missing" } }; },
      upload: async (key: string, bytes: ArrayBuffer, options: { contentType: string; upsert: boolean }) => { assert.equal(options.upsert, false); uploads++; media.set(key, { bytes: Buffer.from(bytes), type: options.contentType }); return { error: null }; },
    }) } } },
    "@/lib/aiMediaGenerationSoundtracks": { loadAiMediaSoundtrack: async (_prompt: string, options: { soundtrackId?: string }) => {
      assert.equal(options.soundtrackId, desiredSoundtrackId, "A manual choice must reach the actual video compositor");
      return soundtrack;
    } },
  });
  const { createInstagramImageMotionVideo } = load<typeof import("../../lib/instagramImageMotionVideo.ts")>("lib/instagramImageMotionVideo.ts");
  const { createFacebookImageMotionVideo } = load<typeof import("../../lib/facebookImageMotionVideo.ts")>("lib/facebookImageMotionVideo.ts");
  const { resolveVideoNormalizationFfmpegPath, probeVideoSource } = load<typeof import("../../lib/mediaVideoNormalizer.ts")>("lib/mediaVideoNormalizer.ts");
  const ffmpeg = await resolveVideoNormalizationFfmpegPath();
  assert.ok(ffmpeg);
  const directory = await mkdtemp(path.join(tmpdir(), "inrcy-story-music-proof-"));
  const audioHashes: string[] = [], storagePaths: string[] = [];
  let firstStoryPcm: Buffer | undefined;
  try {
    for (const [index, color] of colors.entries()) {
      const args = { accountId: "account", publicationId: `stable-sequence-${index}`, imageStoragePaths: [`account/story-source-${index}.jpg`], placement: "story" as const, soundtrackPrompt: `This individual Story must not select music ${index}`, loadedSoundtrack: soundtrack };
      const story = await createInstagramImageMotionVideo(args);
      assert.equal(story.duration, 4); assert.equal(story.sourceMetadata?.duration, 4); assert.equal(story.sourceMetadata?.soundtrackAssetDurationSeconds, 24);
      assert.equal(story.sourceMetadata?.sourceImageCount, 1);
      assert.equal(story.sourceMetadata?.soundtrackId, soundtrack.id);
      assert.ok(story.storagePath);
      storagePaths.push(story.storagePath);
      const stored = media.get(story.storagePath);
      assert.ok(stored);
      const videoPath = path.join(directory, `story-${index}.mp4`);
      await writeFile(videoPath, stored.bytes);
      const probe = await probeVideoSource({ ffmpegPath: ffmpeg, inputPath: videoPath, timeoutMs: 30_000 });
      assert.equal(probe.orientedWidth, 1080); assert.equal(probe.orientedHeight, 1920);
      assert.equal(probe.videoCodec, "h264"); assert.equal(probe.audioCodec, "aac");
      assert.ok(Math.abs(probe.durationSeconds - 4) < 0.15); assert.ok(Math.abs(probe.frameRate - 30) < 0.01);
      const pcmPath = path.join(directory, `story-${index}.pcm`);
      await execute(ffmpeg, ["-v", "error", "-y", "-i", videoPath, "-map", "0:a:0", "-ac", "2", "-ar", "48000", "-f", "s16le", pcmPath], { windowsHide: true, timeout: 30_000 });
      const pcm = await readFile(pcmPath);
      assert.ok(pcm.length > 48_000 * 4 * 3.8, "Each Story keeps its complete four-second audible track");
      assert.ok(pcm.some(byte => byte !== 0), "The encoded track must not be silent");
      audioHashes.push(createHash("sha256").update(pcm).digest("hex"));
      firstStoryPcm ??= pcm;
      const framePath = path.join(directory, `story-${index}.png`);
      await execute(ffmpeg, ["-v", "error", "-y", "-ss", "2", "-i", videoPath, "-frames:v", "1", "-vf", "scale=108:192", framePath], { windowsHide: true, timeout: 30_000 });
      const { data, info } = await sharp(await readFile(framePath)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const middle = (96 * info.width + 54) * info.channels;
      assert.ok(color.every((value, channel) => Math.abs(value - data[middle + channel]) < 25), `Story ${index + 1} must contain its own source image`);
      assert.equal((await createInstagramImageMotionVideo(args)).storagePath, story.storagePath, "Retry must reuse the same prepared clip");
    }
    assert.equal(new Set(storagePaths).size, 5, "Five selected images produce five distinct Story clips");
    assert.equal(new Set(audioHashes).size, 1, "All five Stories must encode the same musical samples");
    assert.equal(uploads, 5, "Cached retries must not render/upload replacement clips");
    const facebook = await createFacebookImageMotionVideo({ accountId: "account", publicationId: "stable-sequence-facebook", imageStoragePaths: ["account/story-source-0.jpg"], placement: "story", soundtrackPrompt: "A different prompt cannot replace the loaded series track", loadedSoundtrack: soundtrack });
    assert.equal(facebook.sourceMetadata?.soundtrackId, soundtrack.id);
    assert.ok(facebook.storagePath);
    const facebookMedia = media.get(facebook.storagePath); assert.ok(facebookMedia);
    const facebookPath = path.join(directory, "facebook-story.mp4"), facebookPcm = path.join(directory, "facebook-story.pcm");
    await writeFile(facebookPath, facebookMedia.bytes);
    await execute(ffmpeg, ["-v", "error", "-y", "-i", facebookPath, "-map", "0:a:0", "-ac", "2", "-ar", "48000", "-f", "s16le", facebookPcm], { windowsHide: true, timeout: 30_000 });
    assert.equal(createHash("sha256").update(await readFile(facebookPcm)).digest("hex"), audioHashes[0], "Facebook must preserve the injected series music too");
    const reel = await createInstagramImageMotionVideo({ accountId: "account", publicationId: "manual-five-image-reel", imageStoragePaths: colors.map((_, index) => `account/story-source-${index}.jpg`), placement: "reel", soundtrackPrompt: "This prompt must not override the manually selected music", soundtrackId: desiredSoundtrackId });
    assert.equal(reel.sourceMetadata?.soundtrackId, desiredSoundtrackId);
    assert.equal(reel.sourceMetadata?.sourceImageCount, 5);
    assert.equal(reel.duration, 15); assert.equal(reel.sourceMetadata?.soundtrackAssetDurationSeconds, 24);
    assert.ok(reel.storagePath);
    const reelMedia = media.get(reel.storagePath); assert.ok(reelMedia);
    const reelPath = path.join(directory, "five-image-reel.mp4"), reelPcm = path.join(directory, "five-image-reel.pcm");
    await writeFile(reelPath, reelMedia.bytes);
    const reelProbe = await probeVideoSource({ ffmpegPath: ffmpeg, inputPath: reelPath, timeoutMs: 30_000 });
    assert.ok(Math.abs(reelProbe.durationSeconds - 15) < 0.15); assert.equal(reelProbe.videoCodec, "h264"); assert.equal(reelProbe.audioCodec, "aac"); assert.ok(Math.abs(reelProbe.frameRate - 30) < 0.01);
    await execute(ffmpeg, ["-v", "error", "-y", "-i", reelPath, "-map", "0:a:0", "-ac", "2", "-ar", "48000", "-f", "s16le", reelPcm], { windowsHide: true, timeout: 30_000 });
    const reelAudio = await readFile(reelPcm); assert.ok(reelAudio.length > 48_000 * 4 * 14.8); assert.ok(firstStoryPcm);
    // End fades follow each clip's duration; the shared musical beginning is
    // identical before the four-second Story starts fading out at 3.2 seconds.
    assert.deepEqual(reelAudio.subarray(0, 48_000 * 4 * 3), firstStoryPcm.subarray(0, 48_000 * 4 * 3), "Stories and Reel must start with the same source music, despite their different total durations");
  } finally {
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(resolved).startsWith("inrcy-story-music-proof-"));
    await rm(resolved, { recursive: true, force: true });
  }
});
