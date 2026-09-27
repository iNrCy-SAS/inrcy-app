import assert from "node:assert/strict";
import test from "node:test";

import { preflightTikTokPausedCampaign, TIKTOK_ADS_CREATION_PATHS } from "../lib/adsTikTokPublish.ts";

const requestId = "0c6a0697-c608-4073-a0be-d5f7d82a6353";
const draft = {
  schemaVersion: 1,
  channel: "tiktok",
  name: "Trafic vidéo de démonstration",
  objectiveType: "TRAFFIC",
  format: "video",
  destinationKind: "website",
  placementIntent: "tiktok_only",
  optimizationIntent: "clicks",
  budget: { amount: 100, currency: "EUR", period: "lifetime", level: "campaign" },
  audience: { locationBriefs: ["France"], audienceBrief: "Adultes en France" },
  creative: { adText: "Découvrir le produit", videoBrief: "Vidéo verticale de présentation", destinationUrl: "https://example.com/offre" },
  externalRefs: { advertiserId: "123456789" },
};
const context = {
  selectedAccount: { id: "123456789", name: "Annonceur", currency: "EUR", status: "STATUS_ENABLE" },
  appAccess: "verified" as const,
  campaignWritePermission: "verified" as const,
  requestId,
};

test("TikTok v1.3 preflight shapes only an explicitly disabled campaign", () => {
  assert.deepEqual(TIKTOK_ADS_CREATION_PATHS, {
    campaign: "/campaign/create/", adGroup: "/adgroup/create/", ad: "/ad/create/",
  });
  const result = preflightTikTokPausedCampaign({ ...draft, operation_status: "ENABLE" }, context);
  assert.deepEqual(result.issues, []);
  assert.equal(result.publicationReady, false);
  assert.deepEqual(result.campaign, {
    advertiser_id: "123456789",
    campaign_name: draft.name,
    objective_type: "TRAFFIC",
    budget_optimize_on: true,
    budget_mode: "BUDGET_MODE_TOTAL",
    budget: 100,
    operation_status: "DISABLE",
    request_id: requestId,
  });
});

test("TikTok preflight fails closed before app and campaign-write approval", () => {
  const result = preflightTikTokPausedCampaign(draft, {
    ...context, appAccess: "unverified", campaignWritePermission: "unverified",
  });
  assert.equal(result.campaign, null);
  assert.deepEqual(result.issues.map((issue) => issue.code), [
    "app_access_unverified", "campaign_permission_unverified",
  ]);
});

test("TikTok preflight does not silently change daily spend or unsupported objectives", () => {
  const result = preflightTikTokPausedCampaign({
    ...draft,
    objectiveType: "WEB_CONVERSIONS",
    budget: { ...draft.budget, period: "daily" },
  }, context);
  assert.equal(result.campaign, null);
  assert.deepEqual(result.issues.map((issue) => issue.code), ["unsupported_objective", "unsupported_budget"]);
});

test("TikTok preflight rejects mismatched account and unsafe destination", () => {
  const result = preflightTikTokPausedCampaign({
    ...draft,
    creative: { ...draft.creative, destinationUrl: "http://example.com" },
  }, { ...context, selectedAccount: { ...context.selectedAccount, id: "987654321" } });
  assert.equal(result.campaign, null);
  assert.deepEqual(result.issues.map((issue) => issue.code), ["unsupported_destination", "advertiser_mismatch"]);
});
