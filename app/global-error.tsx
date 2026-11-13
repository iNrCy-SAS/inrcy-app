"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect, useSyncExternalStore } from "react";
import { createTranslator } from "next-intl";
import { APP_LOCALE_COOKIE, APP_LOCALE_QUERY_PARAMS, DEFAULT_APP_LOCALE, appLocaleFromAcceptLanguage, htmlLanguageFromLocale, tryNormalizeAppLocale } from "@/i18n/config";
import { APP_LANGUAGE_EVENT, APP_LANGUAGE_STORAGE_KEY } from "@/lib/appLanguage";
import fr from "@/messages/fr-FR/public.json";
import en from "@/messages/en-GB/public.json";
import es from "@/messages/es-ES/public.json";
import it from "@/messages/it-IT/public.json";
import de from "@/messages/de-DE/public.json";
import nl from "@/messages/nl-NL/public.json";
import pt from "@/messages/pt-PT/public.json";
import th from "@/messages/th-TH/public.json";
import zh from "@/messages/zh-CN/public.json";

const messages = { "fr-FR": fr, "en-GB": en, "es-ES": es, "it-IT": it, "de-DE": de, "nl-NL": nl, "pt-PT": pt, "th-TH": th, "zh-CN": zh };
function browserLocale() {
  try {
    const params = new URLSearchParams(window.location.search);
    for (const key of APP_LOCALE_QUERY_PARAMS) {
      const explicit = tryNormalizeAppLocale(params.get(key));
      if (explicit) return explicit;
    }
  } catch { /* Browser preferences remain available without a usable URL. */ }
  try {
    const cookie = document.cookie.split(";").map(value => value.trim()).find(value => value.startsWith(`${APP_LOCALE_COOKIE}=`));
    const explicit = cookie ? tryNormalizeAppLocale(decodeURIComponent(cookie.slice(APP_LOCALE_COOKIE.length + 1))) : null;
    if (explicit) return explicit;
  } catch { /* The fallback must also render when cookie access fails. */ }
  try {
    const stored = tryNormalizeAppLocale(window.localStorage.getItem(APP_LANGUAGE_STORAGE_KEY));
    if (stored) return stored;
  } catch { /* Storage can be unavailable on the error page. */ }
  const htmlLocale = typeof document === "undefined" ? null : tryNormalizeAppLocale(document.documentElement.lang);
  if (htmlLocale && htmlLocale !== DEFAULT_APP_LOCALE) return htmlLocale;
  return (typeof navigator === "undefined" ? null : appLocaleFromAcceptLanguage(navigator.languages?.join(",") || navigator.language)) || htmlLocale || DEFAULT_APP_LOCALE;
}
function subscribeLocale(callback: () => void) {
  window.addEventListener(APP_LANGUAGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => { window.removeEventListener(APP_LANGUAGE_EVENT, callback); window.removeEventListener("storage", callback); };
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // A root-layout failure can remove NextIntlClientProvider itself.
  const locale = useSyncExternalStore(subscribeLocale, browserLocale, () => DEFAULT_APP_LOCALE);
  const i18nT = createTranslator({ locale, messages: { public: messages[locale] }, namespace: "public" });
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang={htmlLanguageFromLocale(locale)}>
      <body style={{ margin: 0, fontFamily: "Inter, Arial, sans-serif", background: "#081226", color: "#fff" }}>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ maxWidth: 560, width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 24, padding: 28, boxShadow: "0 20px 60px rgba(0,0,0,0.28)" }}>
            <div style={{ fontSize: 14, opacity: 0.75, marginBottom: 8 }}>iNrCy</div>
            <h1 style={{ margin: "0 0 12px", fontSize: 28, lineHeight: 1.15 }}>{i18nT("global_error_title")}</h1>
            <p style={{ margin: 0, fontSize: 16, lineHeight: 1.6, opacity: 0.92 }}>
              {i18nT("global_error_description")}
            </p>
            <div style={{ display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
              <button
                onClick={() => reset()}
                style={{ border: 0, borderRadius: 14, padding: "12px 16px", fontWeight: 700, cursor: "pointer" }}
              >
                {i18nT("reessayer_895d416b")}
              </button>
              <a
                href="/dashboard"
                style={{ color: "#fff", textDecoration: "none", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 14, padding: "12px 16px", fontWeight: 700 }}
              >
                {i18nT("global_error_back_dashboard")}
              </a>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
