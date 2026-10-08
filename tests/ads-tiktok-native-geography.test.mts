import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as accountPolicy from "../lib/adsTikTokPolicy.ts";
import * as policy from "../lib/adsTikTokResources.ts";

type Api = typeof import("../lib/adsTikTokResourcesServer.ts");
type Dependencies = import("../lib/adsTikTokResourcesServer.ts").TikTokAdsResourceDependencies;
class ConnectionError extends Error { code: string; status: number; constructor(message: string, code: string, status = 503) { super(message); this.code = code; this.status = status; } }
const accountId = "1234567890123", now = Date.parse("2026-10-08T10:00:00Z");
/** Simulated records using the documented region_info shape; these are not a live-account proof.
 * https://business-api.tiktok.com/portal/docs/get-available-locations-by-different-settings/v1.3
 */
const region = (location_id: string, name: string, parent_id: string, level: string, region_code = "FR") => ({ location_id, name, parent_id, level, region_code, area_type: "ADMIN", next_level_ids: [], support_below_18: true });
function fixture() { return { code: 0, data: { region_info: [
  region("3017382", "France", "0", "COUNTRY"), region("443499", "Hauts-de-France", "3017382", "PROVINCE"),
  region("2998324", "Lille", "443499", "CITY"), region("3036784", "Arras", "443499", "CITY"),
  region("6252001", "États-Unis", "0", "COUNTRY", "US"), region("999999", "Province test", "6252001", "PROVINCE", "US"),
  region("112233", "Lille", "999999", "CITY", "US"),
], region_list: ["FR", "US"] }, request_id: "private-request-id" }; }
function load<T>(file: string, modules: Map<string, unknown>): T {
  const loaded = { exports: {} as T };
  const output = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("module", "exports", "require", output)(loaded, loaded.exports, (name: string) => { assert.ok(modules.has(name), name); return modules.get(name); });
  return loaded.exports;
}
function runtime(options: { expired?: boolean; account?: Record<string, unknown>; identityFailure?: number; regionFailure?: number; regions?: unknown; driftAt?: number; driftField?: string } = {}) {
  const calls: Array<{ path: string; params: URLSearchParams }> = [];
  let reads = 0;
  const integration = { id: "integration", status: "connected", resource_id: accountId, resource_label: "Compte", access_token_enc: "cipher", refresh_token_enc: "refresh", expires_at: options.expired ? "2026-10-08T09:00:00Z" : "2026-10-09T10:00:00Z", meta: {} };
  const api = load<Api>("../lib/adsTikTokResourcesServer.ts", new Map<string, unknown>([["server-only", {}], ["./oauthCrypto.ts", {}], ["./adsTikTokServer.ts", { TikTokAdsConnectionError: ConnectionError }], ["./adsTikTokPolicy.ts", accountPolicy], ["./adsTikTokResources.ts", policy]]));
  const dependencies: Dependencies = {
    readIntegration: async (owner) => { assert.equal(owner, "owner"); reads++; return options.driftAt && reads >= options.driftAt ? { ...integration, [options.driftField || "resource_id"]: "changed" } : integration; },
    decrypt: () => "private-token", appId: "private-app-id", secret: "private-secret", now: () => now,
    fetchImpl: (async (input, init) => {
      const url = new URL(String(input)), path = url.pathname.replace("/open_api/v1.3/", ""); calls.push({ path, params: url.searchParams });
      assert.equal(init?.method, "GET"); assert.equal(init?.body, undefined); assert.equal(init?.cache, "no-store");
      assert.equal(new Headers(init?.headers).get("Access-Token"), "private-token");
      if (path === "oauth2/advertiser/get/") return Response.json({ code: 0, data: { advertiser_ids: [accountId] } });
      if (path === "advertiser/info/") return Response.json({ code: 0, data: { list: [{ advertiser_id: accountId, name: "Compte natif", currency: "EUR", status: "STATUS_ENABLE", timezone: "Europe/Paris", ...options.account }] } });
      if (path === "identity/get/") return options.identityFailure ? Response.json({ code: 9, message: "private-token" }, { status: options.identityFailure }) : Response.json({ code: 0, data: { identity_list: [{ identity_id: "native-user", identity_type: "TT_USER", display_name: "Profil natif" }], page_info: { total_page: 1 } } });
      if (path === "tool/region/") {
        assert.equal(url.searchParams.get("advertiser_id"), accountId);
        assert.deepEqual(JSON.parse(url.searchParams.get("placements")!), ["PLACEMENT_TIKTOK"]);
        assert.equal(url.searchParams.get("objective_type"), "TRAFFIC"); assert.equal(url.searchParams.get("level_range"), "TO_CITY");
        assert.equal(url.searchParams.get("language"), "fr"); assert.equal(url.searchParams.has("search_campaign_enabled"), false);
        if (options.regionFailure) return Response.json({ code: 9, message: "private-token private-secret" }, { status: options.regionFailure });
        return Response.json(options.regions ?? fixture());
      }
      throw new Error(`Unexpected GET ${path}`);
    }) as typeof fetch,
  };
  return { api, dependencies, calls, reads: () => reads };
}

