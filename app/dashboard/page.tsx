import { Suspense } from "react";
import DashboardClient from "./DashboardClient";
import ClientHydrationGate from "./_components/ClientHydrationGate";
import { getMyRole } from "@/lib/roles";
import { isDashboardRequiredSetupProtectedLocation } from "@/lib/dashboardRequiredSetupAccess";
import { requireDashboardRequiredSetupCompleted } from "@/lib/dashboardRequiredSetupServer";
import { getTranslations } from "next-intl/server";
import { getCurrentInrcyAccountScope } from "@/lib/multicompte/server";
import { getChannelConnectionStates, type ChannelStates } from "@/lib/channelConnectionState";

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

async function loadInitialOfficialChannelStates(): Promise<ChannelStates | null> {
  try {
    const current = await getCurrentInrcyAccountScope();
    if (!current) return null;
    return await getChannelConnectionStates(current.supabase, current.scope.activeUserId);
  } catch {
    // The account-scoped browser snapshot keeps the last confirmed colours.
    // DashboardClient continues revalidating the canonical state in background.
    return null;
  }
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

  const [{ isAdmin }, t, initialOfficialChannelStates] = await Promise.all([
    getMyRole(),
    getTranslations("common"),
    loadInitialOfficialChannelStates(),
  ]);

  return (
    <Suspense fallback={null}>
      <ClientHydrationGate label={t("dashboardBoot")}>
        <DashboardClient
          isAdmin={isAdmin}
          initialOfficialChannelStates={initialOfficialChannelStates}
        />
      </ClientHydrationGate>
    </Suspense>
  );
}
