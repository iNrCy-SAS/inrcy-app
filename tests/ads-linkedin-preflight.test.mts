import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildLinkedInAdsAudienceCountPath,
  buildLinkedInAdsBudgetPricingPath,
  buildLinkedInAdsGeoSearchPath,
  buildLinkedInAdsGeoUrnsPath,
  linkedInAdsPreflightBlockers,
  normalizeLinkedInAdsAudienceCount,
  normalizeLinkedInAdsBudgetPricing,
  normalizeLinkedInAdsCampaignGroup,
  normalizeLinkedInAdsImage,
  normalizeLinkedInAdsLocales,
  normalizeLinkedInAdsTargetingEntities,
} from "../lib/adsLinkedInPreflightPolicy.ts";

const group = {
  id: 456,
  account: "urn:li:sponsoredAccount:123",
  name: "Groupe test",
  status: "ACTIVE",
  objectiveType: "WEBSITE_VISIT",
  allowedCampaignTypes: ["SPONSORED_UPDATES"],
  runSchedule: { start: 1_800_000_000_000 },
};

test("LinkedIn preflight normalizes only resources belonging to the selected account", () => {
  const normalized = normalizeLinkedInAdsCampaignGroup(group, "123");
  assert.equal(normalized?.urn, "urn:li:sponsoredCampaignGroup:456");
  assert.equal(normalizeLinkedInAdsCampaignGroup(group, "999"), null);
  assert.deepEqual(normalizeLinkedInAdsTargetingEntities({ elements: [{
    urn: "urn:li:geo:105015875", name: "France", facetUrn: "urn:li:adTargetingFacet:locations",
  }] }), [{ urn: "urn:li:geo:105015875", name: "France", facetUrn: "urn:li:adTargetingFacet:locations" }]);
  assert.deepEqual(normalizeLinkedInAdsLocales({ elements: [{ urn: "urn:li:locale:fr_FR" }] }), [
    { language: "fr", country: "FR" },
  ]);
  assert.deepEqual(normalizeLinkedInAdsImage({
    id: "urn:li:image:C4D10AQFexample", owner: "urn:li:organization:789", status: "AVAILABLE",
    mediaLibraryMetadata: { associatedAccount: "urn:li:sponsoredAccount:123" },
  }, "urn:li:image:C4D10AQFexample"), {
    urn: "urn:li:image:C4D10AQFexample", owner: "urn:li:organization:789", status: "AVAILABLE",
    associatedAccount: "urn:li:sponsoredAccount:123",
  });
});

test("LinkedIn preflight builds Bing-geo, audience and pricing read paths", () => {
  const geoPath = buildLinkedInAdsGeoSearchPath("France", "fr", "FR");
  assert.match(geoPath, /adTargetingEntities\?q=typeahead/);
  assert.match(geoPath, /adTargetingFacet%3Alocations/);
  const exactGeoPath = buildLinkedInAdsGeoUrnsPath(["urn:li:geo:105015875"], "fr", "FR");
  assert.match(exactGeoPath, /adTargetingEntities\?q=urns/);
  assert.match(exactGeoPath, /queryVersion=QUERY_USES_URNS/);
  assert.match(exactGeoPath, /urns=List%28urn%3Ali%3Ageo%3A105015875%29/);
  const audiencePath = buildLinkedInAdsAudienceCountPath(["urn:li:geo:105015875"], "fr", "FR");
  assert.match(audiencePath, /audienceCounts\?q=targetingCriteriaV2/);
  assert.match(audiencePath, /urn%3Ali%3Ageo%3A105015875/);
  const pricingPath = buildLinkedInAdsBudgetPricingPath({
    accountId: "123", geoUrns: ["urn:li:geo:105015875"], language: "fr", country: "FR", dailyBudget: 25,
  });
  assert.match(pricingPath, /adBudgetPricing\?account=urn%3Ali%3AsponsoredAccount%3A123/);
  assert.match(pricingPath, /bidType=CPC/);
  assert.match(pricingPath, /dailyBudget=\(amount:25\.00,currencyCode:EUR\)/);
});

test("LinkedIn preflight requires audience >= 300 and provider pricing evidence", () => {
  assert.equal(normalizeLinkedInAdsAudienceCount({ elements: [{ total: 299, active: 0 }] }), 299);
  const pricing = normalizeLinkedInAdsBudgetPricing({ elements: [{
    bidLimits: {
      min: { amount: "1.50", currencyCode: "EUR" }, max: { amount: "25", currencyCode: "EUR" },
    },
    dailyBudgetLimits: {
      min: { amount: "10", currencyCode: "EUR" }, default: { amount: "25", currencyCode: "EUR" },
    },
  }] });
  assert.deepEqual(pricing, { currency: "EUR", bidMin: 1.5, bidMax: 25, dailyBudgetMin: 10, dailyBudgetDefault: 25 });
  const campaignGroup = normalizeLinkedInAdsCampaignGroup(group, "123");
  const common = {
    scopes: ["rw_ads", "r_ads_reporting", "r_organization_admin", "w_organization_social"],
    accountCurrency: "EUR", canManageCampaigns: true, canServeCampaigns: true, targetStatus: "ACTIVE" as const, campaignGroup,
    image: { urn: "urn:li:image:C4D10AQFexample", owner: "urn:li:organization:789", status: "AVAILABLE", associatedAccount: null },
    organizationUrn: "urn:li:organization:789", localeSupported: true,
    verifiedGeoUrns: ["urn:li:geo:105015875"], pricing,
    bidAmount: 2.5, dailyBudget: 25, politicalIntentConfirmed: true, targetingNoticeAcknowledged: true,
  };
  assert.deepEqual(linkedInAdsPreflightBlockers({ ...common, audienceCount: 300 }), []);
  assert.ok(linkedInAdsPreflightBlockers({ ...common, audienceCount: 299 }).includes("audience_too_small"));
  assert.ok(linkedInAdsPreflightBlockers({
    ...common,
    scopes: common.scopes.filter((scope) => scope !== "r_ads_reporting"),
    audienceCount: 300,
  }).includes("missing_scope:r_ads_reporting"));

  const pausedGroup = normalizeLinkedInAdsCampaignGroup({ ...group, status: "PAUSED" }, "123");
  const activeBlocked = linkedInAdsPreflightBlockers({
    ...common, campaignGroup: pausedGroup, canServeCampaigns: false, audienceCount: 300,
  });
  assert.ok(activeBlocked.includes("account_not_serving"));
  assert.ok(activeBlocked.includes("campaign_group_not_active"));
  assert.deepEqual(linkedInAdsPreflightBlockers({
    ...common, targetStatus: "PAUSED", campaignGroup: pausedGroup,
    canServeCampaigns: false, audienceCount: 300,
  }), []);
});

test("LinkedIn resource preflight remains GET-only while publication is isolated in its publisher", () => {
  const route = readFileSync("app/api/ads/linkedin/preflight/route.ts", "utf8");
  const server = readFileSync("lib/adsLinkedInPreflightServer.ts", "utf8");
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function POST/);
  assert.match(server, /publicationEnabled:\s*false/);
  assert.doesNotMatch(server, /method:\s*["']POST["']/);
  assert.match(server, /LINKEDIN_ADS_DEVELOPMENT_ACCOUNT_IDS/);
});
