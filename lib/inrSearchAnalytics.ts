import "server-only";

import { getInrSearchPublicationEligibility } from "@/lib/inrSearchEligibility";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type SupabaseLike = {
  from: (table: string) => any;
};

export type InrSearchEventType = "page_view" | "action_click";

export type InrSearchStatsPeriod = {
  week: number;
  month: number;
  total: number;
};

export type InrSearchAnalyticsSnapshot = {
  views: InrSearchStatsPeriod;
  actions: InrSearchStatsPeriod;
  contactActions: { week: number; month: number };
  actionsByKey: Record<string, number>;
  sources: Record<string, number>;
  topAction: { key: string; count: number } | null;
  topSource: { key: string; count: number } | null;
  syncedAt: number;
};

const ALLOWED_EVENT_TYPES = new Set<InrSearchEventType>(["page_view", "action_click"]);
const ALLOWED_ACTION_KEYS = new Set([
  "phone",
  "email",
  "website",
  "directions",
  "google",
  "facebook",
  "instagram",
  "linkedin",
  "x",
  "tiktok",
  "youtube",
  "pinterest",
  "faq_contact",
  "lead_form",
  "inrbadge",
  "other",
]);
const CONTACT_ACTION_KEYS = new Set(["phone", "email", "faq_contact", "lead_form"]);
const ALLOWED_SOURCES = new Set([
  "direct",
  "google",
  "bing",
  "chatgpt",
  "gemini",
  "perplexity",
  "copilot",
  "social",
  "other",
]);

function clean(value: unknown, max = 240) {
  return String(value ?? "")
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, max);
}

function normalizeToken(value: unknown, max = 80) {
  return clean(value, max)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function safeEventType(value: unknown): InrSearchEventType | null {
  const candidate = normalizeToken(value, 40) as InrSearchEventType;
  return ALLOWED_EVENT_TYPES.has(candidate) ? candidate : null;
}

function safeActionKey(value: unknown) {
  const candidate = normalizeToken(value, 80);
  return ALLOWED_ACTION_KEYS.has(candidate) ? candidate : "other";
}

function safeSource(value: unknown) {
  const candidate = normalizeToken(value, 40);
  return ALLOWED_SOURCES.has(candidate) ? candidate : "other";
}

function startOfPeriod(days: number) {
  return new Date(Date.now() - Math.max(0, days) * 24 * 60 * 60 * 1000).toISOString();
}

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function periodCount(rows: Array<Record<string, unknown>>, type: InrSearchEventType, sinceWeek: string) {
  const month = rows.filter((row) => row.type === type).length;
  const week = rows.filter((row) => row.type === type && String(row.created_at || "") >= sinceWeek).length;
  return { week, month };
}

function emptySnapshot(): InrSearchAnalyticsSnapshot {
  return {
    views: { week: 0, month: 0, total: 0 },
    actions: { week: 0, month: 0, total: 0 },
    contactActions: { week: 0, month: 0 },
    actionsByKey: {},
    sources: {},
    topAction: null,
    topSource: null,
    syncedAt: Date.now(),
  };
}

export async function resolvePublishedInrSearchOwner(slugValue: unknown) {
  const slug = clean(slugValue, 160)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  if (!slug) return null;

  const direct = await supabaseAdmin
    .from("pro_tools_configs")
    .select("user_id,settings")
    .contains("settings", { inrSearch: { slug, enabled: true } })
    .limit(5);

  const directRows = !direct.error && Array.isArray(direct.data) ? direct.data : [];
  const rows = directRows.length > 0
    ? directRows
    : (await supabaseAdmin.from("pro_tools_configs").select("user_id,settings").limit(2000)).data;

  for (const row of Array.isArray(rows) ? rows : []) {
    const settings = row?.settings && typeof row.settings === "object" && !Array.isArray(row.settings)
      ? row.settings as Record<string, unknown>
      : {};
    const config = settings.inrSearch && typeof settings.inrSearch === "object" && !Array.isArray(settings.inrSearch)
      ? settings.inrSearch as Record<string, unknown>
      : {};
    const candidateSlug = clean(config.slug, 160)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120);
    if (config.enabled === true && candidateSlug === slug && row.user_id) {
      const userId = String(row.user_id);
      const eligibility = await getInrSearchPublicationEligibility(userId);
      if (eligibility.allowed) return { userId, slug };
    }
  }

  return null;
}

