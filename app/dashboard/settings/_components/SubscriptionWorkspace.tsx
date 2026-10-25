"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import styles from "./subscriptionWorkspace.module.css";
import offerStyles from "./settingsContentLayout.module.css";

/** Long explanations remain available without extending the subscription overview. */
export function SubscriptionDetails({ title, children, open, onClose }: {
  title: string;
  children: ReactNode;
  open?: boolean;
  onClose?: () => void;
}) {
  const t = useTranslations("settings");
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element || open === undefined) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);

  return <>
    <button type="button" className={styles.detailsTrigger} aria-haspopup="dialog"
      onClick={() => dialog.current?.showModal()}>{title}<span aria-hidden="true">↗</span></button>
    <dialog ref={dialog} className={styles.detailsDialog} role="dialog" aria-modal="true" aria-labelledby={id} onClose={onClose}
      onKeyDown={(event) => { if (event.key === "Escape") event.stopPropagation(); }}>
      <header><h2 id={id}>{title}</h2><button type="button" onClick={() => dialog.current?.close()}
        aria-label={t("fermer_5ab4ec64")} title={t("fermer_5ab4ec64")}>×</button></header>
      <div className={styles.detailsBody}>{children}</div>
    </dialog>
  </>;
}

export default function SubscriptionWorkspace({ children, management, notice, className, layout = "compact" }: {
  children: ReactNode;
  management?: ReactNode;
  notice?: ReactNode;
  className?: string;
  layout?: "compact" | "offers";
}) {
  if (layout === "offers") return <div className={offerStyles.workspace}>
    {notice}
    {children}
    {management ? <div className={styles.offerManagement}>{management}</div> : null}
  </div>;
  return <div className={`${styles.workspace} ${className ?? ""}`}>
    {notice}
    <div className={management ? styles.subscriptionLayout : undefined}>
      <div className={styles.overview}>{children}</div>
      {management}
    </div>
  </div>;
}
