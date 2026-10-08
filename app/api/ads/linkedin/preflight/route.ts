import { normalizeLinkedInDeliverySettings, linkedInDeliveryBidding } from "@/lib/adsLinkedInCampaignSettings";
import { NextResponse } from "next/server";
import { requirePremiumAdsUser } from "@/lib/adsServer";
import { LinkedInAdsConnectionError } from "@/lib/adsLinkedInServer";
import { normalizeLinkedInAdsGeoQueries } from "@/lib/adsLinkedInPreflightPolicy";
import {
  LinkedInAdsPreflightProviderError,
  runLinkedInAdsPreflight,
  type LinkedInAdsPreflightInput,
} from "@/lib/adsLinkedInPreflightServer";
import { log } from "@/lib/observability/logger";
import { enforceRateLimit } from "@/lib/rateLimit";

function failure(error: unknown) {
  const known = error instanceof LinkedInAdsConnectionError ? error : null;
  const providerFailure = error instanceof LinkedInAdsPreflightProviderError ? error : null;
  const status = known?.status || 503;
  const code = known?.code || "preflight_failed";
  const writeLog = status >= 500 ? log.error : log.warn;
  writeLog("linkedin_ads_preflight_failed", {
    provider: "linkedin",
    operation: providerFailure?.operation || "preflight",
    provider_status: providerFailure?.providerStatus ?? undefined,
    provider_code: providerFailure?.providerCode ?? undefined,
    provider_request_id: providerFailure?.providerRequestId ?? undefined,
    code,
    status_code: status,
  });
  return NextResponse.json(
    { error: known?.message || "Contrôle préalable LinkedIn Ads indisponible.", code },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function optionalMoney(value: string | null): number | undefined {
  if (value === null || value === "") return undefined;
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(value) || Number(value) <= 0) {
    throw new TypeError("invalid_money");
  }
  return Number(value);
}

function preflightInput(url: URL): LinkedInAdsPreflightInput {
  const params = url.searchParams;
  const geoQueries = normalizeLinkedInAdsGeoQueries(params.getAll("geo"));
  const rawDelivery = params.get("deliverySettings");
  if (rawDelivery && rawDelivery.length > 24_000) throw new TypeError("invalid_delivery_settings");
  const parsedDelivery = normalizeLinkedInDeliverySettings(rawDelivery ? JSON.parse(rawDelivery) : undefined);
  const objectiveType = params.get("objectiveType") || "WEBSITE_VISIT";
  const format = params.get("format") || "STANDARD_UPDATE";
  const endDate = params.get("endDate") || undefined;
  if (parsedDelivery.error || !linkedInDeliveryBidding(objectiveType, parsedDelivery.settings) || !["STANDARD_UPDATE", "SINGLE_VIDEO"].includes(format) || (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate))) throw new TypeError("invalid_delivery_settings");
  const language = params.get("language") || "fr";
  const country = params.get("country") || "FR";
  const campaignGroupId = params.get("campaignGroupId") || undefined;
  const organizationUrn = params.get("organizationUrn") || undefined;
  const imageUrn = params.get("imageUrn") || undefined;
  const geoUrns = [...params.getAll("geoUrn"), ...(params.get("geoUrns") || "").split(",")]
    .map((value) => value.trim()).filter(Boolean);
  if (!/^[a-z]{2}$/.test(language) || !/^[A-Z]{2}$/.test(country)
    || (campaignGroupId && !/^\d{1,25}$/.test(campaignGroupId))
    || (organizationUrn && !/^urn:li:organization:\d{1,25}$/.test(organizationUrn))
    || (imageUrn && !/^urn:li:image:[A-Za-z0-9_-]{3,200}$/.test(imageUrn))
    || geoUrns.length > 20 || geoUrns.some((urn) => !/^urn:li:geo:\d{1,25}$/.test(urn))) {
    throw new TypeError("invalid_preflight_input");
  }
  return {
    geoQueries, language, country, objectiveType, format, endDate,
    ...(parsedDelivery.settings ? { deliverySettings: parsedDelivery.settings } : {}),
    ...(campaignGroupId ? { campaignGroupId } : {}),
    ...(organizationUrn ? { organizationUrn } : {}),
    ...(imageUrn ? { imageUrn } : {}),
    geoUrns: [...new Set(geoUrns)],
    bidAmount: optionalMoney(params.get("bidAmount")),
    dailyBudget: optionalMoney(params.get("dailyBudget")),
    politicalIntentConfirmed: params.get("politicalIntentConfirmed") === "true",
    targetingNoticeAcknowledged: params.get("targetingNoticeAcknowledged") === "true",
  };
}

export async function GET(request: Request) {
  const { user, errorResponse } = await requirePremiumAdsUser("linkedin");
  if (errorResponse || !user) return errorResponse;
  const limited = await enforceRateLimit({
    name: "ads_linkedin_preflight",
    identifier: user.activeUserId,
    limit: 15,
    fallbackLimit: 6,
    window: "5 m",
    code: "linkedin_ads_preflight_rate_limit",
  });
  if (limited) return limited;
  let input: LinkedInAdsPreflightInput;
  try {
    input = preflightInput(new URL(request.url));
  } catch {
    return NextResponse.json(
      { error: "Paramètres de contrôle LinkedIn Ads invalides.", code: "invalid_preflight_input" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const result = await runLinkedInAdsPreflight(user.activeUserId, input);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
