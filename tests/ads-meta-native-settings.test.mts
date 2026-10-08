import assert from "node:assert/strict";
import test from "node:test";
import { defaultMetaDeliverySettings, normalizeMetaDeliverySettings, metaNativeDelivery, metaAdsInstant, metaAdsLegacyEndTime, metaAdsDisplayCalendar } from "../lib/adsMetaCampaignSettings.ts";
import { normalizeMetaAdsGeoTargets, metaAdsResourcesConsentKey, resolveMetaAdsLanguages, type MetaAdsResources } from "../lib/adsMetaResources.ts";
import { readMetaAdsPlanIntent } from "../lib/adsMetaPlanIntent.ts";
import { parseAdsCampaignInput } from "../lib/adsValidation.ts";
import { defaultOpenaiDeliverySettings } from "../lib/adsOpenaiCampaignSettings.ts";
import { unsupportedAdsConnectorReason } from "../lib/adsPublishMode.ts";
import { executeMetaAdsGraphPublish, type MetaAdsGraphPublishInput } from "../lib/adsMetaPublishCore.ts";
import { executeMetaAdsCampaignUpdate } from "../lib/adsMetaLifecycleCore.ts";

const now = Date.parse("2026-10-08T12:00:00Z");
const endDate = new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 10);
const native = defaultMetaDeliverySettings();
const target = { key: "999", type: "city" as const, name: "Lille", countryCode: "FR", region: "Hauts-de-France" };
const draft = { provider: "meta", creationMode: "inrcy", campaignType: "meta_traffic", objective: "website_traffic", conversionGoal: "website_visit", conversionLocation: "website", bidStrategy: "maximize_clicks", accountCurrency: "EUR", adAccountId: "1234567890", pageId: "9988776655", name: "Annonce locale", dailyBudgetEuros: 10, endDate, destinationUrl: "https://example.fr/offre", primaryText: "Découvrez notre offre dans votre ville.", imageUrl: "https://cdn.example.fr/image.jpg", metaPlacements: ["facebook_feed"], headlines: ["Une offre locale"], descriptions: [], targetLocations: ["Lille"], languages: [], callToAction: "En savoir plus", noSpecialCategoryConfirmed: true, metaDeliverySettings: native, metaGeoTargets: [target] };
const resources: MetaAdsResources = { selectedAccountId: draft.adAccountId, selectedPageId: draft.pageId, account: { id: draft.adAccountId, name: "Compte", currency: "EUR", status: 1, timezone: "Europe/Paris" }, pages: [{ id: draft.pageId, name: "Page", instagramUserId: "17841400000000000" }, { id: "88776655", name: "Autre" }], instagramAccountIds: ["17841400000000000", "17841400000000001"], locales: [{ id: "1002", name: "French" }, { id: "1001", name: "English" }] };

