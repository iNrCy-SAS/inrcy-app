const LI_API = "https://api.linkedin.com/rest";
const LI_VERSION = process.env.LINKEDIN_API_VERSION || "202604";

type Dict = Record<string, unknown>;

function asRecord(value: unknown): Dict {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Dict)
    : {};
}

type LinkedInFetchOptions = {
  extraHeaders?: Record<string, string>;
  useRestHeaders?: boolean;
};

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

export function getLinkedInNextUtcResetIso(now = new Date()): string {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      15,
      0,
      0,
    ),
  ).toISOString();
}

async function fetchLinkedInJson(
  url: string,
  accessToken: string,
  options?: LinkedInFetchOptions,
) {
  const useRestHeaders = options?.useRestHeaders ?? url.includes("/rest/");
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(useRestHeaders
        ? {
            "X-Restli-Protocol-Version": "2.0.0",
            "Linkedin-Version": LI_VERSION,
          }
        : {}),
      "Content-Type": "application/json",
      ...(options?.extraHeaders || {}),
    },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      data?.message ||
        data?.error_description ||
        data?.error ||
        `HTTP ${res.status}`,
    ) as Error & { status?: number; details?: unknown };
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

async function fetchFirstOk(
  urls: string[],
  accessToken: string,
  options?: LinkedInFetchOptions,
) {
  const errors: string[] = [];
  for (const url of urls) {
    try {
      return await fetchLinkedInJson(url, accessToken, options);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(errors[0] || "LinkedIn API error");
}

export type LinkedInMetrics = {
  range: { since: string; until: string };
  totals: Record<string, number>;
  raw?: unknown;
};

function toMs(d: Date): number {
  return d.getTime();
}

function safeNum(v: unknown): number {
  const n =
    typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : 0;
}

function toNumberRecord(value: unknown): Record<string, number> {
  const rec = value && typeof value === "object" ? (value as Dict) : {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(rec)) out[key] = safeNum(raw);
  return out;
}

function toDateRangeParam(start: Date, end: Date): string {
  // Rest.li 2.0 requires its record delimiters to remain literal in the URL.
  // Encoding the whole record produces HTTP 400 "Invalid query parameters".
  // These fields are numeric date components, so no user text needs escaping.
  return `(start:(year:${start.getUTCFullYear()},month:${start.getUTCMonth() + 1},day:${start.getUTCDate()}),end:(year:${end.getUTCFullYear()},month:${end.getUTCMonth() + 1},day:${end.getUTCDate()}))`;
}

function toRestTimeParams(start: Date, end: Date) {
  return {
    "timeIntervals.timeGranularityType": "DAY",
    "timeIntervals.timeRange.start": String(toMs(start)),
    "timeIntervals.timeRange.end": String(toMs(end)),
  };
}

function toRestTimeIntervalValue(start: Date, end: Date): string {
  return `(timeRange:(start:${toMs(start)},end:${toMs(end)}),timeGranularityType:DAY)`;
}

function buildLinkedInTimeBoundUrls(baseUrl: string, start: Date, end: Date) {
  // LinkedIn est strict sur les paramètres Rest.li et certaines versions REST/v2
  // n'acceptent pas exactement la même écriture. On tente plusieurs formes,
  // puis le caller peut ajouter un fallback sans borne de temps si besoin.
  const sep = baseUrl.includes("?") ? "&" : "?";
  const interval = toRestTimeIntervalValue(start, end);
  const intervalAlt = `(timeGranularityType:DAY,timeRange:(start:${toMs(start)},end:${toMs(end)}))`;
  const restli2 = `${baseUrl}${sep}timeIntervals=${encodeURIComponent(interval)}`;
  const restli2Alt = `${baseUrl}${sep}timeIntervals=${encodeURIComponent(intervalAlt)}`;
  const restli2Raw = `${baseUrl}${sep}timeIntervals=${interval}`;
  const dotted = `${baseUrl}${sep}${new URLSearchParams(toRestTimeParams(start, end)).toString()}`;
  return [restli2, restli2Alt, restli2Raw, dotted];
}

function sumFollowerFacetRows(rows: unknown, key: string): number {
  if (!Array.isArray(rows)) return 0;
  return rows.reduce((acc: number, row: unknown) => {
    const counts =
      (row && typeof row === "object" ? (row as Dict)[key] : null) || {};
    const rec = counts && typeof counts === "object" ? (counts as Dict) : {};
    return (
      acc + safeNum(rec.organicFollowerCount) + safeNum(rec.paidFollowerCount)
    );
  }, 0);
}

function pickPageStatistics(el: Dict): Dict {
  const direct =
    el.totalPageStatistics && typeof el.totalPageStatistics === "object"
      ? (el.totalPageStatistics as Dict)
      : null;
  if (direct) return direct;
  return el.pageStatistics && typeof el.pageStatistics === "object"
    ? (el.pageStatistics as Dict)
    : {};
}

function extractOrgPageViewCount(el: Dict): number {
  const pageStatistics = pickPageStatistics(el);
  const views =
    pageStatistics.views && typeof pageStatistics.views === "object"
      ? (pageStatistics.views as Dict)
      : {};
  const allPageViews = safeNum(
    ((views.allPageViews as Dict | undefined) || {}).pageViews,
  );
  if (allPageViews > 0) return allPageViews;

  const overviewPageViews = safeNum(
    ((views.overviewPageViews as Dict | undefined) || {}).pageViews,
  );
  if (overviewPageViews > 0) return overviewPageViews;

  const allDesktop = safeNum(
    ((views.allDesktopPageViews as Dict | undefined) || {}).pageViews,
  );
  const allMobile = safeNum(
    ((views.allMobilePageViews as Dict | undefined) || {}).pageViews,
  );
  if (allDesktop + allMobile > 0) return allDesktop + allMobile;

  return (
    safeNum(
      ((views.desktopOverviewPageViews as Dict | undefined) || {}).pageViews,
    ) +
    safeNum(
      ((views.mobileOverviewPageViews as Dict | undefined) || {}).pageViews,
    )
  );
}

function sumCustomButtonClicks(items: unknown): number {
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, item) => {
    const rec = item && typeof item === "object" ? (item as Dict) : {};
    return (
      sum +
      safeNum(rec.clicks) +
      safeNum(rec.clickCount) +
      safeNum(rec.pageClicks)
    );
  }, 0);
}

