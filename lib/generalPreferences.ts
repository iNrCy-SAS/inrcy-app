/** Values offered by GeneralPreferencesContent. Shared by the form and server. */
export const GENERAL_PREFERENCE_VALUES = {
  clientLanguage: ["fr", "en", "es", "it", "de", "nl", "pt", "th", "zh"],
  timezone: ["Europe/Paris", "Europe/London", "Europe/Madrid", "Europe/Rome", "Europe/Berlin", "Europe/Brussels", "Europe/Amsterdam", "Europe/Lisbon", "Asia/Bangkok", "Asia/Shanghai", "America/New_York", "America/Toronto"],
  dateFormat: ["dd/MM/yyyy", "MM/dd/yyyy", "yyyy-MM-dd", "d MMMM yyyy"],
  currency: ["EUR", "USD", "GBP", "CHF", "CAD"],
} as const;
export type GeneralPreferences = { [K in keyof typeof GENERAL_PREFERENCE_VALUES]: typeof GENERAL_PREFERENCE_VALUES[K][number] };
export const DEFAULT_GENERAL_PREFERENCES: GeneralPreferences = { clientLanguage: "fr", timezone: "Europe/Paris", dateFormat: "dd/MM/yyyy", currency: "EUR" };
export const GENERAL_PREFERENCE_COLUMNS = { clientLanguage: "client_language", timezone: "timezone", dateFormat: "date_format", currency: "currency" } as const;
export function parseGeneralPreferencesPatch(value: unknown): Partial<GeneralPreferences> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Préférences générales invalides.");
  const entries = Object.entries(value);
  if (!entries.length || entries.length > 4) throw new Error("Préférences générales invalides.");
  for (const [key, item] of entries) {
    if (!Object.hasOwn(GENERAL_PREFERENCE_VALUES, key) || typeof item !== "string" || !(GENERAL_PREFERENCE_VALUES[key as keyof GeneralPreferences] as readonly string[]).includes(item)) throw new Error("Préférence générale non proposée par l’application.");
  }
  return Object.fromEntries(entries) as Partial<GeneralPreferences>;
}
export function projectGeneralPreferences(row: Record<string, unknown> | null): GeneralPreferences {
  const result = { ...DEFAULT_GENERAL_PREFERENCES };
  for (const key of Object.keys(GENERAL_PREFERENCE_COLUMNS) as (keyof GeneralPreferences)[]) {
    const value = row?.[GENERAL_PREFERENCE_COLUMNS[key]];
    if (typeof value === "string" && (GENERAL_PREFERENCE_VALUES[key] as readonly string[]).includes(value)) Object.assign(result, { [key]: value });
  }
  return result;
}
