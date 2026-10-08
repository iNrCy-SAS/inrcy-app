import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as settings from "../lib/adsLinkedInCampaignSettings.ts";
import * as policy from "../lib/adsLinkedInPolicy.ts";
import * as preflight from "../lib/adsLinkedInPreflightPolicy.ts";
import * as publish from "../lib/adsLinkedInPublish.ts";
import * as core from "../lib/adsLinkedInPublisherCore.ts";
import * as geo from "../lib/adsLinkedInGeoResolution.ts";
import * as video from "../lib/adsLinkedInVideo.ts";
import * as briefs from "../lib/adsChannelDrafts.ts";
import { parseAdsCampaignInput, type AdsCampaignInput } from "../lib/adsValidation.ts";

const now = Date.now();
const accountId = "12345";
const organization = "urn:li:organization:789";
const operationKey = "linkedin:native-isolated-test";

function nativeSettings(): settings.LinkedInDeliverySettings {
  const value = settings.defaultLinkedInDeliverySettings();
  value.professionalTargeting = {
    include: [{ facet: "skills", urn: "urn:li:skill:501", name: "Marketing" }, { facet: "industries", urn: "urn:li:industry:9", name: "Services" }],
    exclude: [{ facet: "skills", urn: "urn:li:skill:17", name: "Excluded skill" }],
  };
  value.locationType = "permanent";
  value.placements = { audienceExpansion: true, audienceNetwork: true };
  value.budget = { type: "total", totalEuros: 200, startAt: new Date(now + 3_600_000).toISOString(), endAt: new Date(now + 7 * 86_400_000).toISOString() };
  value.bidding = { strategy: "maximum_delivery", amountEuros: null };
  value.callToAction = "SIGN_UP";
  value.conversions = { conversionUrns: ["urn:lla:llaPartnerConversion:100"] };
  return value;
}

function rawDraft(media: "image" | "video" = "image", objectiveType = "WEBSITE_VISIT") {
  return {
    provider: "linkedin", creationMode: "manual", campaignType: "generic", objective: "website_traffic", conversionGoal: "website_visit", conversionLocation: "website", bidStrategy: "manual_review",
    adAccountId: accountId, accountCurrency: "EUR", name: "Campagne native", offer: "Notre service",
    dailyBudgetEuros: 25, endDate: new Date(now + 8 * 86_400_000).toISOString().slice(0, 10),
    destinationUrl: "https://example.com/offre?existing=1&utm_source=old#details", trackingParameters: "utm_source=linkedin&utm_medium=paid_social&utm_campaign=campagne_native",
    primaryText: "Découvrez notre service pour les professionnels.", headlines: ["Notre service"], descriptions: [],
    mediaBrief: "", mediaStrategy: media, creativeType: media,
    creativeUrl: "/api/media-library/items/00000000-0000-4000-8000-000000000001/content?token=fixture1234567890", imageUrl: "",
    callToAction: "", targetLocations: ["France"], targetAudiences: ["Professionnels"], languages: ["fr"], keywords: [], negativeKeywords: [],
    urlExclusions: [], metaPlacements: [],
    channelSettings: { schemaVersion: 1, channel: "linkedin", objectiveType, format: media === "video" ? "SINGLE_VIDEO" : "STANDARD_UPDATE", targetingFacet: "skills", locale: { language: "fr", country: "FR" } },
    linkedinCampaignGroupId: "456", linkedinOrganizationUrn: organization,
    linkedinGeoTargets: [{ urn: "urn:li:geo:105015875", name: "France" }],
    linkedinPoliticalIntentConfirmed: true, linkedinTargetingNoticeAcknowledged: true,
    linkedinDeliverySettings: nativeSettings(),
  };
}
function draft(media: "image" | "video" = "image", objectiveType = "WEBSITE_VISIT"): AdsCampaignInput {
  const parsed = parseAdsCampaignInput(rawDraft(media, objectiveType), { purpose: "publish" });
  assert.equal(parsed.error, null); assert.ok(parsed.draft); return parsed.draft;
}

