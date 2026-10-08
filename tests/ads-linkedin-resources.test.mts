import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import * as policy from "../lib/adsLinkedInResourcesPolicy.ts";
import * as accountPolicy from "../lib/adsLinkedInPolicy.ts";

function compiled(path: string) {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

class ConnectionError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status = 503) { super(message); this.code = code; this.status = status; }
}

const nativeTitle = { urn: "urn:li:title:4", name: "Directeur général", facetUrn: "urn:li:adTargetingFacet:titles" };
const chosenTitle: policy.LinkedInAdsProfessionalTarget = { facet: "titles", urn: nativeTitle.urn, name: "Forged client label" };
const conversion = { id: 101, account: "urn:li:sponsoredAccount:123", name: "Essai démarré", type: "START_TRIAL", enabled: true };

function serverRuntime(options: {
  read?: (path: string) => Promise<unknown>; accountIds?: string[]; selectedAccountId?: string | null;
  memberChanged?: boolean;
} = {}) {
  const calls: Array<{ op: string; value?: unknown }> = [];
  const reader = async (token: string, path: string) => {
    assert.equal(token, "isolated-token");
    calls.push({ op: "read", value: path });
    return options.read ? options.read(path) : { elements: [nativeTitle] };
  };
  const modules = new Map<string, unknown>([
    ["server-only", {}],
    ["./adsLinkedInPolicy.ts", accountPolicy],
    ["./adsLinkedInResourcesPolicy.ts", policy],
    ["./adsLinkedInServer.ts", {
      LinkedInAdsConnectionError: ConnectionError,
      readLinkedInAdsIntegration: async (owner: string) => {
        calls.push({ op: "integration", value: owner });
        const readingCurrent = calls.filter((call) => call.op === "integration").length > 1;
        return {
          id: "integration-id", provider_account_id: options.memberChanged && readingCurrent ? "new-member" : "same-member",
          resource_id: options.selectedAccountId === undefined ? "123" : options.selectedAccountId,
          access_token_enc: readingCurrent ? "refreshed-token-snapshot" : "old-token-snapshot",
        };
      },
      listLinkedInAdsAccounts: async (owner: string) => {
        calls.push({ op: "accounts", value: owner });
        return (options.accountIds || ["123"]).map((id) => ({ id }));
      },
      linkedInAdsAuthorization: async (owner: string, row: { access_token_enc: string }) => {
        assert.equal(row.access_token_enc, "refreshed-token-snapshot");
        calls.push({ op: "token", value: owner });
        return { token: "isolated-token" };
      },
      readLinkedInAdsResourceJson: reader,
    }],
  ]);
  type Exports = {
    listLinkedInAdsProfessionalTargets: (owner: string, input?: Record<string, unknown>) => Promise<Record<string, unknown>>;
    listLinkedInAdsConversions: (owner: string, input?: Record<string, unknown>) => Promise<Record<string, unknown>>;
    resolveLinkedInAdsProfessionalTargets: (input: {
      accessToken: string; targets: policy.LinkedInAdsProfessionalTarget[]; language?: string; country?: string; read?: (path: string) => Promise<unknown>;
    }) => Promise<{ verifiedTargets: policy.LinkedInAdsProfessionalTarget[]; unresolvedTargets: policy.LinkedInAdsProfessionalTarget[] }>;
    resolveLinkedInAdsConversions: (input: {
      accessToken: string; accountId: string; conversionUrns: string[]; read?: (path: string) => Promise<unknown>;
    }) => Promise<{ verifiedConversions: policy.LinkedInAdsConversionOption[]; unresolvedUrns: string[] }>;
  };
  const loaded = { exports: {} as Exports };
  new Function("module", "exports", "require", compiled("../lib/adsLinkedInResourcesServer.ts"))(
    loaded, loaded.exports, (specifier: string) => {
      assert.ok(modules.has(specifier), `Unexpected dependency ${specifier}`);
      return modules.get(specifier);
    },
  );
  return { api: loaded.exports, calls };
}

