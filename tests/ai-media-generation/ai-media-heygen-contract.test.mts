import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import {
  AiMediaRequestValidationError,
  normalizeAiMediaGenerationRequest,
  type AiMediaGenerationRequest,
} from "../../lib/aiMediaGenerationContracts.ts";
import { normalizeAiMediaVideoEngine } from "../../lib/aiMediaModelCatalog.ts";
import * as pricing from "../../lib/aiMediaCreditsPricing.ts";
import { getAiMediaVideoSegmentDurations } from "../../lib/aiMediaVideoTimeline.ts";
import { assertAiVideoReferenceTeamProviderEgress } from "../../lib/aiVideoProviderTypes.ts";

function request(overrides: Record<string, unknown> = {}) {
  return normalizeAiMediaGenerationRequest({
    requestId: "heygen-contract-fixture-0001", source: "studio", operation: "generate",
    creationMode: "free", kind: "video", format: "story", videoEngine: "heygen",
    videoResolution: "768p", durationSeconds: 8, sceneMode: "single",
    freePrompt: "Une personne adulte présente son atelier, sans inscription à l’écran.",
    ...overrides,
  });
}

function quote(overrides: Partial<pricing.AiMediaCreditsQuoteInput> = {}) {
  return pricing.quoteAiMediaCredits({ kind: "video", videoEngine: "heygen", durationSeconds: 5, videoResolution: "768p", ...overrides });
}

function supplier(overrides: Partial<pricing.AiMediaCreditsQuoteInput> = {}) {
  return pricing.estimateAiMediaVideoSupplierCostMicroUsd({ kind: "video", videoEngine: "heygen", durationSeconds: 5, videoResolution: "768p", ...overrides });
}

