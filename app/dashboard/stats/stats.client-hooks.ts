"use client";

import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import {
  getClientUserFacingApiError as getSimpleFrenchApiError,
  getClientUserFacingErrorMessage as getSimpleFrenchErrorMessage,
} from "@/lib/userFacingErrors";
import { PROFILE_VERSION_EVENT, type ProfileVersionChangeDetail } from "@/lib/profileVersioning";
import { fetchSharedDashboardRefreshJson } from "@/lib/dashboardRefreshOrchestrator";
import { type DashboardChannelKey, isDashboardChannelKey } from "@/lib/dashboardChannels";
import {
  markDailyStatsRefreshBootstrapChecked,
  markServerCacheSyncChecked,
  runDailyStatsRefreshBootstrap,
  wasDailyStatsRefreshBootstrapCheckedRecently,
  wasServerCacheSyncCheckedRecently,
  type DailyStatsRefreshBootstrapResponse,
} from "@/lib/dailyStatsRefreshClient";
import {
  markChannelsSynced,
  mergeChannelBlockIntoCachedSnapshots,
  readCachedChannelSyncAt,
  syncGeneratorOpportunitiesFromStatsSummary,
  type StatsWarmPeriod,
} from "../dashboard.client-cache";
import {
  cubeSessionKey,
  expectedUiSnapshotDate,
  getLocalPeriodSyncAt,
  getOverviewSnapshotDate,
  getStatsLastChannelSyncAt,
  hasCapturedLeadsBlocks,
  hasFreshLocalPeriodSnapshot,
  parseCachedCubeSnapshot,
  parseCachedSummarySnapshot,
  readUiCacheValue,
  safeNum,
  summarySessionKey,
  writeUiCacheValue,
  type BulkFetchResult,
  type ChannelRefreshResponse,
  type CubeKey,
  type CubeState,
  type Overview,
  type Period,
  type StatsBulkResponse,
} from "./stats.shared";
import {
  channelConnectivityFromStates,
  cleanChannelIdentityHint,
  normalizeCapturedLeads,
  normalizeInrBadgeStatsSnapshot,
  normalizeInrSearchStatsSnapshot,
  normalizeMailStatsSnapshot,
  readCachedDashboardChannelConnectivity,
  readCachedDashboardChannelIdentityHints,
  writeCachedMailStats,
  type CachedChannelConnectivity,
  type ChannelIdentityHints,
  type InrBadgeStatsSnapshot,
  type InrSearchStatsSnapshot,
  type MailStatsSnapshot,
} from "./stats.client-foundations";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

type SummaryOpportunityState = {
  loading: boolean;
  total: number;
  byCube: Record<CubeKey, number>;
};

type SummaryProfileState = {
  lead_conversion_rate: number;
  avg_basket: number;
};

type RefValue<T> = { current: T };

const INR_SEARCH_ANALYTICS_POLL_MS = 120_000;

type UseStatsChannelIdentitySyncArgs = {
  refreshNonce: number;
  setChannelIdentityHints: StateSetter<ChannelIdentityHints>;
  setCachedChannelConnectivity: StateSetter<CachedChannelConnectivity>;
};

export function useStatsChannelIdentitySync({
  refreshNonce,
  setChannelIdentityHints,
  setCachedChannelConnectivity,
}: UseStatsChannelIdentitySyncArgs) {
  useEffect(() => {
    let cancelled = false;

    const cachedHints = readCachedDashboardChannelIdentityHints();
    if (Object.keys(cachedHints).length > 0) {
      setChannelIdentityHints((current) => ({ ...current, ...cachedHints }));
    }
    setCachedChannelConnectivity((current) => ({ ...current, ...readCachedDashboardChannelConnectivity() }));

    // Même source de connexion que les bulles du Dashboard. Pinterest est relu
    // en direct côté serveur afin de ne pas conserver durablement son profil.
    void fetch("/api/stats/channel-identities", {
      cache: "no-store",
      credentials: "include",
    })
      .then(async (response) => (response.ok ? response.json().catch(() => null) : null))
      .then((payload) => {
        if (cancelled || !payload?.ok || !payload?.identities) return;
        const freshHints = Object.fromEntries(
          Object.entries(payload.identities as Record<string, unknown>)
            .map(([key, value]) => [key, cleanChannelIdentityHint(value)])
            .filter(([, value]) => Boolean(value)),
        ) as ChannelIdentityHints;
        if (Object.keys(freshHints).length === 0) return;
        setChannelIdentityHints((current) => ({ ...current, ...freshHints }));
      })
      .catch(() => null);

    void fetch("/api/integrations/channel-states", {
      cache: "no-store",
      credentials: "include",
    })
      .then(async (response) => (response.ok ? response.json().catch(() => null) : null))
      .then((payload) => {
        if (cancelled || !payload) return;
        setCachedChannelConnectivity((current) => ({ ...current, ...channelConnectivityFromStates(payload) }));
      })
      .catch(() => null);

    return () => {
      cancelled = true;
    };
  }, [refreshNonce]);
}

