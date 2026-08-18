"use client";

import { useEffect, useRef, useState } from "react";

import { APP_LANGUAGE_OPTIONS, getAppLanguageOption, type AppLanguageCode } from "@/lib/appLanguage";
import { useDashboardLanguage } from "../_hooks/useDashboardLanguage";
import { useDashboardI18n } from "../_hooks/useDashboardI18n";
import styles from "../dashboard.module.css";

type Props = {
  mobile?: boolean;
  compact?: boolean;
  onOpen?: () => void;
};

export default function LanguageSelector({ mobile = false, compact = false, onOpen }: Props) {
  const { language, setLanguage } = useDashboardLanguage();
  const t = useDashboardI18n();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const current = getAppLanguageOption(language);


  useEffect(() => {
    if (typeof window === "undefined") return;
    APP_LANGUAGE_OPTIONS.forEach((option) => {
      const image = new window.Image();
      image.decoding = "async";
      image.src = option.flagSrc;
    });
  }, []);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (wrapRef.current?.contains(target)) return;
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const selectLanguage = (nextLanguage: AppLanguageCode) => {
    setOpen(false);
    void setLanguage(nextLanguage);
  };

  return (
    <div className={`${styles.languageSelectorWrap} ${mobile ? styles.languageSelectorWrapMobile : ""}`.trim()} ref={wrapRef}>
      <button
        type="button"
        className={`${styles.languageSelectorBtn} ${mobile ? styles.languageSelectorBtnMobile : ""} ${compact ? styles.languageSelectorBtnCompact : ""}`.trim()}
        aria-label={t.language.buttonAria}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t.language.buttonTitle}
        onClick={() => {
          setOpen((value) => {
            const nextOpen = !value;
            if (nextOpen) onOpen?.();
            return nextOpen;
          });
        }}
      >
        <img
          className={styles.languageFlag}
          src={current.flagSrc}
          alt={current.flag}
          width={24}
          height={24}
          loading="eager"
          decoding="async"
        />
        {!mobile && !compact ? <span className={styles.languageShort}>{current.shortLabel}</span> : null}
        <span className={styles.languageChevron} aria-hidden>▾</span>
      </button>

      {open && (
        <div
          className={`${styles.languageSelectorPanel} ${mobile ? styles.languageSelectorPanelMobile : ""}`.trim()}
          role="menu"
          aria-label={t.language.panelAria}
        >
          {APP_LANGUAGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === current.value}
              className={`${styles.languageSelectorItem} ${option.value === current.value ? styles.languageSelectorItemActive : ""}`.trim()}
              onClick={() => selectLanguage(option.value)}
            >
              <img
                className={styles.languageItemFlag}
                src={option.flagSrc}
                alt={option.flag}
                width={24}
                height={24}
                loading="eager"
                decoding="async"
              />
              <span className={styles.languageItemLabel}>{option.label}</span>
              <span className={styles.languageItemShort}>{option.shortLabel}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
