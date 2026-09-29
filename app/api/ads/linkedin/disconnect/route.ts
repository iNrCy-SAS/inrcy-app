import { NextResponse } from "next/server";
import { adsBadOriginResponse, adsRequestOriginAllowed, requirePremiumAdsUser } from "@/lib/adsServer";
import { LINKEDIN_ADS_PRODUCT, LINKEDIN_ADS_PROVIDER, LINKEDIN_ADS_SOURCE } from "@/lib/adsLinkedInServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(request: Request) {
  if (!adsRequestOriginAllowed(request)) return adsBadOriginResponse();
  const { user, errorResponse } = await requirePremiumAdsUser();
  if (errorResponse || !user) return errorResponse;
  const { error } = await supabaseAdmin.from("integrations").delete()
    .eq("user_id", user.activeUserId)
    .eq("provider", LINKEDIN_ADS_PROVIDER)
    .eq("source", LINKEDIN_ADS_SOURCE)
    .eq("product", LINKEDIN_ADS_PRODUCT);
  if (error) return NextResponse.json(
    { error: "Impossible de déconnecter LinkedIn Ads.", code: "storage_unavailable" },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
