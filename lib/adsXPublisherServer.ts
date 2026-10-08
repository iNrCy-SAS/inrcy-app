import "server-only";
import { signXAdsOAuthRequest } from "./adsXOAuth1.ts";
import { xAdsResourcesConsentKey } from "./adsXResources.ts";
import { createXAdsReadContext, verifyXAdsNativeSelections, buildXAdsPublisherEvidence, checkXAdsCampaignPreparation, type XAdsResourcesDependencies } from "./adsXResourcesServer.ts";
import { xAdsPausedCreationEnabled, xAdsPublisherInputFromDraft, runXAdsPausedCampaign, readbackXAdsPausedCampaign, XAdsPublisherError,
  type XAdsPublisherInput, type XAdsPublisherDependencies, type XAdsPublisherCheckpoint } from "./adsXPublisherCore.ts";
import type { AdsCampaignInput } from "./adsValidation.ts";

export type XAdsCheckpoint = XAdsPublisherCheckpoint;
export type XAdsPublisherOptions = {
  campaignId: string; operationKey: string; initialProgress?: XAdsPublisherCheckpoint;
  expectedPreparationKey?: string;
  assertCampaignOwnership: () => Promise<void>;
  withOperationLock: XAdsPublisherDependencies["withOperationLock"];
  serverDependencies?: XAdsResourcesDependencies;
};
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function validateStore(options: XAdsPublisherOptions) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(options.campaignId) || typeof options.assertCampaignOwnership !== "function" || typeof options.withOperationLock !== "function") throw new XAdsPublisherError("campaign_ownership_required");
}
/** Production bridge. A client cannot supply grant evidence or private native transport. */
export async function publishXAdsCampaign(userId: string, draftValue: AdsCampaignInput, persistProgress: (progress: XAdsPublisherCheckpoint) => Promise<void>, options: XAdsPublisherOptions): Promise<XAdsPublisherCheckpoint> {
  if (!xAdsPausedCreationEnabled()) throw new XAdsPublisherError("native_creation_disabled");
  validateStore(options);
  const draft = structuredClone(draftValue);
  await options.assertCampaignOwnership();
  const preparation = await checkXAdsCampaignPreparation(userId, { accountId: draft.adAccountId, selections: draft.xNativeSelections, draft }, { ...options.serverDependencies, resumed: !!options.initialProgress });
  if (!preparation.ready) throw new XAdsPublisherError("native_preparation_unverified");
  if (options.expectedPreparationKey !== undefined && options.expectedPreparationKey !== preparation.preparationKey) throw new XAdsPublisherError("preparation_changed");
  const ctx = await createXAdsReadContext(userId, draft.adAccountId, options.serverDependencies);
  const checked = await verifyXAdsNativeSelections(ctx, draft.xNativeSelections, draft.primaryText);
  if (xAdsResourcesConsentKey(checked.resources) !== preparation.resourcesKey) throw new XAdsPublisherError("preparation_changed");
  const input = xAdsPublisherInputFromDraft(draft, checked.selections, checked.user), evidence = buildXAdsPublisherEvidence(checked, ctx.deps.now());
  let progress = options.initialProgress ? structuredClone(options.initialProgress) : null;
  const assertOwnership = async () => { await options.assertCampaignOwnership(); await ctx.assertStable(); };
  const request: XAdsPublisherDependencies["request"] = async (method, path, params) => {
    const prefix = `accounts/${input.accountId}/`;
    if (!path.startsWith(prefix) || !/^[a-z0-9_]+(?:\/[a-z0-9]+)?$/i.test(path.slice(prefix.length))) throw new XAdsPublisherError("invalid_resource_path");
    await assertOwnership();
    if (method === "GET") return ctx.read(path, params);
    if (!xAdsPausedCreationEnabled()) throw new XAdsPublisherError("native_creation_disabled");
    if (!["tweet", "campaigns", "line_items", "targeting_criteria", "promoted_tweets"].includes(path.slice(prefix.length))) throw new XAdsPublisherError("mutation_not_supported");
    // Recheck role, funding, promotable identity and source selections before EVERY POST.
    const fresh = await verifyXAdsNativeSelections(ctx, draft.xNativeSelections, draft.primaryText);
    if (Object.values(fresh.resources.capabilities).some((value) => value !== "verified")) throw new XAdsPublisherError("native_grants_changed");
    if (xAdsResourcesConsentKey(fresh.resources) !== preparation.resourcesKey) throw new XAdsPublisherError("preparation_changed");
    if (fresh.user.userId !== input.promotableUserUserId || !fresh.funding.ableToFund) throw new XAdsPublisherError("native_resources_changed");
    const url = `https://ads-api.x.com/12/${path}`;
    const { authorization } = signXAdsOAuthRequest({ method: "POST", url, ...ctx.privateCredentials, formParams: params });
    let response: Response;
    try { response = await ctx.deps.fetchImpl(url, { method: "POST", headers: { Authorization: authorization, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" }, body: params.toString(), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000) }); }
    catch { throw new XAdsPublisherError("provider_transport_error", true); }
    const payload = record(await response.json().catch(() => null));
    if (!response.ok || payload.errors || !("data" in payload)) throw new XAdsPublisherError("provider_response_invalid", true);
    await assertOwnership(); return payload;
  };
  const dependencies: XAdsPublisherDependencies = {
    now: ctx.deps.now, assertOwnership, request,
    loadCheckpoint: async () => progress,
    saveCheckpoint: async (next) => { await persistProgress(next); progress = structuredClone(next); },
    withOperationLock: options.withOperationLock,
  };
  return runXAdsPausedCampaign(input, evidence, options.operationKey, dependencies);
}
/** Read recorded native objects only. The passed input must be the journal's original snapshot. */
export async function readbackStoredXAdsCampaign(userId: string, draft: AdsCampaignInput, progress: XAdsPublisherCheckpoint, options: Pick<XAdsPublisherOptions, "campaignId" | "assertCampaignOwnership" | "serverDependencies"> & Partial<Pick<XAdsPublisherOptions, "withOperationLock">>): Promise<XAdsPublisherCheckpoint> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(options.campaignId) || typeof options.assertCampaignOwnership !== "function") throw new XAdsPublisherError("campaign_ownership_required");
  await options.assertCampaignOwnership();
  const ctx = await createXAdsReadContext(userId, draft.adAccountId, options.serverDependencies);
  const checked = await verifyXAdsNativeSelections(ctx, draft.xNativeSelections, draft.primaryText);
  const input: XAdsPublisherInput = xAdsPublisherInputFromDraft(draft, checked.selections, checked.user);
  const assertOwnership = async () => { await options.assertCampaignOwnership(); await ctx.assertStable(); };
  const deps: XAdsPublisherDependencies = { now: ctx.deps.now, assertOwnership,
    request: async (method, path, params) => { if (method !== "GET" || !path.startsWith(`accounts/${ctx.accountId}/`)) throw new XAdsPublisherError("readback_mutation_forbidden"); return ctx.read(path, params); },
    withOperationLock: options.withOperationLock || (async (_key, action) => action()), loadCheckpoint: async () => progress, saveCheckpoint: async () => { throw new XAdsPublisherError("readback_mutation_forbidden"); } };
  return readbackXAdsPausedCampaign(input, progress, deps);
}
