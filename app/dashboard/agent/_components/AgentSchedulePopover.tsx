"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./AgentSchedulePopover.module.css";

type ScheduleSlot = { day: string; time: string };
type Position = {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
};

export default function AgentSchedulePopover(props: {
  label: string;
  dayLabel: string;
  timeLabel: string;
  slots: ScheduleSlot[];
  dayOptions: Array<{ value: string; label: string }>;
  timeOptions: readonly string[];
  fixedDays?: boolean;
  disabled?: boolean;
  onChange: (index: number, patch: { day?: string; time?: string }) => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Position | null>(null);

  function open() {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect || props.disabled) return;
    const margin = 12;
    const gap = 7;
    const width = Math.min(Math.max(rect.width, 300), window.innerWidth - margin * 2);
    const below = Math.max(0, window.innerHeight - rect.bottom - gap - margin);
    const above = Math.max(0, rect.top - gap - margin);
    const placeBelow = below >= 180 || (above < 80 && below > above);
    const maxHeight = Math.min(420, placeBelow ? below : above);
    setPosition({
      left: Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin)),
      width,
      maxHeight,
      ...(placeBelow ? { top: Math.max(margin, rect.bottom + gap) } : { bottom: Math.max(margin, window.innerHeight - rect.top + gap) }),
    });
  }

  useEffect(() => {
    if (!position) return;
    const focusTarget = panel.current?.querySelector<HTMLSelectElement>("select:not(:disabled)");
    (focusTarget || panel.current)?.focus({ preventScroll: true });

    const close = (restoreFocus = false) => {
      setPosition(null);
      if (restoreFocus) trigger.current?.focus({ preventScroll: true });
    };
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !panel.current?.contains(target) && !trigger.current?.contains(target)) close(true);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
      }
    };
    const resize = () => close();
    const scroll = (event: Event) => {
      if (event.target instanceof Node && panel.current?.contains(event.target)) return;
      close();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", resize);
    window.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [position]);

  return <>
    <button ref={trigger} type="button" className={styles.trigger} disabled={props.disabled}
      aria-expanded={Boolean(position)} aria-haspopup="dialog"
      aria-controls={position ? `${id}-panel` : undefined}
      onClick={() => position ? setPosition(null) : open()}>
      <span>{props.label}</span>
      <span className={styles.toggle} aria-hidden="true">{position ? "−" : "+"}</span>
    </button>
    {position ? createPortal(
      <div ref={panel} id={`${id}-panel`} role="dialog" aria-label={props.label}
        tabIndex={-1} className={styles.popover} style={position}>
        <div className={styles.heading} aria-hidden="true"><span>{props.dayLabel}</span><span>{props.timeLabel}</span></div>
        <div className={styles.rows}>
          {props.slots.map((slot, index) => <div className={styles.row} key={index}>
            <label className={styles.field} htmlFor={`${id}-day-${index}`}>
              <span className={styles.srOnly}>{props.dayLabel} {index + 1}</span>
              {props.fixedDays ? <output id={`${id}-day-${index}`} className={styles.fixedDay}>{props.dayOptions.find(option => option.value === slot.day)?.label || slot.day}</output>
                : <select id={`${id}-day-${index}`} value={slot.day} disabled={props.disabled} onChange={event => props.onChange(index, { day: event.target.value })}>
                  {props.dayOptions.map(option => <option key={option.value} value={option.value}
                    disabled={option.value !== slot.day && props.slots.some((candidate, selectedIndex) => selectedIndex !== index && candidate.day === option.value)}>
                    {option.label}
                  </option>)}
                </select>}
            </label>
            <label className={styles.field} htmlFor={`${id}-time-${index}`}>
              <span className={styles.srOnly}>{props.timeLabel} {index + 1}</span>
              <select id={`${id}-time-${index}`} value={slot.time} disabled={props.disabled} onChange={event => props.onChange(index, { time: event.target.value })}>
                {props.timeOptions.map(time => <option key={time} value={time}>{time}</option>)}
              </select>
            </label>
          </div>)}
        </div>
      </div>, document.body
    ) : null}
  </>;
}
