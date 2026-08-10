import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  INR_AGENT_PINTEREST_PUBLISH_MIGRATION_FLAG,
  INR_AGENT_AUTOMATION_KEYS,
  automationSettingsToDbRow,
  sanitizeInrAgentAutomationSettings,
  sanitizeInrAgentSettings,
  type InrAgentAutomationKey,
  type InrAgentAutomationSettings,
  type InrAgentChannel,
  type InrAgentFrequency,
  type InrAgentSettings,
} from "@/lib/inrAgentSettings";
import { getChannelConnectionStates } from "@/lib/channelConnectionState";
import { ensureSystemManagedInrSearch } from "@/lib/inrSearchProvisioning";
import { getInrSearchPublicStatus } from "@/lib/inrSearchPublic";
import { captureApiException } from "@/lib/observability/sentry";
import { withApi } from "@/lib/observability/withApi";
import { getDashboardEditionForAuthUser } from "@/lib/dashboardEditionServer";
import {
  restrictInrAgentSettingsForStandard,
  standardAgentAutomationKeysForPersistence,
} from "@/lib/standardAgentPolicy";

type DbAgentGlobalSettingsRow = {
  global_enabled?: boolean | null;
  tone?: string | null;
  timezone?: string | null;
  metadata?: Record<string, unknown> | null;
};

type DbAgentAutomationSettingsRow = {
  automation_key?: string | null;
  enabled?: boolean | null;
  frequency?: string | null;
  day_of_week?: number | null;
  time?: string | null;
  validation_mode?: string | null;
  allowed_channels?: string[] | null;
  allowed_themes?: string[] | null;
  use_image_bank?: boolean | null;
  image_required?: boolean | null;
  recipient_scope?: string | null;
  source_strategy?: string | null;
  last_prepared_at?: string | null;
  last_executed_at?: string | null;
  next_run_at?: string | null;
  metadata?: Record<string, unknown> | null;
};

type AutomationScheduleSlot = { dayOfWeek: number; time: string };

const GLOBAL_SELECT = "global_enabled, tone, timezone, metadata";
const AUTOMATION_SELECT = "automation_key, enabled, frequency, day_of_week, time, validation_mode, allowed_channels, allowed_themes, use_image_bank, image_required, recipient_scope, source_strategy, last_prepared_at, last_executed_at, next_run_at, metadata";
const SETTINGS_SCHEDULE_GRACE_MS = 20 * 60 * 1000;

