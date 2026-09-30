import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
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

function runtime(options: { malformedActivation?: boolean } = {}) {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const events: string[] = [];
  const request = async (_user: string, path: string, body: Record<string, unknown>) => {
    calls.push({ path, body });
    if (path.endsWith("googleAds:search")) return { results: [{ customer: { id: customerId, currencyCode: "EUR", status: "ENABLED", manager: false } }] };
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
    "@/lib/adsGoogleLocations": { normalizeGoogleTargetLocationLabels },
    "@/lib/adsPublishMode": { googleSearchBiddingFields }, "@/lib/adsServer": { googleAdsJson: request },
  };
  const exports: Record<string, unknown> = {};
  new Function("require", "exports", compiled)((name: string) => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected runtime dependency ${name}`);
    return modules[name];
  }, exports);
  return { publish: exports.publishGoogleAdsCampaign as (...args: unknown[]) => Promise<Record<string, unknown>>, calls, events };
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
