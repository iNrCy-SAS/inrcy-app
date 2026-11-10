import assert from "node:assert/strict";
import test from "node:test";
import { inrAssistantStudioFacts } from "../../lib/inrAssistantStudioFacts.ts";
import { AI_MEDIA_AVAILABLE_VIDEO_MODELS } from "../../lib/aiMediaModelCatalog.ts";
import { isAiMediaCharacterVoiceEngine } from "../../lib/aiMediaCharacterVoices.ts";

test("supplied voice advice follows only the currently available native catalogue", () => {
  const facts = inrAssistantStudioFacts("Quel moteur Studio pour ma photo avec mon vocal réel ?");
  for (const model of AI_MEDIA_AVAILABLE_VIDEO_MODELS.filter(model => isAiMediaCharacterVoiceEngine(model.id))) assert.ok(facts.includes(model.label));
  assert.match(facts, /Vidéos retirées et indisponibles pour générer : .*Wan 3/);
  assert.doesNotMatch(facts, /Photo\/personnage[^\n]*(?:MiniMax|Wan 3|HeyGen)|referenceMediaIds|spokenScript|supplier|USD/);
  assert.match(facts, /5 à 10 secondes/);
  assert.match(facts, /Ajouter un vocal/);
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
