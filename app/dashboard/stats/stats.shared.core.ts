export function fmtInt(n: number, locale = "fr-FR") {
  return new Intl.NumberFormat(locale).format(Math.round(Number.isFinite(n) ? n : 0));
}

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function safeNum(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function safeObj(v: any): Record<string, any> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {};
}

export function sumMetricValues(metrics: any, keys: string[]) {
  const totals = safeObj(safeObj(metrics).totals);
  return keys.reduce((sum, key) => sum + safeNum(totals[key]), 0);
}

export function bestMetricValue(metrics: any, keys: string[]) {
  const totals = safeObj(safeObj(metrics).totals);
  for (const key of keys) {
    const value = safeNum(totals[key]);
    if (value > 0) return value;
  }
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(totals, key)) return safeNum(totals[key]);
  }
  return 0;
}

export function latestDailyMetricValue(metrics: any, key: string) {
  const daily = Array.isArray(metrics?.daily) ? metrics.daily : [];
  for (let index = daily.length - 1; index >= 0; index -= 1) {
    const value = safeNum(daily[index]?.values?.[key], NaN);
    if (Number.isFinite(value)) return value;
  }
  return safeNum(metrics?.totals?.[key]);
}
