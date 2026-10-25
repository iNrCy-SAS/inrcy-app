"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import type { MeasuredEvolutionMonth } from "./stats.evolution-cache";
import { loadMeasuredEvolution, readBrowserMeasuredEvolution } from "./stats.evolution-loader";
import type { CubeKey } from "./stats.shared.types";
import { statsCalendarMonths, type MonthlyMeasuredMetrics, type StatsCalendarMonth } from "./stats.months";
import { commonMonthlyChange } from "./stats.monthly-metrics";
import css from "./statsPanorama.module.css";

type MonthResult = MeasuredEvolutionMonth;
type Snapshot = { scope: string; channels: string; refresh: number; months: MonthResult[] };
type Props = { enabled: boolean; accountId: string; refreshKey: number; channels: Array<{ key: CubeKey; title: string }>; ready: boolean; tabs?: ReactNode; onHistoryLoaded?: () => void };
export default function StatsEvolution({ enabled, accountId, refreshKey, channels, tabs, onHistoryLoaded }: Props) {
  const locale = useLocale();
  const t = useTranslations("stats");
  const [metric, setMetric] = useState<keyof MonthlyMeasuredMetrics>("visibility");
  const [channel, setChannel] = useState<CubeKey | "all">("all");
  const [requestTick, setRequestTick] = useState(0);
  const requestedKeys = channels.map(item => item.key).sort().join(",");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(() => {
    const cached = refreshKey === 0 ? readBrowserMeasuredEvolution(accountId, requestedKeys) : null;
    return cached ? { scope: accountId, channels: requestedKeys, refresh: refreshKey, months: cached } : null;
  });
  const [busy, setBusy] = useState(false);
  const visibleScope = getActiveBrowserUserId() || accountId;
  const visible = snapshot?.scope === visibleScope && snapshot.channels === requestedKeys ? snapshot : null;
  const periods = visible?.months.map(month => month.period) || statsCalendarMonths();

  useEffect(() => {
    if (!accountId) return;
    const scope = getActiveBrowserUserId() || accountId;
    if (scope !== accountId) return;
    if (snapshot?.scope === accountId && snapshot.channels === requestedKeys && snapshot.refresh === refreshKey) {
      setBusy(false);
      onHistoryLoaded?.();
      return;
    }
    const cached = refreshKey === 0 && requestTick === 0
      ? readBrowserMeasuredEvolution(scope, requestedKeys)
      : null;
    if (cached) { setSnapshot({ scope, channels: requestedKeys, refresh: refreshKey, months: cached }); return; }
    // Join the dashboard preload immediately, without waiting for the unrelated
    // overview. Keep a same-account snapshot visible during manual refresh.
    let cancelled = false;
    const valid = () => !cancelled && (getActiveBrowserUserId() || accountId) === scope;
    setBusy(true);
    void loadMeasuredEvolution({ accountId: scope, channels: requestedKeys, force: refreshKey !== 0 || requestTick !== 0 })
      .then(months => {
        if (months && valid()) setSnapshot({ scope, channels: requestedKeys, refresh: refreshKey, months });
      })
      .catch(() => undefined)
      .finally(() => { if (valid()) setBusy(false); });
    // Leaving the tool must not cancel a shared dashboard preload. The loader
    // itself aborts on account changes and never caches another account's data.
    return () => { cancelled = true; };
  }, [accountId, refreshKey, requestTick, requestedKeys, snapshot, onHistoryLoaded]);

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
