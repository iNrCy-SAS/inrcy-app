import { getActiveBrowserUserId, readAccountCacheValue, writeAccountCacheValue } from "@/lib/browserAccountCache";
import { DASHBOARD_CACHE_KEYS } from "@/lib/dashboardCacheKeys";
import { ACTIVE_INRCY_ACCOUNT_EVENT } from "@/lib/multicompte/constants";
import { measuredEvolutionChannelKey as channelKey, readMeasuredEvolutionCache, writeMeasuredEvolutionCache, type MeasuredEvolutionMonth } from "./stats.evolution-cache";
import { statsCalendarMonths, type MonthlyMeasuredMetrics } from "./stats.months";
import { monthlyMeasuredStats } from "./stats.monthly-metrics";
import type { CubeKey, Overview } from "./stats.shared.types";

type LoadOptions = { accountId: string; channels: string; force?: boolean };
type InternalHistory = { results?: Array<{ month: string; inrbadge: MonthlyMeasuredMetrics; inr_search: MonthlyMeasuredMetrics }> };
const pending = new Map<string, Promise<MeasuredEvolutionMonth[] | null>>();
const isActiveAccount = (accountId: string) => Boolean(accountId) && (getActiveBrowserUserId() || accountId) === accountId;

/** Same catalogue as iNr'Stats, including the account's edition and pilot access. */
export function statsEvolutionChannels(standardMode: boolean, metaPilotEnabled: boolean): string {
  const keys: CubeKey[] = ["inrbadge", "site_web", "gmb", "inr_search", "facebook", "instagram", "linkedin", "tiktok", "youtube_shorts", "pinterest", "x"];
  if (metaPilotEnabled) keys.push("threads");
  if (!standardMode) keys.push("mails");
  return channelKey(keys.join(","));
}

/** Synchronous hydration avoids rendering empty bars before the cache effect runs. */
export function readBrowserMeasuredEvolution(accountId: string, channels: string): MeasuredEvolutionMonth[] | null {
  if (!isActiveAccount(accountId)) return null;
  return readMeasuredEvolutionCache(
    readAccountCacheValue(DASHBOARD_CACHE_KEYS.statsEvolution, accountId),
    accountId, channelKey(channels), statsCalendarMonths(),
  );
}

/** Dashboard warmup and the tool share one request, scoped to the account and calendar windows. */
export function loadMeasuredEvolution({ accountId, channels, force = false }: LoadOptions): Promise<MeasuredEvolutionMonth[] | null> {
  if (!isActiveAccount(accountId)) return Promise.resolve(null);
  const requestedKeys = channelKey(channels);
  const windows = statsCalendarMonths();
  const key = `${accountId}:${requestedKeys}:${windows.map(month => `${month.start}/${month.end}`).join(",")}`;
  const cached = !force && readBrowserMeasuredEvolution(accountId, requestedKeys);
  if (cached) return Promise.resolve(cached);
  const existing = pending.get(key);
  if (existing) return existing;

  const controller = new AbortController();
  const stop = () => { controller.abort(); if (pending.get(key) === promise) pending.delete(key); };
  window.addEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, stop);
  const timeout = window.setTimeout(stop, 75_000);
  const valid = () => !controller.signal.aborted && isActiveAccount(accountId);
  const request = { cache: "no-store", credentials: "include", signal: controller.signal } as const;
  const keys = requestedKeys.split(",") as CubeKey[];

  const promise = (async () => {
    const needsInternal = keys.some(channel => channel === "inrbadge" || channel === "inr_search");
    const internalPromise: Promise<InternalHistory | null> = needsInternal
      ? fetch("/api/inrstats/evolution", request).then(response => response.ok ? response.json() : null).catch(() => null)
      : Promise.resolve(null);
    const supported = keys.filter(channel => !["inrbadge", "inr_search", "mails", "tiktok", "x"].includes(channel));
    const include = supported.flatMap(channel => channel === "site_web" ? ["site_web_ga4", "site_web_gsc"] : [channel]).join(",");
    const months = await Promise.all(windows.map(async period => {
      if (period.days < 7 || !include) return { period, values: {}, loaded: true } as MeasuredEvolutionMonth;
      try {
        const params = new URLSearchParams({ days: String(period.days), snapshotDate: period.end, include });
        const response = await fetch(`/api/stats/overview?${params}`, request);
        if (!response.ok) throw new Error("unavailable");
        const overview = await response.json() as Overview;
        return { period, loaded: true, values: Object.fromEntries(keys.map(channel => [channel, monthlyMeasuredStats(channel, overview, period)])) } as MeasuredEvolutionMonth;
      } catch { return { period, values: {}, loaded: false } as MeasuredEvolutionMonth; }
    }));
    const internal = await internalPromise;
    for (const month of months) {
      const counts = internal?.results?.find(result => result.month === month.period.key);
      if (needsInternal && !counts) month.loaded = false;
      if (counts) {
        if (keys.includes("inrbadge")) month.values.inrbadge = counts.inrbadge;
        if (keys.includes("inr_search")) month.values.inr_search = counts.inr_search;
      }
    }
    if (!valid()) return null;
    const cache = writeMeasuredEvolutionCache(accountId, requestedKeys, months);
    if (cache) writeAccountCacheValue(DASHBOARD_CACHE_KEYS.statsEvolution, cache, accountId);
    return months;
  })().finally(() => {
    window.clearTimeout(timeout);
    window.removeEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, stop);
    if (pending.get(key) === promise) pending.delete(key);
  });
  pending.set(key, promise);
  return promise;
}
