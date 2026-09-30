import { NextResponse } from "next/server";

import { adsBadOriginResponse, adsRequestOriginAllowed, requirePremiumAdsUser } from "@/lib/adsServer";
import { TIKTOK_ADS_PRODUCT, TIKTOK_ADS_SOURCE } from "@/lib/adsTikTokPolicy";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(request: Request) {
  if (!adsRequestOriginAllowed(request)) return adsBadOriginResponse();
  const { user, errorResponse } = await requirePremiumAdsUser("tiktok");
  if (errorResponse || !user) return errorResponse;

  const { error } = await supabaseAdmin.from("integrations").delete()
    .eq("user_id", user.activeUserId)
    .eq("provider", "tiktok")
    .eq("source", TIKTOK_ADS_SOURCE)
    .eq("product", TIKTOK_ADS_PRODUCT);
  if (error) {
    return NextResponse.json({ error: "Impossible de déconnecter TikTok Ads.", code: "storage_unavailable" }, { status: 500 });
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
