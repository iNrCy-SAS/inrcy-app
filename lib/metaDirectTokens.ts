import "server-only";

import { decryptToken, encryptToken } from "@/lib/oauthCrypto";
import { resolveInstagramAuthMode } from "@/lib/instagramAuthMode";
import { asRecord, asString } from "@/lib/tsSafe";

type SupabaseLike = { from: (...args: any[]) => any };
export type MetaDirectIntegration = {
  id?: unknown; user_id?: unknown; provider?: unknown; source?: unknown;
  product?: unknown; resource_id?: unknown; access_token_enc?: unknown; expires_at?: unknown; meta?: unknown;
};
export type MetaDirectProvider = "instagram" | "threads";

export type MetaDirectApiDiagnostics = Readonly<{
  httpStatus?: number;
  metaCode?: number;
  metaSubcode?: number;
}>;

function safeMetaDirectDiagnostics(input: unknown): MetaDirectApiDiagnostics {
  const record = asRecord(input);
  const diagnostics: { httpStatus?: number; metaCode?: number; metaSubcode?: number } = {};
  for (const key of ["httpStatus", "metaCode", "metaSubcode"] as const) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) diagnostics[key] = value;
  }
  return Object.freeze(diagnostics);
}

export class MetaDirectApiError extends Error {
  readonly diagnostics: MetaDirectApiDiagnostics;

  constructor(public code: string, message: string, public status = 400, diagnostics: unknown = {}) {
    super(message);
    this.name = "MetaDirectApiError";
    this.diagnostics = safeMetaDirectDiagnostics(diagnostics);
  }
}

/** Never include credentials, authorization codes, provider response bodies or URLs in errors. */
export async function fetchMetaDirectJson(url: URL | string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, cache: "no-store", signal: init.signal ?? AbortSignal.timeout(25_000) });
  } catch {
    throw new MetaDirectApiError("meta_request_unavailable", "Meta ne répond pas pour le moment. Réessayez.", 502);
  }
  let data: Record<string, unknown>;
  try { data = asRecord(await response.json()); }
  catch { throw new MetaDirectApiError("meta_response_invalid", "La réponse de Meta est momentanément indisponible.", 502, { httpStatus: response.status }); }
  if (!response.ok || data.error || data.error_type) {
    const providerError = asRecord(data.error);
    const providerCode = Number(providerError.code);
    const authenticationError = response.status === 401 || providerCode === 190 || providerCode === 102;
    throw new MetaDirectApiError(authenticationError ? "meta_direct_reconnect_required" : "meta_permission_or_request_failed",
      authenticationError ? "Reconnectez ce compte pour renouveler ses autorisations."
        : "Meta a refusé cette opération. Vérifiez les autorisations du compte et les réglages de l’application.",
      authenticationError ? 401 : response.status >= 500 ? 502 : 400,
      { httpStatus: response.status, metaCode: providerError.code ?? data.code, metaSubcode: providerError.error_subcode ?? data.error_subcode });
  }
  return data;
}

export function metaDirectTokenBase(provider: MetaDirectProvider): string {
  return provider === "instagram" ? "https://graph.instagram.com" : "https://graph.threads.com";
}

export async function exchangeMetaDirectLongToken(provider: MetaDirectProvider, shortToken: string, appSecret: string) {
  const url = new URL(`${metaDirectTokenBase(provider)}/access_token`);
  url.searchParams.set("grant_type", provider === "instagram" ? "ig_exchange_token" : "th_exchange_token");
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("access_token", shortToken);
  const data = await fetchMetaDirectJson(url);
  const accessToken = asString(data.access_token);
  const expiresIn = Number(data.expires_in);
  if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new MetaDirectApiError("meta_token_invalid", "La connexion Meta n’a pas pu être finalisée.", 502);
  }
  return { accessToken, expiresIn, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
}

