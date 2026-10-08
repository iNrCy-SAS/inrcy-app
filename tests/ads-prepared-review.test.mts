import assert from "node:assert/strict";
import test from "node:test";
import { preparedAdsReviewIssues } from "../lib/adsPreparedReview.ts";
import { defaultPreparedDeliverySettings } from "../lib/adsPreparedCampaignSettings.ts";
import type { AdsCampaignInput } from "../lib/adsValidation.ts";
import type { TikTokWizardSettings } from "../lib/adsChannelWizardSettings.ts";

const now = Date.parse("2026-10-08T10:00:00Z");
function draft(channel: "x" | "tiktok" = "x", patch: Record<string, unknown> = {}): AdsCampaignInput {
  return { provider: channel, name: "Découvrir iNrCy", offer: "Essai gratuit de 21 jours", targetLocations: ["Hauts-de-France"], targetAudiences: ["Indépendants et petites entreprises"], primaryText: "Découvrez iNrCy pour préparer votre communication.", channelSettings: channel === "x" ? { channel, objective: "website_traffic", format: "text", targetingMode: "broad" } : { channel, objectiveType: "TRAFFIC", format: "video", targetingMode: "broad", placementIntent: "tiktok_only", optimizationIntent: "clicks", destinationKind: "website" }, conversionLocation: "website", destinationUrl: "https://inrcy.com/", creativeType: "video", imageUrl: "", keywords: [], dailyBudgetEuros: 25, endDate: "2026-10-21", preparedDeliverySettings: defaultPreparedDeliverySettings(), ...patch } as unknown as AdsCampaignInput;
}
test("A complete text-only X brief does not require a media URL or access its optional value", () => {
  assert.deepEqual(preparedAdsReviewIssues(draft(), now), []);
  const image = draft("x", { channelSettings: { channel: "x", objective: "website_traffic", format: "image", targetingMode: "broad" } });
  assert.ok(preparedAdsReviewIssues(image, now).some((issue) => /média/.test(issue)));
  assert.deepEqual(preparedAdsReviewIssues({ ...image, imageUrl: "https://assets.example/advertisement.jpg" }, now), []);
});
test("TikTok reports missing or wrong media without a runtime error, then accepts a complete prepared video brief", () => {
  assert.ok(preparedAdsReviewIssues(draft("tiktok"), now).some((issue) => /média/.test(issue)));
  const video = draft("tiktok", { creativeUrl: "https://assets.example/advertisement.mp4" });
  assert.deepEqual(preparedAdsReviewIssues(video, now), []);
  assert.ok(preparedAdsReviewIssues({ ...video, creativeType: "image" }, now).some((issue) => /vidéo publicitaire/.test(issue)));
});
test("TikTok profile and instant-form destinations can be reviewed without a hidden website URL", () => {
  for (const destinationKind of ["profile", "instant_form"] as const) {
    const video = draft("tiktok", { creativeUrl: "https://assets.example/advertisement.mp4", destinationUrl: "", conversionLocation: "website" });
    const channelSettings = video.channelSettings as TikTokWizardSettings;
    const nativeDestination = { ...video, channelSettings: { ...channelSettings, destinationKind, objectiveType: destinationKind === "profile" ? "ENGAGEMENT" as const : "LEAD_GENERATION" as const, optimizationIntent: destinationKind === "profile" ? "engagement" as const : "leads" as const } };
    assert.deepEqual(preparedAdsReviewIssues(nativeDestination, now), [], destinationKind);
    assert.deepEqual(preparedAdsReviewIssues({ ...nativeDestination, conversionLocation: "instant_form" }, now), [], destinationKind);
  }
});
test("TikTok website destinations still require HTTPS even when an older generic conversion location differs", () => {
  const video = draft("tiktok", { creativeUrl: "https://assets.example/advertisement.mp4", conversionLocation: "instant_form" });
  for (const destinationUrl of ["", "http://inrcy.com/", "https://user:password@inrcy.com/", "javascript:alert(1)"]) assert.ok(preparedAdsReviewIssues({ ...video, destinationUrl }, now).some((issue) => /HTTPS valide/.test(issue)), destinationUrl);
  assert.deepEqual(preparedAdsReviewIssues({ ...video, destinationUrl: "https://inrcy.com/" }, now), []);
  assert.ok(preparedAdsReviewIssues(draft("x", { destinationUrl: "" }), now).some((issue) => /HTTPS valide/.test(issue)));
});
test("Preparation review directs missing audience, geographic choices and keyword-mode inputs to their own fields", () => {
  const issues = preparedAdsReviewIssues(draft("x", { targetLocations: [], targetAudiences: [], channelSettings: { channel: "x", objective: "website_traffic", format: "text", targetingMode: "keywords" } }), now);
  assert.ok(issues.some((issue) => /Zones géographiques/.test(issue))); assert.ok(issues.some((issue) => /Audience/.test(issue))); assert.ok(issues.some((issue) => /mots-clés X/.test(issue)));
  assert.ok(preparedAdsReviewIssues(draft("x", { destinationUrl: "https://user:password@inrcy.com" }), now).some((issue) => /HTTPS valide/.test(issue)));
});
test("Text lengths and scheduled envelope errors remain visible in preparation review", () => {
  const url = "https://inrcy.com/" + "long-path".repeat(30);
  assert.deepEqual(preparedAdsReviewIssues(draft("x", { primaryText: "a".repeat(256) + " " + url }), now), []);
  assert.ok(preparedAdsReviewIssues(draft("x", { primaryText: "a".repeat(257) + " " + url }), now).some((issue) => /longueur/.test(issue)));
  const video = draft("tiktok", { creativeUrl: "https://assets.example/video.mp4", primaryText: "a".repeat(101) });
  assert.ok(preparedAdsReviewIssues(video, now).some((issue) => /longueur/.test(issue)));
  const invalid = { ...defaultPreparedDeliverySettings("total"), budget: { type: "total", totalEuros: 200, startAt: "2026-10-22T10:00:00Z", endAt: "2026-10-21T10:00:00Z" } };
  assert.ok(preparedAdsReviewIssues(draft("x", { preparedDeliverySettings: invalid }), now).some((issue) => /fin préparée/.test(issue)));
});
