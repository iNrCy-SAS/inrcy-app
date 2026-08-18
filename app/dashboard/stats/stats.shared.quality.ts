import { type CubeKey, type Overview, type StatsTranslator } from "./stats.shared.types";
import { bestMetricValue, clamp, latestDailyMetricValue, safeNum, sumMetricValues } from "./stats.shared.core";
import { engagementScore100, getGmbTotals, isIntentQuery, logNorm, mapChannelBucket, pageKind, qualityLabel } from "./stats.shared.opportunity";

const LINKEDIN_DETAIL_SIGNAL_KEYS = [
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

function deepHasLinkedInError(value: any): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((entry) => String(entry || "").trim().length > 0);
  if (typeof value.error === "string" && value.error.trim()) return true;
  if (Array.isArray(value.errors) && value.errors.some((entry: any) => String(entry || "").trim())) return true;
  return Object.values(value).some((entry) => deepHasLinkedInError(entry));
}

function linkedInMetricValue(metrics: any, key: string) {
  return safeNum(metrics?.totals?.[key]) + safeNum(metrics?.[key]);
}

export function hasLinkedInDetailedStats(ov: Overview | null | undefined) {
  const m = ov?.sources?.linkedin?.metrics;
  if (!m) return false;

  // LinkedIn peut remonter des stats exploitables tout en signalant
  // une erreur sur un sous-appel API (ex : profil OK, page partielle, ou inversement).
  // Dans ce cas on garde les chiffres au lieu de masquer tout le bloc.
  return LINKEDIN_DETAIL_SIGNAL_KEYS.some((key) => linkedInMetricValue(m, key) > 0);
}

export function isLinkedInStatsPartial(ov: Overview | null | undefined) {
  const node = ov?.sources?.linkedin;
  if (!node?.connected) return false;
  const m = node.metrics;
  if (!m) return true;

  const hasUsableSignals = hasLinkedInDetailedStats(ov);
  if (hasUsableSignals) return false;

  if (m?.error) return true;
  if (deepHasLinkedInError(m?.raw)) return true;
  return true;
}

