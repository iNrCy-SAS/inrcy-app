"use client";
import Image from "next/image";

import { useDashboardAssistant, type AssistantBadgeState } from "./DashboardAssistantProvider";
import styles from "./DashboardAssistantTrigger.module.css";

export function DashboardAssistantBadge({ state }: { state: AssistantBadgeState }) {
  if (!state) return null;
  return <span className={styles.badge} data-assistant-badge data-state={state} aria-hidden="true" />;
}

/** Desktop tools use the same assistant session as the existing mobile dock. */
export default function DashboardAssistantTrigger() {
  const { toggleAssistant, assistantLabel, assistantOpen, assistantPending, assistantBadgeState } = useDashboardAssistant();
  return <button type="button" className={styles.trigger} onClick={toggleAssistant}
    aria-label={assistantLabel} title={assistantLabel} aria-haspopup="dialog"
    aria-controls="inrcy-assistant-dialog" aria-expanded={assistantOpen}
    aria-busy={assistantPending || undefined} data-dashboard-assistant-trigger>
    <Image src="/agent/agent-assist-pink-v2.png" width={30} height={30} sizes="30px" alt="" draggable={false} />
    <DashboardAssistantBadge state={assistantBadgeState} />
  </button>;
}
