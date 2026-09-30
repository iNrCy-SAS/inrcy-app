import { NextResponse } from "next/server";

import { requirePremiumAdsUser } from "@/lib/adsServer";
import { assessOpenaiAdsAccount, OpenaiAdsPublishError, verifyOpenaiAdsAccount } from "@/lib/adsOpenaiConnector";
import { openaiAdsStoredAccount, readOpenaiAdsIntegration } from "@/lib/adsOpenaiServer";
import { decryptToken } from "@/lib/oauthCrypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET() {
  const { user, errorResponse } = await requirePremiumAdsUser("openai");
  if (errorResponse || !user) return errorResponse;
  try {
    const integration = await readOpenaiAdsIntegration(user.activeUserId);
    let adsKey = "";
    if (integration?.access_token_enc) {
      try { adsKey = decryptToken(integration.access_token_enc); } catch { /* fail closed */ }
    }
    let connected = integration?.status === "connected" && Boolean(adsKey) && Boolean(integration.resource_id);
    let account = connected ? openaiAdsStoredAccount(integration) : null;
    let refreshError = "";
    if (integration && connected && account) {
      try {
        const verified = await verifyOpenaiAdsAccount({ apiKey: adsKey, expectedAccountId: account.id });
        if (JSON.stringify(verified) !== JSON.stringify(account)) {
          const { error } = await supabaseAdmin.from("integrations").update({
            resource_label: verified.name || verified.id,
            meta: {
              currency_code: verified.currencyCode,
              timezone: verified.timezone,
              ad_account_status: verified.status,
              brand_review_status: verified.brandReviewStatus,
              account_review_status: verified.accountReviewStatus,
              verified_at: new Date().toISOString(),
            },
          }).eq("id", integration.id).eq("user_id", user.activeUserId);
          if (error) refreshError = "Le statut du compte n’a pas pu être actualisé. Réessayez avant de créer la campagne.";
        }
        account = verified;
      } catch (cause) {
        // A saved association remains visible, but it must never authorize
        // a provider mutation when the key/account cannot be verified now.
        const invalidKeyOrAccount = cause instanceof OpenaiAdsPublishError && (
          cause.httpStatus === 401 || cause.httpStatus === 403 || cause.code === "ACCOUNT_MISMATCH");
        if (invalidKeyOrAccount) {
          connected = false;
          account = null;
        }
        refreshError = invalidKeyOrAccount
          ? "La clé ChatGPT Ads ou le compte associé doit être actualisé."
          : "Le compte ChatGPT Ads n’a pas pu être vérifié. Réessayez avant de créer la campagne.";
      }
    }
    const assessment = account ? assessOpenaiAdsAccount(account) : null;
    const pausedCreationEnabled = Boolean(connected && !refreshError && assessment?.ready
      && process.env.INRCY_OPENAI_ADS_PAUSED_PUBLISH_ENABLED === "true");
    return NextResponse.json({
      configured: true,
      connected,
      status: connected ? "connected" : integration ? "needs_update" : "disconnected",
      accountId: account?.id || "",
      accountName: account?.name || "",
      selectedAccountId: account?.id || "",
      selectedAccountName: account?.name || "",
      currency: account?.currencyCode || "",
      brandReviewStatus: account?.brandReviewStatus || "",
      accountReviewStatus: account?.accountReviewStatus || null,
      readiness: refreshError ? "verification_unavailable" : assessment?.code || (connected ? "ready_for_paused_creation" : "not_connected"),
      readinessMessage: refreshError || assessment?.message || "",
      proposalEnabled: true,
      publicationEnabled: pausedCreationEnabled,
      pausedCreationEnabled,
      liveDeliveryEnabled: false,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Statut ChatGPT Ads indisponible.", code: "storage_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
