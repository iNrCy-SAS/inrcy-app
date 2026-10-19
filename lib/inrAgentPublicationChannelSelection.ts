import { normalizeBoosterPublishChannel } from "./inrAgentPublishChannels.ts";

type Payload = Record<string, unknown>;
const record = (value: unknown): Payload => value && typeof value === "object" && !Array.isArray(value) ? value as Payload : {};
function channel(value: unknown) {
  return normalizeBoosterPublishChannel(value === "siteWeb" ? "site_web" : value === "inrSearch" ? "inr_search" : value);
}
function channels(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.map(channel).filter((item): item is NonNullable<ReturnType<typeof channel>> => Boolean(item)))] : [];
}

/** Selection changes diffusion only: all generated text and media remain in the payload. */
export function filterInrAgentPublicationChannels<T extends string>(payload: unknown, candidates: readonly T[]): T[] {
  const selection = record(record(payload).publicationChannelSelection);
  const excluded = new Set(selection.version === 1 ? [...channels(selection.excludedChannels), ...channels(selection.pendingChannels), ...channels(selection.unvalidatedChannels)] : []);
  return candidates.filter(candidate => !excluded.has(channel(candidate) || candidate));
}

export function pendingInrAgentPublicationChannels(payload: unknown): string[] {
  const selection = record(record(payload).publicationChannelSelection);
  return selection.version === 1 ? channels(selection.pendingChannels) : [];
}

export function unvalidatedInrAgentPublicationChannels(payload: unknown): string[] {
  const selection = record(record(payload).publicationChannelSelection);
  const excluded = new Set(channels(selection.excludedChannels));
  return selection.version === 1 ? channels(selection.unvalidatedChannels).filter(value => !excluded.has(value)) : [];
}

/** Checked channels include empty drafts; dispatch includes only ready, approved channels. */
export function selectedInrAgentPublicationChannels(payload: unknown, prepared: readonly string[]): string[] {
  const selection = record(record(payload).publicationChannelSelection);
  const excluded = new Set(selection.version === 1 ? channels(selection.excludedChannels) : []);
  return channels([...prepared.filter(value => !excluded.has(channel(value) || value)), ...pendingInrAgentPublicationChannels(payload)]);
}

export function preparedInrAgentPublicationChannels(payload: unknown, targetChannels: readonly string[]): string[] {
  const source = record(payload);
  const selection = record(source.publicationChannelSelection);
  const nested = record(source.publishPayload);
  return channels([
    ...targetChannels,
    ...(selection.version === 1 && Array.isArray(selection.availableChannels) ? selection.availableChannels : []),
    ...channels(source.selectedChannels), ...channels(source.channels), ...channels(source.boosterChannels),
    ...channels(nested.channels), ...channels(nested.selectedChannels),
  ]);
}

export function withInrAgentPublicationChannelSelection(
  payload: Payload,
  availableChannels: readonly string[],
  selectedChannels: unknown,
): Payload {
  const available = channels(availableChannels);
  if (!Array.isArray(selectedChannels) || selectedChannels.length > 20 || !available.length
    || selectedChannels.some(value => !channel(value))) {
    throw new TypeError("Invalid prepared publication channel selection");
  }
  const selected = new Set(channels(selectedChannels));
  return {
    ...payload,
    publicationChannelSelection: {
      version: 1,
      availableChannels: available,
      excludedChannels: available.filter(value => !selected.has(value)),
      ...(channels(selectedChannels).some(value => !available.includes(value)) ? { pendingChannels: channels(selectedChannels).filter(value => !available.includes(value)) } : {}),
      ...(Array.isArray(record(payload.publicationChannelSelection).unvalidatedChannels) ? { unvalidatedChannels: channels(record(payload.publicationChannelSelection).unvalidatedChannels) } : {}),
    },
  };
}
