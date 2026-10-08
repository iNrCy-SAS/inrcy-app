import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as googleSettings from "../lib/adsGoogleCampaignSettings.ts";
import * as googleResources from "../lib/adsGoogleResources.ts";
import { normalizeGoogleTargetLocationLabels } from "../lib/adsGoogleLocations.ts";
import { googleSearchBiddingFields } from "../lib/adsPublishMode.ts";
import { parseAdsCampaignInput } from "../lib/adsValidation.ts";

const customerId = "1234567890";
const prefix = `customers/${customerId}`;
const draft = parseAdsCampaignInput({
  provider: "google", adAccountId: customerId, accountCurrency: "EUR",
  name: "Réparation de vélos à Lille", dailyBudgetEuros: 19.99,
  endDate: new Date(Date.now() + 8 * 86_400_000).toISOString().slice(0, 10),
  destinationUrl: "https://atelier.example/offre?ref=local", trackingParameters: "utm_source=google&utm_campaign=velo_lille",
  headlines: ["Réparation de vélos", "Votre atelier à Lille", "Prenez rendez-vous"],
  descriptions: ["Notre équipe vous accueille dans son atelier à Lille.", "Consultez les services de réparation et prenez rendez-vous."],
  keywords: ["réparation vélo Lille", "atelier vélo Lille"], negativeKeywords: ["emploi", "formation"],
  targetLocations: ["Lille", "Arras"], notEuPoliticalConfirmed: true,
}).draft!;
assert.ok(draft);
const locations = [
  { resourceName: "geoTargetConstants/1006094", label: "Lille", countryCode: "FR" },
  { resourceName: "geoTargetConstants/1005988", label: "Arras", countryCode: "FR" },
];

