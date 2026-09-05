import type { ReactNode } from "react";

import { requireDashboardRequiredSetupCompleted } from "@/lib/dashboardRequiredSetupServer";

export default async function RequiredSetupProtectedLayout({ children }: { children: ReactNode }) {
  await requireDashboardRequiredSetupCompleted();
  return <>{children}</>;
}
