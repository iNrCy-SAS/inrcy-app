import "server-only";

import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { getPinterestAccessToken } from "@/lib/pinterestOAuth";
import { fetchPinterestAnalyticsSnapshot } from "@/lib/pinterestAnalytics";
import { getChannelConnectionStates } from "@/lib/channelConnectionState";
import {
  asRecord,
  isStatsActiveConnection,
  mergePinterestLocalPublicationStats,
  stripPinterestApiMetricsFromPayload,
} from "@/lib/stats/buildOverview.shared";
import type {
  LiveSourcesSnapshot,
  PinterestLocalPublicationStats,
} from "@/lib/stats/buildOverview.shared";

type ChannelStatesSnapshot = Awaited<ReturnType<typeof getChannelConnectionStates>>;

type BestIntegrationAny = (
  provider: string,
  source: string,
  product: string,
  hasToken: (row: Record<string, unknown>) => boolean,
) => Record<string, unknown>;

export function createOverviewLiveSourceTools({
  channelStatesPromise,
  bestIntegrationAny,
  hasFacebookStoredToken,
  hasActiveStoredIntegration,
  userId,
  startDateYmd,
  endDateYmd,
  pinterestLocalPublicationStats,
  includeAll,
  includeSet,
}: {
  channelStatesPromise: Promise<ChannelStatesSnapshot>;
  bestIntegrationAny: BestIntegrationAny;
  hasFacebookStoredToken: (row: Record<string, unknown>) => boolean;
  hasActiveStoredIntegration: (row: Record<string, unknown>, hasToken: boolean) => boolean;
  userId: string;
  startDateYmd: string;
  endDateYmd: string;
  pinterestLocalPublicationStats: PinterestLocalPublicationStats;
  includeAll: boolean;
  includeSet: ReadonlySet<string>;
}) {
  async function fetchLiveSourcesStatus() {
    const states = await channelStatesPromise;
    const fbRow = bestIntegrationAny(
      "facebook",
      "facebook",
      "facebook",
      hasFacebookStoredToken,
    );
    const igRow = bestIntegrationAny(
      "instagram",
      "instagram",
      "instagram",
      (row) => Boolean(row["access_token_enc"]),
    );

    const facebookConnected = hasActiveStoredIntegration(
      fbRow,
      hasFacebookStoredToken(fbRow),
    );
    const instagramConnected = hasActiveStoredIntegration(
      igRow,
      Boolean(igRow["access_token_enc"]),
    );

    console.info("[META_CONNECTION_OVERVIEW]", {
      facebookConnected,
      instagramConnected,
      fbHasResource: Boolean(fbRow["resource_id"]),
      igHasResource: Boolean(igRow["resource_id"]),
      fbHasToken: hasFacebookStoredToken(fbRow),
      igHasToken: Boolean(igRow["access_token_enc"]),
      fbStatus: String(fbRow["status"] || ""),
      igStatus: String(igRow["status"] || ""),
    });

    return {
      site_inrcy: {
        connected: { ga4: states.site_inrcy.ga4, gsc: states.site_inrcy.gsc },
      },
      site_web: {
        connected: { ga4: states.site_web.ga4, gsc: states.site_web.gsc },
      },
      gmb: { connected: isStatsActiveConnection(states.gmb), metrics: null },
      facebook: { connected: facebookConnected, metrics: null },
      instagram: { connected: instagramConnected, metrics: null },
      linkedin: {
        connected: isStatsActiveConnection(states.linkedin),
        metrics: null,
      },
      x: {
        connected: isStatsActiveConnection(states.x),
        metrics: null,
      },
      tiktok: {
        connected: isStatsActiveConnection(states.tiktok),
        metrics: null,
      },
      youtube_shorts: {
        connected: isStatsActiveConnection(states.youtube_shorts),
        metrics: null,
      },
      pinterest: {
        connected: isStatsActiveConnection(states.pinterest),
        metrics: null,
      },
    } satisfies LiveSourcesSnapshot;
  }

  async function fetchPinterestMetricsLive() {
    const states = await channelStatesPromise;
    const connected = isStatsActiveConnection(states.pinterest);
    if (!connected) return null;

    try {
      const accessToken = await getPinterestAccessToken(userId);
      if (!accessToken) {
        throw new Error("Connexion Pinterest expirée. Reconnecte Pinterest dans Canaux.");
      }
      const remote = await fetchPinterestAnalyticsSnapshot({
        accessToken,
        start: startDateYmd,
        end: endDateYmd,
      });
      return mergePinterestLocalPublicationStats(remote, pinterestLocalPublicationStats);
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error || "");
      const lower = rawMessage.toLowerCase();
      const needsReconnect =
        lower.includes("access token") ||
        lower.includes("invalid token") ||
        lower.includes("expired") ||
        lower.includes("unauthorized") ||
        lower.includes("forbidden") ||
        lower.includes("scope") ||
        lower.includes("permission") ||
        lower.includes("reconnect");
      return mergePinterestLocalPublicationStats(
        {
          error: needsReconnect
            ? "Pinterest doit être reconnecté pour récupérer les statistiques en direct."
            : getSimpleFrenchErrorMessage(
                error,
                "Impossible de récupérer les statistiques Pinterest pour le moment.",
              ),
          needs_reconnect: needsReconnect,
        },
        pinterestLocalPublicationStats,
      );
    }
  }

  async function hydratePinterestMetricsOnPayload(payloadUnknown: unknown): Promise<Record<string, unknown>> {
    const payload: Record<string, unknown> = stripPinterestApiMetricsFromPayload(payloadUnknown);
    const shouldLoadPinterest = includeAll || includeSet.has("pinterest");
    if (!shouldLoadPinterest) return payload;

    const sources = asRecord(payload["sources"]);
    const pinterest = asRecord(sources["pinterest"]);
    const liveMetrics = await fetchPinterestMetricsLive();
    return {
      ...payload,
      sources: {
        ...sources,
        pinterest: {
          ...pinterest,
          metrics: liveMetrics,
        },
      },
    };
  }

  return {
    fetchLiveSourcesStatus,
    fetchPinterestMetricsLive,
    hydratePinterestMetricsOnPayload,
  };
}
