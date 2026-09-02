import { NextResponse } from "next/server";
import { buildInternalCronHeaders, getAppOriginFromRequest, isAuthorizedCronRequest } from "@/lib/cronAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { InrAgentAutomationKey, InrAgentFrequency } from "@/lib/inrAgentSettings";
import {
  inrAgentMonthlyDateCount,
  inrAgentMonthlyOccurrenceIndex,
  isInrAgentScheduledMonthDay,
  normalizeInrAgentMonthDays,
} from "@/lib/inrAgentMonthSchedule";
import { getDashboardEditionsForAccountIds } from "@/lib/dashboardEditionServer";
import { isStandardAgentAutomationKey } from "@/lib/standardAgentPolicy";

export const runtime = "nodejs";

const AUTOMATION_KEYS: InrAgentAutomationKey[] = ["publish", "grow", "loyalty", "stats"];
const OPEN_ACTION_STATUSES = ["prepared", "pending_validation", "pending", "draft", "scheduled", "validated", "executing"];
const CAMPAIGN_BLOCKING_ACTION_STATUSES = ["scheduled", "validated", "executing"];
const AUTOMATION_SELECT = "user_id, automation_key, enabled, frequency, day_of_week, time, next_run_at, last_prepared_at, last_executed_at, metadata";
const CRON_RETRY_DELAY_MS = 15 * 60 * 1000;
const MAX_CRON_RETRIES_BEFORE_NEXT_SLOT = 4;

type AutomationRow = {
  user_id: string;
  automation_key: InrAgentAutomationKey;
  enabled: boolean | null;
  frequency: InrAgentFrequency | null;
  day_of_week: number | null;
  time: string | null;
  next_run_at: string | null;
  last_prepared_at: string | null;
  last_executed_at: string | null;
  metadata: Record<string, unknown> | null;
};

type AutomationScheduleSlot = { dayOfWeek: number; time: string };

type CronRunResult = {
  userId: string;
  automationKey: InrAgentAutomationKey;
  status: "prepared" | "sent" | "skipped" | "failed" | "dry_run";
  reason?: string;
  actionId?: string | null;
  nextRunAt?: string | null;
  error?: string;
  errorDetail?: string;
  httpStatus?: number | null;
};

type TriggerAutomationResult = {
  ok: boolean;
  payload: Record<string, unknown> | null;
  error: string | null;
  detail: string | null;
  code: string | null;
  status: number | null;
  statusText: string | null;
  endpoint: string;
  retriable: boolean;
};

function isMissingSchemaError(error: { code?: string; message?: string } | null | undefined) {
  const message = String(error?.message || "").toLowerCase();
  return error?.code === "42P01" || error?.code === "42703" || error?.code === "PGRST205" || message.includes("inr_agent_");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeTime(value: unknown) {
  const text = String(value || "09:00").trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : "09:00";
}

function normalizeDay(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 6 ? Math.round(n) : 1;
}

function normalizeFrequency(value: unknown): InrAgentFrequency {
  const text = String(value || "weekly") as InrAgentFrequency;
  return ["weekly", "twice_weekly", "three_times_weekly", "biweekly", "three_times_monthly", "monthly", "quarterly", "one_off"].includes(text) ? text : "weekly";
}

function getLocalParts(date: Date, timeZone = "Europe/Paris") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: weekdayMap[map.weekday] ?? 1,
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = getLocalParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

function zonedTimeToUtc(parts: { year: number; month: number; day: number; hour: number; minute: number }, timeZone: string) {
  let utc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
  for (let index = 0; index < 3; index += 1) {
    const offset = getTimeZoneOffsetMs(new Date(utc), timeZone);
    utc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0) - offset;
  }
  return new Date(utc);
}

