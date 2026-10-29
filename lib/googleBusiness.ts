import { listAllGoogleBusinessAccounts, listAllGoogleBusinessLocations } from "@/lib/googleBusinessLocations";
import { getGoogleTokenForAnyGoogle } from "@/lib/googleStats";
import { postGoogleBusinessLocalPost } from "@/lib/googleBusinessPostTransport";

type GMBLocation = { name: string; title?: string; storefrontAddress?: any };

export async function gmbListAccounts(accessToken: string) {
  return listAllGoogleBusinessAccounts(accessToken);
}

function normalizeLocationName(name: string): string {
  // Accept:
  // - "locations/123"
  // - "accounts/AAA/locations/123"
  // - full resource paths
  const m = /\/locations\/(\d+)/.exec(name || "");
  if (m) return `locations/${m[1]}`;
  return name;
}

async function fetchJsonOrThrow(r: Response, label: string) {
  const raw = await r.text().catch(() => "");
  let j: any = {};
  try {
    j = raw ? JSON.parse(raw) : {};
  } catch {
    j = {};
  }
  if (!r.ok) {
    const msg = j?.error?.message || j?.error_description || raw || `${label} error`;
    throw new Error(`${label} (${r.status}): ${msg}`);
  }
  return j;
}

export async function gmbListLocations(accessToken: string, accountName: string) {
  return listAllGoogleBusinessLocations(accessToken, accountName);
}

export const gmbListLocationsWithFallback = gmbListLocations;

/**
 * Returns an access token + the stored integration row for the current user,
 * refreshing the access token if needed.
 */
export async function getGmbToken(ctx?: { supabase?: any; userId?: string }) {
  // Publication routes already resolved the active iNrCy account. Reuse that
  // identity instead of relying on a second cookie-based auth lookup, which
  // is unavailable in long-running/cron-style server actions.
  const tok = await getGoogleTokenForAnyGoogle("gmb", "gmb", ctx);
  if (!tok?.accessToken) return null;
  return tok;
}

/**
 * Best-effort "real connectivity" test: call the accounts endpoint.
 * Returns { connected, accountsCount }.
 */
export async function testGmbConnectivity(accessToken: string) {
  try {
    const accounts = await gmbListAccounts(accessToken);
    return { connected: true, accountsCount: accounts.length };
  } catch {
    return { connected: false, accountsCount: 0 };
  }
}

// --- Performance API (best-effort, depends on the user's enabled API access) ---

type DateObj = { year: number; month: number; day: number };

