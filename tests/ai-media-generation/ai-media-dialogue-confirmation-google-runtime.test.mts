import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import * as dialogue from "../../lib/aiMediaNativeDialogueQa.ts";
import { extractAiMediaPronunciationAliases, type AiMediaPronunciationAlias } from "../../lib/aiMediaPronunciation.ts";

const line = "Nous accompagnons votre projet avec une écoute attentive et des conseils personnalisés.";
const cut = line.replace(" personnalisés.", "");

/** Execute the production adapter with virtual files, FFmpeg and Google; no network. */
function adapter(outcome: "complete" | "still-cut" | "deadline", firstComplete = false, overrides: {
  expectedLine?: string;
  firstTranscript?: string;
  secondTranscript?: string;
  pronunciationAliases?: readonly AiMediaPronunciationAlias[];
  expectedContinuation?: boolean;
  thirdTranscript?: string;
  pronunciationStatus?: "verified" | "rejected" | "unavailable" | "invalid" | "deadline";
} = {}) {
  const expectedLine = overrides.expectedLine ?? line;
  const firstTranscript = overrides.firstTranscript ?? cut;
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
        assert.ok(calls.length <= 3, "At most three bounded audio checks are allowed.");
        const prompt = (body.input as Array<{ type: string; text?: string }>).find((part) => part.type === "text")!.text!;
        const schema = (body.response_format as { schema: { properties: Record<string, unknown> } }).schema;
        if (schema.properties.status) {
          assert.equal(calls.length, 3, "Name verification follows two blind transcripts.");
          assert.ok(!prompt.includes(expectedLine), "Name verification receives no full script.");
          assert.ok(!prompt.includes(firstTranscript), "Name verification receives no full transcript.");
          if (overrides.pronunciationStatus === "deadline") {
            qaDeadline.abort(); throw new DOMException("QA deadline", "AbortError");
          }
          return { output_text: JSON.stringify({ status: overrides.pronunciationStatus ?? "unavailable" }), usage: { total_input_tokens: 10, total_output_tokens: 20, total_tokens: 30 } };
        }
        assert.ok(!prompt.includes(expectedLine), "ASR never receives the expected script as a hint.");
        assert.ok(!prompt.includes(firstTranscript), "Confirmation never receives the first transcript as a hint.");
        if (calls.length === 2 && outcome === "deadline") {
          qaDeadline.abort(); throw new DOMException("QA deadline", "AbortError");
        }
        const transcript = calls.length === 3 ? overrides.thirdTranscript ?? firstTranscript : firstComplete ? expectedLine : calls.length === 2
          ? overrides.secondTranscript ?? (outcome === "complete" ? expectedLine : firstTranscript)
          : firstTranscript;
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
    audit: (durationSeconds = 8) => record.exports.auditAiMediaNativeDialogueWithGoogle({ accountId: "test-account", language: "fr", pronunciationAliases: overrides.pronunciationAliases, clips: [{ sceneIndex: 0, buffer: Buffer.from("synthetic-video"), mediaType: "video/mp4", durationSeconds, expectedLine, expectedContinuation: overrides.expectedContinuation }] }),
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

test("a confirmation QA deadline leaves a first rejection inconclusive instead of rejecting the video", async () => {
  for (const outcome of ["still-cut", "deadline"] as const) {
    const h = adapter(outcome); const result = await h.audit();
    assert.equal(result.status, outcome === "deadline" ? "unavailable" : "rejected");
    assert.ok(result.clips[0].issues.includes(outcome === "deadline" ? "transcription_unavailable" : "spoken_dialogue_incomplete"));
    assert.equal(result.clips[0].confirmation, outcome === "deadline" ? "unavailable" : "rejected");
    assert.equal(h.calls.length, 2); assert.equal(h.cleaned(), 1);
  }
});

test("Google confirms a mistaken brand name from audio only without changing the video", async () => {
  const expectedLine = "Je suis Océane et je représente iNrCy pour accompagner votre entreprise.";
  const h = adapter("complete", false, {
    expectedLine,
    firstTranscript: expectedLine.replace("iNrCy", "inertie"),
    thirdTranscript: expectedLine,
  });
  const result = await h.audit();
  assert.equal(result.status, "passed");
  assert.equal(result.clips[0].confirmation, "passed");
  assert.equal(h.calls.length, 3);
  assert.equal(h.extractions(), 1);
  assert.equal(h.cleaned(), 1);
  assert.doesNotMatch(JSON.stringify(result), /Océane|iNrCy|inertie/);
});

test("explicit pronunciation aliases stay in local comparison and never enter the Google ASR request", async () => {
  const expectedLine = "Je suis Océane et je représente iNrCy pour accompagner votre entreprise.";
  const h = adapter("still-cut", false, {
    expectedLine,
    firstTranscript: expectedLine.replace("iNrCy", "inertie"),
    pronunciationAliases: extractAiMediaPronunciationAliases("iNrCy se prononce « inertie »."),
  });
  const result = await h.audit();
  assert.equal(result.status, "passed");
  assert.equal(h.calls.length, 1);
  assert.equal(h.extractions(), 1);
  assert.doesNotMatch(JSON.stringify(h.calls[0].body), /iNrCy|inertie|pronunciationAliases/);
  assert.doesNotMatch(JSON.stringify(result), /iNrCy|inertie|pronunciationalias/);
});

test("a planned internal fragment is compared locally without seeding the Google transcript", async () => {
  const expectedLine = "Notre outil facilite la création de";
  const h = adapter("still-cut", true, { expectedLine, firstTranscript: expectedLine, expectedContinuation: true });
  const result = await h.audit();
  assert.equal(result.status, "passed");
  assert.equal(h.calls.length, 1);
  assert.equal(h.extractions(), 1);
  assert.ok(!JSON.stringify(h.calls[0].body).includes(expectedLine));
  assert.ok(!JSON.stringify(h.calls[0].body).includes("expectedContinuation"));
});

test("Google confirms a real wrong amount but leaves two contradictory amounts inconclusive", async () => {
  const expectedLine = "Notre offre reste disponible pour votre entreprise au tarif de 50 euros seulement.";
  for (const secondAmount of ["500", "5000"]) {
    const h = adapter("still-cut", false, {
      expectedLine,
      firstTranscript: expectedLine.replace("50", "500"),
      secondTranscript: expectedLine.replace("50", secondAmount),
    });
    const result = await h.audit();
    assert.equal(result.status, secondAmount === "500" ? "rejected" : "unavailable");
    assert.deepEqual(result.clips[0].issues, [secondAmount === "500" ? "spoken_critical_value_mismatch" : "transcription_inconclusive"]);
    assert.equal(h.calls.length, 2);
    assert.equal(h.extractions(), 1);
    assert.equal(h.cleaned(), 1);
  }
});

test("longer transcripts receive a bounded output allowance included in the account guard", async () => {
  const h = adapter("complete", true); assert.equal((await h.audit(30)).status, "passed");
  assert.equal(h.calls.length, 1); assert.equal(h.reservations[0].reservedOutputTokens, 360);
  assert.deepEqual(h.calls[0].body.generation_config, { max_output_tokens: 360 });
});

test("isolated brand verification reuses the audio, never seeds ASR, and has a finite shared budget", async () => {
  const expectedLine = "Notre module iNrSearch augmente votre visibilité sur les moteurs intelligents.";
  const heard = expectedLine.replace("iNrSearch", "Inner Search");
  const h = adapter("still-cut", false, { expectedLine, firstTranscript: heard, secondTranscript: heard, pronunciationStatus: "verified" });
  const result = await h.audit(15);
  assert.equal(result.status, "passed");
  assert.equal(result.clips[0].pronunciationVerification, "verified");
  assert.equal(h.calls.length, 3); assert.equal(h.extractions(), 1); assert.equal(h.cleaned(), 1);
  assert.ok(h.calls.every((call) => call.options.maxRetries === 0 && call.options.timeout <= 8_000 && call.body.store === false));
  assert.ok(h.calls[2].options.timeout <= h.calls[1].options.timeout);
  assert.ok(h.calls.slice(0, 2).every((call) => !JSON.stringify(call.body).includes("iNrSearch")));
  assert.equal(h.reservations.length, 3);
  assert.equal(h.reservations[2].reservedOutputTokens, 128);
  assert.doesNotMatch(JSON.stringify(result), /Inner|Search|iNrSearch|transcript|pronunciationalias/);
});

test("negative, uncertain, malformed and timed-out name checks never authorize delivery", async () => {
  const expectedLine = "Notre module iNrSearch augmente votre visibilité sur les moteurs intelligents.";
  const heard = expectedLine.replace("iNrSearch", "Inner Search");
  for (const pronunciationStatus of ["rejected", "unavailable", "invalid", "deadline"] as const) {
    const h = adapter("still-cut", false, { expectedLine, firstTranscript: heard, secondTranscript: heard, pronunciationStatus });
    const result = await h.audit(15);
    assert.equal(result.status, pronunciationStatus === "rejected" ? "rejected" : "unavailable");
    assert.equal(h.calls.length, 3); assert.equal(h.cleaned(), 1);
  }
});

test("a contradictory critical value requires two conforming blind reads and never invokes name verification", async () => {
  const expectedLine = "Notre offre reste disponible pour votre entreprise au tarif de 50 euros seulement.";
  for (const thirdTranscript of [expectedLine, expectedLine.replace("50", "500")]) {
    const h = adapter("complete", false, { expectedLine, firstTranscript: expectedLine.replace("50", "500"), secondTranscript: expectedLine, thirdTranscript });
    const result = await h.audit(15);
    assert.equal(result.status, thirdTranscript === expectedLine ? "passed" : "unavailable");
    assert.equal(h.calls.length, 3); assert.equal(h.extractions(), 1); assert.equal(h.cleaned(), 1);
    assert.ok(h.calls.every((call) => ((call.body.response_format as { schema: { properties: Record<string, unknown> } }).schema.properties.transcript)));
  }
});
