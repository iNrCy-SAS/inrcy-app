import "server-only";

import { asRecord, asString } from "@/lib/tsSafe";

export type YoutubeShortsLocalPublicationStats = {
  posts: number;
  videoPosts: number;
  longVideoPosts?: number;
  latestAt: string | null;
};

export type YoutubeShortsAnalyticsSnapshot = {
  totals: Record<string, number | string | null>;
  daily: Array<Record<string, number | string | null>>;
  videos: Array<Record<string, number | string | null>>;
  raw?: Record<string, unknown>;
  error?: string;
  raw_error?: string | null;
  needs_reconnect?: boolean;
};

function num(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function ymd(date: Date) {
  return date.toISOString().slice(0, 10);
}

function normalizeDateInput(value: unknown, fallback: Date) {
  const raw = asString(value);
  if (!raw) return ymd(fallback);
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return ymd(d);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return ymd(fallback);
}

class YoutubeAnalyticsRequestError extends Error {
  readonly status: number;
  readonly reason: string | null;

  constructor(message: string, status: number, reason: string | null) {
    super(message);
    this.name = "YoutubeAnalyticsRequestError";
    this.status = status;
    this.reason = reason;
  }
}

function youtubeApiError(data: unknown, fallback: string) {
  const rec = asRecord(data);
  const err = asRecord(rec.error);
  const errors = Array.isArray(err.errors) ? err.errors.map(asRecord) : [];
  const detail = asString(errors[0]?.message);
  const reason = asString(errors[0]?.reason);
  const topLevel = asString(err.message);
  const message = detail || topLevel || reason || fallback;
  return {
    message:
      reason && !message.toLowerCase().includes(reason.toLowerCase())
        ? `${message} (${reason})`
        : message,
    reason: reason || null,
  };
}

async function fetchJson(url: string, accessToken: string) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = youtubeApiError(data, `YouTube HTTP ${res.status}`);
    throw new YoutubeAnalyticsRequestError(
      details.message,
      res.status,
      details.reason,
    );
  }
  return data;
}

function parseAnalyticsRows(data: unknown) {
  const rec = asRecord(data);
  const headers = Array.isArray(rec.columnHeaders) ? rec.columnHeaders.map(asRecord) : [];
  const names = headers.map((h) => asString(h.name));
  const rows = Array.isArray(rec.rows) ? rec.rows : [];
  return rows.map((row) => {
    const values = Array.isArray(row) ? row : [];
    const out: Record<string, number | string | null> = {};
    names.forEach((name, idx) => {
      if (!name) return;
      const value = values[idx];
      const numeric = Number(value);
      out[name] = Number.isFinite(numeric) && String(value).trim() !== "" ? numeric : asString(value) || null;
    });
    return out;
  });
}

export function mergeYoutubeShortsLocalPublicationStats(metrics: unknown, local: YoutubeShortsLocalPublicationStats) {
  const current = asRecord(metrics);
  const totals = asRecord(current.totals);
  const raw = asRecord(current.raw);
  return {
    ...current,
    totals: {
      ...totals,
      inrcy_posts: local.posts,
      inrcy_video_posts: local.videoPosts,
      inrcy_short_video_posts: local.videoPosts,
      inrcy_long_video_posts: local.longVideoPosts || 0,
      postsPublished: num(totals.postsPublished) || local.posts,
      postsPublishedLocal: local.posts,
    },
    raw: {
      ...raw,
      inrcyLocalPublications: {
        posts: local.posts,
        videoPosts: local.videoPosts,
        shortVideoPosts: local.videoPosts,
        longVideoPosts: local.longVideoPosts || 0,
        latestAt: local.latestAt,
      },
    },
  };
}

