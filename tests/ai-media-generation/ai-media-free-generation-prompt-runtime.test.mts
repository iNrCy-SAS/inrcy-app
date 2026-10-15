import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

import type { NormalizedAiGenerationProfile } from "../../lib/aiGenerationProfile.ts";
import * as freePrompts from "../../lib/aiMediaFreeGenerationPrompt.ts";
import * as contracts from "../../lib/aiMediaGenerationContracts.ts";
import { buildAiMediaBusinessDnaPayload } from "../../lib/aiMediaBusinessDna.ts";
import { getAiMediaVideoSegmentCount, getAiMediaVideoSegmentDurations } from "../../lib/aiMediaVideoTimeline.ts";
import {
  assertAiMediaVideoProviderContract,
  buildAiMediaVideoProviderContract,
} from "../../lib/aiMediaVideoProviderContract.ts";
import type { AiVideoProviderGenerationArgs } from "../../lib/aiVideoProviderTypes.ts";
import type { AiMediaPromptBuilderArgs } from "../../lib/aiMediaPromptShared.ts";
import { AiJsonResponseNormalizationError, normalizeAiJsonResponseBeforeValidation, type AiJsonResponseNormalizer } from "../../lib/aiJsonResponseNormalization.ts";
import { assertAiJsonMatchesSchema } from "../../lib/aiJsonSchemaValidation.ts";
import * as aiGatewayResponse from "../../lib/aiGatewayResponse.ts";
import type { AiGenerateJsonOptions } from "../../lib/aiGatewayClient.ts";
import * as businessDnaTiming from "../../lib/businessDnaAnalysisTiming.ts";

const profile = {
  business: {
    companyName: "Atelier Test", professionLabel: "METIER_ADN_NON_SOLLICITE", services: [],
    customerTypologies: [], strengths: [], interventionZones: [],
  },
  memory: { targetAudiences: [], differentiators: [], recentNewsItems: [] },
  preferences: { language: "fr", premiumEnabled: false, customInstructions: "INSTRUCTION_GUIDEE_RESIDUELLE" },
} as unknown as NormalizedAiGenerationProfile;

const freeGeneratorSource = readFileSync(new URL("../../app/dashboard/_components/MediaFreeGenerator.tsx", import.meta.url), "utf8");
const freeGeneratorStyles = readFileSync(new URL("../../app/dashboard/_components/MediaFreeGenerator.module.css", import.meta.url), "utf8");

function request(overrides: Record<string, unknown> = {}) {
  return contracts.normalizeAiMediaGenerationRequest({
    requestId: "free-prompt-runtime-0001", source: "studio", operation: "generate",
    creationMode: "free", kind: "image", freePrompt: "Un monde dessiné à la main, avec des baleines dans les nuages.",
    format: "story", ...overrides,
  });
}

function args(overrides: Record<string, unknown> = {}): AiMediaPromptBuilderArgs {
  return { request: request(overrides), profile, brandColors: ["#abcdef"], hasLogo: true };
}

function transpileModule(relative: string, modules: Map<string, unknown>) {
  const output = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), "utf8"), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const record = { exports: {} as Record<string, unknown> };
  const nativeRequire = createRequire(import.meta.url);
  new Function("module", "exports", "require", output)(record, record.exports, (specifier: string) => {
    if (specifier.startsWith("node:")) return nativeRequire(specifier);
    assert.ok(modules.has(specifier), `Dépendance inattendue : ${specifier}`);
    return modules.get(specifier);
  });
  return record.exports;
}

function loadPlan(response: unknown, generate?: (input: AiGenerateJsonOptions) => Promise<unknown>) {
  const calls: Array<{ system: string; input: string; responseSchema: { schema: Record<string, unknown> }; normalizeResponseBeforeValidation?: AiJsonResponseNormalizer }> = [];
  const exports = transpileModule("../../lib/aiMediaFreeGenerationPlan.ts", new Map<string, unknown>([
    ["server-only", {}],
    ["@/lib/aiGatewayClient", { aiGenerateJSON: async (input: typeof calls[number]) => {
      calls.push(input);
      if (generate) return generate(input as AiGenerateJsonOptions);
      return normalizeAiJsonResponseBeforeValidation(response as Record<string, unknown>, input.normalizeResponseBeforeValidation);
    } }],
    ["@/lib/aiEnginePreference", { getAiEngineOption: () => ({ model: "test-planner" }) }],
    ["@/lib/aiMediaGenerationContracts", contracts],
    ["@/lib/aiMediaVideoTimeline", { getAiMediaVideoSegmentCount, getAiMediaVideoSegmentDurations }],
    ["@/lib/aiMediaBusinessDna", { buildAiMediaBusinessDnaPayload }],
    ["@/lib/aiMediaFreeGenerationPrompt", freePrompts],
  ]));
  return { calls, ...exports } as {
    calls: typeof calls;
    buildAiMediaFreeBasePlan: typeof import("../../lib/aiMediaFreeGenerationPlan.ts").buildAiMediaFreeBasePlan;
    prepareAiMediaFreeCreativePlan: typeof import("../../lib/aiMediaFreeGenerationPlan.ts").prepareAiMediaFreeCreativePlan;
    writeAiMediaFreeNarration: typeof import("../../lib/aiMediaFreeGenerationPlan.ts").writeAiMediaFreeNarration;
  };
}

