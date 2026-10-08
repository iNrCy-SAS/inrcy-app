import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultPreparedDeliverySettings,
  normalizePreparedDeliverySettings,
  plannedNativeCalendar,
  preparedAdsCalendarInstant,
  preparedAdsInstant,
  preparedAdsLegacyEndInstant,
  preparedAdsLocalDateTime,
} from "../lib/adsPreparedCampaignSettings.ts";

const now = Date.parse("2026-10-08T10:00:00Z");
const total = () => ({ ...defaultPreparedDeliverySettings("total"), budget: { type: "total" as const, totalEuros: 200, startAt: "2026-10-09T07:00:00Z", endAt: "2026-10-21T21:59:00Z" } });
test("Prepared totals remain exact envelopes, independently of the legacy daily amount or duration", () => {
  const prepared = total();
  const first = plannedNativeCalendar({ preparedDeliverySettings: prepared, dailyBudgetEuros: 25, endDate: "2026-10-21" }, now, "Europe/Paris");
  const second = plannedNativeCalendar({ preparedDeliverySettings: prepared, dailyBudgetEuros: 500, endDate: "2026-11-30" }, now, "America/New_York");
  for (const calendar of [first, second]) {
    assert.equal(calendar.amountEuros, 200); assert.equal(calendar.totalEuros, 200); assert.equal(calendar.dailyEuros, null);
    assert.equal(calendar.endAt, "2026-10-21T21:59:00.000Z"); assert.equal(calendar.startAt, "2026-10-09T07:00:00.000Z");
  }
  assert.deepEqual(prepared, total());
});
test("Legacy drafts preserve daily budgets and their Paris deadline even when displayed in another timezone", () => {
  assert.deepEqual(normalizePreparedDeliverySettings(undefined), { settings: null, error: null });
  const calendar = plannedNativeCalendar({ dailyBudgetEuros: 25, endDate: "2026-10-21" }, now, "America/New_York");
  assert.equal(calendar.dailyEuros, 25); assert.equal(calendar.totalEuros, null); assert.equal(calendar.startAt, null);
  assert.equal(calendar.endAt, "2026-10-21T21:59:59.000Z");
  assert.equal(preparedAdsLocalDateTime(calendar.endAt, "America/New_York"), "2026-10-21T17:59");
});
test("Prepared calendar rejects contradictory budgets, money precision, IDs and unknown provider settings", () => {
  for (const value of [
    { ...total(), budget: { ...total().budget, type: "daily" } },
    { ...total(), budget: { ...total().budget, totalEuros: 200.001 } },
    { ...total(), budget: { ...total().budget, dailyEuros: 20 } },
    { ...total(), accountId: "invented-account" },
    { ...total(), bidding: { strategy: "automatic", amountEuros: 1 } },
    { ...total(), bidding: { strategy: "target_roas", amountEuros: 1 } },
    { ...total(), budget: { ...total().budget, totalEuros: "200" } },
  ]) assert.ok(normalizePreparedDeliverySettings(value).error, JSON.stringify(value));
  assert.throws(() => plannedNativeCalendar({ dailyBudgetEuros: 25, endDate: "2026-10-21", preparedDeliverySettings: defaultPreparedDeliverySettings("total") }, now), /enveloppe totale/);
});
test("Explicit invalid or reversed dates never fall back to the legacy deadline", () => {
  for (const endAt of ["2026-02-30T10:00:00Z", "2026-10-21T23:59:00", "2026-10-09T06:59:59Z", "2026-10-21T25:00:00Z"]) {
    const prepared = { ...total(), budget: { ...total().budget, endAt } };
    assert.ok(normalizePreparedDeliverySettings(prepared).error);
    assert.throws(() => plannedNativeCalendar({ preparedDeliverySettings: prepared, dailyBudgetEuros: 25, endDate: "2026-10-21" }, now));
  }
  assert.equal(preparedAdsInstant("2026-10-21T23:59:00+02:00"), "2026-10-21T21:59:00.000Z");
  assert.equal(preparedAdsLegacyEndInstant("2026-02-30"), null);
});
test("Time-zone conversion preserves wall-clock intent and rejects missing or ambiguous DST hours", () => {
  assert.equal(preparedAdsCalendarInstant("2026-10-09T09:00", "Europe/Paris"), "2026-10-09T07:00:00.000Z");
  assert.equal(preparedAdsCalendarInstant("2026-10-09T09:00", "America/New_York"), "2026-10-09T13:00:00.000Z");
  assert.equal(preparedAdsCalendarInstant("2026-03-29T02:30", "Europe/Paris"), null);
  assert.equal(preparedAdsCalendarInstant("2026-10-25T02:30", "Europe/Paris"), null);
  assert.equal(preparedAdsCalendarInstant("2026-04-05T01:45", "Australia/Lord_Howe"), null);
  assert.equal(preparedAdsCalendarInstant("2026-10-09T09:00", "invalid/zone"), null);
});
test("Preparation bounds reject past schedules, overlong periods and excessive maximum bids", () => {
  const draft = { dailyBudgetEuros: 25, endDate: "2026-10-21", preparedDeliverySettings: total() };
  assert.throws(() => plannedNativeCalendar({ ...draft, preparedDeliverySettings: { ...total(), budget: { ...total().budget, startAt: "2026-10-08T09:00:00Z" } } }, now), /commencer maintenant/);
  assert.throws(() => plannedNativeCalendar({ ...draft, preparedDeliverySettings: { ...total(), budget: { ...total().budget, endAt: "2027-01-07T10:00:01Z" } } }, now), /90 prochains jours/);
  assert.throws(() => plannedNativeCalendar({ ...draft, preparedDeliverySettings: { ...total(), bidding: { strategy: "max_bid", amountEuros: 201 } } }, now), /dépasser le budget/);
  assert.throws(() => plannedNativeCalendar(draft, now, "unknown/zone"), /fuseau/);
  const daily = plannedNativeCalendar({ dailyBudgetEuros: 25, endDate: "2026-10-08" }, now);
  assert.equal(daily.endAt, "2026-10-08T21:59:59.000Z");
});
test("TikTok Cost Cap keeps a positive target cost, while X retains a distinct maximum bid", () => {
  const tiktok = { ...total(), bidding: { strategy: "cost_cap" as const, amountEuros: 1.5 } };
  const x = { ...total(), bidding: { strategy: "max_bid" as const, amountEuros: 1.5 } };
  assert.equal(normalizePreparedDeliverySettings(tiktok, "tiktok").settings?.bidding.amountEuros, 1.5);
  assert.equal(normalizePreparedDeliverySettings(x, "x").settings?.bidding.amountEuros, 1.5);
  assert.match(normalizePreparedDeliverySettings(tiktok, "x").error || "", /coût cible TikTok/);
  assert.match(normalizePreparedDeliverySettings(x, "tiktok").error || "", /Cost Cap/);
  for (const amountEuros of [null, 0, -1, 1.234]) assert.ok(normalizePreparedDeliverySettings({ ...tiktok, bidding: { strategy: "cost_cap", amountEuros } }, "tiktok").error);
  assert.throws(() => plannedNativeCalendar({ provider: "tiktok", dailyBudgetEuros: 25, endDate: "2026-10-21", preparedDeliverySettings: x }, now), /Cost Cap/);
  assert.equal(plannedNativeCalendar({ provider: "tiktok", dailyBudgetEuros: 25, endDate: "2026-10-21", preparedDeliverySettings: tiktok }, now).bidding.strategy, "cost_cap");
});
