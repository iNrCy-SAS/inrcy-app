"use client";

import { useId, type KeyboardEvent } from "react";
import DashboardPremiumCrown from "../../_components/DashboardPremiumCrown";
import AgentSettingsPopover from "./AgentSettingsPopover";
import styles from "./AgentPremiumFrequencySelect.module.css";

type Option = { value: string; label: string; disabled: boolean };

function navigateOptions(event: KeyboardEvent<HTMLDivElement>) {
  const { key } = event;
  if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Home" && key !== "End") return;

  const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=option]:not(:disabled)"));
  if (!options.length) return;
  event.preventDefault();

  const focused = options.indexOf(event.currentTarget.ownerDocument.activeElement as HTMLButtonElement);
  if (key === "Home") options[0].focus();
  else if (key === "End") options.at(-1)?.focus();
  else if (focused < 0) options[key === "ArrowDown" ? 0 : options.length - 1].focus();
  else options[(focused + (key === "ArrowDown" ? 1 : -1) + options.length) % options.length].focus();
}

export default function AgentPremiumFrequencySelect({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  const selected = options.find(option => !option.disabled && option.value === value)
    ?? options.find(option => !option.disabled);

  return (
    <div className={styles.field}>
      <span id={`${id}-label`}>{label}</span>
      <AgentSettingsPopover
        label={label}
        labelledBy={`${id}-label ${id}-value`}
        triggerClassName={styles.trigger}
        panelClassName={styles.panel}
        triggerContent={<span id={`${id}-value`}>{selected?.label}</span>}
      >
        {(close) => (
          <div aria-labelledby={`${id}-label`} className={styles.options} role="listbox" onKeyDown={navigateOptions}>
            {options.map(option => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option === selected}
                tabIndex={-1}
                disabled={option.disabled}
                data-popover-initial-focus={option === selected ? "" : undefined}
                className={styles.option}
                onClick={() => {
                  if (option.value !== value) onChange(option.value);
                  close();
                }}
              >
                <span>{option.label}</span>
                {option.disabled ? <DashboardPremiumCrown className={styles.crown} /> : null}
              </button>
            ))}
          </div>
        )}
      </AgentSettingsPopover>
    </div>
  );
}
