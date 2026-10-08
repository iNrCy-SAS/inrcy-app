/** Native ChatGPT Ads selections. Model/API credentials never belong in this object. */
export const OPENAI_ADS_PLATFORMS = ["web", "ios_app", "android_app", "desktop_web", "ios_web", "android_web"] as const;
export type OpenaiAdsPlatform = typeof OPENAI_ADS_PLATFORMS[number];
export type OpenaiDeliverySettings = {
  budget: { type: "daily" | "total"; totalEuros: number | null; startAt: string | null; endAt: string | null };
  bidding: { strategy: "fixed_bid" };
  /** Empty means no platform restriction; never send an empty included array. */
  platforms: OpenaiAdsPlatform[];
};
export const defaultOpenaiDeliverySettings = (): OpenaiDeliverySettings => ({
  budget: { type: "daily", totalEuros: null, startAt: null, endAt: null },
  bidding: { strategy: "fixed_bid" }, platforms: [],
});
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const keys = (value: Record<string, unknown>, names: string[]) => Object.keys(value).every((name) => names.includes(name));
const money = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;

export function openaiAdsInstant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59 || Number(match[7] || 0) > 23 || Number(match[8] || 0) > 59) return null;
  const calendar = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
  const millis = Date.parse(value);
  return Number.isSafeInteger(millis) && millis >= 946684800000 && millis <= 4102444800000 ? new Date(millis).toISOString() : null;
}
export function openaiAdsTimeZone(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return value; } catch { return null; }
}
export function openaiAdsLocalDateTime(instant: string | null, timeZone: string): string {
  if (!instant || !openaiAdsTimeZone(timeZone) || !Number.isFinite(Date.parse(instant))) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(Date.parse(instant)).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
/** Reject nonexistent and ambiguous wall-clock times instead of silently moving the schedule. */
export function openaiAdsCalendarInstant(local: string, timeZone: string): string | null {
  if (!openaiAdsTimeZone(timeZone) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const target = Date.parse(`${local}:00Z`);
  if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 16) !== local) return null;
  let guess = target;
  for (let i = 0; i < 4; i++) {
    const shown = openaiAdsLocalDateTime(new Date(guess).toISOString(), timeZone);
    guess += target - Date.parse(`${shown}:00Z`);
  }
  if (!Number.isFinite(guess) || openaiAdsLocalDateTime(new Date(guess).toISOString(), timeZone) !== local) return null;
  if ([-7200000, -3600000, 3600000, 7200000].some((delta) => openaiAdsLocalDateTime(new Date(guess + delta).toISOString(), timeZone) === local)) return null;
  return openaiAdsInstant(new Date(guess).toISOString());
}

export function normalizeOpenaiDeliverySettings(value: unknown): { settings: OpenaiDeliverySettings; error: string | null } {
  const fallback = defaultOpenaiDeliverySettings();
  const fail = (error: string) => ({ settings: fallback, error });
  const raw = object(value);
  if (!raw || !keys(raw, ["budget", "bidding", "platforms"])) return fail("Les réglages ChatGPT Ads sont invalides.");
  const budget = object(raw.budget);
  const bidding = object(raw.bidding);
  if (!budget || !keys(budget, ["type", "totalEuros", "startAt", "endAt"]) || !["daily", "total"].includes(String(budget.type))) return fail("Choisissez un budget quotidien ou total ChatGPT Ads.");
  if (budget.type === "total" && !money(budget.totalEuros, 5, 45000)) return fail("Le budget total ChatGPT Ads doit être compris entre 5 et 45 000 € dans iNrCy.");
  if (budget.type === "daily" && budget.totalEuros != null) return fail("ChatGPT Ads utilise soit un budget quotidien, soit un budget total.");
  const startAt = budget.startAt == null ? null : openaiAdsInstant(budget.startAt);
  const endAt = budget.endAt == null ? null : openaiAdsInstant(budget.endAt);
  if ((budget.startAt != null && !startAt) || (budget.endAt != null && !endAt)) return fail("Les dates ChatGPT Ads doivent préciser une heure et son fuseau.");
  if (startAt && endAt && Date.parse(endAt) <= Date.parse(startAt)) return fail("La fin ChatGPT Ads doit être après le début.");
  if (!bidding || !keys(bidding, ["strategy"]) || bidding.strategy !== "fixed_bid") return fail("Ce parcours ChatGPT Ads utilise une enchère fixe par clic.");
  if (!Array.isArray(raw.platforms) || raw.platforms.length > OPENAI_ADS_PLATFORMS.length || raw.platforms.some((p) => !OPENAI_ADS_PLATFORMS.includes(p as OpenaiAdsPlatform))) return fail("Choisissez des plateformes ChatGPT disponibles.");
  return { settings: { budget: { type: budget.type as "daily" | "total", totalEuros: budget.type === "total" ? budget.totalEuros as number : null, startAt, endAt }, bidding: { strategy: "fixed_bid" }, platforms: [...new Set(raw.platforms as OpenaiAdsPlatform[])] }, error: null };
}

