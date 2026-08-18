"use client";

import { useEffect } from "react";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";

import {
  appLanguageFromLocale,
  type AppLocale,
} from "@/i18n/config";
import { persistBrowserAppLocale } from "@/i18n/client-locale";
import { APP_LANGUAGE_EVENT } from "@/lib/appLanguage";

type Props = {
  children: React.ReactNode;
  locale: AppLocale;
  messages: AbstractIntlMessages;
};

export default function DashboardIntlProvider({ children, locale, messages }: Props) {
  useEffect(() => {
    const language = appLanguageFromLocale(locale);
    persistBrowserAppLocale(locale);

    window.dispatchEvent(new CustomEvent(APP_LANGUAGE_EVENT, {
      detail: { language, appLanguage: language },
    }));
  }, [locale]);

  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="Europe/Paris">
      {children}
    </NextIntlClientProvider>
  );
}
