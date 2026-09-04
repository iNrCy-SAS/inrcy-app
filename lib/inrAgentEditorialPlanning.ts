import {
  type InrAgentAutomationSettings,
  type InrAgentChannel,
  type InrAgentFrequency,
  type InrAgentTheme,
  type InrAgentTone,
} from "@/lib/inrAgentSettings";
import {
  inrAgentMonthlyDateCount,
  isInrAgentScheduledMonthDay,
  normalizeInrAgentMonthDays,
} from "@/lib/inrAgentMonthSchedule";

export const INR_AGENT_EDITORIAL_HORIZON_DAYS = 15;
export const INR_AGENT_EDITORIAL_PLAN_VERSION = 1;

export type InrAgentEditorialMediaKind = "image" | "video" | "existing";

export type InrAgentEditorialSlot = {
  slotKey: string;
  scheduledFor: string;
  sequence: number;
  totalSlots: number;
  theme: InrAgentTheme;
  tone: InrAgentTone;
  mediaKind: InrAgentEditorialMediaKind;
  imageCount: 0 | 1 | 2;
  channels: InrAgentChannel[];
  scheduleSignature: string;
  criteriaSignature: string;
};

type ScheduleSlot = { dayOfWeek: number; time: string };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeTime(value: unknown) {
  const text = String(value || "09:00").trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : "09:00";
}

function normalizeDay(value: unknown) {
  const day = Math.round(Number(value));
  return Number.isFinite(day) && day >= 0 && day <= 6 ? day : 1;
}

function getLocalParts(date: Date, timeZone: string) {
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
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
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
  return (
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    ) - date.getTime()
  );
}

function zonedTimeToUtc(
  parts: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
  },
  timeZone: string,
) {
  let utc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    0,
  );
  for (let index = 0; index < 3; index += 1) {
    utc =
      Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        0,
      ) - getTimeZoneOffsetMs(new Date(utc), timeZone);
  }
  return new Date(utc);
}

