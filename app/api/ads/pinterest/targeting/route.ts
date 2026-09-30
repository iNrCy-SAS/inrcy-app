import { NextResponse } from "next/server";
import { requirePremiumAdsUser } from "@/lib/adsServer";
import { searchPinterestGeographyOptions } from "@/lib/adsPinterestLocations";
import { listPinterestAdsAccounts, PinterestAdsConnectionError, readPinterestAdsIntegration } from "@/lib/adsPinterestServer";
import { listPinterestAdsGeographyOptions } from "@/lib/adsPinterestTargetingServer";
import { enforceRateLimit } from "@/lib/rateLimit";

const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const { user, errorResponse } = await requirePremiumAdsUser("pinterest");
  if (errorResponse || !user) return errorResponse;
  const limited = await enforceRateLimit({
    name: "ads_pinterest_targeting", identifier: user.activeUserId,
    limit: 60, fallbackLimit: 30, window: "5 m", code: "pinterest_ads_targeting_rate_limit",
  });
  if (limited) { limited.headers.set("Cache-Control", "no-store"); return limited; }
  const query = (new URL(request.url).searchParams.get("query") || "").trim();
  if (query.length > 120) return NextResponse.json({ error: "La recherche de zone est trop longue.", code: "invalid_query" }, { status: 400, headers });
  try {
    const integration = await readPinterestAdsIntegration(user.activeUserId);
    if (!integration || integration.status !== "connected") {
      throw new PinterestAdsConnectionError("Connectez Pinterest Ads avant de rechercher une zone.", "not_connected", 409);
    }
    // Account IDs come exclusively from the stored choice and fresh provider permissions.
    const accounts = await listPinterestAdsAccounts(user.activeUserId, integration);
    const selected = accounts.find((account) => account.id === integration.resource_id);
    if (!selected) throw new PinterestAdsConnectionError("Choisissez un compte Pinterest Ads accessible avant de rechercher une zone.", "account_not_selected", 409);
    if (selected.canManageCampaigns !== true) throw new PinterestAdsConnectionError("Ce compte Pinterest Ads ne permet pas de gérer des campagnes.", "insufficient_account_permissions", 403);
    if (selected.currency !== "EUR") throw new PinterestAdsConnectionError("Choisissez un compte Pinterest Ads facturé en EUR.", "unsupported_account_currency", 422);
    const options = await listPinterestAdsGeographyOptions(user.activeUserId, selected.id, integration);
    // This is only a search filter, never a default campaign target.
    const country = selected.country || "FR";
    return NextResponse.json({
      options: searchPinterestGeographyOptions(options, country, query),
      selectedAccountId: selected.id, country,
    }, { headers });
  } catch (error) {
    const known = error instanceof PinterestAdsConnectionError ? error : null;
    return NextResponse.json({
      error: known?.message || "La recherche des zones Pinterest est momentanément indisponible.",
      code: known?.code || "targeting_unavailable",
    }, { status: known?.status || 503, headers });
  }
}
