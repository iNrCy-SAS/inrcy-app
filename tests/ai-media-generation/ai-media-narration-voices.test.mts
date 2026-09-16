import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_MEDIA_NARRATION_VOICE_VARIANT_IDS,
  AI_MEDIA_NARRATION_VOICE_VARIANTS,
  defaultAiMediaNarrationVoiceVariant,
  isAiMediaNarrationVoiceVariantForGender,
} from "../../lib/aiMediaNarrationVoices.ts";

test("iNrStudio propose trois voix Gemini distinctes pour chaque catégorie", () => {
  assert.deepEqual(AI_MEDIA_NARRATION_VOICE_VARIANTS.female, [
    "Kore",
    "Aoede",
    "Sulafat",
  ]);
  assert.deepEqual(AI_MEDIA_NARRATION_VOICE_VARIANTS.male, [
    "Charon",
    "Orus",
    "Puck",
  ]);
  assert.equal(new Set(AI_MEDIA_NARRATION_VOICE_VARIANT_IDS).size, 6);
  assert.equal(defaultAiMediaNarrationVoiceVariant("female"), "Kore");
  assert.equal(defaultAiMediaNarrationVoiceVariant("male"), "Charon");
});

test("une variante ne peut pas être envoyée sous la mauvaise catégorie", () => {
  assert.equal(isAiMediaNarrationVoiceVariantForGender("Sulafat", "female"), true);
  assert.equal(isAiMediaNarrationVoiceVariantForGender("Sulafat", "male"), false);
  assert.equal(isAiMediaNarrationVoiceVariantForGender("Puck", "male"), true);
  assert.equal(isAiMediaNarrationVoiceVariantForGender("Puck", "female"), false);
  assert.equal(isAiMediaNarrationVoiceVariantForGender("unknown", "female"), false);
});
