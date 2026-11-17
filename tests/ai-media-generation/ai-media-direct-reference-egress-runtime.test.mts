import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAiMediaGenerationRequest } from "../../lib/aiMediaGenerationContracts.ts";
import { assertAiVideoReferenceTeamGoogleEgress, assertAiVideoReferenceTeamProviderEgress, type AiVideoProviderGenerationArgs } from "../../lib/aiVideoProviderTypes.ts";

type Egress = Pick<AiVideoProviderGenerationArgs, "request" | "directVideo" | "identityTeamPrecomposed" | "identityTeamProviderEgressConsent" | "identityTeamGoogleEgressConsent">;
function input(engine: "veo" | "omni" | "grok" | "grok-lite" | "minimax-h3" = "veo"): Egress {
  const request = normalizeAiMediaGenerationRequest({ requestId: "direct-egress-test", source: "studio", operation: "generate", creationMode: "free", kind: "video",
    format: "story", videoEngine: engine, videoResolution: engine === "minimax-h3" ? "768p" : "720p", durationSeconds: 8,
    freePrompt: "Les deux personnes des photos présentent le jardin.", identityConsent: true, teamVideoProviderConsent: engine,
    withNarration: true, teamVideoSpeechMode: "voiceover", inspirationImages: [1, 2].map(characterIndex => ({
      role: "character", usage: "required", characterIndex, mimeType: "image/png", data: String(characterIndex === 1 ? "A" : "B").repeat(88),
    })) });
  return { request, directVideo: true, identityTeamProviderEgressConsent: engine };
}

test("native Google and Grok retain two authorized original portraits without claiming precomposition", () => {
  for (const engine of ["veo", "omni", "grok"] as const) {
    const args = input(engine), before = structuredClone(args);
    const provider = engine === "grok" ? "spacexai" : "google";
    assert.doesNotThrow(() => assertAiVideoReferenceTeamProviderEgress(args, provider));
    assert.equal(args.identityTeamPrecomposed, undefined);
    assert.deepEqual(args, before);
  }
});

test("native egress still requires identity rights, the exact one-attempt destination, and a coherent normalized consent", () => {
  for (const engine of ["veo", "grok"] as const) {
    const provider = engine === "veo" ? "google" : "spacexai";
    for (const patch of [
      { identityTeamProviderEgressConsent: undefined },
      { identityTeamProviderEgressConsent: "kling" },
      { request: { ...input(engine).request, teamVideoProviderConsent: null } },
      { request: { ...input(engine).request, identityConsent: false } },
      { request: { ...input(engine).request, teamVideoMode: "montage" } },
    ]) assert.throws(() => assertAiVideoReferenceTeamProviderEgress({ ...input(engine), ...patch } as Egress, provider), /consent_required/);
  }
});

test("the older explicit Google consent opens only Google and must be transferred from the normalized request by the server", () => {
  const args = input("veo");
  args.identityTeamProviderEgressConsent = undefined;
  args.request.teamVideoProviderConsent = null;
  args.request.teamVideoVeoConsent = true;
  assert.throws(() => assertAiVideoReferenceTeamGoogleEgress(args), /google_consent_required/);
  args.identityTeamGoogleEgressConsent = true;
  assert.doesNotThrow(() => assertAiVideoReferenceTeamGoogleEgress(args));
  const grok = input("grok");
  grok.identityTeamProviderEgressConsent = undefined;
  grok.identityTeamGoogleEgressConsent = true;
  grok.request.teamVideoProviderConsent = null;
  grok.request.teamVideoVeoConsent = true;
  assert.throws(() => assertAiVideoReferenceTeamProviderEgress(grok, "spacexai"), /provider_consent_required/);
});

test("a body flag, guided/modify/image request, or false provenance cannot activate the server-only native exception", () => {
  const args = input();
  for (const patch of [
    { directVideo: undefined, request: { ...args.request, directVideo: true } },
    { directVideo: "true" },
    { request: { ...args.request, creationMode: "guided" } },
    { request: { ...args.request, operation: "modify" } },
    { request: { ...args.request, kind: "image" } },
  ]) assert.throws(() => assertAiVideoReferenceTeamGoogleEgress({ ...args, ...patch } as Egress), /precomposition_required/);
  assert.throws(() => assertAiVideoReferenceTeamGoogleEgress({ ...args, identityTeamPrecomposed: true }), /provenance_invalid/);
  const normalized = normalizeAiMediaGenerationRequest({ ...args.request, directVideo: true });
  assert.ok(!("directVideo" in normalized));
});

test("native originals retain the provider's real capacity, resolution and reference structure", () => {
  const args = input("grok");
  assert.throws(() => assertAiVideoReferenceTeamProviderEgress({ ...args, request: { ...args.request, videoResolution: "1080p" } }, "spacexai"), /references_unsupported/);
  const google = input("veo");
  assert.throws(() => assertAiVideoReferenceTeamGoogleEgress({ ...google, request: { ...google.request, inspirationImages: [...google.request.inspirationImages, ...google.request.inspirationImages] } }), /references_unsupported/);
  for (const references of [
    args.request.inspirationImages.slice(0, 1),
    args.request.inspirationImages.map(image => ({ ...image, characterIndex: 1 as const })),
    args.request.inspirationImages.map(image => ({ ...image, usage: "inspiration" as const })),
    args.request.inspirationImages.map(image => ({ ...image, role: "product" as const })),
    args.request.inspirationImages.map(image => ({ ...image, data: "" })),
  ]) assert.throws(() => assertAiVideoReferenceTeamProviderEgress({ ...args, request: { ...args.request, inspirationImages: references } }, "spacexai"), /reference_team_invalid/);
  assert.throws(() => assertAiVideoReferenceTeamProviderEgress(args, "minimax"), /references_unsupported/);
});

test("legacy and guided guards retain the original one-composed-image rule and destination consent", () => {
  const args = input();
  args.directVideo = false;
  assert.throws(() => assertAiVideoReferenceTeamGoogleEgress(args), /precomposition_required/);
  args.identityTeamPrecomposed = true;
  assert.throws(() => assertAiVideoReferenceTeamGoogleEgress(args), /single_group_image_required/);
  args.request.inspirationImages = args.request.inspirationImages.slice(0, 1);
  assert.doesNotThrow(() => assertAiVideoReferenceTeamGoogleEgress(args));
  args.identityTeamProviderEgressConsent = undefined;
  assert.throws(() => assertAiVideoReferenceTeamGoogleEgress(args), /google_consent_required/);
});
