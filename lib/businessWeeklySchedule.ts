export const BUSINESS_WEEK_DAY_KEYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type BusinessWeekDayKey = (typeof BUSINESS_WEEK_DAY_KEYS)[number];

export type BusinessScheduleSlot = {
  start: string;
  end: string;
};

export type BusinessScheduleDay = {
  open: boolean;
  allDay: boolean;
  slots: BusinessScheduleSlot[];
};

export type BusinessWeeklySchedule = {
  version: 1;
  days: Record<BusinessWeekDayKey, BusinessScheduleDay>;
  notes: string;
};

const ENCODED_PREFIX = "inrcy-weekly-v1:";
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const RANGE_PATTERN = /(\d{1,2})(?:\s*(?:h|:)\s*(\d{0,2}))?\s*(?:-|–|—|à|a)\s*(\d{1,2})(?:\s*(?:h|:)\s*(\d{0,2}))?/gi;

const DAY_DEFINITIONS: Array<{
  key: BusinessWeekDayKey;
  fr: string;
  aliases: string[];
}> = [
  { key: "monday", fr: "Lundi", aliases: ["lundi", "lun", "monday", "mon", "montag", "lunes", "lunedi", "maandag", "segunda"] },
  { key: "tuesday", fr: "Mardi", aliases: ["mardi", "mar", "tuesday", "tue", "dienstag", "martes", "martedi", "dinsdag", "terca"] },
  { key: "wednesday", fr: "Mercredi", aliases: ["mercredi", "mer", "wednesday", "wed", "mittwoch", "miercoles", "mercoledi", "woensdag", "quarta"] },
  { key: "thursday", fr: "Jeudi", aliases: ["jeudi", "jeu", "thursday", "thu", "donnerstag", "jueves", "giovedi", "donderdag", "quinta"] },
  { key: "friday", fr: "Vendredi", aliases: ["vendredi", "ven", "friday", "fri", "freitag", "viernes", "venerdi", "vrijdag", "sexta"] },
  { key: "saturday", fr: "Samedi", aliases: ["samedi", "sam", "saturday", "sat", "samstag", "sabado", "sabato", "zaterdag"] },
  { key: "sunday", fr: "Dimanche", aliases: ["dimanche", "dim", "sunday", "sun", "sonntag", "domingo", "domenica", "zondag"] },
];

function emptyDay(): BusinessScheduleDay {
  return { open: false, allDay: false, slots: [] };
}

export function createEmptyBusinessWeeklySchedule(): BusinessWeeklySchedule {
  return {
    version: 1,
    days: Object.fromEntries(BUSINESS_WEEK_DAY_KEYS.map((key) => [key, emptyDay()])) as Record<BusinessWeekDayKey, BusinessScheduleDay>,
    notes: "",
  };
}

export const EMPTY_BUSINESS_WEEKLY_SCHEDULE = createEmptyBusinessWeeklySchedule();

function cleanText(value: unknown, maxLength = 500) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, maxLength);
}

