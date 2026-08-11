import "server-only";

import { asRecord, asString } from "@/lib/tsSafe";
import { normalizeYoutubeLongUploadsStatus } from "@/lib/videoPublicationPolicy";

export const YOUTUBE_SHORTS_DEFAULT_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
] as const;

export type YoutubeShortsSettings = {
  connected: boolean;
  accountConnected: boolean;
  channelUrl: string;
  channelHandle: string;
  channelName: string;
  channelId: string;
  accountEmail: string;
  accountName: string;
  avatarUrl: string;
  scopes: string;
  expiresAt: string | null;
  defaultVisibility: "public" | "unlisted" | "private";
  preferredFormat: "shorts" | "video";
  madeForKids: boolean;
  autoHashtags: boolean;
  stats: {
    subscriberCount: number | null;
    videoCount: number | null;
    viewCount: number | null;
  };
};

type IntegrationLite = {
  status?: string | null;
  resource_id?: string | null;
  resource_label?: string | null;
  display_name?: string | null;
  email_address?: string | null;
  expires_at?: string | null;
  access_token_enc?: string | null;
  refresh_token_enc?: string | null;
  scopes?: string | null;
  meta?: unknown;
  updated_at?: string | null;
  created_at?: string | null;
};

export const DEFAULT_YOUTUBE_SHORTS_SETTINGS: YoutubeShortsSettings = {
  connected: false,
  accountConnected: false,
  channelUrl: "",
  channelHandle: "",
  channelName: "",
  channelId: "",
  accountEmail: "",
  accountName: "",
  avatarUrl: "",
  scopes: "",
  expiresAt: null,
  defaultVisibility: "public",
  preferredFormat: "shorts",
  madeForKids: false,
  autoHashtags: true,
  stats: {
    subscriberCount: null,
    videoCount: null,
    viewCount: null,
  },
};

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function hasTruthyString(value: unknown) {
  return Boolean((asString(value) || "").trim());
}

function isExpired(expiresAt: unknown, skewSeconds = 60) {
  const iso = asString(expiresAt);
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return t <= Date.now() + skewSeconds * 1000;
}

function normalizeHandle(value: unknown) {
  const raw = (asString(value) || "").trim();
  if (!raw) return "";
  return raw.startsWith("@") ? raw : `@${raw.replace(/^@+/, "")}`;
}


export function getYoutubeShortsOAuthClientId() {
  return (
    process.env.YOUTUBE_CLIENT_ID ||
    process.env.YOUTUBE_SHORTS_CLIENT_ID ||
    process.env.GOOGLE_YOUTUBE_CLIENT_ID ||
    process.env.GOOGLE_YOUTUBE_SHORTS_CLIENT_ID ||
    process.env.GOOGLE_CLIENT_ID ||
    ""
  );
}

export function getYoutubeShortsOAuthClientSecret() {
  return (
    process.env.YOUTUBE_CLIENT_SECRET ||
    process.env.YOUTUBE_SHORTS_CLIENT_SECRET ||
    process.env.GOOGLE_YOUTUBE_CLIENT_SECRET ||
    process.env.GOOGLE_YOUTUBE_SHORTS_CLIENT_SECRET ||
    process.env.GOOGLE_CLIENT_SECRET ||
    ""
  );
}

export function isYoutubeUsingDedicatedOAuthClient() {
  return Boolean(
    process.env.YOUTUBE_CLIENT_ID ||
    process.env.YOUTUBE_SHORTS_CLIENT_ID ||
    process.env.GOOGLE_YOUTUBE_CLIENT_ID ||
    process.env.GOOGLE_YOUTUBE_SHORTS_CLIENT_ID
  );
}

export function getYoutubeShortsOAuthScope() {
  // Contrat de moindre privilège : une variable Vercel historique ne doit pas
  // pouvoir réintroduire silencieusement un scope Gmail/Drive/etc. dans le
  // parcours YouTube. Toute évolution de cette liste doit passer par le code,
  // les tests et la validation Google correspondante.
  return YOUTUBE_SHORTS_DEFAULT_SCOPES.join(" ");
}

export function getYoutubeShortsRedirectUri(requestUrl: string) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || new URL(requestUrl).origin;
  return process.env.YOUTUBE_SHORTS_REDIRECT_URI || process.env.GOOGLE_YOUTUBE_SHORTS_REDIRECT_URI || `${siteUrl}/api/integrations/youtube-shorts/callback`;
}

