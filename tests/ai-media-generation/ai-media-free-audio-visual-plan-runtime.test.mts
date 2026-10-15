import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import * as contracts from "../../lib/aiMediaGenerationContracts.ts";
import * as prompts from "../../lib/aiMediaFreeGenerationPrompt.ts";
import * as timeline from "../../lib/aiMediaVideoTimeline.ts";
import { buildAiMediaVideoProviderContract, hashAiMediaCanonicalPrompt } from "../../lib/aiMediaVideoProviderContract.ts";
import { usesSeparateAiMediaFreeVoiceover } from "../../lib/aiMediaFreeVoiceoverPolicy.ts";
import { assertAiJsonMatchesSchema } from "../../lib/aiJsonSchemaValidation.ts";
import type { AiGenerateJsonOptions } from "../../lib/aiGatewayClient.ts";
import type { NormalizedAiGenerationProfile } from "../../lib/aiGenerationProfile.ts";
import type { AiMediaCreativePlan } from "../../lib/aiMediaCreativePlan.ts";
import type { AiVideoProviderGenerationArgs } from "../../lib/aiVideoProviderTypes.ts";

const profile = {
  business: { companyName: "Atelier Test", services: [], customerTypologies: [], strengths: [], interventionZones: [] },
  memory: { targetAudiences: [], differentiators: [], recentNewsItems: [] },
  preferences: { language: "fr" },
} as unknown as NormalizedAiGenerationProfile;

function request(overrides: Record<string, unknown> = {}) {
  return contracts.normalizeAiMediaGenerationRequest({
    requestId: "audio-visual-plan-test-0001", source: "studio", operation: "generate", creationMode: "free",
    kind: "video", format: "story", videoEngine: "grok-lite", durationSeconds: 15, sceneMode: "single",
    freePrompt: "Une femme marche avec ses collègues dans une agence.", withNarration: true, withMusic: false,
    ...overrides,
  });
}

function loadPlanner(response: Record<string, unknown>) {
  const calls: AiGenerateJsonOptions[] = [];
  const source = readFileSync(new URL("../../lib/aiMediaFreeGenerationPlan.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const modules = new Map<string, unknown>([
    ["server-only", {}],
    ["@/lib/aiGatewayClient", { aiGenerateJSON: async (input: AiGenerateJsonOptions) => {
      calls.push(input);
      const normalized = input.normalizeResponseBeforeValidation ? await input.normalizeResponseBeforeValidation(response) : response;
      assertAiJsonMatchesSchema(normalized, input.responseSchema!.schema);
      return normalized;
    } }],
    ["@/lib/aiEnginePreference", { getAiEngineOption: () => ({ model: "offline-planner" }) }],
    ["@/lib/aiMediaGenerationContracts", contracts], ["@/lib/aiMediaVideoTimeline", timeline],
    ["@/lib/aiMediaFreeGenerationPrompt", prompts],
  ]);
  const nativeRequire = createRequire(import.meta.url);
  const record = { exports: {} as typeof import("../../lib/aiMediaFreeGenerationPlan.ts") };
  new Function("module", "exports", "require", output)(record, record.exports, (specifier: string) => {
    if (specifier.startsWith("node:")) return nativeRequire(specifier);
    assert.ok(modules.has(specifier), `Unexpected dependency: ${specifier}`);
    return modules.get(specifier);
  });
  return { ...record.exports, calls };
}

const visualResponse = {
  direction: "Une femme accompagne ses collègues dans le couloir de l'agence.",
  scenes: ["Le groupe avance vers la salle de réunion, suivi par la caméra."],
};

function providerArgs(input: contracts.AiMediaGenerationRequest, plan: AiMediaCreativePlan, nativeNarrationLines: readonly string[]): AiVideoProviderGenerationArgs {
  const canonicalPrompt = prompts.buildAiMediaFreeVideoPrompt({ request: input, profile, brandColors: [], hasLogo: false });
  return {
    accountId: "offline-test", request: input, plan, contentLanguage: "fr", nativeNarrationLines,
    canonicalPrompt, canonicalPromptSha256: hashAiMediaCanonicalPrompt(canonicalPrompt),
    creativeBrief: input.freePrompt || "", brandColors: [], profession: "",
    providerContract: buildAiMediaVideoProviderContract({ request: input, durationSeconds: 15, brandColors: [], nativeNarrationLines }),
  };
}

