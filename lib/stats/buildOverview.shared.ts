import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  OVERVIEW_CACHE_SOURCE,
  OVERVIEW_LAST_GOOD_SOURCE,
  hasUsableGmbMetrics,
  isRecentOverviewCandidate,
} from "@/lib/stats/overviewPreservation";

export function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

export function isLinkedInRateLimitMessage(message: unknown): boolean {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("throttle") ||
    text.includes("rate limit") ||
    text.includes("resource level") ||
    text.includes("application day limit") ||
    text.includes("utilisation maximale") ||
    text.includes("étranglé") ||
    text.includes("etrangle")
  );
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || "");
}

export function isTiktokReconnectError(error: unknown): boolean {
  const text = getErrorMessage(error).toLowerCase();
  return Boolean(text.trim()) && (
    text.includes("access token") ||
    text.includes("invalid token") ||
    text.includes("token is invalid") ||
    text.includes("invalid or not found") ||
    text.includes("invalid_grant") ||
    text.includes("expired") ||
    text.includes("unauthorized") ||
    text.includes("forbidden") ||
    text.includes("scope") ||
    text.includes("permission") ||
    text.includes("autorisation") ||
    text.includes("reconnect") ||
    text.includes("reconnecte") ||
    text.includes("reconnecter")
  );
}

export function clearTiktokReconnectMeta(meta: Record<string, unknown>) {
  const next = { ...meta };
  delete next["needs_reconnect"];
  delete next["tiktok_needs_reconnect"];
  delete next["tiktok_stats_needs_reconnect_at"];
  delete next["tiktok_token_invalid_at"];
  delete next["tiktok_stats_last_error"];
  return next;
}

export async function flagTiktokStatsReconnectNeeded({
  supabase,
  userId,
  tiktokRow,
  rawMessage,
}: {
  supabase: SupabaseClient;
  userId: string;
  tiktokRow: Record<string, unknown>;
  rawMessage: string;
}) {
  try {
    const now = new Date().toISOString();
    const nextMeta = {
      ...asRecord(tiktokRow["meta"]),
      needs_reconnect: true,
      tiktok_needs_reconnect: true,
      tiktok_stats_needs_reconnect_at: now,
      tiktok_token_invalid_at: now,
      tiktok_stats_last_error: rawMessage.slice(0, 500) || "Token TikTok invalide.",
    };

    await supabase
      .from("integrations")
      .update({
        meta: nextMeta,
        updated_at: now,
      })
      .eq("user_id", userId)
      .eq("provider", "tiktok")
      .eq("source", "tiktok")
      .eq("product", "tiktok");
  } catch {
    // Ne jamais faire échouer iNrStats à cause d'un simple marquage de reconnexion.
  }
}

