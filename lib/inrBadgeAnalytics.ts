import "server-only";

import { createHash } from "node:crypto";

type SupabaseLike = {
  from: (table: string) => any;
};

export type InrBadgeEventType = "view" | "qr_scan" | "action_click" | "lead_submit" | "appointment_request";

export type InrBadgeStatsPeriod = {
  week: number;
  month: number;
  total: number;
};

export type InrBadgeActionBreakdown = {
  phone: InrBadgeStatsPeriod;
  mail: InrBadgeStatsPeriod;
  save_contact: InrBadgeStatsPeriod;
  lead_form: InrBadgeStatsPeriod;
  appointment: InrBadgeStatsPeriod;
  site_inrcy: InrBadgeStatsPeriod;
  site_web: InrBadgeStatsPeriod;
  google_business: InrBadgeStatsPeriod;
  facebook: InrBadgeStatsPeriod;
  instagram: InrBadgeStatsPeriod;
  linkedin: InrBadgeStatsPeriod;
  x: InrBadgeStatsPeriod;
  tiktok: InrBadgeStatsPeriod;
  youtube_shorts: InrBadgeStatsPeriod;
  other: InrBadgeStatsPeriod;
};

export type InrBadgeStatsSnapshot = {
  views: InrBadgeStatsPeriod;
  qrScans: InrBadgeStatsPeriod;
  actions: InrBadgeStatsPeriod;
  leads: InrBadgeStatsPeriod;
  appointments: InrBadgeStatsPeriod;
  capturedLeads: { week: number; month: number };
  actionsByKey: InrBadgeActionBreakdown;
  qualityScore: number;
  opportunity30: number;
  syncedAt: number;
};

const EVENT_TYPES = new Set<InrBadgeEventType>(["view", "qr_scan", "action_click", "lead_submit", "appointment_request"]);

const ACTION_KEYS = [
  "phone",
  "mail",
  "save_contact",
  "lead_form",
  "appointment",
  "site_inrcy",
  "site_web",
  "google_business",
  "facebook",
  "instagram",
  "linkedin",
  "x",
  "tiktok",
  "youtube_shorts",
  "other",
] as const;

type ActionKey = typeof ACTION_KEYS[number];

const KNOWN_ACTION_KEYS = new Set<string>(ACTION_KEYS);

function clean(value: unknown, max = 160) {
  return String(value ?? "")
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, max);
}


function deterministicEventId(value: string) {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function isUniqueViolation(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return String(candidate.code || "") === "23505" || /duplicate key|unique constraint/i.test(String(candidate.message || ""));
}

function safeEventType(value: unknown): InrBadgeEventType {
  const candidate = clean(value, 40) as InrBadgeEventType;
  return EVENT_TYPES.has(candidate) ? candidate : "action_click";
}

function safeActionKey(value: unknown): ActionKey | null {
  const normalized = clean(value, 80).toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!normalized) return null;
  return (KNOWN_ACTION_KEYS.has(normalized) ? normalized : "other") as ActionKey;
}

function isoDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function startOfPeriod(days: number) {
  return new Date(Date.now() - Math.max(0, days) * 24 * 60 * 60 * 1000).toISOString();
}

function zeroPeriod(): InrBadgeStatsPeriod {
  return { week: 0, month: 0, total: 0 };
}

function zeroActions(): InrBadgeActionBreakdown {
  return {
    phone: zeroPeriod(),
    mail: zeroPeriod(),
    save_contact: zeroPeriod(),
    lead_form: zeroPeriod(),
    appointment: zeroPeriod(),
    site_inrcy: zeroPeriod(),
    site_web: zeroPeriod(),
    google_business: zeroPeriod(),
    facebook: zeroPeriod(),
    instagram: zeroPeriod(),
    linkedin: zeroPeriod(),
    x: zeroPeriod(),
    tiktok: zeroPeriod(),
    youtube_shorts: zeroPeriod(),
    other: zeroPeriod(),
  };
}

function countBy(rows: Array<Record<string, unknown>>, predicate: (row: Record<string, unknown>) => boolean) {
  return rows.reduce((total, row) => total + (predicate(row) ? 1 : 0), 0);
}

function countPeriod(rows: Array<Record<string, unknown>>, predicate: (row: Record<string, unknown>) => boolean): InrBadgeStatsPeriod {
  return {
    week: countBy(rows, (row) => row.__period === "week" && predicate(row)),
    month: countBy(rows, (row) => (row.__period === "week" || row.__period === "month") && predicate(row)),
    total: countBy(rows, predicate),
  };
}

function qualityFromStats(input: { views30: number; qr30: number; actions30: number; captured30: number }) {
  const score = 52
    + Math.min(12, input.views30 / 4)
    + Math.min(10, input.qr30 / 2)
    + Math.min(14, input.actions30 * 2)
    + Math.min(12, input.captured30 * 6);
  return Math.max(45, Math.min(96, Math.round(score)));
}

function opportunityFromStats(input: { views30: number; qr30: number; actions30: number; captured30: number }) {
  const coldBoost = input.views30 <= 0 && input.qr30 <= 0 ? 4 : 0;
  const visibility = Math.min(18, input.views30 / 3 + input.qr30 * 1.4);
  const intent = Math.min(22, input.actions30 * 1.7 + input.captured30 * 4);
  return Math.max(0, Math.round(coldBoost + visibility + intent));
}

export function isQrBadgeSource(value: unknown) {
  const source = clean(value, 40).toLowerCase();
  return ["qr", "qrcode", "qr_code", "inrbadge_qr"].includes(source);
}

