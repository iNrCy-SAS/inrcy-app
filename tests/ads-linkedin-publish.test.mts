import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildLinkedInAdsFinalizationSteps,
  prepareLinkedInAdsDarkPost,
  prepareLinkedInAdsDraftCampaign,
  prepareLinkedInAdsDraftCreative,
  type LinkedInAdsCampaignEvidence,
  type LinkedInAdsDraftCampaignChoices,
} from "../lib/adsLinkedInPublish.ts";
import type { LinkedInAdsDraft } from "../lib/adsChannelDrafts.ts";

const now = Date.parse("2026-09-27T10:00:00Z");
const start = now + 60 * 60_000;
const end = start + 7 * 24 * 60 * 60_000;

function fixture(): {
  draft: LinkedInAdsDraft;
  evidence: LinkedInAdsCampaignEvidence;
  choices: LinkedInAdsDraftCampaignChoices;
} {
  return {
    draft: {
      schemaVersion: 1,
      channel: "linkedin",
      name: "Visites pour la rentrée",
      objectiveType: "WEBSITE_VISIT",
      format: "STANDARD_UPDATE",
      budget: { amount: 25, currency: "EUR", period: "daily", level: "campaign" },
      audience: { locationBriefs: ["France"], audienceBrief: "Professionnels intéressés par le service" },
      locale: { language: "fr", country: "FR" },
      creative: {
        introText: "Découvrez notre service aujourd’hui.",
        headline: "Un service pour vous",
        mediaBrief: "Une photo représentative de notre service",
        destinationUrl: "https://example.com/landing",
      },
      externalRefs: {
        adAccountUrn: "urn:li:sponsoredAccount:123",
        campaignGroupUrn: "urn:li:sponsoredCampaignGroup:456",
        organizationUrn: "urn:li:organization:789",
        creativeAssetUrn: "urn:li:image:C4D10AQFexample",
        geoUrns: ["urn:li:geo:105015875"],
      },
    },
    evidence: {
      fetchedAtMs: now - 1000,
      selectedAccountId: "123",
      scopes: "rw_ads r_ads_reporting r_organization_admin w_organization_social",
      account: {
        id: "123", name: "Compte test", currency: "EUR", country: "FR", status: "ACTIVE", type: "BUSINESS",
        productType: "", servingStatuses: ["RUNNABLE"], test: false,
        permissions: ["CAMPAIGN_MANAGER"], canManageCampaigns: true, canServeCampaigns: true,
      },
      campaignGroup: {
        id: "456", account: "urn:li:sponsoredAccount:123", status: "ACTIVE", objectiveType: "WEBSITE_VISIT",
        runSchedule: { start: now - 60_000, end: end + 60_000 },
      },
      organization: { urn: "urn:li:organization:789", role: "DIRECT_SPONSORED_CONTENT_POSTER" },
      image: {
        urn: "urn:li:image:C4D10AQFexample", owner: "urn:li:organization:789", status: "AVAILABLE",
        associatedAccount: "urn:li:sponsoredAccount:123",
      },
      geoUrns: ["urn:li:geo:105015875"],
      supportedLocales: [{ language: "fr", country: "FR" }],
    },
    choices: {
      bidAmount: "2.50", startAtMs: start, endAtMs: end,
      politicalIntentConfirmed: true, discriminationNoticeAcknowledged: true,
    },
  };
}

