import { NextResponse } from "next/server";
import { getCurrentInrcyAccountScope } from "@/lib/multicompte/server";
import { isAppBubbleEnabledForUser, bubbleAccessDisabledResponse } from "@/lib/appBubbleAccessServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { enforceRateLimit, getClientIp } from "@/lib/rateLimit";
import { makeOAuthState, safeInternalPath } from "@/lib/security";
import {
  X_AUTHORIZE_URL,
  createXCodeChallenge,
  createXCodeVerifier,
  getXOAuthScope,
  getXPkceCookieName,
  getXRedirectUri,
  sealXCodeVerifier,
} from "@/lib/xOAuth";

export async function GET(request: Request) {
  const currentAccount = await getCurrentInrcyAccountScope();
  if (!currentAccount) {
    return NextResponse.json(
      { error: "Votre session a expiré. Merci de vous reconnecter." },
      { status: 401 },
    );
  }

  const clientId = String(process.env.X_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.X_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Configuration X incomplète côté serveur." },
      { status: 503 },
    );
  }

  const accountId = currentAccount.scope.activeUserId;
  const accessEnabled = await isAppBubbleEnabledForUser(supabaseAdmin, accountId, "x");
  if (!accessEnabled) return bubbleAccessDisabledResponse("X");
  const userLimit = await enforceRateLimit({
    name: "oauth_x_start",
    identifier: accountId,
    limit: 10,
    window: "10 m",
  });
  if (userLimit) return userLimit;
  const ipLimit = await enforceRateLimit({
    name: "oauth_x_start_ip",
    identifier: getClientIp(request),
    limit: 20,
    window: "10 m",
  });
  if (ipLimit) return ipLimit;

  const { searchParams } = new URL(request.url);
  const returnTo = safeInternalPath(
    searchParams.get("returnTo") || "/dashboard?panel=x",
    "/dashboard?panel=x",
  );
  const { stateB64, cookieValue, cookieName } = makeOAuthState("x", returnTo, {
    accountId,
  });
  const verifier = createXCodeVerifier();
  const redirectUri = getXRedirectUri(request.url);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: getXOAuthScope(),
    state: stateB64,
    code_challenge: createXCodeChallenge(verifier),
    code_challenge_method: "S256",
  });

  const response = NextResponse.redirect(`${X_AUTHORIZE_URL}?${params.toString()}`);
  const secure = new URL(request.url).protocol === "https:" || process.env.NODE_ENV === "production";
  const cookieOptions = {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 10,
  };
  response.cookies.set(cookieName, cookieValue, cookieOptions);
  response.cookies.set(getXPkceCookieName(stateB64), sealXCodeVerifier(verifier, stateB64), cookieOptions);
  return response;
}
