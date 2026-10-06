import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import * as linkedInPreflightPolicy from "../lib/adsLinkedInPreflightPolicy.ts";
import * as geoResolution from "../lib/adsLinkedInGeoResolution.ts";
import { linkedInAdsContextualGeoDefaults } from "../lib/adsLinkedInClientDefaults.ts";
import {
  buildLinkedInAdsAudienceCountPath,
  buildLinkedInAdsBudgetPricingPath,
  buildLinkedInAdsGeoSearchMinimalPath,
  buildLinkedInAdsGeoSearchPath,
  buildLinkedInAdsGeoUrnsPath,
  linkedInAdsCampaignGroupIsCompatible,
  linkedInAdsPreflightBlockers,
  normalizeLinkedInAdsAudienceCount,
  normalizeLinkedInAdsBudgetPricing,
  normalizeLinkedInAdsCampaignGroup,
  normalizeLinkedInAdsGeoQueries,
  normalizeLinkedInAdsImage,
  normalizeLinkedInAdsLocales,
  normalizeLinkedInAdsTargetingEntities,
  recommendedLinkedInAdsBid,
  selectUnambiguousLinkedInAdsGeoTarget,
} from "../lib/adsLinkedInPreflightPolicy.ts";

const group = {
  id: 456,
  account: "urn:li:sponsoredAccount:123",
  name: "Groupe test",
  status: "ACTIVE",
  objectiveType: "WEBSITE_VISIT",
  allowedCampaignTypes: ["SPONSORED_UPDATES"],
  runSchedule: { start: 1_800_000_000_000 },
};

test("LinkedIn preflight normalizes only resources belonging to the selected account", () => {
  const normalized = normalizeLinkedInAdsCampaignGroup(group, "123");
  assert.equal(normalized?.urn, "urn:li:sponsoredCampaignGroup:456");
  assert.equal(normalizeLinkedInAdsCampaignGroup(group, "999"), null);
  assert.deepEqual(normalizeLinkedInAdsTargetingEntities({ elements: [{
    urn: "urn:li:geo:105015875", name: "France", facetUrn: "urn:li:adTargetingFacet:locations",
  }] }), [{ urn: "urn:li:geo:105015875", name: "France", facetUrn: "urn:li:adTargetingFacet:locations" }]);
  assert.deepEqual(normalizeLinkedInAdsLocales({ elements: [{ urn: "urn:li:locale:fr_FR" }] }), [
    { language: "fr", country: "FR" },
  ]);
  assert.deepEqual(normalizeLinkedInAdsImage({
    id: "urn:li:image:C4D10AQFexample", owner: "urn:li:organization:789", status: "AVAILABLE",
    mediaLibraryMetadata: { associatedAccount: "urn:li:sponsoredAccount:123" },
  }, "urn:li:image:C4D10AQFexample"), {
    urn: "urn:li:image:C4D10AQFexample", owner: "urn:li:organization:789", status: "AVAILABLE",
    associatedAccount: "urn:li:sponsoredAccount:123",
  });
});