test("native professional facets map to the exact LinkedIn facet and safe finder", () => {
  assert.equal(policy.linkedInAdsProfessionalFacetUrn("companySizes"), "urn:li:adTargetingFacet:staffCountRanges");
  assert.equal(policy.linkedInAdsProfessionalFacetUrn("functions"), "urn:li:adTargetingFacet:jobFunctions");
  const path = policy.buildLinkedInAdsProfessionalSearchPath({ facet: "titles", query: "directeur &query=evil" });
  const url = new URL(path, "https://api.linkedin.com");
  assert.equal(url.searchParams.get("q"), "typeahead");
  assert.equal(url.searchParams.get("query"), "directeur &query=evil");
  assert.equal(url.searchParams.get("facet"), "urn:li:adTargetingFacet:titles");
  assert.equal(url.searchParams.get("locale"), "(language:fr,country:FR)");
  for (const facet of ["companySizes", "functions", "seniorities"] as const) {
    assert.equal(new URL(policy.buildLinkedInAdsProfessionalSearchPath({ facet, query: "direction" }), "https://api.linkedin.com").searchParams.get("q"), "adTargetingFacet");
  }
  assert.throws(() => policy.buildLinkedInAdsProfessionalSearchPath({ facet: "skills" }));
  assert.throws(() => policy.buildLinkedInAdsProfessionalSearchPath({ facet: "titles", query: "x" }));
  assert.throws(() => policy.buildLinkedInAdsProfessionalSearchPath({ facet: "titles", query: "ab", count: 101 }));
  assert.throws(() => policy.buildLinkedInAdsProfessionalSearchPath({ facet: "industries", language: "fr&bad" }));
});

test("professional identity normalization rejects cross-facet, missing facet and unavailable entities", () => {
  assert.deepEqual(policy.normalizeLinkedInAdsProfessionalTargets({ elements: [
    nativeTitle, nativeTitle, { ...nativeTitle, facetUrn: "urn:li:adTargetingFacet:skills" },
    { ...nativeTitle, facetUrn: undefined }, { ...nativeTitle, urn: "urn:li:title:5", isTargetable: false },
  ] }), [{ facet: "titles", urn: nativeTitle.urn, name: nativeTitle.name }]);
  assert.equal(policy.normalizeLinkedInAdsProfessionalTargets({ results: {} }), null);
  assert.equal(policy.isLinkedInAdsProfessionalUrn("companySizes", "urn:li:staffCountRange:(2,10)"), true);
  assert.equal(policy.isLinkedInAdsProfessionalUrn("companySizes", "urn:li:staffCountRange:(10,2)"), false);
  assert.equal(policy.isLinkedInAdsProfessionalUrn("titles", "urn:li:skill:4"), false);
});

test("fresh professional resolution replaces client labels and never substitutes another URN", async () => {
  const runtime = serverRuntime();
  const another: policy.LinkedInAdsProfessionalTarget = { ...chosenTitle, urn: "urn:li:title:8" };
  const result = await runtime.api.resolveLinkedInAdsProfessionalTargets({ accessToken: "isolated-token", targets: [chosenTitle, another, chosenTitle] });
  assert.deepEqual(result.verifiedTargets, [{ facet: "titles", urn: nativeTitle.urn, name: nativeTitle.name }]);
  assert.deepEqual(result.unresolvedTargets, [another]);
  assert.match(String(runtime.calls[0]?.value), /urns=List\(urn%3Ali%3Atitle%3A4,urn%3Ali%3Atitle%3A8\)/);
  const partial = serverRuntime({ read: async () => ({ elements: [{ ...nativeTitle, facetUrn: undefined }] }) });
  assert.deepEqual((await partial.api.resolveLinkedInAdsProfessionalTargets({ accessToken: "isolated-token", targets: [chosenTitle] })).verifiedTargets, []);
});