export async function recordInrBadgeEvent(supabase: SupabaseLike, input: {
  userId: string;
  slug: string;
  eventType: unknown;
  actionKey?: unknown;
  targetUrl?: unknown;
  source?: unknown;
  referrer?: unknown;
  visitorId?: unknown;
  metadata?: Record<string, unknown> | null;
}) {
  const userId = clean(input.userId, 80);
  const slug = clean(input.slug, 190);
  if (!userId || !slug) return { ok: false, skipped: true };

  const eventType = safeEventType(input.eventType);
  const actionKey = eventType === "action_click" ? safeActionKey(input.actionKey) : safeActionKey(input.actionKey);
  const visitorId = clean(input.visitorId, 120).replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 120);
  const source = clean(input.source, 80).toLowerCase();
  const targetUrl = clean(input.targetUrl, 700);
  const referrer = clean(input.referrer, 700);
  const dailyVisitKey = visitorId && (eventType === "view" || eventType === "qr_scan")
    ? `${eventType}:${slug}:${visitorId}:${isoDateKey()}`
    : null;

  const payload = {
    user_id: userId,
    slug,
    event_type: eventType,
    action_key: actionKey,
    target_url: targetUrl || null,
    source: source || null,
    referrer: referrer || null,
    visitor_id: visitorId || null,
    daily_visit_key: dailyVisitKey,
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {},
  };

  try {
    if (dailyVisitKey) {
      const { data: existingDailyVisit, error: lookupError } = await supabase
        .from("inrbadge_events")
        .select("id")
        .eq("daily_visit_key", dailyVisitKey)
        .maybeSingle();
      if (lookupError) throw lookupError;
      if (existingDailyVisit?.id) return { ok: true, deduped: true };

      // Utilise un UUID déterministe par visite quotidienne puis un upsert
      // sur la clé primaire. Cela évite les erreurs 23505 dans les logs tout
      // en conservant la déduplication journalière déjà garantie par l'index.
      const dailyPayload = {
        ...payload,
        id: deterministicEventId(dailyVisitKey),
      };
      const { error } = await supabase
        .from("inrbadge_events")
        .upsert(dailyPayload, {
          onConflict: "id",
          ignoreDuplicates: true,
        });
      if (error) {
        if (isUniqueViolation(error)) {
          const { data: racedDailyVisit, error: raceLookupError } = await supabase
            .from("inrbadge_events")
            .select("id")
            .eq("daily_visit_key", dailyVisitKey)
            .maybeSingle();
          if (!raceLookupError && racedDailyVisit?.id) return { ok: true, deduped: true };
        }
        throw error;
      }
      return { ok: true, deduped: true };
    }

    const { error } = await supabase.from("inrbadge_events").insert(payload);
    if (error) throw error;
    return { ok: true, deduped: false };
  } catch (error) {
    console.warn("[inrbadge-analytics] event insert failed", error);
    return { ok: false, error };
  }
}

export async function readInrBadgeStats(supabase: SupabaseLike, userId: string): Promise<InrBadgeStatsSnapshot> {
  const now = Date.now();
  const monthStart = startOfPeriod(30);
  const weekStart = startOfPeriod(7);
  const empty: InrBadgeStatsSnapshot = {
    views: zeroPeriod(),
    qrScans: zeroPeriod(),
    actions: zeroPeriod(),
    leads: zeroPeriod(),
    appointments: zeroPeriod(),
    capturedLeads: { week: 0, month: 0 },
    actionsByKey: zeroActions(),
    qualityScore: 52,
    opportunity30: 4,
    syncedAt: now,
  };

  try {
    const { data, error } = await supabase
      .from("inrbadge_events")
      .select("event_type,action_key,created_at")
      .eq("user_id", userId)
      .gte("created_at", monthStart)
      .order("created_at", { ascending: false })
      .limit(5000);

    if (error) throw error;

    const monthRows = (Array.isArray(data) ? data : []).map((row: Record<string, unknown>) => {
      const createdAt = String(row.created_at || "");
      return {
        ...row,
        __period: createdAt >= weekStart ? "week" : "month",
      };
    });

    const rowsForTotal = monthRows;
    const views = countPeriod(rowsForTotal, (row) => row.event_type === "view");
    const qrScans = countPeriod(rowsForTotal, (row) => row.event_type === "qr_scan");
    const actions = countPeriod(rowsForTotal, (row) => row.event_type === "action_click");
    const leads = countPeriod(rowsForTotal, (row) => row.event_type === "lead_submit");
    const appointments = countPeriod(rowsForTotal, (row) => row.event_type === "appointment_request");
    const actionsByKey = zeroActions();

    for (const key of ACTION_KEYS) {
      actionsByKey[key] = countPeriod(rowsForTotal, (row) => row.event_type === "action_click" && (row.action_key || "other") === key);
    }

    const capturedWeek = leads.week + appointments.week;
    const capturedMonth = leads.month + appointments.month;
    const qualityScore = qualityFromStats({ views30: views.month, qr30: qrScans.month, actions30: actions.month, captured30: capturedMonth });
    const opportunity30 = opportunityFromStats({ views30: views.month, qr30: qrScans.month, actions30: actions.month, captured30: capturedMonth });

    return {
      views,
      qrScans,
      actions,
      leads,
      appointments,
      capturedLeads: { week: capturedWeek, month: capturedMonth },
      actionsByKey,
      qualityScore,
      opportunity30,
      syncedAt: now,
    };
  } catch (error) {
    console.warn("[inrbadge-analytics] stats read failed", error);
    return empty;
  }
}
