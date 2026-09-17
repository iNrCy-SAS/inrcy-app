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
    "Votre projet avance avec une méthode claire et concrète."
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
  assert.notEqual(
    aiMediaDialogueSignature(replacement),
    aiMediaDialogueSignature(tooLong)
  );
});

test("une réplique vidéo conserve le nom propre La Celle Dunoise en entier", () => {
  const line = "Permis de construire pour un bâtiment agricole à La Celle Dunoise";
  assert.equal(isQualityAiMediaDialogueLine(line, "fr"), true);
  assert.equal(
    selectAiMediaDialogueLine({
      value: line,
      language: "fr",
      sceneIndex: 0,
      speaker: "lead",
    }),
    line,
  );
});

test("le prompt Veo transmet la réplique complète et réserve une fin silencieuse", () => {
  const veo = read("lib/aiVideoProviderGoogleVeo.ts");
  const server = read("lib/aiMediaGenerationServer.ts");
  const narration = read("lib/aiMediaNarration.ts");
  const narrationAudio = read("lib/aiMediaNarrationAudio.ts");
  const composer = read("lib/aiMediaGeneratedVideo.ts");

  assert.match(
    veo,
    /const firstLine = resolveAiMediaDialogueSequence\(\{\s*scenes: args\.plan\.scenes,\s*headline: args\.plan\.headline,\s*language,\s*\}\)\[index\]/
  );
  assert.match(
    server,
    /const expectedDialogueLines = resolveAiMediaDialogueSequence\(\{\s*scenes: creativePlan\.scenes,\s*headline: creativePlan\.headline,\s*language: profile\.preferences\.language,\s*\}\)/
  );
  assert.match(
    server,
    /plan: creativePlan,[\s\S]*?contentLanguage: profile\.preferences\.language/
  );
  assert.match(server, /expectedLine: expectedDialogueLines\[index\] \|\| ""/);
  assert.match(
    server,
    /providerRequest\.inputMode === "essential" &&[\s\S]*?characterDialogueRequested &&[\s\S]*?nativeDialogueQa\?\.status !== "passed"/,
    "le Studio essentiel ne livre jamais un dialogue natif non validé"
  );
  assert.match(
    server,
    /providerRequest\.inputMode === "essential" &&[\s\S]*?providerRequest\.withNarration &&[\s\S]*?ai_media_narration_unavailable/,
    "une voix off demandée ne peut pas disparaître silencieusement"
  );
  assert.match(veo, /lip-syncs once 0\.2–5\.5s: “\$\{firstLine\}”/);
  assert.match(veo, /Then mouth closed\/silent/);
  assert.match(veo, /No repeat\/old line\/narrator\/music/);

  assert.match(narration, /count <= target\.max/);
  assert.match(narration, /hasCompleteAiMediaSpeechEnding\(value, language\)/);
  assert.match(narration, /fitAiMediaSpeechToCompleteSentences/);
  assert.match(narration, /8: \{ min: 8, target: 10, max: 12 \}/);
  assert.match(narration, /16: \{ min: 20, target: 23, max: 26 \}/);
  assert.match(narration, /24: \{ min: 31, target: 35, max: 39 \}/);
  assert.match(narrationAudio, /environ 105 à 125 mots par minute/);
  assert.match(narrationAudio, /ne compresse jamais les mots/);

  assert.match(composer, /NARRATION_END_GUARD_SECONDS = 1/);
  assert.match(composer, /NARRATION_DECODE_TOLERANCE_SECONDS = 0\.16/);
  assert.match(composer, /NARRATION_MAX_TEMPO = 1\.08/);
  assert.match(composer, /narrationTempoFilters/);
  assert.match(
    composer,
    /if \(tempo > NARRATION_MAX_TEMPO\) \{\s*throw new Error\("ai_narration_too_long_for_natural_pace"\)/,
    "le monteur refuse une accélération audible"
  );
  assert.doesNotMatch(composer, /while \(tempo > 2\)/);
  assert.match(server, /video_composition_without_overspeed_narration/);
  assert.match(server, /narration_omitted_to_preserve_natural_pace/);
  assert.match(
    server,
    /providerRequest\.inputMode === "essential"[\s\S]*?ai_media_essential_video_composition_failed/,
    "le Studio essentiel refuse un montage qui perdrait les paroles ou l’habillage"
  );
  assert.doesNotMatch(
    composer,
    /atrim=duration=\$\{maximumVoiceSeconds\}/,
    "aucune coupe anticipée ne peut rogner le dernier mot de la voix off"
  );
  assert.match(
    composer,
    /narrationDurationSeconds \+ NARRATION_DECODE_TOLERANCE_SECONDS/,
    "le calcul absorbe le léger décalage possible des formats audio compressés"
  );
  assert.match(
    composer,
    /apad=pad_dur=\$\{args\.durationSeconds\}[\s\S]*?atrim=duration=\$\{args\.durationSeconds\}/,
    "le trim final ne retire que le silence ajouté jusqu’à la durée de la vidéo"
  );
});
