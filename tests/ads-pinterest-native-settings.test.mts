import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as settings from "../lib/adsPinterestCampaignSettings.ts";
import * as resources from "../lib/adsPinterestResources.ts";
import * as locations from "../lib/adsPinterestLocations.ts";
import * as builders from "../lib/adsPinterestPublish.ts";
import { readPinterestAdsPlanIntent } from "../lib/adsPinterestPlanIntent.ts";
import { parseAdsCampaignInput } from "../lib/adsValidation.ts";

const now = Date.parse("2026-10-08T12:00:00Z");
const endDate = new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 10);
const fixture = JSON.parse(readFileSync(new URL("./ads-pinterest/fixtures/targeting-catalog-fr.json", import.meta.url), "utf8"));
const nativeAccount = { id: "123456", name: "Annonceur", currency: "EUR", country: "FR", time_zone: "UTC", permissions: ["ADMIN"] };
const native = resources.normalizePinterestAdsResources(nativeAccount, fixture.LOCATION, fixture.GEO, fixture.LOCALE, nativeAccount.id);
const draft = {
  provider: "pinterest", adAccountId: "123456", accountCurrency: "EUR", name: "Projet local", creationMode: "manual", campaignType: "generic", objective: "website_traffic", conversionGoal: "website_visit", conversionLocation: "website", bidStrategy: "maximize_clicks", offer: "Un projet", metaPlacements: [], descriptions: [], negativeKeywords: [], creativeType: "image", mediaStrategy: "image", targetAudiences: ["Une intention créative"],
  channelSettings: { schemaVersion: 1, channel: "pinterest", objectiveType: "CONSIDERATION", intendedPromotionType: "STANDARD_AD", creativeType: "REGULAR", targetingMode: "automatic", conversionEvent: null },
  keywords: [], destinationUrl: "https://example.fr/offre", trackingParameters: "utm_source=pinterest&utm_campaign=locale", creativeUrl: "https://cdn.example.fr/image.png", dailyBudgetEuros: 10, pinterestBidEuros: 1,
  endDate, headlines: ["Une offre locale"], primaryText: "Découvrez notre service dans votre département.", targetLocations: ["France: Nord"], languages: ["fr"],
};

test("native Pinterest defaults use automatic bidding, while absent settings retain legacy MAX_BID", () => {
  const defaults = settings.defaultPinterestDeliverySettings();
  assert.deepEqual(defaults.bidding, { strategy: "automatic", amountEuros: null });
  const legacy = settings.pinterestNativeDelivery({ dailyBudgetEuros: 10, endDate: "2026-10-16", channelSettings: { objectiveType: "CONSIDERATION" } }, now);
  assert.equal(legacy.bidStrategyType, "MAX_BID"); assert.equal(legacy.bidInMicroCurrency, 1000000); assert.equal(legacy.budgetType, "daily"); assert.equal(legacy.flexibleDaily, false);
  assert.equal(settings.defaultPinterestDeliverySettings("AWARENESS").optimizationGoal, "impressions");
});

test("native total CBO and ISO hours are not replaced by the legacy daily amount or calendar", () => {
  const delivery = settings.defaultPinterestDeliverySettings();
  delivery.budget = { type: "total", totalEuros: 200, flexibleDaily: false, startAt: "2026-10-09T09:30:00+02:00", endAt: "2026-10-19T17:45:00+02:00" };
  const actual = settings.pinterestNativeDelivery({ dailyBudgetEuros: 10, endDate: "2026-12-01", pinterestDeliverySettings: delivery, channelSettings: { objectiveType: "CONSIDERATION" } }, now);
  const campaign = builders.buildPinterestLiveCampaignBody({ name: "Test", objectiveType: "CONSIDERATION", lifetimeSpendCap: actual.spendCap, startTime: actual.startTime, endTime: actual.endTime });
  assert.ok("lifetime_spend_cap" in campaign);
  assert.equal(campaign.lifetime_spend_cap, 200000000); assert.equal("daily_spend_cap" in campaign, false); assert.equal("is_flexible_daily_budgets" in campaign, false);
  assert.equal(campaign.start_time, Date.parse("2026-10-09T07:30:00Z") / 1000); assert.equal(campaign.end_time, Date.parse("2026-10-19T15:45:00Z") / 1000);
});

