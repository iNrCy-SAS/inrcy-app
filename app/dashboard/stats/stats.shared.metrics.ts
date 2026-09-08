import { type CubeKey, type CubeMetricItem, type InrcyActivityCount, type InrcyActivityStats, type InrcyPublicationType, type Overview, type StatsTranslator } from "./stats.shared.types";
import { bestMetricValue, fmtInt, latestDailyMetricValue, safeNum, safeObj, sumMetricValues } from "./stats.shared.core";
import { getGmbTotals, gmbMetricSeriesTotal, isIntentQuery, pageKind } from "./stats.shared.opportunity";
import { isLinkedInStatsPartial } from "./stats.shared.quality";

function formatPercent(value: number, locale: string, digits = 0) {
  const safe = Number.isFinite(value) ? value : 0;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(safe)} %`;
}

function formatSecondsToLabel(value: number) {
  const totalSeconds = Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
  if (totalSeconds <= 0) return "0 s";
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes} min ${seconds}s` : `${minutes} min`;
}

function formatMinutesToLabel(value: number) {
  const totalMinutes = Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
}

function metricKeyExists(metrics: any, keys: string[]) {
  const totals = safeObj(safeObj(metrics).totals);
  return keys.some((key) => Object.prototype.hasOwnProperty.call(totals, key));
}

