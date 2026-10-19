import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import * as contracts from "../../lib/aiMediaGenerationContracts.ts";
import * as prompts from "../../lib/aiMediaFreeGenerationPrompt.ts";
import * as catalog from "../../lib/aiMediaModelCatalog.ts";
import * as timeline from "../../lib/aiMediaVideoTimeline.ts";
import * as boundary from "../../lib/aiMediaVideoProviderContract.ts";
import * as providerTypes from "../../lib/aiVideoProviderTypes.ts";
import * as voices from "../../lib/aiMediaCharacterVoices.ts";
import * as sensitive from "../../lib/aiMediaSensitiveText.ts";
import { bufferFromUint8ArrayView } from "../../lib/aiMediaBuffer.ts";
import { evaluateAiMediaNativeDialogue } from "../../lib/aiMediaNativeDialogueQa.ts";
import { assertAiJsonMatchesSchema } from "../../lib/aiJsonSchemaValidation.ts";
import type { AiGenerateJsonOptions } from "../../lib/aiGatewayClient.ts";
import type { NormalizedAiGenerationProfile } from "../../lib/aiGenerationProfile.ts";

const LINE = "voici inertie, l'application qui permet de publier sur plusieurs canaux en meme temps";
const USER_PROMPT = `fais moi une vidéo ou je présente lapplication inertie :"${LINE}"`;
const profile = { business: { companyName: "", services: [], customerTypologies: [], strengths: [], interventionZones: [] },
  memory: { targetAudiences: [], differentiators: [], recentNewsItems: [] }, preferences: { language: "fr" } } as unknown as NormalizedAiGenerationProfile;

