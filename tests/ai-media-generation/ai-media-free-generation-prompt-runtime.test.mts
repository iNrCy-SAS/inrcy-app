import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

import type { NormalizedAiGenerationProfile } from "../../lib/aiGenerationProfile.ts";
import * as freePrompts from "../../lib/aiMediaFreeGenerationPrompt.ts";
import * as contracts from "../../lib/aiMediaGenerationContracts.ts";
import { buildAiMediaBusinessDnaPayload } from "../../lib/aiMediaBusinessDna.ts";
import { getAiMediaVideoSegmentCount } from "../../lib/aiMediaVideoTimeline.ts";
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
    ["@/lib/aiMediaVideoTimeline", { getAiMediaVideoSegmentCount }],
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
  const calls: Array<{ model: string; deadlineAt: number; timeoutMs: number }> = [];
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
      const { model } = JSON.parse(init.body);
      const response = responses[calls.length];
      calls.push({ model, deadlineAt: init.deadlineAt, timeoutMs: init.timeoutMs });
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

test("la vidéo libre respecte la durée, les menus de référence et l'absence ou présence de voix off", () => {
  for (const withNarration of [false, true]) {
    const input = args({
      kind: "video", durationSeconds: 24, sceneMode: "single", withNarration, withMusic: false,
      inspirationImages: [{ data: "A".repeat(64), mimeType: "image/png", role: "product", usage: "required" }],
    });
    const prompt = freePrompts.buildAiMediaFreeVideoPrompt(input);
    assert.match(prompt, /24 secondes/);
    assert.match(prompt, /9:16/);
    assert.match(prompt, /une action continue/);
    assert.match(prompt, /rôle product, usage obligatoire/);
    assert.match(prompt, /Aucune musique/);
    assert.match(prompt, withNarration ? /voix off native/ : /Aucune voix off/);
  }
});

test("le choix de scènes Libre n'apparaît qu'à 16 ou 24 s, sous la durée, avec 1 scène par défaut", () => {
  assert.match(freeGeneratorSource, /useState<MediaGenerationVideoSceneMode>\("single"\)/);
  assert.match(freeGeneratorSource, /<div className=\{styles\.durationOptions\}>[\s\S]*?\{duration > 8 \? \(\s*<div className=\{styles\.sceneOptions\}/);
  assert.match(freeGeneratorSource, /sceneMode: kind === "video" \? sceneMode : undefined/);
  assert.match(freeGeneratorStyles, /\.sceneOptions\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*repeat\(2,/);
  assert.doesNotMatch(freeGeneratorSource, /ai_generator_free_scene_(?:single|multi)_hint/);
});

test("Libre utilise une scène continue par défaut ; Multiscène conserve des plans indépendants", () => {
  for (const durationSeconds of [16, 24] as const) {
    const single = request({ kind: "video", durationSeconds });
    assert.equal(single.sceneMode, "single");
    assert.equal(single.connectScenes, true);
    assert.match(freePrompts.buildAiMediaFreeVideoPrompt({ request: single, profile, brandColors: [], hasLogo: false }), /une action continue dans un même décor/);

    const multi = request({ kind: "video", durationSeconds, sceneMode: "multi" });
    assert.equal(multi.sceneMode, "multi");
    assert.equal(multi.connectScenes, false);
    assert.match(freePrompts.buildAiMediaFreeVideoPrompt({ request: multi, profile, brandColors: [], hasLogo: false }), /plusieurs plans distincts/);
  }
  const short = request({ kind: "video", durationSeconds: 8, sceneMode: "multi" });
  assert.equal(short.sceneMode, "single");
  assert.equal(short.connectScenes, false);
});

test("le réalisateur Libre distingue une scène continue de plusieurs plans", async () => {
  for (const sceneMode of ["single", "multi"] as const) {
    const runtime = loadPlan({ direction: "Deux étapes dans un atelier.", scenes: ["Le geste commence.", "Le geste se poursuit."] });
    const input = request({ kind: "video", durationSeconds: 16, sceneMode });
    await runtime.prepareAiMediaFreeCreativePlan({ accountId: "test", request: input, profile });
    assert.equal(JSON.parse(runtime.calls[0]!.input).scene_mode, sceneMode);
    assert.match(runtime.calls[0]!.system, sceneMode === "single" ? /UNE SEULE scène continue/ : /plans de 8 secondes demandé/);
  }
});

test("le contrat vidéo libre garde les 4 000 caractères sans style guidé ni perte des références", () => {
  const input = request({ kind: "video", durationSeconds: 16, freePrompt: "x".repeat(4_000), withNarration: true });
  const contract = buildAiMediaVideoProviderContract({ request: input, durationSeconds: 8, brandColors: ["#abcdef"] });
  assert.equal(contract.instruction, input.freePrompt);
  assert.equal(contract.subject, "");
  assert.match(contract.parameters, /mode=free/);
  assert.match(contract.parameters, /film=16s/);
  assert.match(contract.parameters, /voiceover=native/);
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
  assert.match(prompt, /NATIVE VOICEOVER/);
  assert.match(prompt, /Le soleil lui répond avec douceur/);
  assert.match(prompt, /warm, gentle and welcoming tone/);
  assert.doesNotMatch(prompt, /La baleine découvre les nuages/);
  assert.ok(prompt.length <= 3_200);
  assert.throws(() => freePrompts.buildAiMediaFreeVideoScenePrompt({ ...provider, plan: { ...provider.plan, subline: "x".repeat(4_000) } }, 0, 8), /too_long/);
});

test("le script de voix off Libre est réparti sans perte et lié au contrat fournisseur", () => {
  const lines = freePrompts.splitAiMediaFreeNarrationByScene("Bonjour à tous. Voici notre atelier. Nous façonnons des pièces avec soin.", 3);
  assert.equal(lines.length, 3);
  assert.equal(lines.filter(Boolean).join(" "), "Bonjour à tous. Voici notre atelier. Nous façonnons des pièces avec soin.");
  assert.equal(lines[1], "");
  const twoActs = freePrompts.splitAiMediaFreeNarrationByScene(
    "Dans notre atelier, chaque tasse naît d'un geste patient et précis. Nous choisissons l'argile avec soin avant de la façonner lentement.",
    2,
  );
  assert.equal(twoActs.length, 2);
  assert.match(twoActs[0]!, /précis\.$/);
  assert.match(twoActs[1]!, /^Nous choisissons/);
  const input = request({ kind: "video", durationSeconds: 24, withNarration: true });
  const providerContract = buildAiMediaVideoProviderContract({ request: input, durationSeconds: 8, brandColors: [], nativeNarrationLines: lines });
  const provider = { request: input, providerContract, nativeNarrationLines: lines, plan: {
    subline: "Un atelier artisanal.", scenes: [{ visualBrief: "Entrée" }, { visualBrief: "L'établi" }, { visualBrief: "Sortie" }],
  } } as unknown as AiVideoProviderGenerationArgs;
  assert.match(providerContract.parameters, /voiceover=native;narration_sha256=[a-f0-9]{64}/);
  assert.match(freePrompts.buildAiMediaFreeVideoScenePrompt(provider, 1, 8), /this shot has no narration/);
  assert.throws(() => freePrompts.buildAiMediaFreeVideoScenePrompt({ ...provider, nativeNarrationLines: ["Texte modifié", "", ""] }, 0, 8), /contract_incomplete/);
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
  for (const spokenLine of ["", " \n\t ", "mot ".repeat(15), "a".repeat(91), 123]) {
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
