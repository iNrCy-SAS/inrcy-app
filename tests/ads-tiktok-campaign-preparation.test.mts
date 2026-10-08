import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import ts from "typescript";
import sharp from "sharp";
import * as accountPolicy from "../lib/adsTikTokPolicy.ts";
import * as resourcesPolicy from "../lib/adsTikTokResources.ts";
import * as selectionsPolicy from "../lib/adsTikTokNativeSelections.ts";
import * as publicationPolicy from "../lib/adsTikTokPublicationPolicy.ts";
import * as campaignInput from "../lib/adsTikTokCampaignInput.ts";
import * as core from "../lib/adsTikTokPublisherCore.ts";
import * as preparedSettings from "../lib/adsPreparedCampaignSettings.ts";
import type { TikTokCampaignPreparationDependencies, TikTokTrafficCapabilityEvidence, TikTokTrafficCapabilityScope } from "../lib/adsTikTokCampaignPreparationServer.ts";
type ResourcesServer = typeof import("../lib/adsTikTokResourcesServer.ts");
type PreparationServer = typeof import("../lib/adsTikTokCampaignPreparationServer.ts");
type PublisherServer = typeof import("../lib/adsTikTokPublisherServer.ts");
class ConnectionError extends Error { code: string; status: number; constructor(message: string, code: string, status = 503) { super(message); this.code = code; this.status = status; } }
const accountId = "1234567890123", now = Date.parse("2026-10-08T10:00:00Z"), campaignId = "c906f397-f729-43a4-8c1f-6d2a6c18c061";
const videoId = "d195aa0d-d97a-4857-8d39-830863bfa210", thumbnailMediaId = "d195aa0d-d97a-4857-8d39-830863bfa211";
function load<T>(file: string, modules: Map<string, unknown>): T {
  const output = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} as T };
  new Function("module", "exports", "require", output)(loaded, loaded.exports, (name: string) => { assert.ok(modules.has(name), name); return modules.get(name); });
  return loaded.exports;
}
function draft(): campaignInput.TikTokTrafficCampaignDraft {
  return { provider: "tiktok", accountCurrency: "EUR", adAccountId: accountId, name: "Campagne test", primaryText: "Découvrez iNrCy", destinationUrl: "https://inrcy.com/", trackingParameters: "utm_source=tiktok&utm_medium=paid_social", languages: ["fr"], keywords: [], negativeKeywords: [], creativeType: "video", mediaStrategy: "video", creativeUrl: `/api/media-library/items/${videoId}/content?token=private-fixture`,
    channelSettings: { schemaVersion: 1, channel: "tiktok", objectiveType: "TRAFFIC", destinationKind: "website", optimizationIntent: "clicks", placementIntent: "tiktok_only", targetingMode: "broad", format: "video" },
    preparedDeliverySettings: { budget: { type: "total", totalEuros: 200, startAt: "2026-10-09T07:00:00Z", endAt: "2026-10-11T21:59:00Z" }, bidding: { strategy: "automatic", amountEuros: null } },
    tiktokNativeSelections: { schemaVersion: 1, advertiserId: accountId, context: structuredClone(resourcesPolicy.TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT), identity: { id: "native-profile", type: "TT_USER" }, locationIds: ["250", "59123"], callToAction: "LEARN_MORE", thumbnailMediaId, isAiGenerated: true } } as unknown as campaignInput.TikTokTrafficCampaignDraft;
}
function capabilities(scope: TikTokTrafficCapabilityScope): TikTokTrafficCapabilityEvidence {
  const budget = draft().preparedDeliverySettings!.budget;
  return { scope, manualTrafficV13: "verified", nativeWriteAccess: "verified", videoUpload: "verified", imageUpload: "verified", mediaRead: "verified", objectRead: "verified", callToActions: ["LEARN_MORE"], allowedNonSparkIdentityTypes: ["TT_USER"], minimumLifetimeBudgetEuros: 100, budgetCalendar: { startAt: budget.startAt!, endAt: budget.endAt! }, scheduleTimeBasis: "utc", scheduleOffsetMinutes: null, verifiedAt: new Date(now - 1000).toISOString(), validUntil: new Date(now + 60_000).toISOString() };
}
function fixture(options: { enabled?: boolean; proof?: "verified" | "missing"; patchProof?: (record: TikTokTrafficCapabilityEvidence) => TikTokTrafficCapabilityEvidence; drift?: boolean } = {}) {
  const calls: string[] = [];
  let reads = 0, proofReads = 0;
  const integration = { id: "integration", status: "connected", resource_id: accountId, resource_label: "Compte", access_token_enc: "private-cipher", refresh_token_enc: null, expires_at: null, meta: { token_lifecycle: "long_lived" } };
  const modules = new Map<string, unknown>([["server-only", {}], ["node:crypto", { createHash }], ["./oauthCrypto.ts", {}], ["./adsTikTokServer.ts", { TikTokAdsConnectionError: ConnectionError }], ["./adsTikTokPolicy.ts", accountPolicy], ["./adsTikTokResources.ts", resourcesPolicy], ["./adsTikTokNativeSelections.ts", selectionsPolicy], ["./adsTikTokPublicationPolicy.ts", publicationPolicy], ["./adsTikTokCampaignInput.ts", campaignInput], ["./adsTikTokPublisherCore.ts", core]]);
  const resources = load<ResourcesServer>("../lib/adsTikTokResourcesServer.ts", modules);
  modules.set("./adsTikTokResourcesServer.ts", resources);
  modules.set("./adsPreparedCampaignSettings.ts", preparedSettings);
  modules.set("./adsTikTokCapabilityEvidenceServer.ts", load<typeof import("../lib/adsTikTokCapabilityEvidenceServer.ts")>("../lib/adsTikTokCapabilityEvidenceServer.ts", modules));
  modules.set("./supabaseAdmin.ts", { supabaseAdmin: new Proxy({}, { get() { throw new Error("Unexpected database read/write"); } }) });
  modules.set("./adsTikTokSourceMediaServer.ts", load<typeof import("../lib/adsTikTokSourceMediaServer.ts")>("../lib/adsTikTokSourceMediaServer.ts", modules));
  modules.set("./adsTikTokCampaignStore.ts", { readPreparedAdsStoreAvailability: async () => false });
  const preparation = load<PreparationServer>("../lib/adsTikTokCampaignPreparationServer.ts", modules);
  modules.set("./adsTikTokCampaignPreparationServer.ts", preparation); modules.set("sharp", sharp); modules.set("./safeStorageSignedUrl.ts", {});
  modules.set("./supabaseAdmin.ts", { supabaseAdmin: new Proxy({}, { get() { throw new Error("Unexpected database read/write"); } }) });
  const publisher = load<PublisherServer>("../lib/adsTikTokPublisherServer.ts", modules);
  const dependencies: TikTokCampaignPreparationDependencies = {
    readStoreAvailability: async () => true,
    environment: options.enabled ? { TIKTOK_ADS_PAUSED_CREATION_ENABLED: "true" } : {},
    resources: { appId: "1234567890", secret: "private-secret", now: () => now,
      readIntegration: async (owner) => { assert.equal(owner, "owner"); reads++; return options.drift && reads >= 10 ? { ...integration, access_token_enc: "changed" } : integration; }, decrypt: () => "private-token",
      fetchImpl: (async (request, init) => {
        const url = new URL(String(request)), path = url.pathname.replace("/open_api/v1.3/", ""); calls.push(path);
        assert.equal(init?.method, "GET"); assert.equal(init?.body, undefined); assert.equal(init?.redirect, "error");
        if (path === "oauth2/advertiser/get/") return Response.json({ code: 0, data: { advertiser_ids: [accountId] } });
        if (path === "advertiser/info/") return Response.json({ code: 0, data: { list: [{ advertiser_id: accountId, name: "Compte natif", currency: "EUR", status: "STATUS_ENABLE", timezone: "Europe/Paris" }] } });
        if (path === "identity/get/") return Response.json({ code: 0, data: { identity_list: [{ identity_id: "native-profile", identity_type: "TT_USER", display_name: "Profil natif" }], page_info: { total_page: 1 } } });
        if (path === "tool/region/") return Response.json({ code: 0, data: { region_info: [
          { location_id: "250", parent_id: "0", name: "France", level: "COUNTRY", region_code: "FR", area_type: "ADMIN" },
          { location_id: "3200", parent_id: "250", name: "Hauts-de-France", level: "PROVINCE", region_code: "FR", area_type: "ADMIN" },
          { location_id: "59123", parent_id: "3200", name: "Lille", level: "CITY", region_code: "FR", area_type: "ADMIN" },
        ] } });
        throw new Error("Unexpected provider mutation or endpoint " + path);
      }) as typeof fetch },
    readCapabilityEvidence: async (scope) => { proofReads++; const record = capabilities(scope); return options.proof === "verified" ? options.patchProof ? options.patchProof(record) : record : null; },
    readOwnedSourceMedia: async (owner, ids) => { assert.equal(owner, "owner"); assert.deepEqual(ids, [videoId, thumbnailMediaId]); return ids.map((id) => ({ id, media_type: id === videoId ? "video" : "image", mime_type: id === videoId ? "video/mp4" : "image/png", size_bytes: 100, width: 540, height: 960, bucket_name: "inrcy-pro-media", storage_path: `users/owner/${id}`, is_active: true })); },
  };
  return { preparation, publisher, dependencies, calls, proofReads: () => proofReads };
}

