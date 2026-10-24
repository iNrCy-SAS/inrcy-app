import type { VisibilityIndexChannelKey } from "./visibilityIndexModel";
type CubeKey = VisibilityIndexChannelKey;

function value(source: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const candidate = source[key];
    if (typeof candidate !== "number" && typeof candidate !== "string") continue;
    if (typeof candidate === "string" && !candidate.trim()) continue;
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}
const record = (input: unknown): Record<string, unknown> => input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};

/** Relative exposure uses reported views/impressions, never opportunity scores or follower counts. */
export function measuredStatsVisibility(key: CubeKey, input: unknown): number | null {
  if (!input || typeof input !== "object") return null;
  const overview = input as { sources?: Record<string, unknown>; totals?: unknown };
  if (key === "site_web") {
    const connections = record(record(overview.sources).site_web).connected;
    return record(connections).gsc ? value(record(overview.totals), ["impressions"])
      : record(connections).ga4 ? value(record(overview.totals), ["pageviews"]) : null;
  }
  const source = record(record(overview.sources)[key]);
  if (!source.connected) return null;
  const metrics = record(source.metrics);
  if (metrics.error || metrics.needs_reconnect === true) return null;
  const totals = record(metrics.totals);
  const keys: Partial<Record<CubeKey, readonly string[]>> = {
    facebook: ["page_media_view", "post_media_view_sum", "views", "page_impressions", "post_impressions_sum", "impressions"],
    instagram: ["views", "content_views", "impressions"],
    threads: ["views"],
    linkedin: ["impressionCount", "impressions"],
    tiktok: ["video_views", "views"],
    youtube_shorts: ["views", "video_views"],
    pinterest: ["impressions", "impressionCount"],
  };
  if (key === "gmb") {
    const raw = record(metrics.raw);
    if (!Array.isArray(raw.multiDailyMetricTimeSeries)) return null;
    const reportsImpressions = raw.multiDailyMetricTimeSeries.some(group => {
      const series = record(group).dailyMetricTimeSeries;
      return Array.isArray(series) && series.some(entry => String(record(entry).dailyMetric || "").startsWith("BUSINESS_IMPRESSIONS_"));
    });
    return reportsImpressions ? value(totals, ["impressions"]) : null;
  }
  // X and Mail currently expose activity counts, not measured exposure.
  return keys[key] ? value(totals, keys[key]) : null;
}
