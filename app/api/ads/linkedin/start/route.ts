import { NextResponse } from "next/server";
import { requirePremiumAdsUser } from "@/lib/adsServer";
import { makeOAuthState } from "@/lib/security";
import { buildLinkedInAdsAuthorizationUrl, type LinkedInAdsAccessMode } from "@/lib/adsLinkedInPolicy";
import { getLinkedInAdsCredentials, getLinkedInAdsRedirectUri } from "@/lib/adsLinkedInServer";

export async function GET(request: Request) {
  const { user, errorResponse } = await requirePremiumAdsUser();
  if (errorResponse || !user) return errorResponse;
  const modeParam = new URL(request.url).searchParams.get("access") || "read";
  if (modeParam !== "read" && modeParam !== "manage") {
    return NextResponse.json({ error: "Mode d’accès LinkedIn Ads inconnu.", code: "invalid_access_mode" }, { status: 400 });
  }
  const mode: LinkedInAdsAccessMode = modeParam;
  const { clientId, configured } = getLinkedInAdsCredentials();
  if (!configured) return NextResponse.json({ error: "Configuration LinkedIn Ads incomplète.", code: "configuration_missing" }, { status: 503 });
  let redirectUri: string;
  try {
    redirectUri = getLinkedInAdsRedirectUri(request.url);
    const parsed = new URL(redirectUri);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") throw new Error("Invalid redirect URI");
  } catch {
    return NextResponse.json({ error: "URL de retour LinkedIn Ads invalide.", code: "redirect_uri_invalid" }, { status: 503 });
  }
  const { stateB64, cookieValue, cookieName } = makeOAuthState(
    "ads_linkedin", "/dashboard/ads?channel=linkedin",
    { accountId: user.activeUserId, authUserId: user.authUserId, mode },
  );
  const response = NextResponse.redirect(buildLinkedInAdsAuthorizationUrl(clientId, redirectUri, stateB64, mode));
  response.cookies.set(cookieName, cookieValue, {
    httpOnly: true, secure: new URL(request.url).protocol === "https:", sameSite: "lax", path: "/", maxAge: 600,
  });
  return response;
}