function mp4() {
  const bytes = new Uint8Array(75_000), view = new DataView(bytes.buffer);
  const ascii = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i); };
  view.setUint32(0, 24); ascii(4, "ftyp"); ascii(8, "isom"); ascii(16, "isommp42");
  view.setUint32(24, 36); ascii(28, "moov"); view.setUint32(32, 28); ascii(36, "mvhd");
  view.setUint32(52, 1_000); view.setUint32(56, 30_000);
  view.setUint32(60, bytes.length - 60); ascii(64, "mdat"); return bytes;
}

const runtimeSource = ts.transpileModule(readFileSync(new URL("../lib/adsLinkedInPublisherServer.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
type Failure = Error & { progress: core.LinkedInAdsPublishProgress; retrySafe: boolean };
type RuntimePublisher = (userId: string, input: AdsCampaignInput, persist: (value: core.LinkedInAdsPublishProgress) => Promise<void>, options: Record<string, unknown>) => Promise<core.LinkedInAdsPublishProgress>;

function runtime(input: AdsCampaignInput, options: { unverifiedTargets?: boolean; unverifiedConversions?: boolean; unknownVideoInitialize?: boolean; dailyMinimum?: number; geoResolutionStatus?: number; geoFallbackUrn?: string } = {}) {
  class ConnectionError extends Error { code: string; status: number; constructor(message: string, code = "provider_unavailable", status = 503) { super(message); this.code = code; this.status = status; } }
  const requests: Array<{ method: string; path: string; query: string; body: Record<string, unknown> }> = [];
  const saved: core.LinkedInAdsPublishProgress[] = [];
  let mediaReads = 0, campaign: Record<string, unknown> = {}, creative: Record<string, unknown> = {};
  const associations = new Map<string, Record<string, unknown>>();
  const account = { id: accountId, name: "Compte test", currency: "EUR", country: "FR", status: "ACTIVE", type: "BUSINESS", productType: "", servingStatuses: ["RUNNABLE"], test: false, permissions: ["CAMPAIGN_MANAGER"], canManageCampaigns: true, canServeCampaigns: true };
  const fetchImpl: typeof fetch = async (url, init) => {
    const requested = new URL(String(url)), method = init?.method || "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
    const path = decodeURIComponent(requested.pathname);
    requests.push({ method, path, query: requested.search, body });
    if (requested.origin === "https://www.linkedin.com") {
      assert.equal(method, "PUT");
      return new Response(null, { status: input.creativeType === "video" ? 200 : 201, headers: { etag: '"part1"' } });
    }
    assert.equal(requested.origin, "https://api.linkedin.com");
    if (method === "GET") {
      if (path === `/rest/adAccounts/${accountId}/adCampaignGroups`) return Response.json({ elements: [{ id: 456, account: `urn:li:sponsoredAccount:${accountId}`, name: "Groupe", status: "ACTIVE", objectiveType: input.channelSettings?.channel === "linkedin" ? input.channelSettings.objectiveType : "WEBSITE_VISIT" }] });
      if (path === "/rest/organizationAcls") return Response.json({ elements: [{ state: "APPROVED", role: "ADMINISTRATOR", organization }] });
      if (path === "/rest/adTargetingEntities" && requested.searchParams.get("q") === "urns" && options.geoResolutionStatus) return Response.json({}, { status: options.geoResolutionStatus });
      if (path === "/rest/adTargetingEntities" && requested.searchParams.get("q") === "typeahead" && options.geoFallbackUrn) return Response.json({ elements: [{ urn: options.geoFallbackUrn, name: "France", facetUrn: "urn:li:adTargetingFacet:locations" }] });
      if (path === "/rest/adTargetingEntities") return Response.json({ elements: requested.searchParams.get("facet")?.endsWith("interfaceLocales") ? [{ urn: "urn:li:locale:fr_FR", name: "Français", facetUrn: "urn:li:adTargetingFacet:interfaceLocales" }] : [{ urn: "urn:li:geo:105015875", name: "France", facetUrn: "urn:li:adTargetingFacet:locations" }] });
      if (path === "/rest/audienceCounts") return Response.json({ elements: [{ total: 12_000 }] });
      if (path === "/rest/adBudgetPricing") return Response.json({ elements: [{ bidLimits: { min: { amount: "1.00", currencyCode: "EUR" }, max: { amount: "50.00", currencyCode: "EUR" } }, dailyBudgetLimits: { min: { amount: String(options.dailyMinimum ?? 10), currencyCode: "EUR" }, default: { amount: "25.00", currencyCode: "EUR" } } }] });
      if (path.startsWith("/rest/images/")) return Response.json({ id: "urn:li:image:fixture_image", owner: organization, status: "AVAILABLE" });
      if (path.startsWith("/rest/videos/")) return Response.json({ id: "urn:li:video:fixture_video", owner: organization, status: "AVAILABLE", duration: 30_000 });
      if (path === `/rest/adAccounts/${accountId}/adCampaigns/1001`) return Response.json(campaign);
      if (path === `/rest/adAccounts/${accountId}/creatives/urn:li:sponsoredCreative:3003`) return Response.json(creative);
      if (path.startsWith("/rest/campaignConversions/")) return associations.has(path) ? Response.json(associations.get(path)) : Response.json({}, { status: 404 });
      assert.fail(`Unexpected isolated read ${path}`);
    }
    if (path === "/rest/images" && requested.searchParams.get("action") === "initializeUpload") {
      assert.ok(saved.at(-1)?.pendingStep === "initialize_image");
      return Response.json({ value: { image: "urn:li:image:fixture_image", uploadUrl: "https://www.linkedin.com/dms-uploads/image?sig=fixture", uploadUrlExpiresAt: now + 3_600_000 } });
    }
    if (path === "/rest/videos" && requested.searchParams.get("action") === "initializeUpload") {
      assert.equal(saved.at(-1)?.videoCheckpoint?.phase, "initializing");
      if (options.unknownVideoInitialize) throw new Error("unknown committed initialize response");
      return Response.json({ value: { video: "urn:li:video:fixture_video", uploadToken: "isolated-video-token", uploadUrlsExpireAt: now + 3_600_000, uploadInstructions: [{ firstByte: 0, lastByte: 74_999, uploadUrl: "https://www.linkedin.com/dms-uploads/video?sig=fixture" }] } });
    }
    if (path === "/rest/videos" && requested.searchParams.get("action") === "finalizeUpload") return Response.json({});
    if (path === `/rest/adAccounts/${accountId}/adCampaigns`) { campaign = { ...body, id: 1001 }; return Response.json({ id: 1001 }, { status: 201, headers: { "x-restli-id": "1001" } }); }
    if (path === "/rest/posts") return Response.json({ id: "urn:li:share:2002" }, { status: 201, headers: { "x-restli-id": "urn:li:share:2002" } });
    if (path === `/rest/adAccounts/${accountId}/creatives`) { creative = { ...body, id: "urn:li:sponsoredCreative:3003" }; return Response.json({ id: creative.id }, { status: 201, headers: { "x-restli-id": String(creative.id) } }); }
    if (method === "PUT" && path.startsWith("/rest/campaignConversions/")) { associations.set(path, body); return new Response(null, { status: 204 }); }
    if (method === "POST" && path === `/rest/adAccounts/${accountId}/creatives/urn:li:sponsoredCreative:3003`) { creative = { ...creative, ...(body.patch as { $set: object }).$set }; return new Response(null, { status: 204 }); }
    if (method === "POST" && path === `/rest/adAccounts/${accountId}/adCampaigns/1001`) { campaign = { ...campaign, ...(body.patch as { $set: object }).$set }; return new Response(null, { status: 204 }); }
    assert.fail(`Unexpected isolated write ${method} ${path}`);
  };
  const modules = new Map<string, unknown>([
    ["server-only", {}], ["sharp", () => ({ metadata: async () => ({ width: 1200, height: 628, format: "png" }) })],
    ["./adsLinkedInPolicy.ts", policy], ["./adsLinkedInPreflightPolicy.ts", preflight], ["./adsLinkedInPublish.ts", publish], ["./adsLinkedInPublisherCore.ts", core], ["./adsLinkedInGeoResolution.ts", geo], ["./adsLinkedInCampaignSettings.ts", settings], ["./adsLinkedInVideo.ts", video], ["./adsChannelDrafts.ts", briefs],
    ["./adsLinkedInResourcesServer.ts", {
      resolveLinkedInAdsProfessionalTargets: async (value: { targets: settings.LinkedInProfessionalTarget[]; read: unknown }) => { assert.equal(typeof value.read, "function"); return { verifiedTargets: options.unverifiedTargets ? [] : value.targets, unresolvedTargets: options.unverifiedTargets ? value.targets : [] }; },
      resolveLinkedInAdsConversions: async (value: { accountId: string; conversionUrns: string[]; read: unknown }) => { assert.equal(value.accountId, accountId); assert.equal(typeof value.read, "function"); return { verifiedConversions: options.unverifiedConversions ? [] : value.conversionUrns.map((urn) => ({ urn })), unresolvedUrns: options.unverifiedConversions ? value.conversionUrns : [] }; },
    }],
    ["./adsLinkedInServer.ts", { LinkedInAdsConnectionError: ConnectionError, readLinkedInAdsIntegration: async () => ({ id: "integration", provider_account_id: "member", status: "connected", resource_id: accountId }), linkedInAdsAuthorization: async () => ({ token: "isolated-token", scopes: policy.LINKEDIN_ADS_MANAGE_SCOPES.join(" ") }), listLinkedInAdsAccounts: async () => [account] }],
    ["./mediaLibraryContentUrl.ts", { verifyMediaLibraryContentToken: () => true }],
    ["./supabaseAdmin.ts", { supabaseAdmin: {
      from: () => { mediaReads++; const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { media_type: input.creativeType, mime_type: input.creativeType === "video" ? "video/mp4" : "image/png", storage_path: "owned-media", is_active: true } }) }; return query; },
      storage: { from: () => ({ download: async () => ({ data: input.creativeType === "video" ? new Blob([mp4() as unknown as BlobPart], { type: "video/mp4" }) : new Blob(["png fixture"], { type: "image/png" }) }) }) },
    } }],
  ]);
  const loaded = { exports: {} as { publishLinkedInAdsCampaign: RuntimePublisher } };
  new Function("module", "exports", "require", "process", runtimeSource)(loaded, loaded.exports, (name: string) => { assert.ok(modules.has(name), `Unisolated dependency ${name}`); return modules.get(name); }, { env: { LINKEDIN_ADS_DEVELOPMENT_ACCOUNT_IDS: accountId } });
  return { requests, saved, mediaReads: () => mediaReads, run: (checkpoint?: core.LinkedInAdsPublishProgress) => loaded.exports.publishLinkedInAdsCampaign("owner", input, async (value) => { saved.push(structuredClone(value)); }, { operationKey, activate: false, initialProgress: checkpoint, fetchImpl, now: () => now, sleep: async () => {} }) };
}

