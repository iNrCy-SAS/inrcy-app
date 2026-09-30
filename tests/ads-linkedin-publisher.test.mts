import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertLinkedInPublishProgress,
  isSafeLinkedInImageUploadUrl,
  linkedInAdsCampaignReference,
  withLinkedInRequestId,
  type LinkedInAdsPublishProgress,
} from "../lib/adsLinkedInPublisherCore.ts";

const operationKey = "linkedin:00000000-0000-4000-8000-000000000001";

function progress(overrides: Partial<LinkedInAdsPublishProgress> = {}): LinkedInAdsPublishProgress {
  return {
    schemaVersion: 1,
    operationKey,
    accountId: "558357276",
    targetStatus: "PAUSED",
    stage: "preflight_complete",
    ...overrides,
  };
}

test("LinkedIn campaign IDs accept official numeric JSON IDs or URNs and reject ambiguous values", () => {
  assert.deepEqual(linkedInAdsCampaignReference(123456), {
    id: "123456", urn: "urn:li:sponsoredCampaign:123456",
  });
  assert.deepEqual(linkedInAdsCampaignReference("123456"), {
    id: "123456", urn: "urn:li:sponsoredCampaign:123456",
  });
  assert.deepEqual(linkedInAdsCampaignReference("urn:li:sponsoredCampaign:123456"), {
    id: "123456", urn: "urn:li:sponsoredCampaign:123456",
  });
  for (const value of [null, "", 1.5, Number.MAX_SAFE_INTEGER + 1, "urn:li:sponsoredCampaign:nope"]) {
    assert.equal(linkedInAdsCampaignReference(value), null);
  }
});

test("bearer-authenticated image upload URLs cannot redirect the token to another origin", () => {
  assert.equal(isSafeLinkedInImageUploadUrl("https://www.linkedin.com/dms-uploads/example?sig=opaque"), true);
  for (const value of [
    "http://www.linkedin.com/dms-uploads/example",
    "https://evil.example/dms-uploads/example",
    "https://www.linkedin.com.evil.example/dms-uploads/example",
    "https://user:secret@www.linkedin.com/dms-uploads/example",
    "https://www.linkedin.com/other/example",
    "https://www.linkedin.com/dms-uploads/example#leak",
  ]) assert.equal(isSafeLinkedInImageUploadUrl(value), false, value);
});

test("durable LinkedIn checkpoints enforce the exact resource hierarchy and final target", () => {
  const chain: LinkedInAdsPublishProgress[] = [
    progress(),
    progress({ stage: "image_initialized", imageUrn: "urn:li:image:abc_123" }),
    progress({ stage: "image_available", imageUrn: "urn:li:image:abc_123" }),
    progress({
      stage: "campaign_created", imageUrn: "urn:li:image:abc_123",
      campaignId: "1001", campaignUrn: "urn:li:sponsoredCampaign:1001",
    }),
    progress({
      stage: "dark_post_created", imageUrn: "urn:li:image:abc_123",
      campaignId: "1001", campaignUrn: "urn:li:sponsoredCampaign:1001", postUrn: "urn:li:share:2002",
    }),
    progress({
      stage: "creative_created", imageUrn: "urn:li:image:abc_123",
      campaignId: "1001", campaignUrn: "urn:li:sponsoredCampaign:1001", postUrn: "urn:li:share:2002",
      creativeUrn: "urn:li:sponsoredCreative:3003",
    }),
    progress({
      stage: "paused", imageUrn: "urn:li:image:abc_123",
      campaignId: "1001", campaignUrn: "urn:li:sponsoredCampaign:1001", postUrn: "urn:li:share:2002",
      creativeUrn: "urn:li:sponsoredCreative:3003",
    }),
  ];
  for (const checkpoint of chain) {
    assert.doesNotThrow(() => assertLinkedInPublishProgress(checkpoint, operationKey, "558357276", "PAUSED"));
  }
  assert.throws(() => assertLinkedInPublishProgress(
    progress({ stage: "campaign_created", campaignId: "1001", campaignUrn: "urn:li:sponsoredCampaign:1001" }),
    operationKey, "558357276", "PAUSED",
  ), /hierarchy/);
  assert.throws(() => assertLinkedInPublishProgress(
    progress({ stage: "preflight_complete", pendingStep: "not-a-step" as never }),
    operationKey, "558357276", "PAUSED",
  ), /pending/);
  assert.throws(() => assertLinkedInPublishProgress(
    { ...chain.at(-1)!, stage: "active" }, operationKey, "558357276", "PAUSED",
  ), /target status/);
});

