"use client";

import { useId } from "react";
import AgentSettingsPopover from "./AgentSettingsPopover";
import styles from "./AgentSchedulePopover.module.css";

type ScheduleSlot = { day: string; time: string };

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
  return <AgentSettingsPopover label={props.label} disabled={props.disabled}
    triggerClassName={styles.trigger} panelClassName={styles.popover}
    triggerContent={open => <>
      <span>{props.label}</span>
      <span className={styles.toggle} aria-hidden="true">{open ? "−" : "+"}</span>
    </>}>
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
  </AgentSettingsPopover>;
}