export async function clearTiktokStatsReconnectNeeded({
  supabase,
  userId,
  tiktokRow,
}: {
  supabase: SupabaseClient;
  userId: string;
  tiktokRow: Record<string, unknown>;
}) {
  const currentMeta = asRecord(tiktokRow["meta"]);
  if (
    currentMeta["needs_reconnect"] !== true &&
    currentMeta["tiktok_needs_reconnect"] !== true &&
    !currentMeta["tiktok_stats_needs_reconnect_at"] &&
    !currentMeta["tiktok_token_invalid_at"] &&
    !currentMeta["tiktok_stats_last_error"]
  ) {
    return;
  }

  try {
    await supabase
      .from("integrations")
      .update({
        meta: clearTiktokReconnectMeta(currentMeta),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("provider", "tiktok")
      .eq("source", "tiktok")
      .eq("product", "tiktok");
  } catch {
    // Idem : les stats doivent rester disponibles même si le nettoyage méta échoue.
  }
}

export function isExpired(expiresAt: unknown): boolean {
  if (!expiresAt) return false; // unknown => don't block
  const d =
    expiresAt instanceof Date
      ? expiresAt
      : typeof expiresAt === "string" || typeof expiresAt === "number"
        ? new Date(expiresAt)
        : null;
  if (!d) return false;
  const t = d.getTime();
  if (Number.isNaN(t)) return false;
  // 60s safety margin
  return t <= Date.now() + 60_000;
}

// NOTE: We lazy-import internal libs inside the handler to avoid returning an HTML error page
// when a dependency throws at module-evaluation time (e.g. cookies()/headers() scope issues).

export function safeJsonParse<T>(s: unknown, fallback: T): T {
  if (!s) return fallback;
  try {
    if (typeof s === "string") return JSON.parse(s) as T;
    return s as T;
  } catch {
    return fallback;
  }
}

export type SiteConn = { ga4: boolean; gsc: boolean };

export type SourcesStatus = {
  site_inrcy: { connected: SiteConn };
  site_web: { connected: SiteConn };
  gmb: { connected: boolean; metrics: unknown | null };
  facebook: { connected: boolean; metrics: unknown | null };
  instagram: { connected: boolean; metrics: unknown | null };
  linkedin: { connected: boolean; metrics: unknown | null };
  tiktok: { connected: boolean; metrics: unknown | null };
  youtube_shorts: { connected: boolean; metrics: unknown | null };
  pinterest: { connected: boolean; metrics: unknown | null };
};

export type LiveSourcesSnapshot = {
  site_inrcy: { connected: SiteConn };
  site_web: { connected: SiteConn };
  gmb: { connected: boolean; metrics: unknown | null };
  facebook: { connected: boolean; metrics: unknown | null };
  instagram: { connected: boolean; metrics: unknown | null };
  linkedin: { connected: boolean; metrics: unknown | null };
  tiktok: { connected: boolean; metrics: unknown | null };
  youtube_shorts: { connected: boolean; metrics: unknown | null };
  pinterest: { connected: boolean; metrics: unknown | null };
};

export type OverviewCubeKey =
  | "site_inrcy"
  | "site_web"
  | "gmb"
  | "facebook"
  | "instagram"
  | "linkedin"
  | "tiktok"
  | "youtube_shorts"
  | "pinterest";

export function isStatsActiveConnection(state: {
  connected: boolean;
  requiresUpdate?: boolean;
}) {
  return Boolean(state.connected && !state.requiresUpdate);
}

export function mergeCachedSourcesWithLiveState(
  existingSources: unknown,
  liveSources: LiveSourcesSnapshot,
) {
  const existing = asRecord(existingSources);
  const out: Record<string, unknown> = { ...existing };
  for (const [key, liveNodeUnknown] of Object.entries(liveSources)) {
    const liveNode = asRecord(liveNodeUnknown);
    const prevNode = asRecord(existing[key]);
    const nextNode: Record<string, unknown> = { ...prevNode, ...liveNode };
    const liveConnected = liveNode["connected"];

    // Si le canal n'est plus actif pour iNrStats (déconnecté ou à actualiser),
    // on supprime aussi les anciennes métriques du cache pour éviter un calcul live/stale.
    if (liveConnected === false) {
      nextNode["metrics"] = null;
    } else if (
      prevNode["metrics"] !== undefined &&
      (liveNode["metrics"] === undefined ||
        (liveNode["metrics"] === null && prevNode["metrics"] !== null))
    ) {
      nextNode["metrics"] = prevNode["metrics"];
    }

    out[key] = nextNode;
  }
  return out;
}

export function stripPinterestApiMetricsFromPayload(payloadUnknown: unknown): Record<string, unknown> {
  const payload = asRecord(payloadUnknown);
  const sources = asRecord(payload["sources"]);
  const pinterest = asRecord(sources["pinterest"]);
  return {
    ...payload,
    sources: {
      ...sources,
      pinterest: {
        ...pinterest,
        // Pinterest interdit la conservation durable des informations lues via son API.
        // Les métriques live sont donc retirées de tous les caches persistants.
        metrics: null,
      },
    },
  };
}

export function normalizeIdentityValue(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/\/+$/g, "")
    .toLowerCase();
}

export function resolveRequestedCube(
  includeRaw: string,
  includeAll: boolean,
): OverviewCubeKey | null {
  if (includeAll) return null;
  const normalized = String(includeRaw || "").trim();
  if (!normalized) return null;
  if (normalized === "facebook") return "facebook";
  if (normalized === "instagram") return "instagram";
  if (normalized === "linkedin") return "linkedin";
  if (normalized === "tiktok") return "tiktok";
  if (normalized === "youtube_shorts") return "youtube_shorts";
  if (normalized === "pinterest") return "pinterest";
  if (normalized === "gmb") return "gmb";
  if (normalized.includes("site_inrcy")) return "site_inrcy";
  if (normalized.includes("site_web")) return "site_web";
  return null;
}

export function isCubeConnectedInPayload(
  payload: Record<string, unknown>,
  cube: OverviewCubeKey,
) {
  const sources = asRecord(payload["sources"]);
  if (cube === "site_inrcy" || cube === "site_web") {
    const connected = asRecord(asRecord(sources[cube])["connected"]);
    return Boolean(connected["ga4"] || connected["gsc"]);
  }
  return Boolean(asRecord(sources[cube])["connected"]);
}

export const LINKEDIN_DETAIL_SIGNAL_KEYS = [
  "messages",
  "conversations",
  "impressions",
  "impressionCount",
  "uniqueImpressionsCount",
  "viewerImpressions",
  "engagements",
  "likes",
  "likeCount",
  "comments",
  "commentCount",
  "shares",
  "shareCount",
  "clicks",
  "clickCount",
  "linkClickCount",
  "premiumCtaClickCount",
  "pageClicks",
  "profileViews",
  "profileViewFromContentCount",
  "pageViews",
  "postsPublished",
  "postSaveCount",
  "postSendCount",
] as const;

export const LINKEDIN_AUDIENCE_ONLY_KEYS = [
  "followers",
  "followerCount",
  "memberFollowersCount",
  "newFollowers",
  "followerGainedFromContentCount",
  "organicFollowerCount",
  "paidFollowerCount",
] as const;

export function metricNum(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function linkedInMetricValue(metricsRec: Record<string, unknown>, key: string) {
  const totals = asRecord(metricsRec["totals"]);
  return metricNum(totals[key]) + metricNum(metricsRec[key]);
}

export function collectLinkedInMetricErrors(value: unknown, out: string[] = []): string[] {
  if (!value) return out;
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (entry && typeof entry === "object") collectLinkedInMetricErrors(entry, out);
      else if (String(entry || "").trim()) out.push(String(entry));
    }
    return out;
  }
  if (typeof value !== "object") return out;
  const rec = value as Record<string, unknown>;
  if (String(rec["error"] || "").trim()) out.push(String(rec["error"]));
  if (Array.isArray(rec["errors"])) collectLinkedInMetricErrors(rec["errors"], out);
  for (const [key, entry] of Object.entries(rec)) {
    if (key === "error" || key === "errors") continue;
    collectLinkedInMetricErrors(entry, out);
  }
  return out;
}

