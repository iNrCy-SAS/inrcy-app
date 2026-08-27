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
  const redirectFromEnv = process.env.GOOGLE_REDIRECT_URI;

  // ✅ Robust redirect_uri (works on local, preview, prod) even if env is missing.
  const origin = new URL(request.url).origin;
  const redirectUri = redirectFromEnv || `${origin}/api/integrations/google/callback`;

  if (!clientId) {
    // Avoid redirecting to Google with client_id=undefined (hard to debug)
    return NextResponse.json(
      {
        error: "Configuration Google incomplète côté serveur.",
        hint:
          "Set GOOGLE_CLIENT_ID (and GOOGLE_CLIENT_SECRET) in your deployment environment. " +
          "Also add the redirect URI in Google Cloud Console: " +
          redirectUri,
      },
      { status: 500 }
    );
  }

  // ✅ CSRF-safe OAuth state + safe post-auth redirect
  const { searchParams } = new URL(request.url);
  const returnTo = safeInternalPath(searchParams.get("returnTo") || "/dashboard?panel=mails", "/dashboard?panel=mails");
  const loginHint = String(searchParams.get("loginHint") || "").trim().toLowerCase();
  const { stateB64, cookieValue, cookieName } = makeOAuthState("google", returnTo, { accountId });

  // iNrCy only sends mail through Gmail. No mailbox-reading permission is
  // requested because the product does not need to read Gmail messages.
  const gmailScopes = [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/userinfo.email",
  ];

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: gmailScopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    // Ne jamais fusionner les anciens droits Google du compte : ce jeton doit
    // rester strictement limité à Gmail Send + identité.
    state: stateB64,
  });
  if (loginHint.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginHint)) {
    params.set("login_hint", loginHint);
  }

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  const res = NextResponse.redirect(url);
  res.cookies.set(cookieName, cookieValue, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10, // 10 minutes
  });
  return res;
}
