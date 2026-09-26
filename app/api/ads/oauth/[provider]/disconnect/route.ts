import { NextResponse } from "next/server";
import { adsOAuthProvider } from "@/lib/adsOAuth";
import { adsBadOriginResponse, adsRequestOriginAllowed, requirePremiumAdsUser } from "@/lib/adsServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(request: Request, context: { params: Promise<{ provider: string }> }) {
  if (!adsRequestOriginAllowed(request)) return adsBadOriginResponse();
  const provider = adsOAuthProvider((await context.params).provider);
  if (!provider) return NextResponse.json({ error: "Canal publicitaire inconnu." }, { status: 404 });

  const { user, errorResponse } = await requirePremiumAdsUser();
  if (errorResponse || !user) return errorResponse;

  const source = provider === "meta" ? "meta_ads" : "google_ads";
  const { error } = await supabaseAdmin
    .from("integrations")
    .delete()
    .eq("user_id", user.activeUserId)
    .eq("source", source)
    .eq("product", "ads");
  if (error) return NextResponse.json({ error: `Impossible de déconnecter ${provider === "meta" ? "Meta Ads" : "Google Ads"}.` }, { status: 500 });

  return NextResponse.json({ ok: true });
}
