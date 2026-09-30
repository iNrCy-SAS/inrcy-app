import {
  buildLinkedInAdsCampaignAnalyticsPath,
  buildLinkedInAdsCampaignArchiveRequest,
  buildLinkedInAdsCampaignDeletionRequest,
  buildLinkedInAdsCampaignEditRequest,
  buildLinkedInAdsCampaignReadPath,
  buildLinkedInAdsCampaignStatusRequest,
  type LinkedInAdsCampaignOperationEvidence,
  type LinkedInAdsCampaignStatus,
} from "./adsLinkedInOperations.ts";
import {
  linkedInAdsCampaignReference,
  linkedInAdsCreativeUrn,
} from "./adsLinkedInPublisherCore.ts";

export type LinkedInAdsLifecycleContext = {
  accountId: string;
  accountCurrency: string;
  scopes: string;
  hasAccountAccess: boolean;
  canManageCampaigns: boolean;
  canServeCampaigns: boolean;
};

export type LinkedInAdsRemoteRequestInput = {
  method: "GET" | "POST" | "DELETE";
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
};

export type LinkedInAdsRemoteRequest = (input: LinkedInAdsRemoteRequestInput) => Promise<unknown>;

export type LinkedInAdsLifecycleState =
  | "active"
  | "paused"
  | "draft"
  | "archived"
  | "pending_deletion"
  | "removed";

export type LinkedInAdsLifecycleResult = {
  state: LinkedInAdsLifecycleState;
  providerStatus: LinkedInAdsCampaignStatus;
  resources: Record<string, unknown> & { campaignId: string; campaignUrn: string };
};

export class LinkedInAdsLifecycleError extends Error {
  readonly remoteMayHaveChanged: boolean;
  readonly status?: number;

  constructor(
    message: string,
    remoteMayHaveChanged: boolean,
    status?: number,
  ) {
    super(message);
    this.name = "LinkedInAdsLifecycleError";
    this.remoteMayHaveChanged = remoteMayHaveChanged;
    this.status = status;
  }
}

type CampaignSnapshot = LinkedInAdsLifecycleResult & {
  evidence: LinkedInAdsCampaignOperationEvidence;
  raw: Record<string, unknown>;
  campaignGroupUrn: string | null;
};

const CAMPAIGN_GROUP_URN = /^urn:li:sponsoredCampaignGroup:(\d{1,25})$/;
const CAMPAIGN_STATUSES = new Set<LinkedInAdsCampaignStatus>([
  "ACTIVE", "PAUSED", "ARCHIVED", "COMPLETED", "CANCELED", "DRAFT", "PENDING_DELETION", "REMOVED",
]);

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function entity(value: unknown): Record<string, unknown> {
  const root = record(value);
  const data = record(root.data);
  return Object.keys(data).length ? data : root;
}

function lifecycleState(status: LinkedInAdsCampaignStatus): LinkedInAdsLifecycleState {
  if (status === "ACTIVE") return "active";
  if (status === "PAUSED" || status === "COMPLETED" || status === "CANCELED") return "paused";
  if (status === "DRAFT") return "draft";
  if (status === "ARCHIVED") return "archived";
  if (status === "PENDING_DELETION") return "pending_deletion";
  return "removed";
}

function resources(value: unknown, accountId: string) {
  const source = record(value);
  if (source.accountId !== undefined && source.accountId !== accountId) {
    throw new LinkedInAdsLifecycleError(
      "Les ressources LinkedIn enregistrées ne correspondent plus au compte annonceur.",
      false,
    );
  }
  const byUrn = linkedInAdsCampaignReference(source.campaignUrn);
  const byId = linkedInAdsCampaignReference(source.campaignId);
  const campaign = byUrn || byId;
  if (!campaign || (byUrn && byId && byUrn.urn !== byId.urn)) {
    throw new LinkedInAdsLifecycleError(
      "L’identifiant de campagne LinkedIn est incomplet ou incohérent.",
      false,
    );
  }
  return { ...source, campaignId: campaign.id, campaignUrn: campaign.urn };
}

function safeTime(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}