test("only safe LinkedIn request IDs are retained in checkpoints", () => {
  const base = progress();
  const saved = withLinkedInRequestId(base, "create_campaign", new Response(null, {
    headers: { "x-li-request-id": "li-request_123" },
  }));
  assert.deepEqual(saved.providerRequestIds, { create_campaign: "li-request_123" });
  const ignored = withLinkedInRequestId(base, "create_campaign", new Response(null, {
    headers: { "x-li-request-id": "Bearer secret with spaces" },
  }));
  assert.equal(ignored.providerRequestIds, undefined);
});

test("server orchestration persists every ID in order and never blindly retries a POST create", () => {
  const server = readFileSync(new URL("../lib/adsLinkedInPublisherServer.ts", import.meta.url), "utf8");
  const orderedNeedles = [
    'beginCreate("initialize_image")',
    'stage: "image_initialized"',
    'stage: "image_available"',
    'beginCreate("create_campaign")',
    'stage: "campaign_created"',
    'beginCreate("create_dark_post")',
    'stage: "dark_post_created"',
    'beginCreate("create_creative")',
    'stage: "creative_created"',
    'pendingStep: "activate_creative"',
    'stage: "creative_active"',
    'pendingStep: "finalize_campaign"',
  ];
  let position = -1;
  for (const needle of orderedNeedles) {
    const next = server.indexOf(needle, position + 1);
    assert.ok(next > position, `missing/out-of-order publisher step: ${needle}`);
    position = next;
  }
  assert.match(server, /if \(progress\.pendingStep === step\)[\s\S]*?uncertainStep: step/);
  assert.match(server, /response\.headers\.get\("x-restli-id"\)[\s\S]*?created\.payload\.id/);
  assert.match(server, /if \(!campaignReference\) throw new ProviderMutationFailure/);
  assert.match(server, /redirect: "error"/);
  assert.match(server, /method: "PUT",[\s\S]*?Authorization: `Bearer \$\{evidence\.token\}`/);
  assert.match(server, /if \(!hasProviderResource\(progress\)\)[\s\S]*?stage: "preflight_complete"/);
  const createRequest = server.slice(server.indexOf("async function createRequest"), server.indexOf("async function partialUpdate"));
  assert.doesNotMatch(createRequest, /for \(|while \(|retry/i);
});

test("publisher verifies the creative and campaign after final mutation for both launch targets", () => {
  const server = readFileSync(new URL("../lib/adsLinkedInPublisherServer.ts", import.meta.url), "utf8");
  assert.match(server, /targetStatus = options\.activate === false \? "PAUSED" : "ACTIVE"/);
  assert.match(server, /creativePayload\.intendedStatus/);
  assert.match(server, /text\(finalCampaign\.status\) === targetStatus/);
  assert.match(server, /targetStatus === "ACTIVE" \? "active" : "paused"/);
  assert.match(server, /targetStatus === "ACTIVE" && !account\.canServeCampaigns/);
  assert.match(server, /targetStatus === "ACTIVE" && campaignGroup\.status !== "ACTIVE"/);
});

test("LinkedIn rollout is provider-specific and the database permits its real resources only after migration", () => {
  const route = readFileSync(new URL("../app/api/ads/campaigns/[id]/publish/route.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/20260930000116_enable_linkedin_ads_publication.sql", import.meta.url), "utf8");
  assert.match(route, /draft\.provider === "linkedin"[\s\S]*?INRCY_LINKEDIN_ADS_PUBLISH_ENABLED === "true"/);
  assert.match(migration, /'linkedin'::text/);
  assert.match(migration, /or \(status = 'draft' and ad_account_id = ''\)/);
  assert.ok(migration.trim().length > 200, "the LinkedIn migration must never be an empty placeholder");
});
