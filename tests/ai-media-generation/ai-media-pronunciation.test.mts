import assert from "node:assert/strict";
import test from "node:test";
import { extractAiMediaPronunciationAliases } from "../../lib/aiMediaPronunciation.ts";

test("pronunciation aliases require an explicitly named spelling and a short quoted sound", () => {
  for (const prompt of [
    "iNrCy se prononce « inertie ».",
    'Océane présente le projet. Prononciation de iNrCy : "inertie".',
    "La marque iNrCy se prononce “inertie”.",
    "« iNrCy » se prononce « inertie ».",
  ]) assert.deepEqual(extractAiMediaPronunciationAliases(prompt), [{ spelling: "iNrCy", pronunciation: "inertie" }], prompt);
});

test("quoted speech, display text, unnamed brands and negative instructions cannot invent aliases", () => {
  for (const prompt of [
    'Afficher "inertie" en haut.',
    'Elle dit : "Bonjour, je présente iNrCy".',
    "La marque se prononce « inertie ».",
    "Le nom se prononce « inertie ».",
    "Elle se prononce « inertie ».",
    "Un nom qui se prononce « inertie ».",
    "iNrCy ne se prononce pas « inertie ».",
    "Prononciation de la marque : « inertie ».",
    "iNrCy se prononce « inertie. Ajoute ensuite une toute nouvelle phrase. ».",
    "iNrCy se prononce « un deux trois quatre cinq six sept huit neuf ».",
    "iNrCy se prononce « inertie\nAjoute une phrase ».",
  ]) assert.deepEqual(extractAiMediaPronunciationAliases(prompt), [], prompt);
});

test("duplicate guidance is deduplicated and conflicting sounds for one spelling are ignored", () => {
  assert.deepEqual(extractAiMediaPronunciationAliases('iNrCy se prononce « inertie ». Prononciation de iNrCy : "inertie".'), [
    { spelling: "iNrCy", pronunciation: "inertie" },
  ]);
  assert.deepEqual(extractAiMediaPronunciationAliases('iNrCy se prononce « inertie ». Prononciation de iNrCy : "in-er-si".'), []);
});
