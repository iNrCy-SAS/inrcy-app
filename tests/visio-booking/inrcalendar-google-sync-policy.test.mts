import assert from "node:assert/strict";
import test from "node:test";

import {
  INR_CALENDAR_GOOGLE_GUEST_EMAILS_PROPERTY,
  INR_CALENDAR_GOOGLE_SOURCE,
} from "../../lib/inrCalendarGoogleSyncConstants.ts";
import {
  buildInrCalendarCanonicalEventId,
  buildInrCalendarGoogleEventId,
  buildInrCalendarGoogleRow,
  getInrCalendarGoogleEventRange,
  type InrCalendarGoogleEvent,
} from "../../lib/inrCalendarGoogleSyncPolicy.ts";

const calendarId = "shared@group.calendar.google.com";
const adminUserId = "670b527d-5e08-42b4-ba95-e58e812339eb";

function event(overrides: InrCalendarGoogleEvent = {}): InrCalendarGoogleEvent {
  return {
    id: "google-event-123",
    status: "confirmed",
    summary: "Présentation iNrCy",
    description: "Rendez-vous équipe",
    location: "Google Meet",
    updated: "2026-09-08T08:00:00.000Z",
    htmlLink: "https://calendar.google.com/calendar/event?eid=test",
    hangoutLink: "https://meet.google.com/abc-defg-hij",
    start: { dateTime: "2026-09-09T08:00:00.000Z" },
    end: { dateTime: "2026-09-09T09:00:00.000Z" },
    extendedProperties: {
      private: {
        sourceCalendarId: "apolline.benedyczak@inrcy.com",
        sourceEventId: "source-event-1",
        assignedMemberId: "apolline",
        inrcyAppointmentStatus: "appointment_scheduled_direct",
      },
    },
    ...overrides,
  };
}

