import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_MEDIA_VIDEO_MODELS,
  getAiMediaVideoDurations,
  getAiMediaVideoModel,
  normalizeAiMediaVideoEngine,
} from "../../lib/aiMediaModelCatalog.ts";
import { quoteAiMediaCredits, estimateAiMediaVideoSupplierCostMicroUsd } from "../../lib/aiMediaCreditsPricing.ts";
import { getAiMediaVideoSegmentDurations, canGenerateAiMediaVideoDuration } from "../../lib/aiMediaVideoTimeline.ts";

test("Studio offers eight choices from four video families with distinct capabilities", () => {
  assert.equal(AI_MEDIA_VIDEO_MODELS.length, 8);
  assert.equal(new Set(AI_MEDIA_VIDEO_MODELS.map((model) => model.provider)).size, 4);
  assert.equal(getAiMediaVideoModel("veo-lite").maxReferenceImages, 1);
  assert.equal(getAiMediaVideoModel("minimax-h3").defaultResolution, "768p");
  assert.equal(getAiMediaVideoModel("wan-flash").supportsTextToVideo, false);
  assert.equal(normalizeAiMediaVideoEngine("google-gemini-omni"), "omni");
  assert.equal(normalizeAiMediaVideoEngine("spacexai/unreviewed-model"), null);
});

test("duration-first choices respect four seconds minimum, two clips maximum and Google resolution restrictions", () => {
  assert.deepEqual(getAiMediaVideoDurations("omni"), Array.from({ length: 17 }, (_, index) => index + 4));
  assert.deepEqual(getAiMediaVideoDurations("veo-lite", "1080p"), [8, 16]);
  assert.equal(getAiMediaVideoDurations("grok-lite")[0], 4);
  assert.equal(getAiMediaVideoDurations("wan3").at(-1), 30);
  assert.throws(() => getAiMediaVideoDurations("minimax-h3", "1080p"), /resolution_invalid/);
});

test("one wallet prices different models at the same duration without equating credits and supplier USD", () => {
  const quotes = ["omni", "veo-lite", "minimax-h3", "wan3", "grok-lite", "grok"].map((videoEngine) =>
    quoteAiMediaCredits({ kind: "video", videoEngine, durationSeconds: 8 }));
  assert.deepEqual(quotes.map((quote) => quote.totalCredits), [80, 40, 64, 80, 24, 112]);
  assert.equal(quoteAiMediaCredits({ kind: "video", videoEngine: "veo", durationSeconds: 8 }).totalCredits, 80);
  assert.equal(estimateAiMediaVideoSupplierCostMicroUsd({ kind: "video", videoEngine: "veo", durationSeconds: 8 }), 800_000);
  assert.equal(quoteAiMediaCredits({ kind: "video", videoEngine: "veo", durationSeconds: 8, videoResolution: "1080p" }).totalCredits, 96);
  assert.equal(estimateAiMediaVideoSupplierCostMicroUsd({ kind: "video", videoEngine: "veo", durationSeconds: 8, videoResolution: "1080p" }), 960_000);
});

test("higher resolution costs and fractional supplier tariffs round the final video item up", () => {
  assert.equal(quoteAiMediaCredits({ kind: "video", videoEngine: "grok-lite", durationSeconds: 5, videoResolution: "1080p" }).totalCredits, 70);
  assert.equal(quoteAiMediaCredits({ kind: "video", videoEngine: "wan-flash", durationSeconds: 5, videoResolution: "1080p", inspirationImagesCount: 1 }).totalCredits, 38);
  assert.throws(() => quoteAiMediaCredits({ kind: "video", videoEngine: "veo-lite", durationSeconds: 4, videoResolution: "1080p" }), /duration_invalid/);
});

test("narration adds a fixed TTS charge only when it is a separate voice-over", () => {
  const input = { kind: "video", videoEngine: "grok-lite", durationSeconds: 5, withNarration: true };
  assert.equal(quoteAiMediaCredits(input).totalCredits, 17);
  assert.equal(quoteAiMediaCredits({ ...input, creationMode: "free" }).totalCredits, 22);
  assert.equal(quoteAiMediaCredits({ ...input, teamVideoSpeechMode: "characters" }).totalCredits, 15);
});

test("image generation and retouching quote their references while invalid client values fail closed", () => {
  assert.equal(quoteAiMediaCredits({ kind: "image", imageEngine: "gemini", inspirationImagesCount: 3 }).totalCredits, 13);
  assert.equal(quoteAiMediaCredits({ kind: "image", operation: "modify", inspirationImagesCount: 1 }).totalCredits, 9);
  for (const input of [
    { kind: "video", videoEngine: "unknown", durationSeconds: 5 },
    { kind: "video", videoEngine: "wan-flash", durationSeconds: 5 },
    { kind: "video", videoEngine: "grok-lite", durationSeconds: 5, inspirationImagesCount: 2 },
    { kind: "video", videoEngine: "veo-lite", durationSeconds: 8, inspirationImagesCount: 2 },
    { kind: "video", videoEngine: "grok", durationSeconds: 0 },
    { kind: "image", inspirationImagesCount: -1 },
    { kind: "image", imageEngine: "unknown" },
  ]) assert.throws(() => quoteAiMediaCredits(input));
});

