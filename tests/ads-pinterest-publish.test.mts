import assert from "node:assert/strict";
import test from "node:test";

import { PINTEREST_ADS_CREATION_PATHS, preflightPinterestDraftCampaign } from "../lib/adsPinterestPublish.ts";

const draft = {
  schemaVersion: 1,
  channel: "pinterest",
  name: "Découverte du service",
  objectiveType: "CONSIDERATION",
  intendedPromotionType: "STANDARD_AD",
  creativeType: "REGULAR",
  budget: { amount: 12.5, currency: "EUR", period: "daily", level: "campaign" },
  audience: { locationBriefs: ["France"], audienceBrief: "Professionnels francophones" },
  creative: {
    pinTitle: "Découvrir iNrCy",
    pinDescription: "Présenter la plateforme et ses services.",
    visualBrief: "Visuel clair du service et de l’interface.",
    destinationUrl: "https://example.com/offre",
  },
  externalRefs: { adAccountId: "123456789012", pinId: "234567890123", geoCodes: ["FR"] },
};

const context = {
  selectedAccount: {
    id: "123456789012", name: "Annonceur", currency: "EUR", country: "FR",
    permissions: ["ADMIN"], canManageCampaigns: true, eligibleToAssociate: true,
  },
  grantedScopes: "ads:read,ads:write,boards:read,boards:write,pins:read,pins:write",
  appAccess: "verified" as const,
  billing: "verified" as const,
  campaignWritePermission: "verified" as const,
  verifiedAt: 1_000_000,
};

test("Pinterest campaign preparation uses native DRAFT and exact microcurrency", () => {
  assert.equal(PINTEREST_ADS_CREATION_PATHS.campaigns("123456789012"), "/v5/ad_accounts/123456789012/campaigns");
  const prepared = preflightPinterestDraftCampaign({ ...draft, status: "ACTIVE" }, context, 1_100_000);
  assert.deepEqual(prepared.issues, []);
  assert.equal(prepared.publicationReady, false);
  assert.deepEqual(prepared.campaign, {
    name: "Découverte du service",
    status: "DRAFT",
    objective_type: "CONSIDERATION",
    intended_promotion_type: "STANDARD_AD",
    is_campaign_budget_optimization: true,
    daily_spend_cap: 12_500_000,
    is_flexible_daily_budgets: false,
  });
});

test("Pinterest lifetime and daily budgets never mix", () => {
  const prepared = preflightPinterestDraftCampaign({
    ...draft, budget: { ...draft.budget, amount: 20, period: "lifetime" },
  }, context, 1_100_000);
  assert.deepEqual(prepared.issues, []);
  assert.equal(prepared.campaign?.lifetime_spend_cap, 20_000_000);
  assert.equal("daily_spend_cap" in (prepared.campaign || {}), false);
});

test("Pinterest draft fails closed without verified app, billing and write access", () => {
  const prepared = preflightPinterestDraftCampaign(draft, {
    ...context, appAccess: "unverified", billing: "unverified",
    campaignWritePermission: "unverified", grantedScopes: "ads:read",
  }, 1_100_000);
  assert.equal(prepared.campaign, null);
  assert.deepEqual(prepared.issues.map((item) => item.code), [
    "missing_ads_scopes", "app_access_unverified", "billing_unverified", "campaign_permission_unverified",
  ]);
});

test("Pinterest account role and account ID must match fresh provider evidence", () => {
  const prepared = preflightPinterestDraftCampaign(draft, {
    ...context, selectedAccount: { ...context.selectedAccount, id: "987654321012", canManageCampaigns: null },
  }, 1_100_000);
  assert.equal(prepared.campaign, null);
  assert.deepEqual(prepared.issues.map((item) => item.code), ["invalid_account", "account_mismatch"]);
});

test("Pinterest rejects unsupported budget and incompatible campaign format", () => {
  const prepared = preflightPinterestDraftCampaign({
    ...draft,
    objectiveType: "VIDEO_COMPLETION",
    budget: { ...draft.budget, amount: 5.001 },
  }, context, 1_100_000);
  assert.equal(prepared.campaign, null);
  assert.deepEqual(prepared.issues.map((item) => item.code), ["invalid_brief", "unsupported_budget"]);
});

test("Pinterest does not reuse old or future provider verification", () => {
  const old = preflightPinterestDraftCampaign(draft, context, 1_400_001);
  const future = preflightPinterestDraftCampaign(draft, { ...context, verifiedAt: 1_100_001 }, 1_100_000);
  assert.equal(old.campaign, null);
  assert.equal(future.campaign, null);
  assert.deepEqual(old.issues.map((item) => item.code), ["stale_provider_evidence"]);
  assert.deepEqual(future.issues.map((item) => item.code), ["stale_provider_evidence"]);
});
