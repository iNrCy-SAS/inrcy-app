import assert from "node:assert/strict";
import test from "node:test";
import {
  executeMetaAdsCampaignDelete,
  executeMetaAdsCampaignPause,
  executeMetaAdsCampaignResume,
  executeMetaAdsCampaignUpdate,
  metaAdsEndTimeFromDate,
  MetaAdsLifecycleError,
  type MetaAdsLifecycleGraphJson,
} from "../lib/adsMetaLifecycleCore.ts";

type GraphCall = { path: string; body: Record<string, string> | null };

const resources = {
  provider: "meta",
  campaignId: "111111",
  adSetId: "222222",
  creativeId: "333333",
  adId: "444444",
  stage: "demo_paused",
};

const campaignReadPath = "111111?fields=id,account_id,status,effective_status";
const adSetReadPath = "222222?fields=id,account_id,campaign_id";
const adReadPath = "444444?fields=id,account_id,campaign_id,adset_id";

function harness(options: {
  failPath?: string;
  falseSuccessPath?: string;
  campaignAccountId?: string;
  adSetCampaignId?: string;
  adCampaignId?: string;
  adAdSetId?: string;
  status?: string;
  effectiveStatus?: string;
  ambiguousGeo?: boolean;
  emptyGeo?: boolean;
} = {}) {
  const calls: GraphCall[] = [];
  const graph: MetaAdsLifecycleGraphJson = async (_userId, path, body) => {
    calls.push({ path, body: body ? Object.fromEntries(body.entries()) : null });
    if (path === options.failPath) throw new Error("Graph indisponible");
    if (path === options.falseSuccessPath) return { success: false };
    if (path === campaignReadPath) {
      return {
        id: "111111",
        account_id: options.campaignAccountId ?? "123456789",
        status: options.status ?? "PAUSED",
        effective_status: options.effectiveStatus ?? options.status ?? "PAUSED",
      };
    }
    if (path === adSetReadPath) {
      return {
        id: "222222",
        account_id: "123456789",
        campaign_id: options.adSetCampaignId ?? "111111",
      };
    }
    if (path === adReadPath) {
      return {
        id: "444444",
        account_id: "123456789",
        campaign_id: options.adCampaignId ?? "111111",
        adset_id: options.adAdSetId ?? "222222",
      };
    }
    if (path.startsWith("search?")) {
      return {
        data: options.emptyGeo ? [] : options.ambiguousGeo ? [
          { key: "997", type: "city", name: "Saint-Denis", region: "Île-de-France", country_code: "FR", country_name: "France" },
          { key: "996", type: "city", name: "Saint-Denis", region: "La Réunion", country_code: "FR", country_name: "France" },
        ] : [
          { key: "999", type: "city", name: "Lyon", region: "Auvergne-Rhône-Alpes", country_code: "FR", country_name: "France" },
          { key: "998", type: "city", name: "Lyon", region: "Mississippi", country_code: "US", country_name: "United States" },
        ],
      };
    }
    if (path === "222222?fields=targeting") {
      return {
        targeting: {
          age_min: 25,
          age_max: 65,
          publisher_platforms: ["facebook", "instagram"],
          geo_locations: { countries: ["FR"] },
        },
      };
    }
    return { success: true };
  };
  return { calls, graph };
}

function futureDate(days = 14): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

test("modifie nom, budget, date et zones Meta en préservant le ciblage existant", async () => {
  const { calls, graph } = harness();
  const result = await executeMetaAdsCampaignUpdate({
    userId: "user-1",
    adAccountId: "123456789",
    resources,
    changes: {
      name: "Nouvelle campagne locale",
      dailyBudgetCents: 1_500,
      endDate: futureDate(),
      targetLocations: ["Lyon, France"],
    },
  }, graph);

  assert.equal(result.state, "paused");
  assert.deepEqual(result.applied, ["campaign.name", "adset.settings"]);
  const searchCall = calls.find((call) => call.path.startsWith("search?"));
  assert.ok(searchCall);
  assert.equal(new URL(`https://graph.test/${searchCall.path}`).searchParams.get("type"), "adgeolocation");
  assert.ok(calls.some((call) => call.path === "222222?fields=targeting"));
  const mutations = calls.filter((call) => call.body !== null);
  assert.deepEqual(mutations.map((call) => call.path), ["111111", "222222"]);
  assert.equal(mutations[0].body?.name, "Nouvelle campagne locale");
  assert.equal(mutations[1].body?.daily_budget, "1500");
  assert.match(mutations[1].body?.end_time || "", /^\d{4}-\d{2}-\d{2}T23:59:59\+0[12]:00$/);
  const targeting = JSON.parse(mutations[1].body!.targeting) as Record<string, unknown>;
  assert.equal(targeting.age_min, 25);
  assert.equal(targeting.age_max, 65);
  assert.deepEqual(targeting.publisher_platforms, ["facebook", "instagram"]);
  assert.deepEqual(targeting.geo_locations, {
    cities: [{ key: "999" }],
    location_types: ["home", "recent"],
  });
});