test("delivery settings are additive, normalized without mutation, and reject contradictory facets", () => {
  assert.deepEqual(settings.normalizeLinkedInDeliverySettings(undefined), { settings: null, error: null });
  const value = nativeSettings(), before = structuredClone(value);
  assert.deepEqual(settings.normalizeLinkedInDeliverySettings(value).settings, value); assert.deepEqual(value, before);
  const title = { facet: "titles" as const, urn: "urn:li:title:4", name: "Director" };
  for (const facet of ["seniorities", "functions"] as const) {
    const conflict = nativeSettings(); conflict.professionalTargeting.include = [title, { facet, urn: `urn:li:${facet === "functions" ? "function" : "seniority"}:7`, name: "Executive" }];
    assert.ok(settings.normalizeLinkedInDeliverySettings(conflict).error);
  }
  const contradiction = nativeSettings(); contradiction.professionalTargeting.exclude.push(contradiction.professionalTargeting.include[0]);
  assert.ok(settings.normalizeLinkedInDeliverySettings(contradiction).error);
  const wrongFacet = nativeSettings(); wrongFacet.professionalTargeting.include[0].urn = "urn:li:title:501"; assert.ok(settings.normalizeLinkedInDeliverySettings(wrongFacet).error);
  const unknown = { ...nativeSettings(), ignoredSetting: true }; assert.ok(settings.normalizeLinkedInDeliverySettings(unknown).error);
});