test("Complete TikTok selections are freshly native-verified while unknown capabilities remain blocked", async () => {
  const f = fixture(), result = await f.preparation.checkTikTokAdsCampaignPreparation("owner", draft(), f.dependencies);
  assert.equal(result.preparationReady, true); assert.equal(result.ready, false); assert.equal(result.publicationEnabled, false); assert.equal(result.targetStatus, "DISABLE");
  assert.equal(result.selectedIdentity?.displayName, "Profil natif"); assert.deepEqual(result.verifiedLocations.map((target) => target.id), ["250", "59123"]);
  assert.equal(result.consentKey, result.preparationKey); assert.match(result.consentKey, /^[0-9a-f]{64}$/);
  assert.ok(result.blockers.includes("native_capabilities_unverified")); assert.ok(result.blockers.includes("paused_creation_disabled"));
  assert.doesNotMatch(JSON.stringify(result), /private-|cipher|nativeEvidence|integrationFingerprint|accessToken|allowedNonSparkIdentityTypes/);
  assert.deepEqual(f.calls, ["oauth2/advertiser/get/", "advertiser/info/", "identity/get/", "tool/region/"]);
});
test("Enabling the paused adapter never replaces a missing native capability proof", async () => {
  const f = fixture({ enabled: true }), result = await f.preparation.checkTikTokAdsCampaignPreparation("owner", draft(), f.dependencies);
  assert.equal(result.pausedCreationEnabled, true); assert.equal(result.nativeProofReady, false); assert.equal(result.ready, false);
  let persisted = 0;
  await assert.rejects(f.publisher.publishTikTokAdsCampaign("owner", draft(), async () => { persisted++; }, { campaignId, operationKey: "operation_test_fixture", assertCampaignOwnership: async () => {}, withOperationLock: async (_key, action) => action(), preparationDependencies: f.dependencies }), /native_preparation_blocked/);
  assert.equal(persisted, 0); assert.ok(f.calls.every((path) => !/create|upload|update/.test(path)));
});
test("Fixture server-only proof can prepare suspended creation without claiming active publication", async () => {
  const f = fixture({ enabled: true, proof: "verified" }), result = await f.preparation.checkTikTokAdsCampaignPreparation("owner", draft(), f.dependencies);
  assert.equal(result.ready, true); assert.equal(result.nativeProofReady, true); assert.equal(result.publicationEnabled, false);
  assert.deepEqual(result.blockers, []); assert.deepEqual(result.effectiveDelivery, { budgetMode: "total", totalEuros: 200, startAt: "2026-10-09T07:00:00Z", endAt: "2026-10-11T21:59:00Z", currency: "EUR", targetStatus: "DISABLE" });
});
test("Capability proof from another app, token snapshot, account, context or expired interval cannot authorize creation", async () => {
  for (const patchProof of [
    (value: TikTokTrafficCapabilityEvidence) => ({ ...value, scope: { ...value.scope, appId: "9999999999" } }),
    (value: TikTokTrafficCapabilityEvidence) => ({ ...value, scope: { ...value.scope, integrationFingerprint: "a".repeat(64) } }),
    (value: TikTokTrafficCapabilityEvidence) => ({ ...value, scope: { ...value.scope, advertiserId: "9876543210" } }),
    (value: TikTokTrafficCapabilityEvidence) => ({ ...value, validUntil: new Date(now - 1).toISOString() }),
    (value: TikTokTrafficCapabilityEvidence) => ({ ...value, verifiedAt: new Date(now - 600_000).toISOString() }),
    (value: TikTokTrafficCapabilityEvidence) => ({ ...value, validUntil: new Date(now + 3600_000).toISOString() }),
  ]) {
    const f = fixture({ enabled: true, proof: "verified", patchProof }), result = await f.preparation.checkTikTokAdsCampaignPreparation("owner", draft(), f.dependencies);
    assert.equal(result.ready, false); assert.ok(result.blockers.includes("native_capability_snapshot_invalid"));
  }
});
test("Native minimum/calendar, CTA, identity type and API clock must all be proven independently", async () => {
  for (const patchProof of [
    (value: TikTokTrafficCapabilityEvidence) => ({ ...value, nativeWriteAccess: "unverified" as const }),
    (value: TikTokTrafficCapabilityEvidence) => ({ ...value, minimumLifetimeBudgetEuros: null }),
    (value: TikTokTrafficCapabilityEvidence) => ({ ...value, budgetCalendar: null }),
    (value: TikTokTrafficCapabilityEvidence) => ({ ...value, scheduleTimeBasis: null }),
    (value: TikTokTrafficCapabilityEvidence) => ({ ...value, callToActions: [] }),
    (value: TikTokTrafficCapabilityEvidence) => ({ ...value, allowedNonSparkIdentityTypes: [] }),
  ]) {
    const f = fixture({ enabled: true, proof: "verified", patchProof });
    assert.equal((await f.preparation.checkTikTokAdsCampaignPreparation("owner", draft(), f.dependencies)).ready, false);
  }
});
test("Incomplete AIGC, unknown identity and unavailable locations never become verified by defaults", async () => {
  const original = draft();
  for (const patch of [{ isAiGenerated: null }, { identity: { id: "other-profile", type: "TT_USER" as const } }, { locationIds: ["99999"] }, { thumbnailMediaId: null }]) {
    const f = fixture({ enabled: true, proof: "verified" }), result = await f.preparation.checkTikTokAdsCampaignPreparation("owner", { ...original, tiktokNativeSelections: { ...original.tiktokNativeSelections!, ...patch } }, f.dependencies);
    assert.equal(result.ready, false); assert.equal(result.preparationReady, false);
  }
});
test("Consent binds effective spend, calendar, destination, creative and explicit native choices", async () => {
  const f = fixture({ enabled: true, proof: "verified" }), original = draft(), key = (await f.preparation.checkTikTokAdsCampaignPreparation("owner", original, f.dependencies)).consentKey;
  const reordered = { ...original, tiktokNativeSelections: { ...original.tiktokNativeSelections!, locationIds: ["59123", "250"] } };
  assert.equal((await f.preparation.checkTikTokAdsCampaignPreparation("owner", reordered, f.dependencies)).consentKey, key);
  for (const changed of [{ ...original, destinationUrl: "https://inrcy.com/inscription/" }, { ...original, primaryText: "Autre texte" }, { ...original, preparedDeliverySettings: { ...original.preparedDeliverySettings!, budget: { ...original.preparedDeliverySettings!.budget, totalEuros: 201 } } }, { ...original, tiktokNativeSelections: { ...original.tiktokNativeSelections!, isAiGenerated: false } }]) {
    assert.notEqual((await f.preparation.checkTikTokAdsCampaignPreparation("owner", changed, f.dependencies)).consentKey, key);
  }
});
test("Publisher rechecks the validated preparation key before any native mutation or checkpoint", async () => {
  const f = fixture({ enabled: true, proof: "verified" }); let persisted = 0;
  await assert.rejects(f.publisher.publishTikTokAdsCampaign("owner", draft(), async () => { persisted++; }, { campaignId, operationKey: "operation_test_fixture", assertCampaignOwnership: async () => {}, withOperationLock: async (_key, action) => action(), preparationDependencies: f.dependencies, expectedPreparationKey: "0".repeat(64) }), /preparation_changed/);
  assert.equal(persisted, 0); assert.ok(f.calls.every((path) => !/create|upload|update/.test(path)));
});
test("Preparation rejects token/integration drift and capability revocation before the next action", async () => {
  const drift = fixture({ enabled: true, proof: "verified", drift: true });
  await assert.rejects(drift.preparation.checkTikTokAdsCampaignPreparation("owner", draft(), drift.dependencies), /changé/);
  const f = fixture({ enabled: true, proof: "verified" }), prepared = await f.preparation.prepareTikTokAdsCampaignForPublication("owner", draft(), f.dependencies);
  f.dependencies.readCapabilityEvidence = async () => null;
  await assert.rejects(prepared.assertCurrentCapability(), /native_capabilities_changed/);
});

