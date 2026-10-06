import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import type { AdsCampaignInput } from "../lib/adsValidation.ts";
import * as linkedInPolicy from "../lib/adsLinkedInPolicy.ts";
import * as linkedInPreflight from "../lib/adsLinkedInPreflightPolicy.ts";
import * as linkedInPublish from "../lib/adsLinkedInPublish.ts";
import * as linkedInCore from "../lib/adsLinkedInPublisherCore.ts";
import * as linkedInGeoResolution from "../lib/adsLinkedInGeoResolution.ts";
import { isAdsChannelPublishEnabled } from "../lib/adsPublishMode.ts";

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
  const routeAst = ts.createSourceFile("publish-route.ts", route, ts.ScriptTarget.Latest, true);
  let gateExpression: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(routeAst) === "publishModeEnabled") gateExpression = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(routeAst);
  assert.ok(gateExpression, "the route must decide the rollout gate before its provider mutation");
  const routeGate = new Function("draft", "mode", "process", "isAdsChannelPublishEnabled", `return (${gateExpression.getText(routeAst)});`);
  for (const mode of ["live", "paused", "demo_paused"] as const) {
    for (const sharedFlag of ["false", "true"]) {
      for (const dedicatedFlag of [undefined, "false", "true"]) {
        const environment = {
          INRCY_ADS_LIVE_PUBLISH_ENABLED: sharedFlag,
          INRCY_ADS_DEMO_PAUSED_PUBLISH_ENABLED: sharedFlag,
          INRCY_LINKEDIN_ADS_PUBLISH_ENABLED: dedicatedFlag,
        };
        assert.equal(routeGate({ provider: "linkedin" }, mode, { env: environment }, isAdsChannelPublishEnabled), dedicatedFlag === "true");
        assert.equal(routeGate({ provider: "meta" }, mode, { env: environment }, isAdsChannelPublishEnabled), sharedFlag === "true");
      }
    }
  }
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
type RuntimeEvidence = (
  userId: string, draft: AdsCampaignInput, target: "ACTIVE" | "PAUSED", fetchImpl: typeof fetch,
  sleep: (milliseconds: number) => Promise<void>, now: () => number,
) => Promise<{ geoUrns: string[] }>;

const runtimeSource = ts.transpileModule(
  readFileSync(new URL("../lib/adsLinkedInPublisherServer.ts", import.meta.url), "utf8")
    + "\nexport { collectPublicationEvidence };",
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
  geoTargets?: Array<{ urn: string; name: string }>;
  resourcePayloads?: { groups?: unknown; organizations?: unknown; locales?: unknown; geos?: unknown; typeahead?: unknown };
} = {}) {
  let remoteStatus = options.remoteStatus || "DRAFT";
  let mediaReads = 0;
  const requests: Array<{ method: string; path: string; query: string; body?: string }> = [];
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
    ["./adsLinkedInGeoResolution.ts", linkedInGeoResolution],
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
  const loaded = { exports: {} as { publishLinkedInAdsCampaign: RuntimePublisher; collectPublicationEvidence: RuntimeEvidence } };
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
    requests.push({ method, path: request.pathname, query: request.search, body: typeof init?.body === "string" ? init.body : undefined });
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
    if (request.pathname.endsWith("/adCampaignGroups")) return Response.json(options.resourcePayloads?.groups ?? { elements: [{
      id: 456, account: `urn:li:sponsoredAccount:${account.id}`, status: "ACTIVE", objectiveType: "WEBSITE_VISIT",
      allowedCampaignTypes: ["SPONSORED_UPDATES"], runSchedule: { start: recoveryNow - 60_000 },
    }] });
    if (request.pathname === "/rest/organizationAcls") return Response.json(options.resourcePayloads?.organizations ?? { elements: [{
      state: "APPROVED", role: "CONTENT_ADMINISTRATOR", organization: "urn:li:organization:789",
    }] });
    if (request.pathname === "/rest/adTargetingEntities") {
      if (request.searchParams.get("q") === "urns") return Response.json(options.resourcePayloads?.geos ?? { elements: [
        { urn: "urn:li:geo:105015875", name: "France", facetUrn: "urn:li:adTargetingFacet:locations" },
      ] });
      if (request.searchParams.get("q") === "typeahead") return Response.json(options.resourcePayloads?.typeahead ?? { elements: [] });
      return Response.json(options.resourcePayloads?.locales ?? { elements: [{ urn: "urn:li:locale:fr_FR" }] });
    }
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
    linkedinGeoTargets: options.geoTargets ?? [{ urn: "urn:li:geo:105015875", name: "France" }], linkedinBidEuros: 2.5,
    linkedinPoliticalIntentConfirmed: true, linkedinTargetingNoticeAcknowledged: true,
  } as AdsCampaignInput;
  return {
    requests, mediaReads: () => mediaReads,
    evidence: () => loaded.exports.collectPublicationEvidence("owner", draft, target, fetchImpl, async () => {}, () => recoveryNow),
    run: (checkpoint: LinkedInAdsPublishProgress, persist: (value: LinkedInAdsPublishProgress) => Promise<void>) =>
      loaded.exports.publishLinkedInAdsCampaign("owner", draft, persist, {
        operationKey, activate: target === "ACTIVE", initialProgress: checkpoint, fetchImpl,
        now: () => recoveryNow, sleep: async () => {},
      }),
  };
}