export function buildProvenance(cubeKey: CubeKey, ov: Overview, t: StatsTranslator) {
  if (cubeKey === "mails") {
    const m = ov?.sources?.mails?.metrics;
    return [
      { label: t("fideliser_8fa9e4f1"), value: safeNum(m?.fidelisations30), colorVar: "--cSocial" },
      { label: t("propulser_2de43942"), value: safeNum(m?.propulsions30), colorVar: "--cGoogle" },
      { label: t("mails_simples_608d9dcf"), value: safeNum(m?.mailsSimples30), colorVar: "--cDirect" },
    ];
  }

  if (cubeKey === "gmb") {
    const m = ov?.sources?.gmb?.metrics;
    const { impressions, mapsImpressions: maps, searchImpressions: search } = getGmbTotals(m);
    if (maps > 0 || search > 0) {
      return [
        { label: t("maps_80071cd7"), value: maps, colorVar: "--cGoogle" },
        { label: t("search_bce06414"), value: search, colorVar: "--cDirect" },
      ];
    }
    if (impressions > 0) {
      return [
        { label: t("visibilite_locale_afa9cdc9"), value: impressions, colorVar: "--cGoogle" },
      ];
    }
    return [
      { label: t("maps_80071cd7"), value: 0, colorVar: "--cGoogle" },
      { label: t("search_bce06414"), value: 0, colorVar: "--cDirect" },
    ];
  }

  if (cubeKey === "facebook") {
    const m = ov?.sources?.facebook?.metrics;
    const audience = Math.max(
      safeNum(m?.totals?.page_total_media_view_unique),
      safeNum(m?.totals?.post_total_media_view_unique_sum),
      safeNum(m?.totals?.reach),
      // Historique antérieur à la migration Meta de juin 2026.
      safeNum(m?.totals?.page_impressions_unique),
      safeNum(m?.totals?.post_impressions_unique_sum),
      safeNum(m?.totals?.fan_count),
      safeNum(m?.totals?.followers_count),
      safeNum(m?.totals?.page_views_total),
    );
    const interactions =
      bestMetricValue(m, ["page_post_engagements", "page_engaged_users", "post_engaged_users_sum"]) ||
      sumMetricValues(m, ["reactions", "comments", "shares"]);
    return [
      { label: t("audience_51d99345"), value: audience, colorVar: "--cSocial" },
      { label: t("interactions_0b3583ec"), value: interactions, colorVar: "--cGoogle" },
    ];
  }

  if (cubeKey === "instagram") {
    const m = ov?.sources?.instagram?.metrics;
    const audience =
      safeNum(m?.totals?.reach) +
      safeNum(m?.totals?.profile_views) +
      latestDailyMetricValue(m, "follower_count");
    const engagement =
      bestMetricValue(m, ["total_interactions", "accounts_engaged"]) ||
      sumMetricValues(m, ["profile_links_taps", "website_clicks", "phone_call_clicks", "email_contacts", "text_message_clicks", "get_directions_clicks", "get_direction_clicks"]);
    return [
      { label: t("audience_51d99345"), value: audience, colorVar: "--cSocial" },
      { label: t("engagement_4b1f1c7b"), value: engagement, colorVar: "--cGoogle" },
    ];
  }

  if (cubeKey === "tiktok") {
    const m = ov?.sources?.tiktok?.metrics;
    const audience = safeNum(m?.totals?.video_views) + safeNum(m?.totals?.views) + safeNum(m?.totals?.profile_views) + safeNum(m?.totals?.followers);
    const engagement = sumMetricValues(m, ["engagements", "likes", "comments", "shares", "saves"]);
    return [
      { label: t("vues_ff576f2b"), value: audience, colorVar: "--cSocial" },
      { label: t("engagement_4b1f1c7b"), value: engagement, colorVar: "--cGoogle" },
    ];
  }

  if (cubeKey === "youtube_shorts") {
    const m = ov?.sources?.youtube_shorts?.metrics;
    const audience = safeNum(m?.totals?.video_views) + safeNum(m?.totals?.views) + safeNum(m?.totals?.profile_views) + safeNum(m?.totals?.subscribers);
    const engagement = sumMetricValues(m, ["engagements", "likes", "comments", "shares", "saves"]);
    return [
      { label: t("vues_ff576f2b"), value: audience, colorVar: "--cSocial" },
      { label: t("engagement_4b1f1c7b"), value: engagement, colorVar: "--cGoogle" },
    ];
  }

  if (cubeKey === "linkedin") {
    const m = ov?.sources?.linkedin?.metrics;
    const impressions =
      bestMetricValue(m, ["impressionCount", "impressions"]) +
      safeNum(m?.totals?.uniqueImpressionsCount) +
      safeNum(m?.totals?.pageViews);
    const clicks = sumMetricValues(m, ["clickCount", "clicks", "linkClickCount", "premiumCtaClickCount", "pageClicks"]);
    return [
      { label: t("impressions_b5fb66f6"), value: impressions, colorVar: "--cSocial" },
      { label: t("clics_6e92c5b0"), value: clicks, colorVar: "--cGoogle" },
    ];
  }

  const buckets = { google: 0, direct: 0, social: 0, other: 0 };
  for (const c of Array.isArray(ov.channels) ? ov.channels : []) {
    const b = mapChannelBucket(c.channel);
    buckets[b] += safeNum(c.sessions);
  }
  return [
    { label: t("google_2b681c0a"), value: buckets.google, colorVar: "--cGoogle" },
    { label: t("direct_bc81524a"), value: buckets.direct, colorVar: "--cDirect" },
    { label: t("social_41a57508"), value: buckets.social, colorVar: "--cSocial" },
    { label: t("autres_2f0dd042"), value: buckets.other, colorVar: "--cOther" },
  ];
}

function localizedQualityLabel(score: number, t: StatsTranslator) {
  const base = qualityLabel(score);
  const key = score >= 80
    ? "excellent_1aafbf54"
    : score >= 65
      ? "solide_ab31c54d"
      : score >= 45
        ? "correct_48e09e45"
        : "a_ameliorer_3b604209";
  return { ...base, label: t(key) };
}