/** Execute the real Gateway fallback orchestration with in-memory provider responses. */
function loadDialogueGateway(responses: unknown[]) {
  const calls: Array<{ model: string; deadlineAt: number; timeoutMs: number; input: string; maxOutputTokens: number }> = [];
  const engines = { getAiEngineOption: (engine: string) => ({ model: `${engine}/test`, jsonMode: "strict", shortLabel: engine }) };
  const config = {
    cleanAiGatewayEnv: (value: unknown) => String(value || "").trim(),
    normalizeGatewayModelId: (value: unknown) => String(value || "").trim(),
    getAiGatewayCredential: () => "test-only-credential",
    normalizeAiGatewayBaseUrl: () => "https://example.invalid/v1",
  };
  const fallback = transpileModule("../../lib/aiGenerationFallback.ts", new Map<string, unknown>([
    ["server-only", {}], ["@/lib/aiEnginePreference", engines], ["@/lib/aiGatewayConfig", config],
  ]));
  const client = transpileModule("../../lib/aiGatewayClient.ts", new Map<string, unknown>([
    ["server-only", {}],
    ["./aiGatewayReasoning.ts", { resolveAiMediaEditorialReasoning: () => undefined }],
    ["./businessDnaAnalysisTiming.ts", businessDnaTiming],
    ["@/lib/aiGatewayConfig", config],
    ["@/lib/aiEnginePreference", engines],
    ["@/lib/aiGatewayPolicy", {
      getAiFeaturePolicy: () => ({ maxOutputTokens: 2_000, maxTimeoutMs: 30_000, maxInputChars: 72_000, maxImages: 5, maxImageDataChars: 1_000_000, defaultOperationMaxDurationMs: 31_000 }),
      assertAllowedAiGatewayModel: () => undefined,
      reserveAiOperationBudget: () => undefined,
      AiOperationDeadlineExceededError: Error,
    }],
    ["@/lib/aiGatewayAccountGuard", {
      reserveAiGatewayAccountAttempt: async () => null,
      rollbackAiGatewayAccountAttempt: async () => undefined,
      commitAiGatewayAccountAttempt: async () => undefined,
      recordAiGatewayAccountFailure: async () => undefined,
    }],
    ["@/lib/aiGatewayEconomics", {
      estimateInputTokensWithImages: () => 20,
      estimateAiGatewayCostMicroUsd: () => 0,
      resolveAiGatewayGuardPricing: () => ({ source: "test" }),
    }],
    ["@/lib/aiGatewayResponse", aiGatewayResponse],
    ["@/lib/aiJsonSchemaValidation", { assertAiJsonMatchesSchema }],
    ["@/lib/aiJsonResponseNormalization", { normalizeAiJsonResponseBeforeValidation }],
    ["@/lib/aiGatewayOperationTelemetry", { recordAiGatewayOperationCall: () => undefined }],
    ["@/lib/aiGenerationFallback", {
      ...fallback,
      getOpenAiDirectFallbackCredential: () => "",
      resolveGatewayFallbackRouting: () => ({ model: "google/test", engine: "google", jsonMode: "strict" }),
    }],
    ["@/lib/aiModelCapabilities", { resolveModelTemperature: () => undefined }],
    ["@/lib/observability/fetch", { fetchWithRetry: async (_url: string, init: { body: string; deadlineAt: number; timeoutMs: number }) => {
      const { model, input, max_output_tokens } = JSON.parse(init.body);
      const response = responses[calls.length];
      calls.push({ model, deadlineAt: init.deadlineAt, timeoutMs: init.timeoutMs, input: input[1].content[0].text, maxOutputTokens: max_output_tokens });
      assert.ok(response, "Aucun appel supplémentaire n'est autorisé après les réponses prévues.");
      return Response.json({ output_text: JSON.stringify(response), usage: { input_tokens: 20, output_tokens: 40, total_tokens: 60 } });
    } }],
  ]));
  return { calls, generate: client.aiGenerateJSON as (input: AiGenerateJsonOptions) => Promise<unknown> };
}

