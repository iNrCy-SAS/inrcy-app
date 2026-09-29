import assert from "node:assert/strict";
import { test } from "node:test";
import {
  prepareLinkedInAdsDraftCampaign,
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
        creativeAssetUrn: "urn:li:image:asset",
        geoUrns: ["urn:li:geo:105015875"],
      },
    },
    evidence: {
      fetchedAtMs: now - 1000,
      selectedAccountId: "123",
      scopes: "rw_ads",
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
      geoUrns: ["urn:li:geo:105015875"],
      supportedLocales: [{ language: "fr", country: "FR" }],
    },
    choices: { bidAmount: "2.50", startAtMs: start, endAtMs: end },
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
  assert.equal(result.request.body.dailyBudget.amount, "25.00");
  assert.equal(result.request.body.unitCost.amount, "2.50");
  assert.deepEqual(result.request.body.targetingCriteria.include.and, [
    { or: { "urn:li:adTargetingFacet:interfaceLocales": ["urn:li:locale:fr_FR"] } },
    { or: { "urn:li:adTargetingFacet:locations": ["urn:li:geo:105015875"] } },
  ]);
  assert.equal(JSON.stringify(result.request).includes("creativeAssetUrn"), false);
  assert.equal(JSON.stringify(result.request).includes("ACTIVE"), false);
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
