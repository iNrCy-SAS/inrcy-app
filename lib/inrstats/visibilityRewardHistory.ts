import { isVisibilityDay, shiftVisibilityMonths, visibilityDay } from "./visibilityIndexSnapshots.ts";

export const HISTORICAL_REWARD_CHANNELS = ["gmb", "facebook", "instagram", "threads", "linkedin", "site_web"] as const;
export type HistoricalRewardRange = { channel_key: string; starts_on: string; ends_on: string };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const metricNames: Record<string, string[]> = {
  gmb: ["impressions", "callClicks", "websiteClicks", "directionRequests"],
  facebook: ["views", "page_media_view", "page_views_total", "reach", "post_clicks_sum"],
  instagram: ["views", "reach", "impressions", "profile_links_taps"],
  threads: ["views", "clicks", "total_interactions"],
  linkedin: ["impressions", "impressionCount", "pageViews", "clickCount", "clicks"],
  site_web: ["impressions", "pageviews", "sessions"],
};
/** A dated provider report can establish reward eligibility, never past index scores. */
export function historicalVisibilityRewardRanges(input: unknown, now = new Date()): HistoricalRewardRange[] {
  const row = object(input), meta = object(row.meta);
  const end = meta.snapshotDate, days = row.days;
  if (!isVisibilityDay(end) || typeof days !== "number" || !Number.isInteger(days) || days < 7 || days > 90 || meta.preservedReason || meta.preservedFromSnapshotDate) return [];
  const today = visibilityDay(now), cutoff = shiftVisibilityMonths(today, -12);
  if (end > today || end < cutoff) return [];
  const endDate = new Date(end + "T12:00:00Z");
  endDate.setUTCDate(endDate.getUTCDate() - days + 1);
  const start = endDate.toISOString().slice(0, 10);
  const sources = object(row.sources);
  return HISTORICAL_REWARD_CHANNELS.flatMap(channel_key => {
    const source = object(sources[channel_key]), metrics = object(source.metrics), range = object(metrics.range), totals = object(metrics.totals);
    if (source.connected !== true || metrics.error || metrics.needs_reconnect || metrics.preservedReason) return [];
    if (typeof range.since !== "string" || typeof range.until !== "string") return [];
    const since = new Date(range.since), until = new Date(range.until);
    if (!Number.isFinite(+since) || !Number.isFinite(+until) || +until <= +since) return [];
    // Provider requests use Paris midnight and an exclusive upper bound.
    if (visibilityDay(since) !== start || visibilityDay(new Date(+until - 1)) !== end) return [];
    const duration = (+until - +since) / 86_400_000;
    if (Math.abs(duration - days) > 1 / 24 + 0.001) return [];
    const available = metricNames[channel_key].some(key => {
      const value = totals[key];
      return (typeof value === "number" || typeof value === "string" && value.trim() !== "") && Number.isFinite(Number(value)) && Number(value) >= 0;
    });
    return available ? [{ channel_key, starts_on: start, ends_on: end }] : [];
  });
}

/** Calendar coverage, not number of cache rows: duplicates and gaps add no seniority. */
export function historicalVisibilityRewardMonths(ranges: readonly HistoricalRewardRange[], createdAt: string, now = new Date()): number[] {
  if (!Number.isFinite(Date.parse(createdAt))) return [];
  const created = visibilityDay(new Date(createdAt)), today = visibilityDay(now);
  const sorted = ranges.filter(r => isVisibilityDay(r.starts_on) && isVisibilityDay(r.ends_on) && r.ends_on <= today && r.starts_on <= r.ends_on)
    .map(r => ({ start: r.starts_on < created ? created : r.starts_on, end: r.ends_on }))
    .filter(r => r.start <= r.end).sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  const blocks: Array<{start: string; end: string}> = [];
  for (const row of sorted) {
    const last = blocks.at(-1), dayAfter = last ? new Date(Date.parse(last.end + "T12:00:00Z") + 86_400_000).toISOString().slice(0, 10) : "";
    if (last && row.start <= dayAfter) { if (row.end > last.end) last.end = row.end; }
    else blocks.push({ ...row });
  }
  return [1, 3, 6, 12].filter(months => shiftVisibilityMonths(created, months) <= today && blocks.some(block => {
    const exclusiveEnd = new Date(Date.parse(block.end + "T12:00:00Z") + 86_400_000).toISOString().slice(0, 10);
    return shiftVisibilityMonths(block.start, months) <= exclusiveEnd;
  }));
}

/** Smallest greedy chain of real report windows needed for a milestone check. */
export function historicalRewardReportsToVerify(ranges: readonly HistoricalRewardRange[], createdAt: string, now = new Date()): HistoricalRewardRange[] {
  const available = historicalVisibilityRewardMonths(ranges, createdAt, now);
  const months = available.at(-1);
  if (!months) return [];
  const created = visibilityDay(new Date(createdAt)), today = visibilityDay(now);
  const candidates = ranges.filter(r => isVisibilityDay(r.starts_on) && isVisibilityDay(r.ends_on) && r.ends_on <= today && r.starts_on <= r.ends_on);
  const starts = [...new Set(candidates.map(r => r.starts_on < created ? created : r.starts_on))].sort().reverse();
  for (const start of starts) {
    const until = shiftVisibilityMonths(start, months);
    const chain: HistoricalRewardRange[] = [];
    let cursor = start;
    while (cursor < until) {
      const next = candidates.filter(r => r.starts_on <= cursor && r.ends_on >= cursor).sort((a, b) => b.ends_on.localeCompare(a.ends_on) || HISTORICAL_REWARD_CHANNELS.indexOf(a.channel_key as typeof HISTORICAL_REWARD_CHANNELS[number]) - HISTORICAL_REWARD_CHANNELS.indexOf(b.channel_key as typeof HISTORICAL_REWARD_CHANNELS[number]))[0];
      if (!next) break;
      chain.push(next);
      cursor = new Date(Date.parse(next.ends_on + "T12:00:00Z") + 86_400_000).toISOString().slice(0, 10);
    }
    if (cursor >= until) return chain;
  }
  return [];
}
