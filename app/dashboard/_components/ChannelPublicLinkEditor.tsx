"use client";

import { useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import styles from "./DashboardChannelBubble.module.css";
import { getChannelPopoverPlacement } from "./channel-popover-position";

/** One explicit action: edit the public destination used by the eye button. */
export default function ChannelPublicLinkEditor({ name, children, disabled }: { name: string; children: ReactNode; disabled?: boolean }) {
  const t = useTranslations("dashboard.channelBubble");
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>({});
  const place = () => { if (trigger.current) setPosition(getChannelPopoverPlacement(trigger.current, menu.current, 420)); };
  return <>
    <button ref={trigger} type="button" className={styles.iconAction} popoverTarget={id} disabled={disabled} aria-label={`${t("editPublicLink")} — ${name}`} title={t("editPublicLink")}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m14 4 2-2a3 3 0 0 1 4 4l-9 9-5 1 1-5 7-7Zm1-1 4 4M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7" /></svg>
      <span className={styles.actionText} aria-hidden="true">{t("linkShort")}</span>
    </button>
    <div ref={menu} id={id} popover="auto" className={`${styles.typesMenu} ${styles.linkEditor}`} role="group" aria-label={`${t("editPublicLink")} — ${name}`} style={position} onBeforeToggle={event => { if (event.newState === "open") place(); }} onToggle={event => { if (event.newState === "open") place(); }}>
      <header className={styles.popoverHeader}><strong>{t("editPublicLink")}</strong><button type="button" popoverTarget={id} popoverTargetAction="hide" aria-label={t("close")}>×</button></header>
      <div className={styles.publicLinkFields}>{children}</div>
    </div>
  </>;
}