export function buildYoutubeChannelUrl(channelId: unknown, customUrl?: unknown) {
  const custom = (asString(customUrl) || "").trim();
  if (/^https?:\/\//i.test(custom)) return custom;
  if (custom.startsWith("@")) return `https://www.youtube.com/${custom}`;
  if (custom.startsWith("/")) return `https://www.youtube.com${custom}`;
  const id = (asString(channelId) || "").trim();
  return id ? `https://www.youtube.com/channel/${encodeURIComponent(id)}` : "";
}

export function normalizeYoutubeShortsSettings(value: unknown): YoutubeShortsSettings {
  const source = asRecord(value);
  const defaults = asRecord(source.defaults);
  const stats = asRecord(source.stats);
  const defaultVisibility = ["public", "unlisted", "private"].includes(String(defaults.defaultVisibility))
    ? String(defaults.defaultVisibility) as YoutubeShortsSettings["defaultVisibility"]
    : DEFAULT_YOUTUBE_SHORTS_SETTINGS.defaultVisibility;
  const preferredFormat = ["shorts", "video"].includes(String(defaults.preferredFormat))
    ? String(defaults.preferredFormat) as YoutubeShortsSettings["preferredFormat"]
    : DEFAULT_YOUTUBE_SHORTS_SETTINGS.preferredFormat;

  return {
    ...DEFAULT_YOUTUBE_SHORTS_SETTINGS,
    connected: Boolean(source.connected),
    accountConnected: Boolean(source.accountConnected ?? source.connected),
    channelUrl: asString(source.channelUrl) || asString(source.url) || "",
    channelHandle: normalizeHandle(source.channelHandle ?? source.handle),
    channelName: asString(source.channelName) || asString(source.name) || "",
    channelId: asString(source.channelId) || "",
    accountEmail: asString(source.accountEmail) || "",
    accountName: asString(source.accountName) || "",
    avatarUrl: asString(source.avatarUrl) || "",
    scopes: asString(source.scopes) || "",
    expiresAt: asString(source.expiresAt) || null,
    defaultVisibility,
    preferredFormat,
    madeForKids: Boolean(defaults.madeForKids),
    autoHashtags: defaults.autoHashtags !== false,
    stats: {
      subscriberCount: numberOrNull(stats.subscriberCount),
      videoCount: numberOrNull(stats.videoCount),
      viewCount: numberOrNull(stats.viewCount),
    },
  };
}

export function isYoutubeShortsIntegrationActive(integration: unknown) {
  const row = asRecord(integration);
  const status = asString(row.status);
  const hasToken = hasTruthyString(row.access_token_enc);
  const hasRefreshToken = hasTruthyString(row.refresh_token_enc);
  const expired = isExpired(row.expires_at) && !hasRefreshToken;
  return Boolean((status === "connected" || status === "account_connected") && (hasToken || hasRefreshToken) && !expired);
}

export function applyYoutubeShortsIntegrationState(settings: unknown, integration: unknown): YoutubeShortsSettings {
  const base = normalizeYoutubeShortsSettings(settings);
  const row = asRecord(integration);
  const meta = asRecord(row.meta);
  const stats = asRecord(meta.stats);
  const active = isYoutubeShortsIntegrationActive(row);

  if (!active) {
    return {
      ...base,
      connected: false,
      accountConnected: false,
      channelUrl: "",
      channelHandle: "",
      channelName: "",
      channelId: "",
      accountEmail: "",
      accountName: "",
      avatarUrl: "",
      scopes: "",
      expiresAt: null,
      stats: DEFAULT_YOUTUBE_SHORTS_SETTINGS.stats,
    };
  }

  const channelId = asString(meta.channel_id) || asString(row.resource_id) || base.channelId;
  const handle = normalizeHandle(meta.channel_handle || base.channelHandle);
  const url = asString(meta.channel_url) || base.channelUrl || buildYoutubeChannelUrl(channelId, handle);

  return {
    ...base,
    connected: true,
    accountConnected: true,
    channelUrl: url,
    channelHandle: handle,
    channelName: asString(meta.channel_title) || asString(row.resource_label) || asString(row.display_name) || base.channelName,
    channelId,
    accountEmail: asString(row.email_address) || asString(meta.account_email) || base.accountEmail,
    accountName: asString(meta.account_name) || base.accountName,
    avatarUrl: asString(meta.thumbnail_url) || base.avatarUrl,
    scopes: asString(row.scopes) || base.scopes,
    expiresAt: asString(row.expires_at) || base.expiresAt,
    stats: {
      subscriberCount: numberOrNull(stats.subscriberCount) ?? base.stats.subscriberCount,
      videoCount: numberOrNull(stats.videoCount) ?? base.stats.videoCount,
      viewCount: numberOrNull(stats.viewCount) ?? base.stats.viewCount,
    },
  };
}

export async function readYoutubeShortsSettings(supabase: any, userId: string): Promise<{ root: Record<string, unknown>; youtubeShorts: YoutubeShortsSettings }> {
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
    youtubeShorts: normalizeYoutubeShortsSettings(root.youtube_shorts),
  };
}