export function openaiAdsTrackingTemplate(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value !== "string") throw new Error("Les paramètres de suivi ChatGPT Ads sont invalides.");
  const template = value.trim().replace(/^\?/, "");
  if (!template || template.length > 2048 || /[\r\n\u0000-\u001f#]/.test(template) || /^https?:/i.test(template)) throw new Error("Saisissez uniquement les paramètres de suivi, sans adresse de page.");
  const entries = [...new URLSearchParams(template).entries()];
  if (entries.length > 50 || entries.some(([name, text]) => !/^[A-Za-z0-9_.-]{1,80}$/.test(name) || /[\r\n\u0000-\u001f]/.test(text))) throw new Error("Les paramètres de suivi ChatGPT Ads sont invalides.");
  for (const text of [template, ...entries.map(([, text]) => text)]) {
    for (const match of text.matchAll(/\{([^{}]+)\}/g)) if (!["campaign_id", "ad_id"].includes(match[1])) throw new Error("Ce paramètre dynamique de suivi ChatGPT Ads n’est pas pris en charge.");
    if (/[{}]/.test(text.replace(/\{(?:campaign_id|ad_id)\}/g, ""))) throw new Error("Les paramètres dynamiques de suivi ChatGPT Ads sont invalides.");
  }
  return template;
}
export type OpenaiNativeDraft = {
  dailyBudgetEuros: number; endDate: string; openaiBidEuros?: number; trackingParameters?: string;
  openaiDeliverySettings?: OpenaiDeliverySettings;
};

/** Exact historical end-of-day calculation retained for stored drafts without native settings. */
export function openaiAdsLegacyEndTime(endDate: string, timeZone: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || !openaiAdsTimeZone(timeZone)) throw new Error("Le fuseau horaire du compte ChatGPT Ads doit être confirmé.");
  const reference = new Date(`${endDate}T12:00:00Z`);
  if (!Number.isFinite(reference.getTime()) || reference.toISOString().slice(0, 10) !== endDate) throw new Error("La date de fin ChatGPT Ads est invalide.");
  const offsetName = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" }).formatToParts(reference).find((part) => part.type === "timeZoneName")?.value || "";
  const offset = /^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/.exec(offsetName);
  if (!offset) throw new Error("Le fuseau horaire ChatGPT Ads est invalide.");
  const suffix = offset[1] ? `${offset[1]}${offset[2].padStart(2, "0")}:${offset[3] || "00"}` : "+00:00";
  return Math.floor(Date.parse(`${endDate}T23:59:59${suffix}`) / 1000);
}
export function openaiNativeDelivery(draft: OpenaiNativeDraft, now = Date.now(), timeZone = "") {
  const legacy = draft.openaiDeliverySettings === undefined;
  const checked = legacy ? { settings: defaultOpenaiDeliverySettings(), error: null } : normalizeOpenaiDeliverySettings(draft.openaiDeliverySettings);
  if (checked.error) throw new Error(checked.error);
  const settings = checked.settings;
  const amount = settings.budget.type === "total" ? settings.budget.totalEuros : draft.dailyBudgetEuros;
  if (!money(amount, settings.budget.type === "total" ? 5 : 15, settings.budget.type === "total" ? 45000 : 500)) throw new Error("Précisez un budget ChatGPT Ads quotidien de 15 à 500 € ou total de 5 à 45 000 € dans iNrCy.");
  const bid = Number(draft.openaiBidEuros || 0);
  if (!money(bid, 0.01, amount || 0)) throw new Error("L’enchère ChatGPT Ads doit être comprise entre 0,01 € et le budget choisi, avec deux décimales maximum.");
  const startTime = settings.budget.startAt ? Math.floor(Date.parse(settings.budget.startAt) / 1000) : undefined;
  const endTime = settings.budget.endAt ? Math.floor(Date.parse(settings.budget.endAt) / 1000) : openaiAdsLegacyEndTime(draft.endDate, timeZone);
  if (!Number.isFinite(now) || (startTime != null && startTime * 1000 < now - 60000) || endTime * 1000 <= Math.max(now, (startTime || 0) * 1000) || endTime * 1000 > now + 90 * 86400000) throw new Error("Le calendrier ChatGPT Ads doit être futur, avec une fin après le début, dans les 90 prochains jours.");
  const queryStringTemplate = legacy ? "" : openaiAdsTrackingTemplate(draft.trackingParameters);
  return {
    budget: settings.budget.type === "total" ? { lifetimeSpendLimitMicros: Math.round((amount || 0) * 1000000) } : { dailySpendLimitMicros: Math.round((amount || 0) * 1000000) },
    maxBidMicros: Math.round(bid * 1000000), endTime,
    ...(startTime == null ? {} : { startTime }),
    ...(!legacy && settings.platforms.length ? { platforms: settings.platforms } : {}),
    ...(queryStringTemplate ? { queryStringTemplate } : {}),
  };
}
