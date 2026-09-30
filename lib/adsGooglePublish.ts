import "server-only";

import { randomUUID } from "node:crypto";
import { normalizeGoogleTargetLocationLabels } from "@/lib/adsGoogleLocations";
import { googleAdsJson } from "@/lib/adsServer";
import { googleSearchBiddingFields } from "@/lib/adsPublishMode";
import type { AdsCampaignInput } from "@/lib/adsValidation";

/**
 * Google Ads Search is the first supported format. The campaign, ad group,
 * keywords and ad are created atomically and PAUSED. Persist their IDs before
 * any activation call.
 *
 * The account pays Google directly; this module never charges the user in iNrCy.
 */
export type GoogleAdsPublishProgress = {
  customerId: string;
  budgetResourceName: string;
  campaignResourceName: string;
  /** Kept for compatibility with already stored publication progress. */
  locationCriterionResourceName: string;
  locationCriterionResourceNames: string[];
  languageCriterionResourceNames: string[];
  negativeKeywordCriterionResourceNames: string[];
  adGroupResourceName: string;
  keywordCriterionResourceNames: string[];
  adGroupAdResourceName: string;
  status: "PAUSED" | "ENABLED";
  /** Only a first launch may enable the children created paused by this publisher. */
  initialActivationPending: boolean;
};

export type PersistGoogleAdsProgress = (progress: GoogleAdsPublishProgress) => Promise<void> | void;

export type GoogleAdsPublishOptions = {
  /** A review demonstration must never activate provider resources. */
  activate?: boolean;
  /** Resolved before the local draft is claimed, so a bad zone is editable. */
  preparedTargetLocations?: GoogleTargetLocation[];
  /** Marks the first request that could create remote resources. */
  onProviderMutationStart?: () => void;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function resourceNameAt(
  response: Record<string, unknown>,
  index: number,
  resultKey: string,
  expectedPrefix: string,
): string {
  const operations = Array.isArray(response.mutateOperationResponses) ? response.mutateOperationResponses : [];
  const operation = asRecord(operations[index]);
  const result = asRecord(operation[resultKey]);
  const resourceName = String(result.resourceName || "");
  const resourceId = resourceName.startsWith(expectedPrefix) ? resourceName.slice(expectedPrefix.length) : "";
  if (!/^\d+(?:~(?:\d+|[A-Z_]+)){0,2}$/.test(resourceId)) {
    throw new Error(`Google Ads n’a pas retourné l’identifiant attendu (${resultKey}). La campagne peut être en pause sur le compte publicitaire.`);
  }
  return resourceName;
}

function checkGoogleDraft(draft: AdsCampaignInput): string {
  if (draft.provider !== "google") throw new Error("Cette campagne n’est pas une campagne Google Ads.");
  if (!/^\d{5,25}$/.test(draft.adAccountId)) throw new Error("Compte Google Ads invalide.");
  if (draft.accountCurrency !== "EUR") throw new Error("Seuls les comptes Google Ads en EUR sont pris en charge.");
  if (!draft.notEuPoliticalConfirmed) {
    throw new Error("Confirmez explicitement que la campagne ne contient pas de publicité politique ciblant l’Union européenne.");
  }
  if (!Number.isFinite(draft.dailyBudgetEuros) || draft.dailyBudgetEuros < 5 || draft.dailyBudgetEuros > 500 ||
      Math.abs(Math.round(draft.dailyBudgetEuros * 100) - draft.dailyBudgetEuros * 100) > 0.000001) {
    throw new Error("Budget journalier Google Ads invalide.");
  }
  const endDateTime = `${draft.endDate} 23:59:59`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.endDate) ||
      !Number.isFinite(Date.parse(`${draft.endDate}T23:59:59Z`)) ||
      Date.parse(`${draft.endDate}T23:59:59Z`) <= Date.now()) {
    throw new Error("Date de fin Google Ads invalide.");
  }
  if (draft.headlines.length < 3 || draft.descriptions.length < 2 || draft.keywords.length < 1) {
    throw new Error("Il faut au moins trois titres, deux descriptions et un mot-clé Google Ads.");
  }
  let destination: URL;
  try {
    destination = new URL(draft.destinationUrl);
  } catch {
    throw new Error("L’URL de destination doit être une URL HTTPS publique.");
  }
  if (destination.protocol !== "https:" || destination.username || destination.password) {
    throw new Error("L’URL de destination doit être une URL HTTPS publique.");
  }
  return endDateTime;
}

