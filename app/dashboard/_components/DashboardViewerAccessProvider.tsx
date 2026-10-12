"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import { ACTIVE_INRCY_ACCOUNT_EVENT } from "@/lib/multicompte/constants";
import { isMetaChannelPilotEnabled } from "@/lib/metaChannelRollout";

type DashboardViewerAccess = {
  /** Both the authenticated actor and the active account have the trusted admin role. */
  viewerIsAdmin: boolean;
  activeAccountId: string;
  metaPilotEnabled: boolean;
};

const DashboardViewerAccessContext = createContext<DashboardViewerAccess>({
  viewerIsAdmin: false,
  activeAccountId: "",
  metaPilotEnabled: false,
});

export default function DashboardViewerAccessProvider({ viewerIsAdmin, activeAccountId, children }: {
  viewerIsAdmin: boolean;
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
    activeAccountId,
    viewerIsAdmin: viewerIsAdmin && browserAccountId === activeAccountId,
    metaPilotEnabled: isMetaChannelPilotEnabled(viewerIsAdmin && browserAccountId === activeAccountId),
  }), [activeAccountId, browserAccountId, viewerIsAdmin]);
  return <DashboardViewerAccessContext.Provider value={access}>{children}</DashboardViewerAccessContext.Provider>;
}

export function useDashboardViewerAccess(): DashboardViewerAccess {
  return useContext(DashboardViewerAccessContext);
}
