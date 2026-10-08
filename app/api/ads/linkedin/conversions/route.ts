import { NextResponse } from "next/server";
import { requirePremiumAdsUser } from "@/lib/adsServer";
import { enforceRateLimit } from "@/lib/rateLimit";
import { isLinkedInAdsAccountId } from "@/lib/adsLinkedInPolicy";
import { LinkedInAdsConnectionError } from "@/lib/adsLinkedInServer";
import { listLinkedInAdsConversions } from "@/lib/adsLinkedInResourcesServer";

export async function GET(request: Request) {
  const { user, errorResponse } = await requirePremiumAdsUser("linkedin");
  if (errorResponse || !user) return errorResponse;
  const limited = await enforceRateLimit({
    name: "ads_linkedin_conversions", identifier: user.activeUserId, limit: 20, fallbackLimit: 8,
    window: "5 m", code: "linkedin_ads_conversions_rate_limit",
  });
  if (limited) return limited;
  const params = new URL(request.url).searchParams;
  const accountId = params.get("account") || undefined;
  const start = params.has("start") ? Number(params.get("start")) : 0;
  const count = params.has("count") ? Number(params.get("count")) : 100;
  if ((accountId !== undefined && !isLinkedInAdsAccountId(accountId))
    || !Number.isSafeInteger(start) || start < 0 || start > 5_000 || !Number.isSafeInteger(count) || count < 1 || count > 100) {
    return NextResponse.json({ error: "Paramètres de conversions LinkedIn invalides.", code: "invalid_conversion_query" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  try {
    return NextResponse.json(await listLinkedInAdsConversions(user.activeUserId, { accountId, start, count }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const known = error instanceof LinkedInAdsConnectionError ? error : null;
    return NextResponse.json({ error: known?.message || "Conversions LinkedIn Ads indisponibles.", code: known?.code || "conversion_lookup_failed" }, { status: known?.status || 503, headers: { "Cache-Control": "no-store" } });
  }
}
