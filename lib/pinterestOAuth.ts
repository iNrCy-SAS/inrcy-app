import { asRecord, asString } from "@/lib/tsSafe";
import { encryptToken, tryDecryptToken } from "@/lib/oauthCrypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const PINTEREST_PROVIDER = "pinterest";
export const PINTEREST_SOURCE = "pinterest";
export const PINTEREST_PRODUCT = "pinterest";

export type PinterestBoard = {
  id: string;
  name: string;
  description?: string | null;
  url?: string | null;
  privacy?: string | null;
  pin_count?: number | null;
};

export type PinterestUserAccount = {
  id: string | null;
  username: string | null;
  displayName: string | null;
  profileUrl: string | null;
  avatarUrl: string | null;
  websiteUrl: string | null;
  accountType: string | null;
};

type PinterestTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number | string;
  refresh_token_expires_in?: number | string;
  scope?: string;
  token_type?: string;
  response_type?: string;
  error?: string;
  error_description?: string;
  message?: string;
};

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function trimSlash(value: string) {
  return value.replace(/\/+$/g, "");
}

export type PinterestApiEnvironment = "production";

export function getPinterestApiEnvironment(): PinterestApiEnvironment {
  return "production";
}

export function getPinterestApiBaseUrl() {
  return "https://api.pinterest.com";
}

export function getPinterestClientId() {
  return String(process.env.PINTEREST_CLIENT_ID || process.env.PINTEREST_APP_ID || "").trim();
}

export function getPinterestClientSecret() {
  return String(process.env.PINTEREST_CLIENT_SECRET || process.env.PINTEREST_APP_SECRET || "").trim();
}

export function getPinterestRedirectUri(requestUrl?: string) {
  const explicit = String(process.env.PINTEREST_REDIRECT_URI || "").trim();
  if (explicit) return explicit;
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "";
  const origin = configuredOrigin
    ? trimSlash(configuredOrigin)
    : requestUrl
      ? new URL(requestUrl).origin
      : "";
  return `${origin}/api/integrations/pinterest/callback`;
}

export function getPinterestOAuthScope() {
  return String(
    process.env.PINTEREST_OAUTH_SCOPES ||
      "user_accounts:read,boards:read,boards:write,pins:read,pins:write",
  ).trim();
}

export function buildPinterestProfileUrl(username: unknown) {
  const clean = asString(username)?.replace(/^@+/, "").replace(/^\/+|\/+$/g, "").trim();
  return clean ? `https://www.pinterest.fr/${encodeURIComponent(clean)}/` : null;
}

function pinterestBasicAuthHeader(clientId: string, clientSecret: string) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`;
}

async function pinterestPostForm(body: Record<string, string>): Promise<PinterestTokenResponse> {
  const clientId = getPinterestClientId();
  const clientSecret = getPinterestClientSecret();
  if (!clientId || !clientSecret) {
    throw new Error("Configuration Pinterest incomplète côté serveur.");
  }

  const res = await fetch(`${getPinterestApiBaseUrl()}/v5/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: pinterestBasicAuthHeader(clientId, clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
    cache: "no-store",
  });

  const json = (await res.json().catch(() => ({}))) as PinterestTokenResponse;
  if (!res.ok) {
    throw new Error(json.error_description || json.message || json.error || "Pinterest n'a pas accepté la connexion.");
  }
  return json;
}

export async function exchangePinterestAuthorizationCode(code: string, requestUrl?: string) {
  return pinterestPostForm({
    code,
    grant_type: "authorization_code",
    redirect_uri: getPinterestRedirectUri(requestUrl),
  });
}

