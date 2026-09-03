import { type CubeKey, type Overview } from "./stats.shared.types";
import { clamp, safeNum, safeObj } from "./stats.shared.core";

export function gmbMetricSeriesTotal(metrics: any, metricNames: string[]) {
  const rawSeries = Array.isArray(metrics?.raw?.multiDailyMetricTimeSeries)
    ? metrics.raw.multiDailyMetricTimeSeries
    : Array.isArray(metrics?.multiDailyMetricTimeSeries)
      ? metrics.multiDailyMetricTimeSeries
      : [];
  return rawSeries.reduce((sum: number, series: any) => {
    if (!metricNames.includes(String(series?.dailyMetric || ""))) return sum;
    const datedValues = Array.isArray(series?.timeSeries?.datedValues) ? series.timeSeries.datedValues : [];
    return sum + datedValues.reduce((inner: number, dv: any) => inner + safeNum(dv?.value?.value ?? dv?.value), 0);
  }, 0);
}

export function getGmbTotals(metrics: any) {
  const totals = metrics?.totals || {};
  const impressions =
    safeNum(totals.impressions) ||
    safeNum(totals.BUSINESS_IMPRESSIONS) ||
    safeNum(totals.BUSINESS_IMPRESSIONS_DESKTOP_MAPS) +
      safeNum(totals.BUSINESS_IMPRESSIONS_MOBILE_MAPS) +
      safeNum(totals.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH) +
      safeNum(totals.BUSINESS_IMPRESSIONS_MOBILE_SEARCH) ||
    gmbMetricSeriesTotal(metrics, [
      "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
      "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
      "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
      "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
    ]);

  const websiteClicks =
    safeNum(totals.websiteClicks) ||
    safeNum(totals.website_clicks) ||
    safeNum(totals.WEBSITE_CLICKS) ||
    gmbMetricSeriesTotal(metrics, ["WEBSITE_CLICKS"]);

  const callClicks =
    safeNum(totals.callClicks) ||
    safeNum(totals.call_clicks) ||
    safeNum(totals.CALL_CLICKS) ||
    gmbMetricSeriesTotal(metrics, ["CALL_CLICKS"]);

  const directionRequests =
    safeNum(totals.directionRequests) ||
    safeNum(totals.direction_requests) ||
    safeNum(totals.DIRECTION_REQUESTS) ||
    gmbMetricSeriesTotal(metrics, ["DIRECTION_REQUESTS", "BUSINESS_DIRECTION_REQUESTS"]);

  const mapsImpressions =
    safeNum(totals.BUSINESS_IMPRESSIONS_DESKTOP_MAPS) +
    safeNum(totals.BUSINESS_IMPRESSIONS_MOBILE_MAPS) ||
    gmbMetricSeriesTotal(metrics, ["BUSINESS_IMPRESSIONS_DESKTOP_MAPS", "BUSINESS_IMPRESSIONS_MOBILE_MAPS"]);

  const searchImpressions =
    safeNum(totals.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH) +
    safeNum(totals.BUSINESS_IMPRESSIONS_MOBILE_SEARCH) ||
    gmbMetricSeriesTotal(metrics, ["BUSINESS_IMPRESSIONS_DESKTOP_SEARCH", "BUSINESS_IMPRESSIONS_MOBILE_SEARCH"]);

  return { impressions, websiteClicks, callClicks, directionRequests, mapsImpressions, searchImpressions };
}

type GscOpportunitySectorConfig = {
  impressionRef: number;
  clickRef: number;
  intentRef: number;
  ctrTarget: number;
  bonusWeight: number;
  directIntentFactor: number;
  visibilityWeight: number;
  trafficWeight: number;
  intentWeight: number;
  ctrWeight: number;
  minImpressionsForCtr: number;
};

const DEFAULT_GSC_OPPORTUNITY_CONFIG: GscOpportunitySectorConfig = {
  impressionRef: 120,
  clickRef: 8,
  intentRef: 3,
  ctrTarget: 0.05,
  bonusWeight: 0.35,
  directIntentFactor: 0.10,
  visibilityWeight: 0.20,
  trafficWeight: 0.20,
  intentWeight: 0.40,
  ctrWeight: 0.20,
  minImpressionsForCtr: 150,
};

