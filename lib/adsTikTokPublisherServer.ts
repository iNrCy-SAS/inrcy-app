import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { supabaseAdmin } from "./supabaseAdmin.ts";
import { decryptToken } from "./oauthCrypto.ts";
import { createSafeStorageSignedUrl } from "./safeStorageSignedUrl.ts";
import { readTikTokAdsIntegration, type TikTokAdsIntegration } from "./adsTikTokServer.ts";
import { parseTikTokAdvertiserIds, tikTokAdsAccessTokenIsFresh } from "./adsTikTokPolicy.ts";
import { parseTikTokAdsResourceAccount } from "./adsTikTokResources.ts";
import { tikTokTrafficInputFromAdsDraft, type TikTokTrafficCampaignDraft } from "./adsTikTokCampaignInput.ts";
import { prepareTikTokAdsCampaignForPublication, type TikTokCampaignPreparationDependencies } from "./adsTikTokCampaignPreparationServer.ts";
import { tikTokAdsPausedCreationEnabled } from "./adsTikTokPublicationPolicy.ts";
import { normalizeTikTokAdsNativeSelections, tikTokAdsNativeSelectionsComplete } from "./adsTikTokNativeSelections.ts";
import { readTikTokTrafficCampaignContext, type TikTokAdsResourceDependencies } from "./adsTikTokResourcesServer.ts";
import { runTikTokPausedTrafficVideo, readTikTokPausedTrafficHierarchy, TIKTOK_TRAFFIC_API_BASE, TIKTOK_TRAFFIC_MAX_VIDEO_BYTES, TIKTOK_TRAFFIC_MAX_IMAGE_BYTES, TikTokTrafficPublisherError, type TikTokTrafficDependencies, type TikTokTrafficOwnedMedia, type TikTokTrafficVideoInput, type TikTokTrafficCheckpoint, type TikTokPausedHierarchyReadback } from "./adsTikTokPublisherCore.ts";
export { tikTokTrafficInputFromAdsDraft } from "./adsTikTokCampaignInput.ts";
export type { TikTokTrafficServerSelections } from "./adsTikTokCampaignInput.ts";

type MediaRow = { bucket_name: unknown; storage_path: unknown; media_type: unknown; mime_type: unknown; size_bytes: unknown; width: unknown; height: unknown; is_active: unknown };
export type TikTokTrafficServerDependencies = {
  readIntegration: (userId: string) => Promise<TikTokAdsIntegration | null>;
  decrypt: (value: string) => string; fetchImpl: typeof fetch; now: () => number;
  readMedia: (userId: string, id: string) => Promise<MediaRow | null>;
  downloadMedia: (bucket: string, path: string) => Promise<Blob | null>;
  signMedia: (bucket: string, path: string, seconds: number) => Promise<string | null>;
  storageOrigin: string; appId: string; secret: string;
};
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const rowKey = (row: TikTokAdsIntegration) => JSON.stringify([row.id, row.status, row.resource_id, row.access_token_enc, row.refresh_token_enc, row.expires_at, object(row.meta).token_lifecycle]);
function defaults(): TikTokTrafficServerDependencies {
  return {
    readIntegration: readTikTokAdsIntegration, decrypt: decryptToken, fetchImpl: fetch, now: Date.now,
    appId: String(process.env.TIKTOK_ADS_APP_ID || "").trim(), secret: String(process.env.TIKTOK_ADS_SECRET || "").trim(),
    storageOrigin: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    readMedia: async (userId, id) => {
      const { data, error } = await supabaseAdmin.from("pro_media_library")
        .select("bucket_name,storage_path,media_type,mime_type,size_bytes,width,height,is_active")
        .eq("id", id).eq("user_id", userId).maybeSingle();
      if (error) throw new TikTokTrafficPublisherError("media_storage_unavailable");
      return data as MediaRow | null;
    },
    downloadMedia: async (bucket, path) => {
      const result = await supabaseAdmin.storage.from(bucket).download(path);
      return result.error ? null : result.data;
    },
    signMedia: createSafeStorageSignedUrl,
  };
}
/** Only references owned by the authenticated user are resolved. No arbitrary URL is fetched.
 * The bytes are read from storage to verify format/size and compute a stable source signature.
 */
