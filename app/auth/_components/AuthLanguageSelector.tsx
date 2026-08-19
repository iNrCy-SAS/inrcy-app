"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";

import { persistBrowserAppLocale } from "@/i18n/client-locale";
import { APP_LANGUAGE_TO_LOCALE, appLanguageFromLocale } from "@/i18n/config";
import {
  APP_LANGUAGE_OPTIONS,
  getAppLanguageOption,
  type AppLanguageCode,
} from "@/lib/appLanguage";

type Props = {
  className?: string;
};

export default function AuthLanguageSelector({ className = "" }: Props) {
  const locale = useLocale();
  const t = useTranslations("auth.language");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const current = getAppLanguageOption(appLanguageFromLocale(locale));

  useEffect(() => {
    if (!open) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node | null)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const selectLanguage = (language: AppLanguageCode) => {
    persistBrowserAppLocale(APP_LANGUAGE_TO_LOCALE[language]);
    const url = new URL(window.location.href);
    url.searchParams.set("lang", language);
    window.location.replace(url.toString());
  };

  return (
    <div
      ref={wrapRef}
      className={`fixed right-4 top-4 z-[100] ${className}`.trim()}
    >
      <button
        type="button"
        aria-label={t("buttonAria")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-11 min-w-14 items-center justify-center gap-2 rounded-xl border border-white/30 bg-slate-950/85 px-3 text-white shadow-xl backdrop-blur transition hover:bg-slate-900"
      >
        <Image
          src={current.flagSrc}
          alt={current.flag}
          width={24}
          height={24}
          className="h-6 w-6 rounded-sm object-cover"
        />
        <span aria-hidden="true" className="text-xs text-slate-300">
          ▾
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={t("menuAria")}
          className="absolute right-0 mt-2 w-48 overflow-hidden rounded-2xl border border-white/15 bg-slate-950/95 p-1.5 text-white shadow-2xl backdrop-blur"
        >
          {APP_LANGUAGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === current.value}
              onClick={() => selectLanguage(option.value)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition hover:bg-white/10 ${
                option.value === current.value ? "bg-white/10" : ""
              }`}
            >
              <Image
                src={option.flagSrc}
                alt={option.flag}
                width={24}
                height={24}
                className="h-6 w-6 rounded-sm object-cover"
              />
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