test("Only a server-validated durable checkpoint can relax a past start when resuming", async () => {
  const f = fixture({ enabled: true, proof: "verified" }), original = draft();
  const past = { ...original, preparedDeliverySettings: { ...original.preparedDeliverySettings!, budget: { ...original.preparedDeliverySettings!.budget, startAt: "2026-10-08T07:00:00Z" } } };
  f.dependencies.readCapabilityEvidence = async (scope) => ({ ...capabilities(scope), budgetCalendar: { startAt: past.preparedDeliverySettings.budget.startAt!, endAt: past.preparedDeliverySettings.budget.endAt! } });
  assert.equal((await f.preparation.checkTikTokAdsCampaignPreparation("owner", past, f.dependencies)).ready, false);
  assert.equal((await f.preparation.checkTikTokAdsCampaignPreparation("owner", past, { ...f.dependencies, resumed: true })).ready, true);
});

function providerRoute(options: { denied?: boolean; limited?: boolean; invalid?: boolean } = {}) {
  const calls: unknown[][] = [];
  const modules = new Map<string, unknown>([
    ["next/server", { NextResponse: { json: Response.json } }],
    ["@/lib/adsServer", { requirePremiumAdsUser: async (channel: string) => { assert.equal(channel, "tiktok"); return options.denied ? { user: null, errorResponse: new Response("Denied", { status: 403 }) } : { user: { activeUserId: "owner" } }; } }],
    ["@/lib/rateLimit", { enforceRateLimit: async (input: { identifier: string }) => { assert.equal(input.identifier, "owner"); return options.limited ? new Response("Limited", { status: 429 }) : null; } }],
    ["@/lib/adsTikTokServer", { TikTokAdsConnectionError: ConnectionError }], ["@/lib/adsTikTokResources", resourcesPolicy], ["@/lib/adsTikTokResourcesServer", {}],
    ["@/lib/adsTikTokPublisherCore", core], ["@/lib/adsValidation", { parseAdsCampaignInput: (value: unknown, input: { purpose: string }) => { assert.equal(input.purpose, "draft"); return options.invalid ? { draft: null, error: "Invalid fixture" } : { draft: value, error: null }; } }],
    ["@/lib/adsTikTokCampaignPreparationServer", { checkTikTokAdsCampaignPreparation: async (...args: unknown[]) => { calls.push(args); return { ready: false, publicationEnabled: false, consentKey: "fixture-consent", blockers: ["native_capabilities_unverified"] }; } }],
  ]);
  return { calls, api: load<{ POST: (request: Request) => Promise<Response> }>("../app/api/ads/tiktok/preflight/route.ts", modules) };
}
test("TikTok full-draft POST preflight is owner-scoped, rate limited and never accepts proof/options", async () => {
  const request = (body: string) => new Request("https://local.test/api/ads/tiktok/preflight", { method: "POST", headers: { "Content-Type": "application/json" }, body });
  for (const [options, status] of [[{ denied: true }, 403], [{ limited: true }, 429], [{ invalid: true }, 400]] as const) {
    const f = providerRoute(options), result = await f.api.POST(request(JSON.stringify({ draft: draft() })));
    assert.equal(result.status, status); assert.equal(f.calls.length, 0);
  }
  for (const raw of ["invalid JSON", "x".repeat(65_537), JSON.stringify({ draft: draft(), nativeEvidence: { nativeWriteAccess: "verified" } }), JSON.stringify({ draft: draft(), resumed: true }), JSON.stringify({ draft: { ...draft(), provider: "google" } })]) {
    const f = providerRoute(), result = await f.api.POST(request(raw)); assert.equal(result.status, 400); assert.equal(f.calls.length, 0);
  }
  const f = providerRoute(), result = await f.api.POST(request(JSON.stringify({ draft: draft() })));
  assert.equal(result.status, 200); assert.equal(result.headers.get("Cache-Control"), "no-store"); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][0], "owner"); assert.deepEqual(f.calls[0][1], draft()); assert.equal(f.calls[0].length, 2);
  assert.deepEqual(await result.json(), { ready: false, publicationEnabled: false, consentKey: "fixture-consent", blockers: ["native_capabilities_unverified"] });
});

