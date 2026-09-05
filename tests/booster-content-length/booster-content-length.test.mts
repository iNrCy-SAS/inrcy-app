import assert from "node:assert/strict";
import test from "node:test";
import {
  BOOSTER_CHANNEL_CONTENT_RULES,
  formatBoosterGeneratedContentRule,
  getBoosterContentLengthForChannel,
  limitBoosterGeneratedContent,
} from "../../lib/boosterChannelRules.ts";

test("Booster uses the validated SEO length table for every channel", () => {
  assert.deepEqual(BOOSTER_CHANNEL_CONTENT_RULES, {
    inrcy_site: {
      adapted: { min: 1000, max: 1900 },
      short: { min: 600, max: 950 },
      medium: { min: 1100, max: 1700 },
      long: { min: 1800, max: 2600 },
      deep: { min: 2700, max: 3800 },
      detailed: { min: 1800, max: 2400 },
      max: 4200,
    },
    site_web: {
      adapted: { min: 1100, max: 2100 },
      short: { min: 600, max: 950 },
      medium: { min: 1100, max: 1700 },
      long: { min: 1800, max: 2800 },
      deep: { min: 3000, max: 4500 },
      detailed: { min: 1800, max: 2400 },
      max: 5000,
    },
    inr_search: {
      adapted: { min: 140, max: 240 },
      short: { min: 90, max: 140 },
      medium: { min: 150, max: 210 },
      long: { min: 220, max: 275 },
      deep: { min: 275, max: 300 },
      detailed: { min: 230, max: 290 },
      max: 300,
    },
    gmb: {
      adapted: { min: 350, max: 750 },
      short: { min: 220, max: 350 },
      medium: { min: 400, max: 650 },
      long: { min: 700, max: 1050 },
      deep: { min: 1000, max: 1400 },
      detailed: { min: 700, max: 1000 },
      max: 1500,
    },
    facebook: {
      adapted: { min: 350, max: 900 },
      short: { min: 220, max: 400 },
      medium: { min: 450, max: 750 },
      long: { min: 800, max: 1300 },
      deep: { min: 1300, max: 2000 },
      detailed: { min: 800, max: 1200 },
      max: 2200,
    },
    instagram: {
      adapted: { min: 260, max: 650 },
      short: { min: 150, max: 280 },
      medium: { min: 300, max: 500 },
      long: { min: 620, max: 1000 },
      deep: { min: 1000, max: 1800 },
      detailed: { min: 620, max: 950 },
      max: 2200,
    },
    linkedin: {
      adapted: { min: 550, max: 1100 },
      short: { min: 350, max: 600 },
      medium: { min: 650, max: 1000 },
      long: { min: 1100, max: 1800 },
      deep: { min: 1800, max: 2700 },
      detailed: { min: 1100, max: 1700 },
      max: 3000,
    },
    tiktok: {
      adapted: { min: 140, max: 360 },
      short: { min: 80, max: 150 },
      medium: { min: 160, max: 300 },
      long: { min: 380, max: 700 },
      deep: { min: 700, max: 1050 },
      detailed: { min: 380, max: 650 },
      max: 1200,
    },
    youtube_shorts: {
      adapted: { min: 500, max: 1100 },
      short: { min: 300, max: 500 },
      medium: { min: 600, max: 950 },
      long: { min: 1000, max: 1700 },
      deep: { min: 1700, max: 2500 },
      detailed: { min: 1000, max: 1600 },
      max: 2800,
    },
    pinterest: {
      adapted: { min: 160, max: 300 },
      short: { min: 100, max: 160 },
      medium: { min: 180, max: 260 },
      long: { min: 320, max: 460 },
      deep: { min: 440, max: 500 },
      detailed: { min: 320, max: 460 },
      max: 500,
    },
  });
});

test("the AI directive separates the preferred range from the absolute content ceiling", () => {
  assert.equal(
    formatBoosterGeneratedContentRule("pinterest", "detailed"),
    "320–460 caractères de contenu principal. Maximum absolu : 500 caractères dans content, à ne jamais dépasser.",
  );
  assert.equal(
    formatBoosterGeneratedContentRule("site_web", "medium"),
    "1100–1700 caractères de contenu principal. Maximum absolu : 5000 caractères dans content, à ne jamais dépasser.",
  );
});

test("site and social channels resolve their independent length preferences", () => {
  const preferences = {
    length: "medium" as const,
    webLength: "deep" as const,
    socialLength: "short" as const,
  };

  assert.equal(getBoosterContentLengthForChannel(preferences, "site_web"), "deep");
  assert.equal(getBoosterContentLengthForChannel(preferences, "inr_search"), "deep");
  assert.equal(getBoosterContentLengthForChannel(preferences, "facebook"), "short");
  assert.equal(getBoosterContentLengthForChannel(preferences, "gmb"), "short");
});

test("every preferred range is coherent and remains below its publication ceiling", () => {
  for (const [channel, rules] of Object.entries(BOOSTER_CHANNEL_CONTENT_RULES)) {
    for (const mode of ["adapted", "short", "medium", "long", "deep"] as const) {
      assert.ok(rules[mode].min <= rules[mode].max, `${channel}/${mode}: inverted range`);
      assert.ok(rules[mode].max <= rules.max, `${channel}/${mode}: exceeds hard ceiling`);
    }
    assert.ok(rules.deep.max >= rules.long.max, `${channel}: deep must allow at least long`);
  }
});

test("generated content is capped locally without a second AI call and keeps a natural boundary", () => {
  const pinterest = `${"Phrase utile pour Pinterest. ".repeat(25)}Dernière phrase.`;
  const limitedPinterest = limitBoosterGeneratedContent("pinterest", pinterest);
  assert.ok(limitedPinterest.length <= 500);
  assert.match(limitedPinterest, /[.!?…]$/);

  const site = `${"Paragraphe SEO local suffisamment développé. ".repeat(90)}Fin.`;
  const limitedSite = limitBoosterGeneratedContent("inrcy_site", site);
  assert.ok(limitedSite.length <= 4200);

  const shortFacebook = "Contenu déjà conforme.";
  assert.equal(
    limitBoosterGeneratedContent("facebook", shortFacebook),
    shortFacebook,
  );
});
