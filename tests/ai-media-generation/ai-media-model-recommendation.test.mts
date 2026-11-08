import assert from "node:assert/strict";
import test from "node:test";
import { recommendAiMediaModel, type AiMediaModelRecommendationInput } from "../../lib/aiMediaModelRecommendation.ts";
import { AI_MEDIA_AVAILABLE_VIDEO_MODELS, getAiMediaVideoModel } from "../../lib/aiMediaModelCatalog.ts";
import { quoteAiMediaCredits, estimateAiMediaVideoSupplierCostMicroUsd } from "../../lib/aiMediaCreditsPricing.ts";
import { getAiMediaVideoSegmentDurations } from "../../lib/aiMediaVideoTimeline.ts";
import * as catalog from "../../lib/aiMediaModelCatalog.ts";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

const nativeFetch = globalThis.fetch;
test.before(() => { globalThis.fetch = async () => { throw new Error("Recommendations must not call a provider"); }; });
test.after(() => { globalThis.fetch = nativeFetch; });

test("French speech uses available compatible prices without promoting retired dialogue claims or changing duration", () => {
  for (const durationSeconds of [4, 15, 30]) {
    for (const speech of [{ withNarration: true }, { teamVideoSpeechMode: "characters" as const }, { brief: "Le personnage parle en français." }]) {
      const input = Object.freeze({ kind: "video" as const, durationSeconds, language: "fr-FR", ...speech });
      const result = recommendAiMediaModel(input);
      assert.ok(result);
      assert.equal(result.reason, "economy");
      assert.ok(AI_MEDIA_AVAILABLE_VIDEO_MODELS.some(model => model.id === result.engine));
      assert.notEqual(result.engine, "minimax-h3");
      const selected = getAiMediaVideoModel(result.engine);
      assert.doesNotThrow(() => quoteAiMediaCredits({ ...input, videoEngine: selected.id, videoResolution: selected.defaultResolution }));
      const costs = AI_MEDIA_AVAILABLE_VIDEO_MODELS.flatMap(model => {
        try { return [estimateAiMediaVideoSupplierCostMicroUsd({ ...input, videoEngine: model.id, videoResolution: model.defaultResolution })]; }
        catch { return []; }
      });
      assert.equal(estimateAiMediaVideoSupplierCostMicroUsd({ ...input, videoEngine: selected.id, videoResolution: selected.defaultResolution }), Math.min(...costs));
      assert.equal(input.durationSeconds, durationSeconds);
    }
  }
  assert.notEqual(recommendAiMediaModel({ kind: "video", durationSeconds: 8, withNarration: true, language: "FR" })?.engine, "minimax-h3");
  assert.equal(getAiMediaVideoModel("minimax-h3").frenchDialogue, "supported", "historical metadata is preserved without implying present availability");
  assert.equal(catalog.isAiMediaVideoEngineAvailable("minimax-h3"), false);
});

test("Studio free separate voice-over without references suggests compatible Grok Lite720 without changing selection or duration", () => {
  for (const durationSeconds of [4, 10, 15, 30]) {
    const input = Object.freeze({ recommendationContext: "studio-free" as const, kind: "video" as const,
      operation: "generate" as const, durationSeconds, sceneMode: durationSeconds === 30 ? "multi" as const : "single" as const,
      withNarration: true, teamVideoSpeechMode: "voiceover" as const, language: "fr-FR", inspirationImagesCount: 0,
      videoEngine: "minimax-h3", videoResolution: "768p" });
    const result = recommendAiMediaModel(input);
    assert.ok(result);
    assert.deepEqual(result, { engine: "grok-lite", reason: "economy" });
    const model = getAiMediaVideoModel(result.engine);
    assert.ok(AI_MEDIA_AVAILABLE_VIDEO_MODELS.some(candidate => candidate.id === model.id));
    assert.equal(model.defaultResolution, "720p");
    assert.doesNotThrow(() => quoteAiMediaCredits({ ...input, videoEngine: model.id, videoResolution: model.defaultResolution }));
    assert.equal(input.videoEngine, "minimax-h3"); assert.equal(input.videoResolution, "768p");
    assert.equal(input.durationSeconds, durationSeconds);
  }
});

test("the quick Studio voice-over suggestion does not override other flow and reference compatibility policies", () => {
  const legacy = { kind: "video" as const, durationSeconds: 10, withNarration: true,
    teamVideoSpeechMode: "voiceover" as const, language: "fr", inspirationImagesCount: 0 };
  assert.deepEqual(recommendAiMediaModel(legacy), { engine: "veo-lite", reason: "economy" });
  for (const patch of [{ teamVideoSpeechMode: "characters" as const }, { inspirationImagesCount: 1 }, { operation: "modify" as const }]) {
    assert.deepEqual(recommendAiMediaModel({ ...legacy, recommendationContext: "studio-free", ...patch }), recommendAiMediaModel({ ...legacy, ...patch }));
  }
  assert.equal(recommendAiMediaModel({ ...legacy, recommendationContext: "studio-free", durationSeconds: 31 }), null);
  assert.equal(recommendAiMediaModel({ ...legacy, recommendationContext: "studio-free", sceneMode: "multi", durationSeconds: 7 }), null);
});

