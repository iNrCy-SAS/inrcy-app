import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { normalizeAiMediaExactDialogue, type AiMediaExactDialogueTurn } from "../../lib/aiMediaExactDialogue.ts";
import { normalizeAiMediaGenerationRequest } from "../../lib/aiMediaGenerationContracts.ts";
import * as prompts from "../../lib/aiMediaFreeGenerationPrompt.ts";
import { getAiMediaVideoSpeechState } from "../../lib/aiMediaVideoSpeechBudget.ts";
import { getAiMediaAutomaticDialogueContext } from "../../lib/aiMediaNativeDialogueQa.ts";
import { usesSeparateAiMediaFreeVoiceover } from "../../lib/aiMediaFreeVoiceoverPolicy.ts";
import { buildAiMediaVideoProviderContract } from "../../lib/aiMediaVideoProviderContract.ts";
import { buildGenerationAttemptKey } from "../../lib/mediaGenerationClientRequest.ts";
import { createAiMediaRequestFingerprint } from "../../lib/aiMediaGenerationQuotaPolicy.ts";
import { assertAiJsonMatchesSchema } from "../../lib/aiJsonSchemaValidation.ts";
import type { NormalizedAiGenerationProfile } from "../../lib/aiGenerationProfile.ts";
import type { AiGenerateJsonOptions } from "../../lib/aiGatewayClient.ts";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

const lines: AiMediaExactDialogueTurn[] = [
  { speaker: "character", characterIndex: 2, text: "Bonjour, nous entretenons votre jardin avec soin." },
  { speaker: "ai_voice", text: "Une équipe à votre écoute." },
  { speaker: "character", characterIndex: 1, text: "Nous vous accompagnons." },
];
const pictures = [
  { mimeType: "image/png", data: "A".repeat(64), role: "character", usage: "required", characterIndex: 1 },
  { mimeType: "image/png", data: "B".repeat(64), role: "environment", usage: "required" },
  { mimeType: "image/png", data: "C".repeat(64), role: "character", usage: "required", characterIndex: 2 },
];
function raw(overrides: Record<string, unknown> = {}) {
  return { requestId: "exact-dialogue-offline-test", creationMode: "free", source: "studio", kind: "video", format: "story",
    videoEngine: "kling", videoResolution: "720p", durationSeconds: 16, freePrompt: "Deux personnes dans un jardin.",
    identityConsent: true, teamVideoProviderConsent: "kling", exactDialogue: lines, inspirationImages: pictures, ...overrides };
}
const profile = { business: { companyName: "Atelier", services: [], customerTypologies: [], strengths: [], interventionZones: [] },
  memory: { targetAudiences: [], differentiators: [], recentNewsItems: [] }, preferences: { language: "fr" } } as unknown as NormalizedAiGenerationProfile;

test("structured exact speakers override stale global controls and keep strict canonical speech without names", () => {
  const input = normalizeAiMediaGenerationRequest(raw({ teamVideoSpeechMode: "voiceover", withNarration: true }));
  assert.equal(input.teamVideoSpeechMode, "characters"); assert.equal(input.withNarration, false);
  assert.deepEqual(input.exactDialogue, lines);
  assert.equal(input.spokenScript, lines.map(line => line.text).join("\n"));
  assert.equal(getAiMediaAutomaticDialogueContext(input), undefined, "structured Exact must never enable creative paraphrase QA");
  assert.equal(getAiMediaVideoSpeechState(input).issue, null);
  assert.deepEqual(prompts.getAiMediaFreeExactDialogueTurnScenes(input)?.[0].map(turn => [turn.reference, turn.speaker, turn.text]),
    [[3, "Personnage 2", lines[0].text], [0, "NARRATOR_OFFSCREEN_AI", lines[1].text], [1, "Personnage 1", lines[2].text]]);
  const allAi = normalizeAiMediaGenerationRequest(raw({ exactDialogue: [lines[1]], inspirationImages: [], teamVideoSpeechMode: "characters", withNarration: false }));
  assert.equal(allAi.teamVideoSpeechMode, "voiceover"); assert.equal(allAi.withNarration, true);
  assert.equal(usesSeparateAiMediaFreeVoiceover(allAi), false, "Kling Exact narrator is explicitly native, never a character recording");
  assert.equal(allAi.narrationVoiceMode, "ai"); assert.equal(allAi.narrationVoiceSample, null);
});

