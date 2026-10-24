"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import { ACTIVE_INRCY_ACCOUNT_EVENT } from "@/lib/multicompte/constants";
import { VISIBILITY_INDEX_MODEL, type VisibilityIndexInputs } from "@/lib/inrstats/visibilityIndexModel";
import { visibilityIndexPeriodPoints, VISIBILITY_INDEX_RANGES, type VisibilityIndexSnapshot, type VisibilityIndexPeriod, type VisibilityIndexRange } from "@/lib/inrstats/visibilityIndexSnapshots";
import StatsTrendChart from "./StatsTrendChart";
import css from "./statsPanorama.module.css";

type Props = { enabled: boolean; accountId: string; refreshKey: number; ready: boolean; channels: Array<{key: string; title: string}>; tabs?: ReactNode; historyRevision?: number };
type Reward = { months: number; amount: number | null; awardedAt: string | null };
type History = { scope: string; channel: string; createdAt: string; asOf: string; records: VisibilityIndexSnapshot[]; periods: VisibilityIndexPeriod[]; rewards: Reward[] | null; refresh: number; revision: number };
const EMPTY_INPUTS: VisibilityIndexInputs = { connected: 0, audience: null, posts: null, visibility: null, contacts: null, potential: null };
function MilestoneIcon({ unlocked }: {unlocked: boolean}) {
  return unlocked ? <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 10 3 3 7-7"/></svg> : <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="8" width="12" height="9" rx="2"/><path d="M7 8V6a3 3 0 0 1 6 0v2m-3 4v2"/></svg>;
}
export default function StatsVisibilityIndex({ enabled, accountId, refreshKey, ready, channels, tabs, historyRevision = 0 }: Props) {
  const t = useTranslations("stats"), locale = useLocale();
  const [preferredRange, setPreferredRange] = useState<VisibilityIndexRange>(3);
  const [channel, setChannel] = useState("all");
  const [history, setHistory] = useState<History | null>(null);
  const [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  const browserScope = getActiveBrowserUserId() || accountId;
  const active = history?.scope === browserScope && history.channel === channel && history.refresh === refreshKey && history.revision === historyRevision ? history : null;
  useEffect(() => {
    if (!ready || !accountId || browserScope !== accountId || active) return;
    const controller = new AbortController();
    const stop = () => controller.abort();
    const timeout = window.setTimeout(() => { stop(); if ((getActiveBrowserUserId() || accountId) === accountId) setFailed(true); }, 20_000);
    window.addEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, stop);
    setFailed(false);
    void fetch(`/api/inrstats/visibility-index?channel=${encodeURIComponent(channel)}`, { cache: "no-store", credentials: "include", signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("unavailable");
      const data = await response.json() as Omit<History, "refresh" | "revision">;
      if (data.scope !== accountId || data.channel !== channel || !data.createdAt || !Number.isFinite(Date.parse(data.asOf)) || !Array.isArray(data.records) || !Array.isArray(data.periods)) throw new Error("unavailable");
      if (!controller.signal.aborted && (getActiveBrowserUserId() || accountId) === accountId) setHistory({ ...data, refresh: refreshKey, revision: historyRevision });
    }).catch(() => { if (!controller.signal.aborted && (getActiveBrowserUserId() || accountId) === accountId) setFailed(true); });
    return () => { controller.abort(); window.clearTimeout(timeout); window.removeEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, stop); };
  }, [ready, accountId, browserScope, channel, active, refreshKey, retry, historyRevision]);

  const available = active?.periods.filter(period => period.available).map(period => period.months) || [];
  const range = available.includes(preferredRange) ? preferredRange : available.includes(1) ? 1 : available[0] ?? null;
  const points = active && range ? visibilityIndexPeriodPoints(active.records, range, active.asOf) : [];
  const latest = active?.records.at(-1);
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const score = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" });
  const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Paris" });
  const periodChange = points.length > 1 && points[0].value > 0 ? (points.at(-1)!.value - points[0].value) / points[0].value : null;
  const labels = { connected: "visibility_index_channels", audience: "visibility_index_audience", posts: "visibility_index_posts", visibility: "panorama_measured_visibility", contacts: "visibility_index_contacts", potential: "visibility_index_potential" } as const;
  const waiting = !active && !failed;
  return <section className={css.visibilityIndex} hidden={!enabled} aria-label={t("visibility_index_title")} aria-busy={waiting}>
    <div className={`${css.indexHeading} ${css.evolutionToolbarUnified}`}><div><h2>{t("visibility_index_title")}</h2><p>{t("visibility_index_intro")}</p></div>{tabs}<label className={css.indexChannelFilter}><span>{t("canaux_27cb4473")}</span><select value={channel} onChange={event => setChannel(event.target.value)}><option value="all">{t("panorama_all_channels")}</option>{channels.map(item => <option key={item.key} value={item.key}>{item.title}</option>)}</select></label></div>
    <div className={css.indexTopline}><div className={css.indexPeriods} role="group" aria-label={t("visibility_index_period")}>
      {VISIBILITY_INDEX_RANGES.map(months => {
        const unlocked = available.includes(months), reward = active?.rewards?.find(item => item.months === months);
        const period = active?.periods.find(item => item.months === months);
        const future = period?.availableOn && period.availableOn > (active?.asOf.slice(0, 10) || "");
        const title = unlocked ? t("visibility_index_milestone_unlocked") : future ? t("visibility_index_unlock_date", { date: date.format(new Date(period!.availableOn! + "T12:00:00Z")) }) : t("visibility_index_history_required");
        return <button type="button" key={months} disabled={!unlocked} aria-pressed={range === months} title={title} onClick={() => setPreferredRange(months)}><span><MilestoneIcon unlocked={unlocked}/>{months === 12 ? t("visibility_index_year") : t("visibility_index_months", { count: months })}</span>{reward?.amount != null ? <small data-earned={Boolean(reward.awardedAt)}>{reward.awardedAt ? "✓" : "✦"} {t(reward.awardedAt ? "visibility_index_reward_earned" : "visibility_index_reward_goal", { amount: number.format(reward.amount) })}</small> : null}</button>;
      })}
    </div><div className={css.indexIndicators}><span>{t("visibility_index_current")}<strong>{latest ? score.format(latest.value) : "—"} <small>{t("visibility_index_points")}</small></strong></span><span>{t("visibility_index_period_change")}<strong>{periodChange === null ? "—" : percent.format(periodChange)}</strong></span><span>{t("visibility_index_channels")}<strong>{latest ? number.format(latest.inputs.connected) : "—"}</strong></span></div></div>
    <div className={css.indexChartPanel}>
      {points.length > 1 ? <><span className={css.indexModelBadge}>{t("visibility_index_recorded")}</span><StatsTrendChart key={`${range}:${channel}`} trend={{ metricLabelKey: "visibility_index_title", points }} comparison={false} fractionDigits={1} zeroBased={false} filled unitLabelKey="visibility_index_points" /></> : <div className={css.indexEmpty} role="status"><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 36V12m0 24h32M14 28l8-8 7 4 11-12"/><circle cx="40" cy="12" r="3"/></svg><strong>{failed ? t("visibility_index_unavailable") : waiting ? t("panorama_loading_months") : t("visibility_index_tracking_title")}</strong>{active ? <span>{t("visibility_index_tracking_hint")}</span> : null}{failed ? <button type="button" onClick={() => setRetry(value => value + 1)}>{t("refresh_now")}</button> : null}</div>}
    </div>
    <div className={css.indexInputs} aria-label={t("visibility_index_inputs")}>{(["connected", "audience", "posts", "visibility", "contacts", "potential"] as const).map(key => { const value = (latest?.inputs ?? EMPTY_INPUTS)[key]; return <div key={key}><span>{t(labels[key as keyof typeof labels])}</span><b>{!latest || value === null ? "—" : number.format(value)}</b></div>; })}</div>
    <footer className={css.indexFooter}><details className={css.indexMethod}><summary><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="2" width="12" height="16" rx="3"/><path d="M7 6h6M7 10h1m4 0h1m-6 4h1m4 0h1"/></svg>{t("visibility_index_method")}</summary><div><h3>{t("visibility_index_method")}</h3><p>{t("visibility_index_formula", { bonus: percent.format(VISIBILITY_INDEX_MODEL.monthlySeniorityBonus) })}</p><p>{t("visibility_index_recording_method")}</p><code>12 × C + 8 × ln(1 + A) + 10 × ln(1 + P) + 6 × ln(1 + V / 100) + 12 × ln(1 + D) + 6 × ln(1 + O)</code><p>{t("visibility_index_legend")}</p><p>{t("visibility_index_rewards_method")}</p><p>{t("visibility_index_rewards_history_method")}</p></div></details></footer>
  </section>;
}
