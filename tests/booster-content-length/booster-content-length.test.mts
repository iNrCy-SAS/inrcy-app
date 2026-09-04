import assert from "node:assert/strict";
import test from "node:test";
import {
  BOOSTER_CHANNEL_CONTENT_RULES,
  formatBoosterGeneratedContentRule,
  limitBoosterGeneratedContent,
} from "../../lib/boosterChannelRules.ts";

test("Booster uses the validated SEO length table for every channel", () => {
  assert.deepEqual(BOOSTER_CHANNEL_CONTENT_RULES, {
    inrcy_site: {
      short: { min: 700, max: 1000 },
      medium: { min: 1100, max: 1700 },
      detailed: { min: 1800, max: 2400 },
      max: 2600,
    },
    site_web: {
      short: { min: 700, max: 1000 },
      medium: { min: 1100, max: 1700 },
      detailed: { min: 1800, max: 2400 },
      max: 2600,
    },
    inr_search: {
      short: { min: 90, max: 140 },
      medium: { min: 150, max: 210 },
      detailed: { min: 230, max: 290 },
      max: 300,
    },
    gmb: {
      short: { min: 220, max: 350 },
      medium: { min: 400, max: 650 },
      detailed: { min: 700, max: 1000 },
      max: 1200,
    },
    facebook: {
      short: { min: 220, max: 400 },
      medium: { min: 450, max: 750 },
      detailed: { min: 800, max: 1200 },
      max: 1400,
    },
    instagram: {
      short: { min: 150, max: 280 },
      medium: { min: 300, max: 500 },
      detailed: { min: 620, max: 950 },
      max: 1200,
    },
    linkedin: {
      short: { min: 350, max: 600 },
      medium: { min: 650, max: 1000 },
      detailed: { min: 1100, max: 1700 },
      max: 2000,
    },
    tiktok: {
      short: { min: 80, max: 150 },
      medium: { min: 160, max: 300 },
      detailed: { min: 380, max: 650 },
      max: 800,
    },
    youtube_shorts: {
      short: { min: 300, max: 500 },
      medium: { min: 600, max: 950 },
      detailed: { min: 1000, max: 1600 },
      max: 2000,
    },
    pinterest: {
      short: { min: 100, max: 160 },
      medium: { min: 180, max: 260 },
      detailed: { min: 320, max: 460 },
      max: 520,
    },
  });
});

test("the AI directive separates the preferred range from the absolute content ceiling", () => {
  assert.equal(
    formatBoosterGeneratedContentRule("pinterest", "detailed"),
    "320–460 caractères de contenu principal. Maximum absolu : 520 caractères dans content, à ne jamais dépasser.",
  );
  assert.equal(
    formatBoosterGeneratedContentRule("site_web", "medium"),
    "1100–1700 caractères de contenu principal. Maximum absolu : 2600 caractères dans content, à ne jamais dépasser.",
  );
});

test("generated content is capped locally without a second AI call and keeps a natural boundary", () => {
  const pinterest = `${"Phrase utile pour Pinterest. ".repeat(25)}Dernière phrase.`;
  const limitedPinterest = limitBoosterGeneratedContent("pinterest", pinterest);
  assert.ok(limitedPinterest.length <= 520);
  assert.match(limitedPinterest, /[.!?…]$/);

  const site = `${"Paragraphe SEO local suffisamment développé. ".repeat(90)}Fin.`;
  const limitedSite = limitBoosterGeneratedContent("inrcy_site", site);
  assert.ok(limitedSite.length <= 2600);

  const shortFacebook = "Contenu déjà conforme.";
  assert.equal(
    limitBoosterGeneratedContent("facebook", shortFacebook),
    shortFacebook,
  );
});
