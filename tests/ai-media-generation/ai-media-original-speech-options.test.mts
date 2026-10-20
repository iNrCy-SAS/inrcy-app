import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAiMediaGenerationRequest } from "../../lib/aiMediaGenerationContracts.ts";
import { buildAiMediaFreeSceneFramePrompt, buildAiMediaFreeVideoScenePrompt, getAiMediaFreeRequestedDialogue, resolveAiMediaFreeDialogueSequence, splitAiMediaFreeQuotedSpeech } from "../../lib/aiMediaFreeGenerationPrompt.ts";
import { splitAiMediaSpokenScript } from "../../lib/aiMediaSpokenScript.ts";
import { buildAiMediaVideoProviderContract } from "../../lib/aiMediaVideoProviderContract.ts";
import type { AiVideoProviderGenerationArgs } from "../../lib/aiVideoProviderTypes.ts";

const script = "Bonjour, notre application crée vos contenus et les publie partout.";
function provider(overrides: Record<string, unknown> = {}, subtitleLines?: string[]) {
  const request = normalizeAiMediaGenerationRequest({
    requestId: "original-speech-options", source: "studio", creationMode: "free", kind: "video",
    freePrompt: "Une femme adulte fictive parle face caméra. Une enseigne porte « Bonjour ».",
    videoEngine: "heygen", durationSeconds: 8, format: "landscape",
    teamVideoSpeechMode: "characters", withNarration: false, withMusic: false,
    spokenScript: script, ...overrides,
  });
  return {
    request, subtitleLines, contentLanguage: "fr",
    plan: { subline: request.freePrompt, scenes: [{ visualBrief: "Une femme parle devant une enseigne « Bonjour ».", spokenLine: "Texte inventé à ignorer." }] },
    providerContract: buildAiMediaVideoProviderContract({ request, durationSeconds: 8, brandColors: [], subtitleLines }),
  } as unknown as AiVideoProviderGenerationArgs;
}

test("the general brief still accepts quoted multiline speech, excluding pronunciation notes", () => {
  const brief = 'La marque iNrCy se prononce « inertie ».\nDIALOGUE :\n« Bonjour,\nnotre application crée vos contenus. »';
  assert.deepEqual(getAiMediaFreeRequestedDialogue(brief), ["Bonjour, notre application crée vos contenus."]);
  const split = splitAiMediaFreeQuotedSpeech(brief);
  assert.ok(!split.visualPrompt.includes("inertie"));
  assert.ok(!split.visualPrompt.includes("notre application"));
});

test("the dedicated exact script wins over old quoted speech and generated planner words", () => {
  const args = provider({ freePrompt: 'Une femme dit : « Autres paroles. »', spokenScript: script });
  assert.deepEqual(resolveAiMediaFreeDialogueSequence(args), [script]);
  const prompt = buildAiMediaFreeVideoScenePrompt(args, 0, 8);
  assert.ok(!prompt.includes("Autres paroles."));
  assert.ok(!prompt.includes("Texte inventé à ignorer."));
  assert.equal(prompt.split(script).length, 2);
});

test("explicit pronunciation reaches native speech without becoming an extra spoken line", () => {
  const line = "Bonjour, voici iNrCy.";
  const args = provider({
    freePrompt: 'Une femme parle. iNrCy se prononce « inertie ».',
    spokenScript: line,
  });
  const prompt = buildAiMediaFreeVideoScenePrompt(args, 0, 8);
  assert.match(prompt, /AUDIO PRONUNCIATION: \[{"spelling":"iNrCy","pronunciation":"inertie"}\]/);
  assert.match(prompt, /do not read this guide aloud/);
  assert.equal(prompt.split(line).length, 2);
  assert.deepEqual(resolveAiMediaFreeDialogueSequence(args), [line]);
});

test("caption choice is independent of other requested visual text and exact spoken words", () => {
  for (const withSubtitles of [false, true]) {
    const args = provider({ withSubtitles });
    const prompt = buildAiMediaFreeVideoScenePrompt(args, 0, 8);
    assert.match(prompt, new RegExp(`SUBTITLES ${withSubtitles ? "ON" : "OFF"}`));
    assert.ok(prompt.includes("enseigne « Bonjour »"));
    assert.equal(prompt.split(script).length, 2);
    if (withSubtitles) assert.ok(!prompt.includes("no subtitles"));
  }
});

test("the prepared first frame never draws the dedicated speech or pre-burns captions", () => {
  const args = provider({ withSubtitles: true });
  const prompt = buildAiMediaFreeSceneFramePrompt({ request: args.request, profile: { business: { companyName: "" } } } as never);
  assert.match(prompt, /SUBTITLES OFF/);
  assert.ok(!prompt.includes(script));
  assert.ok(prompt.includes("enseigne"));
});

test("separate voiceover captions are opt-in and bound to the prepared narration", () => {
  const off = provider({ withNarration: true, teamVideoSpeechMode: "voiceover" }, [script]);
  assert.ok(!buildAiMediaFreeVideoScenePrompt(off, 0, 8).includes(script));
  const on = provider({ withNarration: true, teamVideoSpeechMode: "voiceover", withSubtitles: true }, [script]);
  const prompt = buildAiMediaFreeVideoScenePrompt(on, 0, 8);
  assert.match(prompt, /EXTERNAL VOICEOVER CAPTIONS:/);
  assert.match(prompt, /No native voices or dialogue/);
  assert.ok(prompt.includes(script));
  assert.throws(() => buildAiMediaFreeVideoScenePrompt({ ...on, subtitleLines: ["Autre texte"] }, 0, 8), /subtitles_contract_incomplete/);
});

test("script splitting preserves every code point, punctuation and newline", () => {
  for (const text of ["  Bonjour,\nOcéane !  Voici iNrCy.  ", "你好，世界。我们创建您的内容。", "ยินดีต้อนรับทุกคน", "Un 👩‍👩‍👧‍👦 et 🇫🇷 !"]) {
    const lines = splitAiMediaSpokenScript(text, [8, 15]);
    assert.equal(lines.length, 2);
    assert.equal(lines.join(""), text);
    for (const line of lines) assert.ok(!/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/u.test(line));
  }
});
