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
};

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
