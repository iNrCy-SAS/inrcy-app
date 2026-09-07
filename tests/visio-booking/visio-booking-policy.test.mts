import assert from "node:assert/strict";
import test from "node:test";

import {
  VISIO_BOOKING_DURATION_MINUTES,
  VISIO_BOOKING_SPACING_MINUTES,
  VISIO_BOOKING_START_HOURS,
  chooseBalancedMember,
  getLocalDateTimeParts,
  isAllowedVisioStart,
  isMemberFree,
  zonedDateTimeToUtc,
  type VisioTeamMember,
} from "../../lib/visioBookingPolicy.ts";

const members: VisioTeamMember[] = [
  { id: "oceane", name: "Océane", email: "oceane@example.com", calendarId: "oceane" },
  { id: "apolline", name: "Apolline", email: "apolline@example.com", calendarId: "apolline" },
  { id: "jimmy", name: "Jimmy", email: "jimmy@example.com", calendarId: "jimmy" },
];

test("les cinq horaires attendus sont proposés", () => {
  assert.deepEqual([...VISIO_BOOKING_START_HOURS], [9, 11, 14, 16, 18]);
  assert.equal(VISIO_BOOKING_DURATION_MINUTES, 60);
  assert.equal(VISIO_BOOKING_SPACING_MINUTES, 120);
});

test("une heure locale de Paris est convertie correctement avant et après le changement d'heure", () => {
  const winter = zonedDateTimeToUtc({ year: 2026, month: 1, day: 12, hour: 9 });
  const summer = zonedDateTimeToUtc({ year: 2026, month: 7, day: 13, hour: 9 });
  assert.equal(winter.toISOString(), "2026-01-12T08:00:00.000Z");
  assert.equal(summer.toISOString(), "2026-07-13T07:00:00.000Z");
  assert.equal(getLocalDateTimeParts(winter).hour, 9);
  assert.equal(getLocalDateTimeParts(summer).hour, 9);
});

test("les dimanches, horaires hors grille et délais calendaires trop courts sont refusés", () => {
  const now = new Date("2026-09-04T08:00:00.000Z");
  assert.equal(
    isAllowedVisioStart({
      start: new Date("2026-09-06T07:00:00.000Z"),
      now,
      horizonDays: 21,
      minimumLeadDays: 1,
    }),
    false,
  );
  assert.equal(
    isAllowedVisioStart({
      start: new Date("2026-09-07T08:00:00.000Z"),
      now,
      horizonDays: 21,
      minimumLeadDays: 1,
    }),
    false,
  );
  assert.equal(
    isAllowedVisioStart({
      start: new Date("2026-09-07T07:00:00.000Z"),
      now,
      horizonDays: 21,
      minimumLeadDays: 4,
    }),
    false,
  );
});

test("les rendez-vous du samedi restent disponibles", () => {
  assert.equal(
    isAllowedVisioStart({
      start: new Date("2026-09-05T07:00:00.000Z"),
      now: new Date("2026-09-04T08:00:00.000Z"),
      horizonDays: 21,
      minimumLeadDays: 1,
    }),
    true,
  );
});

test("une réservation faite le samedi commence au plus tôt le lundi", () => {
  const saturday = new Date("2026-09-05T10:00:00.000Z");
  assert.equal(
    isAllowedVisioStart({
      start: new Date("2026-09-06T07:00:00.000Z"),
      now: saturday,
      horizonDays: 21,
      minimumLeadDays: 1,
    }),
    false,
  );
  assert.equal(
    isAllowedVisioStart({
      start: new Date("2026-09-07T07:00:00.000Z"),
      now: saturday,
      horizonDays: 21,
      minimumLeadDays: 1,
    }),
    true,
  );
});

test("le jour même est refusé mais tous les horaires du lendemain sont permis", () => {
  const mondayMorning = new Date("2026-09-07T06:00:00.000Z");
  assert.equal(
    isAllowedVisioStart({
      start: new Date("2026-09-07T12:00:00.000Z"),
      now: mondayMorning,
      horizonDays: 21,
      minimumLeadDays: 1,
    }),
    false,
  );
  assert.equal(
    isAllowedVisioStart({
      start: new Date("2026-09-08T07:00:00.000Z"),
      now: mondayMorning,
      horizonDays: 21,
      minimumLeadDays: 1,
    }),
    true,
  );
  assert.equal(
    isAllowedVisioStart({
      start: new Date("2026-09-07T07:00:00.000Z"),
      now: new Date("2026-09-06T18:30:00.000Z"),
      horizonDays: 21,
      minimumLeadDays: 1,
    }),
    true,
  );
});

test("un rendez-vous existant dans la fenêtre de deux heures bloque la personne", () => {
  const start = new Date("2026-09-07T07:00:00.000Z");
  assert.equal(
    isMemberFree(
      members[0],
      { oceane: [{ start: "2026-09-07T08:00:00.000Z", end: "2026-09-07T09:00:00.000Z" }] },
      start,
    ),
    false,
  );
  assert.equal(isMemberFree(members[1], {}, start), true);
});

test("l'attribution choisit la personne disponible ayant le moins de rendez-vous", () => {
  const selected = chooseBalancedMember({
    members,
    busyByCalendar: {
      oceane: [],
      apolline: [],
      jimmy: [{ start: "2026-09-07T07:00:00.000Z", end: "2026-09-07T08:00:00.000Z" }],
    },
    bookingCountByMember: { oceane: 4, apolline: 2, jimmy: 0 },
    start: new Date("2026-09-07T07:00:00.000Z"),
  });
  assert.equal(selected?.id, "apolline");
});
