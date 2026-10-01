import "server-only";

import { linkedInAdsScopes, LINKEDIN_ADS_API_VERSION } from "./adsLinkedInPolicy.ts";
import { log } from "./observability/logger.ts";
import {
  LinkedInAdsConnectionError,
  linkedInAdsAuthorization,
  listLinkedInAdsAccounts,
  readLinkedInAdsIntegration,
} from "./adsLinkedInServer.ts";
import {
  buildLinkedInAdsAudienceCountPath,
  buildLinkedInAdsBudgetPricingPath,
  buildLinkedInAdsCampaignGroupsPath,
  buildLinkedInAdsGeoSearchPath,
  buildLinkedInAdsGeoUrnsPath,
  buildLinkedInAdsImagePath,
  buildLinkedInAdsLocalesPath,
  linkedInAdsCampaignGroupIsCompatible,
  linkedInAdsPreflightBlockers,
  normalizeLinkedInAdsAudienceCount,
  normalizeLinkedInAdsBudgetPricing,
  normalizeLinkedInAdsCampaignGroups,
  normalizeLinkedInAdsImage,
  normalizeLinkedInAdsLocales,
  normalizeLinkedInAdsTargetingEntities,
  recommendedLinkedInAdsBid,
  selectUnambiguousLinkedInAdsGeoTarget,
  type LinkedInAdsCampaignGroup,
  type LinkedInAdsImageEvidence,
} from "./adsLinkedInPreflightPolicy.ts";

const LINKEDIN_REST_ORIGIN = "https://api.linkedin.com";
const ORGANIZATION_URN = /^urn:li:organization:\d{1,25}$/;

export type LinkedInAdsPreflightInput = {
  geoQuery?: string;
  language?: string;
  country?: string;
  campaignGroupId?: string;
  organizationUrn?: string;
  imageUrn?: string;
  geoUrns?: string[];
  bidAmount?: number;
  dailyBudget?: number;
  politicalIntentConfirmed?: boolean;
  targetingNoticeAcknowledged?: boolean;
};

type OrganizationAccess = {
  urn: string;
  role: "ADMINISTRATOR" | "DIRECT_SPONSORED_CONTENT_POSTER" | "CONTENT_ADMINISTRATOR";
};

export type LinkedInAdsPreflightOperation =
  | "campaign_groups"
  | "interface_locales"
  | "geo_typeahead_localized"
  | "geo_typeahead_default_locale"
  | "geo_urn_resolution"
  | "organization_access"
  | "image"
  | "audience_count"
  | "budget_pricing";