export function hasLinkedInMetricErrors(metrics: unknown) {
  const metricsRec = asRecord(metrics);
  return collectLinkedInMetricErrors(metricsRec).length > 0;
}

export function getLinkedInRateLimitErrorFromMetrics(metrics: unknown) {
  return collectLinkedInMetricErrors(metrics).find((message) =>
    isLinkedInRateLimitMessage(message),
  );
}

export function hasDetailedLinkedInMetrics(metrics: unknown) {
  const metricsRec = asRecord(metrics);
  if (!Object.keys(metricsRec).length) return false;
  if (String(metricsRec["error"] || "").trim()) return false;
  return LINKEDIN_DETAIL_SIGNAL_KEYS.some((key) => linkedInMetricValue(metricsRec, key) > 0);
}

export function hasAudienceOnlyLinkedInMetrics(metrics: unknown) {
  const metricsRec = asRecord(metrics);
  if (!Object.keys(metricsRec).length) return false;
  if (String(metricsRec["error"] || "").trim()) return false;
  return LINKEDIN_AUDIENCE_ONLY_KEYS.some((key) => linkedInMetricValue(metricsRec, key) > 0);
}

export function hasUsableLinkedInMetrics(metrics: unknown) {
  // Vrais signaux détaillés : exploitables pour les demandes captées.
  return hasDetailedLinkedInMetrics(metrics);
}

export function hasLinkedInOpportunityMetrics(metrics: unknown) {
  // Followers / audience seuls : insuffisants pour les demandes captées,
  // mais suffisants pour conserver le potentiel détecté.
  return hasDetailedLinkedInMetrics(metrics) || hasAudienceOnlyLinkedInMetrics(metrics);
}

export function shouldCacheLinkedInMetrics(metrics: unknown) {
  const metricsRec = asRecord(metrics);
  // Cache dédié LinkedIn : même une réponse valide à zéro/partielle doit être
  // conservée, sinon chaque ouverture consomme le quota. On refuse uniquement
  // les payloads vides et les réponses liées à un quota atteint.
  return (
    Object.keys(metricsRec).length > 0 &&
    !getLinkedInRateLimitErrorFromMetrics(metricsRec)
  );
}


export type InrcyWindowCount = {
  week: number;
  month: number;
  total: number;
};

