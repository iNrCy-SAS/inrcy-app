"use client";
import { useId, useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from 'react';
import { usePathname } from 'next/navigation';
import { useDashboardViewerAccess } from '../_components/DashboardViewerAccessProvider';
import { canonicalInrAssistantPublicLinkTarget, getInrAssistantNativeChannelLinksServerSnapshot, getInrAssistantNativeChannelLinksSnapshot, isNativePublicChannelHref, registerInrAssistantNativeChannelLink, requestInrAssistantNativeChannelLink, subscribeInrAssistantNativeChannelLinks, type InrAssistantNativeChannelLink, type InrAssistantNativeLinkKind } from '@/lib/inrAssistantNativeChannelLinks';
import { useInrAssistantLocalInterface } from './useInrAssistantLocalInterface';

export function useInrAssistantNativeChannelLink(targetName: string, linkedinTarget: string | undefined, entry: Omit<InrAssistantNativeChannelLink, 'actorUserId' | 'accountId' | 'pathname' | 'target'>, enabled = true) {
  const key = useId(), pathname = usePathname();
  const { actorUserId, activeAccountId } = useDashboardViewerAccess();
  const target = canonicalInrAssistantPublicLinkTarget(targetName, linkedinTarget);
  useLayoutEffect(() => { registerInrAssistantNativeChannelLink(key, enabled && target && actorUserId && activeAccountId ? { ...entry, target, pathname, actorUserId, accountId: activeAccountId } : null); });
  useLayoutEffect(() => () => registerInrAssistantNativeChannelLink(key, null), [key]);
}

/** Hand off the exact rendered anchor to the browser. This ACK proves the
 * native opening request, never the external page load or popup permission. */
export function useInrAssistantRenderedPublicLink(targetName: string, href: string, anchor: RefObject<HTMLAnchorElement | null>, enabled = true, linkedinTarget?: string) {
  const requested = useRef('');
  useInrAssistantNativeChannelLink(targetName, linkedinTarget, { kind: 'public', identity: href, state: { href }, blocked: false,
    invoke: operation => { const node = anchor.current; if (operation !== 'open' || !node?.isConnected || !isNativePublicChannelHref(href) || node.href !== new URL(href).href) throw new Error('Rendered public link changed'); node.click(); requested.current = href; },
    matches: () => requested.current === href,
  }, enabled && isNativePublicChannelHref(href));
}

/** One bridge per kind avoids duplicate generic IDs in every channel bubble. */
function useNativeChannelLinkBridge(kind: InrAssistantNativeLinkKind) {
  const pathname = usePathname(), { actorUserId, activeAccountId } = useDashboardViewerAccess();
  const scope = { pathname, actorUserId: actorUserId ?? '', accountId: activeAccountId ?? '' };
  const rows = useSyncExternalStore(subscribeInrAssistantNativeChannelLinks, getInrAssistantNativeChannelLinksSnapshot, getInrAssistantNativeChannelLinksServerSnapshot);
  const scoped = rows.filter(row => row.kind === kind && row.pathname === pathname && row.actorUserId === actorUserId && row.accountId === activeAccountId);
  const applied = useRef<ReturnType<typeof requestInrAssistantNativeChannelLink> | null>(null);
  const handler = (operation: 'open' | 'close' | 'clear') => ({ invoke(value: string | null, stillCurrent: () => boolean) { applied.current = null; applied.current = requestInrAssistantNativeChannelLink(scope, kind, value, operation, stillCurrent, scoped); }, matches() { return Boolean(applied.current?.matches(getInrAssistantNativeChannelLinksSnapshot())); }, ...(kind === 'public' ? { immediate: true } : {}) });
  useInrAssistantLocalInterface(kind === 'public' ? 'public_channel_link' : kind === 'editor' ? 'channel_link_editor' : 'channel_link_draft', scoped,
    kind === 'public' ? { open: handler('open') } : kind === 'editor' ? { open: handler('open'), close: handler('close') } : { clear: handler('clear') }, scoped.length > 0);
}
export function useInrAssistantNativeChannelLinks() { useNativeChannelLinkBridge('public'); useNativeChannelLinkBridge('editor'); useNativeChannelLinkBridge('draft'); }
