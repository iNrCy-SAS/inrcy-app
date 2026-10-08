import "server-only";
import { resolveLinkedInAdsGeoTargets } from "./adsLinkedInGeoResolution.ts";

import { normalizeLinkedInDeliverySettings, linkedInDeliveryBidding, type LinkedInDeliverySettings } from "./adsLinkedInCampaignSettings.ts";
import { resolveLinkedInAdsProfessionalTargets, resolveLinkedInAdsConversions } from "./adsLinkedInResourcesServer.ts";
import { linkedInAdsCampaignScheduleIssues } from "./adsLinkedInPublish.ts";
import { linkedInAdsScopes, LINKEDIN_ADS_API_VERSION } from "./adsLinkedInPolicy.ts";
import { linkedInAdsContextualGeoDefaults } from "./adsLinkedInClientDefaults.ts";
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
  buildLinkedInAdsGeoSearchMinimalPath,
  buildLinkedInAdsGeoSearchPath,
  buildLinkedInAdsGeoUrnsPath,
  buildLinkedInAdsImagePath,
  buildLinkedInAdsLocalesPath,
  selectLinkedInAdsCampaignGroup,
  linkedInAdsPreflightBlockers,
  normalizeLinkedInAdsGeoQueries,
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
  type LinkedInAdsTargetingEntity,
} from "./adsLinkedInPreflightPolicy.ts";

const LINKEDIN_REST_ORIGIN = "https://api.linkedin.com";
const ORGANIZATION_URN = /^urn:li:organization:\d{1,25}$/;

