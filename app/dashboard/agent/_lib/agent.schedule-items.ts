import { pendingActionStatuses } from "./agent.config";
import {
  agentActionStatusLabel,
  agentAutomationTitle,
  agentScheduleChannelLabel,
  agentScheduledStatusLabel,
  agentScheduleTypeLabel,
  agentWeekdayLabel,
  type AgentTranslator,
} from "./agent.i18n";
import {
  computeNextOccurrence,
  scheduleChannelLabelFromAutomation,
  scheduleDateParts,
  scheduleTypeLabelFromAutomation,
  scheduledActionChannelLabel,
  scheduledActionChannelLabels,
  scheduledActionTypeLabel,
} from "./agent.schedule";
import {
  connectedChannelsForAutomation,
  normalizeUiChannels,
  orderChannels,
} from "./agent.settings";
import type {
  AgentPreparedAction,
  AgentScheduledAction,
  Automation,
  AutomationConfig,
  AutomationKey,
  ChannelKey,
  ConnectedChannelMap,
  ScheduleListItem,
} from "./agent.types";
import { asRecord } from "./agent.utils";

type BuildAgentScheduleItemsArgs = {
  actions: AgentPreparedAction[];
  scheduledActions: AgentScheduledAction[];
  visibleAutomations: Automation[];
  configs: Record<AutomationKey, AutomationConfig>;
  connectedChannels: ConnectedChannelMap | null;
  locale: string;
  translate: AgentTranslator;
};

export function buildAgentScheduleItems({
  actions,
  scheduledActions,
  visibleAutomations,
  configs,
  connectedChannels,
  locale,
  translate,
}: BuildAgentScheduleItemsArgs): ScheduleListItem[] {
  const rows: ScheduleListItem[] = [];
  const editorialActions = actions.filter((action) => {
    const editorialPlan = asRecord(action.payload?.editorialPlan);
    return (
      action.automationKey === "publish" &&
      Boolean(editorialPlan) &&
      !["scheduled", "validated", "completed", "cancelled"].includes(
        action.status,
      )
    );
  });
  const activeEditorialActions = editorialActions.filter(
    (action) => action.status !== "refused",
  );
  const hasEditorialPublishPlan = activeEditorialActions.some(
    (action) =>
      new Date(action.scheduledFor || 0).getTime() > Date.now() - 86_400_000,
  );

  for (const automation of visibleAutomations) {
    const config = configs[automation.key];
    if (!config?.enabled) continue;
    if (automation.key === "publish" && hasEditorialPublishPlan) continue;
    const nextOccurrence = computeNextOccurrence(config);
    const dateParts = scheduleDateParts(
      nextOccurrence,
      agentWeekdayLabel(config.day, translate) || "—",
      config.time || "—",
      locale,
    );
    const channels =
      automation.key === "stats"
        ? (["mails"] as ChannelKey[])
        : orderChannels(
            config.channels,
            connectedChannelsForAutomation(automation, connectedChannels),
          );

    if (automation.key !== "stats" && channels.length === 0) continue;

    for (const channel of channels) {
      const channelLabel = agentScheduleChannelLabel(
        scheduleChannelLabelFromAutomation(automation.key, channel),
        translate,
      );
      rows.push({
        id: `automatic-${automation.key}-${channel}`,
        action: agentAutomationTitle(automation.key, translate),
        date: dateParts.date,
        time: dateParts.time,
        typeLabel: agentScheduleTypeLabel(
          scheduleTypeLabelFromAutomation(automation.key),
          translate,
        ),
        channelLabel,
        channelLabels: [channelLabel],
        originLabel: translate("automatique_f8a3c37b"),
        status: translate("automatique_f8a3c37b"),
        statusKey: "scheduled",
        automationKey: automation.key,
        scheduledAtIso: nextOccurrence,
        editable: true,
        removable: true,
        source: "automatic",
      });
    }
  }

  for (const action of editorialActions) {
    const editorialPlan = asRecord(action.payload?.editorialPlan);
    const scheduledFor =
      action.scheduledFor || String(editorialPlan?.scheduledFor || "");
    if (!scheduledFor) continue;
    const dateParts = scheduleDateParts(scheduledFor, "—", "—", locale);
    const channels = normalizeUiChannels(
      action.targetChannels,
      editorialPlan?.channels,
    );
    const channelLabels = channels.map((channel) =>
      agentScheduleChannelLabel(
        scheduleChannelLabelFromAutomation("publish", channel),
        translate,
      ),
    );
    const editorialState = String(editorialPlan?.state || "");
    const contentReady =
      editorialState === "ready" || pendingActionStatuses.has(action.status);
    rows.push({
      id: `editorial-${action.id}`,
      action: action.title || agentAutomationTitle("publish", translate),
      date: dateParts.date,
      time: dateParts.time,
      typeLabel: agentScheduleTypeLabel(
        scheduleTypeLabelFromAutomation("publish"),
        translate,
      ),
      channelLabel: channelLabels.join(" · ") || "—",
      channelLabels,
      originLabel: translate("automatique_f8a3c37b"),
      status: agentActionStatusLabel(action.status, translate),
      statusKey:
        action.status === "draft" || action.status === "executing"
          ? "running"
          : action.status,
      automationKey: "publish",
      preparedActionId: action.id,
      scheduledAtIso: scheduledFor,
      contentReady,
      editable: false,
      removable: true,
      source: "editorial",
    });
  }

  for (const action of scheduledActions) {
    if (
      action.source !== "manual" ||
      !["scheduled", "running", "failed"].includes(action.status)
    ) {
      continue;
    }
    const dateParts = scheduleDateParts(
      action.scheduledAt || action.createdAt,
      "—",
      "—",
      locale,
    );
    rows.push({
      id: `manual-${action.id}`,
      action: action.title || translate("action_programmee_ea2709b8"),
      date: dateParts.date,
      time: dateParts.time,
      typeLabel: agentScheduleTypeLabel(
        scheduledActionTypeLabel(action),
        translate,
      ),
      channelLabel: agentScheduleChannelLabel(
        scheduledActionChannelLabel(action),
        translate,
      ),
      channelLabels: scheduledActionChannelLabels(action).map((label) =>
        agentScheduleChannelLabel(label, translate),
      ),
      originLabel: translate("programme_bab7d71e"),
      status: agentScheduledStatusLabel(action.status, translate),
      statusKey: action.status,
      automationKey: action.automationKey,
      scheduledActionId: action.id,
      scheduledAtIso: action.scheduledAt || action.createdAt,
      editable: action.status !== "running",
      removable: true,
      source: "manual",
    });
  }

  return rows.sort((a, b) => {
    if (a.statusKey === "failed" && b.statusKey !== "failed") return -1;
    if (b.statusKey === "failed" && a.statusKey !== "failed") return 1;
    return (
      new Date(a.scheduledAtIso || 0).getTime() -
      new Date(b.scheduledAtIso || 0).getTime()
    );
  });
}