test("LinkedIn serializes only a non-serving DRAFT campaign with verified resources", () => {
  const { draft, evidence, choices } = fixture();
  const result = prepareLinkedInAdsDraftCampaign(draft, evidence, choices, now);
  assert.equal(result.readyForDraftCreate, true);
  assert.equal(result.publicationReady, false);
  assert.deepEqual(result.issues, []);
  assert.ok(result.request);
  assert.equal(result.request.method, "POST");
  assert.equal(result.request.path, "/rest/adAccounts/123/adCampaigns");
  assert.equal(result.request.headers["Linkedin-Version"], "202609");
  assert.equal(result.request.body.status, "DRAFT");
  assert.equal(result.request.body.objectiveType, "WEBSITE_VISIT");
  assert.equal(result.request.body.type, "SPONSORED_UPDATES");
  assert.equal(result.request.body.costType, "CPC");
  assert.equal(result.request.body.politicalIntent, "NOT_POLITICAL");
  assert.equal(result.request.body.dailyBudget.amount, "25.00");
  assert.equal(result.request.body.unitCost.amount, "2.50");
  assert.deepEqual(result.request.body.targetingCriteria.include.and, [
    { or: { "urn:li:adTargetingFacet:interfaceLocales": ["urn:li:locale:fr_FR"] } },
    { or: { "urn:li:adTargetingFacet:locations": ["urn:li:geo:105015875"] } },
  ]);
  assert.equal(JSON.stringify(result.request).includes("creativeAssetUrn"), false);
  assert.equal(JSON.stringify(result.request).includes("ACTIVE"), false);
});

test("LinkedIn requires both regulatory confirmations", () => {
  const { draft, evidence, choices } = fixture();
  choices.politicalIntentConfirmed = false;
  choices.discriminationNoticeAcknowledged = false;
  const result = prepareLinkedInAdsDraftCampaign(draft, evidence, choices, now);
  assert.equal(result.readyForDraftCreate, false);
  assert.ok(result.issues.some((item) => item.code === "political_intent_confirmation_required"));
  assert.ok(result.issues.some((item) => item.code === "targeting_notice_acknowledgement_required"));
});

test("LinkedIn serializes a dark post then a separate DRAFT creative", () => {
  const { draft, evidence } = fixture();
  const post = prepareLinkedInAdsDarkPost(draft, evidence, now);
  assert.equal(post.readyForDraftCreate, true);
  assert.ok(post.request);
  assert.equal(post.request.path, "/rest/posts");
  assert.equal(post.request.body.distribution.feedDistribution, "NONE");
  assert.equal(post.request.body.adContext.dscStatus, "ACTIVE");
  assert.equal(post.request.body.content.media.id, "urn:li:image:C4D10AQFexample");

  evidence.campaign = {
    urn: "urn:li:sponsoredCampaign:1001", account: "urn:li:sponsoredAccount:123", status: "DRAFT",
  };
  const creative = prepareLinkedInAdsDraftCreative(
    draft, evidence, "urn:li:sponsoredCampaign:1001", "urn:li:share:2002", now,
  );
  assert.equal(creative.readyForDraftCreate, true);
  assert.ok(creative.request);
  assert.equal(creative.request.path, "/rest/adAccounts/123/creatives");
  assert.equal(creative.request.body.intendedStatus, "DRAFT");
  assert.equal(creative.request.body.content.reference, "urn:li:share:2002");
});

test("LinkedIn finalization makes the creative reviewable before the campaign status switch", () => {
  const steps = buildLinkedInAdsFinalizationSteps(
    "123", "urn:li:sponsoredCampaign:1001", "urn:li:sponsoredCreative:3003", "PAUSED",
  );
  assert.equal(steps.length, 2);
  assert.equal(steps[0].body.patch.$set.intendedStatus, "ACTIVE");
  assert.equal(steps[1].body.patch.$set.status, "PAUSED");
  assert.equal(steps[0].path, "/rest/adAccounts/123/creatives/urn%3Ali%3AsponsoredCreative%3A3003");
  assert.equal(steps[1].path, "/rest/adAccounts/123/adCampaigns/1001");
});

