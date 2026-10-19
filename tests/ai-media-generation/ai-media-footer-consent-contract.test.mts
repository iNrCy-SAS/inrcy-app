import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { normalizeAiMediaGenerationRequest } from "../../lib/aiMediaGenerationContracts.ts";

function references(count: number, supplied = false, usage = "required") {
  const now = Date.now();
  return Array.from({ length: count }, (_, index) => ({
    mimeType: "image/png", data: String.fromCharCode(65 + index).repeat(88), role: "character", usage, characterIndex: index + 1,
    voiceMode: supplied ? "provided" : "ai", ...(supplied ? { voiceSample: {
      path: `_studio-voice-references/${new Date(now).toISOString().slice(0, 10)}/test-account__${now}__${randomUUID()}.wav`,
      name: `character-${index + 1}.wav`, mimeType: "audio/wav", durationSeconds: 5, sizeBytes: 160_044,
    } } : {}),
  }));
}

function payload(engine: "wan27" | "wan3" | "heygen" | "veo", count = 2, supplied = true) {
  return {
    requestId: randomUUID(), contractVersion: 4, creationMode: "free", inputMode: "essential", operation: "generate", source: "studio",
    kind: "video", videoEngine: engine, videoResolution: engine === "heygen" ? "768p" : "720p", durationSeconds: 8, sceneMode: "single",
    format: "story", freePrompt: "Les personnages parlent de leur activité face caméra.", subjectSource: "custom", identityMode: "auto",
    teamVideoMode: "cinematic", teamVideoSpeechMode: "characters", withNarration: false,
    identityReferenceSetId: randomUUID(), inspirationImages: references(count, supplied),
  };
}

for (const engine of ["wan27", "wan3", "heygen"] as const) {
  test(`${engine}: the single footer approval supplies both existing permissions for two or three distinct people`, () => {
    for (const count of [2, 3]) {
      const input = payload(engine, count);
      assert.throws(() => normalizeAiMediaGenerationRequest(input), /autorisation|Confirmez/);
      assert.throws(() => normalizeAiMediaGenerationRequest({ ...input, identityConsent: false, teamVideoProviderConsent: engine }), /autorisation|Confirmez/);
      assert.throws(() => normalizeAiMediaGenerationRequest({ ...input, identityConsent: true }), /Confirmez l’animation/);
      const normalized = normalizeAiMediaGenerationRequest({ ...input, identityConsent: true, teamVideoProviderConsent: engine });
      assert.equal(normalized.identityMode, "reference_team"); assert.equal(normalized.identityConsent, true);
      assert.equal(normalized.teamVideoProviderConsent, engine); assert.equal(normalized.teamVideoVeoConsent, false);
      assert.deepEqual(normalized.inspirationImages.map((image) => image.voiceSample?.path), input.inspirationImages.map((image) => image.voiceSample?.path));
    }
  });

  test(`${engine}: another engine's former approval and a bare Google flag cannot authorize this destination`, () => {
    const input = payload(engine);
    const previousEngine = engine === "wan27" ? "wan3" : "wan27";
    for (const permissions of [
      { identityConsent: true, teamVideoProviderConsent: previousEngine },
      { identityConsent: true, teamVideoVeoConsent: true },
      { identityConsent: false, teamVideoProviderConsent: engine, teamVideoVeoConsent: true },
    ]) assert.throws(() => normalizeAiMediaGenerationRequest({ ...input, ...permissions }), /Confirmez|autorisation/);
  });

  test(`${engine}: a supplied inspiration voice still needs the footer's rights approval without a strict face mode`, () => {
    const input = { ...payload(engine, 1), inspirationImages: references(1, true, "inspiration") };
    assert.throws(() => normalizeAiMediaGenerationRequest({ ...input, identityConsent: false }), /autorisation/);
    const normalized = normalizeAiMediaGenerationRequest({ ...input, identityConsent: true });
    assert.equal(normalized.identityMode, "auto"); assert.equal(normalized.identityConsent, true);
    assert.equal(normalized.teamVideoProviderConsent, null);
  });
}

test("the same footer mapping preserves the existing Google team permission protocol", () => {
  const normalized = normalizeAiMediaGenerationRequest({ ...payload("veo", 2, false), identityConsent: true,
    teamVideoProviderConsent: "veo", teamVideoVeoConsent: true });
  assert.equal(normalized.identityConsent, true); assert.equal(normalized.teamVideoProviderConsent, "veo");
  assert.equal(normalized.teamVideoVeoConsent, true);
});

test("unneeded approvals on ordinary product references do not carry into identity or team permissions", () => {
  const input = { ...payload("wan3", 1, false), inspirationImages: [{ mimeType: "image/png", data: "A".repeat(88), role: "product", usage: "required" }] };
  const normalized = normalizeAiMediaGenerationRequest({ ...input, identityConsent: true, teamVideoProviderConsent: "wan3", teamVideoVeoConsent: true });
  assert.equal(normalized.identityMode, "auto"); assert.equal(normalized.identityConsent, false);
  assert.equal(normalized.teamVideoProviderConsent, null); assert.equal(normalized.teamVideoVeoConsent, false);
});
