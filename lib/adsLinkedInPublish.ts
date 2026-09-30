import { assessAdsChannelDraft, type AdsDraftIssue, type LinkedInAdsDraft } from "./adsChannelDrafts.ts";
import { isLinkedInAdsAccountId, linkedInAdsCanManageCampaigns, linkedInAdsScopes, LINKEDIN_ADS_API_VERSION, type LinkedInAdsAccount, type LinkedInAdsRole } from "./adsLinkedInPolicy.ts";

/**
 * Read-only evidence must be collected from LinkedIn immediately before this
 * function is called. A draft's externalRefs are never evidence of ownership.
 * This module only serializes non-serving campaign, dark-post, creative and
 * finalization requests. It never calls LinkedIn; callers must persist every
 * returned provider URN before attempting the next step.
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
  image: {
    urn: string;
    owner: string;
    status: string;
    associatedAccount?: string | null;
  };
  /** Fresh provider response after the DRAFT campaign has been created. */
  campaign?: {
    urn: string;
    account: string;
    status: string;
  };
  geoUrns: string[];
  supportedLocales: Array<{ country: string; language: string }>;
};

export type LinkedInAdsDraftCampaignChoices = {
  /** Explicit manual CPC bid in the selected account's currency. */
  bidAmount: string;
  /** Milliseconds since epoch. Draft creation never starts delivery. */
  startAtMs: number;
  endAtMs?: number;
  /** Explicit advertiser acknowledgement required for EU-targeted ads. */
  politicalIntentConfirmed: boolean;
  /** Explicit acknowledgement of LinkedIn's targeting non-discrimination notice. */
  discriminationNoticeAcknowledged: boolean;
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
    politicalIntent: "NOT_POLITICAL";
    status: "DRAFT";
  };
};

export type LinkedInAdsDarkPostRequest = {
  method: "POST";
  path: "/rest/posts";
  headers: {
    "Linkedin-Version": string;
    "X-Restli-Protocol-Version": "2.0.0";
    "Content-Type": "application/json";
  };
  body: {
    adContext: { dscAdAccount: string; dscStatus: "ACTIVE" };
    author: string;
    commentary: string;
    visibility: "PUBLIC";
    distribution: {
      feedDistribution: "NONE";
      targetEntities: never[];
      thirdPartyDistributionChannels: never[];
    };
    lifecycleState: "PUBLISHED";
    isReshareDisabledByAuthor: true;
    contentCallToActionLabel: "LEARN_MORE";
    contentLandingPage: string;
    content: { media: { title: string; id: string } };
  };
};

export type LinkedInAdsDraftCreativeRequest = {
  method: "POST";
  path: string;
  headers: {
    "Linkedin-Version": string;
    "X-Restli-Protocol-Version": "2.0.0";
    "Content-Type": "application/json";
  };
  body: {
    campaign: string;
    content: { reference: string };
    intendedStatus: "DRAFT";
    name: string;
  };
};

export type LinkedInAdsPartialUpdateRequest = {
  method: "POST";
  path: string;
  headers: {
    "Linkedin-Version": string;
    "X-Restli-Protocol-Version": "2.0.0";
    "X-RestLi-Method": "PARTIAL_UPDATE";
    "Content-Type": "application/json";
  };
  body: { patch: { $set: Record<string, string> } };
};

export type LinkedInAdsDraftCampaignPreparation =
  | { readyForDraftCreate: false; publicationReady: false; request: null; issues: AdsDraftIssue[] }
  | { readyForDraftCreate: true; publicationReady: false; request: LinkedInAdsDraftCampaignRequest; issues: [] };

const ACCOUNT_URN = /^urn:li:sponsoredAccount:(\d{1,25})$/;
const GROUP_URN = /^urn:li:sponsoredCampaignGroup:(\d{1,25})$/;
const ORGANIZATION_URN = /^urn:li:organization:\d{1,25}$/;
const GEO_URN = /^urn:li:geo:\d{1,25}$/;
const IMAGE_URN = /^urn:li:image:[A-Za-z0-9_-]{3,200}$/;
const CAMPAIGN_URN = /^urn:li:sponsoredCampaign:(\d{1,25})$/;
const CREATIVE_URN = /^urn:li:sponsoredCreative:(\d{1,25})$/;
const POST_URN = /^urn:li:(?:share|ugcPost):\d{1,25}$/;
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

