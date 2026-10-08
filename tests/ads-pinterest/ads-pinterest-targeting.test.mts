import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as locations from "../../lib/adsPinterestLocations.ts";
import * as publish from "../../lib/adsPinterestPublish.ts";
import * as nativeSettings from "../../lib/adsPinterestCampaignSettings.ts";
import * as nativeResources from "../../lib/adsPinterestResources.ts";

class ConnectionError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status = 503) { super(message); this.code = code; this.status = status; }
}

type PublishProgress = Record<string, unknown>;
type PublisherModule = {
  publishPinterestAdsCampaign: (userId: string, draft: unknown, persist: (progress: PublishProgress) => Promise<void>, options?: { activate?: boolean }) => Promise<PublishProgress>;
};
type ProviderCall = { path: string; method: string; body: unknown };

function record(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function batchItem(call: ProviderCall | undefined): Record<string, unknown> {
  assert.ok(call && Array.isArray(call.body));
  return record(call.body[0]);
}

function moduleFromFile<T>(path: string, imports: Record<string, unknown>, fetcher?: typeof fetch): T {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, unknown> = {};
  new Function("exports", "require", "fetch", compiled)(exports, (id: string) => {
    assert.ok(id in imports, `Unexpected dependency: ${id}`);
    return imports[id];
  }, fetcher);
  return exports as T;
}

const fixture = JSON.parse(readFileSync(new URL("./fixtures/targeting-catalog-fr.json", import.meta.url), "utf8"));
const options = locations.pinterestGeographyOptions(fixture.LOCATION, fixture.GEO);
const integration = { id: "integration-one", status: "connected", resource_id: "123456" };
const account = { id: "123456", currency: "EUR", country: "FR", canManageCampaigns: true };

function routeHarness(overrides: { auth?: unknown; accounts?: unknown[]; limited?: Response; failure?: Error } = {}) {
  const calls: string[] = [];
  const route = moduleFromFile<{ GET: (request: Request) => Promise<Response> }>("../../app/api/ads/pinterest/targeting/route.ts", {
    "next/server": { NextResponse: { json: (value: unknown, init: ResponseInit) => Response.json(value, init) } },
    "@/lib/adsServer": { requirePremiumAdsUser: async (channel: string) => { calls.push(`auth:${channel}`); return overrides.auth || { user: { activeUserId: "user-one" }, errorResponse: null }; } },
    "@/lib/adsPinterestLocations": locations,
    "@/lib/adsPinterestServer": {
      PinterestAdsConnectionError: ConnectionError,
      readPinterestAdsIntegration: async (userId: string) => { calls.push(`integration:${userId}`); return integration; },
      listPinterestAdsAccounts: async () => { calls.push("accounts"); return overrides.accounts || [account]; },
    },
    "@/lib/adsPinterestTargetingServer": { listPinterestAdsGeographyOptions: async (userId: string, accountId: string) => {
      calls.push(`catalog:${userId}:${accountId}`);
      if (overrides.failure) throw overrides.failure;
      return options;
    } },
    "@/lib/rateLimit": { enforceRateLimit: async () => { calls.push("rate-limit"); return overrides.limited || null; } },
  });
  return { route, calls };
}

test("targeting requires Pinterest authorization before reading account data", async () => {
  const denied = Response.json({ error: "forbidden" }, { status: 403 });
  const { route, calls } = routeHarness({ auth: { user: null, errorResponse: denied } });
  assert.equal(await route.GET(new Request("https://app.example/api/ads/pinterest/targeting")), denied);
  assert.deepEqual(calls, ["auth:pinterest"]);
});

test("targeting ignores injected advertiser IDs and returns exact filtered provider options", async () => {
  const { route, calls } = routeHarness();
  const response = await route.GET(new Request("https://app.example/api/ads/pinterest/targeting?query=nord&accountId=999"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { options: [{ id: "250059", name: "France: Nord", type: "LOCATION", kind: "metro" }], selectedAccountId: "123456", country: "FR" });
  assert.deepEqual(calls, ["auth:pinterest", "rate-limit", "integration:user-one", "accounts", "catalog:user-one:123456"]);
});

test("targeting rejects lost permissions and throttles before provider calls", async () => {
  const inaccessible = routeHarness({ accounts: [{ ...account, id: "789" }] });
  assert.equal((await inaccessible.route.GET(new Request("https://app.example/api/ads/pinterest/targeting"))).status, 409);
  assert.equal(inaccessible.calls.some((call) => call.startsWith("catalog:")), false);
  const readOnly = routeHarness({ accounts: [{ ...account, canManageCampaigns: null }] });
  assert.equal((await readOnly.route.GET(new Request("https://app.example/api/ads/pinterest/targeting"))).status, 403);
  const throttled = routeHarness({ limited: Response.json({ error: "slow down" }, { status: 429 }) });
  assert.equal((await throttled.route.GET(new Request("https://app.example/api/ads/pinterest/targeting"))).status, 429);
  assert.deepEqual(throttled.calls, ["auth:pinterest", "rate-limit"]);
});

test("targeting never exposes unknown exception details", async () => {
  const { route } = routeHarness({ failure: new Error("Bearer SECRET") });
  const response = await route.GET(new Request("https://app.example/api/ads/pinterest/targeting"));
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /SECRET|Bearer/);
});

test("targeting catalog cache is isolated by user and account and reads only provider resources", async () => {
  const calls: string[] = [];
  const service = moduleFromFile<{ listPinterestAdsGeographyOptions: (userId: string, accountId: string, connection: typeof integration) => Promise<typeof options> }>("../../lib/adsPinterestTargetingServer.ts", {
    "server-only": {},
    "./adsPinterestLocations": locations,
    "./adsPinterestServer": {
      PinterestAdsConnectionError: ConnectionError,
      pinterestAdsAccessToken: async (userId: string) => { calls.push(`token:${userId}`); return "fake-token"; },
    },
  }, async (url, init) => {
    assert.equal(init?.method, undefined);
    assert.equal(init?.body, undefined);
    assert.equal(init?.cache, "no-store");
    assert.ok(init?.signal);
    const target = new URL(String(url));
    calls.push(`${target.pathname}:${target.searchParams.get("ad_account_id")}`);
    return Response.json(target.pathname.endsWith("LOCATION") ? fixture.LOCATION : fixture.GEO);
  });
  await service.listPinterestAdsGeographyOptions("user-one", "123456", integration);
  assert.equal(calls.length, 3);
  await service.listPinterestAdsGeographyOptions("user-one", "123456", integration);
  assert.equal(calls.length, 3);
  await service.listPinterestAdsGeographyOptions("user-two", "123456", integration);
  assert.equal(calls.length, 6);
  await assert.rejects(service.listPinterestAdsGeographyOptions("user-one", "999", integration), /compte/);
  assert.equal(calls.length, 6);
});

function publisherHarness(rejectActivation = false) {
  const calls: ProviderCall[] = [];
  const publisher = moduleFromFile<PublisherModule>("../../lib/adsPinterestCampaignPublish.ts", {
    "server-only": {},
    "./adsPinterestPublish.ts": publish,
    "./adsPinterestCampaignSettings.ts": nativeSettings,
    "./adsPinterestResources.ts": nativeResources,
    "./adsPinterestResourcesServer.ts": { readPinterestAdsDeliveryResources: async () => {
      for (const type of ["LOCATION", "GEO", "LOCALE"]) calls.push({ path: `/v5/resources/targeting/${type}`, method: "GET", body: undefined });
      return { resources: nativeResources.normalizePinterestAdsResources({ id: "123456", currency: "EUR" }, fixture.LOCATION, fixture.GEO, fixture.LOCALE, "123456"), accessToken: "fake-token", locationPayload: fixture.LOCATION, geoPayload: fixture.GEO, localePayload: fixture.LOCALE };
    } },
    "./adsPinterestLocations.ts": locations,
    "./mediaLibraryContentUrl.ts": { verifyMediaLibraryContentToken: () => false },
    "./safeStorageSignedUrl.ts": { createSafeStorageSignedUrl: () => { throw new Error("Unexpected storage access"); } },
    "./supabaseAdmin.ts": { supabaseAdmin: {} },
  }, async (url, init) => {
    const path = new URL(String(url)).pathname;
    const method = String(init?.method);
    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ path, method, body });
    if (method === "GET") return Response.json(fixture[path.split("/").at(-1)!]);
    if (method === "PATCH") return Response.json({ items: [{ data: { id: batchItem({ path, method, body }).id, status: "ACTIVE" }, exceptions: rejectActivation ? [{ message: "declined" }] : [] }] });
    if (path.endsWith("/pins")) return Response.json({ id: "333333" });
    const id = path.endsWith("/campaigns") ? "111111" : path.endsWith("/ad_groups") ? "222222" : "444444";
    return Response.json({ items: [{ data: { id, status: "PAUSED" }, exceptions: [] }] });
  });
  return { publisher, calls };
}

