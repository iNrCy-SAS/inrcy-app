import type { InrAgentAutomationKey, InrAgentSettings } from "@/lib/inrAgentSettings";

export const STANDARD_AGENT_AUTOMATION_KEYS = ["publish", "stats"] as const;

export type StandardAgentAutomationKey =
  (typeof STANDARD_AGENT_AUTOMATION_KEYS)[number];

type AgentDescriptor = {
  automationKey?: unknown;
  automation_key?: unknown;
  actionType?: unknown;
  action_type?: unknown;
  targetTool?: unknown;
  target_tool?: unknown;
  source?: unknown;
  payload?: unknown;
};

/** A user's Booster schedule is independent of the editorial AI agent. */
export function isManualBoosterPublicationSchedule(value: AgentDescriptor | null | undefined): boolean {
  if (!value || normalizedDescriptorValue(value.source) !== "manual"
    || normalizedDescriptorValue(value.actionType ?? value.action_type) !== "publication"
    || normalizedDescriptorValue(value.targetTool ?? value.target_tool) !== "booster") return false;
  const automationKey = normalizedDescriptorValue(value.automationKey ?? value.automation_key);
  if (automationKey && automationKey !== "publish") return false;
  const payload = value.payload && typeof value.payload === "object" && !Array.isArray(value.payload)
    ? value.payload as Record<string, unknown> : {};
  const publishPayload = payload.publishPayload && typeof payload.publishPayload === "object" && !Array.isArray(payload.publishPayload)
    ? payload.publishPayload as Record<string, unknown> : null;
  if (!publishPayload || payload.editorialPlan) return false;
  const origins = [payload.origin, publishPayload.origin].map(origin =>
    origin && typeof origin === "object" && !Array.isArray(origin) ? origin as Record<string, unknown> : {});
  if ([payload, publishPayload, ...origins].some(source => source.sourceActionId || source.inrAgentActionId || source.agentActionId
    || normalizedDescriptorValue(source.source).startsWith("inr_agent"))
    || typeof payload.origin === "string" && normalizedDescriptorValue(payload.origin).startsWith("inr_agent")) return false;
  const kind = normalizedDescriptorValue(payload.kind);
  if (kind && kind !== "manual_publish_schedule") return false;
  return kind === "manual_publish_schedule" || normalizedDescriptorValue(publishPayload.source) === "booster_scheduled";
}

export function filterManualBoosterPublicationSchedules<Schedule extends AgentDescriptor>(items: readonly Schedule[]): Schedule[] {
  return items.filter(isManualBoosterPublicationSchedule);
}

function normalizedDescriptorValue(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function isStandardAgentAutomationKey(
  value: unknown,
): value is StandardAgentAutomationKey {
  return STANDARD_AGENT_AUTOMATION_KEYS.includes(
    normalizedDescriptorValue(value) as StandardAgentAutomationKey,
  );
}

/**
 * Standard can only operate on the two exact action families used by Booster
 * publications and iNrStats reports. Merely spoofing an automation key is not
 * enough: the action type and target tool must match too.
 */
export function isStandardAgentActionDescriptor(
  value: AgentDescriptor | null | undefined,
): boolean {
  if (!value) return false;

  const automationKey = normalizedDescriptorValue(
    value.automationKey ?? value.automation_key,
  );
  const actionType = normalizedDescriptorValue(
    value.actionType ?? value.action_type,
  );
  const targetTool = normalizedDescriptorValue(
    value.targetTool ?? value.target_tool,
  );

  return (
    (automationKey === "publish" &&
      actionType === "publication" &&
      targetTool === "booster") ||
    (automationKey === "stats" &&
      actionType === "stats_report" &&
      targetTool === "inrstats")
  );
}

export function filterStandardAgentItems<T extends AgentDescriptor>(
  items: readonly T[],
): T[] {
  return items.filter(isStandardAgentActionDescriptor);
}

/**
 * The hidden Premium automations are forced off in every Standard response.
 * Their persisted rows are left untouched so an edition change remains fully
 * reversible.
 */
export function restrictInrAgentSettingsForStandard(
  settings: InrAgentSettings,
): InrAgentSettings {
  const automations = {
    ...settings.automations,
    stats: {
      ...settings.automations.stats,
      allowedThemes: settings.automations.stats.allowedThemes.filter(
        (theme) => theme !== "mails",
      ),
    },
    grow: {
      ...settings.automations.grow,
      enabled: false,
      nextRunAt: null,
    },
    loyalty: {
      ...settings.automations.loyalty,
      enabled: false,
      nextRunAt: null,
    },
  };
  const globalEnabled = STANDARD_AGENT_AUTOMATION_KEYS.some(
    (key) => automations[key].enabled,
  );

  return {
    ...settings,
    globalEnabled,
    enabled: globalEnabled,
    automations,
    allowedActions: settings.allowedActions.filter(
      (action) => action === "publication",
    ),
    allowedChannels: [...automations.publish.allowedChannels],
  };
}

export function standardAgentAutomationKeysForPersistence(
  standardMode: boolean,
): readonly InrAgentAutomationKey[] {
  return standardMode
    ? STANDARD_AGENT_AUTOMATION_KEYS
    : (["publish", "grow", "loyalty", "stats"] as const);
}
