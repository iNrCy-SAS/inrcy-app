import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTikTokAdsNativeSelections, tikTokAdsNativeSelectionsComplete, tikTokAdsNativeSelectionsKey } from "../lib/adsTikTokNativeSelections.ts";
import { TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT } from "../lib/adsTikTokResources.ts";
import { tikTokAdsPausedCreationEnabled } from "../lib/adsTikTokPublicationPolicy.ts";

function selections() { return { schemaVersion: 1, advertiserId: "1234567890123", context: structuredClone(TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT), identity: { id: "native-identity", type: "TT_USER" }, locationIds: ["250", "59123"], callToAction: "LEARN_MORE", thumbnailMediaId: "d195aa0d-d97a-4857-8d39-830863bfa211", isAiGenerated: true }; }

test("TikTok choices persist incomplete drafts without claiming a complete native selection", () => {
  assert.deepEqual(normalizeTikTokAdsNativeSelections(undefined), { selections: null, error: null });
  const result = normalizeTikTokAdsNativeSelections({ ...selections(), identity: null, locationIds: [], callToAction: null, thumbnailMediaId: null, isAiGenerated: null });
  assert.equal(result.error, null); assert.equal(tikTokAdsNativeSelectionsComplete(result.selections), false);
  assert.equal(result.selections?.isAiGenerated, null);
  const complete = normalizeTikTokAdsNativeSelections(selections());
  assert.equal(complete.error, null); assert.equal(tikTokAdsNativeSelectionsComplete(complete.selections), true);
  assert.equal(normalizeTikTokAdsNativeSelections({ ...selections(), isAiGenerated: false }).selections?.isAiGenerated, false);
});
test("TikTok saved selections reject credentials, grants and provider media references", () => {
  for (const extra of [{ nativeEvidence: { nativeWriteAccess: "verified" } }, { accessToken: "fixture" }, { videoId: "provider-video" }, { publicationEnabled: true }, { displayName: "untrusted" }]) {
    const result = normalizeTikTokAdsNativeSelections({ ...selections(), ...extra });
    assert.equal(result.selections, null); assert.ok(result.error);
  }
});
test("TikTok account and Traffic placement context are exact and cannot be substituted", () => {
  for (const patch of [{ schemaVersion: 2 }, { advertiserId: 1234567890 }, { advertiserId: "unsafe" }, { context: { ...TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT, placements: ["PLACEMENT_PANGLE"] } }, { context: { ...TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT, objectiveType: "CONVERSIONS" } }, { context: { ...TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT, language: "en" } }]) {
    assert.ok(normalizeTikTokAdsNativeSelections({ ...selections(), ...patch }).error);
  }
});
test("TikTok accepts only structurally bound identity and explicit owned thumbnail/AIGC choices", () => {
  for (const patch of [{ identity: { id: "id", type: "UNKNOWN" } }, { identity: { id: "id", type: "BC_AUTH_TT" } }, { identity: { id: "id", type: "BC_AUTH_TT", authorizedBusinessCenterId: "unsafe" } }, { identity: { id: "id", type: "TT_USER", authorizedBusinessCenterId: "1234567" } }, { identity: { id: "id", type: "TT_USER", displayName: "extra" } }, { thumbnailMediaId: "https://external.example/image.png" }, { callToAction: "En savoir plus" }, { isAiGenerated: "false" }]) {
    assert.ok(normalizeTikTokAdsNativeSelections({ ...selections(), ...patch }).error);
  }
  assert.equal(normalizeTikTokAdsNativeSelections({ ...selections(), identity: { id: "id", type: "BC_AUTH_TT", authorizedBusinessCenterId: "1234567" } }).error, null);
});
test("TikTok native locations remain exact strings with no silently deduplicated selection", () => {
  for (const locationIds of [["0"], ["250", "250"], [250], ["x"], ["1".repeat(31)], Array.from({ length: 21 }, (_, index) => String(index + 1))]) assert.ok(normalizeTikTokAdsNativeSelections({ ...selections(), locationIds }).error);
  const first = normalizeTikTokAdsNativeSelections(selections()).selections;
  const reversed = normalizeTikTokAdsNativeSelections({ ...selections(), locationIds: ["59123", "250"] }).selections;
  assert.equal(tikTokAdsNativeSelectionsKey(first), tikTokAdsNativeSelectionsKey(reversed));
  assert.notEqual(tikTokAdsNativeSelectionsKey(first), tikTokAdsNativeSelectionsKey(normalizeTikTokAdsNativeSelections({ ...selections(), isAiGenerated: false }).selections));
});
test("TikTok paused creation flag is closed by default and never grants delivery or provider access", () => {
  for (const environment of [{}, { TIKTOK_ADS_PAUSED_CREATION_ENABLED: "false" }, { TIKTOK_ADS_PAUSED_CREATION_ENABLED: "TRUE" }, { INRCY_ADS_LIVE_PUBLISH_ENABLED: "true" }]) assert.equal(tikTokAdsPausedCreationEnabled(environment), false);
  assert.equal(tikTokAdsPausedCreationEnabled({ TIKTOK_ADS_PAUSED_CREATION_ENABLED: "true" }), true);
});
