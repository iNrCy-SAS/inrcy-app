"use client";

import { useTranslations } from "next-intl";


import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./badge.module.css";
import { getInrBadgeTexts, normalizeInrBadgeLanguage, type InrBadgeLanguageCode } from "@/lib/inrBadgeLanguage";

type Props = {
  publicUrl: string;
  company: string;
  language?: InrBadgeLanguageCode;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function isStandaloneMode() {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)")?.matches || nav.standalone === true;
}

function detectPlatform() {
  if (typeof navigator === "undefined") return { ios: false, android: false, safari: false };
  const ua = navigator.userAgent || "";
  const ios = /iPhone|iPad|iPod/i.test(ua);
  const android = /Android/i.test(ua);
  const safari = /Safari/i.test(ua) && !/Chrome|CriOS|EdgiOS|FxiOS|OPiOS/i.test(ua);
  return { ios, android, safari };
}

export default function BadgeShareButton({ publicUrl, company, language }: Props) {
  const i18nT = useTranslations("public");
  const badgeText = getInrBadgeTexts(normalizeInrBadgeLanguage(language));
  const [open, setOpen] = useState(false);
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [helperText, setHelperText] = useState("");
  const platform = useMemo(() => detectPlatform(), []);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPromptEvent(event as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  }, []);


  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  async function handleNativeShare() {
    try {
      if (navigator.share) {
        await navigator.share({ title: company || "iNr'Badge", text: i18nT("value_value_inr_badge_3b39f90f", { value0: badgeText.shareTextPrefix, value1: company || "iNr'Badge" }), url: publicUrl });
      } else {
        await navigator.clipboard.writeText(publicUrl);
        setHelperText(badgeText.linkCopied);
      }
    } catch {
      // utilisateur a annulé ou navigateur indisponible
    }
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setHelperText(badgeText.linkCopiedClipboard);
    } catch {
      setHelperText(badgeText.copyUnavailable);
    }
  }

  async function handleInstall() {
    if (isStandaloneMode()) {
      setHelperText(badgeText.alreadyInstalled);
      return;
    }

    if (installPromptEvent) {
      try {
        await installPromptEvent.prompt();
        await installPromptEvent.userChoice;
        setHelperText(badgeText.installRequested);
      } catch {
        setHelperText(badgeText.installFailed);
      }
      return;
    }

    if (platform.ios && platform.safari) {
      setHelperText(badgeText.iosInstallHelp);
      return;
    }

    setHelperText(badgeText.androidInstallHelp);
  }


  function handleClosePage() {
    window.close();
    window.setTimeout(() => {
      if (!window.closed && document.visibilityState === "visible") {
        window.history.back();
      }
    }, 120);
  }

  function openSheet() {
    setHelperText("");
    setOpen(true);
  }

  function closeSheet() {
    setOpen(false);
    setHelperText("");
  }

  return (
    <>
      <div className={styles.floatingActions}>
        <button type="button" className={styles.shareButton} onClick={openSheet} aria-label={badgeText.shareAria} title={badgeText.shareTitle}>
          <span className={styles.shareGlyph} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M15.5 8.5L8.5 12" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M15.5 15.5L8.5 12" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
              <circle cx="18" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.9"/>
              <circle cx="6" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.9"/>
              <circle cx="18" cy="17" r="2.5" stroke="currentColor" strokeWidth="1.9"/>
            </svg>
          </span>
        </button>
        <button type="button" className={`${styles.closePageButton} ${styles.iconActionButton}`} onClick={handleClosePage} aria-label={badgeText.close} title={badgeText.close}>×</button>
      </div>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div className={styles.sheetLayer} aria-hidden={false}>
              <button type="button" className={styles.sheetBackdrop} aria-label={badgeText.close} onClick={closeSheet} />
              <div className={styles.sheet} role="dialog" aria-modal="true" aria-label={badgeText.shareAria}>
                <div className={styles.sheetHandle} />
                <div className={styles.sheetHeader}>
                  <div>
                    <strong>{badgeText.shareSheetTitle}</strong>
                    <p>{badgeText.shareSheetDescription}</p>
                  </div>
                  <button type="button" className={styles.sheetClose} onClick={closeSheet} aria-label={badgeText.close}>
                    ×
                  </button>
                </div>

                <div className={styles.sheetActions}>
                  <button type="button" className={styles.sheetAction} onClick={handleNativeShare}>
                    <span className={`${styles.sheetActionIcon} ${styles.shareTone}`}>
                      <span className={styles.shareGlyph}>
                        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M15.5 8.5L8.5 12" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M15.5 15.5L8.5 12" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
                          <circle cx="18" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.9"/>
                          <circle cx="6" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.9"/>
                          <circle cx="18" cy="17" r="2.5" stroke="currentColor" strokeWidth="1.9"/>
                        </svg>
                      </span>
                    </span>
                    <span>
                      {badgeText.shareNative}
                      <small>{badgeText.shareNativeHelper}</small>
                    </span>
                  </button>

                  <button type="button" className={styles.sheetAction} onClick={handleCopyLink}>
                    <span className={`${styles.sheetActionIcon} ${styles.copyTone}`}>⧉</span>
                    <span>
                      {badgeText.copyLink}
                      <small>{badgeText.copyLinkHelper}</small>
                    </span>
                  </button>

                  <button type="button" className={styles.sheetAction} onClick={handleInstall}>
                    <span className={`${styles.sheetActionIcon} ${styles.installTone}`}>＋</span>
                    <span>
                      {badgeText.install}
                      <small>{badgeText.installHelper}</small>
                    </span>
                  </button>
                </div>

                {helperText ? <div className={styles.sheetHelper}>{helperText}</div> : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
