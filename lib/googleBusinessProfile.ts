export const GOOGLE_BUSINESS_DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
export type GoogleBusinessDay = typeof GOOGLE_BUSINESS_DAYS[number];
export type GoogleBusinessTime = { hours?: number; minutes?: number };
export type GoogleBusinessPeriod = { openDay: GoogleBusinessDay; openTime: GoogleBusinessTime; closeDay: GoogleBusinessDay; closeTime: GoogleBusinessTime };
export type GoogleBusinessDate = { year: number; month: number; day: number };
export type GoogleBusinessSpecialPeriod = { startDate: GoogleBusinessDate; endDate?: GoogleBusinessDate; openTime?: GoogleBusinessTime; closeTime?: GoogleBusinessTime; closed?: boolean };
export type GoogleBusinessAddress = { regionCode?: string; administrativeArea?: string; locality?: string; postalCode?: string; addressLines?: string[]; [key: string]: unknown };
export type GoogleBusinessProfile = {
  title: string;
  primaryPhone: string;
  websiteUri: string;
  description: string;
  storefrontAddress: GoogleBusinessAddress | null;
  regularHours: { periods: GoogleBusinessPeriod[] };
  specialHours: { specialHourPeriods: GoogleBusinessSpecialPeriod[] };
};
type RecordValue = Record<string, unknown>;
export const googleBusinessRecord = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const string = (value: unknown) => typeof value === "string" ? value : "";

export function editableGoogleBusinessProfile(value: unknown): GoogleBusinessProfile {
  const source = googleBusinessRecord(value);
  return {
    title: string(source.title), primaryPhone: string(googleBusinessRecord(source.phoneNumbers).primaryPhone), websiteUri: string(source.websiteUri), description: string(googleBusinessRecord(source.profile).description),
    storefrontAddress: source.storefrontAddress ? googleBusinessRecord(source.storefrontAddress) : null,
    regularHours: { periods: Array.isArray(googleBusinessRecord(source.regularHours).periods) ? googleBusinessRecord(source.regularHours).periods as GoogleBusinessPeriod[] : [] },
    specialHours: { specialHourPeriods: Array.isArray(googleBusinessRecord(source.specialHours).specialHourPeriods) ? googleBusinessRecord(source.specialHours).specialHourPeriods as GoogleBusinessSpecialPeriod[] : [] },
  };
}

export function stableGoogleBusinessValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableGoogleBusinessValue).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableGoogleBusinessValue((value as RecordValue)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function boundedText(value: unknown, maximum: number, required = false) {
  if (typeof value !== "string" || value.length > maximum || (required && !value.trim())) throw new Error("Une information de la fiche est invalide ou trop longue.");
  return value.trim();
}

function time(value: unknown): GoogleBusinessTime {
  const row = googleBusinessRecord(value);
  const hours = Number(row.hours ?? 0), minutes = Number(row.minutes ?? 0);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 24 || minutes < 0 || minutes > 59 || (hours === 24 && minutes !== 0)) throw new Error("Vérifiez les horaires d’ouverture.");
  return { hours, minutes };
}

function day(value: unknown): GoogleBusinessDay {
  if (!GOOGLE_BUSINESS_DAYS.includes(value as GoogleBusinessDay)) throw new Error("Jour d’ouverture invalide.");
  return value as GoogleBusinessDay;
}

function date(value: unknown): GoogleBusinessDate {
  const row = googleBusinessRecord(value);
  const result = { year: Number(row.year), month: Number(row.month), day: Number(row.day) };
  const check = new Date(Date.UTC(result.year, result.month - 1, result.day));
  if (!Object.values(result).every(Number.isInteger) || result.year < 2000 || result.year > 2200 || check.getUTCFullYear() !== result.year || check.getUTCMonth() + 1 !== result.month || check.getUTCDate() !== result.day) throw new Error("Date de fermeture ou d’ouverture exceptionnelle invalide.");
  return result;
}

