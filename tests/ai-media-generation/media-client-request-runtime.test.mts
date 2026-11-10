import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGenerationAttemptKey,
  hasStrictIdentityReferences,
  normalizeMediaGenerationAiInstruction,
  type MediaGenerationRequest,
} from "../../lib/mediaGenerationClientRequest.ts";
import { AI_MEDIA_MODIFICATION_INSTRUCTION_MAX_CHARS } from "../../lib/aiMediaGenerationContracts.ts";

const request = (overrides: Partial<MediaGenerationRequest> = {}): MediaGenerationRequest => ({
  kind: "video", subjectSource: "custom", idea: "Une équipe dans son atelier",
  textKeywords: [], format: "square", imageStyle: "photo", peopleMode: "team",
  useBrandColors: true, logoMode: "discreet", source: "studio", ...overrides,
});
const key = (input: MediaGenerationRequest) => buildGenerationAttemptKey(input, input.idea);

test("attempt identity keeps consent and reference changes distinct without mutating the request", () => {
  const original = request({ identityMode: "reference_team", identityConsent: true,
    identityReferenceSetId: "selection-a", inspirationImages: [{ mimeType: "image/jpeg", data: "aGVsbG8=", name: "photo.jpg", role: "character", usage: "required" }] });
  const before = structuredClone(original);
  assert.equal(key(original), key(structuredClone(original)));
  for (const patch of [
    { identityConsent: false }, { identityReferenceSetId: "selection-b" },
    { teamVideoProviderConsent: "veo" as const }, { videoEngine: "veo" as const },
    { format: "portrait" as const }, { source: "booster" as const },
  ]) assert.notEqual(key(original), key({ ...original, ...patch }));
  assert.deepEqual(original, before);
});

test("provided character voice remains a strict identity reference even without visible people", () => {
  const input = request({ peopleMode: "none", identityConsent: true, inspirationImages: [{
    mimeType: "image/jpeg", data: "aGVsbG8=", name: "voice.jpg", role: "character", voiceMode: "provided",
    voiceSample: { path: "account/voice-a.webm" } as NonNullable<MediaGenerationRequest["inspirationImages"]>[number]["voiceSample"],
  }] });
  assert.equal(hasStrictIdentityReferences(input), true);
  assert.equal(JSON.parse(key(input)).identityConsent, true);
  const changed = structuredClone(input);
  changed.inspirationImages![0].voiceSample!.path = "account/voice-b.webm";
  assert.notEqual(key(input), key(changed));
  assert.equal(hasStrictIdentityReferences({ ...input, kind: "image" }), false);
});

test("inspiration-only photos do not activate strict identity consent", () => {
  const input = request({ identityMode: "reference_team", identityConsent: true, inspirationImages: [{
    mimeType: "image/png", data: "cGhvdG8=", name: "mood.png", role: "character", usage: "inspiration",
  }] });
  assert.equal(hasStrictIdentityReferences(input), false);
  assert.equal(JSON.parse(key(input)).identityConsent, false);
  assert.equal(hasStrictIdentityReferences({ ...input, inspirationImages: [{ ...input.inspirationImages![0], usage: "required" }] }), true);
});

test("free video speech and optional DNA are part of identity only in their applicable modes", () => {
  const input = request({ creationMode: "free", freePrompt: "Dans un atelier", spokenScript: "Bonjour !", withNarration: true, withSubtitles: true, useBusinessDna: true });
  const serialized = JSON.parse(key(input));
  assert.equal(serialized.spokenScript, "Bonjour !");
  assert.equal(serialized.withSubtitles, true);
  assert.equal(serialized.useBusinessDna, true);
  assert.notEqual(key(input), key({ ...input, spokenScript: "Bonsoir !" }));
  const guided = JSON.parse(key({ ...input, creationMode: "guided" }));
  for (const field of ["freePrompt", "spokenScript", "withSubtitles", "useBusinessDna"]) assert.equal(Object.hasOwn(guided, field), false);
});

test("modification instructions preserve the exact trimmed text and enforce their existing limit", () => {
  const input = request({ operation: "modify", aiInstruction: "  Ajouter une tasse bleue.\n", modificationSourceWidth: 1920, modificationSourceHeight: 1080 });
  assert.equal(normalizeMediaGenerationAiInstruction(input), "Ajouter une tasse bleue.");
  assert.equal(JSON.parse(key(input)).aiInstruction, "Ajouter une tasse bleue.");
  assert.equal(key(input), key({ ...input, aiInstruction: "Ajouter une tasse bleue." }));
  assert.notEqual(key(input), key({ ...input, modificationSourceWidth: 1080 }));
  assert.doesNotThrow(() => key({ ...input, aiInstruction: "a".repeat(AI_MEDIA_MODIFICATION_INSTRUCTION_MAX_CHARS) }));
  assert.throws(() => key({ ...input, aiInstruction: "a".repeat(AI_MEDIA_MODIFICATION_INSTRUCTION_MAX_CHARS + 1) }), /La consigne de modification ne peut pas dépasser/);
});

test("the editorial role of an image subject changes request identity without changing video or guided jobs", () => {
  const input = request({ kind: "image", creationMode: "free", freePrompt: "Nos nouveaux services", publicationSubject: "Nos nouveaux services" });
  assert.equal(JSON.parse(key(input)).publicationSubject, "Nos nouveaux services");
  assert.notEqual(key(input), key({ ...input, publicationSubject: undefined }));
  for (const patch of [{ kind: "video" as const }, { creationMode: "guided" as const }]) {
    assert.equal(Object.hasOwn(JSON.parse(key({ ...input, ...patch })), "publicationSubject"), false);
  }
});
