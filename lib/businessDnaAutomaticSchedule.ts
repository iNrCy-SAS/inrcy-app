export const BUSINESS_DNA_AUTOMATIC_DEFAULT_DAY = 5;
export const BUSINESS_DNA_AUTOMATIC_DEFAULT_TIME = "07:00";
export const BUSINESS_DNA_AUTOMATIC_DEFAULT_TIMEZONE = "Europe/Paris";
export const BUSINESS_DNA_MANUAL_MONTHLY_LIMIT = 3;

export type BusinessDnaAutomaticScheduleStatus =
  | "never"
  | "running"
  | "success"
  | "failed"
  | "skipped_no_source";

export type BusinessDnaAutomaticSchedule = {
  enabled: boolean;
  dayOfMonth: number;
  time: string;
  timezone: string;
  nextRunAt: string | null;
  lastProcessedPeriod: string | null;
  lastStatus: BusinessDnaAutomaticScheduleStatus;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
};

export type BusinessDnaAutomaticOccurrence = {
  periodStart: string;
  runAt: string;
};

type LocalDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function getLocalParts(date: Date, timeZone: string): LocalDateTimeParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function timezoneOffsetMs(date: Date, timeZone: string) {
  const parts = getLocalParts(date, timeZone);
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  ) - date.getTime();
}

function zonedTimeToUtc(
  parts: Pick<LocalDateTimeParts, "year" | "month" | "day" | "hour" | "minute">,
  timeZone: string,
) {
  const requestedUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    0,
  );
  let utc = requestedUtc;
  for (let index = 0; index < 3; index += 1) {
    utc = requestedUtc - timezoneOffsetMs(new Date(utc), timeZone);
  }
  return new Date(utc);
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function periodStart(year: number, month: number) {
  return `${year}-${pad(month)}-01`;
}

function comparePeriod(left: string | null | undefined, right: string) {
  if (!left) return -1;
  return left.localeCompare(right);
}

export function isValidBusinessDnaScheduleTimezone(value: string) {
  const timezone = String(value || "").trim();
  if (!timezone || timezone.length > 100) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function normalizeBusinessDnaScheduleTimezone(value: unknown) {
  const timezone = String(value || "").trim();
  return isValidBusinessDnaScheduleTimezone(timezone)
    ? timezone
    : BUSINESS_DNA_AUTOMATIC_DEFAULT_TIMEZONE;
}

export function normalizeBusinessDnaScheduleDay(value: unknown) {
  const day = Number(value);
  return Number.isInteger(day) && day >= 1 && day <= 28
    ? day
    : BUSINESS_DNA_AUTOMATIC_DEFAULT_DAY;
}

export function normalizeBusinessDnaScheduleTime(value: unknown) {
  const time = String(value || "").trim().slice(0, 5);
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)
    ? time
    : BUSINESS_DNA_AUTOMATIC_DEFAULT_TIME;
}

export function computeNextBusinessDnaAutomaticOccurrence(args: {
  dayOfMonth: number;
  time: string;
  timezone: string;
  now?: Date;
  lastProcessedPeriod?: string | null;
}): BusinessDnaAutomaticOccurrence {
  const now = args.now ?? new Date();
  const timezone = normalizeBusinessDnaScheduleTimezone(args.timezone);
  const dayOfMonth = normalizeBusinessDnaScheduleDay(args.dayOfMonth);
  const [hour, minute] = normalizeBusinessDnaScheduleTime(args.time)
    .split(":")
    .map(Number);
  const localNow = getLocalParts(now, timezone);

  for (let monthOffset = 0; monthOffset < 24; monthOffset += 1) {
    const monthIndex = localNow.month - 1 + monthOffset;
    const year = localNow.year + Math.floor(monthIndex / 12);
    const month = ((monthIndex % 12) + 12) % 12 + 1;
    const candidatePeriod = periodStart(year, month);
    if (comparePeriod(args.lastProcessedPeriod, candidatePeriod) >= 0) continue;

    const runAt = zonedTimeToUtc(
      { year, month, day: dayOfMonth, hour, minute },
      timezone,
    );
    if (runAt.getTime() <= now.getTime()) continue;
    return { periodStart: candidatePeriod, runAt: runAt.toISOString() };
  }

  throw new Error("Impossible de calculer la prochaine analyse ADN automatique.");
}

export function defaultBusinessDnaAutomaticSchedule(
  timezone = BUSINESS_DNA_AUTOMATIC_DEFAULT_TIMEZONE,
): BusinessDnaAutomaticSchedule {
  return {
    enabled: false,
    dayOfMonth: BUSINESS_DNA_AUTOMATIC_DEFAULT_DAY,
    time: BUSINESS_DNA_AUTOMATIC_DEFAULT_TIME,
    timezone: normalizeBusinessDnaScheduleTimezone(timezone),
    nextRunAt: null,
    lastProcessedPeriod: null,
    lastStatus: "never",
    lastRunAt: null,
    lastSuccessAt: null,
  };
}

export function normalizeBusinessDnaAutomaticScheduleRow(
  value: unknown,
  fallbackTimezone = BUSINESS_DNA_AUTOMATIC_DEFAULT_TIMEZONE,
): BusinessDnaAutomaticSchedule {
  const row = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const allowedStatuses = new Set<BusinessDnaAutomaticScheduleStatus>([
    "never",
    "running",
    "success",
    "failed",
    "skipped_no_source",
  ]);
  const status = String(row.last_status || "never") as BusinessDnaAutomaticScheduleStatus;
  return {
    enabled: row.enabled === true,
    dayOfMonth: normalizeBusinessDnaScheduleDay(row.day_of_month),
    time: normalizeBusinessDnaScheduleTime(row.run_time),
    timezone: normalizeBusinessDnaScheduleTimezone(row.timezone || fallbackTimezone),
    nextRunAt: typeof row.next_run_at === "string" && row.next_run_at
      ? row.next_run_at
      : null,
    lastProcessedPeriod: typeof row.last_run_period === "string" && row.last_run_period
      ? row.last_run_period
      : null,
    lastStatus: allowedStatuses.has(status) ? status : "never",
    lastRunAt: typeof row.last_run_at === "string" && row.last_run_at
      ? row.last_run_at
      : null,
    lastSuccessAt: typeof row.last_success_at === "string" && row.last_success_at
      ? row.last_success_at
      : null,
  };
}