test("native automatic bid omits manual price and keeps the objective billable event and selected placement", () => {
  for (const objectiveType of ["AWARENESS", "CONSIDERATION"] as const) {
    const body = builders.buildPinterestLiveAdGroupBody({ name: "Groupe", campaignId: "123", objectiveType, bidInMicroCurrency: null, bidStrategyType: "AUTOMATIC_BID", placementGroup: "SEARCH", targetingSpec: { LOCATION: ["FR"], LOCALE: ["fr"] } });
    assert.equal(body.bid_strategy_type, "AUTOMATIC_BID"); assert.equal("bid_in_micro_currency" in body, false); assert.equal(body.billable_event, objectiveType === "AWARENESS" ? "IMPRESSION" : "CLICKTHROUGH"); assert.equal(body.placement_group, "SEARCH");
    for (const field of ["budget_in_micro_currency", "budget_type", "start_time", "end_time", "optimization_type"]) assert.equal(field in body, false);
  }
});

test("Pinterest rejects mixed budgets, unverified optimisation, unknown native settings and malformed dates", () => {
  const defaults = settings.defaultPinterestDeliverySettings();
  for (const value of [
    { ...defaults, budget: { ...defaults.budget, totalEuros: 200 } },
    { ...defaults, budget: { ...defaults.budget, type: "total", totalEuros: 200, flexibleDaily: true } },
    { ...defaults, optimizationGoal: "outbound_clicks" },
    { ...defaults, conversions: { actionId: "invented" } },
    { ...defaults, bidding: { strategy: "automatic", amountEuros: 1 } },
    { ...defaults, bidding: { strategy: "max_bid", amountEuros: null } },
    { ...defaults, budget: { ...defaults.budget, startAt: "2026-10-09T09:00" } },
    { ...defaults, budget: { ...defaults.budget, endAt: "2026-02-31T10:00:00Z" } },
  ]) assert.ok(settings.normalizePinterestDeliverySettings(value).error);
  assert.throws(() => settings.pinterestNativeDelivery({ dailyBudgetEuros: 10, endDate: "2026-10-16", channelSettings: { objectiveType: "AWARENESS" }, pinterestDeliverySettings: defaults }, now), /optimisation/);
});

test("Pinterest publication parser preserves the new budget and blocks incompatible native intents early", () => {
  const delivery = settings.defaultPinterestDeliverySettings(); delivery.budget = { ...delivery.budget, type: "total", totalEuros: 200, endAt: new Date(Date.now() + 8 * 86400000).toISOString() };
  const parsed = parseAdsCampaignInput({ ...draft, pinterestDeliverySettings: delivery, pinterestBidEuros: 999 }, { purpose: "publish" });
  assert.equal(parsed.error, null); assert.equal(parsed.draft?.pinterestDeliverySettings?.budget.totalEuros, 200); assert.equal(parsed.draft?.pinterestDeliverySettings?.bidding.amountEuros, null);
  assert.ok(parseAdsCampaignInput({ ...draft, keywords: ["plomberie"] }, { purpose: "publish" }).error);
  assert.ok(parseAdsCampaignInput({ ...draft, channelSettings: { ...draft.channelSettings, targetingMode: "audiences" } }, { purpose: "publish" }).error);
  assert.ok(parseAdsCampaignInput({ ...draft, provider: "google", pinterestDeliverySettings: delivery }, { purpose: "draft" }).error);
});