const GSC_OPPORTUNITY_CONFIG_BY_SECTOR: Record<string, Partial<GscOpportunitySectorConfig>> = {
  artisan_btp: { impressionRef: 80, clickRef: 5, intentRef: 1.8, ctrTarget: 0.045, bonusWeight: 0.44, directIntentFactor: 0.16 },
  sante: { impressionRef: 90, clickRef: 5, intentRef: 2, ctrTarget: 0.05, bonusWeight: 0.42, directIntentFactor: 0.15 },
  medecine_douce: { impressionRef: 90, clickRef: 5, intentRef: 2, ctrTarget: 0.048, bonusWeight: 0.41, directIntentFactor: 0.15 },
  immobilier: { impressionRef: 85, clickRef: 5, intentRef: 1.8, ctrTarget: 0.045, bonusWeight: 0.45, directIntentFactor: 0.16 },
  services_particuliers: { impressionRef: 85, clickRef: 5, intentRef: 1.8, ctrTarget: 0.045, bonusWeight: 0.43, directIntentFactor: 0.15 },
  transport: { impressionRef: 85, clickRef: 5, intentRef: 1.8, ctrTarget: 0.045, bonusWeight: 0.43, directIntentFactor: 0.15 },
  juridique: { impressionRef: 75, clickRef: 4, intentRef: 1.5, ctrTarget: 0.05, bonusWeight: 0.46, directIntentFactor: 0.17 },
  finance: { impressionRef: 75, clickRef: 4, intentRef: 1.5, ctrTarget: 0.05, bonusWeight: 0.45, directIntentFactor: 0.16 },
  hotel_restaurant: { impressionRef: 140, clickRef: 10, intentRef: 3.5, ctrTarget: 0.04, bonusWeight: 0.32, directIntentFactor: 0.09 },
  commerce_boutique: { impressionRef: 130, clickRef: 9, intentRef: 3.2, ctrTarget: 0.04, bonusWeight: 0.31, directIntentFactor: 0.09 },
  automobile: { impressionRef: 100, clickRef: 6, intentRef: 2.2, ctrTarget: 0.045, bonusWeight: 0.39, directIntentFactor: 0.13 },
  communication: { impressionRef: 160, clickRef: 12, intentRef: 4, ctrTarget: 0.035, bonusWeight: 0.28, directIntentFactor: 0.08 },
  plateformes_numeriques: { impressionRef: 170, clickRef: 12, intentRef: 4, ctrTarget: 0.035, bonusWeight: 0.28, directIntentFactor: 0.08 },
  services_entreprises: { impressionRef: 140, clickRef: 10, intentRef: 3.5, ctrTarget: 0.038, bonusWeight: 0.30, directIntentFactor: 0.09 },
  evenementiel: { impressionRef: 130, clickRef: 9, intentRef: 3, ctrTarget: 0.04, bonusWeight: 0.34, directIntentFactor: 0.11 },
  animalier: { impressionRef: 105, clickRef: 6, intentRef: 2.2, ctrTarget: 0.045, bonusWeight: 0.38, directIntentFactor: 0.12 },
  autre: { impressionRef: 110, clickRef: 7, intentRef: 2.6, ctrTarget: 0.045, bonusWeight: 0.35, directIntentFactor: 0.10 },
};

function getGscOpportunityConfig(sectorCategory?: string | null): GscOpportunitySectorConfig {
  const overrides = GSC_OPPORTUNITY_CONFIG_BY_SECTOR[String(sectorCategory || "").trim()] || {};
  return { ...DEFAULT_GSC_OPPORTUNITY_CONFIG, ...overrides };
}

function normalizeRange(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return 0;
  if (max <= min) return 0;
  return clamp((value - min) / (max - min), 0, 1);
}

