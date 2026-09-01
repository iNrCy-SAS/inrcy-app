import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_MEDIA_MONTHLY_LIMITS,
  createAiMediaRequestFingerprint,
  getAiMediaMonthlyLimit,
  hasAiMediaStudioAccess,
  normalizeAiMediaEdition,
  stableAiMediaRequestPayload,
} from "../../lib/aiMediaGenerationQuotaPolicy.ts";

test("les plafonds mensuels sont propres a chaque edition", () => {
  assert.deepEqual(AI_MEDIA_MONTHLY_LIMITS, {
    standard: { image: 20, video: 5, studioEnabled: true },
    premium: { image: 30, video: 10, studioEnabled: true },
    founder: { image: 150, video: 12, studioEnabled: true },
  });

  assert.equal(getAiMediaMonthlyLimit("standard", "image"), 20);
  assert.equal(getAiMediaMonthlyLimit("standard", "video"), 5);
  assert.equal(getAiMediaMonthlyLimit("premium", "image"), 30);
  assert.equal(getAiMediaMonthlyLimit("premium", "video"), 10);
  assert.equal(getAiMediaMonthlyLimit("founder", "image"), 150);
  assert.equal(getAiMediaMonthlyLimit("founder", "video"), 12);
});

test("le studio avance est accessible a toutes les editions", () => {
  assert.equal(hasAiMediaStudioAccess("standard"), true);
  assert.equal(hasAiMediaStudioAccess("premium"), true);
  assert.equal(hasAiMediaStudioAccess("founder"), true);
  assert.equal(normalizeAiMediaEdition(" PREMIUM "), "premium");
  assert.throws(() => normalizeAiMediaEdition("free"), /Edition media IA invalide/);
});

test("l'empreinte idempotente est stable quel que soit l'ordre des cles", () => {
  const first = {
    subject: "Menu du jour",
    options: { withText: true, format: "universal" },
    channels: ["instagram", "facebook"],
  };
  const reordered = {
    channels: ["instagram", "facebook"],
    options: { format: "universal", withText: true },
    subject: "Menu du jour",
  };

  assert.equal(stableAiMediaRequestPayload(first), stableAiMediaRequestPayload(reordered));
  assert.equal(createAiMediaRequestFingerprint(first), createAiMediaRequestFingerprint(reordered));
  assert.match(createAiMediaRequestFingerprint(first), /^[0-9a-f]{64}$/);
  assert.notEqual(
    createAiMediaRequestFingerprint(first),
    createAiMediaRequestFingerprint({ ...first, subject: "Autre menu" }),
  );
});

test("la signature refuse les structures circulaires", () => {
  const request: Record<string, unknown> = { subject: "test" };
  request.self = request;
  assert.throws(() => createAiMediaRequestFingerprint(request), /circulaire/);
});
