"use client";

import { useTranslations } from "next-intl";
import HelpButton from "../../_components/HelpButton";
import DashboardAssistantTrigger from "../../_components/DashboardAssistantTrigger";
import { INR_AGENT_WORKSPACES, type InrAgentWorkspace } from "@/lib/inrAgentWorkspaces";
import appStyles from "../agent.module.css";
import styles from "./AgentWorkspaceHeader.module.css";

type Props = {
  workspace: InrAgentWorkspace;
  campaignMode: "grow" | "loyalty";
  onCampaignMode: (mode: "grow" | "loyalty") => void;
  onHelp: () => void;
  onIdeas: () => void;
  onPrepare: () => void;
  onPlanning: () => void;
  onSettings: () => void;
  onClose: () => void;
  onToggle: () => void;
  enabled: boolean;
  busy: boolean;
  preparing: boolean;
  prepareDisabled: boolean;
  prepareHelp?: string;
  status?: string;
};

export default function AgentWorkspaceHeader(props: Props) {
  const t = useTranslations("agent.workspaces");
  const definition = INR_AGENT_WORKSPACES[props.workspace];

  return (
    <header className={styles.header} data-agent-workspace-header={props.workspace}>
      <div className={styles.identity}>
        <img src={definition.icon} alt="" width={76} height={76} fetchPriority="high" />
        <div>
          <h1>Agent <span>{t(`${props.workspace}.name`)}</span><DashboardAssistantTrigger /></h1>
          <p>{t(`${props.workspace}.description`)}</p>
        </div>
      </div>
      <div className={styles.controls}>
        {props.workspace === "campaigns" ? (
          <div className={styles.modes} role="group" aria-label={t("campaignMode")}>
            {(["grow", "loyalty"] as const).map((mode) => (
              <button type="button" key={mode} aria-pressed={props.campaignMode === mode}
                onClick={() => props.onCampaignMode(mode)} disabled={props.preparing}>
                {t(mode)}
              </button>
            ))}
          </div>
        ) : null}
        <div className={styles.actions}>
          <span className={styles.help}><HelpButton onClick={props.onHelp} title={t("help")} size={34} /></span>
          {props.workspace === "publications" ? (
            <button type="button" className={`${appStyles.headerScheduleButton} ${styles.ideas}`} onClick={props.onIdeas} disabled={props.busy}><span aria-hidden="true">💡</span>{t("ideas")}</button>
          ) : null}
          <button type="button" className={`${appStyles.headerToolButton} ${styles.prepare}`} onClick={props.onPrepare}
            disabled={props.prepareDisabled} aria-busy={props.preparing} title={props.prepareHelp}>
            <span aria-hidden="true">⚡</span>{props.preparing ? t("preparing") : t(props.workspace === "stats" ? "sendReport" : props.workspace === "campaigns" ? "prepare" : "generate")}
          </button>
          <button type="button" className={appStyles.headerScheduleButton} onClick={props.onPlanning}><span className={styles.icon} aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2m-8 3h2" /></svg></span>{t("planning")}</button>
          <button type="button" className={appStyles.headerToolButton} onClick={props.onSettings} disabled={props.busy}><span className={styles.icon} aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m10 3-.7 2.2-2 .9-2.2-.5-2 3.4 1.5 1.8v2.4L3.1 15l2 3.4 2.2-.5 2 .9L10 21h4l.7-2.2 2-.9 2.2.5 2-3.4-1.5-1.8v-2.4L20.9 9l-2-3.4-2.2.5-2-.9L14 3Z" /><circle cx="12" cy="12" r="3" /></svg></span>{t("settings")}</button>
          <button type="button" data-enabled={props.enabled} className={`${appStyles.settingsHeaderSwitch} ${styles.toggle}`}
            onClick={props.onToggle} disabled={props.busy || props.preparing} title={t("configureAutomation")}>
            {t(props.enabled ? "enabled" : "paused")}<span className={styles.track} aria-hidden="true"><i /></span>
          </button>
          <button type="button" className={`${appStyles.headerCloseButton} ${styles.close}`} onClick={props.onClose} aria-label={t("close")} title={t("close")}>×</button>
        </div>
      </div>
      {props.status ? <p className={styles.status} role="status">{props.status}</p> : null}
    </header>
  );
}
