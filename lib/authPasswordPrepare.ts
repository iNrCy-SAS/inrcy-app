// React StrictMode may mount the finish screen twice. Coalesce the one-time
// OTP verification while it is in flight; a later reload uses the sealed
// server continuation instead of relying on this in-memory map.
const pendingPrepares = new Map<string, Promise<unknown>>();

export function coalescePasswordLinkPrepare<T>(
  key: string,
  prepare: () => Promise<T>,
): Promise<T> {
  const existing = pendingPrepares.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const pending = prepare().finally(() => {
    if (pendingPrepares.get(key) === pending) pendingPrepares.delete(key);
  });
  pendingPrepares.set(key, pending);
  return pending;
}