export async function fetchYoutubeShortsAnalyticsSnapshot(args: {
  accessToken: string;
  start: string | Date;
  end: string | Date;
  channelStats?: {
    subscriberCount?: number | null;
    videoCount?: number | null;
    viewCount?: number | null;
  } | null;
}): Promise<YoutubeShortsAnalyticsSnapshot> {
  const accessToken = String(args.accessToken || "").trim();
  if (!accessToken) throw new Error("Connexion YouTube expirée.");

  const today = new Date();
  const start = normalizeDateInput(args.start, new Date(today.getTime() - 28 * 24 * 60 * 60 * 1000));
  const end = normalizeDateInput(args.end, today);
  const channelStats = args.channelStats || {};

  const baseParams = {
    ids: "channel==MINE",
    startDate: start,
    endDate: end,
  };

  const totalsMetricCandidates = [
    "views,estimatedMinutesWatched,averageViewDuration,likes,comments,shares,subscribersGained,subscribersLost",
    "views,estimatedMinutesWatched,averageViewDuration",
    "views",
  ] as const;

  async function fetchTotalsWithFallback() {
    let fallbackReason: string | null = null;
    for (let index = 0; index < totalsMetricCandidates.length; index += 1) {
      const metrics = totalsMetricCandidates[index];
      const url = `https://youtubeanalytics.googleapis.com/v2/reports?${new URLSearchParams({
        ...baseParams,
        metrics,
      }).toString()}`;
      try {
        return {
          data: await fetchJson(url, accessToken),
          metrics,
          fallbackReason,
        };
      } catch (error) {
        const canUseNarrowerMetrics =
          error instanceof YoutubeAnalyticsRequestError &&
          error.status === 400 &&
          index < totalsMetricCandidates.length - 1;
        if (!canUseNarrowerMetrics) throw error;
        fallbackReason ||= error.message;
      }
    }
    throw new Error("YouTube Analytics totals unavailable.");
  }

  const dailyUrl = `https://youtubeanalytics.googleapis.com/v2/reports?${new URLSearchParams({
    ...baseParams,
    dimensions: "day",
    metrics: "views,estimatedMinutesWatched,likes,comments,shares,subscribersGained,subscribersLost",
    sort: "day",
  }).toString()}`;

  const topVideosUrl = `https://youtubeanalytics.googleapis.com/v2/reports?${new URLSearchParams({
    ...baseParams,
    dimensions: "video",
    metrics: "views,likes,comments,shares,estimatedMinutesWatched",
    sort: "-views",
    maxResults: "10",
  }).toString()}`;

  const [totalsResult, dailyData, topVideosData] = await Promise.all([
    fetchTotalsWithFallback(),
    fetchJson(dailyUrl, accessToken).catch(() => ({ rows: [], columnHeaders: [] })),
    fetchJson(topVideosUrl, accessToken).catch(() => ({ rows: [], columnHeaders: [] })),
  ]);
  const totalsData = totalsResult.data;

  const totalsRows = parseAnalyticsRows(totalsData);
  const daily = parseAnalyticsRows(dailyData);
  const videos = parseAnalyticsRows(topVideosData);
  const firstTotals = totalsRows[0] || {};
  const subscribersGained = num(firstTotals.subscribersGained);
  const subscribersLost = num(firstTotals.subscribersLost);
  const likes = num(firstTotals.likes);
  const comments = num(firstTotals.comments);
  const shares = num(firstTotals.shares);
  const views = num(firstTotals.views);

  return {
    totals: {
      views,
      video_views: views,
      impressions: views,
      estimatedMinutesWatched: num(firstTotals.estimatedMinutesWatched),
      averageViewDuration: num(firstTotals.averageViewDuration),
      likes,
      likes_total: likes,
      comments,
      shares,
      engagements: likes + comments + shares,
      subscribers: num(channelStats.subscriberCount),
      followers: num(channelStats.subscriberCount),
      subscribersGained,
      subscribersLost,
      subscribersNet: subscribersGained - subscribersLost,
      video_count: num(channelStats.videoCount),
      shorts_count: num(channelStats.videoCount),
      channel_views_total: num(channelStats.viewCount),
    },
    daily,
    videos,
    raw: {
      startDate: start,
      endDate: end,
      channelStats,
      totals: totalsData,
      totalsMetrics: totalsResult.metrics,
      totalsFallbackReason: totalsResult.fallbackReason,
    },
  };
}