test("la clé Google produit toujours le même UUID et sépare les événements", () => {
  const first = buildInrCalendarGoogleEventId(calendarId, "event-1");
  const retry = buildInrCalendarGoogleEventId(calendarId, "event-1");
  const other = buildInrCalendarGoogleEventId(calendarId, "event-2");

  assert.equal(first, retry);
  assert.notEqual(first, other);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("un rendez-vous Google devient un événement iNrCalendar admin en lecture seule", () => {
  const row = buildInrCalendarGoogleRow({
    event: event(),
    calendarId,
    adminUserId,
  });

  assert.ok(row);
  assert.equal(row.user_id, adminUserId);
  assert.equal(row.start_at, "2026-09-09T08:00:00.000Z");
  assert.equal(row.end_at, "2026-09-09T09:00:00.000Z");
  assert.equal(row.all_day, false);
  assert.equal(row.meta.source, INR_CALENDAR_GOOGLE_SOURCE);
  assert.equal(row.meta.readOnly, true);
  assert.equal(row.meta.appointmentStatus, "appointment_scheduled_direct");
  assert.deepEqual(row.meta.reminders, {
    enabled: false,
    deliveryPolicy: "manual_only",
    inAppMinutesBefore: 120,
    emailMinutesBefore: 1440,
    mailAccountId: null,
    lastInAppReminderAt: null,
    lastEmailReminderAt: null,
    emailSentAtByRecipient: {},
  });
  assert.equal(
    (row.meta.google as Record<string, unknown>).assignedMemberId,
    "apolline",
  );
  assert.equal(
    (row.meta.google as Record<string, unknown>).appointmentStatus,
    "appointment_scheduled_direct",
  );
});

test("les participants externes restent visibles sans activer de rappel iNrCy", () => {
  const row = buildInrCalendarGoogleRow({
    event: event({
      organizer: { email: "apolline.benedyczak@inrcy.com" },
      attendees: [
        { email: "apolline.benedyczak@inrcy.com", self: true, responseStatus: "accepted" },
        { email: "PRO@EXAMPLE.COM", displayName: "Jean Pro", responseStatus: "accepted" },
        { email: "refus@example.com", responseStatus: "declined" },
      ],
    }),
    calendarId,
    adminUserId,
    internalEmails: ["apolline.benedyczak@inrcy.com"],
  });

  assert.ok(row);
  assert.deepEqual(row.meta.guests, [
    { email: "pro@example.com", display_name: "Jean Pro" },
  ]);
  assert.equal((row.meta.reminders as Record<string, unknown>).enabled, false);
  assert.equal(
    (row.meta.reminders as Record<string, unknown>).deliveryPolicy,
    "manual_only",
  );
});

test("deux copies Google du même rendez-vous utilisent une seule ligne iNrCalendar", () => {
  const canonicalIdentity =
    "ical:series@google.com:2026-09-09T08:00:00.000Z";
  const first = buildInrCalendarGoogleRow({
    event: event({ id: "google-copy-a" }),
    calendarId,
    adminUserId,
    canonicalIdentity,
  });
  const second = buildInrCalendarGoogleRow({
    event: event({ id: "google-copy-b" }),
    calendarId,
    adminUserId,
    canonicalIdentity,
  });

  assert.ok(first);
  assert.ok(second);
  assert.equal(first.id, second.id);
  assert.equal(
    first.id,
    buildInrCalendarCanonicalEventId(calendarId, canonicalIdentity),
  );
  assert.equal(first.meta.appointmentIdentity, canonicalIdentity);
  assert.equal(
    (first.meta.google as Record<string, unknown>).canonicalIdentity,
    canonicalIdentity,
  );
});

test("les invités transportés par le miroir Google restent sans rappel", () => {
  const row = buildInrCalendarGoogleRow({
    event: event({
      extendedProperties: {
        private: {
          sourceCalendarId: "apolline.benedyczak@inrcy.com",
          assignedMemberEmail: "apolline.benedyczak@inrcy.com",
          [INR_CALENDAR_GOOGLE_GUEST_EMAILS_PROPERTY]: JSON.stringify([
            "client@example.com",
            "compte@inrcy.com",
          ]),
        },
      },
    }),
    calendarId,
    adminUserId,
  });

  assert.ok(row);
  assert.deepEqual(row.meta.guests, [{ email: "client@example.com" }]);
  assert.equal((row.meta.reminders as Record<string, unknown>).enabled, false);
  assert.equal(
    (row.meta.reminders as Record<string, unknown>).deliveryPolicy,
    "manual_only",
  );
});

test("la resynchronisation conserve l'historique d'envoi et un déplacement le réinitialise", () => {
  const previous = {
    start_at: "2026-09-09T08:00:00.000Z",
    end_at: "2026-09-09T09:00:00.000Z",
    meta: {
      reminders: {
        enabled: true,
        lastInAppReminderAt: "2026-09-08T06:00:00.000Z",
        lastEmailReminderAt: "2026-09-08T06:00:00.000Z",
        emailSentAtByRecipient: {
          "guest:client@example.com": { "1440": "2026-09-08T06:00:00.000Z" },
        },
      },
    },
  };
  const sameSlot = buildInrCalendarGoogleRow({
    event: event({ attendees: [{ email: "client@example.com" }] }),
    calendarId,
    adminUserId,
    previous,
  });
  const moved = buildInrCalendarGoogleRow({
    event: event({
      attendees: [{ email: "client@example.com" }],
      start: { dateTime: "2026-09-10T08:00:00.000Z" },
      end: { dateTime: "2026-09-10T09:00:00.000Z" },
    }),
    calendarId,
    adminUserId,
    previous,
  });

  assert.ok(sameSlot);
  assert.ok(moved);
  assert.equal(
    (sameSlot.meta.reminders as Record<string, unknown>).enabled,
    false,
  );
  assert.deepEqual(
    (sameSlot.meta.reminders as Record<string, unknown>).emailSentAtByRecipient,
    (previous.meta.reminders as Record<string, unknown>).emailSentAtByRecipient,
  );
  assert.deepEqual(
    (moved.meta.reminders as Record<string, unknown>).emailSentAtByRecipient,
    {},
  );
  assert.equal(
    (moved.meta.reminders as Record<string, unknown>).lastEmailReminderAt,
    null,
  );
});

test("les événements sur toute la journée conservent la fin exclusive Google", () => {
  assert.deepEqual(
    getInrCalendarGoogleEventRange(
      event({
        start: { date: "2026-09-10" },
        end: { date: "2026-09-12" },
      }),
    ),
    {
      startAt: "2026-09-10T00:00:00.000Z",
      endAt: "2026-09-12T00:00:00.000Z",
      allDay: true,
    },
  );
});

test("un événement annulé ou sans plage valide n'est pas importé", () => {
  assert.equal(
    buildInrCalendarGoogleRow({
      event: event({ status: "cancelled" }),
      calendarId,
      adminUserId,
    }),
    null,
  );
  assert.equal(
    buildInrCalendarGoogleRow({
      event: event({ start: {}, end: {} }),
      calendarId,
      adminUserId,
    }),
    null,
  );
});