function isMissingSchemaError(error: { code?: string; message?: string } | null | undefined) {
  const message = String(error?.message || "").toLowerCase();
  return error?.code === "42P01" || error?.code === "42703" || error?.code === "PGRST205" || message.includes("inr_agent_settings") || message.includes("inr_agent_automation_settings");
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
  return ["weekly", "twice_weekly", "biweekly", "monthly", "quarterly", "one_off"].includes(text) ? text : "weekly";
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

function scheduledWeekdays(frequency: InrAgentFrequency, dayOfWeek: number) {
  if (frequency === "twice_weekly") return Array.from(new Set([dayOfWeek, (dayOfWeek + 3) % 7]));
  return [dayOfWeek];
}

function normalizeScheduleSlots(
  metadata: Record<string, unknown> | null | undefined,
  frequency: InrAgentFrequency,
  dayOfWeek: number,
  time: string,
): AutomationScheduleSlot[] {
  const fallback = [
    { dayOfWeek, time },
    { dayOfWeek: (dayOfWeek + 3) % 7, time },
  ];
  if (frequency !== "twice_weekly") return [fallback[0]];
  const rawSlots = Array.isArray(metadata?.scheduleSlots) ? metadata?.scheduleSlots : [];
  const slots = rawSlots
    .map((item) => {
      const source = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
      return {
        dayOfWeek: normalizeDay(source.dayOfWeek),
        time: normalizeTime(source.time),
      };
    })
    .filter((slot, index, list) => list.findIndex((candidate) => candidate.dayOfWeek === slot.dayOfWeek && candidate.time === slot.time) === index)
    .slice(0, 2);
  return slots.length >= 2 ? slots : fallback;
}

function isFirstScheduledWeekdayOfMonth(local: ReturnType<typeof getLocalParts>, dayOfWeek: number) {
  return local.weekday === dayOfWeek && local.day <= 7;
}

function isThirdScheduledWeekdayOfMonth(local: ReturnType<typeof getLocalParts>, dayOfWeek: number) {
  return local.weekday === dayOfWeek && local.day >= 15 && local.day <= 21;
}

function isScheduledDate(local: ReturnType<typeof getLocalParts>, frequency: InrAgentFrequency, dayOfWeek: number) {
  if (frequency === "twice_weekly") return scheduledWeekdays(frequency, dayOfWeek).includes(local.weekday);
  if (frequency === "biweekly") return isFirstScheduledWeekdayOfMonth(local, dayOfWeek) || isThirdScheduledWeekdayOfMonth(local, dayOfWeek);
  if (frequency === "monthly") return isFirstScheduledWeekdayOfMonth(local, dayOfWeek);
  if (frequency === "quarterly") return [1, 4, 7, 10].includes(local.month) && isFirstScheduledWeekdayOfMonth(local, dayOfWeek);
  return local.weekday === dayOfWeek;
}

function timeParts(time: string) {
  const [hourRaw, minuteRaw] = normalizeTime(time).split(":");
  return { hour: Number(hourRaw), minute: Number(minuteRaw) };
}

function computeNextRunAt(automation: InrAgentAutomationSettings, after: Date, timeZone: string) {
  const frequency = normalizeFrequency(automation.frequency);
  if (!automation.enabled || frequency === "one_off") return null;

  const start = getLocalParts(new Date(after.getTime() + 60 * 1000), timeZone);
  const dayOfWeek = normalizeDay(automation.dayOfWeek);
  const slots = normalizeScheduleSlots(automation.metadata, frequency, dayOfWeek, normalizeTime(automation.time || "09:00"));

  for (let offset = 0; offset <= 110; offset += 1) {
    const localDate = addLocalDays(start, offset);
    const candidates = slots
      .map((slot) => {
        const schedule = timeParts(slot.time);
        const candidateUtc = zonedTimeToUtc({ ...localDate, ...schedule }, timeZone);
        const candidateLocal = getLocalParts(candidateUtc, timeZone);
        if (!isScheduledDate(candidateLocal, frequency, slot.dayOfWeek)) return null;
        return candidateUtc;
      })
      .filter((candidate): candidate is Date => Boolean(candidate))
      .sort((a, b) => a.getTime() - b.getTime());

    for (const candidateUtc of candidates) {
      if (candidateUtc.getTime() <= after.getTime()) {
        const delay = after.getTime() - candidateUtc.getTime();
        if (offset === 0 && delay <= SETTINGS_SCHEDULE_GRACE_MS) {
          return new Date(after.getTime() - 60 * 1000).toISOString();
        }
        continue;
      }
      return candidateUtc.toISOString();
    }
  }

  return null;
}

function scheduleSignature(row: Pick<DbAgentAutomationSettingsRow, "enabled" | "frequency" | "day_of_week" | "time" | "metadata"> | null | undefined) {
  const frequency = normalizeFrequency(row?.frequency);
  const day = normalizeDay(row?.day_of_week);
  const time = normalizeTime(row?.time);
  return [
    row?.enabled ? "1" : "0",
    frequency,
    String(day),
    time,
    JSON.stringify(normalizeScheduleSlots(row?.metadata, frequency, day, time)),
  ].join("|");
}

function automationSignature(automation: InrAgentAutomationSettings) {
  const frequency = normalizeFrequency(automation.frequency);
  const day = normalizeDay(automation.dayOfWeek);
  const time = normalizeTime(automation.time);
  return [
    automation.enabled ? "1" : "0",
    frequency,
    String(day),
    time,
    JSON.stringify(normalizeScheduleSlots(automation.metadata, frequency, day, time)),
  ].join("|");
}


function shouldRecomputeNextRunAt(args: {
  existing: DbAgentAutomationSettingsRow | undefined;
  automation: InrAgentAutomationSettings;
  scheduleChanged: boolean;
}) {
  if (!args.automation.enabled) return false;
  if (args.scheduleChanged || !args.automation.nextRunAt) return true;

  const metadata = args.existing?.metadata && typeof args.existing.metadata === "object" && !Array.isArray(args.existing.metadata)
    ? args.existing.metadata
    : {};
  const lastStatus = typeof metadata.lastCronStatus === "string" ? metadata.lastCronStatus : "";
  const nextRetry = typeof metadata.lastCronNextRetryAt === "string" ? metadata.lastCronNextRetryAt : "";

  return lastStatus === "failed" && !nextRetry && !args.existing?.last_prepared_at;
}

function rowToAutomation(row: DbAgentAutomationSettingsRow | null | undefined): Partial<InrAgentAutomationSettings> {
  return {
    enabled: row?.enabled ?? undefined,
    frequency: row?.frequency as InrAgentAutomationSettings["frequency"],
    dayOfWeek: row?.day_of_week ?? undefined,
    time: row?.time ?? undefined,
    validationMode: row?.validation_mode as InrAgentAutomationSettings["validationMode"],
    allowedChannels: row?.allowed_channels as InrAgentAutomationSettings["allowedChannels"],
    allowedThemes: row?.allowed_themes as InrAgentAutomationSettings["allowedThemes"],
    useImageBank: row?.use_image_bank ?? undefined,
    imageRequired: row?.image_required ?? undefined,
    recipientScope: row?.recipient_scope as InrAgentAutomationSettings["recipientScope"],
    sourceStrategy: row?.source_strategy as InrAgentAutomationSettings["sourceStrategy"],
    lastPreparedAt: row?.last_prepared_at ?? null,
    lastExecutedAt: row?.last_executed_at ?? null,
    nextRunAt: row?.next_run_at ?? null,
    metadata: row?.metadata ?? {},
  };
}

function connectedInrAgentChannels(states: Awaited<ReturnType<typeof getChannelConnectionStates>>, inrSearchPublished = false): Set<InrAgentChannel> {
  const channels = new Set<InrAgentChannel>();
  if (states.site_inrcy.connected) channels.add("site_inrcy");
  if (states.site_web.connected) channels.add("site_web");
  if (inrSearchPublished) channels.add("inr_search");
  if (states.gmb.connected && !states.gmb.requiresUpdate) channels.add("gmb");
  if (states.facebook.connected && !states.facebook.requiresUpdate) channels.add("facebook");
  if (states.instagram.connected && !states.instagram.requiresUpdate) channels.add("instagram");
  if (states.linkedin.connected && !states.linkedin.requiresUpdate) channels.add("linkedin");
  if (states.tiktok.connected && !states.tiktok.requiresUpdate) channels.add("tiktok");
  if (states.youtube_shorts.connected && !states.youtube_shorts.requiresUpdate) channels.add("youtube");
  if (states.pinterest.connected && !states.pinterest.requiresUpdate) channels.add("pinterest");
  if (states.mails.connected && !states.mails.requiresUpdate) channels.add("mails");
  return channels;
}

function filterSettingsByConnectedChannels(
  settings: InrAgentSettings,
  connectedChannels: Set<InrAgentChannel>,
  options: { hydrateMissingPublishDefaults?: boolean } = {},
): InrAgentSettings {
  const { hydrateMissingPublishDefaults = true } = options;
  const automations = { ...settings.automations };

  for (const key of ["publish", "grow", "loyalty"] as const) {
    const automation = automations[key];
    let allowedChannels = automation.allowedChannels.filter((channel) =>
      connectedChannels.has(channel),
    );
    let metadata = automation.metadata || {};

    if (
      key === "publish" &&
      connectedChannels.has("pinterest") &&
      !allowedChannels.includes("pinterest")
    ) {
      const pinterestAlreadyCustomized =
        metadata[INR_AGENT_PINTEREST_PUBLISH_MIGRATION_FLAG] === true;
      if (hydrateMissingPublishDefaults && !pinterestAlreadyCustomized) {
        allowedChannels = [...allowedChannels, "pinterest"];
        metadata = {
          ...metadata,
          [INR_AGENT_PINTEREST_PUBLISH_MIGRATION_FLAG]: true,
        };
      } else if (!hydrateMissingPublishDefaults) {
        metadata = {
          ...metadata,
          [INR_AGENT_PINTEREST_PUBLISH_MIGRATION_FLAG]: true,
        };
      }
    }

    automations[key] = {
      ...automation,
      allowedChannels,
      metadata,
      enabled: allowedChannels.length > 0 ? automation.enabled : false,
      nextRunAt: allowedChannels.length > 0 ? automation.nextRunAt : null,
    };
  }

  const globalEnabled = Object.values(automations).some(
    (automation) => automation.enabled,
  );

  return sanitizeInrAgentSettings({
    ...settings,
    globalEnabled,
    enabled: globalEnabled,
    automations,
    allowedChannels: automations.publish.allowedChannels,
  });
}

async function applyConnectedChannelFilter(
  settings: InrAgentSettings,
  userId: string,
  options: { hydrateMissingPublishDefaults?: boolean } = {},
) {
  const [states, provisioned] = await Promise.all([
    getChannelConnectionStates(supabaseAdmin, userId),
    ensureSystemManagedInrSearch(supabaseAdmin as any, userId),
  ]);
  const inrSearchStatus = await getInrSearchPublicStatus(provisioned.inrSearch.slug);
  return filterSettingsByConnectedChannels(
    settings,
    connectedInrAgentChannels(states, inrSearchStatus.published),
    options,
  );
}

function rowsToSettings(globalRow: DbAgentGlobalSettingsRow | null | undefined, automationRows: DbAgentAutomationSettingsRow[]): InrAgentSettings {
  const automations = Object.fromEntries(
    INR_AGENT_AUTOMATION_KEYS.map((key) => {
      const row = automationRows.find((item) => item.automation_key === key);
      return [key, sanitizeInrAgentAutomationSettings(key, rowToAutomation(row))];
    }),
  ) as InrAgentSettings["automations"];

  return sanitizeInrAgentSettings({
    globalEnabled: globalRow?.global_enabled ?? undefined,
    tone: globalRow?.tone as InrAgentSettings["tone"],
    timezone: globalRow?.timezone ?? undefined,
    automations,
  });
}

async function getAgentSettingsHandler() {
  const { user, errorResponse, authUserId, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;
  const standardMode =
    (await getDashboardEditionForAuthUser(authUserId)) === "standard";

  const { data: globalData, error: globalError } = await supabaseAdmin
    .from("inr_agent_settings")
    .select(GLOBAL_SELECT)
    .eq("user_id", activeUserId)
    .maybeSingle();

  if (globalError) {
    if (isMissingSchemaError(globalError)) {
      const fallback = sanitizeInrAgentSettings(null);
      return NextResponse.json({
        settings: standardMode
          ? restrictInrAgentSettingsForStandard(fallback)
          : fallback,
        tableMissing: true,
      });
    }
    console.warn("[inr-agent-settings] global read failed", globalError);
    return NextResponse.json({ error: "Lecture de la configuration globale iNr'Agent impossible" }, { status: 500 });
  }

  const { data: automationData, error: automationError } = await supabaseAdmin
    .from("inr_agent_automation_settings")
    .select(AUTOMATION_SELECT)
    .eq("user_id", activeUserId);

  if (automationError) {
    if (isMissingSchemaError(automationError)) {
      const fallback = sanitizeInrAgentSettings(null);
      return NextResponse.json({
        settings: standardMode
          ? restrictInrAgentSettingsForStandard(fallback)
          : fallback,
        tableMissing: true,
      });
    }
    console.warn("[inr-agent-settings] automations read failed", automationError);
    return NextResponse.json({ error: "Lecture des automatisations iNr'Agent impossible" }, { status: 500 });
  }

  const settings = rowsToSettings(
    globalData as DbAgentGlobalSettingsRow | null,
    Array.isArray(automationData)
      ? (automationData as DbAgentAutomationSettingsRow[])
      : [],
  );

  const connectedSettings = await applyConnectedChannelFilter(
    settings,
    activeUserId,
  );
  return NextResponse.json({
    settings: standardMode
      ? restrictInrAgentSettingsForStandard(connectedSettings)
      : connectedSettings,
    tableMissing: false,
  });
}

async function saveAgentSettingsHandler(request: Request) {
  const { user, errorResponse, authUserId, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;
  const standardMode =
    (await getDashboardEditionForAuthUser(authUserId)) === "standard";

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }

  let settings = await applyConnectedChannelFilter(
    sanitizeInrAgentSettings(
      (body as { settings?: Partial<InrAgentSettings> } | null)?.settings,
    ),
    activeUserId,
    { hydrateMissingPublishDefaults: false },
  );
  if (standardMode) {
    settings = restrictInrAgentSettingsForStandard(settings);
  }
  const now = new Date().toISOString();

  const globalPayload = {
    user_id: activeUserId,
    global_enabled: settings.globalEnabled,
    tone: settings.tone,
    timezone: settings.timezone,
    metadata: {
      version: 2,
      legacy: {
        goal: settings.goal,
        allowedActions: settings.allowedActions,
        allowAiImages: settings.allowAiImages,
      },
    },
    updated_at: now,
  };

  const { error: globalError } = await supabaseAdmin
    .from("inr_agent_settings")
    .upsert(globalPayload, { onConflict: "user_id" });

  if (globalError) {
    if (isMissingSchemaError(globalError)) {
      return NextResponse.json({ error: "Les tables iNr'Agent V2 doivent être créées dans Supabase avant d'enregistrer.", tableMissing: true }, { status: 500 });
    }
    console.warn("[inr-agent-settings] global save failed", globalError);
    return NextResponse.json({ error: "Enregistrement de la configuration globale iNr'Agent impossible" }, { status: 500 });
  }

  const { data: existingAutomationData, error: existingAutomationError } = await supabaseAdmin
    .from("inr_agent_automation_settings")
    .select(AUTOMATION_SELECT)
    .eq("user_id", activeUserId);

  if (existingAutomationError && !isMissingSchemaError(existingAutomationError)) {
    console.warn("[inr-agent-settings] existing automations read failed", existingAutomationError);
  }

  const existingRows = Array.isArray(existingAutomationData)
    ? (existingAutomationData as DbAgentAutomationSettingsRow[])
    : [];
  const existingByKey = new Map(existingRows.map((row) => [row.automation_key, row]));
  const nowDate = new Date(now);

  const persistedAutomationKeys = standardAgentAutomationKeysForPersistence(
    standardMode,
  );
  const automationPayloads = persistedAutomationKeys.map((key: InrAgentAutomationKey) => {
    const automation = settings.automations[key];
    const existing = existingByKey.get(key);
    const row = automationSettingsToDbRow(activeUserId, key, automation);
    const scheduleChanged = scheduleSignature(existing) !== automationSignature(automation);
    const recomputeNextRun = shouldRecomputeNextRunAt({ existing, automation, scheduleChanged });
    const nextRunAt = recomputeNextRun
      ? computeNextRunAt(automation, nowDate, settings.timezone || "Europe/Paris")
      : automation.nextRunAt;

    return {
      ...row,
      next_run_at: automation.enabled ? nextRunAt : null,
      metadata: {
        ...row.metadata,
        lastSettingsSavedAt: now,
        lastSettingsRecomputedNextRunAt: recomputeNextRun,
      },
    };
  });

  const savedSettings = sanitizeInrAgentSettings({
    ...settings,
    automations: {
      ...settings.automations,
      ...Object.fromEntries(
        automationPayloads.map((payload) => [
          payload.automation_key,
          {
            ...settings.automations[payload.automation_key],
            nextRunAt: payload.next_run_at,
            metadata: payload.metadata,
          },
        ]),
      ),
    } as InrAgentSettings["automations"],
  });

  const { error: automationError } = await supabaseAdmin
    .from("inr_agent_automation_settings")
    .upsert(automationPayloads, { onConflict: "user_id,automation_key" });

  if (automationError) {
    if (isMissingSchemaError(automationError)) {
      return NextResponse.json({ error: "La table inr_agent_automation_settings doit être créée dans Supabase avant d'enregistrer.", tableMissing: true }, { status: 500 });
    }
    console.warn("[inr-agent-settings] automations save failed", automationError);
    return NextResponse.json({ error: "Enregistrement des automatisations iNr'Agent impossible" }, { status: 500 });
  }

  return NextResponse.json({
    settings: standardMode
      ? restrictInrAgentSettingsForStandard(savedSettings)
      : savedSettings,
    saved: true,
    tableMissing: false,
  });
}

export const GET = withApi(async (_req: Request) => getAgentSettingsHandler(), { route: "/api/agent/settings" });
export const POST = withApi(saveAgentSettingsHandler, { route: "/api/agent/settings" });
