import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeBusinessWeeklySchedule,
  encodeBusinessWeeklySchedule,
  formatBusinessWeeklySchedule,
  mergeBusinessWeeklySchedules,
  parseBusinessWeeklyScheduleText,
} from "../../lib/businessWeeklySchedule.ts";
import { combineOpeningSchedule } from "../../lib/openingSchedule.ts";

test("a legacy weekday sentence becomes a structured weekly schedule", () => {
  const schedule = parseBusinessWeeklyScheduleText("Du lundi au vendredi, 9h-12h et 14h-18h");
  assert.equal(schedule.days.monday.open, true);
  assert.equal(schedule.days.friday.open, true);
  assert.equal(schedule.days.saturday.open, false);
  assert.deepEqual(schedule.days.wednesday.slots, [
    { start: "09:00", end: "12:00" },
    { start: "14:00", end: "18:00" },
  ]);
});

test("7j/7 and 24h/24 round-trip without leaking the encoded payload", () => {
  const schedule = parseBusinessWeeklyScheduleText("Ouvert 7j/7 – 24h/24");
  const encoded = encodeBusinessWeeklySchedule(schedule);
  const human = formatBusinessWeeklySchedule(schedule);
  const decoded = decodeBusinessWeeklySchedule(encoded, human);

  assert.equal(decoded.days.sunday.allDay, true);
  assert.equal(human, "Ouvert 7j/7 – 24h/24");
  assert.equal(combineOpeningSchedule(encoded, human), human);
  assert.doesNotMatch(combineOpeningSchedule(encoded, human), /inrcy-weekly-v1/);
});

test("a manually configured schedule keeps its closed days during AI enrichment", () => {
  const manual = parseBusinessWeeklyScheduleText("Lundi : 9h-18h");
  const suggestion = parseBusinessWeeklyScheduleText("Du lundi au vendredi, 9h-18h");
  const merged = mergeBusinessWeeklySchedules(manual, suggestion);

  assert.equal(merged.days.monday.open, true);
  assert.equal(merged.days.tuesday.open, false);
  assert.equal(merged.days.friday.open, false);
});

test("AI schedule fills the DNA only while no schedule is configured", () => {
  const suggestion = parseBusinessWeeklyScheduleText("Du lundi au vendredi, 9h-18h");
  const merged = mergeBusinessWeeklySchedules({}, suggestion);

  assert.equal(merged.days.monday.open, true);
  assert.equal(merged.days.friday.open, true);
  assert.equal(merged.days.sunday.open, false);
});
