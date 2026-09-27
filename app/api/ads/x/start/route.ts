import { NextResponse } from "next/server";
import { requirePremiumAdsUser } from "@/lib/adsServer";
import { encryptToken } from "@/lib/oauthCrypto";
import { makeOAuthState } from "@/lib/security";
import { getXAdsCredentials, getXAdsRedirectUri, requestXAdsToken, XAdsConnectionError } from "@/lib/adsXServer";

const X_ADS_REQUEST_COOKIE = "inrcy_oauth_x_ads_request";

export async function GET(request: Request) {
  const { user, errorResponse } = await requirePremiumAdsUser();
  if (errorResponse || !user) return errorResponse;
  if (!getXAdsCredentials().configured) {
    return NextResponse.json({ error: "Configuration X Ads OAuth 1.0a incomplète.", code: "configuration_missing" }, { status: 503 });
  }
  let callbackUri: string;
  try {
    callbackUri = getXAdsRedirectUri(request.url);
  } catch {
    return NextResponse.json({ error: "URL de retour X Ads invalide.", code: "redirect_uri_invalid" }, { status: 503 });
  }
  const { stateB64, cookieValue, cookieName } = makeOAuthState(
    "ads_x", "/dashboard/ads?channel=x",
    { accountId: user.activeUserId, authUserId: user.authUserId },
  );
  try {
    const temporary = await requestXAdsToken(callbackUri);
    const response = NextResponse.redirect(temporary.authorizeUrl);
    const cookieOptions = {
      httpOnly: true, secure: new URL(request.url).protocol === "https:",
      sameSite: "lax" as const, path: "/", maxAge: 600,
    };
    response.cookies.set(cookieName, cookieValue, cookieOptions);
    // X's callback has no OAuth 2.0 state; bind its one-time token to our state in an encrypted cookie.
    response.cookies.set(X_ADS_REQUEST_COOKIE, encryptToken(JSON.stringify({
      stateB64, token: temporary.token, tokenSecret: temporary.tokenSecret,
    })), cookieOptions);
    return response;
  } catch (error) {
    const failure = error instanceof XAdsConnectionError ? error : null;
    return NextResponse.json({
      error: failure?.message || "Impossible de démarrer la connexion X Ads.",
      code: failure?.code || "provider_unavailable",
    }, { status: failure?.status || 503 });
  }
}