const selectedGeo = {
  urn: "urn:li:geo:105015875", name: "France", facetUrn: "urn:li:adTargetingFacet:locations",
};

test("initial publication evidence keeps a selected verified location when an unrelated provider row is malformed", async () => {
  const runtime = recoveryRuntime("ACTIVE", { resourcePayloads: {
    geos: { elements: [
      selectedGeo,
      { urn: "urn:li:geo:999999", name: "Unrelated incomplete row" },
      { urn: "urn:li:geo:888888", name: "Unrelated facet", facetUrn: "urn:li:adTargetingFacet:titles" },
    ] },
  } });
  assert.deepEqual((await runtime.evidence()).geoUrns, [selectedGeo.urn]);
  assert.ok(runtime.requests.every((request) => request.method === "GET"));
  assert.equal(runtime.requests.filter((request) => request.query.includes("q=typeahead")).length, 0);
  assert.ok(runtime.requests.some((request) => request.path === "/rest/audienceCounts"));
  assert.ok(runtime.requests.some((request) => request.path === "/rest/adBudgetPricing"));
});

test("initial publication evidence resolves incomplete urns results only through fresh typeahead evidence for that same URN", async () => {
  for (const geos of [
    { elements: [] },
    { elements: [{ urn: selectedGeo.urn }] },
    { results: {} },
  ]) {
    const runtime = recoveryRuntime("ACTIVE", { resourcePayloads: {
      geos, typeahead: { elements: [selectedGeo] },
      organizations: { elements: [{ state: "APPROVED", role: "ADMINISTRATOR", organizationTarget: "urn:li:organization:789" }] },
    } });
    assert.deepEqual((await runtime.evidence()).geoUrns, [selectedGeo.urn]);
    const searches = runtime.requests.filter((request) => request.query.includes("q=typeahead"));
    assert.equal(searches.length, 1);
    assert.equal(new URLSearchParams(searches[0].query).get("query"), "France");
    assert.ok(runtime.requests.every((request) => request.method === "GET"));
  }
});