export type GoogleTargetLocation = {
  resourceName: string;
  label: string;
  countryCode: string;
};

export class GoogleAdsLocationResolutionError extends Error {
  readonly code = "ADS_LOCATION_UNRESOLVED";
}

function gaqlQuoted(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function googleFinalUrlSuffix(value: string): string | null {
  const suffix = value.trim().replace(/^[?&]+/, "");
  if (!suffix) return null;
  if (/[\[\]\r\n#?]/.test(suffix) ||
      suffix.split("&").some((part) => !/^[^=&\s]+=[^&]*$/.test(part))) {
    throw new Error("Les balises de suivi Google Ads doivent être des paramètres URL au format nom=valeur&nom=valeur.");
  }
  return suffix;
}

async function searchGoogleTargetLocations(
  userId: string,
  customerId: string,
  field: "name" | "canonical_name",
  value: string,
  loginCustomerId?: string,
  countryCode?: string,
): Promise<GoogleTargetLocation[]> {
  const response = await googleAdsJson(userId, `customers/${customerId}/googleAds:search`, {
    query: `SELECT geo_target_constant.resource_name, geo_target_constant.name, geo_target_constant.canonical_name, geo_target_constant.country_code, geo_target_constant.status FROM geo_target_constant WHERE geo_target_constant.${field} = '${gaqlQuoted(value)}'${countryCode ? ` AND geo_target_constant.country_code = '${countryCode}'` : ""} LIMIT 20`,
  }, loginCustomerId);
  const byResourceName = new Map<string, GoogleTargetLocation>();
  for (const row of Array.isArray(response.results) ? response.results : []) {
    const target = asRecord(asRecord(row).geoTargetConstant);
    const resourceName = String(target.resourceName || "");
    const label = String(target.canonicalName || target.name || "").trim();
    const resolvedCountryCode = String(target.countryCode || "");
    if (!/^geoTargetConstants\/\d+$/.test(resourceName) || !label || target.status !== "ENABLED") continue;
    byResourceName.set(resourceName, { resourceName, label, countryCode: resolvedCountryCode });
  }
  return [...byResourceName.values()];
}

/**
 * Google accepts resource IDs, not the human-readable zones entered in the
 * studio. Resolve those names before the atomic mutate so an ambiguous city
 * can never silently be replaced with the legacy France-wide default.
 */
export async function resolveGoogleTargetLocations(
  userId: string,
  customerId: string,
  locations: string[],
  loginCustomerId?: string,
): Promise<GoogleTargetLocation[]> {
  const labels = normalizeGoogleTargetLocationLabels(locations);
  if (!labels.length) {
    throw new GoogleAdsLocationResolutionError("Choisissez au moins une zone à l’étape Ciblage. Aucun pays ne sera ajouté par défaut.");
  }

  const franceIncluded = labels.includes("France");

  const resolved = await Promise.all(labels.map(async (label) => {
    if (label === "France") {
      return { input: label, matches: [{ resourceName: "geoTargetConstants/2250", label: "France", countryCode: "FR" }], coveredByFrance: false };
    }
    // A canonical name (for example “Paris, Ile-de-France, France”) removes
    // ambiguity first. Plain city/region names remain convenient when Google
    // exposes exactly one geographic target for the label.
    const canonical = await searchGoogleTargetLocations(userId, customerId, "canonical_name", label, loginCustomerId);
    if (canonical.length === 1) {
      return { input: label, matches: canonical, coveredByFrance: franceIncluded && canonical[0].countryCode === "FR" };
    }
    if (franceIncluded) {
      // A country target already covers its cities and regions. Prefer the
      // explicit France context for ambiguous names such as “Lille”, without
      // discarding a canonical foreign target the professional requested.
      const french = await searchGoogleTargetLocations(userId, customerId, "name", label, loginCustomerId, "FR");
      if (french.length) return { input: label, matches: french, coveredByFrance: true };
    }
    const matches = await searchGoogleTargetLocations(userId, customerId, "name", label, loginCustomerId);
    return { input: label, matches, coveredByFrance: false };
  }));

  const unresolved = resolved.filter((entry) => !entry.coveredByFrance && entry.matches.length !== 1).map((entry) => entry.input);
  if (unresolved.length) {
    throw new GoogleAdsLocationResolutionError(`Google Ads ne peut pas identifier précisément la zone ${unresolved.map((label) => `« ${label} »`).join(", ")}. Corrigez-la à l’étape Ciblage avec le nom canonique affiché par Google, puis réessayez.`);
  }
  const targets = new Map<string, GoogleTargetLocation>();
  for (const entry of resolved) {
    if (!entry.coveredByFrance) targets.set(entry.matches[0].resourceName, entry.matches[0]);
  }
  return [...targets.values()];
}

/**
 * Creates a location-verified Search campaign, then enables its children and
 * finally the campaign. `persistProgress` is optional in the signature for integration
 * convenience, but required at runtime: publishing without a durable record is
 * deliberately refused before the first remote mutation.
 *
 * `loginCustomerId` can be supplied later for manager-account OAuth access.
 * Directly accessible client accounts should omit it.
 */
export async function publishGoogleAdsCampaign(
  userId: string,
  draft: AdsCampaignInput,
  persistProgress?: PersistGoogleAdsProgress,
  loginCustomerId?: string,
  options: GoogleAdsPublishOptions = {},
): Promise<GoogleAdsPublishProgress> {
  if (!persistProgress) {
    throw new Error("L’enregistrement des identifiants Google Ads est requis avant publication.");
  }
  const endDateTime = checkGoogleDraft(draft);
  const biddingFields = googleSearchBiddingFields(draft.bidStrategy);
  if (!biddingFields) {
    throw new Error("La stratégie d’enchères Google Ads choisie n’est pas encore publiable.");
  }
  const finalUrlSuffix = googleFinalUrlSuffix(draft.trackingParameters);
  const customerId = draft.adAccountId;
  if (loginCustomerId && !/^\d{5,25}$/.test(loginCustomerId)) {
    throw new Error("Identifiant de compte administrateur Google Ads invalide.");
  }

  // Verify the actual account, not only the currency displayed in the UI.
  const accountResponse = await googleAdsJson(userId, `customers/${customerId}/googleAds:search`, {
    query: "SELECT customer.id, customer.currency_code, customer.manager, customer.status FROM customer LIMIT 1",
  }, loginCustomerId);
  const accountRows = Array.isArray(accountResponse.results) ? accountResponse.results : [];
  const account = asRecord(asRecord(accountRows[0]).customer);
  if (String(account.id || "") !== customerId || account.currencyCode !== "EUR" || account.manager === true || account.status !== "ENABLED") {
    throw new Error("Le compte Google Ads sélectionné doit être un compte annonceur actif et accessible, en EUR.");
  }
  const targetLocations = options.preparedTargetLocations || await resolveGoogleTargetLocations(
    userId,
    customerId,
    draft.targetLocations,
    loginCustomerId,
  );
  if (!targetLocations.length || targetLocations.some((location) => !/^geoTargetConstants\/\d+$/.test(location.resourceName))) {
    throw new GoogleAdsLocationResolutionError("Vérifiez les zones ciblées avant publication. Aucune campagne sans zone vérifiée ne sera créée.");
  }
  // Search matches languages from the ad copy and landing page. Google Ads
  // rejects manual CampaignCriterion.language targeting from September 2026.
  const budgetTemp = `customers/${customerId}/campaignBudgets/-1`;
  const campaignTemp = `customers/${customerId}/campaigns/-2`;
  const adGroupTemp = `customers/${customerId}/adGroups/-3`;
  const budgetName = `${draft.name} · iNr’ADS ${randomUUID().slice(0, 8)}`;
  const amountMicros = String(Math.round(draft.dailyBudgetEuros * 100) * 10_000);

  // A single atomic mutate avoids an incomplete remote campaign when an ad,
  // keyword or targeting criterion fails validation.
  const mutateOperations: Record<string, unknown>[] = [
    { campaignBudgetOperation: { create: {
      resourceName: budgetTemp,
      name: budgetName,
      deliveryMethod: "STANDARD",
      amountMicros,
      explicitlyShared: false,
    } } },
    { campaignOperation: { create: {
      resourceName: campaignTemp,
      name: draft.name,
      status: "PAUSED",
      advertisingChannelType: "SEARCH",
      campaignBudget: budgetTemp,
      ...biddingFields,
      ...(finalUrlSuffix ? { finalUrlSuffix } : {}),
      containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
      geoTargetTypeSetting: { positiveGeoTargetType: "PRESENCE" },
      networkSettings: {
        targetGoogleSearch: true,
        // Google Search Partners is targetSearchNetwork. The similarly named
        // targetPartnerSearchNetwork is a restricted, unrelated partner network.
        targetSearchNetwork: draft.googleSearchPartners,
        targetContentNetwork: draft.googleDisplayExpansion,
      },
      endDateTime,
    } } },
    ...targetLocations.map((location) => ({ campaignCriterionOperation: { create: {
      campaign: campaignTemp,
      location: { geoTargetConstant: location.resourceName },
    } } })),
    ...draft.negativeKeywords.map((keyword) => ({ campaignCriterionOperation: { create: {
      campaign: campaignTemp,
      negative: true,
      keyword: { text: keyword, matchType: "BROAD" },
    } } })),
    { adGroupOperation: { create: {
      resourceName: adGroupTemp,
      campaign: campaignTemp,
      name: `${draft.name} · Groupe principal`,
      type: "SEARCH_STANDARD",
      status: "PAUSED",
    } } },
    ...draft.keywords.map((keyword) => ({ adGroupCriterionOperation: { create: {
      adGroup: adGroupTemp,
      status: "PAUSED",
      keyword: { text: keyword, matchType: "PHRASE" },
    } } })),
    { adGroupAdOperation: { create: {
      adGroup: adGroupTemp,
      status: "PAUSED",
      ad: {
        responsiveSearchAd: {
          headlines: draft.headlines.map((headline) => ({ text: headline })),
          descriptions: draft.descriptions.map((description) => ({ text: description })),
        },
        finalUrls: [draft.destinationUrl],
      },
    } } },
  ];
  options.onProviderMutationStart?.();
  const created = await googleAdsJson(userId, `customers/${customerId}/googleAds:mutate`, {
    partialFailure: false,
    mutateOperations,
  }, loginCustomerId);
  if (created.partialFailureError) {
    throw new Error("Google Ads a refusé la création complète de la campagne.");
  }

  const adGroupOffset = 2 + targetLocations.length + draft.negativeKeywords.length;
  const paused: GoogleAdsPublishProgress = {
    customerId,
    budgetResourceName: resourceNameAt(created, 0, "campaignBudgetResult", `customers/${customerId}/campaignBudgets/`),
    campaignResourceName: resourceNameAt(created, 1, "campaignResult", `customers/${customerId}/campaigns/`),
    locationCriterionResourceName: resourceNameAt(created, 2, "campaignCriterionResult", `customers/${customerId}/campaignCriteria/`),
    locationCriterionResourceNames: targetLocations.map((_, index) =>
      resourceNameAt(created, 2 + index, "campaignCriterionResult", `customers/${customerId}/campaignCriteria/`)),
    languageCriterionResourceNames: [],
    negativeKeywordCriterionResourceNames: draft.negativeKeywords.map((_, index) =>
      resourceNameAt(created, 2 + targetLocations.length + index, "campaignCriterionResult", `customers/${customerId}/campaignCriteria/`)),
    adGroupResourceName: resourceNameAt(created, adGroupOffset, "adGroupResult", `customers/${customerId}/adGroups/`),
    keywordCriterionResourceNames: draft.keywords.map((_, index) =>
      resourceNameAt(created, adGroupOffset + 1 + index, "adGroupCriterionResult", `customers/${customerId}/adGroupCriteria/`)),
    adGroupAdResourceName: resourceNameAt(created, adGroupOffset + 1 + draft.keywords.length, "adGroupAdResult", `customers/${customerId}/adGroupAds/`),
    status: "PAUSED",
    initialActivationPending: true,
  };

  // If local persistence fails, absolutely nothing is enabled. The remote
  // campaign remains paused and can be reconciled using these resource names.
  try {
    await persistProgress(paused);
  } catch {
    throw new Error(`Campagne créée en pause sur Google Ads, mais son enregistrement local a échoué : ${paused.campaignResourceName}. Aucune diffusion n’a été activée.`);
  }

  // Used only by the explicit review/demo mode. The atomic create above sets
  // the campaign, group, keywords and ad to PAUSED; return before any enable.
  if (options.activate === false) return paused;

  const enableChildren = [
    { adGroupOperation: { update: { resourceName: paused.adGroupResourceName, status: "ENABLED" }, updateMask: "status" } },
    ...paused.keywordCriterionResourceNames.map((resourceName) => ({
      adGroupCriterionOperation: { update: { resourceName, status: "ENABLED" }, updateMask: "status" },
    })),
    { adGroupAdOperation: { update: { resourceName: paused.adGroupAdResourceName, status: "ENABLED" }, updateMask: "status" } },
  ];
  try {
    const prepared = await googleAdsJson(userId, `customers/${customerId}/googleAds:mutate`, {
      partialFailure: false,
      mutateOperations: enableChildren,
    }, loginCustomerId);
    if (prepared.partialFailureError) throw new Error("Échec de l’activation des éléments publicitaires.");
    const expectedChildren = [
      { key: "adGroupResult", name: paused.adGroupResourceName },
      ...paused.keywordCriterionResourceNames.map((name) => ({ key: "adGroupCriterionResult", name })),
      { key: "adGroupAdResult", name: paused.adGroupAdResourceName },
    ];
    const results = Array.isArray(prepared.mutateOperationResponses) ? prepared.mutateOperationResponses : [];
    if (results.length !== expectedChildren.length || expectedChildren.some((expected, index) =>
      asRecord(asRecord(results[index])[expected.key]).resourceName !== expected.name)) {
      throw new Error("Google Ads n’a pas confirmé tous les éléments de la campagne. La campagne reste en pause.");
    }
  } catch {
    throw new Error(`Campagne Google Ads conservée en pause (${paused.campaignResourceName}) : l’activation des annonces ou mots-clés a échoué.`);
  }

  // This is intentionally the last remote write. Before it, no impression can
  // be served even if an ad or keyword was individually enabled.
  try {
    const activated = await googleAdsJson(userId, `customers/${customerId}/campaigns:mutate`, {
      operations: [{ update: { resourceName: paused.campaignResourceName, status: "ENABLED" }, updateMask: "status" }],
    }, loginCustomerId);
    const activationResult = Array.isArray(activated.results) ? asRecord(activated.results[0]) : {};
    if (activationResult.resourceName !== paused.campaignResourceName) {
      throw new Error("Réponse d’activation Google Ads incomplète.");
    }
  } catch {
    throw new Error(`L’activation Google Ads n’a pas pu être confirmée (${paused.campaignResourceName}). Vérifiez le statut sur Google Ads avant de réessayer pour éviter un doublon.`);
  }

  const enabled: GoogleAdsPublishProgress = { ...paused, status: "ENABLED", initialActivationPending: false };
  try {
    await persistProgress(enabled);
  } catch {
    throw new Error(`Campagne Google Ads activée (${enabled.campaignResourceName}), mais la synchronisation locale a échoué. Ne la publiez pas une seconde fois : vérifiez-la dans Google Ads.`);
  }
  return enabled;
}