test("exact voiceover remains intact for separate narration and stays out of native video prompts", async () => {
  const line = "Notre équipe prépare votre projet avec soin.";
  const input = request({ videoEngine: "minimax-h3", freePrompt: `Une femme marche dans une agence. Voix off exacte : « ${line} »` });
  const runtime = loadPlanner(visualResponse);
  const plan = await runtime.prepareAiMediaFreeCreativePlan({ accountId: "offline-test", request: input, profile });
  const sent = JSON.parse(runtime.calls[0].input);
  assert.equal(plan.subline, visualResponse.direction);
  assert.equal(plan.scenes[0].visualBrief, visualResponse.scenes[0]);
  assert.ok(!plan.subline.includes(line) && !plan.scenes[0].visualBrief.includes(line));
  assert.equal(sent.brief, input.freePrompt);
  assert.deepEqual(sent.audio_only_quotes, [line]);
  assert.deepEqual(sent.exact_terms, []);
  assert.deepEqual(sent.exact_dialogue, []);
  assert.equal(sent.native_dialogue, false);

  const narration = await runtime.writeAiMediaFreeNarration({ accountId: "offline-test", request: input, profile, plan });
  assert.equal(narration?.script, line);
  assert.equal(runtime.calls.length, 1, "Exact narration requires no additional generated copy.");
  const nativeNarrationLines = prompts.splitAiMediaFreeNarrationByScene(narration!.script, plan.scenes.length, [15]);
  assert.equal(usesSeparateAiMediaFreeVoiceover(input), true);
  const transport = prompts.buildAiMediaFreeVideoScenePrompt(providerArgs(input, plan, nativeNarrationLines), 0, 15);
  assert.ok(!transport.includes(line), "Even stale native narration lines must never reach the visual provider.");
  assert.doesNotMatch(transport, /NATIVE VOICEOVER:/);
  assert.match(transport, /No native voices or dialogue/);
  const firstFrame = prompts.buildAiMediaFreeSceneFramePrompt({ request: input, profile });
  assert.ok(!firstFrame.includes(line));
  assert.ok(prompts.buildAiMediaFreeVideoPrompt({ request: input, profile }).includes(input.freePrompt!));
});

test("Grok keeps the exact separate voiceover script out of the visual transport", async () => {
  const line = "Notre équipe prépare votre projet avec soin.";
  for (const videoEngine of ["grok", "grok-lite"]) {
    const input = request({ videoEngine, freePrompt: `Une femme marche dans une agence. Voix off exacte : « ${line} »` });
    const runtime = loadPlanner(visualResponse);
    const plan = await runtime.prepareAiMediaFreeCreativePlan({ accountId: "offline-test", request: input, profile });
    const narration = await runtime.writeAiMediaFreeNarration({ accountId: "offline-test", request: input, profile, plan });
    assert.equal(narration?.script, line);
    assert.equal(runtime.calls.length, 1, "Exact separate narration requires no additional generated copy.");
    assert.equal(input.withNarration, true);
    assert.equal(usesSeparateAiMediaFreeVoiceover(input), true);
    assert.ok(!plan.subline.includes(line) && !plan.scenes[0].visualBrief.includes(line));
    // Even stale native lines supplied by a caller must not reach Grok visuals.
    const nativeNarrationLines = prompts.splitAiMediaFreeNarrationByScene(narration!.script, plan.scenes.length, [15]);
    const transport = prompts.buildAiMediaFreeVideoScenePrompt(providerArgs(input, plan, nativeNarrationLines), 0, 15);
    assert.ok(!transport.includes(line));
    assert.doesNotMatch(transport, /NATIVE VOICEOVER:/);
    assert.match(transport, /No native voices or dialogue/);
  }
});

test("spoken quotes are audio only without enabling character dialogue through the voiceover controls", async () => {
  for (const withNarration of [true, false]) {
    const line = "Découvrez notre atelier.";
    const input = request({ withNarration, freePrompt: `Une femme marche. Elle dit : « ${line} »` });
    const runtime = loadPlanner(visualResponse);
    const plan = await runtime.prepareAiMediaFreeCreativePlan({ accountId: "offline-test", request: input, profile });
    const sent = JSON.parse(runtime.calls[0].input);
    assert.equal(plan.subline, visualResponse.direction);
    assert.equal(plan.scenes[0].visualBrief, visualResponse.scenes[0]);
    assert.deepEqual(sent.audio_only_quotes, [line]);
    assert.deepEqual(sent.exact_terms, []);
    assert.deepEqual(sent.exact_dialogue, []);
    assert.equal(sent.native_dialogue, false);
    assert.equal(sent.voiceover, withNarration);
    assert.equal(plan.scenes[0].spokenLine, "");
  }
});