type UseStatsDataControllerArgs = {
  period: Period;
  refreshNonce: number;
  dailyBootReady: boolean;
  isRefreshing: boolean;
  periodCacheRef: RefValue<Map<number, Record<CubeKey, Overview>>>;
  hydratedPeriodsRef: RefValue<Set<number>>;
  lastAutoRefreshAtRef: RefValue<number>;
  refreshTimeoutRef: RefValue<number | null>;
  lastServerCacheCheckAtRef: RefValue<number>;
  serverCacheCheckPromiseRef: RefValue<Promise<void> | null>;
  setDataByCube: StateSetter<Record<CubeKey, CubeState>>;
  setSummaryHydrated: StateSetter<boolean>;
  setSummaryOpp: StateSetter<SummaryOpportunityState>;
  setSummaryProfile: StateSetter<SummaryProfileState>;
  setSummaryEstimatedByCube: StateSetter<Record<CubeKey, number>>;
  setLastRefreshAt: StateSetter<number | null>;
  setIsRefreshing: StateSetter<boolean>;
  setRefreshNonce: StateSetter<number>;
  setDailyBootReady: StateSetter<boolean>;
  setMailStats: StateSetter<MailStatsSnapshot>;
  setInrBadgeStats: StateSetter<InrBadgeStatsSnapshot>;
  setInrSearchStats: StateSetter<InrSearchStatsSnapshot>;
  hydrateMailStatsFromCache: (targetPeriod: Period) => boolean;
  includeMailStats: boolean;
};

