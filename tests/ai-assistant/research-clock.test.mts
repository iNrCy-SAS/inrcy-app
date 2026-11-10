import assert from "node:assert/strict";
import test from "node:test";
import { getInrAssistantCurrentDateTime, isInrAssistantCurrentTimeRequest, isValidInrAssistantTimeZone } from "../../lib/inrAssistantClock.ts";
import { isInrAssistantWebResearchRequest } from "../../lib/inrAssistantResearchIntent.ts";

test("trusted clock returns the correct local day and offset across Paris midnight and DST", () => {
  const winter = getInrAssistantCurrentDateTime("Europe/Paris", new Date("2026-11-10T23:30:01.000Z"));
  assert.equal(winter.source, "server_clock"); assert.equal(winter.localDate, "2026-11-11"); assert.equal(winter.localTime, "00:30:01"); assert.equal(winter.weekday, "mercredi"); assert.equal(winter.utcInstant, "2026-11-10T23:30:01.000Z"); assert.match(winter.utcOffset, /\+01:00/);
  const summer = getInrAssistantCurrentDateTime("Europe/Paris", new Date("2026-07-10T12:00:00.000Z"));
  assert.equal(summer.localTime, "14:00:00"); assert.match(summer.utcOffset, /\+02:00/);
  assert.equal(getInrAssistantCurrentDateTime("America/New_York", new Date("2026-11-10T01:00:00Z")).localDate, "2026-11-09");
});

test("clock accepts validated IANA zones and rejects invalid dates or opaque values", () => {
  for (const zone of ["Europe/Paris", "UTC", "Asia/Tokyo"]) assert.equal(isValidInrAssistantTimeZone(zone), true);
  for (const zone of ["", "Mars/Base", "Europe/Paris\n", null, {}, "x".repeat(100)]) assert.equal(isValidInrAssistantTimeZone(zone), false);
  assert.throws(() => getInrAssistantCurrentDateTime("Mars/Base"));
  assert.throws(() => getInrAssistantCurrentDateTime("Europe/Paris", new Date("invalid")));
});

test("clock and web routing distinguish current public research from private application facts", () => {
  for (const message of ["Quelle est la date du jour ?", "Quelle heure est-il ?", "On est le combien ?", "What time is it now?", "Publie aujourd’hui à 18 h."]) assert.equal(isInrAssistantCurrentTimeRequest(message), true, message);
  for (const message of ["Recherche sur Internet les nouveautés Instagram.", "Quelles sont les dernières annonces de Meta ?", "Explique pourquoi le ciel est bleu.", "La météo à Paris", "What is the latest version of React?"]) assert.equal(isInrAssistantWebResearchRequest(message), true, message);
  for (const message of ["Lis mes statistiques actuelles.", "Retrouve mes dernières publications.", "Comment modifier mon ADN dans iNrCy ?", "Quel moteur utiliser dans iNrStudio ?", "Quel moteur utiliser dans Studio ?", "Quelle est la date du jour ?"]) assert.equal(isInrAssistantWebResearchRequest(message), false, message);
});
