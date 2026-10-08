import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { GoogleAdsApiError } from "../lib/adsGoogleApiError.ts";
import { adsAccountCanBeAssociated } from "../lib/adsValidation.ts";
import * as googleLocations from "../lib/adsGoogleLocations.ts";
import * as resources from "../lib/adsGoogleResources.ts";

const id = "870bb769-8aa0-45da-ac44-d24d0b414955";
const accountId = "1234567890";
const owner = "active-owner";
const draft = { provider: "google", adAccountId: accountId, accountCurrency: "EUR", dailyBudgetEuros: 10 };
const integration = { id: "integration-one", status: "connected", resource_id: accountId };
type Options = { authDenied?: boolean; allowed?: boolean; changed?: boolean; inaccessible?: boolean; foreign?: boolean; claimed?: boolean; mismatch?: boolean; checkerFailure?: Error; limited?: boolean; country?: string; profileFailure?: boolean };
function runtime(routePath: string, options: Options = {}) {
  const calls: string[] = []; let reads = 0;
  const profile = { select: (column: string) => { calls.push("profileSelect:" + column); return profile; }, eq: (column: string, value: unknown) => { calls.push(`profile:${column}:${value}`); return profile; }, order: () => profile, limit: () => profile, maybeSingle: async () => ({ data: { hq_country: options.country === undefined ? "France" : options.country }, error: options.profileFailure ? {} : null }) };
  const query = {
    select: () => query,
    eq: (column: string, value: unknown) => { calls.push(`eq:${column}:${value}`); return query; },
    maybeSingle: async () => ({ data: { id, user_id: options.foreign ? "other-owner" : owner, provider: "google", ad_account_id: accountId, currency: "EUR", daily_budget_cents: options.mismatch ? 2000 : 1000, draft, status: options.claimed ? "publishing" : "draft", provider_resources: {}, published_at: null }, error: null }),
  };
  class GeoError extends Error {}
  const modules: Record<string, unknown> = {
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/adsServer": {
      requirePremiumAdsUser: async () => { calls.push("auth"); return options.authDenied ? { user: null, errorResponse: Response.json({ error: "forbidden" }, { status: 403 }) } : { user: { activeUserId: owner, authUserId: "identity", supabase: { from: (table: string) => { calls.push("profileTable:" + table); return profile; } } }, errorResponse: null }; },
      adsRequestOriginAllowed: () => true,
      adsBadOriginResponse: () => Response.json({}, { status: 403 }),
      isAdsChannelUserAllowed: async () => options.allowed !== false,
      adsPilotOnlyResponse: () => Response.json({}, { status: 403 }),
      readAdsIntegration: async () => { calls.push("integration"); return options.changed && reads++ > 0 ? { ...integration, resource_id: "9999999999" } : integration; },
      adsConnectionStatus: (value: { status: string }) => value.status,
      listAdsAccounts: async () => { calls.push("accounts"); return options.inaccessible ? [] : [{ id: accountId, provider: "google", currency: "EUR", loginCustomerId: "9876543210" }]; },
      googleAdsJson: async (...args: unknown[]) => {
        calls.push("read"); if (options.checkerFailure) throw options.checkerFailure;
        assert.equal(args[0], owner); assert.equal(args[1], `customers/${accountId}/googleAds:search`); assert.equal(args[3], "9876543210");
        const sql = String((args[2] as { query: string }).query);
        if (sql.includes("FROM customer LIMIT")) return { results: [{ customer: { id: accountId, currencyCode: "EUR", manager: false, status: "ENABLED", timeZone: "Europe/Paris" } }] };
        if (sql.includes("customer_conversion_goal")) return { results: [{ customerConversionGoal: { category: "SIGNUP", origin: "WEBSITE", biddable: true } }] };
        return { results: [{ conversionAction: { resourceName: `customers/${accountId}/conversionActions/77`, name: "Essai", category: "SIGNUP", origin: "WEBSITE", status: "ENABLED", type: "WEBPAGE", primaryForGoal: true } }] };
      },
    },
    "@/lib/adsGooglePublish": { GoogleAdsLocationResolutionError: GeoError, resolveGoogleTargetLocations: async (...args: unknown[]) => { calls.push("geo"); assert.equal(args[0], owner); assert.equal(args[1], accountId); assert.equal(args[3], "9876543210"); assert.equal(args[4], options.country === "" || options.profileFailure ? undefined : "FR"); return [{ resourceName: "geoTargetConstants/55", label: "Hauts-de-France,France", countryCode: "FR" }]; }, checkGoogleAdsPublication: async (...args: unknown[]) => { calls.push("check"); assert.deepEqual(args, [owner, draft, "9876543210"]); if (options.checkerFailure) throw options.checkerFailure; return { ready: true, selectedAccountId: accountId, verifiedLocationCount: 2, targetLocations: [{ resourceName: "private" }], token: "internal-only" }; } },
    "@/lib/adsMetaPublish": { checkMetaAdsPublication: async () => { throw new Error("Unexpected Meta request"); } }, "@/lib/adsMetaResourcesServer": { MetaAdsPreparationError: class extends Error {} }, "@/lib/adsOpenaiServer": { checkOpenaiAdsPublication: async () => { throw new Error("Unexpected ChatGPT request"); } }, "@/lib/adsOpenaiConnector": { OpenaiAdsPublishError: class extends Error {} },
    "@/lib/adsPinterestCampaignPublish": { checkPinterestAdsPublication: async () => { throw new Error("Unexpected Pinterest request"); } },
    "@/lib/adsPinterestServer": { PinterestAdsConnectionError: class extends Error {} },
    "@/lib/adsLinkedInPublisherServer": { checkLinkedInAdsPublication: async () => { throw Error("wrong provider"); } },
    "@/lib/adsLinkedInServer": { LinkedInAdsConnectionError: class extends Error {} },
    "@/lib/adsGoogleApiError": { GoogleAdsApiError },
    "@/lib/adsGoogleResources": resources, "@/lib/adsGoogleLocations": googleLocations,
    "@/lib/adsValidation": { parseAdsCampaignInput: (value: unknown) => ({ draft: value, error: null }), adsAccountCanBeAssociated },
    "@/lib/supabaseAdmin": { supabaseAdmin: { from: () => { calls.push("database"); return query; } } },
    "@/lib/rateLimit": { enforceRateLimit: async () => options.limited ? Response.json({}, { status: 429 }) : null },
    "@/lib/observability/logger": { log: { warn: () => {} } },
  };
  const compiled = ts.transpileModule(readFileSync(new URL(routePath, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: { GET?: (...args: unknown[]) => Promise<Response> } = {};
  new Function("exports", "require", compiled)(exports, (name: string) => { assert.ok(Object.hasOwn(modules, name), `unexpected dependency ${name}`); return modules[name]; });
  return { calls, run: (request?: Request) => exports.GET!(request || new Request(`https://app.test/api/ads/campaigns/${id}/preflight`), { params: Promise.resolve({ id }) }) };
}
const preflight = (options: Options = {}) => runtime("../app/api/ads/campaigns/[id]/preflight/route.ts", options);
const resource = (options: Options = {}) => runtime("../app/api/ads/google/resources/route.ts", options);

test("Google saved-draft GET checks owner, current association and parameters without provider or database writes", async () => {
  const harness = preflight(); const response = await harness.run();
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { ready: true, selectedAccountId: accountId, verifiedLocationCount: 2 });
  assert.ok(harness.calls.includes(`eq:user_id:${owner}`));
  assert.deepEqual(harness.calls.filter((call) => ["integration", "accounts", "check"].includes(call)), ["integration", "accounts", "integration", "check"]);
});

test("Google preflight cannot use a foreign, claimed, mismatched, switched or inaccessible account", async () => {
  for (const [options, status] of [[{ authDenied: true }, 403], [{ allowed: false }, 403], [{ foreign: true }, 404], [{ claimed: true }, 409], [{ mismatch: true }, 400], [{ changed: true }, 409], [{ inaccessible: true }, 403], [{ limited: true }, 429]] as const) {
    const harness = preflight(options); assert.equal((await harness.run()).status, status); assert.equal(harness.calls.includes("check"), false);
  }
});

test("Google account resources expose verified account-default conversions with no arbitrary account override", async () => {
  const harness = resource(); const response = await harness.run();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.selectedAccountId, accountId); assert.equal(body.hasBiddableConversions, true); assert.equal(body.conversionMode, "account_defaults");
  assert.equal(body.conversionActions[0].name, "Essai");
  assert.equal(harness.calls.includes("database"), false);
  const changed = resource({ changed: true }); assert.equal((await changed.run()).status, 409); assert.equal(changed.calls.includes("read"), false);
});

