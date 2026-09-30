"use client";

import Image from "next/image";
import { useDashboardI18n } from "../_hooks/useDashboardI18n";
import { useInrAgentPendingCount } from "../_hooks/useInrAgentPendingCount";
import styles from "./DashboardAgentLogoButton.module.css";

type Props = {
  className?: string;
  enabled?: boolean;
  busy?: boolean;
  onClick: () => void;
};

export default function DashboardAgentLogoButton({ className, enabled = true, busy = false, onClick }: Props) {
  const t = useDashboardI18n();
  const pendingCount = useInrAgentPendingCount(enabled);
  const pendingLabel = pendingCount > 99 ? "99+" : String(pendingCount);
  const actionLabel = enabled
    ? pendingCount > 0
      ? `${t.topbar.inrAgentOpen} — ${pendingLabel} ${pendingCount > 1 ? t.topbar.inrAgentActions : t.topbar.inrAgentAction} ${t.topbar.inrAgentPending}`
      : t.topbar.inrAgentOpen
    : t.topbar.inrAgentDisabled;

  return (
    <button
      type="button"
      className={`${styles.button} ${className ?? ""}`}
      data-agent-logo-button="true"
      data-testid="dashboard-agent-logo"
      data-dashboard-prefetch={enabled ? "/dashboard/agent" : undefined}
      onClick={onClick}
      disabled={!enabled || busy}
      aria-disabled={!enabled || busy}
      aria-busy={busy || undefined}
      aria-label={actionLabel}
      title={actionLabel}
    >
      <Image className={styles.logo} src="/icons/inr-agent-header.png" alt="" width={52} height={52} draggable={false} />
      {enabled && pendingCount > 0 ? <span className={styles.badge} data-testid="dashboard-agent-pending-badge" aria-hidden="true">{pendingLabel}</span> : null}
    </button>
  );
}
