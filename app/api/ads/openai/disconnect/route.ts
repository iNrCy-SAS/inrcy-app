import { NextResponse } from "next/server";

import { adsBadOriginResponse, adsRequestOriginAllowed, requirePremiumAdsUser } from "@/lib/adsServer";
import { OPENAI_ADS_PRODUCT, OPENAI_ADS_PROVIDER, OPENAI_ADS_SOURCE } from "@/lib/adsOpenaiServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(request: Request) {
  if (!adsRequestOriginAllowed(request)) return adsBadOriginResponse();
  const { user, errorResponse } = await requirePremiumAdsUser("openai");
  if (errorResponse || !user) return errorResponse;
  const { error } = await supabaseAdmin.from("integrations").delete()
    .eq("user_id", user.activeUserId)
    .eq("provider", OPENAI_ADS_PROVIDER)
    .eq("source", OPENAI_ADS_SOURCE)
    .eq("product", OPENAI_ADS_PRODUCT);
  if (error) return NextResponse.json({ error: "Impossible de déconnecter ChatGPT Ads.", code: "storage_unavailable" },
    { status: 500, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
