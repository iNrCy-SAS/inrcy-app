"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { DashboardEdition } from "@/lib/dashboardEdition";

const DashboardEditionContext = createContext<DashboardEdition>("premium");

export default function DashboardEditionProvider({
  edition,
  children,
}: {
  edition: DashboardEdition;
  children: ReactNode;
}) {
  return (
    <DashboardEditionContext.Provider value={edition}>
      {children}
    </DashboardEditionContext.Provider>
  );
}

export function useDashboardEdition(): DashboardEdition {
  return useContext(DashboardEditionContext);
}
