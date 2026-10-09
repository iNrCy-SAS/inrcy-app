import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { decryptToken, encryptToken } from "@/lib/oauthCrypto";
import {
  LINKEDIN_ADS_API_VERSION,
  linkedInAdsCanRetainAccount,
  linkedInAdsHasAccessMode,
  linkedInAdsHasReadAccess,
  linkedInAdsScopes,
  normalizeLinkedInAdsAccount,
  normalizeLinkedInAdsAccountUser,
  resolveLinkedInAdsRedirectUri,
  type LinkedInAdsAccessMode,
  type LinkedInAdsAccount,
  type LinkedInAdsAccountUser,
} from "@/lib/adsLinkedInPolicy";

// The organic LinkedIn disconnect route deletes every `provider=linkedin` row.
// Keep Ads under a distinct provider key so that action cannot unlink Ads.
export const LINKEDIN_ADS_PROVIDER = "linkedin_ads";
export const LINKEDIN_ADS_SOURCE = "linkedin_ads";
export const LINKEDIN_ADS_PRODUCT = "ads";

type LinkedInAdsToken = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number | string;
  refresh_token_expires_in?: number | string;
  scope?: string;
};

export type LinkedInAdsIntegration = {
  id: string;
  status: string | null;
  scopes: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  expires_at: string | null;
  provider_account_id: string | null;
  resource_id: string | null;
  resource_label: string | null;
  meta: unknown;
};

export type LinkedInAdsOAuthDiagnostic = {
  operation: "code_exchange" | "token_refresh" | "token_introspection";
  providerStatus: number | null;
  providerCode: "invalid_request" | "invalid_client" | "invalid_grant" | "invalid_redirect_uri"
    | "invalid_scope" | "unauthorized_client" | "access_denied" | "temporarily_unavailable" | "server_error" | null;
  verification: "inactive" | "client_mismatch" | "auth_type_mismatch" | "malformed_response"
    | "missing_scopes" | "timeout" | "request_failed" | null;
  attempts?: 1 | 2 | 3 | 4;
  tokenStatus?: "active" | "expired" | "revoked";
};

export class LinkedInAdsConnectionError extends Error {
  constructor(message: string, readonly code: string, readonly status = 503,
    readonly oauthDiagnostic?: LinkedInAdsOAuthDiagnostic) {
    super(message);
    this.name = "LinkedInAdsConnectionError";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Never retain provider descriptions, credential values, or arbitrary error strings. */
function oauthDiagnostic(operation: LinkedInAdsOAuthDiagnostic["operation"], providerStatus: number | null,
  payload?: unknown, verification: LinkedInAdsOAuthDiagnostic["verification"] = null,
  attempts: 1 | 2 | 3 | 4 = 1): LinkedInAdsOAuthDiagnostic {
  const error = asRecord(payload).error;
  const knownCodes: ReadonlySet<unknown> = new Set([
    "invalid_request", "invalid_client", "invalid_grant", "invalid_redirect_uri", "invalid_scope",
    "unauthorized_client", "access_denied", "temporarily_unavailable", "server_error",
  ]);
  const rawStatus = asRecord(payload).status;
  const status = typeof rawStatus === "string" ? rawStatus.toLowerCase() : "";
  const tokenStatus = status === "active" || status === "expired" || status === "revoked" ? status : null;
  return { operation, providerStatus,
    providerCode: knownCodes.has(error) ? error as LinkedInAdsOAuthDiagnostic["providerCode"] : null,
    verification, ...(attempts > 1 ? { attempts } : {}), ...(tokenStatus ? { tokenStatus } : {}) };
}

async function oauthResponse(operation: LinkedInAdsOAuthDiagnostic["operation"], url: string,
  body: URLSearchParams, timeoutMs = 15000): Promise<Response> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new LinkedInAdsConnectionError("Vérification OAuth LinkedIn Ads momentanément indisponible.",
      "provider_unavailable", 503, oauthDiagnostic(operation, null, undefined, timeout ? "timeout" : "request_failed"));
  }
}

