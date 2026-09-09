import assert from "node:assert/strict";
import test from "node:test";

import {
  aiMediaDialogueSignature,
  completeAiMediaSpeechSentence,
  getAiMediaDialogueFallbackPair,
  resolveAiMediaDialogueSequence,
} from "../../lib/aiMediaDialogue.ts";

test("la séquence mémorise les secours réellement prononcés pour éviter leur répétition", () => {
  const fallbacks = [0, 1, 2].map((index) => getAiMediaDialogueFallbackPair("fr", index)[0]);
  const resolved = resolveAiMediaDialogueSequence({
    scenes: [
      { spokenLine: "Oui" },
      { spokenLine: fallbacks[0] },
      { spokenLine: fallbacks[1] },
    ],
    headline: "Une création professionnelle",
    language: "fr",
  });
  assert.deepEqual(resolved, fallbacks.map((line) => completeAiMediaSpeechSentence(line, "fr")));
  assert.equal(new Set(resolved.map(aiMediaDialogueSignature)).size, 3);
  assert.ok(resolved.every((line) => line.endsWith(".")));
});

test("la séquence conserve exactement les répliques valides et leur ponctuation", () => {
  const lines = [
    "Votre projet avance avec une méthode claire.",
    "Découvrez nos nouvelles offres dès aujourd’hui !",
    "Prêts à construire ensemble votre prochain projet ?",
  ];
  const resolved = resolveAiMediaDialogueSequence({
    scenes: lines.map((spokenLine) => ({ spokenLine })),
    headline: "Titre non prononcé",
    language: "fr",
  });
  assert.deepEqual(resolved, lines);
});

test("la séquence suit la priorité réplique, corps, titre puis accroche", () => {
  const resolved = resolveAiMediaDialogueSequence({
    scenes: [
      { spokenLine: "Découvrez nos services pensés pour votre équipe.", body: "Corps non retenu" },
      { body: "Votre projet avance avec une méthode claire.", title: "Titre non retenu" },
      { title: "Construisons ensemble la suite de votre projet." },
    ],
    headline: "Notre équipe vous accompagne à chaque étape.",
    language: "fr",
  });
  assert.deepEqual(resolved, [
    "Découvrez nos services pensés pour votre équipe.",
    "Votre projet avance avec une méthode claire.",
    "Construisons ensemble la suite de votre projet.",
  ]);
  assert.deepEqual(resolveAiMediaDialogueSequence({
    scenes: [{}],
    headline: "Notre équipe vous accompagne à chaque étape.",
    language: "fr",
  }), ["Notre équipe vous accompagne à chaque étape."]);
  assert.deepEqual(resolveAiMediaDialogueSequence({ scenes: [], headline: "", language: "fr" }), []);
});