test("TikTok region_info parser derives country/ancestor labels from the same native hierarchy", () => {
  const targets = policy.parseTikTokAdsTrafficRegions(fixture())!;
  const lille = targets.find((target) => target.id === "2998324")!;
  assert.deepEqual(lille, { id: "2998324", name: "Lille", countryCode: "FR", level: "CITY", parentId: "443499", areaType: "ADMIN", path: ["Hauts-de-France", "France"] });
  assert.equal(policy.tikTokAdsGeoTargetLabel(lille), "Lille, Hauts-de-France, France");
  assert.doesNotMatch(JSON.stringify(targets), /request_id|private|support_below_18|next_level_ids/);
});

test("TikTok geography parser rejects guessed schemas, unsafe native IDs and inconsistent hierarchy", () => {
  assert.equal(policy.parseTikTokAdsTrafficRegions({ data: { list: fixture().data.region_info } }), null);
  assert.equal(policy.parseTikTokAdsTrafficRegions({ data: { regions: fixture().data.region_info } }), null);
  for (const change of [{ location_id: 3017382 }, { location_id: "../id" }, { parent_id: "absent" }, { area_type: "UNKNOWN" }, { level: "FAKE" }, { region_code: "" }]) {
    const payload = fixture(); Object.assign(payload.data.region_info[0], change);
    assert.equal(policy.parseTikTokAdsTrafficRegions(payload), null);
  }
  const missingParent = fixture(); missingParent.data.region_info[2].parent_id = "777777";
  assert.equal(policy.parseTikTokAdsTrafficRegions(missingParent), null);
  const cycle = fixture(); cycle.data.region_info[1].parent_id = "2998324";
  assert.equal(policy.parseTikTokAdsTrafficRegions(cycle), null);
  const duplicate = fixture(); duplicate.data.region_info.push({ ...duplicate.data.region_info[2], name: "Other name" });
  assert.equal(policy.parseTikTokAdsTrafficRegions(duplicate), null);
});

test("TikTok exact geography resolution refuses homonyms and does not broaden partial brief labels", () => {
  const targets = policy.parseTikTokAdsTrafficRegions(fixture())!;
  const resolutions = policy.resolveTikTokAdsGeoQueries(targets, ["Lille", "Lille, Hauts de France, France", "Hauts-de-France", "Toute la France", "Lill", "FR"]);
  assert.equal(resolutions[0].status, "ambiguous"); assert.equal(resolutions[0].target, null); assert.equal(resolutions[0].candidates.length, 2);
  assert.equal(resolutions[1].target?.id, "2998324"); assert.equal(resolutions[2].target?.id, "443499");
  assert.equal(resolutions[3].target, null); assert.equal(resolutions[4].status, "not_found"); assert.ok(resolutions[4].candidates.length > 0);
  assert.equal(resolutions[5].target?.id, "3017382");
});

test("TikTok geography requests and native IDs have explicit app limits, never guessed numbers", () => {
  assert.deepEqual(policy.normalizeTikTokAdsGeoQueries([" France ", "France"]), ["France"]);
  for (const value of [null, "France", [""], Array.from({ length: 21 }, () => "France"), [1]]) assert.equal(policy.normalizeTikTokAdsGeoQueries(value), null);
  assert.deepEqual(policy.normalizeTikTokAdsLocationIds(["3017382", "3017382"]), ["3017382"]);
  for (const value of [[3017382], ["0"], ["fake"], Array.from({ length: 21 }, () => "3017382")]) assert.equal(policy.normalizeTikTokAdsLocationIds(value), null);
});

