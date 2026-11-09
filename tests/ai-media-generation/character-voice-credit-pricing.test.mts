import assert from "node:assert/strict";
import test from "node:test";
import * as pricing from "../../lib/aiMediaCreditsPricing.ts";
import * as models from "../../lib/aiMediaModelCatalog.ts";
import { getMediaVideoEngineQualityChoices } from "../../lib/aiMediaVideoClientOptions.ts";
import { normalizeAiMediaGenerationRequest } from "../../lib/aiMediaGenerationContracts.ts";
import { load, sample } from "./character-voice-runtime-fixtures.mts";

const server = load<typeof import("../../lib/aiMediaCreditQuoteServer.ts")>("lib/aiMediaCreditQuoteServer.ts", {
  "./aiMediaCreditsPricing.ts": pricing,
  "./aiMediaModelCatalog.ts": models,
});
const voiceInput = { kind: "video", creationMode: "free", inputMode: "essential", teamVideoSpeechMode: "characters", durationSeconds: 8, inspirationImagesCount: 2, hasProvidedCharacterVoice: true };

test("Kling quotes original photo references and supplied voices at its own tariff, never a composed master frame", () => {
  const input = { ...voiceInput, videoEngine: "kling", videoResolution: "720p", identityMode: "reference_team" };
  const quote = pricing.quoteAiMediaCredits(input);
  assert.equal(quote.totalCredits, 137); assert.equal(quote.engine, "kling");
  assert.equal(quote.breakdown.find(line => line.key === "preparation")?.credits, 7);
  assert.equal(pricing.estimateAiMediaVideoSupplierCostMicroUsd(input), 1_300_000);
  assert.equal(pricing.quoteAiMediaCredits({ ...input, videoResolution: "1080p" }).totalCredits, 201);
});

test("an unconfigured Kling key blocks the server quote before any generation reservation", () => {
  const previous = process.env.KLING_API_KEY; delete process.env.KLING_API_KEY;
  try { assert.throws(() => server.createAiMediaServerQuote("account-test", { ...voiceInput, videoEngine: "kling" }), /kling_credentials_missing/); }
  finally { if (previous !== undefined) process.env.KLING_API_KEY = previous; }
});

test("HeyGen supplied voices select its reference tariff and image capacity without modifying legacy I2V", () => {
  const base = models.getAiMediaVideoModel("heygen");
  const voiced = models.getAiMediaVideoModelForCharacterVoice("heygen", true);
  assert.equal(base.maxReferenceImages, 1); assert.deepEqual(base.creditsByResolution, { "768p": 4, "1080p": 10 });
  assert.equal(voiced.maxReferenceImages, 9); assert.deepEqual(voiced.creditsByResolution, { "768p": 10, "1080p": 18 });
  assert.deepEqual(voiced.pricingUsdPerSecond, { "768p": 0.1, "1080p": 0.18 });
  assert.equal(voiced.referenceInputCredits, 4); assert.equal(voiced.supplierReferenceCostMicroUsd, 40_000);
  assert.equal(models.getAiMediaVideoModelForCharacterVoice("heygen"), base);
  for (const engine of ["wan27", "wan3"]) assert.equal(models.getAiMediaVideoModelForCharacterVoice(engine, true), models.getAiMediaVideoModel(engine));
});

test("retired HeyGen tariffs remain absent from new engine choices with AI or supplied voices", () => {
  const rates = (voices: boolean) => getMediaVideoEngineQualityChoices(voices).filter((choice) => choice.engine === "heygen").map((choice) => choice.creditsPerSecond);
  assert.deepEqual(rates(false), []); assert.deepEqual(rates(true), []);
  for (const provided of [false, true]) {
    const choices = getMediaVideoEngineQualityChoices(provided);
    assert.deepEqual(choices.filter((choice) => choice.engine === "wan27").map((choice) => choice.creditsPerSecond), [10, 15]);
    assert.deepEqual(choices.filter((choice) => choice.engine === "wan3"), []);
  }
});

test("voice quotes preserve original references and charge only the free creative director, never a composed frame", () => {
  assert.equal(pricing.AI_MEDIA_CREDIT_TARIFF_VERSION, "inrstudio-media-credits-2026-11-v6");
  for (const videoEngine of ["wan27", "wan3", "heygen"]) {
    const quote = pricing.quoteAiMediaCredits({ ...voiceInput, videoEngine });
    assert.equal(quote.totalCredits, videoEngine === "heygen" ? 95 : 87);
    assert.deepEqual(quote.breakdown.filter((item) => item.key === "preparation").map((item) => [item.label, item.credits]), [["Préparation créative", 7]]);
    assert.equal(pricing.estimateAiMediaVideoSupplierCostMicroUsd({ ...voiceInput, videoEngine }), videoEngine === "heygen" ? 880_000 : 800_000);
  }
  assert.equal(pricing.quoteAiMediaCredits({ ...voiceInput, videoEngine: "heygen", videoResolution: "1080p" }).totalCredits, 159);
  assert.equal(pricing.estimateAiMediaVideoSupplierCostMicroUsd({ ...voiceInput, videoEngine: "heygen", videoResolution: "1080p" }), 1_520_000);
  assert.equal(pricing.quoteAiMediaCredits({ ...voiceInput, videoEngine: "heygen", hasProvidedCharacterVoice: false }).totalCredits, 47);
});