function campaignSnapshot(
  payload: unknown,
  context: LinkedInAdsLifecycleContext,
  providerResources: Record<string, unknown> & { campaignId: string; campaignUrn: string },
  nowMs: number,
): CampaignSnapshot {
  const row = entity(payload);
  const reference = linkedInAdsCampaignReference(row.id);
  const status = typeof row.status === "string" && CAMPAIGN_STATUSES.has(row.status as LinkedInAdsCampaignStatus)
    ? row.status as LinkedInAdsCampaignStatus
    : null;
  if (!reference || reference.urn !== providerResources.campaignUrn
    || row.account !== `urn:li:sponsoredAccount:${context.accountId}` || !status) {
    throw new LinkedInAdsLifecycleError(
      "LinkedIn n’a pas confirmé l’identité et la propriété de cette campagne.",
      false,
    );
  }
  const rawSchedule = record(row.runSchedule);
  const runSchedule = {
    ...(safeTime(rawSchedule.start) ? { start: safeTime(rawSchedule.start) } : {}),
    ...(safeTime(rawSchedule.end) ? { end: safeTime(rawSchedule.end) } : {}),
  };
  const campaignGroupUrn = typeof row.campaignGroup === "string" && CAMPAIGN_GROUP_URN.test(row.campaignGroup)
    ? row.campaignGroup
    : null;
  const evidence: LinkedInAdsCampaignOperationEvidence = {
    fetchedAtMs: nowMs,
    selectedAccountId: context.accountId,
    accountCurrency: context.accountCurrency,
    scopes: context.scopes,
    hasAccountAccess: context.hasAccountAccess,
    canManageCampaigns: context.canManageCampaigns,
    campaign: {
      urn: reference.urn,
      account: String(row.account),
      status,
      ...(Object.keys(runSchedule).length ? { runSchedule } : {}),
    },
  };
  return {
    state: lifecycleState(status),
    providerStatus: status,
    resources: providerResources,
    evidence,
    raw: row,
    campaignGroupUrn,
  };
}

async function readSnapshot(
  context: LinkedInAdsLifecycleContext,
  value: unknown,
  request: LinkedInAdsRemoteRequest,
  now: () => number,
): Promise<CampaignSnapshot> {
  const parsed = resources(value, context.accountId);
  const path = buildLinkedInAdsCampaignReadPath(context.accountId, parsed.campaignUrn);
  const payload = await request({ method: "GET", path });
  return campaignSnapshot(payload, context, parsed, now());
}

