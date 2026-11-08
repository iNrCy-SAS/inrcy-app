import assert from "node:assert/strict";
import test from "node:test";
import { getAutomaticMediaVideoDurationOptions, getMediaVideoDurationChoices, getCompatibleMediaVideoResolution, getMediaVideoEngineQualityChoices, isMediaVideoBriefCompatible } from "../../lib/aiMediaVideoClientOptions.ts";
import { AI_MEDIA_VIDEO_MODELS, AI_MEDIA_AVAILABLE_VIDEO_MODELS, getAiMediaVideoModel, getAiMediaVideoNativeDurations, restoreAiMediaVideoPreference, isAiMediaVideoEngineAvailable } from "../../lib/aiMediaModelCatalog.ts";
import { getAiMediaVideoDurationSceneOptions, getAiMediaVideoSegmentDurations } from "../../lib/aiMediaVideoTimeline.ts";

test("the professional chooses the entire four-to-thirty-second range before choosing an engine", () => {
  assert.deepEqual(getMediaVideoDurationChoices(), Array.from({ length: 27 }, (_, index) => index + 4));
  assert.deepEqual(getMediaVideoDurationChoices(8), [4, 5, 6, 7, 8]);
  assert.equal(getMediaVideoDurationChoices(60).at(-1), 30);
  assert.deepEqual(getMediaVideoDurationChoices(3), []);
});

test("engine selection preserves the duration and uses a compatible native resolution", () => {
  assert.equal(getCompatibleMediaVideoResolution("omni", 20, "720p"), "720p");
  assert.equal(getCompatibleMediaVideoResolution("omni", 21, "720p"), null);
  assert.equal(getCompatibleMediaVideoResolution("veo", 10, "1080p"), "720p");
  assert.equal(getCompatibleMediaVideoResolution("veo", 17, "720p"), null);
  assert.equal(getCompatibleMediaVideoResolution("minimax-h3", 25, "720p"), "768p");
  assert.equal(getCompatibleMediaVideoResolution("wan3", 30, "1080p"), "1080p");
  assert.equal(getCompatibleMediaVideoResolution("wan27", 20, "1080p"), "1080p");
  assert.equal(getCompatibleMediaVideoResolution("wan27", 21, "720p"), null);
});

test("two-scene choices require two clips of at least four seconds", () => {
  for (const engine of ["omni", "veo", "minimax-h3", "wan27", "wan3", "grok-lite"] as const) {
    assert.equal(getCompatibleMediaVideoResolution(engine, 7, "720p", "multi"), null);
    assert.ok(getCompatibleMediaVideoResolution(engine, 8, "720p", "multi"));
  }
});

test("automatic Studio duration keeps every supported length and prefers a single native clip", () => {
  for (const model of AI_MEDIA_AVAILABLE_VIDEO_MODELS) for (const resolution of model.resolutions) {
    const options = getAutomaticMediaVideoDurationOptions(model.id, resolution);
    const native = getAiMediaVideoNativeDurations(model.id, resolution);
    const supported = [...new Set(getAiMediaVideoDurationSceneOptions(model.id, resolution).map((option) => option.durationSeconds))];
    assert.deepEqual(options.map((option) => option.durationSeconds), supported, `${model.id}/${resolution}: no duration disappears`);
    for (const option of options) {
      const segments = getAiMediaVideoSegmentDurations(option.durationSeconds, model.id, resolution, option.sceneMode);
      assert.equal(option.sceneMode, native.includes(option.durationSeconds) ? "single" : "multi");
      assert.equal(segments.length, native.includes(option.durationSeconds) ? 1 : 2);
      assert.equal(segments.reduce((total, duration) => total + duration, 0), option.durationSeconds);
    }
  }
  assert.deepEqual(getAutomaticMediaVideoDurationOptions("wan3", "1080p").find((option) => option.durationSeconds === 30), { durationSeconds: 30, sceneMode: "single", sceneCount: 1 });
  assert.deepEqual(getAutomaticMediaVideoDurationOptions("minimax-h3", "768p").find((option) => option.durationSeconds === 30), { durationSeconds: 30, sceneMode: "multi", sceneCount: 2 });
});

test("the single dropdown contains only real engine/resolution pairs and their exact credit rates", () => {
  const choices = getMediaVideoEngineQualityChoices();
  assert.equal(choices.length, AI_MEDIA_AVAILABLE_VIDEO_MODELS.reduce((total, model) => total + model.resolutions.length, 0));
  assert.equal(new Set(choices.map((choice) => choice.value)).size, choices.length);
  for (const choice of choices) {
    const model = getAiMediaVideoModel(choice.engine);
    assert.ok(model.resolutions.includes(choice.resolution));
    assert.equal(choice.creditsPerSecond, model.creditsByResolution[choice.resolution]);
  }
  assert.deepEqual(choices.filter((choice) => choice.engine === "omni").map((choice) => choice.resolution), ["720p"]);
  assert.deepEqual(choices.filter((choice) => choice.engine === "minimax-h3"), []);
  assert.deepEqual(choices.filter((choice) => choice.engine === "grok-lite").map((choice) => choice.creditsPerSecond), [3, 14]);
  assert.deepEqual(choices.filter((choice) => choice.engine === "wan27").map((choice) => ({
    resolution: choice.resolution, creditsPerSecond: choice.creditsPerSecond,
  })), [
    { resolution: "720p", creditsPerSecond: 10 },
    { resolution: "1080p", creditsPerSecond: 15 },
  ]);
  assert.deepEqual(choices.filter((choice) => choice.engine === "heygen"), []);
  assert.deepEqual(getMediaVideoEngineQualityChoices(true).filter((choice) => choice.engine === "heygen"), []);
});

test("retired HeyGen and Wan3 remain in historical records but stored selections restore to an available model", () => {
  assert.ok(AI_MEDIA_VIDEO_MODELS.some((model) => model.id === "heygen"));
  assert.equal(getAiMediaVideoModel("heygen").modelId, "heygen/heygen-video-1");
  assert.equal(isAiMediaVideoEngineAvailable("heygen"), false);
  assert.ok(!AI_MEDIA_AVAILABLE_VIDEO_MODELS.some((model) => model.id === "heygen"));
  assert.deepEqual(restoreAiMediaVideoPreference("heygen", "768p"), { videoEngine: "omni", videoResolution: "720p" });
  assert.deepEqual(restoreAiMediaVideoPreference("wan3", "1080p"), { videoEngine: "omni", videoResolution: "720p" });
  assert.equal(getAiMediaVideoModel("wan3").modelId, "alibaba/wan-v3.0-video");
  assert.equal(isAiMediaVideoEngineAvailable("wan3"), false);
  for (const provided of [false, true]) assert.equal(getMediaVideoEngineQualityChoices(provided).some(choice => choice.engine === "wan3"), false);
  for (const model of AI_MEDIA_AVAILABLE_VIDEO_MODELS) {
    assert.equal(isAiMediaVideoEngineAvailable(model.id), true);
    for (const resolution of model.resolutions) {
      assert.deepEqual(restoreAiMediaVideoPreference(model.id, resolution), { videoEngine: model.id, videoResolution: resolution });
    }
  }
});

test("the Wan Flash brief limit cannot be bypassed by choosing another resolution", () => {
  assert.equal(isMediaVideoBriefCompatible("wan-flash", "a".repeat(1500)), true);
  assert.equal(isMediaVideoBriefCompatible("wan-flash", "a".repeat(1501)), false);
  assert.equal(isMediaVideoBriefCompatible("wan3", "a".repeat(4000)), true);
});
