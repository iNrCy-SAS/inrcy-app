import { pendingActionStatuses } from "./agent.config";
import { publicationValidationState } from "./agent.publication-validation";
import type { AgentPublicationHistoryItem } from "@/lib/inrAgentPublicationHistory";
import {
  agentActionStatusLabel,
  agentAutomationTitle,
  agentScheduleChannelLabel,
  agentScheduledStatusLabel,
  agentScheduleTypeLabel,
  agentThemeListLabel,
  agentWeekdayLabel,
  type AgentTranslator,
} from "./agent.i18n";
import {
  computeNextOccurrence,
  scheduleChannelLabelFromAutomation,
  scheduleDateParts,
  scheduleTypeLabelFromAutomation,
  scheduledActionToPreparedAction,
  scheduledActionChannelLabel,
  scheduledActionChannelLabels,
  scheduledActionTypeLabel,
} from "./agent.schedule";
import {
  extractChannelPreview,
  extractPublishMediaPreview,
} from "./agent.publish-preview";
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
  historyPublications: AgentPublicationHistoryItem[];
  scheduledActions: AgentScheduledAction[];
  visibleAutomations: Automation[];
  configs: Record<AutomationKey, AutomationConfig>;
  connectedChannels: ConnectedChannelMap | null;
  locale: string;
  translate: AgentTranslator;
};

function scheduledContentTitle(
  action: AgentPreparedAction,
  channels: ChannelKey[],
) {
  const genericActionTitle = action.title.trim();
  for (const channel of channels) {
    const title = extractChannelPreview(action, channel).title.trim();
    if (title && title !== genericActionTitle) return title;
  }
  return "";
}

function scheduledMediaKind(
  action: AgentPreparedAction,
  channels: ChannelKey[],
): "image" | "video" | "mixed" | undefined {
  const kinds = new Set(
    channels
      .map((channel) => extractPublishMediaPreview(action, channel).kind)
      .filter((kind): kind is "image" | "video" =>
        kind === "image" || kind === "video",
      ),
  );

  if (kinds.size === 2) return "mixed";
  if (kinds.has("image")) return "image";
  if (kinds.has("video")) return "video";
  return undefined;
}

export function buildAgentScheduleItems({
  actions,
  historyPublications,
  scheduledActions,
  visibleAutomations,
  configs,
  connectedChannels,
  locale,
  translate,
}: BuildAgentScheduleItemsArgs): ScheduleListItem[] {
  const rows: ScheduleListItem[] = [];
  const actionsById = new Map(actions.map((action) => [action.id, action]));
  const historicalActionIds = new Set(historyPublications.map((item) => item.agentActionId).filter(Boolean));
  const historicalScheduledIds = new Set(historyPublications.map((item) => item.scheduledActionId).filter(Boolean));
  const editorialActions = actions.filter((action) => {
    const editorialPlan = asRecord(action.payload?.editorialPlan);
    const scheduledExecution = asRecord(action.payload?.scheduledExecution);
    const linkedScheduledIds = Array.isArray(scheduledExecution?.scheduledActionIds)
      ? scheduledExecution.scheduledActionIds.map(String)
      : [];
    return (
      action.automationKey === "publish" &&
      Boolean(editorialPlan) &&
      !historicalActionIds.has(action.id) &&
      !linkedScheduledIds.some((id) => historicalScheduledIds.has(id)) &&
      !["completed", "cancelled"].includes(
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
    const themeLabel = agentThemeListLabel(
      action.targetThemes,
      translate,
      locale,
    );
    const contentTitle = scheduledContentTitle(action, channels);
    const mediaKind = scheduledMediaKind(action, channels);
    const validationState = publicationValidationState(action);
    rows.push({
      id: `editorial-${action.id}`,
      action: action.title || agentAutomationTitle("publish", translate),
      themeLabel: themeLabel || undefined,
      contentTitle: contentTitle || undefined,
      mediaKind,
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
      approvalState:
        validationState === "validated" ? "approved" : validationState,
      automationKey: "publish",
      preparedActionId: action.id,
      scheduledAtIso: scheduledFor,
      contentReady,
      editable: true,
      removable: true,
      source: "editorial",
    });
  }

  for (const action of scheduledActions) {
    if (
      action.source !== "manual" ||
      historicalScheduledIds.has(action.id) ||
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
    const preparedAction = scheduledActionToPreparedAction(action);
    const scheduledChannels = preparedAction
      ? normalizeUiChannels(preparedAction.targetChannels)
      : [];
    const themeLabel = preparedAction
      ? agentThemeListLabel(preparedAction.targetThemes, translate, locale)
      : "";
    const contentTitle = preparedAction
      ? scheduledContentTitle(preparedAction, scheduledChannels)
      : "";
    const mediaKind = preparedAction
      ? scheduledMediaKind(preparedAction, scheduledChannels)
      : undefined;
    rows.push({
      id: `manual-${action.id}`,
      action: action.title || translate("action_programmee_ea2709b8"),
      themeLabel: themeLabel || undefined,
      contentTitle: contentTitle || undefined,
      mediaKind,
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
      preparedActionId: String(asRecord(action.payload)?.sourceActionId || "") || undefined,
      scheduledActionId: action.id,
      scheduledAtIso: action.scheduledAt || action.createdAt,
      editable: action.status !== "running",
      removable: true,
      source: "manual",
    });
  }

  const historyStatusLabels: Record<AgentPublicationHistoryItem["status"], string> = {
    completed: translate("planning_history_succeeded"),
    partial: translate("planning_history_partial"),
    failed: translate("echec_0ff45fa6"),
    refused: translate("action_status_refused"),
    cancelled: translate("action_status_cancelled"),
    processing: translate("action_status_executing"),
  };
  for (const publication of historyPublications) {
    const historyAction = publication.agentActionId
      ? actionsById.get(publication.agentActionId)
      : null;
    const validationState = publication.status === "refused"
      ? "refused"
      : historyAction
        ? publicationValidationState(historyAction)
        : ["completed", "partial", "processing"].includes(publication.status)
          ? "validated"
          : "pending";
    const occurredAt = new Date(publication.occurredAt);
    const dateParts = {
      date: new Intl.DateTimeFormat(locale, {
        timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric",
      }).format(occurredAt),
      time: new Intl.DateTimeFormat(locale, {
        timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      }).format(occurredAt),
    };
    const channels = normalizeUiChannels(publication.channels);
    const channelLabels = channels.map((channel) =>
      agentScheduleChannelLabel(scheduleChannelLabelFromAutomation("publish", channel), translate),
    );
    rows.push({
      id: publication.id,
      action: publication.title,
      themeLabel: agentThemeListLabel(publication.themes, translate, locale) || undefined,
      contentTitle: publication.contentTitle || undefined,
      mediaKind: publication.mediaKind || undefined,
      date: dateParts.date,
      time: dateParts.time,
      typeLabel: agentScheduleTypeLabel(scheduleTypeLabelFromAutomation("publish"), translate),
      channelLabel: channelLabels.join(" · ") || "—",
      channelLabels,
      originLabel: translate("inr_agent_88080b90"),
      status: historyStatusLabels[publication.status],
      statusKey: publication.status,
      approvalState:
        validationState === "validated"
          ? "approved"
          : validationState === "refused"
            ? "refused"
            : undefined,
      automationKey: "publish",
      preparedActionId: publication.agentActionId,
      scheduledActionId: publication.scheduledActionId,
      scheduledAtIso: publication.occurredAt,
      editable: false,
      removable: false,
      source: "history",
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
