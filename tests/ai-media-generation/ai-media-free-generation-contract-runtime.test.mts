import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_MEDIA_FREE_PROMPT_MAX_CHARS,
  AiMediaRequestValidationError,
  normalizeAiMediaGenerationRequest,
} from "../../lib/aiMediaGenerationContracts.ts";

function freeInput(overrides: Record<string, unknown> = {}) {
  return {
    requestId: "free-studio-runtime-0001",
    source: "studio",
    operation: "generate",
    creationMode: "free",
    kind: "image",
    format: "portrait",
    freePrompt: 'Un flyer violet : inscrire exactement "21 jours gratuits", sans personnage.',
    ...overrides,
  };
}

const reference = (role: string, usage: string, extra = {}) => ({
  mimeType: "image/png",
  data: "A".repeat(64),
  role,
  usage,
  ...extra,
});

test("Libre conserve tout le brief et accepte un flyer sans réglage de texte guidé", () => {
  const prompt = `${"Description de la composition. ".repeat(105)}Fin exacte : 39,90 € / 03 21 00 00 00.`;
  assert.ok(prompt.length > 2_000 && prompt.length < AI_MEDIA_FREE_PROMPT_MAX_CHARS);
  const request = normalizeAiMediaGenerationRequest(freeInput({ freePrompt: prompt }));
  assert.equal(request.creationMode, "free");
  assert.equal(request.freePrompt, prompt);
  assert.equal(request.format, "portrait");
  assert.equal(request.source, "studio");
  assert.equal(request.operation, "generate");
  assert.equal(request.subjectSource, "custom");
  assert.equal(normalizeAiMediaGenerationRequest(freeInput()).creationMode, "free");
});

test("Libre ignore les réglages guidés résiduels au lieu de les appliquer ou les valider", () => {
  const pristine = normalizeAiMediaGenerationRequest(freeInput());
  const polluted = normalizeAiMediaGenerationRequest(freeInput({
    inputMode: "legacy",
    subjectSource: "profile",
    idea: "ANCIEN_SUJET_GUIDE",
    aiInstruction: "ANCIENNE_CONSIGNE_GUIDEE",
    generationMode: "ai_criteria",
    peopleCriterion: "three",
    settingCriterion: "studio",
    focusCriterion: "people",
    imagePurpose: "infographic",
    imageStyle: "three_d",
    visualStyle: "colorful",
    visualDirection: "bold",
    shotType: "close",
    peopleMode: "team",
    creativity: "faithful",
    logoMode: "visible",
    useBrandColors: true,
    textMode: "exact",
    exactText: "ANCIEN_TEXTE_GUIDE",
    withText: true,
    textKeywords: ["ANCIEN_MOT_CLE"],
  }));
  assert.deepEqual(polluted, pristine);
});

test("Libre valide le prompt avant génération sans troncature silencieuse", () => {
  for (const freePrompt of [undefined, null, 123, {}, [], "", "  ", "xy", "x".repeat(AI_MEDIA_FREE_PROMPT_MAX_CHARS + 1)]) {
    assert.throws(() => normalizeAiMediaGenerationRequest(freeInput({ freePrompt })), AiMediaRequestValidationError);
  }
  const maximum = "x".repeat(AI_MEDIA_FREE_PROMPT_MAX_CHARS);
  assert.equal(normalizeAiMediaGenerationRequest(freeInput({ freePrompt: maximum })).freePrompt, maximum);
  const multiline = normalizeAiMediaGenerationRequest(freeInput({ freePrompt: "Première ligne\r\nDeuxième ligne\u0000" }));
  assert.equal(multiline.freePrompt, "Première ligne\nDeuxième ligne");
});

test("Libre ne peut pas détourner Modifier, Booster ni un mode inconnu", () => {
  for (const overrides of [{ operation: "modify" }, { source: "booster" }, { creationMode: "unknown" }]) {
    assert.throws(() => normalizeAiMediaGenerationRequest(freeInput(overrides)), AiMediaRequestValidationError);
  }
});

test("les contrôles vidéo explicites restent prioritaires et utilisent Omni", () => {
  for (const durationSeconds of [8, 16, 24]) {
    const request = normalizeAiMediaGenerationRequest(freeInput({
      kind: "video", format: "story", durationSeconds,
      freePrompt: "Une animation dessinée dans un monde fantastique, avec une voix off chaleureuse.",
      withNarration: true, narrationVoice: "male", narrationVoiceVariant: "Puck",
      withMusic: true, sceneMode: "single", videoEngine: "veo",
    }));
    assert.equal(request.durationSeconds, durationSeconds);
    assert.equal(request.format, "story");
    assert.equal(request.videoEngine, "omni");
    assert.equal(request.withNarration, true);
    assert.equal(request.narrationVoice, "male");
    assert.equal(request.narrationVoiceVariant, "Puck");
    assert.equal(request.withMusic, true);
    assert.equal(request.sceneMode, "single");
  }
});