test("publisher may inject its own GET transport and keep provider diagnostics", async () => {
  const runtime = serverRuntime({ read: async () => { assert.fail("default transport must not be used"); } });
  const read = async () => ({ elements: [nativeTitle] });
  assert.equal((await runtime.api.resolveLinkedInAdsProfessionalTargets({ accessToken: "caller-token", targets: [chosenTitle], read })).verifiedTargets.length, 1);
  const readConversions = async () => ({ elements: [conversion] });
  assert.equal((await runtime.api.resolveLinkedInAdsConversions({ accessToken: "caller-token", accountId: "123", conversionUrns: ["urn:lla:llaPartnerConversion:101"], read: readConversions })).verifiedConversions.length, 1);
  assert.equal(runtime.calls.length, 0);
  const diagnostic = new ConnectionError("provider rejected", "provider_access_denied", 403);
  await assert.rejects(runtime.api.resolveLinkedInAdsProfessionalTargets({ accessToken: "caller-token", targets: [chosenTitle], read: async () => { throw diagnostic; } }), (error) => error === diagnostic);
});

test("an alternate URN facet representation requires exact native evidence from a fresh facet finder", async () => {
  const requests: URL[] = [];
  const runtime = serverRuntime({ read: async (path) => {
    const request = new URL(path, "https://api.linkedin.com");
    requests.push(request);
    return request.searchParams.get("q") === "urns"
      ? { elements: [{ ...nativeTitle, facetUrn: "urn:li:adTargetingFacet:titlesAll" }] }
      : { elements: [nativeTitle, { ...nativeTitle, urn: "urn:li:title:5" }] };
  } });
  const result = await runtime.api.resolveLinkedInAdsProfessionalTargets({ accessToken: "isolated-token", targets: [chosenTitle] });
  assert.deepEqual(result.verifiedTargets, [{ facet: "titles", urn: nativeTitle.urn, name: nativeTitle.name }]);
  assert.deepEqual(requests.map((request) => request.searchParams.get("q")), ["urns", "typeahead"]);
  assert.equal(requests[1].searchParams.get("facet"), "urn:li:adTargetingFacet:titles");
  const stale = serverRuntime({ read: async () => ({ elements: [{ ...nativeTitle, urn: "urn:li:title:5" }] }) });
  assert.equal((await stale.api.resolveLinkedInAdsProfessionalTargets({ accessToken: "isolated-token", targets: [chosenTitle] })).verifiedTargets.length, 0);
});

test("an explicit provider 400 from the professional URN finder uses exact current-facet evidence", async () => {
  const requests: URL[] = [];
  const target: policy.LinkedInAdsProfessionalTarget = { facet: "seniorities", urn: "urn:li:seniority:10", name: "Client label" };
  const native = { facetUrn: "urn:li:adTargetingFacet:seniorities", urn: target.urn, name: "Propriétaire" };
  const runtime = serverRuntime();
  const result = await runtime.api.resolveLinkedInAdsProfessionalTargets({ accessToken: "caller-token", targets: [target], read: async (path) => {
    const request = new URL(path, "https://api.linkedin.com");
    requests.push(request);
    if (request.searchParams.get("q") === "urns") {
      throw Object.assign(new ConnectionError("URN finder rejected", "preflight_professional_target_resolution_rejected", 502), { providerStatus: 400 });
    }
    assert.equal(request.searchParams.get("facet"), native.facetUrn);
    return { elements: [native] };
  } });
  assert.deepEqual(result.verifiedTargets, [{ ...target, name: native.name }]);
  assert.deepEqual(result.unresolvedTargets, []);
  assert.deepEqual(requests.map((request) => request.searchParams.get("q")), ["urns", "adTargetingFacet"]);
});

