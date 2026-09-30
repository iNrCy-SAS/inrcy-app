import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { hasCompleteInitialPublishResources, parseAdsCampaignLifecycleRequest } from "../lib/adsCampaignLifecycle.ts";
import { isAdsChannelPublishEnabled } from "../lib/adsPublishMode.ts";
import { createGoogleAdsRemoteCampaignCoreAdapter, GoogleAdsRemoteCampaignError, type GoogleAdsRemoteRequest } from "../lib/adsGoogleRemoteCampaignCore.ts";

const path = "app/api/ads/campaigns/[id]/lifecycle/route.ts";
const source = ts.createSourceFile(path, readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
function actualFunction(name: string, scope: Record<string, unknown> = {}) {
  const declaration = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `The lifecycle route must define ${name}`);
  const compiled = ts.transpileModule(declaration.getText(source).replace(/^export\s+/, ""), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(scope), `${compiled}\nreturn ${name};`)(...Object.values(scope));
}
const record = actualFunction("record");
const lifecycleRecovery = actualFunction("lifecycleRecovery", {
  record, normalizedRecoveryChanges: actualFunction("normalizedRecoveryChanges", { record }),
});
const disabled = {
  INRCY_GOOGLE_ADS_PUBLISH_ENABLED: "false", INRCY_PINTEREST_ADS_PUBLISH_ENABLED: "false",
  INRCY_LINKEDIN_ADS_PUBLISH_ENABLED: "false", INRCY_ADS_LIVE_PUBLISH_ENABLED: "false",
};

async function exercise(provider: string, body: Record<string, unknown>, recovery?: Record<string, unknown>, enabled = false) {
  const campaign = {
    id: "campaign", provider, status: recovery ? "needs_review" : "paused", ad_account_id: "1234567890",
    provider_resources: recovery ? { inrcyLifecycleRecovery: recovery } : {}, draft: { name: "Campaign" },
    daily_budget_cents: 1000, end_date: "2026-11-01", published_at: null,
  };
  let claims = 0;
  let providerCalls = 0;
  const query = {
    update() { return this; }, eq() { return this; }, select() { return this; },
    maybeSingle: async () => ({ data: { id: campaign.id }, error: null }),
  };
  const patch = actualFunction("PATCH", {
    authorizeRemoteLifecycle: async () => ({ campaign, user: { activeUserId: "business" }, account: {} }),
    parseAdsCampaignLifecycleRequest, lifecycleRecovery, isAdsChannelPublishEnabled,
    process: { env: enabled ? { ...disabled, INRCY_GOOGLE_ADS_PUBLISH_ENABLED: "true", INRCY_PINTEREST_ADS_PUBLISH_ENABLED: "true", INRCY_LINKEDIN_ADS_PUBLISH_ENABLED: "true", INRCY_ADS_LIVE_PUBLISH_ENABLED: "true" } : disabled },
    NextResponse: { json: (payload: unknown, options: { status?: number } = {}) => ({ status: options.status || 200, payload }) },
    claimCampaign: async () => { claims += 1; return { claimedAt: "2026-09-30T10:00:00Z" }; },
    executeRemoteAction: async () => { providerCalls += 1; return { providerResources: {}, status: "paused" }; },
    withoutLifecycleMetadata: actualFunction("withoutLifecycleMetadata", { record }),
    supabaseAdmin: { from: () => query }, hasRemoteArchiveConfirmation: () => true,
  });
  const result = await patch(new Request("https://app.example/api/ads/campaigns/campaign/lifecycle", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: campaign.id }) });
  return { result, claims, providerCalls };
}

test("disabled channels reject resume before claiming or making provider mutations", async () => {
  for (const provider of ["google", "pinterest", "linkedin", "meta"]) {
    for (const recovery of [undefined, { operation: "resume", previousStatus: "paused" }]) {
      const { result, claims, providerCalls } = await exercise(provider, { action: recovery ? "reconcile" : "resume" }, recovery);
      assert.equal(result.status, 423, provider);
      assert.equal(result.payload.code, "ADS_CHANNEL_PUBLICATION_DISABLED");
      assert.equal(claims, 0, provider);
      assert.equal(providerCalls, 0, provider);
    }
  }
});

test("LinkedIn initial publication recovery respects the switch even for paused creation", async () => {
  for (const mode of ["live", "paused", "demo_paused"]) {
    const { result, claims, providerCalls } = await exercise("linkedin", { action: "reconcile" }, { operation: "initial_publish", mode });
    assert.equal(result.status, 423, mode);
    assert.equal(claims, 0);
    assert.equal(providerCalls, 0);
  }
});

