import { Suspense } from "react";
import DashboardClient from "./DashboardClient";
import ClientHydrationGate from "./_components/ClientHydrationGate";
import { getMyRole } from "@/lib/roles";
import { getTranslations } from "next-intl/server";
import { getCurrentInrcyAccountScope } from "@/lib/multicompte/server";
import { getChannelConnectionStates, type ChannelStates } from "@/lib/channelConnectionState";
import { isMetaChannelPilotEnabledForActorAndAccount } from "@/lib/metaChannelRolloutServer";

type InitialOfficialChannelSnapshot = {
  activeUserId: string;
  states: ChannelStates;
};

async function loadInitialOfficialChannelStates(): Promise<InitialOfficialChannelSnapshot | null> {
  try {
    const current = await getCurrentInrcyAccountScope();
    if (!current) return null;
    const metaPilotEnabled = await isMetaChannelPilotEnabledForActorAndAccount(current.supabase, current.scope.activeUserId);
    return {
      activeUserId: current.scope.activeUserId,
      states: await getChannelConnectionStates(current.supabase, current.scope.activeUserId, undefined, { metaPilotEnabled }),
    };
  } catch {
    // The account-scoped browser snapshot keeps the last confirmed colours.
    // DashboardClient continues revalidating the canonical state in background.
    return null;
  }
}

export default async function Page() {
  const [
    { isAdmin },
    t,
    initialOfficialChannelSnapshot,
  ] = await Promise.all([
    getMyRole(),
    getTranslations("common"),
    loadInitialOfficialChannelStates(),
  ]);

  return (
    <Suspense fallback={null}>
      <ClientHydrationGate label={t("dashboardBoot")}>
        <DashboardClient
          isAdmin={isAdmin}
          initialOfficialChannelStates={initialOfficialChannelSnapshot?.states ?? null}
          initialOfficialChannelStatesUserId={initialOfficialChannelSnapshot?.activeUserId ?? null}
        />
      </ClientHydrationGate>
    </Suspense>
  );
}