const INTENT_PATTERNS: RegExp[] = [
  /\bdevis\b/i,
  /\bprix\b/i,
  /\btarif\b/i,
  /\burgen/i,
  /\b24\/?24\b/i,
  /\bcontact\b/i,
  /\brdv\b/i,
  /\brendez[- ]?vous\b/i,
  /\bprès de moi\b/i,
  /\bpres de moi\b/i,
  /\bnear me\b/i,
];

export function isIntentQuery(q: string) {
  return INTENT_PATTERNS.some((re) => re.test(q));
}

export function pageKind(path: string): "contact" | "pricing" | "service" | "other" {
  const p = (path || "").toLowerCase();
  if (/(contact|devis|rdv|rendez|reservation|telephone|t[ée]l[ée]phone)/.test(p)) return "contact";
  if (/(tarif|prix|pricing)/.test(p)) return "pricing";
  if (/(service|services|prestation|prestations|depannage|intervention|urgence)/.test(p)) return "service";
  return "other";
}

export function mapChannelBucket(ch: string): "google" | "direct" | "social" | "other" {
  const c = (ch || "").toLowerCase();
  if (c.includes("organic search") || c.includes("paid search") || c.includes("cross-network") || c.includes("google")) {
    return "google";
  }
  if (c.includes("direct")) return "direct";
  if (c.includes("social")) return "social";
  return "other";
}

export function engagementScore100(t: Overview["totals"]) {
  const engagementRate = safeNum(t.engagementRate, 0);
  const sessions = Math.max(0, safeNum(t.sessions, 0));
  const pageviews = Math.max(0, safeNum(t.pageviews, 0));
  const pps = sessions > 0 ? pageviews / sessions : 0;
  const duration = safeNum(t.avgSessionDuration, 0);

  const s1 = normalizeRange(engagementRate, 0.20, 0.78);
  const s2 = normalizeRange(pps, 1.1, 4.0);
  const s3 = normalizeRange(duration, 35, 210);

  const raw = (s1 * 0.5 + s2 * 0.3 + s3 * 0.2) * 100;
  return Math.max(15, Math.min(95, Math.round(raw)));
}

export function qualityLabel(score: number) {
  if (score >= 80) return { label: "Excellent", tone: "excellent" as const };
  if (score >= 65) return { label: "Solide", tone: "solid" as const };
  if (score >= 45) return { label: "Correct", tone: "ok" as const };
  return { label: "À améliorer", tone: "low" as const };
}

