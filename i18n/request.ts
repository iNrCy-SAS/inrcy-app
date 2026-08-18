import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import {
  APP_LOCALE_COOKIE,
  DEFAULT_APP_LOCALE,
  LEGACY_APP_LOCALE_COOKIE,
  appLocaleFromAcceptLanguage,
  tryNormalizeAppLocale,
} from "./config";
import { loadAppMessages } from "./messages";

export default getRequestConfig(async () => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const locale =
    tryNormalizeAppLocale(cookieStore.get(APP_LOCALE_COOKIE)?.value) ||
    tryNormalizeAppLocale(cookieStore.get(LEGACY_APP_LOCALE_COOKIE)?.value) ||
    appLocaleFromAcceptLanguage(headerStore.get("accept-language")) ||
    DEFAULT_APP_LOCALE;

  return {
    locale,
    messages: await loadAppMessages(locale),
    timeZone: "Europe/Paris",
  };
});
