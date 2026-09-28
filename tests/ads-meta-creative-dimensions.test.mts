import assert from "node:assert/strict";
import test from "node:test";

import {
  assertMetaCreativeDimensions,
  getMetaCreativeVisualDimensions,
  META_CREATIVE_DIMENSION_RULES,
  META_CREATIVE_RATIO_TOLERANCE,
  validateMetaCreativeDimensions,
} from "../lib/adsMetaCreativeDimensions.ts";

test("les formats recommandés Meta Feed et Story/Reel sont acceptés", () => {
  const feed = validateMetaCreativeDimensions("feed", {
    width: 1080,
    height: 1350,
  });
  const story = validateMetaCreativeDimensions("storyReel", {
    width: 1080,
    height: 1920,
  });

  assert.equal(feed.valid, true);
  assert.equal(feed.actualRatio, 4 / 5);
  assert.equal(story.valid, true);
  assert.equal(story.actualRatio, 9 / 16);
  assert.equal(META_CREATIVE_DIMENSION_RULES.feed.minimumWidth, 600);
  assert.equal(META_CREATIVE_DIMENSION_RULES.storyReel.minimumWidth, 540);
});

test("la tolérance accepte un arrondi d’encodeur mais pas le mauvais format", () => {
  const roundedFeed = validateMetaCreativeDimensions("feed", {
    width: 1080,
    height: 1349,
  });
  const roundedStory = validateMetaCreativeDimensions("storyReel", {
    width: 1080,
    height: 1918,
  });
  const squareForFeed = validateMetaCreativeDimensions("feed", {
    width: 1080,
    height: 1080,
  });
  const feedForStory = validateMetaCreativeDimensions("storyReel", {
    width: 1080,
    height: 1350,
  });

  assert.equal(roundedFeed.valid, true);
  assert.ok((roundedFeed.relativeRatioDeviation || 0) < META_CREATIVE_RATIO_TOLERANCE);
  assert.equal(roundedStory.valid, true);
  assert.equal(squareForFeed.issue, "wrong_aspect_ratio");
  assert.equal(feedForStory.issue, "wrong_aspect_ratio");
});

test("une image trop petite ou sans dimensions est refusée", () => {
  const tooSmallFeed = validateMetaCreativeDimensions("feed", {
    width: 400,
    height: 500,
  });
  const tooSmallStory = validateMetaCreativeDimensions("storyReel", {
    width: 450,
    height: 800,
  });
  const unknown = validateMetaCreativeDimensions("feed", {
    width: null,
    height: null,
  });

  assert.equal(tooSmallFeed.issue, "below_minimum");
  assert.match(tooSmallFeed.message || "", /600 × 750/);
  assert.equal(tooSmallStory.issue, "below_minimum");
  assert.match(tooSmallStory.message || "", /540 × 960/);
  assert.equal(unknown.issue, "missing_dimensions");
  assert.throws(
    () => assertMetaCreativeDimensions("feed", { width: 1080, height: 1920 }),
    /format vertical 4:5/,
  );
});

test("l’orientation EXIF est appliquée avant de contrôler le ratio", () => {
  assert.deepEqual(
    getMetaCreativeVisualDimensions({
      width: 1350,
      height: 1080,
      orientation: 6,
    }),
    { width: 1080, height: 1350 },
  );
  assert.equal(
    validateMetaCreativeDimensions("feed", {
      width: 1350,
      height: 1080,
      orientation: 6,
    }).valid,
    true,
  );
});
