export const APP_APPEARANCE_THEME_STORAGE_KEY = "inrcy_app_appearance_theme_v1";
export const APP_APPEARANCE_THEME_EVENT = "inrcy:appearance-theme-updated";

export type AppAppearanceTheme =
  | "original"
  | "midnight"
  | "graphite"
  | "soft-violet"
  | "pearl-light"
  | "azure-light";

export const APP_APPEARANCE_THEMES: readonly AppAppearanceTheme[] = [
  "original",
  "midnight",
  "graphite",
  "soft-violet",
  "pearl-light",
  "azure-light",
] as const;

export function isLightAppAppearanceTheme(theme: AppAppearanceTheme): boolean {
  return theme === "pearl-light" || theme === "azure-light";
}

export function normalizeAppAppearanceTheme(value: unknown): AppAppearanceTheme {
  const candidate = String(value || "").trim().toLowerCase();
  return APP_APPEARANCE_THEMES.includes(candidate as AppAppearanceTheme)
    ? (candidate as AppAppearanceTheme)
    : "original";
}

export function readStoredAppAppearanceTheme(): AppAppearanceTheme {
  if (typeof window === "undefined") return "original";
  try {
    return normalizeAppAppearanceTheme(
      window.localStorage.getItem(APP_APPEARANCE_THEME_STORAGE_KEY),
    );
  } catch {
    return "original";
  }
}

export function applyAppAppearanceTheme(value: unknown): AppAppearanceTheme {
  const theme = normalizeAppAppearanceTheme(value);
  if (typeof document !== "undefined") {
    document.documentElement.dataset.inrcyTheme = theme;
    document.documentElement.dataset.inrcyColorMode = isLightAppAppearanceTheme(theme)
      ? "light"
      : "dark";
  }
  return theme;
}

export function saveAppAppearanceTheme(value: unknown): AppAppearanceTheme {
  const theme = applyAppAppearanceTheme(value);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(APP_APPEARANCE_THEME_STORAGE_KEY, theme);
    } catch {}
    window.dispatchEvent(
      new CustomEvent(APP_APPEARANCE_THEME_EVENT, { detail: { theme } }),
    );
  }
  return theme;
}

export function clearStoredAppAppearanceTheme() {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(APP_APPEARANCE_THEME_STORAGE_KEY);
    } catch {}
  }
  applyAppAppearanceTheme("original");
}

export const APP_APPEARANCE_THEME_BOOT_SCRIPT = `(() => {
  try {
    const allowed = new Set(${JSON.stringify(APP_APPEARANCE_THEMES)});
    const stored = window.localStorage.getItem(${JSON.stringify(APP_APPEARANCE_THEME_STORAGE_KEY)});
    const theme = allowed.has(stored) ? stored : "original";
    document.documentElement.dataset.inrcyTheme = theme;
    document.documentElement.dataset.inrcyColorMode = theme === "pearl-light" || theme === "azure-light" ? "light" : "dark";
  } catch {
    document.documentElement.dataset.inrcyTheme = "original";
    document.documentElement.dataset.inrcyColorMode = "dark";
  }
})();`;
