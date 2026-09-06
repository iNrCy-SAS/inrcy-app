import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  aiMediaDialogueSignature,
  completeAiMediaSpeechSentence,
  fitAiMediaSpeechToCompleteSentences,
  hasCompleteAiMediaSpeechEnding,
  isQualityAiMediaDialogueLine,
  selectAiMediaDialogueLine,
} from "../../lib/aiMediaDialogue.ts";

const ROOT = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(ROOT, relativePath), "utf8");

test("une voix off ne peut jamais être validée ou retaillée sur une phrase incomplète", () => {
  const broken = "On peut prendre rendez-vous et parler de";
  assert.equal(hasCompleteAiMediaSpeechEnding(broken, "fr"), false);
  assert.equal(completeAiMediaSpeechSentence(broken, "fr"), "");

  const long =
    "Votre projet avance avec une méthode claire et concrète. Notre équipe reste disponible pour parler de votre besoin et préparer";
  const fitted = fitAiMediaSpeechToCompleteSentences({
    value: long,
    language: "fr",
    maximumUnits: 19,
  });
  assert.equal(
    fitted,
    "Votre projet avance avec une méthode claire et concrète.",
  );
  assert.equal(hasCompleteAiMediaSpeechEnding(fitted, "fr"), true);
});

test("les répliques natives trop longues ou pendantes basculent vers une phrase courte complète", () => {
  const broken = "Nous pouvons prendre rendez-vous et parler de";
  assert.equal(isQualityAiMediaDialogueLine(broken, "fr"), false);

  const tooLong =
    "Nous pouvons prendre rendez-vous aujourd’hui et parler précisément de toutes les prochaines étapes de votre projet";
  const replacement = selectAiMediaDialogueLine({
    value: tooLong,
    language: "fr",
    sceneIndex: 2,
    speaker: "lead",
  });
  assert.equal(isQualityAiMediaDialogueLine(replacement, "fr"), true);
  assert.ok(replacement.length <= 60);
  assert.notEqual(aiMediaDialogueSignature(replacement), aiMediaDialogueSignature(tooLong));
});

test("le prompt Veo transmet la réplique complète et réserve une fin silencieuse", () => {
  const veo = read("lib/aiVideoProviderGoogleVeo.ts");
  const narration = read("lib/aiMediaNarration.ts");
  const composer = read("lib/aiMediaGeneratedVideo.ts");

  assert.doesNotMatch(veo, /promptSnippet\(firstLine,\s*(?:64|72)\)/);
  assert.match(veo, /says exactly “\$\{firstLine\}”/);
  assert.match(veo, /finish all words by 5\.5s/);
  assert.match(veo, /otherwise stay silent/);

  assert.match(narration, /count <= target\.max/);
  assert.match(narration, /hasCompleteAiMediaSpeechEnding\(value, language\)/);
  assert.match(narration, /fitAiMediaSpeechToCompleteSentences/);

  assert.match(composer, /NARRATION_END_GUARD_SECONDS = 1/);
  assert.match(composer, /NARRATION_DECODE_TOLERANCE_SECONDS = 0\.16/);
  assert.match(composer, /narrationTempoFilters/);
  assert.ok(
    composer.indexOf("...tempoFilters") <
      composer.indexOf("`apad=pad_dur=${args.durationSeconds}`"),
    "la voix off est accélérée pour finir avant le silence de sécurité",
  );
  assert.doesNotMatch(
    composer,
    /atrim=duration=\$\{maximumVoiceSeconds\}/,
    "aucune coupe anticipée ne peut rogner le dernier mot de la voix off",
  );
  assert.match(
    composer,
    /narrationDurationSeconds \+ NARRATION_DECODE_TOLERANCE_SECONDS/,
    "le calcul absorbe le léger décalage possible des formats audio compressés",
  );
  assert.match(
    composer,
    /apad=pad_dur=\$\{args\.durationSeconds\}[\s\S]*?atrim=duration=\$\{args\.durationSeconds\}/,
    "le trim final ne retire que le silence ajouté jusqu’à la durée de la vidéo",
  );
});
