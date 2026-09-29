import { isLinkedInAdsAccountId, linkedInAdsScopes, LINKEDIN_ADS_API_VERSION } from "./adsLinkedInPolicy.ts";

export type LinkedInAdsCampaignStatus =
  | "ACTIVE" | "PAUSED" | "ARCHIVED" | "COMPLETED" | "CANCELED"
  | "DRAFT" | "PENDING_DELETION" | "REMOVED";

export type LinkedInAdsCampaignOperationEvidence = {
  fetchedAtMs: number;
  selectedAccountId: string;
  accountCurrency: string;
  scopes: string;
  hasAccountAccess: boolean;
  canManageCampaigns: boolean;
  campaign: {
    urn: string;
    account: string;
    status: LinkedInAdsCampaignStatus;
  };
};

type PartialUpdateRequest = {
  method: "POST";
  path: string;
  headers: ReturnType<typeof mutationHeaders>;
  body: { patch: { $set: Record<string, unknown> } };
};

type DeleteRequest = {
  method: "DELETE";
  path: string;
  headers: Omit<ReturnType<typeof mutationHeaders>, "X-RestLi-Method" | "Content-Type">;
};

const CAMPAIGN_URN = /^urn:li:sponsoredCampaign:(\d{1,25})$/;
const MAX_EVIDENCE_AGE_MS = 5 * 60_000;
const NON_MUTABLE_CAMPAIGN_STATUSES = new Set<LinkedInAdsCampaignStatus>([
  "COMPLETED", "CANCELED", "PENDING_DELETION", "REMOVED",
]);

function mutationHeaders() {
  return {
    "Linkedin-Version": LINKEDIN_ADS_API_VERSION,
    "X-Restli-Protocol-Version": "2.0.0" as const,
    "X-RestLi-Method": "PARTIAL_UPDATE" as const,
    "Content-Type": "application/json" as const,
  };
}

function operationReference(evidence: LinkedInAdsCampaignOperationEvidence, nowMs: number): {
  accountId: string;
  campaignId: string;
} {
  const match = CAMPAIGN_URN.exec(evidence.campaign.urn);
  if (!match || !isLinkedInAdsAccountId(evidence.selectedAccountId)
    || evidence.campaign.account !== `urn:li:sponsoredAccount:${evidence.selectedAccountId}`
    || evidence.hasAccountAccess !== true || !Number.isSafeInteger(evidence.fetchedAtMs)
    || evidence.fetchedAtMs > nowMs + 1_000 || nowMs - evidence.fetchedAtMs > MAX_EVIDENCE_AGE_MS) {
    throw new TypeError("LinkedIn campaign ownership or role evidence is invalid or stale");
  }
  return { accountId: evidence.selectedAccountId, campaignId: match[1] };
}

function operationPath(evidence: LinkedInAdsCampaignOperationEvidence, nowMs: number): string {
  const reference = operationReference(evidence, nowMs);
  if (evidence.canManageCampaigns !== true || !linkedInAdsScopes(evidence.scopes).includes("rw_ads")) {
    throw new TypeError("LinkedIn campaign management evidence is missing");
  }
  return `/rest/adAccounts/${reference.accountId}/adCampaigns/${reference.campaignId}`;
}

function money(value: number): string {
  if (!Number.isFinite(value) || value <= 0 || value > 10_000_000) throw new TypeError("Invalid LinkedIn money amount");
  return value.toFixed(2);
}

function assertMutableCampaignState(
  evidence: LinkedInAdsCampaignOperationEvidence,
  operation: "edit" | "status" | "archive",
): void {
  if (NON_MUTABLE_CAMPAIGN_STATUSES.has(evidence.campaign.status)) {
    throw new TypeError(`LinkedIn campaign ${operation} state is not supported`);
  }
}

export function buildLinkedInAdsCampaignReadPath(accountId: string, campaignUrn: string): string {
  const match = CAMPAIGN_URN.exec(campaignUrn);
  if (!isLinkedInAdsAccountId(accountId) || !match) throw new TypeError("Invalid LinkedIn campaign reference");
  return `/rest/adAccounts/${accountId}/adCampaigns/${match[1]}`;
}

export function buildLinkedInAdsCampaignEditRequest(input: {
  evidence: LinkedInAdsCampaignOperationEvidence;
  name?: string;
  dailyBudget?: number;
  bidAmount?: number;
  nowMs?: number;
}): PartialUpdateRequest {
  const path = operationPath(input.evidence, input.nowMs ?? Date.now());
  assertMutableCampaignState(input.evidence, "edit");
  if (input.evidence.accountCurrency !== "EUR") throw new TypeError("LinkedIn campaign currency is not supported");
  const set: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name || name.length > 200) throw new TypeError("Invalid LinkedIn campaign name");
    set.name = name;
  }
  if (input.dailyBudget !== undefined) set.dailyBudget = { amount: money(input.dailyBudget), currencyCode: "EUR" };
  if (input.bidAmount !== undefined) set.unitCost = { amount: money(input.bidAmount), currencyCode: "EUR" };
  if (!Object.keys(set).length) throw new TypeError("No LinkedIn campaign field to update");
  return { method: "POST", path, headers: mutationHeaders(), body: { patch: { $set: set } } };
}

