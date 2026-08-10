import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { getChannelConnectionStates } from "@/lib/channelConnectionState";
import { computeInertiaSnapshot } from "@/lib/loyalty/inertia";
import { getIsoWeekId, getIsoWeekStart } from "@/lib/weeklyGoals";
import { repairWeeklyMissionAwardsForUser } from "@/lib/loyalty/serverAward";
import { getDashboardEditionForAccountId } from "@/lib/dashboardEditionServer";

type LedgerRow = {
  created_at: string;
  action_key: string;
  amount: number | null;
  meta: Record<string, unknown> | null;
};

export async function GET() {
  const { supabase, user, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const weekStart = getIsoWeekStart();
  const weekId = getIsoWeekId();
  const dashboardEdition = await getDashboardEditionForAccountId(activeUserId);

  await repairWeeklyMissionAwardsForUser(activeUserId, {
    includePremiumMissions: dashboardEdition !== "standard",
  }).catch(() => null);

  const [states, ledgerRes] = await Promise.all([
    getChannelConnectionStates(supabase, activeUserId),
    supabase
      .from("loyalty_ledger")
      .select("created_at,action_key,amount,meta")
      .eq("user_id", activeUserId)
      .gte("created_at", weekStart.toISOString())
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const snapshot = computeInertiaSnapshot({
    site_inrcy: states.site_inrcy.connected && states.site_inrcy.statsConnected,
    site_web: states.site_web.connected && states.site_web.statsConnected,
    gmb: states.gmb.connected && !states.gmb.requiresUpdate,
    facebook: states.facebook.connected && !states.facebook.requiresUpdate,
    instagram: states.instagram.connected && !states.instagram.requiresUpdate,
    linkedin: states.linkedin.connected && !states.linkedin.requiresUpdate,
    tiktok: states.tiktok.connected && !states.tiktok.requiresUpdate,
    youtube_shorts: states.youtube_shorts.connected && !states.youtube_shorts.requiresUpdate,
  }, { maxMultiplier: 7 });

  const events = ((ledgerRes.data ?? []) as LedgerRow[]).filter((row) => new Date(row.created_at) >= weekStart);
  const hasAction = (key: string) => events.some((row) => row.action_key === key);
  const sumAction = (key: string) => events.filter((row) => row.action_key === key).reduce((acc, row) => acc + Number(row.amount ?? 0), 0);

  const createActuDone = hasAction("create_actu");
  const legacyFeatureDone = hasAction("weekly_feature_use");
  const propulserDone = hasAction("weekly_propulser_use");
  const fideliserDone = hasAction("weekly_fideliser_use");

  return NextResponse.json({
    weekId,
    weekStart: weekStart.toISOString(),
    turbo: {
      multiplier: snapshot.multiplier,
      connectedCount: snapshot.connectedCount,
      totalChannels: snapshot.totalChannels,
    },
    missions: {
      createActu: {
        done: createActuDone,
        gained: sumAction("create_actu"),
        projected: Math.round(10 * snapshot.multiplier),
      },
      // Compat ancienne mission commune, conservée pour ne pas perdre l’historique.
      weeklyFeatureUse: {
        done: legacyFeatureDone,
        gained: sumAction("weekly_feature_use"),
        projected: Math.round(10 * snapshot.multiplier),
      },
      weeklyPropulserUse: {
        done: propulserDone,
        gained: sumAction("weekly_propulser_use"),
        projected: Math.round(10 * snapshot.multiplier),
      },
      weeklyFideliserUse: {
        done: fideliserDone,
        gained: sumAction("weekly_fideliser_use"),
        projected: Math.round(10 * snapshot.multiplier),
      },
    },
  });
}
