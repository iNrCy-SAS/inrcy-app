import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isAdsChannelPublishEnabled } from "../lib/adsPublishMode.ts";
import { isAdsDraftAccountChannel, parseAdsCampaignInput } from "../lib/adsValidation.ts";
import {
  TIKTOK_TRAFFIC_NATIVE_CREATION_ENABLED,
  TikTokTrafficPublisherError,
  prepareTikTokTrafficNativeBodies,
  runTikTokPausedTrafficVideo,
  tikTokTrafficInputKey,
  type TikTokTrafficCheckpoint,
  type TikTokTrafficDependencies,
  type TikTokTrafficNativeEvidence,
  type TikTokTrafficOwnedMedia,
  type TikTokTrafficVideoInput,
} from "../lib/adsTikTokPublisherCore.ts";

// All provider capabilities below are explicit test evidence. They do not
// represent an application grant, a live advertiser, or a documented EUR floor.
const now = Date.parse("2026-10-08T10:00:00Z");
const advertiserId = "1234567890123456789";
const operationKey = "paused_traffic_contract_operation_1";
const input: TikTokTrafficVideoInput = {
  advertiserId, name: "Campagne test Traffic", adGroupName: "Groupe test Traffic", adName: "Vidéo test Traffic",
  destinationUrl: "https://example.com/offre?utm_source=tiktok", adText: "Découvrir l’offre", callToAction: "LEARN_MORE",
  totalBudgetEuros: 200, startAt: "2026-10-09T07:00:00Z", endAt: "2026-10-14T21:59:59Z",
  identity: { id: "native-identity", type: "CUSTOMIZED_USER", displayName: "Annonceur test" }, locationIds: ["3012822"],
  videoMediaId: "06dd9f9a-213f-4c55-9a70-23e9d0c5c7dc", thumbnailMediaId: "175665c1-5941-4b09-8107-6a3b2117f3da", isAiGenerated: true,
};
const evidence: TikTokTrafficNativeEvidence = {
  advertiserId, currency: "EUR", status: "STATUS_ENABLE", timeZone: "Europe/Paris",
  identity: input.identity, locationIds: input.locationIds, callToActions: ["LEARN_MORE"], allowedNonSparkIdentityTypes: ["CUSTOMIZED_USER"],
  manualTrafficV13: "verified", nativeWriteAccess: "verified", videoUpload: "verified", imageUpload: "verified", mediaRead: "verified", objectRead: "verified",
  minimumLifetimeBudgetEuros: 100, scheduleTimeBasis: "utc",
  scheduleOffsetMinutes: null, budgetCalendar: { startAt: input.startAt, endAt: input.endAt },
  verifiedAt: "2026-10-08T09:59:00Z", validUntil: "2026-10-08T10:10:00Z",
};
type ProviderCall = { path: string; method: string; body: Record<string, unknown> | FormData | null; params: URLSearchParams };
type HarnessOptions = {
  evidence?: Partial<TikTokTrafficNativeEvidence>; source?: Partial<TikTokTrafficOwnedMedia>; video?: Record<string, unknown>;
  pauseMismatch?: "campaign" | "adgroup" | "ad"; wrongParent?: boolean; finalCampaignEnabled?: boolean;
  mutationFailure?: { path: string; transport?: boolean; unsafeId?: boolean }; previous?: TikTokTrafficCheckpoint;
  ownershipFailureAfter?: number;
};
function harness(options: HarnessOptions = {}) {
  const calls: ProviderCall[] = [], checkpoints: TikTokTrafficCheckpoint[] = [];
  let current = options.previous ? structuredClone(options.previous) : null, ownerReads = 0, campaignReads = 0;
  const source = (mediaId: string, kind: "video" | "image"): TikTokTrafficOwnedMedia => ({
    id: mediaId, kind, url: `https://fixture.supabase.co/storage/v1/object/sign/owned/${mediaId}?token=private-signed-media-token`,
    expiresAt: "2026-10-08T11:00:00Z", allowedOrigin: "https://fixture.supabase.co", contentType: kind === "video" ? "video/mp4" : "image/jpeg",
    sizeBytes: kind === "video" ? 2_000_000 : 100_000, width: 1080, height: 1920, signature: "1".repeat(32), ...options.source,
  });
  const deps: TikTokTrafficDependencies = {
    accessToken: "private-provider-access-token", now: () => now,
    assertOwnership: async () => { ownerReads++; if (options.ownershipFailureAfter && ownerReads >= options.ownershipFailureAfter) throw new Error("Account ownership changed"); },
    resolveOwnedMedia: async (mediaId, kind) => source(mediaId, kind),
    loadCheckpoint: async () => current ? structuredClone(current) : null,
    saveCheckpoint: async (checkpoint) => { checkpoints.push(structuredClone(checkpoint)); current = structuredClone(checkpoint); },
    withOperationLock: async (key, action) => { assert.equal(key, operationKey); return action(); },
    fetchImpl: (async (request, init) => {
      const url = new URL(String(request)), path = url.pathname.replace("/open_api/v1.3/", "").replace(/\/$/, "");
      assert.equal(url.origin, "https://business-api.tiktok.com");
      assert.equal(new Headers(init?.headers).get("Access-Token"), "private-provider-access-token");
      assert.equal(init?.redirect, "error");
      const method = init?.method || "GET";
      const body = init?.body instanceof FormData ? init.body : typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null;
      calls.push({ path, method, body, params: url.searchParams });
      assert.ok(!path.includes("status/update") && !path.includes("smart_plus") && !path.includes("identity/create"), `Unexpected write boundary: ${path}`);
      if (method === "POST") {
        assert.ok(current?.pendingStep, "The durable checkpoint must precede every provider mutation");
        if (options.mutationFailure?.path === path) {
          if (options.mutationFailure.transport) throw new Error("Response lost after provider submission");
          if (options.mutationFailure.unsafeId) return Response.json({ code: 0, data: { campaign_id: 1234567890123456789 } });
          return Response.json({ code: 40002, message: "private-provider-access-token", data: { campaign_id: "9911111111111111111" } });
        }
        if (path === "file/video/ad/upload") {
          assert.ok(body instanceof FormData); assert.equal(body.get("advertiser_id"), advertiserId); assert.equal(body.get("upload_type"), "UPLOAD_BY_URL");
          return Response.json({ code: 0, data: { video_id: "native-video" } });
        }
        if (path === "file/image/ad/upload") return Response.json({ code: 0, data: { image_id: "native/image" } });
        if (path === "campaign/create") return Response.json({ code: 0, data: { campaign_id: "9911111111111111111" } });
        if (path === "adgroup/create") return Response.json({ code: 0, data: { adgroup_id: "9922222222222222222" } });
        if (path === "ad/create") return Response.json({ code: 0, data: { ad_ids: ["9933333333333333333"] } });
      }
      if (path === "file/video/ad/info") return Response.json({ code: 0, data: { list: [{
        video_id: "native-video", format: "mp4", displayable: true, width: 1080, height: 1920, duration: 30, size: 2_000_000,
        allowed_placements: ["PLACEMENT_TIKTOK"], signature: "1".repeat(32), ...options.video,
      }] } });
      if (path === "file/image/ad/info") return Response.json({ code: 0, data: { list: [{ image_id: "native/image", width: 1080, height: 1920 }] } });
      for (const kind of ["campaign", "adgroup", "ad"] as const) {
        if (path === `${kind}/get`) {
          const nativeId = kind === "campaign" ? "9911111111111111111" : kind === "adgroup" ? "9922222222222222222" : "9933333333333333333";
          if (kind === "campaign") campaignReads++;
          assert.equal(url.searchParams.get("advertiser_id"), advertiserId);
          assert.deepEqual(JSON.parse(url.searchParams.get("filtering")!), { [`${kind}_ids`]: [nativeId] });
          return Response.json({ code: 0, data: { list: [{
            [`${kind}_id`]: nativeId, advertiser_id: advertiserId,
            operation_status: options.pauseMismatch === kind || options.finalCampaignEnabled && kind === "campaign" && campaignReads > 1 ? "ENABLE" : "DISABLE",
            ...(kind === "adgroup" ? { campaign_id: options.wrongParent ? "9900000000000000000" : "9911111111111111111" } : kind === "ad" ? { adgroup_id: "9922222222222222222" } : {}),
          }] } });
        }
      }
      throw new Error(`Unexpected provider endpoint: ${path}`);
    }) as typeof fetch,
  };
  return { deps, calls, checkpoints, checkpoint: () => current, run: (draft = input) => runTikTokPausedTrafficVideo(draft, { ...evidence, ...options.evidence }, operationKey, deps) };
}
const writes = (calls: ProviderCall[]) => calls.filter((call) => call.method === "POST");
const objectWrites = (calls: ProviderCall[]) => writes(calls).filter((call) => /^(?:campaign|adgroup|ad)\/create$/.test(call.path));
function rejectsCode(code: string) { return (error: unknown) => error instanceof TikTokTrafficPublisherError && error.code === code; }

