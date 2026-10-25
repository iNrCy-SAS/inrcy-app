import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import * as prompts from "../../lib/aiMediaFreeGenerationPrompt.ts";
import * as contracts from "../../lib/aiMediaGenerationContracts.ts";
import * as timeline from "../../lib/aiMediaVideoTimeline.ts";
import { AI_MEDIA_VIDEO_MODELS } from "../../lib/aiMediaModelCatalog.ts";
import { buildAiMediaVideoProviderContract } from "../../lib/aiMediaVideoProviderContract.ts";
import { assertAiJsonMatchesSchema } from "../../lib/aiJsonSchemaValidation.ts";
import type { AiGenerateJsonOptions } from "../../lib/aiGatewayClient.ts";
import type { NormalizedAiGenerationProfile } from "../../lib/aiGenerationProfile.ts";
import type { AiMediaCreativePlan } from "../../lib/aiMediaCreativePlan.ts";
import type { AiVideoProviderGenerationArgs } from "../../lib/aiVideoProviderTypes.ts";

const brief = "Crée une vidéo d’une femme qui marche dans une agence de publicité iNrCy pour expliquer l’application à ses collègues. Ils se dirigent vers la salle de réunion et boivent un café.";
const profile = {
  business: { companyName: "iNrCy", professionLabel: "Agence", services: [], customerTypologies: [], strengths: [], interventionZones: [] },
  memory: { targetAudiences: [], differentiators: [], recentNewsItems: [] },
  preferences: { language: "fr", premiumEnabled: false, customInstructions: "REGLAGE_GUIDE_INTERDIT" },
} as unknown as NormalizedAiGenerationProfile;

function request(overrides: Record<string, unknown> = {}) {
  return contracts.normalizeAiMediaGenerationRequest({
    requestId: "video-presentation-test-0001", source: "studio", operation: "generate", creationMode: "free",
    kind: "video", format: "landscape", videoEngine: "grok-lite", durationSeconds: 15, sceneMode: "single",
    freePrompt: brief, useBusinessDna: false, withNarration: false, withMusic: false, ...overrides,
  });
}

