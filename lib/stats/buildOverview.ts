import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import type { StatsSourceKey } from "@/lib/googleStats";
import { encryptToken, tryDecryptToken } from "@/lib/oauthCrypto";
import { getChannelConnectionStates } from "@/lib/channelConnectionState";
import { hasActiveInrcySite } from "@/lib/inrcySite";
import { decodeBusinessSector } from "@/lib/activitySectors";
import { buildSnapshotWindow } from "@/lib/stats/snapshotWindow";
import { log } from "@/lib/observability/logger";
import { markPublishChannelReconnectRequired } from "@/lib/channelPublishDiagnostics";
import { getLinkedInAccessToken } from "@/lib/linkedinOAuth";
import { refreshTiktokAccessToken } from "@/lib/tiktokOAuth";
import { fetchTiktokAnalyticsSnapshot } from "@/lib/tiktokAnalytics";
import { fetchYoutubeMineChannel, refreshYoutubeShortsAccessToken } from "@/lib/youtubeShortsOAuth";
import { fetchYoutubeShortsAnalyticsSnapshot, mergeYoutubeShortsLocalPublicationStats } from "@/lib/youtubeShortsAnalytics";
import { loadInrcyPublishedActivityStats } from "@/lib/stats/buildOverview.activity";
import { buildOverviewConnectionsKey } from "@/lib/stats/buildOverview.connections";
import { createIntegrationResolvers } from "@/lib/stats/buildOverview.integrations";
import { createLinkedInOverviewCache } from "@/lib/stats/buildOverview.linkedinCache";
import { createOverviewLiveSourceTools } from "@/lib/stats/buildOverview.liveSources";
import {
  asRecord,
  clearTiktokReconnectMeta,
  clearTiktokStatsReconnectNeeded,
  collectLinkedInMetricErrors,
  cubeHasUsableData,
  flagTiktokStatsReconnectNeeded,
  getErrorMessage,
  getLinkedInRateLimitErrorFromMetrics,
  hasUsableLinkedInMetrics,
  isExpired,
  isStatsActiveConnection,
  isTiktokReconnectError,
  mergeCachedSourcesWithLiveState,
  mergePinterestLocalPublicationStats,
  mergeTiktokLocalPublicationStats,
  resolveRequestedCube,
  safeJsonParse,
  shouldCacheLinkedInMetrics,
  stabilizeOverviewPayload,
  stripPinterestApiMetricsFromPayload,
} from "@/lib/stats/buildOverview.shared";
import {
  OVERVIEW_CACHE_SOURCE,
  OVERVIEW_LAST_GOOD_SOURCE,
  OVERVIEW_LAST_GOOD_TTL_MS,
} from "@/lib/stats/overviewPreservation";
import type {
  OverviewPayload,
  PinterestLocalPublicationStats,
  SiteConn,
  SiteSettings,
  SourcesStatus,
  TiktokLocalPublicationStats,
  YoutubeShortsLocalPublicationStats,
} from "@/lib/stats/buildOverview.shared";

export type { OverviewPayload } from "@/lib/stats/buildOverview.shared";

