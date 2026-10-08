import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createPausedOpenaiAdsCampaign, OpenaiAdsPublishError, searchOpenaiAdsLocations, type OpenaiAdsPublishRequest } from "../lib/adsOpenaiConnector.ts";

const base: OpenaiAdsPublishRequest = { operationId: "fixture-draft-123", expectedAccountId: "adacct_123", campaignName: "Campaign fixture", biddingType: "clicks", budget: { dailySpendLimitMicros: 15_000_000 }, targetLocations: ["Lille"], countryCode: "FR", adGroupName: "Ad group fixture", contextHints: ["Local service"], maxBidMicros: 1_000_000, adName: "Ad fixture", title: "Service local", body: "Découvrez notre service local.", destinationUrl: "https://example.fr/", mediaStableId: "174dc871-f583-4ad1-a47c-4b49e992d58b", imageUrl: "https://example.fr/image.png" };
function api(locations?: unknown[]) {
  const calls: { path: string; method: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (input: string | URL, init: RequestInit = {}) => {
    const path = new URL(String(input)).pathname.replace(/^\/v1/, "");
    calls.push({ path, method: init.method || "GET", body: init.body ? JSON.parse(String(init.body)) : {} });
    let result: unknown;
    if (path === "/ad_account") result = { id: "adacct_123", name: "Entreprise", currency_code: "EUR", timezone: "Europe/Paris", status: "active", review: { status: "approved" } };
    else if (path === "/geo_lookup/search") result = { results: locations || [{ id: "geo_lille", name: "Lille", type: "city", country_code: "FR", canonical_name: "Lille, France" }] };
    else if (path === "/campaigns" || path === "/campaigns/cmpn_123") result = { id: "cmpn_123", status: "paused" };
    else if (path === "/ad_groups" || path === "/ad_groups/adgrp_123") result = { id: "adgrp_123", status: "paused" };
    else if (path === "/upload") result = { file_id: "file_123" };
    else if (path === "/ads" || path === "/ads/ad_123") result = { id: "ad_123", status: "paused", review_status: "in_review" };
    else throw new Error(`Unexpected provider route: ${path}`);
    return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}
test("la requête native total/calendrier/plateformes/UTM est envoyée une seule fois et en pause", async () => {
  const mock = api();
  const request = { ...base, budget: { lifetimeSpendLimitMicros: 200_000_000 }, startTime: 1791529200, endTime: 1792619940, platforms: ["ios_app", "android_app"] as const, queryStringTemplate: "utm_source=openai&utm_campaign={campaign_id}&utm_content={ad_id}" };
  await createPausedOpenaiAdsCampaign({ apiKey: "fixture", request: { ...request, platforms: [...request.platforms] }, fetchImpl: mock.fetchImpl });
  const campaigns = mock.calls.filter((call) => call.path === "/campaigns" && call.method === "POST");
  assert.equal(campaigns.length, 1);
  assert.deepEqual(campaigns[0].body, { name: base.campaignName, status: "paused", bidding_type: "clicks", budget: { lifetime_spend_limit_micros: 200_000_000 }, start_time: request.startTime, end_time: request.endTime, targeting: { locations: { include: [{ id: "geo_lille" }] }, platforms: { included: ["ios_app", "android_app"] } }, landing_page_configuration: { query_string_template: request.queryStringTemplate } });
  assert.equal(mock.calls.some((call) => call.path.endsWith("/activate")), false);
});
test("un brouillon historique garde son empreinte et l’absence des nouveaux champs", async () => {
  const mock = api();
  const progress = await createPausedOpenaiAdsCampaign({ apiKey: "fixture", request: base, fetchImpl: mock.fetchImpl });
  const { imageUrl, ...stable } = base;
  assert.ok(imageUrl);
  assert.equal(progress.requestFingerprint, createHash("sha256").update(JSON.stringify(stable)).digest("hex"));
  const campaign = mock.calls.find((call) => call.path === "/campaigns" && call.method === "POST")!.body;
  assert.deepEqual(campaign.budget, { daily_spend_limit_micros: 15_000_000 });
  assert.equal(Object.hasOwn(campaign, "start_time"), false);
  assert.equal(Object.hasOwn(campaign, "landing_page_configuration"), false);
  assert.equal(Object.hasOwn(campaign.targeting as object, "platforms"), false);
  const changed = api();
  await assert.rejects(createPausedOpenaiAdsCampaign({ apiKey: "fixture", request: { ...base, platforms: ["web"] }, progress, fetchImpl: changed.fetchImpl }), (error: unknown) => error instanceof OpenaiAdsPublishError && error.code === "PROGRESS_MISMATCH");
  assert.equal(changed.calls.length, 0);
});
test("des réglages natifs invalides bloquent avant toute lecture ou mutation fournisseur", async () => {
  const badRequests = [
    { ...base, platforms: [] }, { ...base, platforms: ["web", "web"] },
    { ...base, startTime: 1792619940, endTime: 1791529200 }, { ...base, queryStringTemplate: "utm_campaign={email}" },
    { ...base, budget: { lifetimeSpendLimitMicros: 5_000_000 }, maxBidMicros: 6_000_000 },
  ];
  for (const request of badRequests) {
    const mock = api();
    await assert.rejects(createPausedOpenaiAdsCampaign({ apiKey: "fixture", request: request as OpenaiAdsPublishRequest, fetchImpl: mock.fetchImpl }), (error: unknown) => error instanceof OpenaiAdsPublishError);
    assert.equal(mock.calls.length, 0);
  }
});
test("le catalogue public filtre pays étrangers/champs privés et ne fait que GET", async () => {
  const mock = api([
    { id: "geo_lille", name: "Lille", type: "city", country_code: "FR", canonical_name: "Lille, France", private_field: "not-public" },
    { id: "geo_fr", name: "France", type: "country", country_code: "FR" },
    { id: "geo_ny", name: "New York", type: "city", country_code: "US" },
  ]);
  assert.deepEqual(await searchOpenaiAdsLocations({ apiKey: "fixture", query: "Lille", countryCode: "FR", fetchImpl: mock.fetchImpl }), [{ id: "geo_lille", name: "Lille", type: "city", countryCode: "FR", canonicalName: "Lille, France" }]);
  assert.deepEqual(mock.calls.map(({ method, path }) => [method, path]), [["GET", "/geo_lookup/search"]]);
});