export type InrcyChannelActivityStats = {
  publications: InrcyWindowCount;
  photoPosts: InrcyWindowCount;
  photos: InrcyWindowCount;
  videos: InrcyWindowCount;
  latestAt: string | null;
};

export type InrcyActivityStatsByChannel = Partial<Record<OverviewCubeKey, InrcyChannelActivityStats>>;

export type TiktokLocalPublicationStats = {
  posts: number;
  videoPosts: number;
  photoPosts: number;
  photos: number;
  latestAt: string | null;
};

export type PinterestLocalPublicationStats = {
  posts: number;
  photoPosts: number;
  photos: number;
  latestAt: string | null;
};

export type YoutubeShortsLocalPublicationStats = {
  posts: number;
  videoPosts: number;
  longVideoPosts: number;
  latestAt: string | null;
};

export const INRCY_PUBLISHABLE_CHANNELS: OverviewCubeKey[] = [
  "site_inrcy",
  "site_web",
  "gmb",
  "facebook",
  "instagram",
  "linkedin",
  "tiktok",
  "youtube_shorts",
  "pinterest",
];

export function emptyWindowCount(): InrcyWindowCount {
  return { week: 0, month: 0, total: 0 };
}

export function emptyInrcyChannelActivityStats(): InrcyChannelActivityStats {
  return {
    publications: emptyWindowCount(),
    photoPosts: emptyWindowCount(),
    photos: emptyWindowCount(),
    videos: emptyWindowCount(),
    latestAt: null,
  };
}

export function emptyInrcyActivityStatsByChannel(): InrcyActivityStatsByChannel {
  return Object.fromEntries(
    INRCY_PUBLISHABLE_CHANNELS.map((channel) => [channel, emptyInrcyChannelActivityStats()]),
  ) as InrcyActivityStatsByChannel;
}


export function normalizePayloadChannels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry || "").trim().toLowerCase())
    .filter(Boolean);
}

export function payloadSucceededForChannel(payload: Record<string, unknown>, channel: OverviewCubeKey) {
  const summary = asRecord(payload["summary"]);
  const successChannels = normalizePayloadChannels(summary["successChannels"]);
  if (successChannels.includes(channel)) return true;

  const results = asRecord(payload["results"]);
  const channelResult = asRecord(results[channel]);
  if (Object.keys(channelResult).length) return channelResult["ok"] !== false;

  const channels = normalizePayloadChannels(payload["channels"]);
  return channels.includes(channel);
}

export function inferPayloadMediaKindForChannel(
  payload: Record<string, unknown>,
  channel: OverviewCubeKey,
): "video" | "photos" | "none" | "unknown" {
  const results = asRecord(payload["results"]);
  const channelResult = asRecord(results[channel]);
  const diagnostics = asRecord(channelResult["diagnostics"]);
  const modeByChannel = asRecord(payload["mediaModeByChannel"]);
  const postByChannel = asRecord(payload["postByChannel"]);
  const channelPost = asRecord(postByChannel[channel]);
  const candidates = [
    channelResult["tiktok_media_type"],
    channelResult["media_type"],
    channelResult["mediaType"],
    diagnostics["mediaType"],
    modeByChannel[channel],
    channelPost["mediaMode"],
    payload["mediaType"],
  ];

  for (const candidate of candidates) {
    const value = String(candidate || "").trim().toLowerCase();
    if (!value) continue;
    if (value === "none") return "none";
    if (value.includes("video")) return "video";
    if (value.includes("photo") || value.includes("image") || value.includes("images")) return "photos";
  }

  return "unknown";
}

export function inferYoutubeVideoPublicationKind(payload: Record<string, unknown>): "short" | "long" {
  const results = asRecord(payload["results"]);
  const channelResult = asRecord(results["youtube_shorts"]);
  const diagnostics = asRecord(channelResult["diagnostics"]);
  const videoByChannel = asRecord(payload["videoByChannel"]);
  const youtubeVideo = asRecord(videoByChannel["youtube_shorts"]);
  const videoSettingsByChannel = asRecord(payload["videoSettingsByChannel"]);
  const youtubeSettings = asRecord(videoSettingsByChannel["youtube_shorts"]);

  const explicitType = String(
    channelResult["youtube_publication_type"] ||
      channelResult["youtubePublicationType"] ||
      diagnostics["publicationType"] ||
      diagnostics["youtube_publication_type"] ||
      "",
  ).trim().toLowerCase();
  if (explicitType === "short" || explicitType === "shorts") return "short";
  if (explicitType === "video" || explicitType === "long" || explicitType === "classic") return "long";

  const duration = Number(
    channelResult["youtube_duration_seconds"] ??
      youtubeVideo["duration"] ??
      asRecord(payload["video"])["duration"] ??
      0,
  );
  const format = String(
    channelResult["youtube_format"] ||
      youtubeSettings["format"] ||
      asRecord(asRecord(youtubeVideo["transformedVariant"]).target)["format"] ||
      "",
  ).trim();

  if (Number.isFinite(duration) && duration > 180) return "long";
  if (format === "16_9") return "long";
  return "short";
}

