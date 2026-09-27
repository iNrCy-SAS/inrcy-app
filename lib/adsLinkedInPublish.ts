import { assessAdsChannelDraft, type AdsDraftIssue, type LinkedInAdsDraft } from "./adsChannelDrafts.ts";
import { isLinkedInAdsAccountId, linkedInAdsCanManageCampaigns, LINKEDIN_ADS_API_VERSION, type LinkedInAdsAccount, type LinkedInAdsRole } from "./adsLinkedInPolicy.ts";

/**
 * Read-only evidence must be collected from LinkedIn immediately before this
 * function is called. A draft's externalRefs are never evidence of ownership.
 * This module only serializes a non-serving campaign DRAFT. It does not create
 * a campaign group, creative, post, or conversion and never calls LinkedIn.
 */
export type LinkedInAdsCampaignEvidence = {
  fetchedAtMs: number;
  selectedAccountId: string;
  scopes: string;
  account: LinkedInAdsAccount;
  campaignGroup: {
    id: string | number;
    account: string;
    status: string;
    objectiveType?: string | null;
    allowedCampaignTypes?: string[];
    runSchedule?: { start?: number; end?: number };
  };
  organization: { urn: string; role: string };
  geoUrns: string[];
  supportedLocales: Array<{ country: string; language: string }>;
};

export type LinkedInAdsDraftCampaignChoices = {
  /** Explicit manual CPC bid in the selected account's currency. */
  bidAmount: string;
  /** Milliseconds since epoch. Draft creation never starts delivery. */
  startAtMs: number;
  endAtMs?: number;
};

export type LinkedInAdsDraftCampaignRequest = {
  method: "POST";
  path: string;
  headers: {
    "Linkedin-Version": string;
    "X-Restli-Protocol-Version": "2.0.0";
    "Content-Type": "application/json";
  };
  body: {
    account: string;
    campaignGroup: string;
    associatedEntity: string;
    name: string;
    objectiveType: "WEBSITE_VISIT";
    format: "STANDARD_UPDATE";
    type: "SPONSORED_UPDATES";
    costType: "CPC";
    optimizationTargetType: "NONE";
    unitCost: { amount: string; currencyCode: "EUR" };
    dailyBudget: { amount: string; currencyCode: "EUR" };
    locale: { country: string; language: string };
    runSchedule: { start: number; end?: number };
    targetingCriteria: {
      include: { and: Array<{ or: Record<string, string[]> }> };
    };
    audienceExpansionEnabled: false;
    offsiteDeliveryEnabled: false;
    status: "DRAFT";
  };
};

export type LinkedInAdsDraftCampaignPreparation =
  | { readyForDraftCreate: false; publicationReady: false; request: null; issues: AdsDraftIssue[] }
  | { readyForDraftCreate: true; publicationReady: false; request: LinkedInAdsDraftCampaignRequest; issues: [] };