function loadPlanner(response: Record<string, unknown>) {
  const calls: AiGenerateJsonOptions[] = [];
  const output = ts.transpileModule(readFileSync(new URL("../../lib/aiMediaFreeGenerationPlan.ts", import.meta.url), "utf8"), {
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

function provider(request: contracts.AiMediaGenerationRequest, plan: AiMediaCreativePlan, nativeNarrationLines?: string[]): AiVideoProviderGenerationArgs {
  return {
    request, plan, contentLanguage: "fr", nativeNarrationLines,
    providerContract: buildAiMediaVideoProviderContract({ request, durationSeconds: request.durationSeconds || 8, brandColors: [], nativeNarrationLines }),
  } as AiVideoProviderGenerationArgs;
}

test("le réalisateur et le transport gardent la demande brute avec un cadre unique et aucun sous-titre automatique", async () => {
  const runtime = loadPlanner({ direction: "Une femme rejoint ses collègues, puis tous entrent dans la salle de réunion et prennent un café.", scenes: ["La femme marche vers ses collègues qui l’accompagnent dans la salle de réunion."] });
  const input = request();
  const plan = await runtime.prepareAiMediaFreeCreativePlan({ accountId: "offline-test", request: input, profile });
  assert.equal(JSON.parse(runtime.calls[0].input).brief, brief);
  assert.ok(runtime.calls[0].system.includes(prompts.buildAiMediaFreeVideoPresentationContract(input)));
  const canonical = prompts.buildAiMediaFreeVideoPrompt({ request: input, profile });
  const transport = prompts.buildAiMediaFreeVideoScenePrompt(provider(input, plan), 0, 15);
  for (const prompt of [canonical, transport]) {
    assert.ok(prompt.includes(prompts.buildAiMediaFreeVideoPresentationContract(input)));
    assert.match(prompt, /One full-frame view; no bars\. Actions unfold in time/);
    assert.match(prompt, /No split screen, panels, collage or duplicate views unless requested/);
    assert.match(prompt, /SUBTITLES OFF/);
    assert.match(prompt, /no subtitles, captions or automatic speech transcription on screen/);
    assert.doesNotMatch(prompt, /REGLAGE_GUIDE_INTERDIT/);
  }
  assert.ok(canonical.includes(brief));
  assert.ok(transport.includes(plan.subline));
  assert.ok(transport.length <= 3_200);
});

for (const freePrompt of [
  "Deux formatrices accompagnent des adultes dans une salle de formation numérique.",
  "Deux formatrices dans une salle réelle, sans dessin animé ni personnages illustrés.",
  "Un dessin animé 2D avec deux formatrices dans une salle de formation, sans aucun photoréalisme.",
  "Deux formatrices en formation : reprends le style artistique de cette référence.",
]) {
  test(`le rendu vidéo reste cohérent du planneur au fournisseur : ${freePrompt}`, async () => {
    const runtime = loadPlanner({ direction: freePrompt, scenes: [freePrompt] });
    const input = request({ freePrompt, inspirationImages: [{ mimeType: "image/png", data: "A".repeat(64), role: "inspiration", usage: "inspiration" }] });
    const plan = await runtime.prepareAiMediaFreeCreativePlan({ accountId: "offline-test", request: input, profile });
    const plannerCall = runtime.calls[0];
    assert.equal(JSON.parse(plannerCall.input).brief, freePrompt);
    assert.ok(plannerCall.system.includes(prompts.AI_MEDIA_FREE_VIDEO_RENDER_CONTRACT));
    assert.doesNotMatch(plannerCall.system, /ni photo réaliste imposés/);
    const canonical = prompts.buildAiMediaFreeVideoPrompt({ request: input, profile });
    const firstFrame = prompts.buildAiMediaFreeSceneFramePrompt({ request: input, profile });
    const transport = prompts.buildAiMediaFreeVideoScenePrompt(provider(input, plan), 0, 15);
    for (const prompt of [canonical, firstFrame, transport]) {
      assert.ok(prompt.includes(prompts.AI_MEDIA_FREE_VIDEO_RENDER_CONTRACT));
      assert.ok(prompt.includes(freePrompt), "The explicit style, reference-style request and exclusions survive unchanged");
      assert.match(prompt, /Photoreal humans\/scenes/);
      assert.match(prompt, /non-photo style only on explicit brief request/);
      assert.match(prompt, /never from refs alone/);
      assert.doesNotMatch(prompt, /y compris animation ou motion design/);
    }
    assert.ok(transport.length <= 3_200);
    assert.equal(input.durationSeconds, 15);
    assert.equal(input.videoEngine, "grok-lite");
    assert.equal(input.withNarration, false);
  });
}

test("la première image conserve uniquement l’instant initial et les références du film", () => {
  const input = request({ inspirationImages: [{ mimeType: "image/png", data: "A".repeat(64), role: "environment", usage: "required" }] });
  const firstFrame = prompts.buildAiMediaFreeSceneFramePrompt({ request: input, profile });
  assert.ok(firstFrame.includes(brief));
  assert.ok(firstFrame.includes(prompts.buildAiMediaFreeVideoPresentationContract({ withSubtitles: false })));
  assert.match(firstFrame, /uniquement l'instant initial/);
  assert.match(firstFrame, /ne pas y résumer les étapes suivantes, dessiner une planche de storyboard ni juxtaposer les futurs plans/);
  assert.match(firstFrame, /rôle environment, usage obligatoire/);
  assert.match(firstFrame, /paroles de voix off et des personnages sont du son/);
});

test("la première image exclut les paroles et leurs valeurs tout en conservant textes, logo et références visuels demandés", () => {
  const narration = "Notre équipe prépare une offre à 29 € sur https://audio.example.";
  const dialogue = "Retrouvons-nous demain dans notre atelier.";
  const title = "Bienvenue chez iNrCy";
  const freePrompt = `Une femme marche dans une agence. Voix off exacte : « ${narration} » Elle dit : « ${dialogue} » Affiche une pancarte qui dit : « ${title} ». Affiche https://visuel.example et le prix de 49 €. Place le logo de mon entreprise au premier instant.`;
  const input = request({ freePrompt, withNarration: true, inspirationImages: [{ mimeType: "image/png", data: "A".repeat(64), role: "product", usage: "required" }] });
  const before = structuredClone(input);
  const firstFrame = prompts.buildAiMediaFreeSceneFramePrompt({ request: input, profile, brandColors: [], hasLogo: true });
  for (const audioOnly of [narration, dialogue, "https://audio.example", "29 €"]) assert.ok(!firstFrame.includes(audioOnly), audioOnly);
  for (const visual of [title, "https://visuel.example", "49 €", "Place le logo de mon entreprise au premier instant."]) assert.ok(firstFrame.includes(visual), visual);
  assert.match(firstFrame, /rôle product, usage obligatoire/);
  assert.match(firstFrame, /logo officiel/);
  assert.deepEqual(input, before);
  const canonical = prompts.buildAiMediaFreeVideoPrompt({ request: input, profile, brandColors: [], hasLogo: true });
  assert.ok(canonical.includes(freePrompt), "Le brief complet reste disponible pour l’audit et les intentions audio.");
});

test("une demande brute de sous-titres ne supplante pas leur désactivation dans la première image", () => {
  const line = "Notre équipe travaille ensemble.";
  const freePrompt = `Une femme marche dans une agence. Voix off : « ${line} » Affiche les sous-titres exacts : « ${line} ».`;
  const input = request({ freePrompt, withNarration: true });
  const firstFrame = prompts.buildAiMediaFreeSceneFramePrompt({ request: input, profile });
  assert.equal(firstFrame.split(line).length, 2, "La seule occurrence restante appartient aux sous-titres explicitement demandés.");
  assert.match(firstFrame, /Affiche les sous-titres exacts/);
  assert.match(firstFrame, /SUBTITLES OFF/);
  assert.match(firstFrame, /even if the brief requests captions/);
  assert.deepEqual(prompts.splitAiMediaFreeQuotedSpeech(freePrompt).audioOnlyQuotes, [line]);
});

test("Grok reçoit un film temporel plein cadre sans script de la voix off à dessiner", () => {
  const line = "Notre équipe prépare sa prochaine campagne.";
  for (const videoEngine of ["grok", "grok-lite"]) {
    const input = request({ videoEngine, format: "story", withNarration: true });
    const runtime = loadPlanner({});
    const plan = runtime.buildAiMediaFreeBasePlan(input);
    plan.subline = "Une femme marche avec ses collègues ; ils rejoignent la salle de réunion, puis prennent un café.";
    plan.scenes[0].visualBrief = "La caméra suit leur progression du couloir vers la réunion.";
    const args = provider(input, plan, [line]);
    const prompt = prompts.buildAiMediaFreeVideoScenePrompt(args, 0, 15);
    assert.match(prompt, /15-second 9:16 video/);
    assert.match(prompt, /actions happen successively in time/);
    assert.ok(prompt.includes(plan.subline));
    assert.ok(prompt.includes(plan.scenes[0].visualBrief));
    assert.ok(!prompt.includes(line), "La piste de voix off séparée ne doit jamais être envoyée au modèle visuel.");
    assert.match(prompt, /No native voices or dialogue/);
    assert.doesNotMatch(prompt, /PARAMETERS:|narration_sha256=|mode=free;/);
    assert.match(args.providerContract.parameters, /voiceover=separate/);
    assert.doesNotMatch(args.providerContract.parameters, /narration_sha256=/, "La narration séparée ne fait plus partie du contrat audio du moteur vidéo.");
  }
});

test("une réplique exacte reste audible sans devenir un texte à incruster", async () => {
  const line = "Avec iNrCy, je prépare ma communication.";
  const input = request({ teamVideoSpeechMode: "characters", freePrompt: `${brief} La femme dit : « ${line} »` });
  const runtime = loadPlanner({ direction: "La femme présente l’application à ses collègues en marchant.", scenes: [{ visualBrief: "La femme parle pendant que ses collègues la suivent.", spokenLine: "Une phrase remplacée par la réplique exacte." }] });
  const plan = await runtime.prepareAiMediaFreeCreativePlan({ accountId: "offline-test", request: input, profile });
  assert.equal(plan.scenes[0].spokenLine, line);
  const transport = prompts.buildAiMediaFreeVideoScenePrompt(provider(input, plan), 0, 15);
  assert.match(transport, /NATIVE DIALOGUE:/);
  assert.equal(transport.split(line).length, 2);
  assert.ok(transport.includes(prompts.buildAiMediaFreeVideoPresentationContract(input)));
  assert.doesNotMatch(transport, /No narrator, repeated\/previous lines, subtitles/);
});

test("une narration séparée reste absente du moteur visuel quand la case Sous-titres est décochée", async () => {
  const line = "Notre équipe imagine ensemble sa prochaine campagne.";
  const input = request({ videoEngine: "minimax-h3", withNarration: true, freePrompt: `${brief} Affiche les sous-titres de la voix off.` });
  const runtime = loadPlanner({ direction: "La femme marche vers la salle de réunion avec ses collègues ; les sous-titres demandés accompagnent la voix off.", scenes: ["Les collègues entrent dans la salle de réunion."] });
  const plan = await runtime.prepareAiMediaFreeCreativePlan({ accountId: "offline-test", request: input, profile });
  const transport = prompts.buildAiMediaFreeVideoScenePrompt(provider(input, plan, [line]), 0, 15);
  assert.equal(JSON.parse(runtime.calls[0].input).brief, input.freePrompt);
  assert.ok(!transport.includes(line));
  assert.doesNotMatch(transport, /NATIVE VOICEOVER:/);
  assert.match(transport, /No native voices or dialogue/);
  assert.ok(transport.includes(plan.subline));
  assert.doesNotMatch(transport, /No repeated\/previous lines, subtitles/);
  assert.match(transport, /Render requested text faithfully/);
  assert.match(transport, /SUBTITLES OFF/);
  assert.match(transport, /even if the brief requests captions/);
});

test("le texte et les vues multiples demandés restent possibles sans grille guidée ni wording imposé", async () => {
  const freePrompt = "Crée un motion design en split screen : deux vues de l’agence côte à côte dès le premier instant. Rédige un titre court présentant iNrCy et affiche-le à l’écran.";
  const runtime = loadPlanner({ direction: "Deux vues de l’agence en split screen demandé, avec le titre créé pour le film : Imaginez votre prochaine campagne.", scenes: ["Les deux vues progressent côte à côte avec un titre animé demandé."] });
  const input = request({ freePrompt });
  const plan = await runtime.prepareAiMediaFreeCreativePlan({ accountId: "offline-test", request: input, profile });
  const firstFrame = prompts.buildAiMediaFreeSceneFramePrompt({ request: input, profile });
  const transport = prompts.buildAiMediaFreeVideoScenePrompt(provider(input, plan), 0, 15);
  assert.equal(JSON.parse(runtime.calls[0].input).brief, freePrompt);
  assert.ok(firstFrame.includes(freePrompt));
  assert.match(firstFrame, /plusieurs vues reste possible uniquement si elle est explicitement demandée à cet instant/);
  assert.ok(transport.includes(plan.subline));
  assert.match(transport, /write wording only if asked/);
  assert.match(transport, /No split screen, panels, collage or duplicate views unless requested/);
  assert.equal(input.withText, false, "Aucun ancien calque textuel Guidé n’est activé.");
});

test("le contrat compact respecte le plafond natif, sans tronquer les directions ou répliques", () => {
  const runtime = loadPlanner({});
  assert.ok(prompts.buildAiMediaFreeVideoPresentationContract({ withSubtitles: false }).length <= 500);
  assert.ok(prompts.buildAiMediaFreeVideoPresentationContract({ withSubtitles: true }).length <= 500);
  for (const model of AI_MEDIA_VIDEO_MODELS) {
    const durationSeconds = timeline.getAiMediaVideoSegmentDurations(8, model.id, model.defaultResolution, "single")[0];
    for (const speech of ["silent", "voiceover", "characters"] as const) {
      const input = request({ videoEngine: model.id, durationSeconds, videoResolution: model.defaultResolution,
        withNarration: speech === "voiceover", teamVideoSpeechMode: speech === "characters" ? "characters" : "voiceover",
        inspirationImages: model.supportsTextToVideo ? [] : [{ mimeType: "image/png", data: "A".repeat(64), role: "environment", usage: "required" }] });
      const plan = runtime.buildAiMediaFreeBasePlan(input);
      plan.subline = "D".repeat(1_400);
      plan.scenes[0].visualBrief = "V".repeat(300);
      plan.scenes[0].spokenLine = speech === "characters" ? "Prenons un café dans la salle de réunion." : "";
      const narration = speech === "voiceover" ? ["Voici notre équipe réunie autour d’un café."] : undefined;
      const transport = prompts.buildAiMediaFreeVideoScenePrompt(provider(input, plan, narration), 0, durationSeconds);
      assert.ok(transport.length <= 3_200, `${model.id}/${speech}: ${transport.length} caractères`);
      assert.ok(transport.includes(plan.subline));
      assert.ok(transport.includes(plan.scenes[0].visualBrief));
      assert.throws(() => prompts.buildAiMediaFreeVideoScenePrompt(provider(input, { ...plan, subline: "X".repeat(3_200) }, narration), 0, durationSeconds), /ai_video_instruction_contract_too_long/);
    }
  }
  assert.notEqual(prompts.AI_MEDIA_FREE_PROMPT_VERSION, "inrcy-free-creative-v2-native-voice");
});
