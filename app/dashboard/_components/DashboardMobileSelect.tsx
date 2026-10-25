"use client";

import type { ReactNode } from "react";
import styles from "./DashboardMobileSelect.module.css";

type DashboardMobileOption<TValue extends string> = {
  value: TValue;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
};

type DashboardMobileSelectProps<TValue extends string> = {
  value: TValue;
  options: readonly DashboardMobileOption<TValue>[];
  onChange: (value: TValue) => void;
  ariaLabel: string;
  controls?: string;
  describedBy?: string;
  disabled?: boolean;
};

/** Compact mobile navigation; its owner keeps routing and exit guards authoritative. */
export default function DashboardMobileSelect<TValue extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  controls,
  describedBy,
  disabled = false,
}: DashboardMobileSelectProps<TValue>) {
  const activeOption = options.find((option) => option.value === value);

  return (
    <div className={styles.navigation} data-has-icon={Boolean(activeOption?.icon)}>
      {activeOption?.icon ? <span className={styles.icon} aria-hidden="true">{activeOption.icon}</span> : null}
      <select
        className={styles.select}
        aria-label={ariaLabel}
        aria-controls={controls}
        aria-describedby={describedBy}
        disabled={disabled}
        value={value}
        onChange={(event) => {
          const destination = options.find((option) => option.value === event.currentTarget.value);
          if (!disabled && destination && !destination.disabled && destination.value !== value) onChange(destination.value);
        }}
      >
        {options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
      </select>
      <svg className={styles.chevron} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
    </div>
  );
}
