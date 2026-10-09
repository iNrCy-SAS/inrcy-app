import assert from "node:assert/strict";
import test from "node:test";
import { adsCampaignMetricsSourceLabel, googleCampaignId, isAdsCampaignMetrics, linkedInCampaignId, metaCampaignId, parseGoogleAdsMetrics, parseLinkedInAdsMetrics, parseMetaAdsMetrics } from "../lib/adsCampaignMetrics.ts";

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

test("LinkedIn distinguishes an actual empty report from a malformed provider envelope", () => {
  const urn = "urn:li:sponsoredCampaign:456";
  assert.equal(parseLinkedInAdsMetrics({ elements: [] }, at, urn), null);
  for (const payload of [null, [], {}, { elements: null }, { elements: {} }, { message: "unauthorized", status: 403 }]) {
    assert.throws(() => parseLinkedInAdsMetrics(payload, at, urn), /invalide/);
  }
  for (const invalidUrn of ["456", "urn:li:sponsoredCampaign:0", "urn:li:sponsoredCampaign:456/other", "urn:li:sponsoredAccount:456"]) {
    assert.throws(() => parseLinkedInAdsMetrics({ elements: [] }, at, invalidUrn), /invalide/);
  }
});

test("LinkedIn long counters and BigDecimal local spend are parsed without unsafe rounding or currency conversion", () => {
  const urn = "urn:li:sponsoredCampaign:456";
  const row = { pivotValues: [urn], impressions: "12", clicks: "3", costInLocalCurrency: "12.345678", externalWebsiteConversions: "2" };
  assert.equal(parseLinkedInAdsMetrics({ elements: [row] }, at, urn)?.spendEuros, 12.345678);
  for (const key of ["impressions", "clicks", "externalWebsiteConversions"]) {
    for (const value of [0.5, -1, "NaN", "9007199254740993", Infinity]) {
      assert.throws(() => parseLinkedInAdsMetrics({ elements: [{ ...row, [key]: value }] }, at, urn));
    }
  }
  for (const value of [NaN, Infinity, -1, "1e999", Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseLinkedInAdsMetrics({ elements: [{ ...row, costInLocalCurrency: value }] }, at, urn));
  }
  assert.throws(() => parseLinkedInAdsMetrics({ elements: [
    { ...row, impressions: Number.MAX_SAFE_INTEGER }, { ...row, impressions: 1 },
  ] }, at, urn));
  assert.throws(() => parseLinkedInAdsMetrics({ elements: [
    { ...row, costInLocalCurrency: Number.MAX_SAFE_INTEGER }, { ...row, costInLocalCurrency: 1 },
  ] }, at, urn));
});

test("LinkedIn native campaign checkpoints must exactly match the selected account and any parallel ID", () => {
  const resources = { accountId: "123", campaignUrn: "urn:li:sponsoredCampaign:456", campaignId: "456" };
  assert.equal(linkedInCampaignId(resources, "123"), "456");
  assert.equal(linkedInCampaignId({ accountId: "123", campaignUrn: resources.campaignUrn }, "123"), "456");
  for (const patch of [{ accountId: "999" }, { accountId: undefined }, { provider: "meta" },
    { adAccountId: "999" }, { campaignId: "999" }, { campaignId: 456 }, { campaignUrn: "456" },
    { campaignUrn: "urn:li:sponsoredCampaign:0" }, { campaignUrn: "urn:li:sponsoredCampaign:456?other=1" }]) {
    assert.equal(linkedInCampaignId({ ...resources, ...patch }, "123"), null);
  }
});

test("both campaign views share a strict real-metrics source guard", () => {
  const metrics = { period: "last_30_days", source: "linkedin", impressions: 0, clicks: 0, spendEuros: 0, conversions: 0, fetchedAt: at };
  assert.equal(isAdsCampaignMetrics(metrics, "linkedin"), true);
  assert.equal(isAdsCampaignMetrics(metrics, "meta"), false);
  for (const patch of [{ impressions: "1" }, { clicks: NaN }, { spendEuros: Infinity }, { conversions: -1 },
    { fetchedAt: "invalid" }, { period: "projection" }, { source: "x" }, { source: { toString: () => "linkedin" } }]) {
    assert.equal(isAdsCampaignMetrics({ ...metrics, ...patch }), false);
  }
  assert.equal(isAdsCampaignMetrics({ ...metrics, source: "google", conversions: 1.5 }, "google"), true);
  assert.equal(isAdsCampaignMetrics({ ...metrics, source: "meta", conversions: null }, "meta"), true);
  assert.equal(adsCampaignMetricsSourceLabel("linkedin"), "LinkedIn Ads");
  assert.equal(adsCampaignMetricsSourceLabel("meta"), "Meta Ads");
  assert.equal(adsCampaignMetricsSourceLabel("google"), "Google Ads");
});