test("professional HTTP 400 fallback never substitutes matching labels, another facet or unavailable URNs", async () => {
  const runtime = serverRuntime();
  const result = await runtime.api.resolveLinkedInAdsProfessionalTargets({ accessToken: "caller-token", targets: [chosenTitle], read: async (path) => {
    if (new URL(path, "https://api.linkedin.com").searchParams.get("q") === "urns") {
      throw Object.assign(new ConnectionError("URN finder rejected", "provider_unavailable"), { providerStatus: 400 });
    }
    return { elements: [
      { ...nativeTitle, urn: "urn:li:title:5", name: chosenTitle.name },
      { ...nativeTitle, facetUrn: "urn:li:adTargetingFacet:titlesAll", name: chosenTitle.name },
      { ...nativeTitle, isTargetable: false, name: chosenTitle.name },
    ] };
  } });
  assert.deepEqual(result.verifiedTargets, []);
  assert.deepEqual(result.unresolvedTargets, [chosenTitle]);
});

test("professional fallback never hides authorization, limits, network errors or a rejected facet finder", async () => {
  const runtime = serverRuntime();
  const failures = [
    ...[401, 403, 429, 500].map((status) => Object.assign(new ConnectionError("Provider failure", "provider_unavailable"), { providerStatus: status })),
    Object.assign(new ConnectionError("Network failure", "provider_unavailable"), { providerStatus: null }),
    new ConnectionError("Application 400 alone is not provider evidence", "invalid_selection", 400),
    new TypeError("Transport failure"),
  ];
  for (const failure of failures) {
    let reads = 0;
    await assert.rejects(runtime.api.resolveLinkedInAdsProfessionalTargets({ accessToken: "caller-token", targets: [chosenTitle], read: async () => {
      reads++; throw failure;
    } }), (error) => error === failure);
    assert.equal(reads, 1);
  }
  const rejected = Object.assign(new ConnectionError("Facet finder also rejected", "provider_unavailable"), { providerStatus: 400 });
  let reads = 0;
  await assert.rejects(runtime.api.resolveLinkedInAdsProfessionalTargets({ accessToken: "caller-token", targets: [chosenTitle], read: async () => {
    reads++; throw rejected;
  } }), (error) => error === rejected);
  assert.equal(reads, 2);
});

test("native professional verification uses bounded URN batches without losing requested identities", async () => {
  const targets = Array.from({ length: 21 }, (_, index) => ({ facet: "titles" as const, urn: `urn:li:title:${index + 1}`, name: `Titre ${index + 1}` }));
  const paths: string[] = [];
  const runtime = serverRuntime();
  const result = await runtime.api.resolveLinkedInAdsProfessionalTargets({ accessToken: "caller-token", targets, read: async (path) => {
    paths.push(path);
    const query = new URL(path, "https://api.linkedin.com").searchParams.get("urns")!;
    const requestedUrns = query.slice(5, -1).split(",");
    return { elements: requestedUrns.map((urn) => ({ urn, name: "Intitulé natif", facetUrn: nativeTitle.facetUrn })) };
  } });
  assert.equal(result.verifiedTargets.length, 21);
  assert.equal(result.unresolvedTargets.length, 0);
  assert.equal(paths.length, 2);
});

test("resource lookup binds reads to the active owner and live accessible account membership", async () => {
  const runtime = serverRuntime();
  const result = await runtime.api.listLinkedInAdsProfessionalTargets("active-owner", { accountId: "123", facet: "titles", query: "directeur" });
  assert.equal(result.accountId, "123");
  assert.deepEqual(runtime.calls.slice(0, 4), [
    { op: "integration", value: "active-owner" }, { op: "accounts", value: "active-owner" },
    { op: "integration", value: "active-owner" }, { op: "token", value: "active-owner" },
  ]);
  const denied = serverRuntime();
  await assert.rejects(denied.api.listLinkedInAdsConversions("active-owner", { accountId: "456" }), (error: unknown) => (error as ConnectionError).code === "account_access_denied");
  assert.equal(denied.calls.some((call) => call.op === "read" || call.op === "token"), false);
  const missing = serverRuntime({ selectedAccountId: null });
  await assert.rejects(missing.api.listLinkedInAdsProfessionalTargets("active-owner"), (error: unknown) => (error as ConnectionError).code === "account_selection_required");
  const discovery = await serverRuntime().api.listLinkedInAdsProfessionalTargets("active-owner");
  assert.deepEqual(discovery.facets, policy.LINKEDIN_ADS_PROFESSIONAL_FACETS);
  const changed = serverRuntime({ memberChanged: true });
  await assert.rejects(changed.api.listLinkedInAdsConversions("active-owner", { accountId: "123" }), (error: unknown) => (error as ConnectionError).code === "connection_changed");
  assert.equal(changed.calls.some((call) => call.op === "token" || call.op === "read"), false);
});

