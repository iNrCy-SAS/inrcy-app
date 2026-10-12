import { normalizeThreadsPublicationMode, type ThreadsPublicationMode } from "./threadsPublicationPreferences.ts";

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord => value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};

/** Historical actions without a saved choice remain Classic. */
export function readInrAgentThreadsPublicationSettings(payload: unknown): { mode: ThreadsPublicationMode } {
  const root = record(payload);
  const nested = record(root.publishPayload);
  const settings = root.threadsPublicationSettings ?? nested.threadsPublicationSettings;
  return { mode: normalizeThreadsPublicationMode(record(settings).mode) };
}

/** Keep the explicit choice even if the account later disables Ghost. */
export function applyInrAgentThreadsPublicationSettings(payload: JsonRecord, mode: ThreadsPublicationMode): JsonRecord {
  const restoreMediaMode = (node: JsonRecord) => {
    const next = { ...node };
    if (mode === "classic" && readInrAgentThreadsPublicationSettings(payload).mode === "ghost") {
      for (const field of ["mediaModeByChannel", "channelMediaModes"]) {
        if (record(next[field]).threads !== "none") continue;
        const map = { ...record(next[field]) };
        delete map.threads;
        next[field] = map;
      }
    }
    return next;
  };
  return {
    ...restoreMediaMode(payload),
    threadsPublicationSettings: { mode },
    publishPayload: { ...restoreMediaMode(record(payload.publishPayload)), threadsPublicationSettings: { mode } },
  };
}

/** Prepare an outgoing request; retained editing media are never deleted. */
export function projectInrAgentThreadsPublishPayload<T extends JsonRecord>(payload: T): T {
  const channels = Array.isArray(payload.channels) ? payload.channels : Array.isArray(payload.selectedChannels) ? payload.selectedChannels : [];
  if (!channels.includes("threads")) {
    const next = { ...payload };
    delete next.threadsPublicationSettings;
    return next;
  }
  const settings = readInrAgentThreadsPublicationSettings(payload);
  const next: JsonRecord = { ...payload, threadsPublicationSettings: settings };
  if (settings.mode !== "ghost") return next as T;
  next.mediaModeByChannel = { ...record(payload.mediaModeByChannel), threads: "none" };
  if (payload.channelMediaModes) next.channelMediaModes = { ...record(payload.channelMediaModes), threads: "none" };
  for (const field of ["imagesByChannel", "videoByChannel", "imageSettingsByChannel", "videoSettingsByChannel", "videoFormatByChannel", "videoAdaptationModeByChannel"]) {
    const map = { ...record(payload[field]) };
    delete map.threads;
    next[field] = map;
  }
  return next as T;
}
