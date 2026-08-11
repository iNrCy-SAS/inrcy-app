export type InrBadgeShareKey =
  | "logo"
  | "name"
  | "company"
  | "phone"
  | "email"
  | "saveContact"
  | "inrSearch"
  | "siteInrcy"
  | "siteWeb"
  | "googleBusiness"
  | "facebook"
  | "instagram"
  | "linkedin"
  | "pinterest"
  | "mails"
  | "tiktok"
  | "youtubeShorts"
  | "appointment"
  | "quote";

export type InrBadgeShareSettings = Record<InrBadgeShareKey, boolean>;

export type InrBadgeAppointmentSlot = {
  startTime: string;
  endTime: string;
  durationMinutes: number;
};

export type InrBadgeAppointmentDaySettings = InrBadgeAppointmentSlot & {
  enabled: boolean;
  slots: InrBadgeAppointmentSlot[];
};

export type InrBadgeAppointmentSettings = {
  durationMinutes: number;
  daysAhead: number;
  minNoticeHours: number;
  startTime: string;
  endTime: string;
  weekdays: number[];
  dailySlots: Record<string, InrBadgeAppointmentDaySettings>;
};

export const DEFAULT_INRBADGE_SHARE_SETTINGS: InrBadgeShareSettings = {
  logo: true,
  name: true,
  company: true,
  phone: true,
  email: true,
  saveContact: true,
  inrSearch: true,
  siteInrcy: true,
  siteWeb: true,
  googleBusiness: true,
  facebook: true,
  instagram: true,
  linkedin: true,
  pinterest: true,
  mails: true,
  tiktok: false,
  youtubeShorts: true,
  appointment: true,
  quote: false,
};

const DEFAULT_INRBADGE_SLOT: InrBadgeAppointmentSlot = {
  startTime: "09:00",
  endTime: "18:00",
  durationMinutes: 30,
};

export const DEFAULT_INRBADGE_DAY_SETTINGS: InrBadgeAppointmentDaySettings = {
  enabled: true,
  ...DEFAULT_INRBADGE_SLOT,
  slots: [{ ...DEFAULT_INRBADGE_SLOT }],
};

const DEFAULT_INRBADGE_DAILY_SLOTS: Record<string, InrBadgeAppointmentDaySettings> = {
  "0": { ...DEFAULT_INRBADGE_DAY_SETTINGS, enabled: false, slots: [{ ...DEFAULT_INRBADGE_SLOT }] },
  "1": { ...DEFAULT_INRBADGE_DAY_SETTINGS, enabled: true, slots: [{ ...DEFAULT_INRBADGE_SLOT }] },
  "2": { ...DEFAULT_INRBADGE_DAY_SETTINGS, enabled: true, slots: [{ ...DEFAULT_INRBADGE_SLOT }] },
  "3": { ...DEFAULT_INRBADGE_DAY_SETTINGS, enabled: true, slots: [{ ...DEFAULT_INRBADGE_SLOT }] },
  "4": { ...DEFAULT_INRBADGE_DAY_SETTINGS, enabled: true, slots: [{ ...DEFAULT_INRBADGE_SLOT }] },
  "5": { ...DEFAULT_INRBADGE_DAY_SETTINGS, enabled: true, slots: [{ ...DEFAULT_INRBADGE_SLOT }] },
  "6": { ...DEFAULT_INRBADGE_DAY_SETTINGS, enabled: false, slots: [{ ...DEFAULT_INRBADGE_SLOT }] },
};

export const DEFAULT_INRBADGE_APPOINTMENT_SETTINGS: InrBadgeAppointmentSettings = {
  durationMinutes: 30,
  daysAhead: 14,
  minNoticeHours: 4,
  startTime: "09:00",
  endTime: "18:00",
  weekdays: [1, 2, 3, 4, 5],
  dailySlots: DEFAULT_INRBADGE_DAILY_SLOTS,
};

const SHARE_KEYS = Object.keys(DEFAULT_INRBADGE_SHARE_SETTINGS) as InrBadgeShareKey[];
const WEEKDAY_KEYS = ["0", "1", "2", "3", "4", "5", "6"] as const;
const MAX_APPOINTMENT_SLOTS_PER_DAY = 3;

function asPlainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numberValue)));
}

