import { NextResponse } from "next/server";
import { requirePremiumAdsUser } from "@/lib/adsServer";
import { TikTokAdsConnectionError } from "@/lib/adsTikTokServer";
import { readTikTokAdsGeography } from "@/lib/adsTikTokResourcesServer";
import { normalizeTikTokAdsGeoQueries } from "@/lib/adsTikTokResources";
import { enforceRateLimit } from "@/lib/rateLimit";

export async function GET(request: Request) {
  const { user, errorResponse } = await requirePremiumAdsUser("tiktok");
  if (!user || errorResponse) return errorResponse;
  const limited = await enforceRateLimit({ name: "ads_tiktok_geography", identifier: user.activeUserId, limit: 30, fallbackLimit: 15, window: "5 m", code: "tiktok_geography_rate_limit" });
  if (limited) { limited.headers.set("Cache-Control", "no-store"); return limited; }
  const params = new URL(request.url).searchParams, accountId = params.get("accountId") || undefined, raw = params.get("queries") || "[]";
  let queries: string[] | null = null;
  if (raw.length <= 4096) { try { queries = normalizeTikTokAdsGeoQueries(JSON.parse(raw)); } catch { /* Invalid JSON is rejected before any provider read. */ } }
  if ((accountId && !/^\d{5,30}$/.test(accountId)) || !queries) return NextResponse.json({ error: "Compte ou libellés géographiques TikTok Ads invalides.", code: "invalid_geography_queries" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  try { return NextResponse.json(await readTikTokAdsGeography(user.activeUserId, { accountId, queries }), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) {
    const failure = error instanceof TikTokAdsConnectionError ? error : null;
    return NextResponse.json({ error: failure?.message || "Les zones TikTok Ads n’ont pas pu être vérifiées.", code: failure?.code || "provider_unavailable" }, { status: failure?.status || 503, headers: { "Cache-Control": "no-store" } });
  }
}
