import { createHash } from "node:crypto";
import type { TikTokAdsIdentity } from "./adsTikTokResources.ts";
import { preparedAdsInstant } from "./adsPreparedCampaignSettings.ts";

/** A narrow, dormant v1.3 manual Traffic adapter. No activation endpoint exists here.
 * SDK: https://github.com/tiktok/tiktok-business-api-sdk/tree/main/js_sdk/docs
 * Budget matrix: https://business-api.tiktok.com/gateway/docs/index?doc_id=1701890928827393
 * AIGC enum: https://business-api.tiktok.com/gateway/docs/index?doc_id=1739473020978177
 * The SDK describes fields, not a particular application's granted permissions.
 */
export const TIKTOK_TRAFFIC_NATIVE_CREATION_ENABLED = false;
export const TIKTOK_TRAFFIC_API_BASE = "https://business-api.tiktok.com/open_api/v1.3";
export const TIKTOK_TRAFFIC_MAX_VIDEO_BYTES = 100 * 1024 * 1024; // iNrCy limit, not a provider claim.
export const TIKTOK_TRAFFIC_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export type TikTokTrafficVideoInput = {
  advertiserId: string; name: string; adGroupName: string; adName: string;
  destinationUrl: string; adText: string; callToAction: string;
  totalBudgetEuros: number; startAt: string; endAt: string;
  identity: TikTokAdsIdentity; locationIds: string[];
  videoMediaId: string; thumbnailMediaId: string; isAiGenerated: boolean;
};
/** Server-only evidence. Account GET alone must NEVER turn either capability to verified. */
export type TikTokTrafficNativeEvidence = {
  advertiserId: string; currency: string; status: string; timeZone: string | null;
  identity: TikTokAdsIdentity; locationIds: string[]; callToActions: string[];
  allowedNonSparkIdentityTypes: TikTokAdsIdentity["type"][];
  /** Currency/calendar-specific minimum and API time basis must be provider/document verified. */
  minimumLifetimeBudgetEuros: number | null; budgetCalendar: { startAt: string; endAt: string } | null;
  scheduleTimeBasis: "utc" | "advertiser" | null; scheduleOffsetMinutes: number | null;
  manualTrafficV13: "verified" | "unverified";
  nativeWriteAccess: "verified" | "unverified";
  videoUpload: "verified" | "unverified"; imageUpload: "verified" | "unverified";
  mediaRead: "verified" | "unverified"; objectRead: "verified" | "unverified";
  verifiedAt: string; validUntil: string;
};
/** URLs are private, short-lived capabilities: never persist them in checkpoints. */
export type TikTokTrafficOwnedMedia = {
  id: string; kind: "video" | "image"; url: string; expiresAt: string;
  allowedOrigin: string; contentType: string; sizeBytes: number;
  width: number; height: number; signature: string;
};
export type TikTokTrafficMutationStep = "upload_video" | "upload_thumbnail" | "create_campaign" | "create_adgroup" | "create_ad";
export type TikTokTrafficCheckpoint = {
  schemaVersion: 1; operationKey: string; advertiserId: string; inputKey: string;
  targetStatus: "DISABLE"; stage: "prepared" | "media_available" | "campaign_created" | "adgroup_created" | "ad_created" | "paused_verified";
  videoId?: string; imageId?: string; campaignId?: string; adGroupId?: string; adId?: string;
  videoSignature?: string; imageSignature?: string;
  pendingStep?: TikTokTrafficMutationStep; uncertainStep?: TikTokTrafficMutationStep;
};
export type TikTokTrafficDependencies = {
  fetchImpl: typeof fetch; accessToken: string; now: () => number;
  /** Must recheck integration, advertiser authorization, active EUR account and ownership. */
  assertOwnership: () => Promise<void>;
  resolveOwnedMedia: (id: string, kind: "video" | "image") => Promise<TikTokTrafficOwnedMedia>;
  loadCheckpoint: () => Promise<TikTokTrafficCheckpoint | null>;
  /** Must be durable, serialize one operation and fail if another runner holds it. */
  saveCheckpoint: (checkpoint: TikTokTrafficCheckpoint) => Promise<void>;
  withOperationLock: <T>(operationKey: string, action: () => Promise<T>) => Promise<T>;
};
export class TikTokTrafficPublisherError extends Error {
  readonly code: string; readonly uncertain: boolean;
  constructor(code: string, uncertain = false) {
    super(`TikTok Traffic preparation failed: ${code}`); this.name = "TikTokTrafficPublisherError"; this.code = code; this.uncertain = uncertain;
  }
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const id = (value: unknown): string => typeof value === "string" && /^\d{5,30}$/.test(value) ? value : "";
export function tikTokTrafficAssetId(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/.test(value)
    && !value.includes("..") && !value.includes("//") ? value : null;
}
function fail(code: string): never { throw new TikTokTrafficPublisherError(code); }
function identityKey(identity: TikTokAdsIdentity): string { return JSON.stringify([identity.id, identity.type, identity.authorizedBusinessCenterId || ""]); }
function httpsUrl(value: string): URL | null {
  try {
    const url = new URL(value), host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash || value.length > 2048
      || !host || host.endsWith(".") || host.includes(":") || /^[\d.]+$/.test(host) || host === "localhost"
      || /\.(?:localhost|local|internal)$/.test(host)) return null;
    return url;
  } catch { return null; }
}
export function tikTokTrafficInputKey(input: TikTokTrafficVideoInput): string {
  return createHash("sha256").update(JSON.stringify({ ...input,
    identity: { id: input.identity.id, type: input.identity.type, authorizedBusinessCenterId: input.identity.authorizedBusinessCenterId || null },
    locationIds: [...input.locationIds].sort() })).digest("hex");
}
/** Structural preparation checks do not manufacture provider capability evidence. */
export function validateTikTokTrafficVideoFields(input: TikTokTrafficVideoInput, now: number, resumed = false): void {
  if (!id(input.advertiserId)) fail("advertiser_mismatch");
  if (!input.identity || !tikTokTrafficAssetId(input.identity.id) || input.identity.type === "AUTH_CODE") fail("identity_unverified");
  if (!Array.isArray(input.locationIds) || !input.locationIds.length || input.locationIds.length > 20
    || new Set(input.locationIds).size !== input.locationIds.length || input.locationIds.some((zone) => typeof zone !== "string" || !/^\d{1,30}$/.test(zone) || /^0+$/.test(zone))) fail("location_unverified");
  if (!/^[A-Z][A-Z_]{1,50}$/.test(input.callToAction)) fail("cta_unverified");
  if (!httpsUrl(input.destinationUrl)) fail("destination_invalid");
  if ([input.name, input.adGroupName, input.adName].some((value) => typeof value !== "string" || value.trim().length < 3 || value.length > 100 || /[\x00-\x1f]/.test(value))) fail("name_invalid");
  if (typeof input.adText !== "string" || input.adText.trim().length < 1 || input.adText.length > 100 || /[\x00-\x1f]/.test(input.adText)) fail("ad_text_invalid");
  if (typeof input.isAiGenerated !== "boolean") fail("aigc_declaration_missing");
  if (!Number.isFinite(input.totalBudgetEuros) || input.totalBudgetEuros <= 0 || input.totalBudgetEuros > 500
    || Math.abs(input.totalBudgetEuros * 100 - Math.round(input.totalBudgetEuros * 100)) > 0.000001) fail("total_budget_invalid");
  const start = Date.parse(input.startAt), end = Date.parse(input.endAt);
  if (!preparedAdsInstant(input.startAt) || !preparedAdsInstant(input.endAt)
    || !Number.isFinite(start) || !Number.isFinite(end) || (!resumed && start < now + 60_000)
    || end <= Math.max(start, now) || end - start > 90 * 86400_000) fail("schedule_invalid");
  if (![input.videoMediaId, input.thumbnailMediaId].every((value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
    || input.videoMediaId === input.thumbnailMediaId) fail("owned_media_required");
}
function nativeTime(iso: string, offsetMinutes: number): string {
  // TikTok account clocks are fixed offsets; never infer daylight saving from an IANA label.
  return new Date(Date.parse(iso) + offsetMinutes * 60_000).toISOString().slice(0, 19).replace("T", " ");
}
export function validateTikTokTrafficVideoInput(input: TikTokTrafficVideoInput, evidence: TikTokTrafficNativeEvidence, now: number, resumed = false): void {
  validateTikTokTrafficVideoFields(input, now, resumed);
  if (!id(input.advertiserId) || input.advertiserId !== evidence.advertiserId) fail("advertiser_mismatch");
  if (evidence.currency !== "EUR" || evidence.status !== "STATUS_ENABLE") fail("account_not_active_eur");
  if (!evidence.timeZone) fail("timezone_unverified");
  try { new Intl.DateTimeFormat("en", { timeZone: evidence.timeZone }); } catch { fail("timezone_unverified"); }
  if (Date.parse(evidence.verifiedAt) > now || !Number.isFinite(Date.parse(evidence.verifiedAt))
    || Date.parse(evidence.validUntil) <= now || !Number.isFinite(Date.parse(evidence.validUntil))) fail("native_evidence_expired");
  for (const key of ["manualTrafficV13", "nativeWriteAccess", "videoUpload", "imageUpload", "mediaRead", "objectRead"] as const) {
    if (evidence[key] !== "verified") fail(`${key}_unverified`);
  }
  if (evidence.scheduleTimeBasis !== "utc" && evidence.scheduleTimeBasis !== "advertiser") fail("schedule_time_basis_unverified");
  if (evidence.scheduleTimeBasis === "advertiser" && (typeof evidence.scheduleOffsetMinutes !== "number" || !Number.isInteger(evidence.scheduleOffsetMinutes)
    || evidence.scheduleOffsetMinutes < -720 || evidence.scheduleOffsetMinutes > 840)) fail("schedule_offset_unverified");
  if (!Number.isFinite(evidence.minimumLifetimeBudgetEuros) || !evidence.minimumLifetimeBudgetEuros || evidence.minimumLifetimeBudgetEuros <= 0) fail("minimum_budget_unverified");
  if (evidence.budgetCalendar?.startAt !== input.startAt || evidence.budgetCalendar?.endAt !== input.endAt) fail("minimum_budget_calendar_unverified");
  if (!input.identity || !tikTokTrafficAssetId(input.identity.id) || identityKey(input.identity) !== identityKey(evidence.identity)
    || !evidence.allowedNonSparkIdentityTypes.includes(input.identity.type)
    || (input.identity.type === "BC_AUTH_TT" && !id(input.identity.authorizedBusinessCenterId))) fail("identity_unverified");
  if (input.locationIds.some((zone) => !evidence.locationIds.includes(zone))) fail("location_unverified");
  if (!evidence.callToActions.includes(input.callToAction)) fail("cta_unverified");
  if (input.totalBudgetEuros < evidence.minimumLifetimeBudgetEuros) fail("total_budget_below_native_minimum");
}
export function prepareTikTokTrafficNativeBodies(input: TikTokTrafficVideoInput, evidence: TikTokTrafficNativeEvidence) {
  if (evidence.scheduleTimeBasis !== "utc" && evidence.scheduleTimeBasis !== "advertiser") fail("schedule_time_basis_unverified");
  if (evidence.scheduleTimeBasis === "advertiser" && !Number.isInteger(evidence.scheduleOffsetMinutes)) fail("schedule_offset_unverified");
  const scheduleOffset = evidence.scheduleTimeBasis === "utc" ? 0 : evidence.scheduleOffsetMinutes!;
  return {
    campaign: { advertiser_id: input.advertiserId, campaign_name: input.name, objective_type: "TRAFFIC", budget_optimize_on: false, budget_mode: "BUDGET_MODE_INFINITE", operation_status: "DISABLE" },
    adGroup: { advertiser_id: input.advertiserId, adgroup_name: input.adGroupName, promotion_type: "WEBSITE", optimization_goal: "CLICK", billing_event: "CPC", bid_type: "BID_TYPE_NO_BID", pacing: "PACING_MODE_SMOOTH", budget_mode: "BUDGET_MODE_TOTAL", budget: input.totalBudgetEuros, schedule_type: "SCHEDULE_START_END", schedule_start_time: nativeTime(input.startAt, scheduleOffset), schedule_end_time: nativeTime(input.endAt, scheduleOffset), placement_type: "PLACEMENT_TYPE_NORMAL", placements: ["PLACEMENT_TIKTOK"], location_ids: [...input.locationIds], operation_status: "DISABLE" },
    creative: { ad_name: input.adName, ad_format: "SINGLE_VIDEO", identity_type: input.identity.type, identity_id: input.identity.id, ...(input.identity.authorizedBusinessCenterId ? { identity_authorized_bc_id: input.identity.authorizedBusinessCenterId } : {}), ad_text: input.adText, call_to_action: input.callToAction, landing_page_url: input.destinationUrl, aigc_disclosure_type: input.isAiGenerated ? "SELF_DISCLOSURE" : "NOT_DECLARED", operation_status: "DISABLE" },
  };
}
function assertCheckpoint(checkpoint: TikTokTrafficCheckpoint, input: TikTokTrafficVideoInput, operationKey: string) {
  const keys = ["schemaVersion", "operationKey", "advertiserId", "inputKey", "targetStatus", "stage", "videoId", "imageId", "campaignId", "adGroupId", "adId", "pendingStep", "uncertainStep", "videoSignature", "imageSignature"];
  if (Object.keys(checkpoint).some((key) => !keys.includes(key))) fail("checkpoint_invalid");
  if (checkpoint.schemaVersion !== 1 || checkpoint.operationKey !== operationKey || checkpoint.advertiserId !== input.advertiserId
    || checkpoint.inputKey !== tikTokTrafficInputKey(input) || checkpoint.targetStatus !== "DISABLE") fail("checkpoint_mismatch");
  const steps = ["upload_video", "upload_thumbnail", "create_campaign", "create_adgroup", "create_ad"];
  if ((checkpoint.pendingStep && !steps.includes(checkpoint.pendingStep)) || (checkpoint.uncertainStep && !steps.includes(checkpoint.uncertainStep))) fail("checkpoint_invalid");
  if ((checkpoint.videoId && !tikTokTrafficAssetId(checkpoint.videoId)) || (checkpoint.imageId && !tikTokTrafficAssetId(checkpoint.imageId))
    || [checkpoint.campaignId, checkpoint.adGroupId, checkpoint.adId].some((value) => value !== undefined && !id(value))) fail("checkpoint_invalid");
  if ((Boolean(checkpoint.videoId) !== Boolean(checkpoint.videoSignature)) || (Boolean(checkpoint.imageId) !== Boolean(checkpoint.imageSignature))
    || [checkpoint.videoSignature, checkpoint.imageSignature].some((value) => value !== undefined && !/^[0-9a-f]{32}$/.test(value))) fail("checkpoint_invalid");
  const stages = ["prepared", "media_available", "campaign_created", "adgroup_created", "ad_created", "paused_verified"];
  const position = stages.indexOf(checkpoint.stage);
  if (position < 0 || (position >= 1 && (!checkpoint.videoId || !checkpoint.imageId)) || (Boolean(checkpoint.campaignId) !== (position >= 2))
    || (Boolean(checkpoint.adGroupId) !== (position >= 3)) || (Boolean(checkpoint.adId) !== (position >= 4))) fail("checkpoint_invalid");
  if (checkpoint.pendingStep || checkpoint.uncertainStep) throw new TikTokTrafficPublisherError("mutation_outcome_unknown", true);
}
function validateOwnedMedia(source: TikTokTrafficOwnedMedia, requestedId: string, kind: "video" | "image", now: number) {
  const url = httpsUrl(source.url);
  if (source.id !== requestedId || source.kind !== kind || !url || url.origin !== source.allowedOrigin
    || !/^\/storage\/v1\/object\/sign\//.test(url.pathname) || !url.searchParams.get("token")) fail("owned_media_invalid");
  if (!Number.isFinite(Date.parse(source.expiresAt)) || Date.parse(source.expiresAt) < now + 300_000) fail("media_url_expired");
  if (!Number.isSafeInteger(source.sizeBytes) || source.sizeBytes <= 0 || source.sizeBytes > (kind === "video" ? TIKTOK_TRAFFIC_MAX_VIDEO_BYTES : TIKTOK_TRAFFIC_MAX_IMAGE_BYTES)
    || !Number.isSafeInteger(source.width) || !Number.isSafeInteger(source.height) || source.width < 540 || source.height < 960
    || source.width * 16 !== source.height * 9 || !/^[0-9a-f]{32}$/.test(source.signature)
    || (kind === "video" ? source.contentType !== "video/mp4" : !["image/jpeg", "image/png"].includes(source.contentType))) fail("media_invalid");
}
/** Injectable orchestration only. Production callers must pass the separately closed server gate.
 * A durable exclusive lock and a checkpoint written BEFORE each POST are mandatory.
 * A timeout, malformed response, nonzero envelope or crash never automatically retries a mutation.
 */
export async function runTikTokPausedTrafficVideo(inputValue: TikTokTrafficVideoInput, evidenceValue: TikTokTrafficNativeEvidence, operationKey: string, deps: TikTokTrafficDependencies): Promise<TikTokTrafficCheckpoint> {
  const input = structuredClone(inputValue), evidence = structuredClone(evidenceValue);
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(operationKey) || !deps.accessToken) fail("operation_invalid");
  return deps.withOperationLock(operationKey, async () => {
    await deps.assertOwnership();
    let progress = await deps.loadCheckpoint();
    if (progress) assertCheckpoint(progress, input, operationKey);
    validateTikTokTrafficVideoInput(input, evidence, deps.now(), Boolean(progress));
    if (!progress) {
      progress = { schemaVersion: 1, operationKey, advertiserId: input.advertiserId, inputKey: tikTokTrafficInputKey(input), targetStatus: "DISABLE", stage: "prepared" };
      await deps.saveCheckpoint(structuredClone(progress));
    }
    async function checkpoint(patch: Partial<TikTokTrafficCheckpoint>) {
      await deps.assertOwnership();
      const next = { ...progress!, ...patch };
      await deps.saveCheckpoint(structuredClone(next)); progress = next;
    }
    async function api(path: string, method: "GET" | "POST", body: Record<string, unknown> | FormData) {
      await deps.assertOwnership();
      if (Date.parse(evidence.validUntil) <= deps.now()) fail("native_evidence_expired");
      const params = method === "GET" ? new URLSearchParams(Object.entries(body).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)])) : null;
      let response: Response;
      try {
        response = await deps.fetchImpl(`${TIKTOK_TRAFFIC_API_BASE}/${path}/${params ? `?${params}` : ""}`, {
          method, headers: { "Access-Token": deps.accessToken, Accept: "application/json", ...(method === "POST" && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}) },
          ...(method === "POST" ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
          cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000),
        });
      } catch { throw new TikTokTrafficPublisherError("provider_transport_error", method === "POST"); }
      const payload = record(await response.json().catch(() => null));
      if (!response.ok || payload.code !== 0 || !payload.data || typeof payload.data !== "object") throw new TikTokTrafficPublisherError("provider_response_invalid", method === "POST");
      await deps.assertOwnership();
      return record(payload.data);
    }
    async function mutation(step: TikTokTrafficMutationStep, path: string, body: Record<string, unknown> | FormData, accept: (data: Record<string, unknown>) => Partial<TikTokTrafficCheckpoint>) {
      await checkpoint({ pendingStep: step });
      try {
        const data = await api(path, "POST", body), patch = accept(data);
        await checkpoint({ ...patch, pendingStep: undefined, uncertainStep: undefined });
      } catch {
        // Even a provider error can hide a partially committed or malformed result.
        await checkpoint({ pendingStep: step, uncertainStep: step }).catch(() => undefined);
        throw new TikTokTrafficPublisherError("mutation_outcome_unknown", true);
      }
    }
    async function upload(kind: "video" | "image", mediaId: string) {
      await deps.assertOwnership();
      const source = await deps.resolveOwnedMedia(mediaId, kind);
      validateOwnedMedia(source, mediaId, kind, deps.now());
      const body = new FormData();
      body.set("advertiser_id", input.advertiserId); body.set("upload_type", "UPLOAD_BY_URL");
      body.set("file_name", `${mediaId}.${kind === "video" ? "mp4" : source.contentType === "image/png" ? "png" : "jpg"}`);
      body.set(`${kind}_url`, source.url);
      await mutation(kind === "video" ? "upload_video" : "upload_thumbnail", `file/${kind}/ad/upload`, body, (data) => {
        const rows = Array.isArray(data.list) ? data.list : [data];
        if (rows.length !== 1) fail("media_upload_response_invalid");
        const reference = tikTokTrafficAssetId(record(rows[0])[`${kind}_id`]);
        if (!reference) fail("media_upload_response_invalid");
        return kind === "video" ? { videoId: reference, videoSignature: source.signature } : { imageId: reference, imageSignature: source.signature };
      });
    }
    if (!progress.videoId) await upload("video", input.videoMediaId);
    if (!progress.imageId) await upload("image", input.thumbnailMediaId);
    async function verifyMedia() {
      for (const [mediaId, kind, signature] of [[input.videoMediaId, "video", progress!.videoSignature], [input.thumbnailMediaId, "image", progress!.imageSignature]] as const) {
        await deps.assertOwnership();
        const source = await deps.resolveOwnedMedia(mediaId, kind);
        validateOwnedMedia(source, mediaId, kind, deps.now());
        if (source.signature !== signature) fail("media_content_changed");
      }
      const video = await api("file/video/ad/info", "GET", { advertiser_id: input.advertiserId, video_ids: [progress!.videoId] });
      const rows = Array.isArray(video.list) ? video.list.map(record) : [];
      const match = rows.length === 1 && rows[0].video_id === progress!.videoId ? rows[0] : null;
      if (!match || match.displayable !== true || match.format !== "mp4" || Number(match.width) < 540 || Number(match.height) < 960
        || Number(match.width) * 16 !== Number(match.height) * 9 || !Number.isFinite(Number(match.duration)) || Number(match.duration) < 5 || Number(match.duration) > 60
        || !Number.isSafeInteger(Number(match.size)) || Number(match.size) <= 0 || Number(match.size) > TIKTOK_TRAFFIC_MAX_VIDEO_BYTES
        || match.signature !== progress!.videoSignature
        || !Array.isArray(match.allowed_placements) || !match.allowed_placements.includes("PLACEMENT_TIKTOK")) fail("native_video_unavailable");
      const image = await api("file/image/ad/info", "GET", { advertiser_id: input.advertiserId, image_ids: [progress!.imageId] });
      const images = Array.isArray(image.list) ? image.list.map(record) : [];
      if (images.length !== 1 || images[0].image_id !== progress!.imageId || Number(images[0].width) < 540 || Number(images[0].height) < 960
        || Number(images[0].width) * 16 !== Number(images[0].height) * 9) fail("native_thumbnail_unavailable");
    }
    await verifyMedia();
    if (progress.stage === "prepared") await checkpoint({ stage: "media_available" });
    const bodies = prepareTikTokTrafficNativeBodies(input, evidence);
    async function readObject(kind: "campaign" | "adgroup" | "ad", objectId: string, parentId?: string) {
      const data = await api(`${kind}/get`, "GET", { advertiser_id: input.advertiserId, filtering: { [`${kind}_ids`]: [objectId] }, fields: [`${kind}_id`, "advertiser_id", "operation_status", ...(kind === "adgroup" ? ["campaign_id"] : kind === "ad" ? ["adgroup_id"] : [])] });
      const list = Array.isArray(data.list) ? data.list.map(record) : [];
      const item = list.length === 1 && list[0][`${kind}_id`] === objectId ? list[0] : null;
      if (!item || item.advertiser_id !== input.advertiserId || item.operation_status !== "DISABLE"
        || (parentId && item[kind === "adgroup" ? "campaign_id" : "adgroup_id"] !== parentId)) fail("paused_readback_mismatch");
    }
    if (!progress.campaignId) await mutation("create_campaign", "campaign/create", bodies.campaign, (data) => {
      const reference = id(data.campaign_id); if (!reference) fail("campaign_id_invalid");
      return { campaignId: reference, stage: "campaign_created" };
    });
    await readObject("campaign", progress.campaignId!);
    if (!progress.adGroupId) await mutation("create_adgroup", "adgroup/create", { ...bodies.adGroup, campaign_id: progress.campaignId }, (data) => {
      const reference = id(data.adgroup_id); if (!reference) fail("adgroup_id_invalid");
      return { adGroupId: reference, stage: "adgroup_created" };
    });
    await readObject("adgroup", progress.adGroupId!, progress.campaignId);
    if (!progress.adId) await mutation("create_ad", "ad/create", { advertiser_id: input.advertiserId, adgroup_id: progress.adGroupId, creatives: [{ ...bodies.creative, video_id: progress.videoId, image_ids: [progress.imageId] }] }, (data) => {
      const values = Array.isArray(data.ad_ids) ? data.ad_ids : [];
      const reference = values.length === 1 ? id(values[0]) : "";
      if (!reference) fail("ad_id_invalid");
      return { adId: reference, stage: "ad_created" };
    });
    // Read all three again: an earlier disabled parent is not sufficient proof at completion.
    await readObject("campaign", progress.campaignId!);
    await readObject("adgroup", progress.adGroupId!, progress.campaignId);
    await readObject("ad", progress.adId!, progress.adGroupId);
    await checkpoint({ stage: "paused_verified" });
    return structuredClone(progress);
  });
}

