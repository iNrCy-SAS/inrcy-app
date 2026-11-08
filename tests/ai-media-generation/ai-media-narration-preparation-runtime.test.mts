import assert from "node:assert/strict";
import test from "node:test";
import { loadNarrationPreparationRuntime } from "./narration-preparation-runtime.mjs";
import { normalizeAiMediaGenerationRequest } from "../../lib/aiMediaGenerationContracts.ts";
import { getAiMediaFreeSpeechBudget } from "../../lib/aiMediaVideoSpeechBudget.ts";
import * as sensitive from "../../lib/aiMediaSensitiveText.ts";

type Row = Record<string, unknown>;
type Preparation = typeof import("../../lib/aiMediaNarrationPreparation.ts");
function harness(options: { rewrites?: number; free?: boolean; copyFailure?: boolean; required?: boolean; cancelAfterCopy?: boolean; prepared?: boolean } = {}) {
  const stages: string[] = [], copies: Row[] = [], voices: Row[] = [], audioChecks: Row[] = [];
  const caller = new AbortController(), narration = new AbortController();
  const cancellation = new Error("cancelled-before-audio");
  const prepared = { script: "Une phrase complète.", wordCount: 3, language: "fr", source: "ai" as const, sha256: "synthetic-script-hash" };
  class TooLong extends Error { requiredTempo = 2; }
  const copy = async (args: Row) => {
    copies.push(args);
    if (options.cancelAfterCopy) caller.abort(cancellation);
    if (options.copyFailure) throw new Error("copy-unavailable");
    return { ...prepared, wordCount: Number(args.maximumSpeechUnits || 20) };
  };
  const dependencies = new Map<string, unknown>([
    ["server-only", {}], ["@/lib/aiMediaSensitiveText", sensitive],
    ["@/lib/aiMediaFreeGenerationPlan", { writeAiMediaFreeNarration: async (args: Row) => { assert.equal(options.free, true); return copy(args); } }],
    ["@/lib/aiMediaNarration", { writeAiMediaNarration: async (args: Row) => { assert.equal(options.free, false); return copy(args); } }],
    ["@/lib/aiMediaNarrationAudio", { generateAiMediaNarrationAudio: async (args: Row) => { voices.push(args); return { buffer: Buffer.from("complete-speech") }; } }],
    ["@/lib/aiMediaGeneratedVideo", { AiMediaNarrationTooLongError: TooLong, prepareAiMediaNarrationAudioForVideo: async (args: Row) => {
      audioChecks.push(args); if (audioChecks.length <= (options.rewrites || 0)) throw new TooLong();
      return { audio: { buffer: Buffer.from("duration-checked-speech") }, silenceCompacted: true };
    } }],
    ["./aiMediaVideoSpeechBudget.ts", { getAiMediaFreeSpeechBudget }],
    ["./aiMediaPronunciation.ts", { extractAiMediaPronunciationAliases: (value: string) => [{ text: value, pronunciation: "exact" }] }],
  ]);
  const service = loadNarrationPreparationRuntime(dependencies) as Preparation;
  const request = normalizeAiMediaGenerationRequest({ requestId: "narration-service-test", source: "studio", operation: "generate", kind: "video", creationMode: options.free ? "free" : "guided", inputMode: "essential", subjectSource: "custom", idea: "Présentation de notre atelier", freePrompt: "Une présentation en français.", format: "story", videoEngine: "grok", videoResolution: "720p", durationSeconds: 8, withNarration: options.required !== false, narrationVoice: "male", narrationVoiceVariant: "Puck", teamVideoSpeechMode: "voiceover" });
  const scope = { accountId: "account-owner", signal: caller.signal };
  const profile = { business: { companyName: "Atelier" }, preferences: { language: "fr" } } as Parameters<Preparation["prepareAiMediaNarration"]>[0]["profile"];
  const creativePlan = { companyName: "Atelier", headline: "Atelier", subline: "Une création", cta: "", scenes: [] };
  return { stages, copies, voices, audioChecks, caller, narration, cancellation, prepared, run: () => service.prepareAiMediaNarration({
    context: scope, narrationRequest: request, preparedNativeNarration: options.prepared ? prepared : null,
    isFreeCreation: !!options.free, profile, creativePlan, businessDnaContext: undefined, recentPublications: [], durationSeconds: 8, narrationSignal: narration.signal,
    measure: async (stage, action) => { stages.push(stage); return action(); },
  }) };
}

test("guided narration forwards account, history and voice to duration-checked synthesis", async () => {
  const h = harness({ free: false }); const result = await h.run();
  assert.deepEqual(h.stages, ["narration_copy", "narration_audio", "narration_audio_preflight"]);
  assert.equal(h.copies[0].accountId, "account-owner"); assert.deepEqual(h.copies[0].recentPublications, []);
  assert.equal(h.voices[0].accountId, "account-owner"); assert.equal(h.voices[0].narrationVoiceVariant, "Puck");
  assert.equal(h.voices[0].signal, h.narration.signal); assert.equal(h.audioChecks[0].signal, h.narration.signal);
  assert.deepEqual(result.warnings, ["narration_silence_compacted_before_video"]);
});

test("long speech is rewritten and synthesized again with decreasing limits, never truncated", async () => {
  const h = harness({ free: true, rewrites: 2 }); const result = await h.run();
  assert.deepEqual(h.copies.map(args => args.maximumSpeechUnits), [undefined, 9, 4]);
  assert.equal(h.voices.length, 3); assert.equal(result.narration?.script, "Une phrase complète.");
  assert.deepEqual(h.stages.slice(-3), ["narration_copy_rewrite_2", "narration_audio_rewrite_2", "narration_audio_preflight_rewrite_2"]);
  assert.ok(h.voices.every(args => Array.isArray(args.pronunciationAliases)));
});

test("three failed duration checks reject required narration without a fourth paid attempt", async () => {
  const h = harness({ free: true, rewrites: 3 });
  await assert.rejects(h.run(), /ai_media_narration_unavailable:ai_media_narration_audio_preflight_failed/);
  assert.equal(h.copies.length, 3); assert.equal(h.voices.length, 3); assert.equal(h.audioChecks.length, 3);
});

test("prepared native copy is reused for the first attempt without another editorial request", async () => {
  const h = harness({ free: true, prepared: true }); const result = await h.run();
  assert.equal(h.copies.length, 0); assert.equal(h.voices[0].narration, h.prepared); assert.equal(result.narration, h.prepared);
  assert.deepEqual(h.stages, ["narration_audio", "narration_audio_preflight"]);
});

test("caller cancellation after copy preserves its reason and prevents synthesis", async () => {
  const h = harness({ free: true, cancelAfterCopy: true });
  await assert.rejects(h.run(), error => error === h.cancellation); assert.equal(h.voices.length, 0);
});

test("required editorial failure is terminal before synthesis", async () => {
  const h = harness({ free: true, copyFailure: true });
  await assert.rejects(h.run(), /ai_media_narration_unavailable:copy-unavailable/); assert.equal(h.voices.length, 0);
});

test("optional editorial failure retains the existing empty result and warning", async () => {
  const h = harness({ free: true, copyFailure: true, required: false });
  assert.deepEqual(await h.run(), { narration: null, audio: null, warnings: ["narration_unavailable_video_continued"] });
  assert.equal(h.voices.length, 0);
});
