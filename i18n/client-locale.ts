"use client";

import { APP_LANGUAGE_STORAGE_KEY } from "@/lib/appLanguage";

import {
  APP_LOCALE_COOKIE,
  APP_LOCALE_COOKIE_MAX_AGE,
  APP_LOCALE_SHARED_DOMAIN,
  LEGACY_APP_LOCALE_COOKIE,
  appLanguageFromLocale,
  htmlLanguageFromLocale,
  normalizeAppLocale,
  type AppLocale,
} from "./config";

function sharedCookieAttributes() {
  const hostname = window.location.hostname.toLowerCase();
  const isInrcyDomain = hostname === "inrcy.com" || hostname.endsWith(".inrcy.com");
  const domain = isInrcyDomain ? `; Domain=${APP_LOCALE_SHARED_DOMAIN}` : "";
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  return `${domain}${secure}; SameSite=Lax; Path=/`;
}

export function persistBrowserAppLocale(value: unknown): AppLocale {
  const locale = normalizeAppLocale(value);
  const language = appLanguageFromLocale(locale);
  const attributes = sharedCookieAttributes();

  document.documentElement.lang = htmlLanguageFromLocale(locale);
  document.cookie = `${APP_LOCALE_COOKIE}=${encodeURIComponent(locale)}; Max-Age=${APP_LOCALE_COOKIE_MAX_AGE}${attributes}`;
  document.cookie = `${LEGACY_APP_LOCALE_COOKIE}=; Max-Age=0${attributes}`;

  try {
    window.localStorage.setItem(APP_LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Le cookie partagé reste la source locale si le stockage est indisponible.
  }

  return locale;
}