test("TikTok Traffic adapter stays dormant and all three native creation payloads explicitly disable delivery", () => {
  assert.equal(TIKTOK_TRAFFIC_NATIVE_CREATION_ENABLED, false);
  const bodies = prepareTikTokTrafficNativeBodies(input, evidence);
  assert.equal(bodies.campaign.operation_status, "DISABLE"); assert.equal(bodies.adGroup.operation_status, "DISABLE"); assert.equal(bodies.creative.operation_status, "DISABLE");
  assert.equal(bodies.campaign.budget_optimize_on, false); assert.equal(bodies.campaign.budget_mode, "BUDGET_MODE_INFINITE");
  assert.equal(bodies.adGroup.budget_mode, "BUDGET_MODE_TOTAL"); assert.equal(bodies.adGroup.budget, 200);
  assert.equal(bodies.adGroup.optimization_goal, "CLICK"); assert.equal(bodies.adGroup.billing_event, "CPC"); assert.equal(bodies.adGroup.bid_type, "BID_TYPE_NO_BID");
  assert.deepEqual(bodies.adGroup.placements, ["PLACEMENT_TIKTOK"]); assert.deepEqual(bodies.adGroup.location_ids, input.locationIds);
  assert.equal(bodies.creative.landing_page_url, input.destinationUrl); assert.equal(bodies.creative.aigc_disclosure_type, "SELF_DISCLOSURE");
  assert.ok(!("pixel_id" in bodies.adGroup) && !("budget" in bodies.campaign));
});