test("conversion finder exposes enabled/disabled owned rules and explicitly shared rules without leaking pixels", () => {
  const options = policy.normalizeLinkedInAdsConversionOptions({ elements: [
    conversion, { ...conversion, id: 102, enabled: false, imagePixelTag: "secret tracking URL" },
    { ...conversion, id: 103, account: "urn:li:sponsoredAccount:456", ownershipType: "SHARED", conversionMethod: "CONVERSIONS_API" },
    { ...conversion, id: 104, account: "urn:li:sponsoredAccount:456" },
    { ...conversion, id: 105, enabled: "true" },
    { ...conversion, id: Number.MAX_SAFE_INTEGER + 1 },
    { ...conversion, id: 106, enabled: undefined },
  ] }, "123")!;
  assert.deepEqual(options.map((option) => [option.urn, option.enabled, option.ownershipType]), [
    ["urn:lla:llaPartnerConversion:101", true, "OWNED"],
    ["urn:lla:llaPartnerConversion:102", false, "OWNED"],
    ["urn:lla:llaPartnerConversion:103", true, "SHARED"],
    ["urn:lla:llaPartnerConversion:106", true, "OWNED"],
  ]);
  assert.equal(JSON.stringify(options).includes("secret"), false);
  assert.equal(policy.normalizeLinkedInAdsConversionOptions({ elements: [conversion, { ...conversion, enabled: false }] }, "123"), null);
});

test("fresh conversion verification accepts only exact enabled account-authorized rules", async () => {
  const runtime = serverRuntime({ read: async (path) => {
    assert.equal(new URL(path, "https://api.linkedin.com").searchParams.get("account"), "urn:li:sponsoredAccount:123");
    return { elements: [conversion, { ...conversion, id: 102, enabled: false }, { ...conversion, id: 103, account: "urn:li:sponsoredAccount:456" }] };
  } });
  const requested = ["urn:lla:llaPartnerConversion:101", "urn:lla:llaPartnerConversion:102", "urn:lla:llaPartnerConversion:103"];
  const result = await runtime.api.resolveLinkedInAdsConversions({ accessToken: "isolated-token", accountId: "123", conversionUrns: requested });
  assert.deepEqual(result.verifiedConversions.map((option) => option.urn), [requested[0]]);
  assert.deepEqual(result.unresolvedUrns, requested.slice(1));
});

test("conversion lookup follows account pagination and refuses inconsistent or malformed pages", async () => {
  const runtime = serverRuntime({ read: async (path) => {
    const start = Number(new URL(path, "https://api.linkedin.com").searchParams.get("start"));
    return { elements: start === 0 ? Array.from({ length: 100 }, (_, index) => ({ ...conversion, id: index + 1 })) : [conversion], paging: { start, total: 101 } };
  } });
  assert.equal((await runtime.api.resolveLinkedInAdsConversions({ accessToken: "isolated-token", accountId: "123", conversionUrns: ["urn:lla:llaPartnerConversion:101"] })).verifiedConversions.length, 1);
  assert.equal(runtime.calls.length, 2);
  const malformed = serverRuntime({ read: async () => ({ results: {} }) });
  await assert.rejects(malformed.api.resolveLinkedInAdsConversions({ accessToken: "isolated-token", accountId: "123", conversionUrns: ["urn:lla:llaPartnerConversion:101"] }), (error: unknown) => (error as ConnectionError).code === "provider_invalid_response");
  const incomplete = serverRuntime({ read: async () => ({ elements: [conversion], paging: { start: 0, total: 200 } }) });
  await assert.rejects(incomplete.api.resolveLinkedInAdsConversions({ accessToken: "isolated-token", accountId: "123", conversionUrns: ["urn:lla:llaPartnerConversion:999"] }), (error: unknown) => (error as ConnectionError).code === "provider_invalid_response");
});

