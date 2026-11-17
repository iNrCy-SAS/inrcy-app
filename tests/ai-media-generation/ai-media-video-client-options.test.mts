import assert from "node:assert/strict";
import test from "node:test";
import { getAutomaticMediaVideoDurationOptions, getMediaVideoDurationChoices, getCompatibleMediaVideoResolution, getMediaVideoEngineQualityChoices, getMediaVideoContextResolution, isMediaVideoQualityCompatible, getAiMediaVideoReferenceCompatibilityIssue, isMediaVideoBriefCompatible } from "../../lib/aiMediaVideoClientOptions.ts";
import { AI_MEDIA_VIDEO_MODELS, AI_MEDIA_AVAILABLE_VIDEO_MODELS, getAiMediaVideoModel, AI_MEDIA_MAX_VIDEO_CREDITS_PER_SECOND, getAiMediaVideoCreditRate, getAiMediaVideoNativeAudio, getAiMediaVideoCreditRateLimitIssue, getAiMediaVideoNativeDurations, restoreAiMediaVideoPreference, isAiMediaVideoEngineAvailable } from "../../lib/aiMediaModelCatalog.ts";
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
    const supported = [...new Set(getAiMediaVideoDurationSceneOptions(model.id, resolution).map((option) => option.durationSeconds))].filter(duration => model.transport !== "heygen-direct" || duration >= 5);
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
  assert.equal(choices.length, AI_MEDIA_AVAILABLE_VIDEO_MODELS.reduce((total, model) => total + model.resolutions.filter(resolution => !getAiMediaVideoCreditRateLimitIssue(model.id, resolution)).length, 0));
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
    for (const resolution of model.resolutions.filter(resolution => !getAiMediaVideoCreditRateLimitIssue(model.id, resolution))) {
      assert.deepEqual(restoreAiMediaVideoPreference(model.id, resolution), { videoEngine: model.id, videoResolution: resolution });
    }
  }
});

test("the Wan Flash brief limit cannot be bypassed by choosing another resolution", () => {
  assert.equal(isMediaVideoBriefCompatible("wan-flash", "a".repeat(1500)), true);
  assert.equal(isMediaVideoBriefCompatible("wan-flash", "a".repeat(1501)), false);
  assert.equal(isMediaVideoBriefCompatible("wan3", "a".repeat(4000)), true);
});

