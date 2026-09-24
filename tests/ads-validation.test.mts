import assert from "node:assert/strict";
import test from "node:test";
import { ADS_CHANNELS, parseAdsCampaignInput } from "../lib/adsValidation.ts";
import { metaFeedTargeting, metaLinkCreativeStory } from "../lib/adsMetaPlacement.ts";

const endDate = new Date(Date.now() + 8 * 86_400_000).toISOString().slice(0, 10);

const metaDraft = {
  provider: "meta",
  adAccountId: "act_1234567890",
  accountCurrency: "EUR",
  name: "Annonce locale",
  dailyBudgetEuros: 12.5,
  endDate,
  destinationUrl: "https://example.com/offre",
  primaryText: "Découvrez notre offre locale.",
  imageUrl: "https://example.com/visuel.jpg",
  pageId: "1234567890",
  headlines: [],
  descriptions: [],
  keywords: [],
  noSpecialCategoryConfirmed: true,
  notEuPoliticalConfirmed: false,
};

const googleDraft = {
  ...metaDraft,
  provider: "google",
  adAccountId: "1234567890",
  headlines: ["Un service local", "Découvrez nos offres", "Contactez-nous"],
  descriptions: ["Découvrez notre offre locale.", "Consultez les informations et contactez-nous."],
  keywords: ["service local"],
  notEuPoliticalConfirmed: true,
};

test("iNr’ADS valide les brouillons Meta et Google sans jamais arrondir le budget", () => {
  assert.equal(parseAdsCampaignInput(metaDraft).draft?.adAccountId, "1234567890");
  assert.equal(parseAdsCampaignInput(googleDraft).draft?.dailyBudgetEuros, 12.5);
  assert.equal(parseAdsCampaignInput({ ...metaDraft, dailyBudgetEuros: 12.555 }).draft, null);
});

test("iNr’ADS refuse les déclarations réglementaires manquantes", () => {
  assert.equal(parseAdsCampaignInput({ ...metaDraft, noSpecialCategoryConfirmed: false }).draft, null);
  assert.equal(parseAdsCampaignInput({ ...googleDraft, notEuPoliticalConfirmed: false }).draft, null);
});

test("iNr’ADS rejette les données longues au lieu de les tronquer avant publication", () => {
  assert.equal(parseAdsCampaignInput({ ...metaDraft, name: "x".repeat(101) }).draft, null);
  assert.equal(parseAdsCampaignInput({ ...metaDraft, primaryText: "x".repeat(501) }).draft, null);
  assert.equal(parseAdsCampaignInput({ ...googleDraft, headlines: ["x".repeat(31), ...googleDraft.headlines] }).draft, null);
  assert.equal(parseAdsCampaignInput({ ...googleDraft, descriptions: ["x".repeat(91), ...googleDraft.descriptions] }).draft, null);
});

test("iNr’ADS exige des liens HTTPS et une date de fin bornée", () => {
  assert.equal(parseAdsCampaignInput({ ...metaDraft, destinationUrl: "http://example.com" }).draft, null);
  assert.equal(parseAdsCampaignInput({ ...metaDraft, endDate: "2099-01-01" }).draft, null);
  assert.equal(parseAdsCampaignInput({ ...metaDraft, endDate: "2000-01-01" }).draft, null);
});

test("les six canaux peuvent être préparés en brouillon sans compte annonceur", () => {
  for (const provider of ["meta", "google", "linkedin", "tiktok", "pinterest", "x"] as const) {
    const result = parseAdsCampaignInput({
      ...metaDraft,
      provider,
      adAccountId: "",
      name: `Brouillon ${provider}`,
      destinationUrl: "",
      imageUrl: "",
      pageId: "",
      headlines: [],
      descriptions: [],
      keywords: [],
      noSpecialCategoryConfirmed: false,
      notEuPoliticalConfirmed: false,
    }, { purpose: "draft" });
    assert.equal(result.error, null, provider);
    assert.equal(result.draft?.provider, provider);
    assert.equal(result.draft?.adAccountId, "");
  }
});

test("les canaux non branchés restent impossibles à publier et ne peuvent pas lier de faux comptes", () => {
  const pinterestDraft = {
    ...metaDraft,
    provider: "pinterest",
    adAccountId: "",
    name: "Pin local",
    destinationUrl: "",
  };
  assert.match(parseAdsCampaignInput(pinterestDraft).error || "", /pas encore disponibles/);
  assert.match(parseAdsCampaignInput({ ...pinterestDraft, adAccountId: "1234567890" }, { purpose: "draft" }).error || "", /Connectez ce canal/);
  assert.equal(parseAdsCampaignInput({ ...metaDraft, provider: "meta", adAccountId: "" }, { purpose: "draft" }).draft?.adAccountId, "");
});

test("les médias préparatoires exigent une URL HTTPS valide", () => {
  const draft = { ...metaDraft, provider: "tiktok", adAccountId: "", name: "TikTok", destinationUrl: "" };
  assert.equal(parseAdsCampaignInput({ ...draft, creativeUrl: "https://example.com/video.mp4", creativeType: "video" }, { purpose: "draft" }).draft?.creativeType, "video");
  assert.equal(parseAdsCampaignInput({ ...draft, creativeUrl: "http://example.com/video.mp4", creativeType: "video" }, { purpose: "draft" }).draft, null);
});

test("Meta Ads prépare les deux fils Facebook et Instagram avec l’identité Instagram liée", () => {
  assert.match(ADS_CHANNELS[0].format, /Facebook.*Instagram/);
  assert.deepEqual(metaFeedTargeting().publisher_platforms, ["facebook", "instagram"]);
  assert.deepEqual(metaFeedTargeting().facebook_positions, ["feed"]);
  assert.deepEqual(metaFeedTargeting().instagram_positions, ["stream"]);
  const creative = metaLinkCreativeStory({
    pageId: "1234567890",
    instagramUserId: "17841400000000000",
    destinationUrl: "https://example.com/offre",
    primaryText: "Découvrez notre offre locale.",
    imageUrl: "https://example.com/visuel.jpg",
  });
  assert.equal(creative.page_id, "1234567890");
  assert.equal(creative.instagram_user_id, "17841400000000000");
});