export function computeQuality(cubeKey: CubeKey, ov: Overview, t: StatsTranslator) {
  if (cubeKey === "gmb") {
    const connected = !!ov?.sources?.gmb?.connected;
    if (!connected) return { score: 0, ...localizedQualityLabel(0, t) };

    const m = ov?.sources?.gmb?.metrics;
    if (m?.error) return { score: 55, ...localizedQualityLabel(55, t) };
    return { score: 70, ...localizedQualityLabel(70, t) };
  }

  if (cubeKey === "mails") {
    const connected = !!ov?.sources?.mails?.connected;
    if (!connected) return { score: 0, ...localizedQualityLabel(0, t) };
    const m = ov?.sources?.mails?.metrics;
    const accounts = safeNum(m?.connectedCount);
    const contacts = safeNum(m?.contactsCrm);
    const campaigns = safeNum(m?.campagnes30);
    const destinataires = safeNum(m?.destinataires30);
    const agenda = safeNum(m?.agendaReminders30);
    const score = clamp(Math.round(35 + Math.min(25, accounts * 8) + Math.min(20, contacts / 10) + Math.min(20, campaigns * 4 + destinataires * 0.10 + agenda * 0.12)), 35, 92);
    return { score, ...localizedQualityLabel(score, t) };
  }

  if (cubeKey === "facebook" || cubeKey === "instagram" || cubeKey === "linkedin" || cubeKey === "tiktok" || cubeKey === "youtube_shorts" || cubeKey === "pinterest") {
    return computeSocialQuality(cubeKey, ov, t);
  }

  const totals = ov.totals || ({} as any);
  const engagement = engagementScore100(totals);
  const pages = Array.isArray(ov.topPages) ? ov.topPages : [];
  const queries = Array.isArray(ov.topQueries) ? ov.topQueries : [];

  const hasContact = pages.some((p) => pageKind(p.path) === "contact");
  const hasService = pages.some((p) => pageKind(p.path) === "service");
  const hasPricing = pages.some((p) => pageKind(p.path) === "pricing");

  const intentClicks = queries.filter((q) => isIntentQuery(q.query)).reduce((s, q) => s + safeNum(q.clicks), 0);
  const totalClicks = queries.reduce((s, q) => s + safeNum(q.clicks), 0);
  const intentShare = totalClicks > 0 ? clamp(intentClicks / totalClicks, 0, 1) : 0;

  let score = engagement;
  score += hasContact ? 8 : -6;
  score += hasService ? 6 : -4;
  score += hasPricing ? 4 : 0;
  score += Math.round(intentShare * 10);

  if (cubeKey === "site_inrcy") score += 10;

  score = clamp(score, 15, 95);
  return { score, ...localizedQualityLabel(score, t) };
}

export function getSocialMetrics(cubeKey: "facebook" | "instagram" | "linkedin" | "tiktok" | "youtube_shorts" | "pinterest", ov: Overview) {
  const m =
    cubeKey === "facebook"
      ? ov?.sources?.facebook?.metrics
      : cubeKey === "instagram"
        ? ov?.sources?.instagram?.metrics
        : cubeKey === "tiktok"
          ? ov?.sources?.tiktok?.metrics
          : cubeKey === "youtube_shorts"
            ? ov?.sources?.youtube_shorts?.metrics
            : cubeKey === "pinterest"
              ? ov?.sources?.pinterest?.metrics
              : ov?.sources?.linkedin?.metrics;

  const audience =
    cubeKey === "facebook"
      ? safeNum(m?.totals?.fan_count) + safeNum(m?.totals?.followers_count) + bestMetricValue(m, ["page_total_media_view_unique", "post_total_media_view_unique_sum", "reach", "page_impressions_unique", "post_impressions_unique_sum"])
      : cubeKey === "instagram"
        ? latestDailyMetricValue(m, "follower_count") + safeNum(m?.totals?.reach) + safeNum(m?.totals?.profile_views)
        : cubeKey === "tiktok"
          ? safeNum(m?.totals?.followers) + safeNum(m?.totals?.profile_views) + safeNum(m?.totals?.video_views)
          : cubeKey === "youtube_shorts"
            ? safeNum(m?.totals?.subscribers) + safeNum(m?.totals?.followers) + safeNum(m?.totals?.profile_views) + safeNum(m?.totals?.video_views) + safeNum(m?.totals?.views)
            : cubeKey === "pinterest"
              ? Math.max(safeNum(m?.totals?.impressions), safeNum(m?.totals?.impressionCount))
              : safeNum(m?.totals?.followers) +
              safeNum(m?.totals?.followerCount) +
              safeNum(m?.totals?.memberFollowersCount) +
              safeNum(m?.totals?.organicFollowerCount) +
              safeNum(m?.totals?.paidFollowerCount) +
              safeNum(m?.totals?.pageViews) +
              safeNum(m?.totals?.uniqueImpressionsCount);

  const engagement =
    cubeKey === "facebook"
      ? safeNum(m?.totals?.page_engaged_users) + safeNum(m?.totals?.post_engaged_users_sum) + safeNum(m?.totals?.reactions) + safeNum(m?.totals?.comments) + safeNum(m?.totals?.shares)
      : cubeKey === "instagram"
        ? safeNum(m?.totals?.likes) + safeNum(m?.totals?.comments) + safeNum(m?.totals?.shares) + safeNum(m?.totals?.replies) + safeNum(m?.totals?.saves)
        : cubeKey === "tiktok"
          ? safeNum(m?.totals?.engagements) + safeNum(m?.totals?.likes) + safeNum(m?.totals?.comments) + safeNum(m?.totals?.shares) + safeNum(m?.totals?.saves)
          : cubeKey === "youtube_shorts"
            ? safeNum(m?.totals?.engagements) + safeNum(m?.totals?.likes) + safeNum(m?.totals?.comments) + safeNum(m?.totals?.shares) + safeNum(m?.totals?.saves)
            : cubeKey === "pinterest"
              ? Math.max(safeNum(m?.totals?.engagements), safeNum(m?.totals?.engagementCount))
              : safeNum(m?.totals?.engagementCount) + safeNum(m?.totals?.reactionCount) + safeNum(m?.totals?.commentCount) + safeNum(m?.totals?.shareCount);

  const conversions =
    cubeKey === "facebook"
      ? safeNum(m?.totals?.page_website_clicks_logged_in_unique) + safeNum(m?.totals?.page_call_phone_clicks_logged_in_unique) + safeNum(m?.totals?.page_get_directions_clicks_logged_in_unique)
      : cubeKey === "instagram"
        ? safeNum(m?.totals?.profile_links_taps) + safeNum(m?.totals?.website_clicks) + safeNum(m?.totals?.phone_call_clicks) + safeNum(m?.totals?.email_contacts) + safeNum(m?.totals?.text_message_clicks) + safeNum(m?.totals?.get_directions_clicks) + safeNum(m?.totals?.get_direction_clicks)
        : cubeKey === "tiktok"
          ? safeNum(m?.totals?.website_clicks) + safeNum(m?.totals?.profile_views) + safeNum(m?.totals?.messages)
          : cubeKey === "youtube_shorts"
            ? safeNum(m?.totals?.website_clicks) + safeNum(m?.totals?.profile_views) + safeNum(m?.totals?.messages)
            : cubeKey === "pinterest"
              ? Math.max(safeNum(m?.totals?.outbound_clicks), safeNum(m?.totals?.pageClicks)) + Math.max(safeNum(m?.totals?.pin_clicks), safeNum(m?.totals?.clickCount))
              : safeNum(m?.totals?.clickCount) + safeNum(m?.totals?.pageClicks);

  const visibility =
    cubeKey === "facebook"
      ? bestMetricValue(m, ["page_media_view", "post_media_view_sum", "views", "page_impressions", "post_impressions_sum", "impressions"])
      : cubeKey === "instagram"
        ? safeNum(m?.totals?.impressions) + safeNum(m?.totals?.reach)
        : cubeKey === "tiktok"
          ? safeNum(m?.totals?.impressions) + safeNum(m?.totals?.video_views) + safeNum(m?.totals?.views)
          : cubeKey === "youtube_shorts"
            ? safeNum(m?.totals?.impressions) + safeNum(m?.totals?.video_views) + safeNum(m?.totals?.views)
            : cubeKey === "pinterest"
              ? Math.max(safeNum(m?.totals?.impressions), safeNum(m?.totals?.impressionCount))
              : safeNum(m?.totals?.impressionCount) + safeNum(m?.totals?.uniqueImpressionsCount);

  return { audience, engagement, conversions, visibility };
}

