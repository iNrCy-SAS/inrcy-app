export type GoogleAdsRemoteCampaignStatus = "ENABLED" | "PAUSED" | "REMOVED";

export type GoogleAdsProviderResources = {
  customerId: string;
  campaignResourceName: string;
  budgetResourceName: string;
  locationCriterionResourceName?: string;
  locationCriterionResourceNames: string[];
  status?: GoogleAdsRemoteCampaignStatus;
  /** Original persisted object, retained so unrelated publication IDs are not lost. */
  source: Readonly<Record<string, unknown>>;
};

export type GoogleAdsRemoteLocationCriterion = {
  resourceName: string;
  geoTargetConstantResourceName: string;
};

export type GoogleAdsRemoteCampaignSnapshot = {
  customerId: string;
  campaignResourceName: string;
  budgetResourceName: string;
  name: string;
  dailyBudgetEuros: number | null;
  budgetExplicitlyShared: boolean;
  budgetReferenceCount: number;
  endDate: string | null;
  status: GoogleAdsRemoteCampaignStatus;
  locationCriteria: GoogleAdsRemoteLocationCriterion[];
};

export type GoogleAdsRemoteCampaignUpdate = {
  name?: string;
  dailyBudgetEuros?: number;
  endDate?: string;
  targetLocations?: string[];
};

export type NormalizedGoogleAdsRemoteCampaignUpdate = GoogleAdsRemoteCampaignUpdate;

export type GoogleAdsResolvedTargetLocation = {
  resourceName: string;
  label: string;
  countryCode: string;
};

