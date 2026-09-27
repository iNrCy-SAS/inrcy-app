/** Pinterest Ads connection policy. No campaign mutation is exposed by this module. */
export const PINTEREST_ADS_SCOPES = ["ads:read", "ads:write"] as const;

export type PinterestAdsAccount = {
  id: string;
  name: string;
  currency: string | null;
  country: string | null;
  permissions: string[];
  canManageCampaigns: boolean | null;
  /** Account choice is allowed while a missing role remains explicitly unverified. */
  eligibleToAssociate: boolean;
};

export type PinterestAdsReadiness =
  | "disconnected"
  | "needs_reconnect"
  | "missing_scopes"
  | "no_ad_account"
  | "account_selection_required"
  | "insufficient_account_permissions"
  | "permission_verification_required"
  | "ready_for_review";

export function parsePinterestAdsScopes(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(parsePinterestAdsScopes);
  if (typeof value !== "string") return [];
  return [...new Set(value.split(/[\s,]+/).map((scope) => scope.trim()).filter(Boolean))];
}

export function missingPinterestAdsScopes(value: unknown): string[] {
  const granted = new Set(parsePinterestAdsScopes(value));
  return PINTEREST_ADS_SCOPES.filter((scope) => !granted.has(scope));
}

export function buildPinterestAdsAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: PINTEREST_ADS_SCOPES.join(","),
    state,
  });
  return `https://www.pinterest.com/oauth/?${params.toString()}`;
}

export function isPinterestAdsCallbackUri(value: string): boolean {
  try {
    const url = new URL(value);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    return (url.protocol === "https:" || (local && url.protocol === "http:"))
      && url.pathname === "/api/ads/pinterest/callback"
      && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Pinterest returns account-level roles. An absent role is unknown, never proof of write access. */
export function normalizePinterestAdsAccount(value: unknown): PinterestAdsAccount | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const id = cleanString(item.id);
  if (!id || !/^\d+$/.test(id)) return null;
  const permissions = Array.isArray(item.permissions)
    ? item.permissions.filter((role): role is string => typeof role === "string").map((role) => role.toUpperCase())
    : [];
  const writeRoles = new Set(["OWNER", "ADMIN", "CAMPAIGN", "CAMPAIGN_MANAGER"]);
  const canManageCampaigns = permissions.length
    ? permissions.some((role) => writeRoles.has(role))
    : null;
  return {
    id,
    name: cleanString(item.name) || `Compte ${id}`,
    currency: cleanString(item.currency),
    country: cleanString(item.country),
    permissions,
    canManageCampaigns,
    eligibleToAssociate: canManageCampaigns !== false,
  };
}

export function pinterestAdsReadiness(input: {
  connected: boolean;
  needsReconnect?: boolean;
  scopes?: unknown;
  accounts?: PinterestAdsAccount[];
  selectedAccountId?: string | null;
}): PinterestAdsReadiness {
  if (input.needsReconnect) return "needs_reconnect";
  if (!input.connected) return "disconnected";
  if (missingPinterestAdsScopes(input.scopes).length) return "missing_scopes";
  const accounts = input.accounts || [];
  if (!accounts.length) return "no_ad_account";
  const selected = accounts.find((account) => account.id === input.selectedAccountId);
  if (!selected) return "account_selection_required";
  if (selected.canManageCampaigns === false) return "insufficient_account_permissions";
  if (selected.canManageCampaigns === null) return "permission_verification_required";
  return "ready_for_review";
}
