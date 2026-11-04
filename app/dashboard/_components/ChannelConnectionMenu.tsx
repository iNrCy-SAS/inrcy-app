"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import styles from "../dashboard.module.css";
import bubbleStyles from "./DashboardChannelBubble.module.css";
import type { ChannelBubbleConnection } from "./channel-bubble.types";

type ConnectionOption = NonNullable<ChannelBubbleConnection["connectOptions"]>[number];

/** Enter/Space opens the disclosure; Tab visits its buttons or native OAuth links. */
export default function ChannelConnectionMenu({ label, info, options, disabled, onChoose, icon }: {
  label: string;
  info?: string;
  options: ConnectionOption[];
  disabled: boolean;
  onChoose: (option: ConnectionOption) => void;
  icon?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const id = useId();
  const infoId = `${id}-info`;
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const infoTrigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open && !infoOpen) return;
    const closeOutside = (event: MouseEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) { setOpen(false); setInfoOpen(false); }
    };
    // Capture Escape before the native dialog handles its cancel event.
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setInfoOpen(false);
      (infoOpen ? infoTrigger : trigger).current?.focus();
    };
    const closeAfterTab = (event: KeyboardEvent) => {
      if (event.key === "Tab" && !root.current?.contains(document.activeElement)) { setOpen(false); setInfoOpen(false); }
    };
    document.addEventListener("click", closeOutside);
    document.addEventListener("keydown", closeOnEscape, true);
    document.addEventListener("keyup", closeAfterTab);
    return () => {
      document.removeEventListener("click", closeOutside);
      document.removeEventListener("keydown", closeOnEscape, true);
      document.removeEventListener("keyup", closeAfterTab);
    };
  }, [open, infoOpen]);

  return <div ref={root} className={bubbleStyles.connectMenu}>
    <button ref={trigger} type="button" className={`${styles.actionBtn} ${styles.connectBtn}`} aria-expanded={open} aria-controls={id} disabled={disabled} onClick={() => { setInfoOpen(false); setOpen(value => !value); }} onKeyDown={event => {
      if (event.key === "ArrowDown") { event.preventDefault(); setInfoOpen(false); setOpen(true); }
    }}>{icon}<span>{label}</span><span aria-hidden="true">▾</span></button>
    {open ? <div id={id} role="group" aria-label={label} className={bubbleStyles.connectMenuChoices}>
      {options.map(option => option.href ? <a key={option.label} href={option.href} target="_top" aria-disabled={disabled} onClick={event => { if (disabled) event.preventDefault(); }}>{option.label}</a> : <button key={option.label} type="button" disabled={disabled} onClick={() => { setOpen(false); onChoose(option); }}>{option.label}</button>)}
    </div> : null}
    {info ? <button ref={infoTrigger} type="button" className={bubbleStyles.connectMenuInfo} aria-label={info} aria-expanded={infoOpen} aria-controls={infoId} onClick={() => { setOpen(false); setInfoOpen(value => !value); }}>i</button> : null}
    {info && infoOpen ? <div id={infoId} role="note" className={bubbleStyles.connectMenuInfoPanel}>{info}</div> : null}
  </div>;
}