export type GoogleAdsRemoteRequest = (
  path: string,
  body: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export type GoogleAdsRemoteCampaignMutationResult = {
  action: "update" | "pause" | "resume" | "remove";
  changed: boolean;
  status: GoogleAdsRemoteCampaignStatus;
  snapshot: GoogleAdsRemoteCampaignSnapshot | null;
  /** Persist this only after the caller has durably accepted the successful result. */
  providerResources: Record<string, unknown>;
};

export type GoogleAdsRemoteCampaignAdapter = {
  read(): Promise<GoogleAdsRemoteCampaignSnapshot>;
  update(input: GoogleAdsRemoteCampaignUpdate): Promise<GoogleAdsRemoteCampaignMutationResult>;
  pause(): Promise<GoogleAdsRemoteCampaignMutationResult>;
  resume(): Promise<GoogleAdsRemoteCampaignMutationResult>;
  remove(): Promise<GoogleAdsRemoteCampaignMutationResult>;
};

export type GoogleAdsRemoteCampaignErrorCode =
  | "INVALID_PROVIDER_RESOURCES"
  | "INVALID_REMOTE_UPDATE"
  | "REMOTE_CAMPAIGN_NOT_FOUND"
  | "REMOTE_CAMPAIGN_REMOVED"
  | "REMOTE_SHARED_BUDGET"
  | "REMOTE_RESOURCE_MISMATCH"
  | "REMOTE_RESPONSE_INCOMPLETE"
  | "REMOTE_MUTATION_UNCONFIRMED";

export class GoogleAdsRemoteCampaignError extends Error {
  readonly code: GoogleAdsRemoteCampaignErrorCode;

  constructor(code: GoogleAdsRemoteCampaignErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GoogleAdsRemoteCampaignError";
    this.code = code;
  }
}

type CoreAdapterInput = {
  expectedCustomerId: string;
  providerResources: unknown;
  request: GoogleAdsRemoteRequest;
  resolveTargetLocations: (locations: string[]) => Promise<GoogleAdsResolvedTargetLocation[]>;
  now?: () => number;
};

type MutationExpectation = {
  resultKey: "campaignResult" | "campaignBudgetResult" | "campaignCriterionResult" |
    "adGroupResult" | "adGroupCriterionResult" | "adGroupAdResult";
  expectedResourceName?: string;
  expectedPrefix?: string;
};

const CAMPAIGN_RESOURCE = /^customers\/(\d{5,25})\/campaigns\/(\d+)$/;
const BUDGET_RESOURCE = /^customers\/(\d{5,25})\/campaignBudgets\/(\d+)$/;
const GEO_TARGET_RESOURCE = /^geoTargetConstants\/\d+$/;

type InitialActivationResources = {
  adGroupResourceName: string;
  adGroupAdResourceName: string;
  keywordCriterionResourceNames: string[];
};

function initialActivationResources(resources: GoogleAdsProviderResources): InitialActivationResources | null {
  if (resources.source.initialActivationPending !== true) return null;
  const group = String(resources.source.adGroupResourceName || "");
  const groupMatch = group.match(/^customers\/(\d{5,25})\/adGroups\/(\d+)$/);
  const ad = String(resources.source.adGroupAdResourceName || "");
  const adMatch = ad.match(/^customers\/(\d{5,25})\/adGroupAds\/(\d+)~\d+$/);
  const keywords = resources.source.keywordCriterionResourceNames;
  if (!groupMatch || groupMatch[1] !== resources.customerId || !adMatch || adMatch[1] !== resources.customerId
    || adMatch[2] !== groupMatch[2] || !Array.isArray(keywords) || !keywords.length || keywords.length > 20
    || new Set(keywords).size !== keywords.length || keywords.some((value) => {
      const match = typeof value === "string" ? value.match(/^customers\/(\d{5,25})\/adGroupCriteria\/(\d+)~\d+$/) : null;
      return !match || match[1] !== resources.customerId || match[2] !== groupMatch[2];
    })) {
    invalidResources("Les éléments de la première activation Google Ads sont incomplets ou appartiennent à un autre compte/groupe.");
  }
  return { adGroupResourceName: group, adGroupAdResourceName: ad, keywordCriterionResourceNames: keywords as string[] };
}

type InitialActivationChild = {
  resourceName: string;
  status: "ENABLED" | "PAUSED";
  operationKey: "adGroupOperation" | "adGroupAdOperation" | "adGroupCriterionOperation";
  resultKey: MutationExpectation["resultKey"];
};

async function readInitialActivationChildren(
  resources: GoogleAdsProviderResources,
  manifest: InitialActivationResources,
  request: GoogleAdsRemoteRequest,
): Promise<InitialActivationChild[]> {
  const queries = [
    `SELECT ad_group.resource_name, ad_group.campaign, ad_group.status FROM ad_group WHERE ad_group.resource_name = '${manifest.adGroupResourceName}'`,
    `SELECT ad_group_ad.resource_name, ad_group_ad.ad_group, ad_group_ad.status FROM ad_group_ad WHERE ad_group_ad.resource_name = '${manifest.adGroupAdResourceName}'`,
    `SELECT ad_group_criterion.resource_name, ad_group_criterion.ad_group, ad_group_criterion.status FROM ad_group_criterion WHERE ad_group_criterion.resource_name IN (${manifest.keywordCriterionResourceNames.map((name) => `'${name}'`).join(",")})`,
  ];
  const responses = await Promise.all(queries.map((query) => request(`customers/${resources.customerId}/googleAds:search`, { query })));
  const children: InitialActivationChild[] = [];
  const add = (response: Record<string, unknown>, key: string, expectedNames: string[], parentField: string, expectedParent: string,
    operationKey: InitialActivationChild["operationKey"], resultKey: MutationExpectation["resultKey"]) => {
    const rows = Array.isArray(response.results) ? response.results : [];
    const seen = new Set<string>();
    for (const row of rows) {
      const child = record(record(row)[key]);
      const name = String(child.resourceName || "");
      if (!expectedNames.includes(name) || seen.has(name) || child[parentField] !== expectedParent
        || (child.status !== "PAUSED" && child.status !== "ENABLED")) {
        throw new GoogleAdsRemoteCampaignError("REMOTE_RESOURCE_MISMATCH", "Les annonces ou mots-clés Google Ads ne correspondent plus aux éléments créés en pause. Vérifiez-les sur Google Ads.");
      }
      seen.add(name);
      children.push({ resourceName: name, status: child.status, operationKey, resultKey });
    }
    if (seen.size !== expectedNames.length || response.nextPageToken) {
      throw new GoogleAdsRemoteCampaignError("REMOTE_RESPONSE_INCOMPLETE", "Google Ads n’a pas confirmé tous les éléments de la première activation. Vérifiez leur état sur Google Ads.");
    }
  };
  add(responses[0], "adGroup", [manifest.adGroupResourceName], "campaign", resources.campaignResourceName, "adGroupOperation", "adGroupResult");
  add(responses[2], "adGroupCriterion", manifest.keywordCriterionResourceNames, "adGroup", manifest.adGroupResourceName, "adGroupCriterionOperation", "adGroupCriterionResult");
  add(responses[1], "adGroupAd", [manifest.adGroupAdResourceName], "adGroup", manifest.adGroupResourceName, "adGroupAdOperation", "adGroupAdResult");
  return children;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function invalidResources(message: string): never {
  throw new GoogleAdsRemoteCampaignError("INVALID_PROVIDER_RESOURCES", message);
}

function validateCriterionResourceName(value: unknown, customerId: string, campaignId: string): string {
  const resourceName = typeof value === "string" ? value : "";
  const match = resourceName.match(/^customers\/(\d{5,25})\/campaignCriteria\/(\d+)~(?:\d+|[A-Z_]+)$/);
  if (!match || match[1] !== customerId || match[2] !== campaignId) {
    invalidResources("Les identifiants géographiques Google Ads enregistrés sont invalides.");
  }
  return resourceName;
}

function remoteCriterionResourceName(value: unknown, customerId: string, campaignId: string): string {
  const resourceName = typeof value === "string" ? value : "";
  const match = resourceName.match(/^customers\/(\d{5,25})\/campaignCriteria\/(\d+)~(?:\d+|[A-Z_]+)$/);
  if (!match || match[1] !== customerId || match[2] !== campaignId) {
    throw new GoogleAdsRemoteCampaignError("REMOTE_RESPONSE_INCOMPLETE", "Google Ads a retourné un identifiant géographique invalide.");
  }
  return resourceName;
}

/**
 * Treat provider_resources as untrusted persisted input. Every mutable resource
 * must belong to the selected customer and campaign before any API call occurs.
 */
export function parseGoogleAdsProviderResources(
  value: unknown,
  expectedCustomerId?: string,
): GoogleAdsProviderResources {
  const source = record(value);
  if (!Object.keys(source).length) {
    invalidResources("Les identifiants Google Ads de cette campagne sont absents.");
  }

  const campaignResourceName = typeof source.campaignResourceName === "string"
    ? source.campaignResourceName
    : "";
  const campaignMatch = campaignResourceName.match(CAMPAIGN_RESOURCE);
  if (!campaignMatch) invalidResources("L’identifiant de campagne Google Ads enregistré est invalide.");
  const [, customerId, campaignId] = campaignMatch;

  if (expectedCustomerId && (!/^\d{5,25}$/.test(expectedCustomerId) || customerId !== expectedCustomerId)) {
    invalidResources("La campagne Google Ads enregistrée n’appartient pas au compte sélectionné.");
  }
  if (source.customerId !== undefined && source.customerId !== customerId) {
    invalidResources("Le compte Google Ads enregistré ne correspond pas à la campagne.");
  }

  const budgetResourceName = typeof source.budgetResourceName === "string"
    ? source.budgetResourceName
    : "";
  const budgetMatch = budgetResourceName.match(BUDGET_RESOURCE);
  if (!budgetMatch || budgetMatch[1] !== customerId) {
    invalidResources("L’identifiant de budget Google Ads enregistré est invalide.");
  }

  const legacyCriterion = source.locationCriterionResourceName;
  const storedCriteria = source.locationCriterionResourceNames;
  if (storedCriteria !== undefined && !Array.isArray(storedCriteria)) {
    invalidResources("Les identifiants géographiques Google Ads enregistrés sont invalides.");
  }
  const rawCriteria = Array.isArray(storedCriteria)
    ? storedCriteria
    : legacyCriterion === undefined ? [] : [legacyCriterion];
  const locationCriterionResourceNames = [...new Set(rawCriteria.map((criterion) =>
    validateCriterionResourceName(criterion, customerId, campaignId)))];
  const locationCriterionResourceName = legacyCriterion === undefined
    ? locationCriterionResourceNames[0]
    : validateCriterionResourceName(legacyCriterion, customerId, campaignId);

  const status = source.status;
  if (status !== undefined && status !== "ENABLED" && status !== "PAUSED" && status !== "REMOVED") {
    invalidResources("Le statut Google Ads enregistré est invalide.");
  }

  return {
    customerId,
    campaignResourceName,
    budgetResourceName,
    ...(locationCriterionResourceName ? { locationCriterionResourceName } : {}),
    locationCriterionResourceNames,
    ...(status ? { status } : {}),
    source,
  };
}

function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T23:59:59Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

/** Runtime validation mirrors the campaign draft bounds used before publish. */
export function normalizeGoogleAdsRemoteCampaignUpdate(
  value: unknown,
  now = Date.now(),
): NormalizedGoogleAdsRemoteCampaignUpdate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GoogleAdsRemoteCampaignError("INVALID_REMOTE_UPDATE", "La modification Google Ads est invalide.");
  }
  const raw = value as Record<string, unknown>;
  const allowed = ["name", "dailyBudgetEuros", "endDate", "targetLocations"];
  if (Object.keys(raw).some((key) => !allowed.includes(key))) {
    throw new GoogleAdsRemoteCampaignError("INVALID_REMOTE_UPDATE", "La modification Google Ads contient un champ inattendu.");
  }

  const normalized: NormalizedGoogleAdsRemoteCampaignUpdate = {};
  if (Object.hasOwn(raw, "name")) {
    if (typeof raw.name !== "string") {
      throw new GoogleAdsRemoteCampaignError("INVALID_REMOTE_UPDATE", "Le nom de campagne Google Ads est invalide.");
    }
    const name = raw.name.trim();
    if (name.length < 3 || name.length > 100) {
      throw new GoogleAdsRemoteCampaignError("INVALID_REMOTE_UPDATE", "Le nom de campagne doit contenir entre 3 et 100 caractères.");
    }
    normalized.name = name;
  }

  if (Object.hasOwn(raw, "dailyBudgetEuros")) {
    const budget = raw.dailyBudgetEuros;
    if (typeof budget !== "number" || !Number.isFinite(budget) || budget < 5 || budget > 500 ||
        Math.abs(Math.round(budget * 100) - budget * 100) > 0.000001) {
      throw new GoogleAdsRemoteCampaignError("INVALID_REMOTE_UPDATE", "Le budget journalier doit être compris entre 5 et 500 €, avec deux décimales maximum.");
    }
    normalized.dailyBudgetEuros = budget;
  }

  if (Object.hasOwn(raw, "endDate")) {
    if (typeof raw.endDate !== "string" || !validCalendarDate(raw.endDate)) {
      throw new GoogleAdsRemoteCampaignError("INVALID_REMOTE_UPDATE", "La date de fin Google Ads est invalide.");
    }
    // Compare civil dates, just like the lifecycle request parser. Comparing the
    // requested day's end with the current instant would incorrectly reject the
    // exact +90-day boundary for most of the current day.
    const currentDate = new Date(now);
    const today = Date.UTC(
      currentDate.getUTCFullYear(),
      currentDate.getUTCMonth(),
      currentDate.getUTCDate(),
    );
    const daysUntilEnd = (Date.parse(`${raw.endDate}T00:00:00.000Z`) - today) / 86_400_000;
    if (daysUntilEnd < 1 || daysUntilEnd > 90) {
      throw new GoogleAdsRemoteCampaignError("INVALID_REMOTE_UPDATE", "Choisissez une fin de campagne entre demain et dans 90 jours.");
    }
    normalized.endDate = raw.endDate;
  }

  if (Object.hasOwn(raw, "targetLocations")) {
    if (!Array.isArray(raw.targetLocations) || raw.targetLocations.length > 20 ||
        raw.targetLocations.some((location) => typeof location !== "string" || location.trim().length > 120)) {
      throw new GoogleAdsRemoteCampaignError("INVALID_REMOTE_UPDATE", "Vérifiez les zones géographiques Google Ads.");
    }
    normalized.targetLocations = raw.targetLocations.map((location) => location.trim()).filter(Boolean);
  }
  return normalized;
}