/** Provider details are deliberately limited to safe, low-cardinality diagnostics. */
export class LinkedInAdsPreflightProviderError extends LinkedInAdsConnectionError {
  constructor(
    message: string,
    code: string,
    status: number,
    readonly operation: LinkedInAdsPreflightOperation,
    readonly providerStatus: number | null,
  ) {
    super(message, code, status);
    this.name = "LinkedInAdsPreflightProviderError";
  }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function allowedDevelopmentAccountIds(): Set<string> {
  return new Set(String(process.env.LINKEDIN_ADS_DEVELOPMENT_ACCOUNT_IDS || "")
    .split(/[\s,]+/).map((value) => value.trim()).filter((value) => /^\d{1,25}$/.test(value)));
}

function rejectedOperationCode(operation: LinkedInAdsPreflightOperation): string {
  return operation === "geo_typeahead_localized" || operation === "geo_typeahead_default_locale"
    ? "preflight_geo_typeahead_rejected"
    : `preflight_${operation}_rejected`;
}

function providerHttpError(
  operation: LinkedInAdsPreflightOperation,
  providerStatus: number,
): LinkedInAdsPreflightProviderError {
  if (providerStatus === 401 || providerStatus === 403) {
    return new LinkedInAdsPreflightProviderError(
      "LinkedIn refuse ce contrôle préalable. Reconnectez le canal et vérifiez les scopes et rôles.",
      "preflight_access_denied",
      403,
      operation,
      providerStatus,
    );
  }
  if (providerStatus === 400) {
    return new LinkedInAdsPreflightProviderError(
      "LinkedIn Ads a refusé une lecture du contrôle préalable.",
      rejectedOperationCode(operation),
      502,
      operation,
      providerStatus,
    );
  }
  if (providerStatus === 429) {
    return new LinkedInAdsPreflightProviderError(
      "LinkedIn Ads limite temporairement les contrôles préalables.",
      "preflight_provider_rate_limited",
      503,
      operation,
      providerStatus,
    );
  }
  return new LinkedInAdsPreflightProviderError(
    "Le contrôle préalable LinkedIn Ads est indisponible.",
    "provider_unavailable",
    providerStatus >= 500 ? 503 : 502,
    operation,
    providerStatus,
  );
}

async function linkedInAdsRead(
  accessToken: string,
  path: string,
  operation: LinkedInAdsPreflightOperation,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`${LINKEDIN_REST_ORIGIN}${path}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Linkedin-Version": LINKEDIN_ADS_API_VERSION,
        "X-Restli-Protocol-Version": "2.0.0",
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new LinkedInAdsPreflightProviderError(
      "LinkedIn Ads n’a pas répondu au contrôle préalable.",
      "provider_unavailable",
      503,
      operation,
      null,
    );
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw providerHttpError(operation, response.status);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new LinkedInAdsPreflightProviderError(
      "Réponse de préflight LinkedIn Ads invalide.",
      "provider_invalid_response",
      502,
      operation,
      response.status,
    );
  }
  return payload as Record<string, unknown>;
}

async function readLinkedInAdsGeoSuggestions(input: {
  accessToken: string;
  accountId: string;
  query: string;
  language: string;
  country: string;
}): Promise<Record<string, unknown>> {
  try {
    return await linkedInAdsRead(input.accessToken, buildLinkedInAdsGeoSearchPath({
      query: input.query,
      accountId: input.accountId,
      language: input.language,
      country: input.country,
    }), "geo_typeahead_localized");
  } catch (error) {
    if (!(error instanceof LinkedInAdsPreflightProviderError)
      || error.operation !== "geo_typeahead_localized" || error.providerStatus !== 400) throw error;
    log.warn("linkedin_ads_preflight_geo_locale_fallback", {
      provider: "linkedin",
      operation: error.operation,
      provider_status: error.providerStatus,
      fallback_operation: "geo_typeahead_default_locale",
    });
    return linkedInAdsRead(input.accessToken, buildLinkedInAdsGeoSearchPath({
      query: input.query,
      accountId: input.accountId,
    }), "geo_typeahead_default_locale");
  }
}

function normalizeOrganizationAccess(payload: unknown): OrganizationAccess[] | null {
  const elements = record(payload).elements;
  if (!Array.isArray(elements) || elements.length > 500) return null;
  const found = new Map<string, OrganizationAccess>();
  for (const value of elements) {
    const row = record(value);
    if (row.state !== "APPROVED") continue;
    const role = text(row.role);
    if (role !== "ADMINISTRATOR" && role !== "DIRECT_SPONSORED_CONTENT_POSTER" && role !== "CONTENT_ADMINISTRATOR") continue;
    const urn = text(row.organization) || text(row.organizationTarget);
    if (!ORGANIZATION_URN.test(urn)) return null;
    found.set(urn, { urn, role });
  }
  return [...found.values()];
}

async function listOrganizationAccess(accessToken: string): Promise<OrganizationAccess[]> {
  const payload = await linkedInAdsRead(
    accessToken,
    "/rest/organizationAcls?q=roleAssignee&state=APPROVED&count=500&start=0",
    "organization_access",
  );
  const organizations = normalizeOrganizationAccess(payload);
  if (!organizations) throw new LinkedInAdsConnectionError("Rôles de Page LinkedIn invalides.", "provider_invalid_response");
  return organizations;
}

export async function runLinkedInAdsPreflight(userId: string, input: LinkedInAdsPreflightInput = {}) {
  const integration = await readLinkedInAdsIntegration(userId);
  if (!integration?.resource_id) {
    throw new LinkedInAdsConnectionError("Associez d’abord un compte LinkedIn Ads.", "account_selection_required", 409);
  }
  const { token, scopes: rawScopes } = await linkedInAdsAuthorization(userId, integration);
  const scopes = linkedInAdsScopes(rawScopes);
  const accounts = await listLinkedInAdsAccounts(userId, integration);
  const account = accounts.find((item) => item.id === integration.resource_id);
  if (!account) throw new LinkedInAdsConnectionError("Le compte LinkedIn Ads associé n’est plus accessible.", "account_access_denied", 403);

  const language = /^[a-z]{2}$/.test(input.language || "") ? input.language! : "fr";
  const country = /^[A-Z]{2}$/.test(input.country || "") ? input.country! : "FR";
  const geoQuery = text(input.geoQuery);
  const hasOrganizationRead = scopes.includes("r_organization_admin") || scopes.includes("rw_organization_admin");
  const requestedGeoUrns = Array.isArray(input.geoUrns)
    ? [...new Set(input.geoUrns.filter((urn) => /^urn:li:geo:\d{1,25}$/.test(urn)))] : [];
  const [groupsPayload, localesPayload, geosPayload, selectedGeosPayload, organizations, imagePayload] = await Promise.all([
    linkedInAdsRead(token, buildLinkedInAdsCampaignGroupsPath(account.id), "campaign_groups"),
    linkedInAdsRead(token, buildLinkedInAdsLocalesPath(), "interface_locales"),
    geoQuery.length >= 2 ? readLinkedInAdsGeoSuggestions({
      accessToken: token, accountId: account.id, query: geoQuery, language, country,
    }) : Promise.resolve({ elements: [] }),
    requestedGeoUrns.length
      ? linkedInAdsRead(token, buildLinkedInAdsGeoUrnsPath(requestedGeoUrns, language, country), "geo_urn_resolution")
      : Promise.resolve({ elements: [] }),
    hasOrganizationRead ? listOrganizationAccess(token) : Promise.resolve([]),
    input.imageUrn ? linkedInAdsRead(token, buildLinkedInAdsImagePath(input.imageUrn), "image") : Promise.resolve(null),
  ]);

  const campaignGroups = normalizeLinkedInAdsCampaignGroups(groupsPayload, account.id);
  const supportedLocales = normalizeLinkedInAdsLocales(localesPayload);
  const geoSuggestions = normalizeLinkedInAdsTargetingEntities(geosPayload);
  const selectedGeoTargets = normalizeLinkedInAdsTargetingEntities(selectedGeosPayload);
  if (!campaignGroups || !supportedLocales || !geoSuggestions || !selectedGeoTargets) {
    throw new LinkedInAdsConnectionError("Ressources LinkedIn Ads incohérentes.", "provider_invalid_response");
  }
  const compatibleCampaignGroups = campaignGroups.filter(linkedInAdsCampaignGroupIsCompatible);
  const selectedGroup: LinkedInAdsCampaignGroup | null = input.campaignGroupId
    ? campaignGroups.find((item) => item.id === input.campaignGroupId) || null
    : compatibleCampaignGroups.length === 1 ? compatibleCampaignGroups[0] : null;
  const selectedOrganization = input.organizationUrn
    ? organizations.find((item) => item.urn === input.organizationUrn) || null
    : organizations.length === 1 ? organizations[0] : null;
  const image: LinkedInAdsImageEvidence | null = input.imageUrn && imagePayload
    ? normalizeLinkedInAdsImage(imagePayload, input.imageUrn) : null;
  if (input.imageUrn && !image) {
    throw new LinkedInAdsConnectionError("Le média LinkedIn ne peut pas être vérifié.", "image_invalid", 422);
  }
  const requestedGeoUrnSet = new Set(requestedGeoUrns);
  const automaticGeoTarget = requestedGeoUrns.length === 0
    ? selectUnambiguousLinkedInAdsGeoTarget(geoSuggestions, geoQuery)
    : null;
  const verifiedGeoTargets = requestedGeoUrns.length
    ? selectedGeoTargets.filter((item) => requestedGeoUrnSet.has(item.urn))
    : automaticGeoTarget ? [automaticGeoTarget] : [];
  const verifiedGeoUrns = verifiedGeoTargets.map((item) => item.urn);
  const localeSupported = supportedLocales.some((item) => item.language === language && item.country === country);
  const dailyBudget = Number.isFinite(input.dailyBudget) && Number(input.dailyBudget) > 0 ? Number(input.dailyBudget) : null;
  const requestedBidAmount = Number.isFinite(input.bidAmount) && Number(input.bidAmount) > 0 ? Number(input.bidAmount) : null;
  const [audiencePayload, pricingPayload] = verifiedGeoUrns.length && localeSupported
    ? await Promise.all([
      linkedInAdsRead(token, buildLinkedInAdsAudienceCountPath(verifiedGeoUrns, language, country), "audience_count"),
      dailyBudget !== null
        ? linkedInAdsRead(token, buildLinkedInAdsBudgetPricingPath({
          accountId: account.id, geoUrns: verifiedGeoUrns, language, country, dailyBudget,
        }), "budget_pricing")
        : Promise.resolve(null),
    ])
    : [null, null];
  const audienceCount = audiencePayload ? normalizeLinkedInAdsAudienceCount(audiencePayload) : null;
  const pricing = pricingPayload ? normalizeLinkedInAdsBudgetPricing(pricingPayload) : null;
  const bidAmount = recommendedLinkedInAdsBid(pricing, requestedBidAmount, dailyBudget);
  const developmentAccountMapped = allowedDevelopmentAccountIds().has(account.id);
  const blockers = linkedInAdsPreflightBlockers({
    scopes,
    accountCurrency: account.currency,
    canManageCampaigns: account.canManageCampaigns,
    canServeCampaigns: account.canServeCampaigns,
    targetStatus: "ACTIVE",
    campaignGroup: selectedGroup,
    image,
    organizationUrn: selectedOrganization?.urn || null,
    localeSupported,
    verifiedGeoUrns,
    audienceCount,
    pricing,
    bidAmount,
    dailyBudget,
    politicalIntentConfirmed: input.politicalIntentConfirmed === true,
    targetingNoticeAcknowledged: input.targetingNoticeAcknowledged === true,
  });
  if (!developmentAccountMapped) blockers.unshift("development_account_mapping_required");

  return {
    checkedAt: new Date().toISOString(),
    apiVersion: LINKEDIN_ADS_API_VERSION,
    account,
    developmentAccountMapped,
    scopes,
    campaignGroups,
    organizations,
    supportedLocales,
    geoSuggestions,
    selected: {
      campaignGroup: selectedGroup,
      organization: selectedOrganization,
      image,
      verifiedGeoUrns,
      verifiedGeoTargets,
      locale: { language, country, supported: localeSupported },
      audienceCount,
      pricing,
      bidAmount,
      dailyBudget,
    },
    blockers: [...new Set(blockers)],
    readyForRemoteDraft: blockers.length === 0,
    publicationEnabled: false,
  };
}
