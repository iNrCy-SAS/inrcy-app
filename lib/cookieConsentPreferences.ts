export type CookieConsentPreferences = { v: 1; ts: number; analytics: boolean };
export const COOKIE_CONSENT_STORAGE_KEY = "inrcy_cookie_consent";
export function parseCookieConsent(raw: string | null): CookieConsentPreferences | null {
  try { const value = raw ? JSON.parse(raw) : null; return value?.v === 1 && typeof value.ts === "number" && Number.isFinite(value.ts) && typeof value.analytics === "boolean" ? { v: 1, ts: value.ts, analytics: value.analytics } : null; } catch { return null; }
}
export function cookieConsentSnapshot(): string | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY); } catch { return null; }
}
export function subscribeCookieConsent(onChange: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("storage", onChange); window.addEventListener("inrcy:cookie-consent", onChange);
  return () => { window.removeEventListener("storage", onChange); window.removeEventListener("inrcy:cookie-consent", onChange); };
}
/** The native banner, RGPD control and assistant share one versioned browser preference. */
export function setCookieAnalyticsPreference(analytics: boolean): boolean {
  if (typeof window === "undefined") return false;
  try { const next: CookieConsentPreferences = { v: 1, ts: Date.now(), analytics }; window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(next));
    const saved = parseCookieConsent(cookieConsentSnapshot()); if (saved?.analytics !== analytics) return false;
    window.dispatchEvent(new CustomEvent("inrcy:cookie-consent", { detail: next })); return true;
  } catch { return false; }
}
