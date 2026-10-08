import { NextResponse } from "next/server";
import { requirePremiumAdsUser } from "@/lib/adsServer";
import { XAdsConnectionError } from "@/lib/adsXServer";
import { readXAdsResources } from "@/lib/adsXResourcesServer";
import { xAdsResourceId, xAdsPostId } from "@/lib/adsXResources";
import { enforceRateLimit } from "@/lib/rateLimit";
export async function GET(request: Request) {
  const { user, errorResponse } = await requirePremiumAdsUser("x"); if (!user || errorResponse) return errorResponse;
  const limited = await enforceRateLimit({ name: "ads_x_resources", identifier: user.activeUserId, limit: 30, fallbackLimit: 15, window: "5 m", code: "x_resources_rate_limit" });
  if (limited) { limited.headers.set("Cache-Control", "no-store"); return limited; }
  const params = new URL(request.url).searchParams, accountId = params.get("accountId") || undefined, postId = params.get("postId") || undefined;
  if (accountId && !xAdsResourceId(accountId) || postId && !xAdsPostId(postId)) return NextResponse.json({ error: "Compte ou post X Ads invalide." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  try { return NextResponse.json(await readXAdsResources(user.activeUserId, { accountId, postId }), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { const failure = error instanceof XAdsConnectionError ? error : null;
    return NextResponse.json({ error: failure?.message || "Les ressources X Ads sont momentanément indisponibles.", code: failure?.code || "provider_unavailable" }, { status: failure?.status || 503, headers: { "Cache-Control": "no-store" } }); }
}