export function buildLinkedInAdsCampaignStatusRequest(input: {
  evidence: LinkedInAdsCampaignOperationEvidence;
  target: "ACTIVE" | "PAUSED";
  confirmedCampaignUrn: string;
  activationReady?: boolean;
  nowMs?: number;
}): PartialUpdateRequest {
  const path = operationPath(input.evidence, input.nowMs ?? Date.now());
  if (input.confirmedCampaignUrn !== input.evidence.campaign.urn) throw new TypeError("LinkedIn status change is not confirmed");
  assertMutableCampaignState(input.evidence, "status");
  if (input.target === "ACTIVE" && input.activationReady !== true) throw new TypeError("LinkedIn activation preflight is incomplete");
  return { method: "POST", path, headers: mutationHeaders(), body: { patch: { $set: { status: input.target } } } };
}

export function buildLinkedInAdsCampaignArchiveRequest(input: {
  evidence: LinkedInAdsCampaignOperationEvidence;
  confirmedCampaignUrn: string;
  nowMs?: number;
}): PartialUpdateRequest {
  const path = operationPath(input.evidence, input.nowMs ?? Date.now());
  if (input.confirmedCampaignUrn !== input.evidence.campaign.urn) throw new TypeError("LinkedIn archive is not confirmed");
  assertMutableCampaignState(input.evidence, "archive");
  if (input.evidence.campaign.status === "ARCHIVED") {
    throw new TypeError("LinkedIn campaign archive state is not supported");
  }
  return { method: "POST", path, headers: mutationHeaders(), body: { patch: { $set: { status: "ARCHIVED" } } } };
}

export function buildLinkedInAdsCampaignDeletionRequest(input: {
  evidence: LinkedInAdsCampaignOperationEvidence;
  confirmedCampaignUrn: string;
  confirmation: "DELETE_DRAFT" | "REQUEST_DELETION";
  nowMs?: number;
}): DeleteRequest | PartialUpdateRequest {
  const path = operationPath(input.evidence, input.nowMs ?? Date.now());
  if (input.confirmedCampaignUrn !== input.evidence.campaign.urn) throw new TypeError("LinkedIn deletion is not confirmed");
  if (input.evidence.campaign.status === "DRAFT") {
    if (input.confirmation !== "DELETE_DRAFT") throw new TypeError("DRAFT deletion confirmation mismatch");
    const { "X-RestLi-Method": _method, "Content-Type": _contentType, ...headers } = mutationHeaders();
    void _method; void _contentType;
    return { method: "DELETE", path, headers };
  }
  if (["PENDING_DELETION", "REMOVED"].includes(input.evidence.campaign.status)
    || input.confirmation !== "REQUEST_DELETION") throw new TypeError("LinkedIn deletion state or confirmation mismatch");
  return { method: "POST", path, headers: mutationHeaders(), body: { patch: { $set: { status: "PENDING_DELETION" } } } };
}

function analyticsDate(value: string): { year: number; month: number; day: number; epoch: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TypeError("Invalid LinkedIn analytics date");
  const [year, month, day] = value.split("-").map(Number);
  const epoch = Date.UTC(year, month - 1, day);
  const date = new Date(epoch);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    throw new TypeError("Invalid LinkedIn analytics date");
  }
  return { year, month, day, epoch };
}

export function buildLinkedInAdsCampaignAnalyticsPath(input: {
  evidence: LinkedInAdsCampaignOperationEvidence;
  startDate: string;
  endDate: string;
  nowMs?: number;
}): string {
  const reference = operationReference(input.evidence, input.nowMs ?? Date.now());
  if (!linkedInAdsScopes(input.evidence.scopes).includes("r_ads_reporting")) {
    throw new TypeError("LinkedIn reporting authorization evidence is missing");
  }
  const start = analyticsDate(input.startDate);
  const end = analyticsDate(input.endDate);
  if (end.epoch < start.epoch || end.epoch - start.epoch > 366 * 24 * 60 * 60_000) {
    throw new TypeError("Invalid LinkedIn analytics range");
  }
  const dateRange = `(start:(year:${start.year},month:${start.month},day:${start.day}),end:(year:${end.year},month:${end.month},day:${end.day}))`;
  const accountUrn = encodeURIComponent(`urn:li:sponsoredAccount:${reference.accountId}`);
  const campaignUrn = encodeURIComponent(`urn:li:sponsoredCampaign:${reference.campaignId}`);
  const fields = "dateRange,impressions,clicks,landingPageClicks,costInLocalCurrency,externalWebsiteConversions,pivotValues";
  return `/rest/adAnalytics?q=analytics&pivot=CAMPAIGN&timeGranularity=DAILY&dateRange=${dateRange}`
    + `&accounts=List(${accountUrn})&campaigns=List(${campaignUrn})&fields=${fields}`;
}
