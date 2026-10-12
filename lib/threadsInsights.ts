import { buildThreadsGraphUrl } from "@/lib/threadsGraphApi";

// Meta's official sample and collection distinguish daily account views,
// account total_value/link_total_values, and lifetime post insights:
// https://github.com/fbsamples/threads_api/blob/main/src/index.js
// https://github.com/fbsamples/threads_api/blob/main/postman/threads-api.postman_collection.json
export const THREADS_ACCOUNT_METRICS = ["views", "likes", "replies", "reposts", "quotes", "clicks", "followers_count"] as const;
export const THREADS_MEDIA_METRICS = ["views", "likes", "replies", "reposts", "quotes", "shares"] as const;
type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord => value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
const numeric = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

async function fetchThreadsJson(path: string, accessToken: string, params: Record<string, string>) {
  const response = await fetch(`${buildThreadsGraphUrl(path)}?${new URLSearchParams(params)}`, {
    cache: "no-store", headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) throw new Error(String(payload?.error?.message || `Threads HTTP ${response.status}`));
  return record(payload);
}

/** Missing metrics stay missing; an empty/error response is never a zero. */
export function normalizeThreadsInsights(rows: unknown, start: Date, end: Date, scope: "account" | "media" = "account") {
  const totals: Record<string, number> = {};
  const audience: Record<string, number> = {};
  const byDay = new Map<string, Record<string, number>>();
  const available = new Set<string>();
  for (const item of Array.isArray(rows) ? rows : []) {
    const row = record(item);
    const name = String(row.name || "");
    if (!(scope === "account" ? THREADS_ACCOUNT_METRICS : THREADS_MEDIA_METRICS).includes(name as never)) continue;
    let total: number | null = numeric(record(row.total_value).value);
    if (name === "clicks" && Array.isArray(row.link_total_values)) {
      const values = row.link_total_values.map((value) => numeric(record(value).value)).filter((value): value is number => value !== null);
      if (values.length || row.link_total_values.length === 0) total = values.reduce((sum, value) => sum + value, 0);
    }
    for (const rawValue of Array.isArray(row.values) ? row.values : []) {
      const valueRow = record(rawValue);
      const value = numeric(valueRow.value);
      if (value === null) continue;
      if (scope === "account" && name === "views") {
        // Meta dates each bucket at its end. Filter by bucket overlap rather
        // than inventing a daily bucket for total_value metrics.
        const endTime = Date.parse(String(valueRow.end_time || ""));
        if (!Number.isFinite(endTime) || endTime <= start.getTime() || endTime > end.getTime()) continue;
        const date = new Date(endTime - 1).toISOString().slice(0, 10);
        const day = byDay.get(date) || {};
        day[name] = (day[name] || 0) + value;
        byDay.set(date, day);
      }
      total = (total ?? 0) + value;
    }
    if (total === null) continue;
    available.add(name);
    if (name === "followers_count") audience[name] = total;
    else totals[name] = total;
  }
  return {
    totals, audience,
    daily: Array.from(byDay, ([date, values]) => ({ date, values })).sort((a, b) => a.date.localeCompare(b.date)),
    availableMetrics: Array.from(available),
  };
}

export async function fetchThreadsAccountInsights(accessToken: string, userId: string, start: Date, end: Date) {
  const collected: unknown[] = [];
  const unavailableMetrics: string[] = [];
  const metricErrors: Record<string, string> = {};
  const params = { since: String(Math.floor(start.getTime() / 1000)), until: String(Math.floor(end.getTime() / 1000)) };
  // Independent calls preserve supported metrics when one permission or
  // account-specific metric is unavailable. No lifetime fallback for a range.
  await Promise.all(THREADS_ACCOUNT_METRICS.map(async (metric) => {
    try {
      const payload = await fetchThreadsJson(`${encodeURIComponent(userId)}/threads_insights`, accessToken, { ...params, metric });
      const rows = Array.isArray(payload.data) ? payload.data : [];
      if (!rows.some((row) => record(row).name === metric)) {
        unavailableMetrics.push(metric);
        metricErrors[metric] = "Métrique non disponible pour ce compte ou cette période.";
      } else collected.push(...rows);
    } catch (error) {
      unavailableMetrics.push(metric);
      metricErrors[metric] = error instanceof Error ? error.message : "Statistique Threads indisponible.";
    }
  }));
  const normalized = normalizeThreadsInsights(collected, start, end);
  const interactions = ["likes", "replies", "reposts", "quotes"].filter((key) => normalized.totals[key] !== undefined);
  if (interactions.length) normalized.totals.total_interactions = interactions.reduce((sum, key) => sum + normalized.totals[key], 0);
  return {
    ...normalized,
    range: { since: start.toISOString(), until: end.toISOString() },
    ...(normalized.availableMetrics.length ? {} : { error: "Les statistiques Threads ne sont pas disponibles pour ce compte ou cette période." }),
    raw: { supportedMetrics: { account: normalized.availableMetrics }, unsupportedMetrics: { account: unavailableMetrics }, metricErrors: { account: metricErrors }, scope: "account_period", followersScope: "current_audience" },
  };
}

export async function fetchThreadsMediaInsights(accessToken: string, mediaId: string) {
  const payload = await fetchThreadsJson(`${encodeURIComponent(mediaId)}/insights`, accessToken, { metric: THREADS_MEDIA_METRICS.join(",") });
  const normalized = normalizeThreadsInsights(payload.data, new Date(0), new Date(), "media");
  return { ...normalized, scope: "media_lifetime" as const };
}

export async function fetchThreadsContent(accessToken: string, userId: string, start: Date, end: Date, maxItems = 100) {
  const items: JsonRecord[] = [];
  const seenIds = new Set<string>();
  const seenCursors = new Set<string>();
  let after = "";
  for (let page = 0; page < 20 && items.length < maxItems; page++) {
    const payload = await fetchThreadsJson(`${encodeURIComponent(userId)}/threads`, accessToken, {
      fields: "id,text,timestamp,permalink,media_type", limit: "100",
      since: String(Math.floor(start.getTime() / 1000)), until: String(Math.floor(end.getTime() / 1000)),
      ...(after ? { after } : {}),
    });
    const rows = Array.isArray(payload.data) ? payload.data : [];
    for (const raw of rows) {
      const row = record(raw);
      const id = String(row.id || "");
      const timestamp = Date.parse(String(row.timestamp || ""));
      if (!id || seenIds.has(id) || !Number.isFinite(timestamp) || timestamp < start.getTime() || timestamp >= end.getTime()) continue;
      seenIds.add(id); items.push(row);
      if (items.length >= maxItems) break;
    }
    const paging = record(payload.paging);
    after = String(record(paging.cursors).after || "");
    if (!paging.next || !after || seenCursors.has(after) || rows.length === 0) break;
    seenCursors.add(after);
  }
  return items;
}