function toDateObj(d: Date): DateObj {
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * Fetch multi daily metrics time series for a given location resource name:
 * locationName example: "locations/12345678901234567890"
 *
 * Note: This endpoint requires the Business Profile Performance API.
 */
export async function gmbFetchDailyMetrics(accessToken: string, locationName: string, start: Date, end: Date) {
  const endpointUrl = new URL(`https://businessprofileperformance.googleapis.com/v1/${locationName}:fetchMultiDailyMetricsTimeSeries`);
  const dailyMetrics = [
    "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
    "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
    "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
    "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
    "WEBSITE_CLICKS",
    "CALL_CLICKS",
    "BUSINESS_DIRECTION_REQUESTS",
    "BUSINESS_CONVERSATIONS",
  ] as const;
  for (const metric of dailyMetrics) endpointUrl.searchParams.append("dailyMetrics", metric);

  const startDate = toDateObj(start);
  const endDate = toDateObj(end);
  endpointUrl.searchParams.set("dailyRange.start_date.year", String(startDate.year));
  endpointUrl.searchParams.set("dailyRange.start_date.month", String(startDate.month));
  endpointUrl.searchParams.set("dailyRange.start_date.day", String(startDate.day));
  endpointUrl.searchParams.set("dailyRange.end_date.year", String(endDate.year));
  endpointUrl.searchParams.set("dailyRange.end_date.month", String(endDate.month));
  endpointUrl.searchParams.set("dailyRange.end_date.day", String(endDate.day));

  const endpoint = endpointUrl.toString();
  const requestMeta = {
    dailyMetrics: [...dailyMetrics],
    dailyRange: { start_date: startDate, end_date: endDate },
  };

  const r = await fetch(endpoint, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const raw = await r.text().catch(() => "");
  let j: any = {};
  try {
    j = raw ? JSON.parse(raw) : {};
  } catch {
    j = {};
  }

  if (!r.ok) {

    const msg = j?.error?.message || j?.error_description || raw || "Impossible de récupérer les statistiques Google Business pour le moment.";
    throw new Error(`Business Profile Performance API error (${r.status}): ${msg}`);
  }

  return j;
}

// --- Normalization helpers (stable shape for UI/opportunities) ---

export type GmbDailyMetrics = {
  range: { since: string; until: string };
  totals: {
    impressions: number;
    websiteClicks: number;
    callClicks: number;
    directionRequests: number;
    conversations: number;
  };
  daily: Array<{
    date: string; // YYYY-MM-DD
    impressions: number;
    websiteClicks: number;
    callClicks: number;
    directionRequests: number;
    conversations: number;
  }>;
  raw?: any;
};

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

function addTo(
  map: Map<string, { impressions: number; websiteClicks: number; callClicks: number; directionRequests: number; conversations: number }>,
  date: string,
  key: "impressions" | "websiteClicks" | "callClicks" | "directionRequests" | "conversations",
  v: number
) {
  const row = map.get(date) || { impressions: 0, websiteClicks: 0, callClicks: 0, directionRequests: 0, conversations: 0 };
  row[key] = (row[key] || 0) + (Number.isFinite(v) ? v : 0);
  map.set(date, row);
}

/**
 * Performance API -> { totals, daily }
 * The API returns a `multiDailyMetricTimeSeries` array with per-metric dated values.
 */
export function gmbNormalizePerformanceResponse(raw: any, start: Date, end: Date): GmbDailyMetrics {
  const outByDay = new Map<string, { impressions: number; websiteClicks: number; callClicks: number; directionRequests: number; conversations: number }>();

  const seriesGroups = Array.isArray(raw?.multiDailyMetricTimeSeries) ? raw.multiDailyMetricTimeSeries : [];
  for (const group of seriesGroups) {
    const entries = Array.isArray(group?.dailyMetricTimeSeries) ? group.dailyMetricTimeSeries : [];
    for (const s of entries) {
      const metric = String(s?.dailyMetric || "");
      const dated = Array.isArray(s?.timeSeries?.datedValues) ? s.timeSeries.datedValues : [];

      const key:
        | "impressions"
        | "websiteClicks"
        | "callClicks"
        | "directionRequests"
        | "conversations"
        | null =
        metric === "WEBSITE_CLICKS"
          ? "websiteClicks"
          : metric === "CALL_CLICKS"
            ? "callClicks"
            : metric === "BUSINESS_DIRECTION_REQUESTS" || metric === "DIRECTION_REQUESTS"
              ? "directionRequests"
              : metric === "BUSINESS_CONVERSATIONS"
                ? "conversations"
                : metric.startsWith("BUSINESS_IMPRESSIONS_")
                  ? "impressions"
                  : null;
      if (!key) continue;

      for (const dv of dated) {
      const d = dv?.date;
      const dateStr =
        d && typeof d === "object"
          ? `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`
          : "";
      if (!dateStr) continue;

      // value can be { value: "123" } depending on backend
        const vRaw = dv?.value?.value ?? dv?.value ?? 0;
        const v = Number(vRaw);
        addTo(outByDay, dateStr, key, Number.isFinite(v) ? v : 0);
      }
    }
  }

  // Fill missing days so the shape is consistent
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (cur <= endDay) {
    const d = ymd(cur);
    if (!outByDay.has(d)) outByDay.set(d, { impressions: 0, websiteClicks: 0, callClicks: 0, directionRequests: 0, conversations: 0 });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  const daily = Array.from(outByDay.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, v]) => ({ date, ...v }));

  const totals = daily.reduce(
    (acc, d) => {
      acc.impressions += d.impressions;
      acc.websiteClicks += d.websiteClicks;
      acc.callClicks += d.callClicks;
      acc.directionRequests += d.directionRequests;
      acc.conversations += d.conversations;
      return acc;
    },
    { impressions: 0, websiteClicks: 0, callClicks: 0, directionRequests: 0, conversations: 0 }
  );

  return {
    range: { since: start.toISOString(), until: end.toISOString() },
    totals,
    daily,
    raw,
  };
}

export async function gmbFetchDailyMetricsNormalized(accessToken: string, locationName: string, start: Date, end: Date) {
  const raw = await gmbFetchDailyMetrics(accessToken, locationName, start, end);
  return gmbNormalizePerformanceResponse(raw, start, end);
}

function locationIdOf(name: string): string {
  const normalized = normalizeLocationName(String(name || ""));
  return normalized.split("/").pop() || normalized;
}



export type ResolvedGmbLocation = {
  accountName: string;
  locationName: string;
  locationTitle: string | null;
};

async function gmbCanReadPerformanceMetrics(args: {
  accessToken: string;
  locationName: string;
  start: Date;
  end: Date;
}): Promise<boolean> {
  try {
    await gmbFetchDailyMetrics(args.accessToken, args.locationName, args.start, args.end);
    return true;
  } catch {
    return false;
  }
}

export async function gmbResolveWorkingLocation(
  accessToken: string,
  preferredLocationName: string,
  preferredAccountName?: string | null,
  start?: Date,
  end?: Date
): Promise<ResolvedGmbLocation | null> {
  const targetId = locationIdOf(preferredLocationName);
  const accounts = await gmbListAccounts(accessToken);
  if (!accounts.length) return null;

  const orderedAccounts = [...accounts].sort((a, b) => {
    if (a.name === preferredAccountName) return -1;
    if (b.name === preferredAccountName) return 1;
    return 0;
  });

  const exactMatches: ResolvedGmbLocation[] = [];

  for (const account of orderedAccounts) {
    if (!account?.name) continue;
    let locations: GMBLocation[] = [];
    try {
      locations = await gmbListLocationsWithFallback(accessToken, account.name);
    } catch {
      continue;
    }
    for (const loc of locations) {
      const normalizedName = normalizeLocationName(String(loc?.name || ""));
      if (!normalizedName) continue;
      const candidate: ResolvedGmbLocation = {
        accountName: account.name,
        locationName: normalizedName,
        locationTitle: typeof loc?.title === "string" && loc.title.trim() ? loc.title.trim() : null,
      };
      if (locationIdOf(normalizedName) === targetId || normalizedName === normalizeLocationName(preferredLocationName)) {
        exactMatches.push(candidate);
      }
    }
  }

  const candidates = exactMatches;
  if (!candidates.length) return null;

  if (!start || !end) {
    if (exactMatches.length > 0) return exactMatches[0];
    return null;
  }

  for (const candidate of candidates) {
    const ok = await gmbCanReadPerformanceMetrics({
      accessToken,
      locationName: candidate.locationName,
      start,
      end,
    });
    if (ok) return candidate;
  }

  return null;
}


export async function gmbCreateLocalPost(args: {
  accessToken: string;
  accountName: string; // "accounts/123"
  locationName: string; // "locations/456"
  summary: string;
  imageUrls?: string[];
  videoUrls?: string[];
  languageCode?: string; // default fr-FR
  callToAction?:
    | { actionType: "LEARN_MORE"; url: string }
    | { actionType: "CALL" }
    | null;
}) {
  const { accessToken, accountName, locationName } = args;

  const accountId = accountName.split("/").pop();
  const locationId = locationName.split("/").pop();
  if (!accountId || !locationId) throw new Error("Établissement Google Business invalide.");

  const endpoint = `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/localPosts`;

  const payload: any = {
    languageCode: args.languageCode || "fr-FR",
    summary: args.summary,
    topicType: "STANDARD",
  };

  const imageUrls = (args.imageUrls || []).filter(Boolean).slice(0, 10);
  const videoUrls = (args.videoUrls || []).filter(Boolean).slice(0, 1);
  const media = [
    ...imageUrls.map((sourceUrl) => ({ mediaFormat: "PHOTO", sourceUrl })),
    ...videoUrls.map((sourceUrl) => ({ mediaFormat: "VIDEO", sourceUrl })),
  ];
  if (media.length) {
    payload.media = media;
  }

  if (args.callToAction?.actionType === "CALL") {
    payload.callToAction = { actionType: "CALL" };
  } else if (args.callToAction?.actionType === "LEARN_MORE" && args.callToAction.url) {
    payload.callToAction = args.callToAction;
  }

  return await postGoogleBusinessLocalPost({
    endpoint,
    accessToken,
    payload,
  });
}

function normalizeGoogleBusinessLocalPostName(value: string) {
  const raw = String(value || "").trim();
  let candidate = raw.replace(/^\/+/, "");
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.hostname !== "mybusiness.googleapis.com") {
      throw new Error("Publication Google Business invalide.");
    }
    candidate = url.pathname.replace(/^\/v4\//, "").replace(/^\/+/, "");
  } catch (error) {
    if (/^https?:\/\//i.test(raw)) throw error;
  }

  if (!/^accounts\/[^/]+\/locations\/[^/]+\/localPosts\/[^/]+$/.test(candidate)) {
    throw new Error("Publication Google Business invalide.");
  }
  return candidate;
}

async function readGoogleBusinessMutationResponse(response: Response, label: string) {
  const raw = await response.text().catch(() => "");
  let payload: any = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const message =
      payload?.error?.message ||
      payload?.error_description ||
      raw ||
      `${label} (${response.status})`;
    const error = new Error(`${label} (${response.status}) : ${message}`);
    Object.assign(error, {
      code: "gmb_local_post_http_error",
      status: response.status,
      retryable: response.status === 429 || response.status >= 500,
      outcomeUnknown: false,
    });
    throw error;
  }
  return payload;
}

