import assert from "node:assert/strict";
import * as deliverySettings from "../lib/adsLinkedInCampaignSettings.ts";
import * as purePublish from "../lib/adsLinkedInPublish.ts";
import * as videoUpload from "../lib/adsLinkedInVideo.ts";

import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import * as policy from "../lib/adsLinkedInPreflightPolicy.ts";
import * as geoResolution from "../lib/adsLinkedInGeoResolution.ts";
import { linkedInAdsContextualGeoDefaults } from "../lib/adsLinkedInClientDefaults.ts";
import { log } from "../lib/observability/logger.ts";

type PreflightResult = {
  selected: { verifiedGeoUrns: string[]; campaignGroup: policy.LinkedInAdsCampaignGroup | null };
  blockers: string[];
  readyForRemoteDraft: boolean;
};

type PreflightFailure = Error & { code: string; operation: string };

const source = ts.transpileModule(
  readFileSync(new URL("../lib/adsLinkedInPreflightServer.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } },
).outputText;

function loadPreflight(fetchImpl: typeof fetch) {
  const logs: Array<{ message: string; context: Record<string, unknown> }> = [];
  class ConnectionError extends Error {
    code: string;
    status: number;

    constructor(message: string, code: string, status = 503) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
  const account = {
    id: "123", currency: "EUR", canManageCampaigns: true, canServeCampaigns: true,
  };
  const modules = new Map<string, unknown>([
    ["server-only", {}],
    ["./adsLinkedInCampaignSettings.ts", deliverySettings],
    ["./adsLinkedInPublish.ts", purePublish],
    ["./adsLinkedInVideo.ts", videoUpload],
    ["./adsLinkedInResourcesServer.ts", {
      resolveLinkedInAdsProfessionalTargets: async (input: { targets: unknown[] }) => { assert.deepEqual(input.targets, []); return { verifiedTargets: [], unresolvedTargets: [] }; },
      resolveLinkedInAdsConversions: async (input: { conversionUrns: string[] }) => { assert.deepEqual(input.conversionUrns, []); return { verifiedConversions: [], unresolvedUrns: [] }; },
    }],

    ["./adsLinkedInPolicy.ts", {
      LINKEDIN_ADS_API_VERSION: "202609",
      linkedInAdsScopes: (value: unknown) => String(value || "").split(/\s+/).filter(Boolean),
    }],
    ["./adsLinkedInServer.ts", {
      LinkedInAdsConnectionError: ConnectionError,
      readLinkedInAdsIntegration: async () => ({ resource_id: account.id }),
      linkedInAdsAuthorization: async () => ({ token: "isolated-test-token", scopes: "rw_ads r_ads_reporting" }),
      listLinkedInAdsAccounts: async () => [account],
    }],
    ["./adsLinkedInPreflightPolicy.ts", policy],
    ["./adsLinkedInGeoResolution.ts", geoResolution],
    ["./adsLinkedInClientDefaults.ts", { linkedInAdsContextualGeoDefaults }],
    ["./observability/logger.ts", { log: {
      warn: (message: string, context: Record<string, unknown>) => logs.push({ message, context }),
      error: (message: string, context: Record<string, unknown>) => logs.push({ message, context }),
    } }],
  ]);
  const loaded = { exports: {} as {
    runLinkedInAdsPreflight: (userId: string, input: Record<string, unknown>) => Promise<PreflightResult>;
  } };
  new Function("module", "exports", "require", "process", "fetch", "AbortSignal", source)(
    loaded, loaded.exports,
    (specifier: string) => {
      assert.ok(modules.has(specifier), `Unexpected dependency: ${specifier}`);
      return modules.get(specifier);
    },
    { env: { LINKEDIN_ADS_DEVELOPMENT_ACCOUNT_IDS: account.id } }, fetchImpl, AbortSignal,
  );
  return { run: loaded.exports.runLinkedInAdsPreflight, logs };
}

const arras = {
  urn: "urn:li:geo:1001", name: "Arras, Hauts-de-France, France",
  facetUrn: "urn:li:adTargetingFacet:locations",
};
const lille = { ...arras, urn: "urn:li:geo:1002", name: "Lille, Hauts-de-France, France" };

function providerResponse(request: URL): Response {
  if (request.pathname.endsWith("/adCampaignGroups")) return Response.json({ elements: [{
    id: 456, account: "urn:li:sponsoredAccount:123", name: "Groupe test", status: "ACTIVE",
    objectiveType: "WEBSITE_VISIT", allowedCampaignTypes: ["SPONSORED_UPDATES"], runSchedule: {},
  }] });
  if (request.pathname === "/rest/adTargetingEntities") {
    switch (request.searchParams.get("q")) {
      case "adTargetingFacet": return Response.json({ elements: [{ urn: "urn:li:locale:fr_FR" }] });
      case "typeahead": return Response.json({ elements: [request.searchParams.get("query") === "Arras" ? arras : lille] });
      case "urns": return Response.json({ elements: [arras, lille] });
    }
  }
  if (request.pathname === "/rest/audienceCounts") return Response.json({ elements: [{ total: 1000 }] });
  assert.fail(`Unexpected provider read: ${request.pathname}`);
}

test("a partial LinkedIn geo re-resolution keeps valid URNs but blocks launch", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const request = new URL(String(input));
    if (request.pathname === "/rest/adTargetingEntities" && request.searchParams.get("q") === "urns") {
      return Response.json({ elements: [arras, { ...lille, facetUrn: "urn:li:adTargetingFacet:titles" }] });
    }
    if (request.searchParams.get("q") === "typeahead" && request.searchParams.get("query") === "Lille") {
      return Response.json({ elements: [] });
    }
    return providerResponse(request);
  };
  const runtime = loadPreflight(fetchImpl);
  const result = await runtime.run("owner", {
    geoQueries: ["Arras", "Lille"], geoUrns: [arras.urn, lille.urn], language: "fr", country: "FR",
  });
  assert.deepEqual(result.selected.verifiedGeoUrns, [arras.urn]);
  assert.ok(result.blockers.includes("selected_geo_unverified"));
  assert.ok(result.blockers.includes("unresolved_geo_queries"));
  assert.equal(result.readyForRemoteDraft, false);
  assert.deepEqual(runtime.logs, [{
    message: "linkedin_ads_preflight_geo_urn_unverified",
    context: { provider: "linkedin", operation: "geo_urn_resolution", requested_count: 2, verified_count: 1 },
  }]);
});

test("a malformed LinkedIn geo resolver cannot verify a selection without fresh matching suggestions", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const request = new URL(String(input));
    if (request.pathname === "/rest/adTargetingEntities" && request.searchParams.get("q") === "urns") {
      return Response.json({ results: {} });
    }
    return providerResponse(request);
  };
  const runtime = loadPreflight(fetchImpl);
  const result = await runtime.run("owner", { geoUrns: [arras.urn] });
  assert.deepEqual(result.selected.verifiedGeoUrns, []);
  assert.ok(result.blockers.includes("selected_geo_unverified"));
  assert.equal(result.readyForRemoteDraft, false);
});

