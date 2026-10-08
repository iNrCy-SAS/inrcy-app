import { NextResponse } from "next/server";
import { requirePremiumAdsUser } from "@/lib/adsServer";
import { enforceRateLimit } from "@/lib/rateLimit";
import { isLinkedInAdsAccountId } from "@/lib/adsLinkedInPolicy";
import { LinkedInAdsConnectionError } from "@/lib/adsLinkedInServer";
import { isLinkedInAdsProfessionalFacet } from "@/lib/adsLinkedInResourcesPolicy";
import { listLinkedInAdsProfessionalTargets } from "@/lib/adsLinkedInResourcesServer";

export async function GET(request: Request) {
  const { user, errorResponse } = await requirePremiumAdsUser("linkedin");
  if (errorResponse || !user) return errorResponse;
  const limited = await enforceRateLimit({
    name: "ads_linkedin_targeting", identifier: user.activeUserId, limit: 60, fallbackLimit: 20,
    window: "5 m", code: "linkedin_ads_targeting_rate_limit",
  });
  if (limited) return limited;
  const params = new URL(request.url).searchParams;
  const accountId = params.get("account") || undefined;
  const facet = params.get("facet") || undefined;
  const query = (params.get("query") || "").trim();
  const language = params.get("language") || "fr";
  const country = params.get("country") || "FR";
  const start = params.has("start") ? Number(params.get("start")) : 0;
  const count = params.has("count") ? Number(params.get("count")) : 100;
  if ((accountId !== undefined && !isLinkedInAdsAccountId(accountId)) || (facet !== undefined && !isLinkedInAdsProfessionalFacet(facet))
    || query.length > 80 || (query.length > 0 && query.length < 2)
    || ((facet === "titles" || facet === "skills") && query.length < 2)
    || (!facet && query) || !/^[a-z]{2}$/.test(language) || !/^[A-Z]{2}$/.test(country)
    || !Number.isSafeInteger(start) || start < 0 || start > 5_000 || !Number.isSafeInteger(count) || count < 1 || count > 100) {
    return NextResponse.json({ error: "Paramètres de ciblage LinkedIn invalides.", code: "invalid_targeting_query" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  try {
    return NextResponse.json(await listLinkedInAdsProfessionalTargets(user.activeUserId, {
      accountId, ...(isLinkedInAdsProfessionalFacet(facet) ? { facet } : {}), query, language, country, start, count,
    }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const known = error instanceof LinkedInAdsConnectionError ? error : null;
    return NextResponse.json({ error: known?.message || "Critères LinkedIn Ads indisponibles.", code: known?.code || "targeting_lookup_failed" }, { status: known?.status || 503, headers: { "Cache-Control": "no-store" } });
  }
}