test("Google films reject a third clip and Grok includes each input photo", () => {
  assert.equal(quoteAiMediaCredits({ kind: "video", videoEngine: "omni", durationSeconds: 20 }).totalCredits, 200);
  assert.throws(() => quoteAiMediaCredits({ kind: "video", videoEngine: "omni", durationSeconds: 24 }), /duration_invalid/);
  assert.equal(quoteAiMediaCredits({ kind: "video", videoEngine: "grok-lite", durationSeconds: 5, inspirationImagesCount: 1 }).totalCredits, 16);
  assert.equal(estimateAiMediaVideoSupplierCostMicroUsd({ kind: "video", videoEngine: "grok-lite", durationSeconds: 5, inspirationImagesCount: 1 }), 160_000);
});

test("every accepted duration resolves to one or two real provider clips without silently changing the film duration", () => {
  for (const model of AI_MEDIA_VIDEO_MODELS) for (const resolution of model.resolutions) {
    for (const mode of ["single", "multi"] as const) for (let duration = 1; duration <= 31; duration += 1) {
      const allowed = getAiMediaVideoDurations(model.id, resolution, mode).includes(duration);
      assert.equal(canGenerateAiMediaVideoDuration(model.id, duration, resolution, mode), allowed);
      if (!allowed) continue;
      const segments = getAiMediaVideoSegmentDurations(duration, model.id, resolution, mode);
      assert.ok(segments.length <= 2);
      assert.equal(segments.reduce((sum, value) => sum + value, 0), duration);
      assert.ok(segments.every((value) => value >= 4 && model.durationsSeconds.includes(value)));
      if (mode === "multi") assert.equal(segments.length, 2);
    }
  }
  assert.deepEqual(getAiMediaVideoSegmentDurations(11, "omni"), [6, 5]);
  assert.deepEqual(getAiMediaVideoSegmentDurations(30, "grok-lite"), [15, 15]);
  assert.deepEqual(getAiMediaVideoSegmentDurations(30, "wan3"), [30]);
  assert.deepEqual(getAiMediaVideoSegmentDurations(30, "wan3", "720p", "multi"), [15, 15]);
  assert.equal(canGenerateAiMediaVideoDuration("veo", 15), false);
  assert.equal(canGenerateAiMediaVideoDuration("omni", 7, "720p", "multi"), false);
});

test("Grok quotations include every transmitted photo for independent and connected two-clip films", () => {
  const film = { kind: "video", videoEngine: "grok-lite", durationSeconds: 30 };
  assert.equal(quoteAiMediaCredits(film).totalCredits, 91);
  assert.equal(estimateAiMediaVideoSupplierCostMicroUsd(film), 910_000);
  assert.equal(quoteAiMediaCredits({ ...film, sceneMode: "multi" }).totalCredits, 90);
  assert.equal(quoteAiMediaCredits({ ...film, inspirationImagesCount: 1 }).totalCredits, 92);
  assert.equal(quoteAiMediaCredits({ ...film, inspirationImagesCount: 3, inputMode: "essential", sceneMode: "multi" }).totalCredits, 105);
  assert.equal(quoteAiMediaCredits({ ...film, sceneMode: "multi" }).sceneMode, "multi");
});

test("approved team portraits are priced as one composed video reference and retain image quote costs", () => {
  const group = { kind: "video", videoEngine: "grok-lite", durationSeconds: 5, inspirationImagesCount: 3, identityMode: "reference_team" };
  assert.equal(quoteAiMediaCredits(group).totalCredits, 29);
  assert.deepEqual(quoteAiMediaCredits(group).breakdown.map((item) => item.credits), [15, 13, 1]);
  assert.equal(estimateAiMediaVideoSupplierCostMicroUsd(group), 160_000);
  assert.equal(quoteAiMediaCredits({ ...group, kind: "image" }).totalCredits, 13);
  assert.equal(quoteAiMediaCredits({ ...group, identityMode: "auto", inputMode: "essential" }).totalCredits, 29);
});

test("Libre video includes creative preparation and replaces it with the first-frame package when references are added", () => {
  const freeVideo = { kind: "video", videoEngine: "grok-lite", durationSeconds: 5, creationMode: "free", inputMode: "essential" };
  const noReferences = quoteAiMediaCredits(freeVideo);
  assert.equal(noReferences.totalCredits, 22);
  assert.deepEqual(noReferences.breakdown.map((item) => [item.key, item.credits]), [["video", 15], ["preparation", 7]]);
  assert.equal(noReferences.breakdown[1].label, "Préparation créative");
  const withReferences = quoteAiMediaCredits({ ...freeVideo, inspirationImagesCount: 3 });
  assert.equal(withReferences.totalCredits, 29);
  assert.deepEqual(withReferences.breakdown.map((item) => [item.key, item.credits]), [["video", 15], ["preparation", 13], ["references", 1]]);
  assert.equal(quoteAiMediaCredits({ ...freeVideo, kind: "image" }).totalCredits, 7);
  assert.equal(quoteAiMediaCredits({ ...freeVideo, creationMode: "guided" }).totalCredits, 15);
  assert.equal(estimateAiMediaVideoSupplierCostMicroUsd(freeVideo), 150_000);
});
