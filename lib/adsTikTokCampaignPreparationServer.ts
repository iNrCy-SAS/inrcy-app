import "server-only";
import { createHash } from "node:crypto";
import { normalizeTikTokAdsNativeSelections, tikTokAdsNativeSelectionsComplete, tikTokAdsNativeSelectionsKey } from "./adsTikTokNativeSelections.ts";
import { tikTokAdsPausedCreationEnabled } from "./adsTikTokPublicationPolicy.ts";
import { tikTokTrafficInputFromAdsDraft, type TikTokTrafficCampaignDraft } from "./adsTikTokCampaignInput.ts";
import { readTikTokTrafficCampaignContext, type TikTokAdsResourceDependencies } from "./adsTikTokResourcesServer.ts";
import { tikTokAdsResourcesConsentKey, TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT, type TikTokAdsGeoTarget, type TikTokAdsIdentity } from "./adsTikTokResources.ts";
import { TikTokTrafficPublisherError, tikTokTrafficInputKey, validateTikTokTrafficVideoFields, validateTikTokTrafficVideoInput, type TikTokTrafficNativeEvidence, type TikTokTrafficVideoInput } from "./adsTikTokPublisherCore.ts";
import { readTikTokConfiguredCapabilityEvidence, TIKTOK_NATIVE_EVIDENCE_MAX_AGE_MS } from "./adsTikTokCapabilityEvidenceServer.ts";
import { checkTikTokOwnedSourceMedia, type TikTokOwnedSourceReader } from "./adsTikTokSourceMediaServer.ts";
import { readPreparedAdsStoreAvailability } from "./adsTikTokCampaignStore.ts";

export type TikTokTrafficCapabilityScope = { appId: string; advertiserId: string; integrationFingerprint: string; context: typeof TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT };
/** Only a server-owned verifier/store can supply this. It is never parsed from a request or draft.
 * A provider account/identity GET cannot itself establish any of these mutation capabilities.
 */
