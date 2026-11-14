export const INR_AGENT_ADMIN_PUBLISH_MODE = 'admin_automatic_publish' as const;
export type InrAgentAdminPublishOptIn = { version: 1; id: string; enabledAt: string };
export type InrAgentAdminAutomaticPublish = { version: 1; optInId: string; accountId: string; preparedAt: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function readInrAgentAdminPublishOptIn(value: unknown): InrAgentAdminPublishOptIn | null {
  const input = record(value);
  return input.version === 1 && typeof input.id === 'string' && uuid.test(input.id)
    && typeof input.enabledAt === 'string' && Number.isFinite(Date.parse(input.enabledAt))
    ? { version: 1, id: input.id, enabledAt: input.enabledAt } : null;
}

export function readInrAgentAdminAutomaticPublish(value: unknown): InrAgentAdminAutomaticPublish | null {
  const input = record(value);
  return input.version === 1 && typeof input.optInId === 'string' && uuid.test(input.optInId)
    && typeof input.accountId === 'string' && uuid.test(input.accountId)
    && typeof input.preparedAt === 'string' && Number.isFinite(Date.parse(input.preparedAt))
    ? { version: 1, optInId: input.optInId, accountId: input.accountId, preparedAt: input.preparedAt } : null;
}

/** Inspect raw settings before structural normalization can discard a forbidden module. */
export function requestedInrAgentAdminOptions(value: unknown) {
  const input = record(value), automations = record(input.automations);
  const usesAdminOption = (entry: Record<string, unknown>) => entry.frequency === 'daily' || entry.validationMode === INR_AGENT_ADMIN_PUBLISH_MODE;
  return {
    requested: input.frequency === 'daily' || input.mode === INR_AGENT_ADMIN_PUBLISH_MODE || Object.values(automations).some(entry => usesAdminOption(record(entry))),
    invalidModule: Object.entries(automations).some(([key, entry]) => key !== 'publish' && usesAdminOption(record(entry))),
  };
}

export function inrAgentPublishNeedsAdmin(automation: { frequency?: unknown; validationMode?: unknown }) {
  return automation.frequency === 'daily' || automation.validationMode === INR_AGENT_ADMIN_PUBLISH_MODE;
}

export function inrAgentAdminMarkerMatchesOptIn(markerValue: unknown, optInValue: unknown, accountId: string) {
  const marker = readInrAgentAdminAutomaticPublish(markerValue), optIn = readInrAgentAdminPublishOptIn(optInValue);
  return Boolean(marker && optIn && marker.accountId === accountId && marker.optInId === optIn.id && Date.parse(marker.preparedAt) >= Date.parse(optIn.enabledAt));
}
