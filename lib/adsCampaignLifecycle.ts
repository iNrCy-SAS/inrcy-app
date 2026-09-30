export const ADS_REMOTE_DELETE_CONFIRMATION = "DELETE_REMOTE_AD_CAMPAIGN";
export const ADS_REMOTE_ARCHIVE_CONFIRMATION = "ARCHIVE_REMOTE_AD_CAMPAIGN";
export const ADS_LOCAL_RECOVERY_DISCARD_CONFIRMATION = "DISCARD_INTERRUPTED_AD_CAMPAIGN_LOCAL_RECORD";

export type AdsCampaignLifecycleAction = "update" | "pause" | "resume" | "archive" | "reconcile";

export type AdsCampaignLifecycleChanges = {
  name?: string;
  dailyBudgetCents?: number;
  endDate?: string;
  targetLocations?: string[];
};

export type AdsCampaignLifecycleRequest = {
  action: AdsCampaignLifecycleAction;
  changes: AdsCampaignLifecycleChanges;
};

type RemoteCampaignIdentity = {
  provider: unknown;
  ad_account_id?: unknown;
  status?: unknown;
  provider_resources: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validIsoDay(value: string): boolean {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function parseLocations(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) return null;
  const locations = value.map((entry) => typeof entry === "string" ? entry.trim() : "");
  if (locations.some((entry) => !entry || entry.length > 120)) return null;
  return [...new Set(locations)];
}

export function parseAdsCampaignLifecycleRequest(
  value: unknown,
  now = new Date(),
): { request: AdsCampaignLifecycleRequest | null; error: string | null } {
  if (!isRecord(value)) return { request: null, error: "Requête de gestion invalide." };
  const action = value.action;
  if (action !== "update" && action !== "pause" && action !== "resume" && action !== "archive" && action !== "reconcile") {
    return { request: null, error: "Action de campagne invalide." };
  }
  if (action !== "update") return { request: { action, changes: {} }, error: null };

  if (!isRecord(value.changes)) {
    return { request: null, error: "Indiquez au moins une modification." };
  }
  const changes: AdsCampaignLifecycleChanges = {};

  if (Object.hasOwn(value.changes, "name")) {
    const name = typeof value.changes.name === "string" ? value.changes.name.trim() : "";
    if (name.length < 3 || name.length > 100) {
      return { request: null, error: "Le nom de campagne doit contenir entre 3 et 100 caractères." };
    }
    changes.name = name;
  }

  if (Object.hasOwn(value.changes, "dailyBudgetEuros")) {
    const amount = Number(value.changes.dailyBudgetEuros);
    const cents = Math.round(amount * 100);
    if (!Number.isFinite(amount) || amount < 5 || amount > 500 || Math.abs(cents - amount * 100) > 0.000001) {
      return { request: null, error: "Le budget journalier doit être compris entre 5 et 500 €, avec deux décimales maximum." };
    }
    changes.dailyBudgetCents = cents;
  }

  if (Object.hasOwn(value.changes, "endDate")) {
    const endDate = typeof value.changes.endDate === "string" ? value.changes.endDate.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || !validIsoDay(endDate)) {
      return { request: null, error: "Choisissez une date de fin valide." };
    }
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const days = (Date.parse(`${endDate}T00:00:00.000Z`) - today) / 86_400_000;
    if (days < 1 || days > 90) {
      return { request: null, error: "Choisissez une fin de campagne entre demain et dans 90 jours." };
    }
    changes.endDate = endDate;
  }

  if (Object.hasOwn(value.changes, "targetLocations")) {
    const targetLocations = parseLocations(value.changes.targetLocations);
    if (!targetLocations) {
      return { request: null, error: "Ajoutez entre 1 et 20 zones ciblées valides." };
    }
    changes.targetLocations = targetLocations;
  }

  if (!Object.keys(changes).length) {
    return { request: null, error: "Indiquez au moins une modification." };
  }
  return { request: { action, changes }, error: null };
}

export function hasRemoteAdsResources(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).some((key) => key !== "inrcyLifecycleClaim" && key !== "inrcyLifecycleRecovery");
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function lifecycleRecoveryOperation(resources: unknown): string | null {
  const recovery = isRecord(resources) && isRecord(resources.inrcyLifecycleRecovery)
    ? resources.inrcyLifecycleRecovery : null;
  return typeof recovery?.operation === "string" ? recovery.operation : null;
}

