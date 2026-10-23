"use client";

import { useId, useRef, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import type { ChannelMailboxSlot } from "./channel-bubble.types";
import styles from "./DashboardChannelBubble.module.css";
import { getChannelPopoverPlacement } from "./channel-popover-position";

type SlotProps = { slot: ChannelMailboxSlot; disabled?: boolean; onAction: (action: () => unknown | Promise<unknown>) => void };

export function MailboxConnectionButton({ slot, disabled, onAction }: SlotProps) {
  const t = useTranslations("dashboard.channelBubble");
  const id = `${useId()}-${slot.number}`;
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>({});
  const place = () => { if (trigger.current) setPosition(getChannelPopoverPlacement(trigger.current, menu.current, 300)); };
  const actions = slot.address ? [
    ...(slot.onConfigure ? [{ label: `${t("parameters")} IMAP`, action: slot.onConfigure }] : []),
    ...(slot.needsUpdate && slot.onReconnect ? [{ label: t("reconnect"), action: slot.onReconnect }] : []),
    ...(slot.onDisconnect ? [{ label: t("disconnect"), action: slot.onDisconnect, danger: true }] : []),
  ] : slot.connectOptions.map(option => ({ label: option.label, action: option.onConnect }));
  const directConnect = !slot.address && actions.length === 1;
  const label = slot.address || t("connect");
  const accessibleLabel = `${t("mailboxSlot", { number: slot.number })} — ${slot.address || `${t("connect")} ${slot.provider}`}${slot.statusLabel ? ` — ${slot.statusLabel}` : ""}`;
  return <>
    <button ref={trigger} type="button" className={styles.mailboxSlot} data-state={slot.address ? slot.needsUpdate ? "warning" : "connected" : "empty"} disabled={disabled || slot.disabled || !actions.length} popoverTarget={!directConnect && actions.length ? id : undefined} title={accessibleLabel} aria-label={accessibleLabel} onClick={directConnect ? () => onAction(actions[0].action) : undefined}>
      <span className={styles.mailboxSlotLabel}>{slot.address ? <span className={styles.mailboxSlotDot} aria-hidden="true" /> : <span aria-hidden="true">＋</span>}<strong>{label}</strong></span>
      <span className={styles.mailboxSlotProvider}>{slot.provider}</span>
    </button>
    {!directConnect && actions.length ? <div ref={menu} id={id} popover="auto" role="group" aria-label={accessibleLabel} className={`${styles.typesMenu} ${styles.mailboxMenu}`} style={position} onBeforeToggle={event => {
      if (event.newState !== "open") return;
      place();
    }} onToggle={event => { if (event.newState === "open") place(); }}>
      <header className={styles.popoverHeader}><strong>{slot.address || `${t("mailboxSlot", { number: slot.number })} — ${t("connect")}`}</strong><button type="button" popoverTarget={id} popoverTargetAction="hide" aria-label={t("close")}>×</button></header>
      {slot.statusLabel ? <p className={styles.typesHint}>{slot.provider} — {slot.statusLabel}</p> : null}
      <div className={styles.mailboxActions}>{actions.map(action => <button key={action.label} type="button" disabled={disabled || slot.disabled} data-danger={"danger" in action && action.danger ? "true" : undefined} onClick={() => { menu.current?.hidePopover(); onAction(action.action); }}>{"danger" in action && action.danger ? <span aria-hidden="true">× </span> : null}{action.label}</button>)}</div>
    </div> : null}
  </>;
}

export default function ChannelMailboxConnections({ slots, disabled, onAction }: { slots: ChannelMailboxSlot[]; disabled?: boolean; onAction: SlotProps["onAction"] }) {
  const t = useTranslations("dashboard.channelBubble");
  return <div className={styles.mailboxGrid} role="group" aria-label={t("mailboxes")}>
    {slots.slice(0, 4).map(slot => <MailboxConnectionButton key={slot.number} slot={slot} disabled={disabled} onAction={onAction} />)}
  </div>;
}
