import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPendingSignupReminderCalendarEvent,
  pendingSignupReminderEventId,
} from "../../lib/visioPendingSignupPolicy.ts";

const input = {
  userId: "f259a6ed-927a-489d-a257-f221b361b7f9",
  calendarId: "shared-calendar@group.calendar.google.com",
  createdAt: "2026-09-16T20:00:54.000Z",
  firstName: "Vincent",
  lastName: "Prata",
  email: "vincent.prata@example.com",
  company: "EI Vincent Prata",
  phone: "06 85 87 26 32",
};

test("l'identifiant du rappel d'inscription est déterministe et compatible Google", () => {
  const first = pendingSignupReminderEventId(input.userId);
  const second = pendingSignupReminderEventId(input.userId);
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{40}$/);
});

test("le rappel orange dure une heure et ne contient que les coordonnées utiles", () => {
  const event = buildPendingSignupReminderCalendarEvent(input);
  assert.equal(event.id, pendingSignupReminderEventId(input.userId));
  assert.equal(event.status, "confirmed");
  assert.equal(event.colorId, "5");
  assert.equal(event.start.dateTime, "2026-09-16T20:00:54.000Z");
  assert.equal(event.end.dateTime, "2026-09-16T21:00:54.000Z");
  assert.equal(event.start.timeZone, "Europe/Paris");
  assert.deepEqual(event.attendees, []);
  assert.deepEqual(event.reminders, { useDefault: false, overrides: [] });
  assert.equal(event.summary, "Inscription iNrCy - EI Vincent Prata");
  assert.match(event.description, /Nom : Prata/);
  assert.match(event.description, /Prénom : Vincent/);
  assert.match(event.description, /E-mail : vincent\.prata@example\.com/);
  assert.match(event.description, /Entreprise : EI Vincent Prata/);
  assert.match(event.description, /Téléphone : 06 85 87 26 32/);
  assert.doesNotMatch(event.description, /consent|utm_|campagne|publicité/i);
});

test("le rappel porte les métadonnées privées de déduplication et de cycle de vie", () => {
  const event = buildPendingSignupReminderCalendarEvent(input);
  const properties = event.extendedProperties.private;
  assert.equal(properties.inrcyAppointmentStatus, "signup_pending");
  assert.equal(properties.inrcyAppointmentOrigin, "signup_without_appointment");
  assert.equal(properties.inrcySignupAssignment, "v1");
  assert.equal(properties.inrcyTeamMirror, "v1");
  assert.equal(properties.prospectUserId, input.userId);
  assert.equal(properties.inrcyLogicalAppointmentId, `prospect:${input.userId}`);
  assert.equal(properties.sourceEventId, event.id);
  assert.equal(properties.sharedCalendarId, input.calendarId);
});
