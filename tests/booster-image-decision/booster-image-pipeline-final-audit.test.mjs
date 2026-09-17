import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) =>
  readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("final audit keeps per-channel fallbacks local and lets Instagram publish a partial carousel", async () => {
  const route = await read("app/api/booster/publish-now/route.ts");
  const channelContext = await read(
    "app/api/booster/publish-now/publishNow.channel-context.ts",
  );

  assert.match(channelContext, /const pickCompleteChannelImageUrls/);
  assert.match(channelContext, /never borrow a fallback from another channel/i);
  assert.match(channelContext, /urls\.length >= expected/);
  assert.match(channelContext, /legacyUrls\.length < expected/);
  assert.match(channelContext, /allowPartial \? legacyUrls : \[\]/);
  assert.match(route, /candidates: \["instagramPublishableUrls"\]/);
  assert.match(route, /allowPartial: true/);
  assert.match(route, /getInstagramPartialImagesWarning/);
  assert.match(route, /instagramPublishImagesBestEffortWithTokenFallback/);
  assert.match(route, /_asyncExpectedImageCount/);
  assert.match(route, /facebookImageUrls/);
  assert.match(route, /linkedInImages/);
  assert.match(route, /gmbChannelImages/);
  assert.match(route, /siteImageUrls/);
});

test("Instagram editing publishes available derivatives and reports the missing photos", async () => {
  const actions = await read("lib/inrsend/publicationChannelActions.ts");

  assert.match(actions, /function getInstagramImageSelection/);
  assert.match(actions, /const urls = prepared\.length \? prepared : originals/);
  assert.match(actions, /uploadInstagramPublicationImagesBestEffort/);
  assert.match(actions, /expectedImageCount/);
  assert.match(actions, /getInstagramPartialImagesWarning/);
  assert.match(actions, /instagramPublishImagesBestEffortWithTokenFallback/);
  assert.doesNotMatch(actions, /Rien n'a été publié/);
});

test("Instagram safely falls back from an unbuilt carousel to one photo", async () => {
  const instagramPublish = await read("lib/instagramPublish.ts");

  assert.match(
    instagramPublish,
    /function canSafelyFallbackFromCarouselToPhoto/,
  );
  assert.match(instagramPublish, /!publishWasAttempted/);
  assert.match(
    instagramPublish,
    /instagramPublishImagesBestEffortWithTokenFallback/,
  );
  assert.match(instagramPublish, /const readyChildren/);
  assert.match(instagramPublish, /publishedImageCount: readyChildren\.length/);
  assert.match(instagramPublish, /publishedImageCount: photoResult\.ok \? 1 : 0/);
});

test("final audit only uses a complete TikTok storage-path set", async () => {
  const route = await read("app/api/booster/publish-now/route.ts");

  assert.match(route, /expectedTiktokImageCount/);
  assert.match(route, /hasCompleteTikTokPaths/);
  assert.match(route, /const socialStoragePaths/);
  assert.match(route, /const sourceStoragePaths/);
  assert.match(route, /hasCompleteTikTokPaths\(socialStoragePaths\)/);
  assert.match(route, /hasCompleteTikTokPaths\(sourceStoragePaths\)/);
  assert.match(route, /explicitTiktokImageSet[\s\S]*socialStoragePaths\.slice/);
  assert.match(route, /sourceStoragePaths\.slice/);
  assert.match(route, /photo_locked/);
});

test("final audit uses safe integer render dimensions for channel targets", async () => {
  const matrix = await read("lib/boosterImageDecision.ts");
  const controller = await read(
    "app/dashboard/booster/publier/usePublishImageController.ts",
  );
  const panel = await read(
    "app/dashboard/booster/publier/components/PublishImagesPanel.tsx",
  );

  assert.match(matrix, /getBoosterImageRenderDimensions/);
  assert.match(matrix, /Math\.ceil\(baseWidth \/ targetRatio - 1e-9\)/);
  assert.match(controller, /getBoosterImageRenderDimensions/);
  assert.match(panel, /getBoosterImageRenderDimensions/);
});
