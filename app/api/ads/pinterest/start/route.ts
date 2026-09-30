import { NextResponse } from "next/server";
import { requirePremiumAdsUser } from "@/lib/adsServer";
import { makeOAuthState } from "@/lib/security";
import { buildPinterestAdsAuthorizeUrl } from "@/lib/adsPinterestPolicy";
import { getPinterestAdsCredentials, getPinterestAdsRedirectUri } from "@/lib/adsPinterestServer";

export async function GET(request: Request) {
  const { user, errorResponse } = await requirePremiumAdsUser("pinterest");
  if (errorResponse || !user) return errorResponse;
  const { clientId, configured } = getPinterestAdsCredentials();
  if (!configured) return NextResponse.json({ error: "Configuration Pinterest Ads incomplète.", code: "configuration_missing" }, { status: 503 });

  let redirectUri: string;
  try {
    redirectUri = getPinterestAdsRedirectUri(request.url);
  } catch {
    return NextResponse.json({ error: "URL de retour Pinterest Ads invalide.", code: "redirect_uri_invalid" }, { status: 503 });
  }

  const { stateB64, cookieValue, cookieName } = makeOAuthState(
    "ads_pinterest",
    "/dashboard/ads?channel=pinterest",
    { accountId: user.activeUserId, authUserId: user.authUserId },
  );
  const response = NextResponse.redirect(buildPinterestAdsAuthorizeUrl(clientId, redirectUri, stateB64));
  response.cookies.set(cookieName, cookieValue, {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return response;
}