test("human Pinterest budgets and instants are preserved without converting a total into daily", () => {
  const intent = readPinterestAdsPlanIntent({ intent: "Campagne Pinterest avec budget total de 200 euros du 9 octobre 2026 à 09h30 au 19 octobre 2026 à 17h45.", now: "2026-10-08T12:00:00Z", timezone: "Europe/Paris" });
  assert.equal(intent.error, null); assert.equal(intent.budget?.type, "total"); assert.equal(intent.budget?.totalEuros, 200); assert.equal(intent.budget?.dailyEuros, null); assert.equal(intent.budget?.startAt, "2026-10-09T07:30:00.000Z"); assert.equal(intent.budget?.endAt, "2026-10-19T15:45:00.000Z");
  assert.equal(intent.deliverySettings?.bidding.strategy, "automatic");
  assert.ok(readPinterestAdsPlanIntent({ intent: "Campagne budget total 200 euros et budget 10 euros par jour.", now: "2026-10-08T12:00:00Z" }).error);
  assert.equal(readPinterestAdsPlanIntent({ intent: "Budget total 30 € pour 1 jour de campagne", now: "2026-10-08T12:00:00Z" }).error, null);
});

test("Pinterest native evidence remains order-independent and changes on timezone or target changes", () => {
  const key = resources.pinterestAdsResourcesConsentKey(native);
  assert.equal(key, resources.pinterestAdsResourcesConsentKey({ ...native, geographies: [...native.geographies].reverse(), locales: [...native.locales].reverse() }));
  assert.notEqual(key, resources.pinterestAdsResourcesConsentKey({ ...native, account: { ...native.account, timezone: "Europe/Paris" } }));
  assert.notEqual(key, resources.pinterestAdsResourcesConsentKey({ ...native, geographies: native.geographies.slice(1) }));
  const canonical = resources.resolvePinterestAdsGeographies(native, ["France: Nord"]);
  assert.deepEqual(canonical.map((item) => item.id), ["250059"]); assert.deepEqual(resources.resolvePinterestAdsGeographies(native, canonical.map((item) => item.name)), canonical);
  assert.throws(() => resources.resolvePinterestAdsGeographies(native, ["Lille"]), /aucun élargissement/);
  assert.throws(() => resources.normalizePinterestAdsResources({ ...nativeAccount, id: "999999" }, fixture.LOCATION, fixture.GEO, fixture.LOCALE, "123456"), /compte/);
});

function runtime<T>(relative: string, modules: Record<string, unknown>, fetcher?: typeof fetch): T {
  const compiled = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function("exports", "require", "fetch", compiled)(exports, (name: string) => { assert.ok(name in modules, `Unexpected module ${name}`); return modules[name]; }, fetcher);
  return exports as T;
}
class ConnectionError extends Error { code: string; status: number; constructor(message: string, code: string, status = 503) { super(message); this.code = code; this.status = status; } }
const integration = { id: "connection-one", status: "connected", resource_id: nativeAccount.id, scopes: "ads:read,ads:write,boards:read,boards:write,pins:read,pins:write" };
type ResourceServer = { readPinterestAdsDeliveryResources(userId: string, accountId?: string): Promise<{ resources: resources.PinterestAdsResources; accessToken: string; locationPayload: unknown; geoPayload: unknown; localePayload: unknown }> };

