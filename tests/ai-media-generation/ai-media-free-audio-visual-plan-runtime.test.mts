import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import * as contracts from "../../lib/aiMediaGenerationContracts.ts";
import * as prompts from "../../lib/aiMediaFreeGenerationPrompt.ts";
import * as globalConstraints from "../../lib/aiMediaGlobalConstraints.ts";
import * as timeline from "../../lib/aiMediaVideoTimeline.ts";
import { buildAiMediaVideoProviderContract, hashAiMediaCanonicalPrompt } from "../../lib/aiMediaVideoProviderContract.ts";
import { usesSeparateAiMediaFreeVoiceover } from "../../lib/aiMediaFreeVoiceoverPolicy.ts";
import { assertAiJsonMatchesSchema } from "../../lib/aiJsonSchemaValidation.ts";
import type { AiGenerateJsonOptions } from "../../lib/aiGatewayClient.ts";
import type { NormalizedAiGenerationProfile } from "../../lib/aiGenerationProfile.ts";
import type { AiMediaCreativePlan } from "../../lib/aiMediaCreativePlan.ts";
import type { AiVideoProviderGenerationArgs } from "../../lib/aiVideoProviderTypes.ts";
import { evaluateAiMediaNativeDialogue } from "../../lib/aiMediaNativeDialogueQa.ts";

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
    ["./aiMediaGlobalConstraints.ts", globalConstraints],
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
  const input = request({ videoEngine: "grok-lite", videoResolution: "720p", freePrompt: `Une femme marche dans une agence. Voix off exacte : « ${line} »` });
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

function coupleRequest(videoEngine = "kling-flash", overrides: Record<string, unknown> = {}) {
  return request({ videoEngine, durationSeconds: 8, teamVideoSpeechMode: "characters", withNarration: false,
    identityConsent: true, teamVideoProviderConsent: videoEngine,
    freePrompt: "L'homme en bleu parle, puis la femme en vert répond. Deux voix françaises distinctes.",
    inspirationImages: ["character", "environment", "character"].map((role, index) => ({
      data: "A".repeat(64), mimeType: "image/png", role, usage: "required", voiceMode: "ai",
      ...(role === "character" ? { characterIndex: index === 0 ? 1 : 2 } : {}),
    })), ...overrides });
}

const coupleTurns = [
  { reference: 1, speaker: "homme en bleu", text: "Nous préparons vos projets avec soin." },
  { reference: 3, speaker: "femme en vert", text: "Et nous restons à votre écoute." },
];

test("automatic Wan and Kling dialogue retains both speakers within one shot and audits both lines", async () => {
  for (const engine of ["wan27", "kling", "kling-flash"]) {
    const input = coupleRequest(engine);
    const runtime = loadPlanner({ direction: "Un couple échange dans le jardin, face caméra.", scenes: [
      { visualBrief: "L'homme parle puis la femme lui répond, l'autre écoute.", spokenLine: "Copie à remplacer.", spokenTurns: coupleTurns },
    ] });
    const plan = await runtime.prepareAiMediaFreeCreativePlan({ accountId: "offline-test", request: input, profile });
    const expected = coupleTurns.map(turn => turn.text).join(" ");
    assert.deepEqual(plan.scenes[0].spokenTurns, coupleTurns);
    assert.equal(plan.scenes[0].spokenLine, expected);
    assert.deepEqual(prompts.resolveAiMediaFreeDialogueSequence({ request: input, plan }), [expected]);
    assert.deepEqual(JSON.parse(runtime.calls[0].input).character_voices.map((voice: { reference: number }) => voice.reference), [1, 3]);
    const transport = prompts.buildAiMediaFreeVideoScenePrompt(providerArgs(input, plan, []), 0, 8);
    assert.match(transport, engine === "wan27" ? /CHARACTER_1: homme en bleu, the person from Image 1/ : /CHARACTER_1: homme en bleu, the person from @image_1/);
    assert.match(transport, engine === "wan27" ? /THEN CHANGE SPEAKER.*CHARACTER_3: femme en vert, the person from Image 3/ : /THEN CHANGE SPEAKER.*CHARACTER_3: femme en vert, the person from @image_3/);
    for (const turn of coupleTurns) assert.equal(transport.split(turn.text).length, 2, "Each turn is submitted exactly once.");
    assert.equal(evaluateAiMediaNativeDialogue({ sceneIndex: 0, expectedLine: expected, transcript: expected }).status, "passed");
    const missingReply = evaluateAiMediaNativeDialogue({ sceneIndex: 0, expectedLine: expected, transcript: coupleTurns[0].text });
    assert.ok(missingReply.issues.includes("spoken_dialogue_incomplete"), "The old one-speaker Flash clip must fail a two-turn expectation.");
  }
});

