"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { getActiveBrowserUserId, readAccountCacheValue, writeAccountCacheValue } from "@/lib/browserAccountCache";
import { DASHBOARD_CACHE_KEYS } from "@/lib/dashboardCacheKeys";
import { readMeasuredEvolutionCache, writeMeasuredEvolutionCache, type MeasuredEvolutionMonth } from "./stats.evolution-cache";
import { ACTIVE_INRCY_ACCOUNT_EVENT } from "@/lib/multicompte/constants";
import type { CubeKey, Overview } from "./stats.shared.types";
import { statsCalendarMonths, type MonthlyMeasuredMetrics, type StatsCalendarMonth } from "./stats.months";
import { commonMonthlyChange, monthlyMeasuredStats } from "./stats.monthly-metrics";
import css from "./statsPanorama.module.css";

type MonthResult = MeasuredEvolutionMonth;
type Props = { enabled: boolean; accountId: string; refreshKey: number; channels: Array<{ key: CubeKey; title: string }>; ready: boolean; tabs?: ReactNode; onHistoryLoaded?: () => void };
export default function StatsEvolution({ enabled, accountId, refreshKey, channels, ready, tabs, onHistoryLoaded }: Props) {
  const locale = useLocale();
  const t = useTranslations("stats");
  const [metric, setMetric] = useState<keyof MonthlyMeasuredMetrics>("visibility");
  const [channel, setChannel] = useState<CubeKey | "all">("all");
  const [requestTick, setRequestTick] = useState(0);
  const [snapshot, setSnapshot] = useState<{ scope: string; refresh: number; months: MonthResult[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const visibleScope = getActiveBrowserUserId() || accountId;
  const visible = snapshot?.scope === visibleScope && snapshot?.refresh === refreshKey ? snapshot : null;
  const periods = visible?.months.map(month => month.period) || statsCalendarMonths();
  const requestedKeys = channels.map(item => item.key).join(",");

  useEffect(() => {
    if (!accountId || (snapshot?.scope === accountId && snapshot.refresh === refreshKey)) return;
    const scope = getActiveBrowserUserId() || accountId;
    if (scope !== accountId) return;
    const windows = statsCalendarMonths();
    const cached = refreshKey === 0 && requestTick === 0
      ? readMeasuredEvolutionCache(readAccountCacheValue(DASHBOARD_CACHE_KEYS.statsEvolution, scope), scope, requestedKeys, windows)
      : null;
    if (cached) { setSnapshot({ scope, refresh: refreshKey, months: cached }); return; }
    // Both views stay mounted. Start the cold fetch as soon as the main snapshot
    // is ready, independently of which tab is currently visible.
    if (!ready) return;
    const controller = new AbortController();
    const stop = () => controller.abort();
    window.addEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, stop);
    const timeout = window.setTimeout(stop, 75_000);
    const valid = () => !controller.signal.aborted && (getActiveBrowserUserId() || accountId) === scope;
    async function load() {
      setBusy(true);
      const internalPromise = fetch("/api/inrstats/evolution", { cache: "no-store", credentials: "include", signal: controller.signal })
        .then(async response => response.ok ? response.json() : null).catch(() => null) as Promise<{ results?: Array<{ month: string; inrbadge: MonthlyMeasuredMetrics; inr_search: MonthlyMeasuredMetrics }> } | null>;
      const external = await Promise.all(windows.map(async period => {
        if (period.days < 7) return { period, values: {}, loaded: true } as MonthResult;
        try {
          const supported = requestedKeys.split(",").filter(key => !["inrbadge", "inr_search", "mails", "tiktok", "x"].includes(key));
          const include = supported.flatMap(key => key === "site_web" ? ["site_web_ga4", "site_web_gsc"] : [key]).join(",");
          if (!include) return { period, values: {}, loaded: true } as MonthResult;
          const params = new URLSearchParams({ days: String(period.days), snapshotDate: period.end, include });
          const response = await fetch(`/api/stats/overview?${params}`, { cache: "no-store", credentials: "include", signal: controller.signal });
          if (!response.ok) throw new Error("unavailable");
          const overview = await response.json() as Overview;
          return { period, loaded: true, values: Object.fromEntries(requestedKeys.split(",").map(key => [key, monthlyMeasuredStats(key as CubeKey, overview, period)])) } as MonthResult;
        } catch { return { period, values: {}, loaded: false } as MonthResult; }
      }));
      const internal = await internalPromise;
      for (const month of external) {
        const counts = internal?.results?.find(result => result.month === month.period.key);
        if (counts) { month.values.inrbadge = counts.inrbadge; month.values.inr_search = counts.inr_search; }
      }
      if (valid()) {
        setSnapshot({ scope, refresh: refreshKey, months: external });
        onHistoryLoaded?.();
        const cache = writeMeasuredEvolutionCache(scope, requestedKeys, external);
        if (cache) writeAccountCacheValue(DASHBOARD_CACHE_KEYS.statsEvolution, cache, scope);
      }
      if ((getActiveBrowserUserId() || accountId) === scope) setBusy(false);
    }
    void load();
    return () => { controller.abort(); window.clearTimeout(timeout); window.removeEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, stop); };
  }, [accountId, ready, refreshKey, requestTick, requestedKeys, snapshot, onHistoryLoaded]);

  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const monthName = (period: StatsCalendarMonth) => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${period.start}T12:00:00Z`));
  const monthly = periods.map(period => {
    const result = visible?.months.find(month => month.period.key === period.key);
    const keys = channels.map(item => item.key).filter(key => (channel === "all" || key === channel) && result?.values[key]?.[metric] !== undefined && result.values[key]![metric] !== null);
    return { period, value: keys.length ? keys.reduce((sum, key) => sum + result!.values[key]![metric]!, 0) : null, count: keys.length, values: result?.values || {} };
  });
  const maximum = Math.max(1, ...monthly.map(month => month.value || 0));
  const change = visible ? commonMonthlyChange(monthly[0].values as Record<string, MonthlyMeasuredMetrics>, monthly[1].values as Record<string, MonthlyMeasuredMetrics>, metric, channel) : null;
  const delta = change === null ? null : new Intl.NumberFormat(locale, { style: "percent", signDisplay: "exceptZero", maximumFractionDigits: 1 }).format(change);
  const metricLabel = t(metric === "visibility" ? "panorama_measured_visibility" : "clics_6e92c5b0");

  return <section className={css.evolution} hidden={!enabled} aria-label={t("panorama_evolution")} aria-busy={busy}>
    <div className={`${css.evolutionToolbar} ${css.evolutionToolbarUnified}`}><div><h2>{t("panorama_monthly_title")}</h2><p>{t("panorama_monthly_intro")}</p></div>{tabs}<div className={css.evolutionFilters}>
      <label><span>{t("canaux_27cb4473")}</span><select value={channel} onChange={event => setChannel(event.target.value as CubeKey | "all")}><option value="all">{t("panorama_all_channels")}</option>{channels.map(item => <option value={item.key} key={item.key}>{item.title}</option>)}</select></label>
      <div className={css.graphSwitch}><button type="button" aria-pressed={metric === "visibility"} onClick={() => setMetric("visibility")}>{t("panorama_measured_visibility")}</button><button type="button" aria-pressed={metric === "clicks"} onClick={() => setMetric("clicks")}>{t("clics_6e92c5b0")}</button></div>
    </div></div>
    <div className={css.monthCards}>{monthly.map((month, index) => <article key={month.period.key} data-current={month.period.current || undefined}><span className={css.monthIndex}>0{index + 1}</span><div><h3>{monthName(month.period)}</h3><span>{month.period.current ? t("panorama_current_month") : t("panorama_closed_month")}</span></div><strong>{month.value === null ? "—" : number.format(month.value)}</strong><small>{metricLabel}</small><span className={css.monthCoverage}>{t("panorama_data_channels", { count: month.count, total: channel === "all" ? channels.length : 1 })}</span></article>)}</div>
    <div className={css.monthChartPanel}>
      <div className={css.monthChartHeading}><h3>{metricLabel}</h3>{delta ? <span className={css.monthDelta} data-down={change! < 0 || undefined}>{change! < 0 ? "↘" : change! > 0 ? "↗" : "→"} {delta}<small>{t("panorama_closed_compare")}</small></span> : null}</div>
      <div className={css.monthChart} role="img" aria-label={monthly.map(month => `${monthName(month.period)} : ${month.value === null ? "—" : number.format(month.value)}`).join(" · ")}>
        {monthly.map(month => <div className={css.monthColumn} key={month.period.key} data-current={month.period.current || undefined}><div className={css.monthBarSpace}><strong>{month.value === null ? "—" : number.format(month.value)}</strong><span className={css.monthBar} style={{ height: month.value === null ? "0%" : `${month.value / maximum * 100}%` }} data-missing={month.value === null || undefined}/></div><span className={css.monthAxis}>{monthName(month.period)}</span></div>)}
      </div>
    </div>
    <footer className={css.evolutionFootnote}><span>{busy ? t("panorama_loading_months") : t("panorama_monthly_note")}</span>{!busy && (!visible || visible.months.some(month => !month.loaded)) ? <button type="button" onClick={() => { setSnapshot(null); setRequestTick(tick => tick + 1); }}>{t("refresh_now")}</button> : null}</footer>
  </section>;
}
