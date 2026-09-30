import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import type { AdsCampaignInput } from "../lib/adsValidation.ts";
import * as linkedInPolicy from "../lib/adsLinkedInPolicy.ts";
import * as linkedInPreflight from "../lib/adsLinkedInPreflightPolicy.ts";
import * as linkedInPublish from "../lib/adsLinkedInPublish.ts";
import * as linkedInCore from "../lib/adsLinkedInPublisherCore.ts";

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
  const migration = readFileSync(new URL("../supabase/migrations/20260930004822_enable_linkedin_ads_publication.sql", import.meta.url), "utf8");
  assert.match(route, /draft\.provider === "linkedin"[\s\S]*?INRCY_LINKEDIN_ADS_PUBLISH_ENABLED === "true"/);
  assert.match(migration, /'linkedin'::text/);
  assert.match(migration, /or \(status = 'draft' and ad_account_id = ''\)/);
  assert.ok(migration.trim().length > 200, "the LinkedIn migration must never be an empty placeholder");
});

type PublisherFailure = Error & { progress: LinkedInAdsPublishProgress; retrySafe: boolean };
type RuntimePublisher = (
  userId: string,
  draft: AdsCampaignInput,
  persist: (value: LinkedInAdsPublishProgress) => Promise<void>,
  options: {
    operationKey: string; activate: boolean; initialProgress: LinkedInAdsPublishProgress;
    fetchImpl: typeof fetch; now: () => number; sleep: (milliseconds: number) => Promise<void>;
  },
) => Promise<LinkedInAdsPublishProgress>;

