"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { INR_AGENT_WORKSPACES, type InrAgentWorkspace } from "@/lib/inrAgentWorkspaces";
import { useDashboardI18n } from "../_hooks/useDashboardI18n";
import { useInrAgentPendingCount } from "../_hooks/useInrAgentPendingCount";
import styles from "./DashboardAgentLogoButton.module.css";
import toolStyles from "./DashboardSignatureTools.module.css";

type Props = {
  className?: string;
  enabled?: boolean;
  busy?: boolean;
  workspace?: InrAgentWorkspace;
  locked?: boolean;
  availabilityHint?: string;
  onClick: () => void;
};

export default function DashboardAgentLogoButton({ className, enabled = true, busy = false, workspace, locked = false, availabilityHint, onClick }: Props) {
  const t = useDashboardI18n();
  const workspaceT = useTranslations("agent.workspaces");
  // The global counter remains on its existing global entry point.
  const pendingCount = useInrAgentPendingCount(enabled && !workspace);
  const definition = workspace ? INR_AGENT_WORKSPACES[workspace] : null;
  const pendingLabel = pendingCount > 99 ? "99+" : String(pendingCount);
  const actionLabel = workspace
    ? `${workspaceT("open")} ${workspaceT(`${workspace}.name`)}`
    : enabled
    ? pendingCount > 0
      ? `${t.topbar.inrAgentOpen} — ${pendingLabel} ${pendingCount > 1 ? t.topbar.inrAgentActions : t.topbar.inrAgentAction} ${t.topbar.inrAgentPending}`
      : t.topbar.inrAgentOpen
    : t.topbar.inrAgentDisabled;

  if (workspace && definition) {
    return (
      <div className={`${styles.contextual} ${className ?? ""}`} title={availabilityHint}>
        <Image className={styles.contextualRobot} src={definition.icon} alt="" title={availabilityHint} width={56} height={56} draggable={false} />
        <div className={styles.contextualCopy}>
          <span className={styles.agentName}>Agent {workspaceT(`${workspace}.name`)}</span>
        <button type="button" className={`${toolStyles.toolButton} ${styles.openAgent}`}
          data-agent-workspace={workspace} data-testid="dashboard-agent-logo"
          data-dashboard-prefetch={enabled && !locked ? definition.href : undefined}
          onClick={onClick} disabled={!enabled || busy} aria-disabled={!enabled || busy}
          aria-busy={busy || undefined} aria-label={availabilityHint ? `${actionLabel} — ${availabilityHint}` : locked ? `${actionLabel} — ${t.modules.campaignsPremiumLabel}` : actionLabel} title={availabilityHint ?? actionLabel}>
          {locked ? t.modules.campaignsPremiumLabel : workspace === "publications" ? workspaceT("publications.automate") : t.modules.agentCta}<span aria-hidden="true">{locked ? "🔒" : "→"}</span>
        </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`${styles.button} ${className ?? ""}`}
      data-agent-logo-button="true"
      data-agent-workspace={workspace}
      data-testid="dashboard-agent-logo"
      data-dashboard-prefetch={enabled ? definition?.href ?? "/dashboard/agent" : undefined}
      onClick={onClick}
      disabled={!enabled || busy}
      aria-disabled={!enabled || busy}
      aria-busy={busy || undefined}
      aria-label={actionLabel}
      title={actionLabel}
    >
      <Image className={styles.logo} src={definition?.icon ?? "/icons/inr-agent-header.png"} alt="" width={64} height={64} draggable={false} />
      {enabled && pendingCount > 0 ? <span className={styles.badge} data-testid="dashboard-agent-pending-badge" aria-hidden="true">{pendingLabel}</span> : null}
    </button>
  );
}
