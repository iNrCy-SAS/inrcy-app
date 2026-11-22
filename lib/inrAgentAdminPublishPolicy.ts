import type { DashboardEdition } from './dashboardEdition.ts';

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

export function isInrAgentHighPublicationFrequency(frequency: unknown) {
  return frequency === 'daily' || frequency === 'five_times_weekly';
}

export type InrAgentPublicationOptionAccess = { highFrequency: boolean; automaticPublish: boolean };

export function getInrAgentPublicationOptionAccess(edition: DashboardEdition, existingAdminAccess: boolean): InrAgentPublicationOptionAccess {
  const highFrequency = existingAdminAccess || edition === 'premium' || edition === 'founder';
  return { highFrequency, automaticPublish: highFrequency || edition === 'standard' };
}

export function isInrAgentPublicationSettingAllowed(
  automation: { frequency?: unknown; validationMode?: unknown }, access: InrAgentPublicationOptionAccess,
) {
  return (!isInrAgentHighPublicationFrequency(automation.frequency) || access.highFrequency)
    && (automation.validationMode !== INR_AGENT_ADMIN_PUBLISH_MODE || access.automaticPublish);
}

/** Inspect raw settings before structural normalization can discard a forbidden module. */
export function requestedInrAgentAdminOptions(value: unknown) {
  const input = record(value), automations = record(input.automations);
  const entries = Object.values(automations).map(record);
  const highFrequency = isInrAgentHighPublicationFrequency(input.frequency) || entries.some(entry => isInrAgentHighPublicationFrequency(entry.frequency));
  const automaticPublish = input.mode === INR_AGENT_ADMIN_PUBLISH_MODE || entries.some(entry => entry.validationMode === INR_AGENT_ADMIN_PUBLISH_MODE);
  return {
    highFrequency, automaticPublish,
    invalidModule: Object.entries(automations).some(([key, entry]) => key !== 'publish' && inrAgentPublishUsesRestrictedOptions(record(entry))),
  };
}

export function inrAgentPublishUsesRestrictedOptions(automation: { frequency?: unknown; validationMode?: unknown }) {
  return isInrAgentHighPublicationFrequency(automation.frequency) || automation.validationMode === INR_AGENT_ADMIN_PUBLISH_MODE;
}

export function inrAgentAdminMarkerMatchesOptIn(markerValue: unknown, optInValue: unknown, accountId: string) {
  const marker = readInrAgentAdminAutomaticPublish(markerValue), optIn = readInrAgentAdminPublishOptIn(optInValue);
  return Boolean(marker && optIn && marker.accountId === accountId && marker.optInId === optIn.id && Date.parse(marker.preparedAt) >= Date.parse(optIn.enabledAt));
}
