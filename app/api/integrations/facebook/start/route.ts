import { NextResponse } from "next/server";
import { makeOAuthState, safeInternalPath } from "@/lib/security";
import { getCurrentInrcyAccountScope } from "@/lib/multicompte/server";
import { buildMetaOAuthUrl } from "@/lib/metaGraphApi";

export async function GET(request: Request) {
  const currentAccount = await getCurrentInrcyAccountScope();
  if (!currentAccount) {
    return NextResponse.json({ error: "Votre session a expiré. Merci de vous reconnecter." }, { status: 401 });
  }
  const accountId = currentAccount.scope.activeUserId;
  const appId = process.env.FACEBOOK_APP_ID;
  const redirectFromEnv = process.env.FACEBOOK_REDIRECT_URI;
  const configId = process.env.FACEBOOK_LOGIN_FOR_BUSINESS_CONFIG_ID;

  // Canonical base URL (prevents redirect_uri mismatches between localhost / preview / prod).
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
  const redirectUri = redirectFromEnv || `${siteUrl}/api/integrations/facebook/callback`;

  if (!appId) {
    return NextResponse.json({ error: "Configuration Facebook incomplète côté serveur." }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const requestedReturnTo = safeInternalPath(searchParams.get("returnTo") || "/dashboard?panel=facebook", "/dashboard?panel=facebook");
  const mode = searchParams.get("mode") === "business" ? "business" : "standard";
  const returnUrl = new URL(requestedReturnTo, siteUrl);
  returnUrl.searchParams.set("fb_mode", mode);
  const returnTo = `${returnUrl.pathname}${returnUrl.search}`;
  const { stateB64, cookieValue, cookieName } = makeOAuthState("facebook", returnTo, { accountId });

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: "code",
    state: stateB64,
  });

  // A Business Login configuration defines its own asset and permission set.
  // For system-user tokens, Meta requires config_id to replace scope.
  if (mode === "business" && configId) {
    params.set("config_id", configId);
  } else {
    params.set(
      "scope",
      [
        "public_profile",
        "email",
        "pages_show_list",
        "pages_manage_posts",
        "pages_read_engagement",
        "read_insights",
      ].join(","),
    );
  }

  const url = `${buildMetaOAuthUrl("dialog/oauth")}?${params.toString()}`;
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