test("initial publication evidence preserves all seven selected URNs while completing only incomplete provider metadata", async () => {
  const geoTargets = ["Arras", "Lille", "Valenciennes", "Saint-Omer", "Cambrai", "Sallaumines", "Harnes"]
    .map((name, index) => ({ urn: `urn:li:geo:${100000001 + index}`, name, facetUrn: selectedGeo.facetUrn }));
  const runtime = recoveryRuntime("ACTIVE", {
    geoTargets,
    resourcePayloads: {
      geos: { elements: [...geoTargets.slice(0, 4), ...geoTargets.slice(4).map(({ urn }) => ({ urn }))] },
      typeahead: { elements: geoTargets },
    },
  });
  const expectedUrns = geoTargets.map(({ urn }) => urn);
  assert.deepEqual((await runtime.evidence()).geoUrns, expectedUrns);
  assert.equal(runtime.requests.filter((request) => request.query.includes("q=typeahead")).length, 3);
  for (const request of runtime.requests.filter((request) => ["/rest/audienceCounts", "/rest/adBudgetPricing"].includes(request.path))) {
    for (const urn of expectedUrns) assert.ok(decodeURIComponent(request.query).includes(urn), `${request.path} omitted ${urn}`);
  }
  assert.ok(runtime.requests.every((request) => request.method === "GET"));
});

test("initial publication rechecks seven profileLocations URNs through fresh exact locations typeahead", async () => {
  const geoTargets = ["Arras", "Lille", "Valenciennes", "Saint-Omer", "Cambrai", "Sallaumines", "Harnes"]
    .map((name, index) => ({ urn: `urn:li:geo:${100000001 + index}`, name, facetUrn: selectedGeo.facetUrn }));
  const runtime = recoveryRuntime("ACTIVE", {
    geoTargets,
    resourcePayloads: {
      geos: { elements: geoTargets.map((target) => ({ ...target, facetUrn: "urn:li:adTargetingFacet:profileLocations" })) },
      typeahead: { elements: geoTargets },
    },
  });
  const expectedUrns = geoTargets.map(({ urn }) => urn);
  assert.deepEqual((await runtime.evidence()).geoUrns, expectedUrns);
  const searches = runtime.requests.filter((request) => request.query.includes("q=typeahead"));
  assert.equal(searches.length, 7);
  assert.deepEqual(searches.map(({ query }) => new URLSearchParams(query).get("query")), geoTargets.map(({ name }) => name));
  for (const request of runtime.requests.filter((request) => ["/rest/audienceCounts", "/rest/adBudgetPricing"].includes(request.path))) {
    for (const urn of expectedUrns) assert.ok(decodeURIComponent(request.query).includes(urn), `${request.path} omitted ${urn}`);
  }
  assert.ok(runtime.requests.every((request) => request.method === "GET"));
});

test("initial publisher rejects unverified, substituted or contradictory geography before any provider mutation", async () => {
  const cases = [
    { geos: { elements: [] }, typeahead: { elements: [] } },
    { geos: { elements: [] }, typeahead: { elements: [{ ...selectedGeo, urn: "urn:li:geo:999999" }] } },
    { geos: { elements: [{ urn: selectedGeo.urn }] }, typeahead: { elements: [{ ...selectedGeo, facetUrn: "urn:li:adTargetingFacet:titles" }] } },
    { geos: { elements: [{ ...selectedGeo, facetUrn: "urn:li:adTargetingFacet:titles" }] }, typeahead: { elements: [selectedGeo] } },
    { geos: { elements: [{ ...selectedGeo, facetUrn: "urn:li:adTargetingFacet:industries" }] }, typeahead: { elements: [selectedGeo] } },
    { geos: { elements: [{ ...selectedGeo, facetUrn: "urn:li:adTargetingFacet:profileLocations" }] }, typeahead: { elements: [] } },
    { geos: { elements: [{ ...selectedGeo, facetUrn: "urn:li:adTargetingFacet:profileLocations" }] }, typeahead: { elements: [{ ...selectedGeo, urn: "urn:li:geo:999999" }] } },
    { geos: { elements: [{ ...selectedGeo, facetUrn: "urn:li:adTargetingFacet:profileLocations" }] }, typeahead: { elements: [{ ...selectedGeo, urn: "urn:li:organization:105015875" }] } },
  ];
  for (const resourcePayloads of cases) {
    const runtime = recoveryRuntime("ACTIVE", { resourcePayloads });
    await assert.rejects(runtime.run(progress({ targetStatus: "ACTIVE" }), async () => {
      assert.fail("No checkpoint may be written before all resource evidence is valid");
    }), /zone LinkedIn.*vérifiable/);
    assert.ok(runtime.requests.length > 0);
    assert.ok(runtime.requests.every((request) => request.method === "GET"), JSON.stringify(resourcePayloads));
    assert.equal(runtime.requests.some((request) => request.path === "/rest/audienceCounts"), false);
  }
});

