import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import sharp from "sharp";
import type * as Video from "../../lib/inrAssistantAttachmentVideo.ts";

const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(12)]);
const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x83, 0x42, 0x82, 0x80]);
const classicMov = Buffer.concat([Buffer.from([0, 0, 0, 8]), Buffer.from("wide"), Buffer.alloc(16)]);
async function harness(options: { failedFrame?: number; duration?: number; noAudio?: boolean; abortAfterProbe?: AbortController; demuxer?: "mov" | "matroska" } = {}) {
  const jpeg = await sharp({ create: { width: 16, height: 16, channels: 3, background: "blue" } }).jpeg().toBuffer();
  const files = new Map<string, Buffer>();
  const commands: string[][] = [], cleaned: string[] = [], probes: string[][] = [];
  let resolved = 0;
  const folder = path.join("C:\\private-tmp", "inrcy-assistant-video-fixture");
  const dependencies: Record<string, unknown> = {
    "server-only": {}, "node:child_process": { execFile: () => undefined },
    "node:fs/promises": {
      mkdtemp: async () => folder,
      writeFile: async (name: string, bytes: Buffer) => { files.set(name, bytes); },
      readFile: async (name: string) => { assert.ok(files.has(name)); return files.get(name); },
      stat: async (name: string) => ({ size: files.get(name)?.length ?? 0 }),
      rm: async (name: string) => { cleaned.push(name); },
    },
    "node:os": { tmpdir: () => "C:\\private-tmp" }, "node:path": path,
    "node:util": { promisify: () => async (_ffmpeg: string, command: string[], limits: { timeout: number; maxBuffer: number; windowsHide: boolean; signal: AbortSignal }) => {
      limits.signal?.throwIfAborted();
      commands.push(command);
      assert.equal(command[command.indexOf("-protocol_whitelist") + 1], "file,pipe");
      assert.equal(command[command.indexOf("-f") + 1], options.demuxer ?? "mov");
      assert.ok(command.indexOf("-f") < command.indexOf("-i"), "Input demuxer must precede every input");
      if ((options.demuxer ?? "mov") === "mov") {
        assert.equal(command[command.indexOf("-enable_drefs") + 1], "0");
        assert.equal(command[command.indexOf("-use_absolute_path") + 1], "0");
      }
      assert.equal(command[command.indexOf("-i") + 1], path.join(folder, "source.video"));
      assert.equal(limits.windowsHide, true); assert.ok(limits.timeout <= 15_000); assert.ok(limits.maxBuffer <= 256_000);
      assert.equal(command.some(arg => /^https?:|^concat:/i.test(arg)), false);
      const output = command.at(-1)!;
      if (options.failedFrame !== undefined && output.endsWith(`frame-${options.failedFrame}.jpg`)) throw new Error("frame_unavailable");
      files.set(output, output.endsWith(".mp3") ? Buffer.from("ID3" + "A".repeat(1000)) : jpeg);
    } },
    "sharp": sharp,
    "./mediaVideoNormalizer.ts": {
      resolveVideoNormalizationFfmpegPath: async () => { resolved += 1; return "ffmpeg-local"; },
      probeVideoSource: async (args: { inputPath: string; inputOptions: string[]; timeoutMs: number }) => {
        probes.push(args.inputOptions);
        assert.equal(args.inputPath, path.join(folder, "source.video"));
        assert.equal(args.inputOptions[args.inputOptions.indexOf("-protocol_whitelist") + 1], "file,pipe");
        assert.equal(args.inputOptions[args.inputOptions.indexOf("-f") + 1], options.demuxer ?? "mov");
        assert.equal(args.timeoutMs, 8000);
        options.abortAfterProbe?.abort();
        return { durationSeconds: options.duration ?? 600, hasAudio: !options.noAudio };
      },
    },
  };
  const source = readFileSync(new URL("../../lib/inrAssistantAttachmentVideo.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const record = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, { Buffer, File, Uint8Array })((name: string) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name];
  }, record, record.exports);
  return { api: record.exports as typeof Video, commands, probes, cleaned, folder, resolved: () => resolved };
}

test("local video samples span the measured clip and speech extraction stops after five minutes", async () => {
  const h = await harness();
  const result = await h.api.prepareAssistantVideoAnalysis({ buffer: mp4, mimeType: "video/mp4", signal: AbortSignal.timeout(10000) });
  assert.deepEqual(Array.from(result.frames, frame => frame.timeSeconds), [0, 300, 599.85]);
  assert.ok(result.frames.every(frame => Buffer.from(frame.image, "base64").length <= 110_000));
  assert.equal(result.audioDurationSeconds, 300); assert.equal(result.audio?.type, "audio/mpeg");
  const speech = h.commands.find(command => command.at(-1)?.endsWith(".mp3"))!;
  assert.equal(speech[speech.indexOf("-t") + 1], "300");
  assert.deepEqual(h.cleaned, [h.folder]);
});

