/** Native rendered links/popovers only. URLs remain browser-local; model input
 * chooses a finite channel and never supplies an address or a DOM selector. */
export const INR_ASSISTANT_PUBLIC_LINK_TARGETS = ['site_web', 'site_inrcy', 'inr_search', 'inr_badge', 'gmb', 'facebook', 'instagram', 'threads', 'linkedin', 'linkedin_profile', 'linkedin_organization', 'x', 'pinterest', 'tiktok', 'youtube_shorts'] as const;
export type InrAssistantPublicLinkTarget = typeof INR_ASSISTANT_PUBLIC_LINK_TARGETS[number];
export type InrAssistantNativeLinkKind = 'public' | 'editor' | 'draft';
type Scope = { actorUserId: string; accountId: string; pathname: string };
export type InrAssistantNativeChannelLink = Scope & { kind: InrAssistantNativeLinkKind; target: InrAssistantPublicLinkTarget; identity: string; state: unknown; blocked: boolean; invoke(operation: 'open' | 'close' | 'clear'): void; matches(state: unknown, operation: 'open' | 'close' | 'clear'): boolean };
type Snapshot = Array<Scope & Pick<InrAssistantNativeChannelLink, 'kind' | 'target' | 'identity' | 'state' | 'blocked'> & { key: string }>;
const entries = new Map<string, InrAssistantNativeChannelLink>(), observers = new Set<() => void>();
const empty: Snapshot = []; let snapshot = empty;
const sameScope = (a: Scope, b: Scope) => a.actorUserId === b.actorUserId && a.accountId === b.accountId && a.pathname === b.pathname;
export function canonicalInrAssistantPublicLinkTarget(value: string, linkedinTarget?: string): InrAssistantPublicLinkTarget | null {
  const aliases: Record<string, string> = { siteWeb: 'site_web', siteInrcy: 'site_inrcy', inrSearch: 'inr_search', inrBadge: 'inr_badge', inrbadge: 'inr_badge', youtube: 'youtube_shorts', twitter: 'x', google_business: 'gmb' };
  const target = value === 'linkedin' && ['profile', 'organization'].includes(linkedinTarget ?? '') ? `linkedin_${linkedinTarget}` : aliases[value] ?? value;
  return INR_ASSISTANT_PUBLIC_LINK_TARGETS.includes(target as never) ? target as InrAssistantPublicLinkTarget : null;
}
export function registerInrAssistantNativeChannelLink(key: string, entry: InrAssistantNativeChannelLink | null) {
  if (entry) entries.set(key, entry); else entries.delete(key);
  const next: Snapshot = [...entries.entries()].map(([key, { kind, target, identity, state, blocked, actorUserId, accountId, pathname }]) => ({ key, kind, target, identity, state, blocked, actorUserId, accountId, pathname }));
  if (JSON.stringify(next) !== JSON.stringify(snapshot)) { snapshot = next; observers.forEach(notify => notify()); }
}
export const getInrAssistantNativeChannelLinksSnapshot = () => snapshot;
export const getInrAssistantNativeChannelLinksServerSnapshot = () => empty;
export function subscribeInrAssistantNativeChannelLinks(notify: () => void) { observers.add(notify); return () => { observers.delete(notify); }; }
export function requestInrAssistantNativeChannelLink(scope: Scope, kind: InrAssistantNativeLinkKind, target: string | null, operation: 'open' | 'close' | 'clear', stillCurrent: () => boolean, expected: Snapshot) {
  if (!target || !INR_ASSISTANT_PUBLIC_LINK_TARGETS.includes(target as never) || !stillCurrent()) throw new Error('Native channel link unavailable');
  const candidates = [...entries.entries()].filter(([, entry]) => sameScope(entry, scope) && entry.kind === kind && entry.target === target && !entry.blocked);
  // Several responsive copies may offer the same public link. Different links,
  // editors or drafts are ambiguous and must never be picked by mount order.
  if (!candidates.length || candidates.length > 1 && (kind !== 'public' || new Set(candidates.map(([, entry]) => entry.identity)).size !== 1)) throw new Error('Native channel target is ambiguous');
  const previous = expected.filter(row => sameScope(row, scope) && row.kind === kind && row.target === target && !row.blocked);
  const current = snapshot.filter(row => sameScope(row, scope) && row.kind === kind && row.target === target && !row.blocked);
  if (JSON.stringify(previous) !== JSON.stringify(current)) throw new Error('Native channel state changed before bridge commit');
  const [key, entry] = candidates[0]; entry.invoke(operation);
  return { key, identity: entry.identity, matches: (rows: Snapshot) => {
    if (!stillCurrent()) return false;
    const current = entries.get(key), row = rows.find(row => row.key === key);
    return Boolean(current && row && sameScope(current, scope) && current.identity === entry.identity && current.matches(row.state, operation));
  } };
}

export function isNativePublicChannelHref(value: string): boolean {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}
