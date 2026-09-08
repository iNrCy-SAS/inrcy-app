import assert from "node:assert/strict";
import test from "node:test";

import { INR_CALENDAR_GOOGLE_SOURCE } from "../../lib/inrCalendarGoogleSyncConstants.ts";
import {
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
  assert.deepEqual(row.meta.reminders, {
    enabled: false,
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

