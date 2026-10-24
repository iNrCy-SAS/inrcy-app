"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";

import { isStandardAgentAutomationKey } from "@/lib/standardAgentPolicy";
import { filterAgentWorkspaceSchedule, isAutomationInAgentWorkspace, type InrAgentWorkspace } from "@/lib/inrAgentWorkspaces";
import { useAgentRuntimeData } from "../_hooks/useAgentRuntimeData";
import { automations } from "../_lib/agent.config";
import type { AgentTranslator } from "../_lib/agent.i18n";
import { buildAgentScheduleItems } from "../_lib/agent.schedule-items";
import { scheduledActionToPreparedAction, scheduledAutomationKey } from "../_lib/agent.schedule";
import { AgentScheduleModal } from "./AgentActionModals";
import AgentWorkspaceMessages from "./AgentWorkspaceMessages";

type DashboardAgentPlanningModalProps = {
  open: boolean;
  onClose: () => void;
  onManage?: () => void;
  inspectionOnly?: boolean;
  closeLabel?: string;
  standardMode?: boolean;
  workspace?: InrAgentWorkspace;
};

export default function DashboardAgentPlanningModal(props: DashboardAgentPlanningModalProps) {
  return props.workspace
    ? <AgentWorkspaceMessages workspace={props.workspace}><DashboardAgentPlanningContent {...props} /></AgentWorkspaceMessages>
    : <DashboardAgentPlanningContent {...props} />;
}

function DashboardAgentPlanningContent({
  open,
  onClose,
  onManage,
  inspectionOnly = false,
  closeLabel,
  standardMode = true,
  workspace,
}: DashboardAgentPlanningModalProps) {
  const i18nT = useTranslations("agent");
  const locale = useLocale();
  const runtimeT = i18nT as unknown as AgentTranslator;
  const visibleAutomations = useMemo(
    () => (standardMode
      ? automations.filter((automation) =>
          isStandardAgentAutomationKey(automation.key),
        )
      : automations).filter((automation) => !workspace || isAutomationInAgentWorkspace(workspace, automation.key)),
    [standardMode, workspace],
  );
  const {
    configs,
    agentConnectedChannels,
    connectedChannelsLoadState,
    loadState,
    actions,
    historyPublications,
    scheduledActions,
    actionsLoadState,
  } = useAgentRuntimeData({ standardMode });
  const allItems = useMemo(
    () =>
      buildAgentScheduleItems({
        actions,
        historyPublications,
        scheduledActions,
        visibleAutomations,
        configs,
        connectedChannels: agentConnectedChannels,
        locale,
        translate: runtimeT,
      }),
    [
      actions,
      historyPublications,
      agentConnectedChannels,
      configs,
      locale,
      runtimeT,
      scheduledActions,
      visibleAutomations,
    ],
  );
  const manualAutomations = useMemo(() => new Map(scheduledActions.map((action) => [
    action.id, scheduledActionToPreparedAction(action)?.automationKey ?? scheduledAutomationKey(action),
  ])), [scheduledActions]);
  const items = workspace ? filterAgentWorkspaceSchedule(workspace, allItems, manualAutomations) : allItems;
  const openPilotage = () => {
    onClose();
    onManage?.();
  };

  return (
    <AgentScheduleModal
      open={open}
      items={items}
      mutationState="idle"
      loading={
        loadState === "loading" ||
        connectedChannelsLoadState === "loading" ||
        actionsLoadState === "loading"
      }
      readOnly
      inspectionOnly={inspectionOnly}
      closeLabel={closeLabel}
      showCampaigns={!standardMode && (!workspace || workspace === "campaigns")}
      onClose={onClose}
      onOpenContent={openPilotage}
      onReschedule={openPilotage}
      onDelete={openPilotage}
    />
  );
}