test("initial publisher identifies malformed group, Page authorization and locale responses separately before mutation", async () => {
  const cases = [
    { resourcePayloads: { groups: { elements: [{ id: "invalid" }] } }, message: /groupes de campagnes renvoyés par LinkedIn/ },
    { resourcePayloads: { organizations: { elements: [{ state: "APPROVED", role: "ADMINISTRATOR", organization: "invalid" }] } }, message: /autorisations de Page renvoyées par LinkedIn/ },
    { resourcePayloads: { locales: { elements: [{ urn: "invalid" }] } }, message: /langues renvoyées par LinkedIn/ },
  ];
  for (const { resourcePayloads, message } of cases) {
    const runtime = recoveryRuntime("ACTIVE", { resourcePayloads });
    await assert.rejects(runtime.run(progress({ targetStatus: "ACTIVE" }), async () => {
      assert.fail("Invalid resources cannot persist a successful preflight");
    }), message);
    assert.ok(runtime.requests.every((request) => request.method === "GET"));
  }
});

test("publication readiness rejects incompatible group dates before uploading or creating anything", async () => {
  for (const runSchedule of [
    { start: recoveryNow - 60_000, end: Date.parse("2026-10-05T23:59:59Z") },
    { start: recoveryNow - 86_400_000, end: recoveryNow - 1 },
    { start: Date.parse("2026-10-11T00:00:00Z") },
    { start: recoveryNow - 60_000, end: recoveryNow + 60_000 },
  ]) {
    for (const target of ["ACTIVE", "PAUSED"] as const) {
      const runtime = recoveryRuntime(target, { resourcePayloads: { groups: { elements: [{
        id: 456, account: "urn:li:sponsoredAccount:558357276", status: "ACTIVE", objectiveType: "WEBSITE_VISIT",
        allowedCampaignTypes: ["SPONSORED_UPDATES"], runSchedule,
      }] } } });
      await assert.rejects(runtime.evidence(), /dates de la campagne.*groupe LinkedIn/);
      await assert.rejects(runtime.run(progress({ targetStatus: target }), async () => {
        assert.fail("Incompatible group dates cannot persist successful publication evidence");
      }), /dates de la campagne.*groupe LinkedIn/);
      assert.ok(runtime.requests.every((request) => request.method === "GET"));
      assert.equal(runtime.requests.some((request) => request.path === "/rest/images"), false);
      assert.equal(runtime.requests.some((request) => request.path === "/rest/audienceCounts"), false);
    }
  }
});

test("publication readiness accepts a future group start and an end equal to the campaign end", async () => {
  const runtime = recoveryRuntime("ACTIVE", { resourcePayloads: { groups: { elements: [{
    id: 456, account: "urn:li:sponsoredAccount:558357276", status: "ACTIVE", objectiveType: "WEBSITE_VISIT",
    allowedCampaignTypes: ["SPONSORED_UPDATES"],
    runSchedule: { start: Date.parse("2026-10-03T10:00:00Z"), end: Date.parse("2026-10-10T23:59:59Z") },
  }] } } });
  assert.deepEqual((await runtime.evidence()).geoUrns, [selectedGeo.urn]);
  assert.ok(runtime.requests.every((request) => request.method === "GET"));
});

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
