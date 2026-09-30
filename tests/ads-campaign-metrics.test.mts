import assert from "node:assert/strict";
import test from "node:test";
import { googleCampaignId, metaCampaignId, parseGoogleAdsMetrics, parseLinkedInAdsMetrics, parseMetaAdsMetrics } from "../lib/adsCampaignMetrics.ts";

const at = "2026-09-26T12:00:00.000Z";

test("Google report uses actual micros and conversions, never budget", () => {
  assert.deepEqual(parseGoogleAdsMetrics({ results: [{ metrics: {
    impressions: "1200", clicks: "48", costMicros: "12345000", conversions: "3.5",
  } }] }, at), {
    period: "last_30_days", source: "google", impressions: 1200, clicks: 48,
    spendEuros: 12.345, conversions: 3.5, fetchedAt: at,
  });
  assert.equal(parseGoogleAdsMetrics({ results: [] }, at), null);
});

test("Google ProtoJSON omitted zero metrics remain genuine zeroes for a returned row", () => {
  assert.deepEqual(parseGoogleAdsMetrics({ results: [{ metrics: {
    impressions: "1200", clicks: "48", costMicros: "12345000",
  } }] }, at), {
    period: "last_30_days", source: "google", impressions: 1200, clicks: 48,
    spendEuros: 12.345, conversions: 0, fetchedAt: at,
  });
  assert.deepEqual(parseGoogleAdsMetrics({ results: [{ metrics: {
    impressions: "1200",
  } }] }, at), {
    period: "last_30_days", source: "google", impressions: 1200, clicks: 0,
    spendEuros: 0, conversions: 0, fetchedAt: at,
  });
});

test("Meta report does not conflate different actions with conversions", () => {
  assert.deepEqual(parseMetaAdsMetrics({ data: [{ impressions: "88", clicks: "4", spend: "2.31" }] }, at), {
    period: "last_30_days", source: "meta", impressions: 88, clicks: 4,
    spendEuros: 2.31, conversions: null, fetchedAt: at,
  });
  assert.equal(parseMetaAdsMetrics({ data: [] }, at), null);
});

test("LinkedIn agrège uniquement les lignes de la campagne confirmée", () => {
  const urn = "urn:li:sponsoredCampaign:456";
  assert.deepEqual(parseLinkedInAdsMetrics({ elements: [
    { pivotValues: [urn], impressions: 10, clicks: 2, costInLocalCurrency: "3.50", externalWebsiteConversions: 1 },
    { pivotValues: [urn], impressions: 5, landingPageClicks: 1, costInLocalCurrency: "1.25" },
  ] }, at, urn), {
    period: "last_30_days", source: "linkedin", impressions: 15, clicks: 3,
    spendEuros: 4.75, conversions: 1, fetchedAt: at,
  });
  assert.equal(parseLinkedInAdsMetrics({ elements: [] }, at, urn), null);
  assert.throws(() => parseLinkedInAdsMetrics({ elements: [{ pivotValues: ["urn:li:sponsoredCampaign:999"], impressions: 1 }] }, at, urn));
});

test("malformed provider reports cannot become fabricated zeroes", () => {
  assert.throws(() => parseGoogleAdsMetrics({ results: [{ metrics: {} }] }, at));
  assert.throws(() => parseGoogleAdsMetrics({ results: [{ metrics: { clicks: "invalid" } }] }, at));
  assert.throws(() => parseMetaAdsMetrics({ data: [{ impressions: "bad", clicks: 1, spend: 2 }] }, at));
});

test("only own advertiser resource names are accepted", () => {
  assert.equal(googleCampaignId({ campaignResourceName: "customers/123/campaigns/456" }, "123"), "456");
  assert.equal(googleCampaignId({ campaignResourceName: "customers/999/campaigns/456" }, "123"), null);
  assert.equal(metaCampaignId({ provider: "meta", adAccountId: "123", campaignId: "456" }, "123"), "456");
  assert.equal(metaCampaignId({ provider: "meta", adAccountId: "999", campaignId: "456" }, "123"), null);
});
