import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import sharp from "sharp";

import { extractAiMediaVideoContinuityFrame } from "../../lib/aiMediaVideoContinuity.ts";
import { resolveVideoNormalizationFfmpegPath } from "../../lib/mediaVideoNormalizer.ts";

const execFileAsync = promisify(execFile);

test("le raccord utilise la dernière vraie frame de l'acte, y compris dans une vidéo cumulée", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "inrcy-continuity-test-"));
  const sourcePath = path.join(directory, "synthetic-three-acts.mp4");
  try {
    const ffmpegPath = await resolveVideoNormalizationFfmpegPath();
    // 0–8 s rouge; 8–15,9 s vert; dernière frame du second acte bleue;
    // 16–24 s jaune. Ni la première frame ni celle de l'acte suivant ne
    // peuvent donc être prises pour la dernière frame bleue attendue.
    await execFileAsync(ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      "-f", "lavfi", "-i", "color=c=red:s=160x90:r=10:d=8",
      "-f", "lavfi", "-i", "color=c=lime:s=160x90:r=10:d=7.9",
      "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=10:d=0.1",
      "-f", "lavfi", "-i", "color=c=yellow:s=160x90:r=10:d=8",
      "-filter_complex", "[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0[out]",
      "-map", "[out]", "-an", "-c:v", "libx264", "-preset", "ultrafast",
      "-pix_fmt", "yuv420p", sourcePath,
    ], { timeout: 30_000, windowsHide: true });
    const buffer = await readFile(sourcePath);

    const frame = await extractAiMediaVideoContinuityFrame({
      buffer,
      sourceStartSeconds: 8,
      durationSeconds: 8,
    });
    assert.equal(frame.mimeType, "image/jpeg");
    const image = Buffer.from(frame.data, "base64");
    assert.equal(image[0], 0xff);
    assert.equal(image[1], 0xd8);
    const metadata = await sharp(image).metadata();
    assert.equal(metadata.format, "jpeg");
    assert.ok((metadata.width || 0) <= 1280);
    assert.ok((metadata.height || 0) <= 1280);
    const stats = await sharp(image).stats();
    assert.ok(stats.channels[2]!.mean > 200, "dernière frame bleue conservée");
    assert.ok(stats.channels[0]!.mean < 40, "pas la première frame rouge ou l'acte jaune suivant");
    assert.ok(stats.channels[1]!.mean < 40, "pas la première frame verte de la dernière seconde");

    const firstAct = await extractAiMediaVideoContinuityFrame({ buffer, durationSeconds: 8 });
    const firstStats = await sharp(Buffer.from(firstAct.data, "base64")).stats();
    assert.ok(firstStats.channels[0]!.mean > 200, "sourceStart omis vise le premier acte rouge");
    assert.ok(firstStats.channels[1]!.mean < 40);
    assert.ok(firstStats.channels[2]!.mean < 40);

    await assert.rejects(
      extractAiMediaVideoContinuityFrame({ buffer, sourceStartSeconds: 40, durationSeconds: 8 }),
      { message: "ai_video_continuity_frame_unavailable" },
      "une plage sans frame ne peut pas réutiliser une ancienne image",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("le raccord refuse les tailles et temps invalides avant de lancer FFmpeg", async () => {
  await assert.rejects(
    extractAiMediaVideoContinuityFrame({ buffer: Buffer.alloc(0), durationSeconds: 8 }),
    { message: "ai_video_continuity_source_invalid" },
  );
  await assert.rejects(
    extractAiMediaVideoContinuityFrame({ buffer: Buffer.alloc(128 * 1024 * 1024 + 1), durationSeconds: 8 }),
    { message: "ai_video_continuity_source_invalid" },
  );
  for (const durationSeconds of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(
      extractAiMediaVideoContinuityFrame({ buffer: Buffer.from("fixture"), durationSeconds }),
      { message: "ai_video_continuity_source_invalid" },
    );
  }
  for (const sourceStartSeconds of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(
      extractAiMediaVideoContinuityFrame({ buffer: Buffer.from("fixture"), durationSeconds: 8, sourceStartSeconds }),
      { message: "ai_video_continuity_source_invalid" },
    );
  }
});

test("une annulation déjà reçue est propagée immédiatement", async () => {
  await assert.rejects(
    extractAiMediaVideoContinuityFrame({
      buffer: Buffer.alloc(0),
      durationSeconds: 8,
      signal: AbortSignal.abort(),
    }),
    { name: "AbortError" },
  );
});
