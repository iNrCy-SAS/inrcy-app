import { Suspense } from "react";
import DashboardClient from "./DashboardClient";
import ClientHydrationGate from "./_components/ClientHydrationGate";
import { getMyRole } from "@/lib/roles";
import { isDashboardRequiredSetupProtectedLocation } from "@/lib/dashboardRequiredSetupAccess";
import { requireDashboardRequiredSetupCompleted } from "@/lib/dashboardRequiredSetupServer";
import { getTranslations } from "next-intl/server";

type DashboardPageSearchParams = Record<string, string | string[] | undefined>;

function toURLSearchParams(input: DashboardPageSearchParams) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      value.forEach((item) => params.append(key, item));
    } else if (typeof value === "string") {
      params.set(key, value);
    }
  }
  return params;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<DashboardPageSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  if (
    isDashboardRequiredSetupProtectedLocation(
      "/dashboard",
      toURLSearchParams(resolvedSearchParams),
    )
  ) {
    await requireDashboardRequiredSetupCompleted();
  }

  const { isAdmin } = await getMyRole();
  const t = await getTranslations("common");

  return (
    <Suspense fallback={null}>
      <ClientHydrationGate label={t("dashboardBoot")}>
        <DashboardClient isAdmin={isAdmin} />
      </ClientHydrationGate>
    </Suspense>
  );
}
