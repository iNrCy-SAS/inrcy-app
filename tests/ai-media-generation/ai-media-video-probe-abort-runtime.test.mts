import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import * as policy from "../../lib/mediaVideoNormalizationPolicy.ts";
import * as metadata from "../../lib/mediaVideoProbeMetadata.ts";

const stderr = "Input #0, mov,mp4, from 'local.mp4':\nDuration: 00:00:30.00, start: 0.000000\nStream #0:0: Video: h264, yuv420p, 1920x1080, 30 fps\n";
type Probe = typeof import("../../lib/mediaVideoNormalizer.ts").probeVideoSource;

function loadProbe(runProcess: (options: { signal?: AbortSignal; timeout: number }) => Promise<{ stderr: string }>): Probe {
  const nativeRequire = createRequire(import.meta.url);
  const execFile = () => { throw new Error("only the promisified process boundary may run"); };
  const dependencies: Record<string, unknown> = {
    "node:child_process": { execFile },
    "node:util": { promisify: (input: unknown) => { assert.equal(input, execFile); return (_file: string, _args: string[], options: { signal?: AbortSignal; timeout: number }) => runProcess(options); } },
    "./mediaVideoNormalizationPolicy.ts": policy,
    "./mediaVideoProbeMetadata.ts": metadata,
    "ffmpeg-static": "local-test-ffmpeg",
  };
  const output = ts.transpileModule(readFileSync(new URL("../../lib/mediaVideoNormalizer.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const record = { exports: {} as { probeVideoSource: Probe } };
  new Function("module", "exports", "require", output)(record, record.exports, (id: string) => {
    if (id in dependencies) return dependencies[id];
    assert.ok(id.startsWith("node:"), `unexpected dependency: ${id}`);
    return nativeRequire(id);
  });
  return record.exports.probeVideoSource;
}

test("an already expired composition signal prevents the video probe process from starting", async () => {
  let calls = 0;
  const probe = loadProbe(async () => { calls += 1; return { stderr }; });
  const controller = new AbortController(), reason = new Error("work_deadline"); controller.abort(reason);
  await assert.rejects(probe({ ffmpegPath: "local", inputPath: "local.mp4", signal: controller.signal }), error => error === reason);
  assert.equal(calls, 0);
});

test("cancelling the video probe aborts its process and cannot turn partial metadata into success", async () => {
  const controller = new AbortController(), reason = new Error("work_deadline");
  let calls = 0, observed: AbortSignal | undefined;
  const probe = loadProbe(options => {
    calls += 1; observed = options.signal; assert.equal(options.timeout, 60_000);
    return new Promise((_resolve, reject) => options.signal!.addEventListener("abort", () =>
      reject(Object.assign(new Error("process aborted"), { stderr })), { once: true }));
  });
  const pending = probe({ ffmpegPath: "local", inputPath: "local.mp4", timeoutMs: 60_000, signal: controller.signal });
  assert.equal(observed, controller.signal); controller.abort(reason);
  await assert.rejects(pending, error => error === reason); assert.equal(calls, 1);
});

test("an ordinary FFmpeg exit still accepts valid partial metadata when the composition was not cancelled", async () => {
  const controller = new AbortController();
  const probe = loadProbe(async options => {
    assert.equal(options.signal, controller.signal);
    throw Object.assign(new Error("ordinary ffmpeg probe exit"), { stderr });
  });
  const result = await probe({ ffmpegPath: "local", inputPath: "local.mp4", signal: controller.signal });
  assert.equal(result.durationSeconds, 30); assert.equal(result.orientedWidth, 1920); assert.equal(result.orientedHeight, 1080);
  assert.equal(result.probeProvenance, "server_ffmpeg"); assert.equal(controller.signal.aborted, false);
});