test("the sixteen-credit ceiling uses effective audio tariffs and leaves historical prices intact", () => {
  assert.equal(AI_MEDIA_MAX_VIDEO_CREDITS_PER_SECOND, 16);
  for (const hasProvidedVoice of [false, true]) for (const audio of [{}, { teamVideoSpeechMode: "characters" }, { teamVideoSpeechMode: "voiceover", withNarration: true }, { teamVideoSpeechMode: "characters", spokenScript: "" }]) {
    const choices = getMediaVideoEngineQualityChoices(hasProvidedVoice, audio);
    assert.ok(choices.length > 0);
    for (const choice of choices) {
      const input = { ...audio, hasProvidedCharacterVoice: hasProvidedVoice };
      assert.ok(choice.creditsPerSecond <= 16, choice.value);
      assert.equal(choice.creditsPerSecond, getAiMediaVideoCreditRate(choice.engine, choice.resolution, input));
      assert.equal(getAiMediaVideoCreditRateLimitIssue(choice.engine, choice.resolution, input), null);
    }
    assert.equal(choices.some(choice => choice.value === "kling:720p"), true);
    assert.equal(choices.some(choice => choice.value === "kling:1080p" || choice.value === "grok:1080p"), false);
  }
  assert.equal(getAiMediaVideoCreditRateLimitIssue("kling", "720p"), null, "exactly sixteen remains available");
  assert.equal(getAiMediaVideoCreditRateLimitIssue("heygen-avatar", "1080p"), null);
  assert.equal(getAiMediaVideoCreditRateLimitIssue("veo", "1080p", { teamVideoSpeechMode: "characters" }), null, "fifteen remains available");
  assert.equal(getAiMediaVideoCreditRateLimitIssue("wan27", "1080p", { hasProvidedCharacterVoice: true }), null);
  assert.equal(getMediaVideoEngineQualityChoices(false, { teamVideoSpeechMode: "voiceover" }).find(choice => choice.value === "veo:1080p")?.creditsPerSecond, 10, "silent provider audio uses its actual rate");
  assert.equal(getAiMediaVideoCreditRateLimitIssue("heygen", "1080p"), null);
  assert.equal(getAiMediaVideoCreditRateLimitIssue("heygen", "1080p", { hasProvidedCharacterVoice: true })?.code, "AI_MEDIA_VIDEO_CREDIT_RATE_LIMIT", "a supplied voice selects the distinct effective tariff");
  assert.equal(getAiMediaVideoModel("kling").creditsByResolution["1080p"], 24, "historical metadata and wholesale pricing are unchanged");
  assert.equal(isAiMediaVideoEngineAvailable("kling"), true);
  assert.deepEqual(restoreAiMediaVideoPreference("kling", "720p"), { videoEngine: "kling", videoResolution: "720p" });
  assert.deepEqual(restoreAiMediaVideoPreference("heygen-avatar", "1080p"), { videoEngine: "heygen-avatar", videoResolution: "1080p" });
  assert.deepEqual(restoreAiMediaVideoPreference("grok", "1080p"), { videoEngine: "grok", videoResolution: "720p" });
  assert.deepEqual(restoreAiMediaVideoPreference("wan27", "1080p"), { videoEngine: "wan27", videoResolution: "1080p" });
});
test("direct media compatibility checks every original photo and keeps supported prompt-only models available", () => {
  const issue = getAiMediaVideoReferenceCompatibilityIssue;
  for (const engine of ["omni", "kling-flash", "heygen-avatar", "grok-lite"] as const) assert.equal(issue(engine), null);
  for (const engine of ["wan-flash", "wan27"] as const) assert.equal(issue(engine)?.code, "AI_MEDIA_VIDEO_PHOTO_REQUIRED");
  for (const model of AI_MEDIA_AVAILABLE_VIDEO_MODELS) {
    const count = Math.min(5, model.maxReferenceImages);
    assert.equal(issue(model.id, { inspirationImagesCount: count }), null, `${model.id}: original photos at its actual capacity`);
    assert.equal(issue(model.id, { inspirationImagesCount: model.maxReferenceImages + 1 })?.code, "AI_MEDIA_VIDEO_REFERENCE_LIMIT");
  }
  for (const engine of ["wan-flash", "veo-lite", "grok-lite"] as const) {
    assert.equal(issue(engine, { inspirationImagesCount: 2 })?.code, "AI_MEDIA_VIDEO_REFERENCE_LIMIT", "AI voices cannot make two original photos fit a single-photo protocol");
  }
  for (const count of [-1, 1.5, NaN, Infinity]) assert.equal(issue("omni", { inspirationImagesCount: count })?.code, "AI_MEDIA_VIDEO_REFERENCE_COUNT_INVALID");
  assert.equal(issue("omni", { inspirationImagesCount: 1, hasProvidedCharacterVoice: true })?.code, "AI_MEDIA_VIDEO_VOICE_ENGINE_UNSUPPORTED");
  assert.equal(issue("kling-flash", { inspirationImagesCount: 1, providedCharacterVoicesCount: 1 })?.code, "AI_MEDIA_VIDEO_VOICE_ENGINE_UNSUPPORTED");
  for (const engine of ["wan27", "kling", "heygen-avatar"] as const) {
    assert.equal(issue(engine, { inspirationImagesCount: 3, hasProvidedCharacterVoice: true, providedCharacterVoicesCount: 3 }), null);
    assert.equal(issue(engine, { inspirationImagesCount: 4, hasProvidedCharacterVoice: true, providedCharacterVoicesCount: 4 })?.code, "AI_MEDIA_VIDEO_CHARACTER_VOICE_COUNT_INVALID");
    assert.equal(issue(engine, { inspirationImagesCount: 2, providedCharacterVoicesCount: 3 })?.code, "AI_MEDIA_VIDEO_CHARACTER_VOICE_COUNT_INVALID");
  }
});

