import assert from "node:assert/strict";
import test from "node:test";

import {
  VISIO_BOOKING_DURATION_MINUTES,
  VISIO_BOOKING_MINIMUM_LEAD_HOURS,
  VISIO_BOOKING_SPACING_MINUTES,
  VISIO_BOOKING_START_HOURS,
  chooseBalancedMember,
  getLocalDateTimeParts,
  isAllowedVisioStart,
  isMemberFree,
  parseLocalDateTime,
  visioTeamAgendaWindow,
  zonedDateTimeToUtc,
  type VisioTeamMember,
} from "../../lib/visioBookingPolicy.ts";

const members: VisioTeamMember[] = [
  { id: "oceane", name: "Océane", email: "oceane@example.com", calendarId: "oceane" },
  { id: "apolline", name: "Apolline", email: "apolline@example.com", calendarId: "apolline" },
  { id: "jimmy", name: "Jimmy", email: "jimmy@example.com", calendarId: "jimmy" },
];

test("un créneau horaire est proposé de 9 h à 18 h", () => {
  assert.deepEqual([...VISIO_BOOKING_START_HOURS], [9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
  assert.equal(VISIO_BOOKING_DURATION_MINUTES, 45);
  assert.equal(VISIO_BOOKING_SPACING_MINUTES, 60);
  assert.equal(VISIO_BOOKING_MINIMUM_LEAD_HOURS, 4);
});

test("une heure locale de Paris est convertie correctement avant et après le changement d'heure", () => {
  const winter = zonedDateTimeToUtc({ year: 2026, month: 1, day: 12, hour: 9 });
  const summer = zonedDateTimeToUtc({ year: 2026, month: 7, day: 13, hour: 9 });
  assert.equal(winter.toISOString(), "2026-01-12T08:00:00.000Z");
  assert.equal(summer.toISOString(), "2026-07-13T07:00:00.000Z");
  assert.equal(getLocalDateTimeParts(winter).hour, 9);
  assert.equal(getLocalDateTimeParts(summer).hour, 9);
});

test("la date saisie par l'admin est interprétée à Paris et les dates impossibles sont refusées", () => {
  assert.equal(
    parseLocalDateTime("2026-09-10T13:45")?.toISOString(),
    "2026-09-10T11:45:00.000Z",
  );
  assert.equal(parseLocalDateTime("2026-02-30T13:45"), null);
  assert.equal(parseLocalDateTime("2026-03-29T02:30"), null);
  assert.equal(parseLocalDateTime("not-a-date"), null);
});

test("les dimanches, horaires hors grille et créneaux à moins de quatre heures sont refusés", () => {
  const now = new Date("2026-09-04T08:00:00.000Z");
  assert.equal(
    isAllowedVisioStart({
      start: new Date("2026-09-06T07:00:00.000Z"),
      now,
      horizonDays: 21,
    }),
    false,
  );
  assert.equal(
    isAllowedVisioStart({
      start: new Date("2026-09-07T08:30:00.000Z"),
      now,
      horizonDays: 21,
    }),
    false,
  );
  assert.equal(
    isAllowedVisioStart({
      start: new Date("2026-09-04T11:00:00.000Z"),
      now,
      horizonDays: 21,
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
    }),
    false,
  );
  assert.equal(
    isAllowedVisioStart({
      start: new Date("2026-09-07T07:00:00.000Z"),
      now: saturday,
      horizonDays: 21,
    }),
    true,
  );
});

test("à 8 h à Paris, le créneau libre de 12 h est permis, mais pas celui de 11 h", () => {
  const mondayMorning = new Date("2026-09-07T06:00:00.000Z");
  assert.equal(
    isAllowedVisioStart({
      start: new Date("2026-09-07T09:00:00.000Z"),
      now: mondayMorning,
      horizonDays: 21,
    }),
    false,
  );
  assert.equal(
    isAllowedVisioStart({
      start: new Date("2026-09-07T10:00:00.000Z"),
      now: mondayMorning,
      horizonDays: 21,
    }),
    true,
  );
  assert.equal(
    isAllowedVisioStart({
      start: new Date("2026-09-07T10:00:00.000Z"),
      now: new Date("2026-09-07T06:01:00.000Z"),
      horizonDays: 21,
    }),
    false,
  );
  assert.equal(
    isAllowedVisioStart({
      start: new Date("2026-09-07T07:00:00.000Z"),
      now: new Date("2026-09-06T18:30:00.000Z"),
      horizonDays: 21,
    }),
    true,
  );
});

test("l'agenda interne commence à minuit à Paris et inclut quatorze jours futurs complets", () => {
  const window = visioTeamAgendaWindow(new Date("2026-10-24T21:30:00.000Z"), 14);
  assert.equal(window.start.toISOString(), "2026-10-23T22:00:00.000Z");
  assert.equal(window.end.toISOString(), "2026-11-07T23:00:00.000Z");
  assert.equal(getLocalDateTimeParts(window.start).day, 24);
  assert.equal(getLocalDateTimeParts(window.end).day, 8);
});

test("un rendez-vous existant dans la fenêtre d'une heure bloque la personne", () => {
  const start = new Date("2026-09-07T07:00:00.000Z");
  assert.equal(
    isMemberFree(
      members[0],
      { oceane: [{ start: "2026-09-07T07:30:00.000Z", end: "2026-09-07T08:30:00.000Z" }] },
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

test("si les trois agendas sont occupés, l'attribution autorise le chevauchement le moins chargé", () => {
  const selected = chooseBalancedMember({
    members,
    busyByCalendar: {
      oceane: [{ start: "2026-09-07T07:00:00.000Z", end: "2026-09-07T08:00:00.000Z" }],
      apolline: [{ start: "2026-09-07T07:00:00.000Z", end: "2026-09-07T08:00:00.000Z" }],
      jimmy: [{ start: "2026-09-07T07:00:00.000Z", end: "2026-09-07T08:00:00.000Z" }],
    },
    bookingCountByMember: { oceane: 3, apolline: 5, jimmy: 2 },
    bookingCountAtStartByMember: { oceane: 2, apolline: 1, jimmy: 1 },
    start: new Date("2026-09-07T07:00:00.000Z"),
  });
  assert.equal(selected?.id, "jimmy");
});