export async function refreshPinterestAccessToken(refreshToken: string) {
  return pinterestPostForm({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

type PinterestApiMethod = "GET" | "POST" | "PATCH" | "DELETE";

async function pinterestApiRequest<T = any>(
  path: string,
  accessToken: string,
  options: { method?: PinterestApiMethod; body?: Record<string, unknown> } = {},
): Promise<T> {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const method = options.method || "GET";
  const hasBody = options.body && method !== "GET";
  const res = await fetch(`${getPinterestApiBaseUrl()}/v5${cleanPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
    },
    body: hasBody ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });

  const raw = await res.text().catch(() => "");
  let json: unknown = {};
  if (raw) {
    try {
      json = JSON.parse(raw);
    } catch {
      json = { message: raw };
    }
  }

  if (!res.ok) {
    const rec = asRecord(json);
    throw new Error(asString(rec.message) || asString(rec.error_description) || asString(rec.error) || "Appel Pinterest impossible.");
  }
  return json as T;
}

export async function pinterestApiGet<T = any>(path: string, accessToken: string): Promise<T> {
  return pinterestApiRequest<T>(path, accessToken);
}

export async function fetchPinterestUserAccount(accessToken: string): Promise<PinterestUserAccount> {
  const data = asRecord(await pinterestApiGet("/user_account", accessToken));
  const username = asString(data.username) || asString(data.user_name) || null;
  const displayName = asString(data.display_name) || asString(data.business_name) || username;
  const profileUrl = asString(data.profile_url) || asString(data.profileUrl) || buildPinterestProfileUrl(username);
  return {
    id: asString(data.id) || asString(data.account_id) || null,
    username,
    displayName,
    profileUrl,
    avatarUrl: asString(data.profile_image) || asString(data.profile_image_url) || asString(data.image_large_url) || null,
    websiteUrl: asString(data.website_url) || asString(data.website) || null,
    accountType: asString(data.account_type) || null,
  };
}

function normalizePinterestBoard(item: unknown): PinterestBoard | null {
  const board = asRecord(item);
  const id = asString(board.id) || "";
  if (!id) return null;
  return {
    id,
    name: asString(board.name) || "Tableau Pinterest",
    description: asString(board.description) || null,
    url: asString(board.url) || null,
    privacy: asString(board.privacy) || null,
    pin_count: numberOrNull(board.pin_count),
  };
}

export async function fetchPinterestBoards(accessToken: string): Promise<PinterestBoard[]> {
  const boards: PinterestBoard[] = [];
  let bookmark = "";

  for (let page = 0; page < 5; page += 1) {
    const params = new URLSearchParams({ page_size: "100" });
    if (bookmark) params.set("bookmark", bookmark);
    const data = asRecord(await pinterestApiGet(`/boards?${params.toString()}`, accessToken));
    const items = Array.isArray(data.items) ? data.items : [];
    for (const item of items) {
      const board = normalizePinterestBoard(item);
      if (board) boards.push(board);
    }
    bookmark = asString(data.bookmark) || "";
    if (!bookmark) break;
  }

  return boards;
}


export async function createPinterestBoard(accessToken: string, name: string): Promise<PinterestBoard> {
  const data = await pinterestApiRequest("/boards", accessToken, {
    method: "POST",
    body: { name },
  });
  const board = normalizePinterestBoard(data);
  if (!board) throw new Error("Pinterest n'a pas renvoyé le tableau créé.");
  return board;
}

export async function updatePinterestBoard(accessToken: string, boardId: string, name: string): Promise<PinterestBoard> {
  const data = await pinterestApiRequest(`/boards/${encodeURIComponent(boardId)}`, accessToken, {
    method: "PATCH",
    body: { name },
  });
  const board = normalizePinterestBoard(data);
  if (!board) throw new Error("Pinterest n'a pas renvoyé le tableau modifié.");
  return board;
}

export async function deletePinterestBoard(accessToken: string, boardId: string): Promise<void> {
  await pinterestApiRequest(`/boards/${encodeURIComponent(boardId)}`, accessToken, {
    method: "DELETE",
  });
}

export function buildPinterestTokenDates(token: PinterestTokenResponse) {
  const expiresIn = numberOrNull(token.expires_in);
  const refreshExpiresIn = numberOrNull(token.refresh_token_expires_in);
  return {
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
    refreshExpiresAt: refreshExpiresIn ? new Date(Date.now() + refreshExpiresIn * 1000).toISOString() : null,
  };
}

export async function getPinterestIntegration(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("integrations")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", PINTEREST_PROVIDER)
    .eq("source", PINTEREST_SOURCE)
    .eq("product", PINTEREST_PRODUCT)
    .maybeSingle();
  if (error) throw error;
  return asRecord(data);
}

function isExpired(expiresAt: unknown, skewSeconds = 120) {
  const iso = asString(expiresAt);
  if (!iso) return false;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return false;
  return time <= Date.now() + skewSeconds * 1000;
}

export async function getPinterestAccessToken(userId: string, _requestUrl?: string) {
  const row = await getPinterestIntegration(userId);
  const status = asString(row.status);
  if (status !== "connected" && status !== "account_connected") return "";

  const meta = asRecord(row.meta);
  const storedEnvironment = asString(meta.pinterest_api_environment) || "production";
  if (storedEnvironment !== getPinterestApiEnvironment()) return "";

  let accessToken = tryDecryptToken(asString(row.access_token_enc) || "") || "";
  const refreshToken = tryDecryptToken(asString(row.refresh_token_enc) || "") || "";
  if (accessToken && !isExpired(row.expires_at)) return accessToken;
  if (!refreshToken) return "";
  if (isExpired(meta.refresh_expires_at)) return "";

  const refreshed = await refreshPinterestAccessToken(refreshToken);
  const nextAccessToken = asString(refreshed.access_token) || "";
  if (!nextAccessToken) return "";
  const nextRefreshToken = asString(refreshed.refresh_token) || refreshToken;
  const dates = buildPinterestTokenDates(refreshed);
  const refreshedMeta = { ...asRecord(row.meta) };
  for (const key of [
    "account_id",
    "username",
    "display_name",
    "profile_url",
    "avatar_url",
    "website_url",
    "account_type",
    "boards",
    "default_board_id",
    "default_board_name",
  ]) {
    delete refreshedMeta[key];
  }
  refreshedMeta.pinterest_token_refreshed_at = new Date().toISOString();
  refreshedMeta.pinterest_api_environment = getPinterestApiEnvironment();
  if (dates.refreshExpiresAt) {
    refreshedMeta.refresh_expires_at = dates.refreshExpiresAt;
  }

  await supabaseAdmin
    .from("integrations")
    .update({
      access_token_enc: encryptToken(nextAccessToken),
      refresh_token_enc: nextRefreshToken ? encryptToken(nextRefreshToken) : row.refresh_token_enc || null,
      expires_at: dates.expiresAt || row.expires_at || null,
      scopes: asString(refreshed.scope) || asString(row.scopes) || getPinterestOAuthScope(),
      meta: refreshedMeta,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("provider", PINTEREST_PROVIDER)
    .eq("source", PINTEREST_SOURCE)
    .eq("product", PINTEREST_PRODUCT);

  accessToken = nextAccessToken;
  return accessToken;
}