function normalizeTime(value: unknown) {
  const raw = cleanText(value, 5).replace("h", ":");
  const match = raw.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function normalizeBusinessWeeklySchedule(value: unknown): BusinessWeeklySchedule {
  let sourceValue = value;
  if (typeof sourceValue === "string" && isEncodedBusinessWeeklySchedule(sourceValue)) {
    try {
      sourceValue = JSON.parse(sourceValue.slice(ENCODED_PREFIX.length));
    } catch {
      sourceValue = {};
    }
  }

  const source = asRecord(sourceValue);
  const sourceDays = asRecord(source.days || source);
  const normalized = createEmptyBusinessWeeklySchedule();

  for (const key of BUSINESS_WEEK_DAY_KEYS) {
    const rawDay = asRecord(sourceDays[key]);
    const rawSlots = Array.isArray(rawDay.slots) ? rawDay.slots : [];
    const slots = rawSlots
      .map((slot) => {
        const item = asRecord(slot);
        const start = normalizeTime(item.start);
        const end = normalizeTime(item.end);
        return start && end && start !== end ? { start, end } : null;
      })
      .filter((slot): slot is BusinessScheduleSlot => Boolean(slot))
      .slice(0, 2);
    const allDay = rawDay.allDay === true || rawDay.all_day === true;
    const open = rawDay.open === true || allDay || slots.length > 0;
    normalized.days[key] = {
      open,
      allDay: open && allDay,
      slots: open && !allDay ? slots : [],
    };
  }

  normalized.notes = cleanText(source.notes, 500);
  return normalized;
}

export function isEncodedBusinessWeeklySchedule(value: unknown) {
  return String(value ?? "").trim().startsWith(ENCODED_PREFIX);
}

export function encodeBusinessWeeklySchedule(value: unknown) {
  return `${ENCODED_PREFIX}${JSON.stringify(normalizeBusinessWeeklySchedule(value))}`;
}

function stripAccents(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
}

function findDayIndexes(segment: string) {
  const normalized = stripAccents(segment);
  const matches: Array<{ index: number; dayIndex: number }> = [];
  DAY_DEFINITIONS.forEach((day, dayIndex) => {
    for (const alias of day.aliases) {
      const match = normalized.match(new RegExp(`\\b${stripAccents(alias)}\\b`));
      if (match?.index != null) matches.push({ index: match.index, dayIndex });
    }
  });
  matches.sort((a, b) => a.index - b.index);
  const unique = matches.filter((item, index) => !matches.slice(0, index).some((previous) => previous.dayIndex === item.dayIndex));
  if (unique.length >= 2) {
    const first = unique[0];
    const second = unique[1];
    const between = normalized.slice(first.index, second.index);
    if (/(?:-|–|—|\bau\b|\bto\b|\bbis\b|\ba\b)/.test(between) && first.dayIndex <= second.dayIndex) {
      return BUSINESS_WEEK_DAY_KEYS.slice(first.dayIndex, second.dayIndex + 1);
    }
  }
  return unique.map((item) => BUSINESS_WEEK_DAY_KEYS[item.dayIndex]);
}

function extractRanges(segment: string) {
  const ranges: BusinessScheduleSlot[] = [];
  for (const match of segment.matchAll(new RegExp(RANGE_PATTERN.source, "gi"))) {
    const start = normalizeTime(`${match[1]}:${match[2] || "00"}`);
    const end = normalizeTime(`${match[3]}:${match[4] || "00"}`);
    if (start && end && start !== end) ranges.push({ start, end });
    if (ranges.length === 2) break;
  }
  return ranges;
}

export function parseBusinessWeeklyScheduleText(value: unknown): BusinessWeeklySchedule {
  if (isEncodedBusinessWeeklySchedule(value)) return normalizeBusinessWeeklySchedule(value);
  const text = cleanText(value, 1_200);
  const result = createEmptyBusinessWeeklySchedule();
  if (!text) return result;

  const normalizedAll = stripAccents(text);
  if (/(?:7\s*j\s*\/\s*7|7\s*jours\s*sur\s*7|every\s*day)/.test(normalizedAll) && /(?:24\s*h\s*\/\s*24|24\s*\/\s*7|around\s*the\s*clock)/.test(normalizedAll)) {
    for (const key of BUSINESS_WEEK_DAY_KEYS) result.days[key] = { open: true, allDay: true, slots: [] };
    return result;
  }

  const notes: string[] = [];
  const segments = text.split(/\n|;/).map((item) => item.trim()).filter(Boolean);
  for (const segment of segments) {
    const dayKeys = findDayIndexes(segment);
    if (!dayKeys.length) {
      notes.push(segment);
      continue;
    }
    const normalized = stripAccents(segment);
    const closed = /\b(?:ferme|closed|geschlossen|cerrado|chiuso|gesloten|fechado)\b/.test(normalized);
    const allDay = /(?:24\s*h\s*\/\s*24|24\s*\/\s*7)/.test(normalized);
    const slots = closed || allDay ? [] : extractRanges(segment);
    for (const key of dayKeys) {
      result.days[key] = {
        open: !closed && (allDay || slots.length > 0),
        allDay: !closed && allDay,
        slots,
      };
    }
    if (!closed && !allDay && !slots.length) notes.push(segment);
  }
  result.notes = cleanText(notes.join("\n"), 500);
  return result;
}

function displayTime(value: string) {
  if (!TIME_PATTERN.test(value)) return value;
  const [hour, minute] = value.split(":");
  return minute === "00" ? `${Number(hour)}h` : `${Number(hour)}h${minute}`;
}

export function formatBusinessWeeklySchedule(value: unknown) {
  const schedule = normalizeBusinessWeeklySchedule(value);
  const days = BUSINESS_WEEK_DAY_KEYS.map((key) => schedule.days[key]);
  const everyDay = days.every((day) => day.open);
  const allDay = everyDay && days.every((day) => day.allDay);
  const lines: string[] = [];

  if (allDay) {
    lines.push("Ouvert 7j/7 – 24h/24");
  } else {
    BUSINESS_WEEK_DAY_KEYS.forEach((key, index) => {
      const day = schedule.days[key];
      if (!day.open) return;
      const hours = day.allDay
        ? "24h/24"
        : day.slots.map((slot) => `${displayTime(slot.start)}–${displayTime(slot.end)}`).join(" / ");
      if (hours) lines.push(`${DAY_DEFINITIONS[index].fr} : ${hours}`);
    });
  }

  if (schedule.notes) lines.push(schedule.notes);
  return lines.join("\n").slice(0, 1_200);
}

export function decodeBusinessWeeklySchedule(openingDays: unknown, openingHours: unknown) {
  if (isEncodedBusinessWeeklySchedule(openingDays)) {
    return normalizeBusinessWeeklySchedule(openingDays);
  }
  const days = cleanText(openingDays, 1_200);
  const hours = cleanText(openingHours, 1_200);
  const legacy = !days ? hours : !hours ? days : hours.toLocaleLowerCase().startsWith(days.toLocaleLowerCase()) ? hours : `${days} : ${hours}`;
  return parseBusinessWeeklyScheduleText(legacy);
}

export function hasBusinessWeeklySchedule(value: unknown) {
  const schedule = normalizeBusinessWeeklySchedule(value);
  return BUSINESS_WEEK_DAY_KEYS.some((key) => schedule.days[key].open) || Boolean(schedule.notes);
}

export function mergeBusinessWeeklySchedules(currentValue: unknown, suggestedValue: unknown) {
  const current = normalizeBusinessWeeklySchedule(currentValue);
  const suggested = normalizeBusinessWeeklySchedule(suggestedValue);

  // Dès qu'un planning a été renseigné, il forme un ensemble cohérent : un
  // jour fermé est alors aussi volontaire qu'un jour ouvert. Compléter les
  // seuls jours fermés avec une suggestion IA réouvrirait silencieusement des
  // journées que le professionnel a explicitement laissées fermées.
  if (hasBusinessWeeklySchedule(current)) return current;
  return suggested;
}