test("Unverified write, identity, geography, media, and read capabilities prevent every provider mutation", async () => {
  for (const capability of ["manualTrafficV13", "nativeWriteAccess", "videoUpload", "imageUpload", "mediaRead", "objectRead"] as const) {
    const h = harness({ evidence: { [capability]: "unverified" } });
    await assert.rejects(h.run(), rejectsCode(`${capability}_unverified`)); assert.equal(writes(h.calls).length, 0);
  }
  for (const [patch, expected] of [
    [{ allowedNonSparkIdentityTypes: [] }, "identity_unverified"], [{ locationIds: [] }, "location_unverified"],
    [{ currency: "USD" }, "account_not_active_eur"], [{ advertiserId: "1234567890000000000" }, "advertiser_mismatch"],
    [{ validUntil: "2026-10-08T09:00:00Z" }, "native_evidence_expired"],
    [{ minimumLifetimeBudgetEuros: null }, "minimum_budget_unverified"], [{ scheduleTimeBasis: null }, "schedule_time_basis_unverified"],
    [{ budgetCalendar: null }, "minimum_budget_calendar_unverified"],
    [{ budgetCalendar: { startAt: input.startAt, endAt: "2026-10-15T21:59:59Z" } }, "minimum_budget_calendar_unverified"],
    [{ scheduleTimeBasis: "advertiser", scheduleOffsetMinutes: null }, "schedule_offset_unverified"],
  ] as Array<[Partial<TikTokTrafficNativeEvidence>, string]>) {
    const h = harness({ evidence: patch }); await assert.rejects(h.run(), rejectsCode(expected)); assert.equal(writes(h.calls).length, 0);
  }
});

test("A native currency-specific minimum never increases or converts the requested total budget", async () => {
  const h = harness({ evidence: { minimumLifetimeBudgetEuros: 201 } });
  await assert.rejects(h.run(), rejectsCode("total_budget_below_native_minimum")); assert.equal(writes(h.calls).length, 0);
  const accepted = harness();
  await accepted.run({ ...input, totalBudgetEuros: 100 });
  const group = objectWrites(accepted.calls).find((call) => call.path === "adgroup/create")!.body as Record<string, unknown>;
  assert.equal(group.budget, 100); assert.equal(group.budget_mode, "BUDGET_MODE_TOTAL");
});

test("Schedule conversion follows explicitly verified API time basis instead of inferring it from the user timezone", () => {
  const utc = prepareTikTokTrafficNativeBodies(input, evidence).adGroup;
  assert.equal(utc.schedule_start_time, "2026-10-09 07:00:00"); assert.equal(utc.schedule_end_time, "2026-10-14 21:59:59");
  const fixedAdvertiser = prepareTikTokTrafficNativeBodies(input, { ...evidence, scheduleTimeBasis: "advertiser", scheduleOffsetMinutes: 120 }).adGroup;
  assert.equal(fixedAdvertiser.schedule_start_time, "2026-10-09 09:00:00"); assert.equal(fixedAdvertiser.schedule_end_time, "2026-10-14 23:59:59");
  assert.throws(() => prepareTikTokTrafficNativeBodies(input, { ...evidence, scheduleTimeBasis: null }), rejectsCode("schedule_time_basis_unverified"));
});

