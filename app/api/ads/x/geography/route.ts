import { NextResponse } from "next/server";
import { requirePremiumAdsUser } from "@/lib/adsServer";
import { XAdsConnectionError } from "@/lib/adsXServer";
import { readXAdsGeography } from "@/lib/adsXResourcesServer";
import { xAdsResourceId, normalizeXAdsGeoQueries } from "@/lib/adsXResources";
import { enforceRateLimit } from "@/lib/rateLimit";
export async function GET(request: Request) {
  const { user, errorResponse } = await requirePremiumAdsUser("x"); if (!user || errorResponse) return errorResponse;
  const limited = await enforceRateLimit({ name: "ads_x_geography", identifier: user.activeUserId, limit: 30, fallbackLimit: 15, window: "5 m", code: "x_geography_rate_limit" });
  if (limited) { limited.headers.set("Cache-Control", "no-store"); return limited; }
  const params = new URL(request.url).searchParams, accountId = params.get("accountId") || undefined, raw = params.get("queries") || "[]";
  let queries: string[] | null = null; if (raw.length <= 4096) { try { queries = normalizeXAdsGeoQueries(JSON.parse(raw)); } catch { /* Reject malformed JSON before provider reads. */ } }
  if (accountId && !xAdsResourceId(accountId) || !queries) return NextResponse.json({ error: "Compte ou zones X Ads invalides." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  try { return NextResponse.json(await readXAdsGeography(user.activeUserId, { accountId, queries }), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { const failure = error instanceof XAdsConnectionError ? error : null;
    return NextResponse.json({ error: failure?.message || "Les zones X Ads sont momentanément indisponibles.", code: failure?.code || "provider_unavailable" }, { status: failure?.status || 503, headers: { "Cache-Control": "no-store" } }); }
}