test("conversion pagination follows provider-sized pages and preserves raw offsets when rows are filtered", async () => {
  const starts: number[] = [];
  const runtime = serverRuntime({ read: async (path) => {
    const start = Number(new URL(path, "https://api.linkedin.com").searchParams.get("start"));
    starts.push(start);
    return {
      elements: start === 0 ? Array.from({ length: 10 }, (_, index) => ({ ...conversion, id: index + 1 })) : [{ ...conversion, id: 11 }],
      paging: { start, count: 10 },
    };
  } });
  const result = await runtime.api.resolveLinkedInAdsConversions({ accessToken: "isolated-token", accountId: "123", conversionUrns: ["urn:lla:llaPartnerConversion:11"] });
  assert.equal(result.verifiedConversions.length, 1);
  assert.deepEqual(starts, [0, 10]);
  const filtered = serverRuntime({ read: async () => ({ elements: [conversion, { ...conversion, id: 99, account: "urn:li:sponsoredAccount:456" }], paging: { start: 0, total: 3 } }) });
  const page = await filtered.api.listLinkedInAdsConversions("active-owner", { accountId: "123" });
  assert.equal((page.options as unknown[]).length, 1);
  assert.deepEqual(page.paging, { start: 0, count: 2, total: 3, hasMore: true });
});

function routeRuntime(kind: "targeting" | "conversions", options: { authStatus?: number; limited?: boolean; failure?: Error } = {}) {
  const calls: Array<{ op: string; value?: unknown }> = [];
  const lookup = async (owner: string, input: unknown) => {
    calls.push({ op: "lookup", value: { owner, input } });
    if (options.failure) throw options.failure;
    return kind === "targeting" ? { accountId: "123", targets: [chosenTitle] } : { accountId: "123", options: [] };
  };
  const modules = new Map<string, unknown>([
    ["next/server", { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } }],
    ["@/lib/adsServer", { requirePremiumAdsUser: async (channel: string) => {
      calls.push({ op: "authorize", value: channel });
      return options.authStatus ? { user: null, errorResponse: Response.json({}, { status: options.authStatus }) } : { user: { activeUserId: "active-owner" }, errorResponse: null };
    } }],
    ["@/lib/rateLimit", { enforceRateLimit: async (input: unknown) => {
      calls.push({ op: "limit", value: input });
      return options.limited ? Response.json({}, { status: 429 }) : null;
    } }],
    ["@/lib/adsLinkedInPolicy", accountPolicy],
    ["@/lib/adsLinkedInServer", { LinkedInAdsConnectionError: ConnectionError }],
    ["@/lib/adsLinkedInResourcesPolicy", policy],
    ["@/lib/adsLinkedInResourcesServer", { listLinkedInAdsProfessionalTargets: lookup, listLinkedInAdsConversions: lookup }],
  ]);
  const loaded = { exports: {} as { GET: (request: Request) => Promise<Response> } };
  new Function("module", "exports", "require", compiled(`../app/api/ads/linkedin/${kind}/route.ts`))(
    loaded, loaded.exports, (specifier: string) => {
      assert.ok(modules.has(specifier), `Unexpected route dependency ${specifier}`);
      return modules.get(specifier);
    },
  );
  return { calls, run: (query: string) => loaded.exports.GET(new Request(`https://app.inrcy.com/api/ads/linkedin/${kind}?${query}`)) };
}