test("visual wording, entities and commercial literals survive while speech-only prices and URLs do not leak", async () => {
  const speech = "Visitez https://audio.example et profitez de 29 €.";
  const visible = "Bienvenue chez iNrCy";
  const input = request({ freePrompt: `Une femme marche. Voix off : « ${speech} » Affiche le titre « ${visible} », https://visuel.example et le prix de 49 €.` });
  const runtime = loadPlanner(visualResponse);
  const plan = await runtime.prepareAiMediaFreeCreativePlan({ accountId: "offline-test", request: input, profile });
  const sent = JSON.parse(runtime.calls[0].input);
  for (const expected of [visible, "https://visuel.example", "49 €"]) {
    assert.ok(plan.subline.includes(expected));
    assert.ok(sent.exact_terms.includes(expected));
  }
  for (const audioOnly of [speech, "https://audio.example", "29 €"]) {
    assert.ok(!plan.subline.includes(audioOnly));
    assert.ok(!plan.scenes[0].visualBrief.includes(audioOnly));
    assert.ok(!sent.exact_terms.includes(audioOnly));
  }
  assert.deepEqual(sent.audio_only_quotes, [speech]);
});

test("the same exact words remain protected when separately requested as visible text", async () => {
  const line = "Bienvenue dans notre atelier.";
  const input = request({ freePrompt: `Voix off : « ${line} » Affiche ensuite le titre « ${line} ».` });
  const runtime = loadPlanner(visualResponse);
  const plan = await runtime.prepareAiMediaFreeCreativePlan({ accountId: "offline-test", request: input, profile });
  const sent = JSON.parse(runtime.calls[0].input);
  assert.deepEqual(sent.audio_only_quotes, [line]);
  assert.deepEqual(sent.exact_terms, [line]);
  assert.ok(plan.subline.includes(line));
});

test("a sign that says exact words remains visible text even when voiceover is enabled", async () => {
  for (const prefix of ["Une pancarte dit", "Un panneau qui dit", "A sign says"]) {
    const line = "Bienvenue chez iNrCy";
    const input = request({ freePrompt: `Une femme marche devant ${prefix.toLowerCase()} : « ${line} ».` });
    const runtime = loadPlanner(visualResponse);
    const plan = await runtime.prepareAiMediaFreeCreativePlan({ accountId: "offline-test", request: input, profile });
    const sent = JSON.parse(runtime.calls[0].input);
    assert.ok(plan.subline.includes(line));
    assert.deepEqual(sent.exact_terms, [line]);
    assert.deepEqual(sent.audio_only_quotes, []);
    assert.deepEqual(sent.exact_dialogue, []);
  }
});

test("character dialogue keeps its exact line and the image plan remains unchanged", async () => {
  const line = "Avec iNrCy, nous avançons ensemble.";
  const input = request({ teamVideoSpeechMode: "characters", freePrompt: `La femme dit : « ${line} »` });
  const runtime = loadPlanner({
    direction: visualResponse.direction,
    scenes: [{ visualBrief: "La femme parle à ses collègues en marchant.", spokenLine: "Une phrase qui doit être remplacée." }],
  });
  const plan = await runtime.prepareAiMediaFreeCreativePlan({ accountId: "offline-test", request: input, profile });
  const sent = JSON.parse(runtime.calls[0].input);
  assert.deepEqual(sent.exact_dialogue, [line]);
  assert.deepEqual(sent.exact_terms, []);
  assert.equal(plan.scenes[0].spokenLine, line);
  assert.equal(plan.subline, visualResponse.direction);
  assert.ok(!plan.scenes[0].visualBrief.includes(line));
  assert.equal(usesSeparateAiMediaFreeVoiceover(input), false);
  const transport = prompts.buildAiMediaFreeVideoScenePrompt(providerArgs(input, plan, []), 0, 15);
  assert.match(transport, /NATIVE DIALOGUE:/);
  assert.equal(transport.split(line).length, 2);

  const image = request({ kind: "image", withNarration: false, freePrompt: `Une affiche avec le titre « ${line} ».` });
  const imagePlan = await runtime.prepareAiMediaFreeCreativePlan({ accountId: "offline-test", request: image, profile });
  assert.deepEqual(imagePlan, runtime.buildAiMediaFreeBasePlan(image));
  assert.equal(runtime.calls.length, 1);
});