test("une zone France remplace uniquement la géographie sans recherche ambiguë", async () => {
  const { calls, graph } = harness();
  await executeMetaAdsCampaignUpdate({
    userId: "user-1",
    adAccountId: "123456789",
    resources,
    changes: { targetLocations: ["France"] },
  }, graph);

  const mutation = calls.find((call) => call.body !== null);
  assert.equal(mutation?.path, "222222");
  const targeting = JSON.parse(mutation!.body!.targeting) as Record<string, unknown>;
  assert.deepEqual(targeting.geo_locations, { countries: ["FR"], location_types: ["home", "recent"] });
  assert.equal(targeting.age_min, 25);
});

test("une zone non résolue bloque toute mutation Meta", async () => {
  const { calls, graph } = harness({ emptyGeo: true });
  await assert.rejects(
    () => executeMetaAdsCampaignUpdate({
      userId: "user-1",
      adAccountId: "123456789",
      resources,
      changes: { name: "Nom qui ne doit pas partir", targetLocations: ["Zone imaginaire"] },
    }, graph),
    (error: unknown) => {
      assert.ok(error instanceof MetaAdsLifecycleError);
      assert.equal(error.remoteMayHaveChanged, false);
      assert.match(error.message, /Aucune modification n’a été envoyée/);
      return true;
    },
  );
  assert.equal(calls.some((call) => call.body !== null), false);
});

test("refuse un géociblage français ambigu à score égal avant toute mutation", async () => {
  const { calls, graph } = harness({ ambiguousGeo: true });
  await assert.rejects(
    () => executeMetaAdsCampaignUpdate({
      userId: "user-1",
      adAccountId: "123456789",
      resources,
      changes: { targetLocations: ["Saint-Denis"] },
    }, graph),
    (error: unknown) => {
      assert.ok(error instanceof MetaAdsLifecycleError);
      assert.equal(error.remoteMayHaveChanged, false);
      assert.match(error.message, /plusieurs zones équivalentes/);
      return true;
    },
  );
  assert.equal(calls.some((call) => call.body !== null), false);
});

test("valide toute la hiérarchie Meta avant d’envoyer une mutation", async () => {
  const invalidHierarchies = [
    { campaignAccountId: "987654321", expected: /campagne Meta n’appartient pas/ },
    { adSetCampaignId: "999999", expected: /ensemble publicitaire Meta n’appartient pas/ },
    { adCampaignId: "999999", expected: /annonce Meta n’appartient pas/ },
    { adAdSetId: "999999", expected: /annonce Meta n’appartient pas/ },
  ];

  for (const { expected, ...options } of invalidHierarchies) {
    const { calls, graph } = harness(options);
    await assert.rejects(
      () => executeMetaAdsCampaignUpdate({
        userId: "user-1",
        adAccountId: "123456789",
        resources,
        changes: { name: "Campagne contrôlée" },
      }, graph),
      (error: unknown) => {
        assert.ok(error instanceof MetaAdsLifecycleError);
        assert.equal(error.remoteMayHaveChanged, false);
        assert.match(error.message, expected);
        return true;
      },
    );
    assert.equal(calls.some((call) => call.body !== null), false);
  }
});

test("pause, reprise et suppression restent sans écriture si la campagne est hors compte", async () => {
  const operations = [
    (graph: MetaAdsLifecycleGraphJson) => executeMetaAdsCampaignPause({ userId: "user-1", adAccountId: "123456789", resources }, graph),
    (graph: MetaAdsLifecycleGraphJson) => executeMetaAdsCampaignResume({ userId: "user-1", adAccountId: "123456789", resources }, graph),
    (graph: MetaAdsLifecycleGraphJson) => executeMetaAdsCampaignDelete({ userId: "user-1", adAccountId: "123456789", resources }, graph),
  ];

  for (const operation of operations) {
    const { calls, graph } = harness({ campaignAccountId: "987654321" });
    await assert.rejects(
      () => operation(graph),
      (error: unknown) => {
        assert.ok(error instanceof MetaAdsLifecycleError);
        assert.equal(error.remoteMayHaveChanged, false);
        return true;
      },
    );
    assert.equal(calls.some((call) => call.body !== null), false);
  }
});