export type TikTokTrafficCapabilityEvidence = Pick<TikTokTrafficNativeEvidence, "manualTrafficV13" | "nativeWriteAccess" | "videoUpload" | "imageUpload" | "mediaRead" | "objectRead" | "minimumLifetimeBudgetEuros" | "budgetCalendar" | "scheduleTimeBasis" | "scheduleOffsetMinutes" | "allowedNonSparkIdentityTypes" | "callToActions" | "verifiedAt" | "validUntil"> & {
  scope: TikTokTrafficCapabilityScope;
  /** Original authority dates are not renewed when a fresh native binding snapshot is issued. */
  authority?: { verifiedAt: string; validUntil: string; source: { kind: string; reference: string } };
};
export type TikTokCampaignPreparationDependencies = {
  resources?: TikTokAdsResourceDependencies;
  environment?: Record<string, string | undefined>;
  /** Server-only, derived from an owned durable checkpoint. A body must never control this. */
  resumed?: boolean;
  /** Optional privileged verifier; production defaults to an explicit scoped server attestation. */
  readCapabilityEvidence?: (scope: TikTokTrafficCapabilityScope) => Promise<TikTokTrafficCapabilityEvidence | null>;
  readOwnedSourceMedia?: TikTokOwnedSourceReader;
  /** The migration is a server prerequisite; a request body cannot claim store availability. */
  readStoreAvailability?: () => Promise<boolean>;
};
export type TikTokAdsCampaignPreparation = {
  ready: boolean; publicationEnabled: false; targetStatus: "DISABLE";
  pausedCreationEnabled: boolean; nativeProofReady: boolean; preparationReady: boolean;
  selectedAccountId: string; selectedIdentity: TikTokAdsIdentity | null;
  verifiedLocations: TikTokAdsGeoTarget[]; verifiedLocationCount: number;
  resourcesKey: string; selectionKey: string; preparationKey: string; consentKey: string;
  effectiveDelivery: { budgetMode: "total"; totalEuros: number | null; startAt: string | null; endAt: string | null; currency: "EUR"; targetStatus: "DISABLE" };
  blockers: string[]; verifiedAt: string;
};
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function identityKey(identity: Pick<TikTokAdsIdentity, "id" | "type" | "authorizedBusinessCenterId">) { return JSON.stringify([identity.id, identity.type, identity.authorizedBusinessCenterId || ""]); }
function capabilityKey(evidence: TikTokTrafficCapabilityEvidence | null): string {
  if (!evidence) return digest(null);
  return digest({ scope: { appId: evidence.scope.appId, advertiserId: evidence.scope.advertiserId, integrationFingerprint: evidence.scope.integrationFingerprint, context: TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT }, manualTrafficV13: evidence.manualTrafficV13, nativeWriteAccess: evidence.nativeWriteAccess,
    videoUpload: evidence.videoUpload, imageUpload: evidence.imageUpload, mediaRead: evidence.mediaRead, objectRead: evidence.objectRead,
    minimumLifetimeBudgetEuros: evidence.minimumLifetimeBudgetEuros, budgetCalendar: evidence.budgetCalendar,
    scheduleTimeBasis: evidence.scheduleTimeBasis, scheduleOffsetMinutes: evidence.scheduleOffsetMinutes,
    allowedNonSparkIdentityTypes: [...evidence.allowedNonSparkIdentityTypes].sort(), callToActions: [...evidence.callToActions].sort(), authority: evidence.authority || null });
}
function validCapabilityRecord(value: TikTokTrafficCapabilityEvidence | null, scope: TikTokTrafficCapabilityScope, now: number): value is TikTokTrafficCapabilityEvidence {
  if (!value || value.scope?.appId !== scope.appId || value.scope.advertiserId !== scope.advertiserId
    || value.scope.integrationFingerprint !== scope.integrationFingerprint || JSON.stringify(value.scope.context) !== JSON.stringify(scope.context)
    || !Array.isArray(value.callToActions) || !Array.isArray(value.allowedNonSparkIdentityTypes)) return false;
  const created = Date.parse(value.verifiedAt), expires = Date.parse(value.validUntil);
  // A long-lived OAuth token does not make a mutation permission snapshot permanently valid.
  return Number.isFinite(created) && Number.isFinite(expires) && created <= now && created >= now - TIKTOK_NATIVE_EVIDENCE_MAX_AGE_MS && expires > now && expires <= created + TIKTOK_NATIVE_EVIDENCE_MAX_AGE_MS;
}
function makeEvidence(resources: Awaited<ReturnType<typeof readTikTokTrafficCampaignContext>>["resources"], identity: TikTokAdsIdentity, locationIds: string[], record: TikTokTrafficCapabilityEvidence | null, now: number): TikTokTrafficNativeEvidence {
  return { advertiserId: resources.selectedAccountId, currency: resources.account.currency, status: resources.account.status, timeZone: resources.account.timezone,
    identity, locationIds, callToActions: record?.callToActions || [], allowedNonSparkIdentityTypes: record?.allowedNonSparkIdentityTypes || [],
    manualTrafficV13: record?.manualTrafficV13 || "unverified", nativeWriteAccess: record?.nativeWriteAccess || "unverified",
    videoUpload: record?.videoUpload || "unverified", imageUpload: record?.imageUpload || "unverified", mediaRead: record?.mediaRead || "unverified", objectRead: record?.objectRead || "unverified",
    minimumLifetimeBudgetEuros: record?.minimumLifetimeBudgetEuros ?? null, budgetCalendar: record?.budgetCalendar ?? null,
    scheduleTimeBasis: record?.scheduleTimeBasis ?? null, scheduleOffsetMinutes: record?.scheduleOffsetMinutes ?? null,
    verifiedAt: record?.verifiedAt || new Date(now).toISOString(), validUntil: record?.validUntil || new Date(now + 30_000).toISOString() };
}

