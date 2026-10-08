import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import ts from "typescript";
import * as core from "../lib/adsXPublisherCore.ts";
import * as resources from "../lib/adsXResources.ts";
import * as policy from "../lib/adsXPolicy.ts";
import * as calendar from "../lib/adsPreparedCampaignSettings.ts";
import * as oauth from "../lib/adsXOAuth1.ts";
import type { AdsCampaignInput } from "../lib/adsValidation.ts";
type Api = typeof import("../lib/adsXResourcesServer.ts"); type Publisher = typeof import("../lib/adsXPublisherServer.ts");
class ConnectionError extends Error { code: string; status: number; constructor(message: string, code: string, status = 503) { super(message); this.code = code; this.status = status; } }
const now = Date.parse("2026-10-08T10:00:00Z"), accountId = "18ce54d4x5t", authorId = "1234567890123456789", operationKey = "inrcy_x_mock_operation", campaignId = "c906f397-f729-43a4-8c1f-6d2a6c18c061";
const geo: resources.XAdsGeoTarget = { id: "geoa1", name: "Hauts-de-France, France", countryCode: "FR", locationType: "REGIONS" };
function load<T>(name: string, modules: Map<string, unknown>): T {
  const loaded = { exports: {} as T }, code = ts.transpileModule(readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  new Function("module", "exports", "require", code)(loaded, loaded.exports, (key: string) => { assert.ok(modules.has(key), key); return modules.get(key); }); return loaded.exports;
}
function fixture(options: { currency?: string; permissions?: string[]; author?: string; driftAt?: number; wrongUser?: boolean; geography?: string; truncated?: boolean; endless?: boolean; unverified?: boolean; failCode?: number; grantDropAfter?: number; nativeWrites?: boolean; revokeAfterPost?: boolean; storeReady?: boolean } = {}) {
  let reads = 0, grants = 0;
  const calls: Array<{ method: string; path: string; params: URLSearchParams; headers: Headers }> = [];
  const nativeObjects = new Map<string, unknown>();
  const row = { id: "integration", status: "connected", resource_id: accountId, resource_label: "Annonceur", provider_account_id: options.author || authorId, access_token_enc: "cipher", refresh_token_enc: "secret-cipher", meta: { auth: "oauth1a" } };
  const modules = new Map<string, unknown>([["server-only", {}], ["node:crypto", { createHash }], ["./oauthCrypto.ts", {}], ["./adsXOAuth1.ts", oauth], ["./adsXServer.ts", { XAdsConnectionError: ConnectionError }], ["./adsXPolicy.ts", policy], ["./adsPreparedCampaignSettings.ts", calendar], ["./adsXResources.ts", resources], ["./adsXPublisherCore.ts", core]]);
  const api = load<Api>("adsXResourcesServer", modules);
  const dependencies: import("../lib/adsXResourcesServer.ts").XAdsResourcesDependencies = {
    readIntegration: async (owner) => { assert.equal(owner, "owner"); reads++; return options.driftAt && reads >= options.driftAt ? { ...row, access_token_enc: "changed" } : row; },
    credentials: () => ({ apiKey: "fixture-private-app", apiSecret: "fixture-private-secret", configured: true }), decrypt: (value) => value === "cipher" ? "fixture-private-token" : "fixture-private-token-secret", now: () => now,
    readStoreAvailability: async () => options.storeReady !== false,
    grantProof: () => { grants++; const state = options.unverified || options.grantDropAfter && grants >= options.grantDropAfter || options.revokeAfterPost && calls.some((call) => call.method === "POST") ? "unverified" : "verified"; return { standardAccess: state, tokenRegeneratedAfterApproval: state, nativeWriteAccess: state }; },
    fetchImpl: (async (input, init) => {
      const url = new URL(String(input)), method = init?.method || "GET", path = url.pathname.replace(`/12/accounts/${accountId}`, "").replace("/12", ""), params = method === "POST" ? new URLSearchParams(String(init?.body)) : url.searchParams, headers = new Headers(init?.headers);
      calls.push({ method, path, params, headers }); assert.equal(url.origin, "https://ads-api.x.com"); assert.equal(init?.redirect, "error"); assert.ok(headers.get("Authorization")?.startsWith("OAuth "));
      if (options.failCode) return Response.json({ errors: [{ message: "fixture-private-token fixture-private-secret" }] }, { status: options.failCode });
      if (options.nativeWrites && method === "POST") {
        assert.equal(new Headers(init?.headers).get("Content-Type"), "application/x-www-form-urlencoded;charset=UTF-8");
        const body = Object.fromEntries(params);
        if (path === "/tweet") { assert.equal(body.nullcast, "true"); assert.equal(body.as_user_id, authorId); return Response.json({ data: { id_str: "1987654321098765432", user: { id_str: authorId }, full_text: body.text, nullcast: true, truncated: false, tweet_type: "PUBLISHED" } }); }
        if (path === "/campaigns") { assert.equal(body.entity_status, "PAUSED"); nativeObjects.set("/campaigns/camp1", { ...body, id: "camp1", deleted: false, currency: "EUR", daily_budget_amount_local_micro: Number(body.daily_budget_amount_local_micro) }); return Response.json({ data: { id: "camp1" } }); }
        if (path === "/line_items") { assert.equal(body.entity_status, "PAUSED"); nativeObjects.set("/line_items/line1", { ...body, id: "line1", deleted: false, placements: [body.placements], daily_budget_amount_local_micro: Number(body.daily_budget_amount_local_micro), bid_amount_local_micro: Number(body.bid_amount_local_micro) }); return Response.json({ data: { id: "line1" } }); }
        if (path === "/targeting_criteria") { const target = { ...body, id: "target1", deleted: false }; nativeObjects.set("/targeting_criteria/target1", target); return Response.json({ data: target }); }
        if (path === "/promoted_tweets") { const promotion = { id: "promo1", line_item_id: body.line_item_id, tweet_id: body.tweet_ids, entity_status: "ACTIVE", deleted: false }; nativeObjects.set("/promoted_tweets/promo1", promotion); return Response.json({ data: [promotion] }); }
      }
      if (method === "GET") {
        if (nativeObjects.has(path)) return Response.json({ data: nativeObjects.get(path) });
        if (!path) return Response.json({ data: { id: accountId, name: "Compte", approval_status: "ACCEPTED", deleted: false, timezone: "Europe/Paris", secret: "private-provider-data" } });
        if (path === "/authenticated_user_access") return Response.json({ data: { user_id: options.wrongUser ? "999999999" : row.provider_account_id, permissions: options.permissions || ["ACCOUNT_ADMIN", "TWEET_COMPOSER"] } });
        if (path === "/funding_instruments") return Response.json({ data: [{ id: "fund1", currency: options.currency || "EUR", able_to_fund: true, cancelled: false, deleted: false, credit_limit_local_micro: 999999 }], next_cursor: options.endless ? "same" : null });
        if (path === "/promotable_users") return Response.json({ data: [{ id: "prom1", user_id: authorId, promotable_user_type: "FULL", deleted: false }] });
        if (path === "/tweets") return Response.json({ data: [{ id_str: "1987654321098765432", user: { id_str: authorId }, full_text: "Votre communication simplifiée", tweet_type: "PUBLISHED", nullcast: true, truncated: Boolean(options.truncated), entities: { urls: [] } }] });
        if (path === "/targeting_criteria/locations") return Response.json({ data: [{ targeting_type: "LOCATION", targeting_value: options.geography || geo.id, name: geo.name, country_code: "FR", location_type: "REGIONS" }] });
      }
      throw new Error("Unexpected fixture native write/read " + method + path);
    }) as typeof fetch,
  };
  const selection: resources.XAdsNativeSelections = { schemaVersion: 1, accountId, context: { objective: "ENGAGEMENTS", format: "text", targetingMode: "broad", placements: "ALL_ON_TWITTER" }, fundingInstrumentId: "fund1", promotableUserId: "prom1", postId: null, geoTargets: [geo] };
  const draft = { provider: "x", adAccountId: accountId, accountCurrency: "EUR", name: "Campagne test", primaryText: "Votre communication simplifiée", mediaStrategy: "search_text", channelSettings: { schemaVersion: 1, channel: "x", objective: "engagement", format: "text", targetingMode: "broad" }, languages: ["fr"], keywords: [], negativeKeywords: [], destinationUrl: "", trackingParameters: "", targetLocations: [geo.name], dailyBudgetEuros: 10,
    preparedDeliverySettings: { budget: { type: "daily", totalEuros: null, startAt: "2026-10-09T07:00:00Z", endAt: "2026-10-14T21:59:00Z" }, bidding: { strategy: "max_bid", amountEuros: 1 } }, xNativeSelections: selection } as unknown as AdsCampaignInput;
  const publisher = load<Publisher>("adsXPublisherServer", new Map<string, unknown>([["server-only", {}], ["./adsXOAuth1.ts", oauth], ["./adsXResources.ts", resources], ["./adsXResourcesServer.ts", api], ["./adsXPublisherCore.ts", core]]));
  return { api, publisher, dependencies, calls, selection, draft, row, reads: () => reads };
}
test("X Standard approval proof is app-bound and requires OAuth regenerated strictly after approval", () => {
  const f = fixture(), apiKey = "fixture-private-app", hash = createHash("sha256").update(apiKey).digest("hex");
  const row = { ...f.row, meta: { oauth1a_app_key_hash: hash, oauth1a_token_issued_at: "2026-10-08T09:30:00Z" } };
  const env = { X_ADS_STANDARD_ACCESS_APPROVED: "true", X_ADS_STANDARD_ACCESS_APPROVED_AT: "2026-10-08T09:00:00Z", X_ADS_APPROVED_APP_KEY_SHA256: hash };
  assert.equal(f.api.xAdsServerGrantProof(row, apiKey, now, env).nativeWriteAccess, "verified");
  for (const changed of [{}, { ...env, X_ADS_APPROVED_APP_KEY_SHA256: "other" }, { ...env, X_ADS_STANDARD_ACCESS_APPROVED_AT: "2026-10-08T09:30:00Z" }, { ...env, X_ADS_STANDARD_ACCESS_APPROVED_AT: "2026-11-31T09:00:00Z" }]) assert.equal(f.api.xAdsServerGrantProof(row, apiKey, now, changed).nativeWriteAccess, "unverified");
});
test("X public discovery verifies account, funding and promotable identities without exposing secrets or writing", async () => {
  const f = fixture(), result = await f.api.readXAdsResources("owner", {}, f.dependencies);
  assert.equal(result.selectedAccountId, accountId); assert.equal(result.account.timeZone, "Europe/Paris"); assert.equal(result.posts.length, 1); assert.equal(result.publicationEnabled, false);
  assert.ok(f.calls.every((call) => call.method === "GET")); assert.doesNotMatch(JSON.stringify(result), /fixture-private|cipher|oauth1a_app_key_hash|secret|credit_limit|access_token/);
});
test("X unknown app grants stay unverified despite successful account discovery", async () => {
  const f = fixture({ unverified: true }); const result = await f.api.checkXAdsCampaignPreparation("owner", { draft: f.draft }, f.dependencies);
  assert.equal(result.preparationReady, true); assert.equal(result.ready, false); assert.equal(result.publicationEnabled, false); assert.equal(result.capabilities.nativeWriteAccess, "unverified"); assert.ok(f.calls.every((call) => call.method === "GET"));
});
test("X native creation stays unavailable until the durable journal migration is verified", async (t) => {
  const before = process.env.X_ADS_PAUSED_CREATION_ENABLED; process.env.X_ADS_PAUSED_CREATION_ENABLED = "true"; t.after(() => { if (before === undefined) delete process.env.X_ADS_PAUSED_CREATION_ENABLED; else process.env.X_ADS_PAUSED_CREATION_ENABLED = before; });
  const f = fixture({ storeReady: false }); const result = await f.api.checkXAdsCampaignPreparation("owner", { draft: f.draft }, f.dependencies);
  assert.equal(result.ready, false); assert.equal(result.preparationReady, true); assert.ok(result.blockers.includes("campaign_store_migration_required"));
  await assert.rejects(f.publisher.publishXAdsCampaign("owner", f.draft, async () => assert.fail("No journal write"), { campaignId, operationKey, assertCampaignOwnership: async () => undefined, withOperationLock: async () => assert.fail("No native lock"), serverDependencies: f.dependencies }), /native_preparation_unverified/);
  assert.ok(f.calls.every((call) => call.method === "GET"));
});
test("X exact native geography resolves from provider names without widening or invented IDs", async () => {
  const f = fixture(), result = await f.api.readXAdsGeography("owner", { queries: [geo.name] }, f.dependencies);
  assert.deepEqual(result.resolutions[0].autoSelectedTarget, geo); assert.equal(result.publicationEnabled, false);
  const partial = await f.api.readXAdsGeography("owner", { queries: ["Hauts-de-France"] }, f.dependencies); assert.equal(partial.resolutions[0].autoSelectedTarget, null);
  const mismatch = fixture({ geography: "changed" }); await assert.rejects(mismatch.api.checkXAdsCampaignPreparation("owner", { draft: mismatch.draft }, mismatch.dependencies), /zone/);
});
test("X null post selector checks FULL/composer rights instead of attaching any old post", async () => {
  const f = fixture({ author: "999999999", permissions: ["AD_MANAGER"] }); await assert.rejects(f.api.checkXAdsCampaignPreparation("owner", { draft: f.draft }, f.dependencies), /composition/);
  const good = fixture(); const checked = await good.api.checkXAdsCampaignPreparation("owner", { draft: good.draft }, good.dependencies); assert.equal(checked.preparationReady, true); assert.equal(good.calls.some((call) => call.path === "/tweets"), false);
});
test("X account/currency/role/authenticated-user/token drift fail closed with controlled errors", async () => {
  for (const options of [{ currency: "USD" }, { permissions: ["CAMPAIGN_ANALYST"] }, { wrongUser: true }, { driftAt: 2 }, { endless: true }, { failCode: 403 }]) {
    const f = fixture(options); await assert.rejects(f.api.readXAdsResources("owner", {}, f.dependencies), (error: unknown) => error instanceof ConnectionError && !error.message.includes("fixture-private")); assert.ok(f.calls.every((call) => call.method === "GET"));
  }
  const wrong = fixture(); await assert.rejects(wrong.api.readXAdsResources("owner", { accountId: "other" }, wrong.dependencies)); assert.equal(wrong.calls.length, 0);
});
test("X missing native mapping and budget total are readable blockers and never become a daily budget", async () => {
  const f = fixture(), total = { ...f.draft, preparedDeliverySettings: { ...f.draft.preparedDeliverySettings!, budget: { ...f.draft.preparedDeliverySettings!.budget, type: "total" as const, totalEuros: 1000 } } };
  const result = await f.api.checkXAdsCampaignPreparation("owner", { draft: total }, f.dependencies); assert.equal(result.preparationReady, false); assert.ok(result.blockers.some((message) => message.includes("quotidien"))); assert.equal(total.dailyBudgetEuros, 10); assert.ok(f.calls.every((call) => call.method === "GET"));
});
test("X stored resume can reread an already started calendar while a new creation remains blocked", async () => {
  const f = fixture(), draft = { ...f.draft, preparedDeliverySettings: { ...f.draft.preparedDeliverySettings!, budget: { ...f.draft.preparedDeliverySettings!.budget, startAt: "2026-10-07T07:00:00Z" } } };
  assert.equal((await f.api.checkXAdsCampaignPreparation("owner", { draft }, f.dependencies)).preparationReady, false);
  assert.equal((await f.api.checkXAdsCampaignPreparation("owner", { draft }, { ...f.dependencies, resumed: true })).preparationReady, true);
  assert.ok(f.calls.every((call) => call.method === "GET"));
});
test("X full preparation preserves a long exact URL counted with native weighted text rules", async () => {
  const f = fixture(), link = `https://inrcy.com/${"long-path-".repeat(12)}`, draft = { ...f.draft, primaryText: `${"a".repeat(240)} ${link}`, destinationUrl: link };
  assert.ok(draft.primaryText.length > 280);
  assert.equal((await f.api.checkXAdsCampaignPreparation("owner", { draft }, f.dependencies)).preparationReady, true);
  const missing = await f.api.checkXAdsCampaignPreparation("owner", { draft: { ...draft, trackingParameters: "utm_source=x" } }, f.dependencies);
  assert.equal(missing.preparationReady, false); assert.ok(missing.blockers.some((message) => message.includes("exactement")));
});
test("X disabled bridge stops before owner callbacks, native reads, locks and journal writes", async (t) => {
  const before = process.env.X_ADS_PAUSED_CREATION_ENABLED; delete process.env.X_ADS_PAUSED_CREATION_ENABLED; t.after(() => { if (before === undefined) delete process.env.X_ADS_PAUSED_CREATION_ENABLED; else process.env.X_ADS_PAUSED_CREATION_ENABLED = before; });
  const f = fixture(); let effects = 0;
  await assert.rejects(f.publisher.publishXAdsCampaign("owner", f.draft, async () => { effects++; }, { campaignId, operationKey, assertCampaignOwnership: async () => { effects++; }, withOperationLock: async (_key, action) => { effects++; return action(); }, serverDependencies: f.dependencies }), /native_creation_disabled/);
  assert.equal(effects, 0); assert.equal(f.calls.length, 0);
});
test("X consent rechecks a server-native preparation key before journal or any POST", async (t) => {
  const before = process.env.X_ADS_PAUSED_CREATION_ENABLED; process.env.X_ADS_PAUSED_CREATION_ENABLED = "true"; t.after(() => { if (before === undefined) delete process.env.X_ADS_PAUSED_CREATION_ENABLED; else process.env.X_ADS_PAUSED_CREATION_ENABLED = before; });
  const f = fixture(); let checkpoints = 0;
  await assert.rejects(f.publisher.publishXAdsCampaign("owner", f.draft, async () => { checkpoints++; }, { campaignId, operationKey, expectedPreparationKey: "stale-client-key", assertCampaignOwnership: async () => undefined, withOperationLock: async (_key, action) => action(), serverDependencies: f.dependencies }), /preparation_changed/);
  assert.equal(checkpoints, 0); assert.ok(f.calls.every((call) => call.method === "GET"));
});
test("X server bridge signs only Ads nullcast/PAUSED writes and verifies every native object", async (t) => {
  const before = process.env.X_ADS_PAUSED_CREATION_ENABLED; process.env.X_ADS_PAUSED_CREATION_ENABLED = "true"; t.after(() => { if (before === undefined) delete process.env.X_ADS_PAUSED_CREATION_ENABLED; else process.env.X_ADS_PAUSED_CREATION_ENABLED = before; });
  const f = fixture({ nativeWrites: true }); const journals: core.XAdsPublisherCheckpoint[] = [];
  const prepared = await f.api.checkXAdsCampaignPreparation("owner", { draft: f.draft }, f.dependencies);
  const result = await f.publisher.publishXAdsCampaign("owner", f.draft, async (next) => { journals.push(structuredClone(next)); }, { campaignId, operationKey, expectedPreparationKey: prepared.preparationKey, assertCampaignOwnership: async () => undefined, withOperationLock: async (_key, action) => action(), serverDependencies: f.dependencies });
  assert.equal(result.stage, "paused_verified"); assert.deepEqual(f.calls.filter((call) => call.method === "POST").map((call) => call.path), ["/tweet", "/campaigns", "/line_items", "/targeting_criteria", "/promoted_tweets"]);
  assert.equal(journals.filter((journal) => journal.pendingStep).length, 5); assert.ok(f.calls.every((call) => !call.path.includes("statuses/update"))); assert.ok(f.calls.filter((call) => call.method === "POST").every((call) => call.params.get("entity_status") !== "ACTIVE"));
});
test("X server bridge rechecks grants before each POST and stops if proof changes", async (t) => {
  const before = process.env.X_ADS_PAUSED_CREATION_ENABLED; process.env.X_ADS_PAUSED_CREATION_ENABLED = "true"; t.after(() => { if (before === undefined) delete process.env.X_ADS_PAUSED_CREATION_ENABLED; else process.env.X_ADS_PAUSED_CREATION_ENABLED = before; });
  const f = fixture({ nativeWrites: true, revokeAfterPost: true }); const journals: core.XAdsPublisherCheckpoint[] = [];
  await assert.rejects(f.publisher.publishXAdsCampaign("owner", f.draft, async (next) => { journals.push(structuredClone(next)); }, { campaignId, operationKey, assertCampaignOwnership: async () => undefined, withOperationLock: async (_key, action) => action(), serverDependencies: f.dependencies }), /mutation_outcome_unknown/);
  assert.deepEqual(f.calls.filter((call) => call.method === "POST").map((call) => call.path), ["/tweet"]); assert.equal(journals.at(-1)?.stage, "post_created"); assert.equal(journals.at(-1)?.uncertainStep, "create_campaign");
});
test("X route boundaries protect full draft POST and public projections contain no app grant secret", () => {
  const source = readFileSync(new URL("../app/api/ads/x/preflight/route.ts", import.meta.url), "utf8");
  assert.match(source, /adsRequestOriginAllowed\(request\)/); assert.match(source, /requirePremiumAdsUser\("x"\)/); assert.match(source, /purpose: "draft"/); assert.match(source, /checkXAdsCampaignPreparation/); assert.doesNotMatch(source, /publishXAds|privateCredentials/);
});
