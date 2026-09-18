import { NextResponse } from "next/server";

import { encryptToken, tryDecryptToken } from "@/lib/oauthCrypto";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchTiktokCreatorInfo, refreshTiktokAccessToken } from "@/lib/tiktokOAuth";
import { isTiktokIntegrationActive, readTiktokIntegration, readTiktokSettingsWithOAuth } from "@/lib/tiktokRouteStorage";
import { asRecord, asString } from "@/lib/tsSafe";

function asBoolean(value: unknown) {
  return value === true;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isExpired(expiresAt: unknown, skewSeconds = 120) {
  const raw = asString(expiresAt);
  if (!raw) return false;
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return false;
  return timestamp <= Date.now() + skewSeconds * 1000;
}

async function getTiktokAccessToken(userId: string, rowLike: unknown) {
  const row = asRecord(rowLike);
  let accessToken = tryDecryptToken(String(row.access_token_enc || "")) || "";
  const refreshToken = tryDecryptToken(String(row.refresh_token_enc || "")) || "";

  if (accessToken && !isExpired(row.expires_at, 120)) return accessToken;
  if (!refreshToken) return accessToken;

  const refreshed = await refreshTiktokAccessToken(refreshToken);
  const nextAccessToken = (asString(refreshed.access_token) || "").trim();
  const nextRefreshToken = (asString(refreshed.refresh_token) || "").trim() || refreshToken;
  const expiresIn = Number(refreshed.expires_in || 0);
  const refreshExpiresIn = Number(refreshed.refresh_expires_in || 0);
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;
  const nextMeta = {
    ...asRecord(row.meta),
    refresh_expires_at: Number.isFinite(refreshExpiresIn) && refreshExpiresIn > 0
      ? new Date(Date.now() + refreshExpiresIn * 1000).toISOString()
      : asRecord(row.meta).refresh_expires_at || null,
    tiktok_token_refreshed_at: new Date().toISOString(),
  };

  if (nextAccessToken) {
    await supabaseAdmin
      .from("integrations")
      .update({
        access_token_enc: encryptToken(nextAccessToken),
        refresh_token_enc: nextRefreshToken ? encryptToken(nextRefreshToken) : row.refresh_token_enc || null,
        expires_at: expiresAt || row.expires_at || null,
        meta: nextMeta,
      })
      .eq("user_id", userId)
      .eq("provider", "tiktok")
      .eq("source", "tiktok")
      .eq("product", "tiktok");
    accessToken = nextAccessToken;
  }

  return accessToken;
}

function normalizePrivacyOptions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (asString(item) || "").trim()).filter(Boolean);
}

export async function GET() {
  const { user, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const [integration, settingsResult] = await Promise.all([
    readTiktokIntegration(supabaseAdmin, activeUserId),
    readTiktokSettingsWithOAuth(supabaseAdmin, activeUserId),
  ]);

  if (!isTiktokIntegrationActive(integration)) {
    return NextResponse.json({ ok: false, error: "TikTok à connecter avant publication." }, { status: 409 });
  }

  const accessToken = await getTiktokAccessToken(activeUserId, integration);
  if (!accessToken) {
    return NextResponse.json({ ok: false, error: "Connexion TikTok expirée. Reconnecte TikTok dans Canaux." }, { status: 401 });
  }

  const creatorInfo = await fetchTiktokCreatorInfo(accessToken);
  const normalized = {
    accountKey:
      settingsResult.tiktok.openId ||
      integration?.resource_id ||
      asString(creatorInfo.creator_username) ||
      asString(creatorInfo.username),
    username: settingsResult.tiktok.username || asString(creatorInfo.creator_username) || asString(creatorInfo.username),
    displayName: settingsResult.tiktok.displayName || asString(creatorInfo.creator_nickname) || asString(creatorInfo.display_name),
    avatarUrl: settingsResult.tiktok.avatarUrl || asString(creatorInfo.creator_avatar_url) || null,
    privacyLevelOptions: normalizePrivacyOptions(creatorInfo.privacy_level_options),
    commentDisabled: asBoolean(creatorInfo.comment_disabled),
    duetDisabled: asBoolean(creatorInfo.duet_disabled),
    stitchDisabled: asBoolean(creatorInfo.stitch_disabled),
    maxVideoDurationSeconds: asNumber(creatorInfo.max_video_post_duration_sec),
    raw: creatorInfo,
  };

  return NextResponse.json({ ok: true, creatorInfo: normalized });
}
