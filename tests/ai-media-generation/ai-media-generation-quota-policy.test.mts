import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_MEDIA_MONTHLY_LIMITS,
  AI_MEDIA_QUOTA_UNITS,
  AI_MEDIA_ROLLOVER_CAPS,
  AI_MEDIA_VIDEO_DURATION_OPTIONS,
  createAiMediaRequestFingerprint,
  getAiMediaMonthlyLimit,
  getAiMediaQuotaUnit,
  getAiMediaRolloverCap,
  getAiMediaVideoMaxDuration,
  hasAiMediaStudioAccess,
  normalizeAiMediaEdition,
  stableAiMediaRequestPayload,
} from "../../lib/aiMediaGenerationQuotaPolicy.ts";

test("les plafonds mensuels sont propres a chaque edition", () => {
  assert.deepEqual(AI_MEDIA_MONTHLY_LIMITS, {
    standard: {
      image: 20,
      video: 48,
      studioEnabled: true,
      videoMaxDurationSeconds: 24,
    },
    premium: {
      image: 30,
      video: 144,
      studioEnabled: true,
      videoMaxDurationSeconds: 24,
    },
    founder: {
      image: 30,
      video: 144,
      studioEnabled: true,
      videoMaxDurationSeconds: 24,
    },
  });

  assert.equal(getAiMediaMonthlyLimit("standard", "image"), 20);
  assert.equal(getAiMediaMonthlyLimit("standard", "video"), 48);
  assert.equal(getAiMediaMonthlyLimit("premium", "image"), 30);
  assert.equal(getAiMediaMonthlyLimit("premium", "video"), 144);
  assert.equal(getAiMediaMonthlyLimit("founder", "image"), 30);
  assert.equal(getAiMediaMonthlyLimit("founder", "video"), 144);
  assert.equal(getAiMediaVideoMaxDuration("standard"), 24);
  assert.equal(getAiMediaVideoMaxDuration("premium"), 24);
  assert.equal(getAiMediaVideoMaxDuration("founder"), 24);
});

test("la cagnotte reportable est plafonnee sans modifier les recharges mensuelles", () => {
  assert.deepEqual(AI_MEDIA_ROLLOVER_CAPS, {
    standard: { image: 70, video: 168 },
    premium: { image: 70, video: 480 },
    founder: { image: 70, video: 480 },
  });
  assert.equal(getAiMediaRolloverCap("standard", "image"), 70);
  assert.equal(getAiMediaRolloverCap("standard", "video"), 168);
  assert.equal(getAiMediaRolloverCap("premium", "video"), 480);
  assert.equal(getAiMediaRolloverCap("founder", "video"), 480);
});

test("les videos consomment leurs secondes de sortie et toutes les editions acceptent 8, 16 ou 24 s", () => {
  assert.deepEqual(AI_MEDIA_VIDEO_DURATION_OPTIONS, [8, 16, 24]);
  assert.deepEqual(AI_MEDIA_QUOTA_UNITS, { image: "item", video: "second" });
  assert.equal(getAiMediaQuotaUnit("image"), "item");
  assert.equal(getAiMediaQuotaUnit("video"), "second");
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
