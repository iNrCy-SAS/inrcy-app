import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { encryptToken } from "@/lib/oauthCrypto";
import { buildMetaGraphUrl } from "@/lib/metaGraphApi";
import { verifyOAuthState } from "@/lib/security";
import { resolveOAuthBoundInrcyAccountId } from "@/lib/multicompte/server";
import { isAdsPilotAdmin } from "@/lib/adsServer";
import { adsOAuthProvider, adsOAuthRedirectUri, adsReturnUrl } from "@/lib/adsOAuth";
import { META_ADS_REQUIRED_PERMISSIONS } from "@/lib/adsMetaScopes";
import { asRecord } from "@/lib/tsSafe";

type TokenPayload = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string | { message?: string };
  error_description?: string;
};

async function grantedMetaAdsPermissions(accessToken: string): Promise<string[]> {
  const response = await fetch(buildMetaGraphUrl("me/permissions?limit=100"), {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({})) as { data?: { permission?: string; status?: string }[] };
  if (!response.ok || !Array.isArray(payload.data)) {
    throw new Error("Impossible de vérifier les autorisations Meta Ads accordées.");
  }
  return payload.data
    .filter((item) => item.status === "granted" && typeof item.permission === "string")
    .map((item) => item.permission!);
}

async function postToken(url: string, body: URLSearchParams): Promise<TokenPayload> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, cache: "no-store" });
  const data = await response.json().catch(() => ({})) as TokenPayload;
  if (!response.ok || !data.access_token) throw new Error(typeof data.error === "object" ? data.error?.message : data.error_description || data.error || "Échange OAuth refusé.");
  return data;
}

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const provider = adsOAuthProvider((await context.params).provider);
  if (!provider) return NextResponse.json({ error: "Canal publicitaire inconnu." }, { status: 404 });
  const requestUrl = new URL(request.url);
  const state = verifyOAuthState<{ accountId?: string; authUserId?: string }>(request, `ads_${provider}`, requestUrl.searchParams.get("state"));
  const finish = (result: "connected" | "error", reason?: string) => {
    const response = NextResponse.redirect(adsReturnUrl(request.url, provider, result, reason));
    response.cookies.set(state.cookieName, "", { httpOnly: true, secure: requestUrl.protocol === "https:", sameSite: "lax", path: "/", maxAge: 0 });
    return response;
  };
  if (!state.ok) return finish("error", "Session de connexion expirée. Réessayez.");
  const code = requestUrl.searchParams.get("code");
  if (!code) return finish("error", requestUrl.searchParams.get("error_description") || "Connexion annulée.");

  try {
    const supabase = await createSupabaseServer();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user || auth.user.id !== state.state.authUserId) return finish("error", "Reconnectez-vous à iNrCy avant de continuer.");
    if (!(await isAdsPilotAdmin(auth.user.id))) return finish("error", "iNr’ADS est actuellement en préparation.");
    const userId = await resolveOAuthBoundInrcyAccountId(supabase, auth.user.id, state.state.accountId);

    const redirectUri = adsOAuthRedirectUri(request.url, provider);
    const clientId = provider === "meta" ? process.env.FACEBOOK_APP_ID : process.env.GOOGLE_CLIENT_ID;
    const clientSecret = provider === "meta" ? process.env.FACEBOOK_APP_SECRET : process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return finish("error", "Configuration OAuth manquante.");

    let token: TokenPayload;
    let profileId = "";
    let email = "";
    let name = "";
    if (provider === "meta") {
      const params = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code });
      const short = await fetch(`${buildMetaGraphUrl("oauth/access_token")}?${params.toString()}`, { cache: "no-store" });
      token = await short.json().catch(() => ({})) as TokenPayload;
      if (!short.ok || !token.access_token) throw new Error("Meta a refusé la connexion Ads.");
      const longParams = new URLSearchParams({ grant_type: "fb_exchange_token", client_id: clientId, client_secret: clientSecret, fb_exchange_token: token.access_token });
      const longResponse = await fetch(`${buildMetaGraphUrl("oauth/access_token")}?${longParams.toString()}`, { cache: "no-store" });
      const longToken = await longResponse.json().catch(() => ({})) as TokenPayload;
      if (longResponse.ok && longToken.access_token) token = longToken;
      const metaAccessToken = token.access_token;
      if (!metaAccessToken) throw new Error("Meta n’a pas transmis de jeton Ads valide.");
      const meResponse = await fetch(`${buildMetaGraphUrl("me")}?fields=id,name,email`, { headers: { Authorization: `Bearer ${metaAccessToken}` }, cache: "no-store" });
      const me = await meResponse.json().catch(() => ({})) as { id?: string; name?: string; email?: string };
      if (!meResponse.ok || !me.id) throw new Error("Impossible de vérifier le compte Meta connecté.");
      profileId = me.id; name = me.name || ""; email = me.email || "";
      const grantedPermissions = await grantedMetaAdsPermissions(metaAccessToken);
      const missingPermissions = META_ADS_REQUIRED_PERMISSIONS.filter((permission) => !grantedPermissions.includes(permission));
      if (missingPermissions.length > 0) {
        throw new Error(`Autorisations Meta Ads non accordées : ${missingPermissions.join(", ")}.`);
      }
      token.scope = grantedPermissions.join(",");
    } else {
      token = await postToken("https://oauth2.googleapis.com/token", new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code",
      }));
      if (!String(token.scope || "").split(/\s+/).includes("https://www.googleapis.com/auth/adwords")) {
        return finish("error", "L’autorisation Google Ads n’a pas été accordée.");
      }
      const meResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${token.access_token}` }, cache: "no-store" });
      const me = await meResponse.json().catch(() => ({})) as { id?: string; name?: string; email?: string };
      if (!meResponse.ok) throw new Error("Impossible de lire le compte Google connecté.");
      profileId = me.id || ""; name = me.name || ""; email = me.email || "";
    }

    if (!token.access_token) throw new Error("Aucun jeton d’accès n’a été fourni.");
    const source = provider === "meta" ? "meta_ads" : "google_ads";
    const { data: existing, error: existingError } = await supabaseAdmin.from("integrations")
      .select("id,provider_account_id,refresh_token_enc,resource_id,resource_label,meta")
      .eq("user_id", userId).eq("source", source).eq("product", "ads").maybeSingle();
    if (existingError) throw new Error("Impossible de sauvegarder la connexion Ads.");
    const reusableGoogleRefreshToken = provider === "google" && profileId && existing?.provider_account_id === profileId
      ? existing.refresh_token_enc
      : null;
    if (provider === "google" && !token.refresh_token && !reusableGoogleRefreshToken) {
      throw new Error("Google n’a pas fourni de jeton de renouvellement Ads. Réessayez la connexion et acceptez l’accès hors ligne.");
    }
    const keepsSelection = Boolean(existing?.provider_account_id && existing.provider_account_id === profileId);
    const payload = {
      user_id: userId,
      provider: provider === "meta" ? "facebook" : "google",
      category: provider === "meta" ? "social" : "stats",
      source,
      product: "ads",
      status: "connected",
      email_address: email || null,
      display_name: name || null,
      provider_account_id: profileId || null,
      scopes: String(token.scope || ""),
      access_token_enc: encryptToken(token.access_token),
      refresh_token_enc: token.refresh_token ? encryptToken(token.refresh_token) : reusableGoogleRefreshToken,
      expires_at: token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null,
      meta: { ...asRecord(keepsSelection ? existing?.meta : null), product: "inr_ads", provider },
      ...(keepsSelection ? {} : { resource_id: null, resource_label: null }),
      updated_at: new Date().toISOString(),
    };
    const saved = existing?.id
      ? await supabaseAdmin.from("integrations").update(payload).eq("id", existing.id).eq("user_id", userId).select("id").single()
      : await supabaseAdmin.from("integrations").insert(payload).select("id").single();
    if (saved.error || !saved.data?.id) throw new Error("La connexion publicitaire n’a pas été enregistrée.");
    return finish("connected");
  } catch (error) {
    return finish("error", error instanceof Error ? error.message : "Connexion publicitaire impossible.");
  }
}
