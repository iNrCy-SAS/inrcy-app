import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import ts from "typescript";
import * as fullFrame from "../../lib/aiMediaFullFrame.ts";
import * as subtitles from "../../lib/aiMediaNarrationSubtitles.ts";

function pcm(leadingSeconds: number, options: { quietDb?: number; activeDb?: number; burstOnly?: boolean; seconds?: number } = {}) {
  const sampleRate = 16_000, seconds = options.seconds ?? 3;
  const result = Buffer.alloc(Math.round(seconds * sampleRate) * 2);
  for (let index = 0; index < result.length / 2; index += 1) {
    const time = index / sampleRate;
    const active = time >= leadingSeconds && (!options.burstOnly || time < leadingSeconds + 0.02);
    const db = active ? options.activeDb ?? -15 : options.quietDb ?? -58;
    // RMS of a sinus is amplitude/sqrt2.
    const value = Math.sin(index / sampleRate * 2 * Math.PI * 400) * Math.SQRT2 * 10 ** (db / 20);
    result.writeInt16LE(Math.round(Math.max(-1, Math.min(0.999, value)) * 32768), index * 2);
  }
  return result;
}

test("a sustained strong onset after a quiet prefix gives a padded caption offset only", () => {
  const source = pcm(1.6), before = Buffer.from(source);
  assert.ok(Math.abs(subtitles.estimateAiMediaNarrationSubtitleStartSeconds(source) - 1.45) < 0.001);
  assert.deepEqual(source, before, "analysis never modifies its PCM input");
});

test("normal, absent, weak, uncertain, late or isolated activity retains zero offset", () => {
  for (const source of [pcm(0), Buffer.alloc(96_000), pcm(1.6, { activeDb: -42 }), pcm(1.6, { quietDb: -43 }),
    pcm(2.7), pcm(1.6, { burstOnly: true }), Buffer.alloc(7), Buffer.alloc(128_000)]) {
    assert.equal(subtitles.estimateAiMediaNarrationSubtitleStartSeconds(source), 0);
  }
});