function extractOrgPageClickCount(el: Dict): number {
  const pageStatistics = pickPageStatistics(el);
  const clicks =
    pageStatistics.clicks && typeof pageStatistics.clicks === "object"
      ? (pageStatistics.clicks as Dict)
      : {};
  return (
    safeNum(((clicks.careersPageClicks as Dict | undefined) || {}).pageClicks) +
    safeNum(
      ((clicks.overviewPageClicks as Dict | undefined) || {}).pageClicks,
    ) +
    safeNum(
      ((clicks.customButtonClicks as Dict | undefined) || {}).pageClicks,
    ) +
    sumCustomButtonClicks(clicks.desktopCustomButtonClickCounts) +
    sumCustomButtonClicks(clicks.mobileCustomButtonClickCounts)
  );
}

function parseMetricType(metricType: unknown): string {
  if (typeof metricType === "string") return metricType;
  if (metricType && typeof metricType === "object") {
    const values = Object.values(metricType as Dict);
    for (const value of values) {
      if (typeof value === "string") return value;
    }
  }
  return "";
}

function aggregatePostAnalyticsElements(
  elements: unknown,
): Record<string, number> {
  const totals: Record<string, number> = {
    impressionCount: 0,
    uniqueImpressionsCount: 0,
    likeCount: 0,
    likes: 0,
    commentCount: 0,
    comments: 0,
    shareCount: 0,
    shares: 0,
    postSendCount: 0,
    postSaveCount: 0,
    linkClickCount: 0,
    premiumCtaClickCount: 0,
    followerGainedFromContentCount: 0,
    profileViewFromContentCount: 0,
  };
  if (!Array.isArray(elements)) return totals;

  for (const raw of elements) {
    const row = raw && typeof raw === "object" ? (raw as Dict) : {};
    const metric = parseMetricType(row.metricType).toUpperCase();
    const count = safeNum(row.count);
    switch (metric) {
      case "IMPRESSION":
        totals.impressionCount += count;
        break;
      case "MEMBERS_REACHED":
        totals.uniqueImpressionsCount += count;
        break;
      case "REACTION":
        totals.likeCount += count;
        totals.likes += count;
        break;
      case "COMMENT":
        totals.commentCount += count;
        totals.comments += count;
        break;
      case "RESHARE":
        totals.shareCount += count;
        totals.shares += count;
        break;
      case "POST_SEND":
        totals.postSendCount += count;
        break;
      case "POST_SAVE":
        totals.postSaveCount += count;
        break;
      case "LINK_CLICKS":
        totals.linkClickCount += count;
        break;
      case "PREMIUM_CTA_CLICKS":
        totals.premiumCtaClickCount += count;
        break;
      case "FOLLOWER_GAINED_FROM_CONTENT":
        totals.followerGainedFromContentCount += count;
        totals.newFollowers = (totals.newFollowers || 0) + count;
        break;
      case "PROFILE_VIEW_FROM_CONTENT":
        totals.profileViewFromContentCount += count;
        totals.profileViews = (totals.profileViews || 0) + count;
        break;
      default:
        break;
    }
  }
  return totals;
}

