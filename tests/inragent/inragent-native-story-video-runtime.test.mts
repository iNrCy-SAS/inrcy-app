import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import sharp from "sharp";
import { runtimeModules } from "./runtime-module-loader.mts";

const run = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));

test("native Agent photos remain full frame for the entire Meta Story, with no inset or zoom; retries reuse the video", { timeout: 150_000 }, async () => {
  const stored = new Map<string, { buffer: Buffer; type: string }>();
  const photo = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="640"><rect width="360" height="640" fill="#2478b8"/><rect width="48" height="48" fill="#dc2828"/><rect x="312" width="48" height="48" fill="#22aa66"/><rect y="592" width="48" height="48" fill="#3355dd"/><rect x="312" y="592" width="48" height="48" fill="#ddaa22"/></svg>')).jpeg().toBuffer();
  stored.set("source.jpg", { buffer: photo, type: "image/jpeg" });
  const load = runtimeModules({
    "@/lib/supabaseAdmin": { supabaseAdmin: { storage: { from: () => ({
      getPublicUrl: (key: string) => ({ data: { publicUrl: `https://storage.example.test/${key}` } }),
      download: async (key: string) => {
        const item = stored.get(key);
        return item ? { data: new Blob([new Uint8Array(item.buffer)], { type: item.type }), error: null } : { data: null, error: { message: "missing" } };
      },
      upload: async (key: string, data: ArrayBuffer, options: { contentType: string }) => {
        stored.set(key, { buffer: Buffer.from(data), type: options.contentType });
        return { error: null };
      },
    }) } } },
    "@/lib/aiMediaGenerationSoundtracks": { loadAiMediaSoundtrack: async () => ({
      id: "fixture", sha256: "fixture-sha", absolutePath: path.join(root, "assets/media-generation/soundtracks/atelier-vivant-8s.wav"),
    }) },
  });
  const { createInstagramImageMotionVideo } = load<typeof import("../../lib/instagramImageMotionVideo.ts")>("lib/instagramImageMotionVideo.ts");
  const { resolveVideoNormalizationFfmpegPath } = load<typeof import("../../lib/mediaVideoNormalizer.ts")>("lib/mediaVideoNormalizer.ts");
  const ffmpeg = await resolveVideoNormalizationFfmpegPath();
  const args = { accountId: "account", publicationId: "publication", imageStoragePaths: ["source.jpg"], placement: "story" as const, soundtrackPrompt: "Atelier", preserveComposition: true };
  const created = await createInstagramImageMotionVideo(args);
  assert.equal(stored.size, 2);
  assert.equal((await createInstagramImageMotionVideo(args)).storagePath, created.storagePath);
  assert.equal(stored.size, 2);
  const temporary = await mkdtemp(path.join(tmpdir(), "inr-agent-story-proof-"));
  try {
    const videoPath = path.join(temporary, "story.mp4");
    await writeFile(videoPath, stored.get(created.storagePath!)!.buffer);
    for (const at of [0.5, 7.5]) {
      const framePath = path.join(temporary, `frame-${at}.png`);
      await run(ffmpeg!, ["-v", "error", "-y", "-ss", String(at), "-i", videoPath, "-frames:v", "1", "-vf", "scale=360:640", framePath], { windowsHide: true });
      const { data, info } = await sharp(await readFile(framePath)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      for (const [x, y, expected] of [[8, 8, [220, 40, 40]], [351, 8, [34, 170, 102]], [8, 631, [51, 85, 221]], [351, 631, [221, 170, 34]]] as Array<[number, number, number[]]>) {
        const offset = (y * info.width + x) * info.channels;
        assert.ok(expected.every((value, channel) => Math.abs(value - data[offset + channel]) < 20), `The complete corner ${x},${y} must remain visible at ${at}s`);
      }
    }
    stored.set("wrong.jpg", { buffer: await sharp(photo).resize(400, 600).jpeg().toBuffer(), type: "image/jpeg" });
    await assert.rejects(createInstagramImageMotionVideo({ ...args, imageStoragePaths: ["wrong.jpg"] }), /native_frame_mismatch/);
  } finally {
    const resolved = path.resolve(temporary);
    assert.ok(resolved.startsWith(path.resolve(tmpdir()) + path.sep));
    await rm(resolved, { recursive: true, force: true });
  }
});