const ACCOUNT_URN = /^urn:li:sponsoredAccount:(\d{1,25})$/;
const GROUP_URN = /^urn:li:sponsoredCampaignGroup:(\d{1,25})$/;
const ORGANIZATION_URN = /^urn:li:organization:\d{1,25}$/;
const GEO_URN = /^urn:li:geo:\d{1,25}$/;
const BID = /^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/;
const EVIDENCE_MAX_AGE_MS = 5 * 60_000;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function string(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function issue(issues: AdsDraftIssue[], code: string, field: string, condition: boolean): void {
  if (condition) issues.push({ code, field });
}

function safeTime(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * Builds only a DRAFT campaign request for a website visit image brief with a
 * manual CPC bid. Every other objective, format, or budget model is blocked.
 * A successful result is not an ad or a publishable campaign: creative content
 * and its account/organization permissions still need separate verification.
 */
export function prepareLinkedInAdsDraftCampaign(
  value: unknown,
  evidenceValue: LinkedInAdsCampaignEvidence | null,
  choicesValue: LinkedInAdsDraftCampaignChoices | null,
  nowMs = Date.now(),
): LinkedInAdsDraftCampaignPreparation {
  const assessment = assessAdsChannelDraft(value);
  const issues: AdsDraftIssue[] = [...assessment.briefIssues];
  const draft = record(value);
  const refs = record(draft.externalRefs);
  const evidence = record(evidenceValue);
  const account = record(evidence.account);
  const group = record(evidence.campaignGroup);
  const organization = record(evidence.organization);
  const choices = record(choicesValue);

  issue(issues, "unsupported_channel", "channel", draft.channel !== "linkedin");
  issue(issues, "unsupported_creation_path", "objectiveType", draft.objectiveType !== "WEBSITE_VISIT");
  issue(issues, "unsupported_creation_path", "format", draft.format !== "STANDARD_UPDATE");
  issue(issues, "unsupported_creation_path", "budget.period", record(draft.budget).period !== "daily");

  const accountId = string(account.id);
  const accountUrn = `urn:li:sponsoredAccount:${accountId}`;
  const selectedAccountId = string(evidence.selectedAccountId);
  issue(issues, "account_unverified", "externalRefs.adAccountUrn",
    !isLinkedInAdsAccountId(accountId) || selectedAccountId !== accountId || string(refs.adAccountUrn) !== accountUrn);
  const scopes = string(evidence.scopes);
  const roles = Array.isArray(account.permissions) ? account.permissions : [];
  const canManage = roles.some((role) => ["CAMPAIGN_MANAGER", "ACCOUNT_MANAGER", "ACCOUNT_BILLING_ADMIN"].includes(String(role))
    && linkedInAdsCanManageCampaigns(role as LinkedInAdsRole, scopes, string(account.status), string(account.type)));
  issue(issues, "account_manage_access_unverified", "account", !canManage || account.canManageCampaigns !== true);
  issue(issues, "account_currency_mismatch", "account.currency", string(account.currency) !== "EUR");

  const fetchedAtMs = evidence.fetchedAtMs;
  issue(issues, "platform_evidence_stale", "evidence.fetchedAtMs",
    !safeTime(fetchedAtMs) || !safeTime(nowMs) || fetchedAtMs > nowMs + 1000 || nowMs - fetchedAtMs > EVIDENCE_MAX_AGE_MS);

  const groupId = String(group.id ?? "");
  const groupUrn = `urn:li:sponsoredCampaignGroup:${groupId}`;
  issue(issues, "campaign_group_unverified", "externalRefs.campaignGroupUrn",
    !GROUP_URN.test(groupUrn) || string(refs.campaignGroupUrn) !== groupUrn || string(group.account) !== accountUrn);
  issue(issues, "campaign_group_unavailable", "campaignGroup.status",
    !["ACTIVE", "DRAFT", "PAUSED"].includes(string(group.status)));
  issue(issues, "campaign_group_objective_mismatch", "campaignGroup.objectiveType",
    Boolean(string(group.objectiveType)) && group.objectiveType !== "WEBSITE_VISIT");
  issue(issues, "campaign_group_format_unverified", "campaignGroup.allowedCampaignTypes",
    account.type === "ENTERPRISE" && (!Array.isArray(group.allowedCampaignTypes) || !group.allowedCampaignTypes.includes("SPONSORED_UPDATES")));

  const organizationUrn = string(organization.urn);
  issue(issues, "organization_unverified", "externalRefs.organizationUrn",
    !ORGANIZATION_URN.test(organizationUrn) || string(refs.organizationUrn) !== organizationUrn
      || !["ADMINISTRATOR", "DIRECT_SPONSORED_CONTENT_POSTER"].includes(string(organization.role)));

  const geoUrns = refs.geoUrns;
  const verifiedGeos = Array.isArray(evidence.geoUrns) ? evidence.geoUrns : [];
  const geosValid = Array.isArray(geoUrns) && geoUrns.length > 0 && geoUrns.length <= 20
    && geoUrns.every((urn) => typeof urn === "string" && GEO_URN.test(urn) && verifiedGeos.includes(urn))
    && new Set(geoUrns).size === geoUrns.length;
  issue(issues, "targeting_geos_unverified", "externalRefs.geoUrns", !geosValid);
  const locale = record(draft.locale);
  const supportedLocales = Array.isArray(evidence.supportedLocales) ? evidence.supportedLocales : [];
  issue(issues, "locale_unverified", "locale", !supportedLocales.some((item) =>
    item?.country === locale.country && item?.language === locale.language));

  const bid = string(choices.bidAmount);
  issue(issues, "manual_bid_required", "choices.bidAmount", !BID.test(bid) || Number(bid) <= 0 || Number(bid) > 500);
  const startAtMs = choices.startAtMs;
  const endAtMs = choices.endAtMs;
  const groupSchedule = record(group.runSchedule);
  issue(issues, "invalid_schedule", "choices.startAtMs",
    !safeTime(startAtMs) || !safeTime(nowMs) || startAtMs < nowMs + 60_000
      || !safeTime(groupSchedule.start) || startAtMs < groupSchedule.start
      || (safeTime(groupSchedule.end) && startAtMs >= groupSchedule.end));
  issue(issues, "invalid_schedule", "choices.endAtMs",
    endAtMs !== undefined && (!safeTime(endAtMs) || !safeTime(startAtMs) || endAtMs <= startAtMs
      || (safeTime(groupSchedule.end) && endAtMs > groupSchedule.end)));

  if (issues.length > 0) return { readyForDraftCreate: false, publicationReady: false, request: null, issues };

  const typedDraft = value as LinkedInAdsDraft;
  const body: LinkedInAdsDraftCampaignRequest["body"] = {
    account: accountUrn,
    campaignGroup: groupUrn,
    associatedEntity: organizationUrn,
    name: typedDraft.name.trim(),
    objectiveType: "WEBSITE_VISIT",
    format: "STANDARD_UPDATE",
    type: "SPONSORED_UPDATES",
    costType: "CPC",
    optimizationTargetType: "NONE",
    unitCost: { amount: Number(bid).toFixed(2), currencyCode: "EUR" },
    dailyBudget: { amount: typedDraft.budget.amount.toFixed(2), currencyCode: "EUR" },
    locale: { country: typedDraft.locale.country, language: typedDraft.locale.language },
    runSchedule: { start: startAtMs as number, ...(endAtMs === undefined ? {} : { end: endAtMs as number }) },
    targetingCriteria: {
      include: { and: [
        { or: { "urn:li:adTargetingFacet:interfaceLocales": [`urn:li:locale:${typedDraft.locale.language}_${typedDraft.locale.country}`] } },
        { or: { "urn:li:adTargetingFacet:locations": [...(geoUrns as string[])] } },
      ] },
    },
    audienceExpansionEnabled: false,
    offsiteDeliveryEnabled: false,
    status: "DRAFT",
  };
  return {
    readyForDraftCreate: true,
    publicationReady: false,
    request: {
      method: "POST",
      path: `/rest/adAccounts/${accountId}/adCampaigns`,
      headers: {
        "Linkedin-Version": LINKEDIN_ADS_API_VERSION,
        "X-Restli-Protocol-Version": "2.0.0",
        "Content-Type": "application/json",
      },
      body,
    },
    issues: [],
  };
}