test("invalid targets, unsupported mixtures, empty lines and contradictory legacy payloads fail before any service", () => {
  for (const exactDialogue of [null, [], [{ speaker: "ai_voice", characterIndex: 1, text: "Bonjour." }],
    [{ speaker: "provided_voice", text: "Une voix réelle." }, { speaker: "ai_voice", text: "Une autre voix." }],
    [{ speaker: "character", characterIndex: 3, text: "Bonjour." }], [{ speaker: "character", characterIndex: "1", text: "Bonjour." }],
    [{ speaker: "ai_voice", text: " " }], [{ speaker: "ai_voice", text: "Bonjour.\u0000" }],
    [{ speaker: "ai_voice", text: "Bonjour.", hiddenVoice: "PRIVATE" }],
    Array.from({ length: 13 }, () => ({ speaker: "ai_voice", text: "Oui." })),
  ]) assert.throws(() => normalizeAiMediaGenerationRequest(raw({ exactDialogue })));
  assert.throws(() => normalizeAiMediaGenerationRequest(raw({ videoEngine: "wan27", teamVideoProviderConsent: "wan27" })), /mélange.*Kling/);
  assert.throws(() => normalizeAiMediaGenerationRequest(raw({ spokenScript: "Un autre texte." })), /soit.*ancien/);
  assert.throws(() => normalizeAiMediaGenerationRequest(raw({ kind: "image" })), /vidéo Libre/);
  const long = [{ speaker: "character", characterIndex: 1, text: "Un texte exact très long. ".repeat(100) }];
  assert.deepEqual(normalizeAiMediaGenerationRequest(raw({ exactDialogue: long })).exactDialogue,long);
  assert.throws(()=>normalizeAiMediaGenerationRequest(raw({exactDialogue:[{speaker:"character",characterIndex:1,text:"x".repeat(4001)}]})));
  assert.equal(long[0].text, "Un texte exact très long. ".repeat(100), "estimates never cut the draft");
  assert.deepEqual(normalizeAiMediaExactDialogue([{ speaker: "ai_voice", text: " Bonjour\r\nle jardin. " }]), [{ speaker: "ai_voice", text: " Bonjour\nle jardin. " }]);
});

test("structured Exact preserves the existing supplied off-screen narrator, without a photo or a native AI substitution", () => {
  const time = Date.now(), date = new Date(time).toISOString().slice(0, 10);
  const sample = { path: `_studio-voice-references/${date}/account-test__${time}__11111111-1111-4111-8111-111111111111.wav`,
    mimeType: "audio/wav", name: "offline-narrator.wav", durationSeconds: 7, sizeBytes: 224044 };
  for (const videoEngine of ["kling", "omni"]) {
    const input = normalizeAiMediaGenerationRequest(raw({ exactDialogue: [{ speaker: "provided_voice", text: "Bonjour, découvrez notre jardin." }],
      inspirationImages: [], videoEngine, durationSeconds: 8, videoResolution: "720p", narrationVoiceMode: "provided", narrationVoiceSample: sample,
      narrationVoiceConsent: true }));
    assert.equal(input.withNarration, true); assert.equal(input.teamVideoSpeechMode, "voiceover");
    assert.equal(input.narrationVoiceMode, "provided"); assert.deepEqual(input.narrationVoiceSample, sample);
    assert.equal(input.narrationVoiceConsent, true); assert.equal(usesSeparateAiMediaFreeVoiceover(input), true);
    assert.equal(input.spokenScript, "Bonjour, découvrez notre jardin.");
  }
  assert.throws(() => normalizeAiMediaGenerationRequest(raw({ exactDialogue: [{ speaker: "provided_voice", text: "Bonjour." }], inspirationImages: [] })), /Sélectionnez.*vocal/);
  const quotes = runtimeModules()<typeof import("../../lib/aiMediaCreditQuoteServer.ts")>("lib/aiMediaCreditQuoteServer.ts");
  const publicQuoteInput = { kind: "video", creationMode: "free", videoEngine: "omni", durationSeconds: 8, withNarration: true,
    exactDialogue: [{ speaker: "provided_voice" as const, text: "Bonjour, découvrez notre jardin." }], inspirationImagesCount: 0 };
  assert.ok(quotes.createAiMediaServerQuote("account-test", publicQuoteInput).totalCredits > 0, "pricing needs no private sample, credentials or consent payload");
});

