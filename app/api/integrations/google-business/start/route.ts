import { NextResponse } from "next/server";
import { makeOAuthState, safeInternalPath } from "@/lib/security";
import { getCurrentInrcyAccountScope } from "@/lib/multicompte/server";

export async function GET(request: Request) {
  const currentAccount = await getCurrentInrcyAccountScope();
  if (!currentAccount) {
    return NextResponse.json({ error: "Votre session a expiré. Merci de vous reconnecter." }, { status: 401 });
  }
  const accountId = currentAccount.scope.activeUserId;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectFromEnv = process.env.GOOGLE_GMB_REDIRECT_URI;

  // Canonical base URL to avoid redirect_uri mismatches between localhost / preview / prod.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
  const redirectUri = redirectFromEnv || `${siteUrl}/api/integrations/google-business/callback`;

  if (!clientId) {
    return NextResponse.json({ error: "Configuration Google incomplète côté serveur." }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const returnTo = safeInternalPath(searchParams.get("returnTo") || "/dashboard?panel=gmb", "/dashboard?panel=gmb");
  const { stateB64, cookieValue, cookieName } = makeOAuthState("google_business", returnTo, { accountId });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    // Google Business ne doit jamais hériter des anciens droits Gmail,
    // Analytics ou YouTube déjà accordés au même client OAuth.
    state: stateB64,
    scope: [
      "https://www.googleapis.com/auth/business.manage",
      "https://www.googleapis.com/auth/userinfo.email",
    ].join(" "),
  });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  const res = NextResponse.redirect(url);
  res.cookies.set(cookieName, cookieValue, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });
  return res;
}