function youtubeReportHasMetric(metrics: any, key: string) {
  const raw = safeObj(safeObj(metrics).raw);
  const requested = String(raw.totalsMetrics || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return requested.includes(key) || safeNum(safeObj(safeObj(metrics).totals)[key]) !== 0;
}

function gmbMetricSeriesExists(metrics: any, metricNames: string[]) {
  const rawSeries = Array.isArray(metrics?.raw?.multiDailyMetricTimeSeries)
    ? metrics.raw.multiDailyMetricTimeSeries
    : Array.isArray(metrics?.multiDailyMetricTimeSeries)
      ? metrics.multiDailyMetricTimeSeries
      : [];
  return rawSeries.some((group: any) => {
    const series = Array.isArray(group?.dailyMetricTimeSeries)
      ? group.dailyMetricTimeSeries
      : [group];
    return series.some((entry: any) => metricNames.includes(String(entry?.dailyMetric || "")));
  });
}

function gmbMetricAvailable(metrics: any, totalKeys: string[], metricNames = totalKeys) {
  return metricKeyExists(metrics, totalKeys) || gmbMetricSeriesExists(metrics, metricNames);
}

export function readMetricError(metrics: any) {
  const error = safeObj(metrics).error;
  return typeof error === "string" ? error.trim() : "";
}

export function isTikTokStatsPermissionError(metrics: any) {
  const m = safeObj(metrics);
  const raw = safeObj(m.raw);
  const videoList = safeObj(raw.videoList);
  const nestedVideoListError = typeof videoList.error === "string" ? videoList.error : "";
  if (m.needs_reconnect === true) return true;
  const text = `${readMetricError(metrics)} ${typeof m.raw_error === "string" ? m.raw_error : ""} ${nestedVideoListError}`.toLowerCase();
  return Boolean(text.trim()) && (
    text.includes("scope") ||
    text.includes("permission") ||
    text.includes("autorisation") ||
    text.includes("unauthorized") ||
    text.includes("forbidden") ||
    text.includes("access token") ||
    text.includes("reconnect") ||
    text.includes("reconnecte")
  );
}

export function hasTikTokStatsSignal(metrics: any) {
  const m = safeObj(metrics);
  const totals = safeObj(m.totals);
  if (!Object.keys(totals).length) return false;
  return [
    "followers",
    "following",
    "likes",
    "likes_total",
    "video_count",
    "videos_public",
    "postsPublished",
    "postsPublishedLocal",
    "inrcy_posts",
    "inrcy_video_posts",
    "inrcy_photo_posts",
    "inrcy_photos",
    "video_views",
    "views",
    "engagements",
    "likes_period",
    "comments",
    "shares",
  ].some((key) => safeNum(totals[key]) > 0 || Object.prototype.hasOwnProperty.call(totals, key));
}


const INRCY_ACTIVITY_CUBE_KEYS = new Set<CubeKey>(["inr_search", "site_inrcy", "site_web", "gmb", "facebook", "instagram", "linkedin", "x", "tiktok", "youtube_shorts", "pinterest"]);

function normalizeInrcyActivityCount(value: any): InrcyActivityCount {
  return {
    week: Math.max(0, Math.round(safeNum(value?.week))),
    month: Math.max(0, Math.round(safeNum(value?.month))),
    year: Math.max(0, Math.round(safeNum(value?.year))),
    total: Math.max(0, Math.round(safeNum(value?.total))),
  };
}

function emptyInrcyActivityStats(): InrcyActivityStats {
  const empty = { week: 0, month: 0, year: 0, total: 0 };
  return {
    publications: { ...empty },
    photos: { ...empty },
    videos: { ...empty },
    publicationTrackingAvailable: false,
  };
}

export function buildInrcyActivityStats(cubeKey: CubeKey, ov: Overview): InrcyActivityStats | null {
  if (!INRCY_ACTIVITY_CUBE_KEYS.has(cubeKey)) return null;
  const raw = (ov as any)?.inrcyActivity?.[cubeKey];
  if (!raw || typeof raw !== "object") return emptyInrcyActivityStats();
  const rawPublicationTypes = (raw as any).publicationTypes;
  const publicationTypes = rawPublicationTypes && typeof rawPublicationTypes === "object"
    ? Object.fromEntries(
        Object.entries(rawPublicationTypes)
          .filter(([type]) => ["text", "image", "video", "classic", "reel", "story", "short", "pin", "unknown"].includes(type))
          .map(([type, count]) => [type, normalizeInrcyActivityCount(count)]),
      ) as Partial<Record<InrcyPublicationType, InrcyActivityCount>>
    : undefined;
  const publications = normalizeInrcyActivityCount((raw as any).publications);
  return {
    publications,
    photos: normalizeInrcyActivityCount((raw as any).photos),
    videos: normalizeInrcyActivityCount((raw as any).videos),
    publicationTypes,
    publicationTrackingAvailable:
      Object.prototype.hasOwnProperty.call((raw as any).publications || {}, "year") &&
      Object.prototype.hasOwnProperty.call(raw, "publicationTypes"),
    publicationHistoryComplete:
      typeof (raw as any).publicationHistoryComplete === "boolean"
        ? (raw as any).publicationHistoryComplete
        : undefined,
  };
}

function tikTokMetricItems(metrics: any, kind: "visibility" | "actions", locale: string, t: StatsTranslator): CubeMetricItem[] {
  const totals = safeObj(safeObj(metrics).totals);
  const videoViews = safeNum(totals.video_views) || safeNum(totals.views);
  const followers = safeNum(totals.followers);
  const likesTotal = safeNum(totals.likes_total);
  const videoCount = safeNum(totals.video_count) || safeNum(totals.videos_public);
  const inrcyPosts = safeNum(totals.inrcy_posts) || safeNum(totals.postsPublishedLocal);
  const likes = safeNum(totals.likes) || safeNum(totals.likes_period);
  const comments = safeNum(totals.comments);
  const shares = safeNum(totals.shares);
  const saves = safeNum(totals.saves);
  const posts = Math.max(safeNum(totals.postsPublished), inrcyPosts, videoCount);
  const interactions = safeNum(totals.engagements) || likes + comments + shares + saves;

  if (kind === "visibility") {
    return [
      { label: t("vues_video_9a534bb5"), value: fmtInt(videoViews, locale) },
      { label: t("abonnes_fa75b9d9"), value: fmtInt(followers, locale) },
      { label: t("j_aime_recus_f5b74330"), value: fmtInt(likesTotal, locale) },
      { label: t("videos_profil_193bd3a7"), value: fmtInt(videoCount, locale) },
    ];
  }

  return [
    { label: t("interactions_0b3583ec"), value: fmtInt(interactions, locale), subValue: t("metric_tracked_posts", { count: posts }) },
    { label: t("j_aime_b75f4622"), value: fmtInt(likes, locale) },
    { label: t("commentaires_dbdeccaf"), value: fmtInt(comments, locale) },
    { label: t("partages_18ab80f0"), value: fmtInt(shares, locale) },
  ];
}

function pushNumberMetric(
  items: CubeMetricItem[],
  label: string,
  value: number,
  options: { available?: boolean; keepZero?: boolean; formatter?: (value: number) => string } = {},
  locale = "fr-FR",
) {
  const n = Number.isFinite(value) ? value : 0;
  const available = options.available ?? n > 0;
  if (!available) return;
  // Une clé explicitement exposée par le fournisseur vaut réellement zéro.
  // L'absence de clé, elle, reste une donnée indisponible et n'ajoute pas de carte.
  if (!options.keepZero && options.available === undefined && n <= 0) return;
  items.push({ label, value: options.formatter ? options.formatter(n) : fmtInt(n, locale) });
}

function firstFour(items: CubeMetricItem[]) {
  return items.slice(0, 4);
}

function firstSix(items: CubeMetricItem[]) {
  return items.slice(0, 6);
}

function isWebsiteConnected(cubeKey: CubeKey, ov: Overview) {
  if (cubeKey === "site_inrcy") {
    return !!ov?.sources?.site_inrcy?.connected?.ga4 || !!ov?.sources?.site_inrcy?.connected?.gsc;
  }
  if (cubeKey === "site_web") {
    return !!ov?.sources?.site_web?.connected?.ga4 || !!ov?.sources?.site_web?.connected?.gsc;
  }
  return false;
}

export function buildVisibilityStats(cubeKey: CubeKey, ov: Overview, locale: string, t: StatsTranslator): CubeMetricItem[] {
  const items: CubeMetricItem[] = [];
  const pushMetric = (label: string, value: number, options: { available?: boolean; keepZero?: boolean; formatter?: (value: number) => string } = {}) =>
    pushNumberMetric(items, label, value, options, locale);

  if (cubeKey === "gmb") {
    if (!ov?.sources?.gmb?.connected) return [];
    const metrics = ov?.sources?.gmb?.metrics;
    const totals = getGmbTotals(metrics);
    pushMetric(t("impressions_b5fb66f6"), totals.impressions, {
      available: gmbMetricAvailable(metrics, ["impressions", "BUSINESS_IMPRESSIONS"], [
        "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
        "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
        "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
        "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
      ]),
    });
    pushMetric(t("metric_map_views"), totals.mapsImpressions, {
      available: gmbMetricAvailable(metrics, ["BUSINESS_IMPRESSIONS_DESKTOP_MAPS", "BUSINESS_IMPRESSIONS_MOBILE_MAPS"], [
        "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
        "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
      ]),
    });
    pushMetric(t("metric_search_views"), totals.searchImpressions, {
      available: gmbMetricAvailable(metrics, ["BUSINESS_IMPRESSIONS_DESKTOP_SEARCH", "BUSINESS_IMPRESSIONS_MOBILE_SEARCH"], [
        "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
        "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
      ]),
    });
    pushMetric(t("vues_fiche_6d715930"), safeNum(metrics?.totals?.views) || safeNum(metrics?.totals?.BUSINESS_PROFILE_VIEWS), {
      available: metricKeyExists(metrics, ["views", "BUSINESS_PROFILE_VIEWS"]),
    });
    return firstFour(items);
  }

  if (cubeKey === "facebook") {
    if (!ov?.sources?.facebook?.connected) return [];
    const m = ov?.sources?.facebook?.metrics;
    const views = bestMetricValue(m, [
      "page_media_view",
      "post_media_view_sum",
      "views",
      // Compatibilité de lecture avec l'historique déjà stocké avant juin 2026.
      "page_impressions",
      "post_impressions_sum",
      "impressions",
    ]);
    const uniqueViewers = bestMetricValue(m, [
      "page_total_media_view_unique",
      "post_total_media_view_unique_sum",
      "reach",
      "page_impressions_unique",
      "post_impressions_unique_sum",
    ]);
    const audience = Math.max(safeNum(m?.totals?.fan_count), safeNum(m?.totals?.followers_count));
    const pageViews = safeNum(m?.totals?.page_views_total);
    const newFollowers = safeNum(m?.totals?.page_fan_adds) || safeNum(m?.totals?.new_like_count);
    pushMetric(t("vues_ff576f2b"), views, { available: metricKeyExists(m, ["page_media_view", "post_media_view_sum", "views", "page_impressions", "post_impressions_sum", "impressions"]) });
    pushMetric(t("metric_unique_viewers"), uniqueViewers, { available: metricKeyExists(m, ["page_total_media_view_unique", "post_total_media_view_unique_sum", "reach", "page_impressions_unique", "post_impressions_unique_sum"]) });
    pushMetric(t("audience_51d99345"), audience, { available: metricKeyExists(m, ["fan_count", "followers_count"]) });
    pushMetric(t("metric_page_views"), pageViews, { available: metricKeyExists(m, ["page_views_total"]) });
    pushMetric(t("metric_new_followers"), newFollowers, { available: metricKeyExists(m, ["page_fan_adds", "new_like_count"]) });
    return firstSix(items);
  }

  if (cubeKey === "instagram") {
    if (!ov?.sources?.instagram?.connected) return [];
    const m = ov?.sources?.instagram?.metrics;
    const followers = latestDailyMetricValue(m, "follower_count");
    pushMetric(t("metric_reach"), safeNum(m?.totals?.reach), { available: metricKeyExists(m, ["reach"]) });
    pushMetric(t("impressions_b5fb66f6"), safeNum(m?.totals?.impressions), { available: metricKeyExists(m, ["impressions"]) });
    pushMetric(t("metric_profile_views"), safeNum(m?.totals?.profile_views), { available: metricKeyExists(m, ["profile_views"]) });
    pushMetric(t("abonnes_fa75b9d9"), followers, { available: metricKeyExists(m, ["follower_count"]) });
    return firstFour(items);
  }

  if (cubeKey === "x") {
    if (!ov?.sources?.x?.connected) return [];
    const m = ov?.sources?.x?.metrics;
    pushMetric(t("publications_0855684c"), safeNum(m?.totals?.inrcy_posts) || safeNum(m?.totals?.postsPublishedLocal), { available: !!m, keepZero: true });
    pushMetric(t("photos_c8b2e864"), safeNum(m?.totals?.inrcy_photos), { available: !!m, keepZero: true });
    pushMetric(t("videos_ea129238"), safeNum(m?.totals?.inrcy_video_posts), { available: !!m, keepZero: true });
    return firstFour(items);
  }

  if (cubeKey === "tiktok") {
    if (!ov?.sources?.tiktok?.connected) return [];
    return tikTokMetricItems(ov?.sources?.tiktok?.metrics, "visibility", locale, t);
  }

  if (cubeKey === "youtube_shorts") {
    if (!ov?.sources?.youtube_shorts?.connected) return [];
    const m = ov?.sources?.youtube_shorts?.metrics;
    pushMetric(t("vues_video_9a534bb5"), safeNum(m?.totals?.video_views) || safeNum(m?.totals?.views), { available: metricKeyExists(m, ["video_views", "views"]), keepZero: true });
    pushMetric(t("metric_channel_views"), safeNum(m?.totals?.channel_views_total), { available: metricKeyExists(m, ["channel_views_total"]), keepZero: true });
    pushMetric(t("abonnes_fa75b9d9"), safeNum(m?.totals?.subscribers) || safeNum(m?.totals?.followers), { available: metricKeyExists(m, ["subscribers", "followers"]), keepZero: true });
    pushMetric(t("metric_channel_videos"), safeNum(m?.totals?.video_count) || safeNum(m?.totals?.shorts_count), { available: metricKeyExists(m, ["video_count", "shorts_count"]), keepZero: true });
    pushMetric(t("metric_watch_time"), safeNum(m?.totals?.estimatedMinutesWatched), {
      available: youtubeReportHasMetric(m, "estimatedMinutesWatched"),
      keepZero: true,
      formatter: formatMinutesToLabel,
    });
    pushMetric(t("metric_average_duration"), safeNum(m?.totals?.averageViewDuration), {
      available: youtubeReportHasMetric(m, "averageViewDuration"),
      keepZero: true,
      formatter: formatSecondsToLabel,
    });
    return firstSix(items);
  }

  if (cubeKey === "pinterest") {
    if (!ov?.sources?.pinterest?.connected) return [];
    const m = ov?.sources?.pinterest?.metrics;
    pushMetric(t("impressions_b5fb66f6"), safeNum(m?.totals?.impressions) || safeNum(m?.totals?.impressionCount), {
      available: metricKeyExists(m, ["impressions", "impressionCount"]),
    });
    return firstFour(items);
  }

  if (cubeKey === "mails") {
    if (!ov?.sources?.mails?.connected) return [];
    const m = ov?.sources?.mails?.metrics;
    pushMetric(t("boites_63c5cc0d"), safeNum(m?.connectedCount), { formatter: (value) => `${fmtInt(value, locale)}/4` });
    pushMetric(t("contacts_email_90f13253"), safeNum(m?.contactsEmail) || safeNum(m?.contactsCrm));
    pushMetric(t("metric_campaigns_30d"), safeNum(m?.campagnes30));
    pushMetric(t("destinataires_51610ad7"), safeNum(m?.destinataires30));
    return firstFour(items);
  }

  if (cubeKey === "linkedin") {
    if (!ov?.sources?.linkedin?.connected || isLinkedInStatsPartial(ov)) return [];
    const m = ov?.sources?.linkedin?.metrics;
    const impressions = bestMetricValue(m, ["impressionCount", "impressions"]);
    const uniqueImpressions = safeNum(m?.totals?.uniqueImpressionsCount);
    const pageViews = bestMetricValue(m, ["pageViews", "profileViews"]);
    const followers = bestMetricValue(m, ["followers", "followerCount", "memberFollowersCount"]);
    const newFollowers = bestMetricValue(m, ["newFollowers", "followerGainedFromContentCount", "organicFollowerCount", "paidFollowerCount"]);
    pushMetric(t("impressions_b5fb66f6"), impressions, { available: metricKeyExists(m, ["impressionCount", "impressions"]) });
    pushMetric(t("metric_unique_impressions"), uniqueImpressions, { available: metricKeyExists(m, ["uniqueImpressionsCount"]) });
    pushMetric(t("metric_page_views"), pageViews, { available: metricKeyExists(m, ["pageViews", "profileViews"]) });
    pushMetric(t("abonnes_fa75b9d9"), followers, { available: metricKeyExists(m, ["followers", "followerCount", "memberFollowersCount"]) });
    pushMetric(t("metric_new_followers"), newFollowers, { available: metricKeyExists(m, ["newFollowers", "followerGainedFromContentCount", "organicFollowerCount", "paidFollowerCount"]) });
    return firstSix(items);
  }

  if (!isWebsiteConnected(cubeKey, ov)) return [];
  const totals = ov?.totals || ({} as any);
  const gscConnected = cubeKey === "site_inrcy" ? !!ov.sources?.site_inrcy?.connected?.gsc : !!ov.sources?.site_web?.connected?.gsc;
  const ga4Connected = cubeKey === "site_inrcy" ? !!ov.sources?.site_inrcy?.connected?.ga4 : !!ov.sources?.site_web?.connected?.ga4;
  if (gscConnected) {
    pushMetric(t("metric_google_impressions"), safeNum(totals.impressions), { available: true });
    pushMetric(t("metric_google_clicks"), safeNum(totals.clicks), { available: true });
  }
  if (ga4Connected) {
    pushMetric(t("metric_sessions"), safeNum(totals.sessions), { available: true });
    pushMetric(t("metric_pages_viewed"), safeNum(totals.pageviews), { available: true });
    pushMetric(t("metric_users"), safeNum(totals.users), { available: true });
  }
  if (gscConnected) {
    pushMetric(t("metric_google_ctr"), safeNum(totals.ctr) * 100, { available: true, keepZero: true, formatter: (value) => formatPercent(value, locale) });
  }
  return firstSix(items);
}

export function buildActionStats(cubeKey: CubeKey, ov: Overview, locale: string, t: StatsTranslator): CubeMetricItem[] {
  const items: CubeMetricItem[] = [];
  const pushMetric = (label: string, value: number, options: { available?: boolean; keepZero?: boolean; formatter?: (value: number) => string } = {}) =>
    pushNumberMetric(items, label, value, options, locale);

  if (cubeKey === "gmb") {
    if (!ov?.sources?.gmb?.connected) return [];
    const metrics = ov?.sources?.gmb?.metrics;
    const totals = getGmbTotals(metrics);
    const conversations = safeNum(metrics?.totals?.conversations) || safeNum(metrics?.totals?.BUSINESS_CONVERSATIONS) || gmbMetricSeriesTotal(metrics, ["BUSINESS_CONVERSATIONS"]);
    pushMetric(t("metric_calls"), totals.callClicks, {
      available: gmbMetricAvailable(metrics, ["callClicks", "call_clicks", "CALL_CLICKS"], ["CALL_CLICKS"]),
    });
    pushMetric(t("metric_directions"), totals.directionRequests, {
      available: gmbMetricAvailable(metrics, ["directionRequests", "direction_requests", "DIRECTION_REQUESTS", "BUSINESS_DIRECTION_REQUESTS"], ["DIRECTION_REQUESTS", "BUSINESS_DIRECTION_REQUESTS"]),
    });
    pushMetric(t("metric_website_clicks"), totals.websiteClicks, {
      available: gmbMetricAvailable(metrics, ["websiteClicks", "website_clicks", "WEBSITE_CLICKS"], ["WEBSITE_CLICKS"]),
    });
    pushMetric(t("metric_messages"), conversations, {
      available: gmbMetricAvailable(metrics, ["conversations", "BUSINESS_CONVERSATIONS"], ["BUSINESS_CONVERSATIONS"]),
    });
    return firstFour(items);
  }

  if (cubeKey === "facebook") {
    if (!ov?.sources?.facebook?.connected) return [];
    const m = ov?.sources?.facebook?.metrics;
    const interactions =
      bestMetricValue(m, ["page_post_engagements", "page_engaged_users", "post_engaged_users_sum"]) ||
      sumMetricValues(m, ["reactions", "comments", "shares"]);
    pushMetric(t("interactions_0b3583ec"), interactions, {
      available: metricKeyExists(m, ["page_post_engagements", "page_engaged_users", "post_engaged_users_sum", "reactions", "comments", "shares"]),
    });
    pushMetric(t("metric_website_clicks"), safeNum(m?.totals?.page_website_clicks_logged_in_unique), {
      available: metricKeyExists(m, ["page_website_clicks_logged_in_unique"]),
    });
    pushMetric(t("metric_calls"), safeNum(m?.totals?.page_call_phone_clicks_logged_in_unique), {
      available: metricKeyExists(m, ["page_call_phone_clicks_logged_in_unique"]),
    });
    pushMetric(t("metric_directions"), safeNum(m?.totals?.page_get_directions_clicks_logged_in_unique), {
      available: metricKeyExists(m, ["page_get_directions_clicks_logged_in_unique"]),
    });
    pushMetric(t("clics_6e92c5b0"), safeNum(m?.totals?.clicks) || safeNum(m?.totals?.post_clicks_sum), {
      available: metricKeyExists(m, ["clicks", "post_clicks_sum"]),
    });
    return firstSix(items);
  }

  if (cubeKey === "instagram") {
    if (!ov?.sources?.instagram?.connected) return [];
    const m = ov?.sources?.instagram?.metrics;
    const linkClicks = sumMetricValues(m, ["profile_links_taps", "website_clicks"]);
    const interactions = bestMetricValue(m, ["total_interactions", "accounts_engaged"]) || sumMetricValues(m, ["likes", "comments", "shares", "replies", "saves"]);
    const messages = sumMetricValues(m, ["text_message_clicks", "replies"]);
    const calls = safeNum(m?.totals?.phone_call_clicks);
    const directions = safeNum(m?.totals?.get_directions_clicks) + safeNum(m?.totals?.get_direction_clicks);
    const emailContacts = safeNum(m?.totals?.email_contacts);
    pushMetric(t("metric_link_clicks"), linkClicks, { available: metricKeyExists(m, ["profile_links_taps", "website_clicks"]) });
    pushMetric(t("interactions_0b3583ec"), interactions, {
      available: metricKeyExists(m, ["total_interactions", "accounts_engaged", "likes", "comments", "shares", "replies", "saves"]),
    });
    pushMetric(t("metric_messages"), messages, { available: metricKeyExists(m, ["text_message_clicks", "replies"]) });
    pushMetric(t("metric_calls"), calls, { available: metricKeyExists(m, ["phone_call_clicks"]) });
    pushMetric(t("metric_directions"), directions, { available: metricKeyExists(m, ["get_directions_clicks", "get_direction_clicks"]) });
    pushMetric(t("contacts_email_90f13253"), emailContacts, { available: metricKeyExists(m, ["email_contacts"]) });
    return firstSix(items);
  }

  if (cubeKey === "x") {
    if (!ov?.sources?.x?.connected) return [];
    const m = ov?.sources?.x?.metrics;
    pushMetric(t("publications_0855684c"), safeNum(m?.totals?.inrcy_posts) || safeNum(m?.totals?.postsPublishedLocal), { available: !!m, keepZero: true });
    pushMetric(t("photos_c8b2e864"), safeNum(m?.totals?.inrcy_photo_posts), { available: !!m, keepZero: true });
    pushMetric(t("videos_ea129238"), safeNum(m?.totals?.inrcy_video_posts), { available: !!m, keepZero: true });
    return firstFour(items);
  }

  if (cubeKey === "tiktok") {
    if (!ov?.sources?.tiktok?.connected) return [];
    return tikTokMetricItems(ov?.sources?.tiktok?.metrics, "actions", locale, t);
  }

  if (cubeKey === "youtube_shorts") {
    if (!ov?.sources?.youtube_shorts?.connected) return [];
    const m = ov?.sources?.youtube_shorts?.metrics;
    const interactions = sumMetricValues(m, ["engagements", "likes", "comments", "shares", "saves"]);
    pushMetric(t("interactions_0b3583ec"), interactions, { available: metricKeyExists(m, ["engagements", "likes", "comments", "shares", "saves"]) });
    pushMetric(t("j_aime_b75f4622"), safeNum(m?.totals?.likes), { available: metricKeyExists(m, ["likes"]) });
    pushMetric(t("commentaires_dbdeccaf"), safeNum(m?.totals?.comments), { available: metricKeyExists(m, ["comments"]) });
    pushMetric(t("partages_18ab80f0"), safeNum(m?.totals?.shares), { available: metricKeyExists(m, ["shares"]) });
    pushMetric(t("metric_new_followers"), safeNum(m?.totals?.subscribersGained), {
      available: youtubeReportHasMetric(m, "subscribersGained"),
      keepZero: true,
    });
    pushMetric(t("metric_subscriber_net"), safeNum(m?.totals?.subscribersNet), {
      available: youtubeReportHasMetric(m, "subscribersGained") && youtubeReportHasMetric(m, "subscribersLost"),
      keepZero: true,
    });
    return firstSix(items);
  }

  if (cubeKey === "pinterest") {
    if (!ov?.sources?.pinterest?.connected) return [];
    const m = ov?.sources?.pinterest?.metrics;
    pushMetric(t("metric_outbound_clicks"), safeNum(m?.totals?.outbound_clicks) || safeNum(m?.totals?.pageClicks), {
      available: metricKeyExists(m, ["outbound_clicks", "pageClicks"]),
    });
    pushMetric(t("clics_6e92c5b0"), safeNum(m?.totals?.pin_clicks) || safeNum(m?.totals?.clickCount), {
      available: metricKeyExists(m, ["pin_clicks", "clickCount"]),
    });
    pushMetric(t("metric_saves"), safeNum(m?.totals?.saves), {
      available: metricKeyExists(m, ["saves"]),
    });
    pushMetric(t("engagement_4b1f1c7b"), safeNum(m?.totals?.engagements) || safeNum(m?.totals?.engagementCount), {
      available: metricKeyExists(m, ["engagements", "engagementCount"]),
    });
    return firstFour(items);
  }

  if (cubeKey === "mails") {
    if (!ov?.sources?.mails?.connected) return [];
    const m = ov?.sources?.mails?.metrics;
    pushMetric(t("boites_63c5cc0d"), safeNum(m?.connectedCount), { formatter: (value) => `${fmtInt(value, locale)}/4` });
    pushMetric(t("contacts_email_90f13253"), safeNum(m?.contactsEmail) || safeNum(m?.contactsCrm));
    pushMetric(t("metric_campaigns_30d"), safeNum(m?.campagnes30));
    pushMetric(t("destinataires_51610ad7"), safeNum(m?.destinataires30));
    return firstFour(items);
  }

  if (cubeKey === "linkedin") {
    if (!ov?.sources?.linkedin?.connected || isLinkedInStatsPartial(ov)) return [];
    const m = ov?.sources?.linkedin?.metrics;
    const clicks = sumMetricValues(m, ["clickCount", "clicks", "linkClickCount", "pageClicks", "premiumCtaClickCount"]);
    const reactions = bestMetricValue(m, ["reactionCount", "likeCount", "likes"]);
    const comments = bestMetricValue(m, ["commentCount", "comments"]);
    const shares = bestMetricValue(m, ["shareCount", "shares"]);
    const saves = safeNum(m?.totals?.postSaveCount);
    const sends = safeNum(m?.totals?.postSendCount);
    pushMetric(t("clics_6e92c5b0"), clicks, { available: metricKeyExists(m, ["clickCount", "clicks", "linkClickCount", "pageClicks", "premiumCtaClickCount"]) });
    pushMetric(t("metric_reactions"), reactions, { available: metricKeyExists(m, ["reactionCount", "likeCount", "likes"]) });
    pushMetric(t("commentaires_dbdeccaf"), comments, { available: metricKeyExists(m, ["commentCount", "comments"]) });
    pushMetric(t("partages_18ab80f0"), shares, { available: metricKeyExists(m, ["shareCount", "shares"]) });
    pushMetric(t("metric_saves"), saves, { available: metricKeyExists(m, ["postSaveCount"]) });
    pushMetric(t("metric_post_sends"), sends, { available: metricKeyExists(m, ["postSendCount"]) });
    return firstSix(items);
  }

  if (!isWebsiteConnected(cubeKey, ov)) return [];
  const totals = ov?.totals || ({} as any);
  const queries = Array.isArray(ov.topQueries) ? ov.topQueries : [];
  const topPages = Array.isArray(ov.topPages) ? ov.topPages : [];
  const intentQueryCount = queries.filter((q) => isIntentQuery(q.query) && (safeNum(q.clicks) > 0 || safeNum(q.impressions) > 0)).length;
  const contactViews = topPages.filter((page) => pageKind(page.path) === "contact").reduce((sum, page) => sum + safeNum(page.views), 0);
  const gscConnected = cubeKey === "site_inrcy" ? !!ov.sources?.site_inrcy?.connected?.gsc : !!ov.sources?.site_web?.connected?.gsc;
  const ga4Connected = cubeKey === "site_inrcy" ? !!ov.sources?.site_inrcy?.connected?.ga4 : !!ov.sources?.site_web?.connected?.ga4;
  pushMetric(t("metric_contact_pages"), contactViews, { available: ga4Connected });
  pushMetric(t("metric_intent_queries"), intentQueryCount, { available: gscConnected });
  pushMetric(t("engagement_4b1f1c7b"), safeNum(totals.engagementRate) * 100, { available: ga4Connected, formatter: (value) => formatPercent(value, locale) });
  pushMetric(t("metric_average_duration"), safeNum(totals.avgSessionDuration), { available: ga4Connected, formatter: (value) => formatSecondsToLabel(value) });
  return firstFour(items);
}