test("tracking merges UTM once, preserves existing query and fragment, and rejects unsupported tracking", () => {
  const tracked = settings.linkedInTrackedDestination("https://example.com/?existing=1&utm_source=old#details", "?utm_source=linkedin&utm_content=ma%20vid%C3%A9o");
  assert.equal(tracked.error, null); const url = new URL(tracked.url!);
  assert.equal(url.searchParams.get("existing"), "1"); assert.deepEqual(url.searchParams.getAll("utm_source"), ["linkedin"]); assert.equal(url.searchParams.get("utm_content"), "ma vidéo"); assert.equal(url.hash, "#details");
  for (const query of ["utm_source=linkedin&utm_source=other", "gclid=ignored", "utm_source=%QQ", "utm_campaign=", "utm_source=linkedin#other"]) assert.ok(settings.linkedInTrackedDestination("https://example.com", query).error);
  assert.equal(settings.linkedInTrackedDestination("https://fcbusiness.example/offre", "utm_source=linkedin").error, null);
  for (const destination of ["https://[::1]/", "https://[::]/", "https://[fc00::1]/", "https://[fe90::1]/"]) assert.ok(settings.linkedInTrackedDestination(destination, "").error);
});

test("objective and bidding combinations use native optimization and charge types", () => {
  const delivery = nativeSettings();
  const expected = { WEBSITE_VISIT: "MAX_CLICK", ENGAGEMENT: "MAX_CLICK", BRAND_AWARENESS: "MAX_IMPRESSION", WEBSITE_CONVERSION: "MAX_CONVERSION", VIDEO_VIEW: "MAX_VIDEO_VIEW" };
  for (const [objective, optimization] of Object.entries(expected)) assert.deepEqual(settings.linkedInDeliveryBidding(objective, delivery), { costType: "CPM", optimizationTargetType: optimization, bidType: "CPM" });
  delivery.bidding.strategy = "cost_cap"; assert.equal(settings.linkedInDeliveryBidding("WEBSITE_CONVERSION", delivery), null);
  assert.equal(settings.linkedInDeliveryBidding("WEBSITE_VISIT", delivery)?.optimizationTargetType, "CAP_COST_AND_MAXIMIZE_CLICKS");
  delivery.bidding.strategy = "manual_cpc"; assert.equal(settings.linkedInDeliveryBidding("BRAND_AWARENESS", delivery), null); assert.equal(settings.linkedInDeliveryBidding("VIDEO_VIEW", delivery), null);
  assert.equal(settings.linkedInDeliveryBidding("WEBSITE_CONVERSION", delivery)?.optimizationTargetType, "ENHANCED_CONVERSION");
  assert.equal(settings.linkedInDeliveryBidding("WEBSITE_VISIT")?.optimizationTargetType, "NONE");
});

