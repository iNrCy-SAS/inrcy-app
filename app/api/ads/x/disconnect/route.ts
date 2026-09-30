import { NextResponse } from "next/server";

import { adsBadOriginResponse, adsRequestOriginAllowed, requirePremiumAdsUser } from "@/lib/adsServer";
import { X_ADS_PRODUCT, X_ADS_PROVIDER, X_ADS_SOURCE } from "@/lib/adsXServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(request: Request) {
  if (!adsRequestOriginAllowed(request)) return adsBadOriginResponse();
  const { user, errorResponse } = await requirePremiumAdsUser("x");
  if (errorResponse || !user) return errorResponse;

  const { error } = await supabaseAdmin.from("integrations").delete()
    .eq("user_id", user.activeUserId)
    .eq("provider", X_ADS_PROVIDER)
    .eq("source", X_ADS_SOURCE)
    .eq("product", X_ADS_PRODUCT);
  if (error) {
    return NextResponse.json({ error: "Impossible de déconnecter X Ads.", code: "storage_unavailable" }, { status: 500 });
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
