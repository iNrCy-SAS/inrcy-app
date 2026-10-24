import type { CubeKey, Overview } from "./stats.shared.types.ts";

export type StatsTrendPoint = { date: string; value: number };
export type StatsTrend = { metricLabelKey: string; points: StatsTrendPoint[] };

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function metricNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function isoDay(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) return null;
  const date = value.slice(0, 10);
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

function googleBusinessPoints(metrics: Record<string, unknown>): StatsTrend | null {
  const raw = record(metrics.raw);
  const groups = raw.multiDailyMetricTimeSeries;
  if (!Array.isArray(groups)) return null;
  // The normalized GMB daily array fills missing dates with zeroes. Use raw
  // provider observations instead so missing history never looks like a drop.
  for (const [prefix, label] of [["BUSINESS_IMPRESSIONS_", "impressions_b5fb66f6"], ["WEBSITE_CLICKS", "clics_6e92c5b0"]]) {
    const byDate = new Map<string, number>();
    for (const group of groups) {
      const series = record(group).dailyMetricTimeSeries;
      if (!Array.isArray(series)) continue;
      for (const entry of series) {
        const item = record(entry);
        if (typeof item.dailyMetric !== "string" || !item.dailyMetric.startsWith(prefix)) continue;
        const dated = record(item.timeSeries).datedValues;
        if (!Array.isArray(dated)) continue;
        for (const row of dated) {
          const point = record(row);
          const dateParts = record(point.date);
          const date = isoDay(`${String(dateParts.year).padStart(4, "0")}-${String(dateParts.month).padStart(2, "0")}-${String(dateParts.day).padStart(2, "0")}`);
          const value = metricNumber(record(point.value).value ?? point.value);
          if (date && value !== null) byDate.set(date, (byDate.get(date) || 0) + value);
        }
      }
    }
    const points = [...byDate].sort(([a], [b]) => a.localeCompare(b)).slice(-60).map(([date, value]) => ({ date, value }));
    if (points.length >= 2) return { metricLabelKey: label, points };
  }
  return null;
}

/** Daily provider observations only. Missing days and missing metrics stay missing. */
export function extractStatsTrend(key: CubeKey, overview: Overview | null | undefined, connected: boolean): StatsTrend | null {
  if (!connected || !overview) return null;
  const source = record(record(overview.sources)[key]);
  const metrics = record(source.metrics);
  if (metrics.error || metrics.needs_reconnect === true) return null;
  if (key === "gmb") return googleBusinessPoints(metrics);
  if (!Array.isArray(metrics.daily)) return null;
  const choices: Array<[string, string]> = key === "facebook"
    ? [["page_media_view", "vues_ff576f2b"], ["page_views_total", "metric_page_views"], ["page_impressions", "impressions_b5fb66f6"]]
    : key === "instagram" ? [["views", "vues_ff576f2b"], ["reach", "metric_reach"], ["impressions", "impressions_b5fb66f6"]]
    : key === "youtube_shorts" ? [["views", "vues_ff576f2b"]]
    : key === "pinterest" ? [["impressions", "impressions_b5fb66f6"], ["outboundClicks", "clics_6e92c5b0"]]
    : [];

  for (const [metric, metricLabelKey] of choices) {
    const byDate = new Map<string, number>();
    for (const row of metrics.daily) {
      const item = record(row);
      const date = isoDay(item.date ?? item.day);
      const values = key === "facebook" || key === "instagram" ? record(item.values) : item;
      const value = metricNumber(values[metric]);
      if (date && value !== null) byDate.set(date, value);
    }
    const points = [...byDate].sort(([a], [b]) => a.localeCompare(b)).slice(-60).map(([date, value]) => ({ date, value }));
    if (points.length >= 2) return { metricLabelKey, points };
  }
  return null;
}

/** Compare two complete adjacent seven-day windows, never incomplete observations. */
export function statsWeeklyChange(points: readonly StatsTrendPoint[]): number | null {
  if (points.length < 14) return null;
  const recent = points.slice(-14);
  for (let i = 1; i < recent.length; i++) {
    if (Date.parse(recent[i].date) - Date.parse(recent[i - 1].date) !== 86_400_000) return null;
  }
  const before = recent.slice(0, 7).reduce((sum, point) => sum + point.value, 0);
  const after = recent.slice(7).reduce((sum, point) => sum + point.value, 0);
  return before > 0 ? (after - before) / before : null;
}

export function statsTrendSegments(points: readonly StatsTrendPoint[]): StatsTrendPoint[][] {
  const segments: StatsTrendPoint[][] = [];
  for (const point of points) {
    const current = segments.at(-1);
    if (!current || Date.parse(point.date) - Date.parse(current.at(-1)!.date) !== 86_400_000) segments.push([point]);
    else current.push(point);
  }
  return segments;
}