test("LinkedIn blocks dark posts and creatives without fresh step-specific authorization evidence", () => {
  const { draft, evidence } = fixture();
  evidence.scopes = "rw_ads r_ads_reporting r_organization_admin";
  const post = prepareLinkedInAdsDarkPost(draft, evidence, now);
  assert.equal(post.readyForDraftCreate, false);
  assert.ok(post.issues.some((item) => item.code === "organization_write_scope_required"));

  evidence.scopes = "w_organization_social";
  evidence.account.permissions = ["VIEWER"];
  evidence.account.canManageCampaigns = false;
  const viewerPost = prepareLinkedInAdsDarkPost(draft, evidence, now);
  assert.equal(viewerPost.readyForDraftCreate, false);
  assert.ok(viewerPost.issues.some((item) => item.code === "account_manage_access_unverified"));

  evidence.scopes = "rw_ads r_ads_reporting r_organization_admin w_organization_social";
  evidence.account.permissions = ["CAMPAIGN_MANAGER"];
  evidence.account.canManageCampaigns = true;
  evidence.campaign = {
    urn: "urn:li:sponsoredCampaign:1001", account: "urn:li:sponsoredAccount:999", status: "DRAFT",
  };
  evidence.fetchedAtMs = now - 6 * 60_000;
  const creative = prepareLinkedInAdsDraftCreative(
    draft, evidence, "urn:li:sponsoredCampaign:1001", "urn:li:share:2002", now,
  );
  assert.equal(creative.readyForDraftCreate, false);
  assert.ok(creative.issues.some((item) => item.code === "campaign_unverified"));
  assert.ok(creative.issues.some((item) => item.code === "platform_evidence_stale"));
});

test("LinkedIn rejects stale, read-only and mismatched account evidence", () => {
  const { draft, evidence, choices } = fixture();
  evidence.fetchedAtMs = now - 6 * 60_000;
  evidence.scopes = "r_ads";
  evidence.selectedAccountId = "999";
  const result = prepareLinkedInAdsDraftCampaign(draft, evidence, choices, now);
  assert.equal(result.readyForDraftCreate, false);
  assert.equal(result.request, null);
  assert.deepEqual(result.issues.filter((item) => ["platform_evidence_stale", "account_manage_access_unverified", "account_unverified"].includes(item.code)).map((item) => item.code).sort(), [
    "account_manage_access_unverified", "account_unverified", "platform_evidence_stale",
  ]);
});

test("LinkedIn rejects group, organization, geography and locale substitutions", () => {
  const { draft, evidence, choices } = fixture();
  evidence.campaignGroup.account = "urn:li:sponsoredAccount:999";
  evidence.organization.role = "VIEWER";
  evidence.geoUrns = ["urn:li:geo:999"];
  evidence.supportedLocales = [{ language: "en", country: "US" }];
  const result = prepareLinkedInAdsDraftCampaign(draft, evidence, choices, now);
  assert.equal(result.readyForDraftCreate, false);
  assert.equal(result.request, null);
  assert.ok(result.issues.some((item) => item.code === "campaign_group_unverified"));
  assert.ok(result.issues.some((item) => item.code === "organization_unverified"));
  assert.ok(result.issues.some((item) => item.code === "targeting_geos_unverified"));
  assert.ok(result.issues.some((item) => item.code === "locale_unverified"));
});

test("LinkedIn requires campaign-specific bid and schedule and blocks other draft formats", () => {
  const { draft, evidence, choices } = fixture();
  draft.format = "SINGLE_VIDEO";
  draft.budget.period = "lifetime";
  choices.bidAmount = "0";
  choices.startAtMs = now - 1000;
  const result = prepareLinkedInAdsDraftCampaign(draft, evidence, choices, now);
  assert.equal(result.readyForDraftCreate, false);
  assert.ok(result.issues.some((item) => item.code === "unsupported_creation_path" && item.field === "format"));
  assert.ok(result.issues.some((item) => item.code === "unsupported_creation_path" && item.field === "budget.period"));
  assert.ok(result.issues.some((item) => item.code === "manual_bid_required"));
  assert.ok(result.issues.some((item) => item.code === "invalid_schedule"));
});

test("LinkedIn requires enterprise group type allowance and never treats refs as proof", () => {
  const { draft, evidence, choices } = fixture();
  evidence.account.type = "ENTERPRISE";
  evidence.account.productType = "MARKETING_SOLUTIONS";
  evidence.campaignGroup.allowedCampaignTypes = ["TEXT_AD"];
  draft.externalRefs!.campaignGroupUrn = "urn:li:sponsoredCampaignGroup:999";
  const result = prepareLinkedInAdsDraftCampaign(draft, evidence, choices, now);
  assert.equal(result.readyForDraftCreate, false);
  assert.ok(result.issues.some((item) => item.code === "campaign_group_format_unverified"));
  assert.ok(result.issues.some((item) => item.code === "campaign_group_unverified"));
});
