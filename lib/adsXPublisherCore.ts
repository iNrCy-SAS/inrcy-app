import { createHash } from "node:crypto";
import twitterText from "twitter-text";
import { preparedAdsInstant, normalizePreparedDeliverySettings } from "./adsPreparedCampaignSettings.ts";
import type { AdsCampaignInput } from "./adsValidation.ts";
import { normalizeXAdsGeoTargets, xAdsResourceId, xAdsPostId, xAdsNativePostText, xAdsPostIncludesDestination, type XAdsFundingInstrument, type XAdsPromotableUser, type XAdsPromotablePost, type XAdsGeoTarget } from "./adsXResources.ts";

/** The callable engine creates PAUSED parents only. No activation endpoint is supported. */
export function xAdsPausedCreationEnabled(environment: Record<string, string | undefined> = process.env): boolean {
  return environment.X_ADS_PAUSED_CREATION_ENABLED === "true";
}
export type XAdsPublisherInput = {
  accountId: string; name: string; lineItemName: string; postText: string;
  fundingInstrumentId: string; promotableUserId: string; promotableUserUserId: string; postId: string | null; geoTargets: XAdsGeoTarget[];
  dailyBudgetEuros: number; bidEuros: number; startAt: string; endAt: string;
};
export type XAdsPublisherEvidence = {
  accountId: string; currency: "EUR"; timeZone: string; accepted: boolean; canManageCampaigns: boolean; billingReady: boolean;
  funding: XAdsFundingInstrument; user: XAdsPromotableUser; post: XAdsPromotablePost | null; canCreatePost: boolean; geoTargets: XAdsGeoTarget[];
  standardAccess: "verified" | "unverified"; tokenRegeneratedAfterApproval: "verified" | "unverified"; nativeWriteAccess: "verified" | "unverified";
  checkedAt: string; validUntil: string;
};
export type XAdsMutationStep = "create_post" | "create_campaign" | "create_line_item" | "create_targeting" | "promote_post";
export type XAdsPublisherCheckpoint = {
  schemaVersion: 1; operationKey: string; accountId: string; inputKey: string; targetStatus: "PAUSED";
  stage: "prepared" | "post_created" | "campaign_created" | "line_item_created" | "targeting_created" | "promoted_tweet_created" | "paused_verified";
  postId?: string; campaignId?: string; lineItemId?: string; targetingCriteria?: Array<{ locationId: string; id: string }>; promotedTweetId?: string;
  pendingStep?: XAdsMutationStep; uncertainStep?: XAdsMutationStep;
};
export type XAdsPublisherDependencies = {
  now: () => number;
  assertOwnership: () => Promise<void>;
  /** Transport returns the parsed X envelope; non-2xx responses must throw without echoing secrets. */
  request: (method: "GET" | "POST", path: string, params: URLSearchParams) => Promise<unknown>;
  loadCheckpoint: () => Promise<XAdsPublisherCheckpoint | null>;
  saveCheckpoint: (checkpoint: XAdsPublisherCheckpoint) => Promise<void>;
  withOperationLock: <T>(operationKey: string, action: () => Promise<T>) => Promise<T>;
};
export class XAdsPublisherError extends Error {
  readonly code: string; readonly uncertain: boolean;
  constructor(code: string, uncertain = false) { super(`X Ads preparation failed: ${code}`); this.name = "XAdsPublisherError"; this.code = code; this.uncertain = uncertain; }
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function fail(code: string): never { throw new XAdsPublisherError(code); }
const micros = (euros: number) => Math.round(euros * 1_000_000);
const validMoney = (euros: number) => Number.isFinite(euros) && euros > 0 && Math.abs(euros * 100 - Math.round(euros * 100)) < 0.000001 && Number.isSafeInteger(micros(euros));
export const xAdsPublisherPostTextValid = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim()) && twitterText.parseTweet(value).valid;
export const xAdsPublisherInputKey = (input: XAdsPublisherInput) => createHash("sha256").update(JSON.stringify(input)).digest("hex");
export function xAdsPublisherInputFromDraft(draft: AdsCampaignInput, selections: { fundingInstrumentId: string | null; promotableUserId: string | null; postId: string | null; geoTargets: XAdsGeoTarget[] }, user: XAdsPromotableUser): XAdsPublisherInput {
  const settings = draft.channelSettings, delivery = normalizePreparedDeliverySettings(draft.preparedDeliverySettings, "x");
  if (draft.provider !== "x" || draft.accountCurrency !== "EUR" || settings?.channel !== "x" || settings.objective !== "engagement" || settings.format !== "text" || settings.targetingMode !== "broad"
    || draft.mediaStrategy !== "search_text" || draft.keywords.length || draft.negativeKeywords.length) fail("draft_not_supported");
  if (!xAdsPostIncludesDestination(draft.primaryText, draft.destinationUrl, draft.trackingParameters)) fail("post_destination_mismatch");
  // draft.languages describes the copy language in this narrow flow; no LANGUAGE targeting is sent.
  if (!selections.fundingInstrumentId || !selections.promotableUserId || delivery.error || !delivery.settings || delivery.settings.budget.type !== "daily"
    || !delivery.settings.budget.startAt || !delivery.settings.budget.endAt || delivery.settings.bidding.strategy !== "max_bid" || delivery.settings.bidding.amountEuros === null) fail("delivery_not_supported");
  if (!draft.targetLocations.length || draft.targetLocations.length !== selections.geoTargets.length
    || draft.targetLocations.some((label) => !selections.geoTargets.some((target) => target.name === label))) fail("draft_geography_mismatch");
  return { accountId: draft.adAccountId, name: draft.name, lineItemName: draft.name, postText: draft.primaryText, fundingInstrumentId: selections.fundingInstrumentId,
    promotableUserId: selections.promotableUserId, promotableUserUserId: user.userId, postId: selections.postId, geoTargets: structuredClone(selections.geoTargets),
    dailyBudgetEuros: draft.dailyBudgetEuros, bidEuros: delivery.settings.bidding.amountEuros, startAt: delivery.settings.budget.startAt, endAt: delivery.settings.budget.endAt };
}
export function validateXAdsPublisherInput(input: XAdsPublisherInput, evidence: XAdsPublisherEvidence, now: number, resumed = false, options: { requireGrantProof?: boolean } = {}): void {
  if (!xAdsResourceId(input.accountId) || input.accountId !== evidence.accountId || evidence.currency !== "EUR" || !evidence.accepted || !evidence.canManageCampaigns || !evidence.billingReady) fail("account_unverified");
  try { new Intl.DateTimeFormat("fr", { timeZone: evidence.timeZone }); } catch { fail("timezone_unverified"); }
  if (!evidence.timeZone || !Number.isFinite(now) || !preparedAdsInstant(evidence.checkedAt) || !preparedAdsInstant(evidence.validUntil)
    || Date.parse(evidence.checkedAt) > now || now - Date.parse(evidence.checkedAt) > 300_000 || Date.parse(evidence.validUntil) <= now) fail("native_evidence_expired");
  if (options.requireGrantProof !== false) for (const key of ["standardAccess", "tokenRegeneratedAfterApproval", "nativeWriteAccess"] as const) if (evidence[key] !== "verified") fail(`${key}_unverified`);
  if (!xAdsResourceId(input.fundingInstrumentId) || evidence.funding.id !== input.fundingInstrumentId || evidence.funding.currency !== "EUR" || !evidence.funding.ableToFund || evidence.funding.deleted || evidence.funding.cancelled) fail("funding_unverified");
  if (!xAdsResourceId(input.promotableUserId) || evidence.user.id !== input.promotableUserId || evidence.user.type !== "FULL" || !xAdsPostId(evidence.user.userId) || input.promotableUserUserId !== evidence.user.userId
    || (input.postId !== null && (!xAdsPostId(input.postId) || evidence.post?.id !== input.postId || evidence.post?.userId !== evidence.user.userId || evidence.post?.text !== input.postText))
    || (input.postId === null && (!evidence.canCreatePost || evidence.post !== null))) fail("post_unverified");
  if (!xAdsPublisherPostTextValid(input.postText)) fail("post_text_invalid");
  for (const name of [input.name, input.lineItemName]) if (typeof name !== "string" || name.trim().length < 3 || name.length > 100 || /[\x00-\x1f]/.test(name)) fail("name_invalid");
  const targets = normalizeXAdsGeoTargets(input.geoTargets);
  if (!targets?.length || targets.some((target) => !evidence.geoTargets.some((actual) => JSON.stringify(actual) === JSON.stringify(target)))) fail("geography_unverified");
  if (!validMoney(input.dailyBudgetEuros) || input.dailyBudgetEuros < 5 || input.dailyBudgetEuros > 500 || !validMoney(input.bidEuros) || input.bidEuros > input.dailyBudgetEuros) fail("budget_or_bid_invalid");
  if (!preparedAdsInstant(input.startAt) || !preparedAdsInstant(input.endAt) || (!resumed && Date.parse(input.startAt) < now + 60_000)
    || Date.parse(input.endAt) <= Math.max(now, Date.parse(input.startAt)) || Date.parse(input.endAt) - Date.parse(input.startAt) > 90 * 86400_000) fail("schedule_invalid");
}
export function prepareXAdsNativeBodies(input: XAdsPublisherInput) {
  return {
    campaign: { funding_instrument_id: input.fundingInstrumentId, name: input.name, budget_optimization: "LINE_ITEM", daily_budget_amount_local_micro: micros(input.dailyBudgetEuros), entity_status: "PAUSED" },
    lineItem: { name: input.lineItemName, product_type: "PROMOTED_TWEETS", objective: "ENGAGEMENTS", placements: "ALL_ON_TWITTER", bid_strategy: "MAX", bid_amount_local_micro: micros(input.bidEuros), daily_budget_amount_local_micro: micros(input.dailyBudgetEuros), start_time: new Date(input.startAt).toISOString(), end_time: new Date(input.endAt).toISOString(), standard_delivery: true, entity_status: "PAUSED" },
    locations: input.geoTargets.map((target) => ({ targeting_type: "LOCATION", targeting_value: target.id, operator_type: "EQ" })),
    post: { as_user_id: input.promotableUserUserId, text: input.postText, nullcast: true, tweet_mode: "extended", trim_user: false },
  };
}
const stages = ["prepared", "post_created", "campaign_created", "line_item_created", "targeting_created", "promoted_tweet_created", "paused_verified"];
function assertCheckpoint(progress: XAdsPublisherCheckpoint, input: XAdsPublisherInput, operationKey: string) {
  const allowed = ["schemaVersion", "operationKey", "accountId", "inputKey", "targetStatus", "stage", "postId", "campaignId", "lineItemId", "targetingCriteria", "promotedTweetId", "pendingStep", "uncertainStep"];
  if (Object.keys(progress).some((key) => !allowed.includes(key)) || progress.schemaVersion !== 1 || progress.operationKey !== operationKey || progress.accountId !== input.accountId || progress.inputKey !== xAdsPublisherInputKey(input) || progress.targetStatus !== "PAUSED") fail("checkpoint_mismatch");
  const position = stages.indexOf(progress.stage), criteria = progress.targetingCriteria || [];
  if (position < 0 || Boolean(progress.postId) !== (position >= 1) || (progress.postId && (!xAdsPostId(progress.postId) || input.postId !== null && progress.postId !== input.postId))
    || Boolean(progress.campaignId) !== (position >= 2) || Boolean(progress.lineItemId) !== (position >= 3) || Boolean(progress.promotedTweetId) !== (position >= 5)
    || [progress.campaignId, progress.lineItemId, progress.promotedTweetId].some((id) => id !== undefined && !xAdsResourceId(id))
    || !Array.isArray(criteria) || criteria.length > input.geoTargets.length || (position < 3 && criteria.length) || (position >= 4 && criteria.length !== input.geoTargets.length)
    || new Set(criteria.map((item) => item.id)).size !== criteria.length || new Set(criteria.map((item) => item.locationId)).size !== criteria.length
    || criteria.some((item) => Object.keys(item).some((key) => !["locationId", "id"].includes(key)) || !xAdsResourceId(item.id) || !input.geoTargets.some((target) => target.id === item.locationId))) fail("checkpoint_invalid");
  if ([progress.pendingStep, progress.uncertainStep].some((step) => step !== undefined && !["create_post", "create_campaign", "create_line_item", "create_targeting", "promote_post"].includes(step))) fail("checkpoint_invalid");
  if (progress.pendingStep || progress.uncertainStep) throw new XAdsPublisherError("mutation_outcome_unknown", true);
}
const params = (body: Record<string, unknown>) => new URLSearchParams(Object.entries(body).map(([key, value]) => [key, String(value)]));
async function envelope(deps: XAdsPublisherDependencies, method: "GET" | "POST", path: string, body: Record<string, unknown>, evidence?: XAdsPublisherEvidence) {
  await deps.assertOwnership();
  if (evidence && Date.parse(evidence.validUntil) <= deps.now()) fail("native_evidence_expired");
  const payload = record(await deps.request(method, path, params(body)));
  if (payload.errors || !("data" in payload)) throw new XAdsPublisherError("provider_response_invalid", method === "POST");
  await deps.assertOwnership(); return payload.data;
}
async function readBack(input: XAdsPublisherInput, progress: XAdsPublisherCheckpoint, deps: XAdsPublisherDependencies, evidence?: XAdsPublisherEvidence) {
  const prefix = `accounts/${input.accountId}`;
  if (progress.postId) {
    const data = await envelope(deps, "GET", `${prefix}/tweets`, { tweet_type: "PUBLISHED", timeline_type: "ALL", tweet_ids: progress.postId, user_id: input.promotableUserUserId, trim_user: false }, evidence);
    const row = Array.isArray(data) && data.length === 1 ? record(data[0]) : {}, user = record(row.user);
    const entities = record(row.entities), extended = record(row.extended_entities);
    if (row.id_str !== progress.postId || user.id_str !== input.promotableUserUserId || xAdsNativePostText(row) !== input.postText
      || row.tweet_type !== "PUBLISHED" || row.truncated !== false || row.deleted === true || input.postId === null && row.nullcast !== true
      || Array.isArray(entities.media) && entities.media.length || Array.isArray(extended.media) && extended.media.length || row.card || row.card_uri
      || row.retweeted_status || row.quoted_status || row.is_quote_status || row.in_reply_to_status_id_str) fail("post_readback_mismatch");
  }
  if (progress.campaignId) {
    const row = record(await envelope(deps, "GET", `${prefix}/campaigns/${progress.campaignId}`, {}, evidence));
    if (row.id !== progress.campaignId || row.deleted !== false || row.entity_status !== "PAUSED" || row.currency !== "EUR" || row.funding_instrument_id !== input.fundingInstrumentId || Number(row.daily_budget_amount_local_micro) !== micros(input.dailyBudgetEuros)) fail("campaign_readback_mismatch");
  }
  if (progress.lineItemId) {
    const row = record(await envelope(deps, "GET", `${prefix}/line_items/${progress.lineItemId}`, {}, evidence));
    if (row.id !== progress.lineItemId || row.deleted !== false || row.entity_status !== "PAUSED" || row.campaign_id !== progress.campaignId || row.objective !== "ENGAGEMENTS" || row.product_type !== "PROMOTED_TWEETS"
      || !Array.isArray(row.placements) || row.placements.length !== 1 || row.placements[0] !== "ALL_ON_TWITTER" || row.bid_strategy !== "MAX" || Number(row.bid_amount_local_micro) !== micros(input.bidEuros)
      || Number(row.daily_budget_amount_local_micro) !== micros(input.dailyBudgetEuros) || Date.parse(String(row.start_time)) !== Date.parse(input.startAt) || Date.parse(String(row.end_time)) !== Date.parse(input.endAt)) fail("line_item_readback_mismatch");
  }
  for (const criterion of progress.targetingCriteria || []) {
    const row = record(await envelope(deps, "GET", `${prefix}/targeting_criteria/${criterion.id}`, {}, evidence));
    if (row.id !== criterion.id || row.deleted !== false || row.line_item_id !== progress.lineItemId || row.targeting_type !== "LOCATION" || row.targeting_value !== criterion.locationId || (row.operator_type != null && row.operator_type !== "EQ")) fail("targeting_readback_mismatch");
  }
  if (progress.promotedTweetId) {
    const row = record(await envelope(deps, "GET", `${prefix}/promoted_tweets/${progress.promotedTweetId}`, {}, evidence));
    // X does not expose a PAUSED write for this association. Its PAUSED parents prevent delivery.
    if (row.id !== progress.promotedTweetId || row.deleted !== false || row.line_item_id !== progress.lineItemId || row.tweet_id !== progress.postId || row.entity_status !== "ACTIVE") fail("promoted_post_readback_mismatch");
  }
}
export async function readbackXAdsPausedCampaign(input: XAdsPublisherInput, progress: XAdsPublisherCheckpoint, deps: XAdsPublisherDependencies) {
  // An uncertain journal may still have known objects worth inspecting; never replay or clear it.
  assertCheckpoint({ ...progress, pendingStep: undefined, uncertainStep: undefined }, input, progress.operationKey);
  return deps.withOperationLock(progress.operationKey, async () => { await readBack(input, progress, deps); return structuredClone(progress); });
}
export async function runXAdsPausedCampaign(inputValue: XAdsPublisherInput, evidenceValue: XAdsPublisherEvidence, operationKey: string, deps: XAdsPublisherDependencies): Promise<XAdsPublisherCheckpoint> {
  const input = structuredClone(inputValue), evidence = structuredClone(evidenceValue);
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(operationKey)) fail("operation_invalid");
  return deps.withOperationLock(operationKey, async () => {
    await deps.assertOwnership(); let progress = await deps.loadCheckpoint();
    if (progress) assertCheckpoint(progress, input, operationKey);
    validateXAdsPublisherInput(input, evidence, deps.now(), Boolean(progress));
    if (!progress) { progress = { schemaVersion: 1, operationKey, accountId: input.accountId, inputKey: xAdsPublisherInputKey(input), targetStatus: "PAUSED", stage: "prepared" }; await deps.saveCheckpoint(structuredClone(progress)); }
    const checkpoint = async (patch: Partial<XAdsPublisherCheckpoint>) => { await deps.assertOwnership(); const next = { ...progress!, ...patch }; await deps.saveCheckpoint(structuredClone(next)); progress = next; };
    const mutation = async (step: XAdsMutationStep, path: string, body: Record<string, unknown>, accept: (data: unknown) => Partial<XAdsPublisherCheckpoint>) => {
      await checkpoint({ pendingStep: step });
      try { const data = await envelope(deps, "POST", path, body, evidence); const patch = accept(data); await checkpoint({ ...patch, pendingStep: undefined, uncertainStep: undefined }); }
      catch { await checkpoint({ pendingStep: step, uncertainStep: step }).catch(() => undefined); throw new XAdsPublisherError("mutation_outcome_unknown", true); }
    };
    const prefix = `accounts/${input.accountId}`, bodies = prepareXAdsNativeBodies(input);
    await readBack(input, progress, deps, evidence);
    if (!progress.postId) {
      if (input.postId !== null) await checkpoint({ postId: input.postId, stage: "post_created" });
      else await mutation("create_post", `${prefix}/tweet`, bodies.post, (data) => {
        const row = record(data), user = record(row.user);
        if (!xAdsPostId(row.id_str) || user.id_str !== input.promotableUserUserId || xAdsNativePostText(row) !== input.postText || row.nullcast !== true) fail("post_response_invalid");
        return { postId: row.id_str, stage: "post_created" };
      });
    }
    await readBack(input, progress, deps, evidence);
    if (!progress.campaignId) await mutation("create_campaign", `${prefix}/campaigns`, bodies.campaign, (data) => {
      const id = record(data).id; if (!xAdsResourceId(id)) fail("campaign_id_invalid"); return { campaignId: id, stage: "campaign_created" };
    });
    await readBack(input, progress, deps, evidence);
    if (!progress.lineItemId) await mutation("create_line_item", `${prefix}/line_items`, { ...bodies.lineItem, campaign_id: progress.campaignId }, (data) => {
      const id = record(data).id; if (!xAdsResourceId(id)) fail("line_item_id_invalid"); return { lineItemId: id, stage: "line_item_created" };
    });
    await readBack(input, progress, deps, evidence);
    for (const target of bodies.locations) {
      if (progress.targetingCriteria?.some((item) => item.locationId === target.targeting_value)) continue;
      await mutation("create_targeting", `${prefix}/targeting_criteria`, { ...target, line_item_id: progress.lineItemId }, (data) => {
        const row = record(data); if (!xAdsResourceId(row.id) || row.line_item_id !== progress!.lineItemId || row.targeting_type !== "LOCATION" || row.targeting_value !== target.targeting_value) fail("targeting_response_invalid");
        return { targetingCriteria: [...progress!.targetingCriteria || [], { id: row.id, locationId: target.targeting_value }] };
      });
    }
    if (progress.stage === "line_item_created") await checkpoint({ stage: "targeting_created" });
    await readBack(input, progress, deps, evidence);
    if (!progress.promotedTweetId) await mutation("promote_post", `${prefix}/promoted_tweets`, { tweet_ids: progress.postId, line_item_id: progress.lineItemId }, (data) => {
      const row = Array.isArray(data) && data.length === 1 ? record(data[0]) : {};
      if (!xAdsResourceId(row.id) || row.line_item_id !== progress!.lineItemId || row.tweet_id !== progress!.postId) fail("promoted_post_response_invalid");
      return { promotedTweetId: row.id, stage: "promoted_tweet_created" };
    });
    await readBack(input, progress, deps, evidence);
    await checkpoint({ stage: "paused_verified" }); return structuredClone(progress);
  });
}
