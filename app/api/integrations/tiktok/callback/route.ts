import { NextResponse } from "next/server";

import { createSupabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { encryptToken } from "@/lib/oauthCrypto";
import { clearAllToolCaches } from "@/lib/statsCache";
import { withCurrentConnectionVersion } from "@/lib/connectionVersions";
import { safeInternalPath, verifyOAuthState } from "@/lib/security";
import { asRecord, asString } from "@/lib/tsSafe";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import {
  buildTiktokProfileUrl,
  fetchTiktokCreatorInfo,
  fetchTiktokUserInfo,
  getTiktokOAuthScope,
  getTiktokRedirectUri,
  tiktokPostForm,
} from "@/lib/tiktokOAuth";
import { buildTiktokSettingsPatch } from "@/lib/tiktokSettings";
import { readTiktokSettings, saveTiktokSettings } from "@/lib/tiktokRouteStorage";
import { resolveOAuthBoundInrcyAccountId } from "@/lib/multicompte/server";

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export async function GET(request: Request) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
  let returnTo = "/dashboard?panel=tiktok";

  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const stateRaw = url.searchParams.get("state");
    const err = url.searchParams.get("error");
    const errDesc = url.searchParams.get("error_description");

    const st = verifyOAuthState(request, "tiktok", stateRaw);
    returnTo = safeInternalPath(st.returnTo || "/dashboard?panel=tiktok", "/dashboard?panel=tiktok");

    const clearStateCookie = (res: NextResponse) => {
      res.cookies.set(st.cookieName, "", {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });
      return res;
    };

    const fail = (error: string, message?: string) => {
      const finalUrl = new URL(returnTo, siteUrl);
      finalUrl.searchParams.set("linked", "tiktok");
      finalUrl.searchParams.set("ok", "0");
      finalUrl.searchParams.set("error", error);
      if (message) {
        finalUrl.searchParams.set("message", getSimpleFrenchErrorMessage(message, "La connexion TikTok n'a pas pu être finalisée.").slice(0, 200));
      }
      return clearStateCookie(NextResponse.redirect(finalUrl));
    };

    if (!st.ok) {
      return clearStateCookie(NextResponse.redirect(new URL("/dashboard?panel=tiktok&linked=tiktok&ok=0&error=oauth_state", siteUrl)));
    }

    if (err || !code) {
      return fail(err || "missing_code", errDesc || "La connexion TikTok a été annulée ou incomplète.");
    }

    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
    if (!clientKey || !clientSecret) {
      return fail("oauth_config_missing", "Configuration TikTok incomplète côté serveur.");
    }

    const supabase = await createSupabaseServer();
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    const user = authData?.user;
    if (authErr || !user) return fail("not_authenticated", "Tu dois être connecté à iNrCy pour connecter TikTok.");
    const activeUserId = await resolveOAuthBoundInrcyAccountId(supabase, user.id, st.state.accountId);

    const redirectUri = getTiktokRedirectUri(request.url);
    const token = await tiktokPostForm("https://open.tiktokapis.com/v2/oauth/token/", {
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    });

    const accessToken = asString(token.access_token) || "";
    const refreshToken = asString(token.refresh_token) || "";
    const openIdFromToken = asString(token.open_id) || "";
    const scope = asString(token.scope) || getTiktokOAuthScope();
    const expiresIn = numberOrNull(token.expires_in);
    const refreshExpiresIn = numberOrNull(token.refresh_expires_in);
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
    const refreshExpiresAt = refreshExpiresIn ? new Date(Date.now() + refreshExpiresIn * 1000).toISOString() : null;
    if (!accessToken) return fail("missing_access_token", "TikTok n'a pas renvoyé de jeton d'accès.");

    let userInfo: Record<string, unknown> = {};
    let creatorInfo: Record<string, unknown> = {};
    let userInfoError: string | null = null;
    let creatorInfoError: string | null = null;

    try {
      userInfo = await fetchTiktokUserInfo(accessToken);
    } catch (error) {
      userInfoError = error instanceof Error ? error.message : String(error);
    }
    try {
      creatorInfo = await fetchTiktokCreatorInfo(accessToken);
    } catch (error) {
      creatorInfoError = error instanceof Error ? error.message : String(error);
    }

    const username =
      asString(userInfo.username) ||
      asString(creatorInfo.creator_username) ||
      (openIdFromToken ? `tiktok_${openIdFromToken.slice(0, 8)}` : "Compte TikTok");
    const displayName = asString(userInfo.display_name) || asString(creatorInfo.creator_nickname) || username;
    const avatarUrl = asString(userInfo.avatar_large_url) || asString(userInfo.avatar_url) || asString(creatorInfo.creator_avatar_url) || "";
    const profileUrl = buildTiktokProfileUrl(username, userInfo.profile_deep_link);
    const openId = asString(userInfo.open_id) || openIdFromToken;

    const meta = {
      open_id: openId,
      union_id: asString(userInfo.union_id) || null,
      username,
      display_name: displayName,
      profile_url: profileUrl,
      avatar_url: avatarUrl || null,
      bio_description: asString(userInfo.bio_description) || null,
      is_verified: typeof userInfo.is_verified === "boolean" ? userInfo.is_verified : null,
      follower_count: numberOrNull(userInfo.follower_count),
      following_count: numberOrNull(userInfo.following_count),
      likes_count: numberOrNull(userInfo.likes_count),
      video_count: numberOrNull(userInfo.video_count),
      creator_info: creatorInfo,
      creator_info_error: creatorInfoError,
      user_info_error: userInfoError,
      refresh_expires_at: refreshExpiresAt,
      refresh_expires_in: refreshExpiresIn,
      ...withCurrentConnectionVersion("channel:tiktok", {}),
    };

    const { data: savedIntegration, error: integrationError } = await supabaseAdmin
      .from("integrations")
      .upsert({
        user_id: activeUserId,
        provider: "tiktok",
        category: "social",
        source: "tiktok",
        product: "tiktok",
        status: "connected",
        display_name: displayName || null,
        provider_account_id: openId || null,
        scopes: scope,
        access_token_enc: encryptToken(accessToken),
        refresh_token_enc: refreshToken ? encryptToken(refreshToken) : null,
        expires_at: expiresAt,
        resource_id: openId || username || null,
        resource_label: username || displayName || null,
        meta,
      }, { onConflict: "user_id,provider,source,product" })
      .select("id,status")
      .single();

    if (integrationError || savedIntegration?.status !== "connected") {
      return fail(
        "integration_write_failed",
        "TikTok est connecté, mais iNrCy n'a pas pu enregistrer la connexion. Réessayez.",
      );
    }

    const { root, tiktok: current } = await readTiktokSettings(supabaseAdmin, activeUserId);
    const next = buildTiktokSettingsPatch(current, {
      connected: true,
      accountConnected: true,
      username: username ? `@${username.replace(/^@+/, "")}` : current.username,
      displayName,
      profileUrl,
      avatarUrl,
      openId,
      scopes: scope,
      expiresAt,
      mode: "oauth",
      stats: {
        followerCount: numberOrNull(userInfo.follower_count),
        followingCount: numberOrNull(userInfo.following_count),
        likesCount: numberOrNull(userInfo.likes_count),
        videoCount: numberOrNull(userInfo.video_count),
      },
    });
    await saveTiktokSettings(supabaseAdmin, activeUserId, root, next);
    await clearAllToolCaches(supabase, activeUserId);

    const finalUrl = new URL(returnTo, siteUrl);
    finalUrl.searchParams.set("linked", "tiktok");
    finalUrl.searchParams.set("ok", "1");
    return clearStateCookie(NextResponse.redirect(finalUrl));
  } catch (error) {
    const finalUrl = new URL(returnTo, siteUrl);
    finalUrl.searchParams.set("linked", "tiktok");
    finalUrl.searchParams.set("ok", "0");
    finalUrl.searchParams.set("error", "oauth_callback_failed");
    const msg = getSimpleFrenchErrorMessage(error, "La connexion TikTok n'a pas pu être finalisée.").slice(0, 200);
    if (msg) finalUrl.searchParams.set("message", msg);
    return NextResponse.redirect(finalUrl);
  }
}
