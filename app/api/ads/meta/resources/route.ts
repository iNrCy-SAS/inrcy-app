import { NextResponse } from "next/server";
import { requirePremiumAdsUser } from "@/lib/adsServer";
import { MetaAdsPreparationError, readMetaAdsDeliveryResources } from "@/lib/adsMetaResourcesServer";
import { enforceRateLimit } from "@/lib/rateLimit";
export async function GET() {
  const { user, errorResponse } = await requirePremiumAdsUser("meta");
  if (!user || errorResponse) return errorResponse;
  const limited = await enforceRateLimit({ name: "ads_meta_resources", identifier: user.activeUserId, limit: 30, fallbackLimit: 15, window: "5 m", code: "meta_resources_rate_limit" });
  if (limited) { limited.headers.set("Cache-Control", "no-store"); return limited; }
  try { return NextResponse.json(await readMetaAdsDeliveryResources(user.activeUserId), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof MetaAdsPreparationError ? error.message : "Les ressources Meta Ads n’ont pas pu être vérifiées. Actualisez la connexion puis réessayez." }, { status: error instanceof MetaAdsPreparationError ? error.status : 503, headers: { "Cache-Control": "no-store" } }); }
}
