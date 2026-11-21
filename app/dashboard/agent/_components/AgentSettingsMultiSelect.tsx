"use client";

import { useId, type ReactNode } from "react";
import AgentSettingsPopover from "./AgentSettingsPopover";
import { useTranslations } from "next-intl";
import styles from "./AgentSettingsMultiSelect.module.css";

type Option = { value: string; label: string; icon?: string; disabled?: boolean; description?: string };

export default function AgentSettingsMultiSelect(props: {
  label: string; options: Option[]; selected: string[]; disabled?: boolean; icon?: ReactNode;
  onToggle: (value: string) => void;
}) {
  const t = useTranslations("agent");
  const id = useId();
  const chosen = props.options.filter(option => props.selected.includes(option.value) && !option.disabled);
  const summary = chosen.length ? chosen.slice(0, 2).map(option => option.label).join(", ") : t("settings_selection_empty");

  return <div className={styles.field}>
    <span id={`${id}-label`}>{props.icon ? <span aria-hidden="true">{props.icon}</span> : null}{props.label}</span>
    <AgentSettingsPopover label={props.label} labelledBy={`${id}-label ${id}-value`} disabled={props.disabled}
      triggerClassName={styles.trigger} panelClassName={styles.popover}
      triggerContent={<>
        <span className={styles.selection}>
          {chosen.some(option => option.icon) ? <span className={styles.logos} aria-hidden="true">{chosen.filter(option => option.icon).slice(0, 3).map(option => <span key={option.value} className={styles.logoBubble}><img src={option.icon} alt="" /></span>)}</span> : null}
          <span id={`${id}-value`} className={styles.value}>{summary}{chosen.length > 2 ? ` +${chosen.length - 2}` : ""}</span>
        </span>
        <span className={styles.count}>{chosen.length}</span><svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 7 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </>}>
      <div className={styles.options}>
        {props.options.map(option => <label key={option.value} data-disabled={option.disabled || undefined}>
          <input type="checkbox" checked={!option.disabled && props.selected.includes(option.value)} disabled={props.disabled || option.disabled}
            onChange={() => props.onToggle(option.value)} />
          {option.icon ? <span className={styles.logoBubble}><img src={option.icon} alt="" /></span> : null}<span>{option.label}</span>
          {option.disabled ? <small>{option.description || t("publication_channel_not_connected")}</small> : null}
        </label>)}
      </div>
    </AgentSettingsPopover>
  </div>;
}
