export const VISIO_BOOKING_TIMEZONE = "Europe/Paris";
export const VISIO_BOOKING_DURATION_MINUTES = 60;
export const VISIO_BOOKING_SPACING_MINUTES = 120;
export const VISIO_BOOKING_MAX_CONCURRENT = 2;
export const VISIO_BOOKING_START_HOURS = [9, 11, 14, 16, 18] as const;

export type LocalDateParts = {
  year: number;
  month: number;
  day: number;
};

export type BusyPeriod = { start: string; end: string };

export type VisioTeamMember = {
  id: string;
  name: string;
  calendarId: string;
  email: string;
  colorId?: string;
};

export function getLocalDateTimeParts(
  date: Date,
  timeZone = VISIO_BOOKING_TIMEZONE,
) {
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
    weekday: weekdayMap[map.weekday] ?? 0,
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = getLocalDateTimeParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - date.getTime();
}

export function zonedDateTimeToUtc(
  parts: LocalDateParts & { hour: number; minute?: number },
  timeZone = VISIO_BOOKING_TIMEZONE,
) {
  const minute = parts.minute ?? 0;
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, minute, 0);
  let utc = target;
  for (let index = 0; index < 3; index += 1) {
    utc = target - getTimeZoneOffsetMs(new Date(utc), timeZone);
  }
  return new Date(utc);
}

export function parseLocalDateTime(
  value: unknown,
  timeZone = VISIO_BOOKING_TIMEZONE,
) {
  const match = String(value || "").trim().match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/,
  );
  if (!match) return null;

  const [, yearValue, monthValue, dayValue, hourValue, minuteValue] = match;
  const expected = {
    year: Number(yearValue),
    month: Number(monthValue),
    day: Number(dayValue),
    hour: Number(hourValue),
    minute: Number(minuteValue),
  };
  if (
    expected.year < 2020 ||
    expected.year > 2100 ||
    expected.month < 1 ||
    expected.month > 12 ||
    expected.day < 1 ||
    expected.day > 31 ||
    expected.hour < 0 ||
    expected.hour > 23 ||
    expected.minute < 0 ||
    expected.minute > 59
  ) {
    return null;
  }

  const date = zonedDateTimeToUtc(expected, timeZone);
  if (!Number.isFinite(date.getTime())) return null;
  const actual = getLocalDateTimeParts(date, timeZone);
  return actual.year === expected.year &&
    actual.month === expected.month &&
    actual.day === expected.day &&
    actual.hour === expected.hour &&
    actual.minute === expected.minute
    ? date
    : null;
}

export function addLocalDays(base: LocalDateParts, days: number): LocalDateParts {
  const date = new Date(Date.UTC(base.year, base.month - 1, base.day + days, 12));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

export function localDateKey(parts: LocalDateParts) {
  return [parts.year, String(parts.month).padStart(2, "0"), String(parts.day).padStart(2, "0")].join("-");
}

export function periodsOverlap(
  leftStart: Date,
  leftEnd: Date,
  right: BusyPeriod,
) {
  const rightStart = new Date(right.start).getTime();
  const rightEnd = new Date(right.end).getTime();
  return Number.isFinite(rightStart) && Number.isFinite(rightEnd)
    ? leftStart.getTime() < rightEnd && leftEnd.getTime() > rightStart
    : true;
}

export function isMemberFree(
  member: VisioTeamMember,
  busyByCalendar: Record<string, BusyPeriod[]>,
  start: Date,
  spacingMinutes = VISIO_BOOKING_SPACING_MINUTES,
) {
  const end = new Date(start.getTime() + spacingMinutes * 60_000);
  const periods = busyByCalendar[member.calendarId] || [];
  return periods.every((period) => !periodsOverlap(start, end, period));
}

export function chooseBalancedMember(input: {
  members: VisioTeamMember[];
  busyByCalendar: Record<string, BusyPeriod[]>;
  bookingCountByMember: Record<string, number>;
  start: Date;
}) {
  return input.members
    .filter((member) => isMemberFree(member, input.busyByCalendar, input.start))
    .sort((left, right) => {
      const loadDelta =
        (input.bookingCountByMember[left.id] || 0) -
        (input.bookingCountByMember[right.id] || 0);
      return loadDelta || left.id.localeCompare(right.id, "fr");
    })[0] || null;
}

export function isAllowedVisioStart(input: {
  start: Date;
  now: Date;
  horizonDays: number;
  minimumLeadDays: number;
}) {
  if (!Number.isFinite(input.start.getTime())) return false;
  const local = getLocalDateTimeParts(input.start);
  if (
    !VISIO_BOOKING_START_HOURS.includes(local.hour as (typeof VISIO_BOOKING_START_HOURS)[number]) ||
    local.minute !== 0 ||
    local.weekday === 0
  ) {
    return false;
  }
  const earliestLocalDate = localDateKey(
    addLocalDays(getLocalDateTimeParts(input.now), input.minimumLeadDays),
  );
  const latest = input.now.getTime() + input.horizonDays * 24 * 60 * 60_000;
  return localDateKey(local) >= earliestLocalDate && input.start.getTime() <= latest;
}
