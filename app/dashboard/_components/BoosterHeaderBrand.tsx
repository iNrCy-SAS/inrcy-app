"use client";

import { useId } from "react";
import BoosterIcon from "./BoosterIcon";
import styles from "./BoosterHeaderBrand.module.css";

export default function BoosterHeaderBrand({ label }: { label: string }) {
  const gradientId = `booster-${useId().replace(/:/g, "")}`;
  return (
    <div className={styles.brand}>
      <span className={styles.rocket} aria-hidden="true"><BoosterIcon gradientId={gradientId} /></span>
      <h1 className={styles.wordmark}>{label}</h1>
    </div>
  );
}