function serverHarness(options: { changed?: boolean; changedDuring?: boolean; role?: boolean; denyStatus?: number } = {}) {
  const calls: string[] = []; let reads = 0;
  const service = runtime<ResourceServer>("../lib/adsPinterestResourcesServer.ts", { "server-only": {}, "./adsPinterestResources.ts": resources, "./adsPinterestPolicy.ts": { missingPinterestAdsScopes: () => [] }, "./adsPinterestServer.ts": {
    PinterestAdsConnectionError: ConnectionError,
    readPinterestAdsIntegration: async () => { calls.push("integration"); reads++; return (options.changed && reads > 1 || options.changedDuring && reads > 3) ? { ...integration, resource_id: "999999" } : integration; },
    listPinterestAdsAccounts: async (_owner: string, connection: unknown) => { calls.push("accounts"); assert.equal(connection, integration); return [{ ...nativeAccount, canManageCampaigns: options.role !== false }]; },
    pinterestAdsAccessToken: async () => { calls.push("token"); return "server-secret"; },
  } }, async (url, init) => {
    assert.equal(init?.method, undefined); assert.equal(init?.body, undefined); assert.equal(init?.cache, "no-store"); assert.ok(init?.signal);
    const pathname = new URL(String(url)).pathname; calls.push(pathname);
    if (options.denyStatus) return Response.json({ error: "private detail" }, { status: options.denyStatus });
    return Response.json(pathname.endsWith(nativeAccount.id) ? nativeAccount : fixture[pathname.split("/").at(-1)!]);
  });
  return { service, calls };
}

test("native Pinterest resource reads refresh current account identity and never create remote objects", async () => {
  const { service, calls } = serverHarness();
  const result = await service.readPinterestAdsDeliveryResources("owner", nativeAccount.id);
  assert.deepEqual(result.resources, native); assert.equal(result.accessToken, "server-secret");
  assert.ok(calls.indexOf("accounts") < calls.indexOf("token")); assert.equal(calls.filter((call) => call.startsWith("/v5/")).length, 4);
  assert.doesNotMatch(JSON.stringify(result.resources), /server-secret|token|upload/);
  for (const options of [{ changed: true }, { changedDuring: true }, { role: false }]) {
    const denied = serverHarness(options); await assert.rejects(denied.service.readPinterestAdsDeliveryResources("owner")); assert.equal(denied.calls.includes("token"), Boolean("changedDuring" in options));
  }
  const forbidden = serverHarness({ denyStatus: 403 }); await assert.rejects(forbidden.service.readPinterestAdsDeliveryResources("owner"), (error: unknown) => error instanceof ConnectionError && error.status === 403 && !error.message.includes("private"));
});

test("native Pinterest publisher sends total/auto selections and records the hierarchy before activation", async () => {
  const calls: Array<{ path: string; method: string; body: unknown }> = []; const progress: Record<string, unknown>[] = [];
  const publisher = runtime<{ publishPinterestAdsCampaign(owner: string, input: unknown, persist: (value: Record<string, unknown>) => Promise<void>): Promise<Record<string, unknown>> }>("../lib/adsPinterestCampaignPublish.ts", {
    "server-only": {}, "./adsPinterestPublish.ts": builders, "./adsPinterestLocations.ts": locations, "./adsPinterestCampaignSettings.ts": settings, "./adsPinterestResources.ts": resources,
    "./adsPinterestResourcesServer.ts": { readPinterestAdsDeliveryResources: async () => ({ resources: native, accessToken: "server-secret", locationPayload: fixture.LOCATION, geoPayload: fixture.GEO, localePayload: fixture.LOCALE }) },
    "./mediaLibraryContentUrl.ts": { verifyMediaLibraryContentToken: () => false }, "./safeStorageSignedUrl.ts": {}, "./supabaseAdmin.ts": { supabaseAdmin: {} },
  }, async (url, init) => {
    const pathname = new URL(String(url)).pathname, method = String(init?.method), body = JSON.parse(String(init?.body)); calls.push({ path: pathname, method, body });
    if (method === "PATCH") { assert.equal(progress.at(-1)?.stage === "ad_created" || progress.at(-1)?.stage === "ad_activated" || progress.at(-1)?.stage === "ad_group_activated", true); return Response.json({ items: [{ data: body[0] }] }); }
    if (pathname.endsWith("/pins")) return Response.json({ id: "333333" });
    return Response.json({ items: [{ data: { id: pathname.endsWith("/campaigns") ? "111111" : pathname.endsWith("/ad_groups") ? "222222" : "444444", status: "PAUSED" } }] });
  });
  const delivery = settings.defaultPinterestDeliverySettings(); delivery.budget = { ...delivery.budget, type: "total", totalEuros: 200, endAt: new Date(Date.now() + 8 * 86400000).toISOString() }; delivery.placementGroup = "BROWSE";
  const result = await publisher.publishPinterestAdsCampaign("owner", { ...draft, pinterestDeliverySettings: delivery }, async (value) => { progress.push(value); });
  assert.equal(result.stage, "active");
  const campaignBody = (calls[0].body as Record<string, unknown>[])[0], groupBody = (calls[1].body as Record<string, unknown>[])[0];
  assert.equal(campaignBody.lifetime_spend_cap, 200000000); assert.equal("daily_spend_cap" in campaignBody, false); assert.equal(groupBody.bid_strategy_type, "AUTOMATIC_BID"); assert.equal("bid_in_micro_currency" in groupBody, false); assert.equal(groupBody.placement_group, "BROWSE");
  assert.deepEqual(calls.filter((call) => call.method === "PATCH").map((call) => call.path.split("/").at(-1)), ["ads", "ad_groups", "campaigns"]);
  assert.equal(progress[0].campaignId, "111111"); assert.equal(progress[1].adGroupId, "222222"); assert.equal(progress[2].pinId, "333333"); assert.equal(progress[3].adId, "444444");
});

