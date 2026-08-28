import { NextResponse } from "next/server";

import { createSupabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { encryptToken } from "@/lib/oauthCrypto";
import { enforceRateLimit, getClientIp } from "@/lib/rateLimit";
import { clearAllToolCaches } from "@/lib/statsCache";
import { safeInternalPath, verifyOAuthState } from "@/lib/security";
import { asRecord, asString } from "@/lib/tsSafe";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { withCurrentConnectionVersion } from "@/lib/connectionVersions";
import { resolveOAuthBoundInrcyAccountId } from "@/lib/multicompte/server";
import {
  findExplicitlyMissingGoogleScopes,
  GOOGLE_OAUTH_PERMISSION_ERROR_CODE,
  GOOGLE_OAUTH_PERMISSION_MESSAGE,
} from "@/lib/googleOAuthConsent";
import {
  YOUTUBE_SHORTS_DEFAULT_SCOPES,
  fetchYoutubeMineChannel,
  getYoutubeShortsOAuthClientId,
  getYoutubeShortsOAuthClientSecret,
  getYoutubeShortsOAuthScope,
  getYoutubeShortsRedirectUri,
  readYoutubeShortsSettings,
  saveYoutubeShortsSettings,
  type YoutubeShortsSettings,
} from "@/lib/youtubeShortsOAuth";

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number | string;
  scope?: string;
  error?: string;
  error_description?: string;
};

type GoogleUserInfo = {
  id?: string;
  email?: string;
  name?: string;
  picture?: string;
};

