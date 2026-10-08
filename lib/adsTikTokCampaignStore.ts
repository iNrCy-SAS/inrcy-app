import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { supabaseAdmin } from "./supabaseAdmin.ts";
import type { AdsCampaignInput } from "./adsValidation.ts";

export type PreparedAdsProvider = "tiktok" | "x";
export type PreparedAdsCampaignRow = {
  id: string; user_id: string; provider: string; ad_account_id: string;
  currency: string; daily_budget_cents: number; status: string;
  draft: unknown; provider_resources: unknown; published_at: string | null; updated_at: string;
};
export type PreparedAdsCheckpoint = Record<string, unknown>;
export type PreparedAdsStoreDependencies = {
  readCampaign: (owner: string, id: string) => Promise<PreparedAdsCampaignRow | null>;
  compareAndSet: (expected: PreparedAdsCampaignRow, patch: Record<string, unknown>) => Promise<PreparedAdsCampaignRow | null>;
  readAvailability: () => Promise<boolean>;
  now: () => number; token: () => string;
};
/** A missing RPC is the historical schema, not permission to attempt a write. */
export async function readPreparedAdsStoreAvailability(): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin.rpc("inrcy_ads_prepared_paused_store_ready", {}, { get: true });
    return !error && data === true;
  } catch { return false; }
}
export class PreparedAdsStoreError extends Error {
  code: string; status: number;
  constructor(code: string, status = 409) { super("Le stockage de reprise de cette campagne doit être revérifié."); this.name = "PreparedAdsStoreError"; this.code = code; this.status = status; }
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(code: string, status = 409): never { throw new PreparedAdsStoreError(code, status); }
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => [key, canonical(entry)]));
  return value;
}
export function preparedAdsCampaignDraftKey(draft: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(draft))).digest("hex");
}
export function preparedAdsOperationKey(provider: PreparedAdsProvider, campaignId: string): string {
  if (!uuid.test(campaignId)) fail("campaign_identity_invalid");
  return `inrcy_${provider}_${campaignId.replace(/-/g, "")}`;
}
/** Draft IDs remain in JSON while the existing draft-only database constraint is installed. */
export function preparedAdsStoredAccountMatches(row: { provider: string; ad_account_id: string; status: string }, draftAccountId: string): boolean {
  return row.ad_account_id === draftAccountId || ((row.provider === "tiktok" || row.provider === "x") && row.status === "draft" && row.ad_account_id === "");
}
const stages = {
  tiktok: ["prepared", "media_available", "campaign_created", "adgroup_created", "ad_created", "paused_verified"],
  x: ["prepared", "post_created", "campaign_created", "line_item_created", "targeting_created", "promoted_tweet_created", "paused_verified"],
} as const;
function checkpoint(value: unknown, provider: PreparedAdsProvider, accountId: string, operationKey: string): PreparedAdsCheckpoint | null {
  if (value == null) return null;
  const row = object(value), nativeKeys = provider === "tiktok"
    ? ["advertiserId", "videoId", "imageId", "adGroupId", "adId", "videoSignature", "imageSignature"]
    : ["accountId", "postId", "lineItemId", "targetingCriteria", "promotedTweetId"];
  const keys = ["schemaVersion", "operationKey", "inputKey", "targetStatus", "stage", "campaignId", "pendingStep", "uncertainStep", ...nativeKeys];
  if (!Object.keys(row).length || Object.keys(row).some((key) => !keys.includes(key)) || row.schemaVersion !== 1
    || row.operationKey !== operationKey || row[provider === "tiktok" ? "advertiserId" : "accountId"] !== accountId
    || row.targetStatus !== (provider === "tiktok" ? "DISABLE" : "PAUSED") || !/^[0-9a-f]{64}$/.test(String(row.inputKey || ""))
    || !(stages[provider] as readonly string[]).includes(String(row.stage))) fail("checkpoint_mismatch");
  for (const [key, value] of Object.entries(row)) {
    if (key === "targetingCriteria") {
      if (!Array.isArray(value) || value.length > 40 || value.some((entry) => {
        const item = object(entry); return Object.keys(item).length !== 2 || !["id", "locationId"].every((field) => typeof item[field] === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(item[field]));
      })) fail("checkpoint_invalid");
    } else if (key !== "schemaVersion" && value !== undefined && (typeof value !== "string" || value.length > 256 || /[\s?&#=]|https?:\/\//.test(value))) fail("checkpoint_invalid");
  }
  return structuredClone(row);
}
function publicCheckpoint(provider: PreparedAdsProvider, accountId: string, value: PreparedAdsCheckpoint | null): Record<string, unknown> {
  if (!value) return {};
  const keys = provider === "tiktok" ? ["campaignId", "adGroupId", "adId"] : ["postId", "campaignId", "lineItemId", "promotedTweetId"];
  return { adAccountId: accountId, preparationStage: value.stage, ...Object.fromEntries(keys.filter((key) => value[key]).map((key) => [key, value[key]])),
    ...(value.pendingStep || value.uncertainStep ? { initialCreationNeedsReview: true } : {}) };
}
function defaults(): PreparedAdsStoreDependencies {
  const columns = "id,user_id,provider,ad_account_id,currency,daily_budget_cents,status,draft,provider_resources,published_at,updated_at";
  return {
    now: Date.now, token: randomUUID, readAvailability: readPreparedAdsStoreAvailability,
    readCampaign: async (owner, id) => {
      const { data, error } = await supabaseAdmin.from("ads_campaigns").select(columns).eq("id", id).eq("user_id", owner).maybeSingle();
      if (error) fail("campaign_store_unavailable", 503);
      return data as PreparedAdsCampaignRow | null;
    },
    compareAndSet: async (expected, patch) => {
      const { data, error } = await supabaseAdmin.from("ads_campaigns").update(patch).eq("id", expected.id).eq("user_id", expected.user_id)
        .eq("provider", expected.provider).eq("status", expected.status).eq("updated_at", expected.updated_at).select(columns).maybeSingle();
      if (error) fail("campaign_store_unavailable", 503);
      return data as PreparedAdsCampaignRow | null;
    },
  };
}

/** Durable owner-scoped CAS claim. A process-local mutex or auto-expiring lease is insufficient:
 * an interrupted POST remains protected by its checkpoint and cannot be replayed implicitly.
 */
export function createPreparedAdsCampaignStore(input: { owner: string; campaignId: string; provider: PreparedAdsProvider; accountId: string; draftSnapshot: unknown }, dependencies?: PreparedAdsStoreDependencies) {
  const deps = dependencies || defaults(), operationKey = preparedAdsOperationKey(input.provider, input.campaignId), draftKey = preparedAdsCampaignDraftKey(input.draftSnapshot);
  if (!input.owner || (input.provider === "tiktok" ? !/^\d{5,30}$/.test(input.accountId) : !/^[A-Za-z0-9]{1,128}$/.test(input.accountId))) fail("campaign_identity_invalid");
  let lockToken: string | null = null, latest: PreparedAdsCheckpoint | null = null, availability: Promise<boolean> | null = null;
  const expectedBudgetCents = Math.round(Number(object(input.draftSnapshot).dailyBudgetEuros) * 100);
  async function isAvailable() {
    // Request/store-local only: a later request must consult the installed schema again.
    availability ||= Promise.resolve().then(() => deps.readAvailability()).then((value) => value === true).catch(() => false);
    return availability;
  }
  async function readOwned() {
    const row = await deps.readCampaign(input.owner, input.campaignId);
    if (!row || row.id !== input.campaignId || row.user_id !== input.owner || row.provider !== input.provider || row.currency !== "EUR"
      || row.daily_budget_cents !== expectedBudgetCents || !preparedAdsStoredAccountMatches(row, input.accountId) || preparedAdsCampaignDraftKey(row.draft) !== draftKey) fail("campaign_snapshot_changed");
    if (!row.provider_resources || typeof row.provider_resources !== "object" || Array.isArray(row.provider_resources)) fail("campaign_resources_invalid");
    const lock = object(object(row.provider_resources).preparedCampaignLock);
    if (lockToken && (row.status !== "publishing" || lock.token !== lockToken || lock.operationKey !== operationKey || lock.draftKey !== draftKey)) fail("campaign_lock_lost");
    return row;
  }
  function revision(row: PreparedAdsCampaignRow) {
    const current = Date.parse(row.updated_at);
    if (!Number.isFinite(current)) fail("campaign_revision_invalid");
    return new Date(Math.max(deps.now(), current + 1)).toISOString();
  }
  async function cas(row: PreparedAdsCampaignRow, patch: Record<string, unknown>) {
    const saved = await deps.compareAndSet(row, { ...patch, updated_at: revision(row) });
    if (!saved) fail("campaign_revision_changed");
    return saved;
  }
  async function loadCheckpoint() {
    const row = await readOwned(), resources = object(row.provider_resources);
    const envelope = object(resources.preparedCampaignCheckpoint);
    if (resources.preparedCampaignCheckpoint != null && (envelope.provider !== input.provider || envelope.draftKey !== draftKey)) fail("checkpoint_mismatch");
    return checkpoint(envelope.value, input.provider, input.accountId, operationKey);
  }
  async function saveCheckpoint(value: PreparedAdsCheckpoint) {
    if (!lockToken) fail("campaign_lock_required");
    const next = checkpoint(value, input.provider, input.accountId, operationKey)!;
    if (latest && latest.inputKey !== next.inputKey) fail("checkpoint_mismatch");
    const nativeIds = input.provider === "tiktok" ? ["videoId", "imageId", "videoSignature", "imageSignature", "campaignId", "adGroupId", "adId"] : ["postId", "campaignId", "lineItemId", "targetingCriteria", "promotedTweetId"];
    for (const key of nativeIds) {
      if (key === "targetingCriteria" && Array.isArray(latest?.[key]) && Array.isArray(next[key])) {
        const previous = latest[key] as unknown[], appended = next[key] as unknown[];
        if (appended.length < previous.length || previous.some((entry, index) => JSON.stringify(canonical(entry)) !== JSON.stringify(canonical(appended[index])))) fail("checkpoint_native_identity_changed");
        if (new Set(appended.map((entry) => String(object(entry).locationId))).size !== appended.length || new Set(appended.map((entry) => String(object(entry).id))).size !== appended.length) fail("checkpoint_native_identity_changed");
        continue;
      }
      if (latest?.[key] && next[key] && JSON.stringify(canonical(latest[key])) !== JSON.stringify(canonical(next[key]))) fail("checkpoint_native_identity_changed");
      if (latest?.[key] && !next[key]) next[key] = structuredClone(latest[key]);
    }
    if (latest) {
      const previousStage = (stages[input.provider] as readonly string[]).indexOf(String(latest.stage)), nextStage = (stages[input.provider] as readonly string[]).indexOf(String(next.stage));
      if (nextStage < previousStage) { if (!next.pendingStep && !next.uncertainStep) fail("checkpoint_stage_regression"); next.stage = latest.stage; }
      if (latest.uncertainStep && !next.uncertainStep) fail("checkpoint_uncertainty_requires_review");
    }
    // Retain a returned provider ID in memory even if its durable write has an unknown outcome.
    latest = next;
    const row = await readOwned(), resources = object(row.provider_resources);
    await cas(row, { provider_resources: { ...resources, ...publicCheckpoint(input.provider, input.accountId, latest),
      preparedCampaignCheckpoint: { provider: input.provider, draftKey, value: latest } } });
  }
  async function withOperationLock<T>(requestedKey: string, action: () => Promise<T>): Promise<T> {
    if (lockToken || requestedKey !== operationKey) fail("campaign_lock_invalid");
    if (!(await isAvailable())) fail("campaign_store_migration_required", 423);
    const row = await readOwned(), resources = object(row.provider_resources);
    if (row.status !== "draft" && row.status !== "needs_review" && row.status !== "paused") fail("campaign_operation_in_progress");
    if (resources.preparedCampaignLock != null) fail("campaign_operation_in_progress");
    if (row.status === "draft" && (row.published_at !== null || Object.keys(resources).length)) fail("draft_not_empty");
    latest = await loadCheckpoint();
    if (row.status !== "draft" && !latest) fail("checkpoint_required");
    if (latest?.pendingStep || latest?.uncertainStep) fail("checkpoint_uncertainty_requires_review");
    const token = deps.token(); if (!uuid.test(token)) fail("campaign_lock_invalid");
    await cas(row, { status: "publishing", ad_account_id: input.accountId, provider_resources: { ...resources,
      preparedCampaignLock: { token, operationKey, draftKey, claimedAt: new Date(deps.now()).toISOString() } } });
    lockToken = token;
    try {
      const result = await action();
      if (latest?.stage !== "paused_verified" || latest.pendingStep || latest.uncertainStep) fail("paused_state_not_verified");
      const current = await readOwned(), completed = { ...object(current.provider_resources), ...publicCheckpoint(input.provider, input.accountId, latest) };
      delete completed.preparedCampaignLock;
      await cas(current, { status: "paused", provider_resources: completed, published_at: current.published_at || new Date(deps.now()).toISOString(), last_error: null });
      return result;
    } catch (error) {
      // Never clear provider IDs, pending/uncertain steps or return a claimed operation to draft.
      try {
        const current = await readOwned(), recovered = { ...object(current.provider_resources), ...publicCheckpoint(input.provider, input.accountId, latest) };
        delete recovered.preparedCampaignLock;
        if (latest) recovered.preparedCampaignCheckpoint = { provider: input.provider, draftKey, value: latest };
        await cas(current, { status: "needs_review", provider_resources: recovered, last_error: "La création en pause doit être contrôlée avant toute reprise." });
      } catch { /* Keep the durable publishing claim if recovery itself could not be confirmed. */ }
      throw error;
    } finally { lockToken = null; }
  }
  return { campaignId: input.campaignId, operationKey, isAvailable, assertCampaignOwnership: async () => { await readOwned(); }, loadCheckpoint, saveCheckpoint, withOperationLock };
}

export function preparedAdsStoreUnavailablePreparation(provider: PreparedAdsProvider, accountId: string): Record<string, unknown> {
  return { ready: false, publicationEnabled: false, campaignStoreReady: false, targetStatus: provider === "tiktok" ? "DISABLE" : "PAUSED", selectedAccountId: accountId, verifiedLocationCount: 0,
    resourcesKey: "", preparationKey: "", blockers: ["campaign_store_migration_required"] };
}

/** Project only stable public evidence. Future private provider fields must not reach the browser. */
export function publicPreparedAdsPreparation(value: unknown): Record<string, unknown> {
  const source = object(value), keys = ["ready", "campaignStoreReady", "targetStatus", "pausedCreationEnabled", "pausedCreationReady", "nativeProofReady", "preparationReady", "selectedAccountId", "selectedIdentity", "verifiedLocations", "verifiedLocationCount", "resourcesKey", "selectionKey", "preparationKey", "effectiveDelivery", "blockers"];
  return { ...Object.fromEntries(keys.filter((key) => Object.hasOwn(source, key)).map((key) => [key, source[key]])), publicationEnabled: false };
}

export function preparedAdsPreparationForCheckpoint(value: unknown, progress: PreparedAdsCheckpoint | null): Record<string, unknown> {
  const preparation = publicPreparedAdsPreparation(value);
  if (!progress?.pendingStep && !progress?.uncertainStep) return preparation;
  const blockers = Array.isArray(preparation.blockers) ? preparation.blockers.filter((entry): entry is string => typeof entry === "string") : [];
  return { ...preparation, ready: false, blockers: [...new Set([...blockers, "creation_result_uncertain"])] };
}

/** Readback may internally return a whole checkpoint; hashes/claims stay private. */
export function publicPreparedAdsReadback(value: unknown): Record<string, unknown> {
  const source = object(value), keys = ["targetStatus", "reason", "campaignId", "adGroupId", "adId", "postId", "lineItemId", "promotedTweetId", "statuses"];
  const confirmed = typeof source.confirmed === "boolean" ? source.confirmed : source.stage === "paused_verified" && !source.pendingStep && !source.uncertainStep;
  return { ...Object.fromEntries(keys.filter((key) => Object.hasOwn(source, key)).map((key) => [key, source[key]])), confirmed, publicationEnabled: false };
}

export function preparedAdsCampaignConsentKey(provider: PreparedAdsProvider, row: Pick<PreparedAdsCampaignRow, "id" | "user_id" | "draft">, preparation: unknown): string {
  return preparedAdsCampaignDraftKey({ provider, campaignId: row.id, owner: row.user_id, mode: "paused", draftFingerprint: preparedAdsCampaignDraftKey(row.draft), preparation: publicPreparedAdsPreparation(preparation) });
}
export type PreparedAdsPausedApproval = { nativeConsentKey: string; expectedDraftFingerprint: string };

export type PreparedAdsPublicationDependencies = {
  store?: PreparedAdsStoreDependencies;
  check?: (owner: string, draft: AdsCampaignInput) => Promise<unknown>;
  publish?: (owner: string, draft: AdsCampaignInput, persist: (value: PreparedAdsCheckpoint) => Promise<void>, options: {
    campaignId: string; operationKey: string; initialProgress?: PreparedAdsCheckpoint; expectedPreparationKey?: string;
    assertCampaignOwnership: () => Promise<void>; withOperationLock: <T>(key: string, action: () => Promise<T>) => Promise<T>;
  }) => Promise<unknown>;
};
/** Dependencies are server-only injection points for tests. Routes never deserialize them. */
export async function publishStoredPreparedAdsCampaign(owner: string, row: PreparedAdsCampaignRow, draft: AdsCampaignInput, approval: PreparedAdsPausedApproval, dependencies: PreparedAdsPublicationDependencies = {}) {
  const provider = draft.provider;
  if ((provider !== "tiktok" && provider !== "x") || row.user_id !== owner || row.provider !== provider || row.currency !== "EUR"
    || draft.accountCurrency !== "EUR" || !preparedAdsStoredAccountMatches(row, draft.adAccountId) || Math.round(draft.dailyBudgetEuros * 100) !== row.daily_budget_cents) fail("campaign_snapshot_changed");
  if (!/^[0-9a-f]{64}$/.test(approval.nativeConsentKey) || approval.expectedDraftFingerprint !== preparedAdsCampaignDraftKey(row.draft)) fail("draft_consent_changed");
  const storeDeps = dependencies.store || defaults();
  const store = createPreparedAdsCampaignStore({ owner, campaignId: row.id, provider, accountId: draft.adAccountId, draftSnapshot: row.draft }, storeDeps);
  await store.assertCampaignOwnership();
  if (!(await store.isAvailable())) return { preparation: preparedAdsStoreUnavailablePreparation(provider, draft.adAccountId), campaign: null };
  const progress = await store.loadCheckpoint();
  const rawPreparation = dependencies.check ? await dependencies.check(owner, draft) : provider === "tiktok"
    ? await (await import("./adsTikTokCampaignPreparationServer.ts")).checkTikTokAdsCampaignPreparation(owner, draft, { resumed: Boolean(progress) })
    : await (await import("./adsXResourcesServer.ts")).checkXAdsCampaignPreparation(owner, { accountId: draft.adAccountId, selections: draft.xNativeSelections, draft }, { resumed: Boolean(progress) });
  const preparation = preparedAdsPreparationForCheckpoint(rawPreparation, progress);
  if (approval.nativeConsentKey !== preparedAdsCampaignConsentKey(provider, row, preparation)) fail("native_consent_changed");
  if (preparation.ready !== true || preparation.targetStatus !== (provider === "tiktok" ? "DISABLE" : "PAUSED")) return { preparation, campaign: null };
  if (preparation.selectedAccountId !== draft.adAccountId || typeof preparation.preparationKey !== "string" || !/^[0-9a-f]{64}$/.test(preparation.preparationKey)) fail("native_preparation_invalid");
  // A fresh proof is checked again inside each bridge before the durable claim/provider mutation.
  const options = { campaignId: row.id, operationKey: store.operationKey, expectedPreparationKey: preparation.preparationKey,
    assertCampaignOwnership: store.assertCampaignOwnership, withOperationLock: store.withOperationLock };
  const persist = async (next: PreparedAdsCheckpoint) => { await store.saveCheckpoint(next); };
  if (dependencies.publish) await dependencies.publish(owner, draft, persist, { ...options, ...(progress ? { initialProgress: progress } : {}) });
  else if (provider === "tiktok") await (await import("./adsTikTokPublisherServer.ts")).publishTikTokAdsCampaign(owner, draft, async (next) => persist({ ...next }), {
    ...options, ...(progress ? { initialProgress: progress as unknown as import("./adsTikTokPublisherCore.ts").TikTokTrafficCheckpoint } : {}) });
  else await (await import("./adsXPublisherServer.ts")).publishXAdsCampaign(owner, draft, async (next) => persist({ ...next }), {
    ...options, ...(progress ? { initialProgress: progress as unknown as import("./adsXPublisherCore.ts").XAdsPublisherCheckpoint } : {}) });
  const campaign = await storeDeps.readCampaign(owner, row.id);
  if (!campaign || campaign.user_id !== owner || campaign.provider !== provider || campaign.status !== "paused") fail("paused_state_not_verified");
  return { preparation, campaign };
}
