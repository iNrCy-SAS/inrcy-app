"use client";

import { Suspense, useEffect, useId, useRef, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import styles from "./ChannelParametersDialog.module.css";
// Keep dialog styles ready while the selected channel controller loads lazily.
import "../settings/_components/ChannelSettingsSteps.module.css";
import "../settings/_components/MailsSettingsContent.module.css";
import "../settings/_components/MailsSignaturePanel.module.css";
import "../settings/_components/InrSearchSettingsContent.module.css";

export default function ChannelParametersDialog({ name, title, children, onClose, fullScreen = false, contentOnly = false, layout }: { name: string; title?: string; children: ReactNode; onClose: () => void; fullScreen?: boolean; contentOnly?: boolean; layout?: "compact" | "reviews" }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const t = useTranslations("dashboard.channelBubble");
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    const ownsScrollLock = overflow !== "hidden";
    dialog?.showModal();
    if (ownsScrollLock) document.body.style.overflow = "hidden";
    return () => { dialog?.close(); if (ownsScrollLock) document.body.style.overflow = overflow; if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={ref} className={`${styles.dialog} ${fullScreen ? styles.fullScreen : ""} ${contentOnly ? styles.contentOnly : ""} ${layout ? styles[layout] : ""}`} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
  }}>
    {contentOnly ? <><h2 id={titleId} className={styles.srOnly}>{title || `${t("parameters")} — ${name}`}</h2><button type="button" className={styles.floatingClose} aria-label={t("close")} onClick={onClose} autoFocus>×</button></> : <header className={styles.header}><h2 id={titleId}>{title || `${t("parameters")} — ${name}`}</h2><button type="button" aria-label={t("close")} onClick={onClose} autoFocus>×</button></header>}
    <div className={styles.content}><Suspense fallback={<p role="status">{t("loading")}</p>}>{children}</Suspense></div>
  </dialog>;
}
