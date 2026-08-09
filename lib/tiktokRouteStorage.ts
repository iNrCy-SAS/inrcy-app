import "server-only";

import { normalizeTiktokSettings, type TiktokSettings } from "@/lib/tiktokSettings";
import { buildTiktokProfileUrl } from "@/lib/tiktokOAuth";
import { hasUsableRefreshCredential } from "@/lib/publicationChannelAvailability";

type IntegrationLite = {
  status?: string | null;
  resource_id?: string | null;
  resource_label?: string | null;
  display_name?: string | null;
  expires_at?: string | null;
  access_token_enc?: string | null;
  refresh_token_enc?: string | null;
  scopes?: string | null;
  meta?: unknown;
  updated_at?: string | null;
  created_at?: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function hasTruthyString(value: unknown) {
  return Boolean(asString(value).trim());
}

function isExpired(expiresAt: unknown, skewSeconds = 60) {
  const iso = asString(expiresAt);
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return t <= Date.now() + skewSeconds * 1000;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function withAtUsername(value: string) {
  const clean = value.trim();
  if (!clean) return "";
  return clean.startsWith("@") ? clean : `@${clean}`;
}

export function isTiktokIntegrationActive(integration: unknown) {
  const row = asRecord(integration);
  const status = asString(row.status);
  const hasToken = hasTruthyString(row.access_token_enc);
  const hasRefreshToken = hasTruthyString(row.refresh_token_enc);
  const hasUsableRefreshToken = hasUsableRefreshCredential(
    hasRefreshToken,
    asRecord(row.meta).refresh_expires_at,
  );
  const expired = isExpired(row.expires_at) && !hasUsableRefreshToken;
  return Boolean((status === "connected" || status === "account_connected") && (hasToken || hasUsableRefreshToken) && !expired);
}

export function applyTiktokIntegrationState(settings: unknown, integration: unknown): TiktokSettings {
  const base = normalizeTiktokSettings(settings);
  const row = asRecord(integration);
  const meta = asRecord(row.meta);
  const active = isTiktokIntegrationActive(row);

  if (!active) {
    return {
      ...base,
      connected: false,
      accountConnected: false,
      username: "",
      displayName: "",
      profileUrl: "",
      avatarUrl: "",
      openId: "",
      scopes: "",
      expiresAt: null,
      stats: {
        followerCount: null,
        followingCount: null,
        likesCount: null,
        videoCount: null,
      },
    };
  }

  const rawUsername = asString(meta.username) || asString(row.resource_label) || base.username;
  const username = rawUsername ? withAtUsername(rawUsername.replace(/^@+/, "")) : base.username;
  const profileUrl = base.profileUrl || asString(meta.profile_url) || buildTiktokProfileUrl(username);

  return {
    ...base,
    connected: true,
    accountConnected: true,
    username,
    displayName: asString(meta.display_name) || asString(row.display_name) || base.displayName,
    profileUrl,
    avatarUrl: asString(meta.avatar_url) || base.avatarUrl,
    openId: asString(meta.open_id) || asString(row.resource_id) || base.openId,
    scopes: asString(row.scopes) || base.scopes,
    expiresAt: asString(row.expires_at) || base.expiresAt,
    mode: "oauth",
    stats: {
      followerCount: numberOrNull(meta.follower_count) ?? base.stats.followerCount,
      followingCount: numberOrNull(meta.following_count) ?? base.stats.followingCount,
      likesCount: numberOrNull(meta.likes_count) ?? base.stats.likesCount,
      videoCount: numberOrNull(meta.video_count) ?? base.stats.videoCount,
    },
  };
}

export async function readTiktokSettings(supabase: any, userId: string): Promise<{ root: Record<string, unknown>; tiktok: TiktokSettings }> {
  const { data } = await supabase
    .from("pro_tools_configs")
    .select("settings")
    .eq("user_id", userId)
    .maybeSingle();

  const root = data?.settings && typeof data.settings === "object" && !Array.isArray(data.settings)
    ? (data.settings as Record<string, unknown>)
    : {};

  return {
    root,
    tiktok: normalizeTiktokSettings(root.tiktok),
  };
}

export async function readTiktokIntegration(supabase: any, userId: string): Promise<IntegrationLite | null> {
  const { data } = await supabase
    .from("integrations")
    .select("status,resource_id,resource_label,display_name,expires_at,access_token_enc,refresh_token_enc,scopes,meta,updated_at,created_at")
    .eq("user_id", userId)
    .eq("provider", "tiktok")
    .eq("source", "tiktok")
    .eq("product", "tiktok")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data || null;
}

export async function readTiktokSettingsWithOAuth(supabase: any, userId: string): Promise<{ root: Record<string, unknown>; tiktok: TiktokSettings; integration: IntegrationLite | null }> {
  const [{ root, tiktok }, integration] = await Promise.all([
    readTiktokSettings(supabase, userId),
    readTiktokIntegration(supabase, userId),
  ]);

  return {
    root,
    integration,
    tiktok: applyTiktokIntegrationState(tiktok, integration),
  };
}

export async function saveTiktokSettings(supabase: any, userId: string, root: Record<string, unknown>, tiktok: TiktokSettings) {
  const settings = { ...root, tiktok };
  const { error } = await supabase
    .from("pro_tools_configs")
    .upsert({ user_id: userId, settings }, { onConflict: "user_id" });

  if (error) throw error;
  return settings;
}