const campaign = {
  provider: "pinterest", adAccountId: "123456", accountCurrency: "EUR", name: "Projet local",
  channelSettings: { channel: "pinterest", objectiveType: "CONSIDERATION", intendedPromotionType: "STANDARD_AD", creativeType: "REGULAR", targetingMode: "automatic", placementGroup: "ALL" },
  keywords: [], destinationUrl: "https://example.fr/offre", trackingParameters: "utm_source=pinterest&utm_campaign=locale",
  creativeUrl: "https://cdn.example.fr/image.png", dailyBudgetEuros: 10, pinterestBidEuros: 1,
  endDate: new Date(Date.now() + 8 * 86_400_000).toISOString().slice(0, 10),
  headlines: ["Une offre locale"], primaryText: "Découvrez notre service dans votre département.",
  targetLocations: ["France: Nord"], languages: ["fr"],
};

test("Pinterest actual publisher validates local catalog and sends targeting and UTM on paused resources", async () => {
  const { publisher, calls } = publisherHarness();
  const progress: PublishProgress[] = [];
  const result = await publisher.publishPinterestAdsCampaign("user-one", campaign, async (stage) => { progress.push(stage); }, { activate: false });
  assert.equal(result.stage, "paused");
  assert.equal(result.initialActivationPending, true);
  assert.deepEqual(calls.slice(0, 3).map((call) => call.method), ["GET", "GET", "GET"]);
  assert.deepEqual(calls.filter((call) => call.method === "POST").map((call) => call.path.split("/").at(-1)), ["campaigns", "ad_groups", "pins", "ads"]);
  assert.deepEqual(batchItem(calls.find((call) => call.method === "POST" && call.path.endsWith("/ad_groups"))).targeting_spec, { LOCATION: ["250059"], LOCALE: ["fr"] });
  assert.equal(record(calls.find((call) => call.path.endsWith("/pins"))?.body).link, "https://example.fr/offre?utm_source=pinterest&utm_campaign=locale");
  assert.equal(batchItem(calls.find((call) => call.path.endsWith("/ads"))).destination_url, "https://example.fr/offre?utm_source=pinterest&utm_campaign=locale");
  assert.equal(calls.some((call) => call.method === "PATCH"), false);
  assert.equal(progress.at(-1)?.stage, "paused");
});

