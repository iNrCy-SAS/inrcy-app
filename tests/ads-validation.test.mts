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
  metaPlacements: ["facebook_feed", "instagram_feed"],
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
  targetLocations: ["Lille"],
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

test("la publication Google Search reste textuelle avec ou sans image locale", () => {
  assert.equal(parseAdsCampaignInput({ ...googleDraft, creationMode: "inrcy", imageUrl: "" }).error, null);
  assert.equal(parseAdsCampaignInput({ ...googleDraft, creationMode: "manual", imageUrl: "" }).error, null);
  assert.equal(parseAdsCampaignInput({ ...googleDraft, creationMode: "inrcy" }).error, null);
});

test("Google exige une zone explicite avant publication et n’invente jamais France pour un brouillon vide", () => {
  for (const targetLocations of [undefined, null, [], [" "]]) {
    const incomplete = { ...googleDraft, targetLocations };
    const published = parseAdsCampaignInput(incomplete, { purpose: "publish" });
    assert.equal(published.draft, null);
    assert.match(published.error || "", /zone ciblée/);
    const saved = parseAdsCampaignInput(incomplete, { purpose: "draft" });
    assert.equal(saved.error, null);
    assert.deepEqual(saved.draft?.targetLocations, []);
  }
  const local = parseAdsCampaignInput(googleDraft, { purpose: "publish" });
  assert.equal(local.error, null);
  assert.deepEqual(local.draft?.targetLocations, ["Lille"]);
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

test("les pistes LinkedIn longues restent entières dans le brouillon, sans élargir les mots-clés Google", () => {
  const signal = "Professionnels souhaitant centraliser leur communication digitale et publier sur plusieurs canaux depuis un même espace.";
  assert.ok(signal.length > 80 && signal.length < 300);
  const linkedin = parseAdsCampaignInput({ ...metaDraft, provider: "linkedin", adAccountId: "", keywords: [signal] }, { purpose: "draft" });
  assert.equal(linkedin.error, null);
  assert.deepEqual(linkedin.draft?.keywords, [signal]);
  assert.equal(parseAdsCampaignInput({ ...googleDraft, keywords: [signal] }, { purpose: "draft" }).draft, null);
  assert.equal(parseAdsCampaignInput({ ...metaDraft, provider: "linkedin", adAccountId: "", keywords: ["x".repeat(301)] }, { purpose: "draft" }).draft, null);
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

test("TikTok et X restent impossibles à publier ; seule l’association X peut accompagner un brouillon", () => {
  const unconnectedDraft = {
    ...metaDraft,
    provider: "tiktok",
    adAccountId: "",
    name: "Campagne locale",
    destinationUrl: "",
  };
  for (const provider of ["tiktok", "x"]) {
    assert.match(parseAdsCampaignInput({ ...unconnectedDraft, provider }).error || "", /pas encore disponibles/);
  }
  assert.match(parseAdsCampaignInput({ ...unconnectedDraft, adAccountId: "1234567890" }, { purpose: "draft" }).error || "", /Connectez ce canal/);
  // Ownership and current access for an X account are checked by POST /campaigns.
  assert.equal(parseAdsCampaignInput({ ...unconnectedDraft, provider: "x", adAccountId: "Ab12cd" }, { purpose: "draft" }).draft?.adAccountId, "Ab12cd");
  assert.equal(parseAdsCampaignInput({ ...metaDraft, provider: "meta", adAccountId: "" }, { purpose: "draft" }).draft?.adAccountId, "");
});

test("LinkedIn accepte un identifiant de compte en brouillon mais exige un compte valide avant publication", () => {
  const linkedInDraft = { ...metaDraft, provider: "linkedin", name: "Campagne LinkedIn" };
  assert.match(parseAdsCampaignInput({ ...linkedInDraft, adAccountId: "" }).error || "", /Sélectionnez un compte publicitaire connecté/);
  assert.match(parseAdsCampaignInput({ ...linkedInDraft, adAccountId: "faux-compte" }, { purpose: "draft" }).error || "", /identifiant du compte publicitaire est invalide/);
  const saved = parseAdsCampaignInput({ ...linkedInDraft, adAccountId: "1234567890" }, { purpose: "draft" });
  assert.equal(saved.error, null);
  assert.equal(saved.draft?.adAccountId, "1234567890");
});

test("les médias préparatoires exigent une URL HTTPS valide", () => {
  const draft = { ...metaDraft, provider: "tiktok", adAccountId: "", name: "TikTok", destinationUrl: "" };
  assert.equal(parseAdsCampaignInput({ ...draft, creativeUrl: "https://example.com/video.mp4", creativeType: "video" }, { purpose: "draft" }).draft?.creativeType, "video");
  assert.equal(parseAdsCampaignInput({ ...draft, creativeUrl: "http://example.com/video.mp4", creativeType: "video" }, { purpose: "draft" }).draft, null);
});

test("un média privé iNrCy reste utilisable dans un brouillon et à la publication Meta", () => {
  const mediaUrl = "/api/media-library/items/12345678-1234-1234-1234-1234567890ab/content?token=abcdefghijklmnopqrstuvwxyz1234567890ABCDE";
  const parsed = parseAdsCampaignInput({ ...metaDraft, imageUrl: mediaUrl });
  assert.equal(parsed.error, null);
  assert.equal(parsed.draft?.imageUrl, mediaUrl);

  const invalid = parseAdsCampaignInput({ ...metaDraft, imageUrl: "/api/media-library/items/12345678-1234-1234-1234-1234567890ab/content?token=short" });
  assert.equal(invalid.draft, null);
});

test("les anciens brouillons Meta migrent leur image vers le slot Feed sans inventer un Story/Reel", () => {
  const parsed = parseAdsCampaignInput(metaDraft);
  assert.deepEqual(parsed.draft?.metaCreativeAssets, {
    feedImageUrl: metaDraft.imageUrl,
    storyReelImageUrl: "",
  });
  assert.equal(parsed.draft?.imageUrl, metaDraft.imageUrl);
});

test("les créations Meta dédiées valident séparément les formats Feed et Story/Reel", () => {
  const feedImageUrl = "https://example.com/meta-feed-4x5.jpg";
  const storyReelImageUrl = "https://example.com/meta-story-reel-9x16.jpg";
  const parsed = parseAdsCampaignInput({
    ...metaDraft,
    imageUrl: "",
    metaPlacements: ["facebook_feed", "stories", "reels"],
    metaCreativeAssets: { feedImageUrl, storyReelImageUrl },
  });
  assert.equal(parsed.error, null);
  assert.deepEqual(parsed.draft?.metaCreativeAssets, { feedImageUrl, storyReelImageUrl });
  assert.equal(parsed.draft?.imageUrl, feedImageUrl);

  const storyOnly = parseAdsCampaignInput({
    ...metaDraft,
    imageUrl: "",
    metaPlacements: ["stories", "reels"],
    metaCreativeAssets: { feedImageUrl: "", storyReelImageUrl },
  });
  assert.equal(storyOnly.error, null);
  assert.equal(storyOnly.draft?.imageUrl, "");

  assert.match(parseAdsCampaignInput({
    ...metaDraft,
    metaPlacements: ["stories"],
  }).error || "", /Story\/Reel 9:16/);
});

test("le contrat des créations Meta échoue fermé sur les structures et URL ambiguës", () => {
  assert.equal(parseAdsCampaignInput({ ...metaDraft, metaCreativeAssets: "https://example.com/image.jpg" }).draft, null);
  assert.equal(parseAdsCampaignInput({
    ...metaDraft,
    metaCreativeAssets: { feedImageUrl: metaDraft.imageUrl, storyReelImageUrl: "", unexpectedId: "123" },
  }).draft, null);
  assert.equal(parseAdsCampaignInput({
    ...metaDraft,
    metaCreativeAssets: { feedImageUrl: { url: metaDraft.imageUrl }, storyReelImageUrl: "" },
  }).draft, null);
  assert.match(parseAdsCampaignInput({
    ...metaDraft,
    metaCreativeAssets: { feedImageUrl: "http://example.com/feed.jpg", storyReelImageUrl: "" },
  }).error || "", /Feed/);
  assert.match(parseAdsCampaignInput({
    ...metaDraft,
    metaPlacements: ["stories"],
    metaCreativeAssets: { feedImageUrl: "", storyReelImageUrl: "http://example.com/story.jpg" },
  }).error || "", /Story\/Reel/);
  assert.match(parseAdsCampaignInput({
    ...metaDraft,
    metaPlacements: ["facebook_feed", "stories"],
    metaCreativeAssets: { feedImageUrl: metaDraft.imageUrl, storyReelImageUrl: metaDraft.imageUrl },
  }).error || "", /deux images Meta distinctes/);
  assert.match(parseAdsCampaignInput({
    ...googleDraft,
    metaCreativeAssets: { feedImageUrl: metaDraft.imageUrl, storyReelImageUrl: "" },
  }).error || "", /réservées aux campagnes Meta Ads/);
});

test("les réglages avancés de diffusion restent sûrs dans les brouillons", () => {
  const google = parseAdsCampaignInput({
    ...googleDraft,
    languages: ["fr", "en"],
    googleSearchPartners: true,
    googleDisplayExpansion: true,
    trackingParameters: "utm_source=google&utm_campaign=devis",
  });
  assert.deepEqual(google.draft?.languages, ["fr", "en"]);
  assert.equal(google.draft?.googleSearchPartners, true);
  assert.equal(google.draft?.googleDisplayExpansion, true);
  assert.equal(google.draft?.conversionLocation, "website");

  const meta = parseAdsCampaignInput({
    ...metaDraft,
    metaPlacements: ["facebook_feed", "instagram_feed"],
    metaAudienceExpansion: false,
  });
  assert.deepEqual(meta.draft?.metaPlacements, ["facebook_feed", "instagram_feed"]);
  assert.equal(meta.draft?.metaAudienceExpansion, false);
  assert.equal(parseAdsCampaignInput({ ...metaDraft, metaPlacements: ["inconnu"] }).draft, null);
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