export async function resolveTikTokTrafficOwnedMedia(userId: string, mediaId: string, kind: "video" | "image", dependencies?: TikTokTrafficServerDependencies): Promise<TikTokTrafficOwnedMedia> {
  const deps = dependencies || defaults();
  if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mediaId)) throw new TikTokTrafficPublisherError("owned_media_required");
  const row = await deps.readMedia(userId, mediaId);
  if (!row || row.is_active !== true || row.media_type !== kind) throw new TikTokTrafficPublisherError("owned_media_unavailable");
  const bucket = String(row.bucket_name || ""), path = String(row.storage_path || "");
  const limit = kind === "video" ? TIKTOK_TRAFFIC_MAX_VIDEO_BYTES : TIKTOK_TRAFFIC_MAX_IMAGE_BYTES;
  if (bucket !== "inrcy-pro-media" || !path.startsWith(`users/${userId}/`) || path.includes("..") || path.includes("\\") || path.length > 1024
    || !Number.isSafeInteger(Number(row.size_bytes)) || Number(row.size_bytes) <= 0 || Number(row.size_bytes) > limit) throw new TikTokTrafficPublisherError("media_invalid");
  const blob = await deps.downloadMedia(bucket, path);
  if (!blob || !blob.size || blob.size > limit || blob.size !== Number(row.size_bytes)) throw new TikTokTrafficPublisherError("media_invalid");
  const bytes = Buffer.from(await blob.arrayBuffer());
  let width = Number(row.width), height = Number(row.height);
  const contentType = String(row.mime_type || blob.type).split(";", 1)[0].toLowerCase();
  if (kind === "video") {
    if (contentType !== "video/mp4" || bytes.length < 12 || bytes.toString("ascii", 4, 8) !== "ftyp") throw new TikTokTrafficPublisherError("media_mp4_required");
    // Native video/info subsequently verifies dimensions and duration from the actual file.
  } else {
    const meta = await sharp(bytes, { failOn: "error", limitInputPixels: 40_000_000 }).metadata().catch(() => null);
    const detected = meta?.format === "jpeg" ? "image/jpeg" : meta?.format === "png" ? "image/png" : "";
    if (!detected || detected !== contentType || Number(meta?.pages || 1) !== 1) throw new TikTokTrafficPublisherError("media_image_invalid");
    width = Number(meta?.width); height = Number(meta?.height);
  }
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 540 || height < 960 || width * 16 !== height * 9) throw new TikTokTrafficPublisherError("media_vertical_required");
  let storageOrigin: URL;
  try {
    storageOrigin = new URL(deps.storageOrigin);
    if (storageOrigin.protocol !== "https:" || storageOrigin.username || storageOrigin.password || storageOrigin.port
      || !storageOrigin.hostname.endsWith(".supabase.co") || storageOrigin.pathname !== "/") throw new Error();
  } catch { throw new TikTokTrafficPublisherError("storage_origin_unverified"); }
  const signed = await deps.signMedia(bucket, path, 3600);
  let url: URL;
  try {
    url = new URL(signed || "");
    const expectedPath = `/storage/v1/object/sign/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;
    if (url.origin !== storageOrigin.origin || url.username || url.password || url.hash || url.pathname !== expectedPath || !url.searchParams.get("token")) throw new Error();
  } catch { throw new TikTokTrafficPublisherError("media_signed_url_invalid"); }
  // The signing helper can reuse a cached URL; derive expiry from the actual capability.
  let expiresAt = NaN;
  try {
    const payload = JSON.parse(Buffer.from(url.searchParams.get("token")!.split(".")[1], "base64url").toString("utf8"));
    expiresAt = Number(object(payload).exp) * 1000;
  } catch { /* A capability with unknown expiry cannot be safely sent to TikTok. */ }
  if (!Number.isFinite(expiresAt) || expiresAt < deps.now() + 300_000) throw new TikTokTrafficPublisherError("media_url_expired");
  return { id: mediaId, kind, url: url.toString(), allowedOrigin: storageOrigin.origin, expiresAt: new Date(expiresAt).toISOString(), contentType, sizeBytes: bytes.length, width, height, signature: createHash("md5").update(bytes).digest("hex") };
}
export type TikTokTrafficCheckpointStore = Pick<TikTokTrafficDependencies, "loadCheckpoint" | "saveCheckpoint" | "withOperationLock"> & {
  campaignId: string; expectedTimeZone: string | null; expectedIntegrationFingerprint?: string; expectedAppId?: string;
  assertCampaignOwnership: () => Promise<void>; assertNativeCapabilities?: () => Promise<void>;
};
/** A future server integration receives private transport closures, never a client token.
 * Every action rechecks both integration stability and the provider's advertiser ownership.
 * This factory does not grant write permissions and is not attached to any publication route.
 */
export async function createTikTokTrafficPublisherDependencies(userId: string, advertiserId: string, store: TikTokTrafficCheckpointStore, dependencies?: TikTokTrafficServerDependencies): Promise<TikTokTrafficDependencies> {
  const deps = dependencies || defaults();
  if (!userId || !/^\d{5,30}$/.test(advertiserId) || !/^\d{5,30}$/.test(deps.appId) || !deps.secret) throw new TikTokTrafficPublisherError("configuration_missing");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(store.campaignId) || typeof store.assertCampaignOwnership !== "function") throw new TikTokTrafficPublisherError("campaign_ownership_required");
  if (!store.expectedTimeZone) throw new TikTokTrafficPublisherError("timezone_unverified");
  if (store.expectedAppId && store.expectedAppId !== deps.appId) throw new TikTokTrafficPublisherError("application_changed");
  const initial = await deps.readIntegration(userId);
  if (!initial || initial.status !== "connected" || initial.resource_id !== advertiserId || !initial.access_token_enc) throw new TikTokTrafficPublisherError("advertiser_mismatch");
  if (store.expectedIntegrationFingerprint && createHash("sha256").update(rowKey(initial)).digest("hex") !== store.expectedIntegrationFingerprint) throw new TikTokTrafficPublisherError("integration_changed");
  const longLived = object(initial.meta).token_lifecycle === "long_lived" && !initial.expires_at && !initial.refresh_token_enc;
  if (!longLived && !tikTokAdsAccessTokenIsFresh(initial.expires_at, deps.now())) throw new TikTokTrafficPublisherError("token_expired");
  let token: string;
  try { token = deps.decrypt(initial.access_token_enc); } catch { throw new TikTokTrafficPublisherError("token_unavailable"); }
  if (!token) throw new TikTokTrafficPublisherError("token_unavailable");
  async function sameIntegration() {
    const current = await deps.readIntegration(userId);
    if (!current || rowKey(current) !== rowKey(initial!)) throw new TikTokTrafficPublisherError("integration_changed");
    if (!longLived && !tikTokAdsAccessTokenIsFresh(current.expires_at, deps.now())) throw new TikTokTrafficPublisherError("token_expired");
  }
  async function read(path: string, params: URLSearchParams) {
    await sameIntegration();
    let response: Response;
    try { response = await deps.fetchImpl(`${TIKTOK_TRAFFIC_API_BASE}/${path}/?${params}`, { method: "GET", headers: { "Access-Token": token, Accept: "application/json" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) }); }
    catch { throw new TikTokTrafficPublisherError("ownership_read_failed"); }
    const payload = object(await response.json().catch(() => null));
    if (!response.ok || payload.code !== 0) throw new TikTokTrafficPublisherError("ownership_read_failed");
    await sameIntegration();
    return payload;
  }
  async function assertOwnership() {
    await store.assertCampaignOwnership();
    if (store.assertNativeCapabilities) await store.assertNativeCapabilities();
    const granted = await read("oauth2/advertiser/get", new URLSearchParams({ app_id: deps.appId, secret: deps.secret }));
    if (!parseTikTokAdvertiserIds(granted).includes(advertiserId)) throw new TikTokTrafficPublisherError("advertiser_not_authorized");
    const response = await read("advertiser/info", new URLSearchParams({ advertiser_ids: JSON.stringify([advertiserId]) }));
    const account = parseTikTokAdsResourceAccount(response, advertiserId);
    if (!account || account.currency !== "EUR" || account.status !== "STATUS_ENABLE" || !account.timezone) throw new TikTokTrafficPublisherError("account_not_active_eur");
    if (account.timezone !== store.expectedTimeZone) throw new TikTokTrafficPublisherError("account_timezone_changed");
  }
  await assertOwnership();
  return { ...store, fetchImpl: deps.fetchImpl, accessToken: token, now: deps.now, assertOwnership,
    resolveOwnedMedia: (id, kind) => resolveTikTokTrafficOwnedMedia(userId, id, kind, deps) };
}
export type TikTokAdsPublisherOptions = {
  campaignId: string; operationKey: string; initialProgress?: TikTokTrafficCheckpoint;
  assertCampaignOwnership: () => Promise<void>;
  withOperationLock: TikTokTrafficDependencies["withOperationLock"];
  serverDependencies?: TikTokTrafficServerDependencies;
  preparationDependencies?: TikTokCampaignPreparationDependencies;
  expectedPreparationKey?: string;
};
/** Callable bridge: its default-closed flag stops before any read/write. An enabled flag grants no rights.
 * The caller must verify ads_campaigns.id/user_id/provider/status and persist each checkpoint
 * to that exact row's server-only provider_resources under a durable exclusive claim.
 */
export async function publishTikTokAdsCampaign(userId: string, draft: TikTokTrafficCampaignDraft, persistProgress: (progress: TikTokTrafficCheckpoint) => Promise<void>, options: TikTokAdsPublisherOptions): Promise<TikTokTrafficCheckpoint> {
  if (!tikTokAdsPausedCreationEnabled(options.preparationDependencies?.environment || process.env)) throw new TikTokTrafficPublisherError("native_creation_disabled");
  await options.assertCampaignOwnership();
  const prepared = await prepareTikTokAdsCampaignForPublication(userId, draft, options.preparationDependencies, Boolean(options.initialProgress));
  if (options.expectedPreparationKey && options.expectedPreparationKey !== prepared.preparation.preparationKey) throw new TikTokTrafficPublisherError("preparation_changed");
  if (!prepared.preparation.ready || !prepared.input || !prepared.nativeEvidence || !prepared.scope) throw new TikTokTrafficPublisherError("native_preparation_blocked");
  const input = prepared.input;
  let progress = options.initialProgress || null;
  const store: TikTokTrafficCheckpointStore = { campaignId: options.campaignId, expectedTimeZone: prepared.nativeEvidence.timeZone, expectedIntegrationFingerprint: prepared.scope.integrationFingerprint, expectedAppId: prepared.scope.appId,
    assertCampaignOwnership: options.assertCampaignOwnership, assertNativeCapabilities: prepared.assertCurrentCapability,
    withOperationLock: options.withOperationLock, loadCheckpoint: async () => progress,
    saveCheckpoint: async (next) => { await persistProgress(next); progress = structuredClone(next); } };
  const deps = await createTikTokTrafficPublisherDependencies(userId, input.advertiserId, store, options.serverDependencies);
  return runTikTokPausedTrafficVideo(input, prepared.nativeEvidence, options.operationKey, deps);
}
/** @deprecated Use publishTikTokAdsCampaign with an owned campaign checkpoint/store.
 * This legacy signature cannot establish campaign ownership or persist mutation checkpoints,
 * so it remains blocked even when the paused-creation flag is enabled.
 */
export async function publishTikTokPausedTrafficVideo(_userId: string, _input: TikTokTrafficVideoInput): Promise<TikTokTrafficCheckpoint> {
  void _userId; void _input;
  if (!tikTokAdsPausedCreationEnabled(process.env)) throw new TikTokTrafficPublisherError("native_creation_disabled");
  throw new TikTokTrafficPublisherError("route_integration_unavailable");
}

export type TikTokAdsReadbackOptions = {
  campaignId: string; assertCampaignOwnership: () => Promise<void>;
  serverDependencies?: TikTokTrafficServerDependencies; resourcesDependencies?: TikTokAdsResourceDependencies;
};
/** Native reconciliation is available with the creation flag closed. No upload or mutation is used. */
export async function readTikTokAdsPausedCampaign(userId: string, draft: TikTokTrafficCampaignDraft, checkpoint: TikTokTrafficCheckpoint, options: TikTokAdsReadbackOptions): Promise<TikTokPausedHierarchyReadback> {
  await options.assertCampaignOwnership();
  const parsed = normalizeTikTokAdsNativeSelections(draft.tiktokNativeSelections);
  if (parsed.error || !tikTokAdsNativeSelectionsComplete(parsed.selections) || parsed.selections.advertiserId !== draft.adAccountId) throw new TikTokTrafficPublisherError("native_selections_invalid");
  const selected = parsed.selections, ctx = await readTikTokTrafficCampaignContext(userId, draft.adAccountId, options.resourcesDependencies);
  const identity = ctx.resources.identities.find((entry) => entry.id === selected.identity.id && entry.type === selected.identity.type && (entry.authorizedBusinessCenterId || "") === (selected.identity.authorizedBusinessCenterId || ""));
  if (!identity || selected.locationIds.some((id) => !ctx.locations.some((target) => target.id === id))) throw new TikTokTrafficPublisherError("native_selections_changed");
  const input = tikTokTrafficInputFromAdsDraft(draft, { identity, locationIds: selected.locationIds, callToAction: selected.callToAction, thumbnailMediaId: selected.thumbnailMediaId, isAiGenerated: selected.isAiGenerated });
  const deps = await createTikTokTrafficPublisherDependencies(userId, draft.adAccountId, { campaignId: options.campaignId, expectedTimeZone: ctx.resources.account.timezone,
    expectedIntegrationFingerprint: ctx.scope.integrationFingerprint, expectedAppId: ctx.scope.appId, assertCampaignOwnership: options.assertCampaignOwnership,
    loadCheckpoint: async () => checkpoint, saveCheckpoint: async () => { throw new TikTokTrafficPublisherError("read_only_operation"); }, withOperationLock: async (_key, action) => action() }, options.serverDependencies);
  return readTikTokPausedTrafficHierarchy(input, checkpoint, checkpoint.operationKey, deps);
}
