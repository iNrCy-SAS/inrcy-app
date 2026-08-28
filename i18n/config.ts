export const APP_LOCALES = [
  "fr-FR",
  "en-GB",
  "es-ES",
  "it-IT",
  "de-DE",
  "nl-NL",
  "pt-PT",
  "th-TH",
  "zh-CN",
] as const;

export type AppLocale = (typeof APP_LOCALES)[number];
export type AppLanguage = "fr" | "en" | "es" | "it" | "de" | "nl" | "pt" | "th" | "zh";

export const DEFAULT_APP_LOCALE: AppLocale = "fr-FR";
export const APP_LOCALE_COOKIE = "inrcy_locale";
export const LEGACY_APP_LOCALE_COOKIE = "inrcy_app_locale";
export const APP_LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
export const APP_LOCALE_SHARED_DOMAIN = ".inrcy.com";
export const APP_LOCALE_REQUEST_HEADER = "x-inrcy-locale";
export const APP_LOCALE_QUERY_PARAMS = ["lang", "locale"] as const;

export const APP_LANGUAGE_TO_LOCALE: Record<AppLanguage, AppLocale> = {
  fr: "fr-FR",
  en: "en-GB",
  es: "es-ES",
  it: "it-IT",
  de: "de-DE",
  nl: "nl-NL",
  pt: "pt-PT",
  th: "th-TH",
  zh: "zh-CN",
};

const APP_LOCALE_BY_LOWERCASE = new Map<string, AppLocale>(
  APP_LOCALES.map((locale) => [locale.toLowerCase(), locale]),
);

export function tryNormalizeAppLocale(value: unknown): AppLocale | null {
  const raw = String(value || "").trim().replaceAll("_", "-");
  if (!raw) return null;

  const exactLocale = APP_LOCALE_BY_LOWERCASE.get(raw.toLowerCase());
  if (exactLocale) return exactLocale;

  const languageMatch = raw.match(/^([a-z]{2})(?:-|$)/i);
  if (!languageMatch) return null;

  return APP_LANGUAGE_TO_LOCALE[languageMatch[1].toLowerCase() as AppLanguage] || null;
}

export function normalizeAppLocale(value: unknown): AppLocale {
  return tryNormalizeAppLocale(value) || DEFAULT_APP_LOCALE;
}

export function appLocaleFromAcceptLanguage(value: unknown): AppLocale | null {
  const candidates = String(value || "")
    .split(",")
    .map((part, index) => {
      const [tag, ...parameters] = part.trim().split(";");
      const qualityParameter = parameters.find((parameter) => parameter.trim().startsWith("q="));
      const quality = qualityParameter
        ? Number.parseFloat(qualityParameter.trim().slice(2))
        : 1;

      return {
        index,
        locale: tryNormalizeAppLocale(tag),
        quality: Number.isFinite(quality) ? quality : 0,
      };
    })
    .filter((candidate) => candidate.locale && candidate.quality > 0)
    .sort((left, right) => right.quality - left.quality || left.index - right.index);

  return candidates[0]?.locale || null;
}

export function appLanguageFromLocale(value: unknown): AppLanguage {
  return normalizeAppLocale(value).slice(0, 2) as AppLanguage;
}

export function buildLocalizedDashboardPath(value: unknown): string {
  return `/dashboard?lang=${appLanguageFromLocale(value)}`;
}

export function htmlLanguageFromLocale(value: unknown): string {
  const locale = normalizeAppLocale(value);
  return locale === "zh-CN" ? locale : appLanguageFromLocale(locale);
}
