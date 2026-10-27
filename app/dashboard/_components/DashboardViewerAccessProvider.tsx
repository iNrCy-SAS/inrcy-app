"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import { ACTIVE_INRCY_ACCOUNT_EVENT } from "@/lib/multicompte/constants";

type DashboardViewerAccess = {
  /** Both the authenticated actor and the active account have the trusted admin role. */
  viewerIsAdmin: boolean;
  actorUserId: string;
  activeAccountId: string;
  metaPilotEnabled: boolean;
};

const DashboardViewerAccessContext = createContext<DashboardViewerAccess>({
  viewerIsAdmin: false,
  actorUserId: "",
  activeAccountId: "",
  metaPilotEnabled: false,
});

export default function DashboardViewerAccessProvider({ viewerIsAdmin, viewerMetaPilotEnabled, actorUserId, activeAccountId, children }: {
  viewerIsAdmin: boolean;
  /** Authenticated actor, distinct from the selected establishment/account. */
  actorUserId: string;
  /** Trusted server rollout availability for the resolved active account. */
  viewerMetaPilotEnabled: boolean;
  activeAccountId: string;
  children: ReactNode;
}) {
  const [browserAccountId, setBrowserAccountId] = useState(activeAccountId);
  useEffect(() => {
    const update = () => setBrowserAccountId(getActiveBrowserUserId() || activeAccountId);
    update();
    window.addEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, update);
    return () => window.removeEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, update);
  }, [activeAccountId]);
  const access = useMemo(() => ({
    actorUserId,
    activeAccountId,
    viewerIsAdmin: viewerIsAdmin && browserAccountId === activeAccountId,
    metaPilotEnabled: viewerMetaPilotEnabled && browserAccountId === activeAccountId,
  }), [actorUserId, activeAccountId, browserAccountId, viewerIsAdmin, viewerMetaPilotEnabled]);
  return <DashboardViewerAccessContext.Provider value={access}>{children}</DashboardViewerAccessContext.Provider>;
}

export function useDashboardViewerAccess(): DashboardViewerAccess {
  return useContext(DashboardViewerAccessContext);
}