test("HeyGen's independent and connected voice clips include each original image per clip without a first-frame surcharge", () => {
  for (const sceneMode of ["single", "multi"]) {
    const quote = pricing.quoteAiMediaCredits({ ...voiceInput, videoEngine: "heygen", durationSeconds: 16, sceneMode });
    assert.equal(quote.totalCredits, 183);
    assert.deepEqual(quote.breakdown.map((item) => [item.key, item.credits]), [["video", 160], ["preparation", 7], ["references", 16]]);
    assert.equal(pricing.estimateAiMediaVideoSupplierCostMicroUsd({ ...voiceInput, videoEngine: "heygen", durationSeconds: 16, sceneMode }), 1_760_000);
  }
  assert.equal(pricing.quoteAiMediaCredits({ ...voiceInput, videoEngine: "wan3", durationSeconds: 20, sceneMode: "multi" }).totalCredits, 207);
  assert.throws(() => pricing.quoteAiMediaCredits({ ...voiceInput, videoEngine: "heygen", inspirationImagesCount: 0 }), /reference_required/);
  assert.throws(() => pricing.quoteAiMediaCredits({ ...voiceInput, videoEngine: "omni" }), /voice_engine_unsupported/);
  assert.throws(() => pricing.quoteAiMediaCredits({ ...voiceInput, kind: "image", videoEngine: "heygen" }), /voice_engine_unsupported/);
  assert.throws(() => pricing.quoteAiMediaCredits({ ...voiceInput, videoEngine: "heygen", hasProvidedCharacterVoice: "true" as unknown as boolean }), /voice_option_invalid/);
});

test("the generation server derives supplied voice from normalized references and rejects a stale quality quote", () => {
  const request = normalizeAiMediaGenerationRequest({ requestId: "wan27-provided-quote", source: "studio", creationMode: "free", kind: "video", freePrompt: 'La personne dit « Bonjour ! ».',
    videoEngine: "wan27", videoResolution: "720p", format: "story", durationSeconds: 8, teamVideoSpeechMode: "characters", identityConsent: true,
    inspirationImages: [{ mimeType: "image/webp", data: "A".repeat(64), role: "character", usage: "inspiration", characterIndex: 1, voiceMode: "provided", voiceSample: sample() }],
    hasProvidedCharacterVoice: false,
  });
  const quoteInputs: pricing.AiMediaCreditsQuoteInput[] = [];
  const checkedServer = load<typeof server>("lib/aiMediaCreditQuoteServer.ts", {
    "./aiMediaCreditsPricing.ts": { ...pricing, quoteAiMediaCredits: (input: pricing.AiMediaCreditsQuoteInput) => { quoteInputs.push(input); return pricing.quoteAiMediaCredits(input); } },
    "./aiMediaModelCatalog.ts": models,
  });
  const real = checkedServer.quoteAiMediaRequest("account-test", request);
  assert.equal(quoteInputs[0].hasProvidedCharacterVoice, true, "the server derives this flag from the normalized audio descriptors");
  assert.equal(real.totalCredits, 87);
  const stale = server.createAiMediaServerQuote("account-test", { ...request, videoResolution: "1080p", inspirationImagesCount: 1, hasProvidedCharacterVoice: false });
  assert.equal(stale.totalCredits, 127);
  assert.notEqual(stale.quoteId, real.quoteId);
  assert.equal(server.assertAiMediaCreditQuote({ ...request, expectedCredits: stale.totalCredits, creditTariffVersion: stale.tariffVersion, creditQuoteId: stale.quoteId }, real), false);
  assert.equal(server.assertAiMediaCreditQuote({ ...request, expectedCredits: real.totalCredits, creditTariffVersion: real.tariffVersion, creditQuoteId: real.quoteId }, real), true);
  const ai = { ...request, inspirationImages: request.inspirationImages.map((image) => ({ ...image, voiceMode: "ai" as const, voiceSample: undefined })) };
  assert.equal(server.quoteAiMediaRequest("account-test", ai).totalCredits, 87);
});

test("the server refuses retired HeyGen quotes for both AI and supplied voices while retaining historical prices", () => {
  const request = normalizeAiMediaGenerationRequest({ requestId: "heygen-retired-quote", source: "studio", creationMode: "free", kind: "video", freePrompt: 'La personne dit « Bonjour ! ».',
    videoEngine: "heygen", videoResolution: "768p", format: "story", durationSeconds: 8, teamVideoSpeechMode: "characters", identityConsent: true,
    inspirationImages: [{ mimeType: "image/webp", data: "A".repeat(64), role: "character", usage: "inspiration", characterIndex: 1, voiceMode: "provided", voiceSample: sample() }],
  });
  for (const hasProvidedCharacterVoice of [false, true]) {
    const input = { ...request, inspirationImagesCount: 1, hasProvidedCharacterVoice };
    assert.equal(pricing.quoteAiMediaCredits(input).totalCredits, hasProvidedCharacterVoice ? 91 : 45);
    assert.throws(() => server.createAiMediaServerQuote("account-test", input), /ai_media_video_engine_unavailable/);
    const normalized = hasProvidedCharacterVoice ? request : {
      ...request, inspirationImages: request.inspirationImages.map((image) => ({ ...image, voiceMode: "ai" as const, voiceSample: undefined })),
    };
    assert.throws(() => server.quoteAiMediaRequest("account-test", normalized), /ai_media_video_engine_unavailable/);
  }
});

test("historical Wan3 voice tariffs remain readable but cannot produce a new server quote", () => {
  const input = { ...voiceInput, videoEngine: "wan3" };
  assert.equal(pricing.quoteAiMediaCredits(input).totalCredits, 87);
  assert.throws(() => server.createAiMediaServerQuote("account-test", input), /Wan 3\.0.*autre moteur/);
});
