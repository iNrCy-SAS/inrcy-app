import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { isAdsPilotAdmin, isAdsUserAllowed } from "@/lib/adsServer";
import { isAdsPublicChannel } from "@/lib/adsAccessPolicy";
import { isAdsChannelPublishEnabled } from "@/lib/adsPublishMode";
import { readAdsConnectionSnapshots } from "@/lib/adsConnectionSnapshotServer";
import { resolveInrcyAccountScopeForUser } from "@/lib/multicompte/server";
import { isAdsChannelId } from "@/lib/adsValidation";
import AdsClient from "./AdsClient";

export const dynamic = "force-dynamic";

export default async function AdsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const accountScope = await resolveInrcyAccountScopeForUser(supabase, data.user);
  if (!(await isAdsUserAllowed(data.user.id, accountScope.activeUserId))) redirect("/dashboard?panel=abonnement");
  const pilotChannelsEnabled = await isAdsPilotAdmin(data.user.id);
  const initialConnections = await readAdsConnectionSnapshots(accountScope.activeUserId);
  const params = await searchParams;
  const requestedChannel = Array.isArray(params.channel) ? params.channel[0] : params.channel;
  const channel = isAdsChannelId(requestedChannel) && (pilotChannelsEnabled || isAdsPublicChannel(requestedChannel)) ? requestedChannel : null;
  return <AdsClient
    key={accountScope.activeUserId}
    initialChannel={channel || "google"}
    pilotChannelsEnabled={pilotChannelsEnabled}
    initialEditCampaignId={typeof params.editCampaign === "string" ? params.editCampaign : ""}
    initialConnections={initialConnections}
    initialConnection={params.connection === "connected" ? "connected" : params.connection === "error" ? "error" : null}
    initialReason={typeof params.reason === "string" ? params.reason : ""}
    livePublishingEnabled={process.env.INRCY_ADS_LIVE_PUBLISH_ENABLED === "true"}
    googlePublishingEnabled={isAdsChannelPublishEnabled("google", "live", process.env)}
    pinterestPublishingEnabled={isAdsChannelPublishEnabled("pinterest", "live", process.env)}
  />;
}