function publicHttpsUrl(value: unknown): boolean {
  try {
    const url = new URL(string(value));
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if (url.protocol !== "https:" || url.username || url.password || !hostname) return false;
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) return false;
    if (hostname === "::1" || hostname === "0.0.0.0") return false;
    if (/^(?:10|127|169\.254|192\.168)\./.test(hostname)) return false;
    if (/^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname)) return false;
    return true;
  } catch {
    return false;
  }
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
    && linkedInAdsCanManageCampaigns(
      role as LinkedInAdsRole,
      scopes,
      string(account.status),
      string(account.type),
      string(account.productType),
    ));
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
      || !["ADMINISTRATOR", "DIRECT_SPONSORED_CONTENT_POSTER", "CONTENT_ADMINISTRATOR"].includes(string(organization.role)));

  const image = record(evidence.image);
  const imageUrn = string(image.urn);
  issue(issues, "image_unverified", "externalRefs.creativeAssetUrn",
    !IMAGE_URN.test(imageUrn) || string(refs.creativeAssetUrn) !== imageUrn
      || image.status !== "AVAILABLE" || string(image.owner) !== organizationUrn
      || (Boolean(string(image.associatedAccount)) && string(image.associatedAccount) !== accountUrn));

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
  issue(issues, "political_intent_confirmation_required", "choices.politicalIntentConfirmed",
    choices.politicalIntentConfirmed !== true);
  issue(issues, "targeting_notice_acknowledgement_required", "choices.discriminationNoticeAcknowledged",
    choices.discriminationNoticeAcknowledged !== true);
  const startAtMs = choices.startAtMs;
  const endAtMs = choices.endAtMs;
  const groupSchedule = record(group.runSchedule);
  issue(issues, "invalid_schedule", "choices.startAtMs",
    !safeTime(startAtMs) || !safeTime(nowMs) || startAtMs < nowMs + 60_000
      || (groupSchedule.start !== undefined && (!safeTime(groupSchedule.start) || startAtMs < groupSchedule.start))
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
    politicalIntent: "NOT_POLITICAL",
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

/**
 * Serializes a direct sponsored content post. It is PUBLISHED only as a dark
 * post (`feedDistribution: NONE`) and cannot serve without a linked creative
 * and campaign. Persist its returned URN before building the creative.
 */
export function prepareLinkedInAdsDarkPost(
  value: unknown,
  evidenceValue: LinkedInAdsCampaignEvidence | null,
  nowMs = Date.now(),
): { readyForDraftCreate: false; request: null; issues: AdsDraftIssue[] }
  | { readyForDraftCreate: true; request: LinkedInAdsDarkPostRequest; issues: [] } {
  const assessment = assessAdsChannelDraft(value);
  const issues: AdsDraftIssue[] = [...assessment.briefIssues];
  const draft = record(value);
  const refs = record(draft.externalRefs);
  const evidence = record(evidenceValue);
  const account = record(evidence.account);
  const organization = record(evidence.organization);
  const image = record(evidence.image);
  const accountId = string(account.id);
  const accountUrn = `urn:li:sponsoredAccount:${accountId}`;
  const organizationUrn = string(organization.urn);
  const imageUrn = string(image.urn);
  const scopes = string(evidence.scopes);
  const roles = Array.isArray(account.permissions) ? account.permissions : [];
  const canManage = roles.some((role) => ["CAMPAIGN_MANAGER", "ACCOUNT_MANAGER", "ACCOUNT_BILLING_ADMIN"].includes(String(role))
    && linkedInAdsCanManageCampaigns(
      role as LinkedInAdsRole,
      scopes,
      string(account.status),
      string(account.type),
      string(account.productType),
    ));

  issue(issues, "unsupported_channel", "channel", draft.channel !== "linkedin");
  issue(issues, "unsupported_creation_path", "objectiveType", draft.objectiveType !== "WEBSITE_VISIT");
  issue(issues, "unsupported_creation_path", "format", draft.format !== "STANDARD_UPDATE");
  issue(issues, "account_unverified", "externalRefs.adAccountUrn",
    !isLinkedInAdsAccountId(accountId) || string(refs.adAccountUrn) !== accountUrn
      || string(evidence.selectedAccountId) !== accountId);
  issue(issues, "platform_evidence_stale", "evidence.fetchedAtMs",
    !safeTime(evidence.fetchedAtMs) || !safeTime(nowMs)
      || evidence.fetchedAtMs > nowMs + 1000 || nowMs - evidence.fetchedAtMs > EVIDENCE_MAX_AGE_MS);
  issue(issues, "organization_write_scope_required", "evidence.scopes",
    !linkedInAdsScopes(scopes).includes("w_organization_social"));
  issue(issues, "account_manage_access_unverified", "account",
    !canManage || account.canManageCampaigns !== true || !linkedInAdsScopes(scopes).includes("rw_ads"));
  issue(issues, "organization_unverified", "externalRefs.organizationUrn",
    !ORGANIZATION_URN.test(organizationUrn) || string(refs.organizationUrn) !== organizationUrn
      || !["ADMINISTRATOR", "DIRECT_SPONSORED_CONTENT_POSTER", "CONTENT_ADMINISTRATOR"].includes(string(organization.role)));
  issue(issues, "image_unverified", "externalRefs.creativeAssetUrn",
    !IMAGE_URN.test(imageUrn) || string(refs.creativeAssetUrn) !== imageUrn
      || image.status !== "AVAILABLE" || string(image.owner) !== organizationUrn
      || (Boolean(string(image.associatedAccount)) && string(image.associatedAccount) !== accountUrn));
  const creative = record(draft.creative);
  issue(issues, "destination_unavailable", "creative.destinationUrl", !publicHttpsUrl(creative.destinationUrl));

  if (issues.length > 0) return { readyForDraftCreate: false, request: null, issues };
  const commentary = string(creative.introText);
  const title = string(creative.headline);
  const destination = string(creative.destinationUrl);
  return {
    readyForDraftCreate: true,
    request: {
      method: "POST",
      path: "/rest/posts",
      headers: {
        "Linkedin-Version": LINKEDIN_ADS_API_VERSION,
        "X-Restli-Protocol-Version": "2.0.0",
        "Content-Type": "application/json",
      },
      body: {
        adContext: { dscAdAccount: accountUrn, dscStatus: "ACTIVE" },
        author: organizationUrn,
        commentary,
        visibility: "PUBLIC",
        distribution: { feedDistribution: "NONE", targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: true,
        contentCallToActionLabel: "LEARN_MORE",
        contentLandingPage: destination,
        content: { media: { title, id: imageUrn } },
      },
    },
    issues: [],
  };
}

/**
 * Links a persisted dark-post URN to a persisted campaign URN. The resulting
 * creative remains DRAFT, so this request alone cannot start delivery.
 */
export function prepareLinkedInAdsDraftCreative(
  value: unknown,
  evidenceValue: LinkedInAdsCampaignEvidence | null,
  campaignUrn: string,
  postUrn: string,
  nowMs = Date.now(),
): { readyForDraftCreate: false; request: null; issues: AdsDraftIssue[] }
  | { readyForDraftCreate: true; request: LinkedInAdsDraftCreativeRequest; issues: [] } {
  const assessment = assessAdsChannelDraft(value);
  const issues: AdsDraftIssue[] = [...assessment.briefIssues];
  const draft = record(value);
  const refs = record(draft.externalRefs);
  const evidence = record(evidenceValue);
  const account = record(evidence.account);
  const accountId = string(account.id);
  const accountUrn = `urn:li:sponsoredAccount:${accountId}`;
  const campaign = record(evidence.campaign);
  const scopes = string(evidence.scopes);
  const roles = Array.isArray(account.permissions) ? account.permissions : [];
  const canManage = roles.some((role) => ["CAMPAIGN_MANAGER", "ACCOUNT_MANAGER", "ACCOUNT_BILLING_ADMIN"].includes(String(role))
    && linkedInAdsCanManageCampaigns(
      role as LinkedInAdsRole,
      scopes,
      string(account.status),
      string(account.type),
      string(account.productType),
    ));

  issue(issues, "unsupported_channel", "channel", draft.channel !== "linkedin");
  issue(issues, "unsupported_creation_path", "objectiveType", draft.objectiveType !== "WEBSITE_VISIT");
  issue(issues, "unsupported_creation_path", "format", draft.format !== "STANDARD_UPDATE");
  issue(issues, "campaign_unverified", "campaignUrn", !CAMPAIGN_URN.test(campaignUrn));
  issue(issues, "campaign_unverified", "campaignUrn",
    string(campaign.urn) !== campaignUrn || string(campaign.account) !== accountUrn || campaign.status !== "DRAFT");
  issue(issues, "post_unverified", "postUrn", !POST_URN.test(postUrn));
  issue(issues, "account_unverified", "externalRefs.adAccountUrn",
    !isLinkedInAdsAccountId(accountId) || string(refs.adAccountUrn) !== accountUrn
      || string(evidence.selectedAccountId) !== accountId);
  issue(issues, "account_manage_access_unverified", "account",
    !canManage || account.canManageCampaigns !== true || !linkedInAdsScopes(scopes).includes("rw_ads"));
  issue(issues, "platform_evidence_stale", "evidence.fetchedAtMs",
    !safeTime(evidence.fetchedAtMs) || !safeTime(nowMs)
      || evidence.fetchedAtMs > nowMs + 1000 || nowMs - evidence.fetchedAtMs > EVIDENCE_MAX_AGE_MS);

  if (issues.length > 0) return { readyForDraftCreate: false, request: null, issues };
  return {
    readyForDraftCreate: true,
    request: {
      method: "POST",
      path: `/rest/adAccounts/${accountId}/creatives`,
      headers: {
        "Linkedin-Version": LINKEDIN_ADS_API_VERSION,
        "X-Restli-Protocol-Version": "2.0.0",
        "Content-Type": "application/json",
      },
      body: {
        campaign: campaignUrn,
        content: { reference: postUrn },
        intendedStatus: "DRAFT",
        name: string(draft.name).slice(0, 200),
      },
    },
    issues: [],
  };
}

/**
 * The creative is made reviewable first while its parent campaign remains
 * DRAFT. The campaign is always the final switch, so ACTIVE cannot serve
 * before every provider ID has been durably persisted.
 */
export function buildLinkedInAdsFinalizationSteps(
  accountId: string,
  campaignUrn: string,
  creativeUrn: string,
  target: "ACTIVE" | "PAUSED",
): LinkedInAdsPartialUpdateRequest[] {
  const campaignMatch = CAMPAIGN_URN.exec(campaignUrn);
  if (!isLinkedInAdsAccountId(accountId) || !campaignMatch || !CREATIVE_URN.test(creativeUrn)
    || (target !== "ACTIVE" && target !== "PAUSED")) {
    throw new TypeError("Invalid LinkedIn Ads finalization resources");
  }
  const headers: LinkedInAdsPartialUpdateRequest["headers"] = {
    "Linkedin-Version": LINKEDIN_ADS_API_VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
    "X-RestLi-Method": "PARTIAL_UPDATE",
    "Content-Type": "application/json",
  };
  return [
    {
      method: "POST",
      path: `/rest/adAccounts/${accountId}/creatives/${encodeURIComponent(creativeUrn)}`,
      headers,
      body: { patch: { $set: { intendedStatus: "ACTIVE" } } },
    },
    {
      method: "POST",
      path: `/rest/adAccounts/${accountId}/adCampaigns/${campaignMatch[1]}`,
      headers,
      body: { patch: { $set: { status: target } } },
    },
  ];
}