test("automatic multi-character speech shares one total duration budget", async () => {
  const input = coupleRequest();
  const runtime = loadPlanner({ direction: "Le couple présente son activité dans le jardin.", scenes: [{
    visualBrief: "L'homme et la femme parlent successivement.", spokenLine: "Brouillon.", spokenTurns: coupleTurns.map(turn => ({
      ...turn, text: "Nous accompagnons chaque projet avec une approche attentive et humaine.",
    })),
  }] });
  await assert.rejects(runtime.prepareAiMediaFreeCreativePlan({ accountId: "offline-test", request: input, profile }), /ai_media_dialogue_budget/);
});

test("automatic dialogue never assigns a turn to an environment reference", async () => {
  const input = coupleRequest();
  const runtime = loadPlanner({ direction: "Le couple présente son activité dans le jardin.", scenes: [{
    visualBrief: "La femme répond à son conjoint.", spokenLine: "Brouillon.", spokenTurns: [{ ...coupleTurns[1], reference: 2 }],
  }] });
  await assert.rejects(runtime.prepareAiMediaFreeCreativePlan({ accountId: "offline-test", request: input, profile }), /ai_media_dialogue_turns_invalid/);
});

test("multiple photos do not force a deliberately silent character to speak", async () => {
  const input = coupleRequest("kling-flash", { freePrompt: "Seule la femme parle. L'homme écoute en silence." });
  const runtime = loadPlanner({ direction: "La femme présente son activité, son conjoint écoute.", scenes: [{
    visualBrief: "La femme parle seule face caméra.", spokenLine: coupleTurns[1].text, spokenTurns: [coupleTurns[1]],
  }] });
  const plan = await runtime.prepareAiMediaFreeCreativePlan({ accountId: "offline-test", request: input, profile });
  assert.deepEqual(plan.scenes[0].spokenTurns, [coupleTurns[1]]);
});

