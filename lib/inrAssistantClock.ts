/** Trusted server clock facts. No provider, session, database or browser input. */
export const INR_ASSISTANT_DEFAULT_TIME_ZONE = "Europe/Paris";

export type InrAssistantClockFacts = {
  source: "server_clock";
  utcInstant: string;
  timeZone: string;
  localDate: string;
  localTime: string;
  weekday: string;
  utcOffset: string;
};

export function isValidInrAssistantTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 80 || /[\u0000-\u0020\u007f]/u.test(value)) return false;
  try { new Intl.DateTimeFormat("fr-FR", { timeZone: value }).format(0); return true; }
  catch { return false; }
}

export function getInrAssistantCurrentDateTime(
  timeZone: string = INR_ASSISTANT_DEFAULT_TIME_ZONE,
  now = new Date(),
): InrAssistantClockFacts {
  if (!isValidInrAssistantTimeZone(timeZone) || !(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("Date ou fuseau horaire invalide.");
  const values = new Map(new Intl.DateTimeFormat("fr-FR", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "long",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "longOffset",
  }).formatToParts(now).map(part => [part.type, part.value]));
  return {
    source: "server_clock", utcInstant: now.toISOString(), timeZone,
    localDate: `${values.get("year")}-${values.get("month")}-${values.get("day")}`,
    localTime: `${values.get("hour")}:${values.get("minute")}:${values.get("second")}`,
    weekday: values.get("weekday") ?? "", utcOffset: values.get("timeZoneName") ?? "",
  };
}

export function isInrAssistantCurrentTimeRequest(message: string): boolean {
  const text = String(message || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return /\b(?:date|heure|jour|time|date|day)\b.{0,45}\b(?:actuel\w*|aujourd|maintenant|courant|du jour|current|today|now)\b|\b(?:quelle heure|quel jour|quelle date|what time|what date|on est le combien|nous sommes le combien)\b|\baujourd['’]?hui\b/.test(text);
}
