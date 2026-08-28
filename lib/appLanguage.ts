export const DEFAULT_APP_LANGUAGE = "fr" as const;
export const APP_LANGUAGE_STORAGE_KEY = "inrcy_app_language_v1";
export const APP_LANGUAGE_EVENT = "inrcy:app-language-updated";

export const APP_LANGUAGE_OPTIONS = [
  { value: "fr", label: "Français", shortLabel: "Fr", flag: "Français", flagSrc: "/flags/fr.png" },
  { value: "en", label: "English", shortLabel: "En", flag: "English", flagSrc: "/flags/en.png" },
  { value: "es", label: "Español", shortLabel: "Es", flag: "Español", flagSrc: "/flags/es.png" },
  { value: "it", label: "Italiano", shortLabel: "It", flag: "Italiano", flagSrc: "/flags/it.png" },
  { value: "de", label: "Deutsch", shortLabel: "De", flag: "Deutsch", flagSrc: "/flags/de.png" },
  { value: "nl", label: "Nederlands", shortLabel: "Nl", flag: "Nederlands", flagSrc: "/flags/nl.png" },
  { value: "pt", label: "Português", shortLabel: "Pt", flag: "Português", flagSrc: "/flags/pt.png" },
  { value: "th", label: "ไทย", shortLabel: "ไทย", flag: "ไทย", flagSrc: "/flags/th.svg" },
  { value: "zh", label: "中文（简体）", shortLabel: "中文", flag: "中国", flagSrc: "/flags/zh.svg" },
] as const;

export type AppLanguageCode = (typeof APP_LANGUAGE_OPTIONS)[number]["value"];

const APP_LANGUAGE_VALUES = new Set<string>(APP_LANGUAGE_OPTIONS.map((option) => option.value));

export function normalizeAppLanguage(value: unknown): AppLanguageCode {
  const raw = String(value || "").trim().toLowerCase();
  if (APP_LANGUAGE_VALUES.has(raw)) return raw as AppLanguageCode;
  if (["french", "francais", "français"].includes(raw)) return "fr";
  if (["english", "anglais"].includes(raw)) return "en";
  if (["spanish", "espagnol"].includes(raw)) return "es";
  if (["italian", "italien"].includes(raw)) return "it";
  if (["german", "allemand"].includes(raw)) return "de";
  if (["dutch", "neerlandais", "néerlandais"].includes(raw)) return "nl";
  if (["portuguese", "portugais"].includes(raw)) return "pt";
  if (["thai", "thailandais", "thaïlandais", "ภาษาไทย", "th-th", "th_th"].includes(raw)) return "th";
  if (["chinese", "simplified chinese", "chinois", "chinois simplifié", "中文", "简体中文", "zh-cn", "zh_cn", "zh-hans"].includes(raw)) return "zh";
  return DEFAULT_APP_LANGUAGE;
}

export function getAppLanguageOption(value: unknown) {
  const language = normalizeAppLanguage(value);
  return APP_LANGUAGE_OPTIONS.find((option) => option.value === language) || APP_LANGUAGE_OPTIONS[0];
}