test("free AI voice-over uses native Veo audio while supplied narrators and guided flows retain their distinct rates", () => {
  for (const engine of ["veo", "veo-lite"] as const) {
    const ai = { creationMode: "free", teamVideoSpeechMode: "voiceover", withNarration: true, narrationVoiceMode: "ai" };
    const provided = { ...ai, narrationVoiceMode: "provided" };
    assert.equal(getAiMediaVideoNativeAudio(engine, ai), true);
    assert.equal(getAiMediaVideoNativeAudio(engine, { ...ai, spokenScript: "Bienvenue dans notre atelier." }), true);
    assert.equal(getAiMediaVideoNativeAudio(engine, provided), false);
    assert.equal(getAiMediaVideoNativeAudio(engine, { ...ai, spokenScript: "" }), false);
    assert.equal(getAiMediaVideoNativeAudio(engine, { ...ai, withNarration: false }), false);
    assert.equal(getAiMediaVideoNativeAudio(engine, { ...ai, creationMode: "guided" }), false);
    assert.equal(getAiMediaVideoNativeAudio(engine, { ...provided, teamVideoSpeechMode: "characters", withNarration: false }), true);
    const model = getAiMediaVideoModel(engine);
    const aiRate = getMediaVideoEngineQualityChoices(false, ai).find(choice => choice.engine === engine && choice.resolution === "720p")!.creditsPerSecond;
    const providedRate = getMediaVideoEngineQualityChoices(false, provided).find(choice => choice.engine === engine && choice.resolution === "720p")!.creditsPerSecond;
    assert.equal(aiRate, model.creditsByResolution["720p"]);
    assert.equal(providedRate, model.silentCreditsByResolution!["720p"]);
  }
});

test("HeyGen client duration choices start at five seconds without rewriting historical Avatar IV metadata", () => {
  const options = getAutomaticMediaVideoDurationOptions("heygen-avatar", "1080p");
  assert.equal(options.some(option => option.durationSeconds === 4), false);
  assert.equal(options[0].durationSeconds, 5);
  assert.equal(options.at(-1)?.durationSeconds, 30);
  assert.ok(getAiMediaVideoNativeDurations("heygen-avatar", "1080p").includes(4));
});

test("HeyGen cinematic narrow canvases offer 720p while speaking character photos retain Avatar IV 1080p", () => {
  for (const format of ["story", "landscape", "square", "portrait"]) for (const hasCharacterReferences of [false, true]) for (const teamVideoSpeechMode of ["voiceover", "characters"] as const) {
    const context = { format, hasCharacterReferences, teamVideoSpeechMode };
    const allowed = format === "story" || format === "landscape" || hasCharacterReferences && teamVideoSpeechMode === "characters";
    assert.equal(isMediaVideoQualityCompatible("heygen-avatar", "1080p", context), allowed, JSON.stringify(context));
    assert.equal(getMediaVideoContextResolution("heygen-avatar", "1080p", context), allowed ? "1080p" : "720p");
    const choices = getMediaVideoEngineQualityChoices(false, { teamVideoSpeechMode }, { format, hasCharacterReferences });
    assert.equal(choices.some(choice => choice.value === "heygen-avatar:1080p"), allowed);
    assert.equal(choices.some(choice => choice.value === "heygen-avatar:720p"), true);
    assert.ok(choices.every(choice => choice.creditsPerSecond <= 16));
  }
  assert.equal(isMediaVideoQualityCompatible("kling", "720p", { format: "square" }), true);
});
test("Veo multiple original photos require every native segment to be eight seconds", () => {
  for (const inspirationImagesCount of [2, 3]) for (const videoResolution of ["720p", "1080p"]) {
    for (const [durationSeconds, sceneMode, valid] of [[5, "single", false], [8, "single", true], [8, "multi", false], [10, "single", false], [10, "multi", false], [14, "single", false], [16, "single", true], [16, "multi", true]] as const) {
      const issue = getAiMediaVideoReferenceCompatibilityIssue("veo", { inspirationImagesCount, durationSeconds, videoResolution, sceneMode });
      assert.equal(issue?.code ?? null, valid ? null : "AI_MEDIA_VIDEO_REFERENCE_DURATION_UNSUPPORTED", JSON.stringify({ inspirationImagesCount, durationSeconds, videoResolution, sceneMode }));
    }
  }
  assert.equal(getAiMediaVideoReferenceCompatibilityIssue("veo", { inspirationImagesCount: 1, durationSeconds: 4, videoResolution: "720p" }), null);
  assert.equal(getAiMediaVideoReferenceCompatibilityIssue("veo", { inspirationImagesCount: 2 }), null, "unknown duration remains a capability-only query");
});