test("A nonexistent civil date is rejected before any mutation rather than rolled into another day", async () => {
  const invalid = { ...input, startAt: "2026-11-31T10:00:00Z", endAt: "2026-12-02T10:00:00Z" };
  const h = harness({ evidence: { budgetCalendar: { startAt: invalid.startAt, endAt: invalid.endAt } } });
  await assert.rejects(h.run(invalid), rejectsCode("schedule_invalid")); assert.equal(writes(h.calls).length, 0);
});

test("Other channel grants and general paid-publication flags never unlock dormant TikTok publication", () => {
  const flags = {
    INRCY_ADS_LIVE_PUBLISH_ENABLED: "true", INRCY_ADS_DEMO_PAUSED_PUBLISH_ENABLED: "true",
    INRCY_LINKEDIN_ADS_PUBLISH_ENABLED: "true", INRCY_TIKTOK_ADS_PUBLISH_ENABLED: "true",
  };
  for (const mode of ["live", "paused", "demo_paused"] as const) assert.equal(isAdsChannelPublishEnabled("tiktok", mode, flags), false);
});

test("TikTok is rejected at the generic publication parser and account-channel boundaries", () => {
  assert.equal(isAdsDraftAccountChannel("tiktok"), false);
  const result = parseAdsCampaignInput({ provider: "tiktok", adAccountId: advertiserId, accountCurrency: "EUR" }, { purpose: "publish" });
  assert.equal(result.draft, null); assert.match(result.error || "", /publication.*pas encore disponibles/);
});