function load<T>(filename: string, modules: Map<string, unknown>): T {
  const source = ts.transpileModule(readFileSync(new URL(`../../${filename}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const record = { exports: {} }; const nativeRequire = createRequire(import.meta.url);
  new Function("module", "exports", "require", source)(record, record.exports, (name: string) => {
    if (name === "server-only") return {};
    if (name.startsWith("node:")) return nativeRequire(name);
    assert.ok(modules.has(name), `unexpected_dependency:${name}`); return modules.get(name);
  });
  return record.exports as T;
}

function request(engine: "wan27" | "wan3" | "heygen") {
  const now = Date.now();
  return contracts.normalizeAiMediaGenerationRequest({
    requestId: `presentation-${engine}`, source: "studio", operation: "generate", inputMode: "essential", creationMode: "free",
    kind: "video", format: "story", videoEngine: engine, videoResolution: engine === "heygen" ? "768p" : "720p",
    durationSeconds: 8, sceneMode: "single", teamVideoSpeechMode: "characters", withNarration: false, withMusic: false,
    freePrompt: USER_PROMPT, identityConsent: true, inspirationImages: [{
      mimeType: "image/png", data: "A".repeat(88), role: "character", usage: "required", characterIndex: 1, voiceMode: "provided",
      voiceSample: { path: `_studio-voice-references/${new Date(now).toISOString().slice(0, 10)}/offline-account__${now}__${randomUUID()}.wav`,
        name: "private-presenter.wav", mimeType: "audio/wav", durationSeconds: 5, sizeBytes: 160_044 },
    }],
  });
}

test("the user's presentation quotation is exact speech, never a protected visual literal", () => {
  assert.deepEqual(prompts.getAiMediaFreeRequestedDialogue(USER_PROMPT), [LINE]);
  const split = prompts.splitAiMediaFreeQuotedSpeech(USER_PROMPT);
  assert.deepEqual(split.audioOnlyQuotes, [LINE]); assert.ok(!split.visualPrompt.includes(LINE));
  for (const subject of ["je présente", "elle présente", "nous présentons", "le personnage explique"]) {
    assert.deepEqual(prompts.getAiMediaFreeRequestedDialogue(`${subject} l'application : « ${LINE} »`), [LINE]);
  }
  const visible = `Une affiche présente le titre : « ${LINE} »`;
  assert.deepEqual(prompts.getAiMediaFreeRequestedDialogue(visible), []);
  assert.equal(prompts.splitAiMediaFreeQuotedSpeech(visible).visualPrompt, visible);
});

test("presenting a sign or screen preserves its explicitly displayed wording", () => {
  for (const prompt of [
    "Une femme présente une pancarte portant le texte : “Offre spéciale”.",
    "Je présente le produit avec un écran affichant le titre : “Inertie”.",
  ]) {
    assert.deepEqual(prompts.getAiMediaFreeRequestedDialogue(prompt), []);
    assert.deepEqual(prompts.splitAiMediaFreeQuotedSpeech(prompt), { visualPrompt: prompt, audioOnlyQuotes: [] });
  }
});

test("adjacent spoken presentation and displayed text remain in their own channels", () => {
  const speech = "Voici notre application.";
  const visible = "Inertie";
  const visual = `Je présente le produit avec un écran affichant le titre : “${visible}”.`;
  const oral = `Je présente l'application : “${speech}”`;
  for (const prompt of [`${oral} ${visual}`, `${visual} ${oral}`, `${visual} Puis je dis : “${speech}”`]) {
    assert.deepEqual(prompts.getAiMediaFreeRequestedDialogue(prompt), [speech]);
    const split = prompts.splitAiMediaFreeQuotedSpeech(prompt);
    assert.deepEqual(split.audioOnlyQuotes, [speech]);
    assert.ok(split.visualPrompt.includes(`“${visible}”`));
    assert.ok(!split.visualPrompt.includes(speech));
  }
});

for (const engine of ["wan27", "wan3", "heygen"] as const) {
  test(`${engine}: exact presentation script reaches the provider and QA once despite duplicated planner visual quotes`, async () => {
    const input = request(engine); const plannerCalls: AiGenerateJsonOptions[] = [];
    const planner = load<typeof import("../../lib/aiMediaFreeGenerationPlan.ts")>("lib/aiMediaFreeGenerationPlan.ts", new Map([
      ["@/lib/aiGatewayClient", { aiGenerateJSON: async (options: AiGenerateJsonOptions) => {
        plannerCalls.push(options);
        const response = { direction: `Le personnage présente l'application : « ${LINE} »`,
          scenes: [{ visualBrief: `character1 dit : « ${LINE} » puis sourit.`, spokenLine: "Une autre phrase automatique à ignorer." }] };
        const normalized = options.normalizeResponseBeforeValidation ? await options.normalizeResponseBeforeValidation(response) : response;
        assertAiJsonMatchesSchema(normalized, options.responseSchema!.schema); return normalized;
      } }],
      ["@/lib/aiEnginePreference", { getAiEngineOption: () => ({ model: "offline-planner" }) }],
      ["@/lib/aiMediaGenerationContracts", contracts], ["@/lib/aiMediaVideoTimeline", timeline], ["@/lib/aiMediaFreeGenerationPrompt", prompts],
    ] as [string, unknown][]));
    const plan = await planner.prepareAiMediaFreeCreativePlan({ accountId: "offline-account", request: input, profile });
    assert.equal(plannerCalls.length, 1);
    const plannerInput = JSON.parse(plannerCalls[0].input);
    assert.deepEqual(plannerInput.exact_dialogue, [LINE]); assert.deepEqual(plannerInput.audio_only_quotes, [LINE]);
    assert.deepEqual(plannerInput.exact_terms, []); assert.equal(plan.scenes[0].spokenLine, LINE);
    const expectedLine = prompts.resolveAiMediaFreeDialogueSequence({ request: input, plan })[0];
    assert.equal(expectedLine, LINE);
    const canonicalPrompt = prompts.buildAiMediaFreeVideoPrompt({ request: input, profile });
    const args = { accountId: "offline-account", request: input, plan, contentLanguage: "fr", canonicalPrompt,
      canonicalPromptSha256: boundary.hashAiMediaCanonicalPrompt(canonicalPrompt),
      providerContract: boundary.buildAiMediaVideoProviderContract({ request: input, durationSeconds: 8, brandColors: [] }),
    } as providerTypes.AiVideoProviderGenerationArgs;
    const gateway = load<typeof import("../../lib/aiVideoProviderGateway.ts")>("lib/aiVideoProviderGateway.ts", new Map([
      ["ai", { createDownload: () => async () => { throw new Error("real_download_forbidden"); } }],
      ["@/lib/aiGatewayAccountGuard", {}], ["./aiMediaBuffer.ts", { bufferFromUint8ArrayView }],
      ["./aiMediaFreeGenerationPrompt.ts", prompts], ["@/lib/aiMediaGenerationContracts", contracts],
      ["./aiMediaModelCatalog.ts", catalog], ["./aiMediaVideoTimeline.ts", timeline], ["./aiMediaVideoContinuity.ts", {}],
      ["./aiMediaVideoTemporaryImages.ts", {}], ["@/lib/aiMediaSensitiveText", sensitive],
      ["./aiMediaVideoProviderContract.ts", boundary], ["./aiMediaCharacterVoices.ts", voices],
      ["@/lib/aiVideoProviderTypes", providerTypes], ["@/lib/aiVideoProviderGoogleVeo", {
        buildGoogleVideoScenePrompt: prompts.buildAiMediaFreeVideoScenePrompt, buildGoogleVideoTeamSpeechDirection: () => "",
      }],
    ] as [string, unknown][]));
    const outbound = gateway.buildGatewayAiVideoRequest(args, 0, undefined,
      ["https://private.example.com/presenter.png"], ["https://private.example.com/own-voice.wav"]);
    assert.equal(String(outbound.prompt).split(LINE).length, 2, "the entire requested script appears only in NATIVE DIALOGUE");
    const visual = String(outbound.prompt).split("NATIVE DIALOGUE:")[0];
    assert.ok(!visual.includes(LINE)); assert.match(String(outbound.prompt), /says exactly once/);
    assert.doesNotMatch(String(outbound.prompt), /Une autre phrase automatique|Never clone|NATIVE VOICEOVER/);
    assert.deepEqual(input.inspirationImages, args.request.inspirationImages);
    const checked = evaluateAiMediaNativeDialogue({ sceneIndex: 0, expectedLine, transcript: LINE, language: "fr" });
    assert.equal(checked.status, "passed"); assert.deepEqual(checked.issues, []);
    const repeated = evaluateAiMediaNativeDialogue({ sceneIndex: 0, expectedLine, transcript: `${LINE}. ${LINE}.`, language: "fr" });
    assert.equal(repeated.status, "rejected"); assert.ok(repeated.issues.includes("spoken_dialogue_repeated"));
  });
}

test("an intentionally displayed copy of the spoken words remains visible", () => {
  const input = request("heygen");
  input.freePrompt = `Je présente l'application : « ${LINE} » Affiche aussi le titre « ${LINE} ».`;
  const args = { request: input, plan: { subline: `Une femme dit : « ${LINE} » Affiche aussi le titre « ${LINE} ».`,
    scenes: [{ visualBrief: "character1 présente l'application face caméra.", spokenLine: LINE }] },
    providerContract: boundary.buildAiMediaVideoProviderContract({ request: input, durationSeconds: 8, brandColors: [] }),
  } as unknown as providerTypes.AiVideoProviderGenerationArgs;
  const prompt = prompts.buildAiMediaFreeVideoScenePrompt(args, 0, 8);
  assert.match(prompt, /Affiche aussi le titre/);
  assert.equal(prompt.split(LINE).length, 3, "one explicit visual title and one authoritative spoken line");
});
