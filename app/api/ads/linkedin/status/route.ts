import { NextResponse } from "next/server";
import { requirePremiumAdsUser } from "@/lib/adsServer";
import { linkedInAdsAccessTokenIsFresh, linkedInAdsHasReadAccess, linkedInAdsScopes } from "@/lib/adsLinkedInPolicy";
import { getLinkedInAdsCredentials, LinkedInAdsConnectionError, readLinkedInAdsIntegration } from "@/lib/adsLinkedInServer";

export async function GET() {
  const { user, errorResponse } = await requirePremiumAdsUser();
  if (errorResponse || !user) return errorResponse;
  try {
    const integration = await readLinkedInAdsIntegration(user.activeUserId);
    const scopes = linkedInAdsScopes(integration?.scopes);
    const meta = integration?.meta && typeof integration.meta === "object" && !Array.isArray(integration.meta)
      ? integration.meta as Record<string, unknown> : {};
    const refreshExpiry = meta.refresh_expires_at;
    const accessFresh = Boolean(integration?.access_token_enc && linkedInAdsAccessTokenIsFresh(integration.expires_at));
    const refreshAvailable = Boolean(integration?.refresh_token_enc)
      && typeof refreshExpiry === "string" && Date.parse(refreshExpiry) > Date.now();
    const configured = getLinkedInAdsCredentials().configured;
    const connected = configured && integration?.status === "connected"
      && linkedInAdsHasReadAccess(integration.scopes) && (accessFresh || refreshAvailable);
    const status = !configured ? "not_configured"
      : !integration ? "disconnected" : connected ? "connected" : "needs_reconnect";
    return NextResponse.json({
      connected, status,
      readiness: !connected ? "connection_required"
        : !integration?.resource_id ? "account_selection_required"
          : meta.selected_account_can_manage === true ? "manage_access_last_verified" : "read_only",
      scopes,
      missingScopes: connected && !scopes.includes("rw_ads") ? ["rw_ads"] : [],
      accounts: [],
      selectedAccountId: integration?.resource_id || null,
      selectedAccountName: integration?.resource_label || null,
      selectedAccountCanManage: connected && meta.selected_account_can_manage === true,
      accountVerificationRequired: true,
      refreshAvailable,
      publicationEnabled: false,
    });
  } catch (error) {
    const status = error instanceof LinkedInAdsConnectionError ? error.status : 503;
    return NextResponse.json({ error: "État LinkedIn Ads indisponible.", code: "status_unavailable" }, { status });
  }
}
