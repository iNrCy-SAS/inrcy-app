import { NextResponse } from "next/server";

import { requirePremiumAdsUser } from "@/lib/adsServer";
import { tikTokAdsOAuthConfiguration } from "@/lib/adsTikTokServer";
import { tikTokAdsAuthorizeUrl } from "@/lib/adsTikTokPolicy";
import { makeOAuthState } from "@/lib/security";

export async function GET(request: Request) {
  const { user, errorResponse } = await requirePremiumAdsUser("tiktok");
  if (errorResponse || !user) return errorResponse;

  const configuration = tikTokAdsOAuthConfiguration(request.url);
  if (!configuration) {
    return NextResponse.json({ error: "Configurez l’application TikTok API for Business et son URL d’autorisation dédiée à iNr’ADS." }, { status: 503 });
  }
  const { stateB64, cookieValue, cookieName } = makeOAuthState(
    "ads_tiktok", "/dashboard/ads?channel=tiktok",
    { accountId: user.activeUserId, authUserId: user.authUserId,
      appId: configuration.appId, redirectUri: configuration.redirectUri },
  );
  const destination = tikTokAdsAuthorizeUrl(configuration.authorizationUrl, stateB64, configuration);
  if (!destination) {
    return NextResponse.json({ error: "URL d’autorisation TikTok Ads invalide." }, { status: 503 });
  }
  const response = NextResponse.redirect(destination);
  response.cookies.set(cookieName, cookieValue, {
    httpOnly: true, secure: new URL(request.url).protocol === "https:", sameSite: "lax", path: "/", maxAge: 600,
  });
  return response;
}
