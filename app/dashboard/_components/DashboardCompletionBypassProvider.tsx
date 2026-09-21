"use client";

import { createContext, useContext, type ReactNode } from "react";

const DashboardCompletionBypassContext = createContext<boolean>(false);

/**
 * Dedicated E2E helper: it stabilises onboarding/completion indicators only.
 * Dashboard access never depends on this context.
 */
export function DashboardCompletionBypassProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  return (
    <DashboardCompletionBypassContext.Provider value={enabled}>
      {children}
    </DashboardCompletionBypassContext.Provider>
  );
}

export function useDashboardCompletionBypass() {
  return useContext(DashboardCompletionBypassContext);
}
