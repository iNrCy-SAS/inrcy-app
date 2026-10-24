export type StatsCalendarMonth = { key: string; start: string; end: string; days: number; current: boolean };
export type MonthlyMeasuredMetrics = { visibility: number | null; clicks: number | null };

/** Three calendar months in the business timezone; today stays out of complete-day reports. */
export function statsCalendarMonths(now = new Date()): StatsCalendarMonth[] {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const year = Number(parts.find(part => part.type === "year")?.value);
  const month = Number(parts.find(part => part.type === "month")?.value);
  const day = Number(parts.find(part => part.type === "day")?.value);
  return [-2, -1, 0].map(offset => {
    const first = new Date(Date.UTC(year, month - 1 + offset, 1));
    const last = offset === 0 ? new Date(Date.UTC(year, month - 1, day - 1)) : new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
    return { key: first.toISOString().slice(0, 7), start: first.toISOString().slice(0, 10), end: last.toISOString().slice(0, 10), days: offset === 0 ? day - 1 : last.getUTCDate(), current: offset === 0 };
  });
}
