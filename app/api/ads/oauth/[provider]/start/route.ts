import { NextResponse } from "next/server";
import { buildMetaOAuthUrl } from "@/lib/metaGraphApi";
import { makeOAuthState } from "@/lib/security";
import { adsOAuthProvider, adsOAuthRedirectUri, adsReturnUrl } from "@/lib/adsOAuth";
import { requirePremiumAdsUser } from "@/lib/adsServer";

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const provider = adsOAuthProvider((await context.params).provider);
  if (!provider) return NextResponse.json({ error: "Canal publicitaire inconnu." }, { status: 404 });
  const { user, errorResponse } = await requirePremiumAdsUser();
  if (errorResponse || !user) return errorResponse;

  const clientId = provider === "meta" ? process.env.FACEBOOK_APP_ID : process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return NextResponse.json({ error: `Configuration ${provider} incomplète côté serveur.` }, { status: 503 });

  const redirectUri = adsOAuthRedirectUri(request.url, provider);
  if (provider === "meta" && new URL(redirectUri).protocol !== "https:") {
    return NextResponse.redirect(adsReturnUrl(
      request.url,
      provider,
      "error",
      "Meta exige une URL HTTPS pour cette connexion. Ouvrez iNr’ADS sur une adresse HTTPS configurée dans Meta Developers.",
    ));
  }
  const { stateB64, cookieValue, cookieName } = makeOAuthState(`ads_${provider}`, `/dashboard/ads?channel=${provider}`, {
    accountId: user.activeUserId,
    authUserId: user.authUserId,
  });
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", state: stateB64 });
  if (provider === "meta") {
    params.set("scope", "ads_management,ads_read,pages_show_list,pages_read_engagement,instagram_basic");
  } else {
    params.set("scope", "https://www.googleapis.com/auth/adwords openid email");
    params.set("access_type", "offline");
    params.set("prompt", "consent");
  }

  const destination = provider === "meta"
    ? `${buildMetaOAuthUrl("dialog/oauth")}?${params.toString()}`
    : `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  const response = NextResponse.redirect(destination);
  response.cookies.set(cookieName, cookieValue, {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return response;
}
