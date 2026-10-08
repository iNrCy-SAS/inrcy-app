import assert from "node:assert/strict";
import test from "node:test";
import * as core from "../lib/adsXPublisherCore.ts";
import * as resources from "../lib/adsXResources.ts";
const now = Date.parse("2026-10-08T10:00:00Z"), operationKey = "inrcy_x_mock_operation";
const geo: resources.XAdsGeoTarget = { id: "abc123geoid", name: "Hauts-de-France, France", countryCode: "FR", locationType: "REGIONS" };
function nativeFixture(existing = false) {
  const input: core.XAdsPublisherInput = { accountId: "18ce54d4x5t", name: "Essai indépendant", lineItemName: "Essai indépendant", postText: "Vos publications simplifiées", fundingInstrumentId: "fund123", promotableUserId: "prom123", promotableUserUserId: "1234567890123456789", postId: existing ? "1987654321098765432" : null, geoTargets: [geo], dailyBudgetEuros: 10, bidEuros: 1.25, startAt: "2026-10-09T07:00:00Z", endAt: "2026-10-14T21:59:00Z" };
  const evidence: core.XAdsPublisherEvidence = { accountId: input.accountId, currency: "EUR", timeZone: "Europe/Paris", accepted: true, canManageCampaigns: true, billingReady: true,
    funding: { id: input.fundingInstrumentId, currency: "EUR", ableToFund: true, deleted: false, cancelled: false }, user: { id: input.promotableUserId, userId: input.promotableUserUserId, type: "FULL" },
    post: existing ? { id: input.postId!, userId: input.promotableUserUserId, text: input.postText } : null, canCreatePost: true, geoTargets: [geo], standardAccess: "verified", tokenRegeneratedAfterApproval: "verified", nativeWriteAccess: "verified", checkedAt: new Date(now).toISOString(), validUntil: new Date(now + 300_000).toISOString() };
  return { input, evidence };
}
function runtime(options: { existing?: boolean; fail?: string; mismatch?: string; ownerFail?: boolean } = {}) {
  const fixture = nativeFixture(options.existing), calls: Array<{ method: string; path: string; body: Record<string, string> }> = [], journal: core.XAdsPublisherCheckpoint[] = [];
  let saved: core.XAdsPublisherCheckpoint | null = null, clock = now;
  const bodies = core.prepareXAdsNativeBodies(fixture.input), postId = fixture.input.postId || "1987654321098765432";
  const post = () => ({ id_str: postId, user: { id_str: fixture.input.promotableUserUserId }, full_text: fixture.input.postText, nullcast: true, tweet_type: "PUBLISHED", truncated: false, entities: { urls: [] } });
  const deps: core.XAdsPublisherDependencies = { now: () => clock, assertOwnership: async () => { if (options.ownerFail) throw new Error("owner_changed"); },
    withOperationLock: async (key, action) => { assert.equal(key, operationKey); return action(); }, loadCheckpoint: async () => saved,
    saveCheckpoint: async (next) => { saved = structuredClone(next); journal.push(structuredClone(next)); },
    request: async (method, path, params) => {
      const body = Object.fromEntries(params), leaf = path.split("/").slice(2).join("/"); calls.push({ method, path: leaf, body });
      assert.ok(path.startsWith(`accounts/${fixture.input.accountId}/`));
      if (method === "POST") { assert.ok(saved?.pendingStep, "durable pending marker precedes every mutation"); if (options.fail === leaf) throw new Error("simulated_timeout"); }
      if (leaf === "tweet") { assert.equal(method, "POST"); assert.equal(body.nullcast, "true"); assert.equal(body.as_user_id, fixture.input.promotableUserUserId); return { data: { ...post(), ...(options.mismatch === "organic" ? { nullcast: false } : {}) } }; }
      if (leaf === "tweets") { assert.equal(body.timeline_type, "ALL"); return { data: [{ ...post(), ...(options.mismatch === "post" ? { full_text: "Texte changé" } : {}) }] }; }
      if (leaf === "campaigns") { assert.equal(body.entity_status, "PAUSED"); return { data: { id: "camp123" } }; }
      if (leaf === "campaigns/camp123") return { data: { ...bodies.campaign, id: "camp123", deleted: false, currency: "EUR", ...(options.mismatch === "campaign" ? { entity_status: "ACTIVE" } : {}) } };
      if (leaf === "line_items") { assert.equal(body.entity_status, "PAUSED"); assert.equal(body.campaign_id, "camp123"); return { data: { id: "line123" } }; }
      if (leaf === "line_items/line123") return { data: { ...bodies.lineItem, placements: ["ALL_ON_TWITTER"], id: "line123", campaign_id: options.mismatch === "parent" ? "wrong" : "camp123", deleted: false, ...(options.mismatch === "budget" ? { daily_budget_amount_local_micro: 99 } : {}) } };
      if (leaf === "targeting_criteria") { assert.equal(body.operator_type, "EQ"); return { data: { id: "geo123", line_item_id: "line123", targeting_type: "LOCATION", targeting_value: geo.id } }; }
      if (leaf === "targeting_criteria/geo123") return { data: { id: "geo123", line_item_id: "line123", deleted: false, targeting_type: "LOCATION", targeting_value: options.mismatch === "geography" ? "wrong" : geo.id } };
      if (leaf === "promoted_tweets") return { data: [{ id: "promoted123", line_item_id: "line123", tweet_id: postId }] };
      if (leaf === "promoted_tweets/promoted123") return { data: { id: "promoted123", line_item_id: "line123", tweet_id: options.mismatch === "promoted" ? "111111" : postId, deleted: false, entity_status: "ACTIVE" } };
      throw new Error("Unexpected native endpoint " + leaf);
    } };
  return { ...fixture, deps, calls, journal, get saved() { return saved; }, set saved(value: core.XAdsPublisherCheckpoint | null) { saved = value; }, set clock(value: number) { clock = value; } };
}
test("X paid switches do not open the dedicated paused gate", () => {
  assert.equal(core.xAdsPausedCreationEnabled({}), false);
  for (const value of ["TRUE", "1", "yes", "false"]) assert.equal(core.xAdsPausedCreationEnabled({ X_ADS_PAUSED_CREATION_ENABLED: value }), false);
  assert.equal(core.xAdsPausedCreationEnabled({ INRCY_ADS_LIVE_PUBLISH_ENABLED: "true", INRCY_LINKEDIN_ADS_PUBLISH_ENABLED: "true" }), false);
  assert.equal(core.xAdsPausedCreationEnabled({ X_ADS_PAUSED_CREATION_ENABLED: "true" }), true);
});
test("X native selectors preserve incomplete drafts and reject foreign proof fields, coercion and duplicate IDs", () => {
  const value = { schemaVersion: 1, accountId: "18ce54d4x5t", context: { objective: "ENGAGEMENTS", format: "text", targetingMode: "broad", placements: "ALL_ON_TWITTER" }, fundingInstrumentId: null, promotableUserId: null, postId: null, geoTargets: [] };
  assert.deepEqual(resources.normalizeXAdsNativeSelections(value).selections, value);
  for (const bad of [{ ...value, token: "client" }, { ...value, postId: 1987654321098765400 }, { ...value, geoTargets: [geo, geo] }, { ...value, accountId: "../other" }, { ...value, context: { ...value.context, objective: "WEBSITE_CLICKS" } }]) assert.ok(resources.normalizeXAdsNativeSelections(bad).error);
});
test("X source parsers keep IDs as strings and admit only FULL published text posts", () => {
  const users = resources.parseXAdsPromotableUsers([{ id: "prom1", user_id: "1987654321098765432", promotable_user_type: "FULL", deleted: false }]);
  const post = { id_str: "1987654321098765433", user: { id_str: users[0].userId }, full_text: "Texte", tweet_type: "PUBLISHED", truncated: false };
  assert.equal(resources.parseXAdsPromotablePosts([post], users).length, 1);
  for (const changed of [{ ...post, id_str: 1987654321098765400 }, { ...post, user: { id_str: "111" } }, { ...post, truncated: true }, { ...post, tweet_type: "DRAFT" }, { ...post, extended_entities: { media: [{}] } }, { ...post, card_uri: "card://x" }]) assert.equal(resources.parseXAdsPromotablePosts([changed], users).length, 0);
});
test("X shortened native links are reconstructed only from exact provider URL entities", () => {
  const raw = "Découvrir https://t.co/abc123", start = raw.indexOf("https://");
  const entity = { url: "https://t.co/abc123", expanded_url: "https://inrcy.com/?utm_source=x", indices: [start, raw.length] };
  assert.equal(resources.xAdsNativePostText({ full_text: raw, entities: { urls: [entity] } }), "Découvrir https://inrcy.com/?utm_source=x");
  assert.equal(resources.xAdsNativePostText({ full_text: raw, entities: { urls: [{ ...entity, indices: [0, raw.length] }] } }), null);
  assert.equal(resources.xAdsNativePostText({ full_text: raw, entities: { urls: [entity, entity] } }), null);
});
test("X destination is accepted only as the exact normalized tracked link in the published text", () => {
  const final = "https://inrcy.com/?utm_source=x&utm_campaign=essai";
  assert.equal(resources.xAdsPostIncludesDestination(`Découvrez iNrCy\n${final}`, "https://inrcy.com", "utm_source=x&utm_campaign=essai"), true);
  for (const [text, destination, tracking] of [
    ["Découvrez iNrCy https://inrcy.com/", "https://inrcy.com/", "utm_source=x"],
    [`Découvrez iNrCy ${final}.`, "https://inrcy.com/", "utm_source=x&utm_campaign=essai"],
    [`Découvrez iNrCy ${final}evil`, "https://inrcy.com/", "utm_source=x&utm_campaign=essai"],
    [final, "http://inrcy.com/", ""],
    [final, "https://inrcy.com/", "utm_source=x&utm_source=y"],
    [final, "", "utm_source=x"],
  ]) assert.equal(resources.xAdsPostIncludesDestination(text, destination, tracking), false);
  const { input, evidence } = nativeFixture();
  input.postText = `${"a".repeat(240)} https://inrcy.com/${"long-path-".repeat(12)}`;
  assert.ok(input.postText.length > 280);
  assert.doesNotThrow(() => core.validateXAdsPublisherInput(input, evidence, now));
  input.postText = "a".repeat(281); assert.throws(() => core.validateXAdsPublisherInput(input, evidence, now), /post_text_invalid/);
});
test("X complete mock creates a nullcast post first then paused parents and exact native geometry", async () => {
  const fixture = runtime(), result = await core.runXAdsPausedCampaign(fixture.input, fixture.evidence, operationKey, fixture.deps);
  assert.equal(result.stage, "paused_verified"); assert.equal(result.postId, "1987654321098765432");
  const posts = fixture.calls.filter((call) => call.method === "POST");
  assert.deepEqual(posts.map((call) => call.path), ["tweet", "campaigns", "line_items", "targeting_criteria", "promoted_tweets"]);
  assert.equal(posts[1].body.daily_budget_amount_local_micro, "10000000"); assert.equal(posts[2].body.bid_amount_local_micro, "1250000");
  assert.equal(Date.parse(posts[2].body.start_time), Date.parse(fixture.input.startAt)); assert.equal(Date.parse(posts[2].body.end_time), Date.parse(fixture.input.endAt));
  assert.equal(posts[2].body.bid_strategy, "MAX"); assert.equal(posts[3].body.targeting_value, geo.id);
  assert.equal(posts[4].body.tweet_ids, result.postId);
  assert.ok(fixture.calls.some((call) => call.method === "GET" && call.path === "tweets" && fixture.calls.indexOf(call) < fixture.calls.indexOf(posts[1])));
  assert.ok(fixture.journal.some((point) => point.pendingStep === "create_post" && !point.postId));
  assert.doesNotMatch(JSON.stringify(result), /oauth|token|secret|https|postText/);
});
test("X existing verified text post is reused without creating a second post", async () => {
  const fixture = runtime({ existing: true }); await core.runXAdsPausedCampaign(fixture.input, fixture.evidence, operationKey, fixture.deps);
  assert.equal(fixture.calls.filter((call) => call.method === "POST" && call.path === "tweet").length, 0);
});
test("X missing grants, wrong account, funding, identity and calendar fail before every mutation", async () => {
  for (const patch of [{ standardAccess: "unverified" }, { tokenRegeneratedAfterApproval: "unverified" }, { nativeWriteAccess: "unverified" }, { currency: "USD" }, { accountId: "wrong" }, { canManageCampaigns: false }, { billingReady: false }, { canCreatePost: false }, { timeZone: "not/a_zone" }, { validUntil: new Date(now).toISOString() }, { funding: { ...nativeFixture().evidence.funding, cancelled: true } }, { user: { ...nativeFixture().evidence.user, type: "RETWEETS_ONLY" } }]) {
    const fixture = runtime(); await assert.rejects(core.runXAdsPausedCampaign(fixture.input, { ...fixture.evidence, ...patch } as core.XAdsPublisherEvidence, operationKey, fixture.deps)); assert.equal(fixture.calls.length, 0);
  }
});
test("X invalid date or cent precision never silently changes the budget or starts a campaign", async () => {
  for (const patch of [{ startAt: "2026-11-31T09:00:00Z" }, { endAt: "2026-10-01T00:00:00Z" }, { dailyBudgetEuros: 10.001 }, { bidEuros: 11 }, { dailyBudgetEuros: 501 }, { geoTargets: [geo, geo] }]) {
    const fixture = runtime(); await assert.rejects(core.runXAdsPausedCampaign({ ...fixture.input, ...patch }, fixture.evidence, operationKey, fixture.deps)); assert.equal(fixture.calls.length, 0);
  }
});
test("X organic post response is quarantined before any campaign object", async () => {
  const fixture = runtime({ mismatch: "organic" }); await assert.rejects(core.runXAdsPausedCampaign(fixture.input, fixture.evidence, operationKey, fixture.deps));
  assert.deepEqual(fixture.calls.filter((call) => call.method === "POST").map((call) => call.path), ["tweet"]); assert.equal(fixture.saved?.uncertainStep, "create_post");
});
for (const mismatch of ["post", "campaign", "parent", "budget", "geography", "promoted"]) test(`X native ${mismatch} readback mismatch never yields paused_verified`, async () => {
  const fixture = runtime({ mismatch }); await assert.rejects(core.runXAdsPausedCampaign(fixture.input, fixture.evidence, operationKey, fixture.deps));
  assert.notEqual(fixture.saved?.stage, "paused_verified");
  if (mismatch === "campaign") assert.equal(fixture.calls.filter((call) => call.method === "POST" && call.path === "line_items").length, 0);
  if (mismatch === "parent" || mismatch === "budget") assert.equal(fixture.calls.filter((call) => call.method === "POST" && call.path === "promoted_tweets").length, 0);
});
for (const step of ["tweet", "campaigns", "line_items", "targeting_criteria", "promoted_tweets"]) test(`X ${step} timeout is never retried automatically`, async () => {
  const fixture = runtime({ fail: step }); await assert.rejects(core.runXAdsPausedCampaign(fixture.input, fixture.evidence, operationKey, fixture.deps));
  const count = fixture.calls.length; assert.ok(fixture.saved?.uncertainStep);
  await assert.rejects(core.runXAdsPausedCampaign(fixture.input, fixture.evidence, operationKey, fixture.deps), (error: unknown) => error instanceof core.XAdsPublisherError && error.uncertain);
  assert.equal(fixture.calls.length, count);
});
test("X completed resume revalidates every native object without a new POST", async () => {
  const fixture = runtime(); await core.runXAdsPausedCampaign(fixture.input, fixture.evidence, operationKey, fixture.deps); const count = fixture.calls.length;
  await core.runXAdsPausedCampaign(fixture.input, fixture.evidence, operationKey, fixture.deps);
  assert.ok(fixture.calls.length > count); assert.ok(fixture.calls.slice(count).every((call) => call.method === "GET"));
  await assert.rejects(core.runXAdsPausedCampaign({ ...fixture.input, postText: "Nouveau texte" }, fixture.evidence, operationKey, fixture.deps), /checkpoint_mismatch/);
});
test("X revoked owner prevents checkpoints and native mutations", async () => {
  const fixture = runtime({ ownerFail: true }); await assert.rejects(core.runXAdsPausedCampaign(fixture.input, fixture.evidence, operationKey, fixture.deps)); assert.equal(fixture.calls.length, 0); assert.equal(fixture.journal.length, 0);
});
