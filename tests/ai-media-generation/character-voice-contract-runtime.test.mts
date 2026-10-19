import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAiMediaGenerationRequest } from "../../lib/aiMediaGenerationContracts.ts";
import { isOwnedAiMediaCharacterVoicePath, normalizeAiMediaCharacterVoiceSample } from "../../lib/aiMediaCharacterVoices.ts";
import { getAiMediaGenerationPublicError } from "../../lib/aiMediaGenerationPublicErrors.ts";

const now = Date.now();
const day = new Date(now).toISOString().slice(0, 10);
const sample = {
  path: `_studio-voice-references/${day}/account-a__${now}__12345678-1234-4123-8123-123456789abc.wav`,
  name: "mon-vocal.wav", mimeType: "audio/wav", durationSeconds: 2, sizeBytes: 64044,
};
const image = (extra = {}) => ({ mimeType: "image/jpeg", data: "A".repeat(64), role: "character", usage: "required", characterIndex: 1, ...extra });
const payload = (extra = {}) => ({
  requestId: "studio-voice-contract-0001", creationMode: "free", source: "studio", kind: "video", operation: "generate",
  freePrompt: 'La personne présente son activité et dit "Bonjour à tous".', format: "story", videoEngine: "wan27", videoResolution: "720p", durationSeconds: 8,
  teamVideoSpeechMode: "characters", identityConsent: true,
  inspirationImages: [image({ voiceMode: "provided", voiceSample: sample })], ...extra,
});

test("normalization binds each supplied voice to its own character and keeps prompt unchanged", () => {
  const input = payload();
  const result = normalizeAiMediaGenerationRequest(input);
  assert.equal(result.videoEngine, "wan27");
  assert.equal(result.freePrompt, input.freePrompt);
  assert.equal(result.inspirationImages[0].voiceMode, "provided");
  assert.deepEqual(result.inspirationImages[0].voiceSample, sample);
  assert.equal(result.identityConsent, true);
  assert.equal(result.withNarration, false);
});

test("inspiration characters may have their own voice without silently demanding their visual identity", () => {
  const result = normalizeAiMediaGenerationRequest(payload({ inspirationImages: [image({ usage: "inspiration", voiceMode: "provided", voiceSample: sample })] }));
  assert.equal(result.identityMode, "auto");
  assert.equal(result.identityConsent, true);
  assert.equal(result.inspirationImages[0].usage, "inspiration");
  assert.deepEqual(result.inspirationImages[0].voiceSample, sample);
});

test("supplied voice cannot bypass model, sound, kind or consent restrictions", () => {
  for (const overrides of [{ videoEngine: "grok-lite" }, { teamVideoSpeechMode: "voiceover" }, { kind: "image" }, { identityConsent: false }]) {
    assert.throws(() => normalizeAiMediaGenerationRequest(payload(overrides)), /voix|Wan 2.7|visages/i);
  }
});

test("a missing or malformed sample is rejected before any provider call", () => {
  for (const extra of [{ voiceMode: "provided" }, { voiceMode: "provided", voiceSample: { ...sample, path: "https://external.test/voice.wav" } },
    { voiceMode: "provided", voiceSample: { ...sample, durationSeconds: 11 } }, { voiceMode: "ai", voiceSample: sample },
    { role: "product", voiceMode: "provided", voiceSample: sample }]) {
    assert.throws(() => normalizeAiMediaGenerationRequest(payload({ inspirationImages: [image(extra)] })), /vocal/i);
  }
});

test("different character voices require distinct stable indexes including inspiration references", () => {
  assert.throws(() => normalizeAiMediaGenerationRequest(payload({ inspirationImages: [image(), image({ usage: "inspiration", voiceMode: "provided", voiceSample: sample })] })), /distinct/i);
  const result = normalizeAiMediaGenerationRequest(payload({
    inspirationImages: [image({ voiceMode: "provided", voiceSample: sample }), image({ characterIndex: 2, voiceMode: "ai" })],
    teamVideoProviderConsent: "wan27",
  }));
  assert.equal(result.inspirationImages[0].voiceSample?.path, sample.path);
  assert.equal(result.inspirationImages[1].voiceMode, "ai");
  assert.equal(result.inspirationImages[1].voiceSample, undefined);
});

test("AI voices keep the existing engines and Wan R2V still requires a photo", () => {
  assert.equal(normalizeAiMediaGenerationRequest(payload({ videoEngine: "grok-lite", inspirationImages: [image({ voiceMode: "ai" })] })).videoEngine, "grok-lite");
  assert.throws(() => normalizeAiMediaGenerationRequest(payload({ inspirationImages: [] })), /photo de référence/i);
});

test("voice reference metadata accepts only normalized private path descriptors", () => {
  assert.deepEqual(normalizeAiMediaCharacterVoiceSample(sample), sample);
  assert.equal(isOwnedAiMediaCharacterVoicePath("account-a", sample.path, now), true);
  assert.equal(isOwnedAiMediaCharacterVoicePath("account-b", sample.path, now), false);
  assert.equal(isOwnedAiMediaCharacterVoicePath("account-a", sample.path, now + 24 * 60 * 60 * 1000 + 1), false);
  assert.equal(normalizeAiMediaCharacterVoiceSample({ ...sample, sizeBytes: 400000 }), null);
});

test("voice failures produce actionable allowlisted messages without paths or URLs", () => {
  const invalid = getAiMediaGenerationPublicError(new Error("voice_reference_invalid_or_expired https://private.test/token"));
  assert.equal(invalid.code, "AI_MEDIA_CHARACTER_VOICE_INVALID");
  assert.doesNotMatch(JSON.stringify(invalid), /private.test|token/);
  assert.equal(getAiMediaGenerationPublicError(new Error("voice_storage_unavailable")).code, "AI_MEDIA_CHARACTER_VOICE_UNAVAILABLE");
});
