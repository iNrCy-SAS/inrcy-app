import assert from "node:assert/strict";
import test from "node:test";

import {
  REQUIRED_VISIO_BOOKING_INTERNAL_ALERT_EMAIL,
  buildVisioBookingInternalAlertDeliveryKey,
  buildVisioBookingInternalAlertPayload,
  buildVisioBookingInternalAlertRecipients,
  smtpAcceptedVisioBookingRecipient,
  visioBookingInternalAlertRetryAt,
} from "../../lib/visioBookingInternalAlertPolicy.ts";

test("l'alerte va au compte central et au responsable sans doublon", () => {
  assert.deepEqual(
    buildVisioBookingInternalAlertRecipients({
      assignedMemberEmail: "Jimmy@inrcy.com",
      configuredRecipients: "contact@inrcy.com; COMPTE@INRCY.COM,incorrect",
    }),
    [REQUIRED_VISIO_BOOKING_INTERNAL_ALERT_EMAIL, "jimmy@inrcy.com", "contact@inrcy.com"],
  );
});

test("une livraison possède une clé stable par événement et destinataire", () => {
  const first = buildVisioBookingInternalAlertDeliveryKey({
    googleEventId: "event-123",
    recipient: "Jimmy@inrcy.com",
  });
  const retry = buildVisioBookingInternalAlertDeliveryKey({
    googleEventId: "event-123",
    recipient: "jimmy@inrcy.com",
  });
  const central = buildVisioBookingInternalAlertDeliveryKey({
    googleEventId: "event-123",
    recipient: "compte@inrcy.com",
  });
  assert.equal(first, retry);
  assert.notEqual(first, central);
  assert.match(first, /^v1:[0-9a-f]{64}$/);
  assert.doesNotMatch(first, /event-123|jimmy/);
});

test("le message interne contient les informations d'action utiles", () => {
  const payload = buildVisioBookingInternalAlertPayload({
    googleEventId: "event-123",
    prospectUserId: "5d524543-6f8b-4594-b1b4-5b7b128ab32e",
    recipient: "jimmy@inrcy.com",
    assignedMemberId: "jimmy",
    assignedMemberName: "Jimmy",
    prospectName: "Nicolas Claude",
    company: "Claude Nico",
    prospectEmail: "claude.nico97two@gmail.com",
    prospectPhone: "0749342220",
    dateLabel: "lundi 14 septembre 2026",
    timeLabel: "16:00",
    meetUrl: "https://meet.google.com/auj-wvyf-kte",
    calendarUrl: "https://calendar.google.com/event?eid=abc",
  });
  assert.match(payload.subject, /Claude Nico/);
  assert.match(payload.text, /Attribué à : Jimmy/);
  assert.match(payload.text, /claude\.nico97two@gmail\.com/);
  assert.match(payload.text, /Google Meet : https:\/\/meet\.google\.com\/auj-wvyf-kte/);
});

test("les reprises sont différées et plafonnées", () => {
  const now = new Date("2026-09-13T20:00:00.000Z");
  const first = visioBookingInternalAlertRetryAt({
    attemptCount: 1,
    deliveryKey: "v1:" + "a".repeat(64),
    now,
  });
  const late = visioBookingInternalAlertRetryAt({
    attemptCount: 20,
    deliveryKey: "v1:" + "a".repeat(64),
    now,
  });
  assert.ok(first.getTime() >= now.getTime() + 60_000);
  assert.ok(first.getTime() <= now.getTime() + 90_000);
  assert.ok(late.getTime() >= now.getTime() + 6 * 60 * 60_000);
  assert.ok(late.getTime() <= now.getTime() + 6 * 60 * 60_000 + 30_000);
});

test("seule l'acceptation SMTP du destinataire valide l'envoi", () => {
  assert.equal(
    smtpAcceptedVisioBookingRecipient("jimmy@inrcy.com", ["JIMMY@INRCY.COM"]),
    true,
  );
  assert.equal(
    smtpAcceptedVisioBookingRecipient("jimmy@inrcy.com", ["compte@inrcy.com"]),
    false,
  );
});

