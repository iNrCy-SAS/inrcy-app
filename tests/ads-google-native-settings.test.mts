import assert from "node:assert/strict";
import test from "node:test";
import { defaultGoogleDeliverySettings, normalizeGoogleDeliverySettings, googleSearchKeyword, googleSearchNativeBidding, googleAdsTextLength } from "../lib/adsGoogleCampaignSettings.ts";
import { googleAdsDateInAccount, readGoogleAdsAccountResources, googleAdsResourcesConsentKey } from "../lib/adsGoogleResources.ts";
import { readGoogleAdsPlanIntent, selectGoogleAdsPlanLocations } from "../lib/adsGooglePlanIntent.ts";
import { normalizeAdsCampaignPlan } from "../lib/adsCampaignPlan.ts";

test("native Search settings are additive, strict and preserve native keyword syntax", () => {
  assert.deepEqual(normalizeGoogleDeliverySettings(undefined), { settings: null, error: null });
  const defaults = defaultGoogleDeliverySettings();
  assert.deepEqual(normalizeGoogleDeliverySettings(defaults).settings, defaults);
  for (const value of [ { ...defaults, conversionActionId: "invented" }, { ...defaults, conversions: { mode: "quote_request" } }, { ...defaults, budget: { type: "total", totalEuros: 200.001 } }, { ...defaults, responsiveSearchAd: { path1: "folder/offer", path2: "" } }, { ...defaults, startDate: "2026-02-30" } ]) assert.ok(normalizeGoogleDeliverySettings(value).error);
  assert.deepEqual(googleSearchKeyword(" [atelier vélo] ", "BROAD"), { text: "atelier vélo", matchType: "EXACT" });
  assert.deepEqual(googleSearchKeyword('"réparation vélo"', "BROAD"), { text: "réparation vélo", matchType: "PHRASE" });
  assert.deepEqual(googleSearchKeyword("vélo Lille", "BROAD"), { text: "vélo Lille", matchType: "BROAD" });
  for (const value of ['"broken', "[broken", "a ".repeat(11), "x".repeat(81)]) assert.throws(() => googleSearchKeyword(value, "PHRASE"));
  assert.equal(googleAdsTextLength("漢字a"), 5);
  assert.equal(googleAdsTextLength("😀"), 1);
});

test("Google native strategies serialize exact values and unconfigured target/manual strategies are blocked", () => {
  const settings = defaultGoogleDeliverySettings();
  assert.equal(googleSearchNativeBidding("manual_review", settings), null);
  assert.equal(googleSearchNativeBidding("target_cpa", settings), null);
  assert.equal(googleSearchNativeBidding("target_roas", settings), null);
  settings.bidding = { manualCpcEuros: 1.25, cpcBidCeilingEuros: 2.5, targetCpaEuros: 10.99, targetRoas: 3.5 };
  assert.deepEqual(googleSearchNativeBidding("manual_review", settings), { manualCpc: {} });
  assert.deepEqual(googleSearchNativeBidding("maximize_clicks", settings), { targetSpend: { cpcBidCeilingMicros: "2500000" } });
  assert.deepEqual(googleSearchNativeBidding("target_cpa", settings), { maximizeConversions: { targetCpaMicros: "10990000" } });
  assert.deepEqual(googleSearchNativeBidding("target_roas", settings), { maximizeConversionValue: { targetRoas: 3.5 } });
  assert.deepEqual(googleSearchNativeBidding("maximize_conversions"), { maximizeConversions: {} });
});

const account = { id: "1234567890", currencyCode: "EUR", manager: false, status: "ENABLED", timeZone: "Europe/Paris" };
const goal = { category: "SUBMIT_LEAD_FORM", origin: "WEBSITE", biddable: true };
const action = { resourceName: "customers/1234567890/conversionActions/55", name: "Inscription", category: goal.category, origin: goal.origin, type: "WEBPAGE", status: "ENABLED", primaryForGoal: true };
test("only a real enabled primary conversion paired to the account biddable goal is verified", async () => {
  for (const changes of [ {}, { primaryForGoal: false }, { status: "HIDDEN" }, { category: "PURCHASE" }, { resourceName: "invented" } ]) {
    const result = await readGoogleAdsAccountResources(async (query) => ({ results: query.includes("customer_conversion_goal") ? [{ customerConversionGoal: goal }] : [{ conversionAction: { ...action, ...changes } }] }), account.id, account);
    assert.equal(result.hasBiddableConversions, Object.keys(changes).length === 0);
    assert.equal(result.conversionMode, "account_defaults");
  }
  await assert.rejects(() => readGoogleAdsAccountResources(async () => ({ results: [] }), account.id, { ...account, manager: true }));
  await assert.rejects(() => readGoogleAdsAccountResources(async () => ({ results: [], nextPageToken: "same" }), account.id, account), /Pagination/);
  assert.equal(googleAdsDateInAccount("America/Los_Angeles", new Date("2026-10-08T00:30:00Z")), "2026-10-07");
});

