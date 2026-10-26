"use client";

import { useId } from "react";
import BoosterIcon from "./BoosterIcon";
import DashboardToolHeading from "./DashboardToolHeading";
import styles from "./BoosterHeaderBrand.module.css";

export default function BoosterHeaderBrand({ label, subtitle }: { label: string; subtitle?: string }) {
  const gradientId = `booster-${useId().replace(/:/g, "")}`;
  return (
    <div className={styles.brand}>
      <span className={styles.rocket} aria-hidden="true"><BoosterIcon gradientId={gradientId} /></span>
      <DashboardToolHeading subtitle={subtitle}><h1 className={styles.wordmark}>{label}</h1></DashboardToolHeading>
    </div>
  );
}