function addLocalDays(base: ReturnType<typeof getLocalParts>, days: number) {
  const d = new Date(Date.UTC(base.year, base.month - 1, base.day + days, 12, 0, 0));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function timeParts(time: string) {
  const [hourRaw, minuteRaw] = normalizeTime(time).split(":");
  return { hour: Number(hourRaw), minute: Number(minuteRaw) };
}

function normalizeScheduleSlots(row: AutomationRow, frequency: InrAgentFrequency): AutomationScheduleSlot[] {
  const dayOfWeek = normalizeDay(row.day_of_week);
  const time = normalizeTime(row.time || "09:00");
  const slotCount = frequency === "three_times_weekly" ? 3 : frequency === "twice_weekly" ? 2 : 1;
  const offsets = slotCount === 3 ? [0, 2, 4] : slotCount === 2 ? [0, 3] : [0];
  const fallback = offsets.map((offset) => ({ dayOfWeek: (dayOfWeek + offset) % 7, time }));
  if (slotCount === 1) return fallback;
  const metadata = asRecord(row.metadata);
  const rawSlots = Array.isArray(metadata.scheduleSlots) ? metadata.scheduleSlots : [];
  const slots = rawSlots
    .map((item) => {
      const source = asRecord(item);
      return {
        dayOfWeek: normalizeDay(source.dayOfWeek),
        time: normalizeTime(source.time),
      };
    })
    .filter((slot, index, list) => list.findIndex((candidate) => candidate.dayOfWeek === slot.dayOfWeek && candidate.time === slot.time) === index)
    .slice(0, slotCount);
  return slots.length >= slotCount ? slots : fallback;
}

function isFirstScheduledWeekdayOfMonth(local: ReturnType<typeof getLocalParts>, dayOfWeek: number) {
  return local.weekday === dayOfWeek && local.day <= 7;
}

function isScheduledDate(
  local: ReturnType<typeof getLocalParts>,
  frequency: InrAgentFrequency,
  dayOfWeek: number,
  monthDays: number[],
) {
  if (inrAgentMonthlyDateCount(frequency)) {
    return isInrAgentScheduledMonthDay(local, monthDays);
  }
  if (frequency === "twice_weekly" || frequency === "three_times_weekly") return local.weekday === dayOfWeek;
  if (frequency === "quarterly") return [1, 4, 7, 10].includes(local.month) && isFirstScheduledWeekdayOfMonth(local, dayOfWeek);
  return local.weekday === dayOfWeek;
}

function localBucket(
  date: Date,
  timeZone: string,
  frequency: InrAgentFrequency,
  monthDays: number[],
) {
  const local = getLocalParts(date, timeZone);
  const y = String(local.year);
  const m = String(local.month).padStart(2, "0");
  const d = String(local.day).padStart(2, "0");
  if (inrAgentMonthlyDateCount(frequency)) {
    return `${y}-${m}-M${inrAgentMonthlyOccurrenceIndex(local, monthDays) + 1}`;
  }
  if (frequency === "quarterly") return `${y}-Q${Math.floor((local.month - 1) / 3) + 1}`;
  return `${y}-${m}-${d}`;
}

function referenceDate(row: AutomationRow) {
  const ref = row.automation_key === "stats" ? row.last_executed_at : row.last_prepared_at;
  const parsed = ref ? Date.parse(ref) : NaN;
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

function isDue(row: AutomationRow, now: Date, timeZone: string) {
  if (!row.enabled) return false;
  const nextRun = row.next_run_at ? Date.parse(row.next_run_at) : NaN;
  if (Number.isFinite(nextRun)) return nextRun <= now.getTime();

  const frequency = normalizeFrequency(row.frequency);
  const monthDays = normalizeInrAgentMonthDays(
    asRecord(row.metadata).monthDays,
    frequency,
  );
  if (frequency === "one_off" && referenceDate(row)) return false;

  const local = getLocalParts(now, timeZone);
  const minuteNow = local.hour * 60 + local.minute;
  const slots = normalizeScheduleSlots(row, frequency);
  const matchingSlot = slots.some((slot) => {
    const schedule = timeParts(slot.time);
    const minuteSchedule = schedule.hour * 60 + schedule.minute;
    return minuteNow >= minuteSchedule && isScheduledDate(local, frequency, slot.dayOfWeek, monthDays);
  });
  if (!matchingSlot) return false;

  const ref = referenceDate(row);
  if (!ref) return true;
  return localBucket(ref, timeZone, frequency, monthDays) !== localBucket(now, timeZone, frequency, monthDays);
}

function computeNextRunAt(row: AutomationRow, after: Date, timeZone: string) {
  const frequency = normalizeFrequency(row.frequency);
  if (frequency === "one_off") return null;

  const start = getLocalParts(new Date(after.getTime() + 60 * 1000), timeZone);
  const slots = normalizeScheduleSlots(row, frequency);
  const monthDays = normalizeInrAgentMonthDays(
    asRecord(row.metadata).monthDays,
    frequency,
  );
  for (let offset = 0; offset <= 110; offset += 1) {
    const localDate = addLocalDays(start, offset);
    const candidates = slots
      .map((slot) => {
        const schedule = timeParts(slot.time);
        const candidateUtc = zonedTimeToUtc({ ...localDate, ...schedule }, timeZone);
        if (candidateUtc.getTime() <= after.getTime()) return null;
        const candidateLocal = getLocalParts(candidateUtc, timeZone);
        return isScheduledDate(candidateLocal, frequency, slot.dayOfWeek, monthDays) ? candidateUtc : null;
      })
      .filter((candidate): candidate is Date => Boolean(candidate))
      .sort((a, b) => a.getTime() - b.getTime());
    if (candidates[0]) return candidates[0].toISOString();
  }
  return null;
}

function dedupeSince(row: AutomationRow, now: Date) {
  const frequency = normalizeFrequency(row.frequency);
  const days = frequency === "three_times_weekly" ? 2 : frequency === "twice_weekly" ? 3 : frequency === "weekly" ? 7 : frequency === "three_times_monthly" ? 8 : frequency === "biweekly" ? 15 : frequency === "monthly" ? 31 : frequency === "quarterly" ? 95 : 1;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function hasOpenPreparedAction(row: AutomationRow, now: Date) {
  if (row.automation_key === "stats") return false;
  const statuses = row.automation_key === "grow" || row.automation_key === "loyalty"
    ? CAMPAIGN_BLOCKING_ACTION_STATUSES
    : OPEN_ACTION_STATUSES;
  const { data, error } = await supabaseAdmin
    .from("inr_agent_actions")
    .select("id")
    .eq("user_id", row.user_id)
    .eq("automation_key", row.automation_key)
    .in("status", statuses)
    .gte("created_at", dedupeSince(row, now))
    .limit(1);

  if (error) return false;
  return Boolean(Array.isArray(data) && data.length > 0);
}

function endpointForAutomation(key: InrAgentAutomationKey) {
  if (key === "publish") return "/api/agent/actions/prepare-publish";
  if (key === "stats") return "/api/agent/actions/send-stats-report";
  return "/api/agent/actions/prepare-campaign";
}

function safeJsonParse(text: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

function trimDiagnosticText(value: unknown, maxLength = 1600) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function errorFromPayload(payload: Record<string, unknown> | null, fallback: string) {
  return (
    trimDiagnosticText(payload?.error, 500) ||
    trimDiagnosticText(payload?.message, 500) ||
    trimDiagnosticText(payload?.detail, 500) ||
    fallback
  );
}

function detailFromPayload(payload: Record<string, unknown> | null, responseText: string, fallback: string) {
  const details = [
    trimDiagnosticText(payload?.detail, 900),
    trimDiagnosticText(payload?.code, 120),
    trimDiagnosticText(payload?.hint, 400),
  ].filter(Boolean);

  if (details.length) return details.join(" · ");

  const body = trimDiagnosticText(responseText, 900);
  if (body && body !== fallback) return body;
  return null;
}

function isRetriableTriggerFailure(status: number | null, error: string | null) {
  const text = String(error || "").toLowerCase();
  if (text.includes("aborted") || text.includes("timeout") || text.includes("fetch failed")) return true;
  if (!status) return true;
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

async function triggerAutomation(args: { origin: string; row: AutomationRow; timeoutMs: number }): Promise<TriggerAutomationResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs);
  const endpoint = endpointForAutomation(args.row.automation_key);
  try {
    const url = `${args.origin}${endpoint}`;
    const body: Record<string, unknown> = { cronUserId: args.row.user_id, triggeredBy: "inr_agent_cron" };
    if (args.row.automation_key === "grow" || args.row.automation_key === "loyalty") body.automationKey = args.row.automation_key;

    const response = await fetch(url, {
      method: "POST",
      headers: buildInternalCronHeaders(args.row.user_id),
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
    const responseText = await response.text().catch(() => "");
    const payload = safeJsonParse(responseText);
    if (!response.ok) {
      const error = errorFromPayload(payload, response.statusText || "Action impossible");
      const detail = detailFromPayload(payload, responseText, error);
      return {
        ok: false,
        payload,
        error,
        detail,
        code: trimDiagnosticText(payload?.code, 160) || null,
        status: response.status,
        statusText: response.statusText || null,
        endpoint,
        retriable: isRetriableTriggerFailure(response.status, error),
      };
    }
    return {
      ok: true,
      payload,
      error: null,
      detail: null,
      code: null,
      status: response.status,
      statusText: response.statusText || null,
      endpoint,
      retriable: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Action impossible";
    return {
      ok: false,
      payload: null,
      error: message,
      detail: error instanceof Error ? error.stack?.slice(0, 1600) || null : null,
      code: error instanceof DOMException ? error.name : null,
      status: null,
      statusText: null,
      endpoint,
      retriable: isRetriableTriggerFailure(null, message),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function updateAutomationAfterRun(row: AutomationRow, nextRunAt: string | null, extraMetadata: Record<string, unknown>) {
  const now = new Date().toISOString();
  const metadata = { ...asRecord(row.metadata), ...extraMetadata };
  await supabaseAdmin
    .from("inr_agent_automation_settings")
    .update({ next_run_at: nextRunAt, metadata, updated_at: now })
    .eq("user_id", row.user_id)
    .eq("automation_key", row.automation_key);
}

function metadataNumber(row: AutomationRow, key: string) {
  const value = asRecord(row.metadata)[key];
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function computeRetryRunAt(now: Date) {
  return new Date(now.getTime() + CRON_RETRY_DELAY_MS).toISOString();
}

function buildFailureMetadata(args: {
  row: AutomationRow;
  triggered: TriggerAutomationResult;
  now: Date;
  nextRegularRunAt: string | null;
}) {
  const retryCount = metadataNumber(args.row, "lastCronRetryCount") + 1;
  const shouldRetry = args.triggered.retriable && retryCount <= MAX_CRON_RETRIES_BEFORE_NEXT_SLOT;
  const retryRunAt = shouldRetry ? computeRetryRunAt(args.now) : null;

  return {
    nextRunAt: retryRunAt || args.nextRegularRunAt,
    metadata: {
      lastCronStatus: "failed",
      lastCronError: args.triggered.error || "Action impossible",
      lastCronErrorDetail: args.triggered.detail,
      lastCronErrorCode: args.triggered.code,
      lastCronHttpStatus: args.triggered.status,
      lastCronHttpStatusText: args.triggered.statusText,
      lastCronEndpoint: args.triggered.endpoint,
      lastCronRetriable: args.triggered.retriable,
      lastCronRetryCount: retryCount,
      lastCronNextRetryAt: retryRunAt,
      lastCronNextRegularRunAt: args.nextRegularRunAt,
      lastCronErrorAt: args.now.toISOString(),
    },
  };
}

function getActionId(payload: Record<string, unknown> | null) {
  const action = asRecord(payload?.action);
  return typeof action.id === "string" ? action.id : null;
}

async function processAutomation(args: { row: AutomationRow; origin: string; now: Date; timeZone: string; dryRun: boolean; timeoutMs: number }): Promise<CronRunResult> {
  const { row, now, timeZone } = args;
  const nextRunAt = computeNextRunAt(row, now, timeZone);

  if (!isDue(row, now, timeZone)) {
    if (!args.dryRun && !row.next_run_at && nextRunAt) {
      await updateAutomationAfterRun(row, nextRunAt, {
        lastCronSkip: "not_due",
        lastCronSkipAt: now.toISOString(),
      });
    }
    return { userId: row.user_id, automationKey: row.automation_key, status: "skipped", reason: "not_due", nextRunAt: row.next_run_at || nextRunAt };
  }

  if (await hasOpenPreparedAction(row, now)) {
    await updateAutomationAfterRun(row, nextRunAt, {
      lastCronSkip: "open_action_already_pending",
      lastCronSkipAt: now.toISOString(),
    });
    return { userId: row.user_id, automationKey: row.automation_key, status: "skipped", reason: "open_action_already_pending", nextRunAt };
  }

  if (args.dryRun) {
    return { userId: row.user_id, automationKey: row.automation_key, status: "dry_run", reason: "would_trigger", nextRunAt };
  }

  const triggered = await triggerAutomation({ origin: args.origin, row, timeoutMs: args.timeoutMs });
  if (!triggered.ok) {
    const failure = buildFailureMetadata({
      row,
      triggered,
      now,
      nextRegularRunAt: nextRunAt,
    });
    await updateAutomationAfterRun(row, failure.nextRunAt, failure.metadata);
    return {
      userId: row.user_id,
      automationKey: row.automation_key,
      status: "failed",
      error: triggered.error || "Action impossible",
      errorDetail: triggered.detail || undefined,
      httpStatus: triggered.status,
      nextRunAt: failure.nextRunAt,
    };
  }

  const actionId = getActionId(triggered.payload);
  if (row.automation_key !== "stats" && !actionId) {
    const syntheticFailure: TriggerAutomationResult = {
      ...triggered,
      ok: false,
      error: "Action préparée introuvable dans la réponse iNr’Agent.",
      detail: "La route de préparation a répondu sans identifiant d’action. Le cron retentera automatiquement avant de passer au prochain créneau.",
      code: "missing_prepared_action_id",
      retriable: true,
    };
    const failure = buildFailureMetadata({
      row,
      triggered: syntheticFailure,
      now,
      nextRegularRunAt: nextRunAt,
    });
    await updateAutomationAfterRun(row, failure.nextRunAt, failure.metadata);
    return {
      userId: row.user_id,
      automationKey: row.automation_key,
      status: "failed",
      error: syntheticFailure.error || "Action impossible",
      errorDetail: syntheticFailure.detail || undefined,
      httpStatus: syntheticFailure.status,
      nextRunAt: failure.nextRunAt,
    };
  }

  await updateAutomationAfterRun(row, nextRunAt, {
    lastCronStatus: "success",
    lastCronError: null,
    lastCronErrorDetail: null,
    lastCronErrorCode: null,
    lastCronHttpStatus: null,
    lastCronEndpoint: triggered.endpoint,
    lastCronRetriable: false,
    lastCronRetryCount: 0,
    lastCronNextRetryAt: null,
    lastCronNextRegularRunAt: nextRunAt,
    lastCronSuccessAt: now.toISOString(),
  });

  return {
    userId: row.user_id,
    automationKey: row.automation_key,
    status: row.automation_key === "stats" ? "sent" : "prepared",
    actionId,
    nextRunAt,
  };
}

export async function POST(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  const url = new URL(req.url);
  const now = new Date();
  const origin = getAppOriginFromRequest(req);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const maxRows = Math.min(100, Math.max(1, Number(url.searchParams.get("max") || 30)));
  const timeoutMs = Math.min(120_000, Math.max(15_000, Number(url.searchParams.get("timeoutMs") || 60_000)));

  const { data: globalRows, error: globalError } = await supabaseAdmin
    .from("inr_agent_settings")
    .select("user_id, global_enabled, timezone")
    .eq("global_enabled", true)
    .limit(maxRows);

  if (globalError) {
    if (isMissingSchemaError(globalError)) {
      return NextResponse.json({ success: false, tableMissing: true, error: "Tables iNr’Agent V2 manquantes." }, { status: 500 });
    }
    return NextResponse.json({ success: false, error: globalError.message }, { status: 500 });
  }

  const userTimezone = new Map<string, string>();
  const userIds = (Array.isArray(globalRows) ? globalRows : [])
    .map((row: any) => {
      const userId = String(row.user_id || "");
      if (userId) userTimezone.set(userId, String(row.timezone || "Europe/Paris"));
      return userId;
    })
    .filter(Boolean);

  if (!userIds.length) {
    return NextResponse.json({ success: true, processed: 0, results: [], dryRun });
  }

  const { data: automationRows, error: automationError } = await supabaseAdmin
    .from("inr_agent_automation_settings")
    .select(AUTOMATION_SELECT)
    .in("user_id", userIds)
    .in("automation_key", AUTOMATION_KEYS)
    .eq("enabled", true)
    .order("next_run_at", { ascending: true, nullsFirst: true })
    .limit(maxRows * AUTOMATION_KEYS.length);

  if (automationError) {
    if (isMissingSchemaError(automationError)) {
      return NextResponse.json({ success: false, tableMissing: true, error: "Table inr_agent_automation_settings manquante." }, { status: 500 });
    }
    return NextResponse.json({ success: false, error: automationError.message }, { status: 500 });
  }

  const rows = (Array.isArray(automationRows) ? automationRows : []) as AutomationRow[];
  const results: CronRunResult[] = [];
  const editionsByAccount = await getDashboardEditionsForAccountIds(
    rows.map((row) => row.user_id),
  );

  for (const row of rows) {
    if (
      editionsByAccount.get(row.user_id) === "standard" &&
      !isStandardAgentAutomationKey(row.automation_key)
    ) {
      results.push({
        userId: row.user_id,
        automationKey: row.automation_key,
        status: "skipped",
        reason: "premium_required",
        nextRunAt: row.next_run_at,
      });
      continue;
    }
    const timeZone = userTimezone.get(row.user_id) || "Europe/Paris";
    results.push(await processAutomation({ row, origin, now, timeZone, dryRun, timeoutMs }));
  }

  const summary = results.reduce<Record<string, number>>((acc, result) => {
    acc[result.status] = (acc[result.status] || 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({
    success: true,
    dryRun,
    processed: results.length,
    summary,
    results,
  });
}

export async function GET(req: Request) {
  return POST(req);
}
