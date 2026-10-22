export type InrAgentWorkspace = "publications" | "campaigns" | "stats";
export type InrAgentAutomation = "publish" | "grow" | "loyalty" | "stats";

export const INR_AGENT_WORKSPACES = {
  publications: {
    href: "/dashboard/agent/publications",
    icon: "/agent/agent-publications.webp",
    automations: ["publish"],
    initialAutomation: "publish",
  },
  campaigns: {
    href: "/dashboard/agent/campagnes-mails",
    icon: "/agent/agent-campaigns.webp",
    automations: ["grow", "loyalty"],
    initialAutomation: "grow",
  },
  stats: {
    href: "/dashboard/agent/stats",
    icon: "/agent/agent-stats.webp",
    automations: ["stats"],
    initialAutomation: "stats",
  },
} as const satisfies Record<InrAgentWorkspace, {
  href: string;
  icon: string;
  automations: readonly InrAgentAutomation[];
  initialAutomation: InrAgentAutomation;
}>;

export function isAutomationInAgentWorkspace(
  workspace: InrAgentWorkspace,
  automation: string | null | undefined,
) {
  return typeof automation === "string" && (INR_AGENT_WORKSPACES[workspace].automations as readonly string[]).includes(automation);
}

export function filterAgentWorkspaceActions<T extends { automationKey: string | null }>(
  workspace: InrAgentWorkspace,
  actions: readonly T[],
): T[] {
  return actions.filter((action) => isAutomationInAgentWorkspace(workspace, action.automationKey));
}

export function filterAgentWorkspaceSchedule<T extends { automationKey?: string | null; source: string; scheduledActionId?: string | null }>(
  workspace: InrAgentWorkspace,
  items: readonly T[],
  manualAutomations: ReadonlyMap<string, string | null | undefined> = new Map(),
): T[] {
  return items.filter((item) => {
    const automationKey = item.automationKey ?? (item.scheduledActionId ? manualAutomations.get(item.scheduledActionId) : undefined);
    return automationKey
      ? isAutomationInAgentWorkspace(workspace, automationKey)
      : workspace === "publications" && item.source === "history";
  });
}