test("Meta absent settings preserve daily cents, Paris end, no cap and LEARN_MORE", () => {
  const delivery = metaNativeDelivery({ dailyBudgetEuros: 12.5, endDate: "2026-10-16" }, now);
  assert.equal(delivery.dailyBudgetCents, 1250); assert.equal(delivery.lifetimeBudgetCents, null);
  assert.equal(delivery.endTime, "2026-10-16T23:59:59+02:00"); assert.equal(delivery.startTime, null);
  assert.equal(delivery.bidStrategy, "LOWEST_COST_WITHOUT_CAP"); assert.equal(delivery.bidAmountCents, null); assert.equal(delivery.callToAction, "LEARN_MORE");
});
test("Meta saved calendar remains readable after expiry without making the same deadline publishable", () => {
  const expired = { dailyBudgetEuros: 10, endDate: "2026-10-07" };
  assert.deepEqual(metaAdsDisplayCalendar(expired), { startAt: null, endAt: "2026-10-07T23:59:59+02:00", startInvalid: false, endInvalid: false });
  assert.throws(() => metaNativeDelivery(expired, now), /entre demain et dans 90 jours/);
  assert.throws(() => metaNativeDelivery({ dailyBudgetEuros: 10, endDate: "2026-10-08" }, now), /entre demain et dans 90 jours/);
  assert.throws(() => metaNativeDelivery({ dailyBudgetEuros: 10, endDate: "2027-01-08" }, now), /entre demain et dans 90 jours/);
});
test("Meta historical deadline keeps 23:59:59 Paris with the correct DST offset on transition dates", () => {
  for (const [date, offset] of [["2026-03-28", "+01:00"], ["2026-03-29", "+02:00"], ["2026-10-24", "+02:00"], ["2026-10-25", "+01:00"]]) assert.equal(metaAdsLegacyEndTime(date), `${date}T23:59:59${offset}`);
  assert.throws(() => metaAdsLegacyEndTime("2026-02-30"), /date de fin Meta est invalide/);
});
test("Meta display calendar distinguishes missing deadlines from invalid dates and preserves explicit native hours", () => {
  const settings = defaultMetaDeliverySettings();
  settings.budget = { type: "total", totalEuros: 200, startAt: "2026-10-09T09:30:00+02:00", endAt: "2026-10-19T17:45:00+02:00" };
  assert.deepEqual(metaAdsDisplayCalendar({ endDate: "2026-10-07", metaDeliverySettings: settings }), { startAt: "2026-10-09T07:30:00.000Z", endAt: "2026-10-19T15:45:00.000Z", startInvalid: false, endInvalid: false });
  assert.deepEqual(metaAdsDisplayCalendar({ endDate: "" }), { startAt: null, endAt: null, startInvalid: false, endInvalid: false });
  assert.deepEqual(metaAdsDisplayCalendar({ endDate: "2026-02-30" }), { startAt: null, endAt: null, startInvalid: false, endInvalid: true });
  const invalid = { ...settings, budget: { ...settings.budget, startAt: "2026-10-09T25:00:00Z", endAt: "not-a-date" } };
  assert.deepEqual(metaAdsDisplayCalendar({ endDate: "2026-10-21", metaDeliverySettings: invalid }), { startAt: null, endAt: null, startInvalid: true, endInvalid: true });
  assert.throws(() => metaNativeDelivery({ dailyBudgetEuros: 25, endDate: "2026-10-21", metaDeliverySettings: invalid }, now), /dates Meta/);
});
test("Meta total and explicit hours override legacy mirror, with a real native bid cap", () => {
  const settings = defaultMetaDeliverySettings();
  settings.budget = { type: "total", totalEuros: 200, startAt: "2026-10-09T09:30:00+02:00", endAt: "2026-10-19T17:45:00+02:00" };
  settings.bidding = { strategy: "bid_cap", amountEuros: 1.25 }; settings.callToAction = "GET_QUOTE"; settings.audience = { ageMin: 25, ageMax: 65 };
  const delivery = metaNativeDelivery({ dailyBudgetEuros: 10, endDate: "2026-12-01", metaDeliverySettings: settings }, now);
  assert.equal(delivery.dailyBudgetCents, null); assert.equal(delivery.lifetimeBudgetCents, 20000);
  assert.equal(delivery.startTime, "2026-10-09T07:30:00.000Z"); assert.equal(delivery.endTime, "2026-10-19T15:45:00.000Z");
  assert.equal(delivery.bidStrategy, "LOWEST_COST_WITH_BID_CAP"); assert.equal(delivery.bidAmountCents, 125); assert.equal(delivery.callToAction, "GET_QUOTE"); assert.equal(delivery.ageMax, 65);
});
test("Meta settings reject mixed limits, fake conversions, invalid age, CTA and instants", () => {
  for (const settings of [
    { ...native, budget: { ...native.budget, totalEuros: 200 } },
    { ...native, bidding: { strategy: "maximum_delivery", amountEuros: 1 } },
    { ...native, bidding: { strategy: "cost_cap", amountEuros: 1 } },
    { ...native, optimizationGoal: "conversions" }, { ...native, callToAction: "MESSAGE_PAGE" },
    { ...native, audience: { ageMin: 17, ageMax: null } }, { ...native, audience: { ageMin: 45, ageMax: 25 } },
    { ...native, budget: { ...native.budget, startAt: "2026-02-30T12:00:00Z" } }, { ...native, pixelId: "invented" },
  ]) assert.ok(normalizeMetaDeliverySettings(settings).error, JSON.stringify(settings));
  assert.equal(metaAdsInstant("2026-10-08T25:00:00Z"), null);
  assert.throws(() => metaNativeDelivery({ dailyBudgetEuros: 10, endDate: "2026-10-16", metaDeliverySettings: { ...native, bidding: { strategy: "bid_cap", amountEuros: 11 } } }, now), /budget choisi/);
  assert.throws(() => metaNativeDelivery({ dailyBudgetEuros: 10, endDate: "2026-10-16", metaDeliverySettings: { ...native, budget: { type: "total", totalEuros: 200, startAt: null, endAt: "2026-10-08T12:00:30Z" } } }, now), /après le début/);
});
test("native Meta validation keeps all-language choice and requires exact zones and one creative title", () => {
  const parsed = parseAdsCampaignInput(draft);
  assert.equal(parsed.error, null); assert.deepEqual(parsed.draft?.languages, []); assert.deepEqual(parsed.draft?.metaGeoTargets, [target]);
  assert.equal(unsupportedAdsConnectorReason(parsed.draft!), null);
  for (const patch of [{ metaGeoTargets: [] }, { headlines: ["Titre un", "Titre deux"] }, { objective: "leads" }, { mediaStrategy: "video" }]) assert.ok(parseAdsCampaignInput({ ...draft, ...patch }).error);
  assert.equal(parseAdsCampaignInput({ ...draft, metaGeoTargets: [] }, { purpose: "draft" }).error, null);
  assert.ok(parseAdsCampaignInput({ ...draft, provider: "google" }, { purpose: "draft" }).error);
  assert.deepEqual(parseAdsCampaignInput({ ...draft, metaDeliverySettings: undefined, metaGeoTargets: undefined, headlines: [] }).draft?.languages, ["fr"]);
});
test("Meta resource consent is stable across provider order and changes with real permissions or identity", () => {
  const key = metaAdsResourcesConsentKey(resources);
  assert.equal(key, metaAdsResourcesConsentKey({ ...resources, pages: [...resources.pages].reverse(), instagramAccountIds: [...resources.instagramAccountIds].reverse(), locales: [...resources.locales].reverse() }));
  for (const changed of [{ ...resources, selectedPageId: "88776655" }, { ...resources, account: { ...resources.account, timezone: "UTC" } }, { ...resources, instagramAccountIds: [] }, { ...resources, locales: [] }]) assert.notEqual(key, metaAdsResourcesConsentKey(changed));
});
test("Meta languages only map to freshly returned IDs and geography never fabricates an identifier", () => {
  assert.deepEqual(resolveMetaAdsLanguages(resources, []), []); assert.deepEqual(resolveMetaAdsLanguages(resources, ["fr", "1001"]), [1002, 1001]);
  assert.throws(() => resolveMetaAdsLanguages({ locales: [] }, ["fr"]), /vérifiées/);
  assert.throws(() => resolveMetaAdsLanguages({ locales: [{ id: "1002", name: "French" }, { id: "1003", name: "French" }] }, ["fr"]), /vérifiées/);
  assert.deepEqual(normalizeMetaAdsGeoTargets([target, target]), [target]); assert.equal(normalizeMetaAdsGeoTargets([{ ...target, countryCode: "fr" }]), null); assert.equal(normalizeMetaAdsGeoTargets([{ ...target, radius: 80 }]), null);
});
test("Meta human total budget and duration remain total; conflicting budget fails before model", () => {
  const intent = readMetaAdsPlanIntent({ intent: "Campagne Meta, budget total 200 euros pour 10 jours.", now: new Date(now).toISOString(), timezone: "Europe/Paris" });
  assert.equal(intent.error, null); assert.equal(intent.budget?.type, "total"); assert.equal(intent.budget?.totalEuros, 200); assert.equal(intent.budget?.dailyEuros, null); assert.equal(intent.deliverySettings?.bidding.strategy, "maximum_delivery");
  assert.ok(readMetaAdsPlanIntent({ intent: "Budget total 200 euros et budget quotidien 10 euros", now: new Date(now).toISOString() }).error);
});
test("Meta graph sends lifetime OR daily, cap and CTA without changing pause-first activation", async () => {
  const calls: Array<{ path: string; body: Record<string, string> }> = [];
  const graph = async (_owner: string, path: string, body?: URLSearchParams) => {
    calls.push({ path, body: Object.fromEntries(body || []) });
    if (path.endsWith("/adimages")) return { images: { one: { hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } } };
    if (path.endsWith("/campaigns")) return { id: "111" }; if (path.endsWith("/adsets")) return { id: "222" }; if (path.endsWith("/adcreatives")) return { id: "333" }; if (path.endsWith("/ads")) return { id: "444" }; return { success: true };
  };
  const input: MetaAdsGraphPublishInput = { userId: "user", adAccountId: draft.adAccountId, pageId: draft.pageId, name: draft.name, destinationUrl: draft.destinationUrl, primaryText: draft.primaryText, headline: draft.headlines[0], dailyBudgetCents: null, lifetimeBudgetCents: 20000, budgetType: "total", startTime: "2026-10-09T07:30:00Z", endTime: "2026-10-19T15:45:00Z", bidStrategy: "LOWEST_COST_WITH_BID_CAP", bidAmountCents: 125, callToAction: "GET_QUOTE", placements: ["facebook_feed"], targeting: { age_min: 25, locales: [1002], geo_locations: { cities: [{ key: "999" }] } }, urlTags: "utm_source=meta", feedImageBytes: "normalized-image", activate: true };
  const journals: Record<string, unknown>[] = [];
  await executeMetaAdsGraphPublish(input, graph, async (record) => { journals.push(record); });
  const adset = calls.find((call) => call.path.endsWith("/adsets"))!.body;
  assert.equal(adset.lifetime_budget, "20000"); assert.equal("daily_budget" in adset, false); assert.equal(adset.start_time, input.startTime); assert.equal(adset.bid_strategy, input.bidStrategy); assert.equal(adset.bid_amount, "125"); assert.equal(adset.status, "PAUSED");
  const creative = calls.find((call) => call.path.endsWith("/adcreatives"))!.body;
  assert.deepEqual(JSON.parse(creative.asset_feed_spec).call_to_action_types, ["GET_QUOTE"]); assert.equal(creative.url_tags, "utm_source=meta");
  assert.deepEqual(calls.filter((call) => call.body.status === "ACTIVE").map((call) => call.path), ["444", "222", "111"]); assert.equal(journals.at(-1)?.budgetType, "total");
  calls.length = 0; await executeMetaAdsGraphPublish({ ...input, dailyBudgetCents: 1000, lifetimeBudgetCents: null, budgetType: "daily", bidStrategy: "LOWEST_COST_WITHOUT_CAP", bidAmountCents: null, callToAction: "LEARN_MORE", activate: false }, graph, async () => {});
  const automatic = calls.find((call) => call.path.endsWith("/adsets"))!.body;
  assert.equal(automatic.daily_budget, "1000"); assert.equal("lifetime_budget" in automatic, false); assert.equal("bid_amount" in automatic, false); assert.equal(calls.some((call) => call.body.status === "ACTIVE"), false);
  calls.length = 0; await assert.rejects(executeMetaAdsGraphPublish({ ...input, dailyBudgetCents: 1000 }, graph, async () => {}), /un seul budget/); assert.equal(calls.length, 0);
});
test("legacy lifecycle cannot replace a Meta total with a daily budget", async () => {
  let calls = 0;
  await assert.rejects(executeMetaAdsCampaignUpdate({ userId: "user", adAccountId: draft.adAccountId, resources: { campaignId: "111", budgetType: "total" }, changes: { dailyBudgetCents: 1000 } }, async () => { calls++; return {}; }), /budget total/);
  assert.equal(calls, 0);
});
test("ChatGPT total native settings allow effective bid and tracking without lowering legacy safeguards", () => {
  const settings = defaultOpenaiDeliverySettings(); settings.budget = { type: "total", totalEuros: 200, startAt: null, endAt: new Date(Date.now() + 8 * 86400000).toISOString() };
  const card = { ...draft, provider: "openai", adAccountId: "adacct_fixture", campaignType: "generic", bidStrategy: "manual_review", metaDeliverySettings: undefined, metaGeoTargets: undefined, dailyBudgetEuros: 10, openaiBidEuros: 20, openaiDeliverySettings: settings, callToAction: "", trackingParameters: "utm_source=chatgpt", noSpecialCategoryConfirmed: false };
  const parsed = parseAdsCampaignInput(card); assert.equal(parsed.error, null); assert.equal(parsed.draft?.openaiDeliverySettings?.budget.totalEuros, 200); assert.equal(unsupportedAdsConnectorReason(parsed.draft!), null);
  assert.ok(parseAdsCampaignInput({ ...card, openaiDeliverySettings: undefined }).error);
  assert.ok(parseAdsCampaignInput({ ...card, openaiBidEuros: 201 }).error);
  assert.ok(parseAdsCampaignInput({ ...card, trackingParameters: "utm_source={invented}" }).error);
});
