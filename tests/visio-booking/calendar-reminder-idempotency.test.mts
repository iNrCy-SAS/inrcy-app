import assert from "node:assert/strict";
import test from "node:test";

import {
  CALENDAR_REMINDER_IDEMPOTENCY_SCOPE,
  CALENDAR_REMINDER_LOCK_TTL_MS,
  buildCalendarReminderDeliveryKey,
  calendarReminderEventIdentity,
  shouldRunAutomaticCalendarReminders,
} from "../../lib/calendarReminderDeliveryPolicy.ts";

const base = {
  id: "local-mirror-a",
  startAt: "2026-09-12T08:00:00.000Z",
  recipientKey: "guest:pro@example.com",
  offsetMinutes: 1440,
  meta: {
    google: {
      calendarId: "shared@group.calendar.google.com",
      eventId: "shared-google-event",
      sourceCalendarId: "apolline@inrcy.com",
      sourceEventId: "source-event-1",
      bookingNonce: "booking-123",
    },
  },
};

test("le verrou des rappels est durable pendant toute la fenêtre du rendez-vous", () => {
  assert.equal(CALENDAR_REMINDER_IDEMPOTENCY_SCOPE, "calendar_reminder_email_v1");
  assert.equal(CALENDAR_REMINDER_LOCK_TTL_MS, 7 * 24 * 60 * 60 * 1000);
});

test("deux lignes miroir du même rendez-vous produisent une seule clé d'envoi", () => {
  const first = buildCalendarReminderDeliveryKey(base);
  const duplicateMirror = buildCalendarReminderDeliveryKey({
    ...base,
    id: "local-mirror-b",
    meta: {
      google: {
        calendarId: "another-calendar@group.calendar.google.com",
        eventId: "another-mirror-event",
        bookingNonce: "booking-123",
      },
    },
  });

  assert.equal(first, duplicateMirror);
  assert.match(first, /^v1:[0-9a-f]{64}$/);
});

test("la date, l'échéance et le destinataire restent trois livraisons distinctes", () => {
  const first = buildCalendarReminderDeliveryKey(base);
  assert.notEqual(first, buildCalendarReminderDeliveryKey({ ...base, startAt: "2026-09-13T08:00:00.000Z" }));
  assert.notEqual(first, buildCalendarReminderDeliveryKey({ ...base, offsetMinutes: 120 }));
  assert.notEqual(first, buildCalendarReminderDeliveryKey({ ...base, recipientKey: "guest:other@example.com" }));
});

test("un événement Google sans booking utilise sa source avant sa ligne locale", () => {
  const input = {
    ...base,
    meta: {
      google: {
        calendarId: "shared@group.calendar.google.com",
        eventId: "mirror-event",
        sourceCalendarId: "oceane@inrcy.com",
        sourceEventId: "source-event-9",
      },
    },
  };
  assert.equal(
    calendarReminderEventIdentity(input),
    "source:oceane@inrcy.com:source-event-9",
  );
  assert.equal(
    buildCalendarReminderDeliveryKey(input),
    buildCalendarReminderDeliveryKey({ ...input, id: "a-different-local-row" }),
  );
});

test("les rendez-vous Google et les lignes manual_only ne passent jamais dans le cron", () => {
  assert.equal(
    shouldRunAutomaticCalendarReminders({
      source: "google_shared_calendar",
      reminders: { enabled: true },
    }),
    false,
  );
  assert.equal(
    shouldRunAutomaticCalendarReminders({
      source: "agenda",
      reminders: { enabled: true, deliveryPolicy: "manual_only" },
    }),
    false,
  );
  assert.equal(
    shouldRunAutomaticCalendarReminders({
      source: "agenda",
      reminders: { enabled: true },
    }),
    true,
  );
});
