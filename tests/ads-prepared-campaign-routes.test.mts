/* Runtime fixtures simulate native proofs; they never assert real provider access. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import ts from "typescript";

const id = "12345678-1234-1234-1234-123456789abc", owner = "owner";
function compile(file: string, modules: Record<string, unknown>) {
  const exports: any = {}, source = readFileSync(new URL(file, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function("exports", "require", code)(exports, (name: string) => {
    if (Object.hasOwn(modules, name)) return modules[name];
    if (name.startsWith("@/lib/")) return new Proxy({}, { get: (_object, property) => { if (property === "__esModule") return true; return function unexpectedFiveProviderCall() { throw new Error("Unexpected connector call: " + name + ":" + String(property)); }; } });
    throw new Error("Unexpected module: " + name);
  });
  return exports;
}
type Options = { provider?: "tiktok" | "x"; ready?: boolean; ownerChanged?: boolean; allowed?: boolean; denied?: boolean; origin?: boolean; limited?: boolean; missing?: boolean; migrationMissing?: boolean };
function runtime(options: Options = {}) {
  const provider = options.provider || "tiktok", accountId = provider === "tiktok" ? "123456789" : "abc123";
  const draft = { provider, name: "Paused test campaign", adAccountId: accountId, accountCurrency: "EUR", dailyBudgetEuros: 10, endDate: "2026-11-08", targetLocations: ["Hauts-de-France"], ...(provider === "tiktok" ? { tiktokNativeSelections: { advertiserId: accountId } } : { xNativeSelections: { accountId } }) };
  let row: any = { id, user_id: options.ownerChanged ? "foreign" : owner, provider, ad_account_id: "", currency: "EUR", daily_budget_cents: 1000, status: "draft", draft, provider_resources: {}, published_at: null, updated_at: "2026-10-08T12:00:00.000Z" };
  const events: string[] = []; let mutations = 0;
  const deps = {
    readAvailability: async () => !options.migrationMissing,
    now: () => Date.parse("2026-10-08T12:00:01Z"), token: () => "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    readCampaign: async (expectedOwner: string, expectedId: string) => expectedOwner === row.user_id && expectedId === row.id ? structuredClone(row) : null,
    compareAndSet: async (expected: any, patch: any) => { if (expected.status !== row.status || expected.updated_at !== row.updated_at || expected.user_id !== row.user_id) return null; events.push("cas:" + (patch.status || "checkpoint")); row = { ...row, ...structuredClone(patch) }; return structuredClone(row); },
  };
  const storeApi = compile("../lib/adsTikTokCampaignStore.ts", { "server-only": {}, "node:crypto": { createHash, randomUUID }, "./supabaseAdmin.ts": { supabaseAdmin: { from: () => { throw new Error("Real database unavailable in fixture"); } } } });
  let preparation: any = { ready: options.ready === true, targetStatus: provider === "tiktok" ? "DISABLE" : "PAUSED", selectedAccountId: accountId, verifiedLocationCount: 1, resourcesKey: "verified-resources", preparationKey: "b".repeat(64), blockers: options.ready ? [] : ["native_capabilities_unverified"] };
  const check = async (_owner: string, _draft: unknown) => { events.push("native:get"); return structuredClone(preparation); };
  const publish = async (_owner: string, _draft: unknown, persist: any, operation: any) => {
    events.push("bridge"); assert.equal(operation.expectedPreparationKey, preparation.preparationKey);
    await operation.withOperationLock(operation.operationKey, async () => {
      const base = { schemaVersion: 1, operationKey: operation.operationKey, [provider === "tiktok" ? "advertiserId" : "accountId"]: accountId, inputKey: "c".repeat(64), targetStatus: preparation.targetStatus };
      if (!operation.initialProgress) {
        await persist({ ...base, stage: "prepared", pendingStep: "create_campaign" });
        assert.equal(row.provider_resources.preparedCampaignCheckpoint.value.pendingStep, "create_campaign"); events.push("simulated-provider:post"); mutations++;
      }
      await persist({ ...base, stage: "paused_verified", campaignId: "555", ...(provider === "tiktok" ? { adGroupId: "556", adId: "557" } : { postId: "12345", lineItemId: "556", promotedTweetId: "557" }) });
    });
  };
  const helpers = { ...storeApi, createPreparedAdsCampaignStore: (input: any) => storeApi.createPreparedAdsCampaignStore(input, deps), publishStoredPreparedAdsCampaign: (user: string, stored: unknown, parsed: unknown, approval: unknown) => storeApi.publishStoredPreparedAdsCampaign(user, stored, parsed, approval, { store: deps, check, publish }) };
  const query: any = {
    select: () => query, eq: (column: string, value: unknown) => { events.push(`eq:${column}:${value}`); return query; },
    maybeSingle: async () => ({ data: options.missing ? null : structuredClone(row), error: null }),
    insert: (payload: any) => { events.push("save:insert"); row = { ...row, ...structuredClone(payload) }; return query; },
    single: async () => ({ data: { id, status: "draft" }, error: null }),
  };
  const publicResources = compile("../lib/adsProviderResources.ts", {});
  const modules: Record<string, unknown> = {
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/adsServer": {
      requirePremiumAdsUser: async () => options.denied ? { user: null, errorResponse: Response.json({}, { status: 403 }) } : { user: { activeUserId: owner, authUserId: "auth" } },
      adsRequestOriginAllowed: () => options.origin !== false, adsBadOriginResponse: () => Response.json({}, { status: 403 }),
      isAdsChannelUserAllowed: async () => options.allowed !== false, adsPilotOnlyResponse: () => Response.json({}, { status: 403 }),
    },
    "@/lib/rateLimit": { enforceRateLimit: async () => options.limited ? Response.json({}, { status: 429 }) : null },
    "@/lib/supabaseAdmin": { supabaseAdmin: { from: () => query, rpc: () => { throw new Error("Unexpected generic five-provider claim"); } } },
    "@/lib/adsValidation": { parseAdsCampaignInput: (value: unknown, parseOptions: { purpose: string }) => { events.push("parse:" + parseOptions.purpose); return { draft: value, error: null }; }, isAdsProvider: (value: string) => value === "meta" || value === "google", isAdsChannelId: () => true },
    "@/lib/adsPublishMode": { parseAdsPublishMode: (value: unknown) => value || "live", hasAdsPublishConfirmation: (mode: string, value: unknown) => value === (mode === "paused" ? "CREER_CAMPAGNE_EN_PAUSE" : mode === "demo_paused" ? "CREER_DEMO_EN_PAUSE" : "PUBLIER_ET_DEPENSER"), isAdsChannelPublishEnabled: () => { throw new Error("Unexpected generic publish flag"); } },
    "@/lib/adsProviderResources": publicResources,
    "@/lib/adsTikTokCampaignStore": helpers,
    "@/lib/adsTikTokCampaignPreparationServer": { checkTikTokAdsCampaignPreparation: check },
    "@/lib/adsXResourcesServer": { checkXAdsCampaignPreparation: check },
    "@/lib/adsTikTokPublisherServer": { readTikTokAdsPausedCampaign: async () => { events.push("readback:get"); return { confirmed: true, targetStatus: "DISABLE", campaignId: "555", statuses: { campaign: "DISABLE", adGroup: "DISABLE", ad: "DISABLE" } }; } },
    "@/lib/adsXPublisherServer": { readbackStoredXAdsCampaign: async () => { events.push("readback:get"); return { schemaVersion: 1, operationKey: "PRIVATE", inputKey: "PRIVATE_HASH", targetStatus: "PAUSED", stage: "paused_verified", campaignId: "555", lineItemId: "556" }; } },
    "../trackingPolicy": { ADS_CAMPAIGN_ID_PATTERN: /^[0-9a-f-]{36}$/ },
    "./[id]/trackingPolicy": { ADS_CAMPAIGN_ID_PATTERN: /^[0-9a-f-]{36}$/, canMutateAdsDraft: () => true },
    "@/lib/observability/logger": { log: { warn: () => {} } },
  };
  const preflight = compile("../app/api/ads/campaigns/[id]/preflight/route.ts", modules), publication = compile("../app/api/ads/campaigns/[id]/publish/route.ts", modules), lifecycle = compile("../app/api/ads/campaigns/[id]/lifecycle/route.ts", modules), save = compile("../app/api/ads/campaigns/route.ts", modules);
  const context = { params: Promise.resolve({ id }) }, url = `https://app.test/api/ads/campaigns/${id}`;
  const get = () => preflight.GET(new Request(url + "/preflight?mode=paused"), context);
  const post = (body: Record<string, unknown>) => publication.POST(new Request(url + "/publish", { method: "POST", body: JSON.stringify(body) }), context);
  return { draft, events, get, post, helpers, mutations: () => mutations, row: () => row, change: (patch: any) => { row = { ...row, ...patch }; }, preparation: (next: any) => { preparation = next; },
    save: () => save.POST(new Request("https://app.test/api/ads/campaigns", { method: "POST", body: JSON.stringify(draft) })),
    lifecycle: (action: string, method = "PATCH") => lifecycle[method](new Request(url + "/lifecycle", { method, body: method === "PATCH" ? JSON.stringify({ action }) : undefined }), context) };
}
for (const provider of ["tiktok", "x"] as const) {
  test(`${provider}: local save keeps native selections and advertiser only in JSON until forward migration`, async () => {
    const h = runtime({ provider }); assert.equal((await h.save()).status, 200); assert.equal(h.row().ad_account_id, "");
    assert.equal(h.row().draft.adAccountId, h.draft.adAccountId); assert.ok(h.row().draft[provider === "tiktok" ? "tiktokNativeSelections" : "xNativeSelections"]);
    assert.equal(h.events.includes("native:get"), false); assert.equal(h.mutations(), 0);
  });
  test(`${provider}: saved preflight exposes server-bound consent; unknown native proof creates nothing`, async () => {
    const h = runtime({ provider }); const response = await h.get(); assert.equal(response.status, 200); const checked = await response.json();
    assert.equal(checked.ready, false); assert.equal(checked.publicationEnabled, false); assert.equal(checked.selectedAccountId, h.draft.adAccountId);
    assert.match(checked.consentKey, /^[0-9a-f]{64}$/); assert.match(checked.draftFingerprint, /^[0-9a-f]{64}$/); assert.equal(checked.updatedAt, h.row().updated_at);
    assert.equal((await h.post({ mode: "paused", confirmation: "CREER_CAMPAGNE_EN_PAUSE", nativeConsentKey: checked.consentKey, expectedDraftFingerprint: checked.draftFingerprint, nativeEvidence: { forged: true } })).status, 423);
    assert.equal(h.row().status, "draft"); assert.equal(h.mutations(), 0); assert.ok(h.events.includes("eq:user_id:" + owner));
  });
  test(`${provider}: simulated verified draft -> preflight -> paused creation -> persisted tracking and repeat readback`, async () => {
    const h = runtime({ provider, ready: true }), checked = await (await h.get()).json();
    const response = await h.post({ mode: "paused", confirmation: "CREER_CAMPAGNE_EN_PAUSE", nativeConsentKey: checked.consentKey, expectedDraftFingerprint: checked.draftFingerprint });
    assert.equal(response.status, 200); const result = await response.json(); assert.equal(result.campaign.status, "paused"); assert.equal(result.publicationEnabled, false);
    assert.equal(result.campaign.provider_resources.campaignId, "555"); assert.equal(result.campaign.provider_resources.preparedCampaignCheckpoint, undefined); assert.equal(result.campaign.provider_resources.preparedCampaignLock, undefined); assert.equal(h.mutations(), 1);
    const read = await h.lifecycle("reconcile"); assert.equal(read.status, 200); const projection = await read.json(); assert.equal(projection.readOnly, true); assert.equal(projection.nativeReadback.confirmed, true); assert.doesNotMatch(JSON.stringify(projection), /PRIVATE_HASH|PRIVATE|inputKey|preparedCampaignCheckpoint|preparedCampaignLock/);
    const retry = await (await h.get()).json(); assert.equal((await h.post({ mode: "paused", confirmation: "CREER_CAMPAGNE_EN_PAUSE", nativeConsentKey: retry.consentKey, expectedDraftFingerprint: retry.draftFingerprint })).status, 200); assert.equal(h.mutations(), 1);
  });
  test(`${provider}: no active launch, no incomplete consent and no remote mutation/delete lifecycle`, async () => {
    const h = runtime({ provider, ready: true });
    for (const mode of ["live", "demo_paused"]) assert.equal((await h.post({ mode, confirmation: mode === "live" ? "PUBLIER_ET_DEPENSER" : "CREER_DEMO_EN_PAUSE" })).status, 423);
    assert.equal((await h.post({ mode: "paused", confirmation: "CREER_CAMPAGNE_EN_PAUSE" })).status, 400);
    for (const action of ["resume", "pause", "update", "archive"]) assert.equal((await h.lifecycle(action)).status, 423);
    assert.equal((await h.lifecycle("delete", "DELETE")).status, 423); assert.equal(h.mutations(), 0);
  });
}
test("native goals/account or saved draft changes revoke approval before claim", async () => {
  for (const change of ["resources", "draft"]) {
    const h = runtime({ ready: true }), checked = await (await h.get()).json();
    if (change === "draft") h.change({ draft: { ...h.draft, name: "Other text" } });
    else h.preparation({ ready: true, targetStatus: "DISABLE", selectedAccountId: h.draft.adAccountId, verifiedLocationCount: 1, resourcesKey: "different", preparationKey: "b".repeat(64), blockers: [] });
    assert.equal((await h.post({ mode: "paused", confirmation: "CREER_CAMPAGNE_EN_PAUSE", nativeConsentKey: checked.consentKey, expectedDraftFingerprint: checked.draftFingerprint })).status, 409); assert.equal(h.mutations(), 0); assert.equal(h.row().status, "draft");
  }
});
test("route authorization, pilot, rate limit and ownership protect planned preflight without native reads", async () => {
  for (const [options, expected] of [[{ denied: true }, 403], [{ origin: false }, 403], [{ allowed: false }, 403], [{ limited: true }, 429], [{ ownerChanged: true }, 404], [{ missing: true }, 404]] as const) {
    const h = runtime(options); assert.equal((await h.get()).status, expected); assert.equal(h.events.includes("native:get"), false);
  }
});
test("interrupted publishing claim is neither expired nor reset by preflight/lifecycle", async () => {
  const h = runtime(); h.change({ status: "publishing", ad_account_id: h.draft.adAccountId, updated_at: "2020-01-01T00:00:00Z", provider_resources: { preparedCampaignLock: { token: "PRIVATE" } } });
  assert.equal((await h.get()).status, 409); assert.equal((await h.lifecycle("reconcile")).status, 409); assert.equal(h.row().status, "publishing"); assert.equal(h.mutations(), 0);
});

test("an otherwise-ready native preflight stays blocked when durable provider result is uncertain", async () => {
  const h = runtime({ ready: true }), draftFingerprint = h.helpers.preparedAdsCampaignDraftKey(h.draft);
  h.change({ status: "needs_review", ad_account_id: h.draft.adAccountId, provider_resources: {
    preparationStage: "prepared", preparedCampaignCheckpoint: { provider: "tiktok", draftKey: draftFingerprint, value: {
      schemaVersion: 1, operationKey: h.helpers.preparedAdsOperationKey("tiktok", id), advertiserId: h.draft.adAccountId,
      inputKey: "c".repeat(64), targetStatus: "DISABLE", stage: "prepared", pendingStep: "create_campaign", uncertainStep: "create_campaign",
    } },
  } });
  const checked = await (await h.get()).json(); assert.equal(checked.ready, false); assert.ok(checked.blockers.includes("creation_result_uncertain"));
  assert.equal((await h.post({ mode: "paused", confirmation: "CREER_CAMPAGNE_EN_PAUSE", nativeConsentKey: checked.consentKey, expectedDraftFingerprint: checked.draftFingerprint })).status, 423);
  assert.equal(h.mutations(), 0); assert.equal(h.row().status, "needs_review"); assert.equal(h.events.some((event) => event.startsWith("cas:")), false);
});

test("saved preflight and publish reject absent migration before any native API call", async () => {
  for (const provider of ["tiktok", "x"] as const) {
    const h = runtime({ provider, ready: true, migrationMissing: true });
    const checked = await (await h.get()).json(); assert.equal(checked.ready, false); assert.equal(checked.campaignStoreReady, false); assert.ok(checked.blockers.includes("campaign_store_migration_required"));
    assert.match(checked.consentKey, /^[0-9a-f]{64}$/); assert.equal(checked.preparationKey, "");
    const response = await h.post({ mode: "paused", confirmation: "CREER_CAMPAGNE_EN_PAUSE", nativeConsentKey: checked.consentKey, expectedDraftFingerprint: checked.draftFingerprint });
    assert.equal(response.status, 423); assert.equal(h.events.includes("native:get"), false); assert.equal(h.mutations(), 0); assert.equal(h.row().status, "draft");
  }
});
