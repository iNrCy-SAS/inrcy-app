import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAiMediaGenerationRequest } from "../../lib/aiMediaGenerationContracts.ts";
import { isOwnedAiMediaCharacterVoicePath, normalizeAiMediaCharacterVoiceSample } from "../../lib/aiMediaCharacterVoices.ts";
import { AI_MEDIA_CHARACTER_VOICE_VIDEO_ENGINES, isAiMediaCharacterVoiceEngine, getAiMediaCharacterVoiceTotalDurationSeconds, exceedsAiMediaCharacterVoiceEngineDuration } from "../../lib/aiMediaCharacterVoices.ts";
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

test("current Wan2.7 and historical HeyGen normalization preserve Free and guided voice assignments without changing their voice assignments", () => {
  assert.deepEqual(AI_MEDIA_CHARACTER_VOICE_VIDEO_ENGINES, ["wan27", "wan3", "heygen", "kling"]);
  for (const videoEngine of AI_MEDIA_CHARACTER_VOICE_VIDEO_ENGINES.filter(engine => engine !== "wan3" && engine !== "kling")) {
    assert.equal(isAiMediaCharacterVoiceEngine(videoEngine), true);
    for (const creationMode of ["free", "guided"]) {
      const result = normalizeAiMediaGenerationRequest(payload({ videoEngine, videoResolution: videoEngine === "heygen" ? "768p" : "720p", creationMode, inputMode: "essential", teamVideoMode: "cinematic", idea: "La personne présente son activité." }));
      assert.equal(result.videoEngine, videoEngine); assert.equal(result.creationMode, creationMode);
      assert.deepEqual(result.inspirationImages[0].voiceSample, sample);
      assert.equal(result.inspirationImages[0].characterIndex, 1); assert.equal(result.identityConsent, true);
      assert.equal(result.withNarration, false); assert.equal(result.teamVideoSpeechMode, "characters");
    }
  }
  for (const engine of ["omni", "veo", "veo-lite", "minimax-h3", "wan-flash", "grok", "grok-lite", null, "unreviewed"])
    assert.equal(isAiMediaCharacterVoiceEngine(engine), false);
});

test("Kling preserves two photo/voice assignments in automatic and exact dialogue and requires five-second samples", () => {
  const images = [1, 2].map(characterIndex => image({ characterIndex, voiceMode: "provided", voiceSample: {
    ...sample, durationSeconds: 5, sizeBytes: 160044,
  } }));
  for (const exact of [false, true]) {
    const result = normalizeAiMediaGenerationRequest(payload({ videoEngine: "kling", inspirationImages: images,
      freePrompt: "Deux adultes présentent leur atelier en français.", teamVideoConsent: true,
      teamVideoMode: "cinematic", teamVideoProviderConsent: "kling", ...(exact ? { spokenScript: "Bonjour à tous. Bienvenue dans notre atelier." } : {}),
    }));
    assert.equal(result.videoEngine, "kling"); assert.equal(result.teamVideoProviderConsent, "kling");
    assert.deepEqual(result.inspirationImages.map(image => [image.characterIndex, image.voiceMode, image.voiceSample?.durationSeconds]), [[1, "provided", 5], [2, "provided", 5]]);
  }
  assert.throws(() => normalizeAiMediaGenerationRequest(payload({ videoEngine: "kling" })), /Kling.*5.*10 secondes/);
});

test("historical Wan3 aggregate remains measurable but new requests reject retirement without shortening samples", () => {
  const images = (seconds: number[]) => seconds.map((durationSeconds, index) => image({ usage: "inspiration", characterIndex: index + 1, voiceMode: "provided", voiceSample: {
    ...sample, durationSeconds, sizeBytes: 44 + durationSeconds * 32_000,
    path: sample.path.replace(/123456789abc\.wav$/, `${String(index + 1).padStart(12, "0")}.wav`),
  } }));
  const allowed = images([5, 5, 5]);
  assert.equal(getAiMediaCharacterVoiceTotalDurationSeconds(allowed), 15);
  assert.equal(exceedsAiMediaCharacterVoiceEngineDuration("wan3", allowed), false);
  assert.deepEqual(normalizeAiMediaGenerationRequest(payload({ videoEngine: "wan27", inspirationImages: allowed })).inspirationImages.map((image) => image.voiceSample?.durationSeconds), [5, 5, 5]);
  assert.throws(() => normalizeAiMediaGenerationRequest(payload({ videoEngine: "wan3", inspirationImages: allowed })), /Wan 3\.0.*autre moteur/);
  const excessive = images([5, 5, 5.1]);
  assert.equal(exceedsAiMediaCharacterVoiceEngineDuration("wan3", excessive), true);
  assert.throws(() => normalizeAiMediaGenerationRequest(payload({ videoEngine: "wan3", inspirationImages: excessive })), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /Wan 3\.0.*autre moteur/);
    assert.doesNotMatch(error.message, /HeyGen/i);
    return true;
  });
  for (const videoEngine of ["wan27", "heygen"]) {
    const originals = images([10, 10, 10]);
    assert.equal(exceedsAiMediaCharacterVoiceEngineDuration(videoEngine, originals), false);
    assert.deepEqual(normalizeAiMediaGenerationRequest(payload({ videoEngine, videoResolution: videoEngine === "heygen" ? "768p" : "720p", inspirationImages: originals })).inspirationImages.map((image) => image.voiceSample?.durationSeconds), [10, 10, 10]);
  }
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
  for (const videoEngine of AI_MEDIA_CHARACTER_VOICE_VIDEO_ENGINES.filter(engine => engine !== "wan3")) for (const overrides of [{ teamVideoSpeechMode: "voiceover" }, { kind: "image" }, { identityConsent: false }]) {
    const inspirationImages = [image({ voiceMode: "provided", voiceSample: { ...sample, durationSeconds: 5, sizeBytes: 160044 } })];
    assert.throws(() => normalizeAiMediaGenerationRequest(payload({ videoEngine, inspirationImages, videoResolution: videoEngine === "heygen" ? "768p" : "720p", ...overrides })), /voix|Wan 2.7|visages/i);
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
