import { NextResponse } from "next/server";

import { adsBadOriginResponse, adsRequestOriginAllowed, requirePremiumAdsUser } from "@/lib/adsServer";
import {
  PINTEREST_ADS_PRODUCT,
  PINTEREST_ADS_PROVIDER,
  PINTEREST_ADS_SOURCE,
} from "@/lib/adsPinterestServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(request: Request) {
  if (!adsRequestOriginAllowed(request)) return adsBadOriginResponse();
  const { user, errorResponse } = await requirePremiumAdsUser();
  if (errorResponse || !user) return errorResponse;

  const { error } = await supabaseAdmin.from("integrations").delete()
    .eq("user_id", user.activeUserId)
    .eq("provider", PINTEREST_ADS_PROVIDER)
    .eq("source", PINTEREST_ADS_SOURCE)
    .eq("product", PINTEREST_ADS_PRODUCT);
  if (error) {
    return NextResponse.json({ error: "Impossible de déconnecter Pinterest Ads.", code: "storage_unavailable" }, { status: 500 });
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