test("les menus rôle et usage des références sont préservés en Libre", () => {
  const images = [reference("product", "required"), reference("environment", "inspiration"), reference("inspiration", "inspiration")];
  for (const kind of ["image", "video"]) {
    const request = normalizeAiMediaGenerationRequest(freeInput({
      kind, inspirationImages: images, identityReferenceSetId: "identity-free-runtime-reference",
    }));
    assert.deepEqual(request.inspirationImages, images);
    assert.equal(request.identityMode, "auto");
    assert.equal(request.generationMode, "inspiration");
  }
});

test("les voix des personnages Libre restent sur Omni sans superposer une voix off", () => {
  for (const inspirationImages of [[], [reference("character", "required", { characterIndex: 1 })]]) {
    const request = normalizeAiMediaGenerationRequest(freeInput({
      kind: "video", durationSeconds: 16, teamVideoSpeechMode: "characters",
      withNarration: true, withMusic: true, inspirationImages, identityConsent: true,
      narrationVoice: "male", narrationVoiceVariant: "Kore",
    }));
    assert.equal(request.teamVideoSpeechMode, "characters");
    assert.equal(request.teamVideoMode, "cinematic");
    assert.equal(request.videoEngine, "omni");
    assert.equal(request.withNarration, false);
    assert.equal(request.withMusic, true);
    assert.equal(request.identityMode, inspirationImages.length ? "professional" : "auto");
  }
  assert.throws(() => normalizeAiMediaGenerationRequest(freeInput({ kind: "video", teamVideoSpeechMode: "unknown" })), AiMediaRequestValidationError);
});

test("le dialogue Libre conserve les consentements des personnages réels", () => {
  const characters = [reference("character", "required", { characterIndex: 1 }), reference("character", "required", { characterIndex: 2 })];
  for (const consent of [{ identityConsent: false, teamVideoVeoConsent: true }, { identityConsent: true, teamVideoVeoConsent: false }]) {
    assert.throws(() => normalizeAiMediaGenerationRequest(freeInput({ kind: "video", teamVideoSpeechMode: "characters", inspirationImages: characters, ...consent })), AiMediaRequestValidationError);
  }
  const request = normalizeAiMediaGenerationRequest(freeInput({ kind: "video", teamVideoSpeechMode: "characters", inspirationImages: characters, identityConsent: true, teamVideoVeoConsent: true }));
  assert.equal(request.identityMode, "reference_team");
  assert.equal(request.teamVideoVeoConsent, true);
});

test("les validations de référence et de voix s'appliquent aussi au mode Libre", () => {
  for (const overrides of [
    { inspirationImages: [reference("unknown", "inspiration")] },
    { inspirationImages: [reference("product", "unknown")] },
    { inspirationImages: [reference("product", "required"), reference("product", "required")] },
    { inspirationImages: [reference("character", "required", { characterIndex: 1 })], identityConsent: false },
    { kind: "video", durationSeconds: 12 },
    { kind: "video", withNarration: true, narrationVoice: "male", narrationVoiceVariant: "Kore" },
  ]) {
    assert.throws(() => normalizeAiMediaGenerationRequest(freeInput(overrides)), AiMediaRequestValidationError);
  }
});

test("les anciens formulaires restent guidés et ignorent le prompt Libre résiduel", () => {
  const guidedInput = {
    requestId: "guided-runtime-regression-0001", source: "studio", kind: "image",
    operation: "generate", inputMode: "essential", subjectSource: "custom",
    idea: "Une photographie du bouquet de fleurs dans son vase.",
    generationMode: "ai_criteria", peopleCriterion: "none", settingCriterion: "interior",
    focusCriterion: "product", imagePurpose: "simple", imageStyle: "photo",
    format: "square", textMode: "none", useBrandColors: true, logoMode: "discreet",
  };
  const legacyGuided = normalizeAiMediaGenerationRequest(guidedInput);
  const explicitGuided = normalizeAiMediaGenerationRequest({ ...guidedInput, creationMode: "guided", freePrompt: "BRIEF_LIBRE_RESIDUEL" });
  assert.deepEqual(explicitGuided, legacyGuided);
  assert.equal(legacyGuided.creationMode, "guided");
  assert.equal(legacyGuided.freePrompt, undefined);
  assert.equal(legacyGuided.idea, guidedInput.idea);
  assert.equal(legacyGuided.peopleMode, "none");
  assert.equal(legacyGuided.imagePurpose, "simple");
  assert.equal(legacyGuided.useBrandColors, true);
  assert.equal(legacyGuided.logoMode, "discreet");
});