function normalizeTotals(
  input: Record<string, number>,
): Record<string, number> {
  const out = { ...input };
  const impressionCount =
    safeNum(out.impressionCount) || safeNum(out.impressions);
  const uniqueImpressionsCount =
    safeNum(out.uniqueImpressionsCount) || safeNum(out.uniqueImpressions);
  const clickCount =
    safeNum(out.clickCount) +
    safeNum(out.linkClickCount) +
    safeNum(out.premiumCtaClickCount) +
    safeNum(out.pageClicks);
  const likeCount = safeNum(out.likeCount) || safeNum(out.likes);
  const commentCount = safeNum(out.commentCount) || safeNum(out.comments);
  const shareCount = safeNum(out.shareCount) || safeNum(out.shares);
  const followerCount =
    safeNum(out.followerCount) || safeNum(out.memberFollowersCount);
  const newFollowers =
    safeNum(out.newFollowers) +
    safeNum(out.followerGainedFromContentCount) +
    safeNum(out.organicFollowerCount) +
    safeNum(out.paidFollowerCount);
  const profileViews =
    safeNum(out.profileViews) + safeNum(out.profileViewFromContentCount);
  const pageViews = safeNum(out.pageViews);

  out.impressions = impressionCount;
  out.impressionCount = impressionCount;
  out.uniqueImpressionsCount = uniqueImpressionsCount;
  out.clicks = clickCount;
  out.clickCount = clickCount;
  out.likes = likeCount;
  out.likeCount = likeCount;
  out.comments = commentCount;
  out.commentCount = commentCount;
  out.shares = shareCount;
  out.shareCount = shareCount;
  out.followers = followerCount;
  out.followerCount = followerCount;
  out.newFollowers = newFollowers;
  out.profileViews = profileViews;
  out.pageViews = pageViews;
  out.engagements =
    safeNum(out.engagements) +
    likeCount +
    commentCount +
    shareCount +
    safeNum(out.postSaveCount) +
    safeNum(out.postSendCount);
  return out;
}

function mergeTotals(
  target: Record<string, number>,
  source: Record<string, number>,
) {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] || 0) + safeNum(value);
  }
}