test("automatic native publication does not require the legacy CPC field and conversions require a chosen rule", () => {
  assert.equal(draft().linkedinBidEuros, undefined);
  const raw = rawDraft("image", "WEBSITE_CONVERSION"); raw.linkedinDeliverySettings.conversions.conversionUrns = [];
  assert.match(parseAdsCampaignInput(raw, { purpose: "publish" }).error || "", /conversion/i);
  raw.linkedinDeliverySettings.bidding.strategy = "cost_cap"; assert.ok(parseAdsCampaignInput(raw, { purpose: "publish" }).error);
});

test("native image publisher uses the exact audience, total budget, schedule, UTM and CTA", async () => {
  const input = draft(), before = structuredClone(input), fixture = runtime(input);
  const result = await fixture.run(); assert.equal(result.stage, "paused"); assert.deepEqual(input, before);
  const campaign = fixture.requests.find((row) => row.method === "POST" && row.path.endsWith("/adCampaigns"))!.body;
  assert.deepEqual(campaign.totalBudget, { amount: "200.00", currencyCode: "EUR" }); assert.equal(campaign.dailyBudget, undefined); assert.equal(campaign.pacingStrategy, "LIFETIME");
  assert.equal(campaign.costType, "CPM"); assert.equal(campaign.optimizationTargetType, "MAX_CLICK"); assert.deepEqual(campaign.unitCost, { amount: "0.00", currencyCode: "EUR" });
  assert.equal(campaign.audienceExpansionEnabled, true); assert.equal(campaign.offsiteDeliveryEnabled, true);
  assert.deepEqual(campaign.runSchedule, { start: Date.parse(input.linkedinDeliverySettings!.budget.startAt!), end: Date.parse(input.linkedinDeliverySettings!.budget.endAt!) });
  const targeting = settings.buildLinkedInDeliveryTargeting(["urn:li:geo:105015875"], "fr", "FR", input.linkedinDeliverySettings); assert.deepEqual(campaign.targetingCriteria, targeting);
  const audienceRead = fixture.requests.find((row) => row.path === "/rest/audienceCounts")!;
  const pricingRead = fixture.requests.find((row) => row.path === "/rest/adBudgetPricing")!;
  for (const row of [audienceRead, pricingRead]) { const text = decodeURIComponent(row.query); for (const facet of ["profileLocations", "industries", "skills"]) assert.ok(text.includes(`adTargetingFacet:${facet}`)); assert.ok(text.includes("exclude:")); }
  assert.ok(pricingRead.query.includes("bidType=CPM")); assert.ok(pricingRead.query.includes("matchType=AUDIENCE_EXPANDED")); assert.ok(!pricingRead.query.includes("dailyBudget="));
  const post = fixture.requests.find((row) => row.method === "POST" && row.path === "/rest/posts")!.body;
  assert.equal(post.contentCallToActionLabel, "SIGN_UP"); const destination = new URL(String(post.contentLandingPage)); assert.equal(destination.searchParams.get("utm_source"), "linkedin"); assert.equal(destination.hash, "#details");
});

