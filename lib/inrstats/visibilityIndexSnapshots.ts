import type { VisibilityIndexInputs } from "./visibilityIndexModel.ts";

export const VISIBILITY_INDEX_RANGES = [1, 3, 6, 12] as const;
export type VisibilityIndexRange = typeof VISIBILITY_INDEX_RANGES[number];
export type VisibilityIndexSnapshot = { date: string; value: number; inputs: VisibilityIndexInputs };
export type VisibilityIndexPeriod = { months: VisibilityIndexRange; available: boolean; availableOn: string | null };

export function visibilityDay(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)!.value).join("-");
}
export function isVisibilityDay(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function shiftVisibilityMonths(day: string, months: number): string {
  const date = new Date(day + "T12:00:00Z");
  const dayOfMonth = date.getUTCDate();
  date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + months);
  const max = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(dayOfMonth, max));
  return date.toISOString().slice(0, 10);
}
function dayNumber(day: string): number { return Date.parse(day + "T12:00:00Z") / 86_400_000; }
/** Keep observations only: never interpolate, invent zeroes or rebuild past scores. */
export function recordedVisibilitySnapshots(records: readonly VisibilityIndexSnapshot[], createdAt: string, asOf: string): VisibilityIndexSnapshot[] {
  const created = Date.parse(createdAt), now = Date.parse(asOf);
  if (!Number.isFinite(created) || !Number.isFinite(now) || created > now) return [];
  const first = visibilityDay(new Date(created)), last = visibilityDay(new Date(now));
  const byDay = new Map<string, VisibilityIndexSnapshot>();
  for (const row of records) {
    if (isVisibilityDay(row.date) && row.date >= first && row.date <= last && typeof row.value === "number" && Number.isFinite(row.value) && row.value >= 0) byDay.set(row.date, row);
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}
export function visibilityIndexPeriods(records: readonly VisibilityIndexSnapshot[], createdAt: string, asOf: string): VisibilityIndexPeriod[] {
  const valid = recordedVisibilitySnapshots(records, createdAt, asOf);
  const end = Number.isFinite(Date.parse(asOf)) ? visibilityDay(new Date(asOf)) : "";
  const created = Number.isFinite(Date.parse(createdAt)) ? visibilityDay(new Date(createdAt)) : "";
  return VISIBILITY_INDEX_RANGES.map(months => {
    const start = end ? shiftVisibilityMonths(end, -months) : "";
    const trackingStart = valid[0]?.date;
    const effectiveStart = trackingStart && trackingStart > start ? trackingStart : start;
    const within = valid.filter(row => row.date >= effectiveStart);
    const days = effectiveStart ? dayNumber(end) - dayNumber(effectiveStart) + 1 : 0;
    // A long gap is not a year of usable daily history. Missing dates remain gaps.
    const coverage = within.length >= Math.ceil(days * 0.8);
    const noLongGap = within.every((row, i) => i === 0 || dayNumber(row.date) - dayNumber(within[i - 1].date) <= 7);
    const available = Boolean(start && created && trackingStart && shiftVisibilityMonths(created, months) <= end && shiftVisibilityMonths(trackingStart, months) <= end && valid.length > 1 && valid.at(-1)!.date >= end && coverage && noLongGap);
    return { months, available, availableOn: trackingStart && created ? shiftVisibilityMonths(trackingStart > created ? trackingStart : created, months) : null };
  });
}
export function visibilityIndexPeriodPoints(records: readonly VisibilityIndexSnapshot[], months: VisibilityIndexRange, asOf: string) {
  const end = visibilityDay(new Date(asOf));
  const start = shiftVisibilityMonths(end, -months);
  return records.filter(row => row.date >= start && row.date <= end).map(row => ({ date: row.date, value: row.value }));
}
