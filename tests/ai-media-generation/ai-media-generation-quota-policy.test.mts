import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_MEDIA_MONTHLY_LIMITS,
  AI_MEDIA_QUOTA_UNITS,
  AI_MEDIA_ROLLOVER_CAPS,
  AI_MEDIA_VIDEO_DURATION_OPTIONS,
  AI_MEDIA_LEGACY_VIDEO_DURATION_OPTIONS,
  AI_MEDIA_LEGACY_CREDIT_FACTORS,
  legacyAiMediaAmountToCredits,
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
    basic: { image: 0, video: 0, studioEnabled: true, videoMaxDurationSeconds: 30 },
    standard: {
      image: 25,
      video: 56,
      studioEnabled: true,
      videoMaxDurationSeconds: 30,
    },
    premium: {
      image: 70,
      video: 204,
      studioEnabled: true,
      videoMaxDurationSeconds: 30,
    },
    founder: {
      image: 50,
      video: 144,
      studioEnabled: true,
      videoMaxDurationSeconds: 30,
    },
  });

  assert.equal(getAiMediaMonthlyLimit("basic", "image"), 0);
  assert.equal(getAiMediaMonthlyLimit("basic", "video"), 0);
  assert.equal(getAiMediaMonthlyLimit("standard", "image"), 25);
  assert.equal(getAiMediaMonthlyLimit("standard", "video"), 56);
  assert.equal(getAiMediaMonthlyLimit("premium", "image"), 70);
  assert.equal(getAiMediaMonthlyLimit("premium", "video"), 204);
  assert.equal(getAiMediaMonthlyLimit("founder", "image"), 50);
  assert.equal(getAiMediaMonthlyLimit("founder", "video"), 144);
  assert.equal(getAiMediaVideoMaxDuration("standard"), 30);
  assert.equal(getAiMediaVideoMaxDuration("premium"), 30);
  assert.equal(getAiMediaVideoMaxDuration("founder"), 30);
});

test("la cagnotte reportable est plafonnee sans modifier les recharges mensuelles", () => {
  assert.deepEqual(AI_MEDIA_ROLLOVER_CAPS, {
    basic: { image: 0, video: 0 },
    standard: { image: 70, video: 168 },
    premium: { image: 150, video: 480 },
    founder: { image: 70, video: 480 },
  });
  assert.equal(getAiMediaRolloverCap("basic", "image"), 0);
  assert.equal(getAiMediaRolloverCap("basic", "video"), 0);
  assert.equal(getAiMediaRolloverCap("standard", "image"), 70);
  assert.equal(getAiMediaRolloverCap("standard", "video"), 168);
  assert.equal(getAiMediaRolloverCap("premium", "video"), 480);
  assert.equal(getAiMediaRolloverCap("founder", "video"), 480);
});

test("les anciennes unités restent disponibles pour les requêtes déjà réservées", () => {
  assert.deepEqual(AI_MEDIA_LEGACY_VIDEO_DURATION_OPTIONS, [8, 16, 24]);
  assert.deepEqual(AI_MEDIA_VIDEO_DURATION_OPTIONS,Array.from({length:27},(_,index)=>index+4));
  assert.deepEqual(AI_MEDIA_QUOTA_UNITS, { image: "item", video: "second" });
  assert.equal(getAiMediaQuotaUnit("image"), "item");
  assert.equal(getAiMediaQuotaUnit("video"), "second");
});

test("les droits existants se convertissent sans changer la durée ni le nombre de médias", () => {
  assert.deepEqual(AI_MEDIA_LEGACY_CREDIT_FACTORS,{image:7,video:10});
  assert.equal(legacyAiMediaAmountToCredits("image",25)+legacyAiMediaAmountToCredits("video",54),715);
  assert.equal(legacyAiMediaAmountToCredits("image",AI_MEDIA_MONTHLY_LIMITS.standard.image)+legacyAiMediaAmountToCredits("video",AI_MEDIA_MONTHLY_LIMITS.standard.video),735);
  assert.equal(legacyAiMediaAmountToCredits("video",50),500);
  assert.throws(()=>legacyAiMediaAmountToCredits("video",-1),/invalide/);
  assert.throws(()=>legacyAiMediaAmountToCredits("image",1.5),/invalide/);
});

test("le studio avance est accessible a toutes les editions", () => {
  assert.equal(hasAiMediaStudioAccess("basic"), true);
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
