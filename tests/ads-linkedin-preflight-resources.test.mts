import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import * as policy from "../lib/adsLinkedInPreflightPolicy.ts";
import { linkedInAdsContextualGeoDefaults } from "../lib/adsLinkedInClientDefaults.ts";

type PreflightResult = {
  selected: { verifiedGeoUrns: string[] };
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

test("a malformed LinkedIn geo resolver envelope reports the exact read", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const request = new URL(String(input));
    if (request.pathname === "/rest/adTargetingEntities" && request.searchParams.get("q") === "urns") {
      return Response.json({ results: {} });
    }
    return providerResponse(request);
  };
  const runtime = loadPreflight(fetchImpl);
  await assert.rejects(runtime.run("owner", { geoUrns: [arras.urn] }), (error: unknown) => {
    const failure = error as PreflightFailure;
    assert.equal(failure.code, "provider_invalid_response");
    assert.equal(failure.operation, "geo_urn_resolution");
    assert.match(failure.message, /Zones LinkedIn Ads/);
    return true;
  });
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
