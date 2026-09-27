/** Read-only policy for LinkedIn Marketing API account discovery. */
export const LINKEDIN_ADS_API_VERSION = "202609";
export const LINKEDIN_ADS_READ_SCOPE = "r_ads";
export const LINKEDIN_ADS_MANAGE_SCOPE = "rw_ads";

export type LinkedInAdsAccessMode = "read" | "manage";
export type LinkedInAdsRole =
  | "VIEWER"
  | "CREATIVE_MANAGER"
  | "CAMPAIGN_MANAGER"
  | "ACCOUNT_MANAGER"
  | "ACCOUNT_BILLING_ADMIN";

export type LinkedInAdsAccountUser = { id: string; role: LinkedInAdsRole; memberUrn: string };
export type LinkedInAdsAccount = {
  id: string;
  name: string;
  currency: string;
  country: string;
  status: string;
  type: string;
  permissions: LinkedInAdsRole[];
  canManageCampaigns: boolean;
};

const MANAGE_ROLES = new Set<LinkedInAdsRole>(["CAMPAIGN_MANAGER", "ACCOUNT_MANAGER", "ACCOUNT_BILLING_ADMIN"]);
const ALL_ROLES = new Set<LinkedInAdsRole>(["VIEWER", "CREATIVE_MANAGER", ...MANAGE_ROLES]);

export function linkedInAdsScopes(value: unknown): string[] {
  return typeof value === "string" ? [...new Set(value.split(/[\s,]+/).map((scope) => scope.trim()).filter(Boolean))] : [];
}

export function linkedInAdsHasReadAccess(value: unknown): boolean {
  const scopes = linkedInAdsScopes(value);
  return scopes.includes(LINKEDIN_ADS_READ_SCOPE) || scopes.includes(LINKEDIN_ADS_MANAGE_SCOPE);
}

export function linkedInAdsScopeForMode(mode: LinkedInAdsAccessMode): string {
  return mode === "manage" ? LINKEDIN_ADS_MANAGE_SCOPE : LINKEDIN_ADS_READ_SCOPE;
}

export function buildLinkedInAdsAuthorizationUrl(clientId: string, redirectUri: string, state: string, mode: LinkedInAdsAccessMode): string {
  const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: linkedInAdsScopeForMode(mode),
  }).toString();
  return url.toString();
}

export function isLinkedInAdsAccountId(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,25}$/.test(value);
}

export function normalizeLinkedInAdsAccountUser(value: unknown): LinkedInAdsAccountUser | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const match = typeof row.account === "string" ? /^urn:li:sponsoredAccount:(\d{1,25})$/.exec(row.account) : null;
  const role = typeof row.role === "string" ? row.role as LinkedInAdsRole : null;
  const memberUrn = typeof row.user === "string" && /^urn:li:person:[A-Za-z0-9_-]+$/.test(row.user) ? row.user : "";
  return match && role && ALL_ROLES.has(role) && memberUrn ? { id: match[1], role, memberUrn } : null;
}

export function linkedInAdsCanManageCampaigns(role: LinkedInAdsRole, scopes: unknown, accountStatus: string, accountType: string): boolean {
  return MANAGE_ROLES.has(role)
    && linkedInAdsScopes(scopes).includes(LINKEDIN_ADS_MANAGE_SCOPE)
    && accountStatus === "ACTIVE"
    && (accountType === "BUSINESS" || accountType === "ENTERPRISE");
}

/** A prior account choice survives OAuth only for the same member and a still-authorized account. */
export function linkedInAdsCanRetainAccount(
  accountId: string | null | undefined,
  sameMember: boolean,
  memberships: LinkedInAdsAccountUser[],
): boolean {
  return Boolean(sameMember && accountId && memberships.some((membership) => membership.id === accountId));
}

export function linkedInAdsAccessTokenIsFresh(expiresAt: unknown, now = Date.now()): boolean {
  const timestamp = typeof expiresAt === "string" ? Date.parse(expiresAt) : NaN;
  return Number.isFinite(timestamp) && timestamp > now + 120_000;
}

export function normalizeLinkedInAdsAccount(value: unknown, membership: LinkedInAdsAccountUser, scopes: unknown): LinkedInAdsAccount | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = String(row.id ?? "");
  if (id !== membership.id || !isLinkedInAdsAccountId(id)) return null;
  const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : `Compte ${id}`;
  const currency = typeof row.currency === "string" ? row.currency : "";
  const country = typeof row.country === "string" ? row.country : "";
  const status = typeof row.status === "string" ? row.status : "";
  const type = typeof row.type === "string" ? row.type : "";
  return {
    id, name, currency, country, status, type,
    permissions: [membership.role],
    canManageCampaigns: linkedInAdsCanManageCampaigns(membership.role, scopes, status, type),
  };
}
