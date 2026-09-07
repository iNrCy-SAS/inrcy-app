import "server-only";

import crypto from "crypto";
import { decryptToken, encryptToken, tryDecryptToken } from "@/lib/oauthCrypto";
import { log } from "@/lib/observability/logger";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { asRecord, asString, safeErrorMessage } from "@/lib/tsSafe";

export const X_OAUTH_PROVIDER = "x" as const;
export const X_OAUTH_SCOPES = [
  "tweet.read",
  "users.read",
  "tweet.write",
  "media.write",
  "offline.access",
] as const;

export const X_PKCE_COOKIE_PREFIX = "inrcy_oauth_pkce_x";
export const X_API_ORIGIN = "https://api.x.com";
export const X_AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
export const X_TOKEN_URL = `${X_API_ORIGIN}/2/oauth2/token`;
export const X_REVOKE_URL = `${X_API_ORIGIN}/2/oauth2/revoke`;

type XIntegrationRecord = {
  id?: string | null;
  status?: string | null;
  access_token_enc?: string | null;
  refresh_token_enc?: string | null;
  expires_at?: string | null;
  resource_id?: string | null;
  resource_label?: string | null;
  provider_account_id?: string | null;
  meta?: unknown;
  scopes?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

export type XAuthState = {
  row: XIntegrationRecord | null;
  accessToken: string | null;
  expiresAt: string | null;
  userId: string | null;
  username: string | null;
  refreshTokenPresent: boolean;
  refreshed: boolean;
  canReconnectSilently: boolean;
  error?: string;
};

function isExpired(expiresAt: unknown, skewSeconds = 90) {
  const iso = asString(expiresAt);
  if (!iso) return false;
  const timestamp = Date.parse(iso);
  return Number.isFinite(timestamp) && timestamp <= Date.now() + skewSeconds * 1000;
}

export function getXOAuthScope() {
  const configured = String(process.env.X_OAUTH_SCOPES || "")
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  const allowed = new Set(X_OAUTH_SCOPES);
  const normalized = configured.filter((scope) => allowed.has(scope as (typeof X_OAUTH_SCOPES)[number]));
  // Le socle complet reste obligatoire : offline.access est nécessaire à
  // iNrAgent et media.write aux publications contenant des médias.
  return [...new Set<string>([...X_OAUTH_SCOPES, ...normalized])].join(" ");
}

export function getXRedirectUri(requestUrl: string) {
  const explicit = String(process.env.X_REDIRECT_URI || "").trim();
  if (explicit) return explicit;
  const siteUrl = String(process.env.NEXT_PUBLIC_SITE_URL || new URL(requestUrl).origin).replace(/\/$/, "");
  return `${siteUrl}/api/integrations/x/callback`;
}

export function createXCodeVerifier() {
  // RFC 7636 allows 43-128 unreserved characters. 64 random bytes encoded as
  // base64url produce an 86-character verifier.
  return crypto.randomBytes(64).toString("base64url");
}

export function createXCodeChallenge(verifier: string) {
  return crypto.createHash("sha256").update(verifier, "utf8").digest("base64url");
}

function digestXOAuthState(stateB64: string) {
  return crypto.createHash("sha256").update(stateB64, "utf8").digest("base64url");
}

export function getXPkceCookieName(stateB64: string) {
  return `${X_PKCE_COOKIE_PREFIX}_${digestXOAuthState(stateB64).slice(0, 20)}`;
}

export function sealXCodeVerifier(verifier: string, stateB64: string) {
  return encryptToken(JSON.stringify({
    v: 1,
    verifier,
    stateDigest: digestXOAuthState(stateB64),
  }));
}

export function openXCodeVerifier(cookieValue: string | null, stateB64: string) {
  if (!cookieValue) return null;
  try {
    const payload = asRecord(JSON.parse(decryptToken(cookieValue)));
    const verifier = asString(payload.verifier);
    if (payload.v !== 1 || !verifier || payload.stateDigest !== digestXOAuthState(stateB64)) return null;
    return verifier.length >= 43 && verifier.length <= 128 ? verifier : null;
  } catch {
    return null;
  }
}

export async function requestXToken(form: Record<string, string>) {
  const clientId = String(process.env.X_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.X_CLIENT_SECRET || "").trim();
  if (!clientId) throw new Error("Configuration X incomplète côté serveur.");

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`;
  }

  const response = await fetch(X_TOKEN_URL, {
    method: "POST",
    headers,
    body: new URLSearchParams({ client_id: clientId, ...form }).toString(),
    cache: "no-store",
  });
  const payload = asRecord(await response.json().catch(() => ({})));
  if (!response.ok) {
    throw new Error(
      asString(payload.error_description) ||
        asString(payload.detail) ||
        asString(payload.error) ||
        `HTTP ${response.status}`,
    );
  }
  return payload;
}

/**
 * Révoque les jetons détenus par iNrCy avant de supprimer la connexion locale.
 * La déconnexion reste possible si X est momentanément indisponible : les
 * échecs sont journalisés sans jamais exposer les jetons ni les conserver en
 * clair.
 */
export async function revokeXTokensBestEffort(input: {
  accessTokenEnc?: string | null;
  refreshTokenEnc?: string | null;
  integrationId?: string | null;
  context?: string | null;
}) {
  const clientId = String(process.env.X_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.X_CLIENT_SECRET || "").trim();
  const tokens = Array.from(new Set([
    tryDecryptToken(input.refreshTokenEnc || null),
    tryDecryptToken(input.accessTokenEnc || null),
  ].filter((token): token is string => Boolean(token))));

  if (!clientId || !tokens.length) return;

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`;
  }

  for (const token of tokens) {
    try {
      const response = await fetch(X_REVOKE_URL, {
        method: "POST",
        headers,
        body: new URLSearchParams({ token, client_id: clientId }).toString(),
        cache: "no-store",
      });
      if (!response.ok) {
        log.warn("x_oauth_revoke_non_ok", {
          status: response.status,
          context: input.context || undefined,
          integration_id: input.integrationId || undefined,
        });
      }
    } catch (error) {
      log.warn("x_oauth_revoke_failed", {
        error_message: safeErrorMessage(error),
        context: input.context || undefined,
        integration_id: input.integrationId || undefined,
      });
    }
  }
}