test("fresh typeahead verifies exactly the selected URNs when urn metadata is missing", async () => {
  const runtime = loadPreflight(async (input) => {
    const request = new URL(String(input));
    if (request.searchParams.get("q") === "urns") return Response.json({ elements: [{ urn: arras.urn }] });
    return providerResponse(request);
  });
  const result = await runtime.run("owner", { geoQueries: ["Arras", "Lille"], geoUrns: [arras.urn, lille.urn] });
  assert.deepEqual(result.selected.verifiedGeoUrns, [arras.urn, lille.urn]);
  assert.ok(!result.blockers.includes("selected_geo_unverified"));
  assert.equal(runtime.logs.length, 0);
});

test("all seven saved locations remain verified when the urns finder describes them as profileLocations", async (t) => {
  const info = t.mock.method(log, "info", () => {});
  const targets = ["Arras", "Lille", "Valenciennes", "Saint-Omer", "Cambrai", "Sallaumines", "Harnes"]
    .map((name, index) => ({ ...arras, urn: `urn:li:geo:${100000001 + index}`, name: `${name}, Hauts-de-France, France` }));
  const requests: URL[] = [];
  const runtime = loadPreflight(async (input, init) => {
    assert.equal(init?.method || "GET", "GET");
    const request = new URL(String(input));
    requests.push(request);
    if (request.searchParams.get("q") === "urns") return Response.json({ elements: targets.map((target) => ({
      ...target, facetUrn: "urn:li:adTargetingFacet:profileLocations",
    })) });
    if (request.searchParams.get("q") === "typeahead") return Response.json({ elements: targets.filter((target) =>
      target.name.split(",")[0] === request.searchParams.get("query")) });
    return providerResponse(request);
  });
  const expectedUrns = targets.map(({ urn }) => urn);
  const result = await runtime.run("owner", {
    geoQueries: targets.map(({ name }) => name.split(",")[0]), geoUrns: expectedUrns,
    language: "fr", country: "FR",
  });
  assert.deepEqual(result.selected.verifiedGeoUrns, expectedUrns);
  assert.ok(!result.blockers.includes("selected_geo_unverified"));
  assert.ok(!result.blockers.includes("unresolved_geo_queries"));
  assert.equal(requests.filter((request) => request.searchParams.get("q") === "typeahead").length, 7);
  assert.equal(runtime.logs.length, 0);
  assert.equal(info.mock.calls.length, 1);
  assert.deepEqual(info.mock.calls[0].arguments, ["linkedin_ads_geo_resolution_verified", {
    provider: "linkedin", requested_count: 7, verified_count: 7, urn_row_count: 7, ignored_non_location_count: 7,
    urn_facet_counts: { locations: 0, profile_locations: 7, other: 0, missing: 0, malformed_row: 0 },
    fallback_query_count: 0,
  }]);
});

