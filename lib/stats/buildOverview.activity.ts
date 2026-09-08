import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  INRCY_PUBLISHABLE_CHANNELS,
  asRecord,
  emptyWindowCount,
  emptyInrcyActivityStatsByChannel,
  emptyInrcyChannelActivityStats,
  incrementWindowCount,
  inferPayloadMediaKindForChannel,
  inferPhotoCountForChannel,
  inferPublicationTypeForChannel,
  inferYoutubeVideoPublicationKind,
  payloadSucceededForChannel,
} from "@/lib/stats/buildOverview.shared";
import type { InrcyActivityStatsByChannel } from "@/lib/stats/buildOverview.shared";
import { createOperationScopedLoader } from "@/lib/stats/operationScopedLoader";

const INRCY_ACTIVITY_ROW_LIMIT = 5000;

export type InrcyPublishedActivityLoader = () => Promise<InrcyActivityStatsByChannel>;

export function createInrcyPublishedActivityLoader({
  supabase,
  userId,
}: {
  supabase: SupabaseClient;
  userId: string;
}): InrcyPublishedActivityLoader {
  return createOperationScopedLoader(() => loadInrcyPublishedActivityStats({ supabase, userId }));
}

export async function loadInrcyPublishedActivityStats({
  supabase,
  userId,
}: {
  supabase: SupabaseClient;
  userId: string;
}): Promise<InrcyActivityStatsByChannel> {
  const statsByChannel = emptyInrcyActivityStatsByChannel();
  const nowMs = Date.now();

  try {
    const { data, error } = await supabase
      .from("app_events")
      .select("payload,created_at,module,type")
      .eq("user_id", userId)
      .in("module", ["booster", "propulser", "fideliser"])
      .in("type", ["publish", "valorize"])
      .order("created_at", { ascending: false })
      .limit(INRCY_ACTIVITY_ROW_LIMIT + 1);

    if (error || !Array.isArray(data)) return {};

    const publicationHistoryComplete = data.length <= INRCY_ACTIVITY_ROW_LIMIT;
    const rows = data.slice(0, INRCY_ACTIVITY_ROW_LIMIT);
    for (const channel of INRCY_PUBLISHABLE_CHANNELS) {
      const stats = statsByChannel[channel];
      if (stats) stats.publicationHistoryComplete = publicationHistoryComplete;
    }

    for (const row of rows) {
      const payload = asRecord(asRecord(row)["payload"]);
      const createdAt = String(asRecord(row)["created_at"] || "").trim();
      const createdAtMs = createdAt ? new Date(createdAt).getTime() : NaN;

      for (const channel of INRCY_PUBLISHABLE_CHANNELS) {
        if (!payloadSucceededForChannel(payload, channel)) continue;
        const stats = statsByChannel[channel] || emptyInrcyChannelActivityStats();
        statsByChannel[channel] = stats;

        incrementWindowCount(stats.publications, createdAtMs, nowMs);
        const publicationType = inferPublicationTypeForChannel(payload, channel);
        const publicationTypeCount = stats.publicationTypes[publicationType] || emptyWindowCount();
        stats.publicationTypes[publicationType] = publicationTypeCount;
        incrementWindowCount(publicationTypeCount, createdAtMs, nowMs);
        if (createdAt && (!stats.latestAt || createdAt > stats.latestAt)) stats.latestAt = createdAt;

        const kind = inferPayloadMediaKindForChannel(payload, channel);
        if (kind === "video") {
          if (channel === "youtube_shorts") {
            const youtubeKind = inferYoutubeVideoPublicationKind(payload);
            if (youtubeKind === "long") {
              incrementWindowCount(stats.photos, createdAtMs, nowMs);
            } else if (youtubeKind === "short") {
              incrementWindowCount(stats.videos, createdAtMs, nowMs);
            }
          } else {
            incrementWindowCount(stats.videos, createdAtMs, nowMs);
          }
        } else if (kind === "photos") {
          incrementWindowCount(stats.photoPosts, createdAtMs, nowMs);
          incrementWindowCount(stats.photos, createdAtMs, nowMs, inferPhotoCountForChannel(payload, channel));
        }
      }
    }

    return statsByChannel;
  } catch {
    return {};
  }
}