function parseTimeToMinutes(value: string) {
  const [rawHour, rawMinute] = value.split(":");
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function normalizeTime(value: unknown, fallback: string) {
  const raw = String(value || "").trim();
  if (/^\d{2}:\d{2}$/.test(raw) && parseTimeToMinutes(raw) !== null) return raw;
  return fallback;
}

function normalizeWeekdays(value: unknown, fallback: number[]) {
  const rawWeekdays = Array.isArray(value) ? value : fallback;
  const weekdays = rawWeekdays
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item >= 0 && item <= 6)
    .filter((item, index, arr) => arr.indexOf(item) === index)
    .sort((a, b) => a - b);
  return weekdays.length ? weekdays : fallback;
}

function fallbackSlotFromDay(fallback: InrBadgeAppointmentDaySettings): InrBadgeAppointmentSlot {
  const firstSlot = Array.isArray(fallback.slots) && fallback.slots[0] ? fallback.slots[0] : null;
  return {
    startTime: firstSlot?.startTime || fallback.startTime || DEFAULT_INRBADGE_SLOT.startTime,
    endTime: firstSlot?.endTime || fallback.endTime || DEFAULT_INRBADGE_SLOT.endTime,
    durationMinutes: firstSlot?.durationMinutes || fallback.durationMinutes || DEFAULT_INRBADGE_SLOT.durationMinutes,
  };
}

function normalizeSlot(value: unknown, fallback: InrBadgeAppointmentSlot): InrBadgeAppointmentSlot | null {
  const raw = asPlainObject(value);
  const startTime = normalizeTime(raw.startTime, fallback.startTime);
  const endTime = normalizeTime(raw.endTime, fallback.endTime);
  const durationMinutes = clampNumber(raw.durationMinutes, fallback.durationMinutes, 15, 180);
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);

  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) return null;
  if (durationMinutes > endMinutes - startMinutes) return null;

  return { startTime, endTime, durationMinutes };
}

function normalizeSlots(value: unknown, fallback: InrBadgeAppointmentDaySettings): InrBadgeAppointmentSlot[] {
  const raw = asPlainObject(value);
  const fallbackSlot = fallbackSlotFromDay(fallback);
  const rawSlots = Array.isArray(raw.slots) && raw.slots.length
    ? raw.slots
    : [{ startTime: raw.startTime, endTime: raw.endTime, durationMinutes: raw.durationMinutes }];

  const normalized = rawSlots
    .slice(0, MAX_APPOINTMENT_SLOTS_PER_DAY)
    .map((slot) => normalizeSlot(slot, fallbackSlot))
    .filter((slot): slot is InrBadgeAppointmentSlot => Boolean(slot))
    .sort((a, b) => (parseTimeToMinutes(a.startTime) ?? 0) - (parseTimeToMinutes(b.startTime) ?? 0));

  const withoutOverlap: InrBadgeAppointmentSlot[] = [];
  for (const slot of normalized) {
    const startMinutes = parseTimeToMinutes(slot.startTime) ?? 0;
    const previousEndMinutes = withoutOverlap.length
      ? parseTimeToMinutes(withoutOverlap[withoutOverlap.length - 1].endTime) ?? 0
      : null;
    if (previousEndMinutes !== null && startMinutes < previousEndMinutes) continue;
    withoutOverlap.push(slot);
  }

  return withoutOverlap.length ? withoutOverlap : [{ ...fallbackSlot }];
}

function normalizeDaySettings(value: unknown, fallback: InrBadgeAppointmentDaySettings): InrBadgeAppointmentDaySettings {
  const raw = asPlainObject(value);
  const slots = normalizeSlots(value, fallback);
  const firstSlot = slots[0] || fallbackSlotFromDay(fallback);

  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : fallback.enabled,
    startTime: firstSlot.startTime,
    endTime: firstSlot.endTime,
    durationMinutes: firstSlot.durationMinutes,
    slots,
  };
}

function buildDailySlotsFromLegacy(raw: Record<string, unknown>, defaultSettings: InrBadgeAppointmentSettings) {
  const legacyDuration = clampNumber(raw.durationMinutes, defaultSettings.durationMinutes, 15, 180);
  let legacyStartTime = normalizeTime(raw.startTime, defaultSettings.startTime);
  let legacyEndTime = normalizeTime(raw.endTime, defaultSettings.endTime);
  const startMinutes = parseTimeToMinutes(legacyStartTime) ?? 540;
  const endMinutes = parseTimeToMinutes(legacyEndTime) ?? 1080;
  if (endMinutes <= startMinutes) {
    legacyStartTime = defaultSettings.startTime;
    legacyEndTime = defaultSettings.endTime;
  }
  const legacyWeekdays = normalizeWeekdays(raw.weekdays, defaultSettings.weekdays);

  return WEEKDAY_KEYS.reduce((acc, key) => {
    const day = Number(key);
    const slot = {
      startTime: legacyStartTime,
      endTime: legacyEndTime,
      durationMinutes: legacyDuration,
    };
    acc[key] = {
      enabled: legacyWeekdays.includes(day),
      ...slot,
      slots: [{ ...slot }],
    };
    return acc;
  }, {} as Record<string, InrBadgeAppointmentDaySettings>);
}