test("LinkedIn preflight builds Bing-geo, audience and pricing read paths", () => {
  const geoPath = buildLinkedInAdsGeoSearchPath({
    query: "France", accountId: "123", language: "fr", country: "FR",
  });
  const geoParams = new URL(geoPath, "https://api.linkedin.com").searchParams;
  assert.deepEqual(Object.fromEntries(geoParams), {
    q: "typeahead",
    query: "France",
    facet: "urn:li:adTargetingFacet:locations",
    queryVersion: "QUERY_USES_URNS",
    "locale.language": "fr",
    "locale.country": "FR",
    lixEntity: "urn:li:sponsoredAccount:123",
  });
  const fallbackGeoParams = new URL(buildLinkedInAdsGeoSearchPath({
    query: "France", accountId: "123",
  }), "https://api.linkedin.com").searchParams;
  assert.equal(fallbackGeoParams.get("q"), "typeahead");
  assert.equal(fallbackGeoParams.get("query"), "France");
  assert.equal(fallbackGeoParams.get("facet"), "urn:li:adTargetingFacet:locations");
  assert.equal(fallbackGeoParams.get("queryVersion"), "QUERY_USES_URNS");
  assert.equal(fallbackGeoParams.get("lixEntity"), "urn:li:sponsoredAccount:123");
  assert.equal(fallbackGeoParams.has("locale.language"), false);
  assert.equal(fallbackGeoParams.has("locale.country"), false);
  assert.equal(fallbackGeoParams.has("locale"), false);
  const minimalGeoParams = new URL(buildLinkedInAdsGeoSearchMinimalPath("Arras"), "https://api.linkedin.com").searchParams;
  assert.deepEqual(Object.fromEntries(minimalGeoParams), {
    q: "typeahead",
    facet: "urn:li:adTargetingFacet:locations",
    query: "Arras",
  });
  assert.throws(() => buildLinkedInAdsGeoSearchMinimalPath("A"), /Invalid LinkedIn Ads geo query/);
  assert.throws(() => buildLinkedInAdsGeoSearchPath({
    query: "France", accountId: "not-an-account", language: "fr", country: "FR",
  }), /Invalid LinkedIn Ads geo query/);
  assert.throws(() => buildLinkedInAdsGeoSearchPath({
    query: "France", accountId: "123", language: "fr",
  }), /Invalid LinkedIn Ads geo query/);
  const exactGeoPath = buildLinkedInAdsGeoUrnsPath(["urn:li:geo:105015875"], "fr", "FR");
  assert.match(exactGeoPath, /adTargetingEntities\?q=urns/);
  assert.match(exactGeoPath, /queryVersion=QUERY_USES_URNS/);
  assert.match(exactGeoPath, /urns=List\(urn%3Ali%3Ageo%3A105015875\)/);
  assert.match(exactGeoPath, /locale=\(language:fr,country:FR\)/);
  assert.match(buildLinkedInAdsGeoUrnsPath(["urn:li:geo:1001", "urn:li:geo:1002"], "fr", "FR"),
    /urns=List\(urn%3Ali%3Ageo%3A1001,urn%3Ali%3Ageo%3A1002\)/);
  const audiencePath = buildLinkedInAdsAudienceCountPath(["urn:li:geo:105015875"], "fr", "FR");
  assert.match(audiencePath, /audienceCounts\?q=targetingCriteriaV2/);
  assert.match(audiencePath, /urn%3Ali%3Ageo%3A105015875/);
  const multiAudiencePath = buildLinkedInAdsAudienceCountPath(["urn:li:geo:1001", "urn:li:geo:1002"], "fr", "FR");
  assert.match(multiAudiencePath, /urn%3Ali%3Ageo%3A1001,urn%3Ali%3Ageo%3A1002/);
  const pricingPath = buildLinkedInAdsBudgetPricingPath({
    accountId: "123", geoUrns: ["urn:li:geo:105015875"], language: "fr", country: "FR", dailyBudget: 25,
  });
  assert.match(pricingPath, /adBudgetPricing\?account=urn%3Ali%3AsponsoredAccount%3A123/);
  assert.match(pricingPath, /bidType=CPC/);
  assert.match(pricingPath, /dailyBudget=\(amount:25\.00,currencyCode:EUR\)/);
  const multiPricingPath = buildLinkedInAdsBudgetPricingPath({
    accountId: "123", geoUrns: ["urn:li:geo:1001", "urn:li:geo:1002"],
    language: "fr", country: "FR", dailyBudget: 25,
  });
  assert.match(multiPricingPath, /urn%3Ali%3Ageo%3A1001,urn%3Ali%3Ageo%3A1002/);
});

test("LinkedIn preflight accepts up to eight distinct place queries", () => {
  assert.deepEqual(normalizeLinkedInAdsGeoQueries([" Arras ", "arras", "Lille"]), ["Arras", "Lille"]);
  assert.deepEqual(normalizeLinkedInAdsGeoQueries([]), []);
  assert.throws(() => normalizeLinkedInAdsGeoQueries(["A"]), /Invalid LinkedIn Ads geo query/);
  assert.throws(() => normalizeLinkedInAdsGeoQueries(Array.from({ length: 9 }, (_, index) => `Ville ${index}`)),
    /Too many LinkedIn Ads geo queries/);
  const route = readFileSync("app/api/ads/linkedin/preflight/route.ts", "utf8");
  assert.match(route, /normalizeLinkedInAdsGeoQueries\(params\.getAll\("geo"\)\)/);
});

test("LinkedIn preflight auto-selects only unambiguous provider resources", () => {
  assert.equal(linkedInAdsCampaignGroupIsCompatible(group), true);
  assert.equal(linkedInAdsCampaignGroupIsCompatible({
    ...group, objectiveType: "LEAD_GENERATION",
  }), false);
  const arras = {
    urn: "urn:li:geo:1001",
    name: "Arras, Hauts-de-France, France",
    facetUrn: "urn:li:adTargetingFacet:locations",
  };
  const armentieres = {
    urn: "urn:li:geo:1002",
    name: "Armentières, Hauts-de-France, France",
    facetUrn: "urn:li:adTargetingFacet:locations",
  };
  assert.deepEqual(selectUnambiguousLinkedInAdsGeoTarget([arras, armentieres], "Arras"), arras);
  assert.deepEqual(selectUnambiguousLinkedInAdsGeoTarget([arras], "Arras, Hauts-de-France"), arras);
  assert.deepEqual(selectUnambiguousLinkedInAdsGeoTarget([{
    ...arras, name: "St. Omer, Hauts-de-France, France",
  }], "Saint-Omer"), { ...arras, name: "St. Omer, Hauts-de-France, France" });
  assert.equal(selectUnambiguousLinkedInAdsGeoTarget([arras, { ...arras, urn: "urn:li:geo:1003" }], "Arras"), null);
  assert.equal(selectUnambiguousLinkedInAdsGeoTarget([arras], "Hauts-de-France"), null);
});

