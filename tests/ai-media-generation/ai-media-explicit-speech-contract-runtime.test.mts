import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_MEDIA_SPOKEN_SCRIPT_MAX_CHARS,
  AiMediaRequestValidationError,
  normalizeAiMediaGenerationRequest,
} from "../../lib/aiMediaGenerationContracts.ts";

const visual = 'Océane présente l’application. La marque se prononce « inertie ».';
const script = '  Bonjour, je suis Océane !\n\nNotre offre : 58 € HT/mois.\n你好，欢迎！ 👩🏽‍💻  ';
function request(overrides: Record<string, unknown> = {}) {
  return normalizeAiMediaGenerationRequest({
    requestId: "original-explicit-script-test", source: "studio", operation: "generate", creationMode: "free",
    kind: "video", freePrompt: visual, videoEngine: "veo", durationSeconds: 8, format: "landscape",
    teamVideoSpeechMode: "characters", ...overrides,
  });
}

test("explicit speech preserves Unicode, numbers, punctuation, spaces and line breaks independently from the visual brief", () => {
  const input = request({ spokenScript: script.replace(/\n/g, "\r\n") });
  assert.equal(input.spokenScript, script);
  assert.equal(input.freePrompt, visual);
  assert.equal(input.withNarration, false);
  assert.equal(request({ spokenScript: script, withNarration: true, teamVideoSpeechMode: "voiceover" }).spokenScript, script);
});

test("an explicit empty script remains distinguishable from an absent legacy speech field", () => {
  assert.equal(request().spokenScript, undefined);
  for (const spokenScript of ["", " \n\t "]) {
    const silent = request({ spokenScript, withNarration: true, withSubtitles: true });
    assert.equal(silent.spokenScript, spokenScript);
    assert.equal(silent.withNarration, false);
    assert.equal(silent.teamVideoSpeechMode, "voiceover");
    assert.equal(silent.withSubtitles, false);
    assert.equal(request({ spokenScript, teamVideoSpeechMode: "voiceover", withNarration: false }).spokenScript, spokenScript);
  }
});

test("spoken scripts have a strict independent 4000-character limit with no silent truncation", () => {
  const maximum = "é".repeat(AI_MEDIA_SPOKEN_SCRIPT_MAX_CHARS);
  assert.equal(request({ spokenScript: maximum }).spokenScript, maximum);
  for (const spokenScript of [null, 1, true, {}, [], maximum + "!", "Bonjour\u0000!", "Bonjour\u0007!"]) {
    assert.throws(() => request({ spokenScript }), AiMediaRequestValidationError);
  }
});

test("actual speech requires a speaking mode while an empty explicit block remains valid", () => {
  assert.throws(() => request({ spokenScript: script, teamVideoSpeechMode: "voiceover", withNarration: false }), /Choisissez une voix off/);
  assert.equal(request({ spokenScript: "", teamVideoSpeechMode: "voiceover", withNarration: false }).spokenScript, "");
});

test("an explicitly silent script retains the usual supplied-character-voice incompatibility check", () => {
  const now = Date.now();
  assert.throws(() => request({ spokenScript: "", videoEngine: "heygen", identityConsent: true,
    inspirationImages: [{ role: "character", usage: "required", characterIndex: 1, voiceMode: "provided",
      mimeType: "image/png", data: "A".repeat(64), voiceSample: {
        path: `_studio-voice-references/${new Date(now).toISOString().slice(0, 10)}/offline-account__${now}__00000000-0000-4000-8000-000000000001.wav`,
        name: "vocal.wav", mimeType: "audio/wav", durationSeconds: 2, sizeBytes: 64_044,
      } }],
  }), /Les voix fournies sont utilisées en mode Personnages/);
});

test("subtitles are strictly boolean, default off and cannot create speech in silent mode", () => {
  const pristine = request();
  assert.equal(pristine.withSubtitles, false);
  assert.deepEqual(request({ withSubtitles: false }), pristine);
  assert.equal(request({ withSubtitles: true }).withSubtitles, true);
  assert.equal(request({ withSubtitles: true, teamVideoSpeechMode: "voiceover", withNarration: true }).withSubtitles, true);
  assert.equal(request({ withSubtitles: true, teamVideoSpeechMode: "voiceover", withNarration: false }).withSubtitles, false);
  for (const withSubtitles of ["true", "false", null, 0, 1, {}, []]) {
    assert.throws(() => request({ withSubtitles }), AiMediaRequestValidationError);
  }
});

test("images, guided generation and modification ignore residual speech and subtitle fields", () => {
  const residual = { spokenScript: { stale: true }, withSubtitles: "stale" };
  for (const overrides of [
    { kind: "image" },
    { creationMode: "guided", subjectSource: "custom", idea: "Une scène lumineuse" },
    { creationMode: "guided", operation: "modify", kind: "image", aiInstruction: "Éclaircir légèrement l’image.",
      modificationSourceWidth: 1080, modificationSourceHeight: 1080,
      inspirationImages: [{ role: "inspiration", mimeType: "image/png", data: "A".repeat(64) }] },
  ]) {
    const input = request({ ...overrides, ...residual });
    assert.equal(input.spokenScript, undefined);
    assert.equal(input.withSubtitles, undefined);
  }
});
