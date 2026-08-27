import { NextResponse } from "next/server";
import { makeOAuthState, safeInternalPath } from "@/lib/security";
import { getCurrentInrcyAccountScope } from "@/lib/multicompte/server";

/**
 * Démarre l'OAuth Microsoft (Outlook/Hotmail/Office365) via Microsoft Identity Platform v2.
 * On utilise /common pour supporter comptes perso + org.
 */
export async function GET(req: Request) {
  const currentAccount = await getCurrentInrcyAccountScope();
  if (!currentAccount) {
    return NextResponse.json({ error: "Votre session a expiré. Merci de vous reconnecter." }, { status: 401 });
  }
  const accountId = currentAccount.scope.activeUserId;
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: "La connexion Outlook n’est pas disponible pour le moment." },
      { status: 500 }
    );
  }

  const url = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_mode", "query");

  // Scopes délégués (Graph)
  url.searchParams.set(
    "scope",
    [
      "openid",
      "profile",
      "email",
      "offline_access",
      "Mail.Send",
      "Mail.Read",
      "User.Read",
    ].join(" ")
  );

  const { searchParams } = new URL(req.url);
  const returnTo = safeInternalPath(searchParams.get("returnTo") || "/dashboard?panel=mails", "/dashboard?panel=mails");
  const loginHint = String(searchParams.get("loginHint") || "").trim().toLowerCase();
  if (loginHint.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginHint)) {
    url.searchParams.set("login_hint", loginHint);
  }
  const { stateB64, cookieValue, cookieName } = makeOAuthState("microsoft", returnTo, { accountId });
  url.searchParams.set("state", stateB64);

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
