/** Narrow native port for the root cookie banner, which is intentionally above
 * the authenticated dashboard provider. It exposes no consent setter or data. */
type Entry = { available: boolean; open: boolean; setOpen: (open: boolean) => void };
const entries = new Map<string, Entry>(), observers = new Set<() => void>();
const absent = { available: false, open: false };
let snapshot = absent;
export function registerInrAssistantCookieOptions(key: string, entry: Entry | null) {
  if (entry) entries.set(key, entry); else entries.delete(key);
  const only = entries.size === 1 ? [...entries.values()][0] : null;
  const next = only?.available ? { available: true, open: only.open } : absent;
  if (next.available !== snapshot.available || next.open !== snapshot.open) { snapshot = next; observers.forEach(notify => notify()); }
}
export const getInrAssistantCookieOptionsSnapshot = () => snapshot;
export const getInrAssistantCookieOptionsServerSnapshot = () => absent;
export function subscribeInrAssistantCookieOptions(notify: () => void) { observers.add(notify); return () => { observers.delete(notify); }; }
export function setNativeInrAssistantCookieOptions(open: boolean) {
  const only = entries.size === 1 ? [...entries.values()][0] : null;
  if (!only?.available) throw new Error("Cookie options unavailable");
  only.setOpen(open);
}