export async function fetchXAuthenticatedUser(accessToken: string) {
  const fields = [
    "id",
    "name",
    "username",
    "description",
    "location",
    "url",
    "profile_image_url",
    "public_metrics",
    "verified",
  ].join(",");
  const response = await fetch(`${X_API_ORIGIN}/2/users/me?user.fields=${encodeURIComponent(fields)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const payload = asRecord(await response.json().catch(() => ({})));
  if (!response.ok) {
    throw new Error(asString(payload.detail) || asString(payload.title) || `HTTP ${response.status}`);
  }
  const user = asRecord(payload.data);
  if (!asString(user.id) || !asString(user.username)) {
    throw new Error("X n'a pas confirmé l'identité du compte autorisé.");
  }
  return user;
}

async function loadLatestXIntegration(userId: string): Promise<XIntegrationRecord | null> {
  const { data } = await supabaseAdmin
    .from("integrations")
    .select(
      "id,status,access_token_enc,refresh_token_enc,expires_at,resource_id,resource_label,provider_account_id,meta,scopes,updated_at,created_at",
    )
    .eq("user_id", userId)
    .eq("provider", X_OAUTH_PROVIDER)
    .eq("source", X_OAUTH_PROVIDER)
    .eq("product", X_OAUTH_PROVIDER)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);
  return Array.isArray(data) && data[0] ? (data[0] as XIntegrationRecord) : null;
}

export async function getXAccessToken(params: {
  userId: string;
  forceRefresh?: boolean;
}): Promise<XAuthState> {
  const row = await loadLatestXIntegration(params.userId);
  if (!row) {
    return {
      row: null,
      accessToken: null,
      expiresAt: null,
      userId: null,
      username: null,
      refreshTokenPresent: false,
      refreshed: false,
      canReconnectSilently: false,
      error: "Compte X introuvable.",
    };
  }

  const meta = asRecord(row.meta);
  const accessToken = tryDecryptToken(row.access_token_enc) || null;
  const refreshToken = tryDecryptToken(row.refresh_token_enc) || null;
  const expired = isExpired(row.expires_at);
  const userId = asString(row.resource_id) || asString(row.provider_account_id) || null;
  const username = asString(row.resource_label) || asString(meta.username) || null;

  if (accessToken && !expired && !params.forceRefresh) {
    return {
      row,
      accessToken,
      expiresAt: asString(row.expires_at) || null,
      userId,
      username,
      refreshTokenPresent: Boolean(refreshToken),
      refreshed: false,
      canReconnectSilently: Boolean(refreshToken),
    };
  }

  if (!refreshToken) {
    return {
      row,
      accessToken: accessToken && !expired ? accessToken : null,
      expiresAt: asString(row.expires_at) || null,
      userId,
      username,
      refreshTokenPresent: false,
      refreshed: false,
      canReconnectSilently: false,
      error: expired ? "La connexion X a expiré. Reconnectez le compte." : undefined,
    };
  }

  try {
    const token = await requestXToken({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    const nextAccessToken = asString(token.access_token);
    if (!nextAccessToken) throw new Error("Réponse X invalide : access_token manquant.");
    const nextRefreshToken = asString(token.refresh_token) || refreshToken;
    const expiresIn = Number(token.expires_in || 0);
    const nextExpiresAt = Number.isFinite(expiresIn) && expiresIn > 0
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null;
    const nextMeta = {
      ...meta,
      refreshed_at: new Date().toISOString(),
      token_type: asString(token.token_type) || asString(meta.token_type) || "bearer",
    };

    await supabaseAdmin
      .from("integrations")
      .update({
        access_token_enc: encryptToken(nextAccessToken),
        refresh_token_enc: encryptToken(nextRefreshToken),
        expires_at: nextExpiresAt,
        scopes: asString(token.scope) || row.scopes || getXOAuthScope(),
        status: "connected",
        meta: nextMeta,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("user_id", params.userId);

    return {
      row: { ...row, expires_at: nextExpiresAt, status: "connected", meta: nextMeta },
      accessToken: nextAccessToken,
      expiresAt: nextExpiresAt,
      userId,
      username,
      refreshTokenPresent: true,
      refreshed: true,
      canReconnectSilently: true,
    };
  } catch (error) {
    return {
      row,
      accessToken: null,
      expiresAt: asString(row.expires_at) || null,
      userId,
      username,
      refreshTokenPresent: true,
      refreshed: false,
      canReconnectSilently: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
