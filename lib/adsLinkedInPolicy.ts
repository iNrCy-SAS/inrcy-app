/** Dedicated LinkedIn Ads OAuth policy; never reuse the organic connector. */
export const LINKEDIN_ADS_API_VERSION = "202609";
export const LINKEDIN_ADS_READ_SCOPE = "r_ads";
export const LINKEDIN_ADS_MANAGE_SCOPE = "rw_ads";
export const LINKEDIN_ADS_MANAGE_SCOPES = [
  "rw_ads",
  "r_ads_reporting",
  "r_organization_admin",
  "w_organization_social",
] as const;

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
  productType: string;
  servingStatuses: string[];
  test: boolean;
  permissions: LinkedInAdsRole[];
  canManageCampaigns: boolean;
  canServeCampaigns: boolean;
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
  return mode === "manage" ? LINKEDIN_ADS_MANAGE_SCOPES.join(" ") : LINKEDIN_ADS_READ_SCOPE;
}

export function missingLinkedInAdsScopes(value: unknown, mode: LinkedInAdsAccessMode): string[] {
  const scopes = linkedInAdsScopes(value);
  const required = mode === "manage" ? LINKEDIN_ADS_MANAGE_SCOPES : [LINKEDIN_ADS_READ_SCOPE];
  return required.filter((scope) => !scopes.includes(scope));
}

export function linkedInAdsHasAccessMode(value: unknown, mode: LinkedInAdsAccessMode): boolean {
  const scopes = linkedInAdsScopes(value);
  return mode === "manage"
    ? missingLinkedInAdsScopes(scopes.join(" "), "manage").length === 0
    : linkedInAdsHasReadAccess(scopes.join(" "));
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

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * Resolves the Ads callback from the dedicated setting first, then the public
 * app origin. The result is deliberately stricter than a generic OAuth URL:
 * LinkedIn requires an exact redirect URI match and the Ads callback must not
 * drift to the organic LinkedIn route or to another origin.
 */
export function resolveLinkedInAdsRedirectUri(input: {
  explicit?: unknown;
  appUrl?: unknown;
  siteUrl?: unknown;
  requestUrl: string;
}): string {
  const request = new URL(input.requestUrl);
  const configuredApp = String(input.appUrl || "").trim();
  const configuredSite = String(input.siteUrl || "").trim();
  const canonical = new URL(configuredApp || configuredSite || request.origin);
  const explicit = String(input.explicit || "").trim();
  const redirect = explicit
    ? new URL(explicit)
    : new URL("/api/ads/linkedin/callback", canonical.origin);

  if (redirect.pathname !== "/api/ads/linkedin/callback"
    || redirect.search || redirect.hash || redirect.username || redirect.password) {
    throw new TypeError("Invalid LinkedIn Ads redirect URI");
  }
  const local = isLoopbackHostname(redirect.hostname);
  if ((!local && redirect.protocol !== "https:")
    || (local && redirect.protocol !== "http:" && redirect.protocol !== "https:")) {
    throw new TypeError("Invalid LinkedIn Ads redirect protocol");
  }
  if ((configuredApp || configuredSite) && redirect.origin !== canonical.origin) {
    throw new TypeError("LinkedIn Ads redirect origin mismatch");
  }
  return redirect.toString();
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

export function linkedInAdsCanManageCampaigns(
  role: LinkedInAdsRole,
  scopes: unknown,
  accountStatus: string,
  accountType: string,
  productType = "",
): boolean {
  // Since API version 202608, Enterprise accounts can identify the LinkedIn
  // product they belong to. Fail closed for Talent Solutions / LinkedIn-on-
  // LinkedIn accounts: they are not Marketing Solutions advertiser accounts.
  const marketingAccount = accountType === "BUSINESS"
    || (accountType === "ENTERPRISE" && productType === "MARKETING_SOLUTIONS");
  return MANAGE_ROLES.has(role)
    && linkedInAdsScopes(scopes).includes(LINKEDIN_ADS_MANAGE_SCOPE)
    && accountStatus === "ACTIVE"
    && marketingAccount;
}

export function linkedInAdsCanServeCampaigns(
  canManageCampaigns: boolean,
  servingStatuses: unknown,
  test: boolean,
): boolean {
  if (!canManageCampaigns || test || !Array.isArray(servingStatuses)) return false;
  const statuses = servingStatuses.filter((status): status is string => typeof status === "string");
  return statuses.length === 1 && statuses[0] === "RUNNABLE";
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
  const productType = typeof row.productType === "string" ? row.productType : "";
  const servingStatuses = Array.isArray(row.servingStatuses)
    ? row.servingStatuses.filter((item): item is string => typeof item === "string")
    : [];
  const test = row.test === true;
  const canManageCampaigns = linkedInAdsCanManageCampaigns(membership.role, scopes, status, type, productType);
  return {
    id, name, currency, country, status, type, productType, servingStatuses, test,
    permissions: [membership.role],
    canManageCampaigns,
    canServeCampaigns: linkedInAdsCanServeCampaigns(canManageCampaigns, servingStatuses, test),
  };
}
