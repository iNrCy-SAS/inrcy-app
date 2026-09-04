"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";

import { isStandardAgentAutomationKey } from "@/lib/standardAgentPolicy";
import { useAgentRuntimeData } from "../_hooks/useAgentRuntimeData";
import { automations } from "../_lib/agent.config";
import type { AgentTranslator } from "../_lib/agent.i18n";
import { buildAgentScheduleItems } from "../_lib/agent.schedule-items";
import { AgentScheduleModal } from "./AgentActionModals";

type DashboardAgentPlanningModalProps = {
  open: boolean;
  onClose: () => void;
  onManage: () => void;
};

export default function DashboardAgentPlanningModal({
  open,
  onClose,
  onManage,
}: DashboardAgentPlanningModalProps) {
  const i18nT = useTranslations("agent");
  const locale = useLocale();
  const runtimeT = i18nT as unknown as AgentTranslator;
  const visibleAutomations = useMemo(
    () =>
      automations.filter((automation) =>
        isStandardAgentAutomationKey(automation.key),
      ),
    [],
  );
  const {
    configs,
    agentConnectedChannels,
    connectedChannelsLoadState,
    loadState,
    actions,
    scheduledActions,
    actionsLoadState,
  } = useAgentRuntimeData({ standardMode: true });
  const items = useMemo(
    () =>
      buildAgentScheduleItems({
        actions,
        scheduledActions,
        visibleAutomations,
        configs,
        connectedChannels: agentConnectedChannels,
        locale,
        translate: runtimeT,
      }),
    [
      actions,
      agentConnectedChannels,
      configs,
      locale,
      runtimeT,
      scheduledActions,
      visibleAutomations,
    ],
  );
  const openPilotage = () => {
    onClose();
    onManage();
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
      showCampaigns={false}
      onClose={onClose}
      onOpenContent={openPilotage}
      onReschedule={openPilotage}
      onDelete={openPilotage}
    />
  );
}