function computeOpportunityPerDayWeb(ov: Overview) {
  const baseDays = Math.max(1, safeNum(ov.days, 30));
  const t = ov.totals || ({} as any);
  const sessions = safeNum(t.sessions);
  const clicks = safeNum(t.clicks);
  const impressions = safeNum(t.impressions);
  const ctr = clamp(safeNum(t.ctr, 0), 0, 1);
  const engagementRate = clamp(safeNum(t.engagementRate, 0.45), 0, 1);
  const avgSessionDurationSec = clamp(safeNum(t.avgSessionDuration, 110), 10, 600);

  const channels = Array.isArray(ov.channels) ? ov.channels : [];
  const direct = channels.find((c) => (c?.channel || "").toLowerCase().includes("direct"));
  const directShare = sessions > 0 ? clamp(safeNum(direct?.sessions) / sessions, 0, 1) : 0;

  const topQueries = Array.isArray(ov.topQueries) ? ov.topQueries : [];
  const intentClicks = topQueries.filter((q) => isIntentQuery(q.query)).reduce((s, q) => s + safeNum(q.clicks), 0);

  const topPages = Array.isArray(ov.topPages) ? ov.topPages : [];
  const contactViews = topPages.filter((p) => pageKind(p.path) === "contact").reduce((s, p) => s + safeNum(p.views), 0);

  const trafficScore = clamp((sessions / baseDays) / 50, 0, 1);
  const intentScore = clamp((intentClicks / baseDays) / 3, 0, 1);
  const durationScore = clamp(avgSessionDurationSec / 180, 0, 1);

  const baseIndex = 0.45 * trafficScore + 0.30 * intentScore + 0.15 * engagementRate + 0.10 * durationScore;

  let rawPerDay =
    ((sessions / baseDays) * 0.08 + (clicks / baseDays) * 0.10 + (intentClicks / baseDays) * 0.32 + (contactViews / baseDays) * 0.05) *
    (0.65 + baseIndex) *
    (0.85 + clamp(directShare / 0.65, 0, 1) * 0.20);

  const gscConnected = !!ov?.sources?.site_inrcy?.connected?.gsc || !!ov?.sources?.site_web?.connected?.gsc;
  if (gscConnected && (impressions > 0 || clicks > 0 || intentClicks > 0)) {
    const cfg = getGscOpportunityConfig(ov.business?.sectorCategory);
    const gscImpressionsPerDay = impressions / baseDays;
    const gscClicksPerDay = clicks / baseDays;
    const gscIntentClicksPerDay = intentClicks / baseDays;
    const visibilityN = logNorm(gscImpressionsPerDay, cfg.impressionRef);
    const trafficN = logNorm(gscClicksPerDay, cfg.clickRef);
    const intentN = logNorm(gscIntentClicksPerDay, cfg.intentRef);
    const ctrOppN = impressions >= cfg.minImpressionsForCtr ? clamp((cfg.ctrTarget - ctr) / Math.max(0.01, cfg.ctrTarget), 0, 1) : 0;
    const gscBonusIndex =
      cfg.visibilityWeight * visibilityN +
      cfg.trafficWeight * trafficN +
      cfg.intentWeight * intentN +
      cfg.ctrWeight * ctrOppN;
    const gscBasePerDay = 0.10 * visibilityN + 0.12 * trafficN + 0.22 * intentN + 0.08 * ctrOppN;
    rawPerDay = (rawPerDay + gscBasePerDay + gscIntentClicksPerDay * cfg.directIntentFactor) * (1 + gscBonusIndex * cfg.bonusWeight);
  }

  return clamp(rawPerDay, 0, 999);
}

function getTotalMetric(metrics: any, keys: string[]): number {
  const m = safeObj(metrics);
  const totals = safeObj(m.totals);
  for (const k of keys) {
    const n = safeNum((totals as any)[k]);
    if (n) return n;
  }
  return 0;
}

export function logNorm(x: number, ref: number) {
  const xx = Math.max(0, x);
  const rr = Math.max(1, ref);
  return clamp(Math.log1p(xx) / Math.log1p(rr), 0, 1);
}

