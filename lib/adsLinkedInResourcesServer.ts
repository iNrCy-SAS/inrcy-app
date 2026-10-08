import "server-only";

import {
  LinkedInAdsConnectionError,
  linkedInAdsAuthorization,
  listLinkedInAdsAccounts,
  readLinkedInAdsIntegration,
  readLinkedInAdsResourceJson,
} from "./adsLinkedInServer.ts";
import {
  LINKEDIN_ADS_PROFESSIONAL_FACETS,
  buildLinkedInAdsConversionsPath,
  buildLinkedInAdsProfessionalSearchPath,
  buildLinkedInAdsProfessionalUrnsPath,
  isLinkedInAdsConversionUrn,
  isLinkedInAdsProfessionalFacet,
  isLinkedInAdsProfessionalUrn,
  linkedInAdsProfessionalNameMatches,
  normalizeLinkedInAdsConversionOptions,
  normalizeLinkedInAdsProfessionalTargets,
  normalizeLinkedInAdsResourcePaging,
  type LinkedInAdsConversionOption,
  type LinkedInAdsProfessionalFacet,
  type LinkedInAdsProfessionalTarget,
} from "./adsLinkedInResourcesPolicy.ts";
import { isLinkedInAdsAccountId } from "./adsLinkedInPolicy.ts";

function invalidResources(): never {
  throw new LinkedInAdsConnectionError("Réponse des ressources LinkedIn Ads invalide.", "provider_invalid_response", 502);
}

/** Rechecks owner-scoped OAuth and live account membership before every UI resource read. */
async function resourceContext(userId: string, requestedAccountId?: string) {
  const integration = await readLinkedInAdsIntegration(userId);
  const accountId = requestedAccountId || integration?.resource_id || "";
  if (!isLinkedInAdsAccountId(accountId)) {
    throw new LinkedInAdsConnectionError("Sélectionnez un compte LinkedIn Ads.", "account_selection_required", 409);
  }
  const accounts = await listLinkedInAdsAccounts(userId, integration);
  if (!accounts.some((account) => account.id === accountId)) {
    throw new LinkedInAdsConnectionError("Ce compte LinkedIn Ads n’est plus accessible.", "account_access_denied", 403);
  }
  // Account discovery may refresh/rotate the token. Never authorize again from
  // its old snapshot, and never combine membership evidence with another member.
  const currentIntegration = await readLinkedInAdsIntegration(userId);
  if (!currentIntegration || currentIntegration.id !== integration?.id
    || currentIntegration.provider_account_id !== integration?.provider_account_id) {
    throw new LinkedInAdsConnectionError("La connexion LinkedIn Ads a changé ; rechargez les ressources.", "connection_changed", 409);
  }
  const { token } = await linkedInAdsAuthorization(userId, currentIntegration);
  return { accountId, accessToken: token };
}

export async function listLinkedInAdsProfessionalTargets(userId: string, input: {
  accountId?: string; facet?: LinkedInAdsProfessionalFacet; query?: string;
  language?: string; country?: string; start?: number; count?: number;
} = {}) {
  // Build/validate before querying integrations, including for internal callers.
  const path = input.facet ? buildLinkedInAdsProfessionalSearchPath({ ...input, facet: input.facet }) : null;
  const context = await resourceContext(userId, input.accountId);
  if (!path || !input.facet) return { accountId: context.accountId, facets: LINKEDIN_ADS_PROFESSIONAL_FACETS, targets: [] };
  const payload = await readLinkedInAdsResourceJson(context.accessToken, path);
  const nativeTargets = normalizeLinkedInAdsProfessionalTargets(payload, input.facet);
  if (!nativeTargets) invalidResources();
  const query = (input.query || "").trim();
  const targets = query && ["seniorities", "companySizes", "functions"].includes(input.facet)
    ? nativeTargets.filter((target) => linkedInAdsProfessionalNameMatches(target.name, query)) : nativeTargets;
  return {
    accountId: context.accountId, facet: input.facet, targets,
    paging: normalizeLinkedInAdsResourcePaging(payload, (payload.elements as unknown[]).length, input.start),
  };
}

export async function listLinkedInAdsConversions(userId: string, input: { accountId?: string; start?: number; count?: number } = {}) {
  if (input.accountId !== undefined) buildLinkedInAdsConversionsPath(input.accountId, input.start, input.count);
  const context = await resourceContext(userId, input.accountId);
  const payload = await readLinkedInAdsResourceJson(context.accessToken, buildLinkedInAdsConversionsPath(context.accountId, input.start, input.count));
  const options = normalizeLinkedInAdsConversionOptions(payload, context.accountId);
  if (!options) invalidResources();
  return { accountId: context.accountId, options, paging: normalizeLinkedInAdsResourcePaging(payload, (payload.elements as unknown[]).length, input.start) };
}

