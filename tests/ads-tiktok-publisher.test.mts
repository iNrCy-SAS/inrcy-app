import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import ts from "typescript";
import sharp from "sharp";
import * as core from "../lib/adsTikTokPublisherCore.ts";
import * as policy from "../lib/adsTikTokPolicy.ts";
import * as resources from "../lib/adsTikTokResources.ts";
import * as campaignInput from "../lib/adsTikTokCampaignInput.ts";
import * as publicationPolicy from "../lib/adsTikTokPublicationPolicy.ts";
import type { AdsCampaignInput } from "../lib/adsValidation.ts";
type Server = typeof import("../lib/adsTikTokPublisherServer.ts");
const accountId = "1234567890123", campaignId = "c906f397-f729-43a4-8c1f-6d2a6c18c061";
const videoId = "d195aa0d-d97a-4857-8d39-830863bfa210", imageId = "d195aa0d-d97a-4857-8d39-830863bfa211";
const now = Date.parse("2026-10-08T10:00:00Z");
function loadServer(): Server {
  const loaded = { exports: {} as Server };
  const modules = new Map<string, unknown>([
    ["server-only", {}], ["node:crypto", { createHash }], ["sharp", sharp],
    ["./supabaseAdmin.ts", { supabaseAdmin: new Proxy({}, { get() { throw new Error("Unexpected database access"); } }) }],
    ["./oauthCrypto.ts", {}], ["./safeStorageSignedUrl.ts", {}], ["./adsTikTokServer.ts", {}],
    ["./adsTikTokPolicy.ts", policy], ["./adsTikTokResources.ts", resources], ["./adsTikTokPublisherCore.ts", core],
    ["./adsTikTokCampaignInput.ts", campaignInput], ["./adsTikTokPublicationPolicy.ts", publicationPolicy],
    ["./adsTikTokCampaignPreparationServer.ts", {}], ["./adsTikTokNativeSelections.ts", {}], ["./adsTikTokResourcesServer.ts", {}],
  ]);
  const source = readFileSync(new URL("../lib/adsTikTokPublisherServer.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  new Function("module", "exports", "require", code)(loaded, loaded.exports, (name: string) => { assert.ok(modules.has(name), name); return modules.get(name); });
  return loaded.exports;
}
function nativeFixture() {
  const input: core.TikTokTrafficVideoInput = { advertiserId: accountId, name: "Essai Traffic vidéo", adGroupName: "Essai groupe", adName: "Essai annonce", destinationUrl: "https://inrcy.com/?utm_source=tiktok", adText: "Votre communication simplifiée", callToAction: "LEARN_MORE", totalBudgetEuros: 200, startAt: "2026-10-09T07:00:00Z", endAt: "2026-10-11T21:59:00Z", identity: { id: "native-identity", type: "TT_USER", displayName: "Identité" }, locationIds: ["1234567"], videoMediaId: videoId, thumbnailMediaId: imageId, isAiGenerated: true };
  const evidence: core.TikTokTrafficNativeEvidence = { advertiserId: accountId, currency: "EUR", status: "STATUS_ENABLE", timeZone: "Europe/Paris", identity: input.identity, locationIds: input.locationIds, callToActions: ["LEARN_MORE"], allowedNonSparkIdentityTypes: ["TT_USER"], manualTrafficV13: "verified", nativeWriteAccess: "verified", videoUpload: "verified", imageUpload: "verified", mediaRead: "verified", objectRead: "verified", verifiedAt: new Date(now - 1000).toISOString(), validUntil: new Date(now + 60_000).toISOString(), minimumLifetimeBudgetEuros: 100, budgetCalendar: { startAt: input.startAt, endAt: input.endAt }, scheduleTimeBasis: "utc", scheduleOffsetMinutes: null };
  return { input, evidence };
}
function serverFixture(options: { drift?: number; revoked?: boolean; currency?: string; status?: string; timezone?: string; expires?: string; providerError?: boolean } = {}) {
  let integrationReads = 0, campaignReads = 0;
  const calls: string[] = [];
  const integration = { id: "integration", status: "connected", resource_id: accountId, resource_label: "Ads", access_token_enc: "cipher", refresh_token_enc: null, expires_at: options.expires ?? null, meta: { token_lifecycle: options.expires ? "timed" : "long_lived" } };
  const dependencies: Parameters<Server["createTikTokTrafficPublisherDependencies"]>[3] = {
    readIntegration: async (userId) => { assert.equal(userId, "owner"); integrationReads++; return options.drift && integrationReads >= options.drift ? { ...integration, access_token_enc: "changed" } : { ...integration }; },
    decrypt: () => "fixture-private-token", appId: "123456789", secret: "fixture-private-secret", storageOrigin: "https://fixture.supabase.co", now: () => now,
    readMedia: async () => null, downloadMedia: async () => null, signMedia: async () => null,
    fetchImpl: (async (url, init) => {
      const parsed = new URL(String(url)); calls.push(parsed.pathname);
      assert.equal(parsed.origin, "https://business-api.tiktok.com"); assert.equal(init?.method, "GET");
      assert.equal(init?.redirect, "error"); assert.equal(init?.body, undefined);
      if (options.providerError) return Response.json({ code: 40001, message: "fixture-private-token fixture-private-secret" });
      if (parsed.pathname.endsWith("oauth2/advertiser/get/")) return Response.json({ code: 0, data: { advertiser_ids: options.revoked ? [] : [accountId] } });
      assert.ok(parsed.pathname.endsWith("advertiser/info/"));
      return Response.json({ code: 0, data: { list: [{ advertiser_id: accountId, currency: options.currency || "EUR", status: options.status || "STATUS_ENABLE", timezone: options.timezone || "Europe/Paris" }] } });
    }) as typeof fetch,
  };
  const store: Parameters<Server["createTikTokTrafficPublisherDependencies"]>[2] = {
    campaignId, expectedTimeZone: "Europe/Paris", assertCampaignOwnership: async () => { campaignReads++; },
    loadCheckpoint: async () => null, saveCheckpoint: async () => undefined,
    withOperationLock: async (_key, action) => action(),
  };
  return { dependencies, store, calls, integrationReads: () => integrationReads, campaignReads: () => campaignReads };
}
test("TikTok server factory rechecks stored integration and actual advertiser before each action", async () => {
  const fixture = serverFixture(), server = loadServer();
  const deps = await server.createTikTokTrafficPublisherDependencies("owner", accountId, fixture.store, fixture.dependencies);
  assert.equal(fixture.calls.length, 2); await deps.assertOwnership(); assert.equal(fixture.calls.length, 4);
  assert.equal(fixture.campaignReads(), 2); assert.ok(fixture.integrationReads() >= 9);
  assert.equal(core.TIKTOK_TRAFFIC_NATIVE_CREATION_ENABLED, false);
});
test("TikTok server factory rejects drift, expired tokens and native account changes without writes", async () => {
  for (const options of [{ drift: 3 }, { revoked: true }, { currency: "USD" }, { status: "STATUS_DISABLE" }, { timezone: "not-a-zone" }, { timezone: "UTC" }, { expires: "2026-10-08T09:00:00Z" }, { providerError: true }]) {
    const fixture = serverFixture(options);
    await assert.rejects(loadServer().createTikTokTrafficPublisherDependencies("owner", accountId, fixture.store, fixture.dependencies), (error: unknown) => error instanceof core.TikTokTrafficPublisherError && !/fixture-private/.test(error.message));
    assert.ok(fixture.calls.every((path) => !/create|upload|update/.test(path)));
  }
});
test("TikTok requires exact DB campaign ownership and scope before any provider read", async () => {
  const fixture = serverFixture();
  await assert.rejects(loadServer().createTikTokTrafficPublisherDependencies("owner", accountId, { ...fixture.store, campaignId: "unsafe" }, fixture.dependencies), /campaign_ownership_required/);
  await assert.rejects(loadServer().createTikTokTrafficPublisherDependencies("owner", accountId, { ...fixture.store, assertCampaignOwnership: async () => { throw new Error("not owner"); } }, fixture.dependencies), /not owner/);
  assert.equal(fixture.calls.length, 0);
});
test("TikTok native schedule requires verified basis and uses fixed account offset, including winter", () => {
  const { input, evidence } = nativeFixture();
  assert.throws(() => core.validateTikTokTrafficVideoInput(input, { ...evidence, scheduleTimeBasis: null }, now), /schedule_time_basis_unverified/);
  assert.throws(() => core.validateTikTokTrafficVideoInput(input, { ...evidence, scheduleTimeBasis: "advertiser", scheduleOffsetMinutes: null }, now), /schedule_offset_unverified/);
  assert.equal(core.prepareTikTokTrafficNativeBodies(input, evidence).adGroup.schedule_start_time, "2026-10-09 07:00:00");
  const winter = { ...input, startAt: "2026-11-01T07:00:00Z", endAt: "2026-11-03T07:00:00Z" };
  assert.equal(core.prepareTikTokTrafficNativeBodies(winter, { ...evidence, scheduleTimeBasis: "advertiser", scheduleOffsetMinutes: 120 }).adGroup.schedule_start_time, "2026-11-01 09:00:00");
});
test("TikTok does not invent currency/calendar-specific minimums or silently raise budget", () => {
  const { input, evidence } = nativeFixture();
  for (const minimum of [null, 0, NaN]) assert.throws(() => core.validateTikTokTrafficVideoInput(input, { ...evidence, minimumLifetimeBudgetEuros: minimum }, now), /minimum_budget_unverified/);
  assert.throws(() => core.validateTikTokTrafficVideoInput(input, { ...evidence, budgetCalendar: null }, now), /minimum_budget_calendar_unverified/);
  assert.throws(() => core.validateTikTokTrafficVideoInput({ ...input, totalBudgetEuros: 1 }, evidence, now), /total_budget_below_native_minimum/);
  assert.equal(input.totalBudgetEuros, 200);
});
test("TikTok production entry points remain closed before any transport or persistence", async () => {
  const server = loadServer(), { input } = nativeFixture();
  await assert.rejects(server.publishTikTokPausedTrafficVideo("owner", input), /native_creation_disabled/);
  let persisted = 0;
  await assert.rejects(server.publishTikTokAdsCampaign("owner", {} as AdsCampaignInput, async () => { persisted++; }, {} as Parameters<Server["publishTikTokAdsCampaign"]>[3]), /native_creation_disabled/);
  assert.equal(persisted, 0);
});
async function mediaFixture(options: { absent?: boolean; wrongKind?: boolean; inactive?: boolean; badHeader?: boolean; externalSigned?: boolean; expired?: boolean; badPath?: boolean } = {}) {
  const fixture = serverFixture();
  const bytes = options.badHeader ? Buffer.from("this is not an MP4") : Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0]);
  const row = { bucket_name: "inrcy-pro-media", storage_path: options.badPath ? "../escape.mp4" : `users/owner/${videoId}.mp4`, media_type: options.wrongKind ? "image" : "video", mime_type: "video/mp4", size_bytes: bytes.length, width: 1080, height: 1920, is_active: !options.inactive };
  const token = `fixture.${Buffer.from(JSON.stringify({ exp: Math.floor((now + (options.expired ? -1000 : 3600_000)) / 1000) })).toString("base64url")}.signature`;
  const dependencies = { ...fixture.dependencies!, readMedia: async (owner: string, requestedId: string) => { assert.equal(owner, "owner"); assert.equal(requestedId, videoId); return options.absent ? null : row; }, downloadMedia: async () => new Blob([bytes], { type: "video/mp4" }), signMedia: async () => `https://${options.externalSigned ? "third-party.example" : "fixture.supabase.co"}/storage/v1/object/sign/${row.bucket_name}/${row.storage_path}?token=${token}` };
  return { dependencies, bytes };
}
test("TikTok resolves only owned MP4 bytes into an exact private storage capability", async () => {
  const fixture = await mediaFixture();
  const result = await loadServer().resolveTikTokTrafficOwnedMedia("owner", videoId, "video", fixture.dependencies);
  assert.equal(result.allowedOrigin, "https://fixture.supabase.co"); assert.equal(result.signature, createHash("md5").update(fixture.bytes).digest("hex"));
  assert.equal(result.width, 1080); assert.equal(result.height, 1920);
});
test("TikTok media rejects another owner, unavailable bytes, header spoofing, expired or external URLs", async () => {
  for (const options of [{ absent: true }, { wrongKind: true }, { inactive: true }, { badHeader: true }, { externalSigned: true }, { expired: true }, { badPath: true }]) {
    const fixture = await mediaFixture(options);
    await assert.rejects(loadServer().resolveTikTokTrafficOwnedMedia("owner", videoId, "video", fixture.dependencies), core.TikTokTrafficPublisherError);
  }
});
test("TikTok thumbnail is inspected from real image bytes with strict 9:16 scope", async () => {
  const fixture = serverFixture(), bytes = await sharp({ create: { width: 540, height: 960, channels: 3, background: "#111111" } }).png().toBuffer();
  const token = `fixture.${Buffer.from(JSON.stringify({ exp: now / 1000 + 3600 })).toString("base64url")}.signature`;
  const deps = { ...fixture.dependencies!, readMedia: async () => ({ bucket_name: "inrcy-pro-media", storage_path: `users/owner/${imageId}.png`, media_type: "image", mime_type: "image/png", size_bytes: bytes.length, width: 1, height: 1, is_active: true }), downloadMedia: async () => new Blob([bytes], { type: "image/png" }), signMedia: async () => `https://fixture.supabase.co/storage/v1/object/sign/inrcy-pro-media/users/owner/${imageId}.png?token=${token}` };
  const result = await loadServer().resolveTikTokTrafficOwnedMedia("owner", imageId, "image", deps);
  assert.equal(result.width, 540); assert.equal(result.height, 960); assert.equal(result.contentType, "image/png");
});
function draftFixture(): AdsCampaignInput {
  return { provider: "tiktok", accountCurrency: "EUR", adAccountId: accountId, name: "Essai campagne", destinationUrl: "https://inrcy.com/", trackingParameters: "utm_source=tiktok&utm_medium=paid_social", primaryText: "Découvrez iNrCy", creativeUrl: `/api/media-library/items/${videoId}/content?token=fixture`, creativeType: "video", mediaStrategy: "video", languages: [], keywords: [], negativeKeywords: [],
    channelSettings: { schemaVersion: 1, channel: "tiktok", objectiveType: "TRAFFIC", destinationKind: "website", optimizationIntent: "clicks", placementIntent: "tiktok_only", targetingMode: "broad", format: "video" },
    preparedDeliverySettings: { budget: { type: "total", totalEuros: 200, startAt: "2026-10-09T07:00:00Z", endAt: "2026-10-11T21:59:00Z" }, bidding: { strategy: "automatic", amountEuros: null } },
  } as unknown as AdsCampaignInput;
}
test("TikTok maps exact supported wizard settings and preserves UTM without trusting AI IDs", () => {
  const { input } = nativeFixture(), draft = draftFixture();
  const selections = { identity: input.identity, locationIds: input.locationIds, callToAction: input.callToAction, thumbnailMediaId: imageId, isAiGenerated: true };
  const result = loadServer().tikTokTrafficInputFromAdsDraft(draft, selections);
  assert.equal(result.totalBudgetEuros, 200); assert.equal(result.videoMediaId, videoId);
  assert.equal(new URL(result.destinationUrl).searchParams.get("utm_source"), "tiktok");
  assert.equal(loadServer().tikTokTrafficInputFromAdsDraft({ ...draft, languages: ["fr"] }, selections).advertiserId, accountId);
  assert.throws(() => loadServer().tikTokTrafficInputFromAdsDraft({ ...draft, keywords: ["marketing"] }, selections), /additional_targeting_unsupported/);
  assert.throws(() => loadServer().tikTokTrafficInputFromAdsDraft({ ...draft, creativeUrl: "https://external.example/video.mp4" }, selections), /owned_media_required/);
  assert.throws(() => loadServer().tikTokTrafficInputFromAdsDraft({ ...draft, preparedDeliverySettings: { ...draft.preparedDeliverySettings!, budget: { ...draft.preparedDeliverySettings!.budget, type: "daily", totalEuros: null } } }, selections), /delivery_not_supported/);
});