export function inferPhotoCountForChannel(payload: Record<string, unknown>, channel: OverviewCubeKey) {
  const results = asRecord(payload["results"]);
  const channelResult = asRecord(results[channel]);
  const diagnostics = asRecord(channelResult["diagnostics"]);
  const postByChannel = asRecord(payload["postByChannel"]);
  const channelPost = asRecord(postByChannel[channel]);

  const explicitCount = Number(
    channelResult["media_count"] ??
      channelResult["mediaCount"] ??
      channelResult["photo_count"] ??
      channelResult["photoCount"],
  );
  if (Number.isFinite(explicitCount) && explicitCount > 0) return Math.round(explicitCount);

  const diagnosticUrls = diagnostics["mediaUrls"];
  if (Array.isArray(diagnosticUrls) && diagnosticUrls.length > 0) return diagnosticUrls.length;

  const channelCandidates = [
    channelPost["images"],
    channelPost["attachments"],
    channelPost["publishableUrls"],
    channelPost["instagramPublishableUrls"],
    channelPost["socialFeedPublishableUrls"],
    channelPost["siteCardPublishableUrls"],
    channelPost["gmbPublishableUrls"],
  ];
  for (const candidate of channelCandidates) {
    if (Array.isArray(candidate) && candidate.length > 0) return candidate.length;
  }

  const payloadCandidates = [
    payload["images"],
    payload["publishableUrls"],
    payload["instagramPublishableUrls"],
    payload["socialFeedPublishableUrls"],
    payload["siteCardPublishableUrls"],
    payload["gmbPublishableUrls"],
  ];
  for (const candidate of payloadCandidates) {
    if (Array.isArray(candidate) && candidate.length > 0) return candidate.length;
  }

  return 1;
}

export function incrementWindowCount(
  counter: InrcyWindowCount,
  createdAtMs: number,
  nowMs: number,
  amount = 1,
) {
  const deltaMs = Number.isFinite(createdAtMs) ? nowMs - createdAtMs : Number.POSITIVE_INFINITY;
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const monthMs = 30 * 24 * 60 * 60 * 1000;
  counter.total += amount;
  if (deltaMs >= 0 && deltaMs <= weekMs) counter.week += amount;
  if (deltaMs >= 0 && deltaMs <= monthMs) counter.month += amount;
}

export function mergeTiktokLocalPublicationStats(
  metrics: unknown,
  local: TiktokLocalPublicationStats,
) {
  const current = asRecord(metrics);
  const totals = asRecord(current["totals"]);
  const raw = asRecord(current["raw"]);

  return {
    ...current,
    totals: {
      ...totals,
      inrcy_posts: local.posts,
      inrcy_video_posts: local.videoPosts,
      inrcy_photo_posts: local.photoPosts,
      inrcy_photos: local.photos,
      postsPublishedLocal: local.posts,
    },
    raw: {
      ...raw,
      inrcyLocalPublications: {
        posts: local.posts,
        videoPosts: local.videoPosts,
        photoPosts: local.photoPosts,
        photos: local.photos,
        latestAt: local.latestAt,
      },
    },
  };
}

export function mergePinterestLocalPublicationStats(
  metrics: unknown,
  local: PinterestLocalPublicationStats,
) {
  const current = asRecord(metrics);
  const totals = asRecord(current["totals"]);
  const raw = asRecord(current["raw"]);

  return {
    ...current,
    totals: {
      ...totals,
      inrcy_posts: local.posts,
      inrcy_photo_posts: local.photoPosts,
      inrcy_photos: local.photos,
      postsPublishedLocal: local.posts,
    },
    raw: {
      ...raw,
      inrcyLocalPublications: {
        posts: local.posts,
        photoPosts: local.photoPosts,
        photos: local.photos,
        latestAt: local.latestAt,
      },
    },
  };
}

