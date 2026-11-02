import "server-only";

import { asRecord, asString } from "@/lib/tsSafe";
import { queryTikTokCreatorInfo } from "./tiktokCreatorInfo.ts";

export const TIKTOK_DEFAULT_SCOPES = [
  "user.info.basic",
  "user.info.profile",
  "user.info.stats",
  "video.list",
  "video.publish",
  "video.upload",
] as const;

export function getTiktokOAuthScope() {
  const raw = process.env.TIKTOK_SCOPES;
  if (!raw || !raw.trim()) return TIKTOK_DEFAULT_SCOPES.join(",");
  return raw
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean)
    .join(",");
}

export function getTiktokRedirectUri(requestUrl: string) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || new URL(requestUrl).origin;
  return process.env.TIKTOK_REDIRECT_URI || `${siteUrl}/api/integrations/tiktok/callback`;
}

export function buildTiktokProfileUrl(username: unknown, fallback: unknown = "") {
  const direct = asString(fallback);
  if (direct && /^https?:\/\//i.test(direct)) return direct;
  const raw = asString(username)?.trim().replace(/^@+/, "") || "";
  return raw ? `https://www.tiktok.com/@${raw}` : "";
}

export async function tiktokPostForm(url: string, form: Record<string, string>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
    cache: "no-store",
  });
  const data: unknown = await res.json().catch(() => ({}));
  const rec = asRecord(data);
  if (!res.ok) {
    throw new Error(
      asString(rec["error_description"]) ||
        asString(rec["error"]) ||
        asString(asRecord(rec["error"])["message"]) ||
        `TikTok HTTP ${res.status}`,
    );
  }
  return rec;
}

export async function fetchTiktokUserInfo(accessToken: string) {
  const fields = [
    "open_id",
    "union_id",
    "avatar_url",
    "avatar_url_100",
    "avatar_large_url",
    "display_name",
    "bio_description",
    "profile_deep_link",
    "is_verified",
    "username",
    "follower_count",
    "following_count",
    "likes_count",
    "video_count",
  ].join(",");
  const res = await fetch(`https://open.tiktokapis.com/v2/user/info/?fields=${encodeURIComponent(fields)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const data: unknown = await res.json().catch(() => ({}));
  const rec = asRecord(data);
  const error = asRecord(rec["error"]);
  const code = asString(error["code"]);
  if (!res.ok || (code && code !== "ok")) {
    throw new Error(asString(error["message"]) || code || `TikTok user info HTTP ${res.status}`);
  }
  return asRecord(asRecord(rec["data"])["user"]);
}

export async function fetchTiktokCreatorInfo(accessToken: string) {
  return queryTikTokCreatorInfo(accessToken);
}

export async function refreshTiktokAccessToken(refreshToken: string) {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) {
    throw new Error("Configuration TikTok incomplète côté serveur.");
  }
  return tiktokPostForm("https://open.tiktokapis.com/v2/oauth/token/", {
    client_key: clientKey,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}