/** A JSON syntax error is malformed data; interrupted body transport is temporary. */
async function oauthPayload(response: Response, operation: LinkedInAdsOAuthDiagnostic["operation"]): Promise<Record<string, unknown>> {
  try {
    return asRecord(await response.json());
  } catch (error) {
    if (error instanceof SyntaxError) return {};
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new LinkedInAdsConnectionError("Vérification OAuth LinkedIn Ads momentanément indisponible.",
      "provider_unavailable", 503, oauthDiagnostic(operation, response.status, undefined, timeout ? "timeout" : "request_failed"));
  }
}

function positiveSeconds(value: unknown): number | null {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function expiryFromSeconds(value: unknown): string | null {
  const seconds = positiveSeconds(value);
  return seconds ? new Date(Date.now() + seconds * 1000).toISOString() : null;
}

function isExpiring(value: unknown, marginSeconds = 120): boolean {
  const timestamp = typeof value === "string" ? Date.parse(value) : NaN;
  return !Number.isFinite(timestamp) || timestamp <= Date.now() + marginSeconds * 1000;
}

export function getLinkedInAdsCredentials() {
  // Never reuse the organic LinkedIn client ID or secret implicitly.
  const clientId = String(process.env.LINKEDIN_ADS_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.LINKEDIN_ADS_CLIENT_SECRET || "").trim();
  return { clientId, clientSecret, configured: Boolean(clientId && clientSecret) };
}

export function getLinkedInAdsRedirectUri(requestUrl: string): string {
  return resolveLinkedInAdsRedirectUri({
    explicit: process.env.LINKEDIN_ADS_REDIRECT_URI,
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    requestUrl,
  });
}

function linkedInAdsVersion(): string {
  const configured = String(process.env.LINKEDIN_ADS_API_VERSION || "").trim();
  return /^20\d{4}$/.test(configured) ? configured : LINKEDIN_ADS_API_VERSION;
}

async function tokenRequest(body: URLSearchParams): Promise<LinkedInAdsToken> {
  const { clientId, clientSecret, configured } = getLinkedInAdsCredentials();
  if (!configured) throw new LinkedInAdsConnectionError("Configuration LinkedIn Ads incomplète.", "configuration_missing");
  const operation = body.get("grant_type") === "refresh_token" ? "token_refresh" : "code_exchange";
  const response = await oauthResponse(operation, "https://www.linkedin.com/oauth/v2/accessToken",
    new URLSearchParams({ ...Object.fromEntries(body), client_id: clientId, client_secret: clientSecret }));
  const payload = await oauthPayload(response, operation);
  if (!response.ok) {
    const invalid = response.status === 400 || response.status === 401;
    throw new LinkedInAdsConnectionError(
      invalid ? "Autorisation LinkedIn Ads invalide ou expirée." : "Échange OAuth LinkedIn Ads indisponible.",
      invalid ? "authorization_invalid" : "provider_unavailable",
      invalid ? 401 : 503,
      oauthDiagnostic(operation, response.status, payload),
    );
  }
  if (typeof payload.access_token !== "string" || !payload.access_token
    || !(typeof payload.expires_in === "number" || typeof payload.expires_in === "string")
    || !positiveSeconds(payload.expires_in)) {
    throw new LinkedInAdsConnectionError("Réponse OAuth LinkedIn Ads invalide.", "provider_invalid_response", 502,
      oauthDiagnostic(operation, response.status, payload, "malformed_response"));
  }
  return payload as LinkedInAdsToken;
}

export async function exchangeLinkedInAdsCode(code: string, redirectUri: string): Promise<LinkedInAdsToken> {
  return tokenRequest(new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }));
}

async function refreshLinkedInAdsToken(refreshToken: string): Promise<LinkedInAdsToken> {
  return tokenRequest(new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }));
}

/** LinkedIn's code exchange may omit `scope`; verify the actual 3-legged token.
 * Only a fresh code exchange may recheck an inactive token within a ten-second window.
 * This bounded verification handles observed timing, without assuming activation or retrying the exchange.
 */