test("relit le statut Meta après une modification", async () => {
  const { calls, graph } = harness({ status: "ACTIVE", effectiveStatus: "ACTIVE" });
  const result = await executeMetaAdsCampaignUpdate({
    userId: "user-1",
    adAccountId: "123456789",
    resources,
    changes: { name: "Campagne toujours active" },
  }, graph);

  assert.equal(result.state, "active");
  assert.equal(calls.filter((call) => call.path === campaignReadPath).length, 2);
  assert.deepEqual(calls.filter((call) => call.body !== null), [
    { path: "111111", body: { name: "Campagne toujours active" } },
  ]);
});

test("la limite Meta de 90 jours est calendaire en heure de Paris", () => {
  // À cet instant il est déjà le 30 mars à Paris. Le 28 juin est donc J+90,
  // même si l’heure de fin exacte est distante de plus de 90 périodes de 24 h.
  const now = Date.parse("2026-03-29T22:30:00.000Z");
  assert.match(metaAdsEndTimeFromDate("2026-06-28", now), /^2026-06-28T23:59:59\+02:00$/);
  assert.throws(() => metaAdsEndTimeFromDate("2026-06-29", now), /dans 90 jours/);
  assert.throws(() => metaAdsEndTimeFromDate("2026-03-30", now), /entre demain/);
});

test("la pause touche d’abord et uniquement la campagne", async () => {
  const { calls, graph } = harness();
  const result = await executeMetaAdsCampaignPause({
    userId: "user-1",
    adAccountId: "123456789",
    resources,
  }, graph);
  assert.equal(result.state, "paused");
  assert.deepEqual(calls.filter((call) => call.body !== null), [{ path: "111111", body: { status: "PAUSED" } }]);
});

test("la reprise active les enfants avant la campagne", async () => {
  const { calls, graph } = harness();
  const result = await executeMetaAdsCampaignResume({
    userId: "user-1",
    adAccountId: "123456789",
    resources,
  }, graph);
  assert.equal(result.state, "active");
  assert.deepEqual(calls.filter((call) => call.body !== null).map((call) => [call.path, call.body?.status]), [
    ["444444", "ACTIVE"],
    ["222222", "ACTIVE"],
    ["111111", "ACTIVE"],
  ]);
});

test("un échec de reprise remet la campagne en pause par sécurité", async () => {
  let campaignActivationCalls = 0;
  const calls: GraphCall[] = [];
  const graph: MetaAdsLifecycleGraphJson = async (_userId, path, body) => {
    calls.push({ path, body: body ? Object.fromEntries(body.entries()) : null });
    if (path === campaignReadPath) {
      return { id: "111111", account_id: "123456789", status: "PAUSED", effective_status: "PAUSED" };
    }
    if (path === adSetReadPath) return { id: "222222", account_id: "123456789", campaign_id: "111111" };
    if (path === adReadPath) return { id: "444444", account_id: "123456789", campaign_id: "111111", adset_id: "222222" };
    if (path === "111111" && body?.get("status") === "ACTIVE" && campaignActivationCalls++ === 0) {
      throw new Error("activation ambiguë");
    }
    return { success: true };
  };
  await assert.rejects(
    () => executeMetaAdsCampaignResume({ userId: "user-1", adAccountId: "123456789", resources }, graph),
    (error: unknown) => {
      assert.ok(error instanceof MetaAdsLifecycleError);
      assert.equal(error.campaignMayBeActive, false);
      assert.deepEqual(error.applied, ["ad.status", "adset.status"]);
      assert.match(error.message, /maintenue en pause/);
      return true;
    },
  );
  assert.deepEqual(calls.slice(-2).map((call) => call.body?.status), ["ACTIVE", "PAUSED"]);
});

test("la suppression exige la confirmation success de Meta", async () => {
  const ok = harness();
  const result = await executeMetaAdsCampaignDelete({
    userId: "user-1",
    adAccountId: "123456789",
    resources,
  }, ok.graph);
  assert.equal(result.state, "deleted");
  assert.deepEqual(ok.calls.filter((call) => call.body !== null), [{ path: "111111", body: { status: "DELETED" } }]);

  const refused = harness({ falseSuccessPath: "111111" });
  await assert.rejects(
    () => executeMetaAdsCampaignDelete({ userId: "user-1", adAccountId: "123456789", resources }, refused.graph),
    (error: unknown) => {
      assert.ok(error instanceof MetaAdsLifecycleError);
      assert.equal(error.remoteMayHaveChanged, true);
      assert.match(error.message, /pas confirmé/);
      return true;
    },
  );
});
