import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { isAdsPilotAdmin } from "@/lib/adsServer";
import { adsOAuthProvider } from "@/lib/adsOAuth";
import AdsClient from "./AdsClient";

export const dynamic = "force-dynamic";

export default async function AdsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  if (!(await isAdsPilotAdmin(data.user.id))) redirect("/dashboard");
  const params = await searchParams;
  const channel = adsOAuthProvider(params.channel);
  return <AdsClient
    initialChannel={channel || "meta"}
    initialConnection={params.connection === "connected" ? "connected" : params.connection === "error" ? "error" : null}
    initialReason={typeof params.reason === "string" ? params.reason : ""}
    livePublishingEnabled={process.env.INRCY_ADS_LIVE_PUBLISH_ENABLED === "true"}
    demoPausedPublishingEnabled={process.env.INRCY_ADS_DEMO_PAUSED_PUBLISH_ENABLED === "true"}
  />;
}
