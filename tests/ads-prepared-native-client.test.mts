import assert from "node:assert/strict";
import test from "node:test";
import { automaticTikTokNativeSelections, automaticXNativeSelections, createReviewedPausedCampaign, ownedPreparedVideoId, preparedNativeCheck, preparedXCopyWithDestination, type PreparedNativeCheck } from "../lib/adsPreparedNativeClient.ts";
import type { AdsCampaignInput } from "../lib/adsValidation.ts";
import type { TikTokAdsResources } from "../lib/adsTikTokResources.ts";
import type { XAdsResources } from "../lib/adsXResources.ts";
import { readPreparedAdsPlanIntent } from "../lib/adsPreparedPlanIntent.ts";

const campaignId = "bf523971-5884-466d-9cc4-09cdf4a08d53";
const check = (provider: "tiktok" | "x" = "tiktok"): PreparedNativeCheck => ({ ready: true, publicationEnabled: false,
  targetStatus: provider === "tiktok" ? "DISABLE" : "PAUSED", pausedCreationEnabled: true, preparationReady: true,
  selectedAccountId: provider === "tiktok" ? "12345678901" : "ab12", verifiedLocationCount: 1,
  resourcesKey: "native-resources", consentKey: "a".repeat(64), preparationKey: "a".repeat(64), blockers: [] });