export async function GET(request: Request) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
  let returnTo = "/dashboard?panel=youtube_shorts";

  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const stateRaw = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error");
    const oauthErrorDescription = url.searchParams.get("error_description");

    const st = verifyOAuthState(request, "youtube_shorts", stateRaw);
    returnTo = safeInternalPath(st.returnTo || "/dashboard?panel=youtube_shorts", "/dashboard?panel=youtube_shorts");

    const clearStateCookie = (res: NextResponse) => {
      res.cookies.set(st.cookieName, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
      return res;
    };

    const fail = (error: string, message?: string) => {
      const finalUrl = new URL(returnTo, siteUrl);
      finalUrl.searchParams.set("linked", "youtube_shorts");
      finalUrl.searchParams.set("ok", "0");
      finalUrl.searchParams.set("error", error);
      if (message) finalUrl.searchParams.set("message", getSimpleFrenchErrorMessage(message, "La connexion YouTube n'a pas pu être finalisée.").slice(0, 200));
      return clearStateCookie(NextResponse.redirect(finalUrl));
    };

    if (!st.ok) {
      return clearStateCookie(NextResponse.redirect(new URL("/dashboard?panel=youtube_shorts&linked=youtube_shorts&ok=0&error=oauth_state", siteUrl)));
    }

    if (oauthError || !code) {
      return fail(oauthError || "missing_code", oauthErrorDescription || "La connexion YouTube a été annulée ou incomplète.");
    }

    const clientId = getYoutubeShortsOAuthClientId();
    const clientSecret = getYoutubeShortsOAuthClientSecret();
    const redirectUri = getYoutubeShortsRedirectUri(request.url);
    if (!clientId || !clientSecret) {
      return fail("oauth_config_missing", "Configuration Google incomplète côté serveur.");
    }

    const supabase = await createSupabaseServer();
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    const user = authData?.user;
    if (authErr || !user) return fail("not_authenticated", "Tu dois être connecté à iNrCy pour connecter YouTube.");
    const activeUserId = await resolveOAuthBoundInrcyAccountId(supabase, user.id, st.state.accountId);

    const rlUser = await enforceRateLimit({
      name: "oauth_youtube_shorts_cb",
      identifier: activeUserId,
      limit: 10,
      window: "10 m",
    });
    if (rlUser) return rlUser;

    const ip = getClientIp(request);
    const rlIp = await enforceRateLimit({
      name: "oauth_youtube_shorts_cb_ip",
      identifier: ip,
      limit: 20,
      window: "10 m",
    });
    if (rlIp) return rlIp;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
      cache: "no-store",
    });

    const tokenData = (await tokenRes.json().catch(() => ({}))) as TokenResponse;
    const accessToken = asString(tokenData.access_token);
    if (!tokenRes.ok || !accessToken) {
      return fail("token_exchange_failed", tokenData.error_description || tokenData.error || "La connexion au compte YouTube a échoué.");
    }

    const missingScopes = findExplicitlyMissingGoogleScopes(
      tokenData.scope,
      YOUTUBE_SHORTS_DEFAULT_SCOPES,
    );
    if (missingScopes.length) {
      return fail(GOOGLE_OAUTH_PERMISSION_ERROR_CODE, GOOGLE_OAUTH_PERMISSION_MESSAGE);
    }

    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    const userInfo = (await userRes.json().catch(() => ({}))) as GoogleUserInfo;
    if (!userRes.ok || !userInfo.email) {
      return fail("userinfo_failed", "Impossible de récupérer l'adresse du compte Google.");
    }

    const channel = await fetchYoutubeMineChannel(accessToken);
    if (!channel) {
      return fail("youtube_channel_missing", "Aucune chaîne YouTube n'a été trouvée sur ce compte Google.");
    }

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("integrations")
      .select("id,refresh_token_enc")
      .eq("user_id", activeUserId)
      .eq("provider", "youtube")
      .eq("source", "youtube_shorts")
      .eq("product", "youtube_shorts")
      .maybeSingle();
    if (existingErr) return fail("db_read_failed", "Le service est momentanément indisponible. Merci de réessayer.");

    const existingRec = asRecord(existing);
    const existingId = asString(existingRec.id);
    const existingRefresh = asString(existingRec.refresh_token_enc);
    const refreshTokenEnc = tokenData.refresh_token ? encryptToken(tokenData.refresh_token) : existingRefresh || null;
    const expiresAt = tokenData.expires_in != null
      ? new Date(Date.now() + Number(tokenData.expires_in) * 1000).toISOString()
      : null;

    const scope = asString(tokenData.scope) || getYoutubeShortsOAuthScope();
    const meta = withCurrentConnectionVersion("channel:youtube_shorts", {
      account_email: userInfo.email,
      account_name: userInfo.name ?? null,
      account_picture: userInfo.picture ?? null,
      channel_id: channel.channelId,
      channel_title: channel.channelTitle,
      channel_handle: channel.channelHandle,
      channel_url: channel.channelUrl,
      thumbnail_url: channel.thumbnailUrl || null,
      long_uploads_status: channel.longUploadsStatus,
      stats: channel.stats,
    });

    const payload: Record<string, unknown> = {
      user_id: activeUserId,
      provider: "youtube",
      category: "social",
      source: "youtube_shorts",
      product: "youtube_shorts",
      status: "connected",
      email_address: userInfo.email,
      display_name: channel.channelTitle || userInfo.name || "Chaîne YouTube",
      provider_account_id: userInfo.id ?? null,
      scopes: scope,
      access_token_enc: encryptToken(accessToken),
      refresh_token_enc: refreshTokenEnc,
      expires_at: expiresAt,
      resource_id: channel.channelId,
      resource_label: channel.channelHandle || channel.channelTitle,
      meta,
      updated_at: new Date().toISOString(),
    };

    if (existingId) {
      const { error: updateErr } = await supabaseAdmin.from("integrations").update(payload).eq("id", existingId).eq("user_id", activeUserId);
      if (updateErr) return fail("db_update_failed", "La mise à jour de la connexion YouTube a échoué.");
    } else {
      const { error: insertErr } = await supabaseAdmin.from("integrations").insert(payload);
      if (insertErr) return fail("db_insert_failed", "L'enregistrement de la connexion YouTube a échoué.");
    }

    const { root, youtubeShorts: current } = await readYoutubeShortsSettings(supabaseAdmin, activeUserId);
    const next: YoutubeShortsSettings = {
      ...current,
      connected: true,
      accountConnected: true,
      channelUrl: channel.channelUrl,
      channelHandle: channel.channelHandle,
      channelName: channel.channelTitle,
      channelId: channel.channelId,
      accountEmail: userInfo.email,
      accountName: userInfo.name ?? current.accountName,
      avatarUrl: channel.thumbnailUrl,
      scopes: scope,
      expiresAt,
      stats: {
        subscriberCount: numberOrNull(channel.stats.subscriberCount),
        videoCount: numberOrNull(channel.stats.videoCount),
        viewCount: numberOrNull(channel.stats.viewCount),
      },
    };
    await saveYoutubeShortsSettings(supabaseAdmin, activeUserId, root, next);
    await clearAllToolCaches(supabase, activeUserId);

    const finalUrl = new URL(returnTo, siteUrl);
    finalUrl.searchParams.set("linked", "youtube_shorts");
    finalUrl.searchParams.set("ok", "1");
    return clearStateCookie(NextResponse.redirect(finalUrl));
  } catch (error) {
    const finalUrl = new URL(returnTo, siteUrl);
    finalUrl.searchParams.set("linked", "youtube_shorts");
    finalUrl.searchParams.set("ok", "0");
    finalUrl.searchParams.set("error", "oauth_callback_failed");
    const message = getSimpleFrenchErrorMessage(error, "La connexion YouTube n'a pas pu être finalisée.").slice(0, 200);
    if (message) finalUrl.searchParams.set("message", message);
    return NextResponse.redirect(finalUrl);
  }
}
