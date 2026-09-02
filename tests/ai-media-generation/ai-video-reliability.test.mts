import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_VEO_MODEL,
  classifyVeoFailure,
  nextVeoInspirationMode,
  resolveVeoModelCandidates,
  selectVeoInspirationMode,
  supportsVeoReferenceImages,
} from "../../lib/aiVideoReliability.ts";

test("la chaîne Veo n'utilise que des modèles 3.1 actifs et dédupliqués", () => {
  assert.deepEqual(resolveVeoModelCandidates({}), [
    DEFAULT_VEO_MODEL,
    "veo-3.1-lite-generate-preview",
  ]);
  assert.deepEqual(
    resolveVeoModelCandidates({
      primary: "veo-3.1-generate-preview",
      fallbacks:
        "veo-3.0-fast-generate-preview, veo-3.1-lite-generate-preview, veo-3.1-lite-generate-preview",
    }),
    ["veo-3.1-generate-preview", "veo-3.1-lite-generate-preview"],
  );
  assert.deepEqual(
    resolveVeoModelCandidates({
      primary: "veo-3.1-fast-generate-preview",
      fallbacks: "",
    }),
    ["veo-3.1-fast-generate-preview"],
  );
  assert.deepEqual(
    resolveVeoModelCandidates({
      primary: "veo-3.0-fast-generate-preview",
      fallbacks: "",
    }),
    [DEFAULT_VEO_MODEL],
  );
  assert.deepEqual(
    resolveVeoModelCandidates({
      primary: "veo-3.1-imaginary-generate-preview",
      fallbacks: "",
    }),
    [DEFAULT_VEO_MODEL],
  );
});

test("les images d'inspiration se dégradent sans bloquer la vidéo", () => {
  assert.equal(
    supportsVeoReferenceImages("veo-3.1-fast-generate-preview"),
    true,
  );
  assert.equal(
    supportsVeoReferenceImages("veo-3.1-lite-generate-preview"),
    false,
  );
  assert.equal(
    selectVeoInspirationMode({
      model: "veo-3.1-fast-generate-preview",
      durationSeconds: 8,
      imageCount: 3,
    }),
    "references",
  );
  assert.equal(
    selectVeoInspirationMode({
      model: "veo-3.1-lite-generate-preview",
      durationSeconds: 8,
      imageCount: 3,
    }),
    "source",
  );
  assert.equal(
    selectVeoInspirationMode({
      model: "veo-3.1-fast-generate-preview",
      durationSeconds: 6,
      imageCount: 3,
    }),
    "source",
  );
  assert.equal(
    selectVeoInspirationMode({
      model: "veo-3.1-fast-generate-preview",
      durationSeconds: 8,
      imageCount: 0,
    }),
    "none",
  );
  assert.equal(nextVeoInspirationMode("references"), "source");
  assert.equal(nextVeoInspirationMode("source"), "none");
  assert.equal(nextVeoInspirationMode("none"), null);
});

test("les erreurs Google déterminent correctement retry, fallback et sécurité", () => {
  const invalid = classifyVeoFailure({
    response: { status: 400, data: { error: { message: "INVALID_ARGUMENT" } } },
  });
  assert.equal(invalid.kind, "invalid_argument");
  assert.equal(invalid.retryable, false);
  assert.equal(invalid.modelFallbackEligible, true);

  const unprocessableParameter = classifyVeoFailure({
    response: { status: 422, statusText: "Unprocessable Entity" },
  });
  assert.equal(unprocessableParameter.kind, "invalid_argument");
  assert.equal(unprocessableParameter.modelFallbackEligible, true);

  for (const [error, kind] of [
    [new Error("429 RESOURCE_EXHAUSTED"), "rate_limited"],
    [new Error("503 UNAVAILABLE"), "unavailable"],
    [new Error("deadline exceeded timeout"), "timeout"],
    [new Error("fetch failed ECONNRESET"), "network"],
  ] as const) {
    const failure = classifyVeoFailure(error);
    assert.equal(failure.kind, kind);
    assert.equal(failure.retryable, true);
  }

  assert.equal(
    classifyVeoFailure(new Error("ai_video_veo_configuration_rejected"))
      .kind,
    "invalid_argument",
  );
  assert.equal(
    classifyVeoFailure(new Error("ai_video_veo_network_failed")).kind,
    "network",
  );
  assert.equal(
    classifyVeoFailure(new Error("ai_video_veo_rate_limited")).kind,
    "rate_limited",
  );
  assert.equal(
    classifyVeoFailure(new Error("ai_video_veo_safety_filtered: RAI_MEDIA"))
      .kind,
    "safety",
  );
  assert.equal(
    classifyVeoFailure(new Error("ai_video_omni_safety_filtered: RAI_MEDIA"))
      .kind,
    "safety",
  );
  assert.equal(
    classifyVeoFailure(new Error("ai_video_omni_configuration_rejected"))
      .kind,
    "invalid_argument",
  );
  assert.equal(
    classifyVeoFailure(new Error("ai_video_omni_rate_limited")).kind,
    "rate_limited",
  );
  assert.equal(
    classifyVeoFailure(new Error("401 invalid API key")).kind,
    "authentication",
  );
});