test("Pinterest actual publisher rejects unsupported local targets and languages before any write", async () => {
  for (const change of [{ targetLocations: ["Lille"] }, { languages: ["unknown"] }]) {
    const { publisher, calls } = publisherHarness();
    await assert.rejects(publisher.publishPinterestAdsCampaign("user-one", { ...campaign, ...change }, async () => {}), (error: unknown) => error instanceof Error && "mutationStarted" in error && error.mutationStarted === false && /unique/.test(error.message));
    assert.equal(calls.some((call) => call.method !== "GET"), false);
  }
});

test("Pinterest actual publisher never reports an item-level activation failure as active", async () => {
  const { publisher, calls } = publisherHarness(true);
  const progress: PublishProgress[] = [];
  await assert.rejects(publisher.publishPinterestAdsCampaign("user-one", campaign, async (stage) => { progress.push(stage); }), (error: unknown) => error instanceof Error && "mutationStarted" in error && error.mutationStarted === true && /pas confirmé/.test(error.message));
  assert.equal(calls.filter((call) => call.method === "PATCH").length, 1);
  assert.equal(progress.some((item) => item.stage === "active"), false);
  assert.equal(progress.at(-1)?.stage, "ad_created");
  assert.equal(progress.at(-1)?.initialActivationPending, true);
});

test("Pinterest consumes the initial activation marker only after the campaign is activated last", async () => {
  const { publisher, calls } = publisherHarness();
  const progress: PublishProgress[] = [];
  const result = await publisher.publishPinterestAdsCampaign("user-one", campaign, async (stage) => { progress.push(stage); });
  assert.equal(result.stage, "active");
  assert.equal(result.initialActivationPending, false);
  assert.equal(calls.at(-1)?.path, "/v5/ad_accounts/123456/campaigns");
  assert.ok(progress.slice(0, -1).every((item) => item.initialActivationPending === true));
});
