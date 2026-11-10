import assert from "node:assert/strict";
import test from "node:test";
import { inrAssistantStudioFacts } from "../../lib/inrAssistantStudioFacts.ts";
import { AI_MEDIA_AVAILABLE_VIDEO_MODELS, AI_MEDIA_IMAGE_MODELS } from "../../lib/aiMediaModelCatalog.ts";
import { AI_MEDIA_CHARACTER_VOICE_MAX_SECONDS, AI_MEDIA_NARRATION_VOICE_MIN_SECONDS, hasTooShortAiMediaCharacterVoice, isAiMediaCharacterVoiceEngine } from "../../lib/aiMediaCharacterVoices.ts";

test("supplied voice advice follows only the currently available native catalogue", () => {
  const facts = inrAssistantStudioFacts("Quel moteur Studio pour ma photo avec mon vocal réel ?");
  for (const model of AI_MEDIA_AVAILABLE_VIDEO_MODELS.filter(model => isAiMediaCharacterVoiceEngine(model.id))) assert.ok(facts.includes(model.label));
  assert.match(facts, /Vidéos retirées et indisponibles pour générer : .*Wan 3/);
  assert.doesNotMatch(facts, /Photo\/personnage[^\n]*(?:MiniMax|Wan 3|HeyGen)|referenceMediaIds|spokenScript|supplier|USD/);
  assert.match(facts, /5 à 10 secondes/);
  assert.match(facts, /Ajouter un vocal/);
  assert.match(facts, /fourni OPTIONNEL/);
  assert.match(facts, /obligatoire seulement si ce mode est choisi/);
});

test("Kling supplied-vocal minimum is mandatory and distinct from the native clip duration", () => {
  const sample = { role: "character", voiceMode: "provided" as const, voiceSample: { path: "fixture", name: "voice.wav", mimeType: "audio/wav" as const, durationSeconds: 3, sizeBytes: 96_044 } };
  assert.equal(hasTooShortAiMediaCharacterVoice("kling", [sample]), true);
  assert.equal(hasTooShortAiMediaCharacterVoice("kling", [{ ...sample, voiceSample: { ...sample.voiceSample, durationSeconds: AI_MEDIA_NARRATION_VOICE_MIN_SECONDS } }]), false);
  const kling = AI_MEDIA_AVAILABLE_VIDEO_MODELS.find(model => model.id === "kling")!;
  assert.equal(kling.maxDurationSeconds, 30);
  for (const limit of [650, 1600, 5000]) {
    const facts = inrAssistantStudioFacts("Mon vocal de 3 secondes suffit-il pour Kling ?", limit);
    assert.ok(facts.length <= limit);
    assert.match(facts, new RegExp(`${AI_MEDIA_NARRATION_VOICE_MIN_SECONDS} à ${AI_MEDIA_CHARACTER_VOICE_MAX_SECONDS} secondes OBLIGATOIRE`));
    assert.match(facts, /plus court refusé/);
    assert.match(facts, /vidéo : 4–30 s, distincte/);
    assert.match(facts, /minimum5s du vocal ne relève pas le minimum4s du clip/);
    assert.match(facts, /clip peut dépasser le vocal, sans règle de boucle\/troncature déduite/);
  }
});

test("provided narration is a separate native path with consent and no visible character requirement", () => {
  const facts = inrAssistantStudioFacts("Différence entre voix off et personnage avec mon vocal réel ?", 1600);
  assert.match(facts, /Voix off : parcours séparé, voix IA ou vocal réel fourni avec consentement personnel, sans personnage imposé/);
});

test("retired-model comparisons retain the active alternatives instead of substituting voice sample lengths", () => {
  const facts = inrAssistantStudioFacts("Wan 3.0 et MiniMax H3 sont-ils retirés ? Quelles alternatives vidéo actives ?");
  assert.ok(facts.length <= 1600);
  assert.match(facts, /Kling 4\.0 Omni \(4–30 s/);
  assert.match(facts, /Veo 3\.1/);
  assert.match(facts, /Grok Imagine/);
  assert.match(facts, /Gemini Omni/);
  assert.match(facts, /aucun classement ou plafond de locuteurs déduit/);
  assert.match(facts, /Kling 4\.0 Flash \(4–20 s ; 720p\)/);
  assert.match(facts, /Modèles distincts : ne pas attribuer à Flash les limites Omni/);
  assert.doesNotMatch(facts, /Kling 4\.0 Omni \(5–10 s/);
  const short = inrAssistantStudioFacts("moteurs vidéo", 650);
  if (!AI_MEDIA_AVAILABLE_VIDEO_MODELS.every(model => short.includes(model.label))) assert.match(short, /liste partielle/);
});

test("a negated video mention keeps an image comparison focused on all native image engines", () => {
  const facts = inrAssistantStudioFacts("Je veux comparer les moteurs d’image pour faire une affiche. Pas de vidéo ni de génération.");
  assert.match(facts, /aucun moteur vidéo/);
  for (const model of AI_MEDIA_IMAGE_MODELS) assert.ok(facts.includes(model.label));
  assert.doesNotMatch(facts, /Vidéos proposées|Kling|Wan/);
});

test("image options keep image engines separate and video duration facts respect the Studio minimum", () => {
  const image = inrAssistantStudioFacts("Explique les options pour créer une image sans lancer de génération", 2500);
  assert.match(image, /aucun moteur vidéo/);
  assert.match(image, /Images :/);
  assert.doesNotMatch(image, /Vidéos proposées|Wan|Kling/);
  const video = inrAssistantStudioFacts("moteurs vidéo", 5000);
  assert.doesNotMatch(video, /\(2–|\(3–|undefined/);
});

test("abbreviated Studio knowledge retains voice compatibility before unrelated catalogue details", () => {
  const facts = inrAssistantStudioFacts("Studio avec mon vocal", 650);
  assert.ok(facts.length <= 650);
  assert.match(facts, /Wan 2\.7/);
  assert.match(facts, /Kling/);
  assert.equal(inrAssistantStudioFacts("Quelle est la météo ?"), "");
});
