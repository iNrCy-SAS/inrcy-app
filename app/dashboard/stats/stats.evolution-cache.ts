import type { CubeKey } from './stats.shared.types.ts';
import type { MonthlyMeasuredMetrics, StatsCalendarMonth } from './stats.months.ts';

export type MeasuredEvolutionMonth = { period: StatsCalendarMonth; values: Partial<Record<CubeKey, MonthlyMeasuredMetrics>>; loaded: boolean };
export const MEASURED_EVOLUTION_CACHE_TTL = 15 * 60 * 1000;
type Cache = { version: 1; scope: string; channels: string; savedAt: number; months: MeasuredEvolutionMonth[] };

/** A cache is usable only for this establishment and these exact calendar windows. */
export function readMeasuredEvolutionCache(raw: string | null, scope: string, channels: string, periods: StatsCalendarMonth[], now = Date.now()): MeasuredEvolutionMonth[] | null {
  if (!raw || !scope) return null;
  try {
    const data = JSON.parse(raw) as Cache;
    if (data.version !== 1 || data.scope !== scope || data.channels !== channels || !Number.isFinite(data.savedAt) || data.savedAt > now || now - data.savedAt >= MEASURED_EVOLUTION_CACHE_TTL || !Array.isArray(data.months) || data.months.length !== periods.length) return null;
    const keys = new Set(channels.split(','));
    for (let i = 0; i < periods.length; i++) {
      const month = data.months[i], period = periods[i];
      if (!month || month.loaded !== true || !month.period || Object.keys(period).some(key => month.period[key as keyof StatsCalendarMonth] !== period[key as keyof StatsCalendarMonth]) || !month.values || Array.isArray(month.values) || typeof month.values !== 'object') return null;
      for (const [key, metrics] of Object.entries(month.values)) {
        if (!keys.has(key) || !metrics || ['visibility', 'clicks'].some(metric => { const value = metrics[metric as keyof MonthlyMeasuredMetrics]; return value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0); })) return null;
      }
    }
    return data.months;
  } catch { return null; }
}

export function writeMeasuredEvolutionCache(scope: string, channels: string, months: MeasuredEvolutionMonth[], now = Date.now()): string | null {
  if (!scope || !months.length || months.some(month => !month.loaded) || !months.some(month => Object.values(month.values).some(value => value && (value.visibility !== null || value.clicks !== null)))) return null;
  return JSON.stringify({ version: 1, scope, channels, savedAt: now, months } satisfies Cache);
}