test("conversion rules are associated and reread before the campaign can leave DRAFT", async () => {
  const fixture = runtime(draft("image", "WEBSITE_CONVERSION")); await fixture.run();
  const campaign = fixture.requests.find((row) => row.method === "POST" && row.path.endsWith("/adCampaigns"))!.body;
  assert.equal(campaign.objectiveType, "WEBSITE_CONVERSION"); assert.equal(campaign.optimizationTargetType, "MAX_CONVERSION");
  const association = fixture.requests.findIndex((row) => row.method === "PUT" && row.path.startsWith("/rest/campaignConversions/"));
  const confirmation = fixture.requests.findIndex((row, index) => index > association && row.method === "GET" && row.path.startsWith("/rest/campaignConversions/"));
  const finalize = fixture.requests.findIndex((row) => row.method === "POST" && row.path.endsWith("/adCampaigns/1001"));
  assert.ok(association > 0 && confirmation > association && finalize > confirmation);
});

test("invalid local copy is rejected before media reads or provider requests", async () => {
  const input = draft(); input.primaryText = "OK";
  const fixture = runtime(input); await assert.rejects(fixture.run(), /incomplète/);
  assert.equal(fixture.mediaReads(), 0); assert.equal(fixture.requests.length, 0);
});

test("unverified professional selections and disabled conversions prevent all provider mutations", async () => {
  for (const options of [{ unverifiedTargets: true }, { unverifiedConversions: true }]) {
    const fixture = runtime(draft(), options); await assert.rejects(fixture.run(), /confirmé/);
    assert.ok(fixture.requests.every((row) => row.method === "GET")); assert.ok(!fixture.saved.some((checkpoint) => checkpoint.imageUrn));
  }
});