export type LinkedInAdsPreflightInput = {
  geoQuery?: string;
  geoQueries?: string[];
  language?: string;
  country?: string;
  campaignGroupId?: string;
  organizationUrn?: string;
  imageUrn?: string;
  geoUrns?: string[];
  bidAmount?: number;
  dailyBudget?: number;
  objectiveType?: string;
  format?: string;
  deliverySettings?: LinkedInDeliverySettings;
  endDate?: string;
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
  | "geo_typeahead_minimal"
  | "geo_urn_resolution"
  | "professional_target_resolution"
  | "conversion_resolution"
  | "organization_access"
  | "image"
  | "audience_count"
  | "budget_pricing";

/** Provider details are limited to a numeric code and a bounded request ID. */
export class LinkedInAdsPreflightProviderError extends LinkedInAdsConnectionError {
  constructor(
    message: string,
    code: string,
    status: number,
    readonly operation: LinkedInAdsPreflightOperation,
    readonly providerStatus: number | null,
    readonly providerCode: number | null = null,
    readonly providerRequestId: string | null = null,
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
    || operation === "geo_typeahead_minimal"
    ? "preflight_geo_typeahead_rejected"
    : `preflight_${operation}_rejected`;
}

function providerDiagnostic(payload: unknown, headers: Headers) {
  const rawCode = record(payload).code;
  const providerCode = typeof rawCode === "number" && Number.isSafeInteger(rawCode)
    && rawCode >= 0 && rawCode <= 999_999 ? rawCode : null;
  const rawRequestId = headers.get("x-li-uuid") || headers.get("x-li-request-id") || "";
  const providerRequestId = /^[A-Za-z0-9+/_=-]{8,128}$/.test(rawRequestId) ? rawRequestId : null;
  return { providerCode, providerRequestId };
}

function providerHttpError(
  operation: LinkedInAdsPreflightOperation,
  providerStatus: number,
  payload: unknown,
  headers: Headers,
): LinkedInAdsPreflightProviderError {
  const { providerCode, providerRequestId } = providerDiagnostic(payload, headers);
  if (providerStatus === 401 || providerStatus === 403) {
    return new LinkedInAdsPreflightProviderError(
      "LinkedIn refuse ce contrôle préalable. Reconnectez le canal et vérifiez les scopes et rôles.",
      "preflight_access_denied",
      403,
      operation,
      providerStatus,
      providerCode,
      providerRequestId,
    );
  }
  if (providerStatus === 400) {
    return new LinkedInAdsPreflightProviderError(
      "LinkedIn Ads a refusé une lecture du contrôle préalable.",
      rejectedOperationCode(operation),
      502,
      operation,
      providerStatus,
      providerCode,
      providerRequestId,
    );
  }
  if (providerStatus === 429) {
    return new LinkedInAdsPreflightProviderError(
      "LinkedIn Ads limite temporairement les contrôles préalables.",
      "preflight_provider_rate_limited",
      503,
      operation,
      providerStatus,
      providerCode,
      providerRequestId,
    );
  }
  return new LinkedInAdsPreflightProviderError(
    "Le contrôle préalable LinkedIn Ads est indisponible.",
    "provider_unavailable",
    providerStatus >= 500 ? 503 : 502,
    operation,
    providerStatus,
    providerCode,
    providerRequestId,
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
  if (!response.ok) throw providerHttpError(operation, response.status, payload, response.headers);
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
  }
  try {
    return await linkedInAdsRead(input.accessToken, buildLinkedInAdsGeoSearchPath({
      query: input.query, accountId: input.accountId,
    }), "geo_typeahead_default_locale");
  } catch (error) {
    if (!(error instanceof LinkedInAdsPreflightProviderError)
      || error.operation !== "geo_typeahead_default_locale" || error.providerStatus !== 400) throw error;
    log.warn("linkedin_ads_preflight_geo_minimal_fallback", {
      provider: "linkedin",
      operation: error.operation,
      provider_status: error.providerStatus,
      fallback_operation: "geo_typeahead_minimal",
    });
  }
  return linkedInAdsRead(input.accessToken, buildLinkedInAdsGeoSearchMinimalPath(input.query), "geo_typeahead_minimal");
}

type LinkedInAdsGeoSuggestionRead =
  | { payload: Record<string, unknown>; rejected: false }
  | { error: LinkedInAdsPreflightProviderError; rejected: true };

async function readLinkedInAdsGeoSuggestionGroups(input: {
  accessToken: string;
  accountId: string;
  queries: string[];
  language: string;
  country: string;
}): Promise<LinkedInAdsGeoSuggestionRead[]> {
  const results: LinkedInAdsGeoSuggestionRead[] = [];
  // Bound provider concurrency while preserving the query order for per-zone resolution.
  for (let index = 0; index < input.queries.length; index += 4) {
    const batch = await Promise.all(input.queries.slice(index, index + 4).map(async (query): Promise<LinkedInAdsGeoSuggestionRead> => {
      try {
        return { payload: await readLinkedInAdsGeoSuggestions({ ...input, query }), rejected: false };
      } catch (error) {
        if (error instanceof LinkedInAdsPreflightProviderError
          && error.operation === "geo_typeahead_minimal" && error.providerStatus === 400) {
          return { error, rejected: true };
        }
        throw error;
      }
    }));
    results.push(...batch);
  }
  const rejected = results.filter((result): result is Extract<LinkedInAdsGeoSuggestionRead, { rejected: true }> =>
    result.rejected);
  if (rejected.length === results.length && rejected.length) throw rejected[0].error;
  if (rejected.length) log.warn("linkedin_ads_preflight_geo_partial_rejected", {
    provider: "linkedin",
    operation: "geo_typeahead_minimal",
    rejected_count: rejected.length,
    successful_count: results.length - rejected.length,
  });
  return results;
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
  const parsedDelivery = normalizeLinkedInDeliverySettings(input.deliverySettings);
  const deliverySettings = parsedDelivery.settings || undefined;
  const objectiveType = input.objectiveType || "WEBSITE_VISIT";
  if (parsedDelivery.error || !linkedInDeliveryBidding(objectiveType, deliverySettings) || (input.format && !["STANDARD_UPDATE", "SINGLE_VIDEO"].includes(input.format))) throw new LinkedInAdsConnectionError(parsedDelivery.error || "Objectif, format ou enchères LinkedIn incompatibles.", "unsupported_delivery_settings", 422);
  const integration = await readLinkedInAdsIntegration(userId);
  if (!integration?.resource_id) {
    throw new LinkedInAdsConnectionError("Associez d’abord un compte LinkedIn Ads.", "account_selection_required", 409);
  }
  const accounts = await listLinkedInAdsAccounts(userId, integration);
  const currentIntegration = await readLinkedInAdsIntegration(userId);
  if (!currentIntegration || currentIntegration.resource_id !== integration.resource_id || currentIntegration.id !== integration.id || currentIntegration.provider_account_id !== integration.provider_account_id) throw new LinkedInAdsConnectionError("La connexion LinkedIn a changé pendant le contrôle. Relancez la vérification.", "connection_changed", 409);
  const { token, scopes: rawScopes } = await linkedInAdsAuthorization(userId, currentIntegration);
  const scopes = linkedInAdsScopes(rawScopes);
  const account = accounts.find((item) => item.id === integration.resource_id);
  if (!account) throw new LinkedInAdsConnectionError("Le compte LinkedIn Ads associé n’est plus accessible.", "account_access_denied", 403);

  const language = /^[a-z]{2}$/.test(input.language || "") ? input.language! : "fr";
  const country = /^[A-Z]{2}$/.test(input.country || "") ? input.country! : "FR";
  const geoQueries = normalizeLinkedInAdsGeoQueries([
    ...(Array.isArray(input.geoQueries) ? input.geoQueries : []),
    ...(input.geoQuery ? [input.geoQuery] : []),
  ]);
  const hasOrganizationRead = scopes.includes("r_organization_admin") || scopes.includes("rw_organization_admin");
  const requestedGeoUrns = Array.isArray(input.geoUrns)
    ? [...new Set(input.geoUrns.filter((urn) => /^urn:li:geo:\d{1,25}$/.test(urn)))] : [];
  const [groupsPayload, localesPayload, geoReads, selectedGeosPayload, organizations, imagePayload] = await Promise.all([
    linkedInAdsRead(token, buildLinkedInAdsCampaignGroupsPath(account.id), "campaign_groups"),
    linkedInAdsRead(token, buildLinkedInAdsLocalesPath(), "interface_locales"),
    readLinkedInAdsGeoSuggestionGroups({
      accessToken: token, accountId: account.id, queries: geoQueries, language, country,
    }),
    requestedGeoUrns.length
      ? linkedInAdsRead(token, buildLinkedInAdsGeoUrnsPath(requestedGeoUrns, language, country), "geo_urn_resolution").catch((error: unknown) => {
        if (!(error instanceof LinkedInAdsPreflightProviderError) || error.providerStatus !== 400) throw error;
        log.warn("linkedin_ads_preflight_geo_urn_fallback", { provider: "linkedin", operation: "geo_urn_resolution", provider_status: 400 });
        return { elements: [] };
      })
      : Promise.resolve({ elements: [] }),
    hasOrganizationRead ? listOrganizationAccess(token) : Promise.resolve([]),
    input.imageUrn ? linkedInAdsRead(token, buildLinkedInAdsImagePath(input.imageUrn), "image") : Promise.resolve(null),
  ]);

  const campaignGroups = normalizeLinkedInAdsCampaignGroups(groupsPayload, account.id);
  const supportedLocales = normalizeLinkedInAdsLocales(localesPayload);
  if (!campaignGroups) throw new LinkedInAdsPreflightProviderError(
    "Groupes de campagnes LinkedIn Ads incohérents.", "provider_invalid_response", 502, "campaign_groups", 200,
  );
  if (!supportedLocales) throw new LinkedInAdsPreflightProviderError(
    "Langues LinkedIn Ads incohérentes.", "provider_invalid_response", 502, "interface_locales", 200,
  );
  const geoSuggestionGroups: LinkedInAdsTargetingEntity[][] = [];
  for (const read of geoReads) {
    if (read.rejected) {
      geoSuggestionGroups.push([]);
      continue;
    }
    const suggestions = normalizeLinkedInAdsTargetingEntities(read.payload);
    if (!suggestions) throw new LinkedInAdsConnectionError("Zones LinkedIn Ads incohérentes.", "provider_invalid_response");
    geoSuggestionGroups.push(suggestions);
  }
  const geoSuggestions = [...new Map(geoSuggestionGroups.flat()
    .map((target) => [target.urn, target] as const)).values()];
  const selectedGeoTargets = await resolveLinkedInAdsGeoTargets({
    targets: requestedGeoUrns.map((urn) => ({ urn, name: geoSuggestions.find((target) => target.urn === urn)?.name || "" })),
    language,
    country,
    resolvedPayload: selectedGeosPayload,
    freshSuggestions: geoSuggestions,
    read: (path) => linkedInAdsRead(token, path, "geo_urn_resolution"),
  });
  const selectedOrganization = input.organizationUrn
    ? organizations.find((item) => item.urn === input.organizationUrn) || null
    : organizations.length === 1 ? organizations[0] : null;
  const nowMs = Date.now();
  const endAtMs = deliverySettings?.budget.endAt ? Date.parse(deliverySettings.budget.endAt)
    : input.endDate ? Date.parse(`${input.endDate}T23:59:59Z`) : undefined;
  const selectedGroup = selectLinkedInAdsCampaignGroup(campaignGroups, {
    selectedId: input.campaignGroupId,
    objectiveType,
    organizationUrn: selectedOrganization?.urn || input.organizationUrn,
    scheduleIsCompatible: (group) => {
      const startAtMs = deliverySettings?.budget.startAt ? Date.parse(deliverySettings.budget.startAt)
        : Math.max(nowMs + 5 * 60_000, group.runSchedule.start || 0);
      return linkedInAdsCampaignScheduleIssues({ startAtMs, endAtMs, groupSchedule: group.runSchedule, nowMs }).length === 0
        && (endAtMs === undefined || endAtMs <= nowMs + 90 * 86_400_000)
        && (deliverySettings?.budget.type !== "total" || endAtMs !== undefined);
    },
  });
  const image: LinkedInAdsImageEvidence | null = input.imageUrn && imagePayload
    ? normalizeLinkedInAdsImage(imagePayload, input.imageUrn) : null;
  if (input.imageUrn && !image) {
    throw new LinkedInAdsConnectionError("Le média LinkedIn ne peut pas être vérifié.", "image_invalid", 422);
  }
  const requestedGeoUrnSet = new Set(requestedGeoUrns);
  const explicitGeoTargets = selectedGeoTargets.filter((item) => requestedGeoUrnSet.has(item.urn));
  const automaticGeoTargets: LinkedInAdsTargetingEntity[] = [];
  const geoResolutions = geoQueries.map((query, index) => {
    const suggestions = geoSuggestionGroups[index];
    const status = geoReads[index].rejected ? "provider_rejected" as const : "ok" as const;
    const chosenFromSuggestions = suggestions.find((item) => requestedGeoUrnSet.has(item.urn));
    const automatic = status === "ok" && !chosenFromSuggestions
      ? selectUnambiguousLinkedInAdsGeoTarget(suggestions, query) : null;
    if (automatic) automaticGeoTargets.push(automatic);
    return { query, suggestions, autoSelectedUrn: automatic?.urn || null, status };
  });
  // LinkedIn can return homonymous cities in several countries. Resolve an
  // otherwise ambiguous city when the other verified locations establish one
  // common region and country; every chosen URN still comes from LinkedIn.
  const contextualGeoUrns = new Set(linkedInAdsContextualGeoDefaults({
    targetLocations: geoQueries,
    verifiedGeoTargets: [...explicitGeoTargets, ...automaticGeoTargets],
    geoResolutions,
  }).map((target) => target.urn));
  const alreadyVerifiedGeoUrns = new Set([...explicitGeoTargets, ...automaticGeoTargets].map((target) => target.urn));
  for (const suggestion of geoSuggestions) {
    if (contextualGeoUrns.has(suggestion.urn) && !alreadyVerifiedGeoUrns.has(suggestion.urn)) {
      automaticGeoTargets.push(suggestion);
      alreadyVerifiedGeoUrns.add(suggestion.urn);
    }
  }
  for (const resolution of geoResolutions) {
    if (resolution.autoSelectedUrn || resolution.status === "provider_rejected") continue;
    const selected = resolution.suggestions.filter((target) =>
      automaticGeoTargets.some((automatic) => automatic.urn === target.urn));
    if (selected.length === 1) resolution.autoSelectedUrn = selected[0].urn;
  }
  const verifiedGeoTargets = [...new Map([...explicitGeoTargets, ...automaticGeoTargets]
    .map((target) => [target.urn, target] as const)).values()];
  const verifiedGeoUrns = verifiedGeoTargets.map((item) => item.urn);
  const verifiedGeoUrnSet = new Set(verifiedGeoUrns);
  const resolvedExplicitGeoUrns = new Set(explicitGeoTargets.map((item) => item.urn));
  const selectedGeoUnverified = requestedGeoUrns.some((urn) => !resolvedExplicitGeoUrns.has(urn));
  if (selectedGeoUnverified) log.warn("linkedin_ads_preflight_geo_urn_unverified", {
    provider: "linkedin",
    operation: "geo_urn_resolution",
    requested_count: requestedGeoUrns.length,
    verified_count: resolvedExplicitGeoUrns.size,
  });
  const unresolvedGeoQueries = geoResolutions.some(({ suggestions, autoSelectedUrn }) =>
    !autoSelectedUrn && !suggestions.some((item) => verifiedGeoUrnSet.has(item.urn)));
  const tooManyGeoTargets = verifiedGeoUrns.length > 20;
  const localeSupported = supportedLocales.some((item) => item.language === language && item.country === country);
  const [professionalResolution, conversionResolution] = await Promise.all([
    resolveLinkedInAdsProfessionalTargets({ accessToken: token, targets: [...(deliverySettings?.professionalTargeting.include || []), ...(deliverySettings?.professionalTargeting.exclude || [])], language, country, read: (path) => linkedInAdsRead(token, path, "professional_target_resolution") }),
    resolveLinkedInAdsConversions({ accessToken: token, accountId: account.id, conversionUrns: deliverySettings?.conversions.conversionUrns || [], read: (path) => linkedInAdsRead(token, path, "conversion_resolution") }),
  ]);
  const startAtMs = deliverySettings?.budget.startAt ? Date.parse(deliverySettings.budget.startAt) : Math.max(nowMs + 5 * 60_000, selectedGroup?.runSchedule.start || 0);
  const scheduleDays = endAtMs === undefined ? undefined : Math.ceil((endAtMs - startAtMs) / 86_400_000);
  const dailyBudget = Number.isFinite(input.dailyBudget) && Number(input.dailyBudget) > 0 ? Number(input.dailyBudget) : null;
  const requestedBidAmount = Number.isFinite(input.bidAmount) && Number(input.bidAmount) > 0 ? Number(input.bidAmount) : null;
  const [audiencePayload, pricingPayload] = verifiedGeoUrns.length && !tooManyGeoTargets && localeSupported
    ? await Promise.all([
      linkedInAdsRead(token, buildLinkedInAdsAudienceCountPath(verifiedGeoUrns, language, country, deliverySettings), "audience_count"),
      (dailyBudget !== null || deliverySettings?.budget.type === "total")
        ? linkedInAdsRead(token, buildLinkedInAdsBudgetPricingPath({
          accountId: account.id, geoUrns: verifiedGeoUrns, language, country, dailyBudget: deliverySettings?.budget.type === "total" ? undefined : dailyBudget!, objectiveType, deliverySettings,
        }), "budget_pricing")
        : Promise.resolve(null),
    ])
    : [null, null];
  const audienceCount = audiencePayload ? normalizeLinkedInAdsAudienceCount(audiencePayload) : null;
  const pricing = pricingPayload ? normalizeLinkedInAdsBudgetPricing(pricingPayload) : null;
  const bidAmount = deliverySettings?.bidding.strategy === "maximum_delivery" ? null : recommendedLinkedInAdsBid(pricing, deliverySettings?.bidding.amountEuros ?? requestedBidAmount, deliverySettings?.budget.type === "total" ? deliverySettings.budget.totalEuros : dailyBudget);
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
    dailyBudget, objectiveType, deliverySettings, totalBudget: deliverySettings?.budget.totalEuros, scheduleDays,
    politicalIntentConfirmed: input.politicalIntentConfirmed === true,
    targetingNoticeAcknowledged: input.targetingNoticeAcknowledged === true,
  });
  if (professionalResolution.unresolvedTargets.length) blockers.push("selected_professional_targets_unverified");
  if (conversionResolution.unresolvedUrns.length) blockers.push("selected_conversion_unverified");
  if (objectiveType === "WEBSITE_CONVERSION" && !conversionResolution.verifiedConversions.length) blockers.push("conversion_required");
  if ((endAtMs !== undefined || deliverySettings?.budget.type === "total") && (linkedInAdsCampaignScheduleIssues({ startAtMs, endAtMs, groupSchedule: selectedGroup?.runSchedule || {}, nowMs }).length || (endAtMs !== undefined && endAtMs > nowMs + 90 * 86_400_000) || (deliverySettings?.budget.type === "total" && endAtMs === undefined))) blockers.push("campaign_schedule_invalid");
  if (!developmentAccountMapped) blockers.unshift("development_account_mapping_required");
  if (selectedGeoUnverified) blockers.push("selected_geo_unverified");
  if (unresolvedGeoQueries) blockers.push("unresolved_geo_queries");
  if (geoResolutions.some((resolution) => resolution.status === "provider_rejected")) blockers.push("geo_query_provider_rejected");
  if (tooManyGeoTargets) blockers.push("too_many_geo_targets");

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
    geoResolutions,
    selected: {
      campaignGroup: selectedGroup,
      organization: selectedOrganization,
      image,
      verifiedGeoUrns,
      verifiedGeoTargets,
      verifiedProfessionalTargets: professionalResolution.verifiedTargets,
      verifiedConversions: conversionResolution.verifiedConversions,
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
