import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAdsCampaignPlan } from "../lib/adsCampaignPlan.ts";
import { nativeWizardMediaStrategy, projectAdsCampaignPlan } from "../lib/adsCampaignPlanClient.ts";
import { defaultAdsChannelWizardSettings } from "../lib/adsChannelWizardSettings.ts";
import type { AdsCampaignInput } from "../lib/adsValidation.ts";

const plan = (provider: "google" | "meta") => normalizeAdsCampaignPlan({
  name: "Nouveau projet", offer: "Notre service", primaryText: "Découvrez notre service.",
  headlines: ["Un service local"], descriptions: ["Préparez votre projet avec notre équipe."],
  targetLocations: ["Lille"], targetAudiences: ["Professionnels"], languages: ["fr"],
  keywords: ["service local"], mediaBrief: "Une présentation du service", destinationUrl: "https://example.invalid/service",
}, { provider, companyName: "Atelier", locations: ["Lille"], locationsAreSelected: true, country: "FR", destinationUrl: "https://example.invalid/service", now: "2026-10-21T12:00:00Z", timezone: "Europe/Paris" });

for (const provider of ["google", "meta"] as const) {
  test(`${provider}: a new plan clears unrelated attachments while preserving the account and the original inputs`, () => {
    const proposed = plan(provider);
    const current = { ...proposed, provider, adAccountId: "saved-account", pageId: "saved-page", accountCurrency: "EUR", dailyBudgetEuros: 27, endDate: "2026-12-01",
      imageUrl: "https://example.invalid/old.jpg", creativeUrl: "https://example.invalid/old.mp4",
      metaCreativeAssets: { feedImageUrl: "old-feed", storyReelImageUrl: "old-story" },
    } as unknown as AdsCampaignInput;
    const before = structuredClone({ current, proposed });
    const result = projectAdsCampaignPlan(current, proposed, { channelId: provider, linkedInCampaignGroups: [], linkedInManualGroupId: null });
    assert.equal(result.adAccountId, "saved-account");
    assert.equal(result.pageId, "saved-page");
    assert.equal(result.creationMode, "inrcy");
    assert.equal(result.imageUrl, proposed.imageUrl);
    assert.equal(result.creativeUrl, proposed.creativeUrl);
    assert.deepEqual(result.metaCreativeAssets, { feedImageUrl: "", storyReelImageUrl: "" });
    assert.deepEqual({ current, proposed }, before);
    if (provider === "meta") assert.deepEqual(result.keywords, []);
  });
}

test("media strategy keeps native text and product-feed formats free of generated image requirements", () => {
  const x = defaultAdsChannelWizardSettings("x");
  const pinterest = defaultAdsChannelWizardSettings("pinterest");
  const tiktok = defaultAdsChannelWizardSettings("tiktok");
  assert.equal(nativeWizardMediaStrategy({ ...x, channel: "x", format: "text" } as typeof x), "search_text");
  assert.equal(nativeWizardMediaStrategy({ ...pinterest, channel: "pinterest", intendedPromotionType: "CATALOG" } as typeof pinterest), "product_feed");
  assert.equal(nativeWizardMediaStrategy(tiktok), "video");
});
