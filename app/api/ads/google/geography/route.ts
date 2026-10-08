import { NextResponse } from "next/server";
import { adsConnectionStatus, listAdsAccounts, readAdsIntegration, requirePremiumAdsUser } from "@/lib/adsServer";
import { adsAccountCanBeAssociated } from "@/lib/adsValidation";
import { normalizeGoogleTargetLocationLabels } from "@/lib/adsGoogleLocations";
import { GoogleAdsLocationResolutionError, resolveGoogleTargetLocations } from "@/lib/adsGooglePublish";
import { GoogleAdsApiError } from "@/lib/adsGoogleApiError";
import { enforceRateLimit } from "@/lib/rateLimit";
const headers = { "Cache-Control": "no-store" };

/** Canonical labels are resolved from the selected advertiser, never from an AI-generated platform ID. */
export async function GET(request: Request) {
  const { user, errorResponse } = await requirePremiumAdsUser("google");
  if (errorResponse || !user) return errorResponse;
  let requested: unknown;
  try { requested = JSON.parse(new URL(request.url).searchParams.get("locations") || "null"); } catch { requested = null; }
  if (!Array.isArray(requested) || requested.length < 1 || requested.length > 20 || requested.some((label) => typeof label !== "string" || !label.trim() || label.length > 120 || /[\r\n\u0000]/.test(label))) return NextResponse.json({ error: "Fournissez 1 à 20 zones géographiques Google lisibles.", code: "google_geography_invalid" }, { status: 400, headers });
  const limited = await enforceRateLimit({ name: "ads_google_geography", identifier: user.activeUserId, limit: 30, fallbackLimit: 15, window: "5 m", code: "google_ads_geography_rate_limit" });
  if (limited) { limited.headers.set("Cache-Control", "no-store"); return limited; }
  try {
    const initial = await readAdsIntegration(user.activeUserId, "google");
    if (!initial || adsConnectionStatus(initial) !== "connected" || !initial.resource_id) return NextResponse.json({ error: "Associez votre compte Google Ads avant de vérifier les zones.", code: "account_not_selected" }, { status: 409, headers });
    const accounts = await listAdsAccounts(user.activeUserId, "google");
    const current = await readAdsIntegration(user.activeUserId, "google");
    if (!current || current.id !== initial.id || current.provider_account_id !== initial.provider_account_id || current.resource_id !== initial.resource_id || adsConnectionStatus(current) !== "connected") return NextResponse.json({ error: "Le compte Google Ads a changé. Relancez la vérification.", code: "account_changed" }, { status: 409, headers });
    const selected = accounts.find((account) => account.provider === "google" && account.id === current.resource_id && adsAccountCanBeAssociated(account));
    if (!selected) return NextResponse.json({ error: "Le compte Google Ads EUR associé n’est plus accessible.", code: "account_not_accessible" }, { status: 403, headers });
    // Country belongs to the legal profiles row, not the iNrADN business_profiles schema.
    // Missing optional context cannot block already exact/canonical requested locations.
    const { data: profile, error: profileError } = await user.supabase.from("profiles").select("hq_country").eq("user_id", user.activeUserId).maybeSingle();
    const country = !profileError && typeof profile?.hq_country === "string" ? profile.hq_country.trim() : "";
    const countryCode = /^fr(?:ance)?$/i.test(country) ? "FR" : /^[A-Z]{2}$/i.test(country) ? country.toUpperCase() : undefined;
    const locations = await resolveGoogleTargetLocations(user.activeUserId, selected.id, normalizeGoogleTargetLocationLabels(requested), selected.loginCustomerId, countryCode);
    return NextResponse.json({ selectedAccountId: selected.id, locations }, { headers });
  } catch (error) {
    const geo = error instanceof GoogleAdsLocationResolutionError;
    const provider = error instanceof GoogleAdsApiError ? error : null;
    const status = geo ? 422 : provider?.status === 401 || provider?.status === 403 ? 403 : provider?.status === 429 ? 429 : 503;
    return NextResponse.json({ error: geo ? error.message : "Google Ads n’a pas permis de vérifier précisément les zones. Réessayez après avoir vérifié la connexion.", code: geo ? error.code : "google_geography_unavailable" }, { status, headers });
  }
}