function computeOpportunityPerDaySocial(cubeKey: CubeKey, ov: Overview): number {
  const baseDays = Math.max(1, safeNum(ov.days, 30));
  const node = safeObj((ov as any)?.sources?.[cubeKey]);
  const connected = !!node.connected;
  const m = (node as any).metrics;

  if (!connected) return 0;

  const coldStartBaseline = cubeKey === "instagram" ? 0.18 : cubeKey === "linkedin" ? 0 : (cubeKey === "tiktok" || cubeKey === "youtube_shorts" || cubeKey === "pinterest") ? 0.18 : 0.2;
  if (!m) return coldStartBaseline;

  const audienceTotal =
    getTotalMetric(m, [
      "followers",
      "followerCount",
      "memberFollowersCount",
      "organicFollowerCount",
      "paidFollowerCount",
      "follower_count",
      "followers_count",
      "fan_count",
      "fans",
      "fanCount",
      "audience",
      "subscribers",
    ]) || 0;

  if (safeObj(m).error && !(cubeKey === "linkedin" && audienceTotal > 0)) return coldStartBaseline;

  const impressionsTotal =
    getTotalMetric(m, [
      "impressions",
      "page_media_view",
      "post_media_view",
      "post_media_view_sum",
      "post_impressions",
      "postImpressions",
      "post_impressions_sum",
      "IMPRESSIONS",
      "impressionCount",
      "uniqueImpressionsCount",
      "viewerImpressions",
      "reach",
      "REACH",
    ]) || 0;

  const engagementsTotal =
    getTotalMetric(m, [
      "engagements",
      "engagementCount",
      "post_engagements",
      "postEngagements",
      "ENGAGEMENTS",
      "total_engagements",
      "page_engaged_users",
      "post_engaged_users_sum",
      "reactions",
      "reactionCount",
      "comments",
      "commentCount",
      "shares",
      "shareCount",
      "likes",
      "likeCount",
      "saves",
      "replies",
      "video_views",
      "videoViews",
    ]) || 0;

  const ctaClicksTotal =
    getTotalMetric(m, [
      "cta_clicks",
      "ctaClicks",
      "link_clicks",
      "linkClicks",
      "website_clicks",
      "websiteClicks",
      "page_website_clicks_logged_in_unique",
      "CLICK_COUNT",
      "clickCount",
      "clicks",
      "outbound_clicks",
      "outboundClicks",
      "profile_links_taps",
      "text_message_clicks",
      "get_directions_clicks",
      "get_direction_clicks",
    ]) || 0;

  const impressionsPerDay = impressionsTotal / baseDays;
  const engagementsPerDay = engagementsTotal / baseDays;
  const ctaClicksPerDay = ctaClicksTotal / baseDays;

  if (cubeKey === "linkedin") {
    const commentsTotal = getTotalMetric(m, ["commentCount", "comments"]);
    const sharesTotal = getTotalMetric(m, ["shareCount", "shares"]);
    const likesTotal = getTotalMetric(m, ["likeCount", "likes", "reactions", "reactionCount"]);
    const newFollowersTotal = getTotalMetric(m, ["newFollowers", "followerGainedFromContentCount"]);
    const postsPublishedTotal = getTotalMetric(m, ["postsPublished"]);
    const uniqueImpressionsTotal = getTotalMetric(m, ["uniqueImpressionsCount"]);
    const contentClicksTotal = getTotalMetric(m, ["linkClickCount", "premiumCtaClickCount", "clickCount", "clicks", "pageClicks"]);
    const contentSavesTotal = getTotalMetric(m, ["postSaveCount"]);
    const contentSendsTotal = getTotalMetric(m, ["postSendCount"]);
    const contentProfileViewsTotal = getTotalMetric(m, ["profileViewFromContentCount", "profileViews"]);

    const hasRealLinkedInSignal =
      impressionsTotal > 0 ||
      uniqueImpressionsTotal > 0 ||
      engagementsTotal > 0 ||
      commentsTotal > 0 ||
      sharesTotal > 0 ||
      likesTotal > 0 ||
      newFollowersTotal > 0 ||
      postsPublishedTotal > 0 ||
      contentClicksTotal > 0 ||
      contentSavesTotal > 0 ||
      contentSendsTotal > 0 ||
      contentProfileViewsTotal > 0 ||
      audienceTotal > 0;

    if (!hasRealLinkedInSignal) return 0;

    const currentPerDay = clamp(
      0.03 +
        (commentsTotal / baseDays) * 0.22 +
        (sharesTotal / baseDays) * 0.18 +
        (newFollowersTotal / baseDays) * 0.14 +
        (likesTotal / baseDays) * 0.05 +
        (contentClicksTotal / baseDays) * 0.20 +
        (contentSavesTotal / baseDays) * 0.12 +
        (contentSendsTotal / baseDays) * 0.10 +
        (contentProfileViewsTotal / baseDays) * 0.16 +
        (postsPublishedTotal / baseDays) * 0.08 +
        (uniqueImpressionsTotal / baseDays) * 0.004 +
        (impressionsTotal / baseDays) * 0.0015,
      0,
      1.4,
    );

    const publishTarget = Math.max(2, Math.round(baseDays / 10));
    const publishDeficit = clamp(1 - postsPublishedTotal / publishTarget, 0, 1);
    const exposureN = logNorm(impressionsPerDay, 1200);
    const engagementN = logNorm(engagementsPerDay, 45);
    const audienceN = logNorm(audienceTotal, 2000);
    const audienceHeadroom = clamp(0.5 * (1 - engagementN) + 0.5 * (1 - exposureN), 0, 1);

    const potentialPerDay = clamp(
      currentPerDay + 0.08 + 0.18 * publishDeficit + 0.22 * audienceHeadroom + 0.12 * audienceN,
      coldStartBaseline,
      2.2,
    );
    const additionalPerDay = Math.max(0, potentialPerDay - currentPerDay);
    return clamp(additionalPerDay, 0, 2.2);
  }

  const refs =
    cubeKey === "instagram"
      ? { imp: 2500, eng: 120, cta: 6, aud: 3000 }
      : (cubeKey === "tiktok" || cubeKey === "youtube_shorts" || cubeKey === "pinterest")
        ? { imp: 3200, eng: 160, cta: 5, aud: 2500 }
        : { imp: 3000, eng: 90, cta: 5, aud: 5000 };

  const exposureN = logNorm(impressionsPerDay, refs.imp);
  const engagementN = logNorm(engagementsPerDay, refs.eng);
  const intentN = logNorm(ctaClicksPerDay, refs.cta);
  const audienceN = logNorm(audienceTotal, refs.aud);

  const currentPerDay = clamp(0.02 + 0.2 * intentN + 0.12 * engagementN + 0.06 * exposureN + 0.04 * audienceN, 0, 1.6);
  const uplift = clamp(0.35 + 0.35 * (1 - intentN) + 0.2 * (1 - exposureN), 0.35, 0.9);
  const histWeight = clamp(exposureN * 0.7 + intentN * 0.3, 0, 1);
  const base = histWeight * currentPerDay + (1 - histWeight) * coldStartBaseline;
  const potentialPerDay = clamp(base * (1 + uplift), coldStartBaseline, 2.5);
  const additionalPerDay = Math.max(0, potentialPerDay - currentPerDay);
  return clamp(additionalPerDay, 0, 2.5);
}

