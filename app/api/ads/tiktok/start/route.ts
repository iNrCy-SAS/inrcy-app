import { NextResponse } from "next/server";

import { requirePremiumAdsUser } from "@/lib/adsServer";
import { tikTokAdsRedirectUri, tikTokAdsReturnUrl } from "@/lib/adsTikTokServer";
import { tikTokAdsAuthorizeUrl } from "@/lib/adsTikTokPolicy";
import { makeOAuthState } from "@/lib/security";

export async function GET(request: Request) {
  const { user, errorResponse } = await requirePremiumAdsUser("tiktok");
  if (errorResponse || !user) return errorResponse;

  const configured = String(process.env.TIKTOK_ADS_AUTHORIZATION_URL || "").trim();
  if (!process.env.TIKTOK_ADS_APP_ID || !process.env.TIKTOK_ADS_SECRET || !configured) {
    return NextResponse.json({ error: "Configurez l’application TikTok API for Business dédiée à iNr’ADS." }, { status: 503 });
  }
  let redirectUri: URL;
  try {
    redirectUri = new URL(tikTokAdsRedirectUri(request.url));
  } catch {
    return NextResponse.json({ error: "URL de retour TikTok Ads invalide." }, { status: 503 });
  }
  if (redirectUri.protocol !== "https:" && redirectUri.hostname !== "localhost") {
    return NextResponse.redirect(tikTokAdsReturnUrl(request.url, "error", "Une URL HTTPS est requise pour TikTok Ads."));
  }

  const { stateB64, cookieValue, cookieName } = makeOAuthState(
    "ads_tiktok", "/dashboard/ads?channel=tiktok",
    { accountId: user.activeUserId, authUserId: user.authUserId },
  );
  const destination = tikTokAdsAuthorizeUrl(configured, stateB64);
  if (!destination) {
    return NextResponse.json({ error: "URL d’autorisation TikTok Ads invalide." }, { status: 503 });
  }
  const response = NextResponse.redirect(destination);
  response.cookies.set(cookieName, cookieValue, {
    httpOnly: true, secure: new URL(request.url).protocol === "https:", sameSite: "lax", path: "/", maxAge: 600,
  });
  return response;
}
