import { NextResponse } from "next/server";
import { adsConnectionStatus, googleAdsJson, listAdsAccounts, readAdsIntegration, requirePremiumAdsUser } from "@/lib/adsServer";
import { adsAccountCanBeAssociated } from "@/lib/adsValidation";
import { readGoogleAdsAccountResources } from "@/lib/adsGoogleResources";
import { GoogleAdsApiError } from "@/lib/adsGoogleApiError";
import { enforceRateLimit } from "@/lib/rateLimit";
const headers = { "Cache-Control": "no-store" };

export async function GET() {
  const { user, errorResponse } = await requirePremiumAdsUser("google");
  if (errorResponse || !user) return errorResponse;
  const limited = await enforceRateLimit({ name: "ads_google_resources", identifier: user.activeUserId, limit: 30, fallbackLimit: 15, window: "5 m", code: "google_ads_resources_rate_limit" });
  if (limited) { limited.headers.set("Cache-Control", "no-store"); return limited; }
  try {
    const initial = await readAdsIntegration(user.activeUserId, "google");
    if (!initial || adsConnectionStatus(initial) !== "connected" || !initial.resource_id) return NextResponse.json({ error: "Connectez et associez votre compte Google Ads avant de vérifier les conversions.", code: "account_not_selected" }, { status: 409, headers });
    const accounts = await listAdsAccounts(user.activeUserId, "google");
    const current = await readAdsIntegration(user.activeUserId, "google");
    if (!current || current.id !== initial.id || current.provider_account_id !== initial.provider_account_id || current.resource_id !== initial.resource_id || adsConnectionStatus(current) !== "connected") return NextResponse.json({ error: "Le compte Google Ads a changé. Relancez la vérification.", code: "account_changed" }, { status: 409, headers });
    const selected = accounts.find((account) => account.id === current.resource_id && account.provider === "google" && adsAccountCanBeAssociated(account));
    if (!selected) return NextResponse.json({ error: "Le compte Google Ads associé n’est plus accessible.", code: "account_not_accessible" }, { status: 403, headers });
    const resources = await readGoogleAdsAccountResources((query, pageToken) => googleAdsJson(user.activeUserId, `customers/${selected.id}/googleAds:search`, { query, ...(pageToken ? { pageToken } : {}) }, selected.loginCustomerId), selected.id);
    return NextResponse.json(resources, { headers });
  } catch (error) {
    const status = error instanceof GoogleAdsApiError ? error.status : 503;
    return NextResponse.json({ error: status === 401 || status === 403 ? "Google Ads n’autorise pas la lecture des conversions de ce compte. Vérifiez la connexion." : "Les objectifs de conversion Google Ads n’ont pas pu être vérifiés. Choisissez Maximiser les clics ou réessayez.", code: "google_resources_unavailable" }, { status: status === 401 || status === 403 ? 403 : status === 429 ? 429 : 503, headers });
  }
}