export function cubeHasUsableData(
  payload: Record<string, unknown>,
  cube: OverviewCubeKey,
) {
  if (!isCubeConnectedInPayload(payload, cube)) return false;
  if (cube === "site_inrcy" || cube === "site_web") {
    const totals = asRecord(payload["totals"]);
    const topPages = Array.isArray(payload["topPages"])
      ? payload["topPages"]
      : [];
    const topQueries = Array.isArray(payload["topQueries"])
      ? payload["topQueries"]
      : [];
    const channels = Array.isArray(payload["channels"])
      ? payload["channels"]
      : [];
    return Boolean(
      Number(totals["sessions"] || 0) > 0 ||
      Number(totals["pageviews"] || 0) > 0 ||
      Number(totals["clicks"] || 0) > 0 ||
      Number(totals["impressions"] || 0) > 0 ||
      topPages.length > 0 ||
      topQueries.length > 0 ||
      channels.length > 0,
    );
  }
  const metrics = asRecord(asRecord(payload["sources"])[cube])["metrics"];
  if (metrics === null || metrics === undefined) return false;
  const metricsRec = asRecord(metrics);
  if (cube === "linkedin") {
    // LinkedIn peut être partiellement indisponible côté stats détaillées,
    // mais un cache avec audience/followers reste exploitable pour le potentiel.
    return hasUsableLinkedInMetrics(metricsRec) || hasLinkedInOpportunityMetrics(metricsRec);
  }
  if (cube === "gmb") return hasUsableGmbMetrics(metricsRec);
  return !String(metricsRec["error"] || "").trim();
}

export function cubeNeedsPreservation(
  payload: Record<string, unknown>,
  cube: OverviewCubeKey,
) {
  if (!isCubeConnectedInPayload(payload, cube)) return false;
  return !cubeHasUsableData(payload, cube);
}

export function identitiesCompatible(
  currentPayload: Record<string, unknown>,
  candidatePayload: Record<string, unknown>,
  cube: OverviewCubeKey,
) {
  const currentIdentity = asRecord(
    asRecord(currentPayload["identities"])[cube],
  );
  const candidateIdentity = asRecord(
    asRecord(candidatePayload["identities"])[cube],
  );
  const currentLabel = normalizeIdentityValue(currentIdentity["label"]);
  const candidateLabel = normalizeIdentityValue(candidateIdentity["label"]);
  const currentUrl = normalizeIdentityValue(currentIdentity["url"]);
  const candidateUrl = normalizeIdentityValue(candidateIdentity["url"]);
  if (currentLabel && candidateLabel && currentLabel !== candidateLabel)
    return false;
  if (currentUrl && candidateUrl && currentUrl !== candidateUrl) return false;
  return true;
}

export function mergePreservedSources(
  candidateSources: unknown,
  currentSources: unknown,
) {
  const candidate = asRecord(candidateSources);
  const current = asRecord(currentSources);
  const out: Record<string, unknown> = { ...candidate };
  for (const key of new Set([
    ...Object.keys(candidate),
    ...Object.keys(current),
  ])) {
    const prevNode = asRecord(candidate[key]);
    const currNode = asRecord(current[key]);
    const nextNode: Record<string, unknown> = { ...prevNode, ...currNode };
    const currMetrics = currNode["metrics"];
    const currMetricsError = String(
      asRecord(currMetrics)["error"] || "",
    ).trim();
    const shouldPreserveLinkedInMetrics =
      key === "linkedin" &&
      prevNode["metrics"] !== undefined &&
      !hasLinkedInOpportunityMetrics(currMetrics);

    if (
      ((currMetrics === null || currMetrics === undefined || currMetricsError) &&
        prevNode["metrics"] !== undefined) ||
      shouldPreserveLinkedInMetrics
    ) {
      nextNode["metrics"] = prevNode["metrics"];
    }
    out[key] = nextNode;
  }
  return out;
}