export function hasProviderCampaignIdentifier(input: RemoteCampaignIdentity): boolean {
  const resources = isRecord(input.provider_resources) ? input.provider_resources : {};
  const value = input.provider === "google" ? resources.campaignResourceName
    : input.provider === "meta" || input.provider === "pinterest" ? resources.campaignId
      : input.provider === "linkedin" ? resources.campaignUrn ?? resources.campaignId : undefined;
  // Any persisted value is treated as a possible remote identity here. A
  // malformed ID must be inspected, never downgraded to a safe local-only
  // cleanup merely because its type is unexpected.
  if (value === undefined || value === null) return false;
  return typeof value !== "string" || value.trim().length > 0;
}

export function hasCompleteInitialPublishResources(input: RemoteCampaignIdentity): boolean {
  const resources = isRecord(input.provider_resources) ? input.provider_resources : {};
  const accountId = typeof input.ad_account_id === "string" ? input.ad_account_id.replace(/^act_/, "").replace(/-/g, "") : "";
  if (!/^\d{5,30}$/.test(accountId)) return false;
  if (input.provider === "google") {
    const campaignPrefix = `customers/${accountId}/campaigns/`;
    const budgetPrefix = `customers/${accountId}/campaignBudgets/`;
    const adGroupPrefix = `customers/${accountId}/adGroups/`;
    const adPrefix = `customers/${accountId}/adGroupAds/`;
    return nonEmptyString(resources.campaignResourceName) && resources.campaignResourceName.startsWith(campaignPrefix)
      && nonEmptyString(resources.budgetResourceName) && resources.budgetResourceName.startsWith(budgetPrefix)
      && nonEmptyString(resources.adGroupResourceName) && resources.adGroupResourceName.startsWith(adGroupPrefix)
      && nonEmptyString(resources.adGroupAdResourceName) && resources.adGroupAdResourceName.startsWith(adPrefix);
  }
  if (input.provider === "meta") {
    return resources.provider === "meta" && resources.adAccountId === accountId
      && [resources.campaignId, resources.adSetId, resources.creativeId, resources.adId]
        .every((value) => typeof value === "string" && /^\d{5,25}$/.test(value));
  }
  if (input.provider === "pinterest") {
    return [resources.campaignId, resources.adGroupId, resources.pinId, resources.adId]
      .every((value) => typeof value === "string" && /^\d{5,30}$/.test(value));
  }
  if (input.provider === "linkedin") {
    const campaignUrn = typeof resources.campaignUrn === "string" ? resources.campaignUrn : "";
    const campaignId = typeof resources.campaignId === "string" ? resources.campaignId : "";
    return campaignUrn === `urn:li:sponsoredCampaign:${campaignId}`
      && /^\d{1,25}$/.test(campaignId)
      && typeof resources.postUrn === "string" && /^urn:li:(?:share|ugcPost):\d{1,25}$/.test(resources.postUrn)
      && typeof resources.creativeUrn === "string" && /^urn:li:sponsoredCreative:\d{1,25}$/.test(resources.creativeUrn)
      && (resources.stage === "active" || resources.stage === "paused");
  }
  return false;
}

export function canDiscardInterruptedInitialPublish(input: RemoteCampaignIdentity): boolean {
  return (input.provider === "google" || input.provider === "meta" || input.provider === "pinterest" || input.provider === "linkedin")
    && input.status === "needs_review"
    && lifecycleRecoveryOperation(input.provider_resources) === "initial_publish"
    && !hasProviderCampaignIdentifier(input);
}

export function canManageRemoteAdsCampaign(input: {
  provider: unknown;
  ad_account_id?: unknown;
  status: unknown;
  provider_resources: unknown;
}): boolean {
  const linkedInInitialRecovery = input.provider === "linkedin" && input.status === "needs_review"
    && lifecycleRecoveryOperation(input.provider_resources) === "initial_publish";
  return (input.provider === "google" || input.provider === "meta" || input.provider === "pinterest" || input.provider === "linkedin")
    && (input.status === "active" || input.status === "paused" || input.status === "demo_paused" || input.status === "needs_review")
    && (hasProviderCampaignIdentifier(input) || linkedInInitialRecovery);
}

export function canRecoverInterruptedAdsCampaign(input: {
  provider: unknown;
  status: unknown;
}): boolean {
  return (input.provider === "google" || input.provider === "meta" || input.provider === "pinterest" || input.provider === "linkedin") && input.status === "publishing";
}

export function hasRemoteDeleteConfirmation(value: unknown): boolean {
  return isRecord(value) && value.confirmation === ADS_REMOTE_DELETE_CONFIRMATION;
}

export function hasRemoteArchiveConfirmation(value: unknown): boolean {
  return isRecord(value) && value.confirmation === ADS_REMOTE_ARCHIVE_CONFIRMATION;
}

export function hasLocalRecoveryDiscardConfirmation(value: unknown): boolean {
  return isRecord(value) && value.confirmation === ADS_LOCAL_RECOVERY_DISCARD_CONFIRMATION;
}