export async function buildStatsOverview(args: {
  supabase: SupabaseClient;
  userId: string;
  days: number;
  includeRaw?: string;
  fresh?: boolean;
  snapshotDate?: string | null;
}): Promise<OverviewPayload> {
  const { supabase, userId, fresh = false } = args;
  const days = Math.min(Math.max(Number(args.days || 28), 7), 90);
  const includeRaw = (args.includeRaw || "").trim();
  const includeSet = new Set(
    includeRaw
      ? includeRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
  );
  const includeAll = includeSet.size === 0;

  const dateWindow = buildSnapshotWindow({
    days,
    fresh,
    snapshotDate: args.snapshotDate,
  });
  const inrcyPublishedActivityStats = await loadInrcyPublishedActivityStats({
    supabase,
    userId,
  });
  const tiktokActivity = inrcyPublishedActivityStats.tiktok;
  const tiktokLocalPublicationStats: TiktokLocalPublicationStats = {
    posts: tiktokActivity?.publications.month || 0,
    videoPosts: tiktokActivity?.videos.month || 0,
    photoPosts: tiktokActivity?.photoPosts.month || 0,
    photos: tiktokActivity?.photos.month || 0,
    latestAt: tiktokActivity?.latestAt || null,
  };
  const youtubeShortsActivity = inrcyPublishedActivityStats.youtube_shorts;
  const youtubeShortsLocalPublicationStats: YoutubeShortsLocalPublicationStats = {
    posts: youtubeShortsActivity?.publications.month || 0,
    videoPosts: youtubeShortsActivity?.videos.month || 0,
    longVideoPosts: youtubeShortsActivity?.photos.month || 0,
    latestAt: youtubeShortsActivity?.latestAt || null,
  };
  const pinterestActivity = inrcyPublishedActivityStats.pinterest;
  const pinterestLocalPublicationStats: PinterestLocalPublicationStats = {
    posts: pinterestActivity?.publications.month || 0,
    photoPosts: pinterestActivity?.photoPosts.month || 0,
    photos: pinterestActivity?.photos.month || 0,
    latestAt: pinterestActivity?.latestAt || null,
  };

  // Lazy-import server helpers inside the request scope to avoid Next.js request-scope errors.
  const {
    getGoogleTokenFor,
    runGa4Report,
    runGa4TopPages,
    runGa4Channels,
    runGscQuery,
    getGoogleTokenForAnyGoogle,
  } = await import("@/lib/googleStats");
  const { gmbFetchDailyMetricsNormalizedWithRecovery } =
    await import("@/lib/googleBusiness");
  const { igFetchDailyInsights } = await import("@/lib/metaInsights");
  const { fbFetchDailyInsights } = await import("@/lib/facebookInsights");
  const { extractFacebookUserTokens } =
    await import("@/lib/metaBusinessAssets");
  const {
    liAggregateAnalytics,
    liFetchMemberAnalytics,
    liFetchOrgAnalytics,
    liResolveFirstAdminOrgUrn,
    isLinkedInRateLimitMessage,
    getLinkedInNextUtcResetIso,
  } = await import("@/lib/linkedinAnalytics");

  // --- Load all integration rows once (avoid Supabase rate-limits) ---
  // iNrStats calls this endpoint several times; repeated per-provider selects can hit Supabase mw:read limits.
  // We fetch the minimal integration snapshot once and reuse it for connection flags + metrics.
  const { data: integrationsAll = [] } = await supabase
    .from("integrations")
    .select(
      "provider,source,product,status,resource_id,resource_label,display_name,access_token_enc,refresh_token_enc,scopes,expires_at,meta,updated_at,created_at",
    )
    .eq("user_id", userId);



  const {
    latestIntegrationAny,
    bestIntegrationAny,
    hasFacebookStoredToken,
    hasActiveStoredIntegration,
    safeGetGoogleTokenFor,
  } = createIntegrationResolvers({
    integrationsAll,
    getGoogleTokenFor,
    supabase,
    userId,
  });

  // Ownership du site iNrCy : utile pour l'UI (rented => connexion globale "Suivi")
  const { data: profileRow } = await supabase
    .from("profiles")
    .select("inrcy_site_ownership")
    .eq("user_id", userId)
    .maybeSingle();

  const inrcySiteOwnership = String(
    asRecord(profileRow)["inrcy_site_ownership"] ?? "none",
  );
  const hasInrcySite = hasActiveInrcySite(inrcySiteOwnership);

  // Load settings from the new schema:
  // - site_inrcy -> inrcy_site_configs.settings
  // - site_web -> pro_tools_configs.settings.site_web
  const [inrcyCfgRes, proCfgRes, businessProfileRes] = await Promise.all([
    supabase
      .from("inrcy_site_configs")
      .select("site_url,settings")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("pro_tools_configs")
      .select("settings")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("business_profiles")
      .select("sector")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  // NOTE: SiteSettings has only optional fields, so an empty object is a valid fallback.
  // Using `null` breaks TS in production builds (null not assignable to SiteSettings).
  const inrcySettings = safeJsonParse<SiteSettings>(
    asRecord(inrcyCfgRes.data)["settings"],
    {},
  );
  const proSettings = safeJsonParse<Record<string, unknown>>(
    asRecord(proCfgRes.data)["settings"],
    {},
  );

  const rawBusinessSector = String(
    asRecord(businessProfileRes.data)["sector"] ?? "",
  ).trim();
  const decodedBusinessSector = decodeBusinessSector(rawBusinessSector);

  // Flag: en mode rented, on peut couper uniquement la couche iNrCy (sans débrancher GA4/GSC)
  const inrcyTrackingEnabled = Boolean(
    asRecord(inrcySettings)["inrcy_tracking_enabled"] ?? true,
  );

  // --- Social connection snapshot (always computed live) ---
  // IMPORTANT: iNrStats calls the same overview endpoint with different `include=` values.
  // If we return a cached payload generated by an older version (or without social keys),
  // the UI can incorrectly show "Déconnecté" even when integrations are connected.
  // So we always (re)hydrate social connection flags from `integrations` before returning.
  // IMPORTANT:
  // Use the same direct DB resolution path as /api/integrations/channel-states.
  // The preloaded snapshot used here could diverge from the live dashboard state and
  // make iNrStats show only one site as connected when both bubbles were green.
  const channelStatesPromise = getChannelConnectionStates(supabase, userId);

  const {
    fetchLiveSourcesStatus,
    fetchPinterestMetricsLive,
    hydratePinterestMetricsOnPayload,
  } =
    createOverviewLiveSourceTools({
      channelStatesPromise,
      bestIntegrationAny,
      hasFacebookStoredToken,
      hasActiveStoredIntegration,
      userId,
      startDateYmd: dateWindow.startDateYmd,
      endDateYmd: dateWindow.endDateYmd,
      pinterestLocalPublicationStats,
      includeAll,
      includeSet,
    });

  // ---- Cache (anti-quota Google) ----
  // ⚠️ Correctif critique : la clé de cache DOIT dépendre de l'état des connexions.
  // Sinon, après une déconnexion, on peut resservir un ancien payload (ex: GMB +90) jusqu'à expiration.
  //
  // On fabrique donc un "snapshot" léger des statuts, en lisant :
  // - integrations (nouveau)
  const connectionsKey = await buildOverviewConnectionsKey({
    integrationsAll,
    inrcySettings,
    proSettings,
    inrcySiteOwnership,
    inrcySiteUrl: asRecord(inrcyCfgRes.data)["site_url"],
    inrcyTrackingEnabled,
    sectorCategory: decodedBusinessSector.sectorCategory,
    profession: decodedBusinessSector.profession,
    inrcyPublishedActivityStats,
  });
  const rangeKey = `days=${days}|include=${includeRaw || "all"}|snapshot=${dateWindow.snapshotDate || "live"}|inrcy=${inrcyTrackingEnabled ? 1 : 0}|conn=${connectionsKey}`;

  const {
    buildLinkedInMetricsCacheKey,
    buildLinkedInSourceMetricsCacheKey,
    annotateLinkedInMetrics,
    readLastGoodLinkedInMetrics,
    readLastGoodLinkedInOpportunityMetrics,
    writeLinkedInMetricsCache,
    writeLastGoodLinkedInMetricsCache,
    writeLastGoodLinkedInOpportunityCache,
    resolveLinkedInCachedMetrics,
    readLinkedInQuotaGuard,
    writeLinkedInQuotaGuard,
    isLastGoodLinkedInMetrics,
  } = createLinkedInOverviewCache({
    supabase,
    userId,
    days,
    snapshotDate: dateWindow.snapshotDate,
    getLinkedInNextUtcResetIso,
  });

  // Lecture cache (best-effort)
  if (!fresh)
    try {
      const nowIso = new Date().toISOString();
      const { data: cacheHit } = await supabase
        .from("stats_cache")
        .select("payload, expires_at")
        .eq("user_id", userId)
        .eq("source", OVERVIEW_CACHE_SOURCE)
        .eq("range_key", rangeKey)
        .gt("expires_at", nowIso)
        .order("expires_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (asRecord(cacheHit)["payload"]) {
        let payload = stripPinterestApiMetricsFromPayload(asRecord(asRecord(cacheHit)["payload"]));
        // Rehydrate all live connection flags to avoid stale/missing keys in cached payloads.
        try {
          const liveSources = await fetchLiveSourcesStatus();
          payload["sources"] = mergeCachedSourcesWithLiveState(
            payload["sources"],
            liveSources,
          );
        } catch (error) {
          log.warn("inrstats_live_connection_sync_failed", {
            user_id: userId,
            stage: "cached_overview_rehydrate",
            error_message: getErrorMessage(error).slice(0, 500),
          });
        }
        payload = await hydratePinterestMetricsOnPayload(payload);
        const stabilizedPayload = await stabilizeOverviewPayload({
          supabase,
          userId,
          days,
          includeRaw,
          includeAll,
          payload,
        });
        return stabilizedPayload as OverviewPayload;
      }
    } catch {
      // Table stats_cache non présente ou non accessible : on ignore.
    }


  // --- GA4/GSC properties ---
  // iNrCy site settings live in `inrcy_site_configs.settings` (root ga4/gsc)
  const inrcyGa4 = asRecord(asRecord(inrcySettings)["ga4"]);
  const inrcyGsc = asRecord(asRecord(inrcySettings)["gsc"]);

  // Pro "site web" settings live in `pro_tools_configs.settings.site_web`
  const proSiteWeb = asRecord(asRecord(proSettings)["site_web"]);
  const webGa4 = asRecord(proSiteWeb["ga4"]);
  const webGsc = asRecord(proSiteWeb["gsc"]);

  const sources: Array<{
    key: StatsSourceKey;
    ga4Property?: string;
    gscProperty?: string;
  }> = [
    {
      key: "site_inrcy",
      // CRITICAL BUSINESS RULE:
      // when profiles.inrcy_site_ownership = "none", the iNrCy site must be treated as non-existent.
      // We therefore ignore any stale GA4/GSC configuration still present in inrcy_site_configs.
      ga4Property: hasInrcySite
        ? String(inrcyGa4["property_id"] ?? "").trim() || undefined
        : undefined,
      gscProperty: hasInrcySite
        ? String(inrcyGsc["property"] ?? "").trim() || undefined
        : undefined,
    },
    {
      key: "site_web",
      ga4Property: String(webGa4["property_id"] ?? "").trim() || undefined,
      gscProperty: String(webGsc["property"] ?? "").trim() || undefined,
    },
  ];

  // Fetch each source (SAFE PERF): run site sources concurrently, and run GA4 calls in parallel.
  const perSource: Record<
    string,
    { ga4: unknown | null; gsc: unknown | null; connected: SiteConn }
  > = {};
  const pageAgg = new Map<string, number>();
  const channelAgg = new Map<string, number>();
  const queryAgg = new Map<
    string,
    { clicks: number; impressions: number; positionSum: number; rows: number }
  >();

  let totalUsers = 0;
  let totalSessions = 0;
  let totalPageviews = 0;

  let engagementWeighted = 0; // engagementRate * sessions
  let durationWeighted = 0; // avgSessionDuration * sessions

  let totalClicks = 0;
  let totalImpressions = 0;

  const siteResults = await Promise.all(
    sources.map(async (s) => {
      const entry: {
        ga4: unknown | null;
        gsc: unknown | null;
        connected: SiteConn;
      } = {
        ga4: null,
        gsc: null,
        connected: { ga4: false, gsc: false },
      };

      const includeGa4 =
        includeAll ||
        includeSet.has(`${s.key}_ga4`) ||
        includeSet.has(`${s.key}-ga4`);
      const includeGsc =
        includeAll ||
        includeSet.has(`${s.key}_gsc`) ||
        includeSet.has(`${s.key}-gsc`);

      const localPages = new Map<string, number>();
      const localChannels = new Map<string, number>();
      const localQueries = new Map<
        string,
        {
          clicks: number;
          impressions: number;
          positionSum: number;
          rows: number;
        }
      >();

      let users = 0;
      let sessions = 0;
      let pageviews = 0;
      let engagementW = 0;
      let durationW = 0;
      let clicksSum = 0;
      let impressionsSum = 0;

      // GA4
      if (includeGa4 && s.ga4Property) {
        const token = await safeGetGoogleTokenFor(s.key, "ga4");
        if (token?.accessToken) {
          try {
            // ✅ parallel GA4 calls (was sequential)
            const [overview, pages, channels] = await Promise.all([
              runGa4Report(token.accessToken, s.ga4Property, days, {
                start: dateWindow.start,
                end: dateWindow.end,
                startDateYmd: dateWindow.startDateYmd,
                endDateYmd: dateWindow.endDateYmd,
              }),
              runGa4TopPages(token.accessToken, s.ga4Property, days, {
                start: dateWindow.start,
                end: dateWindow.end,
                startDateYmd: dateWindow.startDateYmd,
                endDateYmd: dateWindow.endDateYmd,
              }),
              runGa4Channels(token.accessToken, s.ga4Property, days, {
                start: dateWindow.start,
                end: dateWindow.end,
                startDateYmd: dateWindow.startDateYmd,
                endDateYmd: dateWindow.endDateYmd,
              }),
            ]);

            entry.connected.ga4 = true;
            entry.ga4 = {
              propertyId: s.ga4Property,
              overview,
              pages,
              channels,
            };

            users += overview.users;
            sessions += overview.sessions;
            pageviews += overview.pageviews;
            engagementW += overview.engagementRate * overview.sessions;
            durationW += overview.avgSessionDuration * overview.sessions;

            for (const p of pages)
              localPages.set(p.path, (localPages.get(p.path) || 0) + p.views);
            for (const c of channels)
              localChannels.set(
                c.channel,
                (localChannels.get(c.channel) || 0) + c.sessions,
              );
          } catch (e) {
            entry.connected.ga4 = false;
            entry.ga4 = {
              propertyId: s.ga4Property,
              error: getSimpleFrenchErrorMessage(
                e,
                "Impossible de récupérer les statistiques GA4 pour le moment.",
              ),
            };
          }
        }
      }

      // GSC
      if (includeGsc && s.gscProperty) {
        const token = await safeGetGoogleTokenFor(s.key, "gsc");
        if (token?.accessToken) {
          try {
            const q = await runGscQuery(
              token.accessToken,
              s.gscProperty,
              days,
              {
                start: dateWindow.start,
                end: dateWindow.end,
                startDateYmd: dateWindow.startDateYmd,
                endDateYmd: dateWindow.endDateYmd,
              },
            );
            entry.connected.gsc = true;
            entry.gsc = { property: s.gscProperty, queries: q.rows };

            const rows = Array.isArray(asRecord(q)["rows"])
              ? (asRecord(q)["rows"] as unknown[])
              : [];
            for (const r of rows) {
              const rr = asRecord(r);
              const clicks = Number(rr["clicks"] ?? 0) || 0;
              const impressions = Number(rr["impressions"] ?? 0) || 0;
              const query = String(rr["query"] ?? "");
              const position = Number(rr["position"] ?? 0) || 0;

              clicksSum += clicks;
              impressionsSum += impressions;

              const cur = localQueries.get(query) || {
                clicks: 0,
                impressions: 0,
                positionSum: 0,
                rows: 0,
              };
              cur.clicks += clicks;
              cur.impressions += impressions;
              cur.positionSum += position;
              cur.rows += 1;
              localQueries.set(query, cur);
            }
          } catch (e) {
            entry.connected.gsc = false;
            entry.gsc = {
              property: s.gscProperty,
              error: getSimpleFrenchErrorMessage(
                e,
                "Impossible de récupérer les statistiques Search Console pour le moment.",
              ),
            };
          }
        }
      }

      return {
        key: s.key,
        entry,
        agg: {
          users,
          sessions,
          pageviews,
          engagementW,
          durationW,
          clicksSum,
          impressionsSum,
          localPages,
          localChannels,
          localQueries,
        },
      };
    }),
  );

  for (const r of siteResults) {
    perSource[r.key] = r.entry;
    totalUsers += r.agg.users;
    totalSessions += r.agg.sessions;
    totalPageviews += r.agg.pageviews;
    engagementWeighted += r.agg.engagementW;
    durationWeighted += r.agg.durationW;
    totalClicks += r.agg.clicksSum;
    totalImpressions += r.agg.impressionsSum;

    for (const [path, views] of r.agg.localPages.entries()) {
      pageAgg.set(path, (pageAgg.get(path) || 0) + views);
    }
    for (const [channel, sessions] of r.agg.localChannels.entries()) {
      channelAgg.set(channel, (channelAgg.get(channel) || 0) + sessions);
    }
    for (const [query, v] of r.agg.localQueries.entries()) {
      const cur = queryAgg.get(query) || {
        clicks: 0,
        impressions: 0,
        positionSum: 0,
        rows: 0,
      };
      cur.clicks += v.clicks;
      cur.impressions += v.impressions;
      cur.positionSum += v.positionSum;
      cur.rows += v.rows;
      queryAgg.set(query, cur);
    }
  }

  const engagementRate =
    totalSessions > 0 ? engagementWeighted / totalSessions : 0;
  const avgSessionDuration =
    totalSessions > 0 ? durationWeighted / totalSessions : 0;
  const ctr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;

  const topPages = Array.from(pageAgg.entries())
    .map(([path, views]) => ({ path, views }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 8);

  const channels = Array.from(channelAgg.entries())
    .map(([channel, sessions]) => ({ channel, sessions }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 6);

  const topQueries = Array.from(queryAgg.entries())
    .map(([query, v]) => ({
      query,
      clicks: v.clicks,
      impressions: v.impressions,
      ctr: v.impressions > 0 ? v.clicks / v.impressions : 0,
      position: v.rows > 0 ? v.positionSum / v.rows : 0,
    }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 8);

  // --- Connections + channel metrics ---
  const sourcesStatus: SourcesStatus = {
    site_inrcy: { connected: { ga4: false, gsc: false } },
    site_web: { connected: { ga4: false, gsc: false } },
    gmb: { connected: false, metrics: null },
    facebook: { connected: false, metrics: null },
    instagram: { connected: false, metrics: null },
    linkedin: { connected: false, metrics: null },
    tiktok: { connected: false, metrics: null },
    youtube_shorts: { connected: false, metrics: null },
    pinterest: { connected: false, metrics: null },
  };

  const channelStates = await channelStatesPromise;

  // source commune des états de connexion
  sourcesStatus.site_inrcy.connected = {
    ga4: channelStates.site_inrcy.ga4,
    gsc: channelStates.site_inrcy.gsc,
  };
  sourcesStatus.youtube_shorts.connected = isStatsActiveConnection(channelStates.youtube_shorts);
  sourcesStatus.pinterest.connected = isStatsActiveConnection(channelStates.pinterest);

  sourcesStatus.site_web.connected = {
    ga4: channelStates.site_web.ga4,
    gsc: channelStates.site_web.gsc,
  };

  // YouTube: YouTube Analytics API + Data API channel stats + publications iNrCy locales.
  try {
    const youtubeRow = bestIntegrationAny(
      "youtube",
      "youtube_shorts",
      "youtube_shorts",
      (row) => Boolean(row["access_token_enc"] || row["refresh_token_enc"]),
    );
    const youtubeStatus = String(youtubeRow["status"] || "");
    const youtubeHasAuth = Boolean(youtubeRow["access_token_enc"] || youtubeRow["refresh_token_enc"]);
    const youtubeExpiredWithoutRefresh = isExpired(youtubeRow["expires_at"]) && !youtubeRow["refresh_token_enc"];
    sourcesStatus.youtube_shorts.connected = Boolean(
      (youtubeStatus === "connected" || youtubeStatus === "account_connected") &&
        youtubeRow["resource_id"] &&
        youtubeHasAuth &&
        !youtubeExpiredWithoutRefresh,
    );

    const includeYoutubeShorts = includeAll || includeSet.has("youtube_shorts");
    if (!includeYoutubeShorts) {
      sourcesStatus.youtube_shorts.metrics = null;
    } else if (sourcesStatus.youtube_shorts.connected) {
      const meta = asRecord(youtubeRow["meta"]);
      const metaStats = asRecord(meta["stats"]);
      let youtubeChannelStats = {
        subscriberCount: Number(metaStats["subscriberCount"] ?? 0),
        videoCount: Number(metaStats["videoCount"] ?? 0),
        viewCount: Number(metaStats["viewCount"] ?? 0),
      };

      try {
        let accessToken = tryDecryptToken(String(youtubeRow["access_token_enc"] || "")) || "";
        const refreshToken = tryDecryptToken(String(youtubeRow["refresh_token_enc"] || "")) || "";

        if ((!accessToken || isExpired(youtubeRow["expires_at"])) && refreshToken) {
          const refreshed = await refreshYoutubeShortsAccessToken(refreshToken);
          const nextAccessToken = String(refreshed["access_token"] || "").trim();
          const expiresIn = Number(refreshed["expires_in"] || 0);
          const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0
            ? new Date(Date.now() + expiresIn * 1000).toISOString()
            : null;
          if (nextAccessToken) {
            await supabase
              .from("integrations")
              .update({
                access_token_enc: encryptToken(nextAccessToken),
                expires_at: expiresAt || youtubeRow["expires_at"] || null,
                meta: {
                  ...asRecord(youtubeRow["meta"]),
                  youtube_token_refreshed_at: new Date().toISOString(),
                },
                updated_at: new Date().toISOString(),
              })
              .eq("user_id", userId)
              .eq("provider", "youtube")
              .eq("source", "youtube_shorts")
              .eq("product", "youtube_shorts");
            accessToken = nextAccessToken;
          }
        }

        if (!accessToken) {
          throw new Error("Connexion YouTube expirée. Reconnecte YouTube dans Canaux.");
        }

        const liveChannel = await fetchYoutubeMineChannel(accessToken).catch(() => null);
        if (liveChannel?.stats) {
          youtubeChannelStats = {
            subscriberCount: Number(liveChannel.stats.subscriberCount ?? youtubeChannelStats.subscriberCount ?? 0),
            videoCount: Number(liveChannel.stats.videoCount ?? youtubeChannelStats.videoCount ?? 0),
            viewCount: Number(liveChannel.stats.viewCount ?? youtubeChannelStats.viewCount ?? 0),
          };
        }

        const remoteYoutubeMetrics = await fetchYoutubeShortsAnalyticsSnapshot({
          accessToken,
          start: dateWindow.start,
          end: dateWindow.end,
          channelStats: youtubeChannelStats,
        });
        sourcesStatus.youtube_shorts.metrics = mergeYoutubeShortsLocalPublicationStats(
          remoteYoutubeMetrics,
          youtubeShortsLocalPublicationStats,
        );
      } catch (e) {
        const rawMessage = e instanceof Error ? e.message : String(e || "");
        const lowerMessage = rawMessage.toLowerCase();
        const needsReconnect =
          lowerMessage.includes("scope") ||
          lowerMessage.includes("permission") ||
          lowerMessage.includes("autorisation") ||
          lowerMessage.includes("unauthorized") ||
          lowerMessage.includes("forbidden") ||
          lowerMessage.includes("access token") ||
          lowerMessage.includes("invalid_grant") ||
          lowerMessage.includes("reconnect") ||
          lowerMessage.includes("reconnecte") ||
          lowerMessage.includes("expired") ||
          lowerMessage.includes("revoked");
        const reconnectPersisted = needsReconnect
          ? await markPublishChannelReconnectRequired({
              channel: "youtube_shorts",
              userId,
              error: e,
              stage: "stats_provider_metrics",
            })
          : false;
        if (reconnectPersisted) {
          sourcesStatus.youtube_shorts.connected = false;
        }
        if (needsReconnect) {
          console.info("[youtube-stats] reconnect required", {
            code: "youtube_credentials_expired",
          });
        } else {
          console.warn("[youtube-stats] remote metrics unavailable", {
            message: rawMessage.slice(0, 500),
          });
        }
        sourcesStatus.youtube_shorts.metrics = mergeYoutubeShortsLocalPublicationStats(
          {
            totals: {
              subscribers: youtubeChannelStats.subscriberCount || 0,
              followers: youtubeChannelStats.subscriberCount || 0,
              video_count: youtubeChannelStats.videoCount || 0,
              channel_views_total: youtubeChannelStats.viewCount || 0,
            },
            error: getSimpleFrenchErrorMessage(
              e,
              "Impossible de récupérer les statistiques YouTube pour le moment.",
            ),
            raw_error: rawMessage || null,
            needs_reconnect: needsReconnect,
          },
          youtubeShortsLocalPublicationStats,
        );
      }
    } else {
      sourcesStatus.youtube_shorts.metrics = youtubeShortsLocalPublicationStats.posts > 0
        ? mergeYoutubeShortsLocalPublicationStats({}, youtubeShortsLocalPublicationStats)
        : null;
    }
  } catch {}

  // TikTok: Display API / User Info + video.list.
  // Données réelles : profil (followers/likes/vidéos) + vidéos publiques publiées sur la période.
  try {
    const tiktokRow = bestIntegrationAny(
      "tiktok",
      "tiktok",
      "tiktok",
      (row) => Boolean(row["access_token_enc"] || row["refresh_token_enc"]),
    );
    const tiktokHasAuth = Boolean(tiktokRow["access_token_enc"] || tiktokRow["refresh_token_enc"]);
    const tiktokStatus = String(tiktokRow["status"] || "");
    const tiktokExpiredWithoutRefresh = isExpired(tiktokRow["expires_at"]) && !tiktokRow["refresh_token_enc"];
    sourcesStatus.tiktok.connected = Boolean(
      (tiktokStatus === "connected" || tiktokStatus === "account_connected") &&
        tiktokRow["resource_id"] &&
        tiktokHasAuth &&
        !tiktokExpiredWithoutRefresh,
    );

    const includeTikTok = includeAll || includeSet.has("tiktok");
    if (!includeTikTok) {
      sourcesStatus.tiktok.metrics = null;
    } else if (sourcesStatus.tiktok.connected) {
      try {
        let accessToken = tryDecryptToken(String(tiktokRow["access_token_enc"] || "")) || "";
        const refreshToken = tryDecryptToken(String(tiktokRow["refresh_token_enc"] || "")) || "";

        if ((!accessToken || isExpired(tiktokRow["expires_at"])) && refreshToken) {
          const refreshed = await refreshTiktokAccessToken(refreshToken);
          const nextAccessToken = String(refreshed["access_token"] || "").trim();
          const nextRefreshToken = String(refreshed["refresh_token"] || "").trim() || refreshToken;
          const expiresIn = Number(refreshed["expires_in"] || 0);
          const refreshExpiresIn = Number(refreshed["refresh_expires_in"] || 0);
          const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0
            ? new Date(Date.now() + expiresIn * 1000).toISOString()
            : null;
          const nextMeta = clearTiktokReconnectMeta({
            ...asRecord(tiktokRow["meta"]),
            refresh_expires_at: Number.isFinite(refreshExpiresIn) && refreshExpiresIn > 0
              ? new Date(Date.now() + refreshExpiresIn * 1000).toISOString()
              : asRecord(tiktokRow["meta"])["refresh_expires_at"] || null,
            tiktok_token_refreshed_at: new Date().toISOString(),
          });

          if (nextAccessToken) {
            await supabase
              .from("integrations")
              .update({
                access_token_enc: encryptToken(nextAccessToken),
                refresh_token_enc: nextRefreshToken ? encryptToken(nextRefreshToken) : tiktokRow["refresh_token_enc"] || null,
                expires_at: expiresAt || tiktokRow["expires_at"] || null,
                meta: nextMeta,
                updated_at: new Date().toISOString(),
              })
              .eq("user_id", userId)
              .eq("provider", "tiktok")
              .eq("source", "tiktok")
              .eq("product", "tiktok");
            accessToken = nextAccessToken;
          }
        }

        if (!accessToken) {
          throw new Error("Connexion TikTok expirée. Reconnecte TikTok dans Canaux.");
        }

        const remoteTiktokMetrics = await fetchTiktokAnalyticsSnapshot({
          accessToken,
          start: dateWindow.start,
          end: dateWindow.end,
        });
        await clearTiktokStatsReconnectNeeded({ supabase, userId, tiktokRow });
        sourcesStatus.tiktok.metrics = mergeTiktokLocalPublicationStats(
          remoteTiktokMetrics,
          tiktokLocalPublicationStats,
        );
      } catch (e) {
        const rawMessage = getErrorMessage(e);
        const needsReconnect = isTiktokReconnectError(e);

        if (needsReconnect) {
          await flagTiktokStatsReconnectNeeded({ supabase, userId, tiktokRow, rawMessage });
        }

        sourcesStatus.tiktok.metrics = mergeTiktokLocalPublicationStats(
          {
            error: needsReconnect
              ? "TikTok doit être reconnecté pour récupérer les statistiques en direct."
              : getSimpleFrenchErrorMessage(
                e,
                "Impossible de récupérer les statistiques TikTok pour le moment.",
              ),
            raw_error: rawMessage || null,
            needs_reconnect: needsReconnect,
          },
          tiktokLocalPublicationStats,
        );
      }
    } else {
      sourcesStatus.tiktok.metrics = tiktokLocalPublicationStats.posts > 0
        ? mergeTiktokLocalPublicationStats({}, tiktokLocalPublicationStats)
        : null;
    }
  } catch {}

  // Pinterest: analytics réelles lues en direct, sans persistance des données API Pinterest.
  try {
    sourcesStatus.pinterest.connected = isStatsActiveConnection(channelStates.pinterest);
    const includePinterest = includeAll || includeSet.has("pinterest");
    if (!includePinterest) {
      sourcesStatus.pinterest.metrics = null;
    } else if (sourcesStatus.pinterest.connected) {
      sourcesStatus.pinterest.metrics = await fetchPinterestMetricsLive();
    } else if (pinterestLocalPublicationStats.posts > 0) {
      sourcesStatus.pinterest.metrics = mergePinterestLocalPublicationStats({}, pinterestLocalPublicationStats);
    } else {
      sourcesStatus.pinterest.metrics = null;
    }
  } catch {}

  // Facebook: connected if a page has been selected (resource_id)
  try {
    const fbRow = bestIntegrationAny(
      "facebook",
      "facebook",
      "facebook",
      hasFacebookStoredToken,
    );
    sourcesStatus.facebook.connected = hasActiveStoredIntegration(
      fbRow,
      hasFacebookStoredToken(fbRow),
    );

    // Real Facebook Page metrics (only if included)
    const includeFb = includeAll || includeSet.has("facebook");
    if (!includeFb) {
      sourcesStatus.facebook.metrics = null;
    } else if (
      sourcesStatus.facebook.connected &&
      fbRow["resource_id"] &&
      (fbRow["access_token_enc"] ||
        asRecord(fbRow["meta"])["user_access_token_enc"] ||
        asRecord(fbRow["meta"])["standard_user_access_token_enc"] ||
        asRecord(fbRow["meta"])["business_user_access_token_enc"])
    ) {
      try {
        const end = dateWindow.end;
        const start = dateWindow.start;
        const fbEncryptedToken =
          extractFacebookUserTokens(
            fbRow["meta"],
            String(fbRow["access_token_enc"] || "") || null,
          )[0] || String(fbRow["access_token_enc"] || "");
        const token = tryDecryptToken(fbEncryptedToken);
        if (!token)
          throw new Error(
            "La connexion Facebook a expiré ou n’est plus valide.",
          );
        sourcesStatus.facebook.metrics = await fbFetchDailyInsights(
          token,
          String(fbRow["resource_id"]),
          start,
          end,
        );
      } catch (e) {
        console.error("[FB_STATS_REAL_ERROR]", e);
        sourcesStatus.facebook.metrics = {
          error: e instanceof Error ? e.message : String(e),
        };
      }
    } else {
      sourcesStatus.facebook.metrics = null;
    }
  } catch {}

  // Instagram: Meta family. Connected only once a profile is selected (resource_id).
  try {
    const igRow = bestIntegrationAny(
      "instagram",
      "instagram",
      "instagram",
      (row) => Boolean(row["access_token_enc"]),
    );
    sourcesStatus.instagram.connected = hasActiveStoredIntegration(
      igRow,
      Boolean(igRow["access_token_enc"]),
    );

    const includeIg = includeAll || includeSet.has("instagram");
    if (!includeIg) {
      sourcesStatus.instagram.metrics = null;
    } else if (
      sourcesStatus.instagram.connected &&
      igRow["resource_id"] &&
      igRow["access_token_enc"]
    ) {
      try {
        const end = dateWindow.end;
        const start = dateWindow.start;
        const token = tryDecryptToken(String(igRow["access_token_enc"]));
        if (!token)
          throw new Error(
            "La connexion Instagram a expiré ou n’est plus valide.",
          );
        const baseMetrics = await igFetchDailyInsights(
          token,
          String(igRow["resource_id"]),
          start,
          end,
        );
        if (!baseMetrics)
          throw new Error(
            "Impossible de récupérer les statistiques Instagram pour le moment.",
          );
        sourcesStatus.instagram.metrics = {
          ...baseMetrics,
          raw: {
            ...(baseMetrics.raw || {}),
            supportedMetrics: {
              account: Array.isArray(baseMetrics.raw?.supportedMetrics?.account)
                ? baseMetrics.raw.supportedMetrics.account
                : [],
              media: [],
            },
            unsupportedMetrics: {
              account: Array.isArray(
                baseMetrics.raw?.unsupportedMetrics?.account,
              )
                ? baseMetrics.raw.unsupportedMetrics.account
                : [],
              media: [],
            },
            metricErrors: {
              account: baseMetrics.raw?.metricErrors?.account || {},
              media: {},
            },
            mediaInsights: { error: "skipped_for_fast_refresh" },
          },
        };
      } catch (e) {
        console.error("[IG_STATS_REAL_ERROR]", e);
        sourcesStatus.instagram.metrics = {
          error: e instanceof Error ? e.message : String(e),
        };
      }
    } else {
      sourcesStatus.instagram.metrics = null;
    }
  } catch {}

  // LinkedIn: connected if an OAuth row exists.
  try {
    sourcesStatus.linkedin.connected = isStatsActiveConnection(
      channelStates.linkedin,
    );

    const includeLi = includeAll || includeSet.has("linkedin");
    if (!includeLi) {
      sourcesStatus.linkedin.metrics = null;
    } else if (sourcesStatus.linkedin.connected) {
      try {
        const auth = await getLinkedInAccessToken({ userId });
        const token = auth.accessToken;
        if (!token)
          throw new Error(
            auth.error ||
              "La connexion LinkedIn a expiré ou n’est plus valide.",
          );
        let orgUrn = auth.orgUrn || "";
        const authorUrn = auth.authorUrn || "";
        const end = dateWindow.end;
        const start = dateWindow.start;

        // Si aucun URN n'est persistant, on résout l'organisation seulement si aucun
        // guard quota n'est actif, pour éviter un appel inutile pendant le blocage LinkedIn.
        const preliminaryCacheKey = buildLinkedInMetricsCacheKey(authorUrn, orgUrn);
        const preliminaryCached = await resolveLinkedInCachedMetrics(
          preliminaryCacheKey,
          authorUrn,
          orgUrn,
        );
        const quotaGuard = await readLinkedInQuotaGuard();

        if (preliminaryCached) {
          sourcesStatus.linkedin.metrics = annotateLinkedInMetrics(
            preliminaryCached.metrics,
            preliminaryCached.mode,
          );
        } else if (quotaGuard) {
          const lastGood = await readLastGoodLinkedInMetrics(
            authorUrn,
            orgUrn,
            preliminaryCacheKey,
          );
          const lastOpportunity = lastGood
            ? null
            : await readLastGoodLinkedInOpportunityMetrics(
                authorUrn,
                orgUrn,
                preliminaryCacheKey,
              );
          sourcesStatus.linkedin.metrics = lastGood
            ? annotateLinkedInMetrics(lastGood, "last_good_quota_guard", {
                blockedUntil: quotaGuard.expiresAt,
              })
            : lastOpportunity
              ? annotateLinkedInMetrics(lastOpportunity, "last_opportunity_quota_guard", {
                  blockedUntil: quotaGuard.expiresAt,
                })
              : {
                  error: "Stats LinkedIn temporairement indisponibles : quota API atteint.",
                  raw: {
                    errors: [String(asRecord(quotaGuard.payload)["error"] || "linkedin_api_quota")],
                    quotaGuard: { blockedUntil: quotaGuard.expiresAt },
                  },
                };
        } else {
          if (!authorUrn.startsWith("urn:li:person:") && !orgUrn) {
            orgUrn = await liResolveFirstAdminOrgUrn(token);
          }

          const cacheKey = buildLinkedInMetricsCacheKey(authorUrn, orgUrn);
          const cached = await resolveLinkedInCachedMetrics(cacheKey, authorUrn, orgUrn);
          if (cached) {
            sourcesStatus.linkedin.metrics = annotateLinkedInMetrics(
              cached.metrics,
              cached.mode,
            );
          } else {
            try {
              type LinkedInSourceFetch = {
                label: "member" | "organization";
                cacheKey: string;
                authorForCache: string;
                orgForCache: string;
                run: () => Promise<unknown>;
              };

              const sourceFetches: LinkedInSourceFetch[] = [];
              if (authorUrn.startsWith("urn:li:person:")) {
                sourceFetches.push({
                  label: "member",
                  cacheKey: buildLinkedInSourceMetricsCacheKey("member", authorUrn),
                  authorForCache: authorUrn,
                  orgForCache: "",
                  run: () => liFetchMemberAnalytics(token, authorUrn, start, end),
                });
              }
              if (orgUrn.startsWith("urn:li:organization:")) {
                sourceFetches.push({
                  label: "organization",
                  cacheKey: buildLinkedInSourceMetricsCacheKey("organization", orgUrn),
                  authorForCache: "",
                  orgForCache: orgUrn,
                  run: () => liFetchOrgAnalytics(token, orgUrn, start, end),
                });
              }
              if (!sourceFetches.length) {
                throw new Error("Le compte LinkedIn n’est pas correctement configuré.");
              }

              const sourceResults: Array<{
                label: "member" | "organization";
                metrics?: unknown | null;
                error?: string | null;
                mode?: string | null;
              }> = [];

              for (const sourceFetch of sourceFetches) {
                const sourceCached = await resolveLinkedInCachedMetrics(
                  sourceFetch.cacheKey,
                  sourceFetch.authorForCache,
                  sourceFetch.orgForCache,
                );
                if (sourceCached) {
                  sourceResults.push({
                    label: sourceFetch.label,
                    metrics: sourceCached.metrics,
                    mode: sourceCached.mode,
                  });
                  continue;
                }

                try {
                  const sourceMetrics = await sourceFetch.run();
                  const sourceQuotaError = getLinkedInRateLimitErrorFromMetrics(sourceMetrics);
                  if (sourceQuotaError) await writeLinkedInQuotaGuard(sourceQuotaError);
                  if (shouldCacheLinkedInMetrics(sourceMetrics)) {
                    await writeLinkedInMetricsCache(sourceFetch.cacheKey, sourceMetrics);
                  }
                  await writeLastGoodLinkedInOpportunityCache(
                    sourceFetch.cacheKey,
                    sourceMetrics,
                  );

                  if (isLastGoodLinkedInMetrics(sourceMetrics)) {
                    await writeLastGoodLinkedInMetricsCache(
                      sourceFetch.cacheKey,
                      sourceMetrics,
                    );
                    sourceResults.push({
                      label: sourceFetch.label,
                      metrics: sourceMetrics,
                      mode: "live",
                    });
                  } else if (hasUsableLinkedInMetrics(sourceMetrics)) {
                    // Réponse partielle mais exploitable : on la garde pour éviter
                    // de rappeler LinkedIn à chaque ouverture.
                    sourceResults.push({
                      label: sourceFetch.label,
                      metrics: sourceMetrics,
                      mode: "live_partial",
                    });
                  } else {
                    const sourceLastGood = await readLastGoodLinkedInMetrics(
                      sourceFetch.authorForCache,
                      sourceFetch.orgForCache,
                      sourceFetch.cacheKey,
                    );
                    const sourceLastOpportunity = sourceLastGood
                      ? null
                      : await readLastGoodLinkedInOpportunityMetrics(
                          sourceFetch.authorForCache,
                          sourceFetch.orgForCache,
                          sourceFetch.cacheKey,
                        );
                    sourceResults.push({
                      label: sourceFetch.label,
                      metrics: sourceLastGood || sourceLastOpportunity || sourceMetrics,
                      mode: sourceLastGood
                        ? "last_good_after_partial_refresh"
                        : sourceLastOpportunity
                          ? "last_opportunity_after_partial_refresh"
                          : "live_partial",
                    });
                  }
                } catch (sourceError) {
                  const rawSourceMessage = sourceError instanceof Error
                    ? sourceError.message
                    : String(sourceError);
                  if (isLinkedInRateLimitMessage(rawSourceMessage)) {
                    await writeLinkedInQuotaGuard(rawSourceMessage);
                  }
                  const sourceLastGood = await readLastGoodLinkedInMetrics(
                    sourceFetch.authorForCache,
                    sourceFetch.orgForCache,
                    sourceFetch.cacheKey,
                  );
                  const sourceLastOpportunity = sourceLastGood
                    ? null
                    : await readLastGoodLinkedInOpportunityMetrics(
                        sourceFetch.authorForCache,
                        sourceFetch.orgForCache,
                        sourceFetch.cacheKey,
                      );

                  if (sourceLastGood || sourceLastOpportunity) {
                    sourceResults.push({
                      label: sourceFetch.label,
                      metrics: annotateLinkedInMetrics(
                        sourceLastGood || sourceLastOpportunity,
                        sourceLastGood
                          ? "last_good_source_after_error"
                          : "last_opportunity_source_after_error",
                        { refreshIssue: rawSourceMessage },
                      ),
                      mode: sourceLastGood
                        ? "last_good_source_after_error"
                        : "last_opportunity_source_after_error",
                    });
                  } else {
                    sourceResults.push({
                      label: sourceFetch.label,
                      error: rawSourceMessage,
                    });
                  }
                }
              }

              const metrics = liAggregateAnalytics(sourceResults, start, end);
              const quotaMetricError = getLinkedInRateLimitErrorFromMetrics(metrics);
              if (quotaMetricError) {
                await writeLinkedInQuotaGuard(quotaMetricError);
              }
              if (shouldCacheLinkedInMetrics(metrics)) {
                await writeLinkedInMetricsCache(cacheKey, metrics);
              }
              await writeLastGoodLinkedInOpportunityCache(cacheKey, metrics);

              if (isLastGoodLinkedInMetrics(metrics)) {
                await writeLastGoodLinkedInMetricsCache(cacheKey, metrics);
                sourcesStatus.linkedin.metrics = annotateLinkedInMetrics(
                  metrics,
                  "live_sources_aggregate",
                );
              } else if (hasUsableLinkedInMetrics(metrics)) {
                sourcesStatus.linkedin.metrics = annotateLinkedInMetrics(
                  metrics,
                  "partial_sources_aggregate",
                  { refreshIssue: collectLinkedInMetricErrors(metrics)[0] || null },
                );
              } else {
                const lastGood = await readLastGoodLinkedInMetrics(
                  authorUrn,
                  orgUrn,
                  cacheKey,
                );
                const lastOpportunity = lastGood
                  ? null
                  : await readLastGoodLinkedInOpportunityMetrics(authorUrn, orgUrn, cacheKey);
                sourcesStatus.linkedin.metrics = lastGood
                  ? annotateLinkedInMetrics(lastGood, "last_good_after_partial_refresh", {
                      refreshIssue: collectLinkedInMetricErrors(metrics)[0] || null,
                    })
                  : lastOpportunity
                    ? annotateLinkedInMetrics(lastOpportunity, "last_opportunity_after_partial_refresh", {
                        refreshIssue: collectLinkedInMetricErrors(metrics)[0] || null,
                      })
                    : annotateLinkedInMetrics(metrics, "live_partial");
              }
            } catch (e) {
              const rawMessage = e instanceof Error ? e.message : String(e);
              const blockedUntil = isLinkedInRateLimitMessage(rawMessage)
                ? await writeLinkedInQuotaGuard(rawMessage)
                : null;
              const lastGood = await readLastGoodLinkedInMetrics(
                authorUrn,
                orgUrn,
                cacheKey,
              );

              const lastOpportunity = lastGood
                ? null
                : await readLastGoodLinkedInOpportunityMetrics(
                    authorUrn,
                    orgUrn,
                    cacheKey,
                  );

              sourcesStatus.linkedin.metrics = lastGood
                ? annotateLinkedInMetrics(lastGood, "last_good_after_error", {
                    refreshIssue: rawMessage,
                    blockedUntil,
                  })
                : lastOpportunity
                  ? annotateLinkedInMetrics(lastOpportunity, "last_opportunity_after_error", {
                      refreshIssue: rawMessage,
                      blockedUntil,
                    })
                  : {
                      error: getSimpleFrenchErrorMessage(
                        e,
                        "Impossible de récupérer les statistiques LinkedIn pour le moment.",
                      ),
                      raw: {
                        errors: [rawMessage],
                        quotaGuard: blockedUntil ? { blockedUntil } : undefined,
                      },
                    };
            }
          }
        }
      } catch (e) {
        sourcesStatus.linkedin.metrics = {
          error: getSimpleFrenchErrorMessage(
            e,
            "Impossible de récupérer les statistiques LinkedIn pour le moment.",
          ),
        };
      }
    } else {
      sourcesStatus.linkedin.metrics = null;
    }
  } catch {}

  // Google Business uses the exact same live state as Dashboard and Booster.
  // The integration row can temporarily miss its target after an OAuth refresh,
  // while the mirrored settings still contain the selected establishment. The
  // canonical channel state resolves that transition once for every consumer.
  try {
    const gmbRow = latestIntegrationAny("google", "gmb", "gmb");
    const resourceId = String(channelStates.gmb.resource_id || "").trim();
    sourcesStatus.gmb.connected = isStatsActiveConnection(channelStates.gmb);

    const includeGmb = includeAll || includeSet.has("gmb");
    if (!includeGmb) {
      sourcesStatus.gmb.metrics = null;
    } else if (!sourcesStatus.gmb.connected) {
      sourcesStatus.gmb.metrics = null;
    } else {
      const tok = await getGoogleTokenForAnyGoogle("gmb", "gmb", {
        supabase,
        userId,
      });
      const accessToken = tok?.accessToken;

      // IMPORTANT: GMB metrics are tied to a *location* (establishment page), not the Google account.
      // We only fetch metrics once a location has been explicitly selected and saved.
      const loc = resourceId;

      if (accessToken && loc) {
        const end = dateWindow.end;
        const start = dateWindow.start;
        try {
          const preferredAccountName = channelStates.gmb.account_name;
          const recovered = await gmbFetchDailyMetricsNormalizedWithRecovery({
            accessToken,
            locationName: loc,
            start,
            end,
            preferredAccountName,
          });
          sourcesStatus.gmb.metrics = recovered.metrics;

          if (
            recovered.recovered &&
            recovered.locationName &&
            recovered.locationName !== loc
          ) {
            const nextMeta = {
              ...asRecord(gmbRow["meta"]),
              ...(recovered.accountName
                ? { account: recovered.accountName }
                : {}),
            };
            try {
              await supabase
                .from("integrations")
                .update({
                  resource_id: recovered.locationName,
                  resource_label: recovered.locationTitle,
                  meta: nextMeta,
                  updated_at: new Date().toISOString(),
                })
                .eq("user_id", userId)
                .eq("provider", "google")
                .eq("source", "gmb")
                .eq("product", "gmb");
            } catch {}

            try {
              const currentGmb = asRecord(asRecord(proSettings)["gmb"]);
              const mergedSettings = {
                ...proSettings,
                gmb: {
                  ...currentGmb,
                  accountName:
                    recovered.accountName || currentGmb["accountName"] || null,
                  locationName: recovered.locationName,
                  locationTitle:
                    recovered.locationTitle ||
                    currentGmb["locationTitle"] ||
                    null,
                  resource_id: recovered.locationName,
                  resource_label:
                    recovered.locationTitle ||
                    currentGmb["resource_label"] ||
                    null,
                },
              };
              await supabase
                .from("pro_tools_configs")
                .upsert(
                  { user_id: userId, settings: mergedSettings },
                  { onConflict: "user_id" },
                );
            } catch {}
          }
        } catch (e) {
          const reconnectPersisted = await markPublishChannelReconnectRequired({
            channel: "gmb",
            userId,
            error: e,
            stage: "stats_provider_metrics",
          });
          if (reconnectPersisted) {
            sourcesStatus.gmb.connected = false;
          }
          log.warn("gmb_stats_refresh_failed", {
            user_id: userId,
            stage: "provider_metrics",
            connected: sourcesStatus.gmb.connected,
            has_location: Boolean(loc),
            has_account: Boolean(channelStates.gmb.account_name),
            error_message: getErrorMessage(e).slice(0, 500),
          });
          sourcesStatus.gmb.metrics = {
            error: getSimpleFrenchErrorMessage(
              e,
              "Impossible de récupérer les statistiques Google Business pour le moment.",
            ),
            location: loc,
            needs_reconnect: reconnectPersisted,
          };
        }
      } else {
        if (!accessToken) {
          // getGoogleTokenForAnyGoogle persists a revoked refresh token as a
          // reconnect state. Reflect it in this very response instead of
          // waiting for the next Dashboard poll.
          sourcesStatus.gmb.connected = false;
        }
        log.warn("gmb_stats_target_missing", {
          user_id: userId,
          stage: "provider_metrics_precheck",
          connected: sourcesStatus.gmb.connected,
          has_location: Boolean(loc),
          has_account: Boolean(channelStates.gmb.account_name),
          connection_status: channelStates.gmb.connection_status,
        });
        sourcesStatus.gmb.metrics = null;
      }
    }
  } catch (error) {
    log.warn("gmb_stats_state_failed", {
      user_id: userId,
      stage: "state_resolution",
      error_message: getErrorMessage(error).slice(0, 500),
    });
  }

  const generatedAt = new Date().toISOString();

  const payload = await stabilizeOverviewPayload({
    supabase,
    userId,
    days,
    includeRaw,
    includeAll,
    payload: {
      days,
      selected: includeAll ? null : Array.from(includeSet),
      inrcySiteOwnership,
      identities: {
        site_inrcy: {
          label: channelStates.site_inrcy.url || null,
          url: channelStates.site_inrcy.url || null,
        },
        site_web: {
          label: channelStates.site_web.url || null,
          url: channelStates.site_web.url || null,
        },
        gmb: {
          label: channelStates.gmb.resource_label || null,
          url: null,
        },
        facebook: {
          label:
            channelStates.facebook.resource_label ||
            String(
              asRecord(
                latestIntegrationAny("facebook", "facebook", "facebook"),
              )["resource_label"] || "",
            ) ||
            null,
          url:
            channelStates.facebook.page_url ||
            String(
              asRecord(
                asRecord(
                  latestIntegrationAny("facebook", "facebook", "facebook"),
                )["meta"],
              )["page_url"] || "",
            ) ||
            null,
        },
        instagram: {
          label: channelStates.instagram.username
            ? `@${channelStates.instagram.username}`
            : String(
                asRecord(
                  latestIntegrationAny("instagram", "instagram", "instagram"),
                )["resource_label"] || "",
              ) || null,
          url:
            channelStates.instagram.profile_url ||
            String(
              asRecord(
                asRecord(
                  latestIntegrationAny("instagram", "instagram", "instagram"),
                )["meta"],
              )["profile_url"] || "",
            ) ||
            null,
        },
        linkedin: {
          label:
            channelStates.linkedin.organization_name ||
            channelStates.linkedin.display_name ||
            null,
          url: channelStates.linkedin.organization_id
            ? channelStates.linkedin.organization_url
            : channelStates.linkedin.profile_url,
        },
        tiktok: {
          label: channelStates.tiktok.username || null,
          url: channelStates.tiktok.profile_url || null,
        },
        youtube_shorts: {
          label: channelStates.youtube_shorts.channel_name || null,
          url: channelStates.youtube_shorts.channel_url || null,
        },
        pinterest: {
          label: channelStates.pinterest.default_board_name || channelStates.pinterest.username || null,
          url: channelStates.pinterest.profile_url || null,
        },
      },
      totals: {
        users: totalUsers,
        sessions: totalSessions,
        pageviews: totalPageviews,
        engagementRate,
        avgSessionDuration,
        clicks: totalClicks,
        impressions: totalImpressions,
        ctr,
      },
      topPages,
      channels,
      topQueries,
      business: {
        sectorCategory: decodedBusinessSector.sectorCategory || null,
        profession: decodedBusinessSector.profession || null,
      },
      sources: sourcesStatus,
      inrcyActivity: inrcyPublishedActivityStats,
      note: "Sources connectées: site iNrCy (GA4/GSC), site web (GA4/GSC), GMB, Facebook, Instagram, LinkedIn, TikTok, YouTube, Pinterest.",
      meta: {
        generatedAt,
        snapshotDate: dateWindow.snapshotDate,
        live: dateWindow.live,
      },
    },
  });

  // Cache write (best-effort). A healthy channel snapshot is also kept under
  // a separate source so a temporary provider outage cannot overwrite it.
  try {
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    await supabase.from("stats_cache").upsert(
      {
        user_id: userId,
        source: OVERVIEW_CACHE_SOURCE,
        range_key: rangeKey,
        payload: stripPinterestApiMetricsFromPayload(payload),
        expires_at: expiresAt,
      },
      { onConflict: "user_id,source,range_key" },
    );

    const requestedCube = resolveRequestedCube(includeRaw, includeAll);
    if (requestedCube && cubeHasUsableData(payload, requestedCube)) {
      await supabase.from("stats_cache").upsert(
        {
          user_id: userId,
          source: OVERVIEW_LAST_GOOD_SOURCE,
          range_key: rangeKey,
          payload: stripPinterestApiMetricsFromPayload(payload),
          expires_at: new Date(Date.now() + OVERVIEW_LAST_GOOD_TTL_MS).toISOString(),
        },
        { onConflict: "user_id,source,range_key" },
      );
    }
  } catch {}



  return payload as OverviewPayload;
}