test("resource routes retain Premium/channel authorization and rate limits before data reads", async () => {
  for (const kind of ["targeting", "conversions"] as const) {
    for (const authStatus of [401, 403]) {
      const runtime = routeRuntime(kind, { authStatus });
      assert.equal((await runtime.run("account=123")).status, authStatus);
      assert.deepEqual(runtime.calls, [{ op: "authorize", value: "linkedin" }]);
    }
    const limited = routeRuntime(kind, { limited: true });
    assert.equal((await limited.run("account=123")).status, 429);
    assert.equal(limited.calls.some((call) => call.op === "lookup"), false);
    const good = routeRuntime(kind);
    const result = await good.run(kind === "targeting" ? "account=123&facet=titles&query=directeur" : "account=123");
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.equal((good.calls.find((call) => call.op === "lookup")?.value as { owner: string }).owner, "active-owner");
  }
});

test("resource routes reject arbitrary facets/accounts/locales and redact unknown error details", async () => {
  for (const query of ["account=evil", "facet=gender", "facet=titles", "facet=skills&query=x", "facet=titles&query=test&language=fra", "count=0", "count=101", "start=-1"]) {
    const runtime = routeRuntime("targeting");
    assert.equal((await runtime.run(query)).status, 400, query);
    assert.equal(runtime.calls.some((call) => call.op === "lookup"), false);
  }
  const runtime = routeRuntime("conversions", { failure: new Error("provider secret isolated-token") });
  const result = await runtime.run("account=123");
  assert.equal(result.status, 503);
  assert.equal(JSON.stringify(await result.json()).includes("secret"), false);
});

test("central resource reader remains GET-only on LinkedIn and rejects arbitrary endpoints", async () => {
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
  let providerStatus = 200;
  const modules = new Map<string, unknown>([
    ["server-only", {}], ["@/lib/supabaseAdmin", { supabaseAdmin: {} }],
    ["@/lib/oauthCrypto", { decryptToken: () => "", encryptToken: () => "" }],
    ["@/lib/adsLinkedInPolicy", accountPolicy],
  ]);
  const loaded = { exports: {} as { readLinkedInAdsResourceJson: (token: string, path: string) => Promise<unknown> } };
  new Function("module", "exports", "require", "fetch", "process", "AbortSignal", compiled("../lib/adsLinkedInServer.ts"))(
    loaded, loaded.exports, (specifier: string) => { assert.ok(modules.has(specifier)); return modules.get(specifier); },
    async (url: string, init?: RequestInit) => { fetchCalls.push({ url, init }); return Response.json({ elements: [] }, { status: providerStatus }); },
    { env: {} }, AbortSignal,
  );
  await loaded.exports.readLinkedInAdsResourceJson("isolated-token", "/rest/conversions?q=account&account=urn%3Ali%3AsponsoredAccount%3A123");
  assert.equal(fetchCalls[0].url.startsWith("https://api.linkedin.com/rest/conversions?"), true);
  assert.equal(fetchCalls[0].init?.method || "GET", "GET");
  assert.equal(fetchCalls[0].init?.cache, "no-store");
  assert.equal((fetchCalls[0].init?.headers as Record<string, string>)["Linkedin-Version"], "202609");
  for (const path of ["https://evil.example/rest/conversions", "/rest/adAccounts/123", "/rest/conversions/101", "/rest/conversions#evil", "/rest/conversions\\evil"]) {
    await assert.rejects(loaded.exports.readLinkedInAdsResourceJson("isolated-token", path));
  }
  assert.equal(fetchCalls.length, 1);
  for (const status of [400, 401, 403, 429, 500]) {
    providerStatus = status;
    await assert.rejects(loaded.exports.readLinkedInAdsResourceJson("isolated-token", "/rest/adTargetingEntities?q=urns&urns=List(urn%3Ali%3Aseniority%3A10)"), (error: unknown) => {
      const diagnostic = error as { providerStatus: number; status: number };
      return diagnostic.providerStatus === status && diagnostic.status === (status === 401 ? 409 : status === 403 ? 403 : 503);
    });
  }
});
