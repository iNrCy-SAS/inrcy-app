import { NextResponse } from "next/server";
import { adsConnectionStatus, googleAdsJson, listAdsAccounts, readAdsIntegration, requirePremiumAdsUser } from "@/lib/adsServer";
import { adsAccountCanBeAssociated } from "@/lib/adsValidation";
import { GoogleAdsApiError } from "@/lib/adsGoogleApiError";
import { googleLocationSuggestions } from "@/lib/adsGoogleLocations";
import { enforceRateLimit } from "@/lib/rateLimit";

const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const { user, errorResponse } = await requirePremiumAdsUser("google");
  if (errorResponse || !user) return errorResponse;
  const limited = await enforceRateLimit({
    name: "ads_google_targeting", identifier: user.activeUserId,
    limit: 40, fallbackLimit: 20, window: "5 m", code: "google_ads_targeting_rate_limit",
  });
  if (limited) { limited.headers.set("Cache-Control", "no-store"); return limited; }
  const query = (new URL(request.url).searchParams.get("query") || "").trim();
  if (query.length < 2 || query.length > 120) {
    return NextResponse.json({ error: "Saisissez entre 2 et 120 caractères pour rechercher une zone Google.", code: "invalid_query" }, { status: 400, headers });
  }
  try {
    const integration = await readAdsIntegration(user.activeUserId, "google");
    if (!integration || adsConnectionStatus(integration) !== "connected") {
      return NextResponse.json({ error: "Connectez Google Ads avant de rechercher une zone.", code: "not_connected" }, { status: 409, headers });
    }
    if (!integration.resource_id) {
      return NextResponse.json({ error: "Associez votre compte Google Ads avant de rechercher une zone.", code: "account_not_selected" }, { status: 409, headers });
    }
    const accounts = await listAdsAccounts(user.activeUserId, "google");
    const selected = accounts.find((account) => account.id === integration.resource_id && account.provider === "google" && adsAccountCanBeAssociated(account));
    if (!selected) {
      return NextResponse.json({ error: "Le compte Google Ads associé n’est plus accessible. Vérifiez sa connexion.", code: "account_not_accessible" }, { status: 403, headers });
    }
    // Official read-only suggestion service; a POST query does not mutate targeting.
    // No country restriction is inferred: canonical labels let the professional choose.
    const payload = await googleAdsJson(user.activeUserId, "geoTargetConstants:suggest", {
      locale: "fr", locationNames: { names: [query] },
    }, selected.loginCustomerId);
    return NextResponse.json({ options: googleLocationSuggestions(payload), selectedAccountId: selected.id }, { headers });
  } catch (error) {
    const status = error instanceof GoogleAdsApiError ? error.status : 503;
    const authorization = status === 401 || status === 403;
    return NextResponse.json({
      error: authorization ? "Google Ads n’autorise pas cette recherche. Vérifiez la connexion du compte."
        : status === 429 ? "Google Ads reçoit trop de recherches. Réessayez dans quelques instants."
          : "La recherche des zones Google Ads est momentanément indisponible. Réessayez.",
      code: authorization ? "targeting_access_denied" : status === 429 ? "targeting_rate_limited" : "targeting_unavailable",
    }, { status: authorization ? 403 : status === 429 ? 429 : 503, headers });
  }
}