const draft = (provider: "tiktok" | "x" = "tiktok") => ({ provider, adAccountId: check(provider).selectedAccountId, name: "Nouvelle campagne" }) as AdsCampaignInput;
function scenario(provider: "tiktok" | "x" = "tiktok") {
  const calls: Array<{ path: string; body: Record<string, unknown> | null }> = [];
  const replies: Record<string, unknown>[] = [check(provider), { campaign: { id: campaignId, status: "draft" } },
    { ...check(provider), consentKey: "b".repeat(64), draftFingerprint: "c".repeat(64) }, { campaign: { id: campaignId, status: "paused" } }];
  const transport = async (path: string, init?: RequestInit) => {
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null });
    return replies[calls.length - 1];
  };
  return { calls, replies, transport };
}
test("Paused validation uses provider proof then saved consent and never the active API", async () => {
  for (const provider of ["x", "tiktok"] as const) {
    const flow = scenario(provider);
    const result = await createReviewedPausedCampaign({ draft: draft(provider), checked: check(provider), assertUnchanged() {} }, flow.transport);
    assert.equal(result.id, campaignId); assert.equal(flow.calls.length, 4);
    assert.equal(flow.calls[2].path, `/api/ads/campaigns/${campaignId}/preflight?mode=paused`);
    assert.deepEqual(flow.calls[3].body, { mode: "paused", confirmation: "CREER_CAMPAGNE_EN_PAUSE", nativeConsentKey: "b".repeat(64), expectedDraftFingerprint: "c".repeat(64) });
    assert.ok(flow.calls.every((call) => !call.path.includes("lifecycle") && call.body?.mode !== "live"));
  }
});
test("A denied paused gate stops before saving or creating anything", async () => {
  const flow = scenario();
  await assert.rejects(createReviewedPausedCampaign({ draft: draft(), checked: { ...check(), pausedCreationEnabled: false }, assertUnchanged() {} }, flow.transport));
  assert.equal(flow.calls.length, 0);
});
test("Changing resources or consent invalidates the reviewed proposal before draft save", async () => {
  for (const patch of [{ resourcesKey: "changed" }, { consentKey: "changed" }, { ready: false }]) {
    const flow = scenario(); flow.replies[0] = { ...check(), ...patch };
    await assert.rejects(createReviewedPausedCampaign({ draft: draft(), checked: check(), assertUnchanged() {} }, flow.transport));
    assert.equal(flow.calls.length, 1);
  }
});
test("Draft edits during each pre-publication boundary prevent the native POST", async () => {
  for (const boundary of [1, 2, 3, 4]) {
    const flow = scenario(); let count = 0;
    await assert.rejects(createReviewedPausedCampaign({ draft: draft(), checked: check(), assertUnchanged() { if (++count === boundary) throw new Error("changed"); } }, flow.transport), /changed/);
    assert.ok(!flow.calls.some((item) => item.path.endsWith("/publish")));
  }
});
test("Different saved native proof or absent full draft fingerprint prevents the POST", async () => {
  for (const patch of [{ preparationKey: "changed" }, { draftFingerprint: "" }, { selectedAccountId: "999999" }]) {
    const flow = scenario(); flow.replies[2] = { ...flow.replies[2], ...patch };
    await assert.rejects(createReviewedPausedCampaign({ draft: draft(), checked: check(), assertUnchanged() {} }, flow.transport));
    assert.equal(flow.calls.length, 3);
  }
});
test("An uncertain provider response is never automatically replayed", async () => {
  const flow = scenario(); let posts = 0;
  await assert.rejects(createReviewedPausedCampaign({ draft: draft(), checked: check(), assertUnchanged() {} }, async (path, init) => {
    if (path.endsWith("/publish")) { posts++; throw new Error("network outcome unknown"); }
    return flow.transport(path, init);
  }), /unknown/);
  assert.equal(posts, 1);
  const second = scenario(); second.replies[3] = { campaign: { id: campaignId, status: "publishing" } };
  await assert.rejects(createReviewedPausedCampaign({ draft: draft(), checked: check(), assertUnchanged() {} }, second.transport), /suivi/);
  assert.equal(second.calls.length, 4);
});
test("Public paused checks reject foreign accounts, active targets and malformed flags", () => {
  for (const patch of [{ selectedAccountId: "other" }, { publicationEnabled: true }, { targetStatus: "ACTIVE" }, { pausedCreationEnabled: "true" }]) assert.throws(() => preparedNativeCheck({ ...check(), ...patch }, "tiktok", draft().adAccountId));
  assert.equal(preparedNativeCheck(check(), "tiktok", draft().adAccountId).publicationEnabled, false);
});
test("Automatic TikTok defaults pick only a unique real identity and preserve account-bound fields", () => {
  const resources = { selectedAccountId: "12345678901", identities: [{ id: "identity1", type: "TT_USER", displayName: "Entreprise" }] } as TikTokAdsResources;
  const selected = automaticTikTokNativeSelections(resources);
  assert.equal(selected.identity?.id, "identity1"); assert.equal(selected.isAiGenerated, null);
  assert.equal(automaticTikTokNativeSelections({ ...resources, identities: [...resources.identities, { ...resources.identities[0], id: "other" }] }).identity, null);
  assert.deepEqual(automaticTikTokNativeSelections({ ...resources, selectedAccountId: "98765432100" }, { ...selected, locationIds: ["123"], thumbnailMediaId: campaignId }).locationIds, []);
});
test("X automatically selects unique eligible funding and FULL user, never an unrelated existing post", () => {
  const resources = { selectedAccountId: "ab12", fundingInstruments: [{ id: "fund", currency: "EUR", ableToFund: true, deleted: false, cancelled: false }, { id: "wrong", currency: "USD", ableToFund: true, deleted: false, cancelled: false }],
    promotableUsers: [{ id: "user", userId: "123", type: "FULL" }, { id: "retweet", userId: "456", type: "RETWEETS_ONLY" }], posts: [{ id: "123456", userId: "123", text: "Ancien message" }] } as XAdsResources;
  const selected = automaticXNativeSelections(resources);
  assert.equal(selected.fundingInstrumentId, "fund"); assert.equal(selected.promotableUserId, "user"); assert.equal(selected.postId, null);
  assert.equal(automaticXNativeSelections({ ...resources, fundingInstruments: [...resources.fundingInstruments, { ...resources.fundingInstruments[0], id: "second" }] }).fundingInstrumentId, null);
});
test("Thumbnail extraction accepts only canonical private library video references", () => {
  assert.equal(ownedPreparedVideoId(`/api/media-library/items/${campaignId}/content`), campaignId);
  for (const url of [`https://app.inrcy.com/api/media-library/items/${campaignId}/content`, `/api/media-library/items/${campaignId}/content?token=secret`, "https://remote.example/video.mp4", "/api/media-library/items/invalid/content"]) assert.equal(ownedPreparedVideoId(url), null);
});
test("AI defaults produce explicit native proposals without converting human daily or total budgets", () => {
  const context = { now: "2026-10-08T12:00:00Z", timezone: "Europe/Paris" };
  const tt = readPreparedAdsPlanIntent({ ...context, provider: "tiktok" });
  assert.equal(tt.deliverySettings?.budget.type, "total"); assert.equal(tt.deliverySettings?.budget.totalEuros, 200);
  assert.equal(tt.deliverySettings?.budget.startAt, "2026-10-08T12:15:00.000Z");
  const x = readPreparedAdsPlanIntent({ ...context, provider: "x" });
  assert.deepEqual(x.deliverySettings?.bidding, { strategy: "max_bid", amountEuros: 1 });
  assert.equal(readPreparedAdsPlanIntent({ ...context, provider: "tiktok", intent: "Budget 20 euros par jour" }).deliverySettings?.budget.type, "daily");
  assert.equal(readPreparedAdsPlanIntent({ ...context, provider: "x", intent: "Budget total 200 euros" }).deliverySettings?.budget.type, "total");
});

test("X proposals include the exact tracked destination once before final review", () => {
  const url = "https://inrcy.com/?utm_source=x&utm_medium=paid_social";
  assert.equal(preparedXCopyWithDestination("Découvrez iNrCy", "https://inrcy.com/", "utm_source=x&utm_medium=paid_social"), `Découvrez iNrCy\n${url}`);
  const text = `Découvrez iNrCy\n${url}`;
  assert.equal(preparedXCopyWithDestination(text, "https://inrcy.com/", "utm_source=x&utm_medium=paid_social"), text);
  assert.equal(preparedXCopyWithDestination("Découvrez iNrCy", "http://inrcy.com/", ""), "Découvrez iNrCy");
});
