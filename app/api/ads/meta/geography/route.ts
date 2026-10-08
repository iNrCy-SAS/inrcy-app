import { NextResponse } from "next/server";
import { requirePremiumAdsUser } from "@/lib/adsServer";
import { MetaAdsPreparationError, searchMetaAdsGeographies } from "@/lib/adsMetaResourcesServer";
import { enforceRateLimit } from "@/lib/rateLimit";
export async function GET(request: Request) {
  const { user, errorResponse } = await requirePremiumAdsUser("meta");
  if (!user || errorResponse) return errorResponse;
  const limited = await enforceRateLimit({ name: "ads_meta_geography", identifier: user.activeUserId, limit: 30, fallbackLimit: 15, window: "5 m", code: "meta_geography_rate_limit" });
  if (limited) { limited.headers.set("Cache-Control", "no-store"); return limited; }
  try { return NextResponse.json(await searchMetaAdsGeographies(user.activeUserId, new URL(request.url).searchParams.getAll("query")), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof MetaAdsPreparationError ? error.message : "Les zones Meta Ads n’ont pas pu être vérifiées." }, { status: error instanceof MetaAdsPreparationError ? error.status : 503, headers: { "Cache-Control": "no-store" } }); }
}