export async function recordInrSearchEvent(supabase: SupabaseLike, input: {
  userId: string;
  slug: string;
  eventType: unknown;
  actionKey?: unknown;
  targetUrl?: unknown;
  source?: unknown;
  referrer?: unknown;
  visitorId?: unknown;
  pathname?: unknown;
}) {
  const userId = clean(input.userId, 80);
  const slug = clean(input.slug, 160);
  const eventType = safeEventType(input.eventType);
  if (!userId || !slug || !eventType) return { ok: false, skipped: true };

  const visitorId = clean(input.visitorId, 120).replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 120);
  const actionKey = eventType === "action_click" ? safeActionKey(input.actionKey) : null;
  const source = safeSource(input.source);
  const dailyKey = eventType === "page_view" && visitorId
    ? `inrsearch:${slug}:${visitorId}:${dayKey()}`
    : null;

  if (dailyKey) {
    const { data: duplicate } = await supabase
      .from("app_events")
      .select("id")
      .eq("user_id", userId)
      .eq("module", "inr_search")
      .eq("type", "page_view")
      .contains("payload", { dailyKey })
      .limit(1);
    if (Array.isArray(duplicate) && duplicate.length > 0) return { ok: true, deduped: true };
  }

  const payload = {
    slug,
    actionKey,
    targetUrl: clean(input.targetUrl, 700) || null,
    source,
    referrer: clean(input.referrer, 700) || null,
    visitorId: visitorId || null,
    dailyKey,
    pathname: clean(input.pathname, 240) || null,
  };

  const { error } = await supabase.from("app_events").insert({
    user_id: userId,
    module: "inr_search",
    type: eventType,
    payload,
  });

  if (error) {
    console.warn("[inr-search-analytics] event insert failed", error);
    return { ok: false, error };
  }

  return { ok: true, deduped: false };
}

export async function readInrSearchAnalytics(userIdValue: unknown): Promise<InrSearchAnalyticsSnapshot> {
  const userId = clean(userIdValue, 80);
  if (!userId) return emptySnapshot();

  const monthStart = startOfPeriod(30);
  const weekStart = startOfPeriod(7);

  try {
    const [recentRes, totalViewsRes, totalActionsRes] = await Promise.all([
      supabaseAdmin
        .from("app_events")
        .select("type,payload,created_at")
        .eq("user_id", userId)
        .eq("module", "inr_search")
        .gte("created_at", monthStart)
        .order("created_at", { ascending: false })
        .limit(5000),
      supabaseAdmin
        .from("app_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("module", "inr_search")
        .eq("type", "page_view"),
      supabaseAdmin
        .from("app_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("module", "inr_search")
        .eq("type", "action_click"),
    ]);

    if (recentRes.error) throw recentRes.error;
    const rows = (Array.isArray(recentRes.data) ? recentRes.data : []) as Array<Record<string, unknown>>;
    const views = periodCount(rows, "page_view", weekStart);
    const actions = periodCount(rows, "action_click", weekStart);
    const actionsByKey: Record<string, number> = {};
    const sources: Record<string, number> = {};
    let contactWeek = 0;
    let contactMonth = 0;

    for (const row of rows) {
      const payload = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
        ? row.payload as Record<string, unknown>
        : {};
      const source = safeSource(payload.source);
      if (row.type === "page_view") sources[source] = (sources[source] || 0) + 1;

      if (row.type === "action_click") {
        const actionKey = safeActionKey(payload.actionKey);
        actionsByKey[actionKey] = (actionsByKey[actionKey] || 0) + 1;
        if (CONTACT_ACTION_KEYS.has(actionKey)) {
          contactMonth += 1;
          if (String(row.created_at || "") >= weekStart) contactWeek += 1;
        }
      }
    }

    const sortedActions = Object.entries(actionsByKey).sort((a, b) => b[1] - a[1]);
    const sortedSources = Object.entries(sources).sort((a, b) => b[1] - a[1]);

    return {
      views: { week: views.week, month: views.month, total: Number(totalViewsRes.count || 0) },
      actions: { week: actions.week, month: actions.month, total: Number(totalActionsRes.count || 0) },
      contactActions: { week: contactWeek, month: contactMonth },
      actionsByKey,
      sources,
      topAction: sortedActions[0] ? { key: sortedActions[0][0], count: sortedActions[0][1] } : null,
      topSource: sortedSources[0] ? { key: sortedSources[0][0], count: sortedSources[0][1] } : null,
      syncedAt: Date.now(),
    };
  } catch (error) {
    console.warn("[inr-search-analytics] stats read failed", error);
    return emptySnapshot();
  }
}