function computeSocialQuality(cubeKey: "facebook" | "instagram" | "linkedin" | "tiktok" | "youtube_shorts" | "pinterest", ov: Overview, t: StatsTranslator) {
  const connected =
    cubeKey === "facebook"
      ? !!ov?.sources?.facebook?.connected
      : cubeKey === "instagram"
        ? !!ov?.sources?.instagram?.connected
        : cubeKey === "tiktok"
          ? !!ov?.sources?.tiktok?.connected
          : cubeKey === "youtube_shorts"
            ? !!ov?.sources?.youtube_shorts?.connected
            : cubeKey === "pinterest"
              ? !!ov?.sources?.pinterest?.connected
              : !!ov?.sources?.linkedin?.connected;
  if (!connected) return { score: 0, ...localizedQualityLabel(0, t) };

  const { audience, engagement, conversions, visibility } = getSocialMetrics(cubeKey, ov);
  const exposureBase =
    cubeKey === "instagram" ? 2500 : cubeKey === "linkedin" ? 1200 : (cubeKey === "tiktok" || cubeKey === "youtube_shorts" || cubeKey === "pinterest") ? 3200 : 3000;
  const engagementBase =
    cubeKey === "instagram" ? 120 : cubeKey === "linkedin" ? 45 : (cubeKey === "tiktok" || cubeKey === "youtube_shorts" || cubeKey === "pinterest") ? 160 : 90;
  const conversionBase =
    cubeKey === "instagram" ? 6 : cubeKey === "linkedin" ? 3 : 5;

  const s1 = logNorm(Math.max(visibility, audience), exposureBase);
  const s2 = logNorm(engagement, engagementBase);
  const s3 = logNorm(conversions, conversionBase);

  const score = clamp(Math.round((s1 * 0.35 + s2 * 0.35 + s3 * 0.30) * 100), 18, 92);
  return { score, ...localizedQualityLabel(score, t) };
}