test("the live 28-row multi-facet response verifies seven exact locations without any typeahead", async (t) => {
  const info = t.mock.method(log, "info", () => {});
  const targets = ["Arras", "Lille", "Valenciennes", "Saint-Omer", "Cambrai", "Sallaumines", "Harnes"]
    .map((name, index) => ({ ...arras, urn: `urn:li:geo:${100000001 + index}`, name: `${name}, Hauts-de-France, France` }));
  // Production diagnostics identified two additional representations per URN,
  // without logging their raw facet names. Keep those names opaque in this fixture.
  const elements = targets.flatMap((target) => [
    target,
    { ...target, facetUrn: "urn:li:adTargetingFacet:profileLocations" },
    { ...target, facetUrn: "urn:li:adTargetingFacet:opaqueVariantA" },
    { ...target, facetUrn: "urn:li:adTargetingFacet:opaqueVariantB" },
  ]);
  for (const rows of [elements, [...elements].reverse()]) {
    assert.deepEqual(await geoResolution.resolveLinkedInAdsGeoTargets({
      targets, language: "fr", country: "FR", resolvedPayload: { elements: rows },
      read: async () => assert.fail("All seven locations are already proven by the urns response"),
    }), targets);
  }
  assert.equal(info.mock.calls.length, 2);
  for (const call of info.mock.calls) assert.deepEqual(call.arguments, ["linkedin_ads_geo_resolution_verified", {
    provider: "linkedin", requested_count: 7, verified_count: 7, urn_row_count: 28, ignored_non_location_count: 21,
    urn_facet_counts: { locations: 7, profile_locations: 7, other: 14, missing: 0, malformed_row: 0 },
    fallback_query_count: 0,
  }]);
});

test("direct locations evidence survives duplicate profileLocations rows and normalized whitespace", async () => {
  const profile = { ...arras, facetUrn: " urn:li:adTargetingFacet:profileLocations " };
  const location = { ...arras, urn: ` ${arras.urn} `, facetUrn: ` ${arras.facetUrn} ` };
  for (const elements of [[profile, location], [location, profile], [location]]) {
    assert.deepEqual(await geoResolution.resolveLinkedInAdsGeoTargets({
      targets: [arras], language: "fr", country: "FR", resolvedPayload: { elements },
      read: async () => assert.fail("Valid direct locations evidence needs no typeahead"),
    }), [arras]);
  }
});