export async function loadPreviousOverviewCandidate(args: {
  supabase: SupabaseClient;
  userId: string;
  days: number;
  includeRaw: string;
  cube: OverviewCubeKey;
  currentPayload: Record<string, unknown>;
}) {
  const { supabase, userId, days, includeRaw, cube, currentPayload } = args;
  const primaryPrefix = `days=${days}|include=${includeRaw || "all"}|`;
  const prefixes = Array.from(new Set([
    primaryPrefix,
    `days=${days}|include=all|`,
  ]));

  for (const source of [OVERVIEW_LAST_GOOD_SOURCE, OVERVIEW_CACHE_SOURCE]) {
    for (const prefix of prefixes) {
      try {
        const { data: rows = [] } = await supabase
          .from("stats_cache")
          .select("payload, expires_at")
          .eq("user_id", userId)
          .eq("source", source)
          .like("range_key", `${prefix}%`)
          .order("expires_at", { ascending: false })
          .limit(12);

        for (const row of Array.isArray(rows) ? rows : []) {
          const rowRecord = asRecord(row);
          if (!isRecentOverviewCandidate(rowRecord["expires_at"])) continue;
          const candidate = asRecord(rowRecord["payload"]);
          if (!candidate || Object.keys(candidate).length === 0) continue;
          if (!identitiesCompatible(currentPayload, candidate, cube)) continue;
          if (!cubeHasUsableData(candidate, cube)) continue;
          return candidate;
        }
      } catch {}
    }
  }


  return null;
}

export async function stabilizeOverviewPayload(args: {
  supabase: SupabaseClient;
  userId: string;
  days: number;
  includeRaw: string;
  includeAll: boolean;
  payload: Record<string, unknown>;
}) {
  const { supabase, userId, days, includeRaw, includeAll, payload } = args;
  const cube = resolveRequestedCube(includeRaw, includeAll);
  if (!cube) return payload;
  if (!cubeNeedsPreservation(payload, cube)) return payload;

  const candidate = await loadPreviousOverviewCandidate({
    supabase,
    userId,
    days,
    includeRaw,
    cube,
    currentPayload: payload,
  });
  if (!candidate) return payload;

  const currentMeta = asRecord(payload["meta"]);
  const candidateMeta = asRecord(candidate["meta"]);

  return {
    ...candidate,
    days: payload["days"] ?? candidate["days"],
    selected: payload["selected"] ?? candidate["selected"],
    inrcySiteOwnership:
      payload["inrcySiteOwnership"] ?? candidate["inrcySiteOwnership"],
    identities: {
      ...asRecord(candidate["identities"]),
      ...asRecord(payload["identities"]),
    },
    sources: mergePreservedSources(candidate["sources"], payload["sources"]),
    inrcyActivity: {
      ...asRecord(candidate["inrcyActivity"]),
      ...asRecord(payload["inrcyActivity"]),
    },
    business: {
      ...asRecord(candidate["business"]),
      ...asRecord(payload["business"]),
    },
    meta: {
      ...candidateMeta,
      ...currentMeta,
      generatedAt: currentMeta["generatedAt"] ?? new Date().toISOString(),
      snapshotDate:
        currentMeta["snapshotDate"] ?? candidateMeta["snapshotDate"] ?? null,
      preservedCube: cube,
      preservedFromGeneratedAt: candidateMeta["generatedAt"] ?? null,
      preservedFromSnapshotDate: candidateMeta["snapshotDate"] ?? null,
      preservedReason: "technical_refresh_failure",
    },
  };
}

export type SiteSettings = {
  ga4?: { property_id?: string; measurement_id?: string };
  gsc?: { property?: string };
  site_web?: {
    ga4?: { property_id?: string; measurement_id?: string };
    gsc?: { property?: string };
  };
};

export function _sumMap<K extends string>(items: Array<{ key: K; value: number }>) {
  const m = new Map<K, number>();
  for (const it of items) m.set(it.key, (m.get(it.key) || 0) + it.value);
  return m;
}

export type OverviewPayload = {
  days: number;
  selected: string[] | null;
  inrcySiteOwnership: string;
  identities: Record<string, { label: string | null; url: string | null }>;
  totals: {
    users: number;
    sessions: number;
    pageviews: number;
    engagementRate: number;
    avgSessionDuration: number;
    clicks: number;
    impressions: number;
    ctr: number;
  };
  topPages: Array<{ path: string; views: number }>;
  channels: Array<{ channel: string; sessions: number }>;
  topQueries: Array<{
    query: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  }>;
  business: { sectorCategory: string | null; profession: string | null };
  sources: SourcesStatus;
  inrcyActivity: InrcyActivityStatsByChannel;
  note: string;
  meta: {
    generatedAt: string;
    snapshotDate: string | null;
    live: boolean;
  };
};
