import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import * as dialogue from "../../lib/aiMediaNativeDialogueQa.ts";

const line = "Nous accompagnons votre projet avec une écoute attentive et des conseils personnalisés.";
const cut = line.replace(" personnalisés.", "");

/** Execute the production adapter with virtual files, FFmpeg and Google; no network. */
function adapter(outcome: "complete" | "still-cut" | "deadline", firstComplete = false) {
  const files = new Map<string, Buffer>();
  const calls: Array<{ body: Record<string, unknown>; options: { timeout: number; maxRetries: number } }> = [];
  const reservations: Array<{ reservedOutputTokens: number }> = [];
  const qaDeadline = new AbortController(); let cleaned = 0; let extractions = 0;
  const modules = new Map<string, unknown>([
    ["server-only", {}],
    ["node:fs/promises", {
      mkdtemp: async () => "virtual-dialogue-qa",
      writeFile: async (name: string, bytes: Buffer) => { files.set(name, bytes); },
      readFile: async (name: string) => { assert.ok(files.has(name)); return files.get(name); },
      rm: async () => { cleaned++; files.clear(); },
    }],
    ["node:child_process", { execFile(_file: string, args: string[], _options: unknown, done: (error: null, stdout: string, stderr: string) => void) {
      extractions++; files.set(args.at(-1)!, Buffer.alloc(800)); done(null, "", "");
    } }],
    ["@google/genai", { GoogleGenAI: class {
      interactions = { create: async (body: Record<string, unknown>, options: { timeout: number; maxRetries: number }) => {
        calls.push({ body, options });
        assert.ok(calls.length <= 2, "At most one confirmation is allowed.");
        const prompt = (body.input as Array<{ type: string; text?: string }>).find((part) => part.type === "text")!.text!;
        assert.ok(!prompt.includes(line), "ASR never receives the expected script as a hint.");
        if (calls.length === 2 && outcome === "deadline") {
          qaDeadline.abort(); throw new DOMException("QA deadline", "AbortError");
        }
        const transcript = firstComplete || calls.length === 2 && outcome === "complete" ? line : cut;
        return { output_text: JSON.stringify({ transcript }), usage: { total_input_tokens: 10, total_output_tokens: 20, total_tokens: 30 } };
      } };
    } }],
    ["@/lib/aiMediaNativeDialogueQa", dialogue],
    ["@/lib/mediaVideoNormalizer", { resolveVideoNormalizationFfmpegPath: async () => "virtual-ffmpeg" }],
    ["@/lib/aiGatewayAccountGuard", {
      reserveAiGatewayAccountAttempt: async (_account: string, args: { reservedOutputTokens: number }) => { reservations.push(args); return {}; },
      commitAiGatewayAccountAttempt: async () => {}, rollbackAiGatewayAccountAttempt: async () => {}, recordAiGatewayAccountFailure: async () => {},
    }],
  ]);
  const output = ts.transpileModule(readFileSync(new URL("../../lib/aiMediaNativeDialogueQaGoogle.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const native = createRequire(import.meta.url);
  const record = { exports: {} as typeof import("../../lib/aiMediaNativeDialogueQaGoogle.ts") };
  new Function("module", "exports", "require", "process", "AbortSignal", output)(record, record.exports, (id: string) => {
    if (modules.has(id)) return modules.get(id);
    assert.ok(id.startsWith("node:"), `Unexpected production dependency: ${id}`); return native(id);
  }, { env: { GEMINI_API_KEY: "offline-test-only" } }, { timeout: () => qaDeadline.signal, any: AbortSignal.any });
  return { calls, reservations, cleaned: () => cleaned, extractions: () => extractions,
    audit: (durationSeconds = 8) => record.exports.auditAiMediaNativeDialogueWithGoogle({ accountId: "test-account", language: "fr", clips: [{ sceneIndex: 0, buffer: Buffer.from("synthetic-video"), mediaType: "video/mp4", durationSeconds, expectedLine: line }] }),
  };
}

test("Google confirmation reuses extracted audio and shares the existing deadline without a new video", async () => {
  const h = adapter("complete"); const result = await h.audit();
  assert.equal(result.status, "passed"); assert.equal(result.clips[0].confirmation, "passed");
  assert.equal(h.calls.length, 2); assert.equal(h.extractions(), 1); assert.equal(h.cleaned(), 1);
  assert.ok(h.calls.every((call) => call.options.maxRetries === 0 && call.options.timeout <= 8_000));
  assert.ok(h.calls[1].options.timeout <= h.calls[0].options.timeout);
  assert.equal(JSON.stringify(result).includes(line), false);
});

test("a confirmation QA deadline cannot turn an already rejected clip into unavailable", async () => {
  for (const outcome of ["still-cut", "deadline"] as const) {
    const h = adapter(outcome); const result = await h.audit();
    assert.equal(result.status, "rejected"); assert.ok(result.clips[0].issues.includes("spoken_dialogue_incomplete"));
    assert.equal(result.clips[0].confirmation, outcome === "deadline" ? "unavailable" : "rejected");
    assert.equal(h.calls.length, 2); assert.equal(h.cleaned(), 1);
  }
});

test("longer transcripts receive a bounded output allowance included in the account guard", async () => {
  const h = adapter("complete", true); assert.equal((await h.audit(30)).status, "passed");
  assert.equal(h.calls.length, 1); assert.equal(h.reservations[0].reservedOutputTokens, 360);
  assert.deepEqual(h.calls[0].body.generation_config, { max_output_tokens: 360 });
});
