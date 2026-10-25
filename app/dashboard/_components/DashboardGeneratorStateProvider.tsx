"use client";

import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import { ACTIVE_INRCY_ACCOUNT_EVENT } from "@/lib/multicompte/constants";

export type DashboardGeneratorSnapshot = {
  multiplier: number;
  connectedCount: number;
  totalChannels: number;
};

export type DashboardGeneratorState = {
  isActive: boolean | null;
  inertiaSnapshot?: DashboardGeneratorSnapshot;
};

type PublishedGeneratorState = DashboardGeneratorState & { accountId: string };
const UNKNOWN_GENERATOR: DashboardGeneratorState = { isActive: null };
const GeneratorStateContext = createContext<DashboardGeneratorState>(UNKNOWN_GENERATOR);
const GeneratorPublisherContext = createContext<(state: PublishedGeneratorState) => void>(() => {});

function subscribeToAccount(listener: () => void) {
  window.addEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, listener);
  return () => window.removeEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, listener);
}

/** Layout-owned memory survives tool navigation, but never crosses accounts. */
export default function DashboardGeneratorStateProvider({ accountId, children }: {
  accountId: string;
  children: ReactNode;
}) {
  const [published, setPublished] = useState<PublishedGeneratorState | null>(null);
  const browserAccountId = useSyncExternalStore(subscribeToAccount, getActiveBrowserUserId, () => null);
  const publish = useCallback((next: PublishedGeneratorState) => {
    const currentBrowserAccount = getActiveBrowserUserId();
    if (!accountId || next.accountId !== accountId || currentBrowserAccount !== accountId) return;
    if (next.isActive === null) return;
    setPublished((previous) => {
      const before = previous?.inertiaSnapshot;
      const after = next.inertiaSnapshot;
      if (previous?.accountId === next.accountId && previous.isActive === next.isActive &&
        before?.multiplier === after?.multiplier && before?.connectedCount === after?.connectedCount &&
        before?.totalChannels === after?.totalChannels) return previous;
      return next;
    });
  }, [accountId]);
  const state = useMemo<DashboardGeneratorState>(() => {
    if (!accountId || published?.accountId !== accountId || browserAccountId !== accountId) return UNKNOWN_GENERATOR;
    return { isActive: published.isActive, inertiaSnapshot: published.inertiaSnapshot };
  }, [accountId, browserAccountId, published]);

  return (
    <GeneratorPublisherContext.Provider value={publish}>
      <GeneratorStateContext.Provider value={state}>{children}</GeneratorStateContext.Provider>
    </GeneratorPublisherContext.Provider>
  );
}

export function useDashboardGeneratorState() {
  return useContext(GeneratorStateContext);
}

export function useDashboardGeneratorPublisher() {
  return useContext(GeneratorPublisherContext);
}
