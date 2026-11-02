import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  normalizeVideoSource,
  probeVideoSource,
  resolveVideoNormalizationFfmpegPath,
} from "../../lib/mediaVideoNormalizer.ts";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

const run = promisify(execFile);

test("canonical conversion bounds cadence while preserving duration, audio and orientation", { timeout: 150_000 }, async (t) => {
  const temporary = await mkdtemp(path.join(tmpdir(), "inrcy-video-cadence-"));
  const ffmpegPath = await resolveVideoNormalizationFfmpegPath();
  try {
    const fixtures: Array<{
      name: string;
      inputRate: string;
      filter?: string;
      expectedRate?: number;
      audio?: boolean;
      portrait?: boolean;
      rotation?: number;
      missingRate?: boolean;
      codec?: "libx264";
    }> = [
      {
        name: "variable-phone",
        inputRate: "120",
        filter: "select=not(mod(n\\,4))+eq(n\\,1)+eq(n\\,2)",
        audio: true,
      },
      { name: "fractional-29-97", inputRate: "30000/1001", expectedRate: 29.97, audio: true },
      { name: "fractional-23-976-silent-portrait", inputRate: "24000/1001", expectedRate: 23.976, portrait: true },
      { name: "sixty", inputRate: "60", expectedRate: 60, audio: true },
      { name: "high-speed", inputRate: "120", expectedRate: 60 },
      { name: "rotated-mov", inputRate: "25", expectedRate: 25, audio: true, rotation: 90 },
      { name: "missing-rate", inputRate: "30000/1001", expectedRate: 30, audio: true, missingRate: true },
      { name: "compatible-copy", inputRate: "30000/1001", expectedRate: 29.97, audio: true, codec: "libx264" },
    ];
    for (const fixture of fixtures) await t.test(fixture.name, async () => {
      const inputPath = path.join(temporary, `${fixture.name}.mp4`);
      const encodedPath = fixture.rotation ? path.join(temporary, `${fixture.name}-source.mp4`) : inputPath;
      await run(ffmpegPath, [
        "-y", "-v", "error",
        "-f", "lavfi", "-i", `testsrc2=size=${fixture.portrait ? "90x160" : "160x90"}:rate=${fixture.inputRate}:duration=2`,
        ...(fixture.audio ? ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2"] : []),
        ...(fixture.filter ? ["-vf", fixture.filter] : []),
        "-fps_mode", "vfr", "-c:v", fixture.codec || "libx265", "-preset", "ultrafast",
        "-threads", "1",
        ...(fixture.codec ? [] : ["-x265-params", "log-level=error:pools=1:frame-threads=1"]),
        ...(fixture.audio ? ["-c:a", "aac", "-shortest"] : ["-an"]), encodedPath,
      ], { windowsHide: true, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
      if (fixture.rotation) {
        await run(ffmpegPath, ["-y", "-v", "error", "-display_rotation", String(fixture.rotation), "-i", encodedPath, "-c", "copy", inputPath], { windowsHide: true, timeout: 30_000 });
      }
      const source = await probeVideoSource({ ffmpegPath, inputPath });
      assert.equal(source.videoCodec, fixture.codec ? "h264" : "hevc");
      if (fixture.rotation) assert.equal(Math.abs(source.rotationDegrees), fixture.rotation);
      if (fixture.filter) {
        assert.ok(source.frameRate > 25 && source.frameRate < 40);
        const inspected = await run(ffmpegPath, ["-hide_banner", "-i", inputPath, "-frames:v", "1", "-f", "null", "-"], { windowsHide: true });
        assert.match(inspected.stderr, /120 tbr/, "The fixture must exercise the misleading container rate");
      }

      // Exercise a missing source cadence without replacing the encoder: only
      // the input probe's optional fps token is removed; all media work is real.
      const normalize = fixture.missingRate ? runtimeModules({
        "node:util": { promisify: () => async (...args: Parameters<typeof run>) => {
          const inspected = await run(...args);
          const command = args[1] as string[];
          return command.includes(inputPath) && command.includes("null")
            ? { ...inspected, stderr: String(inspected.stderr).replace(/\d+(?:\.\d+)? fps,?\s*/g, "") }
            : inspected;
        } },
      })<typeof import("../../lib/mediaVideoNormalizer.ts")>("lib/mediaVideoNormalizer.ts").normalizeVideoSource : normalizeVideoSource;
      const normalized = await normalize({
        inputPath,
        outputDirectory: path.join(temporary, fixture.name),
        keys: ["canonical"],
      });
      if (fixture.missingRate) assert.equal(normalized.source.frameRate, 0);
      const canonical = normalized.variants.canonical;
      assert.ok(canonical?.available && canonical.filePath);
      assert.equal(canonical.metadata.conversion_mode, fixture.codec ? "stream_copy" : "full_transcode");
      const output = await probeVideoSource({ ffmpegPath, inputPath: canonical.filePath });
      assert.equal(output.videoCodec, "h264");
      assert.equal(output.audioCodec, fixture.audio ? "aac" : "none");
      assert.equal(output.hasAudio, Boolean(fixture.audio));
      assert.equal(output.pixelFormat, "yuv420p");
      assert.equal(output.orientedWidth, source.orientedWidth);
      assert.equal(output.orientedHeight, source.orientedHeight);
      assert.ok(output.frameRate <= 60 && output.frameRate > 0);
      assert.ok(Math.abs(output.frameRate - (fixture.expectedRate ?? source.frameRate)) < 0.02);
      assert.ok(Math.abs(output.durationSeconds - source.durationSeconds) < 0.15, "Cadence normalization must preserve playback duration and audio");
    });
  } finally {
    const resolved = path.resolve(temporary);
    assert.ok(resolved.startsWith(path.resolve(tmpdir()) + path.sep));
    await rm(resolved, { recursive: true, force: true });
  }
});
