"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import styles from "../dashboard.module.css";
import bubbleStyles from "./DashboardChannelBubble.module.css";
import type { ChannelBubbleConnection } from "./channel-bubble.types";

type ConnectionOption = NonNullable<ChannelBubbleConnection["connectOptions"]>[number];

/** A disclosure with normal buttons: Enter/Space opens it, Tab visits each choice. */
export default function ChannelConnectionMenu({ label, options, disabled, onChoose, icon }: {
  label: string;
  options: ConnectionOption[];
  disabled: boolean;
  onChoose: (option: ConnectionOption) => void;
  icon?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    // Capture Escape before the native dialog handles its cancel event.
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    const closeAfterTab = (event: KeyboardEvent) => {
      if (event.key === "Tab" && !root.current?.contains(document.activeElement)) setOpen(false);
    };
    document.addEventListener("click", closeOutside);
    document.addEventListener("keydown", closeOnEscape, true);
    document.addEventListener("keyup", closeAfterTab);
    return () => {
      document.removeEventListener("click", closeOutside);
      document.removeEventListener("keydown", closeOnEscape, true);
      document.removeEventListener("keyup", closeAfterTab);
    };
  }, [open]);

  return <div ref={root} className={bubbleStyles.connectMenu}>
    <button ref={trigger} type="button" className={`${styles.actionBtn} ${styles.connectBtn}`} aria-expanded={open} aria-controls={id} disabled={disabled} onClick={() => setOpen(value => !value)} onKeyDown={event => {
      if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); }
    }}>{icon}<span>{label}</span><span aria-hidden="true">▾</span></button>
    {open ? <div id={id} role="group" aria-label={label} className={bubbleStyles.connectMenuChoices}>
      {options.map(option => <button key={option.label} type="button" disabled={disabled} onClick={() => { setOpen(false); onChoose(option); }}>{option.label}</button>)}
    </div> : null}
  </div>;
}
