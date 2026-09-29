import "server-only";

import { linkedInAdsScopes, LINKEDIN_ADS_API_VERSION } from "./adsLinkedInPolicy.ts";
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
  buildLinkedInAdsImagePath,
  buildLinkedInAdsLocalesPath,
  linkedInAdsPreflightBlockers,
  normalizeLinkedInAdsAudienceCount,
  normalizeLinkedInAdsBudgetPricing,
  normalizeLinkedInAdsCampaignGroups,
  normalizeLinkedInAdsImage,
  normalizeLinkedInAdsLocales,
  normalizeLinkedInAdsTargetingEntities,
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
  role: "ADMINISTRATOR" | "DIRECT_SPONSORED_CONTENT_POSTER";
};

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

async function linkedInAdsRead(accessToken: string, path: string): Promise<Record<string, unknown>> {
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
    throw new LinkedInAdsConnectionError("LinkedIn Ads n’a pas répondu au contrôle préalable.", "provider_unavailable");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const denied = response.status === 401 || response.status === 403;
    throw new LinkedInAdsConnectionError(
      denied ? "LinkedIn refuse ce contrôle préalable. Reconnectez le canal et vérifiez les scopes et rôles."
        : "Le contrôle préalable LinkedIn Ads est indisponible.",
      denied ? "preflight_access_denied" : "provider_unavailable",
      denied ? 403 : 503,
    );
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new LinkedInAdsConnectionError("Réponse de préflight LinkedIn Ads invalide.", "provider_invalid_response");
  }
  return payload as Record<string, unknown>;
}

function normalizeOrganizationAccess(payload: unknown): OrganizationAccess[] | null {
  const elements = record(payload).elements;
  if (!Array.isArray(elements) || elements.length > 500) return null;
  const found = new Map<string, OrganizationAccess>();
  for (const value of elements) {
    const row = record(value);
    if (row.state !== "APPROVED") continue;
    const role = text(row.role);
    if (role !== "ADMINISTRATOR" && role !== "DIRECT_SPONSORED_CONTENT_POSTER") continue;
    const urn = text(row.organization) || text(row.organizationTarget);
    if (!ORGANIZATION_URN.test(urn)) return null;
    found.set(urn, { urn, role });
  }
  return [...found.values()];
}

async function listOrganizationAccess(accessToken: string): Promise<OrganizationAccess[]> {
  const payload = await linkedInAdsRead(accessToken, "/rest/organizationAcls?q=roleAssignee&state=APPROVED&count=500&start=0");
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
  const [groupsPayload, localesPayload, geosPayload, organizations, imagePayload] = await Promise.all([
    linkedInAdsRead(token, buildLinkedInAdsCampaignGroupsPath(account.id)),
    linkedInAdsRead(token, buildLinkedInAdsLocalesPath()),
    geoQuery.length >= 2 ? linkedInAdsRead(token, buildLinkedInAdsGeoSearchPath(geoQuery, language, country)) : Promise.resolve({ elements: [] }),
    hasOrganizationRead ? listOrganizationAccess(token) : Promise.resolve([]),
    input.imageUrn ? linkedInAdsRead(token, buildLinkedInAdsImagePath(input.imageUrn)) : Promise.resolve(null),
  ]);

  const campaignGroups = normalizeLinkedInAdsCampaignGroups(groupsPayload, account.id);
  const supportedLocales = normalizeLinkedInAdsLocales(localesPayload);
  const geoSuggestions = normalizeLinkedInAdsTargetingEntities(geosPayload);
  if (!campaignGroups || !supportedLocales || !geoSuggestions) {
    throw new LinkedInAdsConnectionError("Ressources LinkedIn Ads incohérentes.", "provider_invalid_response");
  }
  const selectedGroup: LinkedInAdsCampaignGroup | null = input.campaignGroupId
    ? campaignGroups.find((item) => item.id === input.campaignGroupId) || null : null;
  const selectedOrganization = input.organizationUrn
    ? organizations.find((item) => item.urn === input.organizationUrn) || null : null;
  const image: LinkedInAdsImageEvidence | null = input.imageUrn && imagePayload
    ? normalizeLinkedInAdsImage(imagePayload, input.imageUrn) : null;
  if (input.imageUrn && !image) {
    throw new LinkedInAdsConnectionError("Le média LinkedIn ne peut pas être vérifié.", "image_invalid", 422);
  }
  const requestedGeoUrns = Array.isArray(input.geoUrns)
    ? [...new Set(input.geoUrns.filter((urn) => /^urn:li:geo:\d{1,25}$/.test(urn)))] : [];
  const suggestedGeoUrns = new Set(geoSuggestions.map((item) => item.urn));
  const verifiedGeoUrns = requestedGeoUrns.filter((urn) => suggestedGeoUrns.has(urn));
  const localeSupported = supportedLocales.some((item) => item.language === language && item.country === country);
  const dailyBudget = Number.isFinite(input.dailyBudget) && Number(input.dailyBudget) > 0 ? Number(input.dailyBudget) : null;
  const bidAmount = Number.isFinite(input.bidAmount) && Number(input.bidAmount) > 0 ? Number(input.bidAmount) : null;
  const [audiencePayload, pricingPayload] = verifiedGeoUrns.length && localeSupported
    ? await Promise.all([
      linkedInAdsRead(token, buildLinkedInAdsAudienceCountPath(verifiedGeoUrns, language, country)),
      dailyBudget !== null
        ? linkedInAdsRead(token, buildLinkedInAdsBudgetPricingPath({
          accountId: account.id, geoUrns: verifiedGeoUrns, language, country, dailyBudget,
        }))
        : Promise.resolve(null),
    ])
    : [null, null];
  const audienceCount = audiencePayload ? normalizeLinkedInAdsAudienceCount(audiencePayload) : null;
  const pricing = pricingPayload ? normalizeLinkedInAdsBudgetPricing(pricingPayload) : null;
  const developmentAccountMapped = allowedDevelopmentAccountIds().has(account.id);
  const blockers = linkedInAdsPreflightBlockers({
    scopes,
    accountCurrency: account.currency,
    canManageCampaigns: account.canManageCampaigns,
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