export function useStatsDataController({
  period,
  refreshNonce,
  dailyBootReady,
  isRefreshing,
  periodCacheRef,
  hydratedPeriodsRef,
  lastAutoRefreshAtRef,
  refreshTimeoutRef,
  lastServerCacheCheckAtRef,
  serverCacheCheckPromiseRef,
  setDataByCube,
  setSummaryHydrated,
  setSummaryOpp,
  setSummaryProfile,
  setSummaryEstimatedByCube,
  setLastRefreshAt,
  setIsRefreshing,
  setRefreshNonce,
  setDailyBootReady,
  setMailStats,
  setInrBadgeStats,
  setInrSearchStats,
  hydrateMailStatsFromCache,
  includeMailStats,
}: UseStatsDataControllerArgs) {
  const inrSearchStatsRequestRef = useRef<Promise<void> | null>(null);

  const applyBulkPayload = useCallback((targetPeriod: Period, next: BulkFetchResult, syncedAt: number) => {
    const snap = next.overviews as Record<CubeKey, Overview>;
    periodCacheRef.current.set(targetPeriod, snap);
    try {
      writeUiCacheValue(cubeSessionKey(targetPeriod), JSON.stringify({ syncedAt, snapshotDate: next.snapshotDate, overviews: snap, blocks: next.blocks }));
      writeUiCacheValue(
        summarySessionKey(targetPeriod),
        JSON.stringify({
          syncedAt,
          snapshotDate: next.snapshotDate,
          ...next.summary,
          profile: next.profile,
          estimatedByCube: next.estimatedByCube,
        }),
      );
      if (targetPeriod === 30) {
        syncGeneratorOpportunitiesFromStatsSummary({
          byCube: next.summary.byCube,
          estimatedByCube: next.estimatedByCube,
          profile: next.profile,
          syncedAt,
          snapshotDate: next.snapshotDate,
          channelBlocks: next.blocks,
        });
      }
    } catch {
      // ignore
    }

    if (targetPeriod !== period) return;

    setDataByCube((prev) => {
      const updated: any = { ...prev };
      for (const k of Object.keys(snap) as CubeKey[]) {
        updated[k] = {
          ov: snap[k] ?? null,
          loading: false,
          error: undefined,
          capturedLeads: normalizeCapturedLeads(next.blocks?.[k]?.capturedLeads, prev[k]?.capturedLeads),
        };
      }
      return updated;
    });
    setSummaryHydrated(true);
    setSummaryOpp({ loading: false, total: next.summary.total, byCube: next.summary.byCube });
    setSummaryProfile(next.profile);
    setSummaryEstimatedByCube(next.estimatedByCube);
    setLastRefreshAt(Date.now());
    setIsRefreshing(false);
  }, [period]);

  const applyChannelRefreshPayload = useCallback((channel: DashboardChannelKey, payload: ChannelRefreshResponse | null | undefined, fallbackSyncAt?: number) => {
    const syncAt = Number.isFinite(Number(fallbackSyncAt)) ? Number(fallbackSyncAt) : Date.now();
    let latestSyncAt = syncAt;

    for (const targetPeriod of [7, 30] as const) {
      const periodPayload = payload?.periods?.[String(targetPeriod)];
      const block = periodPayload?.block;
      if (!block || typeof block !== "object") continue;

      const periodSyncAt = Number.isFinite(Number(periodPayload?.syncedAt)) ? Number(periodPayload?.syncedAt) : (block.syncAt ?? syncAt);
      latestSyncAt = Math.max(latestSyncAt, periodSyncAt);

      mergeChannelBlockIntoCachedSnapshots({
        period: targetPeriod,
        channel,
        block,
        overview: periodPayload?.overview,
        syncedAt: periodSyncAt,
        snapshotDate: typeof periodPayload?.snapshotDate === "string" ? periodPayload.snapshotDate : block.snapshotDate ?? null,
      });

      if (targetPeriod !== period) continue;

      setDataByCube((prev) => ({
        ...prev,
        [channel]: {
          ov: ((periodPayload?.overview as Overview | undefined) ?? (block.overview as Overview | null | undefined) ?? prev[channel]?.ov ?? null),
          loading: false,
          error: block.error ?? undefined,
          capturedLeads: normalizeCapturedLeads(block.capturedLeads, prev[channel]?.capturedLeads),
        },
      }));

      const cachedSummary = parseCachedSummarySnapshot(readUiCacheValue(summarySessionKey(targetPeriod)));
      if (cachedSummary) {
        setSummaryHydrated(true);
        setSummaryOpp({
          loading: false,
          total: safeNum(cachedSummary.total),
          byCube: {
            inrbadge: 0,
            inr_search: 0,
            site_inrcy: safeNum(cachedSummary.byCube?.site_inrcy),
            site_web: safeNum(cachedSummary.byCube?.site_web),
            gmb: safeNum(cachedSummary.byCube?.gmb),
            facebook: safeNum(cachedSummary.byCube?.facebook),
            instagram: safeNum(cachedSummary.byCube?.instagram),
            linkedin: safeNum(cachedSummary.byCube?.linkedin),
            mails: 0,
            tiktok: safeNum(cachedSummary.byCube?.tiktok),
            youtube_shorts: safeNum(cachedSummary.byCube?.youtube_shorts),
            pinterest: safeNum(cachedSummary.byCube?.pinterest),
          },
        });
        setSummaryProfile({
          lead_conversion_rate: safeNum(cachedSummary.profile?.lead_conversion_rate),
          avg_basket: safeNum(cachedSummary.profile?.avg_basket),
        });
        setSummaryEstimatedByCube({
          inrbadge: 0,
          inr_search: 0,
          site_inrcy: safeNum(cachedSummary.estimatedByCube?.site_inrcy),
          site_web: safeNum(cachedSummary.estimatedByCube?.site_web),
          gmb: safeNum(cachedSummary.estimatedByCube?.gmb),
          facebook: safeNum(cachedSummary.estimatedByCube?.facebook),
          instagram: safeNum(cachedSummary.estimatedByCube?.instagram),
          linkedin: safeNum(cachedSummary.estimatedByCube?.linkedin),
          mails: 0,
          tiktok: safeNum(cachedSummary.estimatedByCube?.tiktok),
          youtube_shorts: safeNum(cachedSummary.estimatedByCube?.youtube_shorts),
          pinterest: safeNum(cachedSummary.estimatedByCube?.pinterest),
        });
      }

      if (targetPeriod === 30 && cachedSummary) {
        syncGeneratorOpportunitiesFromStatsSummary({
          byCube: {
            site_inrcy: safeNum(cachedSummary.byCube?.site_inrcy),
            site_web: safeNum(cachedSummary.byCube?.site_web),
            gmb: safeNum(cachedSummary.byCube?.gmb),
            facebook: safeNum(cachedSummary.byCube?.facebook),
            instagram: safeNum(cachedSummary.byCube?.instagram),
            linkedin: safeNum(cachedSummary.byCube?.linkedin),
            tiktok: safeNum(cachedSummary.byCube?.tiktok),
            youtube_shorts: safeNum(cachedSummary.byCube?.youtube_shorts),
            pinterest: safeNum(cachedSummary.byCube?.pinterest),
          },
          estimatedByCube: {
            site_inrcy: safeNum(cachedSummary.estimatedByCube?.site_inrcy),
            site_web: safeNum(cachedSummary.estimatedByCube?.site_web),
            gmb: safeNum(cachedSummary.estimatedByCube?.gmb),
            facebook: safeNum(cachedSummary.estimatedByCube?.facebook),
            instagram: safeNum(cachedSummary.estimatedByCube?.instagram),
            linkedin: safeNum(cachedSummary.estimatedByCube?.linkedin),
            tiktok: safeNum(cachedSummary.estimatedByCube?.tiktok),
            youtube_shorts: safeNum(cachedSummary.estimatedByCube?.youtube_shorts),
          pinterest: safeNum(cachedSummary.estimatedByCube?.pinterest),
          },
          profile: cachedSummary.profile,
          syncedAt: periodSyncAt,
          snapshotDate: typeof periodPayload?.snapshotDate === "string" ? periodPayload.snapshotDate : block.snapshotDate ?? null,
        });
      }
    }

    markChannelsSynced([channel], latestSyncAt);
    setLastRefreshAt(Date.now());
    setIsRefreshing(false);
    return latestSyncAt;
  }, [period]);

  const refreshChannelFromApi = useCallback(async (channel: DashboardChannelKey, fallbackSyncAt?: number) => {
    const json = await fetchSharedDashboardRefreshJson<ChannelRefreshResponse | null>(
      `stats-channel:${channel}`,
      "/api/stats/channel-refresh",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel }),
        cache: "no-store",
        credentials: "include",
      },
      { reuseMs: 15_000 },
    );
    return applyChannelRefreshPayload(channel, json, fallbackSyncAt);
  }, [applyChannelRefreshPayload]);

  const applyBootstrapPayload = useCallback((bootstrap: DailyStatsRefreshBootstrapResponse) => {
    const syncAt = Number.isFinite(Number(bootstrap?.syncAt)) ? Number(bootstrap.syncAt) : Date.now();
    const bootstrapSnapshotDate = typeof bootstrap?.snapshotDate === "string"
      ? bootstrap.snapshotDate
      : expectedUiSnapshotDate();

    markDailyStatsRefreshBootstrapChecked({ snapshotDate: bootstrapSnapshotDate, checkedAt: Date.now(), syncAt });

    if (!bootstrap?.ran) {
      return { syncAt, bootstrapSnapshotDate };
    }

    const generator = bootstrap.generator;

    if (generator) {
      const oppMonth = Number(generator?.details?.opportunities?.month);
      if (Number.isFinite(oppMonth)) {
        try {
          writeUiCacheValue("inrcy_opp30_total_v1", String(oppMonth));
        } catch {
          // ignore
        }
      }

      try {
        const generatorSnapshotDate = typeof generator?.meta?.snapshotDate === "string"
          ? generator.meta.snapshotDate
          : bootstrapSnapshotDate ?? null;
        writeUiCacheValue(
          "inrcy_generator_kpis_v1",
          JSON.stringify({ syncedAt: syncAt, snapshotDate: generatorSnapshotDate, payload: generator })
        );
      } catch {
        // ignore
      }
    }

    for (const [periodKey, rawPayload] of Object.entries(bootstrap.inrstats || {})) {
      const payload = rawPayload as any;
      const targetPeriod = Number(periodKey) as Period;
      const overviews = (payload?.overviews || {}) as Partial<Record<CubeKey, Overview>>;
      const payloadSnapshotDate = typeof payload?.meta?.snapshotDate === "string"
        ? payload.meta.snapshotDate
        : getOverviewSnapshotDate(overviews) || bootstrapSnapshotDate || null;
      const next: BulkFetchResult = {
        overviews,
        summary: {
          total: safeNum(payload?.opportunities?.total),
          byCube: {
            inrbadge: 0,
            inr_search: 0,
            site_inrcy: safeNum(payload?.opportunities?.byCube?.site_inrcy),
            site_web: safeNum(payload?.opportunities?.byCube?.site_web),
            gmb: safeNum(payload?.opportunities?.byCube?.gmb),
            facebook: safeNum(payload?.opportunities?.byCube?.facebook),
            instagram: safeNum(payload?.opportunities?.byCube?.instagram),
            linkedin: safeNum(payload?.opportunities?.byCube?.linkedin),
            mails: 0,
            tiktok: safeNum(payload?.opportunities?.byCube?.tiktok),
            youtube_shorts: safeNum(payload?.opportunities?.byCube?.youtube_shorts),
            pinterest: safeNum(payload?.opportunities?.byCube?.pinterest),
          },
        },
        profile: {
          lead_conversion_rate: safeNum(payload?.profile?.lead_conversion_rate),
          avg_basket: safeNum(payload?.profile?.avg_basket),
        },
        estimatedByCube: {
          inrbadge: 0,
          inr_search: 0,
          site_inrcy: safeNum(payload?.estimatedByCube?.site_inrcy),
          site_web: safeNum(payload?.estimatedByCube?.site_web),
          gmb: safeNum(payload?.estimatedByCube?.gmb),
          facebook: safeNum(payload?.estimatedByCube?.facebook),
          instagram: safeNum(payload?.estimatedByCube?.instagram),
          linkedin: safeNum(payload?.estimatedByCube?.linkedin),
          mails: 0,
          tiktok: safeNum(payload?.estimatedByCube?.tiktok),
          youtube_shorts: safeNum(payload?.estimatedByCube?.youtube_shorts),
          pinterest: safeNum(payload?.estimatedByCube?.pinterest),
        },
        blocks: payload?.blocks,
        snapshotDate: payloadSnapshotDate ?? null,
      };
      applyBulkPayload(targetPeriod, next, syncAt);
    }

    return { syncAt, bootstrapSnapshotDate };
  }, [applyBulkPayload]);

  const syncFromServerCacheIfNeeded = useCallback(async (force = false) => {
    if (typeof window === "undefined") return;
    const now = Date.now();
    const snapshotDate = expectedUiSnapshotDate();
    if (!force) {
      if (now - lastServerCacheCheckAtRef.current < 60_000) return;
      if (wasServerCacheSyncCheckedRecently("stats", { snapshotDate })) return;
    }
    if (serverCacheCheckPromiseRef.current) {
      await serverCacheCheckPromiseRef.current;
      return;
    }

    const job = (async () => {
      lastServerCacheCheckAtRef.current = now;
      try {
        const res = await fetch("/api/dashboard/cache-status", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json().catch(() => null);
        if (json?.connections?.needsRefresh === true) {
          const bootstrap = await runDailyStatsRefreshBootstrap({ announce: true, force: true });
          applyBootstrapPayload(bootstrap);
          markServerCacheSyncChecked("stats", { snapshotDate, checkedAt: Date.now(), syncAt: Number(bootstrap?.syncAt ?? Date.now()) });
          return;
        }

        const periodStatuses: Partial<Record<Period, { syncedAt?: number; channels?: Partial<Record<DashboardChannelKey, number>> }>> = {
          7: json?.inrstats?.[7] ?? json?.inrstats?.["7"] ?? null,
          30: json?.inrstats?.[30] ?? json?.inrstats?.["30"] ?? null,
        };
        const staleChannelsByPeriod = ([7, 30] as Period[]).reduce((acc, days) => {
          const channels = periodStatuses[days]?.channels;
          acc[days] = !channels || typeof channels !== "object"
            ? []
            : Object.entries(channels)
                .filter(([channel, serverTs]) => Number(serverTs ?? 0) > readCachedChannelSyncAt(days as StatsWarmPeriod, channel as DashboardChannelKey))
                .map(([channel]) => channel as DashboardChannelKey);
          return acc;
        }, {} as Partial<Record<Period, DashboardChannelKey[]>>);
        const periodsToRefresh = ([7, 30] as Period[])
          .map((days) => ({
            days,
            syncedAt: Number(periodStatuses[days]?.syncedAt ?? 0),
            staleChannels: staleChannelsByPeriod[days] || [],
          }))
          .filter((item) => item.syncedAt > getLocalPeriodSyncAt(item.days) && (getLocalPeriodSyncAt(item.days) === 0 || item.staleChannels.length === 0));
        const staleChannels = Array.from(new Set((([7, 30] as Period[])
          .filter((days) => !periodsToRefresh.some((item) => item.days === days))
          .flatMap((days) => staleChannelsByPeriod[days] || []))));

        for (const item of periodsToRefresh) {
          const next = await fetchBulkStats(item.days, false);
          applyBulkPayload(item.days, next, item.syncedAt);
        }

        for (const channel of staleChannels) {
          await refreshChannelFromApi(channel);
        }
        markServerCacheSyncChecked("stats", { snapshotDate, checkedAt: Date.now() });
      } catch {
        // ignore lightweight sync errors
      }
    })();

    serverCacheCheckPromiseRef.current = job;
    try {
      await job;
    } finally {
      serverCacheCheckPromiseRef.current = null;
    }
  }, [applyBootstrapPayload, applyBulkPayload, refreshChannelFromApi]);

  const handleSharedStatsRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setLastRefreshAt(Date.now());
    setRefreshNonce((prev) => prev + 1);

    try {
      const bootstrap = await runDailyStatsRefreshBootstrap({ announce: true, force: true });
      applyBootstrapPayload(bootstrap);

      if (!bootstrap?.ran) {
        await syncFromServerCacheIfNeeded(true);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsRefreshing(false);
    }
  }, [applyBootstrapPayload, syncFromServerCacheIfNeeded]);

  const refreshInrBadgeStats = useCallback(async () => {
    setInrBadgeStats((prev) => ({ ...prev, loading: true, error: undefined }));
    try {
      const res = await fetch("/api/inrstats/inrbadge", { cache: "no-store", credentials: "include" });
      if (!res.ok) throw new Error(await getSimpleFrenchApiError(res));
      const json = await res.json().catch(() => ({}));
      const syncedAt = Number.isFinite(Number(json?.syncedAt)) ? Number(json.syncedAt) : Date.now();
      setInrBadgeStats(normalizeInrBadgeStatsSnapshot({ ...json, loading: false }, syncedAt));
    } catch (error) {
      setInrBadgeStats((prev) => ({
        ...prev,
        loading: false,
        error: getSimpleFrenchErrorMessage(error, "Impossible de charger les données iNrBadge pour le moment."),
      }));
    }
  }, []);

  const refreshInrSearchStats = useCallback(() => {
    const existingRequest = inrSearchStatsRequestRef.current;
    if (existingRequest) return existingRequest;

    const job = (async () => {
      setInrSearchStats((prev) => ({
        ...prev,
        loading: prev.enabled ? false : true,
        error: undefined,
      }));
      try {
        const res = await fetch("/api/inr-search/analytics", { cache: "no-store", credentials: "include" });
        if (!res.ok) throw new Error(await getSimpleFrenchApiError(res));
        const json = await res.json().catch(() => ({}));
        setInrSearchStats(normalizeInrSearchStatsSnapshot(json));
      } catch (error) {
        setInrSearchStats((prev) => ({
          ...prev,
          loading: false,
          error: getSimpleFrenchErrorMessage(error, "Impossible de charger les données iNr'Search pour le moment."),
        }));
      }
    })();

    inrSearchStatsRequestRef.current = job;
    void job.finally(() => {
      if (inrSearchStatsRequestRef.current === job) {
        inrSearchStatsRequestRef.current = null;
      }
    });
    return job;
  }, []);

  const refreshMailStats = useCallback(async () => {
    if (!includeMailStats) return;
    setMailStats((prev) => ({ ...prev, loading: true, error: undefined }));
    try {
      const res = await fetch("/api/inrstats/mails", { cache: "no-store", credentials: "include" });
      if (!res.ok) throw new Error(await getSimpleFrenchApiError(res));
      const json = await res.json().catch(() => ({}));

      const syncedAt = Number.isFinite(Number(json?.syncedAt)) ? Number(json.syncedAt) : Date.now();
      const nextMailStats = normalizeMailStatsSnapshot({
        ...json,
        loading: false,
      }, syncedAt);
      writeCachedMailStats(period, nextMailStats, syncedAt);
      setMailStats(nextMailStats);
    } catch (error) {
      setMailStats((prev) => ({
        ...prev,
        loading: false,
        error: getSimpleFrenchErrorMessage(error, "Impossible de charger les données Mails pour le moment."),
      }));
    }
  }, [includeMailStats, period, setMailStats]);

  useEffect(() => {
    if (!includeMailStats) return;
    void refreshMailStats();
    const handler = () => void refreshMailStats();
    window.addEventListener("focus", handler);
    window.addEventListener("inrsend:mail-accounts-updated", handler);
    return () => {
      window.removeEventListener("focus", handler);
      window.removeEventListener("inrsend:mail-accounts-updated", handler);
    };
  }, [includeMailStats, refreshMailStats, refreshNonce]);

  useEffect(() => {
    void refreshInrBadgeStats();
    const handler = () => void refreshInrBadgeStats();
    window.addEventListener("focus", handler);
    return () => {
      window.removeEventListener("focus", handler);
    };
  }, [refreshInrBadgeStats, refreshNonce]);

  useEffect(() => {
    let intervalId: number | null = null;
    const handler = () => {
      if (document.hidden) return;
      void refreshInrSearchStats();
    };
    const stopPolling = () => {
      if (intervalId == null) return;
      window.clearInterval(intervalId);
      intervalId = null;
    };
    const startPolling = () => {
      if (intervalId != null || document.hidden) return;
      intervalId = window.setInterval(handler, INR_SEARCH_ANALYTICS_POLL_MS);
    };
    const visibilityHandler = () => {
      if (document.hidden) {
        stopPolling();
        return;
      }
      handler();
      startPolling();
    };
    if (!document.hidden) {
      handler();
      startPolling();
    }
    window.addEventListener("focus", handler);
    window.addEventListener("inrcy:inr-search-settings-updated", handler);
    document.addEventListener("visibilitychange", visibilityHandler);
    return () => {
      stopPolling();
      window.removeEventListener("focus", handler);
      window.removeEventListener("inrcy:inr-search-settings-updated", handler);
      document.removeEventListener("visibilitychange", visibilityHandler);
    };
  }, [refreshInrSearchStats, refreshNonce]);


  const hydrateFromSessionCache = useCallback((targetPeriod: Period) => {
    if (includeMailStats) hydrateMailStatsFromCache(targetPeriod);
    const lastChannelSyncAt = getStatsLastChannelSyncAt();
    const cachedCube = parseCachedCubeSnapshot(readUiCacheValue(cubeSessionKey(targetPeriod)));
    const cachedSummary = parseCachedSummarySnapshot(readUiCacheValue(summarySessionKey(targetPeriod)));
    const expectedSnapshotDate = expectedUiSnapshotDate();
    const cubeFresh = !!cachedCube?.overviews && cachedCube.syncedAt >= lastChannelSyncAt && cachedCube.snapshotDate === expectedSnapshotDate;
    const cubeBlocksFresh = hasCapturedLeadsBlocks(cachedCube?.blocks);
    const summaryFresh = !!cachedSummary && cachedSummary.syncedAt >= lastChannelSyncAt && cachedSummary.snapshotDate === expectedSnapshotDate;
    if (!cubeFresh || !cubeBlocksFresh || !summaryFresh) return false;

    periodCacheRef.current.set(targetPeriod, cachedCube.overviews);
    setDataByCube((prev) => {
      const next: any = { ...prev };
      for (const k of Object.keys(cachedCube.overviews) as CubeKey[]) {
        next[k] = {
          ov: (cachedCube.overviews as any)[k],
          loading: false,
          error: undefined,
          capturedLeads: normalizeCapturedLeads(cachedCube.blocks?.[k]?.capturedLeads, prev[k]?.capturedLeads),
        };
      }
      return next;
    });

    const byCubePartial = cachedSummary?.byCube || {};
    const estimatedByCubePartial = cachedSummary?.estimatedByCube || {};
    setSummaryHydrated(true);
    setSummaryOpp({
      loading: false,
      total: safeNum(cachedSummary?.total),
      byCube: {
        inrbadge: 0,
        inr_search: 0,
        site_inrcy: safeNum(byCubePartial.site_inrcy),
        site_web: safeNum(byCubePartial.site_web),
        gmb: safeNum(byCubePartial.gmb),
        facebook: safeNum(byCubePartial.facebook),
        instagram: safeNum(byCubePartial.instagram),
        linkedin: safeNum(byCubePartial.linkedin),
          mails: 0,
          tiktok: safeNum(byCubePartial.tiktok),
          youtube_shorts: safeNum(byCubePartial.youtube_shorts),
          pinterest: safeNum(byCubePartial.pinterest),
      },
    });
    setSummaryProfile({
      lead_conversion_rate: safeNum(cachedSummary?.profile?.lead_conversion_rate),
      avg_basket: safeNum(cachedSummary?.profile?.avg_basket),
    });
    setSummaryEstimatedByCube({
      inrbadge: 0,
      inr_search: 0,
      site_inrcy: safeNum(estimatedByCubePartial.site_inrcy),
      site_web: safeNum(estimatedByCubePartial.site_web),
      gmb: safeNum(estimatedByCubePartial.gmb),
      facebook: safeNum(estimatedByCubePartial.facebook),
      instagram: safeNum(estimatedByCubePartial.instagram),
      linkedin: safeNum(estimatedByCubePartial.linkedin),
        mails: 0,
        tiktok: safeNum(estimatedByCubePartial.tiktok),
        youtube_shorts: safeNum(estimatedByCubePartial.youtube_shorts),
      pinterest: safeNum(estimatedByCubePartial.pinterest),
    });
    return true;
  }, [hydrateMailStatsFromCache, includeMailStats]);


  const fetchBulkStats = async (period: Period, forceFresh = false): Promise<BulkFetchResult> => {
    const params = new URLSearchParams({ days: String(period) });
    const expectedSnapshotDate = expectedUiSnapshotDate();
    if (forceFresh) params.set("fresh", "1");
    if (expectedSnapshotDate) params.set("snapshotDate", expectedSnapshotDate);
    const r = await fetch(`/api/stats/dashboard-bulk?${params.toString()}`, { cache: "no-store" });
    if (!r.ok) {
      throw new Error(await getSimpleFrenchApiError(r));
    }
    const json = (await r.json()) as StatsBulkResponse;
    const overviews = (json?.overviews || {}) as Partial<Record<CubeKey, Overview>>;
    const byCubePartial = json?.opportunities?.byCube || {};
    const snapshotDate = typeof json?.meta?.snapshotDate === "string" ? json.meta.snapshotDate : getOverviewSnapshotDate(overviews) || expectedSnapshotDate;
    return {
      overviews,
      summary: {
        total: safeNum(json?.opportunities?.total),
        byCube: {
          inrbadge: 0,
          inr_search: 0,
          site_inrcy: safeNum(byCubePartial.site_inrcy),
          site_web: safeNum(byCubePartial.site_web),
          gmb: safeNum(byCubePartial.gmb),
          facebook: safeNum(byCubePartial.facebook),
          instagram: safeNum(byCubePartial.instagram),
          linkedin: safeNum(byCubePartial.linkedin),
          mails: 0,
          tiktok: safeNum(byCubePartial.tiktok),
          youtube_shorts: safeNum(byCubePartial.youtube_shorts),
          pinterest: safeNum(byCubePartial.pinterest),
        } as Record<CubeKey, number>,
      },
      profile: {
        lead_conversion_rate: safeNum(json?.profile?.lead_conversion_rate),
        avg_basket: safeNum(json?.profile?.avg_basket),
      },
      estimatedByCube: {
        inrbadge: 0,
        inr_search: 0,
        site_inrcy: safeNum(json?.estimatedByCube?.site_inrcy),
        site_web: safeNum(json?.estimatedByCube?.site_web),
        gmb: safeNum(json?.estimatedByCube?.gmb),
        facebook: safeNum(json?.estimatedByCube?.facebook),
        instagram: safeNum(json?.estimatedByCube?.instagram),
        linkedin: safeNum(json?.estimatedByCube?.linkedin),
        mails: 0,
        tiktok: safeNum(json?.estimatedByCube?.tiktok),
        youtube_shorts: safeNum(json?.estimatedByCube?.youtube_shorts),
      } as Record<CubeKey, number>,
      blocks: json?.blocks as any,
      snapshotDate: snapshotDate ?? null,
    };
  };

  useEffect(() => {
    const snapshotDate = expectedUiSnapshotDate();
    const hasFreshLocalStats = hasFreshLocalPeriodSnapshot(period);

    if (hasFreshLocalStats) {
      try {
        hydrateFromSessionCache(period);
      } catch {
        // ignore
      }
    }

    if (hasFreshLocalStats && wasDailyStatsRefreshBootstrapCheckedRecently({ snapshotDate })) {
      setDailyBootReady(true);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const bootstrap = await runDailyStatsRefreshBootstrap();
        if (cancelled) return;

        applyBootstrapPayload(bootstrap);

        if (!bootstrap.ran && !hasFreshLocalStats) {
          await syncFromServerCacheIfNeeded(true);
        }
      } catch (error) {
        console.error(error);
      } finally {
        if (!cancelled) setDailyBootReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyBootstrapPayload, hydrateFromSessionCache, period, syncFromServerCacheIfNeeded]);

  useEffect(() => {
    if (!dailyBootReady) return;
    if (hydratedPeriodsRef.current.has(period)) return;
    hydratedPeriodsRef.current.add(period);

    try {
      hydrateFromSessionCache(period);
    } catch {
      // ignore
    }
  }, [dailyBootReady, hydrateFromSessionCache, period]);

  useEffect(() => {
  if (!dailyBootReady) return;
  let cancelled = false;
  const keys: CubeKey[] = ["site_inrcy", "site_web", "gmb", "facebook", "instagram", "linkedin", "tiktok", "youtube_shorts", "pinterest"];

  (async () => {
    // Fast path: cached data for this period
    const cached = periodCacheRef.current.get(period);
    const cachedCubeSnapshot = parseCachedCubeSnapshot(readUiCacheValue(cubeSessionKey(period)));
    const lastChannelSyncAt = getStatsLastChannelSyncAt();
    const cachedSummary = parseCachedSummarySnapshot(readUiCacheValue(summarySessionKey(period)));
    const hasFreshCachedSummary = !!cachedSummary && cachedSummary.syncedAt >= lastChannelSyncAt && cachedSummary.snapshotDate === expectedUiSnapshotDate();
    const hasFreshCapturedLeads = hasCapturedLeadsBlocks(cachedCubeSnapshot?.blocks);
    if (cached && hasFreshCachedSummary && hasFreshCapturedLeads) {
      setDataByCube((prev) => {
        const next: any = { ...prev };
        for (const k of Object.keys(cached) as CubeKey[]) {
          next[k] = {
            ov: (cached as any)[k],
            loading: false,
            error: undefined,
            capturedLeads: normalizeCapturedLeads(cachedCubeSnapshot?.blocks?.[k]?.capturedLeads, prev[k]?.capturedLeads),
          };
        }
        return next;
      });
      return;
    }
    if (hydrateFromSessionCache(period)) {
      return;
    }
    if (cached && cachedSummary && hasFreshCapturedLeads) {
      setDataByCube((prev) => {
        const next: any = { ...prev };
        for (const k of Object.keys(cached) as CubeKey[]) {
          next[k] = {
            ov: (cached as any)[k],
            loading: false,
            error: undefined,
            capturedLeads: normalizeCapturedLeads(cachedCubeSnapshot?.blocks?.[k]?.capturedLeads, prev[k]?.capturedLeads),
          };
        }
        return next;
      });
      setSummaryOpp({
        loading: false,
        total: safeNum(cachedSummary.total),
        byCube: {
          inrbadge: 0,
          inr_search: 0,
          site_inrcy: safeNum(cachedSummary.byCube?.site_inrcy),
          site_web: safeNum(cachedSummary.byCube?.site_web),
          gmb: safeNum(cachedSummary.byCube?.gmb),
          facebook: safeNum(cachedSummary.byCube?.facebook),
          instagram: safeNum(cachedSummary.byCube?.instagram),
          linkedin: safeNum(cachedSummary.byCube?.linkedin),
          mails: 0,
          tiktok: safeNum(cachedSummary.byCube?.tiktok),
          youtube_shorts: safeNum(cachedSummary.byCube?.youtube_shorts),
            pinterest: safeNum(cachedSummary.byCube?.pinterest),
        },
      });
      setSummaryProfile({
        lead_conversion_rate: safeNum(cachedSummary.profile?.lead_conversion_rate),
        avg_basket: safeNum(cachedSummary.profile?.avg_basket),
      });
      setSummaryEstimatedByCube({
        inrbadge: 0,
        inr_search: 0,
        site_inrcy: safeNum(cachedSummary.estimatedByCube?.site_inrcy),
        site_web: safeNum(cachedSummary.estimatedByCube?.site_web),
        gmb: safeNum(cachedSummary.estimatedByCube?.gmb),
        facebook: safeNum(cachedSummary.estimatedByCube?.facebook),
        instagram: safeNum(cachedSummary.estimatedByCube?.instagram),
        linkedin: safeNum(cachedSummary.estimatedByCube?.linkedin),
        mails: 0,
        tiktok: safeNum(cachedSummary.estimatedByCube?.tiktok),
        youtube_shorts: safeNum(cachedSummary.estimatedByCube?.youtube_shorts),
          pinterest: safeNum(cachedSummary.estimatedByCube?.pinterest),
      });
      return;
    }

    setDataByCube((prev) => {
      const next: any = { ...prev };
      for (const k of keys) next[k] = { ...next[k], loading: true, error: undefined };
      return next;
    });
    setSummaryOpp((prev) => ({ ...prev, loading: true }));

    try {
      const next = await fetchBulkStats(period, refreshNonce > 0);
      if (cancelled) return;
      try {
        const syncedAt = Date.now();
        applyBulkPayload(period, next, syncedAt);
      } catch {}
    } catch (e: any) {
      if (cancelled) return;

      const msg = getSimpleFrenchErrorMessage(e, "Impossible de charger les statistiques pour le moment.");
      setDataByCube((prev) => {
        const updated: any = { ...prev };
        for (const k of keys) {
          updated[k] = { ...updated[k], loading: false, error: updated[k]?.ov ? undefined : msg };
        }
        return updated;
      });
      setSummaryOpp((prev) => ({ ...prev, loading: false }));
    }
  })();

  return () => {
    cancelled = true;
  };
  }, [dailyBootReady, hydrateFromSessionCache, period, refreshNonce]);

  useEffect(() => {
    if (!isRefreshing) return;
    if (refreshTimeoutRef.current) {
      window.clearTimeout(refreshTimeoutRef.current);
    }
    refreshTimeoutRef.current = window.setTimeout(() => {
      setIsRefreshing(false);
      refreshTimeoutRef.current = null;
    }, 900);

    return () => {
      if (refreshTimeoutRef.current) {
        window.clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, [isRefreshing, refreshNonce]);

  useEffect(() => {
    const runSilentSync = async (force: boolean) => {
      const now = Date.now();
      // Evite les rafales quand plusieurs evenements arrivent au retour sur iNrStats.
      if (now - lastAutoRefreshAtRef.current < 1500) return;
      lastAutoRefreshAtRef.current = now;

      // Si le cache local est deja aligne, on ne montre rien et on ne force aucun recalcul.
      if (hydrateFromSessionCache(period)) {
        setIsRefreshing(false);
        return;
      }

      // Controle serveur silencieux : pas de label "Actualisation..." pour un simple check.
      await syncFromServerCacheIfNeeded(force);
    };

    const handleChannelUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ channel?: DashboardChannelKey }>).detail;
      void runSilentSync(isDashboardChannelKey(detail?.channel));
    };

    const handleChannelsUpdated = () => {
      void runSilentSync(true);
    };

    window.addEventListener("inrcy:channel-updated", handleChannelUpdated as EventListener);
    window.addEventListener("inrcy:channels-updated", handleChannelsUpdated as EventListener);
    return () => {
      window.removeEventListener("inrcy:channel-updated", handleChannelUpdated as EventListener);
      window.removeEventListener("inrcy:channels-updated", handleChannelsUpdated as EventListener);
    };
  }, [hydrateFromSessionCache, period, syncFromServerCacheIfNeeded]);

  useEffect(() => {
    const handleProfileVersionChange = (event: Event) => {
      const detail = (event as CustomEvent<ProfileVersionChangeDetail>).detail;
      if (detail?.field !== "stats_version") return;

      // Mise a jour inter-appareil silencieuse : on garde le systeme de synchro
      // sans afficher un refresh utilisateur a chaque retour sur la page.
      void syncFromServerCacheIfNeeded(true);
    };

    window.addEventListener(PROFILE_VERSION_EVENT, handleProfileVersionChange as EventListener);
    return () => {
      window.removeEventListener(PROFILE_VERSION_EVENT, handleProfileVersionChange as EventListener);
    };
  }, [syncFromServerCacheIfNeeded]);


  useEffect(() => {
    if (!dailyBootReady) return;
    // Le cache est vérifié une fois à l'ouverture. Les événements métier et le
    // bouton de rafraîchissement restent les seuls déclencheurs suivants.
    void syncFromServerCacheIfNeeded(false);
  }, [dailyBootReady, syncFromServerCacheIfNeeded]);

  return { handleSharedStatsRefresh };
}
