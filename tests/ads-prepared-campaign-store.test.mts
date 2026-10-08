import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import type { AdsCampaignInput } from "../lib/adsValidation.ts";
import type {
  PreparedAdsCampaignRow,
  PreparedAdsCheckpoint,
  PreparedAdsProvider,
  PreparedAdsPublicationDependencies,
  PreparedAdsStoreDependencies,
} from "../lib/adsTikTokCampaignStore.ts";

type StoreApi = typeof import("../lib/adsTikTokCampaignStore.ts");
type CampaignStore = ReturnType<StoreApi["createPreparedAdsCampaignStore"]>;
type CampaignPatch = Parameters<PreparedAdsStoreDependencies["compareAndSet"]>[1];
type DatabaseResult = { data: PreparedAdsCampaignRow | null; error: { code: string; message: string } | null };
type DatabaseQuery = {
  select: () => DatabaseQuery;
  eq: (name: string, value: unknown) => DatabaseQuery;
  update: (value: CampaignPatch) => DatabaseQuery;
  maybeSingle: () => Promise<DatabaseResult>;
};

function record(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function resources(row: PreparedAdsCampaignRow) { return record(row.provider_resources); }
function persistedCheckpoint(row: PreparedAdsCampaignRow) {
  return record(record(resources(row).preparedCampaignCheckpoint).value);
}
async function requiredCheckpoint(store: CampaignStore) {
  const value = await store.loadCheckpoint();
  assert.ok(value);
  return value;
}

function load(supabaseAdmin?: unknown) {
  const source = readFileSync(new URL("../lib/adsTikTokCampaignStore.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Partial<StoreApi> = {};
  vm.runInNewContext(compiled, { exports, structuredClone, Date, require: (name: string) => {
    if (name === "server-only") return {};
    if (name === "node:crypto") return { createHash, randomUUID };
    if (name === "./supabaseAdmin.ts") return { supabaseAdmin: supabaseAdmin || { from: () => { throw new Error("Unexpected real database use"); } } };
    throw new Error("Unexpected dependency: " + name);
  } });
  return exports as StoreApi;
}
const api = load(), id = "12345678-1234-1234-1234-123456789abc", owner = "owner";
function fixture(provider: PreparedAdsProvider = "tiktok") {
  const accountId = provider === "tiktok" ? "123456789" : "abc123";
  const draft: AdsCampaignInput = {
    provider, adAccountId: accountId, accountCurrency: "EUR", name: "Test paused campaign", dailyBudgetEuros: 10,
    creationMode: "manual", campaignType: "generic", objective: "engagement", conversionGoal: "website_visit",
    conversionLocation: "website", bidStrategy: "manual_review", offer: "Test offer", endDate: "2026-10-15",
    destinationUrl: "https://example.test/", urlExpansion: false, urlExclusions: [], targetLocations: ["France"],
    targetAudiences: [], languages: ["fr"], googleSearchPartners: false, googleDisplayExpansion: false,
    metaAudienceExpansion: false, metaPlacements: [], trackingParameters: "", primaryText: "Test campaign",
    imageUrl: "", metaCreativeAssets: { feedImageUrl: "", storyReelImageUrl: "" }, mediaStrategy: "search_text",
    mediaBrief: "", callToAction: "", pageId: "", headlines: [], descriptions: [], keywords: [], negativeKeywords: [],
    noSpecialCategoryConfirmed: false, notEuPoliticalConfirmed: false,
  };
  let row: PreparedAdsCampaignRow = { id, user_id: owner, provider, ad_account_id: "", currency: "EUR", daily_budget_cents: 1000, status: "draft", draft, provider_resources: {}, published_at: null, updated_at: "2026-10-08T12:00:00.000Z" };
  const patches: CampaignPatch[] = [];
  let failWrite = false;
  const deps: PreparedAdsStoreDependencies = {
    readAvailability: async () => true,
    now: () => Date.parse("2026-10-08T12:00:01.000Z"), token: () => "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    readCampaign: async (expectedOwner: string, expectedId: string) => expectedOwner === row.user_id && expectedId === row.id ? structuredClone(row) : null,
    compareAndSet: async (expected, patch) => {
      if (failWrite) { failWrite = false; throw new Error("Simulated lost database acknowledgement"); }
      if (expected.updated_at !== row.updated_at || expected.status !== row.status || expected.user_id !== row.user_id || expected.provider !== row.provider) return null;
      patches.push(structuredClone(patch)); row = { ...row, ...structuredClone(patch) }; return structuredClone(row);
    },
  };
  const store = api.createPreparedAdsCampaignStore({ owner, campaignId: id, provider, accountId, draftSnapshot: draft }, deps);
  const cp = (stage = "prepared", extras: PreparedAdsCheckpoint = {}): PreparedAdsCheckpoint => ({ schemaVersion: 1, operationKey: store.operationKey, [provider === "tiktok" ? "advertiserId" : "accountId"]: accountId, inputKey: "a".repeat(64), targetStatus: provider === "tiktok" ? "DISABLE" : "PAUSED", stage, ...extras });
  return { draft, accountId, deps, store, cp, patches, get: () => row, set: (next: PreparedAdsCampaignRow) => { row = next; }, failNextWrite: () => { failWrite = true; } };
}

test("draft account column remains compatible with the historical planned constraint, only for an editable draft", () => {
  assert.equal(api.preparedAdsStoredAccountMatches({ provider: "tiktok", ad_account_id: "", status: "draft" }, "123456789"), true);
  for (const provider of ["meta", "google", "pinterest", "linkedin", "openai"]) assert.equal(api.preparedAdsStoredAccountMatches({ provider, ad_account_id: "", status: "draft" }, "123456789"), false);
  assert.equal(api.preparedAdsStoredAccountMatches({ provider: "x", ad_account_id: "", status: "needs_review" }, "abc123"), false);
});
test("exact draft fingerprint is stable for object-key order and changes for native selections", () => {
  assert.equal(api.preparedAdsCampaignDraftKey({ a: 1, b: 2 }), api.preparedAdsCampaignDraftKey({ b: 2, a: 1 }));
  assert.notEqual(api.preparedAdsCampaignDraftKey({ locations: ["1", "2"] }), api.preparedAdsCampaignDraftKey({ locations: ["2", "1"] }));
});
for (const provider of ["tiktok", "x"] as const) {
  test(`${provider}: claim and checkpoint persist before the simulated provider mutation; paused result survives reconstruction`, async () => {
    const f = fixture(provider); let calls = 0;
    await f.store.withOperationLock(f.store.operationKey, async () => {
      assert.equal(f.get().status, "publishing"); assert.equal(f.get().ad_account_id, f.accountId);
      await f.store.saveCheckpoint(f.cp("prepared", { pendingStep: "create_campaign" }));
      assert.equal(persistedCheckpoint(f.get()).pendingStep, "create_campaign"); calls++;
      await f.store.saveCheckpoint(f.cp("campaign_created", { campaignId: "555" }));
      await f.store.saveCheckpoint(f.cp("paused_verified", { campaignId: "555", ...(provider === "tiktok" ? { adGroupId: "556", adId: "557" } : { lineItemId: "556", postId: "999", promotedTweetId: "557" }) }));
    });
    assert.equal(calls, 1); assert.equal(f.get().status, "paused"); assert.equal(resources(f.get()).preparedCampaignLock, undefined);
    const resumed = api.createPreparedAdsCampaignStore({ owner, campaignId: id, provider, accountId: f.accountId, draftSnapshot: f.draft }, f.deps);
    assert.equal((await requiredCheckpoint(resumed)).campaignId, "555");
    await resumed.withOperationLock(resumed.operationKey, async () => { await resumed.saveCheckpoint(await requiredCheckpoint(resumed)); });
    assert.equal(calls, 1); assert.equal(f.get().status, "paused");
  });
  test(`${provider}: concurrent process and old publishing claim cannot acquire a second operation`, async () => {
    const f = fixture(provider), other = api.createPreparedAdsCampaignStore({ owner, campaignId: id, provider, accountId: f.accountId, draftSnapshot: f.draft }, f.deps);
    await f.store.withOperationLock(f.store.operationKey, async () => {
      await assert.rejects(other.withOperationLock(other.operationKey, async () => assert.fail("duplicate mutation")), /revérifié/);
      await f.store.saveCheckpoint(f.cp("paused_verified", { campaignId: "555" }));
    });
    f.set({ ...f.get(), status: "publishing", updated_at: "2020-01-01T00:00:00.000Z", provider_resources: { preparedCampaignLock: { token: "old" } } });
    await assert.rejects(other.withOperationLock(other.operationKey, async () => assert.fail("expired mutation replay")), /revérifié/);
    assert.equal(f.get().status, "publishing");
  });
}
test("unknown provider response remains pending/uncertain in needs_review and is never reset to draft", async () => {
  const f = fixture();
  await assert.rejects(f.store.withOperationLock(f.store.operationKey, async () => {
    await f.store.saveCheckpoint(f.cp("prepared", { pendingStep: "create_campaign" }));
    await f.store.saveCheckpoint(f.cp("prepared", { pendingStep: "create_campaign", uncertainStep: "create_campaign" }));
    throw new Error("Unknown provider response");
  }), /Unknown provider response/);
  assert.equal(f.get().status, "needs_review"); assert.equal((await requiredCheckpoint(f.store)).uncertainStep, "create_campaign");
  await assert.rejects(f.store.withOperationLock(f.store.operationKey, async () => f.store.saveCheckpoint(f.cp("paused_verified"))), /revérifié/);
  assert.equal(f.get().status, "needs_review");
});
test("known returned IDs survive a failed checkpoint write and recovery cannot regress progress", async () => {
  const f = fixture();
  await assert.rejects(f.store.withOperationLock(f.store.operationKey, async () => {
    await f.store.saveCheckpoint(f.cp("prepared", { pendingStep: "create_campaign" }));
    f.failNextWrite(); await f.store.saveCheckpoint(f.cp("campaign_created", { campaignId: "555" }));
  }), /lost database acknowledgement/);
  assert.equal(f.get().status, "needs_review"); assert.equal((await requiredCheckpoint(f.store)).campaignId, "555");
});
test("ownership/account/draft change is detected before any checkpoint mutation", async () => {
  for (const change of [{ user_id: "someone_else" }, { ad_account_id: "999999", status: "paused" }, { draft: { changed: true } }, { daily_budget_cents: 2000 }]) {
    const f = fixture(); f.set({ ...f.get(), ...change });
    await assert.rejects(f.store.assertCampaignOwnership(), /revérifié/); assert.equal(f.patches.length, 0);
  }
});
test("null, scalar or array resource journals fail closed instead of being treated as empty drafts", async () => {
  for (const provider_resources of [null, "unknown", [], 1]) {
    const f = fixture(); f.set({ ...f.get(), provider_resources });
    await assert.rejects(f.store.withOperationLock(f.store.operationKey, async () => assert.fail("corrupt journal mutation")), /revérifié/);
    assert.equal(f.patches.length, 0); assert.equal(f.get().status, "draft");
  }
});
test("migration RPC uses only GET and fails closed on absent schema, errors and non-boolean replies", async () => {
  for (const result of [{ data: true, error: null }, { data: false, error: null }, { data: "true", error: null }, { data: true, error: { code: "PGRST202", message: "PRIVATE" } }]) {
    const reader = load({ rpc: async (name: string, args: unknown, options: unknown) => { assert.equal(name, "inrcy_ads_prepared_paused_store_ready"); assert.equal(JSON.stringify(args), "{}"); assert.equal(JSON.stringify(options), '{"get":true}'); return result; } });
    assert.equal(await reader.readPreparedAdsStoreAvailability(), result.data === true && result.error === null);
  }
  assert.equal(await load({ rpc: async () => { throw new Error("PRIVATE database transport"); } }).readPreparedAdsStoreAvailability(), false);
});
test("missing migration blocks publication and claim before even a native reader is called", async () => {
  const f = fixture(); f.deps.readAvailability = async () => false;
  const result = await api.publishStoredPreparedAdsCampaign(owner, f.get(), f.draft, { nativeConsentKey: "a".repeat(64), expectedDraftFingerprint: api.preparedAdsCampaignDraftKey(f.draft) }, { store: f.deps, check: async () => assert.fail("provider read before storage capability"), publish: async () => assert.fail("provider write without migration") });
  assert.equal(result.preparation.ready, false); assert.equal(result.preparation.campaignStoreReady, false);
  assert.ok(Array.isArray(result.preparation.blockers)); assert.ok(result.preparation.blockers.includes("campaign_store_migration_required"));
  await assert.rejects(f.store.withOperationLock(f.store.operationKey, async () => assert.fail("claim without migration")), /revérifié/);
  assert.equal(f.patches.length, 0); assert.equal(f.get().ad_account_id, "");
});
test("availability is cached for one store only and a new request must recheck the schema", async () => {
  const f = fixture(); let reads = 0;
  f.deps.readAvailability = async () => { reads++; return reads === 1; };
  assert.equal(await f.store.isAvailable(), true); assert.equal(await f.store.isAvailable(), true); assert.equal(reads, 1);
  const next = api.createPreparedAdsCampaignStore({ owner, campaignId: id, provider: "tiktok", accountId: f.accountId, draftSnapshot: f.draft }, f.deps);
  assert.equal(await next.isAvailable(), false); assert.equal(reads, 2);
});
test("an intervening atomic draft save invalidates the publication CAS before any provider mutation", async () => {
  const f = fixture(), compare = f.deps.compareAndSet; let raced = false;
  f.deps.compareAndSet = async (expected, patch) => {
    if (!raced && patch.status === "publishing") { raced = true; f.set({ ...f.get(), draft: { ...f.draft, name: "A saved edit won the race" }, updated_at: "2026-10-08T12:00:00.001Z" }); }
    return compare(expected, patch);
  };
  await assert.rejects(f.store.withOperationLock(f.store.operationKey, async () => assert.fail("publish after intervening save")), /revérifié/);
  assert.equal(f.get().status, "draft"); assert.equal(record(f.get().draft).name, "A saved edit won the race"); assert.equal(f.patches.length, 0);
});

function defaultDatabase(mode: "ok" | "error" | "unknown_claim") {
  const f = fixture(), updates: Array<{ filters: [string, unknown][]; patch: CampaignPatch }> = [];
  const database = {
    rpc: async () => ({ data: true, error: null }),
    from: (table: string) => {
      assert.equal(table, "ads_campaigns"); const filters: [string, unknown][] = []; let patch: CampaignPatch | null = null;
      const query: DatabaseQuery = { select: () => query, eq: (name, value) => { filters.push([name, value]); return query; }, update: (value) => { patch = value; return query; }, maybeSingle: async () => {
        if (filters.some(([key, value]) => !Object.entries(f.get()).some(([column, entry]) => column === key && entry === value))) return { data: null, error: null };
        if (patch) {
          updates.push({ filters: structuredClone(filters), patch });
          if (mode === "error") return { data: null, error: { code: "23514", message: "PRIVATE constraint rejected" } };
          f.set({ ...f.get(), ...structuredClone(patch) });
          if (mode === "unknown_claim" && patch.status === "publishing") throw new Error("Lost claim acknowledgement");
        }
        return { data: structuredClone(f.get()), error: null };
      } }; return query;
    },
  };
  const actual = load(database), store = actual.createPreparedAdsCampaignStore({ owner, campaignId: id, provider: "tiktok", accountId: f.accountId, draftSnapshot: f.draft });
  return { f, actual, store, updates };
}
test("actual Supabase adapter CAS filters every write by id, owner, provider, status and exact revision", async () => {
  const h = defaultDatabase("ok");
  await h.store.withOperationLock(h.store.operationKey, async () => h.store.saveCheckpoint(h.f.cp("paused_verified", { campaignId: "555" })));
  assert.equal(h.f.get().status, "paused");
  for (const { filters } of h.updates) {
    for (const pair of [["id", id], ["user_id", owner], ["provider", "tiktok"]]) assert.ok(filters.some((entry) => entry[0] === pair[0] && entry[1] === pair[1]));
    assert.ok(filters.some(([key]) => key === "status")); assert.ok(filters.some(([key]) => key === "updated_at"));
  }
});
test("definitive DB claim failure leaves the draft unchanged and unknown DB success retains a durable lock, both without provider calls", async () => {
  for (const mode of ["error", "unknown_claim"] as const) {
    const h = defaultDatabase(mode); let providerCalls = 0;
    await assert.rejects(h.store.withOperationLock(h.store.operationKey, async () => { providerCalls++; }), /revérifié|Lost claim acknowledgement/);
    assert.equal(providerCalls, 0);
    assert.equal(h.f.get().status, mode === "error" ? "draft" : "publishing");
    assert.equal(h.f.get().ad_account_id, mode === "error" ? "" : h.f.accountId);
    if (mode === "unknown_claim") { assert.ok(resources(h.f.get()).preparedCampaignLock); await assert.rejects(h.store.withOperationLock(h.store.operationKey, async () => assert.fail("claim replay")), /revérifié/); }
  }
});
test("strict checkpoints reject client proof, tokens, URLs and wrong native identity", async () => {
  for (const change of [{ accessToken: "secret" }, { campaignId: "https://host.test?secret=1" }, { advertiserId: "99999" }, { operationKey: "other" }]) {
    const f = fixture(); await assert.rejects(f.store.withOperationLock(f.store.operationKey, async () => f.store.saveCheckpoint(f.cp("prepared", change))), /revérifié/);
    assert.equal(resources(f.get()).campaignId, undefined);
  }
});
test("native IDs and uncertain results are immutable, compensatory checkpoint keeps established IDs", async () => {
  const f = fixture(); await assert.rejects(f.store.withOperationLock(f.store.operationKey, async () => {
    await f.store.saveCheckpoint(f.cp("campaign_created", { campaignId: "555" }));
    await f.store.saveCheckpoint(f.cp("prepared", { pendingStep: "create_adgroup" }));
    assert.equal((await requiredCheckpoint(f.store)).campaignId, "555");
    await f.store.saveCheckpoint(f.cp("campaign_created", { campaignId: "666" }));
  }), /revérifié/);
  assert.equal((await requiredCheckpoint(f.store)).campaignId, "555");
});
test("public preparation and consent exclude transport time and all private proof fields", () => {
  const f = fixture(), preparation = { ready: false, selectedAccountId: f.accountId, resourcesKey: "one", preparationKey: "p", targetStatus: "DISABLE", verifiedAt: "first", nativeEvidence: { token: "secret" } };
  assert.equal(api.publicPreparedAdsPreparation(preparation).nativeEvidence, undefined);
  assert.equal(api.preparedAdsCampaignConsentKey("tiktok", f.get(), preparation), api.preparedAdsCampaignConsentKey("tiktok", f.get(), { ...preparation, verifiedAt: "later" }));
  assert.notEqual(api.preparedAdsCampaignConsentKey("tiktok", f.get(), preparation), api.preparedAdsCampaignConsentKey("tiktok", f.get(), { ...preparation, resourcesKey: "other" }));
});
test("X targeting checkpoints append per-location IDs without rewriting previous native objects", async () => {
  const f = fixture("x");
  await f.store.withOperationLock(f.store.operationKey, async () => {
    await f.store.saveCheckpoint(f.cp("line_item_created", { campaignId: "555", lineItemId: "556", targetingCriteria: [{ locationId: "geo1", id: "target1" }] }));
    await f.store.saveCheckpoint(f.cp("targeting_created", { campaignId: "555", lineItemId: "556", targetingCriteria: [{ id: "target1", locationId: "geo1" }, { locationId: "geo2", id: "target2" }] }));
    await assert.rejects(f.store.saveCheckpoint(f.cp("targeting_created", { targetingCriteria: [{ locationId: "geo1", id: "replacement" }, { locationId: "geo2", id: "target2" }] })), /revérifié/);
    await f.store.saveCheckpoint(f.cp("paused_verified"));
  });
  const targets = (await requiredCheckpoint(f.store)).targetingCriteria;
  assert.ok(Array.isArray(targets)); assert.equal(targets.length, 2);
});
test("readback projection never exposes full X checkpoint hashes/operation journal", () => {
  const projected = api.publicPreparedAdsReadback({ schemaVersion: 1, inputKey: "PRIVATE", operationKey: "PRIVATE", targetStatus: "PAUSED", stage: "paused_verified", campaignId: "555" });
  assert.equal(projected.confirmed, true); assert.equal(projected.inputKey, undefined); assert.equal(projected.operationKey, undefined);
  assert.equal(api.publicPreparedAdsReadback({ stage: "paused_verified", pendingStep: "create_campaign" }).confirmed, false);
  assert.equal(api.publicPreparedAdsReadback({ stage: "paused_verified", confirmed: false }).confirmed, false);
});
test("forward migration enables durable suspended TT/X states without granting active delivery or changing existing connectors", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261008181421_ads_prepared_native_paused_store.sql", import.meta.url), "utf8").replace(/--[^\r\n]*/g, "");
  assert.match(sql, /provider = any \(array\['meta'::text, 'google'::text, 'pinterest'::text, 'linkedin'::text, 'openai'::text\]\)/);
  assert.match(sql, /status = 'draft' and ad_account_id = ''/);
  assert.match(sql, /status in \('draft', 'publishing', 'paused', 'needs_review'\)/);
  assert.match(sql, /draft ->> 'adAccountId'\) is not distinct from ad_account_id/);
  assert.doesNotMatch(sql, /'active'|'demo_paused'|security definer|disable row level security/i);
  assert.match(sql, /security invoker[\s\S]+set search_path = ''/i);
  assert.match(sql, /pg_catalog\.pg_get_constraintdef\(c\.oid\) = %L/);
  assert.match(sql, /revoke all on function public\.inrcy_ads_prepared_paused_store_ready\(\)[\s\S]+from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.inrcy_ads_prepared_paused_store_ready\(\)[\s\S]+to service_role/);
  assert.doesNotMatch(sql, /grant[\s\S]*to (?:public|anon|authenticated)/i);
  assert.match(sql, /begin;[\s\S]+commit;/);
});
test("pending or uncertain journals override otherwise-ready native preflight and cannot acquire a claim", () => {
  for (const progress of [{ pendingStep: "create_campaign" }, { uncertainStep: "create_campaign" }]) {
    const projected = api.preparedAdsPreparationForCheckpoint({ ready: true, blockers: [] }, progress);
    assert.equal(projected.ready, false); assert.ok(Array.isArray(projected.blockers)); assert.ok(projected.blockers.includes("creation_result_uncertain"));
  }
});
test("closed native preparation never claims or calls a publisher", async () => {
  const f = fixture(), preparation = { ready: false, selectedAccountId: f.accountId, targetStatus: "DISABLE", preparationKey: "b".repeat(64), blockers: ["native_capabilities_unverified"] };
  const result = await api.publishStoredPreparedAdsCampaign(owner, f.get(), f.draft, { nativeConsentKey: api.preparedAdsCampaignConsentKey("tiktok", f.get(), preparation), expectedDraftFingerprint: api.preparedAdsCampaignDraftKey(f.draft) }, { store: f.deps, check: async () => preparation, publish: async () => assert.fail("Publisher called without native proof") });
  assert.equal(result.campaign, null); assert.equal(f.patches.length, 0); assert.equal(f.get().status, "draft");
});
test("changed native consent or a changed saved draft blocks before a durable claim", async () => {
  const f = fixture(), preparation = { ready: true, selectedAccountId: f.accountId, resourcesKey: "first", targetStatus: "DISABLE", preparationKey: "b".repeat(64) };
  const approval = { nativeConsentKey: api.preparedAdsCampaignConsentKey("tiktok", f.get(), preparation), expectedDraftFingerprint: api.preparedAdsCampaignDraftKey(f.draft) };
  await assert.rejects(api.publishStoredPreparedAdsCampaign(owner, f.get(), f.draft, approval, { store: f.deps, check: async () => ({ ...preparation, resourcesKey: "changed" }), publish: async () => assert.fail("stale consent mutation") }), /revérifié/);
  assert.equal(f.patches.length, 0);
  const stale = structuredClone(f.get()); f.set({ ...f.get(), draft: { ...f.draft, name: "Changed in another tab" } });
  await assert.rejects(api.publishStoredPreparedAdsCampaign(owner, stale, f.draft, approval, { store: f.deps, check: async () => preparation }), /revérifié/);
  assert.equal(f.patches.length, 0);
});
test("approved stored draft -> fresh preflight -> durable paused graph returns only after confirmed paused persistence", async () => {
  const f = fixture("x"), preparation = { ready: true, selectedAccountId: f.accountId, resourcesKey: "first", targetStatus: "PAUSED", preparationKey: "b".repeat(64) };
  let calls = 0;
  const result = await api.publishStoredPreparedAdsCampaign(owner, f.get(), f.draft, { nativeConsentKey: api.preparedAdsCampaignConsentKey("x", f.get(), preparation), expectedDraftFingerprint: api.preparedAdsCampaignDraftKey(f.draft) }, {
    store: f.deps, check: async () => preparation,
    publish: (async (_owner, _draft, persist, options) => {
      assert.equal(_owner, owner); assert.equal(_draft, f.draft);
      assert.equal(options.expectedPreparationKey, preparation.preparationKey);
      await options.withOperationLock(options.operationKey, async () => {
        await options.assertCampaignOwnership(); await persist(f.cp("prepared", { pendingStep: "create_post" })); calls++;
        await persist(f.cp("post_created", { postId: "12345" }));
        await persist(f.cp("paused_verified", { postId: "12345", campaignId: "abc", lineItemId: "def", promotedTweetId: "xyz" }));
      });
    }) satisfies NonNullable<PreparedAdsPublicationDependencies["publish"]>,
  });
  assert.ok(result.campaign); assert.equal(result.campaign.status, "paused"); assert.equal(calls, 1); assert.equal(resources(result.campaign).postId, "12345");
});