/** Resolves exact facet+URN pairs afresh. The caller must already authorize the account/token. */
export async function resolveLinkedInAdsProfessionalTargets(input: {
  accessToken: string; targets: LinkedInAdsProfessionalTarget[]; language?: string; country?: string;
  read?: (path: string) => Promise<unknown>;
}) {
  if (!Array.isArray(input.targets) || input.targets.length > 100 || input.targets.some((target) =>
    !target || !isLinkedInAdsProfessionalFacet(target.facet) || !isLinkedInAdsProfessionalUrn(target.facet, target.urn))) {
    throw new TypeError("Invalid LinkedIn professional selection");
  }
  const targets = [...new Map(input.targets.map((target) => [`${target.facet}:${target.urn}`, target])).values()];
  if (!targets.length) return { verifiedTargets: [] as LinkedInAdsProfessionalTarget[], unresolvedTargets: [] as LinkedInAdsProfessionalTarget[] };
  const read = (path: string) => input.read ? input.read(path) : readLinkedInAdsResourceJson(input.accessToken, path);
  const nativeByIdentity = new Map<string, LinkedInAdsProfessionalTarget>();
  const addEvidence = (payload: unknown, facet?: LinkedInAdsProfessionalFacet) => {
    const nativeTargets = normalizeLinkedInAdsProfessionalTargets(payload, facet);
    if (!nativeTargets) invalidResources();
    for (const target of nativeTargets) nativeByIdentity.set(`${target.facet}:${target.urn}`, target);
  };
  // Small batches also keep range URNs and encoded REST.li lists well below proxy URL limits.
  for (let offset = 0; offset < targets.length; offset += 20) {
    try {
      addEvidence(await read(buildLinkedInAdsProfessionalUrnsPath(targets.slice(offset, offset + 20), input.language, input.country)));
    } catch (error) {
      // Only an explicit provider HTTP 400 from this URN finder may use the
      // documented facet finder below. Authorization, rate limits, malformed
      // responses and transport failures must retain their original diagnostics.
      if (!error || typeof error !== "object" || !("providerStatus" in error) || error.providerStatus !== 400) throw error;
    }
  }
  // Some URNs have several facet representations (for example current/past/all
  // titles). Only an exact current-facet row from a fresh facet finder proves the choice.
  const searches = new Map<string, { facet: LinkedInAdsProfessionalFacet; query?: string }>();
  for (const target of targets) {
    if (nativeByIdentity.has(`${target.facet}:${target.urn}`)) continue;
    const query = typeof target.name === "string" ? target.name.trim().slice(0, 80) : "";
    if (["titles", "skills", "industries"].includes(target.facet) && query.length >= 2) {
      searches.set(`${target.facet}:${query}`, { facet: target.facet, query });
    } else if (target.facet !== "titles" && target.facet !== "skills") {
      searches.set(target.facet, { facet: target.facet });
    }
  }
  const fallbackSearches = [...searches.values()];
  for (let offset = 0; offset < fallbackSearches.length; offset += 4) {
    const batch = fallbackSearches.slice(offset, offset + 4);
    const payloads = await Promise.all(batch.map((search) => read(buildLinkedInAdsProfessionalSearchPath({
      ...search, language: input.language, country: input.country,
    }))));
    for (let index = 0; index < batch.length; index += 1) addEvidence(payloads[index], batch[index].facet);
  }
  const verifiedTargets: LinkedInAdsProfessionalTarget[] = [];
  const unresolvedTargets: LinkedInAdsProfessionalTarget[] = [];
  for (const target of targets) {
    const verified = nativeByIdentity.get(`${target.facet}:${target.urn}`);
    if (verified) verifiedTargets.push(verified);
    else unresolvedTargets.push(target);
  }
  return { verifiedTargets, unresolvedTargets };
}

/** Only enabled rules returned by the current account finder can authorize association. */
export async function resolveLinkedInAdsConversions(input: {
  accessToken: string; accountId: string; conversionUrns: string[]; read?: (path: string) => Promise<unknown>;
}) {
  if (!isLinkedInAdsAccountId(input.accountId) || !Array.isArray(input.conversionUrns)
    || input.conversionUrns.length > 100 || input.conversionUrns.some((urn) => !isLinkedInAdsConversionUrn(urn))) {
    throw new TypeError("Invalid LinkedIn conversion selection");
  }
  const conversionUrns = [...new Set(input.conversionUrns)];
  if (!conversionUrns.length) return { verifiedConversions: [] as LinkedInAdsConversionOption[], unresolvedUrns: [] as string[] };
  const found = new Map<string, LinkedInAdsConversionOption>();
  const wanted = new Set(conversionUrns);
  const count = 100;
  for (let start = 0; start < 1_000;) {
    const path = buildLinkedInAdsConversionsPath(input.accountId, start, count);
    const payload = await (input.read ? input.read(path) : readLinkedInAdsResourceJson(input.accessToken, path));
    const options = normalizeLinkedInAdsConversionOptions(payload, input.accountId);
    if (!options) invalidResources();
    for (const option of options) {
      const previous = found.get(option.urn);
      if (previous && JSON.stringify(previous) !== JSON.stringify(option)) invalidResources();
      found.set(option.urn, option);
    }
    const elements = (payload as Record<string, unknown>).elements as unknown[];
    const paging = normalizeLinkedInAdsResourcePaging(payload, elements.length, start);
    const providerPaging = (payload as Record<string, unknown>).paging;
    const providerCount = providerPaging && typeof providerPaging === "object"
      ? (providerPaging as Record<string, unknown>).count : undefined;
    const nativePageSize = typeof providerCount === "number" && Number.isSafeInteger(providerCount) && providerCount > 0
      ? providerCount : count;
    if (paging.start !== start || (paging.hasMore && elements.length === 0)) invalidResources();
    if ([...wanted].every((urn) => found.has(urn)) || (!paging.hasMore && elements.length < nativePageSize)) break;
    if (paging.total !== undefined && start + elements.length >= paging.total) break;
    if (start + elements.length >= 1_000) {
      throw new LinkedInAdsConnectionError("Trop de conversions LinkedIn pour vérifier cette sélection.", "conversion_lookup_limit", 409);
    }
    if (!elements.length) break;
    start += elements.length;
  }
  const verifiedConversions = conversionUrns.map((urn) => found.get(urn)).filter((option): option is LinkedInAdsConversionOption => option?.enabled === true);
  const verified = new Set(verifiedConversions.map((option) => option.urn));
  return { verifiedConversions, unresolvedUrns: conversionUrns.filter((urn) => !verified.has(urn)) };
}