// Execute the production quote signer with its real pricing and SHA-256.
// No server initialization, credentials, SDK client or network is involved.
function quoteServer() {
  const output = ts.transpileModule(readFileSync(new URL("../../lib/aiMediaCreditQuoteServer.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  type Server = {
    quoteAiMediaRequest: (accountId: string, input: AiMediaGenerationRequest) => pricing.AiMediaCreditsQuote & { quoteId: string };
    assertAiMediaCreditQuote: (input: AiMediaGenerationRequest, signed: pricing.AiMediaCreditsQuote & { quoteId: string }) => boolean;
  };
  const record = { exports: {} as Server };
  new Function("module", "exports", "require", output)(record, record.exports, (id: string) => {
    if (id === "server-only") return {};
    if (id === "node:crypto") return crypto;
    if (id === "./aiMediaCreditsPricing.ts") return pricing;
    throw new Error(`Unisolated quote dependency: ${id}`);
  });
  return record.exports;
}

for (const videoResolution of ["768p", "1080p"] as const) {
  test(`HeyGen ${videoResolution} survives canonical request serialization without falling back to another engine`, () => {
    const normalized = request({ videoEngine: " HEYGEN ", videoResolution });
    assert.equal(normalized.videoEngine, "heygen");
    assert.equal(normalized.videoResolution, videoResolution);
    assert.equal(normalized.durationSeconds, 8);
    assert.equal(normalized.sceneMode, "single");
    const restored = normalizeAiMediaGenerationRequest(JSON.parse(JSON.stringify(normalized)));
    assert.equal(restored.videoEngine, "heygen");
    assert.equal(restored.videoResolution, videoResolution);
    assert.equal(normalizeAiMediaVideoEngine(restored.videoEngine), "heygen");
    assert.equal(normalizeAiMediaVideoEngine("heygen-unreviewed"), null);
  });
}

test("HeyGen rejects four seconds, 720p and two scenes below ten seconds before obtaining a quote", () => {
  for (const invalid of [
    { durationSeconds: 4 }, { videoResolution: "720p" },
    { durationSeconds: 5, sceneMode: "multi" }, { durationSeconds: 8, sceneMode: "multi" },
    { durationSeconds: 9, sceneMode: "multi" }, { durationSeconds: 31 },
  ]) {
    assert.throws(() => request(invalid), AiMediaRequestValidationError, JSON.stringify(invalid));
    assert.throws(() => quote(invalid), /ai_media_video_(duration|resolution)_invalid/, JSON.stringify(invalid));
  }
  assert.equal(request({ durationSeconds: 10, sceneMode: "multi" }).sceneMode, "multi");
});

test("HeyGen commercial quotes keep 4 credits per second at 768p and 10 at 1080p plus 4 per transmitted reference", () => {
  for (const [videoResolution, durationSeconds, noReference, oneReference] of [
    ["768p", 5, 20, 24], ["768p", 8, 32, 36], ["768p", 15, 60, 64],
    ["1080p", 5, 50, 54], ["1080p", 8, 80, 84], ["1080p", 15, 150, 154],
  ] as const) {
    assert.equal(quote({ videoResolution, durationSeconds }).totalCredits, noReference);
    const withReference = quote({ videoResolution, durationSeconds, inspirationImagesCount: 1 });
    assert.equal(withReference.totalCredits, oneReference);
    assert.deepEqual(withReference.breakdown.find(item => item.key === "references"), { key: "references", label: "Images de référence", credits: 4 });
    assert.deepEqual(quote({ videoResolution, durationSeconds, inspirationImagesCount: 1 }), withReference);
  }
  assert.throws(() => quote({ inspirationImagesCount: 2 }), /references_unsupported/);
  assert.equal(quote({ creationMode: "free" }).totalCredits, 27, "Creative preparation remains a separate quoted item");
});

test("HeyGen supplier reservation retains the non-promotional 0.036/0.10 USD bounds plus 0.04 per reference", () => {
  for (const [videoResolution, durationSeconds, noReference, oneReference] of [
    ["768p", 5, 180_000, 220_000], ["768p", 8, 288_000, 328_000], ["768p", 15, 540_000, 580_000],
    ["1080p", 5, 500_000, 540_000], ["1080p", 8, 800_000, 840_000], ["1080p", 15, 1_500_000, 1_540_000],
  ] as const) {
    assert.equal(supplier({ videoResolution, durationSeconds }), noReference);
    assert.equal(supplier({ videoResolution, durationSeconds, inspirationImagesCount: 1 }), oneReference);
  }
  assert.throws(() => supplier({ videoResolution: "720p" }), /resolution_invalid/);
});

test("HeyGen thirty-second films contain two real fifteen-second clips and account for continuity/reference inputs", () => {
  for (const videoResolution of ["768p", "1080p"] as const) {
    for (const sceneMode of ["single", "multi"] as const) {
      assert.deepEqual(getAiMediaVideoSegmentDurations(30, "heygen", videoResolution, sceneMode), [15, 15]);
      const normalized = request({ videoResolution, durationSeconds: 30, sceneMode });
      assert.equal(normalized.connectScenes, sceneMode === "single");
    }
  }
  assert.equal(quote({ durationSeconds: 30 }).totalCredits, 124, "Continuous T2V needs a second-clip input frame");
  assert.equal(quote({ durationSeconds: 30, sceneMode: "multi" }).totalCredits, 120);
  assert.equal(quote({ durationSeconds: 30, inspirationImagesCount: 1 }).totalCredits, 128);
  assert.equal(quote({ durationSeconds: 30, inspirationImagesCount: 1, sceneMode: "multi" }).totalCredits, 128);
  assert.equal(supplier({ durationSeconds: 30 }), 1_120_000);
  assert.equal(supplier({ durationSeconds: 30, sceneMode: "multi" }), 1_080_000);
  assert.equal(supplier({ durationSeconds: 30, inspirationImagesCount: 1 }), 1_160_000);
  assert.equal(supplier({ durationSeconds: 30, videoResolution: "1080p", inspirationImagesCount: 1 }), 3_080_000);
});

test("HeyGen team egress requires its named consent and one precomposed team image", () => {
  const references = [1, 2].map(characterIndex => ({
    mimeType: "image/png", data: Buffer.alloc(96, characterIndex).toString("base64"),
    role: "character", usage: "required", characterIndex,
  }));
  const team = { inspirationImages: references, identityConsent: true, teamVideoProviderConsent: "heygen" };
  const normalized = request(team);
  assert.equal(normalized.identityMode, "reference_team");
  assert.equal(normalized.teamVideoProviderConsent, "heygen");
  for (const teamVideoProviderConsent of [undefined, "veo", "omni", "grok-lite"]) {
    assert.throws(() => request({ ...team, teamVideoProviderConsent, teamVideoVeoConsent: true }), AiMediaRequestValidationError);
  }
  const providerInput = {
    request: { ...normalized, inspirationImages: normalized.inspirationImages.slice(0, 1) },
    identityTeamPrecomposed: true,
    identityTeamProviderEgressConsent: "heygen" as const,
  };
  assert.doesNotThrow(() => assertAiVideoReferenceTeamProviderEgress(providerInput, "heygen"));
  assert.throws(() => assertAiVideoReferenceTeamProviderEgress({ ...providerInput, identityTeamProviderEgressConsent: "veo", identityTeamGoogleEgressConsent: true }, "heygen"), /provider_consent_required/);
  assert.throws(() => assertAiVideoReferenceTeamProviderEgress({ ...providerInput, identityTeamPrecomposed: false }, "heygen"), /precomposition_required/);
  assert.throws(() => assertAiVideoReferenceTeamProviderEgress({ ...providerInput, request: normalized }, "heygen"), /single_group_image_required/);
  const composedQuote = quote({ inspirationImagesCount: 2, identityMode: "reference_team" });
  assert.equal(composedQuote.totalCredits, 35, "Two portraits add 11 preparation credits and one transmitted reference at 4 credits");
  assert.equal(supplier({ inspirationImagesCount: 2, identityMode: "reference_team" }), 220_000);
});

test("HeyGen signed quote is stable but cannot authorize another account or the other resolution", () => {
  const server = quoteServer();
  const normalized = request({ durationSeconds: 5 });
  const signed = server.quoteAiMediaRequest("account-a", normalized);
  assert.deepEqual(server.quoteAiMediaRequest("account-a", normalized), signed);
  const authorized = { ...normalized, expectedCredits: signed.totalCredits, creditTariffVersion: signed.tariffVersion, creditQuoteId: signed.quoteId };
  assert.equal(server.assertAiMediaCreditQuote(authorized, signed), true);
  assert.equal(server.assertAiMediaCreditQuote(authorized, server.quoteAiMediaRequest("account-b", normalized)), false);
  const changedResolution = request({ durationSeconds: 5, videoResolution: "1080p" });
  assert.equal(server.assertAiMediaCreditQuote(authorized, server.quoteAiMediaRequest("account-a", changedResolution)), false);
  assert.equal(server.assertAiMediaCreditQuote({ ...authorized, creditTariffVersion: "obsolete-tariff" }, signed), false);
});