test("profileLocations alone never verifies a target without a fresh locations response for its exact geographic URN", async (t) => {
  const warn = t.mock.method(log, "warn", () => {});
  const profile = { ...arras, facetUrn: "urn:li:adTargetingFacet:profileLocations" };
  for (const suggestions of [
    [], [profile], [{ ...arras, urn: lille.urn }],
    [{ ...arras, urn: "urn:li:organization:1001" }],
    [{ ...arras, facetUrn: "urn:li:adTargetingFacet:industries" }],
  ]) {
    const requests: URL[] = [];
    const result = await geoResolution.resolveLinkedInAdsGeoTargets({
      targets: [arras], language: "fr", country: "FR", resolvedPayload: { elements: [profile] },
      freshSuggestions: suggestions,
      read: async (path) => {
        const request = new URL(path, "https://api.linkedin.com");
        requests.push(request);
        assert.equal(request.searchParams.get("facet"), arras.facetUrn);
        return { elements: suggestions };
      },
    });
    assert.deepEqual(result, []);
    assert.equal(requests.length, 1);
  }
  assert.equal(warn.mock.calls.length, 5);
  for (const [index, call] of warn.mock.calls.entries()) assert.deepEqual(call.arguments, ["linkedin_ads_geo_resolution_empty", {
    provider: "linkedin", requested_count: 1, verified_count: 0, ignored_non_location_count: 1,
    urn_response_shape: "elements",
    urn_facet_counts: { locations: 0, profile_locations: 1, other: 0, missing: 0, malformed_row: 0 },
    fresh_suggestion_count: index === 0 ? 0 : 1,
    fallback_query_count: 1,
  }]);
});

test("other facets alone never prove locations and diagnostics never contain provider values", async (t) => {
  const warn = t.mock.method(log, "warn", () => {});
  for (const facetUrn of [" urn:li:adTargetingFacet:industries ", "Bearer private-provider-value"]) {
    const result = await geoResolution.resolveLinkedInAdsGeoTargets({
      targets: [arras], language: "fr", country: "FR",
      resolvedPayload: { elements: [{ ...arras, name: "private-company-name", facetUrn }] },
      read: async () => ({ elements: [] }),
    });
    assert.deepEqual(result, []);
  }
  assert.equal(warn.mock.calls.length, 2);
  for (const call of warn.mock.calls) {
    assert.deepEqual(call.arguments, ["linkedin_ads_geo_resolution_empty", {
      provider: "linkedin", requested_count: 1, verified_count: 0, ignored_non_location_count: 1,
      urn_response_shape: "elements",
      urn_facet_counts: { locations: 0, profile_locations: 0, other: 1, missing: 0, malformed_row: 0 },
      fresh_suggestion_count: 0, fallback_query_count: 1,
    }]);
    assert.doesNotMatch(JSON.stringify(call.arguments), /private|Bearer|urn:li|Arras/);
  }
});

test("non-location representations cannot veto fresh exact locations suggestions", async (t) => {
  t.mock.method(log, "info", () => {});
  for (const facetUrn of ["urn:li:adTargetingFacet:industries", "urn:li:adTargetingFacet:opaqueVariant"]) {
    assert.deepEqual(await geoResolution.resolveLinkedInAdsGeoTargets({
      targets: [arras], language: "fr", country: "FR", freshSuggestions: [arras],
      resolvedPayload: { elements: [{ ...arras, facetUrn }] },
      read: async () => assert.fail("A fresh exact locations suggestion already proves this URN"),
    }), [arras]);
  }
});

test("malformed LinkedIn campaign groups and locales report their own reads", async () => {
  for (const operation of ["campaign_groups", "interface_locales"] as const) {
    const fetchImpl: typeof fetch = async (input) => {
      const request = new URL(String(input));
      if (operation === "campaign_groups" && request.pathname.endsWith("/adCampaignGroups")) {
        return Response.json({ elements: [{ id: 456, account: "urn:li:sponsoredAccount:999", status: "ACTIVE" }] });
      }
      if (operation === "interface_locales" && request.searchParams.get("q") === "adTargetingFacet") {
        return Response.json({ elements: [{ urn: "invalid-locale" }] });
      }
      return providerResponse(request);
    };
    const runtime = loadPreflight(fetchImpl);
    await assert.rejects(runtime.run("owner", {}), (error: unknown) => {
      const failure = error as PreflightFailure;
      assert.equal(failure.code, "provider_invalid_response");
      assert.equal(failure.operation, operation);
      return true;
    });
  }
});