type Operation = Record<string, { create?: Record<string, unknown>; update?: { resourceName: string }; updateMask?: string }>;
const compiled = ts.transpileModule(readFileSync(new URL("../lib/adsGooglePublish.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function runtime(options: { malformedActivation?: boolean; conversionsReady?: boolean; conversionFailure?: boolean; timeZone?: string; geoMatches?: unknown[]; plainGeoOnly?: boolean } = {}) {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const events: string[] = [];
  const request = async (_user: string, path: string, body: Record<string, unknown>) => {
    calls.push({ path, body });
    if (path.endsWith("googleAds:search")) {
      const query = String(body.query);
      if (options.plainGeoOnly && query.includes("geo_target_constant.canonical_name =")) return { results: [] };
      if (query.includes("geo_target_constant")) return { results: (options.geoMatches || []).map((geoTargetConstant) => ({ geoTargetConstant })) };
      if (query.includes("customer_conversion_goal")) { if (options.conversionFailure) throw new Error("Conversion read unavailable"); return { results: [{ customerConversionGoal: { category: "SIGNUP", origin: "WEBSITE", biddable: true } }] }; }
      if (query.includes("FROM conversion_action")) return { results: options.conversionsReady === false ? [] : [{ conversionAction: { resourceName: `${prefix}/conversionActions/77`, name: "Essai", category: "SIGNUP", origin: "WEBSITE", type: "WEBPAGE", status: "ENABLED", primaryForGoal: true } }] };
      return { results: [{ customer: { id: customerId, currencyCode: "EUR", status: "ENABLED", manager: false, timeZone: options.timeZone || "Europe/Paris" } }] };
    }
    events.push("mutation");
    if (path.endsWith("campaigns:mutate")) return { results: [{ resourceName: `${prefix}/campaigns/22` }] };
    const operations = body.mutateOperations as Operation[];
    const activating = Boolean(operations[0].adGroupOperation?.update);
    if (activating && options.malformedActivation) return { mutateOperationResponses: [] };
    return { mutateOperationResponses: operations.map((operation, index) => {
      const [key, value] = Object.entries(operation)[0];
      const ids: Record<string, string> = {
        campaignBudgetOperation: `${prefix}/campaignBudgets/11`, campaignOperation: `${prefix}/campaigns/22`,
        campaignCriterionOperation: `${prefix}/campaignCriteria/22~${900 + index}`, adGroupOperation: `${prefix}/adGroups/33`,
        adGroupCriterionOperation: `${prefix}/adGroupCriteria/33~${900 + index}`, adGroupAdOperation: `${prefix}/adGroupAds/33~44`,
      };
      return { [key.replace("Operation", "Result")]: { resourceName: value.update?.resourceName || ids[key] } };
    }) };
  };
  const modules: Record<string, unknown> = {
    "server-only": {}, "node:crypto": { randomUUID: () => "abcd1234-0000-4000-8000-000000000001" },
    "@/lib/adsGoogleCampaignSettings": googleSettings, "@/lib/adsGoogleResources": googleResources,
    "@/lib/adsGoogleLocations": { normalizeGoogleTargetLocationLabels },
    "@/lib/adsPublishMode": { googleSearchBiddingFields }, "@/lib/adsServer": { googleAdsJson: request },
  };
  const exports: Record<string, unknown> = {};
  new Function("require", "exports", compiled)((name: string) => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected runtime dependency ${name}`);
    return modules[name];
  }, exports);
  return { publish: exports.publishGoogleAdsCampaign as (...args: unknown[]) => Promise<Record<string, unknown>>, check: exports.checkGoogleAdsPublication as (...args: unknown[]) => Promise<Record<string, unknown>>, resolve: exports.resolveGoogleTargetLocations as (...args: unknown[]) => Promise<unknown>, calls, events };
}

test("Google preserves cent budgets, URLs, UTM suffixes and batch ID offsets with local and negative criteria", async () => {
  const harness = runtime();
  const checkpoints: Record<string, unknown>[] = [];
  const result = await harness.publish("professional", draft, (progress: Record<string, unknown>) => {
    harness.events.push("persist"); checkpoints.push(progress);
  }, undefined, { activate: false, preparedTargetLocations: locations, onProviderMutationStart: () => harness.events.push("start") });
  const mutations = harness.calls.filter((call) => call.path.endsWith("googleAds:mutate"));
  assert.equal(mutations.length, 1);
  const operations = mutations[0].body.mutateOperations as Operation[];
  assert.equal(operations[0].campaignBudgetOperation.create?.amountMicros, "19990000");
  assert.equal(operations[1].campaignOperation.create?.finalUrlSuffix, draft.trackingParameters);
  assert.equal(operations[1].campaignOperation.create?.status, "PAUSED");
  assert.deepEqual((operations.at(-1)?.adGroupAdOperation.create?.ad as Record<string, unknown>).finalUrls, [draft.destinationUrl]);
  assert.deepEqual(result.locationCriterionResourceNames, [`${prefix}/campaignCriteria/22~902`, `${prefix}/campaignCriteria/22~903`]);
  assert.deepEqual(result.negativeKeywordCriterionResourceNames, [`${prefix}/campaignCriteria/22~904`, `${prefix}/campaignCriteria/22~905`]);
  assert.equal(result.adGroupResourceName, `${prefix}/adGroups/33`);
  assert.deepEqual(result.keywordCriterionResourceNames, [`${prefix}/adGroupCriteria/33~907`, `${prefix}/adGroupCriteria/33~908`]);
  assert.equal(result.adGroupAdResourceName, `${prefix}/adGroupAds/33~44`);
  assert.equal(result.status, "PAUSED");
  assert.equal(result.initialActivationPending, true);
  assert.equal(checkpoints.length, 1);
  assert.deepEqual(harness.events, ["start", "mutation", "persist"]);
});

test("Google invalid budget, suffix or prepared geography cannot cross the mutation boundary", async () => {
  for (const [changes, preparedTargetLocations] of [
    [{ dailyBudgetEuros: 19.999 }, locations],
    [{ trackingParameters: "utm_campaign" }, locations],
    [{}, []],
    [{}, [{ resourceName: "invented", label: "Lille", countryCode: "FR" }]],
  ] as const) {
    const harness = runtime();
    await assert.rejects(() => harness.publish("professional", { ...draft, ...changes }, () => {}, undefined, {
      activate: false, preparedTargetLocations, onProviderMutationStart: () => harness.events.push("start"),
    }));
    assert.deepEqual(harness.events, []);
  }
});

test("Google will not activate the parent campaign without confirmed child IDs and durable paused state", async () => {
  for (const persistenceFailure of [false, true]) {
    const harness = runtime({ malformedActivation: !persistenceFailure });
    await assert.rejects(() => harness.publish("professional", draft, () => {
      if (persistenceFailure) throw new Error("Database unavailable");
    }, undefined, { preparedTargetLocations: locations }));
    assert.equal(harness.calls.some((call) => call.path.endsWith("campaigns:mutate")), false);
  }
});

test("Google activates the parent last after confirmed children and persists both statuses", async () => {
  const harness = runtime();
  const checkpoints: unknown[] = [];
  const result = await harness.publish("professional", draft, (progress: Record<string, unknown>) => checkpoints.push(progress.status), undefined, { preparedTargetLocations: locations });
  assert.equal(harness.calls.at(-1)?.path, `${prefix}/campaigns:mutate`);
  assert.deepEqual(checkpoints, ["PAUSED", "ENABLED"]);
  assert.equal(result.status, "ENABLED");
  assert.equal(result.initialActivationPending, false);
});

test("native Search uses total budget, dates, presence/interest, match types, CPC and RSA paths without changing batch ordering", async () => {
  const harness = runtime({ conversionFailure: true });
  const settings = googleSettings.defaultGoogleDeliverySettings();
  settings.budget = { type: "total", totalEuros: 200.50 };
  settings.startDate = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  settings.geoTargetType = "PRESENCE_OR_INTEREST";
  settings.keywordMatchType = "BROAD"; settings.negativeKeywordMatchType = "EXACT";
  settings.bidding.manualCpcEuros = 1.25;
  settings.responsiveSearchAd = { path1: "atelier", path2: "reparation" };
  await harness.publish("professional", { ...draft, bidStrategy: "manual_review", googleDeliverySettings: settings, keywords: ["[atelier vélo]", "vélo Lille"] }, () => {}, undefined, { activate: false, preparedTargetLocations: locations });
  const ops = harness.calls.find((call) => call.path.endsWith("googleAds:mutate"))!.body.mutateOperations as Operation[];
  assert.deepEqual(ops[0].campaignBudgetOperation.create?.period, "CUSTOM_PERIOD");
  assert.equal(ops[0].campaignBudgetOperation.create?.totalAmountMicros, "200500000");
  assert.equal(Object.hasOwn(ops[0].campaignBudgetOperation.create!, "amountMicros"), false);
  const campaign = ops[1].campaignOperation.create!;
  assert.deepEqual(campaign.manualCpc, {});
  assert.deepEqual(campaign.geoTargetTypeSetting, { positiveGeoTargetType: "PRESENCE_OR_INTEREST" });
  assert.equal(campaign.startDateTime, settings.startDate + " 00:00:00");
  assert.equal(campaign.endDateTime, draft.endDate + " 23:59:59");
  assert.equal(ops[6].adGroupOperation.create?.cpcBidMicros, "1250000");
  assert.deepEqual(ops[4].campaignCriterionOperation.create?.keyword, { text: "emploi", matchType: "EXACT" });
  assert.deepEqual(ops[7].adGroupCriterionOperation.create?.keyword, { text: "atelier vélo", matchType: "EXACT" });
  assert.deepEqual(ops[8].adGroupCriterionOperation.create?.keyword, { text: "vélo Lille", matchType: "BROAD" });
  const ad = ops.at(-1)!.adGroupAdOperation.create?.ad as Record<string, unknown>;
  assert.equal((ad.responsiveSearchAd as Record<string, unknown>).path1, "atelier");
  assert.equal(harness.calls.some((call) => String(call.body.query).includes("conversion_goal")), false);
});

test("fresh Google native preflight blocks invalid calendar and unverified conversions before mutation", async () => {
  for (const [strategy, changes] of [
    ["maximize_conversions", {}], ["maximize_value", {}], ["target_cpa", { bidding: { ...googleSettings.defaultGoogleDeliverySettings().bidding, targetCpaEuros: 25 } }],
    ["maximize_clicks", { budget: { type: "total", totalEuros: 200 }, startDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) }],
    ["maximize_clicks", { startDate: "2020-01-01" }],
    ["maximize_clicks", { responsiveSearchAd: { path1: "x".repeat(16), path2: "" } }],
  ] as const) {
    const harness = runtime({ conversionsReady: false });
    await assert.rejects(() => harness.publish("professional", { ...draft, bidStrategy: strategy, googleDeliverySettings: { ...googleSettings.defaultGoogleDeliverySettings(), ...changes } }, () => {}, undefined, { preparedTargetLocations: locations, onProviderMutationStart: () => harness.events.push("start") }));
    assert.deepEqual(harness.events, []);
  }
  const harness = runtime();
  const settings = googleSettings.defaultGoogleDeliverySettings(); settings.bidding.targetCpaEuros = 10.99;
  const checked = await harness.check("professional", { ...draft, bidStrategy: "target_cpa", googleDeliverySettings: settings }, undefined, locations);
  assert.equal(checked.ready, true); assert.equal(checked.selectedAccountId, customerId); assert.equal(checked.verifiedLocationCount, 2);
  assert.deepEqual(checked.biddingFields, { maximizeConversions: { targetCpaMicros: "10990000" } });
  assert.deepEqual(harness.events, []);
});

test("Google refuses ambiguous city names and keeps a single canonical provider choice", async () => {
  const first = { resourceName: "geoTargetConstants/100001", canonicalName: "Paris,Ile-de-France,France", countryCode: "FR", status: "ENABLED" };
  const second = { ...first, resourceName: "geoTargetConstants/100002", canonicalName: "Paris,Texas,United States", countryCode: "US" };
  await assert.rejects(() => runtime({ geoMatches: [first, second] }).resolve("professional", customerId, ["Paris"]), /précisément/);
  const harness = runtime({ geoMatches: [first] });
  assert.deepEqual(await harness.resolve("professional", customerId, [first.canonicalName]), [{ resourceName: first.resourceName, label: first.canonicalName, countryCode: "FR" }]);
  assert.deepEqual(harness.events, []);
});

test("a verified country narrows a plain homonym without widening and explicit foreign canonical labels survive", async () => {
  const french = { resourceName: "geoTargetConstants/100001", canonicalName: "Lille,Hauts-de-France,France", countryCode: "FR", status: "ENABLED" };
  const plain = runtime({ plainGeoOnly: true, geoMatches: [french] });
  assert.deepEqual(await plain.resolve("professional", customerId, ["Lille"], undefined, "FR"), [{ resourceName: french.resourceName, label: french.canonicalName, countryCode: "FR" }]);
  assert.ok(plain.calls.some((call) => String(call.body.query).includes("country_code = 'FR'")));
  const foreign = { ...french, resourceName: "geoTargetConstants/100002", canonicalName: "Paris,Texas,United States", countryCode: "US" };
  const explicit = runtime({ geoMatches: [foreign] });
  assert.deepEqual(await explicit.resolve("professional", customerId, [foreign.canonicalName], undefined, "FR"), [{ resourceName: foreign.resourceName, label: foreign.canonicalName, countryCode: "US" }]);
});