test("TikTok accepts actual short numeric region identifiers without inventing targeting", () => {
  const { input, evidence } = nativeFixture();
  core.validateTikTokTrafficVideoInput({ ...input, locationIds: ["250"] }, { ...evidence, locationIds: ["250"] }, now);
  assert.throws(() => core.validateTikTokTrafficVideoFields({ ...input, locationIds: ["0"] }, now), /location_unverified/);
});

test("TikTok reconciliation reads exact native parents and disabled delivery without any mutation", async () => {
  const { input } = nativeFixture();
  const checkpoint: core.TikTokTrafficCheckpoint = { schemaVersion: 1, operationKey: "operation_fixture_123", advertiserId: accountId, inputKey: core.tikTokTrafficInputKey(input), targetStatus: "DISABLE", stage: "paused_verified",
    videoId: "video-native", imageId: "image-native", videoSignature: "a".repeat(32), imageSignature: "b".repeat(32), campaignId: "11111111", adGroupId: "22222222", adId: "33333333" };
  for (const mismatch of [false, true]) {
    const calls: string[] = [];
    const result = await core.readTikTokPausedTrafficHierarchy(input, checkpoint, checkpoint.operationKey, { accessToken: "fixture-private", assertOwnership: async () => {}, fetchImpl: (async (request, init) => {
      const url = new URL(String(request)), kind = url.pathname.split("/").at(-3)!;
      calls.push(kind); assert.equal(init?.method, "GET"); assert.equal(init?.body, undefined); assert.equal(init?.redirect, "error");
      const nativeId = kind === "campaign" ? checkpoint.campaignId : kind === "adgroup" ? checkpoint.adGroupId : checkpoint.adId;
      return Response.json({ code: 0, data: { list: [{ [`${kind}_id`]: nativeId, advertiser_id: accountId, operation_status: mismatch && kind === "ad" ? "ENABLE" : "DISABLE",
        ...(kind === "adgroup" ? { campaign_id: checkpoint.campaignId } : kind === "ad" ? { adgroup_id: checkpoint.adGroupId } : {}) }] } });
    }) as typeof fetch });
    assert.equal(result.confirmed, !mismatch); assert.equal(result.targetStatus, "DISABLE");
    assert.deepEqual(calls, ["campaign", "adgroup", "ad"]);
  }
  let read = false;
  const uncertain = await core.readTikTokPausedTrafficHierarchy(input, { ...checkpoint, uncertainStep: "create_ad" }, checkpoint.operationKey, { accessToken: "fixture-private", assertOwnership: async () => {}, fetchImpl: (async () => { read = true; throw new Error(); }) as typeof fetch });
  assert.equal(uncertain.confirmed, false); assert.equal(uncertain.reason, "mutation_outcome_unknown"); assert.equal(read, false);
});