test("Auto and legacy raw Exact retain the old contract while structured order and speaker changes invalidate identities", () => {
  const legacyScript = "Bonjour, notre équipe vous accompagne.";
  const legacy = raw({ exactDialogue: undefined, spokenScript: legacyScript, teamVideoSpeechMode: "characters" });
  const old = normalizeAiMediaGenerationRequest(legacy);
  assert.equal(Object.hasOwn(old, "exactDialogue"), false); assert.equal(old.spokenScript, legacyScript);
  const automatic = normalizeAiMediaGenerationRequest(raw({ exactDialogue: undefined, teamVideoSpeechMode: "characters" }));
  assert.equal(automatic.spokenScript, undefined); assert.equal(Object.hasOwn(automatic, "exactDialogue"), false);
  const a = normalizeAiMediaGenerationRequest(raw());
  const b = normalizeAiMediaGenerationRequest(raw({ exactDialogue: [...lines].reverse() }));
  const client = (exactDialogue: AiMediaExactDialogueTurn[]) => buildGenerationAttemptKey({
    kind: "video", source: "studio", subjectSource: "custom", idea: "Deux personnes dans un jardin.",
    creationMode: "free", freePrompt: "Deux personnes dans un jardin.", exactDialogue,
    textKeywords: [], format: "story", imageStyle: "photo", shotType: "wide", peopleMode: "team", useBrandColors: false, logoMode: "none",
  }, "Deux personnes dans un jardin.");
  assert.notEqual(client(lines), client([...lines].reverse()));
  const source = readFileSync(new URL("../../app/api/media-generation/generate/route.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === "generationFingerprint"); assert.ok(fn);
  const output = ts.transpileModule(`${fn.getText(ast)}\nexports.fingerprint=generationFingerprint;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const record = {} as { fingerprint: (request: typeof a) => string };
  new Function("exports", "createAiMediaRequestFingerprint", "AI_MEDIA_FREE_PROMPT_VERSION", "AI_MEDIA_PROMPT_VERSION", "AI_MEDIA_DIRECT_VIDEO_PROMPT_VERSION", output)(record, createAiMediaRequestFingerprint, "test-free", "test-guided", "test-direct");
  assert.notEqual(record.fingerprint(a), record.fingerprint(b));
  const contract = buildAiMediaVideoProviderContract({ request: a, durationSeconds: 16, brandColors: [] });
  assert.match(contract.parameters, /;voiceover=native;/, "the signed envelope must not forbid its explicitly requested off-screen narrator");
  assert.ok(contract.parameters.includes(`exact_dialogue_sha256=${createHash("sha256").update(JSON.stringify(a.exactDialogue)).digest("hex")}`));
  assert.notEqual(contract.sha256, buildAiMediaVideoProviderContract({ request: b, durationSeconds: 16, brandColors: [] }).sha256);
});

test("the confirmed price quote binds structured speaker order as well as the model and rejects unsupported targets early", () => {
  const quotes = runtimeModules()<typeof import("../../lib/aiMediaCreditQuoteServer.ts")>("lib/aiMediaCreditQuoteServer.ts");
  const previous = process.env.KLING_API_KEY; process.env.KLING_API_KEY = "offline-test-key-only";
  try {
    const input = { kind: "video", creationMode: "free", videoEngine: "kling", durationSeconds: 16, videoResolution: "720p", exactDialogue: lines,
      inspirationImagesCount: pictures.length, inspirationImages: pictures.map(({ role, characterIndex }) => ({ role, characterIndex })) };
    const quote = quotes.createAiMediaServerQuote("account-a", input);
    const normalized = normalizeAiMediaGenerationRequest(raw({ withNarration: true, teamVideoSpeechMode: "voiceover" }));
    assert.equal(quote.quoteId, quotes.quoteAiMediaRequest("account-a", normalized).quoteId, "stale global narration flags cannot change the mixed Exact quote");
    const changed = quotes.createAiMediaServerQuote("account-a", { ...input, exactDialogue: [...lines].reverse() });
    assert.equal(quote.totalCredits, changed.totalCredits); assert.notEqual(quote.quoteId, changed.quoteId);
    assert.notEqual(quote.quoteId, quotes.createAiMediaServerQuote("account-b", input).quoteId);
    assert.throws(() => quotes.createAiMediaServerQuote("account-a", { ...input, videoEngine: "wan27" }), /mélange.*Kling/);
    assert.throws(() => quotes.createAiMediaServerQuote("account-a", { ...input, inspirationImages: [] }), /photo.*absente/);
  } finally { if (previous === undefined) delete process.env.KLING_API_KEY; else process.env.KLING_API_KEY = previous; }
});

test("the real planner cannot change exact actor order or words, even when its response invents other speech", async () => {
  let calls = 0;
  const load = runtimeModules({ "@/lib/aiEnginePreference": { getAiEngineOption: () => ({ model: "offline-planner" }) },
    "@/lib/aiGatewayClient": { aiGenerateJSON: async (options: AiGenerateJsonOptions) => {
      calls++;
      const output = { direction: "Deux personnes entretiennent un jardin.", scenes: [{ visualBrief: "Les deux adultes travaillent naturellement dans le jardin.",
        spokenLine: "Paroles inventées à refuser.", spokenTurns: [{ reference: 1, speaker: "Autre personne", text: "Autres mots." }] }] };
      const normalized = options.normalizeResponseBeforeValidation ? await options.normalizeResponseBeforeValidation(output) : output;
      assertAiJsonMatchesSchema(normalized, options.responseSchema!.schema);
      return normalized;
    } } });
  const planner = load<typeof import("../../lib/aiMediaFreeGenerationPlan.ts")>("lib/aiMediaFreeGenerationPlan.ts");
  const input = normalizeAiMediaGenerationRequest(raw());
  const plan = await planner.prepareAiMediaFreeCreativePlan({ accountId: "offline", request: input, profile });
  assert.equal(calls, 1);
  assert.deepEqual(plan.scenes[0].spokenTurns, prompts.getAiMediaFreeExactDialogueTurnScenes(input)?.[0]);
  assert.equal(plan.scenes[0].spokenLine, lines.map(line => line.text).join(" "));
  const contract = buildAiMediaVideoProviderContract({ request: input, durationSeconds: 16, brandColors: [] });
  const prompt = prompts.buildAiMediaFreeVideoScenePrompt({ request: input, plan, providerContract: contract, contentLanguage: "fr" }, 0, 16);
  assert.match(prompt, /NARRATOR_OFFSCREEN_AI/); assert.match(prompt, /All visible characters keep their mouths closed/);
  assert.ok(prompt.indexOf(lines[0].text) < prompt.indexOf(lines[1].text) && prompt.indexOf(lines[1].text) < prompt.indexOf(lines[2].text));
  assert.doesNotMatch(prompt, /@image_0|@voice_0|Autres mots|Paroles inventées/);
  assert.throws(() => prompts.buildAiMediaFreeVideoScenePrompt({ request: { ...input, exactDialogue: [...lines].reverse() }, plan,
    providerContract: contract, contentLanguage: "fr" }, 0, 16), /exact_dialogue_contract_incomplete/);
});
