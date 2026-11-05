"use client";
import { useId, useLayoutEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useDashboardViewerAccess } from '../_components/DashboardViewerAccessProvider';
import { registerInrAssistantLocalInterface, type InrAssistantLocalInterface, type InrAssistantLocalHandler, type InrAssistantLocalOperation } from '@/lib/inrAssistantLocalInterface';

/** Only explicitly supplied native callbacks are registered; no DOM lookup.
 * Snapshot stays in the browser. Public hints contain only a random revision,
 * fixed surface name and finite operations, never form/contact/selection text. */
export function useInrAssistantLocalInterface(id: InrAssistantLocalInterface, snapshot: unknown, handlers: Partial<Record<InrAssistantLocalOperation, InrAssistantLocalHandler>>, enabled = true, busy = false, priority: 0 | 1 = 0) {
  const key = useId(), pathname = usePathname();
  const { actorUserId, activeAccountId } = useDashboardViewerAccess();
  const version = useRef({ fingerprint: '', revision: '' });
  const fingerprint = JSON.stringify({ snapshot, enabled, busy, priority, actorUserId, activeAccountId, pathname, operations: Object.keys(handlers) });
  useLayoutEffect(() => {
    if (version.current.fingerprint !== fingerprint) version.current = { fingerprint, revision: crypto.randomUUID() };
    registerInrAssistantLocalInterface(key, enabled && actorUserId && activeAccountId ? { id, pathname, actorUserId, accountId: activeAccountId, snapshot, revision: version.current.revision, handlers, busy, priority } : null);
  });
  useLayoutEffect(() => () => registerInrAssistantLocalInterface(key, null), [key]);
}