async function verifiedLinkedInAdsScopes(accessToken: string, allowInactiveRechecks = false): Promise<{
  scopes: string[]; attempts: 1 | 2 | 3 | 4;
}> {
  const { clientId, clientSecret, configured } = getLinkedInAdsCredentials();
  if (!configured) throw new LinkedInAdsConnectionError("Configuration LinkedIn Ads incomplète.", "configuration_missing");
  const operation = "token_introspection";
  const delays = [250, 750, 1500] as const;
  const deadline = allowInactiveRechecks ? Date.now() + 10000 : null;
  for (const attempts of [1, 2, 3, 4] as const) {
    const remaining = deadline === null ? 15000 : deadline - Date.now();
    if (remaining <= 0) {
      throw new LinkedInAdsConnectionError("Vérification LinkedIn Ads momentanément indisponible.", "provider_unavailable", 503,
        oauthDiagnostic(operation, null, undefined, "timeout", attempts === 1 ? 1 : attempts - 1 as 1 | 2 | 3));
    }
    let response: Response;
    let payload: Record<string, unknown>;
    try {
      response = await oauthResponse(operation, "https://www.linkedin.com/oauth/v2/introspectToken",
        new URLSearchParams({ client_id: clientId, client_secret: clientSecret, token: accessToken }), remaining);
      payload = await oauthPayload(response, operation);
    } catch (error) {
      if (attempts > 1 && error instanceof LinkedInAdsConnectionError && error.oauthDiagnostic) {
        throw new LinkedInAdsConnectionError(error.message, error.code, error.status, { ...error.oauthDiagnostic, attempts });
      }
      throw error;
    }
    if (deadline !== null && Date.now() >= deadline) {
      throw new LinkedInAdsConnectionError("Vérification LinkedIn Ads momentanément indisponible.", "provider_unavailable", 503,
        oauthDiagnostic(operation, response.status, undefined, "timeout", attempts));
    }
    if (response.status === 429 || response.status >= 500) {
      throw new LinkedInAdsConnectionError("Vérification LinkedIn Ads momentanément indisponible.", "provider_unavailable", 503,
        oauthDiagnostic(operation, response.status, payload, null, attempts));
    }
    if (!response.ok) {
      throw new LinkedInAdsConnectionError("Jeton LinkedIn Ads non vérifié.", "authorization_invalid", 401,
        oauthDiagnostic(operation, response.status, payload, null, attempts));
    }
    if (typeof payload.active !== "boolean") {
      throw new LinkedInAdsConnectionError("Réponse de vérification LinkedIn Ads invalide.", "provider_invalid_response", 502,
        oauthDiagnostic(operation, response.status, payload, "malformed_response", attempts));
    }
    if ((payload.client_id && payload.client_id !== clientId) || (payload.auth_type && payload.auth_type !== "3L")) {
      const verification = payload.client_id && payload.client_id !== clientId ? "client_mismatch" : "auth_type_mismatch";
      throw new LinkedInAdsConnectionError("Jeton LinkedIn Ads non vérifié.", "authorization_invalid", 401,
        oauthDiagnostic(operation, response.status, payload, verification, attempts));
    }
    if (payload.active !== true) {
      const status = typeof payload.status === "string" ? payload.status.toLowerCase() : "";
      const delay = delays[attempts - 1];
      if (!allowInactiveRechecks || delay === undefined || status === "revoked" || status === "expired"
        || deadline === null || Date.now() + delay >= deadline) {
        throw new LinkedInAdsConnectionError("Jeton LinkedIn Ads non vérifié.", "authorization_invalid", 401,
          oauthDiagnostic(operation, response.status, payload, "inactive", attempts));
      }
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      continue;
    }
    const scopes = linkedInAdsScopes(payload.scope);
    if (!scopes.length) throw new LinkedInAdsConnectionError("Scopes LinkedIn Ads non vérifiables.", "scope_verification_failed", 403,
      oauthDiagnostic(operation, response.status, payload, "missing_scopes", attempts));
    return { scopes, attempts };
  }
  throw new LinkedInAdsConnectionError("Jeton LinkedIn Ads non vérifié.", "authorization_invalid", 401);
}

export async function readLinkedInAdsIntegration(userId: string): Promise<LinkedInAdsIntegration | null> {
  const { data, error } = await supabaseAdmin.from("integrations")
    .select("id,status,scopes,access_token_enc,refresh_token_enc,expires_at,provider_account_id,resource_id,resource_label,meta")
    .eq("user_id", userId)
    .eq("provider", LINKEDIN_ADS_PROVIDER)
    .eq("source", LINKEDIN_ADS_SOURCE)
    .eq("product", LINKEDIN_ADS_PRODUCT)
    .maybeSingle();
  if (error) throw new LinkedInAdsConnectionError("Connexion LinkedIn Ads indisponible.", "storage_unavailable");
  return data as LinkedInAdsIntegration | null;
}