test("Google human total budget, dates and duration cannot become a daily budget or be replaced by model guesses", () => {
  const context = { now: "2026-10-08T09:00:00Z", timezone: "Europe/Paris" };
  const result = readGoogleAdsPlanIntent({ ...context, intent: "Budget total 200,50 € pour une campagne sur 10 jours, début le 10 octobre 2026." });
  assert.deepEqual(result.budget, { type: "total", totalEuros: 200.5, dailyEuros: null, startDate: "2026-10-10", endDate: "2026-10-19" });
  assert.equal(result.deliverySettings?.budget.type, "total");
  assert.equal(result.deliverySettings?.budget.totalEuros, 200.5);
  const plan = normalizeAdsCampaignPlan({ campaignType: "performance_max", bidStrategy: "maximize_value", googleDeliverySettings: { conversions: { mode: "invented" } }, googleBudgetSuggestion: { type: "daily", dailyEuros: 200 }, mediaStrategy: "video" }, { provider: "google", ...context, intent: "Budget total 200 € sur 10 jours en Hauts-de-France.", locations: ["Lille", "Arras"], destinationUrl: "https://example.test/" });
  assert.equal(plan.campaignType, "search"); assert.equal(plan.bidStrategy, "maximize_clicks"); assert.equal(plan.mediaStrategy, "search_text");
  assert.deepEqual(plan.googleBudgetSuggestion, { type: "total", dailyEuros: null, totalEuros: 200, startDate: "2026-10-08", endDate: "2026-10-17" });
  assert.deepEqual(plan.targetLocations, ["Hauts-de-France"]);
  assert.deepEqual(plan.googleDeliverySettings?.conversions, { mode: "account_defaults" });
  assert.deepEqual(selectGoogleAdsPlanLocations({ intent: "Dans les Hauts-de-France", locations: ["Lille", "Arras"] }), ["Hauts-de-France"]);
});

test("Google preserves explicit daily intent and rejects contradictory or impossible budgets/calendars", () => {
  const context = { now: "2026-10-08T09:00:00Z", timezone: "Europe/Paris" };
  assert.equal(readGoogleAdsPlanIntent({ ...context, intent: "Budget de 20 € par jour pour une campagne pendant 1 jour." }).budget?.dailyEuros, 20);
  assert.equal(readGoogleAdsPlanIntent({ ...context, intent: "Abonnement 29 €/mois, essai 21 jours." }).budget?.dailyEuros, 10);
  assert.equal(readGoogleAdsPlanIntent({ ...context, intent: "Pas de budget total de 500 € ; budget total 200 € sur 7 jours." }).budget?.totalEuros, 200);
  for (const intent of ["Budget total 200 € et 20 € par jour.", "Budget total 200 € puis budget total 300 €.", "Budget total 200 € sur 2 jours.", "Budget total 200 € sur 91 jours.", "Budget quotidien 20 € pour une campagne sur 0 jour.", "Début le 31 février 2026.", "Début le 10 octobre 2026, fin le 9 octobre 2026.", "Début le 10 octobre 2026, fin le 19 octobre 2026. Budget total 200 € sur 7 jours."]) assert.ok(readGoogleAdsPlanIntent({ ...context, intent }).error, intent);
});

test("conversion consent ignores provider ordering but invalidates changes to real account goals/actions", () => {
  const base = { selectedAccountId: account.id, timeZone: account.timeZone, conversionGoals: [goal, { ...goal, category: "PURCHASE", biddable: false }], conversionActions: [action, { ...action, resourceName: "customers/1234567890/conversionActions/99", name: "Contact" }], hasBiddableConversions: true, conversionMode: "account_defaults" as const };
  const approved = googleAdsResourcesConsentKey(base);
  assert.ok(approved); assert.equal(googleAdsResourcesConsentKey(null), "");
  assert.equal(googleAdsResourcesConsentKey({ ...base, conversionGoals: [...base.conversionGoals].reverse(), conversionActions: [...base.conversionActions].reverse() }), approved);
  assert.equal(googleAdsResourcesConsentKey({ ...base, conversionGoals: [...base.conversionGoals, goal] }), approved);
  for (const changed of [ { ...base, selectedAccountId: "9999999999" }, { ...base, timeZone: "UTC" }, { ...base, conversionGoals: [{ ...goal, biddable: false }] }, { ...base, conversionActions: [{ ...action, name: "New paid goal" }] }, { ...base, conversionActions: [{ ...action, primaryForGoal: false }] } ]) assert.notEqual(googleAdsResourcesConsentKey(changed), approved);
});
