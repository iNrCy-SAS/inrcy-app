import type { CubeKey, Overview } from "../app/dashboard/stats/stats.shared.types.ts";
import { statsCalendarMonths } from "../app/dashboard/stats/stats.months.ts";
import { monthlyMeasuredStats, commonMonthlyChange } from "../app/dashboard/stats/stats.monthly-metrics.ts";

type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const metric = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

/** The exact calendar windows and measured metrics used by Évolution mensuelle.
 * Unknown/unsupported months remain null, including the first incomplete week. */
export async function readInrAssistantStatsEvolution(options: {
  channel: CubeKey | null; read: (path: string) => Promise<unknown>; stillCurrent: () => Promise<boolean>; now?: Date;
}) {
  const keys: CubeKey[] = options.channel ? [options.channel] : ["inrbadge", "site_web", "gmb", "inr_search", "facebook", "instagram", "linkedin", "tiktok", "youtube_shorts", "pinterest", "x"];
  const periods = statsCalendarMonths(options.now);
  const needsInternal = keys.some(channel => channel === "inrbadge" || channel === "inr_search");
  const internalPromise = needsInternal ? options.read("/api/inrstats/evolution").catch(() => null) : Promise.resolve(null);
  const supported = keys.filter(channel => !["inrbadge", "inr_search", "mails", "tiktok", "x"].includes(channel));
  const include = supported.flatMap(channel => channel === "site_web" ? ["site_web_ga4", "site_web_gsc"] : [channel]).join(",");
  const months = await Promise.all(periods.map(async period => {
    const missing = Object.fromEntries(keys.map(channel => [channel, { visibility: null, clicks: null }]));
    if (period.days < 7 || !include) return { period, values: missing, loaded: true };
    try {
      const params = new URLSearchParams({ days: String(period.days), snapshotDate: period.end, include });
      const overview = await options.read(`/api/stats/overview?${params}`) as Overview;
      return { period, values: Object.fromEntries(keys.map(channel => [channel, monthlyMeasuredStats(channel, overview, period)])), loaded: true };
    } catch { return { period, values: missing, loaded: false }; }
  }));
  const internal = row(await internalPromise), counts = Array.isArray(internal.results) ? internal.results.map(row) : [];
  for (const month of months) {
    const history = counts.find(item => item.month === month.period.key);
    if (needsInternal && !history) month.loaded = false;
    for (const channel of ["inrbadge", "inr_search"] as const) if (keys.includes(channel) && history) {
      const values = row(history[channel]);
      month.values[channel] = { visibility: metric(values.visibility), clicks: metric(values.clicks) };
    }
  }
  if (!await options.stillCurrent()) return { ok: false, status: "blocked", message: "L’établissement actif a changé." };
  const changes = months.slice(1).map((after, index) => ({
    before: months[index].period.key, after: after.period.key,
    visibility: commonMonthlyChange(months[index].values, after.values, "visibility"),
    clicks: commonMonthlyChange(months[index].values, after.values, "clicks"),
  }));
  return { ok: true, status: months.every(month => month.loaded) ? "read" : "partial", source: "native_monthly_measured_stats", timezone: "Europe/Paris", months, changes,
    message: "Mêmes périodes et mesures qu’Évolution mensuelle. Le mois courant exclut aujourd’hui. Une valeur absente reste inconnue ; un taux n’est comparable que si les mêmes canaux sont mesurés. Ne pas confondre ces mesures avec l’indice de visibilité." };
}
