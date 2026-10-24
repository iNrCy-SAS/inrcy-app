import type { CubeKey, Overview } from "./stats.shared.types.ts";
import type { MonthlyMeasuredMetrics, StatsCalendarMonth } from "./stats.months.ts";
import { measuredStatsVisibility } from "./stats.visibility.ts";

const record = (input: unknown): Record<string, unknown> => input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
function numberFrom(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const raw = source[key];
    if ((typeof raw !== "number" && typeof raw !== "string") || raw === "") continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}
export function monthlyMeasuredStats(key: CubeKey, overview: Overview | null, month: StatsCalendarMonth): MonthlyMeasuredMetrics {
  const missing = { visibility: null, clicks: null };
  if (!overview || month.days < 7 || overview.meta?.snapshotDate !== month.end || overview.days !== month.days) return missing;
  const source = record(record(overview.sources)[key]);
  const metrics = record(source.metrics);
  if (key !== "site_web" && (!source.connected || metrics.error || metrics.needs_reconnect)) return missing;
  // These providers expose only current/cumulative activity in this integration.
  if (["tiktok", "x", "mails", "inrbadge", "inr_search"].includes(key)) return missing;
  const clickKeys: Partial<Record<CubeKey, string[]>> = {
    gmb: ["websiteClicks", "website_clicks"], facebook: ["page_website_clicks_logged_in_unique", "page_website_clicks", "post_clicks_sum"],
    instagram: ["profile_links_taps", "website_clicks"], threads: ["clicks"], linkedin: ["clickCount", "clicks"], pinterest: ["outbound_clicks", "pageClicks"],
  };
  const visibility = measuredStatsVisibility(key, overview);
  const clicks = key === "site_web" ? overview.sources?.site_web?.connected?.gsc ? numberFrom(record(overview.totals), ["clicks"]) : null
    : numberFrom(record(metrics.totals), clickKeys[key] || []);
  return { visibility, clicks };
}

export function commonMonthlyChange(before: Record<string, MonthlyMeasuredMetrics>, after: Record<string, MonthlyMeasuredMetrics>, metric: keyof MonthlyMeasuredMetrics, channel = "all"): number | null {
  const available = (source: Record<string, MonthlyMeasuredMetrics>) => Object.keys(source).filter(key => (channel === "all" || channel === key) && source[key][metric] !== null).sort();
  const beforeKeys = available(before), afterKeys = available(after);
  if (!beforeKeys.length || beforeKeys.join(",") !== afterKeys.join(",")) return null;
  const a = beforeKeys.reduce((sum, key) => sum + before[key][metric]!, 0);
  const b = afterKeys.reduce((sum, key) => sum + after[key][metric]!, 0);
  return a > 0 ? (b - a) / a : null;
}