test("a failed frame keeps the remaining timestamped evidence and does not invent an audio stream", async () => {
  const h = await harness({ failedFrame: 1, noAudio: true, duration: 20 });
  const result = await h.api.prepareAssistantVideoAnalysis({ buffer: mp4, mimeType: "video/mp4" });
  assert.deepEqual(Array.from(result.frames, frame => frame.timeSeconds), [0, 19.85]);
  assert.equal(result.hasAudio, false); assert.equal(result.audio, undefined);
  assert.equal(h.commands.length, 3); assert.deepEqual(h.cleaned, [h.folder]);
});

test("invalid duration and oversized or aborted inputs cannot start unbounded decoding", async () => {
  const h = await harness({ duration: 0 });
  assert.throws(() => h.api.assistantVideoSampleTimes(0)); assert.throws(() => h.api.assistantVideoSampleTimes(Infinity));
  assert.throws(() => h.api.assistantVideoSampleTimes(86_401));
  await assert.rejects(h.api.prepareAssistantVideoAnalysis({ buffer: Buffer.alloc(20 * 1024 * 1024 + 1), mimeType: "video/mp4" }));
  await assert.rejects(h.api.prepareAssistantVideoAnalysis({ buffer: mp4, mimeType: "video/mp4", signal: AbortSignal.abort() }));
  await assert.rejects(h.api.prepareAssistantVideoAnalysis({ buffer: mp4, mimeType: "video/mp4" }));
  assert.equal(h.commands.length, 0); assert.deepEqual(h.cleaned, [h.folder]);
});

test("expiry after a successful local probe preserves honest partial metadata without more decoding", async () => {
  const controller = new AbortController(), h = await harness({ abortAfterProbe: controller });
  const result = await h.api.prepareAssistantVideoAnalysis({ buffer: mp4, mimeType: "video/mp4", signal: controller.signal });
  assert.equal(result.durationSeconds, 600); assert.equal(result.frames.length, 0); assert.equal(result.hasAudio, true);
  assert.equal(result.audio, undefined); assert.equal(h.commands.length, 0); assert.deepEqual(h.cleaned, [h.folder]);
});

test("WebM and QuickTime containers force their finite demuxer on probe, all frames and audio", async () => {
  for (const fixture of [{ buffer: webm, mimeType: "video/webm", demuxer: "matroska" as const }, { buffer: mp4, mimeType: "video/quicktime", demuxer: "mov" as const }, { buffer: classicMov, mimeType: "video/quicktime", demuxer: "mov" as const }]) {
    const h = await harness({ demuxer: fixture.demuxer });
    const result = await h.api.prepareAssistantVideoAnalysis(fixture);
    assert.equal(result.frames.length, 3); assert.ok(result.audio); assert.equal(h.probes.length, 1); assert.equal(h.commands.length, 4);
    for (const command of h.commands) {
      const forced = command.slice(command.indexOf("-protocol_whitelist"), command.indexOf("-i"));
      assert.equal(forced.join("|"), h.probes[0].join("|"));
    }
  }
});

test("renamed playlists, unknown formats and MIME/signature mismatches are refused before any spawn", async () => {
  const h = await harness();
  for (const fixture of [
    { buffer: Buffer.from("#EXTM3U\n#EXTINF:1,\nfile:///C:/private/secret.mp4\n"), mimeType: "video/mp4" },
    { buffer: Buffer.from("ffconcat version 1.0\nfile 'C:/private/secret.mov'\n"), mimeType: "video/quicktime" },
    { buffer: Buffer.from("#EXTM3U\nfile:///etc/passwd\n"), mimeType: "video/webm" },
    { buffer: Buffer.from("unknown-container"), mimeType: "video/mp4" },
    { buffer: mp4, mimeType: "video/webm" }, { buffer: webm, mimeType: "video/mp4" },
    { buffer: mp4, mimeType: "application/octet-stream" },
    { buffer: Buffer.concat([Buffer.from([0, 0, 0, 99]), Buffer.from("ftypisom"), Buffer.alloc(12)]), mimeType: "video/mp4" },
  ]) await assert.rejects(h.api.prepareAssistantVideoAnalysis(fixture), /assistant_video_format_invalid/);
  assert.equal(h.resolved(), 0); assert.equal(h.probes.length, 0); assert.equal(h.commands.length, 0); assert.equal(h.cleaned.length, 0);
});
