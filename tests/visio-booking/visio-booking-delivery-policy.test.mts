import assert from "node:assert/strict";
import test from "node:test";

import {
  VISIO_BOOKING_MANUAL_RESEND_LOCK_TTL_MS,
  VISIO_BOOKING_MANUAL_RESEND_SCOPE,
  buildVisioBookingLinkMail,
  buildVisioBookingManualResendKey,
} from "../../lib/visioBookingDeliveryPolicy.ts";

test("le renvoi manuel possède une clé durable sans donnée personnelle", () => {
  const first = buildVisioBookingManualResendKey({
    appointmentIdentity: "booking:nonce-123",
    deliveryKey: "6c19ebeb-c258-4ef0-a8b2-f476ba95dd36",
  });
  const retry = buildVisioBookingManualResendKey({
    appointmentIdentity: "booking:nonce-123",
    deliveryKey: "6c19ebeb-c258-4ef0-a8b2-f476ba95dd36",
  });
  const explicitSecondSend = buildVisioBookingManualResendKey({
    appointmentIdentity: "booking:nonce-123",
    deliveryKey: "ccdb20d8-b868-4980-ac06-7ac635c03685",
  });

  assert.equal(VISIO_BOOKING_MANUAL_RESEND_SCOPE, "visio_booking_manual_link_v1");
  assert.equal(VISIO_BOOKING_MANUAL_RESEND_LOCK_TTL_MS, 7 * 24 * 60 * 60 * 1000);
  assert.equal(first, retry);
  assert.notEqual(first, explicitSecondSend);
  assert.match(first, /^v1:[0-9a-f]{64}$/);
  assert.doesNotMatch(first, /nonce-123/);
});

test("le mail manuel ne contient que la date, l'horaire et le Meet public", () => {
  const mail = buildVisioBookingLinkMail({
    start: "2026-09-12T08:00:00.000Z",
    end: "2026-09-12T09:00:00.000Z",
    meetUrl: "https://meet.google.com/abc-defg-hij",
  });

  assert.equal(mail.subject, "Votre lien Google Meet — iNrCy");
  assert.match(mail.text, /Google Meet : https:\/\/meet\.google\.com\/abc-defg-hij/);
  assert.match(mail.text, /Aucun rappel automatique supplémentaire/);
  assert.doesNotMatch(mail.text, /responsable|téléphone|acquisition/i);
  assert.match(mail.html, /Rejoindre le Google Meet/);
});

test("un lien qui n'est pas un Google Meet est bloqué", () => {
  assert.throws(
    () => buildVisioBookingLinkMail({
      start: "2026-09-12T08:00:00.000Z",
      end: "2026-09-12T09:00:00.000Z",
      meetUrl: "https://example.com/secret",
    }),
    /visio_booking_manual_resend_invalid/,
  );
});
