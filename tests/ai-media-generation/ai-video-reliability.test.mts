import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_VEO_MODEL,
  classifyVeoFailure,
  isAmbiguousVideoCreationFailure,
  nextVeoInspirationMode,
  resolveVeoModelCandidates,
  selectVeoInspirationMode,
  supportsVeoReferenceImages,
} from "../../lib/aiVideoReliability.ts";

test("speech verification unavailability never triggers paid video retry or provider fallback, even behind HTTP 503", () => {
  for (const code of ["ai_media_native_speech_verification_unavailable", "AI_MEDIA_VIDEO_SPEECH_VERIFICATION_UNAVAILABLE"]) {
    for (const error of [new Error(code), Object.assign(new Error(code), { statusCode: 503 }), new Error("video service unavailable", { cause: { code, status: 503 } })]) {
      const result = classifyVeoFailure(error);
      assert.equal(result.kind, "verification_unavailable");
      assert.equal(result.retryable, false);
      assert.equal(result.modelFallbackEligible, false);
    }
  }
});

test("provider billing refusals are never mistaken for capacity or model problems", () => {
  const text = "Video generation requires a minimum balance of $10. Your current balance is insufficient.";
  for (const error of [new Error(text), Object.assign(new Error(text), { statusCode: 402 }),
    Object.assign(new Error("Your project has exceeded its monthly spending cap."), { statusCode: 429 })]) {
    const failure = classifyVeoFailure(error);
    assert.equal(failure.kind, "billing");
    assert.equal(failure.retryable, false);
    assert.equal(failure.modelFallbackEligible, false);
    assert.equal(isAmbiguousVideoCreationFailure(error), false);
  }
  assert.equal(classifyVeoFailure(Object.assign(new Error(text), { statusCode: 402 })).status, 402);
  assert.equal(classifyVeoFailure(new Error(text)).status, 0, "do not invent an HTTP status absent from the supplier response");
});

test("a per-minute provider quota remains a retryable throughput limit", () => {
  for (const suffix of ["", " Check billing for more information."]) {
    const error = Object.assign(new Error(`Quota exceeded for metric GenerateContent requests per minute per project. Please retry in 60 seconds.${suffix}`), { statusCode: 429 });
    const failure = classifyVeoFailure(error);
    assert.equal(failure.kind, "rate_limited");
    assert.equal(failure.retryable, true);
    assert.equal(failure.modelFallbackEligible, true);
  }
});

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
      imageCount: 1,
    }),
    "references",
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
