"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import styles from "./AgentSettingsMultiSelect.module.css";

type Option = { value: string; label: string; icon?: string; disabled?: boolean; description?: string };

export default function AgentSettingsMultiSelect(props: {
  label: string; options: Option[]; selected: string[]; disabled?: boolean;
  onToggle: (value: string) => void;
}) {
  const t = useTranslations("agent");
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const chosen = props.options.filter(option => props.selected.includes(option.value) && !option.disabled);
  const summary = chosen.length ? chosen.slice(0, 2).map(option => option.label).join(", ") : t("settings_selection_empty");

  function close(restoreFocus = false) {
    setPosition(null);
    if (restoreFocus) trigger.current?.focus();
  }

  function open() {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(Math.max(rect.width, 300), window.innerWidth - 24);
    const maxHeight = Math.min(430, window.innerHeight - 32);
    setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      top: Math.max(12, Math.min(rect.bottom + 7, window.innerHeight - maxHeight - 12)), width, maxHeight });
  }

  useEffect(() => {
    if (!position) return;
    panel.current?.querySelector<HTMLInputElement>("input:not(:disabled)")?.focus();
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) setPosition(null);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setPosition(null); trigger.current?.focus(); }
    };
    const resize = () => setPosition(null);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", resize);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", key); window.removeEventListener("resize", resize); };
  }, [position]);

  return <div className={styles.field}>
    <span id={`${id}-label`}>{props.label}</span>
    <button ref={trigger} type="button" className={styles.trigger} disabled={props.disabled}
      aria-labelledby={`${id}-label ${id}-value`} aria-expanded={Boolean(position)} aria-haspopup="dialog"
      aria-controls={position ? `${id}-panel` : undefined} onClick={() => position ? close() : open()}>
      <span className={styles.selection}>
        {chosen.some(option => option.icon) ? <span className={styles.logos} aria-hidden="true">{chosen.filter(option => option.icon).slice(0, 3).map(option => <span key={option.value} className={styles.logoBubble}><img src={option.icon} alt="" /></span>)}</span> : null}
        <span id={`${id}-value`} className={styles.value}>{summary}{chosen.length > 2 ? ` +${chosen.length - 2}` : ""}</span>
      </span>
      <span className={styles.count}>{chosen.length}</span><svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 7 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {position ? createPortal(<div ref={panel} id={`${id}-panel`} role="dialog" aria-label={props.label} className={styles.popover} style={position}>
      <div className={styles.options}>
        {props.options.map(option => <label key={option.value} data-disabled={option.disabled || undefined}>
          <input type="checkbox" checked={!option.disabled && props.selected.includes(option.value)} disabled={props.disabled || option.disabled}
            onChange={() => props.onToggle(option.value)} />
          {option.icon ? <span className={styles.logoBubble}><img src={option.icon} alt="" /></span> : null}<span>{option.label}</span>
          {option.disabled ? <small>{option.description || t("publication_channel_not_connected")}</small> : null}
        </label>)}
      </div>
    </div>, document.body) : null}
  </div>;
}