function hasLinkedInSignal(totals: Record<string, number>): boolean {
  return [
    "impressions",
    "impressionCount",
    "uniqueImpressionsCount",
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
    "followers",
    "followerCount",
    "memberFollowersCount",
    "newFollowers",
    "followerGainedFromContentCount",
    "organicFollowerCount",
    "paidFollowerCount",
    "postsPublished",
    "postSaveCount",
    "postSendCount",
  ].some((key) => safeNum(totals[key]) > 0);
}

async function liFetchMemberFollowers(
  accessToken: string,
  start: Date,
  end: Date,
): Promise<Record<string, number>> {
  const life = await fetchFirstOk(
    [
      `${LI_API}/memberFollowersCount?q=me`,
      `https://api.linkedin.com/v2/memberFollowersCount?q=me`,
    ],
    accessToken,
    { extraHeaders: { "X-RestLi-Method": "FINDER" } },
  );
  const lifetimeFollowers = safeNum(life?.elements?.[0]?.memberFollowersCount);

  let followerGain = 0;
  try {
    const daily = await fetchFirstOk(
      [
        `${LI_API}/memberFollowersCount?q=dateRange&dateRange=${toDateRangeParam(start, end)}`,
        `https://api.linkedin.com/v2/memberFollowersCount?q=dateRange&dateRange=${toDateRangeParam(start, end)}`,
      ],
      accessToken,
      { extraHeaders: { "X-RestLi-Method": "FINDER" } },
    );
    followerGain = Array.isArray(daily?.elements)
      ? daily.elements.reduce(
          (sum: number, row: Dict) => sum + safeNum(row.memberFollowersCount),
          0,
        )
      : 0;
  } catch {}

  return normalizeTotals({
    followerCount: lifetimeFollowers,
    memberFollowersCount: lifetimeFollowers,
    newFollowers: followerGain,
  });
}

async function liFetchMemberPostAnalytics(
  accessToken: string,
  start: Date,
  end: Date,
): Promise<Record<string, number>> {
  // Quota protection: LinkedIn compte chaque queryType comme un appel.
  // On garde les signaux business essentiels et on évite les métriques de confort
  // qui faisaient exploser les quotas journaliers de l'application.
  const queryTypes = [
    "IMPRESSION",
    "REACTION",
    "COMMENT",
    "RESHARE",
    "LINK_CLICKS",
    "PROFILE_VIEW_FROM_CONTENT",
  ];
  const settled = await Promise.allSettled(
    queryTypes.map((queryType) =>
      fetchFirstOk(
        [
          `${LI_API}/memberCreatorPostAnalytics?q=me&queryType=${encodeURIComponent(queryType)}&aggregation=TOTAL&dateRange=${toDateRangeParam(start, end)}`,
          `https://api.linkedin.com/v2/memberCreatorPostAnalytics?q=me&queryType=${encodeURIComponent(queryType)}&aggregation=TOTAL&dateRange=${toDateRangeParam(start, end)}`,
        ],
        accessToken,
        { extraHeaders: { "X-RestLi-Method": "FINDER" } },
      ),
    ),
  );

  const errors: string[] = [];
  let fulfilled = 0;
  const totals = settled.reduce<Record<string, number>>((acc, result) => {
    if (result.status !== "fulfilled") {
      errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
      return acc;
    }
    fulfilled += 1;
    mergeTotals(acc, aggregatePostAnalyticsElements(result.value?.elements));
    return acc;
  }, {});

  if (fulfilled === 0) {
    throw new Error(errors[0] || "Aucune statistique de publication LinkedIn exploitable.");
  }

  return normalizeTotals(totals);
}

export async function liResolveFirstAdminOrgUrn(
  accessToken: string,
): Promise<string> {
  const params = new URLSearchParams({
    q: "roleAssignee",
    role: "ADMINISTRATOR",
    state: "APPROVED",
    count: "10",
    start: "0",
  }).toString();

  const resp = await fetchFirstOk(
    [
      `${LI_API}/organizationAcls?${params}`,
      `https://api.linkedin.com/v2/organizationAcls?${params}`,
    ],
    accessToken,
    { extraHeaders: { "X-RestLi-Method": "FINDER" } },
  );
  const els = Array.isArray(resp?.elements) ? resp.elements : [];
  for (const el of els) {
    const row = el && typeof el === "object" ? (el as Dict) : {};
    const urn = String(row.organization || row.organizationalTarget || "");
    if (urn.startsWith("urn:li:organization:")) return urn;
  }
  return "";
}

