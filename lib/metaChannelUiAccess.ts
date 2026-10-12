/** Apply the trusted Meta rollout to API payloads and older browser snapshots. */
export function isMetaPilotChannelVisible(channel: unknown, enabled: boolean): boolean {
  return enabled || String(channel || "").trim().toLowerCase() !== "threads";
}

function itemUsesOnlyThreads(item: unknown): boolean {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  const row = item as Record<string, unknown>;
  if (String(row.channel || row.channel_key || row.source || "").toLowerCase() === "threads") return true;
  const payload = row.payload && typeof row.payload === "object" ? row.payload as Record<string, unknown> : {};
  const channels = row.targetChannels ?? row.channels ?? payload.channels ?? payload.targetChannels;
  return Array.isArray(channels) && channels.length > 0 && channels.every((value) => !isMetaPilotChannelVisible(value, false));
}

export function filterMetaPilotItems<T>(items: readonly T[], enabled: boolean): T[] {
  return enabled ? [...items] : items.filter((item) => !itemUsesOnlyThreads(item)).map((item) => filterMetaPilotPayload(item, false));
}

export function filterMetaPilotPayload<T>(value: T, enabled: boolean): T {
  if (enabled || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.filter((item) => isMetaPilotChannelVisible(item, false) && !itemUsesOnlyThreads(item)).map((item) => filterMetaPilotPayload(item, false)) as T;
  }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => isMetaPilotChannelVisible(key, false))
    .map(([key, item]) => [key, filterMetaPilotPayload(item, false)])) as T;
}
