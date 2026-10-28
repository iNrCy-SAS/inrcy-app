"use client";

import styles from "./DashboardGeneratorOrb.module.css";

/** Shared decorative drawing. Its host may describe the state, without an action. */
export default function DashboardGeneratorOrb({ isActive, className = "", bare = false }: {
  isActive: boolean | null;
  className?: string;
  bare?: boolean;
}) {
  return (
    <span className={`${styles.orb} ${bare ? styles.bare : ""} ${className}`} data-generator-orb="true" data-active={isActive === null ? "unknown" : String(isActive)} aria-hidden="true">
      <span className={styles.shell} />
      <span className={styles.core}>
        <span className={styles.generatorCoreCenter}>
          <span className={styles.miniCoreRing} />
          <span className={styles.miniCoreRotor} />
          <span className={styles.miniCoreGlass} />
          <span className={styles.miniCoreGlow} />
        </span>
      </span>
      <span className={styles.status} />
    </span>
  );
}