const runtimeSource = ts.transpileModule(
  readFileSync(new URL("../lib/adsLinkedInPublisherServer.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } },
).outputText;
const recoveryNow = Date.parse("2026-09-30T10:00:00Z");

function finalizingProgress(target: "ACTIVE" | "PAUSED", overrides: Partial<LinkedInAdsPublishProgress> = {}) {
  return progress({
    targetStatus: target, stage: "creative_active", imageUrn: "urn:li:image:abc_123",
    campaignId: "1001", campaignUrn: "urn:li:sponsoredCampaign:1001",
    postUrn: "urn:li:share:2002", creativeUrn: "urn:li:sponsoredCreative:3003", ...overrides,
  });
}

function recoveryRuntime(target: "ACTIVE" | "PAUSED", options: {
  remoteStatus?: string; campaign?: Record<string, unknown>; creative?: Record<string, unknown>;
  timeoutAfterFinalMutation?: boolean; failReads?: boolean; canServe?: boolean;
  scopes?: string; mappedAccount?: string;
} = {}) {
  let remoteStatus = options.remoteStatus || "DRAFT";
  let mediaReads = 0;
  const requests: Array<{ method: string; path: string; body?: string }> = [];
  const account = {
    id: "558357276", name: "Compte test", currency: "EUR", country: "FR", status: "ACTIVE", type: "BUSINESS",
    productType: "", servingStatuses: ["RUNNABLE"], test: false, permissions: ["CAMPAIGN_MANAGER"],
    canManageCampaigns: true, canServeCampaigns: options.canServe !== false,
  };
  const modules = new Map<string, unknown>([
    ["server-only", {}],
    ["sharp", () => ({ metadata: async () => ({ width: 1200, height: 628, format: "png" }) })],
    ["./adsLinkedInPolicy.ts", linkedInPolicy],
    ["./adsLinkedInPreflightPolicy.ts", linkedInPreflight],
    ["./adsLinkedInPublish.ts", linkedInPublish],
    ["./adsLinkedInPublisherCore.ts", linkedInCore],
    ["./adsLinkedInServer.ts", {
      LinkedInAdsConnectionError: class extends Error {},
      readLinkedInAdsIntegration: async () => ({ status: "connected", resource_id: account.id }),
      linkedInAdsAuthorization: async () => ({
        token: "isolated-test-token",
        scopes: options.scopes ?? linkedInPolicy.LINKEDIN_ADS_MANAGE_SCOPES.join(" "),
      }),
      listLinkedInAdsAccounts: async () => [account],
    }],
    ["./mediaLibraryContentUrl.ts", { verifyMediaLibraryContentToken: () => true }],
    ["./supabaseAdmin.ts", { supabaseAdmin: {
      from: () => {
        mediaReads++;
        const query = {
          select: () => query, eq: () => query,
          maybeSingle: async () => ({ data: { media_type: "image", mime_type: "image/png", storage_path: "image.png" } }),
        };
        return query;
      },
      storage: { from: () => ({ download: async () => ({ data: new Blob(["fixture"], { type: "image/png" }) }) }) },
    } }],
  ]);
  const loaded = { exports: {} as { publishLinkedInAdsCampaign: RuntimePublisher } };
  new Function("module", "exports", "require", "process", runtimeSource)(
    loaded, loaded.exports,
    (specifier: string) => {
      assert.ok(modules.has(specifier), `Unisolated publisher dependency: ${specifier}`);
      return modules.get(specifier);
    },
    { env: { LINKEDIN_ADS_DEVELOPMENT_ACCOUNT_IDS: options.mappedAccount ?? account.id } },
  );
  const campaignPath = `/rest/adAccounts/${account.id}/adCampaigns/1001`;
  const fetchImpl: typeof fetch = async (url, init) => {
    const request = new URL(String(url));
    const method = init?.method || "GET";
    requests.push({ method, path: request.pathname, body: typeof init?.body === "string" ? init.body : undefined });
    assert.equal(request.origin, "https://api.linkedin.com");
    if (method !== "GET") {
      assert.equal(method, "POST", "Recovery must not upload or delete resources");
      assert.equal(request.pathname, campaignPath, "Recovery must not create resources or reactivate the creative");
      assert.deepEqual(JSON.parse(String(init?.body)), { patch: { $set: { status: target } } });
      remoteStatus = target;
      if (options.timeoutAfterFinalMutation) throw new Error("simulated response timeout after the provider committed");
      return new Response(null, { status: 204 });
    }
    if (options.failReads) return Response.json({}, { status: 503 });
    if (request.pathname === campaignPath) return Response.json({
      id: 1001, account: `urn:li:sponsoredAccount:${account.id}`, status: remoteStatus,
      campaignGroup: "urn:li:sponsoredCampaignGroup:456", associatedEntity: "urn:li:organization:789",
      objectiveType: "WEBSITE_VISIT", format: "STANDARD_UPDATE", type: "SPONSORED_UPDATES", ...options.campaign,
    });
    if (request.pathname.includes("/creatives/")) return Response.json({
      id: "urn:li:sponsoredCreative:3003", campaign: "urn:li:sponsoredCampaign:1001",
      content: { reference: "urn:li:share:2002" }, intendedStatus: "ACTIVE", ...options.creative,
    });
    if (request.pathname.endsWith("/adCampaignGroups")) return Response.json({ elements: [{
      id: 456, account: `urn:li:sponsoredAccount:${account.id}`, status: "ACTIVE", objectiveType: "WEBSITE_VISIT",
      allowedCampaignTypes: ["SPONSORED_UPDATES"], runSchedule: { start: recoveryNow - 60_000 },
    }] });
    if (request.pathname === "/rest/organizationAcls") return Response.json({ elements: [{
      state: "APPROVED", role: "CONTENT_ADMINISTRATOR", organization: "urn:li:organization:789",
    }] });
    if (request.pathname === "/rest/adTargetingEntities") return Response.json({ elements: request.searchParams.get("q") === "urns"
      ? [{ urn: "urn:li:geo:105015875", name: "France", facetUrn: "urn:li:adTargetingFacet:locations" }]
      : [{ urn: "urn:li:locale:fr_FR" }],
    });
    if (request.pathname === "/rest/audienceCounts") return Response.json({ elements: [{ total: 1000 }] });
    if (request.pathname === "/rest/adBudgetPricing") return Response.json({ elements: [{
      bidLimits: { min: { amount: "1", currencyCode: "EUR" }, max: { amount: "25", currencyCode: "EUR" } },
      dailyBudgetLimits: { min: { amount: "10", currencyCode: "EUR" } },
    }] });
    if (request.pathname.startsWith("/rest/images/")) return Response.json({
      id: "urn:li:image:abc_123", owner: "urn:li:organization:789", status: "AVAILABLE",
    });
    assert.fail(`Unexpected provider read: ${request.pathname}`);
  };
  const draft = {
    provider: "linkedin", adAccountId: account.id, accountCurrency: "EUR", name: "Campagne reprise",
    dailyBudgetEuros: 25, endDate: "2026-10-10", primaryText: "Découvrez notre service.",
    headlines: ["Notre service"], mediaBrief: "Une photo du service", destinationUrl: "https://example.com/offre",
    targetAudiences: ["Professionnels"],
    creativeUrl: "/api/media-library/items/00000000-0000-4000-8000-000000000001/content?token=test",
    channelSettings: { channel: "linkedin", objectiveType: "WEBSITE_VISIT", format: "STANDARD_UPDATE", locale: { language: "fr", country: "FR" } },
    linkedinCampaignGroupId: "456", linkedinOrganizationUrn: "urn:li:organization:789",
    linkedinGeoTargets: [{ urn: "urn:li:geo:105015875", name: "France" }], linkedinBidEuros: 2.5,
    linkedinPoliticalIntentConfirmed: true, linkedinTargetingNoticeAcknowledged: true,
  } as AdsCampaignInput;
  return {
    requests, mediaReads: () => mediaReads,
    run: (checkpoint: LinkedInAdsPublishProgress, persist: (value: LinkedInAdsPublishProgress) => Promise<void>) =>
      loaded.exports.publishLinkedInAdsCampaign("owner", draft, persist, {
        operationKey, activate: target === "ACTIVE", initialProgress: checkpoint, fetchImpl,
        now: () => recoveryNow, sleep: async () => {},
      }),
  };
}

for (const target of ["ACTIVE", "PAUSED"] as const) {
  test(`${target}: response timeout after final mutation reconciles without another mutation`, async () => {
    const runtime = recoveryRuntime(target, { timeoutAfterFinalMutation: true });
    let durable = finalizingProgress(target);
    await assert.rejects(runtime.run(durable, async (value) => { durable = structuredClone(value); }), /n’a pas confirmé le changement/);
    assert.equal(durable.pendingStep, "finalize_campaign");
    assert.equal(durable.stage, "creative_active");
    const mutationsBefore = runtime.requests.filter((entry) => entry.method !== "GET").length;
    const mediaReadsBefore = runtime.mediaReads();
    const result = await runtime.run(durable, async (value) => { durable = structuredClone(value); });
    assert.equal(result.stage, target.toLowerCase());
    assert.equal(result.pendingStep, undefined);
    assert.equal(runtime.requests.filter((entry) => entry.method !== "GET").length, mutationsBefore);
    assert.equal(mutationsBefore, 1);
    assert.equal(runtime.mediaReads(), mediaReadsBefore, "Completed publication does not require the original local media");
  });

  test(`${target}: failed final checkpoint persistence recovers both durable and in-memory progress`, async () => {
    const runtime = recoveryRuntime(target);
    let durable = finalizingProgress(target);
    let failure: PublisherFailure | undefined;
    await assert.rejects(runtime.run(durable, async (value) => {
      if (value.stage === target.toLowerCase()) throw new Error("simulated database write failure");
      durable = structuredClone(value);
    }), (error: unknown) => {
      failure = error as PublisherFailure;
      return /database write failure/.test(failure.message);
    });
    assert.equal(durable.pendingStep, "finalize_campaign");
    assert.equal(failure?.progress.stage, target.toLowerCase());
    for (const checkpoint of [durable, failure!.progress]) {
      const result = await runtime.run(checkpoint, async () => {});
      assert.equal(result.stage, target.toLowerCase());
      assert.equal(result.pendingStep, undefined);
    }
    assert.equal(runtime.requests.filter((entry) => entry.method !== "GET").length, 1);
  });

  test(`${target}: pending finalization still DRAFT retries only the final campaign status`, async () => {
    const runtime = recoveryRuntime(target);
    const result = await runtime.run(finalizingProgress(target, { pendingStep: "finalize_campaign" }), async () => {});
    assert.equal(result.stage, target.toLowerCase());
    assert.equal(runtime.requests.filter((entry) => entry.method !== "GET").length, 1);
  });

  test(`${target}: confirmed final checkpoint remains read-only even if the account no longer serves`, async () => {
    const runtime = recoveryRuntime(target, { remoteStatus: target, canServe: false });
    const final = finalizingProgress(target, { stage: target === "ACTIVE" ? "active" : "paused" });
    const result = await runtime.run(final, async () => {});
    assert.equal(result.stage, final.stage);
    assert.equal(runtime.mediaReads(), 0);
    assert.ok(runtime.requests.every((entry) => entry.method === "GET"));
  });
}

test("final reconciliation rejects incompatible states, foreign resources and revoked access without mutations", async () => {
  const cases: Parameters<typeof recoveryRuntime>[1][] = [
    { remoteStatus: "PAUSED" }, { remoteStatus: "ARCHIVED" }, { remoteStatus: "DRAFT" },
    { campaign: { id: 9999 } }, { campaign: { account: "urn:li:sponsoredAccount:9999" } },
    { campaign: { campaignGroup: "urn:li:sponsoredCampaignGroup:9999" } },
    { campaign: { associatedEntity: "urn:li:organization:9999" } },
    { campaign: { objectiveType: "ENGAGEMENT" } }, { campaign: { format: "TEXT_AD" } },
    { creative: { id: "urn:li:sponsoredCreative:9999" } },
    { creative: { campaign: "urn:li:sponsoredCampaign:9999" } },
    { creative: { content: { reference: "urn:li:share:9999" } } },
    { creative: { intendedStatus: "PAUSED" } }, { creative: { id: undefined } },
    { scopes: "r_ads" }, { mappedAccount: "9999" }, { failReads: true },
  ];
  for (const override of cases) {
    const runtime = recoveryRuntime("ACTIVE", { remoteStatus: "ACTIVE", ...override });
    let persisted = false;
    await assert.rejects(runtime.run(finalizingProgress("ACTIVE", { stage: "active" }), async () => { persisted = true; }));
    assert.equal(persisted, false, JSON.stringify(override));
    assert.equal(runtime.mediaReads(), 0, JSON.stringify(override));
    assert.ok(runtime.requests.every((entry) => entry.method === "GET"), JSON.stringify(override));
  }
});

test("pending finalization never changes an opposite final state or an unverified creative", async () => {
  for (const override of [{ remoteStatus: "ACTIVE" }, { remoteStatus: "DRAFT", creative: { intendedStatus: "DRAFT" } }]) {
    const runtime = recoveryRuntime("PAUSED", override);
    await assert.rejects(runtime.run(finalizingProgress("PAUSED", { pendingStep: "finalize_campaign" }), async () => assert.fail("must not persist")));
    assert.ok(runtime.requests.every((entry) => entry.method === "GET"));
  }
  const runtime = recoveryRuntime("PAUSED", { remoteStatus: "PAUSED" });
  await assert.rejects(runtime.run(finalizingProgress("PAUSED", {
    stage: "creative_created", pendingStep: "finalize_campaign",
  }), async () => assert.fail("must not persist")), /checkpoint de finalisation/);
  assert.equal(runtime.requests.length, 0);
});