function addLocalDays(base: ReturnType<typeof getLocalParts>, days: number) {
  const date = new Date(
    Date.UTC(base.year, base.month - 1, base.day + days, 12, 0, 0),
  );
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function frequencyValue(value: unknown): InrAgentFrequency {
  const normalized = String(value || "weekly") as InrAgentFrequency;
  return [
    "weekly",
    "twice_weekly",
    "three_times_weekly",
    "biweekly",
    "three_times_monthly",
    "monthly",
    "quarterly",
    "one_off",
  ].includes(normalized)
    ? normalized
    : "weekly";
}

function toneValue(value: unknown): InrAgentTone {
  const normalized = String(value || "professional") as InrAgentTone;
  return ["professional", "friendly", "premium", "local", "dynamic"].includes(
    normalized,
  )
    ? normalized
    : "professional";
}

function normalizeScheduleSlots(
  automation: InrAgentAutomationSettings,
): ScheduleSlot[] {
  const frequency = frequencyValue(automation.frequency);
  const slotCount =
    frequency === "three_times_weekly"
      ? 3
      : frequency === "twice_weekly"
        ? 2
        : 1;
  const baseDay = normalizeDay(automation.dayOfWeek);
  const baseTime = normalizeTime(automation.time);
  const offsets = slotCount === 3 ? [0, 2, 4] : slotCount === 2 ? [0, 3] : [0];
  const fallback = offsets.map((offset) => ({
    dayOfWeek: (baseDay + offset) % 7,
    time: baseTime,
  }));
  if (slotCount === 1) return fallback;

  const metadata = asRecord(automation.metadata);
  const raw = Array.isArray(metadata.scheduleSlots)
    ? metadata.scheduleSlots
    : [];
  const configured = raw
    .map((item) => {
      const record = asRecord(item);
      return {
        dayOfWeek: normalizeDay(record.dayOfWeek),
        time: normalizeTime(record.time),
      };
    })
    .filter(
      (slot, index, list) =>
        list.findIndex(
          (candidate) =>
            candidate.dayOfWeek === slot.dayOfWeek &&
            candidate.time === slot.time,
        ) === index,
    )
    .slice(0, slotCount);
  return configured.length === slotCount ? configured : fallback;
}

function scheduledOnLocalDate(args: {
  frequency: InrAgentFrequency;
  local: ReturnType<typeof getLocalParts>;
  slot: ScheduleSlot;
  monthDays: number[];
}) {
  if (inrAgentMonthlyDateCount(args.frequency)) {
    return isInrAgentScheduledMonthDay(args.local, args.monthDays);
  }
  if (args.frequency === "quarterly") {
    return (
      [1, 4, 7, 10].includes(args.local.month) &&
      args.local.weekday === args.slot.dayOfWeek &&
      args.local.day <= 7
    );
  }
  return args.local.weekday === args.slot.dayOfWeek;
}

function stableScore(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function signature(parts: unknown[]) {
  return parts.map((part) => JSON.stringify(part)).join("|");
}

function plannedTheme(
  themes: InrAgentTheme[],
  planSeed: string,
  sequence: number,
) {
  const usable = themes.length
    ? themes
    : (["conseils", "realisations", "offres", "actualites"] as InrAgentTheme[]);
  const startingIndex = stableScore(`${planSeed}:themes`) % usable.length;
  // Rotation équilibrée : tous les thèmes choisis passent une fois avant qu'un
  // thème ne soit réutilisé, tout en gardant un point de départ stable par plan.
  return usable[(startingIndex + sequence) % usable.length];
}

function plannedImageCount(theme: InrAgentTheme, slotKey: string): 1 | 2 {
  if (["realisations", "coulisses", "temoignages"].includes(theme)) return 2;
  if (theme === "offres" && stableScore(`${slotKey}:carousel`) % 2 === 0)
    return 2;
  return 1;
}

function videoSlotKeys(slotKeys: string[]) {
  // Sur un vrai mois éditorial, on garde au moins une vidéo dès quatre
  // publications, puis environ 20 % du volume total.
  const videoCount =
    slotKeys.length >= 4 ? Math.max(1, Math.round(slotKeys.length * 0.2)) : 0;
  return new Set(
    [...slotKeys]
      .sort(
        (left, right) =>
          stableScore(`${left}:video`) - stableScore(`${right}:video`),
      )
      .slice(0, videoCount),
  );
}

export function getInrAgentEditorialPlanSignatures(args: {
  automation: InrAgentAutomationSettings;
  timezone: string;
  tone?: InrAgentTone | string;
}) {
  const frequency = frequencyValue(args.automation.frequency);
  const timezone = args.timezone || "Europe/Paris";
  const scheduleSlots = normalizeScheduleSlots(args.automation);
  const monthDays = normalizeInrAgentMonthDays(
    asRecord(args.automation.metadata).monthDays,
    frequency,
  );
  return {
    scheduleSignature: signature([
      args.automation.enabled,
      frequency,
      scheduleSlots,
      monthDays,
      timezone,
    ]),
    criteriaSignature: signature([
      args.automation.allowedChannels,
      args.automation.allowedThemes,
      args.automation.preferredMediaSource,
      args.automation.useImageBank,
      args.automation.imageRequired,
      toneValue(args.tone),
    ]),
  };
}

export function buildInrAgentEditorialPlan(args: {
  automation: InrAgentAutomationSettings;
  timezone: string;
  tone?: InrAgentTone | string;
  now?: Date;
  horizonDays?: number;
}): InrAgentEditorialSlot[] {
  const now = args.now ?? new Date();
  const automation = args.automation;
  if (!automation.enabled) return [];

  const frequency = frequencyValue(automation.frequency);
  if (frequency === "one_off" && automation.lastPreparedAt) return [];

  const timezone = args.timezone || "Europe/Paris";
  const horizonDays = Math.min(
    30,
    Math.max(
      7,
      Math.round(
        args.horizonDays ??
          automation.planningHorizonDays ??
          INR_AGENT_EDITORIAL_HORIZON_DAYS,
      ),
    ),
  );
  const horizonEnd = now.getTime() + horizonDays * 86_400_000;
  const localStart = getLocalParts(now, timezone);
  const scheduleSlots = normalizeScheduleSlots(automation);
  const monthDays = normalizeInrAgentMonthDays(
    asRecord(automation.metadata).monthDays,
    frequency,
  );
  const occurrences: string[] = [];

  for (let offset = 0; offset <= horizonDays + 2; offset += 1) {
    const localDate = addLocalDays(localStart, offset);
    for (const slot of scheduleSlots) {
      const [hour, minute] = slot.time.split(":").map(Number);
      const candidate = zonedTimeToUtc(
        { ...localDate, hour, minute },
        timezone,
      );
      const local = getLocalParts(candidate, timezone);
      if (
        candidate.getTime() <= now.getTime() ||
        candidate.getTime() > horizonEnd ||
        !scheduledOnLocalDate({ frequency, local, slot, monthDays })
      ) {
        continue;
      }
      occurrences.push(candidate.toISOString());
      if (frequency === "one_off") break;
    }
    if (frequency === "one_off" && occurrences.length) break;
  }

  const uniqueOccurrences = Array.from(new Set(occurrences)).sort();
  const { scheduleSignature, criteriaSignature } =
    getInrAgentEditorialPlanSignatures({
      automation,
      timezone,
      tone: args.tone,
    });
  const slotKeys = uniqueOccurrences.map(
    (scheduledFor) => `publish:${scheduledFor}`,
  );
  const plannedVideos = videoSlotKeys(slotKeys);
  const aiGeneration = automation.preferredMediaSource === "ai_generation";
  const baseChannels = Array.from(new Set(automation.allowedChannels));
  const onlyYoutube =
    baseChannels.length === 1 && baseChannels.includes("youtube");
  const tone = toneValue(args.tone);
  const planSeed = `${scheduleSignature}:${criteriaSignature}`;

  return uniqueOccurrences.map((scheduledFor, index) => {
    const slotKey = slotKeys[index];
    const theme = plannedTheme(automation.allowedThemes, planSeed, index);
    let mediaKind: InrAgentEditorialMediaKind = "existing";
    let channels = [...baseChannels];

    if (aiGeneration) {
      mediaKind =
        onlyYoutube || plannedVideos.has(slotKey) ? "video" : "image";
      if (mediaKind === "image") {
        channels = channels.filter((channel) => channel !== "youtube");
        if (!channels.length) {
          channels = [...baseChannels];
          mediaKind = "video";
        }
      }
    }

    return {
      slotKey,
      scheduledFor,
      sequence: index + 1,
      totalSlots: uniqueOccurrences.length,
      theme,
      tone,
      mediaKind,
      imageCount: mediaKind === "image" ? plannedImageCount(theme, slotKey) : 0,
      channels,
      scheduleSignature,
      criteriaSignature,
    };
  });
}