function getFirstEnabledDay(dailySlots: Record<string, InrBadgeAppointmentDaySettings>) {
  return WEEKDAY_KEYS.map((key) => dailySlots[key]).find((day) => day?.enabled) || dailySlots["1"] || DEFAULT_INRBADGE_DAY_SETTINGS;
}

export function getInrBadgeAppointmentDaySlots(settings: InrBadgeAppointmentSettings, weekday: number): InrBadgeAppointmentSlot[] {
  const daySettings = settings.dailySlots[String(weekday)] || {
    enabled: settings.weekdays.includes(weekday),
    startTime: settings.startTime,
    endTime: settings.endTime,
    durationMinutes: settings.durationMinutes,
    slots: [{ startTime: settings.startTime, endTime: settings.endTime, durationMinutes: settings.durationMinutes }],
  };

  if (!daySettings.enabled) return [];
  return normalizeSlots(daySettings, daySettings).slice(0, MAX_APPOINTMENT_SLOTS_PER_DAY);
}

export function normalizeInrBadgeShareSettings(value: unknown): InrBadgeShareSettings {
  const raw = asPlainObject(value);
  return SHARE_KEYS.reduce((acc, key) => {
    acc[key] = typeof raw[key] === "boolean" ? raw[key] : DEFAULT_INRBADGE_SHARE_SETTINGS[key];
    return acc;
  }, { ...DEFAULT_INRBADGE_SHARE_SETTINGS } as InrBadgeShareSettings);
}

export function normalizeInrBadgeAppointmentSettings(value: unknown): InrBadgeAppointmentSettings {
  const raw = asPlainObject(value);
  const defaultSettings = DEFAULT_INRBADGE_APPOINTMENT_SETTINGS;
  const daysAhead = clampNumber(raw.daysAhead, defaultSettings.daysAhead, 1, 60);
  const minNoticeHours = clampNumber(raw.minNoticeHours, defaultSettings.minNoticeHours, 0, 168);
  const rawDailySlots = asPlainObject(raw.dailySlots);
  const hasDailySlots = WEEKDAY_KEYS.some((key) => Object.prototype.hasOwnProperty.call(rawDailySlots, key));
  const legacyDailySlots = buildDailySlotsFromLegacy(raw, defaultSettings);

  const dailySlots = WEEKDAY_KEYS.reduce((acc, key) => {
    const fallback = hasDailySlots ? DEFAULT_INRBADGE_DAILY_SLOTS[key] : legacyDailySlots[key];
    acc[key] = normalizeDaySettings(hasDailySlots ? rawDailySlots[key] : legacyDailySlots[key], fallback);
    return acc;
  }, {} as Record<string, InrBadgeAppointmentDaySettings>);

  const weekdays = WEEKDAY_KEYS.map(Number).filter((day) => dailySlots[String(day)]?.enabled);
  const firstEnabledDay = getFirstEnabledDay(dailySlots);

  return {
    durationMinutes: firstEnabledDay.durationMinutes,
    daysAhead,
    minNoticeHours,
    startTime: firstEnabledDay.startTime,
    endTime: firstEnabledDay.endTime,
    weekdays: weekdays.length ? weekdays : defaultSettings.weekdays,
    dailySlots,
  };
}

export function resolveInrBadgeAppointmentSettings(rootSettings: unknown): InrBadgeAppointmentSettings {
  const root = asPlainObject(rootSettings);
  const inrcalendar = asPlainObject(root.inrcalendar);
  const calendarAppointmentSettings = Object.prototype.hasOwnProperty.call(inrcalendar, "appointment_settings")
    ? inrcalendar.appointment_settings
    : undefined;
  return normalizeInrBadgeAppointmentSettings(calendarAppointmentSettings ?? root.inrBadgeAppointmentSettings);
}

export function sanitizeInrBadgeShareSettingsPayload(value: unknown): InrBadgeShareSettings {
  return normalizeInrBadgeShareSettings(value);
}

export function sanitizeInrBadgeAppointmentSettingsPayload(value: unknown): InrBadgeAppointmentSettings {
  return normalizeInrBadgeAppointmentSettings(value);
}
