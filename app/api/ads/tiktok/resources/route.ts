import { NextResponse } from "next/server";
import { requirePremiumAdsUser } from "@/lib/adsServer";
import { TikTokAdsConnectionError } from "@/lib/adsTikTokServer";
import { readTikTokAdsResources } from "@/lib/adsTikTokResourcesServer";
import { enforceRateLimit } from "@/lib/rateLimit";

export async function GET(request: Request) {
  const { user, errorResponse } = await requirePremiumAdsUser("tiktok");
  if (!user || errorResponse) return errorResponse;
  const limited = await enforceRateLimit({ name: "ads_tiktok_resources", identifier: user.activeUserId, limit: 30, fallbackLimit: 15, window: "5 m", code: "tiktok_resources_rate_limit" });
  if (limited) { limited.headers.set("Cache-Control", "no-store"); return limited; }
  const expectedAccountId = new URL(request.url).searchParams.get("accountId") || undefined;
  if (expectedAccountId && !/^\d{5,30}$/.test(expectedAccountId)) return NextResponse.json({ error: "Compte TikTok Ads invalide.", code: "invalid_account" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  try { return NextResponse.json(await readTikTokAdsResources(user.activeUserId, expectedAccountId), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) {
    const failure = error instanceof TikTokAdsConnectionError ? error : null;
    return NextResponse.json({ error: failure?.message || "Les ressources TikTok Ads n’ont pas pu être vérifiées.", code: failure?.code || "provider_unavailable" }, { status: failure?.status || 503, headers: { "Cache-Control": "no-store" } });
  }
}