test("Server bridge can create, resume and reconcile one disabled hierarchy using fixture-only native proof", async () => {
  const f = fixture({ enabled: true, proof: "verified" }), original = draft(), resourceDependencies = f.dependencies.resources!;
  const videoBytes = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0]);
  const imageBytes = await sharp({ create: { width: 540, height: 960, channels: 3, background: "#111111" } }).png().toBuffer();
  const nativeIds = { campaign: "11111111", adgroup: "22222222", ad: "33333333" }, writes: Array<{ path: string; body: unknown }> = [];
  const fetchImpl = (async (request, init) => {
    const path = new URL(String(request)).pathname.replace("/open_api/v1.3/", "").replace(/\/$/, "");
    if (init?.method === "POST") {
      const body = init.body instanceof FormData ? Object.fromEntries(init.body.entries()) : JSON.parse(String(init.body));
      writes.push({ path, body });
      if (path === "file/video/ad/upload") return Response.json({ code: 0, data: { video_id: "native-video" } });
      if (path === "file/image/ad/upload") return Response.json({ code: 0, data: { image_id: "native-image" } });
      if (path === "campaign/create") return Response.json({ code: 0, data: { campaign_id: nativeIds.campaign } });
      if (path === "adgroup/create") return Response.json({ code: 0, data: { adgroup_id: nativeIds.adgroup } });
      if (path === "ad/create") return Response.json({ code: 0, data: { ad_ids: [nativeIds.ad] } });
      throw new Error("Unexpected write " + path);
    }
    if (path === "file/video/ad/info") return Response.json({ code: 0, data: { list: [{ video_id: "native-video", displayable: true, format: "mp4", width: 540, height: 960, duration: 32,
      size: videoBytes.length, signature: createHash("md5").update(videoBytes).digest("hex"), allowed_placements: ["PLACEMENT_TIKTOK"] }] } });
    if (path === "file/image/ad/info") return Response.json({ code: 0, data: { list: [{ image_id: "native-image", width: 540, height: 960 }] } });
    for (const kind of ["campaign", "adgroup", "ad"] as const) if (path === `${kind}/get`) return Response.json({ code: 0, data: { list: [{ [`${kind}_id`]: nativeIds[kind], advertiser_id: accountId, operation_status: "DISABLE",
      ...(kind === "adgroup" ? { campaign_id: nativeIds.campaign } : kind === "ad" ? { adgroup_id: nativeIds.adgroup } : {}) }] } });
    return resourceDependencies.fetchImpl(request, init);
  }) as typeof fetch;
  const token = `fixture.${Buffer.from(JSON.stringify({ exp: now / 1000 + 3600 })).toString("base64url")}.signature`;
  const serverDependencies: import("../lib/adsTikTokPublisherServer.ts").TikTokTrafficServerDependencies = { ...resourceDependencies, fetchImpl, storageOrigin: "https://fixture.supabase.co",
    readMedia: async (owner, requested) => { assert.equal(owner, "owner"); assert.ok([videoId, thumbnailMediaId].includes(requested)); const image = requested === thumbnailMediaId;
      return { bucket_name: "inrcy-pro-media", storage_path: `users/owner/${requested}.${image ? "png" : "mp4"}`, media_type: image ? "image" : "video", mime_type: image ? "image/png" : "video/mp4", size_bytes: image ? imageBytes.length : videoBytes.length, width: 540, height: 960, is_active: true }; },
    downloadMedia: async (_bucket, path) => new Blob([path.endsWith("png") ? imageBytes : videoBytes], { type: path.endsWith("png") ? "image/png" : "video/mp4" }),
    signMedia: async (bucket, path) => `https://fixture.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=${token}` };
  f.dependencies.readOwnedSourceMedia = async (owner, ids) => Promise.all(ids.map(async (id) => ({ ...(await serverDependencies.readMedia(owner, id))!, id })));
  const expectedPreparationKey = (await f.preparation.checkTikTokAdsCampaignPreparation("owner", original, f.dependencies)).preparationKey;
  const checkpoints: core.TikTokTrafficCheckpoint[] = [];
  let ownerReads = 0;
  const options: Parameters<PublisherServer["publishTikTokAdsCampaign"]>[3] = { campaignId, operationKey: "operation_test_fixture", assertCampaignOwnership: async () => { ownerReads++; },
    withOperationLock: async (_key, action) => action(), preparationDependencies: f.dependencies, serverDependencies, expectedPreparationKey };
  const result = await f.publisher.publishTikTokAdsCampaign("owner", original, async (value) => { checkpoints.push(structuredClone(value)); }, options);
  assert.equal(result.stage, "paused_verified"); assert.equal(result.targetStatus, "DISABLE"); assert.ok(ownerReads > 1);
  assert.deepEqual(writes.map((write) => write.path), ["file/video/ad/upload", "file/image/ad/upload", "campaign/create", "adgroup/create", "ad/create"]);
  const campaign = writes[2].body as Record<string, unknown>, group = writes[3].body as Record<string, unknown>, ad = writes[4].body as { creatives: Array<Record<string, unknown>> };
  assert.equal(campaign.operation_status, "DISABLE"); assert.equal(group.operation_status, "DISABLE"); assert.equal(ad.creatives[0].operation_status, "DISABLE"); assert.equal(group.budget, 200);
  assert.doesNotMatch(JSON.stringify(checkpoints), /supabase\.co|private-|accessToken|signature=/);
  const resumed = await f.publisher.publishTikTokAdsCampaign("owner", original, async (value) => { checkpoints.push(structuredClone(value)); }, { ...options, initialProgress: result });
  assert.equal(resumed.stage, "paused_verified"); assert.equal(writes.length, 5);
  const readback = await f.publisher.readTikTokAdsPausedCampaign("owner", original, result, { campaignId, assertCampaignOwnership: options.assertCampaignOwnership, serverDependencies, resourcesDependencies: resourceDependencies });
  assert.equal(readback.confirmed, true); assert.equal(writes.length, 5);
});