async function markNeedsReconnect(userId: string, integrationId: string): Promise<void> {
  await supabaseAdmin.from("integrations")
    .update({ status: "needs_update", updated_at: new Date().toISOString() })
    .eq("id", integrationId).eq("user_id", userId);
}

async function linkedInAdsJson(accessToken: string, path: string): Promise<Record<string, unknown>> {
  const response = await fetch(`https://api.linkedin.com/rest/${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Linkedin-Version": linkedInAdsVersion(),
      "X-Restli-Protocol-Version": "2.0.0",
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const denied = response.status === 403;
    throw Object.assign(new LinkedInAdsConnectionError(
      response.status === 401 ? "Reconnectez LinkedIn Ads." : denied
        ? "LinkedIn n’autorise pas cet accès Ads. Vérifiez le produit Marketing API, le scope et votre rôle sur le compte."
        : "LinkedIn Ads est momentanément indisponible.",
      response.status === 401 ? "needs_reconnect" : denied ? "ads_access_denied" : "provider_unavailable",
      response.status === 401 ? 409 : denied ? 403 : 503,
    ), { providerStatus: response.status });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new LinkedInAdsConnectionError("Réponse LinkedIn Ads invalide.", "provider_invalid_response");
  }
  return payload as Record<string, unknown>;
}

/** GET-only role discovery; never uses the member-admin mutation endpoints. */
export async function listLinkedInAdsAccountUsers(accessToken: string): Promise<LinkedInAdsAccountUser[]> {
  const users = new Map<string, LinkedInAdsAccountUser>();
  for (let start = 0; start < 200; start += 100) {
    const params = new URLSearchParams({ q: "authenticatedUser", start: String(start), count: "100" });
    const payload = await linkedInAdsJson(accessToken, `adAccountUsers?${params.toString()}`);
    if (!Array.isArray(payload.elements)) throw new LinkedInAdsConnectionError("Liste des comptes LinkedIn Ads invalide.", "provider_invalid_response");
    for (const row of payload.elements) {
      const user = normalizeLinkedInAdsAccountUser(row);
      if (!user) throw new LinkedInAdsConnectionError("Rôle de compte LinkedIn Ads invalide.", "provider_invalid_response");
      users.set(user.id, user);
    }
    const paging = asRecord(payload.paging);
    const total = typeof paging.total === "number" ? paging.total : null;
    if (total !== null && total > 200) throw new LinkedInAdsConnectionError("Trop de comptes LinkedIn Ads pour cette connexion.", "account_limit");
    if (total !== null && start + payload.elements.length >= total) return [...users.values()];
    if (payload.elements.length < 100 && total === null) return [...users.values()];
    if (payload.elements.length < 100) throw new LinkedInAdsConnectionError("Pagination LinkedIn Ads incomplète.", "provider_invalid_response");
    if (total === null) throw new LinkedInAdsConnectionError("Pagination LinkedIn Ads incomplète.", "provider_invalid_response");
  }
  return [...users.values()];
}

export async function saveLinkedInAdsConnection(userId: string, token: LinkedInAdsToken, requestedMode: LinkedInAdsAccessMode): Promise<void> {
  if (!token.access_token || !positiveSeconds(token.expires_in)) {
    throw new LinkedInAdsConnectionError("Jeton LinkedIn Ads invalide.", "authorization_invalid", 401);
  }
  const { scopes, attempts } = await verifiedLinkedInAdsScopes(token.access_token, true);
  if (!linkedInAdsHasAccessMode(scopes.join(" "), requestedMode)) {
    throw new LinkedInAdsConnectionError("Autorisation LinkedIn Ads requise non accordée.", "missing_scopes", 403,
      oauthDiagnostic("token_introspection", 200, undefined, "missing_scopes", attempts));
  }
  if (attempts > 1) console.info("[linkedin-ads-oauth-verification]", { attempts, result: "active" });
  // Also verifies that Marketing API access is actually approved for this OAuth app.
  const memberships = await listLinkedInAdsAccountUsers(token.access_token);
  const memberUrn = memberships[0]?.memberUrn || null;
  if (memberships.some((membership) => membership.memberUrn !== memberUrn)) {
    throw new LinkedInAdsConnectionError("Identité LinkedIn Ads incohérente.", "provider_invalid_response");
  }
  const existing = await readLinkedInAdsIntegration(userId);
  const sameMember = Boolean(memberUrn && memberUrn === existing?.provider_account_id);
  const retainAccount = linkedInAdsCanRetainAccount(existing?.resource_id, sameMember, memberships);
  const refreshTokenEnc = token.refresh_token ? encryptToken(token.refresh_token)
    : sameMember ? existing?.refresh_token_enc || null : null;
  const previousMeta = sameMember ? asRecord(existing?.meta) : {};
  const refreshExpiry = expiryFromSeconds(token.refresh_token_expires_in)
    || (sameMember && typeof previousMeta.refresh_expires_at === "string" ? previousMeta.refresh_expires_at : null);
  const payload = {
    user_id: userId,
    provider: LINKEDIN_ADS_PROVIDER,
    category: "social",
    source: LINKEDIN_ADS_SOURCE,
    product: LINKEDIN_ADS_PRODUCT,
    status: "connected",
    display_name: "Compte LinkedIn Ads",
    provider_account_id: memberUrn,
    scopes: scopes.join(" "),
    access_token_enc: encryptToken(token.access_token),
    refresh_token_enc: refreshTokenEnc,
    expires_at: expiryFromSeconds(token.expires_in),
    resource_id: retainAccount ? existing?.resource_id || null : null,
    resource_label: retainAccount ? existing?.resource_label || null : null,
    meta: {
      ...previousMeta,
      product: "inr_ads",
      provider: "linkedin",
      oauth_mode: requestedMode,
      refresh_expires_at: refreshExpiry,
      account_roles: Object.fromEntries(memberships.map((membership) => [membership.id, membership.role])),
      selected_account_role: retainAccount ? memberships.find((membership) => membership.id === existing?.resource_id)?.role || null : null,
      // Account status and role must be verified again after every authorization.
      selected_account_can_manage: false,
      selected_account_can_serve: false,
    },
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabaseAdmin.from("integrations")
    .upsert(payload, { onConflict: "user_id,provider,source,product" });
  if (error) throw new LinkedInAdsConnectionError("Impossible de sauvegarder la connexion LinkedIn Ads.", "storage_unavailable");
}

export async function linkedInAdsAuthorization(userId: string, row?: LinkedInAdsIntegration | null): Promise<{ token: string; scopes: string }> {
  const integration = row === undefined ? await readLinkedInAdsIntegration(userId) : row;
  if (!integration || integration.status !== "connected") {
    throw new LinkedInAdsConnectionError("Connectez LinkedIn Ads.", "not_connected", 409);
  }
  if (!linkedInAdsHasReadAccess(integration.scopes)) {
    throw new LinkedInAdsConnectionError("Autorisation LinkedIn Ads manquante.", "missing_scopes", 403);
  }
  if (!isExpiring(integration.expires_at)) {
    try {
      if (integration.access_token_enc) return { token: decryptToken(integration.access_token_enc), scopes: integration.scopes || "" };
    } catch { /* Expired/invalid credentials follow the explicit reconnect path. */ }
  }
  const refreshExpiry = asRecord(integration.meta).refresh_expires_at;
  if (!integration.refresh_token_enc || isExpiring(refreshExpiry, 0)) {
    await markNeedsReconnect(userId, integration.id);
    throw new LinkedInAdsConnectionError("Reconnectez LinkedIn Ads : l’autorisation a expiré.", "needs_reconnect", 409);
  }
  let refreshToken: string;
  try { refreshToken = decryptToken(integration.refresh_token_enc); }
  catch {
    await markNeedsReconnect(userId, integration.id);
    throw new LinkedInAdsConnectionError("Reconnectez LinkedIn Ads.", "needs_reconnect", 409);
  }
  let refreshed: LinkedInAdsToken;
  try { refreshed = await refreshLinkedInAdsToken(refreshToken); }
  catch (error) {
    if (error instanceof LinkedInAdsConnectionError && error.code === "authorization_invalid") {
      await markNeedsReconnect(userId, integration.id);
    }
    throw error;
  }
  const scopes = (await verifiedLinkedInAdsScopes(refreshed.access_token!)).scopes.join(" ");
  if (!linkedInAdsHasReadAccess(scopes)) {
    await markNeedsReconnect(userId, integration.id);
    throw new LinkedInAdsConnectionError("Les autorisations LinkedIn Ads ont changé.", "missing_scopes", 403);
  }
  const previousMeta = asRecord(integration.meta);
  const { error } = await supabaseAdmin.from("integrations").update({
    access_token_enc: encryptToken(refreshed.access_token!),
    refresh_token_enc: encryptToken(refreshed.refresh_token || refreshToken),
    expires_at: expiryFromSeconds(refreshed.expires_in),
    scopes,
    meta: {
      ...previousMeta,
      refresh_expires_at: expiryFromSeconds(refreshed.refresh_token_expires_in) || previousMeta.refresh_expires_at || null,
      // Refresh does not prove the account is still active or that its role is unchanged.
      selected_account_can_manage: false,
      selected_account_can_serve: false,
    },
    updated_at: new Date().toISOString(),
  }).eq("id", integration.id).eq("user_id", userId);
  if (error) throw new LinkedInAdsConnectionError("Renouvellement LinkedIn Ads non enregistré.", "storage_unavailable");
  return { token: refreshed.access_token!, scopes };
}

/** Read-only account details plus the authenticated member's precise role. */
export async function listLinkedInAdsAccounts(userId: string, row?: LinkedInAdsIntegration | null): Promise<LinkedInAdsAccount[]> {
  const integration = row === undefined ? await readLinkedInAdsIntegration(userId) : row;
  const { token, scopes } = await linkedInAdsAuthorization(userId, integration);
  try {
    const memberships = await listLinkedInAdsAccountUsers(token);
    const accounts: LinkedInAdsAccount[] = [];
    for (let start = 0; start < memberships.length; start += 8) {
      const batch = memberships.slice(start, start + 8);
      const details = await Promise.all(batch.map((member) => linkedInAdsJson(token, `adAccounts/${member.id}`)));
      for (let index = 0; index < batch.length; index += 1) {
        const account = normalizeLinkedInAdsAccount(details[index], batch[index], scopes);
        if (!account) throw new LinkedInAdsConnectionError("Détails du compte LinkedIn Ads incohérents.", "provider_invalid_response");
        accounts.push(account);
      }
    }
    return accounts;
  } catch (error) {
    if (error instanceof LinkedInAdsConnectionError && error.code === "needs_reconnect" && integration) {
      await markNeedsReconnect(userId, integration.id);
    }
    throw error;
  }
}

export async function selectLinkedInAdsAccount(userId: string, accountId: string): Promise<LinkedInAdsAccount> {
  const integration = await readLinkedInAdsIntegration(userId);
  const accounts = await listLinkedInAdsAccounts(userId, integration);
  const selected = accounts.find((account) => account.id === accountId);
  if (!selected) throw new LinkedInAdsConnectionError("Compte LinkedIn Ads inaccessible.", "account_access_denied", 403);
  const previousMeta = asRecord(integration?.meta);
  const { data, error } = await supabaseAdmin.from("integrations").update({
    resource_id: selected.id,
    resource_label: selected.name,
    meta: {
      ...previousMeta,
      selected_account_role: selected.permissions[0],
      selected_account_can_manage: selected.canManageCampaigns,
      selected_account_can_serve: selected.canServeCampaigns,
      selected_account_verified_at: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
  }).eq("id", integration!.id).eq("user_id", userId).eq("status", "connected").select("id").maybeSingle();
  if (error) throw new LinkedInAdsConnectionError("Sélection LinkedIn Ads non enregistrée.", "storage_unavailable");
  if (!data) throw new LinkedInAdsConnectionError("La connexion LinkedIn Ads a changé ; rechargez les comptes.", "connection_changed", 409);
  return selected;
}

/** GET-only native discovery; fixed origin and endpoints never come from a browser URL. */
export async function readLinkedInAdsResourceJson(accessToken: string, path: string): Promise<Record<string, unknown>> {
  if (!/^\/rest\/(?:adTargetingEntities|conversions)(?:\?|$)/.test(path)
    || path.includes("#") || path.includes("\\") || path.length > 30_000) {
    throw new TypeError("Invalid LinkedIn Ads resource path");
  }
  return linkedInAdsJson(accessToken, path.slice("/rest/".length));
}
