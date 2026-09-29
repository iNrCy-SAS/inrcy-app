import assert from "node:assert/strict";
import test from "node:test";
import {
  createGoogleAdsRemoteCampaignCoreAdapter,
  GoogleAdsRemoteCampaignError,
  normalizeGoogleAdsRemoteCampaignUpdate,
  parseGoogleAdsProviderResources,
  type GoogleAdsRemoteRequest,
} from "../lib/adsGoogleRemoteCampaignCore.ts";

const customerId = "1234567890";
const campaignId = "456";
const campaignResourceName = `customers/${customerId}/campaigns/${campaignId}`;
const budgetResourceName = `customers/${customerId}/campaignBudgets/789`;
const franceCriterion = `customers/${customerId}/campaignCriteria/${campaignId}~111`;

const providerResources = {
  customerId,
  budgetResourceName,
  campaignResourceName,
  locationCriterionResourceName: franceCriterion,
  locationCriterionResourceNames: [franceCriterion],
  adGroupResourceName: `customers/${customerId}/adGroups/222`,
  status: "ENABLED",
};

type MockCriterion = { resourceName: string; geoTargetConstant: string };
type MockState = {
  name: string;
  amountMicros: string;
  endDateTime: string;
  status: "ENABLED" | "PAUSED" | "REMOVED";
  criteria: MockCriterion[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function mockGoogleAds(options: {
  status?: MockState["status"];
  sharedBudget?: boolean;
  rejectUnifiedMutation?: boolean;
  malformedUnifiedResponse?: boolean;
  acknowledgeWithoutApplying?: boolean;
} = {}) {
  const state: MockState = {
    name: "Campagne initiale",
    amountMicros: "12500000",
    endDateTime: "2026-10-15 23:59:59",
    status: options.status || "ENABLED",
    criteria: [{ resourceName: franceCriterion, geoTargetConstant: "geoTargetConstants/2250" }],
  };
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  let nextCriterionId = 900;

  const request: GoogleAdsRemoteRequest = async (path, body) => {
    calls.push({ path, body });
    const query = typeof body.query === "string" ? body.query : "";
    if (query.includes("FROM campaign_criterion")) {
      return {
        results: state.status === "REMOVED" ? [] : state.criteria.map((criterion) => ({
          campaignCriterion: {
            resourceName: criterion.resourceName,
            negative: false,
            type: "LOCATION",
            location: { geoTargetConstant: criterion.geoTargetConstant },
          },
        })),
      };
    }
    if (query.includes("FROM campaign WHERE")) {
      return {
        results: [{
          campaign: {
            resourceName: campaignResourceName,
            campaignBudget: budgetResourceName,
            name: state.name,
            status: state.status,
            endDateTime: state.endDateTime,
          },
          campaignBudget: {
            resourceName: budgetResourceName,
            amountMicros: state.amountMicros,
            explicitlyShared: options.sharedBudget === true,
            referenceCount: options.sharedBudget ? "2" : "1",
          },
        }],
      };
    }
    if (path.endsWith("/googleAds:mutate")) {
      if (options.rejectUnifiedMutation) throw new Error("Google Ads refuse la modification");
      const operations = Array.isArray(body.mutateOperations) ? body.mutateOperations : [];
      if (options.malformedUnifiedResponse) return { mutateOperationResponses: [] };
      const responses = operations.map((rawOperation) => {
        const operation = asRecord(rawOperation);
        if (operation.campaignOperation) {
          const update = asRecord(asRecord(operation.campaignOperation).update);
          if (!options.acknowledgeWithoutApplying) {
            if (typeof update.name === "string") state.name = update.name;
            if (typeof update.endDateTime === "string") state.endDateTime = update.endDateTime;
          }
          return { campaignResult: { resourceName: campaignResourceName } };
        }
        if (operation.campaignBudgetOperation) {
          const update = asRecord(asRecord(operation.campaignBudgetOperation).update);
          if (!options.acknowledgeWithoutApplying && typeof update.amountMicros === "string") {
            state.amountMicros = update.amountMicros;
          }
          return { campaignBudgetResult: { resourceName: budgetResourceName } };
        }
        const criterionOperation = asRecord(operation.campaignCriterionOperation);
        if (criterionOperation.create) {
          const create = asRecord(criterionOperation.create);
          const location = asRecord(create.location);
          const resourceName = `customers/${customerId}/campaignCriteria/${campaignId}~${nextCriterionId++}`;
          if (!options.acknowledgeWithoutApplying) {
            state.criteria.push({ resourceName, geoTargetConstant: String(location.geoTargetConstant || "") });
          }
          return { campaignCriterionResult: { resourceName } };
        }
        const removed = String(criterionOperation.remove || "");
        if (!options.acknowledgeWithoutApplying) {
          state.criteria = state.criteria.filter((criterion) => criterion.resourceName !== removed);
        }
        return { campaignCriterionResult: { resourceName: removed } };
      });
      return { mutateOperationResponses: responses };
    }
    if (path.endsWith("/campaigns:mutate")) {
      const operations = Array.isArray(body.operations) ? body.operations : [];
      const operation = asRecord(operations[0]);
      if (operation.remove) state.status = "REMOVED";
      const update = asRecord(operation.update);
      if (update.status === "ENABLED" || update.status === "PAUSED") state.status = update.status;
      return { results: [{ resourceName: campaignResourceName }] };
    }
    throw new Error(`Appel Google Ads mocké inattendu : ${path}`);
  };

  const resolveTargetLocations = async (locations: string[]) => {
    const labels = locations.length ? locations : ["France"];
    return labels.map((label) => ({
      label,
      countryCode: "FR",
      resourceName: label === "France" ? "geoTargetConstants/2250"
        : label === "Paris" ? "geoTargetConstants/1006094"
          : "geoTargetConstants/1006095",
    }));
  };

  const adapter = createGoogleAdsRemoteCampaignCoreAdapter({
    expectedCustomerId: customerId,
    providerResources,
    request,
    resolveTargetLocations,
    now: () => Date.parse("2026-09-29T10:00:00Z"),
  });
  return { adapter, calls, state };
}

test("les provider_resources Google Ads sont validées avant tout appel distant", () => {
  const parsed = parseGoogleAdsProviderResources(providerResources, customerId);
  assert.equal(parsed.campaignResourceName, campaignResourceName);
  assert.deepEqual(parsed.locationCriterionResourceNames, [franceCriterion]);

  assert.throws(
    () => parseGoogleAdsProviderResources({
      ...providerResources,
      budgetResourceName: "customers/9999999999/campaignBudgets/789",
    }, customerId),
    (error) => error instanceof GoogleAdsRemoteCampaignError && error.code === "INVALID_PROVIDER_RESOURCES",
  );
  assert.throws(
    () => parseGoogleAdsProviderResources(providerResources, "9999999999"),
    /n’appartient pas au compte sélectionné/,
  );
});

test("la validation distante conserve les mêmes bornes que le brouillon Google", () => {
  const now = Date.parse("2026-09-29T10:00:00Z");
  assert.deepEqual(normalizeGoogleAdsRemoteCampaignUpdate({
    name: "  Nouveau nom  ",
    dailyBudgetEuros: 18.75,
    endDate: "2026-10-20",
    targetLocations: [" Paris ", ""],
  }, now), {
    name: "Nouveau nom",
    dailyBudgetEuros: 18.75,
    endDate: "2026-10-20",
    targetLocations: ["Paris"],
  });
  assert.throws(() => normalizeGoogleAdsRemoteCampaignUpdate({ dailyBudgetEuros: 5.001 }, now), /deux décimales/);
  assert.throws(() => normalizeGoogleAdsRemoteCampaignUpdate({ endDate: "2026-02-31" }, now), /date de fin/);
  assert.deepEqual(normalizeGoogleAdsRemoteCampaignUpdate({ endDate: "2026-12-28" }, now), {
    endDate: "2026-12-28",
  });
  assert.throws(
    () => normalizeGoogleAdsRemoteCampaignUpdate({ endDate: "2026-12-29" }, now),
    /dans 90 jours/,
  );
  assert.throws(() => normalizeGoogleAdsRemoteCampaignUpdate({ unexpected: true }, now), /champ inattendu/);
});

test("update accepte la borne civile exacte à +90 jours et refuse +91", async () => {
  const accepted = mockGoogleAds();
  const result = await accepted.adapter.update({ endDate: "2026-12-28" });
  assert.equal(result.changed, true);
  assert.equal(result.snapshot?.endDate, "2026-12-28");
  assert.equal(
    accepted.calls.filter((call) => call.path.endsWith("/googleAds:mutate")).length,
    1,
  );

  const rejected = mockGoogleAds();
  await assert.rejects(
    () => rejected.adapter.update({ endDate: "2026-12-29" }),
    (error) => error instanceof GoogleAdsRemoteCampaignError && error.code === "INVALID_REMOTE_UPDATE",
  );
  assert.equal(rejected.calls.length, 0);
});

test("read relit la campagne, son budget et ses critères géographiques", async () => {
  const { adapter, calls } = mockGoogleAds();
  const snapshot = await adapter.read();
  assert.equal(snapshot.name, "Campagne initiale");
  assert.equal(snapshot.dailyBudgetEuros, 12.5);
  assert.equal(snapshot.endDate, "2026-10-15");
  assert.equal(snapshot.status, "ENABLED");
  assert.deepEqual(snapshot.locationCriteria, [{
    resourceName: franceCriterion,
    geoTargetConstantResourceName: "geoTargetConstants/2250",
  }]);
  assert.equal(calls.length, 2);
  assert.match(String(calls[0].body.query), /campaign\.end_date_time/);
  assert.match(String(calls[1].body.query), /campaign_criterion\.type = LOCATION/);
});

test("update modifie nom, budget, date et zones dans une mutation atomique vérifiée", async () => {
  const { adapter, calls, state } = mockGoogleAds();
  const result = await adapter.update({
    name: "  Campagne renouvelée  ",
    dailyBudgetEuros: 20,
    endDate: "2026-11-01",
    targetLocations: ["Paris", "Lyon"],
  });

  assert.equal(result.changed, true);
  assert.equal(result.snapshot?.name, "Campagne renouvelée");
  assert.equal(result.snapshot?.dailyBudgetEuros, 20);
  assert.equal(result.snapshot?.endDate, "2026-11-01");
  assert.deepEqual(
    result.snapshot?.locationCriteria.map((criterion) => criterion.geoTargetConstantResourceName).sort(),
    ["geoTargetConstants/1006094", "geoTargetConstants/1006095"],
  );
  assert.equal(state.criteria.some((criterion) => criterion.resourceName === franceCriterion), false);

  const mutation = calls.find((call) => call.path.endsWith("/googleAds:mutate"));
  assert.ok(mutation);
  const operations = mutation.body.mutateOperations as Record<string, unknown>[];
  assert.equal(operations.length, 5);
  assert.equal(asRecord(operations[0].campaignOperation).updateMask, "name,end_date_time");
  assert.equal(asRecord(operations[1].campaignBudgetOperation).updateMask, "amount_micros");
  assert.equal(result.providerResources.adGroupResourceName, providerResources.adGroupResourceName);
  assert.equal((result.providerResources.locationCriterionResourceNames as string[]).length, 2);
});

test("une mise à jour déjà appliquée est un no-op idempotent", async () => {
  const { adapter, calls } = mockGoogleAds();
  const result = await adapter.update({
    name: "Campagne initiale",
    dailyBudgetEuros: 12.5,
    endDate: "2026-10-15",
    targetLocations: ["France"],
  });
  assert.equal(result.changed, false);
  assert.equal(calls.some((call) => call.path.endsWith("/googleAds:mutate")), false);
});

test("un refus Google est propagé sans faux résultat de succès", async () => {
  const { adapter } = mockGoogleAds({ rejectUnifiedMutation: true });
  await assert.rejects(
    () => adapter.update({ name: "Campagne refusée" }),
    /Google Ads refuse la modification/,
  );
});

test("un budget devenu partagé n’est jamais modifié implicitement", async () => {
  const { adapter, calls } = mockGoogleAds({ sharedBudget: true });
  await assert.rejects(
    () => adapter.update({ dailyBudgetEuros: 30 }),
    (error) => error instanceof GoogleAdsRemoteCampaignError && error.code === "REMOTE_SHARED_BUDGET",
  );
  assert.equal(calls.some((call) => call.path.endsWith("/googleAds:mutate")), false);
});

test("une réponse de mutation incomplète ou un état non appliqué reste non confirmé", async () => {
  const malformed = mockGoogleAds({ malformedUnifiedResponse: true });
  await assert.rejects(
    () => malformed.adapter.update({ name: "Campagne ambiguë" }),
    (error) => error instanceof GoogleAdsRemoteCampaignError && error.code === "REMOTE_MUTATION_UNCONFIRMED",
  );

  const unapplied = mockGoogleAds({ acknowledgeWithoutApplying: true });
  await assert.rejects(
    () => unapplied.adapter.update({ dailyBudgetEuros: 25 }),
    (error) => error instanceof GoogleAdsRemoteCampaignError && error.code === "REMOTE_MUTATION_UNCONFIRMED",
  );
});

test("pause et reprise relisent le statut et deviennent idempotentes", async () => {
  const { adapter, calls } = mockGoogleAds();
  const paused = await adapter.pause();
  assert.equal(paused.changed, true);
  assert.equal(paused.status, "PAUSED");
  assert.equal(paused.providerResources.status, "PAUSED");

  const pausedAgain = await adapter.pause();
  assert.equal(pausedAgain.changed, false);

  const resumed = await adapter.resume();
  assert.equal(resumed.changed, true);
  assert.equal(resumed.status, "ENABLED");
  assert.equal(calls.filter((call) => call.path.endsWith("/campaigns:mutate")).length, 2);
});

test("remove supprime à distance puis traite les répétitions comme un no-op", async () => {
  const { adapter, calls } = mockGoogleAds({ status: "PAUSED" });
  const removed = await adapter.remove();
  assert.equal(removed.changed, true);
  assert.equal(removed.status, "REMOVED");
  assert.equal(removed.providerResources.status, "REMOVED");

  const removedAgain = await adapter.remove();
  assert.equal(removedAgain.changed, false);
  assert.equal(calls.filter((call) => call.path.endsWith("/campaigns:mutate")).length, 1);
});
