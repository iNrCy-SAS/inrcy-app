export const OVERVIEW_CACHE_SOURCE = "overview";
export const OVERVIEW_LAST_GOOD_SOURCE = "overview_last_good";
export const OVERVIEW_LAST_GOOD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const OVERVIEW_HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

const GMB_SIGNAL_KEYS = [
  "impressions",
  "websiteClicks",
  "website_clicks",
  "callClicks",
  "call_clicks",
  "directionRequests",
  "direction_requests",
  "conversations",
] as const;

/**
 * A normalized GMB response always contains a filled `daily` array, even when
 * Google returned an empty object. Do not treat that generated zero-filled
 * array as proof that the provider successfully returned metrics.
 */
export function hasUsableGmbMetrics(metrics: unknown) {
  const node = asRecord(metrics);
  if (!Object.keys(node).length || String(node["error"] || "").trim()) {
    return false;
  }

  const totals = asRecord(node["totals"]);
  if (GMB_SIGNAL_KEYS.some((key) => positiveNumber(totals[key]))) {
    return true;
  }

  const raw = asRecord(node["raw"]);
  const groups = Array.isArray(raw["multiDailyMetricTimeSeries"])
    ? raw["multiDailyMetricTimeSeries"]
    : [];

  // A real provider series is also a valid answer when all its values are 0.
  return groups.some((group) => {
    const series = asRecord(group)["dailyMetricTimeSeries"];
    return Array.isArray(series) && series.length > 0;
  });
}

export function isRecentOverviewCandidate(
  expiresAt: unknown,
  nowMs = Date.now(),
) {
  const expiresMs = new Date(String(expiresAt || "")).getTime();
  if (!Number.isFinite(expiresMs)) return false;
  return expiresMs >= nowMs - OVERVIEW_HISTORY_RETENTION_MS;
}