function amount(value: unknown, currency: string): number | null {
  const money = record(value);
  if (money.currencyCode !== currency) return null;
  const parsed = Number(money.amount);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function sameNumber(left: number | null, right: number): boolean {
  return left !== null && Math.abs(left - right) < 0.000001;
}

function endAtMs(endDate: string): number {
  const value = Date.parse(`${endDate}T23:59:59.000Z`);
  if (!Number.isSafeInteger(value)) throw new LinkedInAdsLifecycleError("Date de fin LinkedIn invalide.", false);
  return value;
}

function mutationRejected(error: unknown, fallback: string): LinkedInAdsLifecycleError {
  if (error instanceof LinkedInAdsLifecycleError) return error;
  return new LinkedInAdsLifecycleError(error instanceof Error ? error.message : fallback, true);
}

function confirmationFailed(error: unknown, fallback: string): LinkedInAdsLifecycleError {
  return new LinkedInAdsLifecycleError(
    `${error instanceof Error && error.message ? error.message : fallback} Vérifiez le statut dans LinkedIn Campaign Manager avant de réessayer.`,
    true,
  );
}

async function mutate(
  request: LinkedInAdsRemoteRequest,
  operation: { method: "POST" | "DELETE"; path: string; headers: Record<string, string>; body?: unknown },
  fallback: string,
): Promise<void> {
  try {
    await request(operation);
  } catch (error) {
    throw mutationRejected(error, fallback);
  }
}

export async function readLinkedInAdsCampaignStateCore(input: {
  context: LinkedInAdsLifecycleContext;
  resources: unknown;
  request: LinkedInAdsRemoteRequest;
  now?: () => number;
}): Promise<LinkedInAdsLifecycleResult> {
  const snapshot = await readSnapshot(input.context, input.resources, input.request, input.now || Date.now);
  return { state: snapshot.state, providerStatus: snapshot.providerStatus, resources: snapshot.resources };
}

export async function updateLinkedInAdsCampaignCore(input: {
  context: LinkedInAdsLifecycleContext;
  resources: unknown;
  changes: { name?: string; dailyBudgetCents?: number; endDate?: string };
  request: LinkedInAdsRemoteRequest;
  now?: () => number;
}): Promise<LinkedInAdsLifecycleResult> {
  const now = input.now || Date.now;
  const current = await readSnapshot(input.context, input.resources, input.request, now);
  const desiredBudget = input.changes.dailyBudgetCents === undefined
    ? undefined : input.changes.dailyBudgetCents / 100;
  const desiredEnd = input.changes.endDate === undefined ? undefined : endAtMs(input.changes.endDate);
  const currentName = typeof current.raw.name === "string" ? current.raw.name.trim() : "";
  const currentBudget = amount(current.raw.dailyBudget, "EUR");
  const currentEnd = safeTime(record(current.raw.runSchedule).end);
  const name = input.changes.name !== undefined && input.changes.name.trim() !== currentName
    ? input.changes.name : undefined;
  const dailyBudget = desiredBudget !== undefined && !sameNumber(currentBudget, desiredBudget)
    ? desiredBudget : undefined;
  const end = desiredEnd !== undefined && currentEnd !== desiredEnd ? desiredEnd : undefined;
  if (name === undefined && dailyBudget === undefined && end === undefined) {
    return { state: current.state, providerStatus: current.providerStatus, resources: current.resources };
  }
  const operation = buildLinkedInAdsCampaignEditRequest({
    evidence: current.evidence,
    ...(name === undefined ? {} : { name }),
    ...(dailyBudget === undefined ? {} : { dailyBudget }),
    ...(end === undefined ? {} : { endAtMs: end }),
    nowMs: now(),
  });
  await mutate(input.request, operation, "LinkedIn n’a pas confirmé la modification de la campagne.");
  let confirmed: CampaignSnapshot;
  try {
    confirmed = await readSnapshot(input.context, current.resources, input.request, now);
  } catch (error) {
    throw confirmationFailed(error, "LinkedIn n’a pas confirmé la modification.");
  }
  if ((input.changes.name !== undefined && String(confirmed.raw.name || "").trim() !== input.changes.name.trim())
    || (desiredBudget !== undefined && !sameNumber(amount(confirmed.raw.dailyBudget, "EUR"), desiredBudget))
    || (desiredEnd !== undefined && safeTime(record(confirmed.raw.runSchedule).end) !== desiredEnd)) {
    throw confirmationFailed(null, "LinkedIn n’a pas retourné les valeurs demandées.");
  }
  return { state: confirmed.state, providerStatus: confirmed.providerStatus, resources: confirmed.resources };
}

async function assertActivationHierarchy(
  context: LinkedInAdsLifecycleContext,
  current: CampaignSnapshot,
  request: LinkedInAdsRemoteRequest,
): Promise<void> {
  if (!context.canServeCampaigns) {
    throw new LinkedInAdsLifecycleError(
      "Le compte LinkedIn Ads est On hold ou non servable. La campagne reste en pause.",
      false,
    );
  }
  const groupMatch = current.campaignGroupUrn ? CAMPAIGN_GROUP_URN.exec(current.campaignGroupUrn) : null;
  const creativeUrn = linkedInAdsCreativeUrn(current.resources.creativeUrn);
  if (!groupMatch || !creativeUrn) {
    throw new LinkedInAdsLifecycleError("La hiérarchie LinkedIn à réactiver est incomplète.", false);
  }
  const [groupPayload, creativePayload] = await Promise.all([
    request({ method: "GET", path: `/rest/adAccounts/${context.accountId}/adCampaignGroups/${groupMatch[1]}` }),
    request({ method: "GET", path: `/rest/adAccounts/${context.accountId}/creatives/${encodeURIComponent(creativeUrn)}` }),
  ]);
  const group = entity(groupPayload);
  const creative = entity(creativePayload);
  const groupReference = typeof group.id === "number" && Number.isSafeInteger(group.id)
    ? `urn:li:sponsoredCampaignGroup:${group.id}`
    : typeof group.id === "string" && /^\d{1,25}$/.test(group.id)
      ? `urn:li:sponsoredCampaignGroup:${group.id}` : String(group.id || "");
  if (groupReference !== current.campaignGroupUrn
    || group.account !== `urn:li:sponsoredAccount:${context.accountId}` || group.status !== "ACTIVE") {
    throw new LinkedInAdsLifecycleError("Le groupe de campagnes LinkedIn n’est plus actif ou n’appartient plus au compte.", false);
  }
  if (linkedInAdsCreativeUrn(creative.id) !== creativeUrn
    || creative.account !== `urn:li:sponsoredAccount:${context.accountId}`
    || creative.campaign !== current.resources.campaignUrn
    || creative.intendedStatus !== "ACTIVE") {
    throw new LinkedInAdsLifecycleError("La création LinkedIn active ne correspond plus à cette campagne.", false);
  }
}

export async function setLinkedInAdsCampaignPausedCore(input: {
  context: LinkedInAdsLifecycleContext;
  resources: unknown;
  paused: boolean;
  request: LinkedInAdsRemoteRequest;
  now?: () => number;
}): Promise<LinkedInAdsLifecycleResult> {
  const now = input.now || Date.now;
  const current = await readSnapshot(input.context, input.resources, input.request, now);
  const target = input.paused ? "PAUSED" as const : "ACTIVE" as const;
  if (current.providerStatus === target) {
    return { state: current.state, providerStatus: current.providerStatus, resources: current.resources };
  }
  if (!input.paused) await assertActivationHierarchy(input.context, current, input.request);
  const operation = buildLinkedInAdsCampaignStatusRequest({
    evidence: current.evidence,
    target,
    confirmedCampaignUrn: current.resources.campaignUrn,
    activationReady: input.paused ? undefined : true,
    nowMs: now(),
  });
  await mutate(input.request, operation, `LinkedIn n’a pas confirmé le statut ${target}.`);
  let confirmed: CampaignSnapshot;
  try {
    confirmed = await readSnapshot(input.context, current.resources, input.request, now);
  } catch (error) {
    throw confirmationFailed(error, `LinkedIn n’a pas confirmé le statut ${target}.`);
  }
  if (confirmed.providerStatus !== target) {
    throw confirmationFailed(null, `LinkedIn n’a pas confirmé le statut ${target}.`);
  }
  return { state: confirmed.state, providerStatus: confirmed.providerStatus, resources: confirmed.resources };
}

export async function archiveLinkedInAdsCampaignCore(input: {
  context: LinkedInAdsLifecycleContext;
  resources: unknown;
  request: LinkedInAdsRemoteRequest;
  now?: () => number;
}): Promise<LinkedInAdsLifecycleResult> {
  const now = input.now || Date.now;
  const current = await readSnapshot(input.context, input.resources, input.request, now);
  if (current.providerStatus === "ARCHIVED") {
    return { state: current.state, providerStatus: current.providerStatus, resources: current.resources };
  }
  const operation = buildLinkedInAdsCampaignArchiveRequest({
    evidence: current.evidence,
    confirmedCampaignUrn: current.resources.campaignUrn,
    nowMs: now(),
  });
  await mutate(input.request, operation, "LinkedIn n’a pas confirmé l’archivage de la campagne.");
  let confirmed: CampaignSnapshot;
  try {
    confirmed = await readSnapshot(input.context, current.resources, input.request, now);
  } catch (error) {
    throw confirmationFailed(error, "LinkedIn n’a pas confirmé l’archivage.");
  }
  if (confirmed.providerStatus !== "ARCHIVED") {
    throw confirmationFailed(null, "LinkedIn n’a pas confirmé l’archivage.");
  }
  return { state: confirmed.state, providerStatus: confirmed.providerStatus, resources: confirmed.resources };
}

export async function deleteLinkedInAdsCampaignCore(input: {
  context: LinkedInAdsLifecycleContext;
  resources: unknown;
  request: LinkedInAdsRemoteRequest;
  now?: () => number;
}): Promise<LinkedInAdsLifecycleResult> {
  const now = input.now || Date.now;
  const current = await readSnapshot(input.context, input.resources, input.request, now);
  if (current.providerStatus === "PENDING_DELETION" || current.providerStatus === "REMOVED") {
    return { state: current.state, providerStatus: current.providerStatus, resources: current.resources };
  }
  const operation = buildLinkedInAdsCampaignDeletionRequest({
    evidence: current.evidence,
    confirmedCampaignUrn: current.resources.campaignUrn,
    confirmation: current.providerStatus === "DRAFT" ? "DELETE_DRAFT" : "REQUEST_DELETION",
    nowMs: now(),
  });
  await mutate(input.request, operation, "LinkedIn n’a pas confirmé la suppression de la campagne.");
  let confirmed: CampaignSnapshot;
  try {
    confirmed = await readSnapshot(input.context, current.resources, input.request, now);
  } catch (error) {
    if (current.providerStatus === "DRAFT" && error instanceof LinkedInAdsLifecycleError && error.status === 404) {
      return { state: "removed", providerStatus: "REMOVED", resources: current.resources };
    }
    throw confirmationFailed(error, "LinkedIn n’a pas confirmé la suppression.");
  }
  if (confirmed.providerStatus !== "PENDING_DELETION" && confirmed.providerStatus !== "REMOVED") {
    throw confirmationFailed(null, "LinkedIn n’a pas confirmé la suppression.");
  }
  return { state: confirmed.state, providerStatus: confirmed.providerStatus, resources: confirmed.resources };
}

export async function readLinkedInAdsCampaignAnalyticsCore(input: {
  context: LinkedInAdsLifecycleContext;
  resources: unknown;
  startDate: string;
  endDate: string;
  request: LinkedInAdsRemoteRequest;
  now?: () => number;
}): Promise<{ payload: unknown; campaignUrn: string }> {
  const now = input.now || Date.now;
  const current = await readSnapshot(input.context, input.resources, input.request, now);
  const path = buildLinkedInAdsCampaignAnalyticsPath({
    evidence: current.evidence,
    startDate: input.startDate,
    endDate: input.endDate,
    nowMs: now(),
  });
  return {
    payload: await input.request({ method: "GET", path }),
    campaignUrn: current.resources.campaignUrn,
  };
}
