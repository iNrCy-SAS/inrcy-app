/** X Ads account policy. This module never authorizes a paid-ad mutation. */
export type XAdsAccount = {
  id: string;
  name: string;
  approvalStatus: string | null;
  deleted: boolean;
  currency: string | null;
  permissions: string[];
  canManageCampaigns: boolean | null;
  billingReady: boolean | null;
  eligibleToAssociate: boolean;
};

export type XAdsReadiness =
  | "disconnected"
  | "needs_reconnect"
  | "no_ad_account"
  | "account_selection_required"
  | "account_verification_required"
  | "ineligible_ad_account"
  | "eur_account_required"
  | "insufficient_permissions"
  | "billing_verification_required"
  | "ready_for_review";

/** Keep the Ads OAuth credentials on their dedicated callback, never the organic X integration. */
export function isXAdsCallbackUri(value: string): boolean {
  try {
    const url = new URL(value);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    return (url.protocol === "https:" || (local && url.protocol === "http:"))
      && url.pathname === "/api/ads/x/callback"
      && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function normalizeXAdsAccount(value: unknown): XAdsAccount | null {
  const raw = asRecord(value);
  const id = stringValue(raw.id);
  if (!id || !/^[a-z0-9]+$/i.test(id)) return null;
  const approvalStatus = stringValue(raw.approval_status)?.toUpperCase() || null;
  return {
    id,
    name: stringValue(raw.name) || `Compte ${id}`,
    approvalStatus,
    deleted: raw.deleted === true,
    currency: null,
    permissions: [],
    canManageCampaigns: null,
    billingReady: null,
    eligibleToAssociate: false,
  };
}

/** Account currency comes from active funding instruments, not GET /accounts. */
export function verifyXAdsAccount(
  account: XAdsAccount,
  accessResponse: unknown,
  fundingResponse: unknown,
): XAdsAccount {
  const access = asRecord(accessResponse);
  const permissions = Array.isArray(access.permissions)
    ? access.permissions.filter((value): value is string => typeof value === "string").map((value) => value.toUpperCase())
    : [];
  const canManageCampaigns = permissions.length
    ? permissions.some((permission) => permission === "ACCOUNT_ADMIN" || permission === "AD_MANAGER")
    : null;
  const instruments = Array.isArray(fundingResponse) ? fundingResponse.map(asRecord) : [];
  const active = instruments.filter((instrument) => instrument.deleted !== true && instrument.cancelled !== true);
  const currencies = [...new Set(active.map((instrument) => stringValue(instrument.currency)?.toUpperCase()).filter((value): value is string => Boolean(value)))];
  const currency = currencies.length === 1 ? currencies[0] : null;
  const billingStatuses = active.filter((instrument) => instrument.able_to_fund === true || instrument.able_to_fund === false);
  const billingReady = billingStatuses.some((instrument) => instrument.able_to_fund === true)
    ? true
    : billingStatuses.length ? false : null;
  return {
    ...account,
    currency,
    permissions,
    canManageCampaigns,
    billingReady,
    eligibleToAssociate: account.approvalStatus === "ACCEPTED"
      && !account.deleted
      && currency === "EUR"
      && canManageCampaigns === true,
  };
}

export function xAdsReadiness(input: {
  connected: boolean;
  needsReconnect?: boolean;
  accounts?: XAdsAccount[];
  selectedAccountId?: string | null;
}): XAdsReadiness {
  if (input.needsReconnect) return "needs_reconnect";
  if (!input.connected) return "disconnected";
  const accounts = input.accounts || [];
  if (!accounts.length) return "no_ad_account";
  if (!input.selectedAccountId) return "account_selection_required";
  const selected = accounts.find((account) => account.id === input.selectedAccountId);
  if (!selected) return "account_verification_required";
  if (selected.deleted || selected.approvalStatus !== "ACCEPTED") return "ineligible_ad_account";
  if (selected.currency !== "EUR") return "eur_account_required";
  if (selected.canManageCampaigns === null) return "account_verification_required";
  if (!selected.canManageCampaigns) return "insufficient_permissions";
  if (selected.billingReady !== true) return "billing_verification_required";
  return "ready_for_review";
}
