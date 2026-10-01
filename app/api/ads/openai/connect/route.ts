import { NextResponse } from "next/server";

import { adsBadOriginResponse, adsRequestOriginAllowed, requirePremiumAdsUser } from "@/lib/adsServer";
import { assessOpenaiAdsAccount, OpenaiAdsPublishError, verifyOpenaiAdsAccount } from "@/lib/adsOpenaiConnector";
import { saveOpenaiAdsIntegration } from "@/lib/adsOpenaiServer";
import { isAdsChannelPublishEnabled } from "@/lib/adsPublishMode";
import { enforceRateLimit } from "@/lib/rateLimit";

export async function POST(request: Request) {
  if (!adsRequestOriginAllowed(request)) return adsBadOriginResponse();
  const { user, errorResponse } = await requirePremiumAdsUser("openai");
  if (errorResponse || !user) return errorResponse;
  const limited = await enforceRateLimit({ name: "ads_openai_connect", identifier: user.authUserId, limit: 10, window: "1 h" });
  if (limited) return limited;
  const body = await request.json().catch(() => null) as { adsApiKey?: unknown } | null;
  const adsApiKey = typeof body?.adsApiKey === "string" ? body.adsApiKey.trim() : "";
  if (!adsApiKey || adsApiKey.length > 2048 || /[\r\n]/.test(adsApiKey)) {
    return NextResponse.json({ error: "Saisissez la clé du compte annonceur ChatGPT Ads.", code: "invalid_ads_key" },
      { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  try {
    // This check rejects model-API keys and proves which advertiser account owns the key.
    const account = await verifyOpenaiAdsAccount({ apiKey: adsApiKey });
    await saveOpenaiAdsIntegration(user.activeUserId, adsApiKey, account);
    const assessment = assessOpenaiAdsAccount(account);
    const pausedCreationEnabled = assessment.ready
      && isAdsChannelPublishEnabled("openai", "paused", process.env);
    const liveDeliveryEnabled = assessment.ready
      && isAdsChannelPublishEnabled("openai", "live", process.env);
    return NextResponse.json({
      connected: true,
      accountId: account.id,
      accountName: account.name,
      currency: account.currencyCode,
      brandReviewStatus: account.brandReviewStatus,
      accountReviewStatus: account.accountReviewStatus,
      readiness: assessment.code || (liveDeliveryEnabled ? "ready_for_live_creation" : "ready_for_paused_creation"),
      readinessMessage: assessment.message || "",
      publicationEnabled: pausedCreationEnabled || liveDeliveryEnabled,
      pausedCreationEnabled,
      liveDeliveryEnabled,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof OpenaiAdsPublishError) {
      const status = error.httpStatus === 401 ? 400 : error.httpStatus === 403 ? 403 : error.httpStatus === 429 ? 429 : 503;
      return NextResponse.json({ error: error.message, code: error.code },
        { status, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: "La connexion ChatGPT Ads n’a pas pu être enregistrée.", code: "connection_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
