import { NextResponse } from "next/server";

import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { tryDecryptToken, encryptToken } from "@/lib/oauthCrypto";
import { asRecord, asString } from "@/lib/tsSafe";
import {
  fetchYoutubeMineChannel,
  isYoutubeShortsIntegrationActive,
  readYoutubeShortsIntegration,
  refreshYoutubeShortsAccessToken,
} from "@/lib/youtubeShortsOAuth";

const REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
] as const;

function isExpired(expiresAt: unknown, skewSeconds = 120) {
  const raw = asString(expiresAt);
  if (!raw) return false;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return false;
  return t <= Date.now() + skewSeconds * 1000;
}

function scopeSet(value: unknown) {
  const raw = asString(value) || "";
  return new Set(raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean));
}

function missingScopes(scopes: unknown) {
  const set = scopeSet(scopes);
  return REQUIRED_SCOPES.filter((scope) => !set.has(scope));
}

async function getFreshAccessToken(userId: string, integration: unknown) {
  const row = asRecord(integration);
  let accessToken = tryDecryptToken(asString(row.access_token_enc)) || "";
  const refreshToken = tryDecryptToken(asString(row.refresh_token_enc)) || "";

  if (accessToken && !isExpired(row.expires_at)) return accessToken;
  if (!refreshToken) return accessToken;

  const refreshed = await refreshYoutubeShortsAccessToken(refreshToken);
  const nextAccessToken = (asString(refreshed.access_token) || "").trim();
  if (!nextAccessToken) return accessToken;

  const expiresIn = Number(refreshed.expires_in || 0);
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : asString(row.expires_at) || null;

  await supabaseAdmin
    .from("integrations")
    .update({
      access_token_enc: encryptToken(nextAccessToken),
      expires_at: expiresAt,
      scopes: asString(refreshed.scope) || asString(row.scopes) || null,
      meta: {
        ...asRecord(row.meta),
        youtube_diagnostics_token_refreshed_at: new Date().toISOString(),
      },
    })
    .eq("user_id", userId)
    .eq("provider", "youtube")
    .eq("source", "youtube_shorts")
    .eq("product", "youtube_shorts");

  accessToken = nextAccessToken;
  return accessToken;
}

async function pingAnalytics(accessToken: string) {
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const url = `https://youtubeanalytics.googleapis.com/v2/reports?${new URLSearchParams({
    ids: "channel==MINE",
    startDate: start,
    endDate: end,
    metrics: "views",
  }).toString()}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = asRecord(asRecord(data).error);
    return { ok: false, status: res.status, error: asString(error.message) || `YouTube Analytics HTTP ${res.status}` };
  }
  return { ok: true, status: res.status };
}

export async function GET() {
  const { errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const integration = await readYoutubeShortsIntegration(supabaseAdmin, activeUserId);
  const active = isYoutubeShortsIntegrationActive(integration);
  const missing = missingScopes(integration?.scopes);

  const base = {
    connected: active,
    scopes_ok: missing.length === 0,
    missing_scopes: missing,
    expires_at: integration?.expires_at || null,
    channel_id: integration?.resource_id || null,
    channel_name: integration?.resource_label || integration?.display_name || null,
    account_email: integration?.email_address || null,
  };

  if (!active) {
    return NextResponse.json({
      ok: true,
      ready: false,
      ...base,
      checks: {
        oauth: Boolean(integration),
        channel: false,
        analytics: false,
        upload_scope: false,
      },
      message: "YouTube n'est pas connecté.",
    });
  }

  try {
    const accessToken = await getFreshAccessToken(activeUserId, integration);
    if (!accessToken) throw new Error("Token YouTube indisponible.");

    const channel = await fetchYoutubeMineChannel(accessToken);
    const analytics = await pingAnalytics(accessToken);
    const uploadScopeOk = !missing.includes("https://www.googleapis.com/auth/youtube.upload");
    const ready = Boolean(channel?.channelId && analytics.ok && missing.length === 0 && uploadScopeOk);

    return NextResponse.json({
      ok: true,
      ready,
      ...base,
      channel_id: channel?.channelId || base.channel_id,
      channel_name: channel?.channelTitle || base.channel_name,
      channel_url: channel?.channelUrl || asString(asRecord(integration?.meta).channel_url) || null,
      checks: {
        oauth: true,
        channel: Boolean(channel?.channelId),
        analytics: analytics.ok,
        upload_scope: uploadScopeOk,
      },
      analytics,
      stats: channel?.stats || null,
      message: ready
        ? "YouTube est prêt : connexion, chaîne, scopes et analytics OK."
        : "YouTube est connecté, mais un contrôle reste à corriger avant publication complète.",
    });
  } catch (err) {
    return NextResponse.json({
      ok: true,
      ready: false,
      ...base,
      checks: {
        oauth: true,
        channel: false,
        analytics: false,
        upload_scope: !missing.includes("https://www.googleapis.com/auth/youtube.upload"),
      },
      message: err instanceof Error ? err.message : "Diagnostic YouTube impossible.",
    });
  }
}