export type TikTokPausedHierarchyReadback = {
  confirmed: boolean; targetStatus: "DISABLE"; reason: string | null;
  campaignId?: string; adGroupId?: string; adId?: string;
  statuses: { campaign: string | null; adGroup: string | null; ad: string | null };
};
/** Reconcile an owned saved hierarchy using GET only. Unknown creations are never replayed. */
export async function readTikTokPausedTrafficHierarchy(input: TikTokTrafficVideoInput, checkpointValue: TikTokTrafficCheckpoint, operationKey: string,
  deps: Pick<TikTokTrafficDependencies, "fetchImpl" | "accessToken" | "assertOwnership">): Promise<TikTokPausedHierarchyReadback> {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(operationKey) || !deps.accessToken) fail("operation_invalid");
  const checkpoint = structuredClone(checkpointValue), clean = { ...checkpoint };
  delete clean.pendingStep; delete clean.uncertainStep;
  assertCheckpoint(clean, input, operationKey);
  const result: TikTokPausedHierarchyReadback = { confirmed: false, targetStatus: "DISABLE", reason: null,
    ...(checkpoint.campaignId ? { campaignId: checkpoint.campaignId } : {}), ...(checkpoint.adGroupId ? { adGroupId: checkpoint.adGroupId } : {}), ...(checkpoint.adId ? { adId: checkpoint.adId } : {}),
    statuses: { campaign: null, adGroup: null, ad: null } };
  if (checkpoint.pendingStep || checkpoint.uncertainStep) return { ...result, reason: "mutation_outcome_unknown" };
  for (const [kind, objectId, parentId] of [["campaign", checkpoint.campaignId, null], ["adgroup", checkpoint.adGroupId, checkpoint.campaignId], ["ad", checkpoint.adId, checkpoint.adGroupId]] as const) {
    if (!objectId) continue;
    await deps.assertOwnership();
    const params = new URLSearchParams({ advertiser_id: input.advertiserId, filtering: JSON.stringify({ [`${kind}_ids`]: [objectId] }),
      fields: JSON.stringify([`${kind}_id`, "advertiser_id", "operation_status", ...(kind === "adgroup" ? ["campaign_id"] : kind === "ad" ? ["adgroup_id"] : [])]) });
    let response: Response;
    try { response = await deps.fetchImpl(`${TIKTOK_TRAFFIC_API_BASE}/${kind}/get/?${params}`, { method: "GET", headers: { "Access-Token": deps.accessToken, Accept: "application/json" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) }); }
    catch { throw new TikTokTrafficPublisherError("readback_unavailable"); }
    const payload = record(await response.json().catch(() => null));
    if (!response.ok || payload.code !== 0) throw new TikTokTrafficPublisherError("readback_unavailable");
    await deps.assertOwnership();
    const data = record(payload.data), rows = Array.isArray(data.list) ? data.list.map(record) : [];
    const row = rows.length === 1 && rows[0][`${kind}_id`] === objectId ? rows[0] : null;
    if (!row || row.advertiser_id !== input.advertiserId || (parentId && row[kind === "adgroup" ? "campaign_id" : "adgroup_id"] !== parentId)) return { ...result, reason: "native_hierarchy_mismatch" };
    result.statuses[kind === "adgroup" ? "adGroup" : kind] = typeof row.operation_status === "string" ? row.operation_status : null;
    if (row.operation_status !== "DISABLE") return { ...result, reason: "native_delivery_not_disabled" };
  }
  return { ...result, confirmed: Boolean(checkpoint.campaignId && checkpoint.adGroupId && checkpoint.adId), reason: checkpoint.campaignId && checkpoint.adGroupId && checkpoint.adId ? null : "native_hierarchy_incomplete" };
}