test("TikTok geography reads only current advertiser Traffic/TikTok catalogue and returns compact native choices", async () => {
  const sample = runtime(), result = await sample.api.readTikTokAdsGeography("owner", { accountId, queries: ["Lille", "Arras", "Unknown town"] }, sample.dependencies);
  assert.deepEqual(sample.calls.map((call) => call.path), ["oauth2/advertiser/get/", "advertiser/info/", "tool/region/"]);
  assert.equal(result.selectedAccountId, accountId); assert.deepEqual(result.context, policy.TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT);
  assert.deepEqual(result.resolvedTargets.map((target) => target.id), ["3036784"]); assert.deepEqual(result.unresolvedQueries, ["Lille", "Unknown town"]);
  assert.ok(result.options.every((target) => ["2998324", "112233", "3036784"].includes(target.id)));
  assert.equal(result.publicationEnabled, false); assert.doesNotMatch(JSON.stringify(result), /private-|cipher|secret|access_token/);
  const countries = runtime(), defaultResult = await countries.api.readTikTokAdsGeography("owner", { accountId, queries: [] }, countries.dependencies);
  assert.ok(defaultResult.options.length > 0); assert.ok(defaultResult.options.every((target) => target.level === "COUNTRY"));
  assert.deepEqual(defaultResult.resolvedTargets, []);
});

test("TikTok geography blocks account/token changes, expired token and malformed catalogue without side effects", async () => {
  const wrong = runtime(); await assert.rejects(wrong.api.readTikTokAdsGeography("owner", { accountId: "999999999", queries: ["France"] }, wrong.dependencies), /compte/); assert.equal(wrong.calls.length, 0);
  const expired = runtime({ expired: true }); await assert.rejects(expired.api.readTikTokAdsGeography("owner", { accountId, queries: ["France"] }, expired.dependencies), (error: unknown) => error instanceof ConnectionError && error.code === "needs_reconnect"); assert.equal(expired.calls.length, 0);
  for (const driftAt of [2, 3, 4, 5, 6]) for (const driftField of ["id", "resource_id", "status", "access_token_enc"]) {
    const changed = runtime({ driftAt, driftField }); await assert.rejects(changed.api.readTikTokAdsGeography("owner", { accountId, queries: ["France"] }, changed.dependencies), (error: unknown) => error instanceof ConnectionError && error.code === "account_mismatch");
  }
  const malformed = runtime({ regions: { code: 0, data: { list: fixture().data.region_info } } });
  await assert.rejects(malformed.api.readTikTokAdsGeography("owner", { accountId, queries: ["France"] }, malformed.dependencies), (error: unknown) => error instanceof ConnectionError && error.code === "geography_response_invalid");
});

test("TikTok geographic HTTP errors remain explicit and redact provider messages", async () => {
  for (const [status, code] of [[401, "needs_reconnect"], [403, "ads_access_denied"], [429, "provider_rate_limit"], [500, "provider_unavailable"]] as const) {
    const sample = runtime({ regionFailure: status });
    await assert.rejects(sample.api.readTikTokAdsGeography("owner", { accountId, queries: ["France"] }, sample.dependencies), (error: unknown) => error instanceof ConnectionError && error.code === code && !error.message.includes("private-"));
    assert.equal(sample.calls.length, 3);
  }
});