type RuntimePreflightResult = {
  geoSuggestions: Array<{ urn: string; name: string; facetUrn: string }>;
  geoResolutions: Array<{
    query: string;
    suggestions: Array<{ urn: string; name: string; facetUrn: string }>;
    autoSelectedUrn: string | null;
    status: "ok" | "provider_rejected";
  }>;
  selected: {
    verifiedGeoUrns: string[];
    verifiedGeoTargets: Array<{ urn: string; name: string; facetUrn: string }>;
  };
  blockers: string[];
};

type RuntimePreflightFailure = Error & {
  code: string;
  status: number;
  operation: string;
  providerStatus: number | null;
  providerCode: number | null;
  providerRequestId: string | null;
};

const preflightRuntimeSource = ts.transpileModule(
  readFileSync(new URL("../lib/adsLinkedInPreflightServer.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } },
).outputText;

function loadPreflightRuntime(fetchImpl: typeof fetch) {
  const logs: Array<{ message: string; context: Record<string, unknown> }> = [];
  class RuntimeConnectionError extends Error {
    code: string;
    status: number;

    constructor(message: string, code: string, status = 503) {
      super(message);
      this.name = "LinkedInAdsConnectionError";
      this.code = code;
      this.status = status;
    }
  }
  const account = {
    id: "123",
    name: "Compte test",
    currency: "EUR",
    country: "FR",
    status: "ACTIVE",
    type: "BUSINESS",
    productType: "",
    servingStatuses: ["RUNNABLE"],
    test: false,
    permissions: ["CAMPAIGN_MANAGER"],
    canManageCampaigns: true,
    canServeCampaigns: true,
  };
  const modules = new Map<string, unknown>([
    ["server-only", {}],
    ["./adsLinkedInPolicy.ts", {
      LINKEDIN_ADS_API_VERSION: "202609",
      linkedInAdsScopes: (value: unknown) => String(value || "").split(/\s+/).filter(Boolean),
    }],
    ["./adsLinkedInServer.ts", {
      LinkedInAdsConnectionError: RuntimeConnectionError,
      readLinkedInAdsIntegration: async () => ({ resource_id: account.id }),
      linkedInAdsAuthorization: async () => ({ token: "isolated-test-token", scopes: "rw_ads r_ads_reporting" }),
      listLinkedInAdsAccounts: async () => [account],
    }],
    ["./adsLinkedInPreflightPolicy.ts", linkedInPreflightPolicy],
    ["./adsLinkedInGeoResolution.ts", geoResolution],
    ["./adsLinkedInClientDefaults.ts", { linkedInAdsContextualGeoDefaults }],
    ["./observability/logger.ts", {
      log: {
        warn: (message: string, context: Record<string, unknown>) => logs.push({ message, context }),
        error: (message: string, context: Record<string, unknown>) => logs.push({ message, context }),
      },
    }],
  ]);
  const loaded = { exports: {} as {
    runLinkedInAdsPreflight: (userId: string, input: Record<string, unknown>) => Promise<RuntimePreflightResult>;
  } };
  new Function("module", "exports", "require", "process", "fetch", "AbortSignal", preflightRuntimeSource)(
    loaded,
    loaded.exports,
    (specifier: string) => {
      assert.ok(modules.has(specifier), `Unisolated preflight dependency: ${specifier}`);
      return modules.get(specifier);
    },
    { env: { LINKEDIN_ADS_DEVELOPMENT_ACCOUNT_IDS: account.id } },
    fetchImpl,
    AbortSignal,
  );
  return { run: loaded.exports.runLinkedInAdsPreflight, logs };
}

function nonGeoPreflightResponse(request: URL): Response {
  if (request.pathname.endsWith("/adCampaignGroups")) return Response.json({ elements: [{
    id: 456,
    account: "urn:li:sponsoredAccount:123",
    name: "Groupe test",
    status: "ACTIVE",
    objectiveType: "WEBSITE_VISIT",
    allowedCampaignTypes: ["SPONSORED_UPDATES"],
    runSchedule: {},
  }] });
  if (request.pathname === "/rest/adTargetingEntities"
    && request.searchParams.get("q") === "adTargetingFacet") {
    return Response.json({ elements: [{ urn: "urn:li:locale:fr_FR" }] });
  }
  if (request.pathname === "/rest/audienceCounts") return Response.json({ elements: [{ total: 1000 }] });
  assert.fail(`Unexpected provider read: ${request.pathname}?${request.searchParams.toString()}`);
}

test("LinkedIn geo preflight retries one account-scoped typeahead without locale after provider 400", async () => {
  const requests: URL[] = [];
  const providerGeo = {
    urn: "urn:li:geo:1001",
    name: "Arras, Hauts-de-France, France",
    facetUrn: "urn:li:adTargetingFacet:locations",
  };
  const fetchImpl: typeof fetch = async (input) => {
    const request = new URL(String(input));
    requests.push(request);
    if (request.pathname === "/rest/adTargetingEntities" && request.searchParams.get("q") === "typeahead") {
      return request.searchParams.has("locale.language")
        ? Response.json({ message: "localized query rejected" }, { status: 400 })
        : Response.json({ elements: [providerGeo] });
    }
    return nonGeoPreflightResponse(request);
  };
  const runtime = loadPreflightRuntime(fetchImpl);
  const result = await runtime.run("owner", { geoQuery: "Arras", language: "fr", country: "FR" });
  const typeaheadRequests = requests.filter((request) => request.searchParams.get("q") === "typeahead");
  assert.equal(typeaheadRequests.length, 2);
  assert.equal(typeaheadRequests[0].searchParams.get("locale.language"), "fr");
  assert.equal(typeaheadRequests[0].searchParams.get("locale.country"), "FR");
  assert.equal(typeaheadRequests[1].searchParams.has("locale.language"), false);
  assert.equal(typeaheadRequests[1].searchParams.has("locale.country"), false);
  for (const request of typeaheadRequests) {
    assert.equal(request.searchParams.get("query"), "Arras");
    assert.equal(request.searchParams.get("facet"), "urn:li:adTargetingFacet:locations");
    assert.equal(request.searchParams.get("queryVersion"), "QUERY_USES_URNS");
    assert.equal(request.searchParams.get("lixEntity"), "urn:li:sponsoredAccount:123");
  }
  assert.equal(requests.some((request) => request.searchParams.get("q") === "urns"), false);
  assert.deepEqual(result.geoSuggestions, [providerGeo]);
  assert.deepEqual(result.selected.verifiedGeoTargets, [providerGeo]);
  assert.deepEqual(result.selected.verifiedGeoUrns, [providerGeo.urn]);
  assert.deepEqual(runtime.logs, [{
    message: "linkedin_ads_preflight_geo_locale_fallback",
    context: {
      provider: "linkedin",
      operation: "geo_typeahead_localized",
      provider_status: 400,
      fallback_operation: "geo_typeahead_default_locale",
    },
  }]);
  assert.doesNotMatch(JSON.stringify(runtime.logs), /Arras|isolated-test-token|localized query rejected/);
});

test("LinkedIn geo preflight never retries authentication or provider availability failures", async () => {
  for (const providerStatus of [403, 503]) {
    let typeaheadReads = 0;
    const fetchImpl: typeof fetch = async (input) => {
      const request = new URL(String(input));
      if (request.pathname === "/rest/adTargetingEntities" && request.searchParams.get("q") === "typeahead") {
        typeaheadReads++;
        return Response.json({}, { status: providerStatus });
      }
      return nonGeoPreflightResponse(request);
    };
    const runtime = loadPreflightRuntime(fetchImpl);
    await assert.rejects(
      runtime.run("owner", { geoQuery: "Arras", language: "fr", country: "FR" }),
      (error: unknown) => {
        const failure = error as RuntimePreflightFailure;
        assert.equal(failure.providerStatus, providerStatus);
        assert.equal(failure.operation, "geo_typeahead_localized");
        assert.equal(failure.code, providerStatus === 403 ? "preflight_access_denied" : "provider_unavailable");
        assert.equal(failure.status, providerStatus === 403 ? 403 : 503);
        return true;
      },
    );
    assert.equal(typeaheadReads, 1);
    assert.deepEqual(runtime.logs, []);
  }
});

test("LinkedIn geo preflight uses the documented minimum after both scoped reads return 400", async () => {
  const requests: URL[] = [];
  const providerGeo = {
    urn: "urn:li:geo:1001",
    name: "Arras, Hauts-de-France, France",
    facetUrn: "urn:li:adTargetingFacet:locations",
  };
  const fetchImpl: typeof fetch = async (input) => {
    const request = new URL(String(input));
    if (request.pathname === "/rest/adTargetingEntities" && request.searchParams.get("q") === "typeahead") {
      requests.push(request);
      return requests.length <= 2
        ? Response.json({}, { status: 400 })
        : Response.json({ elements: [providerGeo] });
    }
    return nonGeoPreflightResponse(request);
  };
  const runtime = loadPreflightRuntime(fetchImpl);
  const result = await runtime.run("owner", { geoQuery: "Arras", language: "fr", country: "FR" });
  assert.equal(requests.length, 3);
  assert.deepEqual(Object.fromEntries(requests[2].searchParams), {
    q: "typeahead", facet: "urn:li:adTargetingFacet:locations", query: "Arras",
  });
  assert.deepEqual(result.geoSuggestions, [providerGeo]);
  assert.deepEqual(result.selected.verifiedGeoTargets, [providerGeo]);
  assert.deepEqual(result.selected.verifiedGeoUrns, [providerGeo.urn]);
  assert.deepEqual(runtime.logs.map((entry) => entry.message), [
    "linkedin_ads_preflight_geo_locale_fallback",
    "linkedin_ads_preflight_geo_minimal_fallback",
  ]);
});

test("LinkedIn geo preflight keeps ambiguous minimal suggestions unselected", async () => {
  const arras = {
    urn: "urn:li:geo:1001", name: "Arras, Hauts-de-France, France",
    facetUrn: "urn:li:adTargetingFacet:locations",
  };
  let typeaheadReads = 0;
  const fetchImpl: typeof fetch = async (input) => {
    const request = new URL(String(input));
    if (request.pathname === "/rest/adTargetingEntities" && request.searchParams.get("q") === "typeahead") {
      typeaheadReads++;
      return typeaheadReads <= 2 ? Response.json({}, { status: 400 })
        : Response.json({ elements: [arras, { ...arras, urn: "urn:li:geo:1002" }] });
    }
    return nonGeoPreflightResponse(request);
  };
  const runtime = loadPreflightRuntime(fetchImpl);
  const result = await runtime.run("owner", { geoQuery: "Arras", language: "fr", country: "FR" });
  assert.equal(typeaheadReads, 3);
  assert.equal(result.geoSuggestions.length, 2);
  assert.deepEqual(result.selected.verifiedGeoTargets, []);
  assert.deepEqual(result.selected.verifiedGeoUrns, []);
});

test("LinkedIn geo preflight maps three rejected reads to a safe operation-specific error", async () => {
  let typeaheadReads = 0;
  const fetchImpl: typeof fetch = async (input) => {
    const request = new URL(String(input));
    if (request.pathname === "/rest/adTargetingEntities" && request.searchParams.get("q") === "typeahead") {
      typeaheadReads++;
      return Response.json({ code: 123, message: "do not expose provider details or tokens" }, {
        status: 400, headers: { "x-li-uuid": "xreq12345" },
      });
    }
    return nonGeoPreflightResponse(request);
  };
  const runtime = loadPreflightRuntime(fetchImpl);
  await assert.rejects(
    runtime.run("owner", { geoQuery: "Arras", language: "fr", country: "FR" }),
    (error: unknown) => {
      const failure = error as RuntimePreflightFailure;
      assert.equal(failure.code, "preflight_geo_typeahead_rejected");
      assert.equal(failure.status, 502);
      assert.equal(failure.operation, "geo_typeahead_minimal");
      assert.equal(failure.providerStatus, 400);
      assert.equal(failure.providerCode, 123);
      assert.equal(failure.providerRequestId, "xreq12345");
      assert.doesNotMatch(failure.message, /provider details|Arras|token/i);
      return true;
    },
  );
  assert.equal(typeaheadReads, 3);
});

test("LinkedIn preflight resolves two places independently and combines verified URNs", async () => {
  const arras = {
    urn: "urn:li:geo:1001", name: "Arras, Hauts-de-France, France",
    facetUrn: "urn:li:adTargetingFacet:locations",
  };
  const lille = { ...arras, urn: "urn:li:geo:1002", name: "Lille, Hauts-de-France, France" };
  const requests: URL[] = [];
  let arrasReads = 0;
  const fetchImpl: typeof fetch = async (input) => {
    const request = new URL(String(input));
    requests.push(request);
    if (request.pathname === "/rest/adTargetingEntities" && request.searchParams.get("q") === "typeahead") {
      if (request.searchParams.get("query") === "Arras") {
        arrasReads++;
        return arrasReads <= 2 ? Response.json({}, { status: 400 }) : Response.json({ elements: [arras] });
      }
      assert.equal(request.searchParams.get("query"), "Lille");
      return Response.json({ elements: [lille] });
    }
    return nonGeoPreflightResponse(request);
  };
  const runtime = loadPreflightRuntime(fetchImpl);
  const result = await runtime.run("owner", {
    geoQueries: ["Arras", "Lille", "arras"], language: "fr", country: "FR",
  });
  assert.equal(arrasReads, 3);
  assert.equal(requests.filter((request) => request.searchParams.get("query") === "Lille").length, 1);
  assert.deepEqual(result.geoSuggestions, [arras, lille]);
  assert.deepEqual(result.geoResolutions.map((resolution) => [resolution.query, resolution.autoSelectedUrn]), [
    ["Arras", arras.urn], ["Lille", lille.urn],
  ]);
  assert.deepEqual(result.selected.verifiedGeoUrns, [arras.urn, lille.urn]);
  const audienceRequest = requests.find((request) => request.pathname === "/rest/audienceCounts");
  assert.ok(audienceRequest);
  assert.match(audienceRequest.href, /urn%3Ali%3Ageo%3A1001/);
  assert.match(audienceRequest.href, /urn%3Ali%3Ageo%3A1002/);
  assert.equal(result.blockers.includes("unresolved_geo_queries"), false);
});

test("LinkedIn preflight leaves one ambiguous place pending while keeping another verified", async () => {
  const arras = {
    urn: "urn:li:geo:1001", name: "Arras, Hauts-de-France, France",
    facetUrn: "urn:li:adTargetingFacet:locations",
  };
  const lille = { ...arras, urn: "urn:li:geo:1003", name: "Lille, Hauts-de-France, France" };
  const fetchImpl: typeof fetch = async (input) => {
    const request = new URL(String(input));
    if (request.pathname === "/rest/adTargetingEntities" && request.searchParams.get("q") === "typeahead") {
      return request.searchParams.get("query") === "Arras"
        ? Response.json({ elements: [arras, { ...arras, urn: "urn:li:geo:1002" }] })
        : Response.json({ elements: [lille] });
    }
    if (request.pathname === "/rest/adTargetingEntities" && request.searchParams.get("q") === "urns") {
      return Response.json({ elements: [arras] });
    }
    return nonGeoPreflightResponse(request);
  };
  const runtime = loadPreflightRuntime(fetchImpl);
  const input = { geoQueries: ["Arras", "Lille"], language: "fr", country: "FR" };
  const pending = await runtime.run("owner", input);
  assert.deepEqual(pending.selected.verifiedGeoUrns, [lille.urn]);
  assert.equal(pending.geoResolutions[0].autoSelectedUrn, null);
  assert.equal(pending.geoResolutions[0].suggestions.length, 2);
  assert.ok(pending.blockers.includes("unresolved_geo_queries"));
  const chosen = await runtime.run("owner", { ...input, geoUrns: [arras.urn] });
  assert.deepEqual(chosen.selected.verifiedGeoUrns, [arras.urn, lille.urn]);
  assert.equal(chosen.blockers.includes("unresolved_geo_queries"), false);
});

test("LinkedIn preflight completes an ambiguous city from the other verified cities' region", async () => {
  const location = (urn: string, name: string) => ({
    urn, name, facetUrn: "urn:li:adTargetingFacet:locations",
  });
  const arras = location("urn:li:geo:1001", "Arras, Hauts-de-France, France");
  const arrasCanada = location("urn:li:geo:1002", "Arras, British Columbia, Canada");
  const lille = location("urn:li:geo:1003", "Lille, Hauts-de-France, France");
  const stOmer = location("urn:li:geo:1004", "St. Omer, Hauts-de-France, France");
  const fetchImpl: typeof fetch = async (input) => {
    const request = new URL(String(input));
    if (request.pathname === "/rest/adTargetingEntities" && request.searchParams.get("q") === "typeahead") {
      const query = request.searchParams.get("query");
      return Response.json({ elements: query === "Arras" ? [arrasCanada, arras]
        : query === "Lille" ? [lille] : query === "Saint-Omer" ? [stOmer] : [] });
    }
    return nonGeoPreflightResponse(request);
  };
  const result = await loadPreflightRuntime(fetchImpl).run("owner", {
    geoQueries: ["Arras", "Lille", "Saint-Omer"], language: "fr", country: "FR",
  });
  assert.deepEqual(result.selected.verifiedGeoUrns, [lille.urn, stOmer.urn, arras.urn]);
  assert.deepEqual(result.geoResolutions.map((resolution) => resolution.autoSelectedUrn), [
    arras.urn, lille.urn, stOmer.urn,
  ]);
  assert.equal(result.blockers.includes("unresolved_geo_queries"), false);
});

test("LinkedIn preflight verifies a chosen URN through an exact fresh typeahead match", async () => {
  const arras = {
    urn: "urn:li:geo:1001", name: "Arras, Hauts-de-France, France",
    facetUrn: "urn:li:adTargetingFacet:locations",
  };
  const fetchImpl: typeof fetch = async (input) => {
    const request = new URL(String(input));
    if (request.pathname === "/rest/adTargetingEntities" && request.searchParams.get("q") === "typeahead") {
      return Response.json({ elements: [arras] });
    }
    if (request.pathname === "/rest/adTargetingEntities" && request.searchParams.get("q") === "urns") {
      return Response.json({ elements: [] });
    }
    return nonGeoPreflightResponse(request);
  };
  const runtime = loadPreflightRuntime(fetchImpl);
  const result = await runtime.run("owner", {
    geoQueries: ["Arras"], geoUrns: [arras.urn], language: "fr", country: "FR",
  });
  assert.ok(!result.blockers.includes("selected_geo_unverified"));
  assert.deepEqual(result.selected.verifiedGeoUrns, [arras.urn]);
});

test("LinkedIn preflight preserves a valid place when another is rejected by every typeahead form", async () => {
  const lille = {
    urn: "urn:li:geo:1002", name: "Lille, Hauts-de-France, France",
    facetUrn: "urn:li:adTargetingFacet:locations",
  };
  let arrasReads = 0;
  const fetchImpl: typeof fetch = async (input) => {
    const request = new URL(String(input));
    if (request.pathname === "/rest/adTargetingEntities" && request.searchParams.get("q") === "typeahead") {
      if (request.searchParams.get("query") === "Arras") {
        arrasReads++;
        return Response.json({ code: 123 }, { status: 400 });
      }
      return Response.json({ elements: [lille] });
    }
    return nonGeoPreflightResponse(request);
  };
  const runtime = loadPreflightRuntime(fetchImpl);
  const result = await runtime.run("owner", {
    geoQueries: ["Arras", "Lille"], language: "fr", country: "FR",
  });
  assert.equal(arrasReads, 3);
  assert.deepEqual(result.selected.verifiedGeoUrns, [lille.urn]);
  assert.deepEqual(result.geoResolutions.map((resolution) => [resolution.query, resolution.status]), [
    ["Arras", "provider_rejected"], ["Lille", "ok"],
  ]);
  assert.deepEqual(result.geoResolutions[0].suggestions, []);
  assert.ok(result.blockers.includes("geo_query_provider_rejected"));
  assert.ok(result.blockers.includes("unresolved_geo_queries"));
  assert.ok(runtime.logs.some((entry) => entry.message === "linkedin_ads_preflight_geo_partial_rejected"));
});

test("LinkedIn preflight still fails globally on a provider rate limit among place queries", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const request = new URL(String(input));
    if (request.pathname === "/rest/adTargetingEntities" && request.searchParams.get("q") === "typeahead") {
      return request.searchParams.get("query") === "Arras"
        ? Response.json({ elements: [] }) : Response.json({}, { status: 429 });
    }
    return nonGeoPreflightResponse(request);
  };
  const runtime = loadPreflightRuntime(fetchImpl);
  await assert.rejects(
    runtime.run("owner", { geoQueries: ["Arras", "Lille"], language: "fr", country: "FR" }),
    (error: unknown) => {
      const failure = error as RuntimePreflightFailure;
      assert.equal(failure.code, "preflight_provider_rate_limited");
      assert.equal(failure.providerStatus, 429);
      return true;
    },
  );
});

