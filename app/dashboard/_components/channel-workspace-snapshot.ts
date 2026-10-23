import { getActiveBrowserUserId, readAccountCacheValue, writeAccountCacheValue } from "@/lib/browserAccountCache";

const SNAPSHOT_TTL = 10 * 60 * 1000;
const key = (channel: string) => `inrcy_channel_workspace_ui_v1:${channel}`;

/** Display-only, account-scoped snapshots. Every controller still verifies its API. */
export function readChannelWorkspaceSnapshot<T>(channel: string, fallback: T): T {
  try {
    const raw = readAccountCacheValue(key(channel));
    if (!raw) return fallback;
    const snapshot = JSON.parse(raw) as { value?: T; updatedAt?: number };
    return snapshot.value && typeof snapshot.updatedAt === "number" && Date.now() - snapshot.updatedAt < SNAPSHOT_TTL ? snapshot.value : fallback;
  } catch { return fallback; }
}

export function writeChannelWorkspaceSnapshot<T>(channel: string, value: T, accountId = getActiveBrowserUserId()) {
  writeAccountCacheValue(key(channel), JSON.stringify({ value, updatedAt: Date.now() }), accountId);
}
