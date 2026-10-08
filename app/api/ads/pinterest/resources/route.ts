import { NextResponse } from "next/server";
import { requirePremiumAdsUser } from "@/lib/adsServer";
import { readPinterestAdsDeliveryResources } from "@/lib/adsPinterestResourcesServer";
import { PinterestAdsConnectionError } from "@/lib/adsPinterestServer";
import { enforceRateLimit } from "@/lib/rateLimit";
const headers = { "Cache-Control": "no-store" };

export async function GET() {
  const { user, errorResponse } = await requirePremiumAdsUser("pinterest");
  if (errorResponse || !user) return errorResponse;
  const limited = await enforceRateLimit({ name: "ads_pinterest_resources", identifier: user.activeUserId, limit: 30, fallbackLimit: 15, window: "5 m", code: "pinterest_ads_resources_rate_limit" });
  if (limited) { limited.headers.set("Cache-Control", "no-store"); return limited; }
  try {
    const { resources } = await readPinterestAdsDeliveryResources(user.activeUserId);
    return NextResponse.json(resources, { headers });
  } catch (error) {
    const known = error instanceof PinterestAdsConnectionError ? error : null;
    return NextResponse.json({ error: known?.message || "Les paramètres natifs Pinterest n’ont pas pu être vérifiés. Réessayez.", code: known?.code || "pinterest_resources_unavailable" }, { status: known?.status || 503, headers });
  }
}
