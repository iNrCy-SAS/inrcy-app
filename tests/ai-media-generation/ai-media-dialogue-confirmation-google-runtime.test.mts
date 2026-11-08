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
  checkFinalFrameLayout?: boolean;
  finalFrameLayout?: string;
  finalFrameIssue?: string;
  missingFinalFrame?: boolean;
  firstReadDeadline?: boolean;
  firstReadThrows?: boolean;
  extractionFailure?: "audio" | "image" | "reference" | "final" | "deadline";
  sourceStartSeconds?: number;
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
  const reservations: Array<{ reservedOutputTokens: number; estimatedInputTokens: number; estimatedCostMicroUsd: number }> = [];
  const extractionArgs: string[][] = []; const costs: number[] = [];
  const qaDeadline = new AbortController(); let cleaned = 0; let extractions = 0;
  const modules = new Map<string, unknown>([
    ["server-only", {}],
    ["node:fs/promises", {
      mkdtemp: async () => "virtual-dialogue-qa",
      writeFile: async (name: string, bytes: Buffer) => { files.set(name, bytes); },
      readFile: async (name: string) => { assert.ok(files.has(name)); return files.get(name); },
      rm: async () => { cleaned++; files.clear(); },
    }],
    ["node:child_process", { execFile(_file: string, args: string[], _options: unknown, done: (error: Error | null, stdout: string, stderr: string) => void) {
      extractions++; extractionArgs.push(args);
      const image = args.includes("0:v:0");
      const position = args.at(-1)!.includes("reference-") ? "reference" : "final";
      if (overrides.extractionFailure === "deadline" || overrides.extractionFailure === (image ? "image" : "audio") || image && overrides.extractionFailure === position) {
        if (overrides.extractionFailure === "deadline") qaDeadline.abort();
        done(new Error("PRIVATE_EXTRACTION_FAILURE"), "", ""); return;
      }
      files.set(args.at(-1)!, image && !overrides.missingFinalFrame ? Buffer.concat([Buffer.from([255,216,255]), Buffer.alloc(797, position === "reference" ? 17 : 34)]) : Buffer.alloc(800));
      done(null, "", "");
    } }],
    ["@google/genai", { GoogleGenAI: class {
      interactions = { create: async (body: Record<string, unknown>, options: { timeout: number; maxRetries: number }) => {
        calls.push({ body, options });
        if (overrides.firstReadDeadline && calls.length === 1) { qaDeadline.abort(); throw new DOMException("QA deadline", "AbortError"); }
        if (overrides.firstReadThrows && calls.length === 1) throw new TypeError("PRIVATE_TRANSPORT_ERROR");
        assert.ok(calls.length <= 3, "At most three bounded audio checks are allowed.");
        const prompt = (body.input as Array<{ type: string; text?: string }>).filter((part) => part.type === "text").map(part => part.text).join("\n");
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
        return { output_text: JSON.stringify({ transcript, ...(schema.properties.final_frame_layout ? { final_frame_layout: overrides.finalFrameLayout ?? "passed", final_frame_issue: overrides.finalFrameIssue ?? (overrides.finalFrameLayout === "rejected" ? "unexpected_partial_transition" : overrides.finalFrameLayout && overrides.finalFrameLayout !== "passed" ? "unavailable" : "none") } : {}) }), usage: { total_input_tokens: 10, total_output_tokens: 20, total_tokens: 30 } };
      } };
    } }],
    ["@/lib/aiMediaNativeDialogueQa", dialogue],
    ["@/lib/mediaVideoNormalizer", { resolveVideoNormalizationFfmpegPath: async () => "virtual-ffmpeg" }],
    ["@/lib/aiGatewayAccountGuard", {
      reserveAiGatewayAccountAttempt: async (_account: string, args: { reservedOutputTokens: number; estimatedInputTokens: number; estimatedCostMicroUsd: number }) => { reservations.push(args); return {}; },
      commitAiGatewayAccountAttempt: async (args: { actualCostMicroUsd: number }) => { costs.push(args.actualCostMicroUsd); }, rollbackAiGatewayAccountAttempt: async () => {}, recordAiGatewayAccountFailure: async () => {},
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
  return { calls, reservations, extractionArgs, costs, cleaned: () => cleaned, extractions: () => extractions,
    audit: (durationSeconds = 8) => record.exports.auditAiMediaNativeDialogueWithGoogle({ accountId: "test-account", language: "fr", pronunciationAliases: overrides.pronunciationAliases, clips: [{ sceneIndex: 0, buffer: Buffer.from("synthetic-video"), mediaType: "video/mp4", durationSeconds, expectedLine, expectedContinuation: overrides.expectedContinuation, checkFinalFrameLayout: overrides.checkFinalFrameLayout, sourceStartSeconds: overrides.sourceStartSeconds }] }),
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


test("the first existing Google call includes two ordered bounded JPEGs and raises configured reservations only for that image", async () => {
  const h = adapter("complete", true, { checkFinalFrameLayout: true });
  const result = await h.audit();
  assert.equal(result.status, "passed"); assert.equal(result.clips[0].finalFrameLayout, "passed");
  assert.equal(h.calls.length, 1); assert.equal(h.extractions(), 3);
  const input = h.calls[0].body.input as Array<{ type: string; mime_type?: string; text?: string; data?: string }>;
  assert.deepEqual(input.map(part => part.type), ["audio", "text", "image", "text", "image", "text"]);
  assert.equal(input[2].mime_type, "image/jpeg"); assert.equal(input[4].mime_type, "image/jpeg");
  assert.match((input[1] as { text: string }).text, /IMAGE 1.*RÉFÉRENCE/);
  assert.match((input[3] as { text: string }).text, /IMAGE 2.*FIN/);
  assert.equal(Buffer.from((input[2] as { data: string }).data, "base64")[3], 17);
  assert.equal(Buffer.from((input[4] as { data: string }).data, "base64")[3], 34);
  assert.equal(h.reservations[0].estimatedInputTokens, 2688);
  assert.equal(h.reservations[0].estimatedCostMicroUsd, 3000);
  assert.equal(h.reservations[0].reservedOutputTokens, 208);
  assert.deepEqual(h.costs, [3000]);
  assert.equal(h.calls[0].options.maxRetries, 0); assert.ok(h.calls[0].options.timeout <= 8000);
  assert.equal(h.cleaned(), 1);
});

test("tail extraction respects a cumulative logical clip and retains the last frame rather than the first", async () => {
  const h = adapter("complete", true, { checkFinalFrameLayout: true, sourceStartSeconds: 8 }); await h.audit(8);
  const reference = h.extractionArgs[1];
  assert.equal(reference[reference.indexOf("-ss") + 1], "15.5");
  assert.equal(reference[reference.indexOf("-frames:v") + 1], "1");
  const args = h.extractionArgs[2];
  assert.equal(args[args.indexOf("-ss") + 1], "15.75");
  assert.equal(args[args.indexOf("-t") + 1], "0.25");
  assert.equal(args[args.indexOf("-update") + 1], "1");
  assert.equal(args.includes("-frames:v"), false);
  assert.match(args[args.indexOf("-vf") + 1], /scale=768:768/);
});

test("a tail refusal or uncertainty uses no confirmation request or automatic SDK retry", async () => {
  for (const finalFrameLayout of ["rejected", "unavailable", "malformed"]) {
    const h = adapter("complete", false, { checkFinalFrameLayout: true, finalFrameLayout });
    const result = await h.audit();
    assert.equal(result.status, finalFrameLayout === "rejected" ? "rejected" : "unavailable");
    assert.equal(h.calls.length, 1); assert.equal(h.reservations.length, 1);
    assert.equal(h.calls[0].options.maxRetries, 0); assert.equal(h.cleaned(), 1);
  }
});

test("a missing local final frame does not buy a replacement visual or audio request", async () => {
  const h = adapter("complete", true, { checkFinalFrameLayout: true, missingFinalFrame: true });
  assert.equal((await h.audit()).status, "unavailable");
  assert.equal(h.calls.length, 0); assert.equal(h.reservations.length, 0); assert.equal(h.cleaned(), 1);
});

test("a blind audio confirmation reuses sound only and cannot replace the first visual verdict", async () => {
  const h = adapter("complete", false, { checkFinalFrameLayout: true });
  const result = await h.audit();
  assert.equal(result.status, "passed"); assert.equal(result.clips[0].finalFrameLayout, "passed");
  assert.equal(h.calls.length, 2); assert.equal(h.extractions(), 3);
  assert.deepEqual((h.calls[1].body.input as Array<{ type: string }>).map(part => part.type), ["audio", "text"]);
  assert.equal(h.reservations[1].estimatedInputTokens, 640); assert.equal(h.costs[1], 1000);
  assert.ok(h.calls[1].options.timeout <= h.calls[0].options.timeout);
});

test("a first-call deadline keeps the requested image unverified without another request or extended budget", async () => {
  const h = adapter("complete", true, { checkFinalFrameLayout: true, firstReadDeadline: true });
  const result = await h.audit();
  assert.equal(result.status, "unavailable"); assert.equal(result.clips[0].finalFrameLayout, "unavailable");
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].options.maxRetries, 0);
  assert.ok(h.calls[0].options.timeout <= 8000); assert.equal(h.cleaned(), 1);
});

test("audio extraction, image extraction and extraction deadline preserve explicit unavailable layout without paying for QA", async () => {
  for (const extractionFailure of ["audio", "image", "deadline"] as const) {
    const h = adapter("complete", true, { checkFinalFrameLayout: true, extractionFailure });
    const result = await h.audit();
    assert.equal(result.status, "unavailable"); assert.equal(result.clips[0].finalFrameLayout, "unavailable");
    assert.equal(h.calls.length, 0); assert.equal(h.reservations.length, 0); assert.equal(h.cleaned(), 1);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  }
});

test("a thrown first Google request keeps image unavailable and never buys a replacement request", async () => {
  const h = adapter("complete", true, { checkFinalFrameLayout: true, firstReadThrows: true });
  const result = await h.audit();
  assert.equal(result.status, "unavailable"); assert.equal(result.clips[0].finalFrameLayout, "unavailable");
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].options.maxRetries, 0); assert.equal(h.cleaned(), 1);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
});


test("a missing reference OR final image stops before a paid comparison", async () => {
  for (const extractionFailure of ["reference", "final"] as const) {
    const h = adapter("complete", true, { checkFinalFrameLayout: true, extractionFailure });
    assert.equal((await h.audit()).status, "unavailable"); assert.equal(h.calls.length, 0);
    assert.equal(h.extractions(), 3); assert.equal(h.cleaned(), 1);
  }
});

test("comparison names only an unexpected partial transition and permits full-frame cuts or natural groups", async () => {
  const h = adapter("complete", true, { checkFinalFrameLayout: true }); const result = await h.audit();
  assert.equal(result.status, "passed"); assert.equal(result.clips[0].finalFrameIssue, "none");
  const input = h.calls[0].body.input as Array<{ type: string; text?: string }>;
  const prompt = input.filter(part => part.type === "text").map(part => part.text).join(" ");
  assert.match(prompt, /TRANSITION PARTIELLE INATTENDUE/);
  assert.match(prompt, /remplace TOUT le cadre est autorisé/);
  assert.match(prompt, /Plusieurs personnes naturellement présentes/);
  assert.equal(h.calls.length, 1);
});

test("two-image issue and verdict must agree, without audio-only confirmation clearing the issue", async () => {
  for (const [finalFrameLayout, finalFrameIssue] of [["passed", "unexpected_partial_transition"], ["rejected", "none"], ["passed", "malformed"]]) {
    const h = adapter("complete", true, { checkFinalFrameLayout: true, finalFrameLayout, finalFrameIssue });
    const result = await h.audit(); assert.equal(result.status, "unavailable"); assert.equal(h.calls.length, 1);
  }
  const rejected = adapter("complete", false, { checkFinalFrameLayout: true, finalFrameLayout: "rejected", finalFrameIssue: "unexpected_partial_transition" });
  const result = await rejected.audit(); assert.equal(result.status, "rejected");
  assert.equal(result.clips[0].finalFrameIssue, "unexpected_partial_transition"); assert.equal(rejected.calls.length, 1);
});