/** Updates text and CTA in place. Media changes are handled by safe replacement. */
export async function gmbPatchLocalPost(args: {
  accessToken: string;
  localPostName: string;
  summary: string;
  languageCode?: string;
  callToAction?:
    | { actionType: "LEARN_MORE"; url: string }
    | { actionType: "CALL" }
    | null;
}) {
  const localPostName = normalizeGoogleBusinessLocalPostName(args.localPostName);
  const endpoint = new URL(
    `https://mybusiness.googleapis.com/v4/${localPostName}`,
  );
  endpoint.searchParams.set("updateMask", "summary,callToAction");
  const payload: any = {
    name: localPostName,
    languageCode: args.languageCode || "fr-FR",
    summary: args.summary,
    topicType: "STANDARD",
  };
  if (args.callToAction?.actionType === "CALL") {
    payload.callToAction = { actionType: "CALL" };
  } else if (args.callToAction?.actionType === "LEARN_MORE" && args.callToAction.url) {
    payload.callToAction = args.callToAction;
  }

  let response: Response;
  try {
    response = await fetch(endpoint.toString(), {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${String(args.accessToken || "").trim()}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      redirect: "error",
    });
  } catch (cause) {
    const error = new Error(
      "La réponse Google Business a été interrompue pendant la modification. Vérifiez la publication avant de relancer.",
      { cause },
    );
    Object.assign(error, {
      code: "gmb_local_post_patch_network_error",
      retryable: false,
      outcomeUnknown: true,
    });
    throw error;
  }
  return readGoogleBusinessMutationResponse(
    response,
    "Modification Google Business impossible",
  );
}

export async function gmbDeleteLocalPost(args: {
  accessToken: string;
  localPostName: string;
}) {
  const localPostName = normalizeGoogleBusinessLocalPostName(args.localPostName);
  const response = await fetch(
    `https://mybusiness.googleapis.com/v4/${localPostName}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${String(args.accessToken || "").trim()}` },
      cache: "no-store",
      redirect: "error",
    },
  );
  if (response.status === 404) return;
  await readGoogleBusinessMutationResponse(
    response,
    "Suppression Google Business impossible",
  );
}

export async function gmbFetchDailyMetricsNormalizedWithRecovery(args: {
  accessToken: string;
  locationName: string;
  start: Date;
  end: Date;
  preferredAccountName?: string | null;
}) {
  // Reading statistics must never select a different establishment.
  const locationName = normalizeLocationName(args.locationName);
  const metrics = await gmbFetchDailyMetricsNormalized(args.accessToken, locationName, args.start, args.end);
  return { metrics, locationName, locationTitle: null, accountName: args.preferredAccountName ?? null, recovered: false };
}
