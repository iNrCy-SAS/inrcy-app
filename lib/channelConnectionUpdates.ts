import { accountScopedStorageKey, getActiveBrowserUserId } from "@/lib/browserAccountCache";
import { DASHBOARD_CACHE_KEYS } from "@/lib/dashboardCacheKeys";

export const CHANNEL_CONNECTION_UPDATED_EVENT = "inrcy:channel-connection-updated";

function snapshotState(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const state = parsed?.state ?? parsed;
    if (!state || typeof state !== "object" || Array.isArray(state)) return raw;
    // Cache timestamps change on every hydration; only actual state changes
    // should make another tab re-read channel availability.
    return JSON.stringify(Object.keys(state).sort().map(key => [key, state[key]]));
  } catch {
    return raw;
  }
}

/** Revalidate availability after a confirmed change, including in another tab. */
export function subscribeToChannelConnectionUpdates(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  let active = true;
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    const accountId = getActiveBrowserUserId();
    queueMicrotask(() => {
      queued = false;
      if (active && accountId === getActiveBrowserUserId()) onChange();
    });
  };
  const onConfirmedChange = (event: Event) => {
    const accountId = (event as CustomEvent<{ accountId?: string | null }>).detail?.accountId;
    if (accountId !== undefined && accountId !== getActiveBrowserUserId()) return;
    schedule();
  };
  const onStorage = (event: StorageEvent) => {
    const key = accountScopedStorageKey(DASHBOARD_CACHE_KEYS.channelState);
    if (!key || event.key !== key || snapshotState(event.oldValue) === snapshotState(event.newValue)) return;
    schedule();
  };
  window.addEventListener(CHANNEL_CONNECTION_UPDATED_EVENT, onConfirmedChange);
  window.addEventListener("storage", onStorage);
  return () => {
    active = false;
    window.removeEventListener(CHANNEL_CONNECTION_UPDATED_EVENT, onConfirmedChange);
    window.removeEventListener("storage", onStorage);
  };
}
