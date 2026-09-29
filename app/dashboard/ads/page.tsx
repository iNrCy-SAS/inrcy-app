import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { isAdsPilotAdmin } from "@/lib/adsServer";
import { readAdsConnectionSnapshots } from "@/lib/adsConnectionSnapshotServer";
import { resolveInrcyAccountScopeForUser } from "@/lib/multicompte/server";
import { isAdsChannelId } from "@/lib/adsValidation";
import AdsClient from "./AdsClient";

export const dynamic = "force-dynamic";

export default async function AdsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  if (!(await isAdsPilotAdmin(data.user.id))) redirect("/dashboard");
  const accountScope = await resolveInrcyAccountScopeForUser(supabase, data.user);
  const initialConnections = await readAdsConnectionSnapshots(accountScope.activeUserId);
  const params = await searchParams;
  const requestedChannel = Array.isArray(params.channel) ? params.channel[0] : params.channel;
  const channel = isAdsChannelId(requestedChannel) ? requestedChannel : null;
  return <AdsClient
    initialChannel={channel || "meta"}
    initialEditCampaignId={typeof params.editCampaign === "string" ? params.editCampaign : ""}
    initialConnections={initialConnections}
    initialConnection={params.connection === "connected" ? "connected" : params.connection === "error" ? "error" : null}
    initialReason={typeof params.reason === "string" ? params.reason : ""}
    livePublishingEnabled={process.env.INRCY_ADS_LIVE_PUBLISH_ENABLED === "true"}
    demoPausedPublishingEnabled={process.env.INRCY_ADS_DEMO_PAUSED_PUBLISH_ENABLED === "true"}
  />;
}