async function liFetchOrgShareStats(
  accessToken: string,
  orgUrn: string,
  start: Date,
  end: Date,
): Promise<Record<string, number>> {
  const baseParams = new URLSearchParams({
    q: "organizationalEntity",
    organizationalEntity: orgUrn,
  }).toString();
  const restBase = `${LI_API}/organizationalEntityShareStatistics?${baseParams}`;
  const v2Base = `https://api.linkedin.com/v2/organizationalEntityShareStatistics?${baseParams}`;

  const resp = await fetchFirstOk(
    [
      ...buildLinkedInTimeBoundUrls(restBase, start, end),
      ...buildLinkedInTimeBoundUrls(v2Base, start, end),
      // Fallback sécurité : certaines apps LinkedIn refusent la fenêtre de temps
      // sur cet endpoint selon les permissions/version. Mieux vaut un total global
      // qu'une erreur qui retombe visuellement à zéro.
      restBase,
      v2Base,
    ],
    accessToken,
    { extraHeaders: { "X-RestLi-Method": "FINDER" } },
  );
  const elements = Array.isArray(resp?.elements) ? resp.elements : [];

  const totals: Record<string, number> = {};
  for (const el of elements) {
    const row = el && typeof el === "object" ? (el as Dict) : {};
    const stats = (
      row.totalShareStatistics && typeof row.totalShareStatistics === "object"
        ? row.totalShareStatistics
        : row.shareStatistics && typeof row.shareStatistics === "object"
          ? row.shareStatistics
          : row.statistics && typeof row.statistics === "object"
            ? row.statistics
            : {}
    ) as Dict;
    for (const key of [
      "impressionCount",
      "uniqueImpressionsCount",
      "clickCount",
      "likeCount",
      "commentCount",
      "shareCount",
      "engagement",
    ]) {
      totals[key] = (totals[key] || 0) + safeNum(stats[key]);
    }
  }

  return normalizeTotals(totals);
}

async function liFetchOrgPageStats(
  accessToken: string,
  orgUrn: string,
  start: Date,
  end: Date,
): Promise<Record<string, number>> {
  const baseParams = new URLSearchParams({
    q: "organization",
    organization: orgUrn,
  }).toString();
  const restBase = `${LI_API}/organizationPageStatistics?${baseParams}`;
  const v2Base = `https://api.linkedin.com/v2/organizationPageStatistics?${baseParams}`;

  const resp = await fetchFirstOk(
    [
      ...buildLinkedInTimeBoundUrls(restBase, start, end),
      ...buildLinkedInTimeBoundUrls(v2Base, start, end),
    ],
    accessToken,
    { extraHeaders: { "X-RestLi-Method": "FINDER" } },
  );
  const elements = Array.isArray(resp?.elements) ? resp.elements : [];

  let pageViews = 0;
  let pageClicks = 0;
  for (const raw of elements) {
    const el = raw && typeof raw === "object" ? (raw as Dict) : {};
    pageViews += extractOrgPageViewCount(el);
    pageClicks += extractOrgPageClickCount(el);
  }

  return normalizeTotals({ pageViews, pageClicks, clickCount: pageClicks });
}