test("LinkedIn UI auto-selects one verified geo and keeps exact provider suggestions selectable", () => {
  const client = readFileSync("app/dashboard/ads/AdsClient.tsx", "utf8");
  assert.match(client, /const verifiedGeoUrns = new Set\(selected\.verifiedGeoUrns \|\| \[\]\)/);
  assert.match(client, /\.filter\(\(target\) => verifiedGeoUrns\.has\(target\.urn\)\)/);
  assert.match(client, /linkedInAdsContextualGeoDefaults\(\{[\s\S]*targetLocations: baseDraft\.targetLocations,[\s\S]*verifiedGeoTargets: verifiedGeoTargets\.filter\(\(target\) => !linkedInGeoDismissedUrns\.current\.has\(target\.urn\)\),[\s\S]*geoResolutions: data\.geoResolutions \|\| \[\]/);
  assert.match(
    client,
    /const addedGeoTargets = proposedGeoTargets\.filter\(\(target\) =>[\s\S]*!currentGeoUrns\.has\(target\.urn\) && !linkedInGeoDismissedUrns\.current\.has\(target\.urn\)/,
  );
  assert.match(client, /const nextGeoTargets = normalizeLinkedInGeoTargets\(\[\.\.\.currentGeoTargets, \.\.\.addedGeoTargets\]\)/);
  assert.match(client, /const data = await fetchLinkedInPreflight[\s\S]{0,240}applyLinkedInProviderDefaults\(data\)/);
  assert.match(
    client,
    /type="checkbox" checked=\{selected\}[\s\S]{0,700}\{ urn: target\.urn, name: target\.name \}/,
  );
  assert.match(client, /params\.append\("geoUrn", target\.urn\)/);
  assert.match(client, /fetchLinkedInPreflight\(undefined, true, accountId, launchDraft\)/);
});

test("LinkedIn preflight chooses a CPC only from verified provider bounds", () => {
  const pricing = { currency: "EUR", bidMin: 1.501, bidMax: 25, dailyBudgetMin: 10, dailyBudgetDefault: 25 };
  assert.equal(recommendedLinkedInAdsBid(pricing, 2.5), 2.5);
  assert.equal(recommendedLinkedInAdsBid(pricing, 1), 1.51);
  assert.equal(recommendedLinkedInAdsBid(pricing, null), 1.51);
  assert.equal(recommendedLinkedInAdsBid(pricing, 20, 10), 1.51);
  assert.equal(recommendedLinkedInAdsBid(pricing, null, 1), null);
  assert.equal(recommendedLinkedInAdsBid({ ...pricing, bidMin: 2, bidMax: 1 }, null), null);
  assert.equal(recommendedLinkedInAdsBid(null, 2.5), null);
});

test("LinkedIn preflight requires audience >= 300 and provider pricing evidence", () => {
  assert.equal(normalizeLinkedInAdsAudienceCount({ elements: [{ total: 299, active: 0 }] }), 299);
  const pricing = normalizeLinkedInAdsBudgetPricing({ elements: [{
    bidLimits: {
      min: { amount: "1.50", currencyCode: "EUR" }, max: { amount: "25", currencyCode: "EUR" },
    },
    dailyBudgetLimits: {
      min: { amount: "10", currencyCode: "EUR" }, default: { amount: "25", currencyCode: "EUR" },
    },
  }] });
  assert.deepEqual(pricing, { currency: "EUR", bidMin: 1.5, bidMax: 25, dailyBudgetMin: 10, dailyBudgetDefault: 25 });
  const campaignGroup = normalizeLinkedInAdsCampaignGroup(group, "123");
  const common = {
    scopes: ["rw_ads", "r_ads_reporting", "r_organization_admin", "w_organization_social"],
    accountCurrency: "EUR", canManageCampaigns: true, canServeCampaigns: true, targetStatus: "ACTIVE" as const, campaignGroup,
    image: { urn: "urn:li:image:C4D10AQFexample", owner: "urn:li:organization:789", status: "AVAILABLE", associatedAccount: null },
    organizationUrn: "urn:li:organization:789", localeSupported: true,
    verifiedGeoUrns: ["urn:li:geo:105015875"], pricing,
    bidAmount: 2.5, dailyBudget: 25, politicalIntentConfirmed: true, targetingNoticeAcknowledged: true,
  };
  assert.deepEqual(linkedInAdsPreflightBlockers({ ...common, audienceCount: 300 }), []);
  assert.ok(linkedInAdsPreflightBlockers({ ...common, audienceCount: 299 }).includes("audience_too_small"));
  assert.ok(linkedInAdsPreflightBlockers({
    ...common,
    scopes: common.scopes.filter((scope) => scope !== "r_ads_reporting"),
    audienceCount: 300,
  }).includes("missing_scope:r_ads_reporting"));

  const pausedGroup = normalizeLinkedInAdsCampaignGroup({ ...group, status: "PAUSED" }, "123");
  const activeBlocked = linkedInAdsPreflightBlockers({
    ...common, campaignGroup: pausedGroup, canServeCampaigns: false, audienceCount: 300,
  });
  assert.ok(activeBlocked.includes("account_not_serving"));
  assert.ok(activeBlocked.includes("campaign_group_not_active"));
  assert.deepEqual(linkedInAdsPreflightBlockers({
    ...common, targetStatus: "PAUSED", campaignGroup: pausedGroup,
    canServeCampaigns: false, audienceCount: 300,
  }), []);
});

test("LinkedIn resource preflight remains GET-only while publication is isolated in its publisher", () => {
  const route = readFileSync("app/api/ads/linkedin/preflight/route.ts", "utf8");
  const server = readFileSync("lib/adsLinkedInPreflightServer.ts", "utf8");
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function POST/);
  assert.match(server, /publicationEnabled:\s*false/);
  assert.doesNotMatch(server, /method:\s*["']POST["']/);
  assert.match(server, /LINKEDIN_ADS_DEVELOPMENT_ACCOUNT_IDS/);
  assert.match(server, /compatibleCampaignGroups\.length === 1/);
  assert.match(server, /organizations\.length === 1/);
  assert.match(server, /selectUnambiguousLinkedInAdsGeoTarget/);
  assert.match(server, /buildLinkedInAdsGeoUrnsPath/);
  assert.match(server, /recommendedLinkedInAdsBid/);
  assert.match(server, /error\.providerStatus !== 400/);
  assert.match(route, /LinkedInAdsPreflightProviderError/);
  assert.match(route, /linkedin_ads_preflight_failed/);
  assert.match(route, /provider_status: providerFailure\?\.providerStatus/);
  assert.match(route, /provider_code: providerFailure\?\.providerCode/);
  assert.match(route, /provider_request_id: providerFailure\?\.providerRequestId/);
  assert.doesNotMatch(route, /providerFailure\?\.message|JSON\.stringify\(error\)/);
});
