import assert from "node:assert/strict";
import test from "node:test";
import { getStudioReferenceMediaIds, normalizeStudioReferenceMemory, StudioReferencesValidationError, StudioReferencesVersionError } from "../../lib/studioReferences.ts";
import { AUDIO, memory, PHOTO, REF, VOICE } from "./studio-references-fixture.mts";

test("the durable reference set preserves IDs, roles, names and explicit voice associations only", () => {
  const value = memory(); value.references[0].characterName = " Ｃamille   Martin ";
  const normalized = normalizeStudioReferenceMemory(JSON.parse(JSON.stringify(value)));
  assert.equal(normalized.references[0].characterName, "Camille Martin");
  assert.deepEqual(normalized.voices[0].target, { referenceId: REF });
  assert.deepEqual(getStudioReferenceMediaIds(normalized), [PHOTO, AUDIO]);
  assert.deepEqual(normalizeStudioReferenceMemory({ version: 1, references: [], voices: [], activeNarrationVoiceId: null }), { version: 1, references: [], voices: [], activeNarrationVoiceId: null });
});

test("bytes, URLs, consent, dialogue and model settings cannot enter any saved namespace level", () => {
  for (const [level, field, value] of [
    ["root", "prompt", "private prompt"], ["root", "identityConsent", true], ["root", "durationSeconds", 16],
    ["reference", "data", "base64"], ["reference", "signed_url", "https://private.invalid"], ["reference", "sample", { path: "temporary.wav" }],
    ["voice", "path", "temp.wav"], ["voice", "consent", true], ["voice", "voiceSample", { data: "bytes" }],
  ] as const) {
    const row = memory();
    const target = level === "root" ? row : level === "reference" ? row.references[0] : row.voices[0];
    Object.assign(target, { [field]: value });
    assert.throws(() => normalizeStudioReferenceMemory(row), StudioReferencesValidationError);
  }
});

test("dangling, duplicate, swapped or non-character voice targets are rejected instead of reassigned", () => {
  for (const change of [
    (row: ReturnType<typeof memory>) => { row.voices[0].target = null; },
    (row: ReturnType<typeof memory>) => { row.voices[0].target = { referenceId: VOICE }; },
    (row: ReturnType<typeof memory>) => { row.references[0].voiceMode = "ai"; },
    (row: ReturnType<typeof memory>) => { row.references[0].role = "environment"; },
    (row: ReturnType<typeof memory>) => { row.voices.push({ ...row.voices[0], id: REF }); },
    (row: ReturnType<typeof memory>) => { row.activeNarrationVoiceId = VOICE; },
    (row: ReturnType<typeof memory>) => { row.references[0].id = "blob:local"; },
  ]) {
    const row = memory(); change(row);
    assert.throws(() => normalizeStudioReferenceMemory(row), StudioReferencesValidationError);
  }
  const narrator = memory(); narrator.voices[0].target = "narration"; narrator.activeNarrationVoiceId = VOICE; narrator.references[0].voiceMode = "ai";
  assert.deepEqual(normalizeStudioReferenceMemory(narrator), narrator);
});

test("future versions, malformed arrays, duplicate names and provider limits fail closed", () => {
  assert.throws(() => normalizeStudioReferenceMemory({ ...memory(), version: 2 }), StudioReferencesVersionError);
  for (const value of [null, [], { ...memory(), voices: {} }, { ...memory(), references: Array.from({ length: 6 }, () => memory().references[0]) },
    { ...memory(), references: [{ ...memory().references[0], role: ["character"] }] },
    { ...memory(), voices: [{ ...memory().voices[0], gender: ["auto"] }] },
    { ...memory(), voices: Array.from({ length: 4 }, () => memory().voices[0]) },
    { ...memory(), references: [memory().references[0], { ...memory().references[0], id: VOICE, voiceMode: "ai", characterName: " CAMILLE " }] },
  ]) assert.throws(() => normalizeStudioReferenceMemory(value));
});