test("an unavailable Grok Lite cannot become the Studio recommendation", () => {
  const { recommendAiMediaModel: recommendWithoutGrokLite } = runtimeModules({
    "./aiMediaModelCatalog.ts": { ...catalog, AI_MEDIA_AVAILABLE_VIDEO_MODELS: catalog.AI_MEDIA_AVAILABLE_VIDEO_MODELS.filter(model => model.id !== "grok-lite") },
  })<typeof import("../../lib/aiMediaModelRecommendation.ts")>("lib/aiMediaModelRecommendation.ts");
  assert.deepEqual(recommendWithoutGrokLite({ recommendationContext: "studio-free", kind: "video", durationSeconds: 10,
    withNarration: true, teamVideoSpeechMode: "voiceover", language: "fr", inspirationImagesCount: 0 }),
  { engine: "veo-lite", reason: "economy" });
});

test("a silent brief or another spoken language does not claim French dialogue suitability", () => {
  for (const brief of ["Un paysage sans voix ni narration.", "Une promenade sans dialogue.", "The character speaks in English."]) {
    assert.deepEqual(recommendAiMediaModel({ kind: "video", durationSeconds: 8, brief }), { engine: "grok-lite", reason: "economy" });
  }
  const input = Object.freeze({ kind: "video" as const, durationSeconds: 8, withNarration: true, language: "en-US" });
  const result = recommendAiMediaModel(input);
  assert.ok(result);
  assert.equal(result.reason, "economy", "une voix anglaise ne justifie pas la recommandation dialogue français");
  const compatibleCosts = AI_MEDIA_AVAILABLE_VIDEO_MODELS.flatMap(model => {
    try { return [estimateAiMediaVideoSupplierCostMicroUsd({ ...input, videoEngine: model.id, videoResolution: model.defaultResolution })]; }
    catch { return []; }
  });
  const selected = getAiMediaVideoModel(result.engine);
  assert.equal(estimateAiMediaVideoSupplierCostMicroUsd({ ...input, videoEngine: result.engine, videoResolution: selected.defaultResolution }), Math.min(...compatibleCosts), "la suggestion suit le coût actuel, y compris Veo sans audio avec voix off séparée");
});

test("retired native Wan3 metadata cannot become a new long-film recommendation", () => {
  for (const durationSeconds of [16, 20, 24, 30]) {
    const result = recommendAiMediaModel({ kind: "video", durationSeconds, sceneMode: "single" });
    assert.deepEqual(result, { engine: "grok-lite", reason: "economy" });
    assert.ok(AI_MEDIA_AVAILABLE_VIDEO_MODELS.some(model => model.id === result?.engine));
    assert.deepEqual(getAiMediaVideoSegmentDurations(durationSeconds, "wan3"), [durationSeconds]);
  }
  assert.deepEqual(recommendAiMediaModel({ kind: "video", durationSeconds: 30, sceneMode: "multi" }), { engine: "grok-lite", reason: "economy" });
});

test("photo animation requires a supplied compatible reference, with the same first-frame composition as billing", () => {
  assert.deepEqual(recommendAiMediaModel({ kind: "video", durationSeconds: 8, inspirationImagesCount: 1 }), { engine: "wan-flash", reason: "photo-animation" });
  assert.deepEqual(recommendAiMediaModel({ kind: "video", durationSeconds: 8, inspirationImagesCount: 0, brief: "Animer une photo" }), { engine: "grok-lite", reason: "economy" });
  assert.deepEqual(recommendAiMediaModel({ kind: "video", durationSeconds: 8, inspirationImagesCount: 3, inputMode: "essential" }), { engine: "wan-flash", reason: "photo-animation" });
  assert.deepEqual(recommendAiMediaModel({ kind: "video", durationSeconds: 8, inspirationImagesCount: 3, identityMode: "reference_team" }), { engine: "wan-flash", reason: "photo-animation" });
  // Legacy references are sent separately; Wan/Grok Lite cannot accept three.
  const legacy = { kind: "video" as const, durationSeconds: 8, inspirationImagesCount: 3, inputMode: "legacy" as const };
  const result = recommendAiMediaModel(legacy)!;
  assert.equal(result.reason, "economy");
  assert.ok(AI_MEDIA_AVAILABLE_VIDEO_MODELS.some(model => model.id === result.engine));
  const selected = getAiMediaVideoModel(result.engine);
  assert.doesNotThrow(() => quoteAiMediaCredits({ ...legacy, videoEngine: selected.id, videoResolution: selected.defaultResolution }));
  assert.notEqual(result.engine, "minimax-h3");
});

