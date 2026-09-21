"use client";

import type { ReactNode } from "react";
import { useId } from "react";

import styles from "./ChannelSettingsSteps.module.css";

type ChannelAccent = "pinterest" | "x" | "youtube";

type ChannelSettingsStepProps = {
  step: number;
  title: string;
  description: string;
  accent: ChannelAccent;
  status?: ReactNode;
  children: ReactNode;
};

export default function ChannelSettingsStep({
  step,
  title,
  description,
  accent,
  status,
  children,
}: ChannelSettingsStepProps) {
  const titleId = useId();

  return (
    <section
      className={`${styles.stepCard} ${styles[accent]}`}
      aria-labelledby={titleId}
    >
      <div className={styles.stepHeader}>
        <span className={styles.stepNumber} aria-hidden="true">
          {String(step).padStart(2, "0")}
        </span>
        <div className={styles.stepCopy}>
          <h3 id={titleId} className={styles.stepTitle}>
            {title}
          </h3>
          <p className={styles.stepDescription}>{description}</p>
        </div>
        {status ? <div className={styles.stepStatus}>{status}</div> : null}
      </div>
      <div className={styles.stepBody}>{children}</div>
    </section>
  );
}

export function ChannelSettingsHint({
  children,
  icon = "✦",
}: {
  children: ReactNode;
  icon?: string;
}) {
  return (
    <div className={styles.hint}>
      <span className={styles.hintIcon} aria-hidden="true">
        {icon}
      </span>
      <div>{children}</div>
    </div>
  );
}
