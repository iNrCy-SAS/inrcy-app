"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import styles from "./subscriptionWorkspace.module.css";
import offerStyles from "./settingsContentLayout.module.css";
import { useInrAssistantLocalInterface } from "../../_hooks/useInrAssistantLocalInterface";

/** Long explanations remain available without extending the subscription overview. */
export function SubscriptionDetails({ title, children, open, onClose, assistantBilling = false }: {
  title: string;
  children: ReactNode;
  open?: boolean;
  onClose?: () => void;
  assistantBilling?: boolean;
}) {
  const t = useTranslations("settings");
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const openDetails = () => { const element = dialog.current; if (!element?.isConnected) throw new Error("Billing details unavailable"); if (!element.open) element.showModal(); setDialogOpen(element.open); };
  const closeDetails = () => { const element = dialog.current; if (!element?.isConnected) throw new Error("Billing details unavailable"); if (element.open) element.close(); setDialogOpen(element.open); };

  useEffect(() => {
    const element = dialog.current;
    if (!element || open === undefined) return;
    if (open && !element.open) { element.showModal(); setDialogOpen(element.open); }
    else if (!open && element.open) { element.close(); setDialogOpen(element.open); }
  }, [open]);
  useInrAssistantLocalInterface("subscription_details", { open: dialogOpen }, {
    open: { invoke: openDetails, matches: snapshot => Boolean(snapshot && typeof snapshot === "object" && "open" in snapshot && snapshot.open === true) },
    close: { invoke: closeDetails, matches: snapshot => Boolean(snapshot && typeof snapshot === "object" && "open" in snapshot && snapshot.open === false) },
  }, assistantBilling);

  return <>
    <button type="button" className={styles.detailsTrigger} aria-haspopup="dialog"
      onClick={openDetails}>{title}<span aria-hidden="true">↗</span></button>
    <dialog ref={dialog} className={styles.detailsDialog} role="dialog" aria-modal="true" aria-labelledby={id} onClose={() => { setDialogOpen(false); onClose?.(); }}
      onKeyDown={(event) => { if (event.key === "Escape") event.stopPropagation(); }}>
      <header><h2 id={id}>{title}</h2><button type="button" onClick={closeDetails}
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