test("a lifetime budget below provider daily minimum times duration blocks before upload", async () => {
  const fixture = runtime(draft(), { dailyMinimum: 100 }); await assert.rejects(fixture.run(), /total_budget_too_low/);
  assert.ok(fixture.requests.every((row) => row.method === "GET"));
});

test("video publication uploads MP4 once, persists its session, and creates SINGLE_VIDEO with correct evidence", async () => {
  const fixture = runtime(draft("video", "VIDEO_VIEW")); const result = await fixture.run();
  assert.equal(result.stage, "paused"); assert.equal(result.imageUrn, undefined); assert.equal(result.videoUrn, "urn:li:video:fixture_video");
  assert.equal(result.videoCheckpoint?.phase, "available"); assert.equal(result.videoCheckpoint?.uploadToken, undefined); assert.deepEqual(result.videoCheckpoint?.parts, []);
  core.assertLinkedInPublishProgress(result, operationKey, accountId, "PAUSED");
  assert.equal(fixture.requests.filter((row) => row.path === "/rest/videos" && row.query.includes("initializeUpload")).length, 1);
  const campaign = fixture.requests.find((row) => row.method === "POST" && row.path.endsWith("/adCampaigns"))!.body;
  assert.equal(campaign.format, "SINGLE_VIDEO"); assert.equal(campaign.optimizationTargetType, "MAX_VIDEO_VIEW");
  const post = fixture.requests.find((row) => row.method === "POST" && row.path === "/rest/posts")!.body;
  assert.equal(((post.content as { media: { id: string } }).media).id, "urn:li:video:fixture_video");
});

test("an unknown video initialize result retains an unsafe checkpoint and never creates a second upload", async () => {
  const fixture = runtime(draft("video"), { unknownVideoInitialize: true });
  let failure: Failure | null = null; try { await fixture.run(); } catch (error) { failure = error as Failure; }
  assert.ok(failure); assert.equal(failure.retrySafe, false); assert.equal(failure.progress.videoCheckpoint?.phase, "initializing");
  await assert.rejects(fixture.run(failure.progress), /initialisation/);
  assert.equal(fixture.requests.filter((row) => row.path === "/rest/videos" && row.query.includes("initializeUpload")).length, 1);
  assert.equal(fixture.requests.filter((row) => row.method === "POST" && row.path.endsWith("/adCampaigns")).length, 0);
});

test("publisher recovers rejected geographic URN finder only with an exact fresh location", async () => {
  const good = runtime(draft(), { geoResolutionStatus: 400, geoFallbackUrn: "urn:li:geo:105015875" });
  assert.equal((await good.run()).stage, "paused");
  assert.ok(good.requests.some(request => request.path === "/rest/adTargetingEntities" && request.query.includes("q=typeahead")));
  const bad = runtime(draft(), { geoResolutionStatus: 400, geoFallbackUrn: "urn:li:geo:999" });
  await assert.rejects(bad.run());
  assert.equal(bad.requests.some(request => request.method !== "GET"), false);
  for (const status of [401, 403, 429, 500]) {
    const denied = runtime(draft(), { geoResolutionStatus: status, geoFallbackUrn: "urn:li:geo:105015875" });
    await assert.rejects(denied.run());
    assert.equal(denied.requests.some(request => request.query.includes("q=typeahead")), false);
    assert.equal(denied.requests.some(request => request.method !== "GET"), false);
  }
});
