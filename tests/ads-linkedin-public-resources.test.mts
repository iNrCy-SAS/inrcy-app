import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as projection from "../lib/adsProviderResources.ts";
import * as tracking from "../app/api/ads/campaigns/[id]/trackingPolicy.ts";

const secret = "private-upload-capability";
const resources = {
  schemaVersion: 1, operationKey: "linkedin:fixture", accountId: "12345", targetStatus: "PAUSED", stage: "video_initialized",
  videoUrn: "urn:li:video:fixture_video", campaignUrn: "urn:li:sponsoredCampaign:678",
  videoCheckpoint: { phase: "uploading", uploadToken: secret, parts: [{ uploadUrl: `https://www.linkedin.com/dms-uploads/?sig=${secret}`, etag: secret }] },
  inrcyLifecycleRecovery: { operation: "initial_publish", mode: "paused" },
};

test("public resources hide every video upload capability without changing server recovery state", () => {
  const before = structuredClone(resources), visible = projection.publicAdsProviderResources(resources) as Record<string, unknown>;
  assert.equal("videoCheckpoint" in visible, false);
  assert.doesNotMatch(JSON.stringify(visible), /private-upload-capability|uploadToken|uploadUrl/);
  assert.equal(visible.videoUrn, resources.videoUrn);
  assert.deepEqual(visible.inrcyLifecycleRecovery, resources.inrcyLifecycleRecovery);
  assert.deepEqual(resources, before);
  assert.deepEqual(projection.publicAdsProviderResources({ campaignId: "meta-legacy", adId: "ad" }), { campaignId: "meta-legacy", adId: "ad" });
});

test("video checkpoints and video resources cannot be downgraded to an empty retryable publication", () => {
  assert.equal(projection.hasLinkedInAdsPublicationResources({}), false);
  assert.equal(projection.hasLinkedInAdsPublicationResources({ stage: "preflight_complete" }), false);
  assert.equal(projection.hasLinkedInAdsPublicationResources({ videoCheckpoint: { phase: "initializing" } }), true);
  assert.equal(projection.hasLinkedInAdsPublicationResources({ videoUrn: "urn:li:video:fixture_video" }), true);
  assert.equal(projection.hasLinkedInAdsPublicationResources({ imageUrn: "urn:li:image:legacy" }), true);
  const route = readFileSync(new URL("../app/api/ads/campaigns/[id]/publish/route.ts", import.meta.url), "utf8");
  assert.match(route, /linkedinRejectedBeforeCreate[\s\S]*?!hasLinkedInAdsPublicationResources\(resources\)/);
  assert.match(route, /provider_resources: rejectedBeforeCreate \? \{\} : withInitialPublishRecovery\(resources, mode\)/);
});

function getRuntime(route: "list" | "detail") {
  const row = { id: "00000000-0000-4000-8000-000000000001", provider: "linkedin", status: "needs_review", draft: { provider: "linkedin" }, provider_resources: structuredClone(resources) };
  const query = {
    select: () => query, eq: () => query, in: () => query, order: () => query,
    range: async () => ({ data: [row], count: 1, error: null }),
    maybeSingle: async () => ({ data: row, error: null }),
  };
  const modules = new Map<string, unknown>([
    ["next/server", { NextResponse: { json: (body: unknown, init: ResponseInit = {}) => Response.json(body, init) } }],
    ["@/lib/adsProviderResources", projection],
    ["@/lib/adsServer", { requirePremiumAdsUser: async () => ({ user: { authUserId: "owner", activeUserId: "owner" } }), isAdsPilotAdmin: async () => true, isAdsChannelUserAllowed: async () => true }],
    ["@/lib/adsValidation", { normalizeStoredAdsCampaignDraft: (draft: unknown) => draft, isAdsChannelId: () => true }],
    ["@/lib/supabaseAdmin", { supabaseAdmin: { from: () => query } }],
    ["@/lib/rateLimit", {}], ["@/lib/adsAccessPolicy", {}],
    ["./[id]/trackingPolicy", tracking], ["./trackingPolicy", tracking],
  ]);
  const file = route === "list" ? "../app/api/ads/campaigns/route.ts" : "../app/api/ads/campaigns/[id]/route.ts";
  const source = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const loaded = { exports: {} as { GET: (request: Request, context?: { params: Promise<{ id: string }> }) => Promise<Response> } };
  new Function("module", "exports", "require", source)(loaded, loaded.exports, (name: string) => { assert.ok(modules.has(name), `Unisolated GET dependency ${name}`); return modules.get(name); });
  return { row, get: () => loaded.exports.GET(new Request("https://app.inrcy.com/api/ads/campaigns"), { params: Promise.resolve({ id: row.id }) }) };
}

test("actual campaign list and detail GETs project resources while database checkpoints remain intact", async () => {
  for (const route of ["list", "detail"] as const) {
    const runtime = getRuntime(route), before = structuredClone(runtime.row);
    const response = await runtime.get();
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json() as { campaigns?: Array<{ provider_resources: Record<string, unknown> }>; campaign?: { provider_resources: Record<string, unknown> } };
    const visible = (body.campaigns?.[0] || body.campaign)!.provider_resources;
    assert.equal(visible.videoUrn, resources.videoUrn); assert.equal(visible.campaignUrn, resources.campaignUrn);
    assert.equal("videoCheckpoint" in visible, false); assert.doesNotMatch(JSON.stringify(body), /private-upload-capability/);
    assert.deepEqual(runtime.row, before);
  }
  const lifecycle = readFileSync(new URL("../app/api/ads/campaigns/[id]/lifecycle/route.ts", import.meta.url), "utf8");
  assert.match(lifecycle, /provider_resources: publicAdsProviderResources\(data.provider_resources\)/);
});