test("A valid capability snapshot never makes unavailable or changed source media ready", async () => {
  const f = fixture({ enabled: true, proof: "verified" });
  f.dependencies.readOwnedSourceMedia = async () => [];
  const missing = await f.preparation.checkTikTokAdsCampaignPreparation("owner", draft(), f.dependencies);
  assert.equal(missing.ready, false); assert.ok(missing.blockers.includes("owned_source_media_unavailable"));
});

test("Store availability is server-only and missing migration stops before native reads", async () => {
  for (const readStoreAvailability of [undefined, async () => false, async () => { throw new Error("Missing RPC"); }]) {
    const f = fixture({ enabled: true, proof: "verified" });
    f.dependencies.readStoreAvailability = readStoreAvailability;
    const result = await f.preparation.checkTikTokAdsCampaignPreparation("owner", draft(), f.dependencies);
    assert.equal(result.ready, false); assert.equal(result.preparationReady, false); assert.equal(result.nativeProofReady, false);
    assert.deepEqual(result.blockers, ["campaign_store_migration_required"]); assert.equal(f.calls.length, 0); assert.equal(f.proofReads(), 0);
    assert.doesNotMatch(JSON.stringify(result), /private-|nativeEvidence|integrationFingerprint/);
  }
  // The closure keeps the server-owned availability reader and catches a later failed check.
  const reader = fixture({ enabled: true, proof: "verified" }); let available = true;
  reader.dependencies.readStoreAvailability = async () => available;
  const bound = await reader.preparation.prepareTikTokAdsCampaignForPublication("owner", draft(), reader.dependencies);
  assert.equal(bound.preparation.ready, true); available = false;
  await assert.rejects(bound.assertCurrentCapability(), (error: unknown) => error instanceof core.TikTokTrafficPublisherError && error.code === "campaign_store_migration_required");
});

test("Owned-source metadata cannot point outside the user storage prefix or change after consent", async () => {
  for (const patch of [{ storage_path: "users/other/foreign.mp4" }, { bucket_name: "other-bucket" }, { size_bytes: NaN }, { width: 960, height: 540 }]) {
    const f = fixture({ enabled: true, proof: "verified" }), originalReader = f.dependencies.readOwnedSourceMedia!;
    f.dependencies.readOwnedSourceMedia = async (...args) => (await originalReader(...args)).map((row) => ({ ...row, ...patch }));
    const result = await f.preparation.checkTikTokAdsCampaignPreparation("owner", draft(), f.dependencies);
    assert.equal(result.ready, false); assert.ok(result.blockers.includes("owned_source_media_unavailable"));
  }
  const f = fixture({ enabled: true, proof: "verified" }), prepared = await f.preparation.prepareTikTokAdsCampaignForPublication("owner", draft(), f.dependencies);
  f.dependencies.readOwnedSourceMedia = async () => [];
  await assert.rejects(prepared.assertCurrentCapability(), (error: unknown) => error instanceof core.TikTokTrafficPublisherError && error.code === "source_media_changed");
});