function microsToEuros(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value);
  if (!/^\d+$/.test(raw)) return null;
  const micros = Number(raw);
  return Number.isSafeInteger(micros) ? micros / 1_000_000 : null;
}

function nonNegativeInteger(value: unknown, omittedValue = 0): number | null {
  if (value === undefined) return omittedValue;
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (!/^\d+$/.test(String(value))) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function campaignStatus(value: unknown): GoogleAdsRemoteCampaignStatus | null {
  return value === "ENABLED" || value === "PAUSED" || value === "REMOVED" ? value : null;
}

function endDateFromGoogle(value: unknown): string | null {
  const match = typeof value === "string" ? value.match(/^(\d{4}-\d{2}-\d{2})(?:\s|T)/) : null;
  return match && validCalendarDate(match[1]) ? match[1] : null;
}

function campaignIdFromResourceName(resourceName: string): string {
  return resourceName.match(CAMPAIGN_RESOURCE)?.[2] || "";
}

async function readSnapshot(
  resources: GoogleAdsProviderResources,
  request: GoogleAdsRemoteRequest,
  options: { allowMissing?: boolean } = {},
): Promise<GoogleAdsRemoteCampaignSnapshot | null> {
  const campaignResponse = await request(`customers/${resources.customerId}/googleAds:search`, {
    query: `SELECT campaign.resource_name, campaign.name, campaign.status, campaign.end_date_time, campaign.campaign_budget, campaign_budget.resource_name, campaign_budget.amount_micros, campaign_budget.explicitly_shared, campaign_budget.reference_count FROM campaign WHERE campaign.resource_name = '${resources.campaignResourceName}' AND campaign.status IN (ENABLED, PAUSED, REMOVED) LIMIT 1`,
  });
  const rows = Array.isArray(campaignResponse.results) ? campaignResponse.results : [];
  if (!rows.length) {
    if (options.allowMissing) return null;
    throw new GoogleAdsRemoteCampaignError("REMOTE_CAMPAIGN_NOT_FOUND", "La campagne Google Ads enregistrée est introuvable ou inaccessible.");
  }

  const row = record(rows[0]);
  const campaign = record(row.campaign);
  const budget = record(row.campaignBudget);
  if (campaign.resourceName !== resources.campaignResourceName) {
    throw new GoogleAdsRemoteCampaignError("REMOTE_RESOURCE_MISMATCH", "Google Ads a retourné une autre campagne que celle demandée.");
  }
  const status = campaignStatus(campaign.status);
  if (!status) {
    throw new GoogleAdsRemoteCampaignError("REMOTE_RESPONSE_INCOMPLETE", "Google Ads n’a pas retourné un statut de campagne exploitable.");
  }

  const campaignBudget = typeof campaign.campaignBudget === "string" ? campaign.campaignBudget : "";
  const returnedBudget = typeof budget.resourceName === "string" ? budget.resourceName : campaignBudget;
  if (status !== "REMOVED" && returnedBudget !== resources.budgetResourceName) {
    throw new GoogleAdsRemoteCampaignError("REMOTE_RESOURCE_MISMATCH", "Le budget distant n’est plus celui enregistré pour cette campagne Google Ads.");
  }
  if (campaignBudget && campaignBudget !== resources.budgetResourceName) {
    throw new GoogleAdsRemoteCampaignError("REMOTE_RESOURCE_MISMATCH", "La campagne Google Ads utilise un autre budget que celui enregistré.");
  }

  const dailyBudgetEuros = microsToEuros(budget.amountMicros);
  const budgetExplicitlyShared = budget.explicitlyShared === true;
  const budgetReferenceCount = nonNegativeInteger(budget.referenceCount);
  const endDate = endDateFromGoogle(campaign.endDateTime);
  const name = typeof campaign.name === "string" ? campaign.name : "";
  if ((budget.explicitlyShared !== undefined && typeof budget.explicitlyShared !== "boolean") || budgetReferenceCount === null ||
      (status !== "REMOVED" && (!name || dailyBudgetEuros === null || !endDate))) {
    throw new GoogleAdsRemoteCampaignError("REMOTE_RESPONSE_INCOMPLETE", "Google Ads n’a pas retourné l’état complet de la campagne.");
  }

  let locationCriteria: GoogleAdsRemoteLocationCriterion[] = [];
  if (status !== "REMOVED") {
    const campaignId = campaignIdFromResourceName(resources.campaignResourceName);
    const criteriaResponse = await request(`customers/${resources.customerId}/googleAds:search`, {
      query: `SELECT campaign_criterion.resource_name, campaign_criterion.negative, campaign_criterion.type, campaign_criterion.location.geo_target_constant FROM campaign_criterion WHERE campaign.id = ${campaignId} AND campaign_criterion.type = LOCATION LIMIT 100`,
    });
    const criteriaRows = Array.isArray(criteriaResponse.results) ? criteriaResponse.results : [];
    locationCriteria = criteriaRows.flatMap((criterionRow) => {
      const criterion = record(record(criterionRow).campaignCriterion);
      if (criterion.negative === true) return [];
      const location = record(criterion.location);
      const geoTargetConstantResourceName = typeof location.geoTargetConstant === "string"
        ? location.geoTargetConstant
        : "";
      const resourceName = remoteCriterionResourceName(criterion.resourceName, resources.customerId, campaignId);
      if (!GEO_TARGET_RESOURCE.test(geoTargetConstantResourceName)) {
        throw new GoogleAdsRemoteCampaignError("REMOTE_RESPONSE_INCOMPLETE", "Google Ads a retourné un ciblage géographique incomplet.");
      }
      return [{ resourceName, geoTargetConstantResourceName }];
    });
  }

  return {
    customerId: resources.customerId,
    campaignResourceName: resources.campaignResourceName,
    budgetResourceName: resources.budgetResourceName,
    name,
    dailyBudgetEuros,
    budgetExplicitlyShared,
    budgetReferenceCount: budgetReferenceCount || 0,
    endDate,
    status,
    locationCriteria,
  };
}

function persistedResources(
  resources: GoogleAdsProviderResources,
  status: GoogleAdsRemoteCampaignStatus,
  snapshot: GoogleAdsRemoteCampaignSnapshot | null,
  initialActivationCompleted = false,
): Record<string, unknown> {
  const locationCriterionResourceNames = snapshot
    ? snapshot.locationCriteria.map((criterion) => criterion.resourceName)
    : resources.locationCriterionResourceNames;
  const source = { ...resources.source };
  delete source.locationCriterionResourceName;
  delete source.locationCriterionResourceNames;
  delete source.status;
  return {
    ...source,
    customerId: resources.customerId,
    campaignResourceName: resources.campaignResourceName,
    budgetResourceName: resources.budgetResourceName,
    ...(locationCriterionResourceNames[0]
      ? { locationCriterionResourceName: locationCriterionResourceNames[0] }
      : {}),
    locationCriterionResourceNames,
    status,
    ...(source.initialActivationPending === true && (initialActivationCompleted || status === "ENABLED")
      ? { initialActivationPending: false } : {}),
  };
}

function mutationResultResourceName(value: unknown, resultKey: string): string {
  return String(record(record(value)[resultKey]).resourceName || "");
}

function assertUnifiedMutationResponse(
  response: Record<string, unknown>,
  expectations: MutationExpectation[],
) {
  if (response.partialFailureError) {
    throw new GoogleAdsRemoteCampaignError("REMOTE_MUTATION_UNCONFIRMED", "Google Ads a signalé un échec partiel inattendu. Vérifiez la campagne avant de réessayer.");
  }
  const results = Array.isArray(response.mutateOperationResponses) ? response.mutateOperationResponses : [];
  if (results.length !== expectations.length) {
    throw new GoogleAdsRemoteCampaignError("REMOTE_MUTATION_UNCONFIRMED", "La réponse de modification Google Ads est incomplète. Vérifiez la campagne avant de réessayer.");
  }
  expectations.forEach((expectation, index) => {
    const resourceName = mutationResultResourceName(results[index], expectation.resultKey);
    const exact = expectation.expectedResourceName && resourceName === expectation.expectedResourceName;
    const prefixed = expectation.expectedPrefix && resourceName.startsWith(expectation.expectedPrefix) &&
      /^(?:\d+|[A-Z_]+)$/.test(resourceName.slice(expectation.expectedPrefix.length));
    if (!exact && !prefixed) {
      throw new GoogleAdsRemoteCampaignError("REMOTE_MUTATION_UNCONFIRMED", "Google Ads n’a pas confirmé toutes les ressources modifiées. Vérifiez la campagne avant de réessayer.");
    }
  });
}

function assertCampaignMutationResponse(response: Record<string, unknown>, campaignResourceName: string) {
  if (response.partialFailureError) {
    throw new GoogleAdsRemoteCampaignError("REMOTE_MUTATION_UNCONFIRMED", "Google Ads a signalé un échec partiel inattendu. Vérifiez la campagne avant de réessayer.");
  }
  const results = Array.isArray(response.results) ? response.results : [];
  if (results.length !== 1 || record(results[0]).resourceName !== campaignResourceName) {
    throw new GoogleAdsRemoteCampaignError("REMOTE_MUTATION_UNCONFIRMED", "Google Ads n’a pas confirmé la modification de la campagne. Vérifiez-la avant de réessayer.");
  }
}

function sameSet(left: Iterable<string>, right: Iterable<string>): boolean {
  const a = new Set(left);
  const b = new Set(right);
  return a.size === b.size && [...a].every((value) => b.has(value));
}

function assertUpdateApplied(
  snapshot: GoogleAdsRemoteCampaignSnapshot,
  update: NormalizedGoogleAdsRemoteCampaignUpdate,
  locations: GoogleAdsResolvedTargetLocation[] | null,
) {
  const applied = (update.name === undefined || snapshot.name === update.name) &&
    (update.dailyBudgetEuros === undefined || snapshot.dailyBudgetEuros === update.dailyBudgetEuros) &&
    (update.endDate === undefined || snapshot.endDate === update.endDate) &&
    (!locations || sameSet(
      snapshot.locationCriteria.map((criterion) => criterion.geoTargetConstantResourceName),
      locations.map((location) => location.resourceName),
    ));
  if (!applied) {
    throw new GoogleAdsRemoteCampaignError("REMOTE_MUTATION_UNCONFIRMED", "La modification Google Ads n’a pas pu être confirmée. Vérifiez la campagne avant de réessayer.");
  }
}

export function createGoogleAdsRemoteCampaignCoreAdapter(
  input: CoreAdapterInput,
): GoogleAdsRemoteCampaignAdapter {
  const resources = parseGoogleAdsProviderResources(input.providerResources, input.expectedCustomerId);
  const now = input.now || Date.now;
  let activationWasObserved = resources.source.initialActivationPending === false;
  const persist = (status: GoogleAdsRemoteCampaignStatus, snapshot: GoogleAdsRemoteCampaignSnapshot | null) =>
    persistedResources(resources, status, snapshot, activationWasObserved);

  const read = async () => {
    const snapshot = await readSnapshot(resources, input.request);
    if (!snapshot) {
      throw new GoogleAdsRemoteCampaignError("REMOTE_CAMPAIGN_NOT_FOUND", "La campagne Google Ads enregistrée est introuvable ou inaccessible.");
    }
    if (snapshot.status === "ENABLED") activationWasObserved = true;
    return snapshot;
  };

  const update = async (rawUpdate: GoogleAdsRemoteCampaignUpdate): Promise<GoogleAdsRemoteCampaignMutationResult> => {
    const campaignUpdate = normalizeGoogleAdsRemoteCampaignUpdate(rawUpdate, now());
    const before = await read();
    if (before.status === "REMOVED") {
      throw new GoogleAdsRemoteCampaignError("REMOTE_CAMPAIGN_REMOVED", "Une campagne Google Ads supprimée ne peut plus être modifiée.");
    }

    const targetLocations = campaignUpdate.targetLocations === undefined
      ? null
      : await input.resolveTargetLocations(campaignUpdate.targetLocations);
    if (targetLocations && (!targetLocations.length || targetLocations.some((location) => !GEO_TARGET_RESOURCE.test(location.resourceName)))) {
      throw new GoogleAdsRemoteCampaignError("REMOTE_RESPONSE_INCOMPLETE", "La résolution géographique Google Ads n’a retourné aucune zone exploitable.");
    }

    const mutateOperations: Record<string, unknown>[] = [];
    const expectations: MutationExpectation[] = [];
    const campaignFields: Record<string, unknown> = { resourceName: resources.campaignResourceName };
    const campaignMask: string[] = [];
    if (campaignUpdate.name !== undefined && campaignUpdate.name !== before.name) {
      campaignFields.name = campaignUpdate.name;
      campaignMask.push("name");
    }
    if (campaignUpdate.endDate !== undefined && campaignUpdate.endDate !== before.endDate) {
      campaignFields.endDateTime = `${campaignUpdate.endDate} 23:59:59`;
      campaignMask.push("end_date_time");
    }
    if (campaignMask.length) {
      mutateOperations.push({ campaignOperation: { update: campaignFields, updateMask: campaignMask.join(",") } });
      expectations.push({ resultKey: "campaignResult", expectedResourceName: resources.campaignResourceName });
    }

    if (campaignUpdate.dailyBudgetEuros !== undefined && campaignUpdate.dailyBudgetEuros !== before.dailyBudgetEuros) {
      if (before.budgetExplicitlyShared || before.budgetReferenceCount > 1) {
        throw new GoogleAdsRemoteCampaignError("REMOTE_SHARED_BUDGET", "Le budget Google Ads est désormais partagé avec une autre campagne. Modifiez-le directement dans Google Ads pour éviter d’affecter d’autres campagnes.");
      }
      mutateOperations.push({ campaignBudgetOperation: { update: {
        resourceName: resources.budgetResourceName,
        amountMicros: String(Math.round(campaignUpdate.dailyBudgetEuros * 1_000_000)),
      }, updateMask: "amount_micros" } });
      expectations.push({ resultKey: "campaignBudgetResult", expectedResourceName: resources.budgetResourceName });
    }

    if (targetLocations) {
      const desired = new Set(targetLocations.map((location) => location.resourceName));
      const currentByTarget = new Map<string, GoogleAdsRemoteLocationCriterion[]>();
      for (const criterion of before.locationCriteria) {
        const matches = currentByTarget.get(criterion.geoTargetConstantResourceName) || [];
        matches.push(criterion);
        currentByTarget.set(criterion.geoTargetConstantResourceName, matches);
      }
      for (const location of targetLocations) {
        if (currentByTarget.has(location.resourceName)) continue;
        mutateOperations.push({ campaignCriterionOperation: { create: {
          campaign: resources.campaignResourceName,
          location: { geoTargetConstant: location.resourceName },
        } } });
        expectations.push({
          resultKey: "campaignCriterionResult",
          expectedPrefix: `customers/${resources.customerId}/campaignCriteria/${campaignIdFromResourceName(resources.campaignResourceName)}~`,
        });
      }
      for (const [geoTarget, criteria] of currentByTarget) {
        const obsolete = desired.has(geoTarget) ? criteria.slice(1) : criteria;
        for (const criterion of obsolete) {
          mutateOperations.push({ campaignCriterionOperation: { remove: criterion.resourceName } });
          expectations.push({ resultKey: "campaignCriterionResult", expectedResourceName: criterion.resourceName });
        }
      }
    }

    if (!mutateOperations.length) {
      return {
        action: "update",
        changed: false,
        status: before.status,
        snapshot: before,
        providerResources: persist(before.status, before),
      };
    }

    const mutationResponse = await input.request(`customers/${resources.customerId}/googleAds:mutate`, {
      partialFailure: false,
      mutateOperations,
    });
    assertUnifiedMutationResponse(mutationResponse, expectations);

    let after: GoogleAdsRemoteCampaignSnapshot;
    try {
      after = await read();
    } catch (error) {
      throw new GoogleAdsRemoteCampaignError("REMOTE_MUTATION_UNCONFIRMED", "Google Ads a accepté la modification, mais son nouvel état n’a pas pu être relu. Vérifiez la campagne avant de réessayer.", { cause: error });
    }
    assertUpdateApplied(after, campaignUpdate, targetLocations);
    return {
      action: "update",
      changed: true,
      status: after.status,
      snapshot: after,
      providerResources: persist(after.status, after),
    };
  };

  const setStatus = async (status: "ENABLED" | "PAUSED"): Promise<GoogleAdsRemoteCampaignMutationResult> => {
    const action = status === "PAUSED" ? "pause" : "resume";
    // Legacy campaigns and ordinary resumes never touch child statuses. Only
    // the publisher's explicit first-activation manifest authorizes this work.
    const initial = status === "ENABLED" && !activationWasObserved ? initialActivationResources(resources) : null;
    const before = await read();
    if (before.status === "REMOVED") {
      throw new GoogleAdsRemoteCampaignError("REMOTE_CAMPAIGN_REMOVED", "Une campagne Google Ads supprimée ne peut plus être activée ni mise en pause.");
    }
    if (initial) {
      const children = await readInitialActivationChildren(resources, initial, input.request);
      const pausedChildren = children.filter((child) => child.status === "PAUSED");
      if (before.status === "ENABLED" && pausedChildren.length) {
        throw new GoogleAdsRemoteCampaignError("REMOTE_RESOURCE_MISMATCH", "La campagne Google Ads a déjà été activée mais certains éléments sont en pause. Vérifiez-les sur Google Ads ; leur pause manuelle est conservée.");
      }
      if (pausedChildren.length) {
        try {
          const response = await input.request(`customers/${resources.customerId}/googleAds:mutate`, {
            partialFailure: false,
            mutateOperations: pausedChildren.map((child) => ({
              [child.operationKey]: { update: { resourceName: child.resourceName, status: "ENABLED" }, updateMask: "status" },
            })),
          });
          assertUnifiedMutationResponse(response, pausedChildren.map((child) => ({
            resultKey: child.resultKey, expectedResourceName: child.resourceName,
          })));
          const verified = await readInitialActivationChildren(resources, initial, input.request);
          if (verified.some((child) => child.status !== "ENABLED")) throw new Error("Un élément Google Ads reste en pause.");
        } catch (error) {
          throw new GoogleAdsRemoteCampaignError("REMOTE_MUTATION_UNCONFIRMED", "Google Ads n’a pas confirmé l’activation des annonces et mots-clés. La campagne reste en pause ; contrôlez ses éléments avant de réessayer.", { cause: error });
        }
      }
    }
    if (before.status === status) {
      return {
        action,
        changed: false,
        status,
        snapshot: before,
        providerResources: persist(status, before),
      };
    }

    const response = await input.request(`customers/${resources.customerId}/campaigns:mutate`, {
      partialFailure: false,
      operations: [{
        update: { resourceName: resources.campaignResourceName, status },
        updateMask: "status",
      }],
    });
    assertCampaignMutationResponse(response, resources.campaignResourceName);

    let after: GoogleAdsRemoteCampaignSnapshot;
    try {
      after = await read();
    } catch (error) {
      throw new GoogleAdsRemoteCampaignError("REMOTE_MUTATION_UNCONFIRMED", "Google Ads a accepté le changement de statut, mais il n’a pas pu être confirmé. Vérifiez la campagne avant de réessayer.", { cause: error });
    }
    if (after.status !== status) {
      throw new GoogleAdsRemoteCampaignError("REMOTE_MUTATION_UNCONFIRMED", "Le statut demandé n’est pas confirmé par Google Ads. Vérifiez la campagne avant de réessayer.");
    }
    return {
      action,
      changed: true,
      status,
      snapshot: after,
      providerResources: persist(status, after),
    };
  };

  const remove = async (): Promise<GoogleAdsRemoteCampaignMutationResult> => {
    const before = await read();
    if (before.status === "REMOVED") {
      return {
        action: "remove",
        changed: false,
        status: "REMOVED",
        snapshot: before,
        providerResources: persist("REMOVED", before),
      };
    }

    const response = await input.request(`customers/${resources.customerId}/campaigns:mutate`, {
      partialFailure: false,
      operations: [{ remove: resources.campaignResourceName }],
    });
    assertCampaignMutationResponse(response, resources.campaignResourceName);

    let after: GoogleAdsRemoteCampaignSnapshot | null;
    try {
      after = await readSnapshot(resources, input.request, { allowMissing: true });
    } catch (error) {
      throw new GoogleAdsRemoteCampaignError("REMOTE_MUTATION_UNCONFIRMED", "Google Ads a accepté la suppression, mais elle n’a pas pu être confirmée. Vérifiez la campagne avant de réessayer.", { cause: error });
    }
    if (after && after.status !== "REMOVED") {
      throw new GoogleAdsRemoteCampaignError("REMOTE_MUTATION_UNCONFIRMED", "La suppression n’est pas confirmée par Google Ads. Vérifiez la campagne avant de réessayer.");
    }
    return {
      action: "remove",
      changed: true,
      status: "REMOVED",
      snapshot: after,
      providerResources: persist("REMOVED", after),
    };
  };

  return {
    read,
    update,
    pause: () => setStatus("PAUSED"),
    resume: () => setStatus("ENABLED"),
    remove,
  };
}