test("Google native GET routes suppress unexpected provider details and retain authorization/rate-limit statuses", async () => {
  for (const make of [preflight, resource]) for (const error of [new Error("Bearer SECRET"), new GoogleAdsApiError("Bearer SECRET", 403), new GoogleAdsApiError("Bearer SECRET", 429)]) {
    const response = await make({ checkerFailure: error }).run();
    assert.ok([422, 403, 429, 503].includes(response.status)); assert.doesNotMatch(await response.text(), /SECRET|Bearer/);
  }
});

test("automatic geography uses only the current stored account and the RLS business country, never a request country", async () => {
  for (const country of ["France", "fr", ""]) {
    const harness = runtime("../app/api/ads/google/geography/route.ts", { country });
    const response = await harness.run(new Request("https://app.test/api/ads/google/geography?country=US&accountId=9999999999&locations=" + encodeURIComponent(JSON.stringify(["Hauts-de-France"]))));
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { selectedAccountId: accountId, locations: [{ resourceName: "geoTargetConstants/55", label: "Hauts-de-France,France", countryCode: "FR" }] });
    assert.ok(harness.calls.includes("profile:user_id:" + owner));
    assert.ok(harness.calls.includes("profileTable:profiles"));
    assert.ok(harness.calls.includes("profileSelect:hq_country"));
  }
  for (const options of [{ changed: true }]) {
    const harness = runtime("../app/api/ads/google/geography/route.ts", options);
    assert.ok([409,503].includes((await harness.run(new Request("https://app.test/api/ads/google/geography?locations=" + encodeURIComponent(JSON.stringify(["Lille"]))))).status));
    assert.equal(harness.calls.includes("geo"), false);
  }
});


test("optional legal country read failures never invent a country or block exact provider geography", async () => {
  const harness = runtime("../app/api/ads/google/geography/route.ts", { profileFailure: true });
  const response = await harness.run(new Request("https://app.test/api/ads/google/geography?locations=" + encodeURIComponent(JSON.stringify(["France"]))));
  assert.equal(response.status, 200); assert.ok(harness.calls.includes("geo"));
});
