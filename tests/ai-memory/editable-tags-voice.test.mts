import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const editableTags = readFileSync(
  resolve(import.meta.dirname, "../../app/dashboard/settings/_components/EditableTags.tsx"),
  "utf8",
);
const voiceButton = readFileSync(
  resolve(import.meta.dirname, "../../app/dashboard/_components/MediaSubjectVoiceButton.tsx"),
  "utf8",
);

test("every shared Business DNA tag editor exposes the existing voice control", () => {
  assert.match(editableTags, /<MediaSubjectVoiceButton/);
  assert.match(editableTags, /purpose="tags"/);
  assert.match(editableTags, /data-editable-tags-voice-help/);
  assert.match(editableTags, /tags_voice_help/);
  assert.match(voiceButton, /purpose === "tags"/);
});

test("voice tag input accepts spoken comma separators and commits after transcription", () => {
  assert.match(editableTags, /virgule\|comma\|coma\|komma\|virgola\|vírgula/);
  assert.match(editableTags, /if \(draftRef\.current\.trim\(\)\) commit\(draftRef\.current\)/);
  assert.match(editableTags, /uniqueTags\(\[\.\.\.values, \.\.\.next\]\)\.slice\(0, maxItems\)/);
});