/** Server-only result includes proof and a revalidation closure; routes must project `preparation` only. */
export async function prepareTikTokAdsCampaignForPublication(userId: string, draft: TikTokTrafficCampaignDraft, dependencies: TikTokCampaignPreparationDependencies = {}, resumed = false) {
  const parsed = normalizeTikTokAdsNativeSelections(draft.tiktokNativeSelections);
  if (draft.provider !== "tiktok" || parsed.error || !parsed.selections || parsed.selections.advertiserId !== draft.adAccountId) throw new TikTokTrafficPublisherError("native_selections_invalid");
  const selection = parsed.selections, selectionKey = tikTokAdsNativeSelectionsKey(selection)!;
  const readStoreAvailability = dependencies.readStoreAvailability || readPreparedAdsStoreAvailability;
  const storeAvailable = async () => { try { return await readStoreAvailability() === true; } catch { return false; } };
  const effectiveDelivery = { budgetMode: "total" as const, totalEuros: draft.preparedDeliverySettings?.budget.totalEuros ?? null,
    startAt: draft.preparedDeliverySettings?.budget.startAt ?? null, endAt: draft.preparedDeliverySettings?.budget.endAt ?? null, currency: "EUR" as const, targetStatus: "DISABLE" as const };
  const pausedCreationEnabled = tikTokAdsPausedCreationEnabled(dependencies.environment || process.env);
  if (!await storeAvailable()) {
    const preparationKey = digest({ selectionKey, effectiveDelivery, storeAvailable: false, targetStatus: "DISABLE" });
    const preparation: TikTokAdsCampaignPreparation = { ready: false, publicationEnabled: false, targetStatus: "DISABLE",
      pausedCreationEnabled, nativeProofReady: false, preparationReady: false, selectedAccountId: draft.adAccountId, selectedIdentity: null,
      verifiedLocations: [], verifiedLocationCount: 0, resourcesKey: "", selectionKey, preparationKey, consentKey: preparationKey,
      effectiveDelivery, blockers: ["campaign_store_migration_required"], verifiedAt: new Date(dependencies.resources?.now?.() ?? Date.now()).toISOString() };
    return { preparation, input: null, nativeEvidence: null, scope: null,
      assertCurrentCapability: async () => { throw new TikTokTrafficPublisherError("campaign_store_migration_required"); } };
  }
  const ctx = await readTikTokTrafficCampaignContext(userId, draft.adAccountId, dependencies.resources);
  const resources = ctx.resources, now = ctx.now();
  const resourcesKey = tikTokAdsResourcesConsentKey(resources);
  if (!resourcesKey) throw new TikTokTrafficPublisherError("account_context_changed");
  const selectedIdentity = selection.identity ? resources.identities.find((identity) => identityKey(identity) === identityKey(selection.identity!)) || null : null;
  const verifiedLocations = selection.locationIds.flatMap((id) => { const found = ctx.locations.find((target) => target.id === id); return found ? [found] : []; });
  const blockers: string[] = [];
  if (!selectedIdentity) blockers.push(selection.identity ? "identity_not_authorized" : "identity_required");
  if (!selection.locationIds.length) blockers.push("location_required");
  else if (verifiedLocations.length !== selection.locationIds.length) blockers.push("location_not_available");
  if (!selection.callToAction) blockers.push("cta_required");
  if (!selection.thumbnailMediaId) blockers.push("thumbnail_required");
  if (typeof selection.isAiGenerated !== "boolean") blockers.push("aigc_declaration_required");
  if (!resources.account.timezone) blockers.push("account_timezone_unverified");
  if (resources.identityRead.status !== "verified") blockers.push("identity_read_unavailable");
  let input: TikTokTrafficVideoInput | null = null;
  let sourceMediaFingerprint: string | null = null;
  if (tikTokAdsNativeSelectionsComplete(selection) && selectedIdentity && verifiedLocations.length === selection.locationIds.length) {
    try {
      input = tikTokTrafficInputFromAdsDraft(draft, { identity: selectedIdentity, locationIds: [...selection.locationIds], callToAction: selection.callToAction, thumbnailMediaId: selection.thumbnailMediaId, isAiGenerated: selection.isAiGenerated });
      validateTikTokTrafficVideoFields(input, now, resumed);
    } catch (error) { input = null; blockers.push(error instanceof TikTokTrafficPublisherError ? error.code : "draft_not_supported"); }
  }
  if (input) {
    const sourceMedia = await checkTikTokOwnedSourceMedia(userId, input.videoMediaId, input.thumbnailMediaId, dependencies.readOwnedSourceMedia);
    sourceMediaFingerprint = sourceMedia.fingerprint;
    if (!sourceMedia.ready) { blockers.push("owned_source_media_unavailable"); input = null; }
  }
  const readCapability = (scope: TikTokTrafficCapabilityScope) => dependencies.readCapabilityEvidence ? dependencies.readCapabilityEvidence(scope)
    : readTikTokConfiguredCapabilityEvidence(scope, ctx.now(), dependencies.environment || process.env);
  const rawCapability = await readCapability(ctx.scope);
  const proofNow = ctx.now();
  const record = validCapabilityRecord(rawCapability, ctx.scope, proofNow) ? structuredClone(rawCapability) : null;
  if (rawCapability && !record) blockers.push("native_capability_snapshot_invalid");
  const capability = record ? capabilityKey(record) : capabilityKey(null);
  const evidence = selectedIdentity ? makeEvidence(resources, selectedIdentity, verifiedLocations.map((target) => target.id), record, proofNow) : null;
  if (!record) blockers.push("native_capabilities_unverified");
  if (evidence) {
    for (const key of ["manualTrafficV13", "nativeWriteAccess", "videoUpload", "imageUpload", "mediaRead", "objectRead"] as const) if (evidence[key] !== "verified") blockers.push(`${key}_unverified`);
    if (!evidence.callToActions.includes(selection.callToAction || "")) blockers.push("cta_options_unverified");
    if (!evidence.allowedNonSparkIdentityTypes.includes(selectedIdentity!.type)) blockers.push("non_spark_identity_type_unverified");
    if (evidence.minimumLifetimeBudgetEuros == null) blockers.push("budget_minimum_unverified");
    if (!evidence.scheduleTimeBasis) blockers.push("schedule_time_basis_unverified");
  }
  let nativeProofReady = false;
  if (input && evidence) {
    try { validateTikTokTrafficVideoInput(input, evidence, proofNow, resumed); nativeProofReady = true; }
    catch (error) { blockers.push(error instanceof TikTokTrafficPublisherError ? error.code : "native_evidence_invalid"); }
  }
  if (!pausedCreationEnabled) blockers.push("paused_creation_disabled");
  const preparationKey = digest({ resourcesKey, selectionKey, capability, inputKey: input ? tikTokTrafficInputKey(input) : null, sourceMediaFingerprint, effectiveDelivery, targetStatus: "DISABLE" });
  const preparation: TikTokAdsCampaignPreparation = { ready: pausedCreationEnabled && nativeProofReady && Boolean(input), publicationEnabled: false, targetStatus: "DISABLE",
    pausedCreationEnabled, nativeProofReady, preparationReady: Boolean(input), selectedAccountId: ctx.resources.selectedAccountId, selectedIdentity, verifiedLocations,
    verifiedLocationCount: verifiedLocations.length, resourcesKey, selectionKey, preparationKey, consentKey: preparationKey, effectiveDelivery, blockers: [...new Set(blockers)], verifiedAt: new Date(proofNow).toISOString() };
  await ctx.assertCurrent();
  return { preparation, input, nativeEvidence: evidence, scope: ctx.scope,
    assertCurrentCapability: async () => {
      if (!await storeAvailable()) throw new TikTokTrafficPublisherError("campaign_store_migration_required");
      await ctx.assertCurrent();
      const current = await readCapability(ctx.scope);
      if (!validCapabilityRecord(current, ctx.scope, ctx.now()) || capabilityKey(current) !== capability) throw new TikTokTrafficPublisherError("native_capabilities_changed");
      if (input) {
        const sourceMedia = await checkTikTokOwnedSourceMedia(userId, input.videoMediaId, input.thumbnailMediaId, dependencies.readOwnedSourceMedia);
        if (!sourceMedia.ready || sourceMedia.fingerprint !== sourceMediaFingerprint) throw new TikTokTrafficPublisherError("source_media_changed");
      }
      await ctx.assertCurrent();
    } };
}

/** Public, read-only preflight. No proof object, access token, URL capability or mutation is projected. */
export async function checkTikTokAdsCampaignPreparation(userId: string, draft: TikTokTrafficCampaignDraft, dependencies?: TikTokCampaignPreparationDependencies): Promise<TikTokAdsCampaignPreparation> {
  return (await prepareTikTokAdsCampaignForPublication(userId, draft, dependencies, dependencies?.resumed === true)).preparation;
}
