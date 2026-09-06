import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  inspectAiMediaVideoBufferLocally,
  inspectAiMediaVideoLocally,
  parseAiMediaVideoVisualQa,
} from "../../lib/aiMediaVideoLocalQa.ts";
import { resolveVideoNormalizationFfmpegPath } from "../../lib/mediaVideoNormalizer.ts";

const execFileAsync = promisify(execFile);

test("la détection visuelle ignore les fondus et plans éditoriaux courts", () => {
  const result = parseAiMediaVideoVisualQa(
    [
      "black_start:0 black_end:0.4 black_duration:0.4",
      "lavfi.freezedetect.freeze_start: 2",
      "lavfi.freezedetect.freeze_duration: 3",
      "lavfi.freezedetect.freeze_end: 5",
    ].join("\n"),
    8,
  );

  assert.equal(result.likelyBlack, false);
  assert.equal(result.likelyFrozen, false);
  assert.equal(result.blackSeconds, 0.4);
  assert.equal(result.longestFrozenSeconds, 3);
});

test("la détection visuelle signale seulement un défaut couvrant presque tout le film", () => {
  const black = parseAiMediaVideoVisualQa(
    "black_start:0 black_end:7.8 black_duration:7.8",
    8,
  );
  assert.equal(black.likelyBlack, true);
  assert.equal(black.likelyFrozen, false);

  const frozen = parseAiMediaVideoVisualQa(
    "lavfi.freezedetect.freeze_duration: 7.2",
    8,
  );
  assert.equal(frozen.likelyBlack, false);
  assert.equal(frozen.likelyFrozen, true);
});

test("une QA indisponible reste consultative et ne lève jamais d'échec utilisateur", async () => {
  const result = await inspectAiMediaVideoLocally({
    inputPath: path.join(tmpdir(), "inrcy-video-inexistant.mp4"),
    expectedDurationSeconds: 8,
    audioExpectation: "required",
    ffmpegPath: "inrcy-ffmpeg-inexistant",
    timeoutMs: 3_000,
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.blocking, false);
  assert.deepEqual(result.advisories, ["metadata_unavailable"]);
});

test("un Buffer vide reste lui aussi non bloquant et ne crée aucun fichier durable", async () => {
  const result = await inspectAiMediaVideoBufferLocally({
    buffer: new Uint8Array(),
    expectedDurationSeconds: 8,
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.blocking, false);
  assert.equal(result.metadata.expectedDurationSeconds, 8);
});

test("la QA locale valide rapidement une vraie vidéo animée avec audio", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "inrcy-video-qa-ok-"));
  const inputPath = path.join(directory, "moving-with-audio.mp4");
  const ffmpegPath = await resolveVideoNormalizationFfmpegPath();
  try {
    await execFileAsync(
      ffmpegPath,
      [
        "-y",
        "-hide_banner",
        "-nostdin",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=s=320x180:r=24:d=3",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=660:sample_rate=48000:duration=3",
        "-shortest",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        inputPath,
      ],
      { timeout: 30_000, windowsHide: true },
    );

    const result = await inspectAiMediaVideoBufferLocally({
      buffer: await readFile(inputPath),
      expectedDurationSeconds: 3,
      audioExpectation: "required",
      ffmpegPath,
    });
    assert.equal(result.status, "ok");
    assert.equal(result.blocking, false);
    assert.equal(result.metadata.hasAudio, true);
    assert.ok(Math.abs((result.metadata.durationSeconds || 0) - 3) <= 0.2);
    assert.equal(result.visual.scanned, true);
    assert.equal(result.visual.likelyBlack, false);
    assert.equal(result.visual.likelyFrozen, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("la QA locale remonte une vidéo noire et muette sans jamais la bloquer", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "inrcy-video-qa-black-"));
  const inputPath = path.join(directory, "black-silent.mp4");
  const ffmpegPath = await resolveVideoNormalizationFfmpegPath();
  try {
    await execFileAsync(
      ffmpegPath,
      [
        "-y",
        "-hide_banner",
        "-nostdin",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=320x180:r=24:d=6",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        "-an",
        inputPath,
      ],
      { timeout: 30_000, windowsHide: true },
    );

    const result = await inspectAiMediaVideoLocally({
      inputPath,
      expectedDurationSeconds: 6,
      audioExpectation: "required",
      ffmpegPath,
    });
    assert.equal(result.status, "advisory");
    assert.equal(result.blocking, false);
    assert.equal(result.metadata.hasAudio, false);
    assert.ok(result.advisories.includes("audio_stream_missing"));
    assert.ok(result.advisories.includes("mostly_black"));
    assert.equal(result.visual.likelyFrozen, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