async function liFetchOrgFollowerStats(
  accessToken: string,
  orgUrn: string,
  start: Date,
  end: Date,
): Promise<Record<string, number>> {
  const baseParams = new URLSearchParams({
    q: "organizationalEntity",
    organizationalEntity: orgUrn,
  }).toString();
  const restBase = `${LI_API}/organizationalEntityFollowerStatistics?${baseParams}`;
  const v2Base = `https://api.linkedin.com/v2/organizationalEntityFollowerStatistics?${baseParams}`;

  const resp = await fetchFirstOk(
    [
      ...buildLinkedInTimeBoundUrls(restBase, start, end),
      ...buildLinkedInTimeBoundUrls(v2Base, start, end),
    ],
    accessToken,
    { extraHeaders: { "X-RestLi-Method": "FINDER" } },
  );
  const elements = Array.isArray(resp?.elements) ? resp.elements : [];

  let organicFollowers = 0;
  let paidFollowers = 0;
  for (const raw of elements) {
    const el = raw && typeof raw === "object" ? (raw as Dict) : {};
    const followerGains =
      el.followerGains && typeof el.followerGains === "object"
        ? (el.followerGains as Dict)
        : {};
    const gainOrganic = safeNum(followerGains.organicFollowerGain);
    const gainPaid = safeNum(followerGains.paidFollowerGain);
    if (gainOrganic || gainPaid) {
      organicFollowers += gainOrganic;
      paidFollowers += gainPaid;
      continue;
    }

    const followerCounts =
      el.followerCounts && typeof el.followerCounts === "object"
        ? (el.followerCounts as Dict)
        : {};
    const directOrganic = safeNum(followerCounts.organicFollowerCount);
    const directPaid = safeNum(followerCounts.paidFollowerCount);
    if (directOrganic || directPaid) {
      organicFollowers += directOrganic;
      paidFollowers += directPaid;
    } else {
      organicFollowers += sumFollowerFacetRows(
        el.followerCountsByGeoCountry,
        "followerCounts",
      );
    }
  }

  return normalizeTotals({
    organicFollowerCount: organicFollowers,
    paidFollowerCount: paidFollowers,
    followerCount: organicFollowers + paidFollowers,
    newFollowers: organicFollowers + paidFollowers,
  });
}

export async function liFetchOrgAnalytics(
  accessToken: string,
  orgUrn: string,
  start: Date,
  end: Date,
): Promise<LinkedInMetrics> {
  if (!orgUrn)
    throw new Error("Le compte LinkedIn n’est pas correctement configuré.");

  const settled = await Promise.allSettled([
    liFetchOrgShareStats(accessToken, orgUrn, start, end),
    liFetchOrgPageStats(accessToken, orgUrn, start, end),
    liFetchOrgFollowerStats(accessToken, orgUrn, start, end),
  ]);

  const totals: Record<string, number> = {};
  const raw: Record<string, unknown> = {
    posts: { skipped: "quota_protection" },
  };
  const errors: string[] = [];
  const labels = ["shareStats", "pageStats", "followerStats"];

  settled.forEach((result, idx) => {
    const label = labels[idx];
    if (result.status === "fulfilled") {
      mergeTotals(totals, result.value);
      raw[label] = result.value;
    } else {
      raw[label] = {
        error:
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
      };
      errors.push(
        `${label}:${raw[label] && typeof raw[label] === "object" ? (raw[label] as { error?: string }).error || "error" : "error"}`,
      );
    }
  });

  const normalizedTotals = normalizeTotals(totals);
  if (!hasLinkedInSignal(normalizedTotals)) {
    throw new Error(errors[0] || "Aucune métrique LinkedIn exploitable.");
  }

  return {
    range: { since: start.toISOString(), until: end.toISOString() },
    totals: normalizedTotals,
    raw: { ...raw, errors },
  };
}

