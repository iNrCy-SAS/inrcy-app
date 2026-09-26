import "server-only";

import { randomUUID } from "node:crypto";
import { googleAdsJson } from "@/lib/adsServer";
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
  adGroupResourceName: string;
  keywordCriterionResourceNames: string[];
  adGroupAdResourceName: string;
  status: "PAUSED" | "ENABLED";
};

export type PersistGoogleAdsProgress = (progress: GoogleAdsPublishProgress) => Promise<void> | void;

export type GoogleAdsPublishOptions = {
  /** A review demonstration must never activate provider resources. */
  activate?: boolean;
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
  if (!/^\d+(?:~\d+)?$/.test(resourceId)) {
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
      Math.round(draft.dailyBudgetEuros * 100) !== draft.dailyBudgetEuros * 100) {
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

type GoogleTargetLocation = {
  resourceName: string;
  label: string;
};

function gaqlQuoted(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function uniqueLocationLabels(locations: string[]) {
  const labels = new Map<string, string>();
  for (const value of locations) {
    const label = String(value || "").trim().replace(/\s+/g, " ");
    if (!label) continue;
    const key = label.toLocaleLowerCase("fr-FR");
    if (!labels.has(key)) labels.set(key, label);
  }
  return [...labels.values()].slice(0, 20);
}

async function searchGoogleTargetLocations(
  userId: string,
  customerId: string,
  field: "name" | "canonical_name",
  value: string,
  loginCustomerId?: string,
): Promise<GoogleTargetLocation[]> {
  const response = await googleAdsJson(userId, `customers/${customerId}/googleAds:search`, {
    query: `SELECT geo_target_constant.resource_name, geo_target_constant.name, geo_target_constant.canonical_name FROM geo_target_constant WHERE geo_target_constant.${field} = '${gaqlQuoted(value)}' LIMIT 20`,
  }, loginCustomerId);
  const byResourceName = new Map<string, GoogleTargetLocation>();
  for (const row of Array.isArray(response.results) ? response.results : []) {
    const target = asRecord(asRecord(row).geoTargetConstant);
    const resourceName = String(target.resourceName || "");
    const label = String(target.canonicalName || target.name || "").trim();
    if (!/^geoTargetConstants\/\d+$/.test(resourceName) || !label) continue;
    byResourceName.set(resourceName, { resourceName, label });
  }
  return [...byResourceName.values()];
}

/**
 * Google accepts resource IDs, not the human-readable zones entered in the
 * studio. Resolve those names before the atomic mutate so an ambiguous city
 * can never silently be replaced with the legacy France-wide default.
 */
async function resolveGoogleTargetLocations(
  userId: string,
  customerId: string,
  locations: string[],
  loginCustomerId?: string,
): Promise<GoogleTargetLocation[]> {
  const labels = uniqueLocationLabels(locations);
  if (!labels.length) {
    return [{ resourceName: "geoTargetConstants/2250", label: "France" }];
  }

  const resolved = await Promise.all(labels.map(async (label) => {
    // A canonical name (for example “Paris, Ile-de-France, France”) removes
    // ambiguity first. Plain city/region names remain convenient when Google
    // exposes exactly one geographic target for the label.
    const canonical = await searchGoogleTargetLocations(userId, customerId, "canonical_name", label, loginCustomerId);
    const matches = canonical.length === 1
      ? canonical
      : await searchGoogleTargetLocations(userId, customerId, "name", label, loginCustomerId);
    return { input: label, matches };
  }));

  const unresolved = resolved.filter((entry) => entry.matches.length !== 1).map((entry) => entry.input);
  if (unresolved.length) {
    throw new Error(`Google Ads ne peut pas identifier précisément la zone ${unresolved.map((label) => `« ${label} »`).join(", ")}. Utilisez une ville, une région ou le nom canonique affiché par Google, puis réessayez.`);
  }
  return resolved.map((entry) => entry.matches[0]);
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
  const targetLocations = await resolveGoogleTargetLocations(
    userId,
    customerId,
    draft.targetLocations,
    loginCustomerId,
  );

  const budgetTemp = `customers/${customerId}/campaignBudgets/-1`;
  const campaignTemp = `customers/${customerId}/campaigns/-2`;
  const adGroupTemp = `customers/${customerId}/adGroups/-3`;
  const budgetName = `${draft.name.slice(0, 70)} · iNr’ADS ${randomUUID().slice(0, 8)}`;
  const amountMicros = String(Math.round(draft.dailyBudgetEuros * 1_000_000));

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
      targetSpend: {},
      containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
      geoTargetTypeSetting: { positiveGeoTargetType: "PRESENCE" },
      networkSettings: {
        targetGoogleSearch: true,
        targetSearchNetwork: false,
        targetPartnerSearchNetwork: draft.googleSearchPartners,
        targetContentNetwork: draft.googleDisplayExpansion,
      },
      endDateTime,
    } } },
    ...targetLocations.map((location) => ({ campaignCriterionOperation: { create: {
      campaign: campaignTemp,
      location: { geoTargetConstant: location.resourceName },
    } } })),
    { adGroupOperation: { create: {
      resourceName: adGroupTemp,
      campaign: campaignTemp,
      name: `${draft.name.slice(0, 70)} · Groupe principal`,
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

  const created = await googleAdsJson(userId, `customers/${customerId}/googleAds:mutate`, {
    partialFailure: false,
    mutateOperations,
  }, loginCustomerId);
  if (created.partialFailureError) {
    throw new Error("Google Ads a refusé la création complète de la campagne.");
  }

  const paused: GoogleAdsPublishProgress = {
    customerId,
    budgetResourceName: resourceNameAt(created, 0, "campaignBudgetResult", `customers/${customerId}/campaignBudgets/`),
    campaignResourceName: resourceNameAt(created, 1, "campaignResult", `customers/${customerId}/campaigns/`),
    locationCriterionResourceName: resourceNameAt(created, 2, "campaignCriterionResult", `customers/${customerId}/campaignCriteria/`),
    locationCriterionResourceNames: targetLocations.map((_, index) =>
      resourceNameAt(created, 2 + index, "campaignCriterionResult", `customers/${customerId}/campaignCriteria/`)),
    adGroupResourceName: resourceNameAt(created, 2 + targetLocations.length, "adGroupResult", `customers/${customerId}/adGroups/`),
    keywordCriterionResourceNames: draft.keywords.map((_, index) =>
      resourceNameAt(created, 3 + targetLocations.length + index, "adGroupCriterionResult", `customers/${customerId}/adGroupCriteria/`)),
    adGroupAdResourceName: resourceNameAt(created, 3 + targetLocations.length + draft.keywords.length, "adGroupAdResult", `customers/${customerId}/adGroupAds/`),
    status: "PAUSED",
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

  const enabled: GoogleAdsPublishProgress = { ...paused, status: "ENABLED" };
  try {
    await persistProgress(enabled);
  } catch {
    throw new Error(`Campagne Google Ads activée (${enabled.campaignResourceName}), mais la synchronisation locale a échoué. Ne la publiez pas une seconde fois : vérifiez-la dans Google Ads.`);
  }
  return enabled;
}