test("TikTok preparation can verify selections while all publication capabilities/budget/time basis remain unknown", async () => {
  const sample = runtime(), result = await sample.api.checkTikTokAdsTrafficPreparation("owner", { accountId, identity: { id: "native-user", type: "TT_USER" }, locationIds: ["3017382", "2998324", "2998324"] }, sample.dependencies);
  assert.equal(result.preparationReady, true); assert.equal(result.ready, false); assert.equal(result.publicationEnabled, false);
  assert.equal(result.selectedIdentity?.displayName, "Profil natif"); assert.equal(result.verifiedLocationCount, 2);
  for (const field of ["nativeWriteAccess", "manualTrafficV13", "videoUpload", "imageUpload", "mediaRead", "objectRead"] as const) assert.equal(result.capabilities[field], "unverified");
  assert.equal(result.capabilities.minimumLifetimeBudgetEuros, null); assert.equal(result.capabilities.budgetCalendar, null); assert.equal(result.capabilities.scheduleTimeBasis, null); assert.equal(result.capabilities.scheduleOffsetMinutes, null);
  for (const blocker of ["campaign_write_unverified", "budget_minimum_unverified", "schedule_time_basis_unverified", "cta_options_unverified", "non_spark_identity_type_unverified"]) assert.ok(result.blockers.includes(blocker));
  assert.equal(typeof result.resourcesKey, "string"); assert.doesNotMatch(JSON.stringify(result), /private-|cipher|access_token|secret/);
  assert.deepEqual(sample.calls.map((call) => call.path), ["oauth2/advertiser/get/", "advertiser/info/", "identity/get/", "tool/region/"]);
});

test("TikTok preparation refuses unavailable native IDs/identities, missing timezone and connection drift", async () => {
  for (const input of [{ identity: null, locationIds: [] }, { identity: { id: "invented", type: "TT_USER" as const }, locationIds: ["777777"] }, { identity: { id: "native-user", type: "AUTH_CODE" as const }, locationIds: ["3017382"] }]) {
    const sample = runtime(), result = await sample.api.checkTikTokAdsTrafficPreparation("owner", { accountId, ...input }, sample.dependencies);
    assert.equal(result.preparationReady, false); assert.equal(result.ready, false); assert.equal(result.selectedIdentity, null);
  }
  const denied = runtime({ identityFailure: 403 });
  const deniedResult = await denied.api.checkTikTokAdsTrafficPreparation("owner", { accountId, identity: { id: "native-user", type: "TT_USER" }, locationIds: ["3017382"] }, denied.dependencies);
  assert.equal(deniedResult.preparationReady, false); assert.ok(deniedResult.blockers.includes("identity_read_unavailable"));
  const timezone = runtime({ account: { timezone: "Unknown/Zone" } });
  assert.equal((await timezone.api.checkTikTokAdsTrafficPreparation("owner", { accountId, identity: { id: "native-user", type: "TT_USER" }, locationIds: ["3017382"] }, timezone.dependencies)).preparationReady, false);
  for (const driftAt of [7, 8, 9]) { const changed = runtime({ driftAt }); await assert.rejects(changed.api.checkTikTokAdsTrafficPreparation("owner", { accountId, locationIds: ["3017382"] }, changed.dependencies), (error: unknown) => error instanceof ConnectionError && error.code === "account_mismatch"); }
});

test("TikTok geography consent ignores response time/order and changes with resolved scope/account/context", async () => {
  const sample = runtime(), geo = await sample.api.readTikTokAdsGeography("owner", { accountId, queries: ["France", "Arras"] }, sample.dependencies), key = policy.tikTokAdsGeographyConsentKey(geo);
  assert.equal(key, policy.tikTokAdsGeographyConsentKey({ ...geo, verifiedAt: "later", resolutions: [...geo.resolutions].reverse(), resolvedTargets: [...geo.resolvedTargets].reverse() }));
  assert.notEqual(key, policy.tikTokAdsGeographyConsentKey({ ...geo, selectedAccountId: "999999999" }));
  assert.notEqual(key, policy.tikTokAdsGeographyConsentKey({ ...geo, resolvedTargets: [geo.resolvedTargets[0]] }));
  assert.equal(policy.tikTokAdsGeographyConsentKey({ ...geo, context: { ...geo.context, language: "en" } } as unknown as policy.TikTokAdsGeography), null);
});