class PreparationError extends Error {}
function routeHarness(options: { failure?: Error; denied?: boolean; claimed?: boolean; foreign?: boolean } = {}) {
  const calls: string[] = [];
  const saved = { id: "870bb769-8aa0-45da-ac44-d24d0b414955", user_id: options.foreign ? "foreign" : "owner", provider: "pinterest", ad_account_id: draft.adAccountId, currency: "EUR", daily_budget_cents: 1000, draft, status: options.claimed ? "active" : "draft", provider_resources: {}, published_at: null };
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: saved, error: null }) };
  const modules = {
    "next/server": { NextResponse: { json: (value: unknown, init?: ResponseInit) => Response.json(value, init) } },
    "@/lib/adsServer": { adsRequestOriginAllowed: () => true, adsBadOriginResponse: () => Response.json({}, { status: 403 }), adsPilotOnlyResponse: () => Response.json({}, { status: 403 }), isAdsChannelUserAllowed: async (...args: string[]) => { calls.push(`channel:${args.at(-1)}`); return true; }, requirePremiumAdsUser: async (channel?: string) => { calls.push(`auth:${channel}`); return options.denied ? { errorResponse: Response.json({}, { status: 403 }) } : { user: { activeUserId: "owner", authUserId: "auth" } }; } },
    "@/lib/rateLimit": { enforceRateLimit: async () => null }, "@/lib/supabaseAdmin": { supabaseAdmin: { from: () => { calls.push("database-read"); return query; } } },
    "@/lib/adsValidation": { parseAdsCampaignInput }, "@/lib/observability/logger": { log: { warn() {} } },
    "@/lib/adsMetaPublish": { checkMetaAdsPublication: async () => { throw new Error("Unexpected Meta request"); } }, "@/lib/adsMetaResourcesServer": { MetaAdsPreparationError: class extends Error {} }, "@/lib/adsOpenaiServer": { checkOpenaiAdsPublication: async () => { throw new Error("Unexpected ChatGPT request"); } }, "@/lib/adsOpenaiConnector": { OpenaiAdsPublishError: class extends Error {} },
    "@/lib/adsGooglePublish": {}, "@/lib/adsGoogleApiError": {}, "@/lib/adsLinkedInPublisherServer": {}, "@/lib/adsLinkedInServer": {},
    "@/lib/adsPinterestServer": { PinterestAdsConnectionError: ConnectionError },
    "@/lib/adsPinterestResourcesServer": { readPinterestAdsDeliveryResources: async (owner: string) => { calls.push(`resources:${owner}`); if (options.failure) throw options.failure; return { resources: native, accessToken: "Bearer private-token", locationPayload: fixture.LOCATION }; } },
    "@/lib/adsPinterestCampaignPublish": { PinterestAdsPreparationError: PreparationError, checkPinterestAdsPublication: async (owner: string, input: unknown) => { calls.push(`check:${owner}`); assert.equal((input as { adAccountId: string }).adAccountId, "123456"); if (options.failure) throw options.failure; return { ready: true, selectedAccountId: "123456", verifiedLocationCount: 1, verifiedLanguageCount: 1, resourcesKey: resources.pinterestAdsResourcesConsentKey(native), accessToken: "Bearer private-token", imageUrl: "https://storage.example/signed-secret" }; } },
  };
  return { calls, preflight: runtime<{ GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> }>("../app/api/ads/campaigns/[id]/preflight/route.ts", modules), resource: runtime<{ GET(): Promise<Response> }>("../app/api/ads/pinterest/resources/route.ts", modules), saved };
}

