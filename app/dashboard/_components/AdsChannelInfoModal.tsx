"use client";

import { useEffect, useId, useRef } from "react";
import { useTranslations } from "next-intl";
import type { AdsChannelId } from "@/lib/adsValidation";
import styles from "./AdsChannelInfoModal.module.css";

const CHANNELS = [
  { id: "google", name: "Google Ads" },
  { id: "pinterest", name: "Pinterest Ads" },
  { id: "meta", name: "Meta Ads" },
  { id: "linkedin", name: "LinkedIn Ads" },
  { id: "tiktok", name: "TikTok Ads" },
  { id: "x", name: "X Ads" },
  { id: "openai", name: "ChatGPT Ads" },
] as const satisfies readonly { id: AdsChannelId; name: string }[];

export default function AdsChannelInfoModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("dashboard.signatureTools.adsInfo");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus({ preventScroll: true });

    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  const closeDialog = () => {
    dialogRef.current?.close();
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); closeDialog(); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDialog();
      }}
    >
      <div className={styles.surface}>
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>iNr’ADS</span>
            <h2 id={titleId}>{t("title")}</h2>
          </div>
          <button ref={closeButtonRef} type="button" className={styles.close} onClick={closeDialog} aria-label={t("close")}>×</button>
        </header>
        <div className={styles.grid}>
          {CHANNELS.map((channel) => (
            <section className={styles.channel} key={channel.id}>
              <h3>{channel.name}</h3>
              <p>{t(channel.id)}</p>
            </section>
          ))}
        </div>
      </div>
    </dialog>
  );
}
