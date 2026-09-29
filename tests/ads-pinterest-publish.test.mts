import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPinterestActivationSteps,
  buildPinterestAdOnlyPinBody,
  buildPinterestEntityStatusPatch,
  buildPinterestLiveAdBody,
  buildPinterestLiveAdGroupBody,
  buildPinterestLiveCampaignBody,
  PINTEREST_ADS_CREATION_PATHS,
  pinterestLiveConfigurationIssue,
  preflightPinterestDraftCampaign,
} from "../lib/adsPinterestPublish.ts";

const draft = {
  schemaVersion: 1,
  channel: "pinterest",
  name: "Découverte du service",
  objectiveType: "CONSIDERATION",
  intendedPromotionType: "STANDARD_AD",
  creativeType: "REGULAR",
  targetingMode: "automatic",
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

test("Pinterest live preflight refuses manual targeting and precise placements before mutation", () => {
  const keywordTargeting = preflightPinterestDraftCampaign({
    ...draft,
    targetingMode: "keywords",
  }, context, 1_100_000);
  assert.equal(keywordTargeting.campaign, null);
  assert.deepEqual(keywordTargeting.issues.map((item) => item.code), ["unsupported_targeting"]);

  const searchOnly = preflightPinterestDraftCampaign({
    ...draft,
    placementGroup: "SEARCH",
  }, context, 1_100_000);
  assert.equal(searchOnly.campaign, null);
  assert.deepEqual(searchOnly.issues.map((item) => item.code), ["unsupported_placement"]);
  const withKeywords = preflightPinterestDraftCampaign({ ...draft, keywords: ["idée cadeau"] }, context, 1_100_000);
  assert.equal(withKeywords.campaign, null);
  assert.deepEqual(withKeywords.issues.map((item) => item.code), ["unsupported_keywords"]);
  assert.match(pinterestLiveConfigurationIssue({ ...draft, targetingMode: "audiences" }) || "", /audiences/);
  assert.match(pinterestLiveConfigurationIssue(draft, ["idée cadeau"]) || "", /Mots-clés|mots-clés/);
  assert.match(pinterestLiveConfigurationIssue({ ...draft, placementGroup: "BROWSE" }) || "", /emplacements/);
});

test("Pinterest live payloads keep every entity paused and create an ad-only Pin", () => {
  assert.deepEqual(buildPinterestLiveCampaignBody({
    name: "Découverte Pinterest",
    objectiveType: "CONSIDERATION",
    dailySpendCap: 20_000_000,
    endTime: 1_800_000_000,
  }), {
    name: "Découverte Pinterest",
    status: "PAUSED",
    objective_type: "CONSIDERATION",
    intended_promotion_type: "STANDARD_AD",
    is_campaign_budget_optimization: true,
    is_flexible_daily_budgets: false,
    daily_spend_cap: 20_000_000,
    end_time: 1_800_000_000,
  });

  assert.deepEqual(buildPinterestLiveAdGroupBody({
    name: "Découverte Pinterest · Groupe d’annonces",
    campaignId: "111111111111",
    objectiveType: "CONSIDERATION",
    bidInMicroCurrency: 1_000_000,
    locationCodes: ["FR", "BE"],
  }), {
    name: "Découverte Pinterest · Groupe d’annonces",
    campaign_id: "111111111111",
    status: "PAUSED",
    billable_event: "CLICKTHROUGH",
    bid_in_micro_currency: 1_000_000,
    bid_strategy_type: "MAX_BID",
    placement_group: "ALL",
    auto_targeting_enabled: true,
    targeting_spec: { LOCATION: ["FR", "BE"] },
  });

  assert.deepEqual(buildPinterestAdOnlyPinBody({
    title: "Préparez votre projet",
    description: "Une idée utile à enregistrer.",
    destinationUrl: "https://example.fr/offre",
    imageUrl: "https://cdn.example.fr/image.jpg",
  }), {
    title: "Préparez votre projet",
    description: "Une idée utile à enregistrer.",
    link: "https://example.fr/offre",
    media_source: { source_type: "image_url", url: "https://cdn.example.fr/image.jpg", is_standard: true },
    is_removable: true,
  });

  assert.deepEqual(buildPinterestLiveAdBody({
    name: "Découverte Pinterest · Épingle sponsorisée",
    adGroupId: "222222222222",
    pinId: "333333333333",
    destinationUrl: "https://example.fr/offre",
  }), {
    name: "Découverte Pinterest · Épingle sponsorisée",
    ad_group_id: "222222222222",
    pin_id: "333333333333",
    creative_type: "REGULAR",
    status: "PAUSED",
    destination_url: "https://example.fr/offre",
    is_removable: true,
  });
});

test("Pinterest live status patches are explicit and never default to ACTIVE", () => {
  assert.deepEqual(buildPinterestEntityStatusPatch("123456789012", "PAUSED"), [
    { id: "123456789012", status: "PAUSED" },
  ]);
  assert.deepEqual(buildPinterestEntityStatusPatch("123456789012", "ACTIVE"), [
    { id: "123456789012", status: "ACTIVE" },
  ]);
  assert.deepEqual(buildPinterestActivationSteps("999999999999", {
    campaignId: "111111111111",
    adGroupId: "222222222222",
    adId: "333333333333",
  }), [
    {
      path: "/ad_accounts/999999999999/ads",
      body: [{ id: "333333333333", status: "ACTIVE" }],
      stage: "ad_activated",
    },
    {
      path: "/ad_accounts/999999999999/ad_groups",
      body: [{ id: "222222222222", status: "ACTIVE" }],
      stage: "ad_group_activated",
    },
    {
      path: "/ad_accounts/999999999999/campaigns",
      body: [{ id: "111111111111", status: "ACTIVE" }],
      stage: "active",
    },
  ]);
});

test("Pinterest does not reuse old or future provider verification", () => {
  const old = preflightPinterestDraftCampaign(draft, context, 1_400_001);
  const future = preflightPinterestDraftCampaign(draft, { ...context, verifiedAt: 1_100_001 }, 1_100_000);
  assert.equal(old.campaign, null);
  assert.equal(future.campaign, null);
  assert.deepEqual(old.issues.map((item) => item.code), ["stale_provider_evidence"]);
  assert.deepEqual(future.issues.map((item) => item.code), ["stale_provider_evidence"]);
});
