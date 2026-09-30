import { NextResponse } from "next/server";

import { requirePremiumAdsUser } from "@/lib/adsServer";
import { readTikTokAdsIntegration } from "@/lib/adsTikTokServer";
import { tikTokAdsAccessTokenIsFresh, tikTokAdsAuthorizeUrl, tikTokAdsRefreshTokenIsUsable } from "@/lib/adsTikTokPolicy";

export async function GET() {
  const { user, errorResponse } = await requirePremiumAdsUser("tiktok");
  if (errorResponse || !user) return errorResponse;
  try {
    // Read the durable association, without calling TikTok on every screen open.
    const row = await readTikTokAdsIntegration(user.activeUserId);
    const configured = Boolean(process.env.TIKTOK_ADS_APP_ID && process.env.TIKTOK_ADS_SECRET
      && tikTokAdsAuthorizeUrl(process.env.TIKTOK_ADS_AUTHORIZATION_URL || "", "state-check"));
    const meta = row?.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
      ? row.meta as Record<string, unknown> : {};
    const longLived = Boolean(row?.access_token_enc && !row.expires_at && !row.refresh_token_enc
      && meta.token_lifecycle === "long_lived");
    const connected = configured && row?.status === "connected" && (
      longLived || Boolean(row.access_token_enc && tikTokAdsAccessTokenIsFresh(row.expires_at))
      || tikTokAdsRefreshTokenIsUsable(row.refresh_token_enc, meta.refresh_expires_at)
    );
    return NextResponse.json({
      configured,
      connected,
      status: !configured ? "not_configured" : connected ? "connected" : row ? "needs_reconnect" : "disconnected",
      readiness: connected && row?.resource_id ? "account_selected" : connected ? "account_required" : "connection_required",
      selectedAccountId: row?.resource_id || null,
      selectedAccountLabel: row?.resource_label || null,
      publicationEnabled: false,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Connexion TikTok Ads indisponible." }, { status: 503 });
  }
}