export function buildGoogleBusinessProfilePatch(current: GoogleBusinessProfile, proposed: unknown) {
  const source = googleBusinessRecord(proposed);
  const location: RecordValue = {};
  const updateMask: string[] = [];
  const set = (key: keyof GoogleBusinessProfile, normalized: unknown, mask = String(key)) => {
    if (stableGoogleBusinessValue(current[key]) === stableGoogleBusinessValue(normalized)) return;
    updateMask.push(mask);
    if (key === "primaryPhone") location.phoneNumbers = { primaryPhone: normalized };
    else if (key === "description") location.profile = { description: normalized };
    else location[key] = normalized;
  };
  if ("title" in source) set("title", boundedText(source.title, 200, true));
  if ("primaryPhone" in source) {
    const phone = boundedText(source.primaryPhone, 50);
    if (phone && !/^\+?[\d\s().-]{5,50}$/.test(phone)) throw new Error("Le numéro de téléphone est invalide.");
    set("primaryPhone", phone, "phoneNumbers.primaryPhone");
  }
  if ("websiteUri" in source) {
    const website = boundedText(source.websiteUri, 2048);
    if (website) { let url: URL; try { url = new URL(website); } catch { throw new Error("Indiquez une adresse de site commençant par https:// ou http://."); } if (!["https:", "http:"].includes(url.protocol)) throw new Error("L’adresse du site est invalide."); }
    set("websiteUri", website);
  }
  if ("description" in source) set("description", boundedText(source.description, 750), "profile.description");
  if ("storefrontAddress" in source) {
    if (source.storefrontAddress === null && current.storefrontAddress !== null) throw new Error("La suppression de l’adresse doit être effectuée depuis Google.");
    if (source.storefrontAddress !== null) {
      if (!current.storefrontAddress) throw new Error("L’adresse de cet établissement n’est pas affichée sur Google.");
      const incoming = googleBusinessRecord(source.storefrontAddress);
      const address = { ...current.storefrontAddress };
      for (const key of ["regionCode", "administrativeArea", "locality", "postalCode"] as const) {
        const next = boundedText(incoming[key] ?? "", key === "regionCode" ? 2 : 200);
        if (key === "regionCode" && !/^[A-Z]{2}$/.test(next)) throw new Error("Code pays invalide.");
        if (String(address[key] || "") !== next) { address[key] = next; updateMask.push(`storefrontAddress.${key}`); }
      }
      if (!Array.isArray(incoming.addressLines) || incoming.addressLines.length > 5) throw new Error("Adresse invalide.");
      const lines = incoming.addressLines.map(line => boundedText(line, 200)).filter(Boolean);
      if (!lines.length) throw new Error("L’adresse ne peut pas être vide.");
      if (stableGoogleBusinessValue(address.addressLines) !== stableGoogleBusinessValue(lines)) { address.addressLines = lines; updateMask.push("storefrontAddress.addressLines"); }
      if (updateMask.some(mask => mask.startsWith("storefrontAddress."))) location.storefrontAddress = address;
    }
  }
  if ("regularHours" in source) {
    // Unchanged provider data is preserved verbatim, including uncommon time formats.
    if (stableGoogleBusinessValue(current.regularHours) !== stableGoogleBusinessValue(source.regularHours)) {
      const periods = googleBusinessRecord(source.regularHours).periods;
      if (!Array.isArray(periods) || periods.length > 50) throw new Error("Horaires d’ouverture invalides.");
      const normalized = periods.map(value => {
        const row = googleBusinessRecord(value);
        const period = { openDay: day(row.openDay), closeDay: day(row.closeDay), openTime: time(row.openTime), closeTime: time(row.closeTime) };
        const first = GOOGLE_BUSINESS_DAYS.indexOf(period.openDay) * 1440 + Number(period.openTime.hours) * 60 + Number(period.openTime.minutes);
        let last = GOOGLE_BUSINESS_DAYS.indexOf(period.closeDay) * 1440 + Number(period.closeTime.hours) * 60 + Number(period.closeTime.minutes);
        if (period.closeDay !== period.openDay && last <= first) last += 7 * 1440;
        if (last <= first) throw new Error("L’heure de fermeture doit suivre l’heure d’ouverture.");
        return period;
      });
      set("regularHours", { periods: normalized });
    }
  }
  if ("specialHours" in source && stableGoogleBusinessValue(current.specialHours) !== stableGoogleBusinessValue(source.specialHours)) {
    const periods = googleBusinessRecord(source.specialHours).specialHourPeriods;
    if (!Array.isArray(periods) || periods.length > 200) throw new Error("Horaires exceptionnels invalides.");
    const normalized = periods.map(value => {
      const row = googleBusinessRecord(value), startDate = date(row.startDate);
      if (row.closed === true) return { startDate, closed: true };
      const endDate = row.endDate ? date(row.endDate) : startDate, openTime = time(row.openTime), closeTime = time(row.closeTime);
      const firstDay = Date.UTC(startDate.year, startDate.month - 1, startDate.day), lastDay = Date.UTC(endDate.year, endDate.month - 1, endDate.day);
      const duration = (lastDay - firstDay) / 60000 + Number(closeTime.hours) * 60 + Number(closeTime.minutes) - Number(openTime.hours) * 60 - Number(openTime.minutes);
      if (lastDay < firstDay || lastDay - firstDay > 86400000 || duration <= 0 || duration > 1440) throw new Error("Vérifiez la durée de l’ouverture exceptionnelle.");
      return { startDate, endDate, openTime, closeTime, closed: false };
    });
    const regular = googleBusinessRecord(location.regularHours || current.regularHours).periods;
    if (normalized.length && (!Array.isArray(regular) || !regular.length)) throw new Error("Renseignez les horaires habituels avant les horaires exceptionnels.");
    set("specialHours", { specialHourPeriods: normalized });
  }
  return { location, updateMask };
}
