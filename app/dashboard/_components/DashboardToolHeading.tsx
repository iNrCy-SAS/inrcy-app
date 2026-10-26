"use client";

import type { ReactNode } from "react";
import DashboardAssistantTrigger from "./DashboardAssistantTrigger";
import styles from "./DashboardToolHeading.module.css";

export default function DashboardToolHeading({ children, subtitle }: { children: ReactNode; subtitle?: ReactNode }) {
  return <div className={styles.identity} data-dashboard-tool-heading>
    <div className={styles.titleRow} data-dashboard-tool-title>{children}<DashboardAssistantTrigger /></div>
    {subtitle ? <p className={styles.subtitle} data-dashboard-tool-subtitle>{subtitle}</p> : null}
  </div>;
}
