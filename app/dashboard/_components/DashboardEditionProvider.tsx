"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { DashboardEdition } from "@/lib/dashboardEdition";

const DashboardEditionContext = createContext<DashboardEdition>("premium");
const DashboardSubscriptionEditionContext = createContext<DashboardEdition>("premium");

export default function DashboardEditionProvider({
  edition,
  subscriptionEdition = edition,
  children,
}: {
  edition: DashboardEdition;
  /** Commercial subscription, distinct from temporary reviewer tool access. */
  subscriptionEdition?: DashboardEdition;
  children: ReactNode;
}) {
  return (
    <DashboardEditionContext.Provider value={edition}>
      <DashboardSubscriptionEditionContext.Provider value={subscriptionEdition}>
        {children}
      </DashboardSubscriptionEditionContext.Provider>
    </DashboardEditionContext.Provider>
  );
}

export function useDashboardEdition(): DashboardEdition {
  return useContext(DashboardEditionContext);
}

export function useDashboardSubscriptionEdition(): DashboardEdition {
  return useContext(DashboardSubscriptionEditionContext);
}