test("preflight recovers a rejected geo URN finder with exact fresh suggestions and never masks access failures", async () => {
  const runtime = loadPreflight(async input => {
    const request = new URL(String(input));
    if (request.searchParams.get("q") === "urns") return Response.json({}, { status: 400 });
    return providerResponse(request);
  });
  const result = await runtime.run("owner", { geoQueries: ["Arras"], geoUrns: [arras.urn] });
  assert.deepEqual(result.selected.verifiedGeoUrns, [arras.urn]);
  assert.equal(result.blockers.includes("selected_geo_unverified"), false);
  assert.ok(runtime.logs.some(entry => entry.message === "linkedin_ads_preflight_geo_urn_fallback"));
  for (const status of [401, 403, 429, 500]) {
    const denied = loadPreflight(async input => {
      const request = new URL(String(input));
      return request.searchParams.get("q") === "urns" ? Response.json({}, { status }) : providerResponse(request);
    });
    await assert.rejects(denied.run("owner", { geoQueries: ["Arras"], geoUrns: [arras.urn] }));
    assert.equal(denied.logs.some(entry => entry.message === "linkedin_ads_preflight_geo_urn_fallback"), false);
  }
});

test("the preflight deterministically selects an existing group with two or more provider groups", async () => {
  const now = Date.now(), endAt = new Date(now + 8 * 86_400_000).toISOString();
  const native = (id: string, overrides: Record<string, unknown> = {}) => ({
    id, account: "urn:li:sponsoredAccount:123", name: "Existing group " + id, status: "ACTIVE",
    objectiveType: "WEBSITE_VISIT", allowedCampaignTypes: ["SPONSORED_UPDATES"], runSchedule: {}, ...overrides,
  });
  const groups = [native("8"), native("9", { backfilled: true }), native("7", { status: "PAUSED", backfilled: true }),
    native("1", { backfilled: true, runSchedule: { end: now + 86_400_000 } }), native("2", { objectiveType: "ENGAGEMENT" })];
  const choices = deliverySettings.defaultLinkedInDeliverySettings();
  choices.budget.endAt = endAt;
  const run = async (providerGroups: typeof groups, campaignGroupId?: string) => loadPreflight(async (input, init) => {
    assert.ok(!init?.method || init.method === "GET", "selection only performs provider reads");
    const request = new URL(String(input));
    if (request.pathname.endsWith("/adCampaignGroups")) return Response.json({ elements: providerGroups });
    return providerResponse(request);
  }).run("owner", { deliverySettings: choices, campaignGroupId });
  assert.equal((await run(groups)).selected.campaignGroup?.id, "9");
  assert.equal((await run([...groups].reverse())).selected.campaignGroup?.id, "9");
  assert.equal((await run(groups, "7")).selected.campaignGroup?.id, "7", "explicit paused group is preserved");
  assert.equal((await run(groups, "404")).selected.campaignGroup, null, "unavailable explicit choice never silently changes");
});

test("the preflight leaves the group empty when no provider schedule can fit the requested budget calendar", async () => {
  const now = Date.now(), choices = deliverySettings.defaultLinkedInDeliverySettings();
  choices.budget = { type: "total", totalEuros: 100, startAt: new Date(now + 600_000).toISOString(), endAt: new Date(now + 8 * 86_400_000).toISOString() };
  const runtime = loadPreflight(async (input) => {
    const request = new URL(String(input));
    if (request.pathname.endsWith("/adCampaignGroups")) return Response.json({ elements: [{
      id: "456", account: "urn:li:sponsoredAccount:123", name: "Existing group", status: "ACTIVE",
      objectiveType: "WEBSITE_VISIT", runSchedule: { end: now + 86_400_000 },
    }] });
    return providerResponse(request);
  });
  const result = await runtime.run("owner", { deliverySettings: choices });
  assert.equal(result.selected.campaignGroup, null);
  assert.ok(result.blockers.includes("campaign_group_required"));
});