export async function readYoutubeShortsIntegration(supabase: any, userId: string): Promise<IntegrationLite | null> {
  const { data } = await supabase
    .from("integrations")
    .select("status,resource_id,resource_label,display_name,email_address,expires_at,access_token_enc,refresh_token_enc,scopes,meta,updated_at,created_at")
    .eq("user_id", userId)
    .eq("provider", "youtube")
    .eq("source", "youtube_shorts")
    .eq("product", "youtube_shorts")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data || null;
}

export async function readYoutubeShortsSettingsWithOAuth(supabase: any, userId: string): Promise<{ root: Record<string, unknown>; youtubeShorts: YoutubeShortsSettings; integration: IntegrationLite | null }> {
  const [{ root, youtubeShorts }, integration] = await Promise.all([
    readYoutubeShortsSettings(supabase, userId),
    readYoutubeShortsIntegration(supabase, userId),
  ]);

  return {
    root,
    integration,
    youtubeShorts: applyYoutubeShortsIntegrationState(youtubeShorts, integration),
  };
}

export async function saveYoutubeShortsSettings(supabase: any, userId: string, root: Record<string, unknown>, youtubeShorts: YoutubeShortsSettings) {
  const settings = { ...root, youtube_shorts: serializeYoutubeShortsSettings(youtubeShorts) };
  const { error } = await supabase
    .from("pro_tools_configs")
    .upsert({ user_id: userId, settings }, { onConflict: "user_id" });

  if (error) throw error;
  return settings;
}

export function serializeYoutubeShortsSettings(settings: YoutubeShortsSettings) {
  return {
    connected: settings.connected,
    accountConnected: settings.accountConnected,
    channelUrl: settings.channelUrl,
    channelHandle: settings.channelHandle,
    channelName: settings.channelName,
    channelId: settings.channelId,
    accountEmail: settings.accountEmail,
    accountName: settings.accountName,
    avatarUrl: settings.avatarUrl,
    scopes: settings.scopes,
    expiresAt: settings.expiresAt,
    stats: settings.stats,
    defaults: {
      defaultVisibility: settings.defaultVisibility,
      preferredFormat: settings.preferredFormat,
      madeForKids: settings.madeForKids,
      autoHashtags: settings.autoHashtags,
    },
  };
}

type YoutubeChannelApiItem = {
  id?: string;
  snippet?: {
    title?: string;
    customUrl?: string;
    thumbnails?: Record<string, { url?: string }>;
  };
  statistics?: {
    viewCount?: string;
    subscriberCount?: string;
    hiddenSubscriberCount?: boolean;
    videoCount?: string;
  };
  status?: {
    longUploadsStatus?: string;
  };
};

export async function fetchYoutubeMineChannel(accessToken: string) {
  const fields = "items(id,snippet(title,customUrl,thumbnails),statistics(viewCount,subscriberCount,hiddenSubscriberCount,videoCount),status(longUploadsStatus))";
  const res = await fetch(`https://www.googleapis.com/youtube/v3/channels?${new URLSearchParams({
    part: "snippet,statistics,status",
    mine: "true",
    fields,
  }).toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  const data: unknown = await res.json().catch(() => ({}));
  const rec = asRecord(data);
  if (!res.ok) {
    const err = asRecord(asRecord(rec.error).errors);
    throw new Error(asString(asRecord(rec.error).message) || asString(err.message) || `YouTube HTTP ${res.status}`);
  }

  const items = Array.isArray(rec.items) ? rec.items as YoutubeChannelApiItem[] : [];
  const item = items[0];
  if (!item?.id) return null;

  const snippet = item.snippet || {};
  const thumbnails = snippet.thumbnails || {};
  const thumbnailUrl = thumbnails.high?.url || thumbnails.medium?.url || thumbnails.default?.url || "";
  const handle = normalizeHandle(snippet.customUrl || "");
  const channelUrl = buildYoutubeChannelUrl(item.id, handle);

  return {
    channelId: item.id,
    channelTitle: snippet.title || "Chaîne YouTube",
    channelHandle: handle,
    channelUrl,
    thumbnailUrl,
    longUploadsStatus: normalizeYoutubeLongUploadsStatus(
      item.status?.longUploadsStatus,
    ),
    stats: {
      subscriberCount: item.statistics?.hiddenSubscriberCount ? null : numberOrNull(item.statistics?.subscriberCount),
      videoCount: numberOrNull(item.statistics?.videoCount),
      viewCount: numberOrNull(item.statistics?.viewCount),
    },
  };
}

export async function refreshYoutubeShortsAccessToken(refreshToken: string) {
  const clientId = getYoutubeShortsOAuthClientId();
  const clientSecret = getYoutubeShortsOAuthClientSecret();
  if (!clientId || !clientSecret) throw new Error("Configuration Google OAuth incomplète.");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const rec = asRecord(data);
    throw new Error(asString(rec.error_description) || asString(rec.error) || "Rafraîchissement YouTube impossible.");
  }
  return data as { access_token?: string; expires_in?: number; scope?: string; token_type?: string };
}
