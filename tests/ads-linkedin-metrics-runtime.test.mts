/** Runtime mocks only: no real database, OAuth grant, or provider request. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as metrics from "../lib/adsCampaignMetrics.ts";
import * as core from "../lib/adsLinkedInLifecycleCore.ts";
import * as policy from "../lib/adsLinkedInPolicy.ts";

type Lifecycle = typeof import("../lib/adsLinkedInLifecycle.ts");
type MetricsRoute = typeof import("../app/api/ads/campaigns/[id]/metrics/route.ts");
const id = "12345678-1234-1234-1234-123456789abc";
const campaignUrn = "urn:li:sponsoredCampaign:456";
const now = Date.parse("2026-10-09T12:00:00Z");
const grantedScopes = "rw_ads r_ads_reporting r_organization_admin w_organization_social";
const resources = { accountId: "123", campaignUrn, campaignId: "456", stage: "paused" };
class ConnectionError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status: number) { super(message); this.code = code; this.status = status; }
}
function compile<T>(path: string, modules: Record<string, unknown>, fetchImpl?: typeof fetch, env = {}): T {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {} as T;
  class Clock extends Date {
    constructor(value?: string | number) { super(value === undefined ? now : value); }
    static now() { return now; }
  }
  new Function("exports", "require", "fetch", "process", "Date", code)(exports, (name: string) => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected dependency ${name}`); return modules[name];
  }, fetchImpl || (() => { throw new Error("Live fetch forbidden in fixture"); }), { env }, Clock);
  return exports;
}

type Options = { localStatus?: string; scopes?: string; currency?: string; manage?: boolean; mapped?: boolean;
  connectionChanged?: boolean; foreignOwner?: boolean; missing?: boolean; resources?: unknown; nativeAccount?: string;
  nativeCampaign?: string; nativeStatus?: string; report?: unknown; providerStatus?: number; jsonFailure?: boolean;
  provider?: "linkedin" | "google" | "meta"; denied?: boolean; limited?: boolean; allowed?: boolean };
function runtime(options: Options = {}) {
  const nativeCalls: Array<{ method: string; path: string; headers: Headers }> = [];
  const events: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.linkedin.com");
    assert.equal(init?.method, "GET", "Statistics never mutate a provider campaign");
    assert.equal(init?.cache, "no-store");
    assert.ok(init);
    const headers = new Headers(init.headers);
    assert.equal(headers.get("Authorization"), "Bearer fixture-token");
    assert.equal(headers.get("Linkedin-Version"), "202609");
    assert.equal(headers.get("X-Restli-Protocol-Version"), "2.0.0");
    nativeCalls.push({ method: init.method!, path: url.pathname + url.search, headers });
    if (url.pathname === "/rest/adAccounts/123/adCampaigns/456") return Response.json({
      id: options.nativeCampaign || "456", account: options.nativeAccount || "urn:li:sponsoredAccount:123",
      status: options.nativeStatus || "PAUSED",
    });
    assert.equal(url.pathname, "/rest/adAnalytics");
    if (options.jsonFailure) return { ok: true, status: 200, json: async () => { throw new SyntaxError("Invalid JSON"); } } as unknown as Response;
    if (options.providerStatus) return Response.json({ message: "PRIVATE_PROVIDER_DESCRIPTION fixture-token" }, { status: options.providerStatus });
    return Response.json(options.report === undefined ? { elements: [{ pivotValues: [campaignUrn], impressions: 12,
      clicks: 3, costInLocalCurrency: "2.12345", externalWebsiteConversions: 1 }] } : options.report);
  };
  const lifecycle = compile<Lifecycle>("../lib/adsLinkedInLifecycle.ts", {
    "server-only": {}, "./adsLinkedInPolicy.ts": policy, "./adsLinkedInLifecycleCore.ts": core,
    "./adsLinkedInServer.ts": {
      LinkedInAdsConnectionError: ConnectionError,
      readLinkedInAdsIntegration: async () => options.connectionChanged ? null : { status: "connected", resource_id: "123" },
      linkedInAdsAuthorization: async () => ({ token: "fixture-token", scopes: options.scopes === undefined ? grantedScopes : options.scopes }),
      listLinkedInAdsAccounts: async () => [{ id: "123", currency: options.currency || "EUR",
        canManageCampaigns: options.manage !== false, canServeCampaigns: false }],
    },
  }, fetchImpl, { LINKEDIN_ADS_DEVELOPMENT_ACCOUNT_IDS: options.mapped === false ? "999" : "123" });
  const filters = new Map<string, unknown>();
  const query = {
    select: () => query,
    eq: (key: string, value: unknown) => { filters.set(key, value); return query; },
    maybeSingle: async () => {
      assert.equal(filters.get("id"), id);
      assert.equal(filters.get("user_id"), "owner", "The privileged database read must be owner-scoped");
      return { error: null, data: options.missing || options.foreignOwner ? null : {
        provider: options.provider || "linkedin", ad_account_id: "123", status: options.localStatus || "paused",
        provider_resources: options.resources === undefined ? options.provider === "google"
          ? { campaignResourceName: "customers/123/campaigns/456" } : options.provider === "meta"
            ? { provider: "meta", adAccountId: "123", campaignId: "456" } : resources : options.resources,
      } };
    },
  };
  const route = compile<MetricsRoute>("../app/api/ads/campaigns/[id]/metrics/route.ts", {
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/adsCampaignMetrics": metrics,
    "@/lib/adsLinkedInLifecycle": lifecycle,
    "@/lib/adsLinkedInServer": { LinkedInAdsConnectionError: ConnectionError },
    "@/lib/supabaseAdmin": { supabaseAdmin: { from: (table: string) => { assert.equal(table, "ads_campaigns"); return query; } } },
    "@/lib/rateLimit": { enforceRateLimit: async () => options.limited ? Response.json({}, { status: 429 }) : null },
    "@/lib/adsValidation": { isAdsChannelId: (value: unknown) => ["google", "meta", "linkedin"].includes(String(value)) },
    "@/lib/adsServer": {
      requirePremiumAdsUser: async () => options.denied ? { user: null, errorResponse: Response.json({}, { status: 403 }) }
        : { user: { activeUserId: "owner", authUserId: "auth" } },
      isAdsChannelUserAllowed: async () => options.allowed !== false, adsPilotOnlyResponse: () => Response.json({}, { status: 403 }),
      listAdsAccounts: async () => [{ id: "123", currency: "EUR" }],
      googleAdsJson: async (_owner: string, path: string, body: unknown) => { events.push("google"); assert.equal(path, "customers/123/googleAds:search");
        assert.match(JSON.stringify(body), /LAST_30_DAYS/); return { results: [{ metrics: { impressions: "4", clicks: "2", costMicros: "3000000", conversions: "1.5" } }] }; },
      metaAdsJson: async (_owner: string, path: string) => { events.push("meta"); assert.match(path, /456\/insights\?.*date_preset=last_30d/);
        return { data: [{ impressions: "5", clicks: "1", spend: "2.4" }] }; },
    },
  });
  return { nativeCalls, events, get: (localId = id) => route.GET(new Request("https://app.example/api/ads/campaigns/" + localId + "/metrics"),
    { params: Promise.resolve({ id: localId }) }) };
}

test("all four reportable LinkedIn states read the paused native campaign and an exact 30-day GET report", async () => {
  for (const localStatus of ["active", "paused", "demo_paused", "needs_review"]) {
    const run = runtime({ localStatus });
    const response = await run.get();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual((await response.json()).metrics, { period: "last_30_days", source: "linkedin", impressions: 12,
      clicks: 3, spendEuros: 2.12345, conversions: 1, fetchedAt: "2026-10-09T12:00:00.000Z" });
    assert.equal(run.nativeCalls.length, 2);
    const report = run.nativeCalls[1].path;
    assert.match(report, /dateRange=\(start:\(year:2026,month:9,day:10\),end:\(year:2026,month:10,day:9\)\)/);
    assert.match(report, /campaigns=List\(urn%3Ali%3AsponsoredCampaign%3A456\)/);
    assert.match(report, /accounts=List\(urn%3Ali%3AsponsoredAccount%3A123\)/);
    assert.match(report, /externalWebsiteConversions/);
  }
});

test("real empty LinkedIn elements remain no-data and never fabricated zero performance", async () => {
  const run = runtime({ report: { elements: [] } });
  const response = await run.get();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { metrics: null, reason: "no_data" });
});

test("malformed native envelopes and JSON failures cannot become no-data", async () => {
  for (const options of [{ report: {} }, { report: null }, { report: { elements: null } }, { jsonFailure: true }]) {
    const response = await runtime(options).get();
    assert.equal(response.status, 502);
    assert.equal(Object.hasOwn(await response.json(), "metrics"), false);
  }
});

test("reporting scope, current connection, native role, EUR and account mapping are rechecked before reporting", async () => {
  for (const [options, expected] of [[{ scopes: "rw_ads r_organization_admin w_organization_social" }, 403],
    [{ manage: false }, 403], [{ currency: "USD" }, 403], [{ mapped: false }, 403], [{ connectionChanged: true }, 409]] as const) {
    const run = runtime(options);
    const response = await run.get();
    assert.equal(response.status, expected);
    assert.equal(run.nativeCalls.length, 0);
    assert.doesNotMatch(JSON.stringify(await response.json()), /fixture-token|PRIVATE/);
  }
});

test("LinkedIn native ownership mismatch stops before analytics and typed provider errors stay distinct from zero", async () => {
  for (const options of [{ nativeAccount: "urn:li:sponsoredAccount:999" }, { nativeCampaign: "999" }]) {
    const run = runtime(options);
    assert.equal((await run.get()).status, 503);
    assert.equal(run.nativeCalls.length, 1);
  }
  for (const [providerStatus, expected] of [[401, 403], [403, 403], [404, 404], [429, 503], [500, 503]] as const) {
    const response = await runtime({ providerStatus }).get();
    assert.equal(response.status, expected);
    assert.doesNotMatch(JSON.stringify(await response.json()), /PRIVATE_PROVIDER_DESCRIPTION|fixture-token/);
  }
});

test("local ownership, UUID, pilot, rate limit and canonical checkpoints block all native reads", async () => {
  for (const [options, expected] of [[{ foreignOwner: true }, 404], [{ missing: true }, 404], [{ denied: true }, 403],
    [{ limited: true }, 429], [{ allowed: false }, 403], [{ localStatus: "draft" }, 409],
    [{ resources: { ...resources, accountId: "999" } }, 409], [{ resources: { ...resources, campaignId: "999" } }, 409]] as const) {
    const run = runtime(options); assert.equal((await run.get()).status, expected); assert.equal(run.nativeCalls.length, 0);
  }
  const run = runtime(); assert.equal((await run.get("bad-id")).status, 400); assert.equal(run.nativeCalls.length, 0);
});

test("the existing Google and Meta read-only metrics branches retain their native parsers", async () => {
  for (const provider of ["google", "meta"] as const) {
    const run = runtime({ provider }), response = await run.get();
    assert.equal(response.status, 200); const body = await response.json();
    assert.equal(metrics.isAdsCampaignMetrics(body.metrics, provider), true);
    assert.equal(body.metrics.conversions, provider === "google" ? 1.5 : null);
    assert.equal(run.nativeCalls.length, 0); assert.deepEqual(run.events, [provider]);
  }
});