test("saved Pinterest preflight scopes the owner and returns reviewed evidence without tokens, media capabilities or writes", async () => {
  const harness = routeHarness();
  const response = await harness.preflight.GET(new Request("https://app.example/api/ads/campaigns/id/preflight"), { params: Promise.resolve({ id: harness.saved.id }) });
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.deepEqual(body, { ready: true, selectedAccountId: "123456", verifiedLocationCount: 1, verifiedLanguageCount: 1, resourcesKey: resources.pinterestAdsResourcesConsentKey(native) });
  assert.deepEqual(harness.calls, ["auth:undefined", "database-read", "channel:pinterest", "check:owner"]);
  assert.doesNotMatch(JSON.stringify(body), /Bearer|private-token|signed-secret/);
});

test("Pinterest GET guards reject inaccessible or claimed drafts and suppress unexpected provider internals", async () => {
  for (const options of [{ denied: true }, { claimed: true }, { foreign: true }]) {
    const harness = routeHarness(options); const response = await harness.preflight.GET(new Request("https://app.example/preflight"), { params: Promise.resolve({ id: harness.saved.id }) });
    assert.ok(response.status >= 400); assert.equal(harness.calls.includes("check:owner"), false);
  }
  const forbidden = routeHarness({ failure: new ConnectionError("Le compte a changé.", "account_changed", 409) });
  assert.equal((await forbidden.preflight.GET(new Request("https://app.example/preflight"), { params: Promise.resolve({ id: forbidden.saved.id }) })).status, 409);
  const badGeo = routeHarness({ failure: new PreparationError("La zone Lille reste à vérifier.") });
  const geoFailure = await badGeo.preflight.GET(new Request("https://app.example/preflight"), { params: Promise.resolve({ id: badGeo.saved.id }) });
  assert.equal(geoFailure.status, 422); assert.match(await geoFailure.text(), /Lille/);
  const unexpected = routeHarness({ failure: new Error("Bearer private-token https://database.private") });
  const failure = await unexpected.preflight.GET(new Request("https://app.example/preflight"), { params: Promise.resolve({ id: unexpected.saved.id }) });
  assert.equal(failure.status, 503); assert.doesNotMatch(await failure.text(), /Bearer|private-token|database.private/);
});

test("Pinterest resources endpoint exposes only public native evidence and requires channel authorization", async () => {
  const harness = routeHarness(); const response = await harness.resource.GET(); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), native); assert.deepEqual(harness.calls, ["auth:pinterest", "resources:owner"]);
  const denied = routeHarness({ denied: true }); assert.equal((await denied.resource.GET()).status, 403); assert.deepEqual(denied.calls, ["auth:pinterest"]);
  const failed = routeHarness({ failure: new Error("Bearer private-token") }); const unavailable = await failed.resource.GET(); assert.equal(unavailable.status, 503); assert.doesNotMatch(await unavailable.text(), /Bearer|private-token/);
});