export async function liFetchMemberAnalytics(
  accessToken: string,
  authorUrn: string,
  start: Date,
  end: Date,
): Promise<LinkedInMetrics> {
  const settled = await Promise.allSettled([
    liFetchMemberFollowers(accessToken, start, end),
    liFetchMemberPostAnalytics(accessToken, start, end),
  ]);

  const totals: Record<string, number> = {};
  const raw: Record<string, unknown> = {
    memberPosts: { skipped: "quota_protection" },
  };
  const errors: string[] = [];
  const labels = ["memberFollowers", "memberPostAnalytics"];

  settled.forEach((result, idx) => {
    const label = labels[idx];
    if (result.status === "fulfilled") {
      mergeTotals(totals, result.value);
      raw[label] = result.value;
    } else {
      raw[label] = {
        error:
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
      };
      errors.push(
        `${label}:${raw[label] && typeof raw[label] === "object" ? (raw[label] as { error?: string }).error || "error" : "error"}`,
      );
    }
  });

  const normalizedTotals = normalizeTotals(totals);
  if (!hasLinkedInSignal(normalizedTotals)) {
    throw new Error(
      errors[0] || "Aucune métrique LinkedIn membre exploitable.",
    );
  }

  return {
    range: { since: start.toISOString(), until: end.toISOString() },
    totals: normalizedTotals,
    raw: { ...raw, errors },
  };
}

export function liAggregateAnalytics(
  parts: Array<{
    label: "member" | "organization" | string;
    metrics?: unknown | null;
    error?: string | null;
    mode?: string | null;
  }>,
  start: Date,
  end: Date,
): LinkedInMetrics {
  const totals: Record<string, number> = {};
  const raw: Record<string, unknown> = {};
  const errors: string[] = [];
  const activeLabels: string[] = [];
  const cacheModes: Record<string, string> = {};

  for (const part of parts) {
    const label = String(part.label || `source_${activeLabels.length}`);
    if (part.metrics) {
      const metricsRec = part.metrics && typeof part.metrics === "object"
        ? (part.metrics as Dict)
        : {};
      const totalsRec = asRecord(metricsRec.totals);
      mergeTotals(
        totals,
        Object.keys(totalsRec).length ? toNumberRecord(totalsRec) : toNumberRecord(metricsRec),
      );
      raw[label] = metricsRec.raw || metricsRec;
      activeLabels.push(label);
      if (part.mode) cacheModes[label] = part.mode;
      continue;
    }

    if (part.error) {
      const message = String(part.error);
      raw[label] = { error: message };
      errors.push(`${label}:${message}`);
    }
  }

  const normalizedTotals = normalizeTotals(totals);
  if (!hasLinkedInSignal(normalizedTotals)) {
    throw new Error(errors[0] || "Aucune métrique LinkedIn exploitable.");
  }

  return {
    range: { since: start.toISOString(), until: end.toISOString() },
    totals: normalizedTotals,
    raw: {
      ...raw,
      errors,
      mode: activeLabels.includes("organization") && activeLabels.includes("member")
        ? "member_plus_organization"
        : activeLabels[0] || "unknown",
      sources: activeLabels,
      cacheModes,
    },
  };
}

export async function liFetchCombinedAnalytics(
  accessToken: string,
  authorUrn: string | null | undefined,
  orgUrn: string | null | undefined,
  start: Date,
  end: Date,
): Promise<LinkedInMetrics> {
  const tasks: Array<{
    label: "member" | "organization";
    run: () => Promise<LinkedInMetrics>;
  }> = [];

  if (typeof authorUrn === "string" && authorUrn.startsWith("urn:li:person:")) {
    tasks.push({
      label: "member",
      run: () => liFetchMemberAnalytics(accessToken, authorUrn, start, end),
    });
  }

  if (typeof orgUrn === "string" && orgUrn.startsWith("urn:li:organization:")) {
    tasks.push({
      label: "organization",
      run: () => liFetchOrgAnalytics(accessToken, orgUrn, start, end),
    });
  }

  if (!tasks.length)
    throw new Error("Le compte LinkedIn n’est pas correctement configuré.");

  const settled = await Promise.allSettled(tasks.map((task) => task.run()));
  return liAggregateAnalytics(
    settled.map((result, idx) => {
      const label = tasks[idx]?.label || `source_${idx}`;
      if (result.status === "fulfilled") return { label, metrics: result.value, mode: "live" };
      return {
        label,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      };
    }),
    start,
    end,
  );
}