/** Refresh long-lived tokens before expiry; concurrent refreshes cannot overwrite a reconnection. */
export async function ensureMetaDirectAccessToken(admin: SupabaseLike, integration: MetaDirectIntegration): Promise<string> {
  const encryptedToken = asString(integration.access_token_enc);
  if (!encryptedToken) throw new MetaDirectApiError("meta_direct_reconnect_required", "Reconnectez ce compte.", 401);
  const provider = integration.provider === "threads" ? "threads" : "instagram";
  const direct = provider === "threads" || resolveInstagramAuthMode(integration.meta) === "instagram_login";
  const accessToken = decryptToken(encryptedToken);
  if (!direct) return accessToken;
  const expiresAt = Date.parse(asString(integration.expires_at) || "");
  const now = Date.now();
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    throw new MetaDirectApiError("meta_direct_reconnect_required", "L’autorisation a expiré. Reconnectez ce compte.", 401);
  }
  if (expiresAt - now > 7 * 24 * 60 * 60 * 1000) return accessToken;
  const meta = asRecord(integration.meta);
  const lastRefresh = Date.parse(asString(meta.token_refreshed_at) || asString(meta.token_issued_at) || "");
  // Meta requires tokens to be at least 24 hours old before refreshing.
  if (Number.isFinite(lastRefresh) && now - lastRefresh < 24 * 60 * 60 * 1000) return accessToken;
  const id = asString(integration.id);
  const userId = asString(integration.user_id);
  if (!id || !userId) throw new MetaDirectApiError("meta_token_identity_missing", "La connexion doit être actualisée.", 409);
  const url = new URL(`${metaDirectTokenBase(provider)}/refresh_access_token`);
  url.searchParams.set("grant_type", provider === "instagram" ? "ig_refresh_token" : "th_refresh_token");
  url.searchParams.set("access_token", accessToken);
  const data = await fetchMetaDirectJson(url);
  const refreshedToken = asString(data.access_token);
  const expiresIn = Number(data.expires_in);
  if (!refreshedToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new MetaDirectApiError("meta_token_invalid", "Reconnectez ce compte pour actualiser son autorisation.", 401);
  }
  const refreshedExpiry = new Date(now + expiresIn * 1000).toISOString();
  const encryptedRefresh = encryptToken(refreshedToken);
  const update = admin.from("integrations").update({
    access_token_enc: encryptedRefresh, expires_at: refreshedExpiry,
    meta: { ...meta, token_refreshed_at: new Date(now).toISOString() }, updated_at: new Date(now).toISOString(),
  });
  const guardedUpdate = update.eq("id", id).eq("user_id", userId).eq("access_token_enc", encryptedToken)
    .eq("resource_id", integration.resource_id);
  // A preference write during the Meta request must not be overwritten by this older snapshot.
  const metadataUpdate = integration.meta == null ? guardedUpdate.is("meta", null)
    : guardedUpdate.eq("meta", JSON.stringify(integration.meta));
  const { data: changed, error } = await metadataUpdate.select("id").maybeSingle();
  if (error) throw new MetaDirectApiError("meta_token_save_failed", "L’autorisation n’a pas pu être actualisée. Réessayez.", 503);
  if (changed) return refreshedToken;
  // Another refresh/reconnection won. Reuse it only if it still names this exact channel/account.
  const { data: winner, error: winnerError } = await admin.from("integrations")
    .select("id,user_id,provider,source,product,status,resource_id,access_token_enc,expires_at,meta")
    .eq("id", id).eq("user_id", userId).maybeSingle();
  const winning = asRecord(winner);
  const winningExpiry = Date.parse(asString(winning.expires_at) || "");
  if (winnerError || winning.status !== "connected" || winning.provider !== integration.provider
    || winning.source !== integration.source || winning.product !== integration.product
    || asString(winning.resource_id) !== asString(integration.resource_id)
    || resolveInstagramAuthMode(winning.meta) !== resolveInstagramAuthMode(integration.meta)
    || !Number.isFinite(winningExpiry) || winningExpiry <= Date.now()) {
    throw new MetaDirectApiError("meta_connection_changed", "La connexion a changé pendant l’opération. Réessayez.", 409);
  }
  const winningToken = asString(winning.access_token_enc);
  if (!winningToken) throw new MetaDirectApiError("meta_direct_reconnect_required", "Reconnectez ce compte.", 401);
  return decryptToken(winningToken);
}