function routeRuntime(route: string, options: { denied?: boolean; limited?: boolean } = {}) {
  const calls: unknown[] = [];
  const api = load<{ GET: (request: Request) => Promise<Response> }>(route, new Map<string, unknown>([
    ["next/server", { NextResponse: { json: Response.json } }],
    ["@/lib/adsServer", { requirePremiumAdsUser: async (provider: string) => { assert.equal(provider, "tiktok"); return options.denied ? { user: null, errorResponse: new Response("Denied", { status: 403 }) } : { user: { activeUserId: "owner" } }; } }],
    ["@/lib/adsTikTokServer", { TikTokAdsConnectionError: ConnectionError }], ["@/lib/adsTikTokResources", policy],
    ["@/lib/adsValidation", { parseAdsCampaignInput: () => { throw new Error("GET cannot parse a POST draft"); } }],
    ["@/lib/adsTikTokCampaignPreparationServer", {}], ["@/lib/adsTikTokPublisherCore", {}],
    ["@/lib/rateLimit", { enforceRateLimit: async (input: { identifier: string }) => { assert.equal(input.identifier, "owner"); return options.limited ? new Response("Limited", { status: 429 }) : null; } }],
    ["@/lib/adsTikTokResourcesServer", { readTikTokAdsGeography: async (...args: unknown[]) => { calls.push(args); return { publicationEnabled: false }; }, checkTikTokAdsTrafficPreparation: async (...args: unknown[]) => { calls.push(args); return { ready: false, publicationEnabled: false }; } }],
  ]));
  return { api, calls };
}

test("TikTok new GET routes reject unauthenticated, excessive and malformed selections before provider calls", async () => {
  for (const file of ["../app/api/ads/tiktok/geography/route.ts", "../app/api/ads/tiktok/preflight/route.ts"]) {
    const denied = routeRuntime(file, { denied: true }); assert.equal((await denied.api.GET(new Request("https://local.test/api"))).status, 403); assert.equal(denied.calls.length, 0);
    const limited = routeRuntime(file, { limited: true }), response = await limited.api.GET(new Request("https://local.test/api")); assert.equal(response.status, 429); assert.equal(response.headers.get("Cache-Control"), "no-store"); assert.equal(limited.calls.length, 0);
    const invalid = routeRuntime(file); assert.equal((await invalid.api.GET(new Request("https://local.test/api?accountId=bad"))).status, 400); assert.equal(invalid.calls.length, 0);
    const source = readFileSync(new URL(file, import.meta.url), "utf8"); assert.doesNotMatch(source, /request\.json|process\.env|access_token_enc/);
    if (file.includes("geography")) assert.doesNotMatch(source, /export async function POST/);
  }
  for (const query of ["bad-json", JSON.stringify(Array.from({ length: 21 }, () => "France")), "[1]"]) {
    const sample = routeRuntime("../app/api/ads/tiktok/geography/route.ts"), url = new URL("https://local.test/api"); url.searchParams.set("queries", query);
    assert.equal((await sample.api.GET(new Request(url))).status, 400); assert.equal(sample.calls.length, 0);
  }
  const prep = routeRuntime("../app/api/ads/tiktok/preflight/route.ts"), url = new URL("https://local.test/api"); url.searchParams.set("identity", JSON.stringify({ id: "x", type: "BC_AUTH_TT" }));
  assert.equal((await prep.api.GET(new Request(url))).status, 400); assert.equal(prep.calls.length, 0);
});

test("TikTok new routes forward only owner-scoped safe selections and remain no-store/unpublishable", async () => {
  const geo = routeRuntime("../app/api/ads/tiktok/geography/route.ts"), geoUrl = new URL("https://local.test/api"); geoUrl.searchParams.set("accountId", accountId); geoUrl.searchParams.set("queries", JSON.stringify(["France"]));
  const response = await geo.api.GET(new Request(geoUrl)); assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "no-store"); assert.deepEqual(geo.calls, [["owner", { accountId, queries: ["France"] }]]);
  const prep = routeRuntime("../app/api/ads/tiktok/preflight/route.ts"), prepUrl = new URL("https://local.test/api"); prepUrl.searchParams.set("accountId", accountId); prepUrl.searchParams.set("locationIds", JSON.stringify(["3017382"])); prepUrl.searchParams.set("identity", JSON.stringify({ id: "native-user", type: "TT_USER", token: "private-secret" }));
  const prepared = await prep.api.GET(new Request(prepUrl)); assert.equal(prepared.status, 200); assert.equal(prepared.headers.get("Cache-Control"), "no-store"); assert.deepEqual(await prepared.json(), { ready: false, publicationEnabled: false });
  assert.deepEqual(prep.calls, [["owner", { accountId, locationIds: ["3017382"], identity: { id: "native-user", type: "TT_USER", displayName: "" } }]]);
});
