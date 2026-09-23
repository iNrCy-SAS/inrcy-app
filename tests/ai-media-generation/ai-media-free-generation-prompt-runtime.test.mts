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

const profile = {
  business: {
    companyName: "Atelier Test", professionLabel: "METIER_ADN_NON_SOLLICITE", services: [],
    customerTypologies: [], strengths: [], interventionZones: [],
  },
  memory: { targetAudiences: [], differentiators: [], recentNewsItems: [] },
  preferences: { language: "fr", premiumEnabled: false, customInstructions: "INSTRUCTION_GUIDEE_RESIDUELLE" },
} as unknown as NormalizedAiGenerationProfile;

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

function loadPlan(response: unknown) {
  const calls: Array<{ system: string; input: string; responseSchema: unknown }> = [];
  const exports = transpileModule("../../lib/aiMediaFreeGenerationPlan.ts", new Map<string, unknown>([
    ["server-only", {}],
    ["@/lib/aiGatewayClient", { aiGenerateJSON: async (input: { system: string; input: string; responseSchema: unknown }) => { calls.push(input); return response; } }],
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
    assert.match(prompt, withNarration ? /voix off est ajoutée séparément/ : /Aucune voix off/);
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
  const input = request({ kind: "video", durationSeconds: 16, withNarration: true });
  const providerContract = buildAiMediaVideoProviderContract({ request: input, durationSeconds: 8, brandColors: [] });
  const provider = {
    request: input, providerContract,
    plan: { headline: "", companyName: "", cta: "", subline: "DIRECTION_LIBRE_UNIQUE", scenes: [
      { visualBrief: "ETAPE_UNIQUE_UN" }, { visualBrief: "ETAPE_UNIQUE_DEUX" },
    ] },
  } as unknown as AiVideoProviderGenerationArgs;
  const prompt = freePrompts.buildAiMediaFreeVideoScenePrompt(provider, 1, 8, { continuationFrame: true, firstFrameTag: true });
  assert.match(prompt, /DIRECTION_LIBRE_UNIQUE/);
  assert.match(prompt, /ETAPE_UNIQUE_DEUX/);
  assert.doesNotMatch(prompt, /ETAPE_UNIQUE_UN/);
  assert.match(prompt, /<FIRST_FRAME>@Image1/);
  assert.match(prompt, /voiceover is added separately/);
  assert.ok(prompt.length <= 3_200);
  assert.throws(() => freePrompts.buildAiMediaFreeVideoScenePrompt({ ...provider, plan: { ...provider.plan, subline: "x".repeat(4_000) } }, 0, 8), /too_long/);
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

test("un dialogue Libre absent, trop long ou trop nombreux est rejeté sans substituer un texte guidé", async () => {
  for (const scenes of [[{ visualBrief: "La baleine sourit.", spokenLine: "" }], [{ visualBrief: "La baleine parle.", spokenLine: "mot ".repeat(15) }]]) {
    const runtime = loadPlan({ direction: "Court film animé.", scenes });
    await assert.rejects(runtime.prepareAiMediaFreeCreativePlan({ accountId: "test", request: request({ kind: "video", durationSeconds: 8, teamVideoSpeechMode: "characters" }), profile }), contracts.AiMediaRequestValidationError);
  }
  for (const freePrompt of ['Il dit « Bonjour ! ». Elle répond « Salut ! ».', `Il dit « ${"mot ".repeat(15)} ».`]) {
    const runtime = loadPlan({});
    await assert.rejects(runtime.prepareAiMediaFreeCreativePlan({ accountId: "test", request: request({ kind: "video", durationSeconds: 8, teamVideoSpeechMode: "characters", freePrompt }), profile }), contracts.AiMediaRequestValidationError);
    assert.equal(runtime.calls.length, 0);
  }
});