test("economic suggestions use the current catalogue price among compatible models, not a fixed engine", () => {
  const input = { kind: "video" as const, durationSeconds: 15, sceneMode: "multi" as const, inspirationImagesCount: 0 };
  const result = recommendAiMediaModel(input)!;
  assert.equal(result.reason, "economy");
  const costs = AI_MEDIA_AVAILABLE_VIDEO_MODELS.flatMap((model) => {
    try { return [estimateAiMediaVideoSupplierCostMicroUsd({ ...input, videoEngine: model.id, videoResolution: model.defaultResolution })]; }
    catch { return []; }
  });
  const selected = getAiMediaVideoModel(result.engine);
  assert.equal(estimateAiMediaVideoSupplierCostMicroUsd({ ...input, videoEngine: result.engine, videoResolution: selected.defaultResolution }), Math.min(...costs));
});

test("an oversized photo brief cannot recommend Wan Flash beyond its native prompt limit", () => {
  const input = { kind: "video" as const, durationSeconds: 8, inspirationImagesCount: 1 };
  assert.deepEqual(recommendAiMediaModel({ ...input, brief: "a".repeat(1_500) }), { engine: "wan-flash", reason: "photo-animation" });
  const result = recommendAiMediaModel({ ...input, brief: "a".repeat(1_501) });
  assert.deepEqual(result, { engine: "grok-lite", reason: "economy" });
  assert.equal(result?.engine, "grok-lite");
});

test("every recommendation passes real quote and at most two exact native clips, including duration and reference boundaries", () => {
  for (const durationSeconds of Array.from({ length: 27 }, (_, index) => index + 4)) {
    for (const sceneMode of ["single", "multi"] as const) {
      for (const inspirationImagesCount of [0, 1, 3, 5]) {
        const input = { kind: "video" as const, durationSeconds, sceneMode, inspirationImagesCount };
        const result = recommendAiMediaModel(input);
        if (!result) { assert.equal(sceneMode, "multi"); assert.ok(durationSeconds < 8); continue; }
        const model = getAiMediaVideoModel(result.engine);
        assert.ok(!["heygen", "wan3", "minimax-h3"].includes(result.engine), "retired engines cannot return through automatic recommendations");
        assert.doesNotThrow(() => quoteAiMediaCredits({ ...input, videoEngine: result.engine, videoResolution: model.defaultResolution }));
        const durations = getAiMediaVideoSegmentDurations(durationSeconds, model.id, model.defaultResolution, sceneMode);
        assert.ok(durations.length <= 2);
        assert.equal(durations.reduce((total, value) => total + value, 0), durationSeconds);
      }
    }
  }
});

test("invalid duration, fractional references and impossible two-scene requests produce no suggestion", () => {
  for (const durationSeconds of [1, 2, 3, 31, 1.5, NaN, Infinity]) {
    assert.equal(recommendAiMediaModel({ kind: "video", durationSeconds }), null);
  }
  for (const inspirationImagesCount of [-1, 1.5, 6, Infinity]) {
    assert.equal(recommendAiMediaModel({ kind: "video", durationSeconds: 8, inspirationImagesCount }), null);
  }
  assert.equal(recommendAiMediaModel({ kind: "video", durationSeconds: 7, sceneMode: "multi", withNarration: true }), null);
  assert.equal(recommendAiMediaModel({ kind: "audio" } as unknown as AiMediaModelRecommendationInput), null);
});

test("image recommendations describe brief fit without implying a price difference", () => {
  for (const brief of ["Flyer pour la promotion", "Changer le texte de la photo", "Ajouter un prix exact et un slogan"]) {
    assert.deepEqual(recommendAiMediaModel({ kind: "image", brief }), { engine: "openai", reason: "precise-image" });
  }
  for (const brief of ["Photo de cuisine", "Sans texte ni logo, un paysage", "Modifier la couleur du mur"]) {
    assert.deepEqual(recommendAiMediaModel({ kind: "image", brief }), { engine: "gemini", reason: "image-creation" });
  }
  assert.equal(quoteAiMediaCredits({ kind: "image", imageEngine: "openai" }).totalCredits, quoteAiMediaCredits({ kind: "image", imageEngine: "gemini" }).totalCredits);
});

test("new image suggestions respect reference and operation capabilities without changing the selected engine", () => {
  assert.equal(recommendAiMediaModel({kind:"image",brief:"Illustration graphique d'une boutique"})?.engine,"recraft");
  assert.equal(recommendAiMediaModel({kind:"image",brief:"Packshot produit avec couleurs de marque",inspirationImagesCount:2})?.engine,"flux");
  assert.equal(recommendAiMediaModel({kind:"image",brief:"Une image économique",inspirationImagesCount:3})?.engine,"grok");
  assert.equal(recommendAiMediaModel({kind:"image",brief:"Une image économique",inspirationImagesCount:4})?.engine,"gemini");
  assert.equal(recommendAiMediaModel({kind:"image",operation:"modify",brief:"Illustration graphique",inspirationImagesCount:1})?.engine,"gemini");
  assert.equal(recommendAiMediaModel({kind:"image",operation:"modify",inspirationImagesCount:0}),null);
});
