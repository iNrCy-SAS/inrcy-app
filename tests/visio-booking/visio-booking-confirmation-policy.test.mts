import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVisioBookingConfirmationDeliveryKey,
  buildVisioBookingConfirmationPayload,
  visioBookingConfirmationRetryAt,
} from "../../lib/visioBookingConfirmationPolicy.ts";

function payload() {
  return buildVisioBookingConfirmationPayload({
    googleEventId: "event-123",
    prospectUserId: "5d524543-6f8b-4594-b1b4-5b7b128ab32e",
    recipient: "pro@example.com",
    prospectName: "Camille Martin",
    company: "Atelier Martin",
    assignedMemberId: "oceane",
    assignedMemberName: "Océane",
    dateLabel: "vendredi 18 septembre 2026",
    timeLabel: "15:00",
    meetUrl: "https://meet.google.com/abc-defg-hij",
    calendarUrl: "https://calendar.google.com/calendar/event?eid=abc",
  });
}

test("builds a branded Outlook-safe confirmation with the real Meet link", () => {
  const message = payload();
  assert.match(message.subject, /rendez-vous iNrCy est confirmé/);
  assert.match(message.text, /30 à 45 minutes/);
  assert.match(message.text, /https:\/\/meet\.google\.com\/abc-defg-hij/);
  assert.match(message.html, /cid:inrcy-logo@inrcy/);
  assert.match(message.html, /bgcolor="#635BFF"/);
  assert.match(message.html, /background-color:#635BFF/);
  assert.match(message.html, />Rejoindre la visio Google Meet<\/a>/);
  assert.match(message.html, /Océane/);
  assert.match(message.html, /Voir dans mon agenda/);
  assert.doesNotMatch(message.html, /linear-gradient/);
});

test("rejects a missing or forged Meet URL", () => {
  for (const meetUrl of ["", "http://meet.google.com/abc", "https://evil.example/meet"]) {
    assert.throws(
      () => buildVisioBookingConfirmationPayload({
        googleEventId: "event-123",
        prospectUserId: "prospect-123",
        recipient: "pro@example.com",
        prospectName: "Camille",
        assignedMemberId: "jimmy",
        assignedMemberName: "Jimmy",
        dateLabel: "18 septembre 2026",
        timeLabel: "15:00",
        meetUrl,
      }),
      /visio_booking_confirmation_invalid/,
    );
  }
});

test("uses a deterministic recipient-specific delivery key and retry jitter", () => {
  const first = buildVisioBookingConfirmationDeliveryKey({
    googleEventId: "event-123",
    recipient: "PRO@example.com",
  });
  const replay = buildVisioBookingConfirmationDeliveryKey({
    googleEventId: "event-123",
    recipient: "pro@example.com",
  });
  const other = buildVisioBookingConfirmationDeliveryKey({
    googleEventId: "event-123",
    recipient: "other@example.com",
  });
  assert.equal(first, replay);
  assert.notEqual(first, other);
  assert.match(first, /^v1:[0-9a-f]{64}$/);

  const now = new Date("2026-09-17T10:00:00.000Z");
  const retry = visioBookingConfirmationRetryAt({
    attemptCount: 2,
    deliveryKey: first,
    now,
  });
  assert.ok(retry.getTime() >= now.getTime() + 120_000);
  assert.ok(retry.getTime() <= now.getTime() + 150_000);
});
