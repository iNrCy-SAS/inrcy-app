import assert from "node:assert/strict";
import test from "node:test";
import { buildAiMediaNarrationSubtitleCues, buildAiMediaNarrationSubtitlesAss } from "../../lib/aiMediaNarrationSubtitles.ts";

test("local narration captions retain exact accented words and advance over the measured voice only", () => {
  const script = "L’été d’Inès révèle l’élégance du jardin. Découvrez l’allée éclairée d’un accueil chaleureux.";
  const cues = buildAiMediaNarrationSubtitleCues(script, 7.5);
  assert.ok(cues.length > 1);
  assert.equal(cues.map(cue => cue.text).join(" ").replace(/\s/gu, ""), script.replace(/\s/gu, ""));
  assert.equal(cues[0].startSeconds, 0);
  assert.equal(cues.at(-1)!.endSeconds, 7.5);
  cues.forEach((cue, index) => {
    assert.ok(cue.endSeconds > cue.startSeconds);
    if (index) assert.equal(cue.startSeconds, cues[index - 1].endSeconds);
  });
  const ass = buildAiMediaNarrationSubtitlesAss({ script, durationSeconds: 7.5, width: 1080, height: 1920 });
  assert.match(ass, /L’été d’Inès/);
  assert.match(ass, /éclairée/);
  assert.match(ass, /d’un accueil chaleureux/);
  assert.equal(ass.split("Dialogue: ").length - 1, cues.length);
});

test("caption text cannot introduce ASS overrides or FFmpeg filter syntax", () => {
  const ass = buildAiMediaNarrationSubtitlesAss({ script: "Exact {\\an8} d’Inès : [video]; 'été'", durationSeconds: 2, width: 320, height: 320 });
  assert.ok(ass.includes("\\{\\\\an8\\}"));
  assert.throws(() => buildAiMediaNarrationSubtitleCues("", 2), /subtitles_invalid/);
  assert.throws(() => buildAiMediaNarrationSubtitleCues("texte", 31), /subtitles_invalid/);
  assert.throws(() => buildAiMediaNarrationSubtitleCues("x".repeat(4_001), 2), /subtitles_invalid/);
});
