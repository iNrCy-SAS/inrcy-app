import "server-only";

import { encryptToken, tryDecryptToken } from "@/lib/oauthCrypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { asRecord, asString } from "@/lib/tsSafe";

export type LinkedInIntegrationRecord = {
  id?: string | null;
  status?: string | null;
  resource_id?: string | null;
  access_token_enc?: string | null;
  refresh_token_enc?: string | null;
  expires_at?: string | null;
  meta?: unknown;
  resource_label?: string | null;
  display_name?: string | null;
  provider_account_id?: string | null;
  email_address?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

export type LinkedInAuthState = {
  row: LinkedInIntegrationRecord | null;
  accessToken: string | null;
  expiresAt: string | null;
  authorUrn: string | null;
  orgUrn: string | null;
  refreshTokenPresent: boolean;
  refreshed: boolean;
  canReconnectSilently: boolean;
  error?: string;
};

function isExpired(expiresAt: unknown, skewSeconds = 60) {
  const iso = asString(expiresAt);
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return t <= Date.now() + skewSeconds * 1000;
}

async function postTokenForm(form: Record<string, string>) {
  const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      String(data?.error_description || data?.error || `HTTP ${res.status}`),
    );
  }
  return data;
}

async function loadLatestLinkedInRow(
  userId: string,
): Promise<LinkedInIntegrationRecord | null> {
  const { data } = await supabaseAdmin
    .from("integrations")
    .select(
      "id,status,resource_id,provider_account_id,access_token_enc,refresh_token_enc,expires_at,meta,resource_label,display_name,email_address,updated_at,created_at",
    )
    .eq("user_id", userId)
    .eq("provider", "linkedin")
    .eq("source", "linkedin")
    .eq("product", "linkedin")
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);

  return Array.isArray(data) && data[0]
    ? (data[0] as LinkedInIntegrationRecord)
    : null;
}

export async function getLinkedInAccessToken(params: {
  userId: string;
  forceRefresh?: boolean;
}): Promise<LinkedInAuthState> {
  const row = await loadLatestLinkedInRow(params.userId);
  if (!row) {
    return {
      row: null,
      accessToken: null,
      expiresAt: null,
      authorUrn: null,
      orgUrn: null,
      refreshTokenPresent: false,
      refreshed: false,
      canReconnectSilently: false,
      error: "Compte LinkedIn introuvable.",
    };
  }

  const meta = asRecord(row.meta);
  const accessToken =
    tryDecryptToken(asString(row.access_token_enc) || "") || null;
  const refreshToken =
    tryDecryptToken(asString(row.refresh_token_enc) || "") || null;
  const refreshTokenPresent = Boolean(refreshToken);
  const persistedResourceId = asString(row.resource_id) || "";
  const providerAccountId = asString(row.provider_account_id);
  const authorUrn =
    asString(meta.profile_urn) ||
    (persistedResourceId.startsWith("urn:li:person:")
      ? persistedResourceId
      : "") ||
    (providerAccountId ? `urn:li:person:${providerAccountId}` : "") ||
    null;
  const orgUrn = asString(meta.org_urn) || null;
  const expired = isExpired(row.expires_at);
  const refreshTokenExpired = Boolean(
    refreshToken && isExpired(meta.refresh_expires_at),
  );

  if (accessToken && !expired && !params.forceRefresh) {
    return {
      row,
      accessToken,
      expiresAt: asString(row.expires_at) || null,
      authorUrn,
      orgUrn,
      refreshTokenPresent,
      refreshed: false,
      canReconnectSilently: refreshTokenPresent,
    };
  }

  if (!refreshToken) {
    return {
      row,
      accessToken: accessToken && !expired ? accessToken : null,
      expiresAt: asString(row.expires_at) || null,
      authorUrn,
      orgUrn,
      refreshTokenPresent: false,
      refreshed: false,
      canReconnectSilently: false,
      error: expired
        ? "Le jeton LinkedIn a expiré et aucun refresh token n'est disponible."
        : undefined,
    };
  }

  if (refreshTokenExpired) {
    return {
      row,
      accessToken: accessToken && !expired ? accessToken : null,
      expiresAt: asString(row.expires_at) || null,
      authorUrn,
      orgUrn,
      refreshTokenPresent: true,
      refreshed: false,
      canReconnectSilently: false,
      error: "Le jeton de renouvellement LinkedIn a expiré.",
    };
  }

  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return {
      row,
      accessToken: null,
      expiresAt: asString(row.expires_at) || null,
      authorUrn,
      orgUrn,
      refreshTokenPresent: true,
      refreshed: false,
      canReconnectSilently: true,
      error: "Configuration LinkedIn incomplète côté serveur.",
    };
  }

  try {
    const tokenData = await postTokenForm({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });

    const nextAccessToken = asString(tokenData.access_token);
    if (!nextAccessToken)
      throw new Error("Réponse LinkedIn invalide: access_token manquant.");

    const expiresIn = Number(tokenData.expires_in || 0);
    const nextExpiresAt =
      Number.isFinite(expiresIn) && expiresIn > 0
        ? new Date(Date.now() + expiresIn * 1000).toISOString()
        : null;

    const nextRefreshToken = asString(tokenData.refresh_token) || refreshToken;
    const nextRefreshExpiresIn = Number(
      tokenData.refresh_token_expires_in,
    );
    const nextMeta = {
      ...meta,
      refresh_token_expires_in: Number.isFinite(
        nextRefreshExpiresIn,
      )
        ? nextRefreshExpiresIn
        : (meta.refresh_token_expires_in ?? null),
      refresh_expires_at:
        Number.isFinite(nextRefreshExpiresIn) && nextRefreshExpiresIn > 0
          ? new Date(Date.now() + nextRefreshExpiresIn * 1000).toISOString()
          : (meta.refresh_expires_at ?? null),
      refreshed_at: new Date().toISOString(),
    };

    await supabaseAdmin
      .from("integrations")
      .update({
        access_token_enc: encryptToken(nextAccessToken),
        refresh_token_enc: nextRefreshToken
          ? encryptToken(nextRefreshToken)
          : row.refresh_token_enc || null,
        expires_at: nextExpiresAt,
        status: "connected",
        meta: nextMeta,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("user_id", params.userId);

    const nextRow: LinkedInIntegrationRecord = {
      ...row,
      access_token_enc: encryptToken(nextAccessToken),
      refresh_token_enc: nextRefreshToken
        ? encryptToken(nextRefreshToken)
        : row.refresh_token_enc || null,
      expires_at: nextExpiresAt,
      status: "connected",
      meta: nextMeta,
      updated_at: new Date().toISOString(),
    };

    return {
      row: nextRow,
      accessToken: nextAccessToken,
      expiresAt: nextExpiresAt,
      authorUrn,
      orgUrn,
      refreshTokenPresent: true,
      refreshed: true,
      canReconnectSilently: true,
    };
  } catch (error) {
    return {
      row,
      accessToken: null,
      expiresAt: asString(row.expires_at) || null,
      authorUrn,
      orgUrn,
      refreshTokenPresent: true,
      refreshed: false,
      canReconnectSilently: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