test("les prompts libres préservent le brief complet et le format sans importer les réglages guidés", () => {
  const freePrompt = `${"Une composition imaginaire. ".repeat(100)}Texte exact : « Fin de l'offre : 39,90 € ».`;
  const input = args({ freePrompt });
  input.request.aiInstruction = "CONSIGNE_GUIDEE_INTERDITE";
  input.request.exactText = "TEXTE_GUIDE_INTERDIT";
  for (const build of [freePrompts.buildAiMediaFreeImagePrompt, freePrompts.buildAiMediaFreeSceneFramePrompt]) {
    const prompt = build(input);
    assert.ok(prompt.includes(freePrompt));
    assert.ok(prompt.includes("9:16"));
    assert.doesNotMatch(prompt, /CONSIGNE_GUIDEE_INTERDITE|TEXTE_GUIDE_INTERDIT|METIER_ADN_NON_SOLLICITE|INSTRUCTION_GUIDEE_RESIDUELLE/);
    assert.doesNotMatch(prompt, /#abcdef/);
  }
});

test("l'ADN et le logo sont activés uniquement par une demande compatible", () => {
  assert.deepEqual(freePrompts.getAiMediaFreeBrandPolicy("Une galaxie dessinée à la main", "Atelier Test"), {
    useCompanyContext: false, useLogo: false, useBrandColors: false,
  });
  const brief = "Un flyer pour Atelier Test avec le logo de mon entreprise et notre charte.";
  const prompt = freePrompts.buildAiMediaFreeImagePrompt(args({ freePrompt: brief }));
  assert.match(prompt, /METIER_ADN_NON_SOLLICITE/);
  assert.match(prompt, /#abcdef/);
  assert.match(prompt, /logo officiel/);
  for (const exclusion of ["Une affiche pour mon entreprise sans notre logo.", "Pour notre entreprise, ne mets pas le logo."]) {
    assert.equal(freePrompts.getAiMediaFreeBrandPolicy(exclusion).useLogo, false, exclusion);
  }
});

test("l’option ADN conserve le brief Libre et ajoute une identité par défaut sans règles guidées", () => {
  const freePrompt = "Une galaxie dessinée à la main, avec une baleine bleue, sans texte ni publicité.";
  for (const build of [freePrompts.buildAiMediaFreeImagePrompt, freePrompts.buildAiMediaFreeSceneFramePrompt, freePrompts.buildAiMediaFreeVideoPrompt]) {
    const original = build(args({ freePrompt }));
    assert.equal(build(args({ freePrompt, useBusinessDna: false })), original);
    const prompt = build(args({ freePrompt, useBusinessDna: true }));
    assert.ok(prompt.includes(freePrompt));
    assert.match(prompt, /METIER_ADN_NON_SOLLICITE/);
    assert.match(prompt, /demande créative reste prioritaire/);
    assert.doesNotMatch(prompt, /configuration_ia|INSTRUCTION_GUIDEE_RESIDUELLE/);
    assert.match(prompt, /#abcdef/);
    assert.match(prompt, /logo officiel/);
  }
  assert.deepEqual(freePrompts.getAiMediaFreeBrandPolicy(freePrompt, "Atelier Test", true), {
    useCompanyContext: true, useLogo: true, useBrandColors: true,
  });
  assert.equal(freePrompts.getAiMediaFreeBrandPolicy("Un nouveau logo pour une autre marque", "Atelier Test", true).useLogo, false);
  assert.equal(freePrompts.getAiMediaFreeBrandPolicy("Une affiche sans logo, sans charte", "Atelier Test", true).useLogo, false);
  assert.equal(freePrompts.getAiMediaFreeBrandPolicy("Une affiche sans logo, sans charte", "Atelier Test", true).useBrandColors, false);
  const branded = freePrompts.buildAiMediaFreeImagePrompt(args({ freePrompt: "Une affiche avec le logo et notre charte.", useBusinessDna: true }));
  assert.match(branded, /logo officiel/);
  assert.match(branded, /#abcdef/);
});

test("décocher l’ADN préserve la prise en compte des faits explicitement demandés dans le prompt", () => {
  const freePrompt = "Une affiche pour mon entreprise avec notre charte et le logo de mon entreprise.";
  const original = freePrompts.buildAiMediaFreeImagePrompt(args({ freePrompt }));
  assert.equal(freePrompts.buildAiMediaFreeImagePrompt(args({ freePrompt, useBusinessDna: false })), original);
  assert.match(original, /METIER_ADN_NON_SOLLICITE|logo officiel/);
});

test("la vidéo libre respecte la durée, les menus de référence et l'absence ou présence de voix off", () => {
  for (const withNarration of [false, true]) {
    const input = args({
      kind: "video", durationSeconds: 20, sceneMode: "single", withNarration, withMusic: false,
      inspirationImages: [{ data: "A".repeat(64), mimeType: "image/png", role: "product", usage: "required" }],
    });
    const prompt = freePrompts.buildAiMediaFreeVideoPrompt(input);
    assert.match(prompt, /20 secondes/);
    assert.match(prompt, /9:16/);
    assert.match(prompt, /une action continue/);
    assert.match(prompt, /rôle product, usage obligatoire/);
    assert.match(prompt, /Aucune musique/);
    assert.match(prompt, withNarration ? /voix off est produite séparément/ : /Aucune voix off/);
  }
});

test("Libre conserve le scénario choisi dans le sélecteur partagé du bandeau", () => {
  assert.match(freeGeneratorSource, /useState<MediaGenerationVideoSceneMode>\("single"\)/);
  assert.match(freeGeneratorSource, /onDurationSceneChange=\{\(seconds, mode\) => \{ setDuration\(seconds\); setSceneMode\(mode\); \}\}/);
  assert.match(freeGeneratorSource, /<MediaGenerationActions>[\s\S]*?\{engineControls\}/);
  assert.doesNotMatch(freeGeneratorSource, /<MediaVideoDurationSelect|className=\{styles\.sceneOptions\}/);
  assert.match(freeGeneratorSource, /getMediaVideoDurationChoices\(maxDuration\)/);
  assert.match(freeGeneratorSource, /canGenerateAiMediaVideoDuration\(enginePreference\.videoEngine, duration, videoResolution, sceneMode\)/);
  assert.doesNotMatch(freeGeneratorSource, /setDuration\(\(current\)/);
  assert.doesNotMatch(freeGeneratorSource, /const DURATIONS = \[8, 16, 24\]/);
  assert.match(freeGeneratorSource, /sceneMode: kind === "video" \? sceneMode : undefined/);
  assert.match(freeGeneratorStyles, /\.workspace \.formatFieldset\s*\{\s*grid-column:\s*1 \/ -1/);
  assert.doesNotMatch(freeGeneratorSource, /ai_generator_free_scene_(?:single|multi)_hint/);
});

test("Libre utilise une scène continue par défaut ; Multiscène conserve des plans indépendants", () => {
  for (const durationSeconds of [16, 20] as const) {
    const single = request({ kind: "video", durationSeconds });
    assert.equal(single.sceneMode, "single");
    assert.equal(single.connectScenes, true);
    assert.match(freePrompts.buildAiMediaFreeVideoPrompt({ request: single, profile, brandColors: [], hasLogo: false }), /une action continue dans un même décor/);

    const multi = request({ kind: "video", durationSeconds, sceneMode: "multi" });
    assert.equal(multi.sceneMode, "multi");
    assert.equal(multi.connectScenes, false);
    assert.match(freePrompts.buildAiMediaFreeVideoPrompt({ request: multi, profile, brandColors: [], hasLogo: false }), /exactement deux plans distincts/);
  }
  const short = request({ kind: "video", durationSeconds: 8, sceneMode: "multi" });
  assert.equal(short.sceneMode, "multi");
  assert.equal(short.connectScenes, false);
});

test("le réalisateur Libre distingue une scène continue de plusieurs plans", async () => {
  for (const sceneMode of ["single", "multi"] as const) {
    const runtime = loadPlan({ direction: "Deux étapes dans un atelier.", scenes: ["Le geste commence.", "Le geste se poursuit."] });
    const input = request({ kind: "video", durationSeconds: 16, sceneMode });
    await runtime.prepareAiMediaFreeCreativePlan({ accountId: "test", request: input, profile });
    assert.equal(JSON.parse(runtime.calls[0]!.input).scene_mode, sceneMode);
    assert.match(runtime.calls[0]!.system, sceneMode === "single" ? /UNE SEULE scène continue/ : /plans demandé/);
  }
});

test("le contrat vidéo libre garde les 4 000 caractères sans style guidé ni perte des références", () => {
  const input = request({ kind: "video", durationSeconds: 16, freePrompt: "x".repeat(4_000), withNarration: true });
  const contract = buildAiMediaVideoProviderContract({ request: input, durationSeconds: 8, brandColors: ["#abcdef"] });
  assert.equal(contract.instruction, input.freePrompt);
  assert.equal(contract.subject, "");
  assert.match(contract.parameters, /mode=free/);
  assert.match(contract.parameters, /film=16s/);
  assert.match(contract.parameters, /voiceover=separate/);
  assert.doesNotMatch(contract.parameters, /look=|faithful|photo|#abcdef/);
  assert.doesNotThrow(() => assertAiMediaVideoProviderContract(contract));
});

test("le plan image Libre ne déclenche aucun rédacteur guidé ni appel texte supplémentaire", async () => {
  const runtime = loadPlan({});
  const plan = await runtime.prepareAiMediaFreeCreativePlan({ accountId: "test", request: request(), profile });
  assert.equal(runtime.calls.length, 0);
  assert.equal(plan.headline, "");
  assert.equal(plan.cta, "");
  assert.equal(plan.companyName, "");
  assert.equal(plan.scenes.length, 1);
  assert.equal(plan.scenes[0]!.title, "");
});

test("le réalisateur vidéo libre reçoit le brief entier et restaure les valeurs littérales omises", async () => {
  const runtime = loadPlan({ direction: "Deux scènes dessinées, dans les nuages.", scenes: ["Une baleine apparaît.", "Elle traverse les nuages."] });
  const input = request({ kind: "video", durationSeconds: 16, freePrompt: 'Montrer une affiche "21 jours gratuits" puis un prix de 39,90 € dans un univers dessiné.' });
  const plan = await runtime.prepareAiMediaFreeCreativePlan({ accountId: "test", request: input, profile });
  assert.equal(runtime.calls.length, 1);
  const parsed = JSON.parse(runtime.calls[0]!.input);
  assert.equal(parsed.brief, input.freePrompt);
  assert.equal(parsed.company, null);
  assert.equal(parsed.count, 2);
  assert.equal(parsed.duration, 16);
  assert.match(plan.subline, /21 jours gratuits/);
  assert.match(plan.subline, /39,90 €/);
  assert.deepEqual(plan.scenes.map((scene) => scene.visualBrief), ["Une baleine apparaît.", "Elle traverse les nuages."]);
  assert.equal(plan.cta, "");
});

test("l’ADN choisi atteint le réalisateur et la voix off comme contexte facultatif, sans copie commerciale guidée", async () => {
  for (const useBusinessDna of [false, true]) {
    const input = request({ kind: "video", durationSeconds: 8, withNarration: true, useBusinessDna });
    const director = loadPlan({ direction: "Une baleine traverse les nuages.", scenes: ["La baleine avance lentement."] });
    const plan = await director.prepareAiMediaFreeCreativePlan({ accountId: "test", request: input, profile });
    const narration = loadPlan({ script: "Une baleine traverse les nuages.", language: "fr" });
    await narration.writeAiMediaFreeNarration({ accountId: "test", request: input, profile, plan });
    for (const call of [...director.calls, ...narration.calls]) {
      const parsed = JSON.parse(call.input);
      assert.equal(parsed.brief, input.freePrompt);
      if (useBusinessDna) {
        assert.ok(parsed.company);
        assert.match(JSON.stringify(parsed.company), /METIER_ADN_NON_SOLLICITE/);
        assert.match(call.system, /prioritaire/);
        assert.doesNotMatch(call.input, /configuration_ia|INSTRUCTION_GUIDEE_RESIDUELLE/);
      } else {
        assert.equal(parsed.company, null);
      }
    }
    assert.equal(plan.headline, "");
    assert.equal(plan.cta, "");
    assert.equal(plan.companyName, "");
  }
});

test("un découpage vidéo incomplet est refusé avant les appels média", async () => {
  for (const result of [{ direction: "Court film", scenes: [] }, { direction: "Court film", scenes: ["Un seul plan"] }, { direction: "", scenes: ["Premier plan", "Second plan"] }]) {
    const runtime = loadPlan(result);
    await assert.rejects(runtime.prepareAiMediaFreeCreativePlan({ accountId: "test", request: request({ kind: "video", durationSeconds: 16 }), profile }), contracts.AiMediaRequestValidationError);
  }
});

test("la voix off Libre respecte le texte exact et refuse de le tronquer pour tenir dans la durée", async () => {
  const runtime = loadPlan({});
  const input = request({ kind: "video", durationSeconds: 8, withNarration: true, freePrompt: 'Une baleine bleue dans le ciel. Voix off : « Découvrez un monde merveilleux. »' });
  const result = await runtime.writeAiMediaFreeNarration({ accountId: "test", request: input, profile, plan: runtime.buildAiMediaFreeBasePlan(input) });
  assert.equal(result?.script, "Découvrez un monde merveilleux.");
  assert.equal(runtime.calls.length, 0);
  const tooLong = request({ kind: "video", durationSeconds: 8, withNarration: true, freePrompt: `Voix off : « ${"mot ".repeat(30)}. »` });
  await assert.rejects(runtime.writeAiMediaFreeNarration({ accountId: "test", request: tooLong, profile, plan: runtime.buildAiMediaFreeBasePlan(tooLong) }), contracts.AiMediaRequestValidationError);
});

test("sans option voix off, Libre ne lance aucune génération de narration", async () => {
  const runtime = loadPlan({ script: "Ceci ne doit pas être utilisé.", language: "fr" });
  const input = request({ kind: "video", withNarration: false });
  assert.equal(await runtime.writeAiMediaFreeNarration({ accountId: "test", request: input, profile, plan: runtime.buildAiMediaFreeBasePlan(input) }), null);
  assert.equal(runtime.calls.length, 0);
});

test("generated narration exceeding the duration uses the existing bounded text fallback without changing the brief", async () => {
  const gateway = loadDialogueGateway([
    { script: "mot ".repeat(30).trim(), language: "fr" },
    { script: "Découvrez un monde merveilleux dans les nuages.", language: "fr" },
  ]);
  const runtime = loadPlan(null, gateway.generate);
  const input = request({ kind: "video", durationSeconds: 8, withNarration: true });
  const narration = await runtime.writeAiMediaFreeNarration({ accountId: "test", request: input, profile, plan: runtime.buildAiMediaFreeBasePlan(input) });
  assert.equal(narration?.script, "Découvrez un monde merveilleux dans les nuages.");
  assert.equal(gateway.calls.length, 2); assert.equal(runtime.calls.length, 1);
  assert.equal(gateway.calls[0].deadlineAt, gateway.calls[1].deadlineAt);
  assert.equal(JSON.parse(runtime.calls[0].input).brief, input.freePrompt);
  assert.ok(gateway.calls.every((call) => call.maxOutputTokens === 1_600));
  const firstAttempt = JSON.parse(gateway.calls[0].input);
  const retry = JSON.parse(gateway.calls[1].input);
  assert.equal(firstAttempt.rewrite, undefined);
  assert.equal(retry.brief, input.freePrompt);
  assert.equal(retry.max_words, 14);
  assert.equal(retry.rewrite.word_count, 30);
  assert.equal(retry.rewrite.draft, "mot ".repeat(30).trim());
  assert.match(retry.rewrite.instruction, /1 à 14 mots/);
  assert.ok(narration!.wordCount <= retry.max_words);
});

test("a shorter TTS budget reaches every narration attempt and its rewrite feedback", async () => {
  const gateway = loadDialogueGateway([
    { script: "Le drainage lymphatique est une technique de massage douce qui accompagne la circulation.", language: "fr" },
    { script: "Un massage doux accompagne la circulation.", language: "fr" },
  ]);
  const runtime = loadPlan(null, gateway.generate);
  const input = request({ kind: "video", durationSeconds: 8, withNarration: true, freePrompt: "Une femme explique une technique de massage." });
  const narration = await runtime.writeAiMediaFreeNarration({ accountId: "test", request: input, profile, plan: runtime.buildAiMediaFreeBasePlan(input), maximumSpeechUnits: 6 });
  assert.equal(narration?.script, "Un massage doux accompagne la circulation.");
  assert.equal(narration?.wordCount, 6);
  assert.equal(gateway.calls.length, 2);
  assert.ok(gateway.calls.every((call) => JSON.parse(call.input).max_words === 6));
  assert.match(JSON.parse(gateway.calls[1].input).rewrite.instruction, /1 à 6 mots/);
});

test("exhausted generated narration is an application failure, never an accusation that the short user prompt is too long", async () => {
  const invalid = { script: "mot ".repeat(30).trim(), language: "fr" };
  const gateway = loadDialogueGateway([invalid, invalid]); const runtime = loadPlan(null, gateway.generate);
  const input = request({ kind: "video", durationSeconds: 8, withNarration: true, freePrompt: "Une baleine dans le ciel." });
  await assert.rejects(runtime.writeAiMediaFreeNarration({ accountId: "test", request: input, profile, plan: runtime.buildAiMediaFreeBasePlan(input) }), (error: Error) => {
    assert.equal(error.message, "ai_media_generated_narration_invalid");
    assert.ok(!(error instanceof contracts.AiMediaRequestValidationError)); return true;
  });
  assert.equal(gateway.calls.length, 2);
});

test("le prompt Omni libre exploite ses plans distincts et la continuité sans gabarit guidé", () => {
  const input = request({ kind: "video", durationSeconds: 16, withNarration: true, narrationVoiceVariant: "Sulafat" });
  const nativeNarrationLines = ["La baleine découvre les nuages.", "Le soleil lui répond avec douceur."];
  const providerContract = buildAiMediaVideoProviderContract({ request: input, durationSeconds: 8, brandColors: [], nativeNarrationLines });
  const provider = {
    request: input, providerContract, nativeNarrationLines, contentLanguage: "fr",
    plan: { headline: "", companyName: "", cta: "", subline: "DIRECTION_LIBRE_UNIQUE", scenes: [
      { visualBrief: "ETAPE_UNIQUE_UN" }, { visualBrief: "ETAPE_UNIQUE_DEUX" },
    ] },
  } as unknown as AiVideoProviderGenerationArgs;
  const prompt = freePrompts.buildAiMediaFreeVideoScenePrompt(provider, 1, 8, { continuationFrame: true, firstFrameTag: true });
  assert.match(prompt, /DIRECTION_LIBRE_UNIQUE/);
  assert.match(prompt, /ETAPE_UNIQUE_DEUX/);
  assert.doesNotMatch(prompt, /ETAPE_UNIQUE_UN/);
  assert.match(prompt, /<FIRST_FRAME>@Image1/);
  assert.match(prompt, /No native voices or dialogue/);
  assert.match(prompt, /VISUAL SPEECH:/);
  assert.doesNotMatch(prompt, /NATIVE VOICEOVER|La baleine découvre les nuages|Le soleil lui répond avec douceur/);
  assert.ok(prompt.length <= 3_200);
  assert.throws(() => freePrompts.buildAiMediaFreeVideoScenePrompt({ ...provider, plan: { ...provider.plan, subline: "x".repeat(4_000) } }, 0, 8), /too_long/);
});

test("le script de voix off Libre est réparti sans perte et ne contamine pas le moteur visuel", () => {
  const lines = freePrompts.splitAiMediaFreeNarrationByScene("Bonjour à tous. Voici notre atelier. Nous façonnons des pièces avec soin.", 2);
  assert.equal(lines.length, 2);
  assert.throws(() => freePrompts.splitAiMediaFreeNarrationByScene("Bonjour à tous.", 3), contracts.AiMediaRequestValidationError);
  const longScript = Array.from({ length: 50 }, (_, index) => `mot${index}`).join(" ");
  const longLines = freePrompts.splitAiMediaFreeNarrationByScene(longScript, 2, [15, 15]);
  assert.equal(longLines.join(" "), longScript);
  assert.ok(longLines.every((line) => line.split(" ").length <= 28));
  assert.throws(() => freePrompts.splitAiMediaFreeNarrationByScene(longScript, 2, [4, 4]), contracts.AiMediaRequestValidationError);
  assert.equal(lines.filter(Boolean).join(" "), "Bonjour à tous. Voici notre atelier. Nous façonnons des pièces avec soin.");
  assert.equal(lines[1], "");
  const twoActs = freePrompts.splitAiMediaFreeNarrationByScene(
    "Dans notre atelier, chaque tasse naît d'un geste patient et précis. Nous choisissons l'argile avec soin avant de la façonner lentement.",
    2,
  );
  assert.equal(twoActs.length, 2);
  assert.match(twoActs[0]!, /précis\.$/);
  assert.match(twoActs[1]!, /^Nous choisissons/);
  const input = request({ kind: "video", durationSeconds: 20, withNarration: true });
  const providerContract = buildAiMediaVideoProviderContract({ request: input, durationSeconds: 8, brandColors: [], nativeNarrationLines: lines });
  const provider = { request: input, providerContract, nativeNarrationLines: lines, plan: {
    subline: "Un atelier artisanal.", scenes: [{ visualBrief: "Entrée" }, { visualBrief: "L'établi" }],
  } } as unknown as AiVideoProviderGenerationArgs;
  assert.match(providerContract.parameters, /voiceover=separate/);
  assert.doesNotMatch(providerContract.parameters, /narration_sha256=/);
  for (const nativeNarrationLines of [lines, ["Texte modifié", ""]]) {
    const prompt = freePrompts.buildAiMediaFreeVideoScenePrompt({ ...provider, nativeNarrationLines }, 0, 8);
    assert.match(prompt, /No native voices or dialogue/);
    assert.doesNotMatch(prompt, /NATIVE VOICEOVER|Bonjour à tous|Texte modifié/);
    assert.match(prompt, /Un atelier artisanal/);
  }
});

test("le réalisateur Libre prépare des personnages parlants sans rédacteur ou réplique commerciale guidés", async () => {
  const runtime = loadPlan({ direction: "Film d'animation dans les nuages.", scenes: [
    { visualBrief: "La baleine sourit et parle.", spokenLine: "Les nuages ont un goût de vanille !" },
    { visualBrief: "Le soleil lui répond en souriant.", spokenLine: "Alors partageons ce délicieux voyage ensemble !" },
  ] });
  const input = request({ kind: "video", durationSeconds: 16, teamVideoSpeechMode: "characters", freePrompt: "Une baleine et un soleil discutent du goût des nuages, dans un dessin animé." });
  const plan = await runtime.prepareAiMediaFreeCreativePlan({ accountId: "test", request: input, profile });
  assert.equal(JSON.parse(runtime.calls[0]!.input).native_dialogue, true);
  assert.doesNotMatch(runtime.calls[0]!.system, /Aucun dialogue natif/);
  assert.equal(plan.scenes[0]!.spokenLine, "Les nuages ont un goût de vanille !");
  assert.equal(plan.scenes[1]!.spokenLine, "Alors partageons ce délicieux voyage ensemble !");
  const providerContract = buildAiMediaVideoProviderContract({ request: input, durationSeconds: 8, brandColors: [] });
  const provider = { request: input, providerContract, plan } as AiVideoProviderGenerationArgs;
  const prompt = freePrompts.buildAiMediaFreeVideoScenePrompt(provider, 1, 8);
  assert.match(prompt, /NATIVE DIALOGUE/);
  assert.match(prompt, /Alors partageons ce délicieux voyage ensemble/);
  assert.doesNotMatch(prompt, /Les nuages ont un goût de vanille|No native voices|voiceover is added|Votre projet/);
  assert.match(providerContract.parameters, /characters=native-dialogue;voiceover=none/);
  assert.match(freePrompts.buildAiMediaFreeVideoPrompt({ request: input, profile }), /personnages parlent/);
  const speech = await runtime.writeAiMediaFreeNarration({ accountId: "test", request: { ...input, withNarration: true }, profile, plan });
  assert.equal(speech, null);
  assert.equal(runtime.calls.length, 1);
});

test("le dialogue Libre conserve une citation même courte et située après 2 000 caractères", async () => {
  const runtime = loadPlan({ direction: "Un astronaute dans un dessin animé.", scenes: [
    { visualBrief: "L'astronaute dit bonjour.", spokenLine: "Une réplique inventée par erreur." },
    { visualBrief: "Il salue la planète en silence.", spokenLine: "Autre réplique non demandée." },
  ] });
  const freePrompt = `${"Des étoiles brillent au loin. ".repeat(80)} L'astronaute dit : « Bonjour ! »`;
  const input = request({ kind: "video", durationSeconds: 16, teamVideoSpeechMode: "characters", freePrompt });
  const plan = await runtime.prepareAiMediaFreeCreativePlan({ accountId: "test", request: input, profile });
  assert.deepEqual(plan.scenes.map((scene) => scene.spokenLine), ["Bonjour !", ""]);
  assert.deepEqual(freePrompts.resolveAiMediaFreeDialogueSequence({ request: input, plan }), ["Bonjour !", ""]);
  const providerContract = buildAiMediaVideoProviderContract({ request: input, durationSeconds: 8, brandColors: [] });
  const provider = { request: input, providerContract, plan } as AiVideoProviderGenerationArgs;
  assert.match(freePrompts.buildAiMediaFreeVideoScenePrompt(provider, 0, 8), /Bonjour !/);
  assert.match(freePrompts.buildAiMediaFreeVideoScenePrompt(provider, 1, 8), /no speech in this shot/);
});

test("un dialogue IA absent ou trop long est une sortie fournisseur invalide, pas une demande utilisateur invalide", async () => {
  for (const spokenLine of ["", " \n\t ", "mot ".repeat(15), "a".repeat(141), 123]) {
    const scenes = [{ visualBrief: "La baleine parle.", spokenLine }];
    const runtime = loadPlan({ direction: "Court film animé.", scenes });
    await assert.rejects(runtime.prepareAiMediaFreeCreativePlan({ accountId: "test", request: request({ kind: "video", durationSeconds: 8, teamVideoSpeechMode: "characters" }), profile }), (error: unknown) => {
      assert.ok(error instanceof AiJsonResponseNormalizationError);
      assert.equal(error.code, "ai_gateway_invalid_output");
      assert.ok(!(error instanceof contracts.AiMediaRequestValidationError));
      return true;
    });
  }
});

test("dialogue budgets follow actual duration and non-space languages without a fixed 90-character ceiling", async () => {
  const spokenLine = "Bienvenue dans notre atelier où nous fabriquons chaque jour vos meubles sur mesure avec passion et beaucoup de soin.";
  assert.ok(spokenLine.length > 90);
  assert.doesNotThrow(() => freePrompts.validateAiMediaFreeDialogueLine(spokenLine, 30, "fr"));
  assert.throws(() => freePrompts.validateAiMediaFreeDialogueLine(spokenLine, 8, "fr"), contracts.AiMediaRequestValidationError);
  assert.doesNotThrow(() => freePrompts.validateAiMediaFreeDialogueLine("让".repeat(42), 8, "zh"));
  assert.throws(() => freePrompts.validateAiMediaFreeDialogueLine("让".repeat(43), 8, "zh"), contracts.AiMediaRequestValidationError);
  const runtime = loadPlan({ direction: "Le personnage visite son atelier.", scenes: [{ visualBrief: "Un artisan s'adresse à la caméra.", spokenLine }] });
  const input = request({ kind: "video", videoEngine: "wan3", durationSeconds: 30, teamVideoSpeechMode: "characters", freePrompt: `L'artisan dit « ${spokenLine} ».` });
  const plan = await runtime.prepareAiMediaFreeCreativePlan({ accountId: "test", request: input, profile });
  assert.equal(plan.scenes[0].spokenLine, spokenLine);
  const payload = JSON.parse(runtime.calls[0].input);
  assert.equal(payload.dialogue_budgets[0].duration_seconds, 30);
  assert.equal(payload.dialogue_budgets[0].maxUnits, 58);
  assertAiJsonMatchesSchema({ direction: "Le personnage visite son atelier.", scenes: [{ visualBrief: "Un artisan s'adresse à la caméra.", spokenLine }] }, runtime.calls[0].responseSchema.schema);
});

test("quoted and generated voiceovers share the explicitly requested language over the profile default", async () => {
  const line = "Discover our workshop and meet the people behind every creation.";
  const runtime = loadPlan({ script: line, language: "fr" });
  const quoted = request({ kind: "video", videoEngine: "veo", durationSeconds: 8, withNarration: true, freePrompt: `Une visite, voix off en anglais. Narration exacte : « ${line} »` });
  const exact = await runtime.writeAiMediaFreeNarration({ accountId: "test", request: quoted, profile, plan: runtime.buildAiMediaFreeBasePlan(quoted) });
  assert.equal(exact?.language, "en");
  assert.equal(exact?.script, line);
  assert.equal(runtime.calls.length, 0);
  const generated = { ...quoted, freePrompt: "Une visite avec une voix off en anglais." };
  assert.equal((await runtime.writeAiMediaFreeNarration({ accountId: "test", request: generated, profile, plan: runtime.buildAiMediaFreeBasePlan(generated) }))?.language, "en");
  assert.equal(freePrompts.resolveAiMediaFreeSpeechLanguage("Narration exacte", line, "fr"), "en");
  assert.equal(freePrompts.resolveAiMediaFreeSpeechLanguage("Film", "Bonjour", "fr"), "fr");
});

test("les citations trop longues ou trop nombreuses restent rejetées avant tout appel IA", async () => {
  for (const freePrompt of ['Il dit « Bonjour ! ». Elle répond « Salut ! ».', `Il dit « ${"mot ".repeat(15)} ».`]) {
    const runtime = loadPlan({});
    await assert.rejects(runtime.prepareAiMediaFreeCreativePlan({ accountId: "test", request: request({ kind: "video", durationSeconds: 8, teamVideoSpeechMode: "characters", freePrompt }), profile }), contracts.AiMediaRequestValidationError);
    assert.equal(runtime.calls.length, 0);
  }
});

test("le schéma des voix exige des paroles générées mais autorise le silence après une citation", async () => {
  const response = { direction: "Court film animé.", scenes: [{ visualBrief: "La baleine parle.", spokenLine: "  Bonjour,   petit nuage !  " }] };
  const runtime = loadPlan(response);
  const input = request({ kind: "video", durationSeconds: 8, teamVideoSpeechMode: "characters" });
  const plan = await runtime.prepareAiMediaFreeCreativePlan({ accountId: "test", request: input, profile });
  assert.equal(plan.scenes[0]!.spokenLine, "Bonjour, petit nuage !");
  assert.throws(() => assertAiJsonMatchesSchema({ ...response, scenes: [{ ...response.scenes[0], spokenLine: "" }] }, runtime.calls[0]!.responseSchema.schema));

  const exact = loadPlan({ direction: "Court film animé.", scenes: [
    { visualBrief: "La baleine parle.", spokenLine: "Une phrase fournisseur incorrecte. ".repeat(6) },
    { visualBrief: "Le nuage sourit.", spokenLine: "Une réplique non demandée." },
  ] });
  const exactInput = request({ kind: "video", durationSeconds: 16, teamVideoSpeechMode: "characters", freePrompt: 'La baleine dit « Bonjour ! » puis sourit.' });
  const exactPlan = await exact.prepareAiMediaFreeCreativePlan({ accountId: "test", request: exactInput, profile });
  assert.deepEqual(exactPlan.scenes.map((scene) => scene.spokenLine), ["Bonjour !", ""]);
  assert.doesNotThrow(() => assertAiJsonMatchesSchema({ direction: exactPlan.subline, scenes: exactPlan.scenes.map(({ visualBrief, spokenLine }) => ({ visualBrief, spokenLine })) }, exact.calls[0]!.responseSchema.schema));
});

test("une voix IA vide est récupérée par le secours Gateway dans la même deadline", async () => {
  const gateway = loadDialogueGateway([
    { direction: "Court film animé.", scenes: [{ visualBrief: "La baleine parle.", spokenLine: "" }] },
    { direction: "Court film animé.", scenes: [{ visualBrief: "La baleine parle.", spokenLine: "Bonjour, petit nuage !" }] },
  ]);
  const runtime = loadPlan(null, gateway.generate);
  const plan = await runtime.prepareAiMediaFreeCreativePlan({ accountId: "test", request: request({ kind: "video", durationSeconds: 8, teamVideoSpeechMode: "characters" }), profile });
  assert.equal(plan.scenes[0]!.spokenLine, "Bonjour, petit nuage !");
  assert.equal(runtime.calls.length, 1);
  assert.equal(gateway.calls.length, 2);
  assert.notEqual(gateway.calls[0]!.model, gateway.calls[1]!.model);
  assert.equal(gateway.calls[0]!.deadlineAt, gateway.calls[1]!.deadlineAt);
  assert.ok(gateway.calls.every((call) => call.timeoutMs <= 30_000));
});

test("deux réponses IA invalides épuisent les secours sans boucle ni erreur de demande utilisateur", async () => {
  const badResponse = { direction: "Court film animé.", scenes: [{ visualBrief: "La baleine parle.", spokenLine: "" }] };
  const gateway = loadDialogueGateway([badResponse, badResponse]);
  const runtime = loadPlan(null, gateway.generate);
  await assert.rejects(runtime.prepareAiMediaFreeCreativePlan({ accountId: "test", request: request({ kind: "video", durationSeconds: 8, teamVideoSpeechMode: "characters" }), profile }), AiJsonResponseNormalizationError);
  assert.equal(runtime.calls.length, 1);
  assert.equal(gateway.calls.length, 2);
});

test("dialogue rewrite feedback repairs only automatic over-budget lines in the existing bounded fallback", async () => {
  const goodLine = "Bonjour, petit nuage !";
  const longLine = "Nous explorons ensemble ce merveilleux ciel pour découvrir les secrets de chaque petit nuage blanc.";
  const response = (spokenLine: string) => ({ direction: "Une baleine explore les nuages.", scenes: [
    { visualBrief: "La baleine salue le nuage.", spokenLine: goodLine },
    { visualBrief: "Le nuage lui répond.", spokenLine },
  ] });
  const gateway = loadDialogueGateway([response(longLine), response("Explorons ce ciel ensemble !")]);
  const runtime = loadPlan(null, gateway.generate);
  const input = request({ kind: "video", durationSeconds: 16, teamVideoSpeechMode: "characters" });
  const plan = await runtime.prepareAiMediaFreeCreativePlan({ accountId: "test", request: input, profile });
  assert.deepEqual(plan.scenes.map((scene) => scene.spokenLine), [goodLine, "Explorons ce ciel ensemble !"]);
  assert.equal(runtime.calls.length, 1, "Reuse the existing Gateway chain instead of opening another operation.");
  assert.equal(gateway.calls.length, 2);
  assert.equal(gateway.calls[0].deadlineAt, gateway.calls[1].deadlineAt);
  const first = JSON.parse(gateway.calls[0].input);
  const retry = JSON.parse(gateway.calls[1].input);
  assert.equal(first.rewrite_dialogue, undefined);
  assert.equal(retry.brief, input.freePrompt);
  assert.deepEqual(retry.exact_dialogue, []);
  assert.equal(retry.rewrite_dialogue.length, 1);
  assert.equal(retry.rewrite_dialogue[0].scene, 2);
  assert.equal(retry.rewrite_dialogue[0].duration_seconds, 8);
  assert.equal(retry.rewrite_dialogue[0].draft, longLine);
  assert.equal(retry.rewrite_dialogue[0].units, 15);
  assert.equal(retry.rewrite_dialogue[0].maxUnits, 14);
  assert.equal(retry.rewrite_dialogue[0].maxCharacters, 140);
  assert.match(retry.rewrite_dialogue[0].instruction, /phrase complète/i);
});

test("dialogue rewrite feedback respects character and non-space budgets and stops when fallback is exhausted", async () => {
  for (const [spokenLine, freePrompt, units, unit] of [
    ["a".repeat(141), "Un personnage parle dans les nuages.", 1, "mots"],
    ["让".repeat(43), "Un personnage parle en chinois dans les nuages.", 43, "caractères prononcés"],
  ] as const) {
    const invalid = { direction: "Court film animé.", scenes: [{ visualBrief: "Le personnage parle.", spokenLine }] };
    const gateway = loadDialogueGateway([invalid, invalid]);
    const runtime = loadPlan(null, gateway.generate);
    await assert.rejects(runtime.prepareAiMediaFreeCreativePlan({ accountId: "test", request: request({ kind: "video", durationSeconds: 8, teamVideoSpeechMode: "characters", freePrompt }), profile }), AiJsonResponseNormalizationError);
    assert.equal(runtime.calls.length, 1);
    assert.equal(gateway.calls.length, 2, "No outer retry is added when both allowed model attempts fail.");
    const feedback = JSON.parse(gateway.calls[1].input).rewrite_dialogue[0];
    assert.equal(feedback.units, units);
    assert.equal(feedback.unit, unit);
    assert.equal(feedback.draft, spokenLine);
  }
});

test("planner requires silent staging for both voiceover and silent video without changing the user's brief", async () => {
  for (const withNarration of [true, false]) {
    const runtime = loadPlan({ direction: "Une femme présente son agence par des gestes.", scenes: ["Elle montre les bureaux en silence."] });
    const input = request({ kind: "video", durationSeconds: 8, withNarration, teamVideoSpeechMode: "voiceover", freePrompt: "Une femme explique les services de son agence." });
    const plan = await runtime.prepareAiMediaFreeCreativePlan({ accountId: "test", request: input, profile });
    assert.equal(runtime.calls.length, 1);
    assert.match(runtime.calls[0].system, /direction et visualBrief.*mise en scène silencieuse/u);
    assert.match(runtime.calls[0].system, /gestes.*regards/u);
    assert.match(runtime.calls[0].system, /sans articulation.*lèvres/u);
    assert.equal(JSON.parse(runtime.calls[0].input).brief, input.freePrompt);
    assert.equal(JSON.parse(runtime.calls[0].input).native_dialogue, false);
    assert.equal(plan.scenes[0].spokenLine, "");
  }
});
