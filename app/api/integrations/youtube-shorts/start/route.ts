import { NextResponse } from "next/server";
import { getCurrentInrcyAccountScope } from "@/lib/multicompte/server";

import { getYoutubeShortsOAuthClientId, getYoutubeShortsOAuthScope, getYoutubeShortsRedirectUri } from "@/lib/youtubeShortsOAuth";
import { makeOAuthState, safeInternalPath } from "@/lib/security";

export async function GET(request: Request) {
  const currentAccount = await getCurrentInrcyAccountScope();
  if (!currentAccount) {
    return NextResponse.json({ error: "Votre session a expiré. Merci de vous reconnecter." }, { status: 401 });
  }
  const accountId = currentAccount.scope.activeUserId;
  const clientId = getYoutubeShortsOAuthClientId();
  const redirectUri = getYoutubeShortsRedirectUri(request.url);

  if (!clientId) {
    return NextResponse.json({
      ok: false,
      error: "Configuration Google incomplète côté serveur.",
      hint: `Ajoute YOUTUBE_CLIENT_ID/YOUTUBE_CLIENT_SECRET ou GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET, puis configure cette URI de redirection dans Google Cloud : ${redirectUri}`,
    }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const returnTo = safeInternalPath(searchParams.get("returnTo") || "/dashboard?panel=youtube_shorts", "/dashboard?panel=youtube_shorts");
  const { stateB64, cookieValue, cookieName } = makeOAuthState("youtube_shorts", returnTo, { accountId });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: getYoutubeShortsOAuthScope(),
    access_type: "offline",
    prompt: "consent",
    // Le jeton YouTube reste limité aux scopes YouTube explicitement requis ;
    // les autorisations Google historiques du compte ne sont pas réinjectées.
    state: stateB64,
  });

  const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  res.cookies.set(cookieName, cookieValue, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });
  return res;
}