test("multi-character Kling keeps exact user speech authoritative", async () => {
  const spokenScript = "  Avec iNrCy, nous avançons ensemble.  ";
  const input = coupleRequest("kling", { spokenScript });
  const runtime = loadPlanner({ direction: "Le couple présente son activité dans le jardin.", scenes: [{
    visualBrief: "L'homme parle, la femme écoute.", spokenLine: "Réplique automatique à ignorer.",
  }] });
  const plan = await runtime.prepareAiMediaFreeCreativePlan({ accountId: "offline-test", request: input, profile });
  assert.equal(plan.scenes[0].spokenLine, spokenScript);
  assert.equal(plan.scenes[0].spokenTurns, undefined);
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

test("explicit character speech overrides legacy quotes and generated wording without normalizing its copy", async () => {
  const spokenScript = "  Bonjour, je suis Océane !\n\nBienvenue chez iNrCy.  ";
  const input = request({ teamVideoSpeechMode: "characters", spokenScript,
    freePrompt: 'La femme présente l’application. Elle dit « Ancienne réplique ». La marque se prononce « inertie ».' });
  const runtime = loadPlanner({ direction: visualResponse.direction,
    scenes: [{ visualBrief: "La femme présente l’application face caméra.", spokenLine: "Paroles automatiques à ignorer." }] });
  const plan = await runtime.prepareAiMediaFreeCreativePlan({ accountId: "offline-test", request: input, profile });
  assert.equal(runtime.calls.length, 1, "The original visual planner remains active.");
  const sent = JSON.parse(runtime.calls[0].input);
  assert.deepEqual(sent.exact_dialogue, [spokenScript]);
  assert.ok(sent.audio_only_quotes.includes(spokenScript));
  assert.ok(!sent.exact_terms.includes(spokenScript));
  assert.ok(!sent.exact_terms.includes("inertie"), "Pronunciation notes must not become protected visual lettering.");
  assert.equal(plan.scenes[0].spokenLine, spokenScript);
  assert.equal(plan.subline, visualResponse.direction);
  assert.ok(!plan.scenes[0].visualBrief.includes(spokenScript));
  assert.deepEqual(prompts.resolveAiMediaFreeDialogueSequence({ request: input, plan }), [spokenScript]);
  assert.equal(await runtime.writeAiMediaFreeNarration({ accountId: "offline-test", request: input, profile, plan }), null);
  assert.equal(runtime.calls.length, 1);
});

test("explicit voiceover returns the exact script and hash without a copywriting or rewriting call", async () => {
  const spokenScript = "  Bonjour, Océane !\n\n58 € HT/mois.  ";
  const input = request({ spokenScript, freePrompt: 'Une femme marche. Voix off : « Ancienne narration ». ' });
  const runtime = loadPlanner(visualResponse);
  const plan = await runtime.prepareAiMediaFreeCreativePlan({ accountId: "offline-test", request: input, profile });
  const narration = await runtime.writeAiMediaFreeNarration({ accountId: "offline-test", request: input, profile, plan });
  assert.equal(narration?.script, spokenScript);
  assert.equal(narration?.sha256, createHash("sha256").update(spokenScript).digest("hex"));
  assert.equal(runtime.calls.length, 1, "Exact narration adds no LLM request to visual planning.");
});

test("an explicitly empty speech block remains silent despite old quoted speech in the visual brief", async () => {
  const input = request({ spokenScript: " \n\t ", teamVideoSpeechMode: "characters", withNarration: true, withSubtitles: true,
    freePrompt: 'Une femme présente une application. Elle dit « Ne pas reprendre ces paroles ». ' });
  const runtime = loadPlanner(visualResponse);
  const plan = await runtime.prepareAiMediaFreeCreativePlan({ accountId: "offline-test", request: input, profile });
  assert.equal(input.withNarration, false);
  assert.equal(input.teamVideoSpeechMode, "voiceover");
  assert.equal(input.withSubtitles, false);
  assert.equal(plan.scenes[0].spokenLine, "");
  assert.equal(await runtime.writeAiMediaFreeNarration({ accountId: "offline-test", request: input, profile, plan }), null);
  assert.equal(runtime.calls.length, 1);
  const sent = JSON.parse(runtime.calls[0].input);
  assert.equal(sent.voiceover, false);
  assert.equal(sent.native_dialogue, false);
});

test("duration guards reject an oversized exact voiceover without rewriting or truncating it", async () => {
  const spokenScript = "Bonjour à toutes et à tous, nous sommes heureux de vous présenter notre application et toutes ses fonctionnalités.";
  assert.throws(() => request({ spokenScript, durationSeconds: 4 }), contracts.AiMediaRequestValidationError);
  // Restored legacy data reaches the same exact-speech guard without truncation.
  const input = { ...request(), spokenScript, durationSeconds: 4 };
  const runtime = loadPlanner(visualResponse);
  await assert.rejects(runtime.writeAiMediaFreeNarration({ accountId: "offline-test", request: input, profile,
    plan: runtime.buildAiMediaFreeBasePlan(input) }), contracts.AiMediaRequestValidationError);
  assert.equal(input.spokenScript, spokenScript);
  assert.equal(runtime.calls.length, 0);
});

test("phonetic guidance does not remove the same wording when it is separately requested on a sign", async () => {
  const input = request({ spokenScript: "Bienvenue !", teamVideoSpeechMode: "characters",
    freePrompt: 'La marque se prononce « inertie ». Affiche aussi le titre « inertie ».' });
  const runtime = loadPlanner({ direction: visualResponse.direction,
    scenes: [{ visualBrief: "La femme présente l’application devant une enseigne.", spokenLine: "Paroles automatiques à ignorer." }] });
  const plan = await runtime.prepareAiMediaFreeCreativePlan({ accountId: "offline-test", request: input, profile });
  const sent = JSON.parse(runtime.calls[0].input);
  assert.deepEqual(sent.exact_terms, ["inertie"]);
  assert.ok(plan.subline.includes("inertie"));
  assert.equal(plan.scenes[0].spokenLine, "Bienvenue !");
});