function harness(options: { duration?: number; analysisError?: boolean; abortAnalysis?: boolean } = {}) {
  const duration = options.duration ?? 6.88, analysis = pcm(1.6), originalAudio = Buffer.from("exact-prepared-narration");
  const controller = new AbortController(), cancellation = new Error("caller-stopped");
  const analyses: Array<{ args: string[]; timeout: number }> = [];
  const renders: Array<{ captions: string | null; filter: string; narration: Buffer; duration: string }> = [];
  const nativeRequire = createRequire(import.meta.url);
  const fakeExec = (() => assert.fail("only the promisified local process boundary is allowed")) as unknown as typeof execFile;
  Object.defineProperty(fakeExec, promisify.custom, { value: async (_file: string, args: string[], execution: { timeout: number; cwd?: string }) => {
    if (args.includes("s16le")) {
      analyses.push({ args, timeout: execution.timeout });
      if (options.abortAnalysis) { controller.abort(cancellation); throw cancellation; }
      if (options.analysisError) throw new Error("local-analysis-unavailable");
      return { stdout: analysis, stderr: Buffer.alloc(0) };
    }
    if (args.includes("rawvideo")) return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    if (args.includes("null")) return { stdout: "", stderr: `Duration: 00:00:${duration.toFixed(2).padStart(5, "0")}, start:0` };
    assert.ok(args.includes("-filter_complex"), "no unreviewed local command");
    const filter = args[args.indexOf("-filter_complex") + 1];
    const cwd = execution.cwd!;
    renders.push({ captions: filter.includes("subtitles=filename=captions.ass") ? await readFile(path.join(cwd, "captions.ass"), "utf8") : null,
      filter, narration: await readFile(path.join(cwd, "narration.wav")), duration: args[args.indexOf("-t") + 1] });
    await writeFile(args.at(-1)!, Buffer.from("mock-container"));
    return { stdout: "", stderr: "" };
  } });
  const source = readFileSync(new URL("../../lib/aiMediaGeneratedVideo.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const record = { exports: {} as { composeOriginalAiVideo: (args: Record<string, unknown>) => Promise<unknown> } };
  const probe = { durationSeconds: 10, orientedWidth: 320, orientedHeight: 320, hasAudio: true,
    containerFormats: ["mp4"], videoCodec: "h264", pixelFormat: "yuv420p", frameRate: 30, audioCodec: "aac" };
  new Function("module", "exports", "require", compiled)(record, record.exports, (id: string) => {
    if (id === "server-only") return {};
    if (id === "node:child_process") return { execFile: fakeExec };
    if (id === "./aiMediaFullFrame.ts") return fullFrame;
    if (id === "./aiMediaNarrationSubtitles.ts") return subtitles;
    if (id === "@/lib/mediaVideoNormalizer") return { probeVideoSource: async () => probe, resolveVideoNormalizationFfmpegPath: async () => "local-ffmpeg" };
    if (id.startsWith("node:")) return nativeRequire(id);
    throw new Error("unexpected-test-dependency");
  });
  return { analyses, renders, originalAudio, cancellation, run: (captions = true) => record.exports.composeOriginalAiVideo({
    clips: [{ buffer: Buffer.from("owned-provider-clip"), durationSeconds: 10 }], overlays: [Buffer.from("transparent-overlay")],
    width: 320, height: 320, durationSeconds: 10, nativeAudioMode: "mute", signal: controller.signal,
    narration: { buffer: originalAudio, mimeType: "audio/wav", extension: "wav", model: "existing-clone", voice: "provided" },
    ...(captions ? { subtitles: { script: "Bonjour, nous vous aidons à créer un jardin agréable, adapté à vos envies." } } : {}),
  }) };
}

test("composition shifts only captions, preserves their end, audio filters and ten-second duration", async () => {
  const h = harness(); await h.run(true); await h.run(false);
  assert.equal(h.analyses.length, 1, "captions disabled never triggers energy decoding");
  assert.equal(h.analyses[0].timeout, 2000);
  assert.equal(h.analyses[0].args[h.analyses[0].args.indexOf("-t") + 1], "3");
  assert.match(h.renders[0].captions!, /Dialogue: 0,0:00:01\.45,/);
  assert.ok(h.renders[0].captions!.includes("0:00:06.88,Default"));
  assert.equal(h.renders[1].captions, null);
  for (const render of h.renders) {
    assert.deepEqual(render.narration, h.originalAudio);
    assert.equal(render.duration, "10");
  }
  const voice = (filter: string) => filter.split(";").find(part => part.endsWith("[voice]"));
  assert.equal(voice(h.renders[0].filter), voice(h.renders[1].filter), "caption timing never changes audio processing");
});

test("analysis errors keep the original zero-offset captions without another attempt", async () => {
  const h = harness({ analysisError: true }); await h.run();
  assert.equal(h.analyses.length, 1);
  assert.match(h.renders[0].captions!, /Dialogue: 0,0:00:00\.00,/);
});

test("the same existing tempo scales both the caption offset and measured end", async () => {
  const h = harness({ duration: 9.2 }); await h.run();
  const tempo = (9.2 + 0.16) / 8.8;
  const expected = subtitles.buildAiMediaNarrationSubtitlesAss({ script: "Bonjour, nous vous aidons à créer un jardin agréable, adapté à vos envies.",
    durationSeconds: 9.2 / tempo, startOffsetSeconds: 1.45 / tempo, width: 320, height: 320 });
  assert.equal(h.renders[0].captions, expected);
  assert.match(h.renders[0].filter, /atempo=1\.063636/);
});

test("a caller cancellation during analysis propagates before any render", async () => {
  const h = harness({ abortAnalysis: true });
  await assert.rejects(h.run(), error => error === h.cancellation);
  assert.equal(h.renders.length, 0);
});