export function computeOpportunity30(cubeKey: CubeKey, ov: Overview) {
  if (cubeKey === "gmb") {
    const connected = !!ov?.sources?.gmb?.connected;
    if (!connected) return 0;

    const m = ov?.sources?.gmb?.metrics;
    const hasError = !!m?.error;
    const { impressions, websiteClicks, callClicks, directionRequests } = getGmbTotals(m);
    const conversations =
      safeNum(m?.totals?.conversations) ||
      safeNum(m?.totals?.BUSINESS_CONVERSATIONS);

    const intentOpportunity =
      websiteClicks * 0.45 +
      callClicks * 0.70 +
      directionRequests * 0.55 +
      conversations * 0.65;
    const visibilityOpportunity = impressions / 450;
    const baseline = hasError || !m ? 2 : 0;

    return Math.max(0, Math.round(clamp(baseline + intentOpportunity + visibilityOpportunity, 0, 80)));
  }
  if (cubeKey === "mails") {
    const connected = !!ov?.sources?.mails?.connected;
    if (!connected) return 0;
    const m = ov?.sources?.mails?.metrics;
    const base = safeNum(m?.campagnes30) <= 0 ? 8 : 3;
    const contactsPotential = Math.min(28, safeNum(m?.contactsCrm) / 14);
    const activityPotential = Math.min(14, safeNum(m?.campagnes30) * 2 + safeNum(m?.destinataires30) / 45 + safeNum(m?.agendaReminders30) / 20);
    return Math.max(0, Math.round(base + contactsPotential + activityPotential));
  }

  if (cubeKey === "facebook" || cubeKey === "instagram" || cubeKey === "linkedin" || cubeKey === "tiktok" || cubeKey === "youtube_shorts" || cubeKey === "pinterest") {
    const perDay = computeOpportunityPerDaySocial(cubeKey, ov);
    return Math.max(0, Math.round(perDay * 30));
  }
  const perDay = computeOpportunityPerDayWeb(ov);
  return Math.max(0, Math.round(perDay * 30));
}