test("disabled channels still allow pause and read-only reconciliation", async () => {
  for (const provider of ["google", "pinterest", "linkedin", "meta"]) {
    for (const action of ["pause", "reconcile"]) {
      const { result, claims, providerCalls } = await exercise(provider, { action });
      assert.equal(result.status, 200, `${provider} ${action}`);
      assert.equal(claims, 1);
      assert.equal(providerCalls, 1);
    }
  }
  for (const provider of ["google", "pinterest", "meta"]) {
    const { result } = await exercise(provider, { action: "reconcile" }, { operation: "initial_publish", mode: "live" });
    assert.equal(result.status, 200, `${provider} only reads initial publication state`);
  }
});

test("enabled providers can resume their already authorized real campaigns", async () => {
  for (const provider of ["google", "pinterest", "linkedin", "meta"]) {
    const { result, claims, providerCalls } = await exercise(provider, { action: "resume" }, undefined, true);
    assert.equal(result.status, 200, provider);
    assert.equal(claims, 1);
    assert.equal(providerCalls, 1);
  }
});

test("Google reconciliation consumes first activation before a later manual pause and ordinary resume", async () => {
  const customerId = "1234567890";
  const campaignResourceName = `customers/${customerId}/campaigns/111`;
  const budgetResourceName = `customers/${customerId}/campaignBudgets/222`;
  let remoteStatus = "ENABLED";
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const request: GoogleAdsRemoteRequest = async (path, body) => {
    calls.push({ path, body });
    const query = String(body.query || "");
    if (query.includes("FROM campaign WHERE")) return { results: [{
      campaign: { resourceName: campaignResourceName, campaignBudget: budgetResourceName, name: "Campagne", status: remoteStatus, endDateTime: "2026-11-01 23:59:59" },
      campaignBudget: { resourceName: budgetResourceName, amountMicros: "10000000", explicitlyShared: false, referenceCount: "1" },
    }] };
    if (query.includes("FROM campaign_criterion")) return { results: [] };
    if (path.endsWith("/campaigns:mutate")) {
      const operation = (body.operations as { update: { status: string } }[])[0];
      remoteStatus = operation.update.status;
      return { results: [{ resourceName: campaignResourceName }] };
    }
    throw new Error("No child read or activation is allowed after the initial activation was observed.");
  };
  const execute = actualFunction("executeRemoteAction", {
    lifecycleRecovery, hasCompleteInitialPublishResources, GoogleAdsRemoteCampaignError,
    pausedLocalStatus: actualFunction("pausedLocalStatus"),
    createGoogleAdsRemoteCampaignAdapter: (input: { adAccountId: string; providerResources: unknown }) => createGoogleAdsRemoteCampaignCoreAdapter({
      expectedCustomerId: input.adAccountId, providerResources: input.providerResources,
      request, resolveTargetLocations: async () => [],
    }),
  });
  const campaign = {
    provider: "google", status: "needs_review", ad_account_id: customerId,
    provider_resources: {
      customerId, campaignResourceName, budgetResourceName, locationCriterionResourceNames: [],
      adGroupResourceName: `customers/${customerId}/adGroups/333`,
      adGroupAdResourceName: `customers/${customerId}/adGroupAds/333~444`,
      keywordCriterionResourceNames: [`customers/${customerId}/adGroupCriteria/333~555`],
      initialActivationPending: true,
      inrcyLifecycleRecovery: { operation: "initial_publish", mode: "live" },
    },
  };
  const common = { userId: "professional", claimedAt: "2026-09-30T10:00:00Z" };
  const reconciled = await execute({ ...common, campaign, request: { action: "reconcile", changes: {} } });
  assert.equal(reconciled.status, "active");
  assert.equal(reconciled.providerResources.initialActivationPending, false);

  // A professional now pauses the parent and an ad directly in Google Ads.
  // iNrCy's pause no-op must retain the consumed marker, then resume only parent.
  remoteStatus = "PAUSED";
  const paused = await execute({ ...common, campaign: { ...campaign, status: "active", provider_resources: reconciled.providerResources }, request: { action: "pause", changes: {} } });
  assert.equal(paused.status, "paused");
  assert.equal(paused.providerResources.initialActivationPending, false);
  const resumed = await execute({ ...common, campaign: { ...campaign, status: "paused", provider_resources: paused.providerResources }, request: { action: "resume", changes: {} } });
  assert.equal(resumed.status, "active");
  assert.equal(resumed.providerResources.initialActivationPending, false);
  assert.deepEqual(calls.filter((call) => call.path.endsWith(":mutate")).map((call) => call.path), [`customers/${customerId}/campaigns:mutate`]);
});