test("The generic paid route retains its publication guards before claiming a local campaign and never calls dormant TikTok creation", () => {
  const route = readFileSync(new URL("../app/api/ads/campaigns/[id]/publish/route.ts", import.meta.url), "utf8");
  const post = route.slice(route.indexOf("export async function POST"));
  const claim = post.indexOf('supabaseAdmin.rpc("inrcy_claim_ads_draft_for_publish"');
  assert.ok(claim > 0);
  for (const guard of ['parseAdsCampaignInput(stored.draft, { purpose: "publish" })', "isAdsDraftAccountChannel(draft.provider)", "isAdsChannelPublishEnabled(draft.provider, mode, process.env)"]) {
    const position = post.indexOf(guard); assert.ok(position >= 0 && position < claim, guard);
  }
  assert.doesNotMatch(route, /publishTikTok(?:AdsCampaign|PausedTrafficVideo)\s*\(/);
});

test("A paused hierarchy uses exact current native IDs and verifies all three disabled objects before completing", async () => {
  const h = harness(), result = await h.run();
  assert.equal(result.stage, "paused_verified"); assert.equal(result.targetStatus, "DISABLE");
  assert.deepEqual(writes(h.calls).map((call) => call.path), ["file/video/ad/upload", "file/image/ad/upload", "campaign/create", "adgroup/create", "ad/create"]);
  const objects = objectWrites(h.calls), group = objects[1].body as Record<string, unknown>, ad = objects[2].body as Record<string, unknown>;
  assert.equal(group.campaign_id, result.campaignId); assert.equal(ad.adgroup_id, result.adGroupId);
  const creative = (ad.creatives as Array<Record<string, unknown>>)[0];
  assert.equal(creative.video_id, result.videoId); assert.deepEqual(creative.image_ids, [result.imageId]); assert.equal(creative.identity_id, input.identity.id);
  assert.ok(objects.every((call) => call.path === "ad/create" ? (call.body as { creatives: Array<{ operation_status: string }> }).creatives.every((row) => row.operation_status === "DISABLE") : (call.body as { operation_status: string }).operation_status === "DISABLE"));
  assert.deepEqual(h.calls.slice(-3).map((call) => call.path), ["campaign/get", "adgroup/get", "ad/get"]);
  assert.equal(result.inputKey, tikTokTrafficInputKey(input));
  assert.ok(!JSON.stringify(h.checkpoints).includes("private-") && !JSON.stringify(h.checkpoints).includes("https://"));
});

test("Unsafe or unrelated source media is rejected before upload", async () => {
  for (const patch of [
    { id: input.thumbnailMediaId }, { allowedOrigin: "https://other.supabase.co" },
    { url: "https://fixture.supabase.co/storage/v1/object/public/owned/test.mp4" },
    { expiresAt: "2026-10-08T10:01:00Z" }, { contentType: "image/jpeg" }, { width: 1920, height: 1080 },
  ]) {
    const h = harness({ source: patch }); await assert.rejects(h.run(), TikTokTrafficPublisherError); assert.equal(writes(h.calls).length, 0);
  }
});

test("Native video validation rejects changed identity, dimensions, availability, duration and placement before hierarchy creation", async () => {
  for (const patch of [
    { video_id: "unrelated-video" }, { displayable: false }, { format: "mov" }, { width: 1920, height: 1080 },
    { duration: 61 }, { duration: "not-a-duration" }, { allowed_placements: ["PLACEMENT_PANGLE"] },
    { size: "not-a-size" }, { signature: "2".repeat(32) },
  ]) {
    const h = harness({ video: patch }); await assert.rejects(h.run(), rejectsCode("native_video_unavailable")); assert.equal(objectWrites(h.calls).length, 0);
  }
});

test("A changed owned source cannot replace media on resume, even with the same media library IDs", async () => {
  const first = harness(), previous = await first.run(), changed = harness({ previous, source: { signature: "2".repeat(32) } });
  await assert.rejects(changed.run(), rejectsCode("media_content_changed")); assert.equal(writes(changed.calls).length, 0);
  assert.deepEqual(changed.checkpoint(), previous);
});

test("Concurrent operation exclusion and current account ownership are checked before any mutation", async () => {
  const locked = harness();
  locked.deps.withOperationLock = async () => { throw new Error("Operation already held"); };
  await assert.rejects(locked.run(), /Operation already held/); assert.equal(writes(locked.calls).length, 0);
  const changed = harness({ ownershipFailureAfter: 1 });
  await assert.rejects(changed.run(), /Account ownership changed/); assert.equal(writes(changed.calls).length, 0);
});

test("A non-disabled campaign readback stops before ad group creation and preserves the campaign ID", async () => {
  const h = harness({ pauseMismatch: "campaign" }); await assert.rejects(h.run(), rejectsCode("paused_readback_mismatch"));
  assert.deepEqual(objectWrites(h.calls).map((call) => call.path), ["campaign/create"]);
  assert.equal(h.checkpoint()?.campaignId, "9911111111111111111"); assert.notEqual(h.checkpoint()?.stage, "paused_verified");
});

test("An ad group attached to another campaign is rejected before ad creation", async () => {
  const h = harness({ wrongParent: true }); await assert.rejects(h.run(), rejectsCode("paused_readback_mismatch"));
  assert.deepEqual(objectWrites(h.calls).map((call) => call.path), ["campaign/create", "adgroup/create"]);
  assert.ok(h.checkpoint()?.adGroupId); assert.equal(h.checkpoint()?.adId, undefined);
});

test("Final parent drift or an enabled ad cannot be presented as verified pause", async () => {
  for (const options of [{ finalCampaignEnabled: true }, { pauseMismatch: "ad" as const }]) {
    const h = harness(options); await assert.rejects(h.run(), rejectsCode("paused_readback_mismatch"));
    assert.equal(objectWrites(h.calls).length, 3); assert.ok(h.checkpoint()?.adId); assert.notEqual(h.checkpoint()?.stage, "paused_verified");
  }
});

test("An uncertain provider mutation is never replayed automatically, including HTTP 200 with nonzero API code", async () => {
  for (const failure of [
    { path: "campaign/create" }, { path: "campaign/create", transport: true }, { path: "campaign/create", unsafeId: true },
  ]) {
    const h = harness({ mutationFailure: failure }); await assert.rejects(h.run(), rejectsCode("mutation_outcome_unknown"));
    assert.equal(h.checkpoint()?.uncertainStep, "create_campaign"); const count = writes(h.calls).length;
    await assert.rejects(h.run(), rejectsCode("mutation_outcome_unknown")); assert.equal(writes(h.calls).length, count);
    assert.equal(objectWrites(h.calls).length, 1);
  }
});

test("A completed operation is read again without uploading or recreating paid objects", async () => {
  const first = harness(), result = await first.run(), resumed = harness({ previous: result });
  assert.equal((await resumed.run()).stage, "paused_verified"); assert.equal(writes(resumed.calls).length, 0);
  assert.ok(resumed.calls.some((call) => call.path === "file/video/ad/info"));
  assert.deepEqual(resumed.calls.slice(-3).map((call) => call.path), ["campaign/get", "adgroup/get", "ad/get"]);
});

test("Resuming a saved operation cannot substitute a new budget or destination", async () => {
  const first = harness(), previous = await first.run();
  for (const patch of [{ totalBudgetEuros: 201 }, { destinationUrl: "https://example.com/another-offer" }]) {
    const h = harness({ previous }); await assert.rejects(h.run({ ...input, ...patch }), rejectsCode("checkpoint_mismatch"));
    assert.equal(writes(h.calls).length, 0); assert.deepEqual(h.checkpoint(), previous);
  }
});
